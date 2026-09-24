'use strict';

// Antall barn som rendres om gangen i store objekter/lister.
const CHUNK = 500;
// Hvor mange nivåer som er åpne når data lastes.
const DEFAULT_OPEN_DEPTH = 1;
// Maks antall søketreff som åpnes i treet.
const MAX_MATCHES = 2000;
// Advarsel før "Åpne alle" dersom treet har flere noder enn dette.
const EXPAND_ALL_WARN = 20000;

const $ = (id) => document.getElementById(id);

const state = {
  data: undefined,
  hasData: false,
  raw: false,
  query: '',
  selected: null,
  vars: loadVars(),
};

// ---------- Hjelpefunksjoner ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function storageGet(store, key) {
  try { return store.getItem(key); } catch { return null; }
}

function storageSet(store, key, value) {
  try { store.setItem(key, value); } catch { /* lagring er valgfritt */ }
}

function loadVars() {
  try { return JSON.parse(storageGet(sessionStorage, 'jsonview.vars') || '{}'); } catch { return {}; }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

// ---------- Faner og meldinger ----------

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  storageSet(localStorage, 'jsonview.tab', name);
}

document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

function showMessage(text, kind = 'error') {
  const box = $('message');
  box.textContent = text;
  box.className = `message ${kind}`;
  box.hidden = false;
}

function clearMessage() {
  $('message').hidden = true;
}

// ---------- Innlasting av data ----------

function describeJsonError(err, text) {
  const msg = err.message;
  const m = /position (\d+)/.exec(msg);
  if (!m || /line \d+/.test(msg)) return msg;
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return `${msg} (linje ${line}, kolonne ${col})`;
}

function parseJson(text) {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (!trimmed) throw new Error('Ingen data å vise.');
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`Ugyldig JSON: ${describeJsonError(e, trimmed)}`);
  }
}

// Tekstfeltet under «Lim inn» holder alltid dataene som tekst, uansett om de kom fra
// innliming, fil eller URL. Teksten lagres i localStorage og er med etter F5.
const pasteInput = $('pasteInput');
const TEXT_KEY = 'jsonview.text';
const NOT_SAVED = '\nFor store til å lagres lokalt, så de blir ikke med etter F5.';

// localStorage har en grense på noen MB per side.
function saveText(text) {
  try {
    if (text) localStorage.setItem(TEXT_KEY, text);
    else localStorage.removeItem(TEXT_KEY);
    return true;
  } catch {
    try { localStorage.removeItem(TEXT_KEY); } catch { /* ignorer */ }
    return false;
  }
}

function setText(text) {
  if (pasteInput.value !== text) pasteInput.value = text;
  return saveText(text);
}

// Viser teksten i treet og legger den i tekstfeltet. format: true formaterer teksten først (fil og URL).
function loadText(text, source, { format = false } = {}) {
  let data;
  try {
    data = parseJson(text);
  } catch (e) {
    showMessage(e.message);
    return false;
  }
  const saved = setText(format ? JSON.stringify(data, null, 2) : text);
  setData(data);
  showMessage(`${source} lastet (${formatBytes(new Blob([text]).size)})${saved ? '' : NOT_SAVED}`, 'ok');
  return true;
}

// keepView: true beholder åpne noder og valgt node (brukes når teksten redigeres).
function setData(data, { keepView = false } = {}) {
  const keep = keepView ? openPaths() : null;
  const selectedPath = keepView && state.selected ? pathKey(state.selected._path) : null;
  state.data = data;
  state.hasData = data !== undefined;
  select(null);
  render(keep);
  if (selectedPath) {
    const li = [...viewer.querySelectorAll('li')].find((n) => n._path && pathKey(n._path) === selectedPath);
    if (li) select(li);
  }
}

function openPaths() {
  const set = new Set();
  viewer.querySelectorAll('li.open').forEach((li) => set.add(pathKey(li._path)));
  return set;
}

function restoreText() {
  try { localStorage.removeItem('jsonview.data'); } catch { /* gammel lagringsnøkkel */ }
  const saved = storageGet(localStorage, TEXT_KEY);
  if (!saved) return;
  pasteInput.value = saved;
  try {
    setData(parseJson(saved));
  } catch { /* teksten kan være ugyldig JSON under redigering */ }
}

// ---------- Visning ----------

const viewer = $('viewer');

