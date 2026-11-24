// Cifratura nel browser (Web Crypto). Password e chiave dello spazio non lasciano mai il dispositivo.
const te = new TextEncoder();
const td = new TextDecoder();
const subtle = crypto.subtle;

export const PW_ITER = 600000;
export const RC_ITER = 100000;
export const PIN_ITER = 300000;

export function b64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
export const rand = n => crypto.getRandomValues(new Uint8Array(n));
export const uuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = rand(16); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export async function pbkdf2(secret, saltB64, iter) {
  const base = await subtle.importKey('raw', te.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter }, base, 256));
}

async function hkdfBits(ikm, info, len = 256) {
  const hk = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits', 'deriveKey']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: te.encode(info) }, hk, len));
}
async function hkdfKey(ikm, info) {
  const raw = await hkdfBits(ikm, info);
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Da un segreto (password, codice, PIN) ricava la chiave che apre la cassaforte e la prova per il server. */
export async function deriveSecret(secret, saltB64, iter) {
  const bits = await pbkdf2(secret, saltB64, iter);
  return { kek: await hkdfKey(bits, 'znk-kek'), auth: b64(await hkdfBits(bits, 'znk-auth')), bits };
}
export async function kekFrom(bytes, info = 'znk-kek') { return hkdfKey(bytes, info); }

export async function aesEnc(key, bytes, aad) {
  const iv = rand(12);
  const p = { name: 'AES-GCM', iv };
  if (aad) p.additionalData = te.encode(aad);
  const ct = await subtle.encrypt(p, key, bytes);
  return { iv: b64(iv), ct: b64(ct) };
}
export async function aesDec(key, box, aad) {
  const p = { name: 'AES-GCM', iv: unb64(box.iv) };
  if (aad) p.additionalData = te.encode(aad);
  return new Uint8Array(await subtle.decrypt(p, key, unb64(box.ct)));
}

// ---------- chiave dello spazio (MK) ----------
export class Space {
  constructor(raw) { this.raw = raw; }
  static async create() { const s = new Space(rand(32)); await s.init(); return s; }
  static async open(raw) { const s = new Space(raw); await s.init(); return s; }
  async init() {
    this.key = await subtle.importKey('raw', this.raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    this.mkAuth = b64(await hkdfBits(this.raw, 'znk-mk-auth'));
  }
  wrapWith(kek) { return aesEnc(kek, this.raw, 'znk-mk'); }
  static async unwrap(kek, box) { return Space.open(await aesDec(kek, box, 'znk-mk')); }

  async encItem(id, obj) {
    const iv = rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(id) }, this.key, te.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return 'v1.' + b64(out);
  }
  async decItem(id, str) {
    if (!str || !str.startsWith('v1.')) throw new Error('formato');
    const u = unb64(str.slice(3));
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12), additionalData: te.encode(id) }, this.key, u.subarray(12));
    return JSON.parse(td.decode(pt));
  }
  /** Dati binari (immagini, allegati): [lunghezza intestazione][intestazione JSON][byte]. */
  async encBytes(id, meta, bytes) {
    const m = te.encode(JSON.stringify(meta));
    const buf = new Uint8Array(4 + m.length + bytes.length);
    new DataView(buf.buffer).setUint32(0, m.length);
    buf.set(m, 4); buf.set(bytes, 4 + m.length);
    const iv = rand(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(id) }, this.key, buf));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
    return 'b1.' + b64(out);
  }
  async decBytes(id, str) {
    const u = unb64(str.slice(3));
    const buf = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12), additionalData: te.encode(id) }, this.key, u.subarray(12)));
    const n = new DataView(buf.buffer).getUint32(0);
    return { meta: JSON.parse(td.decode(buf.subarray(4, 4 + n))), bytes: buf.subarray(4 + n) };
  }
  async encJSON(obj, aad) { return aesEnc(this.key, te.encode(JSON.stringify(obj)), aad); }
  async decJSON(box, aad) { return JSON.parse(td.decode(await aesDec(this.key, box, aad))); }
}

// ---------- codice di recupero ----------
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRecoveryCode() {
  const b = rand(24);
  let s = '';
  for (let i = 0; i < 24; i++) s += ALPHA[b[i] & 31];
  return s.match(/.{4}/g).join('-');
}
export function normCode(s) {
  return String(s || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '');
}

// ---------- chiave pubblica per le email in arrivo ----------
export async function newMailKeys(space) {
  const kp = await subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' }, true, ['encrypt', 'decrypt']);
  const spki = b64(await subtle.exportKey('spki', kp.publicKey));
  const pem = '-----BEGIN PUBLIC KEY-----\n' + spki.match(/.{1,64}/g).join('\n') + '\n-----END PUBLIC KEY-----\n';
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
  const priv = await aesEnc(space.key, pkcs8, 'znk-priv');
  return { pub: pem, priv };
}
export async function openPrivKey(space, box) {
  const pkcs8 = await aesDec(space.key, box, 'znk-priv');
  return subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-1' }, false, ['decrypt']);
}
export async function unseal(priv, sealed) {
  const k = await subtle.decrypt({ name: 'RSA-OAEP' }, priv, unb64(sealed.w));
  const key = await subtle.importKey('raw', k, { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, key, unb64(sealed.ct));
  return JSON.parse(td.decode(pt));
}

export async function sha256hex(str) {
  const h = new Uint8Array(await subtle.digest('SHA-256', te.encode(str)));
  return [...h].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Robustezza indicativa della password (0–4). */
export function strength(v) {
  let s = 0;
  if (v.length >= 10) s++;
  if (v.length >= 14) s++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++;
  if (/\d/.test(v)) s++;
  if (/[^A-Za-z0-9]/.test(v) || v.trim().split(/\s+/).length > 2) s++;
  if (v.length < 10) s = Math.min(s, 1);
  return Math.min(s, 4);
}
