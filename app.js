'use strict';
/* app.js: CSV URL Fetcher. Load a CSV, fill a URL template like https://example.com/{id}/{name}/get from each row,
   GET it, one card per response.
   Data: IndexedDB stores `runs` (settings + queued items) and `results` (one record per response, id = runId:index);
   kv keeps the loaded CSV, the options and the last opened run. */
const DEFAULT_OPTS = { template: '', header: true, encode: true, skipEmpty: true, dedupe: false, concurrency: 4, timeout: 15,
  proxyUrl: '', proxyKey: '', proxyMode: 'blocked' }; // proxyMode: off | blocked (only CORS/http-blocked rows) | always
const BATCH = 60; // cards rendered per batch; more load while scrolling
const state = { csv: null, opts: { ...DEFAULT_OPTS }, run: null, results: new Map(), filter: 'all', q: '', persisted: null, exporting: false };
let view = null; // live DOM refs of the Fetch tab, rebuilt on every render

const pad = (n, w = 6) => String(n).padStart(w, '0');
const resultKey = (runId, i) => `${runId}:${pad(i)}`;
const safeName = (s) => (s || 'empty').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'value';
const fileBase = (it) => `row${it.row}_${safeName(it.value)}`;
const LS_TEMPLATE = APP_SLUG + '-url-template';
const PH = /\{([^{}]+)\}/g; // {column name} or {column number}

/* ---------- CSV + queue ---------- */
function columnNames(csv = state.csv, header = state.opts.header) {
  if (!csv) return [];
  const width = csv.rows.reduce((m, r) => Math.max(m, r.length), 0);
  return Array.from({ length: width }, (_, j) => (header && csv.rows[0] && String(csv.rows[0][j] ?? '').trim()) || `Column ${j + 1}`);
}
const dataRows = () => !state.csv ? [] : state.opts.header ? state.csv.rows.slice(1) : state.csv.rows;

// Placeholder -> column index: exact header name (case-insensitive), else a 1-based column number. -1 if neither.
function resolveCol(key, names) {
  const k = key.trim().toLowerCase();
  const j = names.findIndex(n => n.toLowerCase() === k);
  if (j >= 0) return j;
  return /^\d+$/.test(k) && +k >= 1 && +k <= names.length ? +k - 1 : -1;
}
// Columns the template uses (in order of first use) and placeholders that match no column.
function templateCols(t = state.opts.template, names = columnNames()) {
  const used = [], unknown = [];
  for (const m of t.matchAll(PH)) {
    const j = resolveCol(m[1], names);
    if (j < 0) { if (!unknown.includes(m[1])) unknown.push(m[1]); } else if (!used.includes(j)) used.push(j);
  }
  return { used, unknown };
}

function buildItems(o = state.opts) {
  const names = columnNames(), t = o.template.trim();
  const { used } = templateCols(t, names);
  if (!used.length) return [];
  const items = [], seen = new Set();
  dataRows().forEach((r, idx) => {
    const cell = (j) => String(r[j] ?? '').trim();
    const values = used.map(cell);
    if (o.skipEmpty && values.some(v => !v)) return;
    const url = t.replace(PH, (m, key) => { const j = resolveCol(key, names); return j < 0 ? m : o.encode ? encodeURIComponent(cell(j)) : cell(j); });
    if (o.dedupe) { if (seen.has(url)) return; seen.add(url); }
    items.push({ i: items.length, row: idx + 1, value: values.join(' · '), values, url });
  });
  return items;
}

async function loadCsvFile(file) {
  if (!file) return;
  let text = await file.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const res = Papa.parse(text, { skipEmptyLines: 'greedy' }); // quotes, commas in quotes, CRLF/LF auto-detected
  if (!res.data.length) { toast('That file has no rows'); return; }
  state.csv = { name: file.name || 'pasted.csv', rows: res.data, warnings: res.errors.length };
  await DB.put('kv', state.csv, 'csv');
  await saveOpts();
  toast(`Loaded ${dataRows().length} rows`);
  Tabs.refresh();
}

// Bundled sample: httpbin.org paths covering every card type. Values are paths, so encoding is turned off.
async function loadSample() {
  const res = await fetch('sample.csv');
  if (!res.ok) { toast('Sample not available'); return; }
  Object.assign(state.opts, { template: 'https://httpbin.org/{endpoint}', header: true, encode: false, skipEmpty: true, dedupe: false });
  await loadCsvFile(new File([await res.blob()], 'sample.csv', { type: 'text/csv' }));
}

async function saveOpts() {
  try { localStorage.setItem(LS_TEMPLATE, state.opts.template); } catch (e) {}
  await DB.put('kv', state.opts, 'opts');
}

