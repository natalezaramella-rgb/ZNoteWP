// Stato dell'app: elementi decifrati in memoria, sincronizzazione con il server, copia locale cifrata.
import { api, isOffline } from './api.js';
import { kv, items as idbItems, blobs as idbBlobs } from './db.js';
import { uuid } from './crypto.js';
import { toast } from './ui.js';

export const S = {
  space: null,
  vault: null,
  priv: null,
  me: null,
  items: new Map(),
  seq: 0,
  offline: false,
  inbox: 0,
  recovery: 'off',
  readyAt: null,
  syncing: false,
};

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
let emitT = null;
export function emit() {
  clearTimeout(emitT);
  emitT = setTimeout(() => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }), 16);
}

export function setOffline(v) {
  if (S.offline === v) return;
  S.offline = v;
  document.body.classList.toggle('offline', v);
  emit();
}

// ---------- lettura ----------
export const get = id => S.items.get(id);
export const alive = it => it && !it.deleted_at && !it.purged && it.d;
export function all(kind) {
  const out = [];
  for (const it of S.items.values()) if (it.kind === kind && alive(it)) out.push(it);
  return out;
}
export const bySort = (a, b) => (a.sort - b.sort) || (a.created_at < b.created_at ? -1 : 1);
export function children(parentId, kind) {
  const out = [];
  for (const it of S.items.values()) if (it.parent_id === parentId && (!kind || it.kind === kind) && alive(it)) out.push(it);
  return out.sort(bySort);
}
export function nextSort(parentId, kind, first = false) {
  const c = children(parentId, kind);
  if (!c.length) return 1000;
  return first ? c[0].sort - 1000 : c[c.length - 1].sort + 1000;
}
export function settings() {
  const s = S.items.get('settings');
  return (s && s.d) || {};
}

async function decryptRow(row) {
  const it = { ...row, d: null, _raw: row.data };
  delete it.data;
  if (row.lazy || !row.data) { it.d = row.lazy ? { lazy: true } : null; return it; }
  try { it.d = await S.space.decItem(row.id, row.data); } catch (e) { console.warn('decifratura fallita', row.id); }
  return it;
}

/** Carica la copia locale (usata all'avvio e offline). */
export async function loadCache() {
  const rows = await idbItems.all();
  S.items.clear();
  for (const r of rows) {
    if (r.purged) continue;
    S.items.set(r.id, await decryptRow(r));
  }
  S.seq = (await kv.get('seq')) || 0;
  emit();
}

/** Sincronizza con il server; restituisce false se offline. */
export async function sync() {
  if (!S.space || S.syncing) return !S.offline;
  S.syncing = true;
  try {
    const r = await api('GET', `sync?since=${S.seq}`);
    setOffline(false);
    const put = [];
    const del = [];
    if (r.full) {
      const ids = new Set(r.items.map(x => x.id));
      for (const id of [...S.items.keys()]) if (!ids.has(id) && !pending.has(id)) { S.items.delete(id); del.push(id); }
    }
    for (const row of r.items) {
      if (pending.has(row.id)) continue;
      if (row.purged) { S.items.delete(row.id); del.push(row.id); continue; }
      const cur = S.items.get(row.id);
      if (cur && cur.rev === row.rev && !r.full) continue;
      if (cur && cur.rev === row.rev && cur.d) continue;
      S.items.set(row.id, await decryptRow(row));
      put.push(row);
    }
    if (put.length) await idbItems.putMany(put);
    if (del.length) await idbItems.delMany(del);
    S.seq = r.seq;
    await kv.set('seq', r.seq);
    S.inbox = r.inbox;
    S.recovery = r.recovery;
    S.readyAt = r.ready_at;
    if (put.length || del.length) emit();
    return true;
  } catch (e) {
    if (isOffline(e)) { setOffline(true); return false; }
    throw e;
  } finally {
    S.syncing = false;
  }
}

// ---------- scrittura ----------
const chains = new Map();
const pending = new Set();

export function canWrite() {
  if (S.offline) { toast('Sei offline: le note sono in sola lettura finché torna la connessione.'); return false; }
  return true;
}

function toRow(it, data) {
  return {
    id: it.id, kind: it.kind, parent_id: it.parent_id, sort: it.sort, due_at: it.due_at, remind_at: it.remind_at,
    completed: it.completed, deleted_at: it.deleted_at, purged: false, rev: it.rev, seq: it.seq, size: it.size,
    updated_at: it.updated_at, created_at: it.created_at, data: it.lazy ? null : data, lazy: !!it.lazy,
  };
}

/**
 * Salva un elemento. `patch` può contenere i campi in chiaro e `d` (dati da cifrare).
 * L'aggiornamento locale è immediato; l'invio al server avviene in ordine per ogni elemento.
 */
