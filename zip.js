'use strict';
/* zip.js: minimal ZIP writer. Deflates with CompressionStream('deflate-raw') (Safari 16.4+), stores when unavailable.
   const blob = await Zip.make([{ name: 'a.txt', data: Blob|string|Uint8Array }, ...]) */
const Zip = (() => {
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const canDeflate = typeof CompressionStream === 'function' && (() => { try { new CompressionStream('deflate-raw'); return true; } catch (e) { return false; } })();

  async function bytes(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') return new TextEncoder().encode(data);
    return new Uint8Array(await data.arrayBuffer());
  }
  async function deflate(u8) {
    const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function dosTime(d) {
    return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }

  async function make(files) {
    const parts = [], central = [];
    const { time, date } = dosTime(new Date());
    let offset = 0;
    for (const f of files) {
      const raw = await bytes(f.data);
      const name = new TextEncoder().encode(f.name);
      const crc = crc32(raw);
      let data = raw, method = 0;
      if (canDeflate && raw.length > 64) {
        const z = await deflate(raw);
        if (z.length < raw.length) { data = z; method = 8; }
      }
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, method, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, raw.length, true);
      local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      parts.push(local, name, data);

      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, method, true); cen.setUint16(12, time, true); cen.setUint16(14, date, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, raw.length, true);
      cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
      central.push(cen, name);
      offset += 30 + name.length + data.length;
    }
    const cenSize = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  return { make, crc32, canDeflate };
})();