/* ---------- results ---------- */
const isFail = (r) => !!r && r.state === 'done' && (!!r.error || r.status >= 400);
const isOk = (r) => !!r && r.state === 'done' && !r.error && r.status < 400;
function counts() {
  const c = { done: 0, pending: 0, success: 0, client: 0, server: 0, network: 0, total: state.run ? state.run.items.length : 0 };
  for (const r of state.results.values()) {
    if (r.state === 'pending') { c.pending++; continue; }
    c.done++;
    if (r.error) c.network++; else if (r.status >= 500) c.server++; else if (r.status >= 400) c.client++; else c.success++;
  }
  c.notRun = c.total - c.done - c.pending;
  return c;
}
const retryable = () => state.run ? state.run.items.filter(it => { const r = state.results.get(it.i); return !r || isFail(r); }) : [];

async function openRun(run) {
  state.run = run;
  state.results = new Map();
  if (run) {
    const recs = await DB.run('results', 'readonly', st => st.getAll(IDBKeyRange.bound(run.id + ':', run.id + ':￿')));
    for (const r of recs) state.results.set(r.i, r);
    await DB.put('kv', run.id, 'lastRun');
  }
}

/* ---------- proxy ---------- */
function proxyConfig() {
  const o = state.opts, url = (o.proxyUrl || '').trim();
  return o.proxyMode !== 'off' && url && o.proxyKey ? { url, key: o.proxyKey } : null;
}
// Direct first; rows the browser blocks (CORS, http from https) go again through the proxy when one is set up.
async function fetchRow(url, opts) {
  const proxy = proxyConfig();
  if (proxy && state.opts.proxyMode === 'always') return Fetcher.get(url, { ...opts, proxy });
  const r = await Fetcher.get(url, opts);
  if (proxy && r.error && ['cors', 'insecure'].includes(r.error.kind) && !(opts.signal && opts.signal.aborted)) return Fetcher.get(url, { ...opts, proxy });
  return r;
}

async function start(items, retry) {
  if (Runner.running || !items.length) return;
  const o = state.opts;
  if (!retry) {
    const names = columnNames();
    const run = { id: uid(), created: Date.now(), template: o.template.trim(), csvName: state.csv.name,
      columns: templateCols(o.template, names).used.map(j => names[j]), opts: { ...o }, items };
    await DB.put('runs', run);
    await openRun(run);
    view && (view.setup.open = false);
    Tabs.refresh();
  } else {
    for (const it of items) state.results.delete(it.i);
    paintCards();
  }
  const run = state.run;
  run.finished = null;
  updateSummary();
  const stopped = await Runner.run(items, {
    concurrency: Math.min(10, Math.max(1, o.concurrency | 0)), timeoutMs: Math.max(1, +o.timeout || 15) * 1000, fetch: fetchRow,
    onStart: (it) => { state.results.set(it.i, { state: 'pending' }); placeCard(it); scheduleSummary(); },
    onDone: (it, r) => {
      const rec = { id: resultKey(run.id, it.i), runId: run.id, i: it.i, state: 'done', at: Date.now(), ...r };
      if (state.run === run) { state.results.set(it.i, rec); placeCard(it); scheduleSummary(); }
      return DB.put('results', rec).catch(e => console.warn('save failed', e));
    },
  });
  run.finished = Date.now();
  run.counts = counts();
  await DB.put('runs', run);
  updateSummary();
  toast(stopped ? 'Stopped' : 'Done');
}

/* ---------- cards ---------- */
function badge(r) {
  if (!r || r.state === 'pending') return h('span', { class: 'badge pending' }, h('span', { class: 'spin' }), 'Waiting');
  if (r.error) return h('span', { class: 'badge net' }, r.error.kind === 'cors' ? 'BLOCKED by CORS' : Errors.network(r.error.kind).title);
  const cls = r.status >= 400 ? 'bad' : r.status >= 300 ? 'warn' : 'ok';
  return h('span', { class: 'badge ' + cls }, `${r.status} ${r.reason || Errors.reason(r.status)}`.trim());
}

function explain(r) {
  const e = r.error ? Errors.network(r.error.kind) : Errors.status(r.status);
  const title = r.error ? e.title : `${r.status} ${r.reason || Errors.reason(r.status)}`.trim();
  return h('div', { class: 'explain' + (r.error ? ' net' : '') },
    h('div', { class: 'ex-title' }, title),
    e.text ? h('div', null, e.text) : null,
    e.fix ? h('div', null, h('b', null, 'Try: '), e.fix) : null,
    r.retryAfter ? h('div', null, h('b', null, 'Retry-After: '), r.retryAfter) : (r.status === 429 || r.status === 503 ? h('div', { class: 'muted small' }, 'No Retry-After header was readable.') : null),
    r.error && r.error.message && r.error.kind !== 'stopped' ? h('div', { class: 'muted small' }, 'Browser said: ' + r.error.message) : null);
}

