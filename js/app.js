/* Brando – main application */

// ── Config ──────────────────────────────────────────────────────────────────
const BASE_URL = (() => {
  const u = window.location.href.split('?')[0].replace(/\/+$/, '');
  return u.endsWith('index.html') ? u.slice(0, -10) : u + '/';
})();

const APP_VERSION = window.APP_VERSION || '-';

// ── Feather icon helper ───────────────────────────────────────────────────────
function icon(name, size = 16) {
  if (typeof feather === 'undefined') return '';
  return feather.toSvg(name, { width: size, height: size, 'stroke-width': 2 });
}

// ── Editor zoom ───────────────────────────────────────────────────────────────
let editorZoom = 1.0;
let _pdfNaturalWidth = 0;
let _pdfNaturalHeight = 0;

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  scripts: [],
  notes: [],
  settings: {
    scrollRate: 40,
    theme: 'dark',
    meLabel: 'ME',
    themLabel: 'THEM',
  },
  importData: { name: '', arrayBuffer: null },
  currentScriptId: null,
  peer: null,
  peerId: null,
  conn: null,
  readerConn: null,
  scrollRaf: null,
  swReg: null,
};

// ── Storage ───────────────────────────────────────────────────────────────────
function saveScripts() {
  localStorage.setItem('brando_scripts', JSON.stringify(state.scripts));
}
function loadScripts() {
  try { state.scripts = JSON.parse(localStorage.getItem('brando_scripts') || '[]'); }
  catch { state.scripts = []; }
}
function saveSettings() {
  localStorage.setItem('brando_settings', JSON.stringify(state.settings));
}
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('brando_settings') || 'null');
    if (s) Object.assign(state.settings, s);
  } catch {}
}
function saveNotes() {
  localStorage.setItem('brando_notes', JSON.stringify(state.notes));
}
function loadNotes() {
  try { state.notes = JSON.parse(localStorage.getItem('brando_notes') || '[]'); }
  catch { state.notes = []; }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── IndexedDB (PDF storage) ───────────────────────────────────────────────────
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

// ── Navigation ────────────────────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  closeAllPanels();
}

// ── Panels ────────────────────────────────────────────────────────────────────
function openPanel(id) {
  closeAllPanels();
  document.getElementById(id).classList.add('open');
  document.getElementById('overlay').classList.remove('hidden');
}
function closeAllPanels() {
  document.querySelectorAll('.slide-panel').forEach(p => p.classList.remove('open'));
  document.getElementById('overlay').classList.add('hidden');
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────
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

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
}

// ── Settings ──────────────────────────────────────────────────────────────────
function renderSettings() {
  const { scrollRate, theme, meLabel, themLabel } = state.settings;
  const scrollEl = document.getElementById('setting-scroll');
  scrollEl.value = scrollRate;
  document.getElementById('setting-scroll-val').textContent = `${scrollRate} px/s`;
  document.getElementById('setting-me').value = meLabel;
  document.getElementById('setting-them').value = themLabel;
  applyTheme(theme);
}

function initSettingsListeners() {
  document.getElementById('setting-scroll').addEventListener('input', e => {
    state.settings.scrollRate = +e.target.value;
    document.getElementById('setting-scroll-val').textContent = `${e.target.value} px/s`;
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
    state.settings.meLabel = e.target.value.trim() || 'ME';
    e.target.value = state.settings.meLabel;
    saveSettings();
  });
  document.getElementById('setting-them').addEventListener('change', e => {
    state.settings.themLabel = e.target.value.trim() || 'THEM';
    e.target.value = state.settings.themLabel;
    saveSettings();
  });
}

// ── Home ──────────────────────────────────────────────────────────────────────
function renderHome() {
  const list = document.getElementById('script-list');
  const empty = document.getElementById('empty-state');

  if (state.scripts.length === 0) {
    list.classList.add('hidden');
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = state.scripts.map(scriptCard).join('');

  if (typeof feather !== 'undefined') feather.replace({ 'stroke-width': 2 });
  list.querySelectorAll('.script-action-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.closest('.script-card').dataset.id;
      handleScriptAction(btn.dataset.action, id);
    });
  });
}