export function save(id, patch, { quiet = false } = {}) {
  const cur = S.items.get(id);
  const now = new Date().toISOString();
  const it = cur ? { ...cur } : { id, rev: 0, seq: 0, size: 0, created_at: now, parent_id: null, sort: 0, due_at: null, remind_at: null, completed: false, deleted_at: null };
  for (const k of ['kind', 'parent_id', 'sort', 'due_at', 'remind_at', 'completed']) if (k in patch) it[k] = patch[k];
  if ('deleted' in patch) it.deleted_at = patch.deleted ? (it.deleted_at || now) : null;
  if ('d' in patch) it.d = patch.d;
  it.updated_at = now;
  S.items.set(id, it);
  emit();
  pending.add(id);
  const prev = chains.get(id) || Promise.resolve();
  const job = prev.catch(() => {}).then(() => send(id, patch, quiet));
  chains.set(id, job);
  job.finally(() => { if (chains.get(id) === job) { chains.delete(id); pending.delete(id); } });
  return job;
}

async function send(id, patch, quiet, force = false) {
  const it = S.items.get(id);
  if (!it) return;
  const body = { kind: it.kind };
  for (const k of ['parent_id', 'sort', 'due_at', 'remind_at', 'completed']) if (k in patch) body[k] = patch[k];
  if ('deleted' in patch) body.deleted = !!patch.deleted;
  if ('d' in patch || !it.rev) {
    body.data = patch.raw || (it.kind === 'blob' ? patch.raw : await S.space.encItem(id, it.d));
    if (!it.rev) for (const k of ['parent_id', 'sort', 'due_at', 'remind_at', 'completed']) body[k] = it[k];
  }
  if (it.rev) body.base_rev = it.rev;
  if (force) body.force = true;
  try {
    const r = await api('PUT', `items/${encodeURIComponent(id)}`, body);
    const now = S.items.get(id) || it;
    Object.assign(now, { rev: r.rev, seq: r.seq, size: r.size, updated_at: r.updated_at, created_at: r.created_at, deleted_at: r.deleted_at, lazy: r.lazy });
    if (body.data) now.size = body.data.length;
    if (body.data !== undefined) now._raw = body.data;
    await idbItems.putMany([toRow(now, now._raw)]);
  } catch (e) {
    if (e.status === 409 && e.data && e.data.current) {
      const server = e.data.current;
      if (it.kind === 'page' && 'd' in patch && server.data) {
        // Un altro dispositivo ha cambiato la stessa pagina: teniamo entrambe le versioni.
        const mine = it.d;
        const theirs = await decryptRow(server);
        S.items.set(id, theirs);
        await idbItems.putMany([server]);
        const copy = uuid();
        save(copy, { kind: 'page', parent_id: theirs.parent_id, sort: theirs.sort + 1, d: { ...mine, title: (mine.title || 'Senza titolo') + ' (copia in conflitto)' } });
        toast('La pagina era stata modificata su un altro dispositivo: la tua versione è stata salvata come copia.');
        emit();
        return;
      }
      it.rev = server.rev;
      return send(id, patch, quiet, true);
    }
    if (isOffline(e)) setOffline(true);
    if (!quiet) toast(isOffline(e) ? 'Connessione persa: la modifica non è stata salvata.' : e.message);
    throw e;
  }
}

export function create(kind, parentId, d, extra = {}) {
  const id = extra.id || uuid();
  const sort = extra.sort !== undefined ? extra.sort : nextSort(parentId, kind, extra.first);
  save(id, { kind, parent_id: parentId, sort, d, ...extra.plain });
  return id;
}

export function update(id, fn) {
  const it = S.items.get(id);
  if (!it || !it.d) return;
  const d = structuredClone(it.d);
  fn(d);
  return save(id, { d });
}

export function descendants(id) {
  const out = [];
  const walk = pid => { for (const it of S.items.values()) if (it.parent_id === pid && !it.purged) { out.push(it); walk(it.id); } };
  walk(id);
  return out;
}

/** Sposta nel cestino l'elemento e tutto ciò che contiene. */
export async function trash(id) {
  const now = new Date().toISOString();
  const list = [S.items.get(id), ...descendants(id).filter(x => !x.deleted_at)];
  await batch(list.map(x => ({ id: x.id, deleted: true })), now);
}
export async function restore(id) {
  const root = S.items.get(id);
  if (!root) return;
  const t = new Date(root.deleted_at).getTime();
  const list = [root, ...descendants(id).filter(x => x.deleted_at && Math.abs(new Date(x.deleted_at).getTime() - t) < 15000)];
  // Se il contenitore non esiste più, la pagina torna nella prima sezione.
  const parent = root.parent_id && S.items.get(root.parent_id);
  const ops = list.map(x => ({ id: x.id, deleted: false }));
  if (root.parent_id && (!parent || parent.deleted_at)) {
    // Contenitore sparito: la pagina o il gruppo tornano nella prima sezione, la sezione nel primo taccuino.
    const want = { page: 'section', group: 'section', section: 'notebook', task: 'list' }[root.kind];
    const fallback = want ? (all(want).sort(bySort)[0] || {}).id : null;
    ops[0].parent_id = fallback || null;
  }
  await batch(ops);
}
export async function purge(id) {
  const list = [S.items.get(id), ...descendants(id)].filter(Boolean);
  const ops = list.map(x => ({ id: x.id, purge: true }));
  for (const x of list) S.items.delete(x.id);
  emit();
  await api('POST', 'items/batch', { ops });
  await idbItems.delMany(list.map(x => x.id));
}

