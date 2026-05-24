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

// ── Editor zoom & display compositing ────────────────────────────────────────
let editorZoom = 1.0;
let _pdfNaturalWidth = 0;
let _pdfNaturalHeight = 0;
let _pageCanvases = [];       // off-screen canvas per PDF page
let _pageCssHeights = [];     // CSS px height per page
let _displaySectionOffsets = []; // display-space CSS top of each section (null if DELETED)
let _displayTotalHeight = 0;  // total CSS height of visible sections
let _dpR = 1;                 // device pixel ratio used when rendering

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
      handleScriptAction('delete', btn.closest('.script-card').dataset.id);
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
  if (meLabel)   meLabel.textContent   = state.settings.meLabel;
  if (themLabel) themLabel.textContent = state.settings.themLabel;
}

function scriptCard(s) {
  const sectionCount = s.complete && s.sections ? s.sections.length : (s.splits ? s.splits.length + 1 : 1);
  const statusLabel = s.complete ? 'Ready' : 'Draft';
  const statusClass = s.complete ? 'complete' : 'draft';
  const selected = state.currentScriptId === s.id;

  return `
    <div class="script-card${selected ? ' selected' : ''}" data-id="${s.id}">
      <div class="script-card-header">
        <div>
          <div class="script-card-title">${esc(s.name)}</div>
          <div class="script-card-meta">${sectionCount} section${sectionCount !== 1 ? 's' : ''}</div>
        </div>
        <span class="script-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="script-card-actions">
        <button class="script-action-btn danger" data-action="delete">${icon('trash-2',14)} Delete</button>
      </div>
    </div>`;
}

