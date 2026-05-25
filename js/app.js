/* Brando – main application */

// ── Config ───────────────────────────────────────────────────────────────────
const BASE_URL = (() => {
  const u = window.location.href.split('?')[0].replace(/\/+$/, '');
  return u.endsWith('index.html') ? u.slice(0, -10) : u + '/';
})();

const APP_VERSION = window.APP_VERSION || '-';

// ── Feather icon helper ──────────────────────────────────────────────────────
function icon(name, size = 16) {
  if (typeof feather === 'undefined') return '';
  return feather.toSvg(name, { width: size, height: size, 'stroke-width': 2 });
}

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  scripts: [],
  notes: [],
  settings: { scrollRate: 40, meFontSize: 32, themFontSize: 16, theme: 'dark', meLabel: 'Actor', themLabel: 'Reader' },
  importData: { name: '', arrayBuffer: null },
  currentScriptId: null,
  peer: null,
  peerId: null,
  conn: null,
  readerConn: null,
  scrollRaf: null,
  swReg: null,
};

// ── Storage ──────────────────────────────────────────────────────────────────
function saveScripts() { localStorage.setItem('brando_scripts', JSON.stringify(state.scripts)); }
function loadScripts() {
  try { state.scripts = JSON.parse(localStorage.getItem('brando_scripts') || '[]'); }
  catch { state.scripts = []; }
}
function saveSettings() { localStorage.setItem('brando_settings', JSON.stringify(state.settings)); }
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('brando_settings') || 'null');
    if (s) Object.assign(state.settings, s);
  } catch {}
}
function saveNotes() { localStorage.setItem('brando_notes', JSON.stringify(state.notes)); }
function loadNotes() {
  try { state.notes = JSON.parse(localStorage.getItem('brando_notes') || '[]'); }
  catch { state.notes = []; }
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

let _scanStream = null;
let _scanRaf = null;

// ── IndexedDB (PDF storage) ──────────────────────────────────────────────────
let _db = null;
function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('brando_db', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('pdfs');
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}
async function savePDF(id, buffer) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').put(buffer, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function loadPDF(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readonly');
    const req = tx.objectStore('pdfs').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function deletePDF(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pdfs', 'readwrite');
    tx.objectStore('pdfs').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ── Navigation ───────────────────────────────────────────────────────────────
const VIEW_TITLES = {
  'view-home': 'Brando', 'view-import': 'Create Script', 'view-editor': 'Edit Script',
  'view-qr': 'Connect Reader', 'view-scan': 'Scan QR', 'view-reader': 'Reading', 'view-notes': 'Notes',
};

function showView(id) {
  if (id !== 'view-scan') stopScan();
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  closeAllPanels();
  const titleEl = document.getElementById('main-title');
  if (titleEl) titleEl.textContent = VIEW_TITLES[id] || 'Brando';
  const rs = document.getElementById('reader-status');
  if (rs) rs.classList.toggle('hidden', id !== 'view-reader');
}

// ── Panels ───────────────────────────────────────────────────────────────────
function openPanel(id) {
  closeAllPanels();
  document.getElementById(id).classList.add('open');
  document.getElementById('overlay').classList.remove('hidden');
}
function closeAllPanels() {
  document.querySelectorAll('.slide-panel').forEach(p => p.classList.remove('open'));
  document.getElementById('overlay').classList.add('hidden');
}

// ── Toast ────────────────────────────────────────────────────────────────────
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Confirm Dialog ───────────────────────────────────────────────────────────
function showConfirm(title, msg) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h3>${title}</h3>
        <p>${msg}</p>
        <div class="confirm-actions">
          <button class="confirm-cancel">Cancel</button>
          <button class="confirm-ok">Delete</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => { overlay.remove(); resolve(false); });
    overlay.querySelector('.confirm-ok').addEventListener('click', () => { overlay.remove(); resolve(true); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}

// ── Theme ────────────────────────────────────────────────────────────────────
function loadOpenDyslexic() {
  if (document.getElementById('opendyslexic-css')) return;
  ['400', '700'].forEach(w => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    if (w === '400') l.id = 'opendyslexic-css';
    l.href = `https://cdn.jsdelivr.net/npm/@fontsource/opendyslexic/${w}.css`;
    document.head.appendChild(l);
  });
}

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  if (theme === 'dyslexia') loadOpenDyslexic();
}

