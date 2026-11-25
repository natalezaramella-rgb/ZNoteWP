// Crittografia di «I miei secrets»: chiavi degli utenti, chiave per voce, firme.
// Tutto avviene nel browser; al sito arrivano solo chiavi pubbliche e dati cifrati.
import { b64, unb64, rand, aesEnc, aesDec } from './crypto.js';

const subtle = crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIG = { name: 'ECDSA', hash: 'SHA-256' };
const AAD_PRIV = 'znk-vault-keys-v1';

async function sha256(str) { return new Uint8Array(await subtle.digest('SHA-256', te.encode(str))); }
const hex = u => [...u].map(x => x.toString(16).padStart(2, '0')).join('');

/** Impronta delle chiavi di un utente (uguale alla formula del sito, ma calcolata qui). */
export async function fingerprint(uid, pubEnc, pubSig) { return hex(await sha256(`znk-fp-v1|${uid}|${pubEnc}|${pubSig}`)); }
/** Impronta da leggere ad alta voce: 8 gruppi di 5 cifre. */
export function fmtFp(fp) {
  const out = [];
  for (let i = 0; i < 8; i++) out.push(String(parseInt(fp.slice(i * 5, i * 5 + 5), 16) % 100000).padStart(5, '0'));
  return out.join(' ');
}

// ---------- chiavi dell'utente ----------
export async function newUserKeys(space) {
  const e = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const s = await subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const pubEnc = b64(await subtle.exportKey('spki', e.publicKey));
  const pubSig = b64(await subtle.exportKey('spki', s.publicKey));
  const secret = {
    e: b64(await subtle.exportKey('pkcs8', e.privateKey)),
    s: b64(await subtle.exportKey('pkcs8', s.privateKey)),
    pub_enc: pubEnc, pub_sig: pubSig,
  };
  const priv = await aesEnc(space.key, te.encode(JSON.stringify(secret)), AAD_PRIV);
  return { pub_enc: pubEnc, pub_sig: pubSig, priv };
}

/** Apre le chiavi private. Le pubbliche si prendono da dentro la scatola cifrata, non dal sito. */
export async function openUserKeys(space, uid, row) {
  const secret = JSON.parse(td.decode(await aesDec(space.key, row.priv, AAD_PRIV)));
  if (secret.pub_enc !== row.pub_enc || secret.pub_sig !== row.pub_sig) throw new Error('Le chiavi pubbliche sul sito non corrispondono alle tue.');
  return {
    uid,
    encPriv: await subtle.importKey('pkcs8', unb64(secret.e), ECDH, false, ['deriveBits']),
    sigPriv: await subtle.importKey('pkcs8', unb64(secret.s), ECDSA, false, ['sign']),
    pub_enc: secret.pub_enc, pub_sig: secret.pub_sig,
    fp: await fingerprint(uid, secret.pub_enc, secret.pub_sig),
  };
}

const pubCache = new Map();
async function importPub(spki, alg, uses) {
  const k = alg.name + spki;
  if (!pubCache.has(k)) pubCache.set(k, await subtle.importKey('spki', unb64(spki), alg, false, uses));
  return pubCache.get(k);
}

// ---------- chiave della voce, avvolta per ogni utente ----------
const wrapInfo = ctx => te.encode('znk-wrap-v1|' + ctx);
async function wrapKek(shared, salt, ctx) {
  const hk = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: wrapInfo(ctx) }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** ctx = id voce | id utente | versione chiave: una chiave avvolta non si può spostare su un'altra voce o utente. */
export const wrapCtx = (id, uid, kv) => `${id}|${uid}|${kv}`;

export async function wrapFor(rawKey, pubEnc, ctx) {
  const eph = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const peer = await importPub(pubEnc, ECDH, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: peer }, eph.privateKey, 256));
  const epk = b64(await subtle.exportKey('spki', eph.publicKey));
  const kek = await wrapKek(shared, await sha256('znk-wrap-salt|' + epk + '|' + pubEnc), ctx);
  const box = await aesEnc(kek, rawKey, 'znk-wrap-v1|' + ctx);
  return { e: epk, iv: box.iv, ct: box.ct };
}

export async function unwrap(keys, box, ctx) {
  const peer = await importPub(box.e, ECDH, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: peer }, keys.encPriv, 256));
  const kek = await wrapKek(shared, await sha256('znk-wrap-salt|' + box.e + '|' + keys.pub_enc), ctx);
  return aesDec(kek, box, 'znk-wrap-v1|' + ctx);
}

export const newEntryKey = () => rand(32);

// ---------- contenuto cifrato e firmato ----------
const sigMsg = (id, kv, d) => `znk-ve-v1|${id}|${kv}|${d.by}|${d.n}|${d.iv}|${d.ct}`;

/** n = numero di revisione che avrà la voce dopo il salvataggio (lega il contenuto alla sua revisione). */
export async function sealEntry(rawKey, keys, id, kv, n, obj) {
  const k = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const box = await aesEnc(k, te.encode(JSON.stringify(obj)), `znk-ve-v1|${id}|${kv}`);
  const d = { v: 1, by: keys.uid, n, iv: box.iv, ct: box.ct };
  d.sig = b64(await subtle.sign(SIG, keys.sigPriv, te.encode(sigMsg(id, kv, d))));
  return d;
}
export async function openEntry(rawKey, id, kv, d) {
  const k = await subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  return JSON.parse(td.decode(await aesDec(k, d, `znk-ve-v1|${id}|${kv}`)));
}
export async function verifyEntry(pubSig, id, kv, d) {
  try { return await subtle.verify(SIG, await importPub(pubSig, ECDSA, ['verify']), unb64(d.sig), te.encode(sigMsg(id, kv, d))); } catch (e) { return false; }
}

// ---------- elenco dei membri firmato dal proprietario ----------
export async function signAcl(keys, id, kv, members) {
  const m = {};
  for (const [uid, perm] of Object.entries(members)) m[uid] = perm;
  const acl = JSON.stringify({ v: 1, id, owner: keys.uid, kv, m, t: new Date().toISOString() });
  return { acl, sig: b64(await subtle.sign(SIG, keys.sigPriv, te.encode('znk-acl-v1|' + acl))) };
}
export async function verifyAcl(pubSig, box) {
  try {
    if (!await subtle.verify(SIG, await importPub(pubSig, ECDSA, ['verify']), unb64(box.sig), te.encode('znk-acl-v1|' + box.acl))) return null;
    return JSON.parse(box.acl);
  } catch (e) { return null; }
}
