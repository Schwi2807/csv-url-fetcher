'use strict';
/* render.js: turns a response body (Blob) into card content.
   Render.body(result, fileBase) -> element, filled asynchronously.
   Detection: Content-Type first, then sniffing (magic bytes, valid UTF-8, JSON/HTML shape).
   Kinds: json, image, text, html, pdf, binary. Long bodies collapse after ~30 lines. */
const Render = (() => {
  const SHOW_MAX = 300 * 1024;  // characters shown inline; Copy/Download still give everything
  const LINES = 30;

  const EXT = { 'application/json': 'json', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
    'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
    'text/html': 'html', 'application/xml': 'xml', 'text/xml': 'xml', 'text/csv': 'csv', 'text/plain': 'txt',
    'application/pdf': 'pdf', 'application/javascript': 'js', 'text/javascript': 'js', 'text/css': 'css', 'application/zip': 'zip' };
  const KIND_EXT = { json: 'json', html: 'html', text: 'txt', pdf: 'pdf', image: 'img', binary: 'bin' };

  const mimeOf = (ct) => (ct || '').split(';')[0].trim().toLowerCase();
  function charsetOf(ct) { const m = /charset=([^;]+)/i.exec(ct || ''); return m ? m[1].trim().replace(/"/g, '') : 'utf-8'; }
  const isJsonMime = (m) => m === 'application/json' || m.endsWith('+json') || m === 'text/json';
  const isTextMime = (m) => m.startsWith('text/') || m.endsWith('+xml') || m === 'application/xml' || m === 'application/javascript'
    || m === 'application/x-www-form-urlencoded' || m === 'application/x-ndjson' || m === 'application/yaml' || m === 'application/x-yaml';

  function magic(b) {
    const s = (i, str) => [...str].every((c, k) => b[i + k] === c.charCodeAt(0));
    if (b[0] === 0x89 && s(1, 'PNG')) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (s(0, 'GIF8')) return 'image/gif';
    if (s(0, 'RIFF') && s(8, 'WEBP')) return 'image/webp';
    if (s(0, '%PDF')) return 'application/pdf';
    if (s(0, 'PK')) return 'application/zip';
    return null;
  }
  function decode(buf, ct, fatal) {
    let d;
    try { d = new TextDecoder(charsetOf(ct), { fatal }); } catch (e) { d = new TextDecoder('utf-8', { fatal }); }
    return d.decode(buf);
  }
  const looksJson = (t) => { const s = t.trimStart()[0]; return s === '{' || s === '['; };
  const looksHtml = (t) => /^\s*(<!doctype html|<html|<head|<body)/i.test(t);

  // -> { kind, mime, text?, json? }
  async function detect(r) {
    let mime = mimeOf(r.ct);
    const blob = r.body;
    if (!blob || !blob.size) return { kind: 'empty', mime };
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const sniffed = magic(head);
    if (mime.startsWith('image/')) return { kind: 'image', mime };
    if (mime === 'application/pdf') return { kind: 'pdf', mime };
    let text = null;
    if (isJsonMime(mime) || isTextMime(mime) || mime === 'text/html' || mime === 'application/xhtml+xml') {
      text = decode(await blob.arrayBuffer(), r.ct, false);
    } else {
      if (sniffed && sniffed.startsWith('image/')) return { kind: 'image', mime: sniffed };
      if (sniffed === 'application/pdf') return { kind: 'pdf', mime: sniffed };
      if (sniffed) return { kind: 'binary', mime: mime || sniffed };
      try { text = decode(await blob.arrayBuffer(), r.ct, true); } catch (e) { return { kind: 'binary', mime: mime || 'application/octet-stream' }; }
      if (/[\u0000-\u0008\u000e-\u001a]/.test(text.slice(0, 4096))) return { kind: 'binary', mime: mime || 'application/octet-stream' };
    }
    if (isJsonMime(mime) || ((!mime || mime === 'text/plain' || !isTextMime(mime)) && looksJson(text))) {
      try { return { kind: 'json', mime, text, json: JSON.parse(text) }; } catch (e) { /* falls through to text */ }
    }
    if (mime === 'text/html' || mime === 'application/xhtml+xml' || ((!mime || mime === 'text/plain') && looksHtml(text))) return { kind: 'html', mime, text };
    return { kind: 'text', mime, text };
  }

  function fileName(base, mime, kind) {
    return `${base}.${EXT[mime] || (mime.startsWith('image/') ? mime.slice(6).replace(/\W.*/, '') : KIND_EXT[kind] || 'bin')}`;
  }
  const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`;

  function copyBtn(getText, label = 'Copy') {
    const b = h('button', { class: 'btn small-btn', onclick: async () => {
      await copyText(getText(), 'Copied');
      b.textContent = 'Copied'; b.classList.add('done');
      setTimeout(() => { b.textContent = label; b.classList.remove('done'); }, 1500);
    } }, label);
    return b;
  }
  const dlBtn = (blob, name) => h('button', { class: 'btn small-btn', onclick: () => offerFile(blob, name) }, 'Download');

  // Clamp to ~30 lines with a Show more toggle when the content is long.
  function collapsible(content, long) {
    const wrap = h('div', { class: 'coll' + (long ? ' clamped' : '') }, content);
    if (!long) return wrap;
    const more = h('button', { class: 'btn ghost more', onclick: () => {
      const open = wrap.classList.toggle('clamped');
      more.textContent = open ? 'Show more' : 'Show less';
    } }, 'Show more');
    return h('div', null, wrap, more);
  }
  const countLines = (t, cap = LINES + 1) => { let n = 1; for (let i = 0; i < t.length && n < cap; i++) if (t.charCodeAt(i) === 10) n++; return n; };
  const isLong = (t) => countLines(t) > LINES || t.length > LINES * 120;

  function pre(text, cls = '') {
    const shown = text.length > SHOW_MAX ? text.slice(0, SHOW_MAX) : text;
    return h('div', null,
      collapsible(h('pre', { class: 'code ' + cls }, shown), isLong(shown)),
      text.length > SHOW_MAX ? h('div', { class: 'muted small' }, `Showing the first ${fmtSize(SHOW_MAX)} of text; Copy or Download for all of it.`) : null);
  }

  /* ---- JSON tree: <details> per object/array, so every level folds ---- */
  function jsonTree(val) {
    let lines = 0;
    const prim = (v) => {
      if (v === null) return h('span', { class: 'jnull' }, 'null');
      if (typeof v === 'string') return h('span', { class: 'jstr' }, JSON.stringify(v));
      if (typeof v === 'number') return h('span', { class: 'jnum' }, String(v));
      return h('span', { class: 'jbool' }, String(v));
    };
    const keyEl = (k) => k == null ? null : [h('span', { class: 'jkey' }, typeof k === 'number' ? '' : JSON.stringify(k)), typeof k === 'number' ? null : ': '];
    function node(k, v, depth, comma) {
      lines++;
      const tail = comma ? ',' : '';
      if (v === null || typeof v !== 'object') return h('div', { class: 'jl' }, keyEl(k), prim(v), tail);
      const arr = Array.isArray(v);
      const entries = arr ? v.map((x, i) => [i, x]) : Object.entries(v);
      const [o, c] = arr ? ['[', ']'] : ['{', '}'];
      if (!entries.length) return h('div', { class: 'jl' }, keyEl(k), o + c, tail);
      const d = h('details', { class: 'jd', open: depth < 3 || null },
        h('summary', { class: 'jl' }, keyEl(k), o, h('span', { class: 'jhint' }, ` ${entries.length} ${arr ? 'item' : 'key'}${entries.length === 1 ? '' : 's'} ${c}${tail}`)),
        h('div', { class: 'jkids' }, entries.map(([ek, ev], i) => node(arr ? null : ek, ev, depth + 1, i < entries.length - 1))),
        h('div', { class: 'jl' }, c, tail));
      lines++;
      return d;
    }
    const el = h('div', { class: 'code json' }, node(null, val, 0, false));
    return { el, lines };
  }

  function json(info, blob, base) {
    const pretty = JSON.stringify(info.json, null, 2);
    const tools = h('div', { class: 'tools' }, copyBtn(() => pretty), dlBtn(new Blob([pretty], { type: 'application/json' }), fileName(base, 'application/json', 'json')));
    if (pretty.length > SHOW_MAX) return [tools, pre(pretty)]; // too big for a DOM tree; plain text stays fast
    const { el, lines } = jsonTree(info.json);
    return [tools, collapsible(el, lines > LINES)];
  }

  function image(info, blob, base, r) {
    const dims = h('span', { class: 'muted small' }, 'loading…');
    const url = URL.createObjectURL(blob);
    const img = h('img', { class: 'shot', alt: 'Response image', src: url });
    img.onload = () => { dims.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${info.mime}`; URL.revokeObjectURL(url); };
    img.onerror = () => { dims.textContent = 'The browser could not display this image.'; URL.revokeObjectURL(url); };
    if (typeof Viewer !== 'undefined') { img.classList.add('tap'); img.onclick = () => Viewer.open([blob], { title: base }); }
    return [h('div', { class: 'tools' }, dims, h('span', { class: 'spacer' }), dlBtn(blob, fileName(base, info.mime, 'image'))), img];
  }

  function html(info, blob, base, r) {
    const box = h('div');
    let frame = null;
    const toggle = h('button', { class: 'btn small-btn', 'aria-pressed': 'false', onclick: () => {
      if (frame) { frame.remove(); frame = null; toggle.setAttribute('aria-pressed', 'false'); toggle.textContent = 'Preview'; return; }
      // sandbox="" = no scripts, no forms, no same-origin access; <base> makes relative images/styles resolve
      const baseTag = `<base href="${(r.finalUrl || '').replace(/"/g, '&quot;')}">`;
      frame = h('iframe', { class: 'preview', sandbox: '', referrerpolicy: 'no-referrer', title: 'HTML preview' });
      frame.srcdoc = baseTag + info.text;
      box.prepend(frame);
      toggle.setAttribute('aria-pressed', 'true'); toggle.textContent = 'Hide preview';
    } }, 'Preview');
    box.append(pre(info.text, 'markup'));
    return [h('div', { class: 'tools' }, toggle, copyBtn(() => info.text), dlBtn(blob, fileName(base, 'text/html', 'html'))), box];
  }

  function text(info, blob, base) {
    const mime = info.mime || 'text/plain';
    return [h('div', { class: 'tools' }, h('span', { class: 'muted small' }, mime), h('span', { class: 'spacer' }), copyBtn(() => info.text), dlBtn(blob, fileName(base, mime, 'text'))), pre(info.text)];
  }

  async function hexHead(blob) {
    const b = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    let out = '';
    for (let i = 0; i < b.length; i += 16) {
      const row = [...b.slice(i, i + 16)];
      out += i.toString(16).padStart(4, '0') + '  ' + row.map(x => x.toString(16).padStart(2, '0')).join(' ').padEnd(48) + '  '
        + row.map(x => x >= 32 && x < 127 ? String.fromCharCode(x) : '.').join('') + '\n';
    }
    return out;
  }

  async function other(info, blob, base, r) {
    const isPdf = info.kind === 'pdf';
    const label = isPdf ? 'PDF document' : 'Binary data';
    const nodes = [h('div', { class: 'tools' },
      h('span', { class: 'muted small' }, `${label} · ${info.mime || 'unknown type'} · ${fmtSize(blob.size)}`), h('span', { class: 'spacer' }),
      isPdf && typeof Viewer !== 'undefined' ? h('button', { class: 'btn small-btn', onclick: () => Viewer.open([blob], { title: base }) }, 'Preview') : null,
      dlBtn(blob, fileName(base, info.mime, info.kind)))];
    if (!isPdf) nodes.push(h('pre', { class: 'code hex' }, await hexHead(blob)));
    return nodes;
  }

  function body(r, base) {
    const box = h('div', { class: 'resp' }, h('div', { class: 'muted small' }, 'Rendering…'));
    (async () => {
      const info = await detect(r);
      let nodes;
      if (info.kind === 'empty') nodes = [h('div', { class: 'muted small' }, 'Empty body.')];
      else if (info.kind === 'json') nodes = json(info, r.body, base);
      else if (info.kind === 'image') nodes = image(info, r.body, base, r);
      else if (info.kind === 'html') nodes = html(info, r.body, base, r);
      else if (info.kind === 'text') nodes = text(info, r.body, base);
      else nodes = await other(info, r.body, base, r);
      if (r.truncated) nodes.unshift(h('div', { class: 'note warn' }, `Body cut at ${fmtSize(MAX_BODY)}: the response was larger.`));
      box.dataset.kind = info.kind;
      box.replaceChildren(...nodes);
    })().catch(e => { box.replaceChildren(h('div', { class: 'note' }, 'Could not render the body: ' + e.message)); });
    return box;
  }

  return { body, detect, fileName, fmtSize, mimeOf, EXT, copyBtn };
})();