// ── Settings ─────────────────────────────────────────────────────────────────
function applyFontSizes() {
  const me = state.settings.meFontSize || 32;
  const them = state.settings.themFontSize || 16;
  document.body.style.setProperty('--me-font-size', me + 'px');
  document.body.style.setProperty('--them-font-size', them + 'px');
}

function renderSettings() {
  const { scrollRate, meFontSize, themFontSize, meLabel, themLabel } = state.settings;
  document.getElementById('setting-scroll').value = scrollRate;
  document.getElementById('setting-scroll-val').textContent = `${scrollRate} px/s`;
  document.getElementById('setting-me-font-size').value = meFontSize || 32;
  document.getElementById('setting-me-font-size-val').textContent = `${meFontSize || 32}px`;
  document.getElementById('setting-them-font-size').value = themFontSize || 16;
  document.getElementById('setting-them-font-size-val').textContent = `${themFontSize || 16}px`;
  document.getElementById('setting-me').value = meLabel;
  document.getElementById('setting-them').value = themLabel;
  applyTheme(state.settings.theme);
}

function initSettingsListeners() {
  document.getElementById('setting-scroll').addEventListener('input', e => {
    state.settings.scrollRate = +e.target.value;
    document.getElementById('setting-scroll-val').textContent = `${e.target.value} px/s`;
    saveSettings();
  });

  document.getElementById('setting-me-font-size').addEventListener('input', e => {
    state.settings.meFontSize = +e.target.value;
    document.getElementById('setting-me-font-size-val').textContent = `${e.target.value}px`;
    applyFontSizes();
    saveSettings();
  });
  document.getElementById('setting-them-font-size').addEventListener('input', e => {
    state.settings.themFontSize = +e.target.value;
    document.getElementById('setting-them-font-size-val').textContent = `${e.target.value}px`;
    applyFontSizes();
    saveSettings();
  });
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.theme = btn.dataset.theme;
      applyTheme(btn.dataset.theme);
      saveSettings();
    });
  });
  document.getElementById('setting-me').addEventListener('change', e => {
    state.settings.meLabel = e.target.value.trim() || 'Actor';
    e.target.value = state.settings.meLabel;
    saveSettings();
  });
  document.getElementById('setting-them').addEventListener('change', e => {
    state.settings.themLabel = e.target.value.trim() || 'Reader';
    e.target.value = state.settings.themLabel;
    saveSettings();
  });
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.for;
      if (!key) return;
      state.settings[key] = btn.dataset.color;
      document.querySelectorAll(`.color-btn[data-for="${key}"]`).forEach(b =>
        b.classList.toggle('active', b.dataset.color === btn.dataset.color));
      saveSettings();
    });
  });
}

// ── Home ─────────────────────────────────────────────────────────────────────
function renderHome() {
  const list = document.getElementById('script-list');
  const empty = document.getElementById('empty-state');

  if (state.scripts.length === 0) {
    list.classList.add('hidden');
    list.innerHTML = '';
    empty.classList.remove('hidden');
    updateFooter();
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = state.scripts.map(scriptCard).join('');

  if (typeof feather !== 'undefined') feather.replace({ 'stroke-width': 2 });

  list.querySelectorAll('.script-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-action="delete"]')) return;
      selectScript(card.dataset.id);
    });
  });

  list.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handleScriptDelete(btn.closest('.script-card').dataset.id);
    });
  });

  updateFooter();
}

function selectScript(id) {
  state.currentScriptId = id;
  document.querySelectorAll('.script-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === id);
  });
  updateFooter();
}

