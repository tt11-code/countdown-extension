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
    data.milestones.forEach((milestone, index) => {
      const row = document.createElement('article');
      row.className = 'milestone-row';
      row.dataset.id = milestone.id;
      row.appendChild(text('p', 'milestone-name', `${index + 1}. ${milestone.title}`));
      row.appendChild(text('p', 'milestone-meta', `${milestone.date}${milestone.time ? ` at ${milestone.time}` : ''}${milestone.subtitle ? ` - ${milestone.subtitle}` : ''}`));
      const edit = button('Edit', 'edit');
      const up = button('Move up', 'up');
      const down = button('Move down', 'down');
      const remove = button(pendingDeleteId === milestone.id ? 'Confirm delete' : 'Delete', pendingDeleteId === milestone.id ? 'confirm-delete' : 'delete');
      row.append(edit, up, down, remove);
      if (pendingDeleteId === milestone.id) {
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
    await CountdownStorage.save(data);
    showMessage('birthday-message', 'Birthday saved.');
  });

  document.getElementById('remove-birthday-button').addEventListener('click', async () => {
    data.birthday = '';
    data.birthdayEnabled = false;
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

  milestonesElement.addEventListener('click', async (event) => {
    const action = event.target.dataset.action;
    const row = event.target.closest('.milestone-row');
    if (!action || !row) return;
    const index = data.milestones.findIndex((milestone) => milestone.id === row.dataset.id);
    if (index < 0) return;
    if (action === 'edit') openEditor(data.milestones[index]);
    if (action === 'delete') { pendingDeleteId = row.dataset.id; render(); }
    if (action === 'cancel-delete') { pendingDeleteId = ''; render(); }
    if (action === 'confirm-delete') {
      data.milestones.splice(index, 1);
      pendingDeleteId = '';
      await CountdownStorage.save(data);
      render();
    }
    if (action === 'up' && index > 0) {
      [data.milestones[index - 1], data.milestones[index]] = [data.milestones[index], data.milestones[index - 1]];
      await CountdownStorage.save(data);
      render();
    }
    if (action === 'down' && index < data.milestones.length - 1) {
      [data.milestones[index + 1], data.milestones[index]] = [data.milestones[index], data.milestones[index + 1]];
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
    if (index < 0) data.milestones.push(entry);
    else data.milestones[index] = entry;
    await CountdownStorage.save(data);
    editor.hidden = true;
    render();
  });

  CountdownStorage.get().then((stored) => {
    data = stored;
    render();
  }).catch((error) => showMessage('birthday-message', `Unable to load settings: ${error.message}`));
}());
