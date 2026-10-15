'use strict';
/* core.js (pwa kit): shared helpers. App-specific code lives in app.js.
   Globals: $, $$, h, uid, toast, DB, Theme, THEMES, Tabs, ICONS, icon, openSheet, closeSheet,
            confirmBox, copyText, pickFiles, offerFile, isIOS, stamp, registerSW, persistStorage, APP_SLUG */

const APP_SLUG = 'csv-url-fetcher'; // unique per app: all apps on <user>.github.io share one origin

/* ---------- DOM helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
// h('button', { class: 'btn', onclick: fn, 'aria-pressed': true }, 'Label', childNode, [more])
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('aria-') && v != null) { e.setAttribute(k, String(v)); continue; }
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  if (value !== undefined) e.value = value; // after children so <select> options exist
  return e;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ---------- icons (24px stroke paths) ---------- */
const ICONS = {
  home: 'M3 11l9-7 9 7M5 10v10h14V10',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.8A8 8 0 1 1 21 12z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  file: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z',
  check: 'M4 12l5 5L20 6',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  book: 'M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 21V5',
  building: 'M4 21V5h11v16M15 10h5v11M2 21h20M8 8h3M8 12h3M8 16h3',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  share: 'M12 3v12M8 7l4-4 4 4M5 12v8h14v-8',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<path d="${ICONS[name] || ICONS.grid}"/>`;
  return s;
}

/* ---------- IndexedDB ----------
   await DB.open(['items', 'photos'])  -> object stores keyed by `id`, plus a `kv` store (key/value).
   Adding a store later: pass the new list; the version bumps itself. */
const DB = {
  db: null,
  async open(stores) {
    const name = APP_SLUG;
    const want = [...stores, 'kv'];
    let ver = await new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => { const d = r.result; const missing = want.some(s => !d.objectStoreNames.contains(s)); const v = d.version + (missing ? 1 : 0); d.close(); res(v); }; r.onerror = () => res(1); });
    return new Promise((res, rej) => {
      const r = indexedDB.open(name, ver);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of want) if (!d.objectStoreNames.contains(s)) s === 'kv' ? d.createObjectStore('kv') : d.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => res(this.db = r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => toast('Close other tabs of this app');
    });
  },
  run(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      let req;
      try { req = fn(t.objectStore(store)); } catch (e) { rej(e); return; }
      t.oncomplete = () => res(req && req.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  },
  stores() { return [...this.db.objectStoreNames]; },
  all: (s) => DB.run(s, 'readonly', st => st.getAll()),
  get: (s, k) => DB.run(s, 'readonly', st => st.get(k)),
  put: (s, v, k) => DB.run(s, 'readwrite', st => k === undefined ? st.put(v) : st.put(v, k)),
  del: (s, k) => DB.run(s, 'readwrite', st => st.delete(k)),
  clear: (s) => DB.run(s, 'readwrite', st => st.clear()),
  async kvAll() { // [[key, value], ...] for backup
    const keys = await DB.run('kv', 'readonly', st => st.getAllKeys());
    return Promise.all(keys.map(async k => [k, await DB.get('kv', k)]));
  },
};

/* ---------- themes ---------- */
const THEMES = [
  ['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['ocean', 'Ocean'], ['sunset', 'Sunset'], ['rose', 'Rose'],
  ['sand', 'Sand'], ['mint', 'Mint'], ['contrast', 'High contrast'], ['forest', 'Forest'], ['grape', 'Grape'],
  ['slate', 'Slate'], ['midnight', 'Midnight'],
];
const Theme = {
  current: 'system',
  apply(t) {
    this.current = t;
    if (t && t !== 'system') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem(APP_SLUG + '-theme', t); } catch (e) {}
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#f2f2f7';
  },
  async load() { this.apply((await DB.get('kv', 'theme')) || 'system'); },
  async set(t) { this.apply(t); await DB.put('kv', t, 'theme'); },
  // Grid of theme swatches; each swatch previews its own palette via data-theme on the button.
  picker(onChange) {
    const grid = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Theme' });
    const paint = () => [...grid.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.t === this.current));
    for (const [k, label] of THEMES) {
      grid.append(h('button', { class: 'swatch', 'data-t': k, 'data-theme': k === 'system' ? null : k, onclick: async () => {
        await this.set(k); paint(); onChange && onChange(k);
      } }, h('span', { class: 'bars' }, h('i'), h('i'), h('i')), label));
    }
    paint();
    return grid;
  },
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => Theme.apply(Theme.current));

/* ---------- sheet (modal) ---------- */
let sheetOnClose = null;
// openSheet('Title', bodyNode, { right: saveButton, small: true, onClose })
function openSheet(title, body, { left, right, small, onClose } = {}) {
  const s = $('#sheet');
  s.className = 'sheet' + (small ? ' small' : '');
  s.replaceChildren(h('div', { class: 'box', role: 'dialog', 'aria-label': title },
    h('div', { class: 'head' },
      left || h('button', { class: 'btn ghost', onclick: closeSheet }, 'Close'),
      h('h2', null, title),
      right || h('span', { style: 'width:72px' })),
    h('div', { class: 'body' }, body)));
  s.hidden = false;
  s.onclick = (e) => { if (e.target === s) closeSheet(); };
  sheetOnClose = onClose || null;
}
function closeSheet() {
  const s = $('#sheet');
  s.hidden = true; s.replaceChildren();
  const f = sheetOnClose; sheetOnClose = null; if (f) f();
}
// if (await confirmBox('Delete X?')) ...
function confirmBox(msg, okLabel = 'Delete') {
  return new Promise(res => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; sheetOnClose = null; closeSheet(); res(v); };
    openSheet('Confirm', h('div', { class: 'form' },
      h('p', { style: 'margin:0' }, msg),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'),
        h('button', { class: 'btn danger-fill', onclick: () => finish(true) }, okLabel))),
      { small: true, left: h('span', { style: 'width:72px' }), onClose: () => { if (!done) { done = true; res(false); } } });
  });
}

/* ---------- tabs ----------
   Tabs.setup([{ id, label, icon, title?, actions?: () => [nodes], render: (body) => {} }]) */
const Tabs = {
  list: [], current: null,
  setup(list, start) {
    this.list = list;
    $('#app').replaceChildren(...list.map(t => h('section', { class: 'tab', id: 'tab-' + t.id, hidden: true },
      h('header', { class: 'bar' }, h('h1', null, t.title || t.label), h('div', { class: 'bar-actions' })),
      h('div', { class: 'tab-body' }))));
    const bar = $('#tabbar');
    bar.replaceChildren(...list.map(t => h('button', { 'data-tab': t.id, 'aria-selected': false }, icon(t.icon), h('span', null, t.label))));
    bar.onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (b) this.show(b.dataset.tab); };
    this.show(start || list[0].id);
  },
  show(id) {
    this.current = id;
    for (const t of this.list) $('#tab-' + t.id).hidden = t.id !== id;
    for (const b of $$('#tabbar button')) b.setAttribute('aria-selected', b.dataset.tab === id);
    $('#app').scrollTop = 0;
    this.refresh();
  },
  refresh() {
    const t = this.list.find(x => x.id === this.current);
    if (!t) return;
    const sec = $('#tab-' + t.id);
    $('.bar-actions', sec).replaceChildren(...(t.actions ? t.actions() : []));
    t.render($('.tab-body', sec));
  },
};

/* ---------- clipboard, files ---------- */
async function copyText(text, msg = 'Copied') {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = h('textarea', { value: text, readonly: true, style: 'position:fixed;top:0;left:0;opacity:0' });
    document.body.append(ta); ta.select(); ta.setSelectionRange(0, text.length);
    document.execCommand('copy'); ta.remove();
  }
  toast(msg);
}
// const files = await pickFiles({ accept: 'image/*', multiple: true, capture: 'environment' })
function pickFiles({ accept, multiple, capture } = {}) {
  return new Promise(res => {
    const input = h('input', { type: 'file', accept: accept || null, multiple: !!multiple, capture: capture || null, style: 'display:none' });
    const done = (files) => { input.remove(); res(files); };
    input.addEventListener('change', () => done([...input.files]));
    input.addEventListener('cancel', () => done([]));
    document.body.append(input);
    input.click();
  });
}
// Offer a generated file. On iOS the share sheet ("Save to Files") needs a fresh tap,
// so this opens a small sheet with the buttons instead of calling share() after async work.
function offerFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  const canShare = isIOS && navigator.canShare && navigator.canShare({ files: [file] });
  const download = () => {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  };
  openSheet('Export', h('div', { class: 'form' },
    h('p', { style: 'margin:0' }, h('b', null, name), ` (${Math.max(1, Math.round(blob.size / 1024))} KB)`),
    canShare ? h('button', { class: 'btn primary block', onclick: async () => {
      try { await navigator.share({ files: [file] }); closeSheet(); }
      catch (e) { if (e.name !== 'AbortError') toast('Share failed: ' + e.message); }
    } }, 'Share / Save to Files') : null,
    h('button', { class: 'btn block' + (canShare ? '' : ' primary'), onclick: download }, 'Download')), { small: true });
}

/* ---------- service worker + storage ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'activated' && hadController) toast('App updated. Close and reopen to use it.');
      });
    });
  }).catch(err => console.warn('SW registration failed', err));
}
// Resolves true/false; iOS may say false, which is why a backup export matters.
async function persistStorage() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; }
  catch (e) { return false; }
}
// Pinch-zoom of the whole page is never wanted inside overlays.
document.addEventListener('gesturestart', (e) => { if (e.target.closest && e.target.closest('.overlay')) e.preventDefault(); });