function updateFooter() {
  const script = state.scripts.find(s => s.id === state.currentScriptId);
  const hasScript = !!script;
  const isComplete = hasScript && script.complete;

  const editBtn = document.getElementById('btn-footer-edit');
  const meBtn   = document.getElementById('btn-footer-me');
  const themBtn = document.getElementById('btn-footer-them');
  if (editBtn) editBtn.disabled = !hasScript;
  if (meBtn)   meBtn.disabled   = !isComplete;
  if (themBtn) themBtn.disabled = !isComplete;

  const meLabel   = document.getElementById('footer-me-label');
  const themLabel = document.getElementById('footer-them-label');
  if (meLabel)   meLabel.textContent = state.settings.meLabel;
  if (themLabel) themLabel.textContent = state.settings.themLabel;
}

function scriptCard(s) {
  const lineCount = s.lines ? s.lines.length : 0;
  const statusLabel = s.complete ? 'Ready' : 'Draft';
  const statusClass = s.complete ? 'complete' : 'draft';
  const selected = state.currentScriptId === s.id;

  return `
    <div class="script-card${selected ? ' selected' : ''}" data-id="${s.id}">
      <div class="script-card-header">
        <div class="script-card-info">
          <div class="script-card-title">${esc(s.name)}</div>
          <div class="script-card-meta">${lineCount > 0 ? `${lineCount} line${lineCount !== 1 ? 's' : ''}` : 'tap Edit to set up'}</div>
        </div>
        <span class="script-status ${statusClass}">${statusLabel}</span>
        <button class="script-trash-btn" data-action="delete" title="Delete">${icon('trash-2', 16)}</button>
      </div>
    </div>`;
}

async function handleScriptDelete(id) {
  const script = state.scripts.find(s => s.id === id);
  if (!script) return;
  const ok = await showConfirm('Delete script', `Delete "${script.name}"? This cannot be undone.`);
  if (!ok) return;
  await deletePDF(id).catch(() => {});
  state.scripts = state.scripts.filter(s => s.id !== id);
  if (state.currentScriptId === id) state.currentScriptId = null;
  saveScripts();
  renderHome();
  toast('Script deleted');
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── PDF Import ────────────────────────────────────────────────────────────────
function triggerImport() {
  const inp = document.getElementById('pdf-input-global');
  inp.value = '';
  inp.click();
}

function showImportError(title, details) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${esc(title)}</h3>
      <pre style="font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;background:var(--surface2);padding:8px;border-radius:6px;text-align:left">${esc(details)}</pre>
      <div class="modal-actions">
        <button class="btn-primary modal-ok">OK</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-ok').addEventListener('click', () => overlay.remove());
}

async function handleFile(file) {
  const debugInfo = [];
  try {
    if (!file) { showImportError('No file', 'file was null'); return; }
    debugInfo.push(`File: ${file.name}`);
    debugInfo.push(`Type: "${file.type}"  Size: ${file.size}`);
    document.getElementById('pdf-input-global').value = '';

    const name = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');

    let buf;
    try {
      buf = await file.arrayBuffer();
      debugInfo.push(`Buffer: ${buf.byteLength} bytes`);
    } catch (e) {
      debugInfo.push(`arrayBuffer error: ${e}`);
      showImportError('Failed to read PDF', debugInfo.join('\n'));
      return;
    }

    const script = {
      id: uid(), name, lines: null, sections: null,
      complete: false, createdAt: Date.now(),
    };

    state.scripts.unshift(script);
    try { saveScripts(); } catch (e) { debugInfo.push(`saveScripts error: ${e}`); }
    state.currentScriptId = script.id;
    showView('view-home');
    renderHome();
    toast(`"${name}" imported — tap Edit to set up`);

    savePDF(script.id, buf).catch(err => console.warn('PDF storage failed:', err));
  } catch (err) {
    debugInfo.push(`Unexpected error: ${err}`);
    showImportError('Import failed', debugInfo.join('\n'));
    console.error('handleFile error:', err);
  }
}