function scriptCard(s) {
  const sectionCount = s.complete && s.sections ? s.sections.length : (s.splits ? s.splits.length + 1 : 1);
  const statusLabel = s.complete ? 'Ready' : 'Draft';
  const statusClass = s.complete ? 'complete' : 'draft';

  return `
    <div class="script-card" data-id="${s.id}">
      <div class="script-card-header">
        <div>
          <div class="script-card-title">${esc(s.name)}</div>
          <div class="script-card-meta">${sectionCount} section${sectionCount !== 1 ? 's' : ''}</div>
        </div>
        <span class="script-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="script-card-actions">
        <button class="script-action-btn" data-action="edit">${icon('edit-2',14)} Edit</button>
        ${s.complete
          ? `<button class="script-action-btn primary-action" data-action="audition">${icon('film',14)} Audition</button>
             <button class="script-action-btn primary-action" data-action="reader">${icon('book-open',14)} Reader</button>`
          : ''}
        <button class="script-action-btn danger" data-action="delete">${icon('trash-2',14)}</button>
      </div>
    </div>`;
}

async function handleScriptAction(action, id) {
  const script = state.scripts.find(s => s.id === id);
  if (!script) return;

  if (action === 'edit') {
    state.currentScriptId = id;
    showView('view-editor');
    await renderEditor(id);
  } else if (action === 'audition') {
    state.currentScriptId = id;
    startAuditionFlow(id);
  } else if (action === 'reader') {
    state.currentScriptId = id;
    startReaderMode(script, null);
  } else if (action === 'delete') {
    const ok = await showConfirm('Delete script', `Delete "${script.name}"? This cannot be undone.`);
    if (ok) {
      await deletePDF(id).catch(() => {});
      state.scripts = state.scripts.filter(s => s.id !== id);
      saveScripts();
      renderHome();
      toast('Script deleted');
    }
  }
}

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── PDF Import ────────────────────────────────────────────────────────────────
function initImportView() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('pdf-input');
  const nameInput = document.getElementById('script-name');
  const createBtn = document.getElementById('btn-create-script');
  const progress = document.getElementById('import-progress');
  const dropLabel = document.getElementById('drop-label');

  state.importData = { name: '', arrayBuffer: null };
  nameInput.value = '';
  dropLabel.textContent = 'Tap to select PDF';
  dropLabel.classList.remove('file-name');
  createBtn.classList.add('hidden');
  progress.classList.add('hidden');

  // Re-attach file handlers (clone to clear old ones)
  const newDrop = dropZone.cloneNode(true);
  dropZone.parentNode.replaceChild(newDrop, dropZone);
  const newInput = document.getElementById('pdf-input');

  newDrop.addEventListener('click', () => newInput.click());
  newInput.addEventListener('change', () => handleFile(newInput.files[0]));

  newDrop.addEventListener('dragover', e => { e.preventDefault(); newDrop.classList.add('dragover'); });
  newDrop.addEventListener('dragleave', () => newDrop.classList.remove('dragover'));
  newDrop.addEventListener('drop', e => { e.preventDefault(); newDrop.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); });
}

async function handleFile(file) {
  if (!file || file.type !== 'application/pdf') { toast('Please select a PDF file'); return; }

  const dropLabel = document.getElementById('drop-label');
  const progress = document.getElementById('import-progress');
  const createBtn = document.getElementById('btn-create-script');
  const nameInput = document.getElementById('script-name');

  dropLabel.textContent = file.name;
  dropLabel.classList.add('file-name');
  progress.classList.remove('hidden');
  progress.textContent = 'Loading PDF…';

  if (!nameInput.value.trim()) {
    nameInput.value = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
    state.importData.name = nameInput.value;
  }

  try {
    state.importData.arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: state.importData.arrayBuffer.slice(0) }).promise;
    progress.textContent = `${pdf.numPages} page${pdf.numPages !== 1 ? 's' : ''} loaded — tap Create Script`;
    createBtn.classList.remove('hidden');
  } catch (err) {
    progress.textContent = 'Failed to read PDF — try another file.';
    console.error(err);
  }
}

async function createScript() {
  const nameInput = document.getElementById('script-name');
  const name = nameInput.value.trim() || state.importData.name || 'Untitled';
  if (!state.importData.arrayBuffer) { toast('Select a PDF first'); return; }

  const script = {
    id: uid(),
    name,
    splits: [],          // Y fractions (0–1) of total rendered height
    roles: ['THEM'],     // role per section
    sections: null,      // [{role, text}] — filled on completion
    pageHeights: [],     // rendered CSS px height per page
    totalHeight: 0,
    renderScale: 1,
    complete: false,
    createdAt: Date.now(),
  };

  await savePDF(script.id, state.importData.arrayBuffer);
  state.scripts.unshift(script);
  saveScripts();
  state.importData = { name: '', arrayBuffer: null };

  state.currentScriptId = script.id;
  showView('view-editor');
  await renderEditor(script.id);
  toast('Tap the PDF to add splits');
}


