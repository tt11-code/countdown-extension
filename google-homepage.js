(function () {
  'use strict';

  if (window.location.pathname !== '/' || document.getElementById('countdown-extension-dashboard')) return;

  let dashboard = null;
  let timerId = null;
  let observer = null;
  let data = null;

  function node(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value;
    return element;
  }

  function findInsertionPoint() {
    const logo = Array.from(document.querySelectorAll('img[alt="Google"]')).find((image) => image.offsetParent !== null);
    const search = document.querySelector('input[name="q"], textarea[name="q"]');
    if (!logo || !search) return null;
    let logoSection = logo.parentElement;
    while (logoSection && logoSection !== document.body) {
      const descendants = Array.from(logoSection.querySelectorAll('input[name="q"], textarea[name="q"]'));
      const directChildren = Array.from(logoSection.children);
      const logoBranch = directChildren.find((child) => child === logo || child.contains(logo));
      const searchBranch = directChildren.find((child) => descendants.some((field) => child.contains(field)));
      if (logoBranch && searchBranch && logoBranch !== searchBranch && directChildren.length <= 4) {
        return { candidate: logoSection, logoBranch };
      }
      logoSection = logoSection.parentElement;
    }
    return null;
  }

  function render() {
    if (!dashboard || !data) return;
    dashboard.replaceChildren();
    const now = new Date();
    const byId = new Map(data.milestones.map((milestone) => [milestone.id, milestone]));
    (data.order || []).forEach((id) => {
      const item = document.createElement('article');
      item.className = 'countdown-extension-item';
      if (id === 'birthday') {
        if (!data.birthdayEnabled || !data.birthday) return;
        const birthday = CountdownLogic.nextBirthday(data.birthday, now);
        if (!birthday) return;
        item.append(
          node('p', 'countdown-extension-value', CountdownLogic.formatDuration(birthday.target - now)),
          node('p', 'countdown-extension-support', `Until I turn ${birthday.age} years old`)
        );
      } else {
        const milestone = byId.get(id);
        if (!milestone) return;
        const target = CountdownLogic.milestoneTarget(milestone);
        item.append(node('p', 'countdown-extension-value', target && target > now ? CountdownLogic.formatDuration(target - now) : 'This milestone has arrived.'));
        item.append(node('p', 'countdown-extension-title', milestone.title));
        if (milestone.subtitle) item.append(node('p', 'countdown-extension-support', milestone.subtitle));
      }
      dashboard.appendChild(item);
    });
    if (!dashboard.children.length) return;
    const link = document.createElement('a');
    link.className = 'countdown-extension-link';
    link.href = chrome.runtime.getURL('newtab.html');
    link.textContent = 'Manage countdowns';
    dashboard.appendChild(link);
  }

  function load() {
    CountdownStorage.get().then((stored) => {
      data = stored;
      render();
      timerId = window.setInterval(render, 1000);
    }).catch(() => {});
  }

  function attach() {
    if (dashboard) return true;
    const point = findInsertionPoint();
    if (!point || point.candidate.querySelector(':scope > #countdown-extension-dashboard')) return false;
    dashboard = document.createElement('section');
    dashboard.id = 'countdown-extension-dashboard';
    dashboard.setAttribute('aria-label', 'Countdown inspiration');
    point.candidate.insertBefore(dashboard, point.logoBranch);
    load();
    return true;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[CountdownStorage.STORAGE_KEY]) return;
    data = CountdownStorage.normalize(changes[CountdownStorage.STORAGE_KEY].newValue);
    render();
  });

  if (!attach()) {
    observer = new MutationObserver(() => {
      if (attach()) {
        observer.disconnect();
        observer = null;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => {
      if (observer) observer.disconnect();
      observer = null;
    }, 15000);
  }
}());