/** Più modifiche in chiaro (ordine, cestino, spostamenti) in una sola chiamata. */
export async function batch(ops, deletedAt) {
  const now = deletedAt || new Date().toISOString();
  const body = [];
  for (const op of ops) {
    const it = S.items.get(op.id);
    if (!it) continue;
    for (const k of ['parent_id', 'sort', 'completed', 'due_at', 'remind_at']) if (k in op) it[k] = op[k];
    if ('deleted' in op) it.deleted_at = op.deleted ? now : null;
    const b = { id: op.id, kind: it.kind, base_rev: it.rev, force: true };
    for (const k of ['parent_id', 'sort', 'completed', 'due_at', 'remind_at', 'deleted']) if (k in op) b[k] = op[k];
    if (op.d) { it.d = op.d; b.data = await S.space.encItem(op.id, op.d); }
    body.push(b);
  }
  emit();
  if (!body.length) return;
  for (const b of body) pending.add(b.id);
  try {
    const r = await api('POST', 'items/batch', { ops: body });
    const rows = [];
    for (const res of r.results) {
      const it = S.items.get(res.id);
      if (!it || res.error) continue;
      Object.assign(it, { rev: res.rev, seq: res.seq, deleted_at: res.deleted_at, updated_at: res.updated_at });
      rows.push(it);
    }
    const upd = [];
    for (const it of rows) {
      const b = body.find(x => x.id === it.id);
      if (b.data) it._raw = b.data;
      upd.push(toRow(it, it._raw));
    }
    await idbItems.putMany(upd);
  } catch (e) {
    toast(isOffline(e) ? 'Connessione persa: la modifica non è stata salvata.' : e.message);
    throw e;
  } finally {
    for (const b of body) pending.delete(b.id);
  }
}

// ---------- dati grandi (immagini, allegati, disegni) ----------
const urlCache = new Map();
async function fetchRaw(id) {
  const it = S.items.get(id);
  const key = `${id}@${it ? it.rev : 0}`;
  let raw = await idbBlobs.get(key);
  if (!raw) {
    const r = await api('GET', `items/${encodeURIComponent(id)}`);
    raw = r.data;
    if (raw) await idbBlobs.set(key, raw);
  }
  return raw;
}
export async function blobURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const raw = await fetchRaw(id);
  if (!raw) throw new Error('vuoto');
  const { meta, bytes } = await S.space.decBytes(id, raw);
  const u = URL.createObjectURL(new Blob([bytes], { type: meta.type || 'application/octet-stream' }));
  const out = { url: u, meta };
  urlCache.set(id, out);
  return out;
}
export async function blobBytes(id) {
  const raw = await fetchRaw(id);
  return S.space.decBytes(id, raw);
}
export async function putBlob(meta, bytes, parentId) {
  const id = uuid();
  const raw = await S.space.encBytes(id, meta, bytes);
  const it = { id, kind: 'blob', parent_id: parentId, sort: 0, d: { lazy: true, name: meta.name, type: meta.type, size: bytes.length }, rev: 0, lazy: true, created_at: new Date().toISOString() };
  S.items.set(id, it);
  urlCache.set(id, { url: URL.createObjectURL(new Blob([bytes], { type: meta.type })), meta });
  await save(id, { kind: 'blob', parent_id: parentId, sort: 0, raw });
  await idbBlobs.set(`${id}@${S.items.get(id).rev}`, raw);
  return id;
}

const drawCache = new Map();
export async function getDrawing(id) {
  const it = S.items.get(id);
  const key = `${id}@${it ? it.rev : 0}`;
  if (drawCache.has(key)) return drawCache.get(key);
  const raw = await fetchRaw(id);
  const d = await S.space.decItem(id, raw);
  drawCache.set(key, d);
  return d;
}
export async function saveDrawing(id, parentId, data) {
  const isNew = !S.items.get(id);
  const raw = await S.space.encItem(id, data);
  if (isNew) S.items.set(id, { id, kind: 'drawing', parent_id: parentId, sort: 0, rev: 0, lazy: true, d: { lazy: true }, created_at: new Date().toISOString() });
  await save(id, { kind: 'drawing', parent_id: parentId, raw, d: { lazy: true } });
  const rev = S.items.get(id).rev;
  drawCache.set(`${id}@${rev}`, data);
  await idbBlobs.set(`${id}@${rev}`, raw);
  return id;
}

export function forgetMemory() {
  S.space = null; S.priv = null; S.vault = null;
  S.items.clear();
  for (const v of urlCache.values()) URL.revokeObjectURL(v.url);
  urlCache.clear(); drawCache.clear();
}

/** Dati cifrati così come stanno sul server (per il backup). */
export async function rawOf(id) {
  const it = S.items.get(id);
  if (it && it._raw) return it._raw;
  return fetchRaw(id);
}
