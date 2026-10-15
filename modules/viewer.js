'use strict';
/* modules/viewer.js (pwa kit): full-screen image + PDF viewer. Needs core.js; PDFs need vendor/pdf.min.js
   and vendor/pdf.worker.min.js (new-app.js vendors them when this module is chosen).
   Viewer.open([blob, blob, ...], { title })   images and/or PDFs; every PDF page is shown, in order
   Viewer.pages(blobs) -> Promise<img[]>         same page images, e.g. for thumbnails
   Zoom: two-finger pinch, double-tap, or the +/- buttons. One-finger scroll stays native.
   PDFs are rendered once per Blob to PNG pages (no <iframe>/<embed>: iOS shows only page 1 there). */
const Viewer = {
  cache: new WeakMap(), // Blob -> Promise<objectURL[]>
  lib: null,

  loadPdfJs() {
    if (!this.lib) this.lib = new Promise((res, rej) => {
      const s = h('script', { src: 'vendor/pdf.min.js' });
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; res(window.pdfjsLib); };
      s.onerror = () => { this.lib = null; s.remove(); rej(new Error('pdf.js failed to load')); };
      document.head.append(s);
    });
    return this.lib;
  },

  async pdfUrls(blob) {
    const lib = await this.loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    // screen.* can be 0 in some embedded browsers; never render below 1024px on the long side
    const longSide = Math.max(screen.width || 0, screen.height || 0, innerWidth, innerHeight, 1024);
    const target = Math.min(2000, Math.round(longSide * (window.devicePixelRatio || 1) * 1.25));
    const urls = [];
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: target / page.getViewport({ scale: 1 }).width });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const b = await new Promise(r => c.toBlob(r, 'image/png'));
        if (!b) throw new Error(`page ${i} could not be rendered`);
        urls.push(URL.createObjectURL(b));
        c.width = c.height = 0; // iOS caps total canvas memory: free it right away
        page.cleanup();
      }
    } finally { doc.destroy(); }
    return urls;
  },

  urlsFor(blob) {
    if (!this.cache.has(blob)) {
      const isPdf = blob.type === 'application/pdf';
      const p = isPdf ? this.pdfUrls(blob) : Promise.resolve([URL.createObjectURL(blob)]);
      p.catch(() => this.cache.delete(blob));
      this.cache.set(blob, p);
    }
    return this.cache.get(blob);
  },

  async pages(blobs) {
    const all = (await Promise.all(blobs.map(b => this.urlsFor(b)))).flat();
    return all.map((u, i) => h('img', { src: u, alt: 'Page ' + (i + 1), draggable: 'false' }));
  },

  async open(blobs, { title = '' } = {}) {
    const ov = $('#overlay');
    const pages = h('div', { class: 'pages' }, h('p', { style: 'color:#ccc;text-align:center' }, 'Loading…'));
    const scroll = h('div', { class: 'scroll' }, pages);
    let zoom = 1;
    const setZoom = (z, cx, cy) => { // keep the point (cx, cy) of the viewport fixed
      z = Math.min(5, Math.max(1, z));
      if (cx == null) { cx = scroll.clientWidth / 2; cy = scroll.clientHeight / 2; }
      const k = z / zoom, x = scroll.scrollLeft + cx, y = scroll.scrollTop + cy;
      zoom = z; pages.style.width = (z * 100) + '%';
      scroll.scrollLeft = x * k - cx; scroll.scrollTop = y * k - cy;
    };
    ov.replaceChildren(
      h('div', { class: 'head' },
        h('button', { class: 'btn', onclick: () => this.close() }, 'Close'),
        h('span', null, title),
        h('button', { class: 'btn', 'aria-label': 'Zoom out', onclick: () => setZoom(zoom / 1.5) }, '−'),
        h('button', { class: 'btn', 'aria-label': 'Zoom in', onclick: () => setZoom(zoom * 1.5) }, '+')),
      scroll);
    ov.hidden = false;
    try { pages.replaceChildren(...await this.pages(blobs)); }
    catch (e) { pages.replaceChildren(h('p', { style: 'color:#fff' }, 'Could not open: ' + e.message)); }

    // Pinch: touch events (not pointer events: iOS cancels pointers once native scrolling starts).
    let pinch = null, lastTap = 0, touchDbl = 0;
    const rel = (t) => { const r = scroll.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top]; };
    scroll.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2) return;
      const [a, b] = [rel(e.touches[0]), rel(e.touches[1])];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: zoom, x: scroll.scrollLeft + (a[0] + b[0]) / 2, y: scroll.scrollTop + (a[1] + b[1]) / 2 };
    }, { passive: true });
    scroll.addEventListener('touchmove', (e) => {
      lastTap = 0;
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const [a, b] = [rel(e.touches[0]), rel(e.touches[1])];
      const z = Math.min(5, Math.max(1, pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, k = z / pinch.z;
      zoom = z; pages.style.width = (z * 100) + '%';
      scroll.scrollLeft = pinch.x * k - mx; scroll.scrollTop = pinch.y * k - my;
    }, { passive: false });
    scroll.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length || e.changedTouches.length !== 1) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault(); touchDbl = now; lastTap = 0;
        const [x, y] = rel(e.changedTouches[0]);
        setZoom(zoom > 1.01 ? 1 : 2.5, x, y);
      } else lastTap = now;
    }, { passive: false });
    scroll.addEventListener('dblclick', (e) => {
      if (Date.now() - touchDbl < 800) return;
      const [x, y] = rel(e); setZoom(zoom > 1.01 ? 1 : 2.5, x, y);
    });
  },

  close() { const ov = $('#overlay'); ov.hidden = true; ov.replaceChildren(); },
};
