(function () {
  'use strict';

  const CACHE_MAX_AGE = 1000 * 60 * 60 * 24;
  const API_ROOT = 'https://en.wikipedia.org/w/api.php';

  function milestoneSignature(milestone) {
    return [milestone.id, milestone.title, milestone.subtitle, milestone.date, milestone.time].join('|');
  }

  function eligibleContext(data) {
    const birthday = data.birthdayEnabled && data.birthday ? {
      id: 'birthday',
      title: 'Until I turn',
      subtitle: 'Documented achievements connected to the age I am turning',
      date: data.birthday,
      age: String(CountdownLogic.nextBirthday(data.birthday, new Date()).age)
    } : null;
    const byId = new Map(data.milestones.map((milestone) => [milestone.id, milestone]));
    return (data.order || []).map((id) => id === 'birthday' ? birthday : byId.get(id)).filter(Boolean)[0] || null;
  }

  function request(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'fetchResearch', url }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!response || !response.ok) reject(new Error(response && response.error ? response.error : 'Research request failed.'));
        else resolve(response.payload);
      });
    });
  }

  function httpsWikiUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'en.wikipedia.org' ? url.href : '';
    } catch (error) { return ''; }
  }

  function httpsImageUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'upload.wikimedia.org' && /\.(jpe?g|png)$/i.test(url.pathname) ? url.href : '';
    } catch (error) { return ''; }
  }

  function ageEvidence(text, age) {
    if (!age) return '';
    const clean = String(text || '').replace(/\s+/g, ' ');
    if (/\b(Gilded Age|Ice Age|Stone Age|Middle Ages)\b/i.test(clean)) return '';
    const ages = [Number(age), Number(age) - 1].filter((value) => value > 0);
    for (const candidate of ages) {
      const expression = new RegExp(`(?:at the age of|at age|aged|at|when (?:he|she|they) was|when (?:he|she|they) were)\\s+${candidate}\\b[^.?!]*[.!?]`, 'i');
      const match = clean.match(expression);
      if (match) return match[0].trim();
    }
    return '';
  }

  function sourceNumbersAreValid(text, generated) {
    const sourceNumbers = String(text).match(/\b\d{1,4}\b/g) || [];
    return (String(generated).match(/\b\d{1,4}\b/g) || []).every((number) => sourceNumbers.includes(number));
  }

  function apiParams(params) {
    return new URL(`${API_ROOT}?${new URLSearchParams(Object.assign(params, { format: 'json', formatversion: '2', origin: '*' }))}`).href;
  }

  async function search(query, offset) {
    const payload = await request(apiParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: '10',
      sroffset: String(offset || 0)
    }));
    return payload && payload.query && Array.isArray(payload.query.search) ? payload.query.search : [];
  }

  async function getDetails(titles) {
    const pages = [];
    for (let index = 0; index < titles.length; index += 20) {
      const payload = await request(apiParams({
        action: 'query',
        prop: 'extracts|pageimages|info',
        exintro: '1',
        explaintext: '1',
        exchars: '700',
        piprop: 'thumbnail',
        pithumbsize: '320',
        inprop: 'url',
        redirects: '1',
        titles: titles.slice(index, index + 20).join('|')
      }));
      if (payload && payload.query && Array.isArray(payload.query.pages)) pages.push(...payload.query.pages);
    }
    return pages;
  }

  async function getAlternativeImages(titles) {
    const images = new Map();
    for (const title of titles.slice(0, 10)) {
      try {
        const payload = await request(apiParams({
          action: 'query',
          prop: 'images',
          imlimit: '3',
          titles: title
        }));
        const page = payload && payload.query && payload.query.pages && payload.query.pages[0];
        const imageTitles = page && Array.isArray(page.images) ? page.images.map((image) => image.title).filter((value) => !/icon|logo|flag|map/i.test(value)) : [];
        if (!imageTitles.length) continue;
        const info = await request(apiParams({
          action: 'query',
          prop: 'imageinfo',
          iiprop: 'url|extmetadata',
          iiurlwidth: '320',
          titles: imageTitles[0]
        }));
        const imagePage = info && info.query && info.query.pages && info.query.pages[0];
        const image = imagePage && imagePage.imageinfo && imagePage.imageinfo[0];
        const url = image && httpsImageUrl(image.thumburl || image.url);
        if (url) images.set(title, { url, credit: 'Wikimedia Commons image; see source attribution.' });
      } catch (error) {
        continue;
      }
    }
    return images;
  }

  function buildCandidates(pages, context) {
    const age = context.age;
    return pages.map((page) => {
      const url = httpsWikiUrl(page.fullurl || '');
      if (!page.title || !page.extract || !url) return null;
      const evidence = age ? ageEvidence(page.extract, age) : '';
      if (age && !evidence) return null;
      return {
        originalTitle: page.title,
        title: page.title,
        summary: page.extract,
        url,
        image: page.thumbnail && httpsImageUrl(page.thumbnail.source) ? page.thumbnail.source : '',
        imageType: page.thumbnail ? 'article' : '',
        evidence,
        age: evidence ? Number(age) : null,
        ageVerified: Boolean(evidence)
      };
    }).filter(Boolean);
  }

  async function fetchPool(context, queries, seenUrls) {
    const titles = [];
    for (const query of queries) {
      const results = await search(query, Math.floor(Math.random() * 3) * 10);
      results.forEach((result) => {
        const title = result.title;
        const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
        if (title && !seenUrls.includes(url) && !titles.includes(title) && !/disambiguation|Gilded Age|Doctor Who|Doctor Sleep|Seventh Doctor/i.test(title)) titles.push(title);
      });
      if (titles.length >= 30) break;
    }
    const pages = await getDetails(titles.slice(0, 30));
    const alternatives = await getAlternativeImages(pages.filter((page) => !page.thumbnail).map((page) => page.title));
    const candidates = buildCandidates(pages, context);
    candidates.forEach((candidate) => {
      if (!candidate.image && alternatives.has(candidate.originalTitle)) {
        candidate.image = alternatives.get(candidate.originalTitle).url;
        candidate.imageType = 'commons';
        candidate.imageCredit = alternatives.get(candidate.originalTitle).credit;
      }
    });
    return candidates.filter((candidate, index, list) => list.findIndex((item) => item.url === candidate.url) === index);
  }

  async function rankPool(context, pool) {
    const ranked = [];
    for (let index = 0; index < pool.length; index += 8) {
      const batch = pool.slice(index, index + 8);
      const ranking = await CountdownAI.rank(context, batch.map((item) => ({
        title: item.originalTitle,
        extract: item.summary,
        evidence: item.evidence
      })));
      if (!Array.isArray(ranking)) throw new Error('AI relevance ranking failed.');
      ranking.forEach((item) => {
        if (item.relevant && Number.isFinite(Number(item.score)) && Number.isInteger(item.index) && batch[item.index]) {
          ranked.push(Object.assign({}, batch[item.index], { relevanceScore: Number(item.score), relevanceReason: String(item.reason || '') }));
        }
      });
    }
    return ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  async function getOrFetch(data, forceRefresh, status) {
    const context = eligibleContext(data);
    if (!context) return { data, pool: [], currentPage: 1 };
    const signature = context.id === 'birthday' ? `birthday|${context.age}|${data.birthday}` : milestoneSignature(context);
    const cache = data.research;
    if (!forceRefresh && cache.researchVersion === CountdownStorage.RESEARCH_VERSION
      && cache.milestoneId === context.id && cache.milestoneSignature === signature
      && Date.now() - Number(cache.fetchedAt) < CACHE_MAX_AGE && Array.isArray(cache.pool)) {
      return { data, pool: cache.pool, currentPage: cache.currentPage || 1 };
    }
    const state = await CountdownAI.availability();
    if (state !== 'available') throw new Error(state);
    status('Understanding your milestone…');
    const interpretation = await CountdownAI.interpret(context, forceRefresh ? cache.usedQueries || [] : []);
    if (!interpretation || !Array.isArray(interpretation.queries) || interpretation.queries.length < 1) throw new Error('AI query generation failed.');
    const queries = interpretation.queries.slice(0, 10);
    status('Searching sources…');
    const candidates = await fetchPool(context, queries, forceRefresh ? cache.seenUrls || [] : []);
    status('Checking relevance…');
    let pool = await rankPool(context, candidates);
    const pageTarget = Math.max(2, Math.floor(Math.max(190, window.innerHeight - 110) / 190) * 2);
    let seenUrls = cache.seenUrls || [];
    if (forceRefresh && pool.length < pageTarget) {
      status('Searching for different sources…');
      const retry = await CountdownAI.interpret(context, queries);
      if (retry && Array.isArray(retry.queries)) {
        pool = await rankPool(context, await fetchPool(context, retry.queries.slice(0, 10), cache.seenUrls || []));
      }
      if (pool.length < pageTarget && (cache.seenUrls || []).length) {
        status('You have seen most available inspirations, starting over.');
        pool = await rankPool(context, await fetchPool(context, queries, []));
        seenUrls = [];
      }
    }
    const updated = Object.assign({}, data, {
      research: {
        researchVersion: CountdownStorage.RESEARCH_VERSION,
        milestoneId: context.id,
        milestoneSignature: signature,
        fetchedAt: Date.now(),
        currentPage: 1,
        pool,
        seenUrls,
        usedQueries: [...new Set([...(cache.usedQueries || []), ...queries])].slice(-40)
      }
    });
    await CountdownStorage.save(updated);
    return { data: updated, pool, currentPage: 1 };
  }

  window.CountdownResearch = {
    CACHE_MAX_AGE,
    eligibleContext,
    milestoneSignature,
    sourceNumbersAreValid,
    getOrFetch
  };
}());
