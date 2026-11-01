(function () {
  'use strict';

  const STORAGE_KEY = 'countdownData';

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
      order,
      research: source.research && typeof source.research === 'object'
        ? source.research
        : { milestoneId: '', fetchedAt: 0, results: [] }
    };
  }

  function get() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(normalize(result[STORAGE_KEY]));
      });
    });
  }

  function save(data) {
    const normalized = normalize(data);
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: normalized }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(normalized);
      });
    });
  }

  window.CountdownStorage = { STORAGE_KEY, makeId, normalize, get, save };
}());
