(function () {
  'use strict';

  const milestonesElement = document.getElementById('milestones');
  const editor = document.getElementById('editor');
  const milestoneForm = document.getElementById('milestone-form');
  let data = null;
  let pendingDeleteId = '';

  function showMessage(id, text) {
    document.getElementById(id).textContent = text;
  }

  function render() {
    document.getElementById('birthday-date').value = data.birthday || '';
    document.getElementById('birthday-enabled').checked = data.birthdayEnabled;
    document.getElementById('research-enabled').checked = data.researchEnabled;
    milestonesElement.replaceChildren();
    const milestonesById = new Map(data.milestones.map((milestone) => [milestone.id, milestone]));
    data.order.forEach((id, index) => {
      const isBirthday = id === 'birthday';
      const milestone = isBirthday ? null : milestonesById.get(id);
      if (!isBirthday && !milestone) return;
      const row = document.createElement('article');
      row.className = 'milestone-row';
      row.dataset.id = id;
      row.appendChild(text('p', 'milestone-name', `${index + 1}. ${isBirthday ? 'Birthday countdown' : milestone.title}`));
      row.appendChild(text('p', 'milestone-meta', isBirthday ? (data.birthday ? `Turns ${CountdownLogic.nextBirthday(data.birthday, new Date()).age}` : 'No date saved') : `${milestone.date}${milestone.time ? ` at ${milestone.time}` : ''}${milestone.subtitle ? ` - ${milestone.subtitle}` : ''}`));
      const edit = button(isBirthday ? 'Edit date' : 'Edit', 'edit');
      const up = button('Move up', 'up');
      const down = button('Move down', 'down');
      row.append(edit, up, down);
      if (!isBirthday) {
        const remove = button(pendingDeleteId === id ? 'Confirm delete' : 'Delete', pendingDeleteId === id ? 'confirm-delete' : 'delete');
        row.append(remove);
      }
      if (pendingDeleteId === id) {
        const cancel = button('Cancel', 'cancel-delete');
        row.append(cancel);
      }
      milestonesElement.appendChild(row);
    });
  }

  function text(tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }

  function button(label, action) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.dataset.action = action;
    return node;
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
    data.researchEnabled = event.target.checked;
    await CountdownStorage.save(data);
  });

  document.getElementById('setup-ai-button').addEventListener('click', async () => {
    const status = await CountdownAI.availability();
    showMessage('ai-status', status === 'available' ? 'On-device AI is ready.' : 'Preparing the on-device AI model...');
    const result = await CountdownAI.setup();
    showMessage('ai-status', result === 'available'
      ? 'On-device AI is ready.'
      : 'On-device AI is unavailable. Inspiration is disabled until it is supported and ready.');
    updateAiAvailability(result);
  });

  function updateAiAvailability(state) {
    const checkbox = document.getElementById('research-enabled');
    const hint = document.getElementById('research-hint');
    const available = state === 'available';
    checkbox.disabled = !available;
    if (!available) {
      checkbox.checked = false;
      hint.textContent = state === 'unavailable'
        ? "Inspiration requires Chrome's on-device AI, which isn't supported in this browser or device."
        : "Inspiration needs the on-device AI model. Choose 'Set up on-device AI' below.";
    }
    document.getElementById('ai-status').textContent = available
      ? 'On-device AI is ready.'
      : `On-device AI status: ${state}.`;
  }

  milestonesElement.addEventListener('click', async (event) => {
    const action = event.target.dataset.action;
    const row = event.target.closest('.milestone-row');
    if (!action || !row) return;
    const index = data.order.indexOf(row.dataset.id);
    if (index < 0) return;
    if (action === 'edit') {
      if (row.dataset.id === 'birthday') {
        document.getElementById('birthday-date').focus();
        return;
      }
      openEditor(data.milestones.find((milestone) => milestone.id === row.dataset.id));
    }
    if (action === 'delete') {
      if (row.dataset.id === 'birthday') return;
      pendingDeleteId = row.dataset.id;
      render();
    }
    if (action === 'cancel-delete') { pendingDeleteId = ''; render(); }
    if (action === 'confirm-delete') {
      data.milestones = data.milestones.filter((milestone) => milestone.id !== row.dataset.id);
      data.order.splice(index, 1);
      pendingDeleteId = '';
      await CountdownStorage.save(data);
      render();
    }
    if (action === 'up' && index > 0) {
      [data.order[index - 1], data.order[index]] = [data.order[index], data.order[index - 1]];
      await CountdownStorage.save(data);
      render();
    }
    if (action === 'down' && index < data.order.length - 1) {
      [data.order[index + 1], data.order[index]] = [data.order[index], data.order[index + 1]];
      await CountdownStorage.save(data);
      render();
    }
  });

  milestoneForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = document.getElementById('milestone-title').value.trim();
    const date = document.getElementById('milestone-date').value;
    if (!title || !CountdownLogic.parseDateOnly(date)) {
      showMessage('editor-message', 'Enter a title and valid target date.');
      return;
    }
    const entry = {
      id: document.getElementById('editing-id').value || CountdownStorage.makeId(),
      title,
      date,
      time: document.getElementById('milestone-time').value,
      subtitle: document.getElementById('milestone-subtitle').value.trim()
    };
    const index = data.milestones.findIndex((milestone) => milestone.id === entry.id);
    if (index < 0) {
      data.milestones.push(entry);
      data.order.push(entry.id);
    }
    else data.milestones[index] = entry;
    await CountdownStorage.save(data);
    editor.hidden = true;
    render();
  });

  CountdownAI.availability().then(updateAiAvailability);
  CountdownStorage.get().then((stored) => {
    data = stored;
    render();
  }).catch((error) => showMessage('birthday-message', `Unable to load settings: ${error.message}`));
}());