// ── PDF Text Extraction ───────────────────────────────────────────────────────
async function extractLines(pdfData) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const allItems = [];

  for (let pn = 1; pn <= pdf.numPages; pn++) {
    const page = await pdf.getPage(pn);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    for (const item of content.items) {
      if (!item.str.trim()) continue;
      const [vx, vy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      // Offset by page index so pages never merge
      allItems.push({ str: item.str.trim(), x: vx, y: pn * 10000 + vy });
    }
  }

  allItems.sort((a, b) => a.y - b.y || a.x - b.x);

  const textLines = [];
  let lineItems = [];
  let prevY = null;

  for (const item of allItems) {
    if (prevY !== null && Math.abs(item.y - prevY) > 4) {
      if (lineItems.length) textLines.push({ text: lineItems.join(' '), role: null });
      lineItems = [];
    }
    lineItems.push(item.str);
    prevY = item.y;
  }
  if (lineItems.length) textLines.push({ text: lineItems.join(' '), role: null });

  return textLines;
}

// ── Line Editor ───────────────────────────────────────────────────────────────
async function renderEditor(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;
  document.getElementById('main-title').textContent = script.name;

  const loading = document.getElementById('line-loading');
  const lineList = document.getElementById('line-list');

  if (!script.lines) {
    loading.textContent = 'Extracting lines from PDF…';
    loading.classList.remove('hidden');
    lineList.innerHTML = '';
    try {
      const pdfData = await loadPDF(scriptId);
      if (!pdfData) { loading.textContent = 'PDF not found — please re-import.'; return; }
      script.lines = await extractLines(pdfData);
      saveScripts();
    } catch {
      loading.textContent = 'Could not extract text from PDF.';
      return;
    }
  }

  loading.classList.add('hidden');
  renderLineList(scriptId);
}

function renderLineList(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  const lineList = document.getElementById('line-list');
  if (!script || !script.lines) return;
  const { meLabel, themLabel } = state.settings;

  lineList.innerHTML = script.lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => line.role !== 'CUT')
    .map(({ line, i }) => {
      const rc    = line.role === 'ME' ? 'me' : line.role === 'THEM' ? 'them' : '';
      const label = line.role === 'ME' ? meLabel : line.role === 'THEM' ? themLabel : '';
      const activeA = line.role === 'ME'   ? ' active' : '';
      const activeB = line.role === 'THEM' ? ' active' : '';
      return `
        <div class="line-row ${rc}" data-index="${i}">
          <span class="line-role-badge ${rc}">${esc(label)}</span>
          <span class="line-text">${esc(line.text)}</span>
          <button class="line-btn line-btn-a${activeA}" data-index="${i}" data-role="ME">A</button>
          <button class="line-btn line-btn-b${activeB}" data-index="${i}" data-role="THEM">B</button>
        </div>`;
    }).join('');

  lineList.querySelectorAll('.line-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const line = script.lines[+btn.dataset.index];
      line.role = line.role === btn.dataset.role ? null : btn.dataset.role;
      saveScripts();
      renderLineList(scriptId);
    });
  });
}

// ── getSections (audition & reader) ──────────────────────────────────────────
function getSections(script) {
  if (script.sections) return script.sections;
  return [{ role: script.roles ? (script.roles[0] || 'THEM') : 'THEM', text: '' }];
}