// The app may not read a CORS-blocked response, but the browser may still show it, like tapping the link.
// sandbox="" = no scripts, no forms, no access to this app; lazy so a long list does not load them all at once.
function corsFrame(it) {
  return h('div', { class: 'resp' },
    h('div', { class: 'muted small' }, 'Shown the way your browser opens it: the app cannot read the status, copy or export it.'),
    h('iframe', { class: 'preview', src: it.url, sandbox: '', loading: 'lazy', referrerpolicy: 'no-referrer', title: 'Response for row ' + it.row }));
}

function card(it) {
  const r = state.results.get(it.i);
  const done = r && r.state === 'done';
  const meta = [];
  if (done) {
    meta.push(`${r.ms} ms`);
    if (!r.error) meta.push(Render.fmtSize(r.size) + (r.truncated ? ' (cut)' : ''));
    if (!r.error && r.ct) meta.push(Render.mimeOf(r.ct));
    if (r.via === 'proxy') meta.push('via proxy');
  }
  return h('article', { class: 'card rcard', 'data-i': it.i },
    h('div', { class: 'rhead' },
      h('span', { class: 'rownum' }, '#' + it.row),
      h('h3', { class: 'val' }, it.value || h('span', { class: 'muted' }, '(empty)')),
      badge(r)),
    h('a', { class: 'url', href: it.url, target: '_blank', rel: 'noopener noreferrer' }, it.url),
    done && r.redirected && r.finalUrl && r.finalUrl !== it.url ? h('div', { class: 'muted small url' }, 'Redirected to ' + r.finalUrl) : null,
    meta.length ? h('div', { class: 'meta muted small' }, meta.join(' · ')) : null,
    !done ? h('div', { class: 'pending-body' }, h('span', { class: 'spin big' }), 'Waiting for response…') : null,
    done && isFail(r) ? explain(r) : null,
    done && r.error && r.error.kind === 'cors' ? corsFrame(it) : null,
    done && r.body && (r.body.size || !isFail(r)) ? Render.body(r, fileBase(it)) : null);
}

function matches(it) {
  const r = state.results.get(it.i);
  if (!r) return false; // cards appear when their request starts
  if (state.filter === 'success' && !isOk(r)) return false;
  if (state.filter === 'errors' && !isFail(r)) return false;
  const q = state.q.trim().toLowerCase();
  return !q || it.value.toLowerCase().includes(q) || it.url.toLowerCase().includes(q);
}

// Insert, update or remove one card, keeping CSV order. Only the first `limit` matching cards are in the DOM.
function placeCard(it) {
  if (!view) return;
  const old = view.rendered.get(it.i);
  if (!matches(it)) { if (old) { old.remove(); view.rendered.delete(it.i); } updateEmpty(); return; }
  if (old) { const el = card(it); old.replaceWith(el); view.rendered.set(it.i, el); return; }
  const keys = [...view.rendered.keys()];
  const maxKey = keys.length ? Math.max(...keys) : -1;
  if (view.rendered.size >= view.limit && it.i > maxKey) { updateSentinel(); return; }
  const el = card(it);
  const after = keys.filter(k => k > it.i);
  if (after.length) view.cards.insertBefore(el, view.rendered.get(Math.min(...after)));
  else view.cards.append(el);
  view.rendered.set(it.i, el);
  updateEmpty();
}

function paintCards() {
  if (!view) return;
  view.cards.replaceChildren();
  view.rendered.clear();
  view.limit = BATCH;
  loadMore(true);
}
function loadMore(first) {
  if (!view || !state.run) return;
  if (!first) view.limit += BATCH;
  const keys = [...view.rendered.keys()];
  const maxKey = keys.length ? Math.max(...keys) : -1;
  const frag = document.createDocumentFragment();
  for (const it of state.run.items) {
    if (view.rendered.size >= view.limit) break;
    if (it.i <= maxKey || !matches(it)) continue;
    const el = card(it); frag.append(el); view.rendered.set(it.i, el);
  }
  view.cards.append(frag);
  updateSentinel(); updateEmpty();
}
function hiddenCount() {
  if (!view || !state.run) return 0;
  let n = 0; for (const it of state.run.items) if (matches(it)) n++;
  return n - view.rendered.size;
}
function updateSentinel() {
  if (!view) return;
  const n = hiddenCount();
  view.sentinel.hidden = n <= 0;
  view.moreBtn.textContent = `Show ${Math.min(n, BATCH)} more (${n} not shown)`;
}
function updateEmpty() {
  if (!view) return;
  const c = state.run ? counts() : null;
  view.empty.hidden = view.rendered.size > 0;
  view.empty.textContent = !state.run ? 'Load a CSV, write the URL template and press Run. Each response gets its own box here.'
    : c.done + c.pending === 0 ? 'No requests have run yet.' : 'No boxes match the filter or search.';
}

