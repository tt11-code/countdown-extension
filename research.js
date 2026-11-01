(function () {
  'use strict';

  const CACHE_MAX_AGE = 1000 * 60 * 60 * 24;
  const API_ROOT = 'https://en.wikipedia.org/w/api.php';
  const GDELT_ROOT = 'https://api.gdeltproject.org/api/v2/doc/doc';

  function milestoneSignature(milestone) {
    return [milestone.id, milestone.title, milestone.subtitle, milestone.date, milestone.time].join('|');
  }

  function ageContext(data) {
    if (!data.birthday) return '';
    const birthday = CountdownLogic.nextBirthday(data.birthday, new Date());
    return birthday ? String(birthday.age) : '';
  }

  function eligibleContext(data) {
    const birthday = data.birthdayEnabled && data.birthday ? {
      id: 'birthday',
      title: 'Birthday',
      subtitle: 'Interesting achievements and stories connected to the age I am turning',
      date: data.birthday,
      age: ageContext(data)
    } : null;
    const byId = new Map(data.milestones.map((milestone) => [milestone.id, milestone]));
    return (data.order || []).map((id) => id === 'birthday' ? birthday : byId.get(id)).filter(Boolean)[0] || null;
  }

  function categoryFor(milestone) {
    const text = `${milestone.title} ${milestone.subtitle}`.toLowerCase();
    if (milestone.id === 'birthday' || /\b(turn|age|aged|year[- ]old|birthday)\b/.test(text)) return { type: 'age', age: milestone.age || (text.match(/\b\d{1,3}\b/) || [])[0] };
    if (/\bgraduat|degree|college|university|school|academic\b/.test(text)) return { type: 'education' };
    if (/\bjob|career|work|employ|profession|hire\b/.test(text)) return { type: 'career' };
    if (/\bstart|found|launch|business|company|entrepreneur\b/.test(text)) return { type: 'business' };
    if (/\bmove|relocat|abroad|immigra|expat\b/.test(text)) return { type: 'relocation' };
    if (/\blanguage|fluent|learn\b/.test(text)) return { type: 'language' };
    if (/\bvisit|travel|trip|explor|japan|france|italy|canada|london\b/.test(text)) return { type: 'travel' };
    if (/\bmarathon|run|race|cycling|climb\b/.test(text)) return { type: 'sport' };
    return { type: 'general' };
  }

  function fallbackQueries(milestone) {
    const category = categoryFor(milestone);
    const text = `${milestone.title} ${milestone.subtitle}`.trim();
    const queries = {
      age: [`notable achievements at age ${category.age}`, `people events when they were ${category.age}`, `famous people career at age ${category.age}`],
      education: [`graduation stories educational achievements`, `people earned degree overcoming challenges`, `notable university graduation achievements`],
      career: [`first job career beginnings success story`, `people found employment after career change`, `overcame unemployment career story`],
      business: [`entrepreneur company founding story`, `people started successful business`, `startup founder journey`],
      relocation: [`people moved abroad life story`, `international relocation experience`, `starting over in another country`],
      language: [`people learned a new language journey`, `language learning achievement story`, `became fluent in another language`],
      travel: [`interesting travel experience ${text}`, `${text} travel discoveries`, `${text} notable places`],
      sport: [`first marathon achievement story`, `people completed marathon journey`, `notable running achievement`],
      general: [`${text} achievement story`, `${text} life experience`, `people accomplished ${text}`]
    };
    return queries[category.type] || queries.general;
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

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'en.wikipedia.org' ? url.href : '';
    } catch (error) { return ''; }
  }

  function safeImageUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && (url.hostname === 'upload.wikimedia.org' || url.hostname === 'en.wikipedia.org') ? url.href : '';
    } catch (error) { return ''; }
  }

  function relevant(result, milestone, category) {
    const haystack = `${result.title} ${result.snippet || ''}`.toLowerCase();
    if (/disambiguation/i.test(result.title)) return false;
    if (category.type === 'age') return new RegExp(`\\b${category.age}\\b|\\bage\\b|\\baged\\b|\\byear[- ]old\\b`).test(haystack);
    const concepts = {
      education: 'graduat|degree|university|college|education|academic',
      career: 'job|career|work|employment|professional|company',
      business: 'business|company|entrepreneur|founder|startup',
      relocation: 'move|abroad|immigra|country|relocat',
      language: 'language|fluent|linguist|speak',
      travel: 'travel|visit|journey|destination',
      sport: 'marathon|run|race|athlet'
    };
    return new RegExp(concepts[category.type] || '[a-z]').test(haystack);
  }

  async function search(query, milestone, category) {
    const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '10', format: 'json', origin: '*' });
    const payload = await request(`${API_ROOT}?${params}`);
    const results = payload && payload.query && Array.isArray(payload.query.search) ? payload.query.search : [];
    return results.filter((result) => relevant(result, milestone, category));
  }

  async function gdeltSearch(query) {
    const params = new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: '10', sort: 'HybridRel' });
    const payload = await request(`${GDELT_ROOT}?${params}`);
    const articles = payload && Array.isArray(payload.articles) ? payload.articles : [];
    return articles.map((article) => {
      try {
        const url = new URL(article.url);
        if (url.protocol !== 'https:') return null;
        return {
          title: typeof article.title === 'string' ? article.title : '',
          summary: typeof article.seendate === 'string' ? `Published ${article.seendate.slice(0, 8)} by ${url.hostname}.` : `Reported by ${url.hostname}.`,
          url: url.href,
          image: ''
        };
      } catch (error) { return null; }
    }).filter((article) => article && article.title && article.url);
  }

  async function details(results) {
    if (!results.length) return [];
    const params = new URLSearchParams({
      action: 'query', prop: 'extracts|pageimages|info', exintro: '1', explaintext: '1',
      exchars: '600', piprop: 'thumbnail', pithumbsize: '240', inprop: 'url',
      redirects: '1', titles: results.map((result) => result.title).join('|'),
      format: 'json', formatversion: '2', origin: '*'
    });
    const payload = await request(`${API_ROOT}?${params}`);
    const pages = payload && payload.query && Array.isArray(payload.query.pages) ? payload.query.pages : [];
    return pages.map((page) => {
      const url = safeUrl(page.fullurl || '');
      if (!page.title || !page.extract || !url) return null;
      return { title: page.title, summary: page.extract, url, image: page.thumbnail && safeImageUrl(page.thumbnail.source) ? page.thumbnail.source : '' };
    }).filter(Boolean);
  }

  async function fetchResults(milestone, data) {
    const fallback = fallbackQueries(milestone);
    const interpretation = await CountdownAI.interpret(milestone, { queries: fallback });
    const queries = Array.isArray(interpretation.queries) ? interpretation.queries.filter((query) => typeof query === 'string' && query.trim()).slice(0, 5) : fallback;
    const category = categoryFor(milestone);
    const found = [];
    for (const query of [...queries, ...fallback]) {
      let results = [];
      try { results = await search(query, milestone, category); } catch (error) { results = []; }
      results.forEach((result) => {
        if (!found.some((item) => item.title === result.title)) found.push(result);
      });
      if (found.length >= 8) break;
    }
    let articles = await details(found.slice(0, 5));
    for (const query of fallback.slice(0, 2)) {
      let external = [];
      try { external = await gdeltSearch(query); } catch (error) { external = []; }
      external.forEach((article) => {
        if (!articles.some((existing) => existing.url === article.url)) articles.push(article);
      });
    }
    const ranking = await CountdownAI.rank(milestone, articles);
    if (Array.isArray(ranking)) {
      articles = ranking.filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.index < articles.length)
        .sort((a, b) => Number(b.score) - Number(a.score))
        .map((item) => articles[item.index])
        .filter(Boolean);
    }
    const summarized = [];
    for (const article of articles.slice(0, 5)) {
      summarized.push(Object.assign({}, article, { summary: await CountdownAI.summarize(article) }));
    }
    return summarized;
  }

  async function getOrFetch(data, forceRefresh) {
    const milestone = eligibleContext(data);
    if (!milestone) return { data, results: [] };
    const cache = data.research || {};
    const signature = milestone.id === 'birthday'
      ? `birthday|${milestone.age}|${data.birthday}`
      : milestoneSignature(milestone);
    const fresh = cache.milestoneId === milestone.id && cache.milestoneSignature === signature
      && Date.now() - Number(cache.fetchedAt) < CACHE_MAX_AGE;
    if (!forceRefresh && fresh && Array.isArray(cache.results)) return { data, results: cache.results };
    const results = await fetchResults(milestone, data);
    const updated = Object.assign({}, data, { research: { milestoneId: milestone.id, milestoneSignature: signature, fetchedAt: Date.now(), results } });
    await CountdownStorage.save(updated);
    return { data: updated, results };
  }

  window.CountdownResearch = { CACHE_MAX_AGE, eligibleContext, categoryFor, fallbackQueries, fetchResults, getOrFetch, milestoneSignature };
}());