// ── Audition Flow ─────────────────────────────────────────────────────────────
function startAuditionFlow(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;

  showView('view-qr');
  document.getElementById('qr-code').innerHTML = '';
  document.getElementById('peer-id-display').textContent = '';
  document.getElementById('status-text').textContent = 'Creating connection…';
  document.getElementById('status-dot').className = 'status-dot';
  document.getElementById('btn-enter-audition').classList.add('hidden');

  initPeer(peerId => {
    state.peerId = peerId;
    const connectUrl = `${BASE_URL}?peer=${peerId}&script=${scriptId}`;
    document.getElementById('peer-id-display').textContent = `ID: ${peerId}`;
    generateQR(connectUrl);
    document.getElementById('status-text').textContent = 'Waiting for reader…';
  });

  state.peer.on('connection', conn => {
    state.conn = conn;
    conn.on('open', () => {
      conn.send({
        type: 'script',
        data: script,
        meLabel: state.settings.meLabel,
        themLabel: state.settings.themLabel,
      });
      enterAuditionMode();
    });
    conn.on('data', msg => handleAuditionCommand(msg));
    conn.on('close', () => toast('Reader disconnected'));
  });
}

function handleAuditionCommand(msg) {
  if (msg.type === 'show_me') showMeText(msg.text);
  else if (msg.type === 'clear') clearAudition();
}

function enterAuditionMode() {
  showView('view-audition');
  document.getElementById('audition-blank').style.opacity = '1';
  document.getElementById('audition-text-container').classList.add('hidden');
}

function showMeText(text) {
  stopScrolling();
  const container = document.getElementById('audition-text-container');
  const textEl = document.getElementById('audition-text');
  const blank = document.getElementById('audition-blank');
  textEl.textContent = text;
  textEl.style.fontSize = '';  // reset to --me-font-size before each line
  textEl.style.transform = 'translateY(0)';
  blank.style.opacity = '0';
  container.classList.remove('hidden');

  requestAnimationFrame(() => {
    // Shrink font until no word overflows the container width
    if (textEl.scrollWidth > textEl.clientWidth) {
      let size = parseFloat(getComputedStyle(textEl).fontSize);
      while (size > 12 && textEl.scrollWidth > textEl.clientWidth) {
        size -= 2;
        textEl.style.fontSize = size + 'px';
      }
    }

    const containerH = container.clientHeight;
    const textH = textEl.offsetHeight;
    if (textH > containerH) {
      const startY = (textH - containerH) / 2;
      textEl.style.transform = `translateY(${startY}px)`;
      setTimeout(() => startScrolling(textEl, startY), 500);
    }
  });
}

function clearAudition() {
  stopScrolling();
  document.getElementById('audition-blank').style.opacity = '1';
  document.getElementById('audition-text-container').classList.add('hidden');
}

function startScrolling(textEl, startY) {
  stopScrolling();
  const rate = state.settings.scrollRate;
  let startTime = null;
  function step(ts) {
    if (!startTime) startTime = ts;
    const elapsed = (ts - startTime) / 1000;
    const y = startY - elapsed * rate;
    textEl.style.transform = `translateY(${y}px)`;
    if (y > -startY) state.scrollRaf = requestAnimationFrame(step);
  }
  state.scrollRaf = requestAnimationFrame(step);
}

function stopScrolling() {
  if (state.scrollRaf) { cancelAnimationFrame(state.scrollRaf); state.scrollRaf = null; }
}

// ── Reader Mode ───────────────────────────────────────────────────────────────
function startReaderMode(script, conn) {
  state.readerConn = conn;
  const { meLabel, themLabel } = state.settings;

  showView('view-reader');
  document.getElementById('main-title').textContent = script.name;
  const statusEl = document.getElementById('reader-status');
  statusEl.className = conn ? 'reader-status connected' : 'reader-status';
  statusEl.textContent = conn ? '●' : '○';

  // Group consecutive same-role lines; skip unassigned/CUT without breaking grouping
  let lines;
  if (script.lines) {
    lines = [];
    let cur = null;
    for (const line of script.lines) {
      if (!line.role || line.role === 'CUT') continue;
      if (!cur || cur.role !== line.role) {
        cur = { role: line.role, text: line.text };
        lines.push(cur);
      } else {
        cur.text += '\n' + line.text;
      }
    }
  } else {
    lines = getSections(script);
  }

  const container = document.getElementById('reader-sections');
  container.innerHTML = lines.map((line, i) => {
    const label = line.role === 'ME' ? meLabel : themLabel;
    return `<div class="reader-section" data-role="${line.role}" data-index="${i}">
              <div class="reader-section-label">${esc(label)}</div>
              <div class="reader-section-text">${esc(line.text || '')}</div>
            </div>`;
  }).join('');

  container.querySelectorAll('.reader-section').forEach(el => {
    el.addEventListener('click', () => {
      container.querySelectorAll('.reader-section').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      if (navigator.vibrate) navigator.vibrate(40);
      if (!conn) return;
      const role = el.dataset.role;
      const text = el.querySelector('.reader-section-text').textContent;
      if (role === 'ME') conn.send({ type: 'show_me', text });
      else conn.send({ type: 'clear' });
    });
  });
}