function render(keep = null) {
  viewer.textContent = '';
  $('matchCount').textContent = '';
  if (!state.hasData) {
    viewer.append(el('div', 'empty', 'Ingen data ennå. Lim inn JSON, slipp en fil eller hent fra en URL.'));
    return;
  }
  if (state.raw) {
    viewer.append(el('pre', 'raw', JSON.stringify(state.data, null, 2)));
    return;
  }
  const ctx = { query: state.query.toLowerCase(), open: null, keep };
  if (ctx.query) {
    const { open, count } = findMatches(state.data, ctx.query);
    ctx.open = open;
    $('matchCount').textContent = count >= MAX_MATCHES ? `${MAX_MATCHES}+ treff` : `${count} treff`;
  }
  const tree = el('ul', 'tree');
  tree.append(createNode(undefined, state.data, [], ctx, 0));
  viewer.append(tree);
}

function pathKey(path) {
  return JSON.stringify(path);
}

function isContainer(value) {
  return value !== null && typeof value === 'object';
}

function entriesOf(value) {
  return Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value);
}

function sizeOf(value) {
  return Array.isArray(value) ? value.length : Object.keys(value).length;
}

// Finner søketreff og returnerer stiene som må åpnes for å vise dem.
function findMatches(data, q) {
  const open = new Set();
  let count = 0;
  const walk = (key, value, path) => {
    if (count >= MAX_MATCHES) return;
    const keyHit = key !== undefined && String(key).toLowerCase().includes(q);
    const valueHit = !isContainer(value) && String(value).toLowerCase().includes(q);
    if (keyHit || valueHit) {
      count++;
      for (let i = 0; i < path.length; i++) open.add(pathKey(path.slice(0, i)));
    }
    if (isContainer(value)) {
      for (const [k, v] of entriesOf(value)) walk(k, v, path.concat([k]));
    }
  };
  walk(undefined, data, []);
  return { open, count };
}

function setHighlighted(node, text, q) {
  if (!q) {
    node.textContent = text;
    return;
  }
  const lower = text.toLowerCase();
  let pos = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    if (idx > pos) node.append(text.slice(pos, idx));
    node.append(el('mark', null, text.slice(idx, idx + q.length)));
    pos = idx + q.length;
    idx = lower.indexOf(q, pos);
  }
  if (pos < text.length) node.append(text.slice(pos));
}

function valueSpan(value, q) {
  const type = value === null ? 'null' : typeof value;
  const span = el('span', `v-${type}`);
  setHighlighted(span, type === 'string' ? JSON.stringify(value) : String(value), q);
  return span;
}

function createNode(key, value, path, ctx, depth) {
  const li = el('li');
  li._value = value;
  li._path = path;
  li._ctx = ctx;

  const container = isContainer(value);
  const size = container ? sizeOf(value) : 0;
  const expandable = container && size > 0;
  const row = el('div', expandable ? 'node-row expandable' : 'node-row');
  row.append(el('span', expandable ? 'toggle' : 'toggle leaf', expandable ? '▶' : ''));

  if (key !== undefined) {
    const k = el('span', typeof key === 'number' ? 'key index' : 'key');
    setHighlighted(k, String(key), ctx.query);
    row.append(k, el('span', 'colon', ':'));
  }

  if (container) {
    const isArr = Array.isArray(value);
    const label = size === 0 ? (isArr ? '[]' : '{}') : isArr ? `[${size}]` : `{${size}}`;
    row.append(el('span', 'summary', label));
  } else {
    row.append(valueSpan(value, ctx.query));
  }
  li.append(row);

  if (expandable) {
    const set = ctx.open || ctx.keep;
    const open = depth === 0 || (set ? set.has(pathKey(path)) : depth < DEFAULT_OPEN_DEPTH);
    if (open) expandNode(li);
  }
  return li;
}

function expandNode(li) {
  if (!li._rendered) renderChildren(li);
  li.classList.add('open');
}

function toggleNode(li) {
  if (!isContainer(li._value) || sizeOf(li._value) === 0) return;
  if (li.classList.contains('open')) li.classList.remove('open');
  else expandNode(li);
}

