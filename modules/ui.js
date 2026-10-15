'use strict';
/* modules/ui.js (pwa kit): touch UI patterns. Needs core.js. See references/ui-patterns.md.
   UI.segmented(options, value, onChange)      options: [[value, label], ...]
   UI.chipFilter(options, value, onChange)     options: [{ value, label, count?, tone? }]  tone = CSS colour var
   UI.stars(value, onChange) / UI.starsRO(n)
   UI.input(obj, key, label, attrs)            two-way binds obj[key]; returns <label class="field">
   UI.textarea(obj, key, label, attrs)         plain <textarea>: Apple Pencil Scribble works
   UI.card({ title, subtitle, chip, meta, body, actions, onTap })
   UI.empty(text, actionLabel, onAction)
   UI.search(placeholder, onInput)
   UI.checkRow(text, checked, onToggle, onDelete)
   UI.split(masterNode, detailNode)            master/detail in iPad landscape, single column otherwise */
const UI = {
  segmented(options, value, onChange) {
    const wrap = h('div', { class: 'seg', role: 'group' });
    const paint = () => [...wrap.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.v === String(value)));
    for (const [v, label] of options) {
      wrap.append(h('button', { type: 'button', 'data-v': v, onclick: () => { value = v; paint(); onChange(v); } }, label));
    }
    paint();
    return wrap;
  },

  chipFilter(options, value, onChange) {
    const wrap = h('div', { class: 'chips scroll-x' });
    for (const o of options) {
      wrap.append(h('button', {
        type: 'button', class: 'chip' + (o.tone ? ' tone' : ''), style: o.tone ? `--c:${o.tone}` : null,
        'aria-pressed': o.value === value, onclick: () => onChange(o.value),
      }, o.tone ? h('span', { class: 'dot' }) : null, o.label + (o.count != null ? ` ${o.count}` : '')));
    }
    return wrap;
  },

  stars(value, onChange, max = 5) {
    const wrap = h('div', { class: 'stars', role: 'group', 'aria-label': 'Rating' });
    const paint = () => [...wrap.children].forEach((b, i) => b.classList.toggle('on', i < value));
    for (let i = 1; i <= max; i++) {
      wrap.append(h('button', { type: 'button', 'aria-label': `${i} of ${max}`, onclick: () => {
        value = value === i ? 0 : i; paint(); onChange(value); // tap the same star again to clear
      } }, '★'));
    }
    paint();
    return wrap;
  },
  starsRO(n, max = 5) {
    return h('span', { class: 'stars ro', 'aria-label': `${n} of ${max}` },
      Array.from({ length: max }, (_, i) => h('span', { class: i < n ? 'on' : '' }, '★')));
  },

  input(obj, key, label, attrs = {}) {
    const el = h('input', { type: 'text', autocomplete: 'off', ...attrs, value: obj[key] ?? '' });
    el.addEventListener('input', () => { obj[key] = el.value; });
    return h('label', { class: 'field' }, label, el);
  },
  textarea(obj, key, label, attrs = {}) {
    const el = h('textarea', { ...attrs, value: obj[key] ?? '' });
    el.addEventListener('input', () => { obj[key] = el.value; });
    return h('label', { class: 'field' }, label, el);
  },

  card({ title, subtitle, chip, meta, body, actions, onTap }) {
    return h('article', { class: 'card' + (onTap ? ' tap' : ''), onclick: onTap || null },
      h('div', { class: 'top' },
        h('div', null, h('h3', null, title), subtitle ? h('div', { class: 'muted small' }, subtitle) : null),
        chip || null),
      meta && meta.length ? h('div', { class: 'meta' }, meta) : null,
      body ? h('div', { class: 'body' }, body) : null,
      actions && actions.length ? h('div', { class: 'actions', onclick: (e) => e.stopPropagation() }, actions) : null);
  },

  empty(text, actionLabel, onAction) {
    return h('div', { class: 'empty' }, h('div', null, text),
      actionLabel ? h('button', { class: 'btn primary', onclick: onAction }, actionLabel) : null);
  },

  search(placeholder, onInput, value = '') {
    const el = h('input', { type: 'search', placeholder, autocomplete: 'off', value, enterkeyhint: 'search' });
    el.addEventListener('input', () => onInput(el.value));
    return el;
  },

  checkRow(text, checked, onToggle, onDelete) {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = checked;
    const lab = h('label', { class: 'check' + (checked ? ' done' : '') }, cb, h('span', { class: 'txt' }, text));
    cb.addEventListener('change', () => { lab.classList.toggle('done', cb.checked); onToggle(cb.checked); });
    return h('div', { class: 'item' }, lab,
      onDelete ? h('button', { class: 'btn ghost danger', 'aria-label': 'Delete', onclick: onDelete }, '✕') : null);
  },

  // In portrait (or narrow) only the master shows; open details in a sheet there instead.
  split(master, detail) {
    return h('div', { class: 'split' }, h('div', { class: 'master' }, master), h('div', { class: 'detail' }, detail));
  },
  isSplit() { return matchMedia('(min-width: 900px) and (orientation: landscape)').matches; },
};