// ── QR Scanner ────────────────────────────────────────────────────────────────
function stopScan() {
  if (_scanRaf) { cancelAnimationFrame(_scanRaf); _scanRaf = null; }
  if (_scanStream) { _scanStream.getTracks().forEach(t => t.stop()); _scanStream = null; }
}

async function startScanMode() {
  showView('view-scan');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Camera not available on this device');
    showView('view-home'); renderHome(); return;
  }
  if (typeof jsQR === 'undefined') {
    toast('QR scanner not loaded yet — try again');
    showView('view-home'); renderHome(); return;
  }
  try {
    try {
      _scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    } catch {
      _scanStream = await navigator.mediaDevices.getUserMedia({ video: true });
    }
    const video = document.getElementById('scan-video');
    video.srcObject = _scanStream;
    video.play().catch(() => {});
    const canvas = document.getElementById('scan-canvas');
    const ctx = canvas.getContext('2d');
    function tick() {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (code) {
          const m = code.data.match(/[?&]peer=([^&]+)/);
          if (m) {
            stopScan();
            showView('view-reader');
            document.getElementById('main-title').textContent = 'Connecting…';
            document.getElementById('reader-sections').innerHTML =
              '<div class="empty-notes"><span>&#128279;</span><p>Connecting to audition device…</p></div>';
            handleIncomingPeer(m[1]);
            return;
          }
        }
      }
      _scanRaf = requestAnimationFrame(tick);
    }
    _scanRaf = requestAnimationFrame(tick);
  } catch (err) {
    toast('Camera access denied — check permissions');
    showView('view-home'); renderHome();
  }
}

// ── Peer Connection ───────────────────────────────────────────────────────────
function initPeer(onOpen) {
  if (state.peer) { try { state.peer.destroy(); } catch {} }
  const peer = new Peer({ debug: 0 });
  state.peer = peer;
  peer.on('open', id => { state.peerId = id; if (onOpen) onOpen(id); });
  peer.on('error', err => { console.warn('Peer error:', err); toast('Connection error: ' + err.type); });
}

