(function () {
  'use strict';

  const milestonesElement = document.getElementById('milestones');
  const editor = document.getElementById('editor');
  const milestoneForm = document.getElementById('milestone-form');
  let data;
  let pendingDeleteId = '';
  let hasKey = false;

  function showMessage(id, text) { document.getElementById(id).textContent = text; }
  function text(tag, className, value) { const node = document.createElement(tag); node.className = className; node.textContent = value; return node; }
  function button(label, action) { const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.dataset.action = action; return node; }
  function messageForCode(code) {
    return {
      unauthorized: 'Invalid key.',
      'no-credits': 'This key is out of credits.',
      'rate-limited': 'Exa is rate limiting requests. Try again later.',
      network: 'Network error while contacting Exa.',
      'no-key': 'Add an Exa API key first.'
    }[code] || 'Exa returned an unexpected error.';
  }

  function updateResearchGate() {
    const checkbox = document.getElementById('research-enabled');
    checkbox.disabled = !hasKey;
    document.getElementById('research-hint').textContent = hasKey
      ? 'Exa inspiration is ready.'
      : 'Add an Exa API key to enable inspiration';
  }

  function render() {
    document.getElementById('birthday-date').value = data.birthday || '';
    document.getElementById('birthday-enabled').checked = data.birthdayEnabled;
    document.getElementById('research-enabled').checked = data.researchEnabled && hasKey;
    updateResearchGate();
    milestonesElement.replaceChildren();
    const byId = new Map(data.milestones.map((milestone) => [milestone.id, milestone]));
    data.order.forEach((id, index) => {
      const birthday = id === 'birthday';
      const milestone = birthday ? null : byId.get(id);
      if (!birthday && !milestone) return;
      const row = document.createElement('article');
      row.className = 'milestone-row';
      row.dataset.id = id;
      row.append(
        text('p', 'milestone-name', `${index + 1}. ${birthday ? 'Birthday countdown' : milestone.title}`),
        text('p', 'milestone-meta', birthday ? (data.birthday ? `Turns ${CountdownLogic.nextBirthday(data.birthday, new Date()).age}` : 'No date saved') : `${milestone.date}${milestone.time ? ` at ${milestone.time}` : ''}${milestone.subtitle ? ` - ${milestone.subtitle}` : ''}`),
        button(birthday ? 'Edit date' : 'Edit', 'edit'),
        button('Move up', 'up'),
        button('Move down', 'down')
      );
      if (!birthday) row.append(button(pendingDeleteId === id ? 'Confirm delete' : 'Delete', pendingDeleteId === id ? 'confirm-delete' : 'delete'));
      if (pendingDeleteId === id) row.append(button('Cancel', 'cancel-delete'));
      milestonesElement.appendChild(row);
    });
  }

  function openEditor(milestone) {
    milestoneForm.reset();
    document.getElementById('editor-heading').textContent = milestone ? 'Edit milestone' : 'Add milestone';
    document.getElementById('editing-id').value = milestone ? milestone.id : '';
    if (milestone) {
      document.getElementById('milestone-title').value = milestone.title;
      document.getElementById('milestone-date').value = milestone.date;
      document.getElementById('milestone-time').value = milestone.time;
      document.getElementById('milestone-subtitle').value = milestone.subtitle;
    }
    showMessage('editor-message', '');
    editor.hidden = false;
    document.getElementById('milestone-title').focus();
  }

  function send(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
  }

  async function updateData(mutator) {
    const latest = await CountdownStorage.get();
    mutator(latest);
    data = await CountdownStorage.save(latest);
    return data;
  }

  document.getElementById('add-button').addEventListener('click', () => openEditor());
  document.getElementById('cancel-button').addEventListener('click', () => { editor.hidden = true; });
  document.getElementById('birthday-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const birthday = document.getElementById('birthday-date').value;
    if (!CountdownLogic.parseDateOnly(birthday) || new Date(`${birthday}T00:00:00`) > new Date()) {
      showMessage('birthday-message', 'Enter a valid date of birth in the past.');
      return;
    }
    await updateData((latest) => {
      latest.birthday = birthday;
      latest.birthdayEnabled = document.getElementById('birthday-enabled').checked;
      if (!latest.order.includes('birthday')) latest.order.unshift('birthday');
    });
    showMessage('birthday-message', 'Birthday saved.');
  });
  document.getElementById('remove-birthday-button').addEventListener('click', async () => {
    await updateData((latest) => {
      latest.birthday = '';
      latest.birthdayEnabled = false;
      latest.order = latest.order.filter((id) => id !== 'birthday');
    });
    render();
    showMessage('birthday-message', 'Saved birthday removed.');
  });
  document.getElementById('birthday-enabled').addEventListener('change', async (event) => {
    if (data.birthday) await updateData((latest) => { latest.birthdayEnabled = event.target.checked; });
    else showMessage('birthday-message', 'Save a birthday to apply this setting.');
  });
  document.getElementById('research-enabled').addEventListener('change', async (event) => {
    if (!hasKey) return;
    await updateData((latest) => { latest.researchEnabled = event.target.checked; });
  });

  document.getElementById('save-exa-key').addEventListener('click', async () => {
    const key = document.getElementById('exa-key').value.trim();
    if (!key) { showMessage('exa-status', 'Enter an Exa API key.'); return; }
    if (/^•+$/.test(key)) { showMessage('exa-status', 'The saved key is already masked. Enter a new key to replace it.'); return; }
    let response;
    try {
      await chrome.storage.local.set({ exaApiKey: key });
      response = { ok: true };
    } catch (error) {
      response = { ok: false };
    }
    if (!response.ok) { showMessage('exa-status', 'Unable to save the key.'); return; }
    hasKey = true;
    document.getElementById('exa-key').value = `••••${key.slice(-4)}`;
    await updateData((latest) => { latest.researchEnabled = true; });
    updateResearchGate();
    showMessage('exa-status', `Key saved as ••••${key.slice(-4)}.`);
  });
  document.getElementById('remove-exa-key').addEventListener('click', async () => {
    let response;
    try {
      await chrome.storage.local.remove('exaApiKey');
      response = { ok: true };
    } catch (error) {
      response = { ok: false };
    }
    if (!response.ok) { showMessage('exa-status', 'Unable to remove the key.'); return; }
    hasKey = false;
    document.getElementById('exa-key').value = '';
    await updateData((latest) => { latest.researchEnabled = false; });
    updateResearchGate();
    showMessage('exa-status', 'Exa API key removed.');
  });
  document.getElementById('test-exa-key').addEventListener('click', async () => {
    showMessage('exa-status', 'Testing Exa API key…');
    const response = await send({ type: 'exaSearch', query: '19 year old accolades', numResults: 1, schema: { type: 'object', properties: { isRelevant: { type: 'boolean' } }, required: ['isRelevant'] } });
    showMessage('exa-status', response && response.ok ? 'Exa API key works.' : messageForCode(response && response.code));
  });

  milestonesElement.addEventListener('click', async (event) => {
    const target = event.target;
    const action = target.dataset.action;
    const row = target.closest('.milestone-row');
    if (!action || !row) return;
    const index = data.order.indexOf(row.dataset.id);
    if (index < 0) return;
    if (action === 'edit') {
      if (row.dataset.id === 'birthday') document.getElementById('birthday-date').focus();
      else openEditor(data.milestones.find((item) => item.id === row.dataset.id));
    } else if (action === 'delete') { pendingDeleteId = row.dataset.id; render(); }
    else if (action === 'cancel-delete') { pendingDeleteId = ''; render(); }
    else if (action === 'confirm-delete') {
      await updateData((latest) => {
        latest.milestones = latest.milestones.filter((item) => item.id !== row.dataset.id);
        const latestIndex = latest.order.indexOf(row.dataset.id);
        if (latestIndex >= 0) latest.order.splice(latestIndex, 1);
      });
      pendingDeleteId = '';
      render();
    } else if (action === 'up' && index > 0) {
      await updateData((latest) => {
        const latestIndex = latest.order.indexOf(row.dataset.id);
        if (latestIndex > 0) [latest.order[latestIndex - 1], latest.order[latestIndex]] = [latest.order[latestIndex], latest.order[latestIndex - 1]];
      });
      render();
    } else if (action === 'down' && index < data.order.length - 1) {
      await updateData((latest) => {
        const latestIndex = latest.order.indexOf(row.dataset.id);
        if (latestIndex >= 0 && latestIndex < latest.order.length - 1) [latest.order[latestIndex + 1], latest.order[latestIndex]] = [latest.order[latestIndex], latest.order[latestIndex + 1]];
      });
      render();
    }
  });

  milestoneForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const entry = {
      id: document.getElementById('editing-id').value || CountdownStorage.makeId(),
      title: document.getElementById('milestone-title').value.trim(),
      date: document.getElementById('milestone-date').value,
      time: document.getElementById('milestone-time').value,
      subtitle: document.getElementById('milestone-subtitle').value.trim()
    };
    if (!entry.title || !CountdownLogic.parseDateOnly(entry.date)) { showMessage('editor-message', 'Enter a title and valid target date.'); return; }
    await updateData((latest) => {
      const index = latest.milestones.findIndex((item) => item.id === entry.id);
      if (index < 0) { latest.milestones.push(entry); latest.order.push(entry.id); } else latest.milestones[index] = entry;
    });
    editor.hidden = true;
    render();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[CountdownStorage.STORAGE_KEY]) return;
    data = CountdownStorage.normalize(changes[CountdownStorage.STORAGE_KEY].newValue);
    render();
  });

  Promise.all([
    send({ type: 'hasExaKey' }),
    CountdownStorage.get()
  ]).then(([keyState, stored]) => {
    hasKey = Boolean(keyState && keyState.hasKey);
    data = stored;
    render();
    if (hasKey) document.getElementById('exa-key').value = '••••••••';
  }).catch((error) => showMessage('birthday-message', `Unable to load settings: ${error.message}`));
}());