function renderChildren(li) {
  const ctx = li._ctx;
  const ul = el('ul');
  const entries = entriesOf(li._value);
  const depth = li._path.length + 1;
  // Ved søk vises alle barn til en åpnet node, slik at treff ikke skjules bak "Vis flere".
  const limit = ctx.open && ctx.open.has(pathKey(li._path)) ? entries.length : CHUNK;

  const renderFrom = (start, max) => {
    const end = Math.min(entries.length, start + max);
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const [k, v] = entries[i];
      frag.append(createNode(k, v, li._path.concat([k]), ctx, depth));
    }
    if (end < entries.length) {
      const moreLi = el('li');
      const btn = el('button', 'more', `Vis flere (${entries.length - end} gjenstår)`);
      btn.addEventListener('click', () => {
        moreLi.remove();
        renderFrom(end, CHUNK);
      });
      moreLi.append(btn);
      frag.append(moreLi);
    }
    ul.append(frag);
  };

  renderFrom(0, limit);
  li.append(ul);
  li._rendered = true;
}

function rootNode() {
  return viewer.querySelector('.tree > li');
}

function countNodes(value) {
  let n = 0;
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    n++;
    if (isContainer(v)) for (const [, c] of entriesOf(v)) stack.push(c);
  }
  return n;
}

function expandAll() {
  const root = rootNode();
  if (!root) return;
  const total = countNodes(state.data);
  if (total > EXPAND_ALL_WARN && !confirm(`Dataene har ${total.toLocaleString('no')} noder. Å åpne alle kan gjøre siden treg. Fortsette?`)) return;
  const stack = [root];
  while (stack.length) {
    const li = stack.pop();
    if (!isContainer(li._value) || sizeOf(li._value) === 0) continue;
    expandNode(li);
    for (const child of li.lastElementChild.children) {
      if (child._path) stack.push(child);
    }
  }
}

function collapseAll() {
  const root = rootNode();
  if (!root) return;
  root.querySelectorAll('li.open').forEach((li) => { if (li !== root) li.classList.remove('open'); });
}

// ---------- Valg og statuslinje ----------

function formatPath(path) {
  return '/' + path.map(String).join('/');
}

function select(li) {
  if (state.selected) state.selected.firstElementChild.classList.remove('selected');
  state.selected = li;
  if (li) li.firstElementChild.classList.add('selected');
  $('pathLabel').textContent = li ? formatPath(li._path) : ' ';
  $('copyPath').disabled = !li;
  $('copyValue').disabled = !li;
}

viewer.addEventListener('click', (e) => {
  const row = e.target.closest('.node-row');
  if (!row) return;
  const li = row.parentElement;
  // Klikk hvor som helst på raden (pil, nøkkel eller antall) åpner/lukker objekter og lister.
  toggleNode(li);
  select(li);
});

$('copyPath').addEventListener('click', () => state.selected && copyText(formatPath(state.selected._path)));
$('copyValue').addEventListener('click', () => state.selected && copyText(JSON.stringify(state.selected._value, null, 2)));
$('expandAll').addEventListener('click', expandAll);
$('collapseAll').addEventListener('click', collapseAll);

$('rawToggle').addEventListener('click', () => {
  state.raw = !state.raw;
  $('rawToggle').classList.toggle('active', state.raw);
  $('expandAll').disabled = state.raw;
  $('collapseAll').disabled = state.raw;
  $('searchInput').disabled = state.raw;
  select(null);
  render();
});

let searchTimer;
$('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    select(null);
    render();
  }, 200);
});

// ---------- Lim inn ----------

$('pasteView').addEventListener('click', () => loadText(pasteInput.value, 'Tekst'));
$('pasteClear').addEventListener('click', () => {
  setText('');
  setData(undefined);
  clearMessage();
  pasteInput.focus();
});
$('pasteFormat').addEventListener('click', () => {
  try {
    const saved = setText(JSON.stringify(parseJson(pasteInput.value), null, 2));
    if (saved) clearMessage();
    else showMessage(NOT_SAVED.trim());
  } catch (e) {
    showMessage(e.message);
  }
});

// Når teksten endres (skriving eller innliming) oppdateres visningen og teksten lagres.
// Ved ugyldig JSON står forrige gyldige visning igjen, og feilen vises.
let editTimer;
pasteInput.addEventListener('input', () => {
  clearTimeout(editTimer);
  editTimer = setTimeout(() => {
    const text = pasteInput.value;
    const saved = saveText(text);
    if (!text.trim()) {
      setData(undefined);
      clearMessage();
      return;
    }
    try {
      setData(parseJson(text), { keepView: true });
      if (saved) clearMessage();
      else showMessage(NOT_SAVED.trim());
    } catch (e) {
      showMessage(e.message);
    }
  }, 300);
});
pasteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    loadText(pasteInput.value, 'Tekst');
  }
});

// ---------- Fil og drag-and-drop ----------