async function handleScriptAction(action, id) {
  const script = state.scripts.find(s => s.id === id);
  if (!script) return;

  if (action === 'delete') {
    const ok = await showConfirm('Delete script', `Delete "${script.name}"? This cannot be undone.`);
    if (ok) {
      await deletePDF(id).catch(() => {});
      state.scripts = state.scripts.filter(s => s.id !== id);
      if (state.currentScriptId === id) state.currentScriptId = null;
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
function triggerImport() {
  state.importData = { name: '', arrayBuffer: null };
  document.getElementById('script-name').value = '';
  document.getElementById('import-progress').classList.add('hidden');
  document.getElementById('btn-import-confirm').disabled = true;
  const inp = document.getElementById('pdf-input-global');
  inp.value = '';
  inp.click();
}

async function handleFile(file) {
  if (!file || file.type !== 'application/pdf') { toast('Please select a PDF file'); return; }
  document.getElementById('pdf-input-global').value = '';

  const name = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
  toast(`Importing "${name}"…`);

  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (err) {
    toast('Failed to read PDF — try another file.'); return;
  }

  const script = {
    id: uid(), name,
    splits: [], roles: ['THEM'], sections: null,
    pageHeights: [], totalHeight: 0, renderScale: 1,
    complete: false, createdAt: Date.now(),
  };

  await savePDF(script.id, buf);
  state.scripts.unshift(script);
  saveScripts();

  state.currentScriptId = script.id;
  showView('view-home');
  renderHome();
  toast(`"${name}" imported — tap Edit to start`);
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
  showView('view-home');
  renderHome();
  toast('Script created — tap Edit to start splitting');
}


// ── PDF Editor ────────────────────────────────────────────────────────────────
async function renderEditor(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;

  document.getElementById('editor-title').textContent = script.name;

  // Reset zoom & display state
  editorZoom = 1.0;
  _pdfNaturalWidth = 0;
  _pdfNaturalHeight = 0;
  _pageCanvases = [];
  _pageCssHeights = [];
  _displaySectionOffsets = [];
  _displayTotalHeight = 0;
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
  _dpR = Math.min(window.devicePixelRatio || 1, 2);

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
    canvas.width = Math.round(cssW * _dpR);
    canvas.height = Math.round(cssH * _dpR);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.style.display = 'block';
    // Render off-screen — rebuildDisplay composites into canvasLayer
    const ctx = canvas.getContext('2d');
    ctx.scale(_dpR, _dpR);
    await page.render({ canvasContext: ctx, viewport }).promise;

    _pageCanvases.push(canvas);
    _pageCssHeights.push(cssH);
    script.pageHeights.push(cssH);
    script.totalHeight += cssH;
  }

  _pdfNaturalWidth = containerWidth;
  pdfPages.style.width = containerWidth + 'px';
  saveScripts();

  // Overlay sits alongside the canvas layer — not inside it, so it doesn't scale
  const overlay = document.createElement('div');
  overlay.id = 'pdf-overlay';
  overlay.className = 'pdf-overlay';
  pdfPages.appendChild(overlay);

  pdfLoading.classList.add('hidden');

  if (script.splits.length === 0 && script.totalHeight > 0) {
    addSplit(scriptId, Math.min(80, script.totalHeight * 0.04)); // calls rebuildDisplay internally
  } else {
    rebuildDisplay(scriptId);
  }
}

// Composite visible (non-DELETED) sections into canvasLayer from off-screen page canvases.
// Updates _displaySectionOffsets and _displayTotalHeight, then calls renderOverlay.
function rebuildDisplay(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  const canvasLayer = document.getElementById('pdf-canvas-layer');
  if (!canvasLayer || !script || !script.totalHeight || !_pageCanvases.length) return;

  canvasLayer.innerHTML = '';
  _displaySectionOffsets = new Array(script.roles.length).fill(null);
  _displayTotalHeight = 0;

  const sorted = [...script.splits].sort((a, b) => a - b);
  const boundaryFracs = [0, ...sorted, 1];

  // Top offset in CSS px for each page
  const pageOffsets = [];
  let cumH = 0;
  for (const h of _pageCssHeights) { pageOffsets.push(cumH); cumH += h; }

  const canvasW = _pageCanvases[0].width; // device px (same for all pages)
  const cssW = canvasW / _dpR;

  for (let i = 0; i < boundaryFracs.length - 1; i++) {
    const role = script.roles[i] || 'THEM';
    if (role === 'DELETED') continue;

    const topPx    = boundaryFracs[i]     * script.totalHeight;
    const bottomPx = boundaryFracs[i + 1] * script.totalHeight;
    const sectionH = bottomPx - topPx;
    if (sectionH <= 0) continue;

    _displaySectionOffsets[i] = _displayTotalHeight;
    _displayTotalHeight += sectionH;

    // Composite section pixels from source page canvases
    const canvas = document.createElement('canvas');
    canvas.width  = canvasW;
    canvas.height = Math.round(sectionH * _dpR);
    canvas.style.width  = cssW + 'px';
    canvas.style.height = sectionH + 'px';
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    for (let pn = 0; pn < _pageCanvases.length; pn++) {
      const pageTop    = pageOffsets[pn];
      const pageBottom = pageTop + _pageCssHeights[pn];
      if (pageBottom <= topPx || pageTop >= bottomPx) continue;

      const overlapTop    = Math.max(topPx, pageTop);
      const overlapBottom = Math.min(bottomPx, pageBottom);
      const srcY = Math.round((overlapTop - pageTop)  * _dpR);
      const srcH = Math.round((overlapBottom - overlapTop) * _dpR);
      const dstY = Math.round((overlapTop - topPx) * _dpR);
      ctx.drawImage(_pageCanvases[pn], 0, srcY, canvasW, srcH, 0, dstY, canvasW, srcH);
    }
    canvasLayer.appendChild(canvas);
  }

  _pdfNaturalHeight = _displayTotalHeight;

  // Keep canvas layer zoom in sync
  if (_pdfNaturalWidth) {
    canvasLayer.style.transform   = editorZoom !== 1 ? `scale(${editorZoom})` : '';
    canvasLayer.style.marginRight  = `${Math.max(0, _pdfNaturalWidth  * (editorZoom - 1))}px`;
    canvasLayer.style.marginBottom = `${Math.max(0, _pdfNaturalHeight * (editorZoom - 1))}px`;
    const pp = document.getElementById('pdf-pages');
    if (pp) pp.style.width = (_pdfNaturalWidth * Math.max(1, editorZoom)) + 'px';
  }

  renderOverlay(scriptId);
}

// Map a Y position in display space (cut sections removed) back to PDF space.
function displayYToPdfY(displayY, scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script || !script.totalHeight || !_displaySectionOffsets.length) return displayY;

  const sorted = [...script.splits].sort((a, b) => a - b);
  const boundaryFracs = [0, ...sorted, 1];

  for (let i = 0; i < boundaryFracs.length - 1; i++) {
    const dispTop = _displaySectionOffsets[i];
    if (dispTop === null) continue;
    const sectionH = (boundaryFracs[i + 1] - boundaryFracs[i]) * script.totalHeight;
    if (displayY >= dispTop && displayY < dispTop + sectionH) {
      return boundaryFracs[i] * script.totalHeight + (displayY - dispTop);
    }
  }
  return script.totalHeight;
}

function renderOverlay(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  const overlay = document.getElementById('pdf-overlay');
  if (!overlay || !script || !script.totalHeight) return;

  overlay.innerHTML = '';
  overlay.style.height = (_displayTotalHeight * editorZoom) + 'px';

  const sorted = [...script.splits].sort((a, b) => a - b);
  const boundaryFracs = [0, ...sorted, 1];

  // Lines adjacent to a DELETED section are not shown
  const hiddenFracs = new Set();
  sorted.forEach((frac, idx) => {
    if ((script.roles[idx] || 'THEM') === 'DELETED' ||
        (script.roles[idx + 1] || 'THEM') === 'DELETED') {
      hiddenFracs.add(frac);
    }
  });

  // ── Section tint regions ─────────────────────────────────────────────────
  boundaryFracs.forEach((topFrac, i) => {
    if (i >= boundaryFracs.length - 1) return;
    const role = script.roles[i] || 'THEM';
    if (role === 'DELETED') return; // no display space for cut sections
    const displayTop = _displaySectionOffsets[i];
    if (displayTop === null) return;
    const sectionH = (boundaryFracs[i + 1] - topFrac) * script.totalHeight;
    const region = document.createElement('div');
    region.className = `pdf-section ${role === 'ME' ? 'me' : 'them'}`;
    region.style.top    = (displayTop * editorZoom) + 'px';
    region.style.height = (sectionH  * editorZoom) + 'px';
    overlay.appendChild(region);
  });

  // ── Fixed top line ──────────────────────────────────────────────────────
  const topLine = document.createElement('div');
  topLine.className = 'pdf-split-line pdf-split-line--fixed pdf-split-line--top';
  topLine.style.top = '0px';
  overlay.appendChild(topLine);

  // ── User split lines ────────────────────────────────────────────────────
  sorted.forEach((fraction, sortedIdx) => {
    if (hiddenFracs.has(fraction)) return;
    const sectionIdx = sortedIdx + 1; // section below this line
    const displayTop = _displaySectionOffsets[sectionIdx];
    if (displayTop === null) return;

    const minFrac = sortedIdx > 0 ? sorted[sortedIdx - 1] + 0.002 : 0.001;
    const maxFrac = sortedIdx < sorted.length - 1 ? sorted[sortedIdx + 1] - 0.002 : 0.999;

    const line = document.createElement('div');
    line.className = 'pdf-split-line';
    line.style.top = (displayTop * editorZoom) + 'px';

    let dragging = false, didDrag = false, startClientY = 0, liveFraction = fraction, longPressTimer = null;
    const startDisplayTop = displayTop; // display Y at drag start

    const startDrag = cy => { dragging = true; didDrag = false; startClientY = cy; liveFraction = fraction; line.classList.add('dragging'); };
    const onMove = cy => {
      if (!dragging) return;
      const d = cy - startClientY;
      if (Math.abs(d) > 3) didDrag = true;
      const deltaDisp = d / editorZoom; // delta in CSS px — same in display and PDF space for non-DELETED sections
      liveFraction = Math.max(minFrac, Math.min(maxFrac, fraction + deltaDisp / script.totalHeight));
      line.style.top = ((startDisplayTop + deltaDisp) * editorZoom) + 'px';
    };
    const onEnd = () => {
      clearTimeout(longPressTimer);
      if (!dragging) return;
      dragging = false; line.classList.remove('dragging');
      if (didDrag) {
        const idx = script.splits.findIndex(f => f === fraction);
        if (idx !== -1) script.splits[idx] = liveFraction;
        saveScripts(); rebuildDisplay(scriptId);
      }
    };

    line.addEventListener('touchstart', e => { e.stopPropagation(); const ty = e.touches[0].clientY; longPressTimer = setTimeout(() => startDrag(ty), 300); }, { passive: true });
    line.addEventListener('touchmove', e => { if (!dragging) { clearTimeout(longPressTimer); return; } e.preventDefault(); onMove(e.touches[0].clientY); }, { passive: false });
    line.addEventListener('touchend', e => { e.stopPropagation(); onEnd(); });
    line.addEventListener('touchcancel', () => { clearTimeout(longPressTimer); onEnd(); });
    line.addEventListener('mousedown', e => { e.stopPropagation(); startDrag(e.clientY); const mm = ev => onMove(ev.clientY); const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); onEnd(); }; document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu); });
    line.addEventListener('click', e => e.stopPropagation());
    line.addEventListener('contextmenu', e => e.preventDefault());

    if ((script.roles[sectionIdx] || 'THEM') !== 'DELETED') {
      const btn = document.createElement('button');
      btn.className = 'split-scissors-btn';
      btn.innerHTML = icon('scissors', 15);
      btn.addEventListener('click', e => { e.stopPropagation(); showLineMenu(btn, scriptId, sectionIdx); });
      line.appendChild(btn);
    }

    overlay.appendChild(line);
  });

  // ── Fixed bottom line ───────────────────────────────────────────────────
  const botLine = document.createElement('div');
  botLine.className = 'pdf-split-line pdf-split-line--fixed pdf-split-line--bottom';
  botLine.style.top = (_displayTotalHeight * editorZoom) + 'px';
  overlay.appendChild(botLine);
}