// ── PDF Editor ────────────────────────────────────────────────────────────────
async function renderEditor(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;

  document.getElementById('editor-title').textContent = script.name;

  // Reset zoom
  editorZoom = 1.0;
  _pdfNaturalWidth = 0;
  _pdfNaturalHeight = 0;
  document.getElementById('zoom-slider').value = 100;
  document.getElementById('zoom-val').textContent = '100%';

  const pdfPages = document.getElementById('pdf-pages');
  const pdfLoading = document.getElementById('pdf-loading');
  pdfPages.innerHTML = '';
  pdfPages.style.width = '';
  pdfLoading.classList.remove('hidden');

  let pdfData;
  try {
    pdfData = await loadPDF(scriptId);
  } catch {
    pdfLoading.textContent = 'Could not load PDF — please re-import.';
    return;
  }

  if (!pdfData) {
    pdfLoading.textContent = 'PDF not found — please re-import.';
    return;
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;

  // Wait one frame so pdf-pages has a measured width
  await new Promise(r => requestAnimationFrame(r));
  const containerWidth = pdfPages.clientWidth || window.innerWidth;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  // Scale is based on the first page width → all pages use same scale
  const firstPage = await pdf.getPage(1);
  const baseViewport = firstPage.getViewport({ scale: 1 });
  const scale = containerWidth / baseViewport.width;

  script.pageHeights = [];
  script.totalHeight = 0;
  script.renderScale = scale;

  // Canvas layer is what gets scaled — pills and split buttons live outside it
  const canvasLayer = document.createElement('div');
  canvasLayer.id = 'pdf-canvas-layer';
  canvasLayer.style.transformOrigin = 'top left';
  pdfPages.appendChild(canvasLayer);

  for (let pn = 1; pn <= pdf.numPages; pn++) {
    const page = await pdf.getPage(pn);
    const viewport = page.getViewport({ scale });

    const cssW = viewport.width;    // = containerWidth
    const cssH = viewport.height;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.style.display = 'block';
    canvasLayer.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);
    await page.render({ canvasContext: ctx, viewport }).promise;

    script.pageHeights.push(cssH);
    script.totalHeight += cssH;
  }

  _pdfNaturalWidth = containerWidth;
  _pdfNaturalHeight = script.totalHeight;
  pdfPages.style.width = containerWidth + 'px';
  saveScripts();

  // Overlay sits alongside the canvas layer — not inside it, so it doesn't scale
  const overlay = document.createElement('div');
  overlay.id = 'pdf-overlay';
  overlay.className = 'pdf-overlay';
  pdfPages.appendChild(overlay);

  pdfLoading.classList.add('hidden');
  renderOverlay(scriptId);
}

function renderOverlay(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  const overlay = document.getElementById('pdf-overlay');
  if (!overlay || !script || !script.totalHeight) return;

  overlay.innerHTML = '';
  overlay.style.height = (script.totalHeight * editorZoom) + 'px';

  const { meLabel, themLabel } = state.settings;
  const sorted = [...script.splits].sort((a, b) => a - b);
  const boundaries = [0, ...sorted.map(f => f * script.totalHeight), script.totalHeight];

  // Section regions
  boundaries.forEach((top, i) => {
    if (i >= boundaries.length - 1) return;
    const bottom = boundaries[i + 1];
    const role = script.roles[i] || 'THEM';

    const region = document.createElement('div');
    region.className = `pdf-section ${role === 'ME' ? 'me' : 'them'}`;
    region.style.top = (top * editorZoom) + 'px';
    region.style.height = ((bottom - top) * editorZoom) + 'px';

    const pill = document.createElement('div');
    pill.className = 'section-pill';

    [['ME', meLabel], ['THEM', themLabel]].forEach(([r, lbl]) => {
      const btn = document.createElement('button');
      btn.className = 'section-pill-btn' + (r === role ? ' active' : '');
      btn.textContent = lbl;
      btn.dataset.role = r;
      btn.addEventListener('click', e => { e.stopPropagation(); setRoleWithCascade(scriptId, i, r); });
      pill.appendChild(btn);
    });

    if (script.splits.length > 0) {
      const delBtn = document.createElement('button');
      delBtn.className = 'section-pill-btn pill-delete';
      delBtn.innerHTML = icon('trash-2', 15);
      delBtn.title = 'Delete section';
      delBtn.addEventListener('click', e => { e.stopPropagation(); deleteSection(scriptId, i); });
      pill.appendChild(delBtn);
    }

    region.appendChild(pill);
    overlay.appendChild(region);
  });

  // Split lines
  sorted.forEach(fraction => {
    const y = fraction * script.totalHeight * editorZoom;
    const line = document.createElement('div');
    line.className = 'pdf-split-line';
    line.style.top = y + 'px';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'pdf-split-remove';
    removeBtn.innerHTML = icon('x', 13);
    removeBtn.title = 'Remove split';
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      removeSplit(scriptId, fraction);
    });

    line.appendChild(removeBtn);
    overlay.appendChild(line);
  });
}

