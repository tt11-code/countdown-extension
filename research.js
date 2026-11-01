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
      subtitle: 'Interesting documented achievements connected to the age I am turning',
      date: data.birthday,
      age: ageContext(data)
    } : null;
    const byId = new Map(data.milestones.map((milestone) => [milestone.id, milestone]));
    return (data.order || []).map((id) => id === 'birthday' ? birthday : byId.get(id)).filter(Boolean)[0] || null;
  }

  function categoryFor(milestone) {
    const text = `${milestone.title} ${milestone.subtitle}`.toLowerCase();
    if (milestone.id === 'birthday' || /\b(turn|age|aged|year[- ]old|birthday)\b/.test(text)) return { type: 'age', age: String(milestone.age || (text.match(/\b\d{1,3}\b/) || [])[0] || '') };
    if (/\bgraduat|degree|college|university|school|academic\b/.test(text)) return { type: 'education' };
    if (/\bdoctor|physician|medical|medicine|lawyer|attorney|pilot|aviation|actor|acting\b/.test(text)) return { type: 'professional' };
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
      age: [`notable achievements at age ${category.age}`, `people achieved something when they were ${category.age}`, `career beginnings at age ${category.age}`],
      education: ['documented graduation stories educational achievements', 'people earned a degree overcoming challenges', 'notable university graduation achievements'],
      professional: [`documented ${text} career journey`, `people became professionals in ${text}`, `${text} education and career beginnings`],
      career: ['documented first job career beginnings success story', 'people found employment after career change', 'overcame unemployment career story'],
      business: ['documented entrepreneur company founding story', 'people started a successful business', 'startup founder journey'],
      relocation: ['documented people moved abroad life story', 'international relocation experience', 'starting over in another country'],
      language: ['documented people learned a new language journey', 'language learning achievement story', 'became fluent in another language'],
      travel: [`interesting documented travel experience ${text}`, `${text} travel discoveries`, `${text} notable places`],
      sport: ['documented first marathon achievement story', 'people completed marathon journey', 'notable running achievement'],
      general: [`${text} documented achievement story`, `${text} life experience`, `people accomplished ${text}`]
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

  function httpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch (error) { return ''; }
  }

  function safeWikiUrl(value) {
    const url = httpsUrl(value);
    return url && new URL(url).hostname === 'en.wikipedia.org' ? url : '';
  }

  function safeImageUrl(value) {
    const url = httpsUrl(value);
    if (!url) return '';
    const hostname = new URL(url).hostname;
    return hostname === 'upload.wikimedia.org' || hostname === 'en.wikipedia.org' ? url : '';
  }

  function ageEvidence(text, age) {
    const clean = String(text || '').replace(/\s+/g, ' ');
    if (!age || /\bGilded Age\b|\bIce Age\b|\bStone Age\b|\bMiddle Ages\b/i.test(clean)) return '';
    const pattern = new RegExp(`(?:at the age of|at age|at|aged|when (?:he|she|they) was|when (?:he|she|they) were)\\s+${age}\\b[^.?!]*[.!?]`, 'i');
    const match = clean.match(pattern);
    return match ? match[0].trim() : '';
  }

  function relevant(result, milestone, category) {
    const haystack = `${result.title} ${result.snippet || ''}`.toLowerCase();
    if (/disambiguation|doctor who|doctor sleep|seventh doctor|gilded age|ice age|stone age|middle ages/i.test(result.title)) return false;
    if (category.type === 'age') return !/\b(age of|history of the|period)\b/i.test(haystack);
    const concepts = {
      education: 'graduat|degree|university|college|education|academic',
      professional: 'doctor|physician|medical|medicine|lawyer|attorney|pilot|aviation|actor|acting',
      career: 'job|career|work|employment|professional|company',
      business: 'business|company|entrepreneur|founder|startup',
      relocation: 'move|abroad|immigra|country|relocat',
      language: 'language|fluent|linguist|speak',
      travel: 'travel|visit|journey|destination',
      sport: 'marathon|run|race|athlet'
    };
    return new RegExp(concepts[category.type] || '[a-z]').test(haystack);
  }

  async function searchWiki(query, milestone, category) {
    const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '10', format: 'json', origin: '*' });
    const payload = await request(`${API_ROOT}?${params}`);
    const results = payload && payload.query && Array.isArray(payload.query.search) ? payload.query.search : [];
    return results.filter((result) => relevant(result, milestone, category));
  }

  async function searchGdelt(query) {
    const params = new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: '10', sort: 'HybridRel' });
    const payload = await request(`${GDELT_ROOT}?${params}`);
    return (payload && Array.isArray(payload.articles) ? payload.articles : []).map((article) => {
      const url = httpsUrl(article.url);
      if (!url || !article.title) return null;
      return {
        title: article.title,
        summary: typeof article.seendate === 'string' ? `Published ${article.seendate.slice(0, 8)} by ${new URL(url).hostname}.` : `Reported by ${new URL(url).hostname}.`,
        url,
        image: httpsUrl(article.socialimage),
        imageType: article.socialimage ? 'publisher' : ''
      };
    }).filter(Boolean);
  }

  async function details(results, milestone, category) {
    if (!results.length) return [];
    const params = new URLSearchParams({
      action: 'query', prop: 'extracts|pageimages|info', exintro: '1', explaintext: '1',
      exchars: '700', piprop: 'thumbnail', pithumbsize: '320', inprop: 'url',
      redirects: '1', titles: results.map((result) => result.title).join('|'),
      format: 'json', formatversion: '2', origin: '*'
    });
    const payload = await request(`${API_ROOT}?${params}`);
    const pages = payload && payload.query && Array.isArray(payload.query.pages) ? payload.query.pages : [];
    return pages.map((page) => {
      const url = safeWikiUrl(page.fullurl || '');
      if (!page.title || !page.extract || !url) return null;
      const evidence = category.type === 'age' ? ageEvidence(page.extract, category.age) : '';
      if (category.type === 'age' && !evidence) return null;
      return {
        title: page.title,
        originalTitle: page.title,
        summary: page.extract,
        url,
        image: page.thumbnail && safeImageUrl(page.thumbnail.source) ? page.thumbnail.source : '',
        imageType: page.thumbnail ? 'article' : '',
        ageVerified: Boolean(evidence),
        age: evidence ? Number(category.age) : null,
        evidence
      };
    }).filter(Boolean);
  }

  async function fetchResults(milestone) {
    const category = categoryFor(milestone);
    const fallback = fallbackQueries(milestone);
    const interpretation = await CountdownAI.interpret(milestone, { queries: fallback });
    const queries = Array.isArray(interpretation.queries) ? interpretation.queries.filter((query) => typeof query === 'string' && query.trim()).slice(0, 5) : fallback;
    const found = [];
    for (const query of [...queries, ...fallback]) {
      try {
        const results = await searchWiki(query, milestone, category);
        results.forEach((result) => {
          if (!found.some((item) => item.title === result.title)) found.push(result);
        });
      } catch (error) { /* Continue with other public sources. */ }
      if (found.length >= 8) break;
    }
    let articles = await details(found.slice(0, 8), milestone, category);
    if (category.type !== 'age') {
      for (const query of fallback.slice(0, 2)) {
        try {
          const external = await searchGdelt(query);
          external.forEach((article) => {
            if (!articles.some((existing) => existing.url === article.url)) articles.push(article);
          });
        } catch (error) { /* Rate limits must not break countdowns. */ }
      }
    }
    const ranking = await CountdownAI.rank(milestone, articles);
    if (Array.isArray(ranking)) {
      articles = ranking.filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.index < articles.length)
        .sort((a, b) => Number(b.score) - Number(a.score))
        .map((item) => articles[item.index]).filter(Boolean);
    }
    const results = [];
    for (const article of articles.slice(0, 5)) {
      const fallbackTitle = article.ageVerified
        ? `${article.originalTitle} — documented achievement at age ${article.age}`
        : `${article.originalTitle} — relevant ${category.type} story`;
      const displayTitle = await CountdownAI.displayTitle(milestone, article, fallbackTitle);
      const summary = await CountdownAI.summarize(article);
      results.push(Object.assign({}, article, { displayTitle, summary }));
    }
    return results;
  }

  async function getOrFetch(data, forceRefresh) {
    const milestone = eligibleContext(data);
    if (!milestone) return { data, results: [] };
    const signature = milestone.id === 'birthday' ? `birthday|${milestone.age}|${data.birthday}` : milestoneSignature(milestone);
    const cache = data.research || {};
    const fresh = cache.milestoneId === milestone.id && cache.milestoneSignature === signature && Date.now() - Number(cache.fetchedAt) < CACHE_MAX_AGE;
    if (!forceRefresh && fresh && Array.isArray(cache.results)) return { data, results: cache.results };
    const results = await fetchResults(milestone);
    const updated = Object.assign({}, data, { research: { milestoneId: milestone.id, milestoneSignature: signature, fetchedAt: Date.now(), results } });
    await CountdownStorage.save(updated);
    return { data: updated, results };
  }

  window.CountdownResearch = { CACHE_MAX_AGE, eligibleContext, categoryFor, fallbackQueries, fetchResults, getOrFetch, milestoneSignature, ageEvidence };
}());
