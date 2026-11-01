(function () {
  'use strict';

  const STORAGE_KEY = 'countdownData';
  const dashboard = document.getElementById('dashboard');
  const milestoneFormContainer = document.getElementById('milestone-form-container');
  const milestoneForm = document.getElementById('milestone-form');
  const settingsPanel = document.getElementById('settings-panel');
  const birthdayForm = document.getElementById('birthday-form');
  let data = { birthday: '', milestones: [] };
  let timerId = null;

  function getStorage() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result[STORAGE_KEY] || { birthday: '', milestones: [] });
      });
    });
  }

  function saveStorage() {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [STORAGE_KEY]: data }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  function localDate(year, month, day, time) {
    const parts = (time || '00:00').split(':').map(Number);
    const result = new Date(year, month - 1, day, parts[0] || 0, parts[1] || 0, 0, 0);
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function parseDateOnly(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = localDate(year, month, day);
    return date && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? { year, month, day } : null;
  }

  function nextBirthday(birthday, now) {
    const birth = parseDateOnly(birthday);
    if (!birth) return null;
    let year = now.getFullYear();
    const day = birth.month === 2 && birth.day === 29 && !isLeapYear(year) ? 28 : birth.day;
    let target = localDate(year, birth.month, day);
    if (target <= now) {
      year += 1;
      const nextDay = birth.month === 2 && birth.day === 29 && !isLeapYear(year) ? 28 : birth.day;
      target = localDate(year, birth.month, nextDay);
    }
    return { target, age: year - birth.year };
  }

  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function milestoneTarget(milestone) {
    const date = parseDateOnly(milestone.date);
    if (!date) return null;
    return localDate(date.year, date.month, date.day, milestone.time);
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${days} : ${String(hours).padStart(2, '0')} : ${String(minutes).padStart(2, '0')} : ${String(seconds).padStart(2, '0')}`;
  }

  function textElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function render() {
    dashboard.replaceChildren();
    if (!data.birthday) {
      dashboard.appendChild(textElement('p', 'welcome', 'Welcome. Add your date of birth to start your countdown.'));
      return;
    }
    const birthday = nextBirthday(data.birthday, new Date());
    if (birthday) {
      const item = document.createElement('article');
      item.className = 'countdown-item';
      item.dataset.kind = 'birthday';
      item.appendChild(textElement('p', 'countdown', formatDuration(birthday.target - new Date())));
      item.appendChild(textElement('p', 'item-title', 'Until my next birthday'));
      item.appendChild(textElement('p', 'age-text', `Until I turn ${birthday.age} years old`));
      dashboard.appendChild(item);
    }
    data.milestones.forEach((milestone) => {
      const item = document.createElement('article');
      item.className = 'countdown-item';
      item.dataset.id = milestone.id;
      const target = milestoneTarget(milestone);
      if (!target || target <= new Date()) {
        item.appendChild(textElement('p', 'arrived', 'This milestone has arrived.'));
      } else {
        item.appendChild(textElement('p', 'countdown', formatDuration(target - new Date())));
      }
      item.appendChild(textElement('p', 'item-title', milestone.title));
      if (milestone.subtitle) item.appendChild(textElement('p', 'item-subtitle', milestone.subtitle));
      const controls = document.createElement('div');
      controls.className = 'item-controls';
      const edit = textElement('button', 'text-button', 'Edit');
      edit.type = 'button';
      edit.dataset.action = 'edit';
      const remove = textElement('button', 'text-button', 'Delete');
      remove.type = 'button';
      remove.dataset.action = 'delete';
      controls.append(edit, remove);
      item.appendChild(controls);
      dashboard.appendChild(item);
    });
  }

  function showMilestoneForm(milestone) {
    milestoneForm.reset();
    document.getElementById('form-heading').textContent = milestone ? 'Edit milestone' : 'Add milestone';
    document.getElementById('editing-id').value = milestone ? milestone.id : '';
    if (milestone) {
      document.getElementById('milestone-title').value = milestone.title;
      document.getElementById('milestone-date').value = milestone.date;
      document.getElementById('milestone-time').value = milestone.time || '';
      document.getElementById('milestone-subtitle').value = milestone.subtitle || '';
    }
    document.getElementById('form-error').textContent = '';
    milestoneFormContainer.hidden = false;
    settingsPanel.hidden = true;
    document.getElementById('milestone-title').focus();
  }

  function showSettings() {
    document.getElementById('birthday-date').value = data.birthday || '';
    document.getElementById('birthday-error').textContent = '';
    settingsPanel.hidden = false;
    milestoneFormContainer.hidden = true;
  }

  function closeForms() {
    milestoneFormContainer.hidden = true;
    settingsPanel.hidden = true;
  }

  document.getElementById('add-milestone-button').addEventListener('click', () => showMilestoneForm());
  document.getElementById('settings-button').addEventListener('click', showSettings);
  document.getElementById('manage-milestones-button').addEventListener('click', () => {
    settingsPanel.hidden = true;
    showMilestoneForm();
  });
  document.getElementById('cancel-form-button').addEventListener('click', closeForms);
  document.getElementById('cancel-settings-button').addEventListener('click', closeForms);

  dashboard.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const item = data.milestones.find((entry) => entry.id === button.closest('.countdown-item').dataset.id);
    if (!item) return;
    if (button.dataset.action === 'edit') showMilestoneForm(item);
    if (button.dataset.action === 'delete' && window.confirm(`Delete "${item.title}"?`)) {
      data.milestones = data.milestones.filter((entry) => entry.id !== item.id);
      await saveStorage();
      render();
    }
  });

  milestoneForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(milestoneForm);
    const date = String(formData.get('date') || '');
    if (!parseDateOnly(date)) {
      document.getElementById('form-error').textContent = 'Enter a valid target date.';
      return;
    }
    const entry = {
      id: String(formData.get('editing-id') || crypto.randomUUID()),
      title: String(formData.get('title') || '').trim(),
      date,
      time: String(formData.get('time') || ''),
      subtitle: String(formData.get('subtitle') || '').trim()
    };
    if (!entry.title) {
      document.getElementById('form-error').textContent = 'A milestone title is required.';
      return;
    }
    const index = data.milestones.findIndex((milestone) => milestone.id === entry.id);
    if (index >= 0) data.milestones[index] = entry;
    else data.milestones.push(entry);
    await saveStorage();
    closeForms();
    render();
  });

  birthdayForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const birthday = document.getElementById('birthday-date').value;
    if (!parseDateOnly(birthday) || new Date(`${birthday}T00:00:00`) > new Date()) {
      document.getElementById('birthday-error').textContent = 'Enter a valid date of birth in the past.';
      return;
    }
    data.birthday = birthday;
    await saveStorage();
    closeForms();
    render();
  });

  async function init() {
    try {
      const stored = await getStorage();
      data = {
        birthday: typeof stored.birthday === 'string' ? stored.birthday : '',
        milestones: Array.isArray(stored.milestones) ? stored.milestones : []
      };
      render();
      if (!data.birthday) showSettings();
      if (timerId) clearInterval(timerId);
      timerId = window.setInterval(render, 1000);
    } catch (error) {
      dashboard.replaceChildren(textElement('p', 'welcome', `Unable to load saved countdowns: ${error.message}`));
    }
  }

  init();
}());