async function loadFile(file) {
  if (!file) return;
  try {
    loadText(await file.text(), file.name, { format: true });
  } catch (e) {
    showMessage(`Kunne ikke lese filen: ${e.message}`);
  }
}

$('fileInput').addEventListener('change', (e) => {
  loadFile(e.target.files[0]);
  e.target.value = '';
});

const overlay = $('dropOverlay');
const dropZone = $('dropZone');
let dragDepth = 0;

const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  overlay.hidden = false;
  dropZone.classList.add('over');
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    overlay.hidden = true;
    dropZone.classList.remove('over');
  }
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  dropZone.classList.remove('over');
  loadFile(e.dataTransfer.files[0]);
});

// ---------- URL / curl ----------

const urlInput = $('urlInput');
const methodInput = $('methodInput');
const headersInput = $('headersInput');
const bodyInput = $('bodyInput');

// Deler opp en shell-kommando i argumenter (bash-, cmd- og PowerShell-linjeskift).
function tokenize(cmd) {
  cmd = cmd.replace(/[\\^`]\r?\n/g, ' ');
  const tokens = [];
  let cur = '';
  let quote = null;
  let has = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && '"\\$`'.includes(cmd[i + 1] ?? '')) cur += cmd[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (has) tokens.push(cur);
      cur = '';
      has = false;
    } else if (c === '\\' && i + 1 < cmd.length) {
      cur += cmd[++i];
      has = true;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) tokens.push(cur);
  return tokens;
}

// Flagg som tar en verdi, men som ikke er relevante i nettleseren.
const IGNORED_VALUE_FLAGS = new Set([
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '-e', '--referer',
  '-x', '--proxy', '-A', '--user-agent', '-b', '--cookie', '-c', '--cookie-jar', '--retry', '-r', '--range',
]);

function parseCurl(text) {
  const tokens = tokenize(text.trim());
  const req = { url: '', method: '', headers: [], body: null };
  const addBody = (v) => { req.body = req.body === null ? v : `${req.body}&${v}`; };
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    let flag = t;
    let inline = null;
    if (t.startsWith('--') && t.includes('=')) {
      flag = t.slice(0, t.indexOf('='));
      inline = t.slice(t.indexOf('=') + 1);
    }
    const val = () => (inline !== null ? inline : tokens[++i] ?? '');
    switch (flag) {
      case '-X': case '--request': req.method = val().toUpperCase(); break;
      case '-H': case '--header': req.headers.push(val()); break;
      case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii': addBody(val()); break;
      case '--json':
        addBody(val());
        req.headers.push('Content-Type: application/json', 'Accept: application/json');
        break;
      case '-u': case '--user': req.headers.push(`Authorization: Basic ${btoa(val())}`); break;
      case '--url': req.url = val(); break;
      default:
        if (IGNORED_VALUE_FLAGS.has(flag)) val();
        else if (/^-X[A-Za-z]+$/.test(t)) req.method = t.slice(2).toUpperCase();
        else if (!t.startsWith('-') && !req.url) req.url = t;
    }
  }
  if (!req.method) req.method = req.body !== null ? 'POST' : 'GET';
  return req;
}

const isCurl = (text) => /^\s*curl(\.exe)?\s/i.test(text);

function applyCurl() {
  if (!isCurl(urlInput.value)) return;
  const req = parseCurl(urlInput.value);
  if (![...methodInput.options].some((o) => o.value === req.method)) methodInput.append(el('option', null, req.method));
  methodInput.value = req.method;
  headersInput.value = req.headers.join('\n');
  bodyInput.value = req.body ?? '';
  updateBodyField();
}

function updateBodyField() {
  $('bodyField').hidden = methodInput.value === 'GET' && !bodyInput.value;
}

// Plassholdere: %navn% (minst 4 tegn, for å ikke forveksle med URL-koding) eller {{navn}}.
const PLACEHOLDER_RE = /%([A-Za-z_][\w.-]{3,})%|\{\{\s*([\w.-]+)\s*\}\}/g;

function placeholderNames() {
  const text = [urlInput.value, headersInput.value, bodyInput.value].join('\n');
  const names = new Set();
  for (const m of text.matchAll(PLACEHOLDER_RE)) names.add(m[1] || m[2]);
  return [...names];
}

function substitute(text) {
  return text.replace(PLACEHOLDER_RE, (all, a, b) => state.vars[a || b] ?? all);
}

function saveVars() {
  storageSet(sessionStorage, 'jsonview.vars', JSON.stringify(state.vars));
}