/* ---------- summary ---------- */
let summaryTimer = null;
function scheduleSummary() { if (!summaryTimer) summaryTimer = setTimeout(() => { summaryTimer = null; updateSummary(); }, 120); }
function updateSummary() {
  if (!view) return;
  const run = state.run, c = counts();
  view.summary.hidden = !run;
  const running = Runner.running;
  view.runBtn.disabled = running || !canRun();
  view.stopBtn.disabled = !running;
  const retryN = retryable().length;
  view.retryBtn.disabled = running || !retryN;
  view.retryBtn.textContent = retryN && !running ? `Retry failed (${retryN})` : 'Retry failed';
  if (!run) return;
  const pct = c.total ? Math.round(100 * c.done / c.total) : 0;
  view.bar.style.width = pct + '%';
  view.progress.textContent = `${c.done} / ${c.total} done` + (c.pending ? ` · ${c.pending} in flight` : '') + (!running && c.notRun > 0 ? ` · ${c.notRun} not run` : '');
  view.count.success.textContent = c.success; view.count.client.textContent = c.client;
  view.count.server.textContent = c.server; view.count.network.textContent = c.network;
  view.exportBtn.disabled = running || !c.done || state.exporting;
  view.runInfo.textContent = `${run.csvName} · ${runTemplate(run)} · ${new Date(run.created).toLocaleString()}`;
  updateSentinel(); updateEmpty();
}

