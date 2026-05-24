/* Brando – main application */

// ── Config ──────────────────────────────────────────────────────────────────
const BASE_URL = (() => {
  const u = window.location.href.split('?')[0].replace(/\/+$/, '');
  return u.endsWith('index.html') ? u.slice(0, -10) : u + '/';
})();

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  scripts: [],
  notes: [],
  settings: {
    scrollRate: 40,      // px per second
    fontSize: 28,        // px
    theme: 'dark',
    meLabel: 'ME',
    themLabel: 'THEM',
  },
  importData: { name: '', lines: [] },
  currentScriptId: null,
  peer: null,
  peerId: null,
  conn: null,
  readerConn: null,     // on reader device
  scrollRaf: null,
  scrollStartY: null,
  scrollStartTime: null,
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
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => {
      overlay.remove(); resolve(false);
    });
    overlay.querySelector('.confirm-ok').addEventListener('click', () => {
      overlay.remove(); resolve(true);
    });
    overlay.addEventListener('click', e => {
      if (e.target === overlay) { overlay.remove(); resolve(false); }
    });
  });
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────
function renderSettings() {
  const { scrollRate, fontSize, theme, meLabel, themLabel } = state.settings;

  const scrollEl = document.getElementById('setting-scroll');
  scrollEl.value = scrollRate;
  document.getElementById('setting-scroll-val').textContent = `${scrollRate} px/s`;

  const fontEl = document.getElementById('setting-fontsize');
  fontEl.value = fontSize;
  document.getElementById('setting-fontsize-val').textContent = `${fontSize}px`;

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

  document.getElementById('setting-fontsize').addEventListener('input', e => {
    state.settings.fontSize = +e.target.value;
    document.getElementById('setting-fontsize-val').textContent = `${e.target.value}px`;
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
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = state.scripts.map(s => scriptCard(s)).join('');

  list.querySelectorAll('.script-action-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.closest('.script-card').dataset.id;
      handleScriptAction(btn.dataset.action, id);
    });
  });
}

