(function () {
  'use strict';

  const RESEARCH_VERSION = 5;
  const INSPIRATIONS_PER_PAGE = 4;
  const CACHE_MAX_AGE = 1000 * 60 * 60 * 24;
  const API_ROOT = 'https://en.wikipedia.org/w/api.php';
  const FILLER_PHRASES = [
    /^until\s+i\s+/i, /^until\s+/i, /^i\s+will\s+/i, /^become\s+(?:a|an)\s+/i,
    /^to\s+be\s+/i, /^to\s+become\s+/i, /^get\s+my\s+/i, /^finish\s+/i,
    /^graduate\s+as\s+/i
  ];
  const KEYWORDS = ['accolades', 'achievements', 'achievers', 'awards', 'records', 'youngest', 'first', 'hall of fame', 'success story'];
  const AGE_TEMPLATES = [
    '{a} year old accolades', '{a}-year-old youngest person to achieve a major record',
    'notable achievements by a {a} year old', 'teenager at age {a} award winner',
    'at age {a} became the youngest to', 'inspiring story of someone who accomplished something remarkable at {a}'
  ];
  const TOPIC_TEMPLATES = [
    'real inspiring stories about people who became a {topic}',
    '{topic} success story overcoming obstacles', 'notable {topic} achievements and awards',
    'youngest {topic} in history', 'first in their family to become a {topic}',
    'people who changed careers to become a {topic}'
  ];

  function eligibleContext(data) {
    const birthday = data.birthdayEnabled && data.birthday ? {
      id: 'birthday',
      title: 'birthday',
      subtitle: '',
      date: data.birthday,
      age: String(CountdownLogic.nextBirthday(data.birthday, new Date()).age)
    } : null;
    const byId = new Map(data.milestones.map((item) => [item.id, item]));
    return (data.order || []).map((id) => id === 'birthday' ? birthday : byId.get(id)).filter(Boolean)[0] || null;
  }

  function milestoneSignature(milestone) {
    return [milestone.id, milestone.title, milestone.subtitle, milestone.date, milestone.time].join('|');
  }

  function interpret(context) {
    const raw = `${context.title} ${context.subtitle || ''}`.trim();
    const ageMatch = raw.match(/turn(?:ing)?\s+(\d{1,3})|(\d{1,3})\s*(?:years?[- ]old|yrs?)/i);
    if (context.id === 'birthday' || ageMatch) {
      const age = Number(context.age || (ageMatch && (ageMatch[1] || ageMatch[2])));
      return { type: 'age', age, ages: [age - 1, age].filter((value) => value > 0), topic: '' };
    }
    let topic = context.title.trim();
    FILLER_PHRASES.forEach((phrase) => { topic = topic.replace(phrase, ''); });
    topic = topic.replace(/^[\s:,-]+|[\s:,-]+$/g, '').trim() || context.title.trim();
    return { type: 'topic', age: null, ages: [], topic };
  }

  function request(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const error = new Error('Network request failed.');
          error.code = 'network';
          reject(error);
        } else if (!response || !response.ok) {
          const error = new Error(response && response.code ? response.code : 'other');
          error.code = response && response.code ? response.code : 'other';
          error.detail = response && response.detail ? response.detail : '';
          reject(error);
        } else resolve(response);
      });
    });
  }

  function canonicalUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return '';
      url.hash = '';
      return url.href;
    } catch (error) { return ''; }
  }

  function normalizePerson(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function normalizedText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function containsEvidence(result, quote) {
    const evidence = normalizedText(quote);
    const source = normalizedText([result.text, ...(Array.isArray(result.highlights) ? result.highlights : [])].join(' '));
    if (!evidence || !source) return false;
    if (source.includes(evidence)) return true;
    const words = evidence.split(' ').filter((word) => word.length > 2);
    return words.length >= 5 && words.filter((word) => source.includes(word)).length / words.length >= 0.75;
  }

  const numberWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  function hasAgeEvidence(quote, ages) {
    const text = normalizedText(quote);
    return ages.some((age) => new RegExp(`\\b${age}\\b`).test(text) || text.includes(numberWords[age] || '__missing__'));
  }

  function ageFromText(text, ages) {
    const normalized = normalizedText(text);
    return ages.find((age) => new RegExp(`\\b${age}\\b`).test(normalized) || normalized.includes(numberWords[age] || '__missing__')) || null;
  }

  function topicEvidence(item, topic) {
    const words = normalizedText(topic).split(' ').filter((word) => word.length > 2);
    const text = normalizedText(`${item.achievement} ${item.evidenceQuote}`);
    const synonyms = { doctor: ['physician', 'medical'], lawyer: ['attorney', 'legal'], artist: ['painter', 'sculptor', 'creative'] };
    return words.some((word) => text.includes(word)) || words.some((word) => (synonyms[word] || []).some((synonym) => text.includes(synonym)));
  }

  function schema() {
    return {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'person_story, listicle, or other' },
        personName: { type: 'string', description: 'Full name of the person, or empty string if none' },
        ageAtAchievement: { type: 'number', description: 'Age stated on the page, or 0 if not stated' },
        achievement: { type: 'string' },
        evidenceQuote: { type: 'string' },
        isRelevant: { type: 'boolean' }
      },
      required: ['kind', 'personName', 'ageAtAchievement', 'achievement', 'evidenceQuote', 'isRelevant']
    };
  }

  function templateChoice(interpreted, used, attempt, forceRefresh) {
    const templates = interpreted.type === 'age' ? AGE_TEMPLATES : TOPIC_TEMPLATES;
    const age = interpreted.type === 'age' ? interpreted.ages[attempt % interpreted.ages.length] : null;
    const eligibleTemplates = templates.filter((template) => !(template.startsWith('teenager') && age >= 20));
    const candidates = eligibleTemplates.map((template) => ({ template, key: `${interpreted.type}-${templates.indexOf(template)}` }))
      .filter((entry) => !used.includes(entry.key));
    const wrappedTemplates = eligibleTemplates.map((template) => ({ template, key: `${interpreted.type}-${templates.indexOf(template)}` }));
    const entry = candidates[attempt] || wrappedTemplates[attempt % wrappedTemplates.length];
    if (interpreted.type === 'age' && !forceRefresh && attempt === 0) {
      return { key: entry.key, query: `${interpreted.age} year old person accolades` };
    }
    const keyword = KEYWORDS[(used.length + attempt) % KEYWORDS.length];
    const templateText = entry.template.toLowerCase();
    const keywordText = KEYWORDS[(used.length + attempt) % KEYWORDS.length];
    const suffix = templateText.includes(keywordText.toLowerCase()) ? '' : ` ${keywordText}`;
    if (interpreted.type === 'age') {
      return { key: entry.key, query: `${entry.template.replace('{a}', age)}${suffix}` };
    }
    return { key: entry.key, query: `${entry.template.replace('{topic}', interpreted.topic)}${suffix}` };
  }

  function validateResult(result, interpreted, seenUrls, seenPeople) {
    const url = canonicalUrl(result.url);
    let summary = result.summary;
    if (typeof summary === 'string') {
      try { summary = JSON.parse(summary); } catch (error) { summary = {}; }
    }
    summary = summary && typeof summary === 'object' ? summary : {};
    const highlights = Array.isArray(result.highlights) ? result.highlights : [];
    const sourceText = String(result.text || highlights[0] || '');
    let evidenceQuote = typeof summary.evidenceQuote === 'string' && summary.evidenceQuote.trim()
      ? summary.evidenceQuote.trim()
      : (highlights[0] || sourceText.split(/(?<=[.!?])\s+/)[0] || '');
    if (!containsEvidence(result, evidenceQuote)) {
      evidenceQuote = highlights[0] || sourceText.split(/(?<=[.!?])\s+/)[0] || '';
    }
    const achievement = typeof summary.achievement === 'string' && summary.achievement.trim()
      ? summary.achievement.trim()
      : evidenceQuote;
    const item = {
      url,
      originalTitle: String(result.title || ''),
      kind: typeof summary.kind === 'string' ? summary.kind : '',
      personName: typeof summary.personName === 'string' ? summary.personName.trim() : '',
      ageAtAchievement: Number(summary.ageAtAchievement) > 0 ? Number(summary.ageAtAchievement) : null,
      achievement,
      evidenceQuote,
      isRelevant: summary.isRelevant !== false,
      publishedDate: typeof result.publishedDate === 'string' ? result.publishedDate : '',
      exaImage: canonicalImage(result.image),
      text: sourceText,
      highlights
    };
    if (!item.url) return { item: null, reason: 'noUrl' };
    if (!item.originalTitle) return { item: null, reason: 'noUrl' };
    if (/listicle|roundup|collection/i.test(item.kind)) return { item: null, reason: 'listicle' };
    if (!item.isRelevant) return { item: null, reason: 'notRelevant' };
    if (!item.personName) return { item: null, reason: 'noPerson' };
    if (!item.achievement) return { item: null, reason: 'noAchievement' };
    if (!item.evidenceQuote) return { item: null, reason: 'noEvidence' };
    if (seenUrls.has(item.url) || seenPeople.has(normalizePerson(item.personName))) return { item: null, reason: 'duplicate' };
    if (interpreted.type === 'age') {
      const ageInEvidence = hasAgeEvidence(`${item.evidenceQuote} ${item.achievement} ${item.text}`, interpreted.ages);
      if (!interpreted.ages.includes(item.ageAtAchievement) && !ageInEvidence) return { item: null, reason: 'ageMismatch' };
      if (!interpreted.ages.includes(item.ageAtAchievement) && ageInEvidence) {
        item.ageAtAchievement = ageFromText(`${item.evidenceQuote} ${item.achievement} ${item.text}`, interpreted.ages);
      }
    }
    if (interpreted.type === 'topic' && !topicEvidence(item, interpreted.topic)) return { item: null, reason: 'topicMismatch' };
    item.displayTitle = `${item.personName} — ${item.achievement}`.slice(0, 90).trim();
    item.summary = `${item.achievement.replace(/[.!?]+$/, '')}.`;
    return { item, reason: '' };
  }

  function canonicalImage(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch (error) { return ''; }
  }

  async function search(query) {
    const response = await request({ type: 'exaSearch', query, numResults: 15, schema: schema() });
    return response.results || [];
  }

  async function fetchPool(interpreted, cache, forceRefresh, status) {
    const seenUrls = new Set(forceRefresh ? cache.seenUrls || [] : []);
    const seenPeople = new Set(forceRefresh ? cache.seenPeople || [] : []);
    const used = cache.usedTemplateKeys || [];
    const pool = [];
    const allPool = [];
    const chosenKeys = [];
    const rejected = {
      noUrl: 0, listicle: 0, notRelevant: 0, noPerson: 0, noAchievement: 0,
      noEvidence: 0, ageMismatch: 0, duplicate: 0, topicMismatch: 0
    };
    for (let attempt = 0; attempt < 2 && pool.length < 8; attempt += 1) {
      const choice = templateChoice(interpreted, [...used, ...chosenKeys], attempt, forceRefresh);
      chosenKeys.push(choice.key);
      status('Searching sources…');
      const results = await search(choice.query);
      status('Verifying results…');
      results.forEach((result) => {
        const validation = validateResult(result, interpreted, new Set(), new Set());
        if (!validation.item) {
          rejected[validation.reason] += 1;
          return;
        }
        const item = validation.item;
        if (allPool.some((existing) => existing.url === item.url || normalizePerson(existing.personName) === normalizePerson(item.personName))) {
          rejected.duplicate += 1;
          return;
        }
        allPool.push(item);
        if (seenUrls.has(item.url) || seenPeople.has(normalizePerson(item.personName))) {
          rejected.duplicate += 1;
          return;
        }
        seenUrls.add(item.url);
        seenPeople.add(normalizePerson(item.personName));
        pool.push(item);
      });
      // TEMP-DEBUG
      console.debug('[Inspiration] fetch:', { query: choice.query, received: results.length, kept: pool.length, rejected: Object.assign({}, rejected) });
    }
    return {
      pool: pool.slice(0, 12),
      allPool: allPool.slice(0, 12),
      rejected,
      usedTemplateKeys: [...new Set([...used, ...chosenKeys])].slice(-AGE_TEMPLATES.length - TOPIC_TEMPLATES.length)
    };
  }

  async function wikiImage(personName) {
    const url = `${API_ROOT}?${new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', origin: '*',
      prop: 'extracts|pageimages|info', exintro: '1', explaintext: '1',
      piprop: 'thumbnail', pithumbsize: '320', inprop: 'url', redirects: '1',
      titles: personName
    })}`;
    const response = await request({ type: 'fetchResearch', method: 'GET', url });
    const page = response.payload && response.payload.query && response.payload.query.pages && response.payload.query.pages[0];
    if (!page || normalizePerson(page.title) !== normalizePerson(personName) || !/\bborn\b/i.test(page.extract || '')) return null;
    const image = canonicalImage(page.thumbnail && page.thumbnail.source);
    if (!image || !/^https:\/\/upload\.wikimedia\.org\//i.test(image)) return null;
    return { url: image, credit: 'Image: Wikipedia', creditUrl: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}` };
  }

  async function resolveImage(item) {
    if (item.imageResolved) return item;
    const wiki = await wikiImage(item.personName).catch(() => null);
    if (wiki) Object.assign(item, { image: wiki.url, imageCredit: wiki.credit, imageCreditUrl: wiki.creditUrl });
    else if (item.exaImage) Object.assign(item, { image: item.exaImage, imageCredit: `Image: ${new URL(item.url).hostname}` });
    else item.image = '';
    item.imageResolved = true;
    return item;
  }

  async function getOrFetch(data, forceRefresh, status) {
    const context = eligibleContext(data);
    if (!context) return { data, pool: [] };
    const interpreted = interpret(context);
    const signature = context.id === 'birthday' ? `birthday|${interpreted.age}|${data.birthday}` : milestoneSignature(context);
    const cache = data.research;
    if (!forceRefresh && cache.researchVersion === RESEARCH_VERSION && cache.milestoneSignature === signature
      && Date.now() - Number(cache.fetchedAt) < CACHE_MAX_AGE && Array.isArray(cache.pool) && cache.pool.length) return { data, pool: cache.pool };
    const result = await fetchPool(interpreted, cache, forceRefresh, status);
    if (forceRefresh && result.pool.length < INSPIRATIONS_PER_PAGE && (cache.seenUrls || []).length) {
      status("You've seen most available inspirations, starting over.");
      result.pool = result.allPool;
    }
    if (!result.pool.length) {
      return {
        data: Object.assign({}, data, {
          research: Object.assign({}, data.research, { pool: [] })
        }),
        pool: [],
        rejectionCounts: result.rejected
      };
    }
    const updated = Object.assign({}, data, {
      research: {
        researchVersion: RESEARCH_VERSION,
        milestoneId: context.id,
        milestoneSignature: signature,
        fetchedAt: Date.now(),
        currentPage: 1,
        pool: result.pool,
        seenUrls: forceRefresh && result.pool.length >= INSPIRATIONS_PER_PAGE ? cache.seenUrls || [] : [],
        seenPeople: forceRefresh && result.pool.length >= INSPIRATIONS_PER_PAGE ? cache.seenPeople || [] : [],
        usedTemplateKeys: result.usedTemplateKeys
      }
    });
    await CountdownStorage.save(updated);
    return { data: updated, pool: result.pool, rejectionCounts: result.rejected };
  }

  window.CountdownResearch = {
    RESEARCH_VERSION,
    INSPIRATIONS_PER_PAGE,
    FILLER_PHRASES,
    eligibleContext,
    milestoneSignature,
    interpret,
    resolveImage,
    getOrFetch
  };
}());
