(function () {
  'use strict';

  const dashboard = document.getElementById('dashboard');
  const message = document.getElementById('dashboard-message');
  const columns = [document.getElementById('research-left'), document.getElementById('research-right')];
  const controls = {
    previous: document.getElementById('research-prev'),
    next: document.getElementById('research-next'),
    page: document.getElementById('research-page'),
    refresh: document.getElementById('research-refresh'),
    status: document.getElementById('research-status')
  };
  let data;
  let researchRequest;
  let generation = 0;
  let timerId;

  function node(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function signature(context) {
    return context.id === 'birthday' ? `birthday|${context.age}|${data.birthday}` : CountdownResearch.milestoneSignature(context);
  }

  function renderCountdowns() {
    dashboard.replaceChildren();
    const now = new Date();
    const milestones = new Map(data.milestones.map((item) => [item.id, item]));
    (data.order || []).forEach((id) => {
      if (id === 'birthday') {
        if (!data.birthdayEnabled || !data.birthday) return;
        const birthday = CountdownLogic.nextBirthday(data.birthday, now);
        const item = node('article', 'countdown-item');
        item.appendChild(node('p', 'countdown', CountdownLogic.formatDuration(birthday.target - now)));
        item.appendChild(node('p', 'age-text', `Until I turn ${birthday.age} years old`));
        dashboard.appendChild(item);
        return;
      }
      const milestone = milestones.get(id);
      if (!milestone) return;
      const item = node('article', 'countdown-item');
      const target = CountdownLogic.milestoneTarget(milestone);
      item.appendChild(node('p', target && target > now ? 'countdown' : 'arrived', target && target > now
        ? CountdownLogic.formatDuration(target - now) : 'This milestone has arrived.'));
      item.appendChild(node('p', 'item-title', milestone.title));
      if (milestone.subtitle) item.appendChild(node('p', 'item-subtitle', milestone.subtitle));
      dashboard.appendChild(item);
    });
    if (!data.birthdayEnabled && data.milestones.length === 0) message.textContent = 'Use the extension toolbar icon to configure countdowns.';
    else if (!data.birthdayEnabled) message.textContent = 'Birthday countdown is disabled.';
    else if (!data.birthday && data.milestones.length === 0) message.textContent = 'Use the extension toolbar icon to add your birthday.';
    else message.textContent = '';
  }

  function itemsPerPage() {
    const available = Math.max(190, window.innerHeight - 110);
    return Math.max(2, Math.floor(available / 190) * 2);
  }

  function setStatus(text) {
    controls.status.textContent = text || '';
  }

  function pageState(pool) {
    const size = itemsPerPage();
    const pages = Math.max(1, Math.ceil(pool.length / size));
    const current = Math.min(Math.max(1, Number(data.research.currentPage) || 1), pages);
    return { size, pages, current };
  }

  async function prepare(item, context) {
    if (item.displayTitle && item.summaryGenerated) return item;
    const generated = await CountdownAI.presentation(context, {
      title: item.originalTitle,
      extract: item.summary,
      evidence: item.evidence
    });
    if (generated && generated.displayTitle && generated.summary
      && CountdownResearch.sourceNumbersAreValid(`${item.summary} ${item.evidence}`, generated.displayTitle)
      && CountdownResearch.sourceNumbersAreValid(`${item.summary} ${item.evidence}`, generated.summary)) {
      item.displayTitle = String(generated.displayTitle);
      item.summary = String(generated.summary);
    } else {
      item.displayTitle = item.originalTitle;
      item.summary = String(item.summary || '').split(/(?<=[.!?])\s+/)[0] || item.originalTitle;
    }
    item.summaryGenerated = true;
    return item;
  }

  function renderResearch() {
    columns.forEach((column) => column.replaceChildren());
    if (!data || !data.researchEnabled || !CountdownResearch.eligibleContext(data)) {
      controls.previous.disabled = true;
      controls.next.disabled = true;
      controls.page.textContent = 'Page 1 of 1';
      return;
    }
    const pool = Array.isArray(data.research.pool) ? data.research.pool : [];
    const state = pageState(pool);
    const start = (state.current - 1) * state.size;
    const visible = pool.slice(start, start + state.size);
    if (visible.length % 2) visible.pop();
    controls.page.textContent = `Page ${state.current} of ${state.pages}`;
    controls.previous.disabled = state.current <= 1;
    controls.next.disabled = state.current >= state.pages;
    visible.forEach((item, index) => {
      const card = node('article', 'research-item');
      card.appendChild(node('p', 'research-summary', 'Loading…'));
      columns[index % 2].appendChild(card);
      const context = CountdownResearch.eligibleContext(data);
      prepare(item, context).then(() => {
        if (!card.isConnected) return;
        card.replaceChildren();
        if (item.image) {
          const image = document.createElement('img');
          image.src = item.image;
          image.alt = item.displayTitle;
          image.width = 150;
          image.height = 84;
          image.addEventListener('error', () => image.remove(), { once: true });
          card.appendChild(image);
          card.appendChild(node('p', 'research-image-credit', item.imageCredit || 'Wikimedia image; see source attribution.'));
        }
        const title = node('a', '', item.displayTitle);
        title.href = item.url;
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
        card.appendChild(title);
        const source = node('a', 'research-source-link', `Source: Wikipedia – ${item.originalTitle}`);
        source.href = item.url;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        card.appendChild(source);
        card.appendChild(node('p', 'research-summary', item.summary));
        if (item.evidence) card.appendChild(node('p', 'research-evidence', item.evidence));
        data.research.seenUrls = [...new Set([...(data.research.seenUrls || []), item.url])].slice(-300);
        CountdownStorage.save(data).catch(() => {});
      });
    });
  }

  function changePage(delta) {
    const state = pageState(data.research.pool || []);
    data.research.currentPage = Math.min(state.pages, Math.max(1, state.current + delta));
    CountdownStorage.save(data).then(renderResearch);
  }

  async function loadResearch(force) {
    if (researchRequest || !data || !data.researchEnabled || !CountdownResearch.eligibleContext(data)) return;
    const mine = ++generation;
    const state = await CountdownAI.availability();
    if (state !== 'available') {
      setStatus(state === 'unavailable'
        ? "Inspiration requires Chrome's on-device AI, which isn't supported in this browser or device."
        : "Inspiration needs the on-device AI model. Open the extension popup and choose 'Set up on-device AI'.");
      renderResearch();
      return;
    }
    setStatus(force ? 'Refreshing inspiration…' : 'Finding milestone inspiration…');
    researchRequest = CountdownResearch.getOrFetch(data, force, setStatus).then((result) => {
      if (mine !== generation) return;
      data = result.data;
      renderResearch();
    }).catch((error) => {
      if (mine !== generation) return;
      setStatus(error.message === 'unavailable' ? "Inspiration requires Chrome's on-device AI, which isn't supported in this browser or device." : 'Unable to load inspiration. Your countdowns are still available.');
      renderResearch();
    }).finally(() => { if (mine === generation) researchRequest = null; });
  }

  controls.previous.addEventListener('click', () => changePage(-1));
  controls.next.addEventListener('click', () => changePage(1));
  controls.refresh.addEventListener('click', () => loadResearch(true));
  window.addEventListener('resize', () => renderResearch());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[CountdownStorage.STORAGE_KEY]) return;
    const next = CountdownStorage.normalize(changes[CountdownStorage.STORAGE_KEY].newValue);
    const oldContext = data && CountdownResearch.eligibleContext(data);
    const nextContext = CountdownResearch.eligibleContext(next);
    const changed = (!oldContext !== !nextContext) || (oldContext && nextContext && signature(oldContext) !== (nextContext.id === 'birthday' ? `birthday|${nextContext.age}|${next.birthday}` : CountdownResearch.milestoneSignature(nextContext)));
    data = next;
    renderCountdowns();
    if (changed || !next.researchEnabled) { generation += 1; researchRequest = null; }
    if (next.researchEnabled && (changed || !data.research.pool.length)) loadResearch(false);
    else renderResearch();
  });

  CountdownStorage.get().then((stored) => {
    data = stored;
    renderCountdowns();
    loadResearch(false);
    timerId = window.setInterval(renderCountdowns, 1000);
  }).catch((error) => { message.textContent = `Unable to load saved countdowns: ${error.message}`; });
}());
