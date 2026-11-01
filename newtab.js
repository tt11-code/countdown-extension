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
  let research;
  let requestInFlight = false;
  let generation = 0;
  let errorText = '';
  let rejectionText = '';

  function node(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function eligibleSignature(value) {
    const context = CountdownResearch.eligibleContext(value);
    if (!context) return '';
    return context.id === 'birthday'
      ? `birthday|${context.age}|${value.birthday}`
      : CountdownResearch.milestoneSignature(context);
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
        item.appendChild(node('p', 'countdown', CountdownLogic.formatDuration(birthday.target - now)));
        const age = node('p', 'age-text', 'Until I turn ');
        age.appendChild(document.createElement('strong')).textContent = birthday.age;
        age.appendChild(document.createTextNode(' years old'));
        item.appendChild(age);
        dashboard.appendChild(item);
        return;
      }
      const milestone = byId.get(id);
      if (!milestone) return;
      const target = CountdownLogic.milestoneTarget(milestone);
      const item = node('article', 'countdown-item');
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

  function status(text) { controls.status.textContent = text || ''; }

  function pageState(pool) {
    const pages = Math.max(1, Math.ceil(pool.length / CountdownResearch.INSPIRATIONS_PER_PAGE));
    const current = Math.min(pages, Math.max(1, Number(research.currentPage) || 1));
    return { pages, current };
  }

  function initials(name) {
    return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
  }

  function appendTitle(card, item) {
    const title = node('p', 'research-title');
    const context = CountdownResearch.eligibleContext(data);
    const interpreted = context && CountdownResearch.interpret(context);
    const age = item.ageAtAchievement || (interpreted && interpreted.type === 'age' ? interpreted.ages[0] : null);
    if (age) {
      const prefix = document.createElement('strong');
      prefix.textContent = `At ${age}`;
      title.append(prefix, document.createTextNode(` · ${item.personName} — ${item.achievement}`));
    } else {
      title.textContent = item.displayTitle;
    }
    card.appendChild(title);
  }

  function sourceLabel(item) {
    const domain = new URL(item.url).hostname.replace(/^www\./, '');
    const date = item.publishedDate && !Number.isNaN(new Date(item.publishedDate).getTime())
      ? ` · ${new Date(item.publishedDate).toLocaleDateString()}` : '';
    return `Source: ${domain}${date}`;
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
    appendTitle(card, item);
    const source = node('a', 'research-source-link', sourceLabel(item));
    source.href = item.url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    card.append(source, node('p', 'research-summary', item.summary), node('p', 'research-evidence', item.evidenceQuote));
    const imageCredit = credit(item);
    if (imageCredit) card.appendChild(imageCredit);
    column.appendChild(card);
    return CountdownResearch.resolveImage(item).then(() => {
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
        const existing = card.querySelector('.research-image-credit');
        if (nextCredit && existing) existing.replaceWith(nextCredit);
        else if (nextCredit) card.appendChild(nextCredit);
      } else imageBox.appendChild(node('span', 'research-monogram', initials(item.personName)));
    });
  }

  function poolKey(value) {
    return JSON.stringify({
      page: value.currentPage,
      pool: (value.pool || []).map((item) => [item.url, item.personName, item.achievement, item.ageAtAchievement])
    });
  }

  function renderResearch() {
    columns.forEach((column) => column.replaceChildren());
    controls.refresh.disabled = requestInFlight;
    if (!data || !data.researchEnabled || !research) {
      controls.previous.hidden = true;
      controls.next.hidden = true;
      controls.page.hidden = true;
      controls.refresh.hidden = true;
      return;
    }
    const pool = Array.isArray(research.pool) ? research.pool : [];
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
    const imageTasks = visible.map((item, index) => renderCard(item, columns[index % 2]));
    Promise.allSettled(imageTasks).then(() => {
      const nextSeenUrls = [...new Set([...(research.seenUrls || []), ...visible.map((item) => item.url)])].slice(-300);
      const nextSeenPeople = [...new Set([...(research.seenPeople || []), ...visible.map((item) => String(item.personName).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())])].slice(-200);
      const nextResearch = Object.assign({}, research, { seenUrls: nextSeenUrls, seenPeople: nextSeenPeople });
      research = nextResearch;
      CountdownStorage.saveResearch(nextResearch).catch(() => {});
    });
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
      research = result.research;
      renderResearch();
      if (result.rejectionCounts && !result.pool.length) {
        const rejected = Object.values(result.rejectionCounts).reduce((total, count) => total + count, 0);
        if (rejected) rejectionText = `Results were found but none passed filtering (${rejected} rejected).`;
      }
      if (result.stale && result.refreshPromise) {
        result.refreshPromise.then((fresh) => {
          if (currentGeneration !== generation) return;
          research = fresh.research;
          errorText = '';
          rejectionText = '';
          renderResearch();
        }).catch(() => {});
      }
    } catch (error) {
      if (currentGeneration !== generation) return;
      const messages = {
        'no-key': 'Inspiration needs an Exa API key. Open the extension popup and add one.',
        unauthorized: 'The Exa API key is invalid.',
        'no-credits': 'The Exa API key is out of credits.',
        'rate-limited': 'Exa is rate limiting requests. Try again later.',
        timeout: 'Exa timed out while searching. Try Refresh inspiration.',
        network: 'Exa could not be reached due to a network error.'
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
    const state = pageState(research.pool || []);
    research.currentPage = Math.min(state.pages, Math.max(1, state.current + delta));
    CountdownStorage.saveResearch(research).then(renderResearch).catch(() => {});
  }

  controls.previous.addEventListener('click', () => changePage(-1));
  controls.next.addEventListener('click', () => changePage(1));
  controls.refresh.addEventListener('click', () => loadResearch(true));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[CountdownStorage.STORAGE_KEY]) {
      const next = CountdownStorage.normalize(changes[CountdownStorage.STORAGE_KEY].newValue);
      const changed = !data || eligibleSignature(data) !== eligibleSignature(next) || data.researchEnabled !== next.researchEnabled;
      data = next;
      renderCountdowns();
      if (changed) {
        generation += 1;
        requestInFlight = false;
        loadResearch(false);
      }
    }
    if (changes[CountdownStorage.RESEARCH_STORAGE_KEY]) {
      CountdownStorage.getResearch().then((next) => {
        if (!research || poolKey(research) !== poolKey(next)) {
          research = next;
          renderResearch();
        } else research = next;
      }).catch(() => {});
    }
  });

  Promise.all([CountdownStorage.get(), CountdownStorage.getResearch()]).then(([stored, storedResearch]) => {
    data = stored;
    research = storedResearch;
    renderCountdowns();
    renderResearch();
    loadResearch(false);
    window.setInterval(renderCountdowns, 1000);
  }).catch((error) => { message.textContent = `Unable to load saved countdowns: ${error.message}`; });
}());