// Skjuler verdien, men viser den mens feltet er i fokus.
function maskWhenBlurred(input) {
  input.addEventListener('focus', () => { input.type = 'text'; });
  input.addEventListener('blur', () => { input.type = 'password'; });
}

// %token% har et fast felt; andre plassholdere får egne felt her.
const TOKEN_VAR = 'token';

function renderPlaceholders() {
  const box = $('placeholders');
  const names = placeholderNames().filter((n) => n !== TOKEN_VAR);
  const current = [...box.querySelectorAll('input')].map((i) => i.dataset.name);
  if (names.join('\n') === current.join('\n')) return;
  box.textContent = '';
  for (const name of names) {
    const label = el('label', 'field');
    label.append(el('span', null, `Verdi for ${name}`));
    const input = el('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.name = name;
    input.value = state.vars[name] ?? '';
    input.placeholder = 'Lagres kun i denne fanen';
    input.addEventListener('input', () => {
      state.vars[name] = input.value;
      saveVars();
    });
    maskWhenBlurred(input);
    label.append(input);
    box.append(label);
  }
}

function parseHeaders(text) {
  const headers = new Headers();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) throw new Error(`Ugyldig header: "${line.trim()}"`);
    headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  return headers;
}

// Firebase Realtime Database krever ".json" på slutten av stien i REST-API-et.
function fixFirebaseUrl(url) {
  if (!/\.(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname)) return false;
  if (url.pathname.endsWith('.json')) return false;
  url.pathname = url.pathname.replace(/\/$/, '') + '.json';
  return true;
}

async function doFetch() {
  const source = isCurl(urlInput.value) ? parseCurl(urlInput.value).url : urlInput.value.trim();
  if (!source) {
    showMessage('Skriv inn en URL eller curl-kommando.');
    return;
  }
  const missing = placeholderNames().filter((n) => !state.vars[n]);
  if (missing.length) {
    showMessage(`Mangler verdi for: ${missing.join(', ')}`);
    return;
  }

  let url;
  let headers;
  try {
    url = new URL(substitute(source));
    headers = parseHeaders(substitute(headersInput.value));
  } catch (e) {
    showMessage(e instanceof TypeError ? `Ugyldig URL: ${substitute(source)}` : e.message);
    return;
  }
  const addedJson = fixFirebaseUrl(url);

  const method = methodInput.value;
  const opts = { method, headers };
  if (bodyInput.value && method !== 'GET' && method !== 'HEAD') opts.body = substitute(bodyInput.value);

  const btn = $('fetchBtn');
  btn.disabled = true;
  btn.textContent = 'Henter…';
  const started = performance.now();
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    const info = `${res.status} ${res.statusText} · ${ms} ms · ${formatBytes(new Blob([text]).size)}`;
    let data;
    try {
      data = parseJson(text);
    } catch (e) {
      showMessage(`${info}\n${res.ok ? e.message : text.slice(0, 500)}`);
      return;
    }
    const saved = setText(JSON.stringify(data, null, 2));
    setData(data);
    const note = (addedJson ? '\nLa til ".json" på slutten av Firebase-URL-en.' : '') + (saved ? '' : NOT_SAVED);
    showMessage(`${info}${note}`, res.ok ? 'ok' : 'error');
  } catch (e) {
    showMessage(`Kunne ikke hente: ${e.message}\nMulige årsaker: nettverksfeil, eller at serveren ikke tillater forespørsler fra nettleseren (CORS).`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Hent';
  }
}

urlInput.addEventListener('input', () => {
  applyCurl();
  renderPlaceholders();
  storageSet(localStorage, 'jsonview.url', urlInput.value);
});
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    doFetch();
  }
});
headersInput.addEventListener('input', renderPlaceholders);
bodyInput.addEventListener('input', renderPlaceholders);
methodInput.addEventListener('change', updateBodyField);
$('fetchBtn').addEventListener('click', doFetch);

const tokenInput = $('tokenInput');
tokenInput.value = state.vars[TOKEN_VAR] ?? '';
tokenInput.addEventListener('input', () => {
  state.vars[TOKEN_VAR] = tokenInput.value;
  saveVars();
});
tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doFetch();
});
maskWhenBlurred(tokenInput);

// ---------- Oppstart ----------

urlInput.value = storageGet(localStorage, 'jsonview.url') || '';
applyCurl();
renderPlaceholders();
updateBodyField();
restoreText();
showTab(storageGet(localStorage, 'jsonview.tab') || 'paste');