function scriptCard(s) {
  const { meLabel, themLabel } = state.settings;
  const sectionCount = getSections(s).length;
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
        <button class="script-action-btn" data-action="edit">&#9998; Edit</button>
        ${s.complete
          ? `<button class="script-action-btn primary-action" data-action="audition">&#127917; Audition</button>
             <button class="script-action-btn primary-action" data-action="reader">&#128214; Reader</button>`
          : ''}
        <button class="script-action-btn danger" data-action="delete">&#128465;</button>
      </div>
    </div>`;
}

async function handleScriptAction(action, id) {
  const script = state.scripts.find(s => s.id === id);
  if (!script) return;

  if (action === 'edit') {
    state.currentScriptId = id;
    renderEditor(id);
    showView('view-editor');
  } else if (action === 'audition') {
    state.currentScriptId = id;
    startAuditionFlow(id);
  } else if (action === 'reader') {
    state.currentScriptId = id;
    startReaderMode(script, null);
  } else if (action === 'delete') {
    const ok = await showConfirm('Delete script', `Delete "${script.name}"? This cannot be undone.`);
    if (ok) {
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

  state.importData = { name: '', lines: [] };
  nameInput.value = '';
  dropLabel.textContent = 'Tap to select PDF';
  dropLabel.classList.remove('file-name');
  createBtn.classList.add('hidden');
  progress.classList.add('hidden');

  dropZone.addEventListener('click', () => fileInput.click(), { once: true });
  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]), { once: true });

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0]);
  });
}

async function handleFile(file) {
  if (!file || file.type !== 'application/pdf') {
    toast('Please select a PDF file');
    return;
  }

  const dropLabel = document.getElementById('drop-label');
  const progress = document.getElementById('import-progress');
  const createBtn = document.getElementById('btn-create-script');
  const nameInput = document.getElementById('script-name');

  dropLabel.textContent = file.name;
  dropLabel.classList.add('file-name');
  progress.classList.remove('hidden');

  if (!nameInput.value.trim()) {
    nameInput.value = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
    state.importData.name = nameInput.value;
  }

  try {
    state.importData.lines = await extractLinesFromPDF(file);
    progress.textContent = `Extracted ${state.importData.lines.length} lines`;
    createBtn.classList.remove('hidden');
  } catch (err) {
    progress.textContent = 'Failed to read PDF. Try another file.';
    console.error(err);
  }
}

async function extractLinesFromPDF(file) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Group items by Y position (within 3px tolerance)
    const rows = [];
    let prevY = null;
    let row = [];

    const sorted = [...content.items].sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 3) return yDiff;
      return a.transform[4] - b.transform[4];
    });

    for (const item of sorted) {
      const y = item.transform[5];
      if (prevY !== null && Math.abs(y - prevY) > 5) {
        const text = row.join(' ').trim();
        if (text) rows.push(text);
        row = [];
      }
      if (item.str.trim()) row.push(item.str);
      prevY = y;
    }
    if (row.length) {
      const text = row.join(' ').trim();
      if (text) rows.push(text);
    }

    allLines.push(...rows);
    if (pageNum < pdf.numPages) allLines.push(''); // page separator
  }

  // Remove runs of blank lines, keep at most one
  return allLines.reduce((acc, line, i, arr) => {
    if (line === '' && arr[i - 1] === '') return acc;
    acc.push(line);
    return acc;
  }, []);
}

function createScript() {
  const nameInput = document.getElementById('script-name');
  const name = nameInput.value.trim() || state.importData.name || 'Untitled';
  if (!state.importData.lines.length) { toast('No PDF content to import'); return; }

  const script = {
    id: uid(),
    name,
    lines: state.importData.lines,
    boundaries: [],   // line indices after which section breaks occur
    roles: ['THEM'],  // role per section (starts with 1 section = 1 role)
    complete: false,
    createdAt: Date.now(),
  };

  state.scripts.unshift(script);
  saveScripts();
  state.importData = { name: '', lines: [] };

  state.currentScriptId = script.id;
  renderEditor(script.id);
  showView('view-editor');
  toast('Script created — now split it into sections');
}

// ── Script Editor ─────────────────────────────────────────────────────────────
function getSections(script) {
  const { lines, boundaries, roles } = script;
  if (!lines.length) return [];

  const sorted = [...boundaries].sort((a, b) => a - b);
  const sections = [];
  let start = 0;

  for (let i = 0; i <= sorted.length; i++) {
    const end = i < sorted.length ? sorted[i] : lines.length - 1;
    sections.push({
      index: i,
      startLine: start,
      endLine: end,
      lines: lines.slice(start, end + 1),
      role: roles[i] || 'THEM',
    });
    start = end + 1;
  }

  return sections;
}

function renderEditor(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;

  const { meLabel, themLabel } = state.settings;
  document.getElementById('editor-title').textContent = script.name;
  const container = document.getElementById('script-sections');
  const sections = getSections(script);
  let html = '';

  sections.forEach((sec, si) => {
    const roleLabel = sec.role === 'ME' ? meLabel : themLabel;
    const linesHtml = sec.lines.map((line, li) => {
      const absLine = sec.startLine + li;
      const isEmpty = !line.trim();
      return `<div class="section-line${isEmpty ? ' empty' : ''}"
                   data-script="${scriptId}" data-line="${absLine}">
                ${isEmpty ? '&nbsp;' : esc(line)}
              </div>`;
    }).join('');

    html += `
      <div class="editor-section" data-role="${sec.role}" data-section="${si}">
        <div class="section-role-bar">
          <button class="role-btn${sec.role === 'ME' ? ' active' : ''}"
                  data-role="ME" data-script="${scriptId}" data-section="${si}">
            ${esc(meLabel)}
          </button>
          <button class="role-btn${sec.role === 'THEM' ? ' active' : ''}"
                  data-role="THEM" data-script="${scriptId}" data-section="${si}">
            ${esc(themLabel)}
          </button>
        </div>
        <div class="section-lines">${linesHtml}</div>
      </div>`;

    // Add divider between sections (represents the boundary)
    if (si < sections.length - 1) {
      const boundaryLine = sec.endLine;
      html += `<div class="section-divider" data-script="${scriptId}" data-boundary="${boundaryLine}">
                 <span>&#10005; remove split</span>
               </div>`;
    }
  });

  container.innerHTML = html;

  // Section line click → add boundary after that line
  container.querySelectorAll('.section-line').forEach(el => {
    el.addEventListener('click', () => {
      const lineIdx = +el.dataset.line;
      const sid = el.dataset.script;
      const script = state.scripts.find(s => s.id === sid);
      if (!script) return;

      // Don't split after the very last line
      if (lineIdx >= script.lines.length - 1) return;

      // Don't add duplicate
      if (script.boundaries.includes(lineIdx)) return;

      // Find which section this line is in, insert role for new section
      const sections = getSections(script);
      const secIdx = sections.findIndex(s => lineIdx >= s.startLine && lineIdx <= s.endLine);

      script.boundaries.push(lineIdx);
      script.boundaries.sort((a, b) => a - b);

      // Insert a new role after the split section; new section gets opposite role
      const currentRole = script.roles[secIdx] || 'THEM';
      script.roles.splice(secIdx + 1, 0, currentRole === 'ME' ? 'THEM' : 'ME');

      saveScripts();
      renderEditor(sid);
    });
  });

  // Divider click → remove boundary
  container.querySelectorAll('.section-divider').forEach(el => {
    el.addEventListener('click', () => {
      const boundaryLine = +el.dataset.boundary;
      const sid = el.dataset.script;
      const script = state.scripts.find(s => s.id === sid);
      if (!script) return;

      const idx = script.boundaries.indexOf(boundaryLine);
      if (idx === -1) return;

      // Find section index of the boundary and merge roles
      const sorted = [...script.boundaries].sort((a, b) => a - b);
      const boundaryIdx = sorted.indexOf(boundaryLine);

      script.boundaries.splice(idx, 1);
      // Remove the role for the section after this boundary
      script.roles.splice(boundaryIdx + 1, 1);

      saveScripts();
      renderEditor(sid);
    });
  });

  // Role button clicks
  container.querySelectorAll('.role-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const sid = btn.dataset.script;
      const secIdx = +btn.dataset.section;
      const role = btn.dataset.role;
      const script = state.scripts.find(s => s.id === sid);
      if (!script) return;

      script.roles[secIdx] = role;
      saveScripts();
      renderEditor(sid);
    });
  });
}

// ── Audition Flow ─────────────────────────────────────────────────────────────
function startAuditionFlow(scriptId) {
  const script = state.scripts.find(s => s.id === scriptId);
  if (!script) return;

  // Show QR screen while peer is being set up
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

    conn.on('open', () => {
      // Send script to reader
      conn.send({ type: 'script', data: script });
    });

    conn.on('data', msg => handleAuditionCommand(msg));
    conn.on('close', () => {
      if (document.getElementById('view-audition').classList.contains('hidden')) return;
      toast('Reader disconnected');
    });
  });
}

function handleAuditionCommand(msg) {
  if (msg.type === 'show_me') {
    showMeText(msg.text);
  } else if (msg.type === 'clear') {
    clearAudition();
  }
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

  textEl.style.fontSize = state.settings.fontSize + 'px';
  textEl.textContent = text;

  blank.style.opacity = '0';
  container.classList.remove('hidden');

  // Reset position
  textEl.style.transform = 'translateY(0)';
  textEl.style.transition = 'none';

  // Start scroll after a short pause
  setTimeout(() => startScrolling(textEl), 500);
}

function clearAudition() {
  stopScrolling();
  const blank = document.getElementById('audition-blank');
  const container = document.getElementById('audition-text-container');
  blank.style.opacity = '1';
  container.classList.add('hidden');
}

function startScrolling(textEl) {
  stopScrolling();
  const rate = state.settings.scrollRate; // px/s
  let startTime = null;
  const startY = 0;
  // Scroll until text top has moved past the top of the viewport + text height
  const maxScroll = textEl.offsetHeight + window.innerHeight;

  function step(ts) {
    if (!startTime) startTime = ts;
    const elapsed = (ts - startTime) / 1000;
    const y = startY - elapsed * rate;
    textEl.style.transform = `translateY(${y}px)`;

    if (-y < maxScroll) {
      state.scrollRaf = requestAnimationFrame(step);
    }
  }

  state.scrollRaf = requestAnimationFrame(step);
}

function stopScrolling() {
  if (state.scrollRaf) {
    cancelAnimationFrame(state.scrollRaf);
    state.scrollRaf = null;
  }
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
    const text = sec.lines.filter(l => l.trim()).join('\n');
    return `<div class="reader-section" data-role="${sec.role}" data-index="${i}" data-section-index="${i}">
              <div class="reader-section-label">${esc(label)}</div>
              <div class="reader-section-text">${esc(text)}</div>
            </div>`;
  }).join('');

  container.querySelectorAll('.reader-section').forEach(el => {
    el.addEventListener('click', () => {
      container.querySelectorAll('.reader-section').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      const role = el.dataset.role;
      const idx = +el.dataset.sectionIndex;
      const text = el.querySelector('.reader-section-text').textContent;

      if (!conn) return; // local reader mode, no peer

      if (role === 'ME') {
        conn.send({ type: 'show_me', text, sectionIndex: idx });
      } else {
        conn.send({ type: 'clear' });
      }
    });
  });

  showView('view-reader');
}

// ── Peer Connection ───────────────────────────────────────────────────────────
function initPeer(onOpen) {
  if (state.peer) {
    try { state.peer.destroy(); } catch {}
  }

  const peer = new Peer({ debug: 0 });
  state.peer = peer;

  peer.on('open', id => {
    state.peerId = id;
    if (onOpen) onOpen(id);
  });

  peer.on('error', err => {
    console.warn('Peer error:', err);
    toast('Connection error: ' + err.type);
  });
}

function generateQR(url) {
  const container = document.getElementById('qr-code');
  container.innerHTML = '';
  new QRCode(container, {
    text: url,
    width: 240,
    height: 240,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

// ── Incoming connection (reader device) ───────────────────────────────────────
function handleIncomingPeer(peerId, scriptId) {
  toast('Connecting to audition device…');
  initPeer(() => {
    const conn = state.readerConn = state.peer.connect(peerId, { reliable: true });

    conn.on('open', () => {
      toast('Connected to audition device');
      document.getElementById('reader-status').className = 'reader-status connected';
      document.getElementById('reader-status').textContent = '●';
    });

    conn.on('data', msg => {
      if (msg.type === 'script') {
        startReaderMode(msg.data, conn);
      }
    });

    conn.on('close', () => {
      toast('Disconnected from audition device');
      document.getElementById('reader-status').className = 'reader-status disconnected';
      document.getElementById('reader-status').textContent = '●';
    });

    conn.on('error', err => {
      toast('Connection error: ' + err);
    });
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
        <button class="note-action-btn edit" title="Edit">&#9998;</button>
        <button class="note-action-btn delete" title="Delete">&#128465;</button>
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
      if (ok) {
        state.notes = state.notes.filter(n => n.id !== id);
        saveNotes();
        renderNotes();
      }
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
    if (existing) {
      existing.text = text;
    } else {
      state.notes.unshift({ id: uid(), text, createdAt: Date.now() });
    }
    saveNotes();
    overlay.remove();
    renderNotes();
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ── Event Bindings ────────────────────────────────────────────────────────────
function bindEvents() {
  // Overlay / panel close
  document.getElementById('overlay').addEventListener('click', closeAllPanels);

  // Hamburger
  document.getElementById('btn-menu').addEventListener('click', () => openPanel('menu-panel'));
  document.getElementById('btn-menu-close').addEventListener('click', closeAllPanels);

  // Settings
  document.getElementById('btn-settings').addEventListener('click', () => {
    renderSettings();
    openPanel('settings-panel');
  });
  document.getElementById('btn-settings-close').addEventListener('click', closeAllPanels);

  // Menu items
  document.getElementById('menu-import').addEventListener('click', () => {
    closeAllPanels();
    initImportView();
    showView('view-import');
  });
  document.getElementById('menu-notes').addEventListener('click', () => {
    closeAllPanels();
    renderNotes();
    showView('view-notes');
  });

  // Home → Import (empty state button)
  document.getElementById('btn-import-empty').addEventListener('click', () => {
    initImportView();
    showView('view-import');
  });

  // Import view
  document.getElementById('btn-import-back').addEventListener('click', () => {
    showView('view-home');
    renderHome();
  });

  document.getElementById('script-name').addEventListener('input', e => {
    state.importData.name = e.target.value;
  });

  document.getElementById('btn-create-script').addEventListener('click', createScript);

  // Editor
  document.getElementById('btn-editor-back').addEventListener('click', () => {
    showView('view-home');
    renderHome();
  });

  document.getElementById('btn-editor-done').addEventListener('click', () => {
    const script = state.scripts.find(s => s.id === state.currentScriptId);
    if (!script) return;
    const sections = getSections(script);
    const allAssigned = sections.every(s => s.role);
    if (!allAssigned) { toast('Assign all sections first'); return; }
    script.complete = true;
    saveScripts();
    toast('Script ready!');
    showView('view-home');
    renderHome();
  });

  // QR view
  document.getElementById('btn-qr-back').addEventListener('click', () => {
    if (state.peer) { try { state.peer.destroy(); } catch {} state.peer = null; }
    showView('view-home');
    renderHome();
  });

  document.getElementById('btn-enter-audition').addEventListener('click', enterAuditionMode);

  // Audition view
  document.getElementById('btn-exit-audition').addEventListener('click', () => {
    stopScrolling();
    clearAudition();
    showView('view-home');
    renderHome();
  });

  // Reader view
  document.getElementById('btn-reader-back').addEventListener('click', () => {
    if (state.readerConn) { try { state.readerConn.close(); } catch {} state.readerConn = null; }
    showView('view-home');
    renderHome();
  });

  // Notes view
  document.getElementById('btn-notes-back').addEventListener('click', () => {
    showView('view-home');
    renderHome();
  });

  document.getElementById('btn-add-note').addEventListener('click', () => openNoteModal(null));
}

// ── Service Worker ────────────────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
  }
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

  // Check for incoming peer connection from QR scan
  const params = new URLSearchParams(window.location.search);
  const incomingPeer = params.get('peer');
  const incomingScript = params.get('script');

  if (incomingPeer) {
    // Clean URL so refresh doesn't reconnect
    window.history.replaceState({}, '', window.location.pathname);
    // Show reader loading screen
    showView('view-reader');
    document.getElementById('reader-title').textContent = 'Connecting…';
    document.getElementById('reader-sections').innerHTML =
      '<div class="empty-notes"><span>&#128279;</span><p>Connecting to audition device…</p></div>';
    handleIncomingPeer(incomingPeer, incomingScript);
    return;
  }

  // Normal home screen
  showView('view-home');
  renderHome();
}

document.addEventListener('DOMContentLoaded', init);