/* ---------- export (zip, only on request) ---------- */
function csvCell(v) { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
async function exportZip() {
  const run = state.run;
  if (!run || state.exporting) return;
  state.exporting = true; updateSummary();
  const label = view.exportBtn.textContent;
  view.exportBtn.textContent = 'Zipping…';
  try {
    // With several template columns, each gets its own CSV column after the combined value.
    const cols = run.columns && run.columns.length > 1 ? run.columns : [];
    const files = [], lines = [['row', 'value', ...cols, 'url', 'status', 'time_ms', 'content_type', 'error_reason', 'final_url', 'size_bytes', 'body_file', 'via'].join(',')];
    for (const it of run.items) {
      const r = state.results.get(it.i);
      let reason = '', file = '';
      if (!r || r.state !== 'done') reason = 'Not run';
      else if (r.error) reason = r.error.kind === 'cors' ? 'BLOCKED by CORS' : Errors.network(r.error.kind).title;
      else if (r.status >= 400) reason = `${r.status} ${r.reason || Errors.reason(r.status)}`.trim();
      if (r && r.body && r.body.size) {
        let mime = Render.mimeOf(r.ct), kind = 'binary';
        if (!Render.EXT[mime]) { const info = await Render.detect(r); kind = info.kind; mime = info.mime || mime; }
        file = 'responses/' + Render.fileName(`${pad(it.row, 4)}_${safeName(it.value)}`, mime, kind);
        files.push({ name: file, data: r.body });
      }
      const ok = r && r.state === 'done';
      lines.push([it.row, it.value, ...cols.map((_, k) => (it.values || [])[k] ?? ''), it.url, ok && !r.error ? r.status : '', ok ? r.ms : '', ok && !r.error ? Render.mimeOf(r.ct) : '', reason, ok && !r.error ? r.finalUrl : '', ok && !r.error ? r.size : '', file, ok ? r.via || 'direct' : ''].map(csvCell).join(','));
    }
    files.unshift({ name: 'results.csv', data: '﻿' + lines.join('\r\n') + '\r\n' });
    const blob = await Zip.make(files);
    offerFile(blob, `${safeName(run.csvName.replace(/\.csv$/i, ''))}-results-${stamp()}.zip`);
  } catch (e) { toast('Export failed: ' + e.message); }
  finally { state.exporting = false; if (view) view.exportBtn.textContent = label; updateSummary(); }
}

/* ---------- Fetch tab ---------- */
function canRun() { return !!(state.csv && buildItems().length); }
const runTemplate = (run) => run.template || (run.base || '') + (run.column ? `{${run.column}}` : '');

function checkbox(key, label, hint) {
  const cb = h('input', { type: 'checkbox', checked: !!state.opts[key] });
  cb.addEventListener('change', () => { state.opts[key] = cb.checked; saveOpts(); onSetupChange(key); });
  return h('label', { class: 'check opt' }, cb, h('span', { class: 'txt' }, label, hint ? h('span', { class: 'muted small' }, hint) : null));
}

function renderSetup() {
  const o = state.opts;
  // A wrapping textarea so long templates stay readable on a phone; line breaks are never part of a URL.
  const tpl = h('textarea', { class: 'tpl', rows: 2, inputmode: 'url', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off',
    placeholder: 'https://api.example.com/users/{id}/get', value: o.template, enterkeyhint: 'done' });
  tpl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tpl.blur(); } });
  tpl.addEventListener('input', () => {
    if (/[\r\n]/.test(tpl.value)) tpl.value = tpl.value.replace(/[\r\n]+/g, '');
    o.template = tpl.value; saveOpts(); onSetupChange('template');
  });
  // Column chips insert {name} at the cursor, so nobody has to hunt for braces on the iPhone keyboard.
  const insert = (text) => {
    const s = tpl.selectionStart ?? tpl.value.length, e = tpl.selectionEnd ?? s;
    tpl.setRangeText(text, s, e, 'end');
    tpl.dispatchEvent(new Event('input'));
  };

  const fileInfo = state.csv
    ? h('div', null, h('b', null, state.csv.name), h('span', { class: 'muted small' }, ` · ${dataRows().length} rows · ${columnNames().length} columns` + (state.csv.warnings ? ` · ${state.csv.warnings} parse warning(s)` : '')))
    : h('div', { class: 'muted' }, 'No CSV loaded.');
  const drop = h('div', { class: 'drop' + (state.csv ? '' : ' empty-drop') },
    fileInfo,
    h('div', { class: 'row' },
      h('button', { class: 'btn' + (state.csv ? '' : ' primary'), onclick: async () => {
        const [f] = await pickFiles({ accept: '.csv,text/csv,text/plain,text/comma-separated-values' });
        await loadCsvFile(f);
      } }, icon('file'), state.csv ? 'Choose another CSV' : 'Choose CSV file'),
      h('span', { class: 'muted small' }, 'or drop it here'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost', onclick: loadSample }, 'Load sample')));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); loadCsvFile(e.dataTransfer.files[0]); });

  const parts = [h('div', { class: 'field' }, h('span', { class: 'flabel' }, 'CSV file'), drop)];
  let previewBox = null;
  if (state.csv) {
    previewBox = h('div', { class: 'preview-table' });
    parts.push(checkbox('header', 'First row is header'), previewBox);
  }
  parts.push(h('label', { class: 'field' }, 'URL template', tpl),
    state.csv ? h('div', { class: 'colchips' }, h('span', { class: 'muted small' }, 'Tap to insert a column:'),
      h('div', { class: 'chips' }, columnNames().map(n => h('button', { type: 'button', class: 'chip',
        onmousedown: (e) => e.preventDefault(), // keep the cursor in the field on desktop
        onclick: () => insert(`{${n}}`) }, n))))
      : h('div', { class: 'muted small' }, 'Write {column name} where a value goes, e.g. https://example.com/{id}/{name}/get. Load a CSV to get insert buttons.'));

  const conc = h('input', { type: 'range', min: 1, max: 10, step: 1, value: o.concurrency });
  const concVal = h('b', null, String(o.concurrency));
  conc.addEventListener('input', () => { o.concurrency = +conc.value; concVal.textContent = conc.value; saveOpts(); });
  const tmo = h('input', { type: 'number', min: 1, max: 300, step: 1, inputmode: 'numeric', value: o.timeout });
  tmo.addEventListener('input', () => { const v = +tmo.value; if (v >= 1 && v <= 300) { o.timeout = v; saveOpts(); } });
  parts.push(h('div', { class: 'opts' },
    checkbox('encode', 'URL-encode values'), checkbox('skipEmpty', 'Skip empty cells'), checkbox('dedupe', 'Skip duplicate URLs'),
    h('label', { class: 'field' }, h('span', null, 'Concurrency ', concVal), conc),
    h('label', { class: 'field' }, 'Timeout per request (s)', tmo)));

  const urlPreview = h('div', { class: 'urlprev' });
  parts.push(urlPreview);
  const runBtn = h('button', { class: 'btn primary', onclick: () => start(buildItems(), false) }, 'Run');
  const stopBtn = h('button', { class: 'btn', onclick: () => Runner.stop() }, 'Stop');
  const retryBtn = h('button', { class: 'btn', onclick: () => start(retryable(), true) }, 'Retry failed');
  parts.push(h('div', { class: 'row runrow' }, runBtn, stopBtn, retryBtn));

  const setup = h('details', { class: 'panel setup', open: !state.run || null },
    h('summary', null, h('span', null, 'Setup'), h('span', { class: 'muted small sum-info' })),
    h('div', { class: 'form' }, parts));
  return { setup, urlPreview, previewBox, runBtn, stopBtn, retryBtn };
}

function paintPreviewTable() {
  if (!view.previewBox) return;
  const names = columnNames(), used = templateCols(state.opts.template, names).used;
  const sel = (j) => used.includes(j) ? 'sel' : null;
  const rows = dataRows().slice(0, 5);
  view.previewBox.replaceChildren(h('table', null,
    h('thead', null, h('tr', null, names.map((n, j) => h('th', { class: sel(j) }, n)))),
    h('tbody', null, rows.map(r => h('tr', null, names.map((_, j) => h('td', { class: sel(j) }, String(r[j] ?? '')))))),
  ), h('div', { class: 'muted small' }, `First ${rows.length} of ${dataRows().length} rows`));
}

function paintUrlPreview() {
  const items = state.csv ? buildItems() : [];
  const o = state.opts;
  const nodes = [];
  const { used, unknown } = state.csv ? templateCols() : { used: [], unknown: [] };
  if (unknown.length) nodes.push(h('div', { class: 'note warn' }, `No column matches ${unknown.map(u => `{${u}}`).join(', ')}; ${unknown.length === 1 ? 'it stays' : 'they stay'} as typed. Use a header name or a column number like {2}.`));
  if (!state.csv) nodes.push(h('div', { class: 'muted' }, 'Load a CSV to see the first URL.'));
  else if (!o.template.trim()) nodes.push(h('div', { class: 'muted' }, 'Write the URL template.'));
  else if (!used.length) nodes.push(h('div', { class: 'muted' }, 'Add at least one {column} to the template (tap a column above).'));
  else if (!items.length) nodes.push(h('div', { class: 'muted' }, 'No rows to fetch: every row has an empty value in a column the template uses.'));
  else {
    nodes.push(h('div', { class: 'muted small' }, `Row ${items[0].row} URL · ${items.length} request${items.length === 1 ? '' : 's'}`),
      h('code', { class: 'url' }, items[0].url));
    try { const u = new URL(items[0].url); if (!/^https?:$/.test(u.protocol)) throw 0; }
    catch (e) { nodes.push(h('div', { class: 'note warn' }, 'This is not a valid http(s) URL. The template must start with http:// or https://.')); }
    if (o.encode && items.some(it => it.values.some(v => v.includes('/')))) {
      nodes.push(h('div', { class: 'note' }, 'Some values contain "/", which URL-encoding turns into %2F. If the values are paths (like image/png), turn "URL-encode values" off.'));
    }
  }
  view.urlPreview.replaceChildren(...nodes);
  const sumInfo = $('.sum-info', view.setup);
  if (sumInfo) sumInfo.textContent = state.csv ? ` · ${state.csv.name} · ${items.length} URLs` : '';
}

function onSetupChange(key) {
  if (key === 'header') { Tabs.refresh(); return; } // column names change, so rebuild the chips
  if (key === 'template') paintPreviewTable();
  paintUrlPreview(); updateSummary();
}

function renderFetch(body) {
  const s = renderSetup();
  const count = { success: h('b'), client: h('b'), server: h('b'), network: h('b') };
  const chips = h('div');
  const paintChips = () => chips.replaceChildren(UI.chipFilter([
    { value: 'all', label: 'All' }, { value: 'success', label: 'Success' }, { value: 'errors', label: 'Errors' },
  ], state.filter, (v) => { state.filter = v; paintChips(); paintCards(); }));
  paintChips();
  let qTimer;
  const search = UI.search('Search value or URL', (v) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = v; paintCards(); }, 150); }, state.q);
  const exportBtn = h('button', { class: 'btn', onclick: exportZip }, icon('share'), 'Export .zip');
  const bar = h('div', { class: 'fill' });
  const summary = h('div', { class: 'panel summary' },
    h('div', { class: 'muted small run-info' }),
    h('div', { class: 'progress' }, bar),
    h('div', { class: 'row prog-row' }, h('span', { class: 'prog-text' }), h('span', { class: 'spacer' }), exportBtn),
    h('div', { class: 'counters' },
      h('span', { class: 'ctr ok' }, count.success, ' success'), h('span', { class: 'ctr bad' }, count.client, ' client error'),
      h('span', { class: 'ctr bad' }, count.server, ' server error'), h('span', { class: 'ctr net' }, count.network, ' network error')),
    chips, h('div', { class: 'search-in' }, search));
  const cards = h('div', { class: 'cards results' });
  const moreBtn = h('button', { class: 'btn block', onclick: () => loadMore() }, 'Show more');
  const sentinel = h('div', { class: 'sentinel', hidden: true }, moreBtn);
  const empty = h('div', { class: 'empty' });

  body.replaceChildren(h('div', { class: 'pad' }, s.setup, summary), empty, cards, h('div', { class: 'pad' }, sentinel));
  if (view && view.io) view.io.disconnect();
  view = { ...s, summary, bar, progress: $('.prog-text', summary), runInfo: $('.run-info', summary), count, exportBtn, cards, sentinel, moreBtn, empty,
    rendered: new Map(), limit: BATCH };
  if ('IntersectionObserver' in window) {
    view.io = new IntersectionObserver((ents) => { if (ents.some(e => e.isIntersecting) && hiddenCount() > 0) loadMore(); }, { root: $('#app'), rootMargin: '800px 0px' });
    view.io.observe(sentinel);
  }
  paintPreviewTable();
  paintUrlPreview();
  paintCards();
  updateSummary();
}

