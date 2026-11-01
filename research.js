(function () {
  'use strict';

  const CACHE_MAX_AGE = 1000 * 60 * 60 * 24;
  const API_ROOT = 'https://en.wikipedia.org/w/api.php';

  function milestoneSignature(milestone) {
    return [milestone.id, milestone.title, milestone.subtitle, milestone.date, milestone.time].join('|');
  }

  function categoryFor(milestone) {
    const text = `${milestone.title} ${milestone.subtitle}`.toLowerCase();
    const ageMatch = text.match(/\b(?:turn|age|aged|year[- ]old)\s*(\d{1,3})\b/) || text.match(/\b(\d{1,3})\s*(?:st|nd|rd|th)?\s*birthday\b/);
    if (ageMatch) return { type: 'age', age: Number(ageMatch[1]) };
    if (/\bgraduat|degree|college|university|school\b/.test(text)) return { type: 'education' };
    if (/\bstart|found|launch|business|company|entrepreneur\b/.test(text)) return { type: 'business' };
    if (/\bmove|relocat|abroad|immigra|expat\b/.test(text)) return { type: 'relocation' };
    if (/\bvisit|travel|trip|explor|japan|france|italy|canada|london\b/.test(text)) return { type: 'travel' };
    if (/\bmarathon|run|race|cycling|climb\b/.test(text)) return { type: 'sport' };
    if (/\bjob|career|work|promot|profession\b/.test(text)) return { type: 'career' };
    return { type: 'general' };
  }

  function queriesFor(milestone) {
    const category = categoryFor(milestone);
    const text = `${milestone.title} ${milestone.subtitle}`.trim();
    if (category.type === 'age') return [`people achievements at age ${category.age}`, `notable events age ${category.age}`];
    if (category.type === 'education') return [`notable graduation stories ${text}`, `educational achievements ${text}`];
    if (category.type === 'business') return [`entrepreneurs founded company ${text}`, `company founding story ${text}`];
    if (category.type === 'relocation') return [`people moved abroad ${text}`, `international relocation stories ${text}`];
    if (category.type === 'travel') return [`travel experiences ${text}`, `${text} travel destinations`];
    if (category.type === 'sport') return [`notable marathon achievements ${text}`, `running achievement ${text}`];
    if (category.type === 'career') return [`career achievement ${text}`, `professional success story ${text}`];
    return [`${text} notable achievements`, `${text} real world stories`];
  }

  function request(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'fetchResearch', url }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response || !response.ok) {
          reject(new Error(response && response.error ? response.error : 'Research request failed.'));
        } else {
          resolve(response.payload);
        }
      });
    });
  }

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'en.wikipedia.org' ? url.href : '';
    } catch (error) {
      return '';
    }

    function safeImageUrl(value) {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && (url.hostname === 'upload.wikimedia.org' || url.hostname === 'en.wikipedia.org')
          ? url.href
          : '';
      } catch (error) {
        return '';
      }
    }
  }

  function relevant(result, milestone, category) {
    const haystack = `${result.title} ${result.snippet || ''}`.toLowerCase();
    const terms = `${milestone.title} ${milestone.subtitle}`.toLowerCase().split(/\W+/).filter((term) => term.length > 3);
    const hasContext = category.type === 'age'
      ? /\bage\b|\baged\b|\byear[- ]old\b|\bat \d{1,3}\b/.test(haystack)
      : terms.length === 0 || terms.some((term) => haystack.includes(term));
    return hasContext && !/disambiguation/i.test(result.title);
  }

  async function search(query, milestone, category) {
    const params = new URLSearchParams({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: '8',
      format: 'json',
      origin: '*'
    });
    const payload = await request(`${API_ROOT}?${params}`);
    const results = payload && payload.query && Array.isArray(payload.query.search) ? payload.query.search : [];
    return results.filter((result) => relevant(result, milestone, category)).slice(0, 4);
  }

  async function details(results) {
    if (!results.length) return [];
    const titles = results.map((result) => result.title).join('|');
    const params = new URLSearchParams({
      action: 'query',
      prop: 'extracts|pageimages|info',
      exintro: '1',
      explaintext: '1',
      exchars: '420',
      piprop: 'thumbnail',
      pithumbsize: '240',
      inprop: 'url',
      redirects: '1',
      titles,
      format: 'json',
      formatversion: '2',
      origin: '*'
    });
    const payload = await request(`${API_ROOT}?${params}`);
    const pages = payload && payload.query && Array.isArray(payload.query.pages) ? payload.query.pages : [];
    return pages.map((page) => {
      const sourceUrl = safeUrl(page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title || '')}`);
      if (!page.title || !page.extract || !sourceUrl) return null;
      return {
        title: page.title,
        summary: page.extract,
        url: sourceUrl,
        image: page.thumbnail && safeImageUrl(page.thumbnail.source) ? page.thumbnail.source : ''
      };
    }).filter(Boolean).slice(0, 5);
  }

  async function fetchResults(milestone) {
    const category = categoryFor(milestone);
    const queryResults = [];
    for (const query of queriesFor(milestone)) {
      const results = await search(query, milestone, category);
      results.forEach((result) => {
        if (!queryResults.some((existing) => existing.title === result.title)) queryResults.push(result);
      });
      if (queryResults.length >= 5) break;
    }
    return details(queryResults.slice(0, 5));
  }

  async function getOrFetch(data, forceRefresh) {
    const milestone = data.milestones[0];
    if (!milestone) return { data, results: [] };
    const cache = data.research || {};
    const signature = milestoneSignature(milestone);
    const fresh = cache.milestoneId === milestone.id
      && cache.milestoneSignature === signature
      && Date.now() - Number(cache.fetchedAt) < CACHE_MAX_AGE;
    if (!forceRefresh && fresh && Array.isArray(cache.results)) return { data, results: cache.results };
    const results = await fetchResults(milestone);
    const updated = Object.assign({}, data, {
      research: { milestoneId: milestone.id, milestoneSignature: signature, fetchedAt: Date.now(), results }
    });
    await CountdownStorage.save(updated);
    return { data: updated, results };
  }

  window.CountdownResearch = { CACHE_MAX_AGE, categoryFor, queriesFor, fetchResults, getOrFetch, milestoneSignature };
}());
