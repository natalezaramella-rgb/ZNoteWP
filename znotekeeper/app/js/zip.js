// Archivio ZIP minimo (senza compressione), per l'esportazione Markdown leggibile.
const te = new TextEncoder();
let table = null;
function crc32(buf) {
  if (!table) { table = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[i] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
export class Zip {
  constructor() { this.files = []; this.names = new Set(); }
  unique(path) {
    let p = path, i = 2;
    const dot = path.lastIndexOf('.');
    while (this.names.has(p.toLowerCase())) p = dot > path.lastIndexOf('/') ? `${path.slice(0, dot)} (${i++})${path.slice(dot)}` : `${path} (${i++})`;
    this.names.add(p.toLowerCase());
    return p;
  }
  add(path, data, date = new Date()) {
    const bytes = typeof data === 'string' ? te.encode(data) : data;
    const name = this.unique(path);
    this.files.push({ name, bytes, date: new Date(date) });
    return name;
  }
  blob() {
    const parts = [];
    const central = [];
    let off = 0;
    for (const f of this.files) {
      const nm = te.encode(f.name);
      const crc = crc32(f.bytes);
      const { time, date } = dosTime(f.date);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
      h.setUint32(18, f.bytes.length, true); h.setUint32(22, f.bytes.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, nm, f.bytes);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
      c.setUint32(20, f.bytes.length, true); c.setUint32(24, f.bytes.length, true); c.setUint16(28, nm.length, true);
      c.setUint32(42, off, true);
      central.push(c.buffer, nm);
      off += 30 + nm.length + f.bytes.length;
    }
    const csize = central.reduce((n, b) => n + (b.byteLength || b.length), 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.files.length, true); e.setUint16(10, this.files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
  }
}