function addSplit(scriptId, yPixels) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script || !script.totalHeight) return;

  const MIN_PX = 30;
  if (yPixels < MIN_PX || yPixels > script.totalHeight - MIN_PX) return;

  const fraction = yPixels / script.totalHeight;

  // Avoid duplicates or splits too close together
  const sorted = [...script.splits].sort((a, b) => a - b);
  const tooClose = sorted.some(f => Math.abs((f - fraction) * script.totalHeight) < MIN_PX);
  if (tooClose) return;

  // Find section index where this split falls
  const sectionIdx = sorted.findIndex(f => fraction < f);
  const insertAt = sectionIdx === -1 ? sorted.length : sectionIdx;

  script.splits.push(fraction);
  script.splits.sort((a, b) => a - b);

  // New section gets opposite role to the one it splits
  const currentRole = script.roles[insertAt] || 'THEM';
  script.roles.splice(insertAt + 1, 0, currentRole === 'ME' ? 'THEM' : 'ME');

  saveScripts();
  renderOverlay(scriptId);
}

function removeSplit(scriptId, fraction) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;

  const sorted = [...script.splits].sort((a, b) => a - b);
  const idx = sorted.indexOf(fraction);
  if (idx === -1) return;

  script.splits = script.splits.filter(f => f !== fraction);
  script.roles.splice(idx + 1, 1);

  saveScripts();
  renderOverlay(scriptId);
}

// Set a role and cascade alternating ME/THEM to subsequent sections
function setRoleWithCascade(scriptId, sectionIndex, role) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;
  script.roles[sectionIndex] = role;
  let current = role;
  for (let i = sectionIndex + 1; i < script.roles.length; i++) {
    current = current === 'ME' ? 'THEM' : 'ME';
    script.roles[i] = current;
  }
  saveScripts();
  renderOverlay(scriptId);
}

// Remove section entirely — removes the bounding split and the role entry
function deleteSection(scriptId, sectionIndex) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script || script.splits.length === 0) return;

  const sorted = [...script.splits].sort((a, b) => a - b);

  if (sectionIndex === 0) {
    // First section: remove lower boundary, merges into next section
    script.splits = script.splits.filter(f => f !== sorted[0]);
  } else {
    // Any other section: remove upper boundary, merges into previous section
    script.splits = script.splits.filter(f => f !== sorted[sectionIndex - 1]);
  }

  script.roles.splice(sectionIndex, 1);
  saveScripts();
  renderOverlay(scriptId);
}

// Extract text from PDF per section (called at completion)
async function extractSectionTexts(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;

  const pdfData = await loadPDF(scriptId);
  if (!pdfData) { toast('PDF not found — cannot extract text'); return; }

  const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
  const scale = script.renderScale;
  const totalH = script.totalHeight;

  // Collect all text items with absolute Y position in rendered space
  const items = [];
  let pageOffset = 0;

  for (let pn = 1; pn <= pdf.numPages; pn++) {
    const page = await pdf.getPage(pn);
    const viewport = page.getViewport({ scale });
    const content = await page.getTextContent();

    for (const item of content.items) {
      if (!item.str.trim()) continue;
      const [vx, vy] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      items.push({ str: item.str, x: vx, y: pageOffset + vy });
    }

    pageOffset += script.pageHeights[pn - 1] || 0;
  }

  items.sort((a, b) => a.y - b.y || a.x - b.x);

  const sorted = [...script.splits].sort((a, b) => a - b);
  const boundaries = [0, ...sorted.map(f => f * totalH), totalH];

  script.sections = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const top = boundaries[i];
    const bottom = boundaries[i + 1];
    const sectionItems = items.filter(t => t.y >= top && t.y < bottom);

    // Group into lines by proximity
    const lines = [];
    let prevY = null;
    let line = [];

    for (const item of sectionItems) {
      if (prevY !== null && Math.abs(item.y - prevY) > 10) {
        if (line.length) lines.push(line.join(' '));
        line = [];
      }
      line.push(item.str);
      prevY = item.y;
    }
    if (line.length) lines.push(line.join(' '));

    const role = script.roles[i] || 'THEM';
    script.sections.push({ role, text: lines.join('\n') });
  }
}