/* ---------- History tab ---------- */
async function deleteRun(run) {
  await DB.run('results', 'readwrite', st => st.delete(IDBKeyRange.bound(run.id + ':', run.id + ':￿')));
  await DB.del('runs', run.id);
  if (state.run && state.run.id === run.id) { state.run = null; state.results = new Map(); await DB.del('kv', 'lastRun'); }
}

async function renderHistory(body) {
  const runs = (await DB.all('runs')).sort((a, b) => b.created - a.created);
  const list = h('div', { class: 'cards' });
  if (!runs.length) list.append(UI.empty('No runs yet. Runs and their responses are saved on this device.'));
  for (const run of runs) {
    const c = run.counts;
    const active = state.run && state.run.id === run.id;
    list.append(UI.card({
      title: run.csvName,
      subtitle: new Date(run.created).toLocaleString(),
      chip: active ? h('span', { class: 'badge ok' }, 'Open') : null,
      meta: [h('div', { class: 'url' }, runTemplate(run)),
        h('div', null, c ? `${run.items.length} rows · ${c.success} success · ${c.client + c.server} HTTP errors · ${c.network} network` + (c.notRun ? ` · ${c.notRun} not run` : '')
          : `${run.items.length} rows · not finished`)],
      actions: [
        h('button', { class: 'btn primary', onclick: async () => { if (Runner.running) { toast('Stop the current run first'); return; } await openRun(run); Tabs.show('fetch'); } }, 'Open'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (Runner.running && active) { toast('Stop the run first'); return; }
          if (!(await confirmBox(`Delete this run and its ${run.items.length} saved responses?`))) return;
          await deleteRun(run); Tabs.refresh(); toast('Deleted');
        } }, 'Delete')],
    }));
  }
  body.replaceChildren(list);
}

