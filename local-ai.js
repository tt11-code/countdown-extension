(function () {
  'use strict';

  let sessionPromise = null;

  function getApi() {
    return typeof LanguageModel !== 'undefined' ? LanguageModel : null;
  }

  async function availability() {
    const model = getApi();
    if (!model || typeof model.availability !== 'function') return 'unavailable';
    try { return await model.availability(); } catch (error) { return 'unavailable'; }
  }

  async function createSession(withMonitor) {
    const model = getApi();
    if (!model) return null;
    const state = await availability();
    if (state !== 'available' && !withMonitor) return null;
    try {
      return await model.create({
        temperature: 0.2,
        topK: 3,
        monitor: withMonitor ? (monitor) => {
          monitor.addEventListener('downloadprogress', (event) => {
            window.dispatchEvent(new CustomEvent('countdown-ai-download', { detail: event.loaded }));
          });
        } : undefined
      });
    } catch (error) {
      return null;
    }
  }

  async function session() {
    if (!sessionPromise) sessionPromise = createSession(false);
    return sessionPromise;
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch (error) {
      const match = String(text).match(/[\[{][\s\S]*[\]}]/);
      if (!match) return null;
      try { return JSON.parse(match[0]); } catch (parseError) { return null; }
    }
  }

  async function promptJson(prompt, schema) {
    const active = await session();
    if (!active) return null;
    try {
      const response = await active.prompt(prompt, {
        responseConstraint: schema
      });
      return parseJson(response);
    } catch (constraintError) {
      try {
        const response = await active.prompt(prompt);
        return parseJson(response);
      } catch (promptError) {
        return null;
      }
    }
  }

  function describe(context) {
    return `Title: ${context.title}\nDescription: ${context.subtitle || ''}\nTarget date: ${context.date || ''}\nTarget age: ${context.age || ''}`;
  }

  async function interpret(context, previousQueries) {
    const schema = {
      type: 'object',
      properties: {
        category: { type: 'string' },
        intention: { type: 'string' },
        queries: { type: 'array', items: { type: 'string' }, minItems: 8, maxItems: 10 },
        keywords: { type: 'array', items: { type: 'string' } }
      },
      required: ['category', 'intention', 'queries', 'keywords']
    };
    return promptJson(`Understand this milestone and generate only research queries, never facts. Queries must use achievement-oriented language such as accolades, achievements, achievers, awards, records, youngest, first, hall of fame, notable people, or success story. Cover different fields and angles. ${previousQueries.length ? `Do not repeat or closely paraphrase these previous queries: ${JSON.stringify(previousQueries)}.` : ''}\n${describe(context)}`, schema);
  }

  async function rank(context, articles) {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          score: { type: 'number' },
          relevant: { type: 'boolean' },
          reason: { type: 'string' }
        },
        required: ['index', 'score', 'relevant', 'reason']
      }
    };
    return promptJson(`Rank only these retrieved article metadata for relevance to the milestone. Do not invent facts. Return one object per article.\n${describe(context)}\n${JSON.stringify(articles)}`, schema);
  }

  async function presentation(context, article) {
    const schema = {
      type: 'object',
      properties: { displayTitle: { type: 'string' }, summary: { type: 'string' } },
      required: ['displayTitle', 'summary']
    };
    return promptJson(`Create a concise display title and one-sentence summary using only the supplied extract and evidence. Do not add numbers, ages, dates, achievements, or relationships absent from the source. If specificity is unsupported, use a cautious generic title.\nMilestone:\n${describe(context)}\nArticle:\n${JSON.stringify(article)}`, schema);
  }

  async function setup() {
    const state = await availability();
    if (state === 'unavailable') return state;
    const active = await createSession(true);
    if (!active) return 'unavailable';
    sessionPromise = Promise.resolve(active);
    return 'available';
  }

  window.CountdownAI = { availability, setup, interpret, rank, presentation };
}());
