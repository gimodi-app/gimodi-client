/**
 * @returns {HTMLDivElement}
 */
function createOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.style.zIndex = '10000';
  return overlay;
}

/**
 * @returns {HTMLDivElement}
 */
function createContent() {
  const content = document.createElement('div');
  content.className = 'modal-content';
  content.style.width = '400px';
  return content;
}

/**
 * @param {...HTMLButtonElement} buttons
 * @returns {HTMLDivElement}
 */
function createButtons(...buttons) {
  const div = document.createElement('div');
  div.className = 'modal-buttons';
  div.style.justifyContent = 'flex-end';
  buttons.forEach(b => div.appendChild(b));
  return div;
}

/**
 * @param {string} label
 * @param {string} [className='btn-secondary']
 * @returns {HTMLButtonElement}
 */
function makeButton(label, className = 'btn-secondary') {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = label;
  return btn;
}

/**
 * @param {string} message
 * @returns {Promise<void>}
 */
export function customAlert(message) {
  return new Promise(resolve => {
    const overlay = createOverlay();
    const content = createContent();
    const msg = document.createElement('p');
    msg.style.whiteSpace = 'pre-wrap';
    msg.style.margin = '0 0 16px';
    msg.textContent = message;
    const okBtn = makeButton('OK', 'btn-primary');
    content.appendChild(msg);
    content.appendChild(createButtons(okBtn));
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    okBtn.focus();
    okBtn.addEventListener('click', () => { overlay.remove(); resolve(); });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === 'Escape') { overlay.remove(); resolve(); }
    });
  });
}

/**
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export function customConfirm(message) {
  return new Promise(resolve => {
    const overlay = createOverlay();
    const content = createContent();
    const msg = document.createElement('p');
    msg.style.whiteSpace = 'pre-wrap';
    msg.style.margin = '0 0 16px';
    msg.textContent = message;
    const cancelBtn = makeButton('Cancel', 'btn-secondary');
    const okBtn = makeButton('OK', 'btn-primary');
    content.appendChild(msg);
    content.appendChild(createButtons(cancelBtn, okBtn));
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    okBtn.focus();
    okBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });
    cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { overlay.remove(); resolve(false); }
    });
  });
}

/**
 * @param {string} message
 * @param {string} [defaultValue='']
 * @returns {Promise<string|null>}
 */
export function customPrompt(message, defaultValue = '') {
  return new Promise(resolve => {
    const overlay = createOverlay();
    const content = createContent();
    const msg = document.createElement('label');
    msg.style.display = 'block';
    msg.style.marginBottom = '8px';
    msg.textContent = message;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultValue;
    input.style.width = '100%';
    input.style.marginBottom = '4px';
    const cancelBtn = makeButton('Cancel', 'btn-secondary');
    const okBtn = makeButton('OK', 'btn-primary');
    content.appendChild(msg);
    content.appendChild(input);
    content.appendChild(createButtons(cancelBtn, okBtn));
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
    const submit = () => { overlay.remove(); resolve(input.value); };
    const cancel = () => { overlay.remove(); resolve(null); };
    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') cancel();
    });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape' && e.target !== input) cancel();
    });
  });
}
