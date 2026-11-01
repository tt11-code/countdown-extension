(function () {
  'use strict';

  const dashboard = document.getElementById('dashboard');
  const message = document.getElementById('dashboard-message');
  const researchColumns = [
    document.getElementById('research-left'),
    document.getElementById('research-right')
  ];
  let data = null;
  let timerId = null;
  let researchRequest = null;
  let researchGeneration = 0;

  function textElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function renderCountdowns() {
    if (!data) return;
    dashboard.replaceChildren();
    const now = new Date();
    const milestonesById = new Map(data.milestones.map((milestone) => [milestone.id, milestone]));
    (data.order || []).forEach((id) => {
      if (id === 'birthday') {
        if (!data.birthdayEnabled || !data.birthday) return;
        const birthday = CountdownLogic.nextBirthday(data.birthday, now);
        if (!birthday) return;
        const item = document.createElement('article');
        item.className = 'countdown-item';
        item.appendChild(textElement('p', 'countdown', CountdownLogic.formatDuration(birthday.target - now)));
        item.appendChild(textElement('p', 'age-text', `Until I turn ${birthday.age} years old`));
        dashboard.appendChild(item);
        return;
      }
      const milestone = milestonesById.get(id);
      if (!milestone) return;
      const item = document.createElement('article');
      item.className = 'countdown-item';
      const target = CountdownLogic.milestoneTarget(milestone);
      if (!target || target <= now) {
        item.appendChild(textElement('p', 'arrived', 'This milestone has arrived.'));
      } else {
        item.appendChild(textElement('p', 'countdown', CountdownLogic.formatDuration(target - now)));
      }
      item.appendChild(textElement('p', 'item-title', milestone.title));
      if (milestone.subtitle) item.appendChild(textElement('p', 'item-subtitle', milestone.subtitle));
      dashboard.appendChild(item);
    });
    if (!data.birthdayEnabled && data.milestones.length === 0) {
      message.textContent = 'Birthday countdown is disabled. Use the extension toolbar icon to configure countdowns.';
    } else if (!data.birthdayEnabled) {
      message.textContent = 'Birthday countdown is disabled.';
    } else if (!data.birthday && data.milestones.length === 0) {
      message.textContent = 'Use the extension toolbar icon to add your birthday.';
    } else {
      message.textContent = '';
    }
  }

  function renderResearch(results, loading) {
    researchColumns.forEach((column) => column.replaceChildren());
    if (loading) {
      researchColumns[0].appendChild(textElement('p', 'research-status', 'Finding milestone inspiration...'));
      return;
    }
    if (!data || !data.researchEnabled || !CountdownResearch.eligibleContext(data)) return;
    const refresh = textElement('button', 'research-refresh', 'Refresh inspiration');
    refresh.type = 'button';
    refresh.addEventListener('click', () => loadResearch(true));
    researchColumns[1].appendChild(refresh);
    if (!results || !results.length) {
      researchColumns[0].appendChild(textElement('p', 'research-status', 'No suitable inspiration found.'));
      return;
    }
    results.forEach((result, index) => {
      const item = document.createElement('article');
      item.className = 'research-item';
      if (result.image) {
        const image = document.createElement('img');
        image.src = result.image;
        image.alt = '';
        image.loading = 'lazy';
        item.appendChild(image);
      }
      const title = document.createElement('a');
      title.href = result.url;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
      title.textContent = result.title;
      item.appendChild(title);
      item.appendChild(textElement('p', 'research-summary', result.summary));
      researchColumns[index % 2].appendChild(item);
    });
  }

  async function loadResearch(forceRefresh) {
    if (!data || !CountdownResearch.eligibleContext(data) || researchRequest) return;
    const generation = ++researchGeneration;
    researchRequest = CountdownResearch.getOrFetch(data, forceRefresh)
      .then((result) => {
        if (generation !== researchGeneration) return;
        data = result.data;
        renderResearch(result.results, false);
      })
      .catch(() => {
        if (generation !== researchGeneration) return;
        const cache = data.research;
        const context = CountdownResearch.eligibleContext(data);
        const signature = context && (context.id === 'birthday'
          ? `birthday|${context.age}|${data.birthday}`
          : CountdownResearch.milestoneSignature(context));
        renderResearch(cache && context && cache.milestoneId === context.id
          && cache.milestoneSignature === signature ? cache.results : [], false);
      })
      .finally(() => {
        if (generation === researchGeneration) researchRequest = null;
      });
    renderResearch([], true);
  }

  async function init() {
    try {
      data = await CountdownStorage.get();
      renderCountdowns();
      if (data.researchEnabled && CountdownResearch.eligibleContext(data)) loadResearch(false);
      if (timerId) clearInterval(timerId);
      timerId = window.setInterval(renderCountdowns, 1000);
    } catch (error) {
      message.textContent = `Unable to load saved countdowns: ${error.message}`;
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[CountdownStorage.STORAGE_KEY]) return;
    const next = CountdownStorage.normalize(changes[CountdownStorage.STORAGE_KEY].newValue);
    const previousContext = data ? CountdownResearch.eligibleContext(data) : null;
    const nextContext = CountdownResearch.eligibleContext(next);
    const previousSignature = previousContext ? (previousContext.id === 'birthday' ? `birthday|${previousContext.age}|${data.birthday}` : CountdownResearch.milestoneSignature(previousContext)) : '';
    const nextSignature = nextContext ? (nextContext.id === 'birthday' ? `birthday|${nextContext.age}|${next.birthday}` : CountdownResearch.milestoneSignature(nextContext)) : '';
    const researchContextChanged = previousSignature !== nextSignature;
    const researchSettingChanged = !data || data.researchEnabled !== next.researchEnabled;
    data = next;
    renderCountdowns();
    if (researchContextChanged || researchSettingChanged || !next.researchEnabled) {
      researchGeneration += 1;
      researchRequest = null;
      if (next.researchEnabled) loadResearch(false);
      else renderResearch([], false);
    }
  });

  init();
}());