function showLineMenu(anchor, scriptId, sectionIdx) {
  document.querySelectorAll('.line-menu').forEach(m => m.remove());
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;
  const role = script.roles[sectionIdx] || 'THEM';
  const { meLabel, themLabel } = state.settings;

  const menu = document.createElement('div');
  menu.className = 'line-menu';
  menu.innerHTML = `
    <button class="line-menu-item${role === 'ME' ? ' active' : ''}" data-action="me">${esc(meLabel)}</button>
    <button class="line-menu-item${role === 'THEM' ? ' active' : ''}" data-action="them">${esc(themLabel)}</button>
    <div class="line-menu-sep"></div>
    <button class="line-menu-item line-menu-cut" data-action="delete">${icon('scissors', 13)} Cut section</button>`;

  const r = anchor.getBoundingClientRect();
  const menuW = 140, menuH = 132;
  let left = r.right - menuW;
  let top = r.bottom + 6;
  if (left < 4) left = 4;
  if (top + menuH > window.innerHeight - 8) top = r.top - menuH - 6;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  document.body.appendChild(menu);

  menu.addEventListener('click', e => {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    menu.remove();
    const action = item.dataset.action;
    if (action === 'me') setRoleWithCascade(scriptId, sectionIdx, 'ME');
    else if (action === 'them') setRoleWithCascade(scriptId, sectionIdx, 'THEM');
    else if (action === 'delete') deleteSection(scriptId, sectionIdx);
  });

  const dismiss = e => { if (!menu.contains(e.target)) menu.remove(); };
  setTimeout(() => document.addEventListener('click', dismiss, { once: true }), 10);
}