/* ---------- Settings tab ---------- */
let workerCode = ''; // loaded ahead so "Copy Worker code" copies inside the tap (iOS refuses clipboard writes after an await)
const isProxyUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' || (u.protocol === 'http:' && Fetcher.isLocal(u.hostname)); } catch (e) { return false; } };

function proxySteps() {
  const li = (...k) => h('li', null, ...k);
  openSheet('Set up the proxy', h('div', { class: 'form steps' },
    h('p', { style: 'margin:0' }, 'A free Cloudflare Worker fetches blocked URLs for the app and adds the missing CORS header. Only this app, with your key, can use it. About 5 minutes; Cloudflare menu names may differ slightly.'),
    h('ol', null,
      li('Here: press ', h('b', null, 'Generate'), ' under Key, then ', h('b', null, 'Copy key'), '.'),
      li('Open ', h('b', null, 'dash.cloudflare.com'), ' and sign up (free plan: 100,000 requests a day).'),
      li(h('b', null, 'Workers & Pages'), ' → ', h('b', null, 'Create'), ' → create a Worker from the "Hello World" starter, name it e.g. ', h('code', null, 'csv-proxy'), ', Deploy.'),
      li(h('b', null, 'Edit code'), ': delete everything, paste the Worker code (', h('b', null, 'Copy Worker code'), ' below), ', h('b', null, 'Deploy'), '.'),
      li('Worker → ', h('b', null, 'Settings'), ' → ', h('b', null, 'Variables and Secrets'), ' → Add: type ', h('b', null, 'Secret'), ', name ', h('code', null, 'PROXY_KEY'), ', value = your key. Save / Deploy.'),
      li('Only if you use the app from another address than ', h('code', null, 'https://schwi2807.github.io'), ' (e.g. a test copy on a PC at ', h('code', null, 'http://localhost:8000'), '): add a Text variable ', h('code', null, 'ALLOWED_ORIGINS'), ' listing the addresses, comma-separated.'),
      li('Copy the Worker address (', h('code', null, 'https://csv-proxy.<account>.workers.dev'), ') into ', h('b', null, 'Proxy URL'), ' here and press ', h('b', null, 'Test proxy'), '.')),
    h('button', { class: 'btn block', onclick: () => workerCode ? copyText(workerCode, 'Worker code copied') : toast('Worker code not loaded') }, 'Copy Worker code')));
}

