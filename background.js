(function () {
  'use strict';

  const EXA_ENDPOINT = 'https://api.exa.ai/search';
  const WIKI_HOST = 'en.wikipedia.org';
  const KEY_STORAGE = 'exaApiKey';

  function send(response, sendResponse) {
    sendResponse(response);
    return false;
  }

  function errorCode(status) {
    if (status === 401 || status === 403) return 'unauthorized';
    if (status === 402) return 'no-credits';
    if (status === 429) return 'rate-limited';
    return 'other';
  }

  async function fetchJson(url, options) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45000);
    try {
      const response = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
      let payload = null;
      try { payload = await response.json(); } catch (error) { payload = null; }
      if (!response.ok) {
        const error = new Error('Remote request failed.');
        error.code = errorCode(response.status);
        error.status = response.status;
        error.detail = JSON.stringify(payload).slice(0, 300);
        throw error;
      }
      return payload;
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error('Remote request timed out.');
        timeoutError.code = 'timeout';
        throw timeoutError;
      }
      if (error.name === 'TypeError') {
        const networkError = new Error('Network request timed out or failed.');
        networkError.code = 'network';
        throw networkError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getKey() {
    const values = await chrome.storage.local.get(KEY_STORAGE);
    return typeof values[KEY_STORAGE] === 'string' ? values[KEY_STORAGE].trim() : '';
  }

  async function searchExa(message, sendResponse) {
    const key = await getKey();
    if (!key) return send({ ok: false, code: 'no-key' }, sendResponse);
    const request = {
      query: String(message.query || ''),
      type: 'auto',
      numResults: Math.min(15, Math.max(1, Number(message.numResults) || 10)),
      contents: {
        highlights: true,
        summary: {
          query: 'Extract only facts stated on this page. If the page does not state a named person’s specific achievement, set personName empty and isRelevant false. Use age 0 if no age is stated. evidenceQuote must be copied verbatim from the page.',
          schema: message.schema
        }
      }
    };
    const startedAt = Date.now();
    try {
      const payload = await fetchJson(EXA_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key },
        body: JSON.stringify(request)
      });
      // TEMP-DEBUG
      console.debug('[Exa] results:', Array.isArray(payload.results) ? payload.results.length : 0, 'durationMs:', Date.now() - startedAt);
      (Array.isArray(payload.results) ? payload.results.slice(0, 2) : []).forEach((result) => {
        console.debug('[Exa] result:', result.title, typeof result.summary, String(result.summary).slice(0, 300));
      });
      return send({ ok: true, results: Array.isArray(payload.results) ? payload.results : [] }, sendResponse);
    } catch (error) {
      return send({ ok: false, code: error.code || 'other', detail: error.detail || '' }, sendResponse);
    }
  }

  async function fetchWikipedia(message, sendResponse) {
    let url;
    try { url = new URL(message.url); } catch (error) { return send({ ok: false, code: 'other' }, sendResponse); }
    if (url.protocol !== 'https:' || url.hostname !== WIKI_HOST || message.method !== 'GET') {
      return send({ ok: false, code: 'other' }, sendResponse);
    }
    try {
      return send({ ok: true, payload: await fetchJson(url.href, { headers: { Accept: 'application/json' } }) }, sendResponse);
    } catch (error) {
      return send({ ok: false, code: error.code || 'network' }, sendResponse);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    if (message.type === 'hasExaKey') {
      getKey().then((key) => sendResponse({ hasKey: Boolean(key) })).catch(() => sendResponse({ hasKey: false }));
      return true;
    }
    if (message.type === 'exaSearch') {
      searchExa(message, sendResponse);
      return true;
    }
    if (message.type === 'fetchResearch') {
      fetchWikipedia(message, sendResponse);
      return true;
    }
    return false;
  });
}());
