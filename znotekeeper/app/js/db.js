// IndexedDB: copia locale (cifrata) per l'uso offline in sola lettura.
const NAME = 'znotekeeper';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const kv = {
  get: k => open().then(d => req(d.transaction('kv').objectStore('kv').get(k))),
  set: (k, v) => tx('kv', 'readwrite', s => { s.put(v, k); }),
  del: k => tx('kv', 'readwrite', s => { s.delete(k); }),
};

export const items = {
  all: () => open().then(d => req(d.transaction('items').objectStore('items').getAll())),
  putMany: list => tx('items', 'readwrite', s => { for (const it of list) s.put(it); }),
  delMany: ids => tx('items', 'readwrite', s => { for (const id of ids) s.delete(id); }),
  clear: () => tx('items', 'readwrite', s => { s.clear(); }),
};

export const blobs = {
  get: k => open().then(d => req(d.transaction('blobs').objectStore('blobs').get(k))),
  set: (k, v) => tx('blobs', 'readwrite', s => { s.put(v, k); }),
  del: k => tx('blobs', 'readwrite', s => { s.delete(k); }),
  clear: () => tx('blobs', 'readwrite', s => { s.clear(); }),
};

export async function wipeAll() {
  await items.clear();
  await blobs.clear();
  await tx('kv', 'readwrite', s => { s.clear(); });
}
