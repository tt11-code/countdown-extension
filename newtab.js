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
  let requestInFlight = false;
  let generation = 0;
  let timerId;
  let errorText = '';
  let rejectionText = '';

  function node(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function renderCountdowns() {
    dashboard.replaceChildren();
    const now = new Date();
    const byId = new Map(data.milestones.map((item) => [item.id, item]));
    (data.order || []).forEach((id) => {
      if (id === 'birthday') {
        if (!data.birthdayEnabled || !data.birthday) return;
        const birthday = CountdownLogic.nextBirthday(data.birthday, now);
        const item = node('article', 'countdown-item');
        item.append(node('p', 'countdown', CountdownLogic.formatDuration(birthday.target - now)), node('p', 'age-text', `Until I turn ${birthday.age} years old`));
        dashboard.appendChild(item);
        return;
      }
      const milestone = byId.get(id);
      if (!milestone) return;
      const target = CountdownLogic.milestoneTarget(milestone);
      const item = node('article', 'countdown-item');
      item.append(node('p', target && target > now ? 'countdown' : 'arrived', target && target > now ? CountdownLogic.formatDuration(target - now) : 'This milestone has arrived.'));
      item.appendChild(node('p', 'item-title', milestone.title));
      if (milestone.subtitle) item.appendChild(node('p', 'item-subtitle', milestone.subtitle));
      dashboard.appendChild(item);
    });
    if (!data.birthdayEnabled && data.milestones.length === 0) message.textContent = 'Use the extension toolbar icon to configure countdowns.';
    else if (!data.birthdayEnabled) message.textContent = 'Birthday countdown is disabled.';
    else if (!data.birthday && data.milestones.length === 0) message.textContent = 'Use the extension toolbar icon to add your birthday.';
    else message.textContent = '';
  }

  function status(text) { controls.status.textContent = text || ''; }
  function pageState(pool) {
    const pages = Math.max(1, Math.ceil(pool.length / CountdownResearch.INSPIRATIONS_PER_PAGE));
    const current = Math.min(pages, Math.max(1, Number(data.research.currentPage) || 1));
    return { pages, current };
  }

  function initials(name) {
    return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  }

  function sourceLabel(item) {
    const domain = new URL(item.url).hostname.replace(/^www\./, '');
    const published = item.publishedDate && !Number.isNaN(new Date(item.publishedDate).getTime())
      ? ` · ${new Date(item.publishedDate).toLocaleDateString()}` : '';
    return `Source: ${domain}${published}`;
  }

  function credit(item) {
    if (!item.imageCredit) return null;
    const link = node('a', 'research-image-credit', item.imageCredit);
    link.href = item.imageCreditUrl || item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }

  function renderCard(item, column) {
    const card = node('article', 'research-item');
    const imageBox = node('div', 'research-image-box');
    imageBox.appendChild(node('span', 'research-monogram', initials(item.personName)));
    card.appendChild(imageBox);
    const title = node('p', 'research-title', item.displayTitle);
    card.appendChild(title);
    const source = node('a', 'research-source-link', sourceLabel(item));
    source.href = item.url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    card.append(source, node('p', 'research-summary', item.summary), node('p', 'research-evidence', item.evidenceQuote));
    const imageCredit = credit(item);
    if (imageCredit) card.appendChild(imageCredit);
    column.appendChild(card);
    CountdownResearch.resolveImage(item).then(() => {
      if (!card.isConnected) return;
      imageBox.replaceChildren();
      if (item.image) {
        const image = document.createElement('img');
        image.src = item.image;
        image.alt = item.displayTitle;
        image.width = 160;
        image.height = 80;
        image.addEventListener('error', () => {
          image.remove();
          imageBox.appendChild(node('span', 'research-monogram', initials(item.personName)));
        }, { once: true });
        imageBox.appendChild(image);
        const nextCredit = credit(item);
        if (nextCredit) {
          const existing = card.querySelector('.research-image-credit');
          if (existing) existing.replaceWith(nextCredit);
          else card.appendChild(nextCredit);
        }
      } else imageBox.appendChild(node('span', 'research-monogram', initials(item.personName)));
      data.research.seenUrls = [...new Set([...(data.research.seenUrls || []), item.url])].slice(-300);
      data.research.seenPeople = [...new Set([...(data.research.seenPeople || []), String(item.personName).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()])].slice(-200);
      CountdownStorage.save(data).catch(() => {});
    }).catch(() => {});
  }

  function renderResearch() {
    columns.forEach((column) => column.replaceChildren());
    controls.refresh.disabled = requestInFlight;
    if (!data || !data.researchEnabled) {
      controls.previous.hidden = true;
      controls.next.hidden = true;
      controls.page.hidden = true;
      controls.refresh.hidden = true;
      return;
    }
    const pool = Array.isArray(data.research.pool) ? data.research.pool : [];
    const state = pageState(pool);
    controls.previous.hidden = state.pages <= 1;
    controls.next.hidden = state.pages <= 1;
    controls.page.hidden = state.pages <= 1;
    controls.refresh.hidden = false;
    controls.page.textContent = `Page ${state.current} of ${state.pages}`;
    controls.previous.disabled = state.current <= 1 || requestInFlight;
    controls.next.disabled = state.current >= state.pages || requestInFlight;
    const visible = pool.slice((state.current - 1) * CountdownResearch.INSPIRATIONS_PER_PAGE, state.current * CountdownResearch.INSPIRATIONS_PER_PAGE);
    if (visible.length % 2) visible.pop();
    visible.forEach((item, index) => renderCard(item, columns[index % 2]));
    if (errorText) status(errorText);
    else if (rejectionText) status(rejectionText);
    else if (!pool.length && !requestInFlight) status('No suitable inspiration found for this milestone.');
  }

  function hasKey() {
    return new Promise((resolve) => chrome.runtime.sendMessage({ type: 'hasExaKey' }, (response) => resolve(Boolean(response && response.hasKey))));
  }

  async function loadResearch(forceRefresh) {
    if (requestInFlight || !data || !data.researchEnabled) return;
    const currentGeneration = ++generation;
    errorText = '';
    rejectionText = '';
    if (!(await hasKey())) {
      errorText = 'Inspiration needs an Exa API key. Open the extension popup and add one.';
      renderResearch();
      return;
    }
    requestInFlight = true;
    status('Searching sources…');
    renderResearch();
    try {
      const result = await CountdownResearch.getOrFetch(data, forceRefresh, status);
      if (currentGeneration !== generation) return;
      data = result.data;
      if (result.rejectionCounts) {
        const rejected = Object.values(result.rejectionCounts).reduce((total, count) => total + count, 0);
        if (!result.pool.length && rejected) rejectionText = `Results were found but none passed filtering (${rejected} rejected).`;
      }
      status('');
      renderResearch();
    } catch (error) {
      if (currentGeneration !== generation) return;
      const messages = {
        'no-key': 'Inspiration needs an Exa API key. Open the extension popup and add one.',
        unauthorized: 'The Exa API key is invalid.',
        'no-credits': 'The Exa API key is out of credits.',
        'rate-limited': 'Exa is rate limiting requests. Try again later.',
        network: 'Exa could not be reached due to a network error or timeout.'
      };
      errorText = messages[error.code] || `Unable to load inspiration (${error.code}${error.detail ? `: ${error.detail}` : ''}).`;
      renderResearch();
    } finally {
      if (currentGeneration === generation) {
        requestInFlight = false;
        renderResearch();
      }
    }
  }

  function changePage(delta) {
    const state = pageState(data.research.pool || []);
    data.research.currentPage = Math.min(state.pages, Math.max(1, state.current + delta));
    CountdownStorage.save(data).then(renderResearch).catch(() => {});
  }

  controls.previous.addEventListener('click', () => changePage(-1));
  controls.next.addEventListener('click', () => changePage(1));
  controls.refresh.addEventListener('click', () => loadResearch(true));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!changes[CountdownStorage.STORAGE_KEY]) return;
    data = CountdownStorage.normalize(changes[CountdownStorage.STORAGE_KEY].newValue);
    renderCountdowns();
    renderResearch();
  });

  CountdownStorage.get().then((stored) => {
    data = stored;
    renderCountdowns();
    loadResearch(false);
    timerId = window.setInterval(renderCountdowns, 1000);
  }).catch((error) => { message.textContent = `Unable to load saved countdowns: ${error.message}`; });
}());
