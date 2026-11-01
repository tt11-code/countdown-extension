(function () {
  'use strict';

  const STORAGE_KEY = 'countdownData';
  const RESEARCH_STORAGE_KEY = 'countdownResearch';
  const RESEARCH_VERSION = 5;

  function makeId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalize(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const milestones = Array.isArray(source.milestones) ? source.milestones : [];
    const normalizedMilestones = milestones.map((milestone) => ({
      id: typeof milestone.id === 'string' && milestone.id ? milestone.id : makeId(),
      title: typeof milestone.title === 'string' ? milestone.title : '',
      date: typeof milestone.date === 'string' ? milestone.date : '',
      time: typeof milestone.time === 'string' ? milestone.time : '',
      subtitle: typeof milestone.subtitle === 'string' ? milestone.subtitle : ''
    }));
    const validIds = new Set(normalizedMilestones.map((milestone) => milestone.id));
    const order = Array.isArray(source.order)
      ? source.order.filter((id) => id === 'birthday' || validIds.has(id))
      : [];
    normalizedMilestones.forEach((milestone) => {
      if (!order.includes(milestone.id)) order.push(milestone.id);
    });
    if (source.birthday && !order.includes('birthday')) order.unshift('birthday');
    return {
      birthday: typeof source.birthday === 'string' ? source.birthday : '',
      birthdayEnabled: source.birthdayEnabled !== false,
      researchEnabled: source.researchEnabled !== false,
      milestones: normalizedMilestones,
      order
    };
  }

  function normalizeResearch(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      researchVersion: Number.isInteger(source.researchVersion) ? source.researchVersion : RESEARCH_VERSION,
      milestoneId: typeof source.milestoneId === 'string' ? source.milestoneId : '',
      milestoneSignature: typeof source.milestoneSignature === 'string' ? source.milestoneSignature : '',
      fetchedAt: Number(source.fetchedAt) || 0,
      lastAttemptAt: Number(source.lastAttemptAt) || 0,
      lastAttemptStatus: ['ok', 'empty', 'error'].includes(source.lastAttemptStatus) ? source.lastAttemptStatus : '',
      currentPage: Math.max(1, Number(source.currentPage) || 1),
      pool: Array.isArray(source.pool) ? source.pool : [],
      seenUrls: Array.isArray(source.seenUrls) ? source.seenUrls.filter((value) => typeof value === 'string').slice(-300) : [],
      seenPeople: Array.isArray(source.seenPeople) ? source.seenPeople.filter((value) => typeof value === 'string').slice(-200) : [],
      usedTemplateKeys: Array.isArray(source.usedTemplateKeys) ? source.usedTemplateKeys.filter((value) => typeof value === 'string') : [],
      rejectionCounts: source.rejectionCounts && typeof source.rejectionCounts === 'object' ? source.rejectionCounts : {}
    };
  }

  function get() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const source = result[STORAGE_KEY];
        const normalized = normalize(source);
        if (source && source.research && typeof source.research === 'object') {
          chrome.storage.local.set({
            [STORAGE_KEY]: normalized,
            [RESEARCH_STORAGE_KEY]: normalizeResearch(source.research)
          }, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(normalized);
          });
        } else resolve(normalized);
      });
    });
  }

  function getResearch() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([RESEARCH_STORAGE_KEY, STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const legacy = result[RESEARCH_STORAGE_KEY] || (result[STORAGE_KEY] && result[STORAGE_KEY].research);
        const research = normalizeResearch(legacy);
        const cleanup = () => {
          if (!result[RESEARCH_STORAGE_KEY] && result[STORAGE_KEY] && result[STORAGE_KEY].research) {
            const migrated = normalize(result[STORAGE_KEY]);
            chrome.storage.local.set({ [STORAGE_KEY]: migrated, [RESEARCH_STORAGE_KEY]: research }, () => resolve(research));
          } else resolve(research);
        };
        cleanup();
      });
    });
  }

  function save(data) {
    const normalized = normalize(data);
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: normalized }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(normalized);
      });
    });
  }

  function saveResearch(research) {
    const normalized = normalizeResearch(research);
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [RESEARCH_STORAGE_KEY]: normalized }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(normalized);
      });
    });
  }

  window.CountdownStorage = {
    STORAGE_KEY,
    RESEARCH_STORAGE_KEY,
    RESEARCH_VERSION,
    makeId,
    normalize,
    normalizeResearch,
    get,
    getResearch,
    save,
    saveResearch
  };
}());