// ── getSections (used by audition & reader) ───────────────────────────────────
function getSections(script) {
  if (script.sections) return script.sections;
  // Fallback for incomplete scripts: return one empty section
  return [{ role: script.roles[0] || 'THEM', text: '' }];
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
    document.getElementById('status-dot').className = 'status-dot connected';
    document.getElementById('status-text').textContent = 'Reader connected!';
    document.getElementById('btn-enter-audition').classList.remove('hidden');

    conn.on('open', () => conn.send({ type: 'script', data: script }));
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

  textEl.style.fontSize = '32px';
  textEl.textContent = text;
  blank.style.opacity = '0';
  container.classList.remove('hidden');

  textEl.style.transform = 'translateY(0)';
  setTimeout(() => startScrolling(textEl), 500);
}

function clearAudition() {
  stopScrolling();
  document.getElementById('audition-blank').style.opacity = '1';
  document.getElementById('audition-text-container').classList.add('hidden');
}

function startScrolling(textEl) {
  stopScrolling();
  const rate = state.settings.scrollRate;
  let startTime = null;
  const maxScroll = textEl.offsetHeight + window.innerHeight;

  function step(ts) {
    if (!startTime) startTime = ts;
    const elapsed = (ts - startTime) / 1000;
    const y = -elapsed * rate;
    textEl.style.transform = `translateY(${y}px)`;
    if (-y < maxScroll) state.scrollRaf = requestAnimationFrame(step);
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

  document.getElementById('reader-title').textContent = script.name;
  const statusEl = document.getElementById('reader-status');
  statusEl.className = conn ? 'reader-status connected' : 'reader-status';
  statusEl.textContent = conn ? '●' : '○';

  const sections = getSections(script);
  const container = document.getElementById('reader-sections');

  container.innerHTML = sections.map((sec, i) => {
    const label = sec.role === 'ME' ? meLabel : themLabel;
    const text = sec.text || '';
    return `<div class="reader-section" data-role="${sec.role}" data-index="${i}">
              <div class="reader-section-label">${esc(label)}</div>
              <div class="reader-section-text">${esc(text)}</div>
            </div>`;
  }).join('');

  container.querySelectorAll('.reader-section').forEach(el => {
    el.addEventListener('click', () => {
      container.querySelectorAll('.reader-section').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      if (!conn) return;
      const role = el.dataset.role;
      const text = el.querySelector('.reader-section-text').textContent;
      if (role === 'ME') conn.send({ type: 'show_me', text });
      else conn.send({ type: 'clear' });
    });
  });

  showView('view-reader');
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
      if (msg.type === 'script') startReaderMode(msg.data, conn);
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

function showUpdateBanner() {
  document.getElementById('update-banner').classList.remove('hidden');
}

function applyUpdate() {
  const reg = state.swReg;
  if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  else window.location.reload();
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

  document.getElementById('btn-menu').addEventListener('click', () => openPanel('menu-panel'));
  document.getElementById('btn-menu-close').addEventListener('click', closeAllPanels);

  document.getElementById('btn-settings').addEventListener('click', () => { renderSettings(); openPanel('settings-panel'); });
  document.getElementById('btn-settings-close').addEventListener('click', closeAllPanels);

  document.getElementById('menu-import').addEventListener('click', () => { closeAllPanels(); initImportView(); showView('view-import'); });
  document.getElementById('menu-notes').addEventListener('click', () => { closeAllPanels(); renderNotes(); showView('view-notes'); });
  document.getElementById('btn-import-empty').addEventListener('click', () => { initImportView(); showView('view-import'); });

  document.getElementById('btn-import-back').addEventListener('click', () => { showView('view-home'); renderHome(); });
  document.getElementById('script-name').addEventListener('input', e => { state.importData.name = e.target.value; });
  document.getElementById('btn-create-script').addEventListener('click', createScript);

  // Editor
  document.getElementById('btn-editor-back').addEventListener('click', () => { showView('view-home'); renderHome(); });

  document.getElementById('btn-editor-done').addEventListener('click', async () => {
    const script = state.scripts.find(s => s.id === state.currentScriptId);
    if (!script) return;
    if (!script.splits.length) { toast('Add at least one split first'); return; }

    const btn = document.getElementById('btn-editor-done');
    btn.textContent = '…';
    btn.disabled = true;

    await extractSectionTexts(state.currentScriptId);
    script.complete = true;
    saveScripts();

    btn.textContent = '✓';
    btn.disabled = false;
    toast('Script ready!');
    showView('view-home');
    renderHome();
  });

  // PDF tap-to-split (account for CSS zoom on pdf-pages)
  document.getElementById('pdf-pages').addEventListener('click', e => {
    const pdfPages = document.getElementById('pdf-pages');
    const rect = pdfPages.getBoundingClientRect();
    const y = (e.clientY - rect.top) / editorZoom;
    if (state.currentScriptId) addSplit(state.currentScriptId, y);
  });

  // Zoom slider — scales only the canvas layer, not the overlay controls
  document.getElementById('zoom-slider').addEventListener('input', e => {
    editorZoom = +e.target.value / 100;
    document.getElementById('zoom-val').textContent = e.target.value + '%';
    const canvasLayer = document.getElementById('pdf-canvas-layer');
    const pdfPages = document.getElementById('pdf-pages');
    if (canvasLayer && _pdfNaturalWidth) {
      canvasLayer.style.transform = `scale(${editorZoom})`;
      // Expand layout to match visual size so viewer scrolls correctly
      canvasLayer.style.marginRight = `${Math.max(0, _pdfNaturalWidth * (editorZoom - 1))}px`;
      canvasLayer.style.marginBottom = `${Math.max(0, _pdfNaturalHeight * (editorZoom - 1))}px`;
      pdfPages.style.width = (_pdfNaturalWidth * Math.max(1, editorZoom)) + 'px';
    }
    if (state.currentScriptId) renderOverlay(state.currentScriptId);
  });

  // QR / Audition
  document.getElementById('btn-qr-back').addEventListener('click', () => {
    if (state.peer) { try { state.peer.destroy(); } catch {} state.peer = null; }
    showView('view-home'); renderHome();
  });
  document.getElementById('btn-enter-audition').addEventListener('click', enterAuditionMode);
  document.getElementById('btn-exit-audition').addEventListener('click', () => {
    stopScrolling(); clearAudition(); showView('view-home'); renderHome();
  });

  // Reader
  document.getElementById('btn-reader-back').addEventListener('click', () => {
    if (state.readerConn) { try { state.readerConn.close(); } catch {} state.readerConn = null; }
    showView('view-home'); renderHome();
  });

  // Notes
  document.getElementById('btn-notes-back').addEventListener('click', () => { showView('view-home'); renderHome(); });
  document.getElementById('btn-add-note').addEventListener('click', () => openNoteModal(null));

  // Update / Reload
  document.getElementById('btn-apply-update').addEventListener('click', applyUpdate);
  document.getElementById('menu-reload').addEventListener('click', () => window.location.reload());
  document.getElementById('menu-check-update').addEventListener('click', checkForUpdates);
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  loadScripts();
  loadSettings();
  loadNotes();
  applyTheme(state.settings.theme);
  bindEvents();
  initSettingsListeners();
  registerSW();

  if (typeof feather !== 'undefined') feather.replace({ 'stroke-width': 2 });

  const vText = `v${APP_VERSION}`;
  const vEl = document.getElementById('app-version');
  if (vEl) vEl.textContent = vText;
  const mVer = document.getElementById('menu-version');
  if (mVer) mVer.textContent = `Brando ${vText}`;

  const params = new URLSearchParams(window.location.search);
  const incomingPeer = params.get('peer');

  if (incomingPeer) {
    window.history.replaceState({}, '', window.location.pathname);
    showView('view-reader');
    document.getElementById('reader-title').textContent = 'Connecting…';
    document.getElementById('reader-sections').innerHTML =
      '<div class="empty-notes"><span>&#128279;</span><p>Connecting to audition device…</p></div>';
    handleIncomingPeer(incomingPeer);
    return;
  }

  showView('view-home');
  renderHome();
}

document.addEventListener('DOMContentLoaded', init);
