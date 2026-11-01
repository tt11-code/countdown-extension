(function () {
  'use strict';

  const RESEARCH_VERSION = 5;
  const INSPIRATIONS_PER_PAGE = 4;
  const CACHE_MAX_AGE = 1000 * 60 * 60 * 24;
  const ATTEMPT_COOLDOWN = 1000 * 60 * 30;
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
  const EMPTY_REJECTIONS = () => ({
    noUrl: 0, listicle: 0, notRelevant: 0, noPerson: 0, noAchievement: 0,
    noEvidence: 0, ageMismatch: 0, duplicate: 0, topicMismatch: 0
  });

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

  function evidenceInSource(result, quote) {
    const source = normalizedText([result.text, ...(Array.isArray(result.highlights) ? result.highlights : [])].join(' '));
    return Boolean(source && normalizedText(quote) && source.includes(normalizedText(quote)));
  }

  const numberWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  function hasAgeEvidence(text, ages) {
    const normalized = normalizedText(text);
    return ages.some((age) => new RegExp(`\\b${age}\\b`).test(normalized) || normalized.includes(numberWords[age] || '__missing__'));
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
    const eligible = templates.filter((template) => !(template.startsWith('teenager') && age >= 20));
    const entries = eligible.map((template) => ({ template, key: `${interpreted.type}-${templates.indexOf(template)}` }));
    const unused = entries.filter((entry) => !used.includes(entry.key));
    const entry = unused[attempt] || entries[attempt % entries.length];
    if (interpreted.type === 'age' && !forceRefresh && attempt === 0) {
      return { key: entry.key, query: `${interpreted.age} year old person accolades` };
    }
    const keyword = KEYWORDS[(used.length + attempt) % KEYWORDS.length];
    const suffix = entry.template.toLowerCase().includes(keyword.toLowerCase()) ? '' : ` ${keyword}`;
    return {
      key: entry.key,
      query: `${entry.template.replace('{a}', age).replace('{topic}', interpreted.topic)}${suffix}`
    };
  }

  function canonicalImage(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch (error) { return ''; }
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
    let evidenceQuote = typeof summary.evidenceQuote === 'string' ? summary.evidenceQuote.trim() : '';
    if ((!evidenceQuote || !evidenceInSource(result, evidenceQuote)) && (highlights.length || sourceText)) {
      evidenceQuote = highlights[0] || sourceText.split(/(?<=[.!?])\s+/)[0] || '';
    }
    const achievement = typeof summary.achievement === 'string' ? summary.achievement.trim() : '';
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
    if (!item.url || !item.originalTitle) return { item: null, reason: 'noUrl' };
    if (/listicle|roundup|collection/i.test(item.kind)) return { item: null, reason: 'listicle' };
    if (!item.isRelevant) return { item: null, reason: 'notRelevant' };
    if (!item.personName) return { item: null, reason: 'noPerson' };
    if (!item.achievement) return { item: null, reason: 'noAchievement' };
    if (!item.evidenceQuote) return { item: null, reason: 'noEvidence' };
    if (seenUrls.has(item.url) || seenPeople.has(normalizePerson(item.personName))) return { item: null, reason: 'duplicate' };
    if (interpreted.type === 'age') {
      const ageText = `${item.evidenceQuote} ${item.achievement} ${item.text}`;
      if (!interpreted.ages.includes(item.ageAtAchievement) && !hasAgeEvidence(ageText, interpreted.ages)) return { item: null, reason: 'ageMismatch' };
      item.ageAtAchievement = interpreted.ages.includes(item.ageAtAchievement) ? item.ageAtAchievement : ageFromText(ageText, interpreted.ages);
    }
    if (interpreted.type === 'topic' && !topicEvidence(item, interpreted.topic)) return { item: null, reason: 'topicMismatch' };
    item.displayTitle = `${item.personName} — ${item.achievement}`.slice(0, 90).trim();
    item.summary = `${item.achievement.replace(/[.!?]+$/, '')}.`;
    return { item, reason: '' };
  }

  async function search(query) {
    const response = await request({ type: 'exaSearch', query, numResults: 10, schema: schema() });
    return response.results || [];
  }

  async function fetchPool(interpreted, cache, forceRefresh, status) {
    const seenUrls = new Set(forceRefresh ? cache.seenUrls || [] : []);
    const seenPeople = new Set(forceRefresh ? cache.seenPeople || [] : []);
    const used = cache.usedTemplateKeys || [];
    const pool = [];
    const allPool = [];
    const chosenKeys = [];
    const rejected = EMPTY_REJECTIONS();
    const attempts = forceRefresh ? 2 : 1;
    for (let attempt = 0; attempt < attempts && pool.length < 8; attempt += 1) {
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
      seenUrls: [...seenUrls],
      seenPeople: [...seenPeople],
      rejected,
      usedTemplateKeys: [...new Set([...used, ...chosenKeys])].slice(-AGE_TEMPLATES.length - TOPIC_TEMPLATES.length)
    };
  }

  async function wikiImage(personName) {
    const url = `${API_ROOT}?${new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', origin: '*', prop: 'extracts|pageimages|info',
      exintro: '1', explaintext: '1', piprop: 'thumbnail', pithumbsize: '320', inprop: 'url', redirects: '1', titles: personName
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

  async function fetchAndStore(data, context, interpreted, signature, cache, forceRefresh, status) {
    try {
      const result = await fetchPool(interpreted, cache, forceRefresh, status);
      const now = Date.now();
      const research = Object.assign({}, cache, {
        researchVersion: RESEARCH_VERSION,
        milestoneId: context.id,
        milestoneSignature: signature,
        lastAttemptAt: now,
        lastAttemptStatus: result.pool.length ? 'ok' : 'empty',
        rejectionCounts: result.rejected,
        usedTemplateKeys: result.usedTemplateKeys,
        seenUrls: [...new Set([...(forceRefresh ? [] : cache.seenUrls), ...result.seenUrls])],
        seenPeople: [...new Set([...(forceRefresh ? [] : cache.seenPeople), ...result.seenPeople])]
      });
      if ((forceRefresh && result.pool.length) || result.pool.length >= INSPIRATIONS_PER_PAGE || !cache.pool.length) {
        research.pool = result.pool;
        research.fetchedAt = result.pool.length ? now : cache.fetchedAt;
        research.currentPage = 1;
        if (!result.pool.length) research.seenUrls = cache.seenUrls;
        if (!result.pool.length) research.seenPeople = cache.seenPeople;
      }
      const saved = await CountdownStorage.saveResearch(research);
      return { data, pool: saved.pool, research: saved, rejectionCounts: result.rejected };
    } catch (error) {
      const failed = Object.assign({}, cache, {
        researchVersion: RESEARCH_VERSION,
        milestoneId: context.id,
        milestoneSignature: signature,
        lastAttemptAt: Date.now(),
        lastAttemptStatus: 'error'
      });
      await CountdownStorage.saveResearch(failed);
      throw error;
    }
  }

  async function getOrFetch(data, forceRefresh, status) {
    const context = eligibleContext(data);
    if (!context) return { data, pool: [], research: await CountdownStorage.getResearch() };
    const interpreted = interpret(context);
    const signature = context.id === 'birthday' ? `birthday|${interpreted.age}|${data.birthday}` : milestoneSignature(context);
    const cache = await CountdownStorage.getResearch();
    const matching = cache.researchVersion === RESEARCH_VERSION && cache.milestoneSignature === signature;
    const age = Date.now() - Number(cache.fetchedAt);
    if (!forceRefresh && matching && cache.pool.length && age < CACHE_MAX_AGE) return { data, pool: cache.pool, research: cache };
    if (!forceRefresh && matching && cache.lastAttemptAt && Date.now() - cache.lastAttemptAt < ATTEMPT_COOLDOWN
      && (cache.lastAttemptStatus === 'empty' || cache.lastAttemptStatus === 'error')) {
      return { data, pool: cache.pool, research: cache, throttled: true };
    }
    if (!forceRefresh && matching && cache.pool.length && age >= CACHE_MAX_AGE) {
      const refreshPromise = fetchAndStore(data, context, interpreted, signature, cache, false, status);
      return { data, pool: cache.pool, research: cache, stale: true, refreshPromise };
    }
    return fetchAndStore(data, context, interpreted, signature, cache, forceRefresh, status);
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