function addSplit(scriptId, yPixels) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script || !script.totalHeight) return;

  const MIN_PX = 2;
  if (yPixels < MIN_PX || yPixels > script.totalHeight - MIN_PX) return;

  const fraction = yPixels / script.totalHeight;

  // Only block exact duplicate splits
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
  rebuildDisplay(scriptId);
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
  rebuildDisplay(scriptId);
}

// Set a role and cascade alternating ME/THEM to subsequent sections
function setRoleWithCascade(scriptId, sectionIndex, role) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;
  script.roles[sectionIndex] = role;
  let current = role;
  for (let i = sectionIndex + 1; i < script.roles.length; i++) {
    if (script.roles[i] === 'DELETED') continue;
    current = current === 'ME' ? 'THEM' : 'ME';
    script.roles[i] = current;
  }
  saveScripts();
  renderOverlay(scriptId);
}

// Cut section — mark as excluded; covered with solid block everywhere, skipped in output
function deleteSection(scriptId, sectionIndex) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;
  script.roles[sectionIndex] = 'DELETED';
  saveScripts();
  rebuildDisplay(scriptId);
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
    if (role === 'DELETED') continue;
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
  document.getElementById('footer-nav').classList.add('hidden');
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

  document.getElementById('menu-import').addEventListener('click', () => { closeAllPanels(); triggerImport(); });
  document.getElementById('menu-notes').addEventListener('click', () => { closeAllPanels(); renderNotes(); showView('view-notes'); });
  document.getElementById('btn-import-empty').addEventListener('click', triggerImport);
  document.getElementById('pdf-input-global').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  document.getElementById('btn-import-quit').addEventListener('click', () => { showView('view-home'); renderHome(); });
  document.getElementById('script-name').addEventListener('input', e => { state.importData.name = e.target.value; });
  document.getElementById('btn-import-confirm').addEventListener('click', createScript);

  // Footer nav
  document.getElementById('btn-footer-home').addEventListener('click', () => {
    showView('view-home'); renderHome();
  });
  document.getElementById('btn-footer-edit').addEventListener('click', async () => {
    if (!state.currentScriptId) return;
    showView('view-editor');
    await renderEditor(state.currentScriptId);
  });
  document.getElementById('btn-footer-me').addEventListener('click', () => {
    if (!state.currentScriptId) return;
    startAuditionFlow(state.currentScriptId);
  });
  document.getElementById('btn-footer-them').addEventListener('click', () => {
    if (!state.currentScriptId) return;
    const script = state.scripts.find(s => s.id === state.currentScriptId);
    if (script) startReaderMode(script, null);
  });

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
    const displayY = (e.clientY - rect.top) / editorZoom;
    if (state.currentScriptId) addSplit(state.currentScriptId, displayYToPdfY(displayY, state.currentScriptId));
  });
  document.getElementById('pdf-viewer').addEventListener('contextmenu', e => e.preventDefault());

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
    stopScrolling(); clearAudition();
    document.getElementById('footer-nav').classList.remove('hidden');
    showView('view-home'); renderHome();
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

  // Auto-select most recent script so footer buttons are immediately usable
  if (state.scripts.length > 0 && !state.currentScriptId) {
    state.currentScriptId = state.scripts[0].id;
  }

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
