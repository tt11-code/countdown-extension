(function () {
  'use strict';

  if (window.location.pathname !== '/') return;

  const STORAGE_KEY = 'countdownData';
  let timerId = null;
  let dashboard = null;
  let data = { birthday: '', milestones: [] };

  function localDate(year, month, day) {
    return new Date(year, month - 1, day);
  }
  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = localDate(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? { year, month, day } : null;
  }
  function leap(year) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }
  function birthdayTarget(value, now) {
    const birth = parseDate(value);
    if (!birth) return null;
    let year = now.getFullYear();
    let day = birth.month === 2 && birth.day === 29 && !leap(year) ? 28 : birth.day;
    let target = localDate(year, birth.month, day);
    if (target <= now) {
      year += 1;
      day = birth.month === 2 && birth.day === 29 && !leap(year) ? 28 : birth.day;
      target = localDate(year, birth.month, day);
    }
    return { target, age: year - birth.year };
  }
  function targetFor(milestone) {
    const date = parseDate(milestone.date);
    if (!date) return null;
    const time = (milestone.time || '00:00').split(':').map(Number);
    return new Date(date.year, date.month - 1, date.day, time[0] || 0, time[1] || 0);
  }
  function duration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(seconds / 86400)} : ${String(Math.floor(seconds % 86400 / 3600)).padStart(2, '0')} : ${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')} : ${String(seconds % 60).padStart(2, '0')}`;
  }
  function element(tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }
  function render() {
    if (!dashboard) return;
    dashboard.replaceChildren();
    const now = new Date();
    const birthday = birthdayTarget(data.birthday, now);
    if (birthday) {
      const item = element('article', 'countdown-extension-item', '');
      item.append(element('p', 'countdown-extension-value', duration(birthday.target - now)));
      item.append(element('p', 'countdown-extension-title', 'Until my next birthday'));
      item.append(element('p', 'countdown-extension-support', `Until I turn ${birthday.age} years old`));
      dashboard.append(item);
    }
    data.milestones.forEach((milestone) => {
      const target = targetFor(milestone);
      const item = element('article', 'countdown-extension-item', '');
      item.append(element('p', 'countdown-extension-value', target && target > now ? duration(target - now) : 'This milestone has arrived.'));
      item.append(element('p', 'countdown-extension-title', milestone.title));
      if (milestone.subtitle) item.append(element('p', 'countdown-extension-support', milestone.subtitle));
      dashboard.append(item);
    });
    if (!data.birthday && data.milestones.length === 0) {
      dashboard.append(element('p', 'countdown-extension-support', 'Set up countdowns from a new tab.'));
    }
    const link = document.createElement('a');
    link.className = 'countdown-extension-link';
    link.href = chrome.runtime.getURL('newtab.html');
    link.textContent = 'Manage countdowns';
    dashboard.append(link);
  }
  function load() {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError) return;
      const stored = result[STORAGE_KEY] || {};
      data = {
        birthday: typeof stored.birthday === 'string' ? stored.birthday : '',
        milestones: Array.isArray(stored.milestones) ? stored.milestones : []
      };
      render();
      if (!timerId) timerId = window.setInterval(render, 1000);
    });
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    const stored = changes[STORAGE_KEY].newValue || {};
    data = {
      birthday: typeof stored.birthday === 'string' ? stored.birthday : '',
      milestones: Array.isArray(stored.milestones) ? stored.milestones : []
    };
    render();
  });
  function attach() {
    if (dashboard) return true;
    const logo = document.querySelector('img[alt="Google"]');
    if (!logo) return false;
    const host = logo.closest('div');
    if (!host || !host.parentElement) return false;
    dashboard = document.createElement('section');
    dashboard.id = 'countdown-extension-dashboard';
    host.parentElement.insertBefore(dashboard, host);
    load();
    return true;
  }
  if (!attach()) {
    const observer = new MutationObserver(() => {
      if (attach()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 15000);
  }
}());