function generateQR(url) {
  const container = document.getElementById('qr-code');
  container.innerHTML = '';
  new QRCode(container, { text: url, width: 240, height: 240,
    colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
}

function handleIncomingPeer(peerId) {
  toast('Connecting to audition device…');
  initPeer(() => {
    const conn = state.readerConn = state.peer.connect(peerId, { reliable: true });
    conn.on('open', () => {
      toast('Connected!');
      document.getElementById('reader-status').className = 'reader-status connected';
      document.getElementById('reader-status').textContent = '●';
    });
    conn.on('data', msg => {
      if (msg.type === 'script') {
        if (msg.meLabel) state.settings.meLabel = msg.meLabel;
        if (msg.themLabel) state.settings.themLabel = msg.themLabel;
        startReaderMode(msg.data, conn);
      }
    });
    conn.on('close', () => {
      toast('Disconnected');
      document.getElementById('reader-status').className = 'reader-status disconnected';
      document.getElementById('reader-status').textContent = '●';
    });
    conn.on('error', err => toast('Connection error: ' + err));
  });
}

// ── Notes ─────────────────────────────────────────────────────────────────────
function renderNotes() {
  const list = document.getElementById('notes-list');
  if (!state.notes.length) {
    list.innerHTML = '<div class="empty-notes"><span>&#128221;</span><p>No notes yet. Tap + to add one.</p></div>';
    return;
  }
  list.innerHTML = state.notes.map(n => `
    <div class="note-card" data-id="${n.id}">
      <div class="note-text">${esc(n.text)}</div>
      <div class="note-actions">
        <button class="note-action-btn edit" title="Edit">${icon('edit-2',15)}</button>
        <button class="note-action-btn delete" title="Delete">${icon('trash-2',15)}</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.note-action-btn.edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.note-card').dataset.id;
      const note = state.notes.find(n => n.id === id);
      if (note) openNoteModal(note);
    });
  });
  list.querySelectorAll('.note-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.note-card').dataset.id;
      const ok = await showConfirm('Delete note', 'Delete this note?');
      if (ok) { state.notes = state.notes.filter(n => n.id !== id); saveNotes(); renderNotes(); }
    });
  });
}

function openNoteModal(existing) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${existing ? 'Edit Note' : 'Add Note'}</h3>
      <textarea id="note-textarea" placeholder="Write your note…">${existing ? esc(existing.text) : ''}</textarea>
      <div class="modal-actions">
        <button class="modal-cancel">Cancel</button>
        <button class="btn-primary modal-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const ta = overlay.querySelector('#note-textarea');
  ta.focus();
  overlay.querySelector('.modal-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.modal-save').addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) return;
    if (existing) existing.text = text;
    else state.notes.unshift({ id: uid(), text, createdAt: Date.now() });
    saveNotes();
    overlay.remove();
    renderNotes();
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ── Service Worker & Updates ──────────────────────────────────────────────────
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    state.swReg = reg;
    if (reg.waiting) showUpdateBanner();
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
      });
    });
  } catch (err) { console.warn('SW registration failed:', err); }
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}

function showUpdateBanner() { document.getElementById('update-banner').classList.remove('hidden'); }

function applyUpdate() {
  const reg = state.swReg;
  if (reg && reg.waiting) {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(() => window.location.reload(), 500);
  } else {
    window.location.reload();
  }
}

async function checkForUpdates() {
  const reg = state.swReg;
  closeAllPanels();
  if (!reg) { window.location.reload(); return; }
  if (reg.waiting) { showUpdateBanner(); toast('Update ready — tap the banner to install'); return; }
  toast('Checking for updates…');
  try {
    await reg.update();
    setTimeout(() => {
      if (reg.waiting) showUpdateBanner();
      else toast('Already on the latest version ✓');
    }, 1500);
  } catch { toast('Could not check for updates'); }
}

// ── Event Bindings ────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('overlay').addEventListener('click', closeAllPanels);
  document.getElementById('how-it-works-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });
  document.getElementById('btn-menu').addEventListener('click', () => openPanel('menu-panel'));
  document.getElementById('btn-menu-close').addEventListener('click', closeAllPanels);
  document.getElementById('btn-settings').addEventListener('click', () => { renderSettings(); openPanel('settings-panel'); });
  document.getElementById('btn-settings-close').addEventListener('click', closeAllPanels);

  document.getElementById('menu-import').addEventListener('click', () => { closeAllPanels(); triggerImport(); });
  document.getElementById('menu-notes').addEventListener('click', () => { closeAllPanels(); renderNotes(); showView('view-notes'); });
  document.getElementById('menu-how-it-works').addEventListener('click', () => {
    closeAllPanels();
    document.getElementById('how-it-works-modal').classList.remove('hidden');
    if (typeof feather !== 'undefined') feather.replace({ 'stroke-width': 2 });
  });
  document.getElementById('btn-hiw-close').addEventListener('click', () => {
    document.getElementById('how-it-works-modal').classList.add('hidden');
  });
  document.getElementById('btn-import-empty').addEventListener('click', triggerImport);
  document.getElementById('pdf-input-global').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  document.getElementById('btn-import-quit').addEventListener('click', () => { showView('view-home'); renderHome(); });

  // Footer nav
  document.getElementById('btn-footer-home').addEventListener('click', () => {
    stopScrolling();
    if (state.peer) { try { state.peer.destroy(); } catch {} state.peer = null; }
    if (state.readerConn) { try { state.readerConn.close(); } catch {} state.readerConn = null; }
    showView('view-home'); renderHome();
  });
  document.getElementById('btn-footer-edit').addEventListener('click', async () => {
    if (!state.currentScriptId) return;
    showView('view-editor');
    await renderEditor(state.currentScriptId);
  });
  document.getElementById('btn-footer-me').addEventListener('click', () => {
    if (!state.currentScriptId) return;
    if (state.conn && state.conn.open) { enterAuditionMode(); return; }
    startAuditionFlow(state.currentScriptId);
  });
  document.getElementById('btn-footer-them').addEventListener('click', () => {
    if (!state.currentScriptId) return;
    const script = state.scripts.find(s => s.id === state.currentScriptId);
    if (script) startReaderMode(script, null);
  });
  document.getElementById('btn-footer-scan').addEventListener('click', startScanMode);

  // Editor
  document.getElementById('btn-editor-done').addEventListener('click', () => {
    const script = state.scripts.find(s => s.id === state.currentScriptId);
    if (!script || !script.lines || !script.lines.length) { toast('No lines to save'); return; }

    script.sections = [];
    let current = null;
    for (const line of script.lines) {
      if (!line.role || line.role === 'CUT') { current = null; continue; }
      if (!current || current.role !== line.role) {
        current = { role: line.role, text: line.text };
        script.sections.push(current);
      } else {
        current.text += '\n' + line.text;
      }
    }
    script.complete = true;
    saveScripts();
    toast('Script ready!');
    showView('view-home');
    renderHome();
  });

  // QR / Audition
  document.getElementById('btn-enter-audition').addEventListener('click', enterAuditionMode);
  document.getElementById('btn-exit-audition').addEventListener('click', () => {
    stopScrolling(); clearAudition();
    showView('view-home'); renderHome();
  });

  // Notes
  document.getElementById('btn-add-note').addEventListener('click', () => openNoteModal(null));

  // Update / Reload
  document.getElementById('btn-apply-update').addEventListener('click', applyUpdate);
  document.getElementById('menu-reload').addEventListener('click', async () => {
    closeAllPanels();
    const reg = state.swReg;
    if (reg) {
      try { await reg.update(); } catch {}
      if (reg.waiting) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); return; }
    }
    window.location.reload();
  });
  document.getElementById('menu-check-update').addEventListener('click', checkForUpdates);
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  loadScripts();
  loadSettings();
  loadNotes();
  applyTheme(state.settings.theme);
  applyFontSizes();
  bindEvents();
  initSettingsListeners();
  registerSW();

  if (typeof feather !== 'undefined') feather.replace({ 'stroke-width': 2 });

  const vText = `v${APP_VERSION}`;
  const vEl = document.getElementById('app-version');
  if (vEl) vEl.textContent = vText;
  const mVer = document.getElementById('menu-version');
  if (mVer) mVer.textContent = `Brando ${vText}`;

  if (state.scripts.length > 0 && !state.currentScriptId) {
    state.currentScriptId = state.scripts[0].id;
  }

  const params = new URLSearchParams(window.location.search);
  const incomingPeer = params.get('peer');

  if (incomingPeer) {
    window.history.replaceState({}, '', window.location.pathname);
    showView('view-reader');
    document.getElementById('main-title').textContent = 'Connecting…';
    document.getElementById('reader-sections').innerHTML =
      '<div class="empty-notes"><span>&#128279;</span><p>Connecting to audition device…</p></div>';
    handleIncomingPeer(incomingPeer);
    return;
  }

  showView('view-home');
  renderHome();
}

document.addEventListener('DOMContentLoaded', init);
