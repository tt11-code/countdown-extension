chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'fetchResearch') return false;
  let url;
  try {
    url = new URL(message.url);
  } catch (error) {
    sendResponse({ ok: false, error: 'Invalid research URL.' });
    return false;
  }
  if (url.protocol !== 'https:' || !['en.wikipedia.org', 'upload.wikimedia.org'].includes(url.hostname)) {
    sendResponse({ ok: false, error: 'Research URL is not allowed.' });
    return false;
  }
  fetch(url.href, { headers: { Accept: 'application/json' } })
    .then((response) => {
      if (!response.ok) throw new Error(`Research request failed (${response.status}).`);
      return response.json();
    })
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});
