(function () {
  'use strict';

  let sessionPromise = null;
  function getApi() { return typeof LanguageModel !== 'undefined' ? LanguageModel : null; }
  async function availability() {
    const model = getApi();
    if (!model || typeof model.availability !== 'function') return 'unavailable';
    try { return await model.availability(); } catch (error) { return 'unavailable'; }
  }
  async function session() {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        const model = getApi();
        const state = await availability();
        if (!model || state !== 'available') return null;
        return model.create({ temperature: 0.1, topK: 3 });
      })().catch(() => null);
    }
    return sessionPromise;
  }
  function parseJson(text) {
    try { return JSON.parse(text); } catch (error) {
      const match = String(text).match(/[\[{][\s\S]*[\]}]/);
      if (!match) return null;
      try { return JSON.parse(match[0]); } catch (parseError) { return null; }
    }
  }
  async function jsonPrompt(prompt, fallback) {
    const active = await session();
    if (!active) return fallback;
    try { return parseJson(await active.prompt(prompt)) || fallback; } catch (error) { return fallback; }
  }
  function describe(context) {
    return `Title: ${context.title}\nDescription: ${context.subtitle || ''}\nTarget date: ${context.date || ''}\nTarget age: ${context.age || ''}`;
  }
  async function interpret(context, fallback) {
    return jsonPrompt(`Return JSON only with category, intention, relatedConcepts, searchTopics, queries, and sourceCategories. Understand this personal milestone and generate four diverse public-source queries without inventing facts.\n${describe(context)}`, fallback);
  }
  async function rank(context, articles) {
    const fallback = articles.map((article, index) => ({ index, score: 1, reason: 'Potentially related to the milestone.' }));
    return jsonPrompt(`Return JSON only as an array of {index,score,reason}. Score supplied articles for relevance to the milestone. Use only supplied metadata; never invent facts.\n${describe(context)}\n${JSON.stringify(articles)}`, fallback);
  }
  async function summarize(article) {
    const fallback = { summary: article.summary };
    const result = await jsonPrompt(`Return JSON only with summary. Write one factual sentence using only this supplied source text. Do not claim facts absent from it.\nTitle: ${article.title}\nSource text: ${article.summary}`, fallback);
    return result && typeof result.summary === 'string' ? result.summary : article.summary;
  }
  async function displayTitle(context, article, fallback) {
    const result = await jsonPrompt(`Return JSON only with title. Write a short, factual, milestone-specific title explaining the relationship between the supplied source and milestone. Use only facts in the source text. If the source does not establish a specific achievement or age, use a cautious general title.\nMilestone: ${JSON.stringify(context)}\nArticle: ${JSON.stringify(article)}`, { title: fallback });
    return result && typeof result.title === 'string' && result.title.trim() ? result.title.trim() : fallback;
  }
  async function setup() {
    const model = getApi();
    if (!model) return 'unavailable';
    try {
      const active = await model.create({
        temperature: 0.1,
        topK: 3,
        monitor(monitorObject) {
          monitorObject.addEventListener('downloadprogress', (event) => {
            window.dispatchEvent(new CustomEvent('countdown-ai-download', { detail: event.loaded }));
          });
        }
      });
      sessionPromise = Promise.resolve(active);
      return 'available';
    } catch (error) {
      sessionPromise = null;
      return 'unavailable';
    }
  }
  window.CountdownAI = { availability, setup, interpret, rank, summarize, displayTitle };
}());