function proxyPanel() {
  const o = state.opts;
  const status = h('div', { class: 'muted small' });
  const describe = () => { status.textContent = o.proxyMode === 'off' ? 'Off: blocked rows show the framed fallback.'
    : !proxyConfig() ? 'Not set up yet: blocked rows show the framed fallback.'
    : o.proxyMode === 'always' ? 'Every request goes through the proxy.' : 'Rows the browser blocks are retried through the proxy.'; };
  describe();
  const field = (attrs) => h('input', { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off', ...attrs });
  const url = field({ type: 'url', inputmode: 'url', placeholder: 'https://csv-proxy.your-account.workers.dev', value: o.proxyUrl });
  url.addEventListener('input', () => { o.proxyUrl = url.value.trim(); saveOpts(); describe(); });
  const key = field({ type: 'text', class: 'mono', placeholder: 'Press Generate', value: o.proxyKey });
  key.addEventListener('input', () => { o.proxyKey = key.value.trim(); saveOpts(); describe(); });
  const generate = async () => {
    if (o.proxyKey && !(await confirmBox('Make a new key? The Worker’s PROXY_KEY secret must then be changed to it too.', 'New key'))) return;
    key.value = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');
    key.dispatchEvent(new Event('input'));
  };
  const test = async () => {
    const p = { url: o.proxyUrl, key: o.proxyKey };
    if (!isProxyUrl(p.url)) { status.textContent = 'Enter the Worker address (https://…).'; return; }
    if (!p.key) { status.textContent = 'Generate a key first, and set it as PROXY_KEY on the Worker.'; return; }
    status.textContent = 'Testing…';
    const r = await Fetcher.get('https://example.com/', { timeoutMs: 20000, proxy: p });
    status.textContent = r.error ? `Not working: ${r.error.message || Errors.network(r.error.kind).title}`
      : `Proxy works: example.com answered ${r.status} through it (${r.ms} ms).`;
  };
  return h('div', { class: 'panel' },
    h('div', { class: 'muted small' }, 'For servers that block web apps (BLOCKED by CORS). Your own free Cloudflare Worker fetches those URLs for the app.'),
    UI.segmented([['off', 'Off'], ['blocked', 'When blocked'], ['always', 'Always']], o.proxyMode, (v) => { o.proxyMode = v; saveOpts(); describe(); }),
    h('label', { class: 'field' }, 'Proxy URL', url),
    h('label', { class: 'field' }, 'Key', key),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: generate }, 'Generate'),
      Render.copyBtn(() => key.value, 'Copy key'),
      h('button', { class: 'btn primary', onclick: test }, 'Test proxy')),
    status,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: proxySteps }, 'Setup steps'),
      h('button', { class: 'btn', onclick: () => workerCode ? copyText(workerCode, 'Worker code copied') : toast('Worker code not loaded') }, 'Copy Worker code')));
}

async function renderSettings(body) {
  if (!workerCode) fetch('proxy/worker.js').then(r => r.ok ? r.text() : '').then(t => { workerCode = t; }).catch(() => {});
  const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  body.replaceChildren(h('div', { class: 'pad' },
    h('h2', null, 'Proxy'), proxyPanel(),
    h('h2', null, 'Theme'), Theme.picker(),
    h('h2', null, 'Data on this device'),
    h('div', { class: 'panel' },
      h('div', null, est ? `Using about ${Render.fmtSize(est.usage || 0)} of storage.` : 'Storage use unknown.'),
      h('div', { class: 'muted small' }, state.persisted ? 'Storage: persistent.' : 'Storage: not marked persistent; the browser may clear it if space runs low or the app goes unused for weeks. Export runs you want to keep.'),
      h('button', { class: 'btn danger', onclick: async () => {
        if (Runner.running) { toast('Stop the run first'); return; }
        if (!(await confirmBox('Delete every saved run and response? The loaded CSV and settings stay.', 'Delete all'))) return;
        await DB.clear('results'); await DB.clear('runs'); await DB.del('kv', 'lastRun');
        state.run = null; state.results = new Map(); Tabs.refresh(); toast('History deleted');
      } }, 'Delete all history')),
    h('h2', null, 'About'),
    h('p', { class: 'muted small' }, 'Requests go straight from this device to each URL. Servers that do not allow cross-origin reads show "BLOCKED by CORS" (with the page shown in a frame), or go through your proxy when it is set up. Responses are kept up to 10 MB each.')));
}

(async function boot() {
  await DB.open(['runs', 'results']);
  await Theme.load();
  state.opts = { ...DEFAULT_OPTS, ...((await DB.get('kv', 'opts')) || {}) };
  if (state.opts.template === '') { // carry over a v1 "base URL + column" setup
    const old = state.opts.base || (() => { try { return localStorage.getItem(APP_SLUG + '-base-url'); } catch (e) { return null; } })();
    if (old) state.opts.template = old + (state.opts.columnName ? `{${state.opts.columnName}}` : '');
  }
  try { const t = localStorage.getItem(LS_TEMPLATE); if (t && !state.opts.template) state.opts.template = t; } catch (e) {}
  delete state.opts.base; delete state.opts.column; delete state.opts.columnName;
  state.csv = (await DB.get('kv', 'csv')) || null;
  const last = await DB.get('kv', 'lastRun');
  if (last) { const run = await DB.get('runs', last); if (run) await openRun(run); }
  Tabs.setup([
    { id: 'fetch', label: 'Fetch', icon: 'search', title: 'CSV URL Fetcher', render: renderFetch },
    { id: 'history', label: 'History', icon: 'list', render: renderHistory },
    { id: 'settings', label: 'Settings', icon: 'settings', render: renderSettings },
  ]);
  registerSW();
  state.persisted = await persistStorage();
})().catch(err => { console.error(err); toast('Storage error: ' + err.message); });
