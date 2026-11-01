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

  document.getElementById('add-button').addEventListener('click', () => openEditor());
  document.getElementById('cancel-button').addEventListener('click', () => { editor.hidden = true; });
  document.getElementById('birthday-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const birthday = document.getElementById('birthday-date').value;
    if (!CountdownLogic.parseDateOnly(birthday) || new Date(`${birthday}T00:00:00`) > new Date()) {
      showMessage('birthday-message', 'Enter a valid date of birth in the past.');
      return;
    }
    data.birthday = birthday;
    data.birthdayEnabled = document.getElementById('birthday-enabled').checked;
    if (!data.order.includes('birthday')) data.order.unshift('birthday');
    await CountdownStorage.save(data);
    showMessage('birthday-message', 'Birthday saved.');
  });
  document.getElementById('remove-birthday-button').addEventListener('click', async () => {
    data.birthday = '';
    data.birthdayEnabled = false;
    data.order = data.order.filter((id) => id !== 'birthday');
    await CountdownStorage.save(data);
    render();
    showMessage('birthday-message', 'Saved birthday removed.');
  });
  document.getElementById('birthday-enabled').addEventListener('change', async (event) => {
    data.birthdayEnabled = event.target.checked;
    if (data.birthday) await CountdownStorage.save(data);
    else showMessage('birthday-message', 'Save a birthday to apply this setting.');
  });
  document.getElementById('research-enabled').addEventListener('change', async (event) => {
    if (!hasKey) return;
    data.researchEnabled = event.target.checked;
    await CountdownStorage.save(data);
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
    data.researchEnabled = true;
    await CountdownStorage.save(data);
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
    data.researchEnabled = false;
    await CountdownStorage.save(data);
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
      data.milestones = data.milestones.filter((item) => item.id !== row.dataset.id);
      data.order.splice(index, 1);
      pendingDeleteId = '';
      await CountdownStorage.save(data);
      render();
    } else if (action === 'up' && index > 0) {
      [data.order[index - 1], data.order[index]] = [data.order[index], data.order[index - 1]];
      await CountdownStorage.save(data);
      render();
    } else if (action === 'down' && index < data.order.length - 1) {
      [data.order[index + 1], data.order[index]] = [data.order[index], data.order[index + 1]];
      await CountdownStorage.save(data);
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
    const index = data.milestones.findIndex((item) => item.id === entry.id);
    if (index < 0) { data.milestones.push(entry); data.order.push(entry.id); } else data.milestones[index] = entry;
    await CountdownStorage.save(data);
    editor.hidden = true;
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
