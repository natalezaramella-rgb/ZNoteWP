// «I miei secrets»: gestore di password (voci con utente, password, indirizzo, note, tag, campi extra),
// cartelle personali e condivisione cifrata con gli altri utenti del sito (sola lettura o modifica).
import { api, isOffline } from './api.js';
import { kv } from './db.js';
import { S } from './store.js';
import * as store from './store.js';
import { app } from './ctx.js';
import { ic } from './icons.js';
import { $, $$, esc, sheet, drawer, closeOverlay, confirmDialog, promptDialog, choose, toast, toastErr, fmtWhen } from './ui.js';
import { uuid, rand } from './crypto.js';
import * as K from './share.js';

const FOLDER = 'vfolder';
const PERM = { owner: 'Proprietario', write: 'Può modificare', read: 'Sola lettura' };

// ---------- stato (solo in memoria, si azzera al blocco) ----------
const V = {
  keys: null, // chiavi private aperte
  keysBusy: null,
  entries: new Map(), // id → { row, d, key, err, check }
  people: new Map(), // uid → { id, name, login, pub_enc, pub_sig }
  dir: null, // utenti a cui si può condividere
  stamp: null,
  loaded: false,
  failed: null,
  at: 0,
  busy: null,
  hw: {}, // revisione più alta vista per voce (per accorgersi di versioni vecchie riproposte)
};
const me = () => (V.keys ? V.keys.uid : 0);
window.addEventListener('focus', () => { if (S.space && V.loaded && app.R && app.R.view === 'vault') refresh(); });

export function forget() {
  V.keys = null; V.keysBusy = null; V.entries.clear(); V.people.clear(); V.dir = null; V.stamp = null; V.loaded = false; V.failed = null; V.busy = null;
  D = null; draftNew = null;
}

// ---------- chiavi ----------
/** Crea le chiavi di condivisione al primo sblocco (servono anche per ricevere condivisioni). */
export function ensureKeys() {
  if (V.keys) return Promise.resolve(V.keys);
  if (V.keysBusy) return V.keysBusy;
  V.keysBusy = (async () => {
    let r;
    try {
      r = await api('GET', 'vault/keys', undefined, { quiet: true });
      await kv.set('vault-keys', r);
    } catch (e) {
      if (!isOffline(e)) throw e;
      r = await kv.get('vault-keys');
      if (!r || !r.keys) throw e;
    }
    if (!r.keys) {
      const nk = await K.newUserKeys(S.space);
      try { r = await api('POST', 'vault/keys', nk, { quiet: true }); } catch (e) { if (e.status !== 409) throw e; r = await api('GET', 'vault/keys', undefined, { quiet: true }); }
      await kv.set('vault-keys', r);
    }
    V.keys = await K.openUserKeys(S.space, r.uid, r.keys);
    return V.keys;
  })().catch(e => { V.keysBusy = null; throw e; });
  return V.keysBusy;
}

// ---------- caricamento e decifratura ----------
const pins = () => store.settings().vpins || {};

async function personFp(p) { return p && p.pub_enc ? K.fingerprint(p.id, p.pub_enc, p.pub_sig) : null; }

/** Primo incontro: si ricorda l'impronta delle chiavi di ciascun utente. Se poi cambia, lo diciamo. */
async function pinCheck(uid) {
  if (uid === me()) return 'ok';
  const p = V.people.get(uid);
  const fp = await personFp(p);
  if (!fp) return 'missing';
  const known = pins()[uid];
  if (!known) { newPins[uid] = fp; return 'new'; }
  return known === fp ? 'ok' : 'changed';
}
let newPins = {};
function savePins() {
  const add = newPins; newPins = {};
  if (!Object.keys(add).length || S.offline || !store.get('settings')) return;
  store.update('settings', d => { d.vpins = { ...(d.vpins || {}), ...add }; });
}
const pubSig = uid => (uid === me() ? V.keys.pub_sig : (V.people.get(uid) || {}).pub_sig);

async function decryptEntry(row) {
  const out = { row, d: null, key: null, err: null, check: { ok: true, notes: [] } };
  try {
    if (row.wkv !== row.kv) throw new Error('La tua chiave per questa voce non è aggiornata: chiedi al proprietario di condividerla di nuovo.');
    out.key = await K.unwrap(V.keys, row.wrapped, K.wrapCtx(row.id, me(), row.wkv));
    out.d = await K.openEntry(out.key, row.id, row.kv, row.data);
  } catch (e) {
    out.err = e && e.message && !/operation|decrypt/i.test(e.message) ? e.message : 'Impossibile decifrare questa voce.';
    return out;
  }
  // Controlli: elenco dei membri firmato dal proprietario, contenuto firmato da chi poteva scriverlo.
  const c = out.check;
  const warn = m => { c.ok = false; c.notes.push(m); };
  const ownerPub = pubSig(row.owner);
  const acl = ownerPub ? await K.verifyAcl(ownerPub, row.acl) : null;
  if (!acl || acl.id !== row.id || acl.owner !== row.owner || acl.kv !== row.kv) warn('L\'elenco dei permessi non porta una firma valida del proprietario.');
  const by = row.data.by;
  const byPerm = acl && acl.m ? acl.m[by] : null;
  if (acl && by !== row.owner && byPerm !== 'write') warn('L\'ultima modifica è di un utente che non aveva il permesso di modificare.');
  if (!pubSig(by) || !await K.verifyEntry(pubSig(by), row.id, row.kv, row.data)) warn('La firma dell\'ultima modifica non è valida.');
  for (const u of new Set([row.owner, by])) {
    const st = await pinCheck(u);
    if (st === 'changed') warn(`Le chiavi di ${nameOf(u)} sono cambiate rispetto a quelle che conoscevi: verifica il codice di sicurezza.`);
  }
  if ((V.hw[row.id] || 0) > row.data.n) warn('Il sito ha mostrato una versione più vecchia di una già vista.');
  else V.hw[row.id] = row.data.n;
  // I permessi veri sono quelli firmati: se il sito dice di più, vale la firma.
  c.perm = row.owner === me() ? 'owner' : (acl && acl.m && acl.m[me()] === 'write' && row.perm === 'write') ? 'write' : 'read';
  return out;
}

function ingest(r) {
  for (const p of r.people || []) V.people.set(p.id, p);
  V.stamp = r.stamp;
}

/** Scarica le voci (se cambiate) e le decifra. */
export function refresh(force = false) {
  if (!S.space) return Promise.resolve();
  if (V.busy) return V.busy;
  V.busy = (async () => {
    await ensureKeys();
    if (!Object.keys(V.hw).length) V.hw = (await kv.get('vault-hw')) || {};
    let r;
    try {
      r = await api('GET', 'vault' + (V.stamp && !force && V.loaded ? `?stamp=${V.stamp}` : ''), undefined, { quiet: true });
      if (r.same) return;
      await kv.set('vault-cache', r);
    } catch (e) {
      if (!isOffline(e) || V.loaded) throw e;
      r = await kv.get('vault-cache');
      if (!r) { V.loaded = true; return; }
    }
    ingest(r);
    const m = new Map();
    for (const row of r.entries) {
      const cur = V.entries.get(row.id);
      if (cur && cur.row.rev === row.rev && cur.row.kv === row.kv && cur.d) { m.set(row.id, { ...cur, row }); continue; }
      m.set(row.id, await decryptEntry(row));
    }
    V.entries = m;
    V.loaded = true;
    savePins();
    kv.set('vault-hw', V.hw).catch(() => {});
    V.failed = null;
  })().catch(e => { V.failed = e.message || 'Errore'; if (!isOffline(e)) console.warn(e); }).finally(() => { V.busy = null; V.at = Date.now(); if (app.R && app.R.view === 'vault') app.render(); });
  return V.busy;
}

async function loadDir() {
  const list = await api('GET', 'vault/people');
  for (const p of list) V.people.set(p.id, p);
  V.dir = list;
  return list;
}

// ---------- utilità ----------
const nameOf = uid => (uid === me() ? 'te' : (V.people.get(uid) || {}).name || 'utente ' + uid);
const titleOf = e => (e.d && e.d.title) || (e.err ? 'Voce non leggibile' : 'Senza titolo');
const isMine = e => e.row.owner === me();
const permOf = e => (isMine(e) ? 'owner' : e.check.perm || e.row.perm);
const canEdit = e => !S.offline && e.d && !e.row.trashed_at && (permOf(e) === 'owner' || permOf(e) === 'write');
const folders = () => store.all(FOLDER).sort((a, b) => (a.d.name || '').localeCompare(b.d.name || '', 'it', { sensitivity: 'base' }));
const folderName = id => { const f = id && store.get(id); return f && store.alive(f) ? f.d.name : ''; };
/** Solo link web: un indirizzo scritto da altri non deve poter eseguire codice (javascript:, data:…). */
const safeUrl = u => { try { const x = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + String(u).replace(/^[a-z][a-z0-9+.-]*:\/*/i, '')); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } };
const hostOf = u => { try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : 'https://' + u).hostname; } catch (e) { return u || ''; } };
const live = () => [...V.entries.values()].filter(e => !e.row.trashed_at);
function allTags() {
  const m = new Map();
  for (const e of live()) for (const t of (e.d && e.d.tags) || []) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'it', { sensitivity: 'base' }));
}
function inFolderTree(fid, root) {
  let f = fid && store.get(fid); let n = 0;
  while (f && n++ < 30) { if (f.id === root) return true; f = f.parent_id && store.get(f.parent_id); }
  return false;
}
function scopeEntries(scope) {
  if (scope === 'trash') return [...V.entries.values()].filter(e => e.row.trashed_at && isMine(e));
  const l = live();
  if (scope === 'fav') return l.filter(e => e.row.fav);
  if (scope === 'shared') return l.filter(e => !isMine(e));
  if (scope === 'byme') return l.filter(e => isMine(e) && e.row.members.length > 1);
  if (scope && scope.startsWith('f:')) return l.filter(e => inFolderTree(e.row.folder_id, scope.slice(2)));
  if (scope && scope.startsWith('t:')) return l.filter(e => ((e.d && e.d.tags) || []).includes(scope.slice(2)));
  return l;
}
function scopeTitle(scope) {
  if (scope === 'trash') return 'Cestino';
  if (scope === 'fav') return 'Preferiti';
  if (scope === 'shared') return 'Condivisi con me';
  if (scope === 'byme') return 'Condivisi da me';
  if (scope && scope.startsWith('f:')) return folderName(scope.slice(2)) || 'Cartella';
  if (scope && scope.startsWith('t:')) return '#' + scope.slice(2);
  return 'Tutti i secrets';
}

let clipT = null;
async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copiat${/password/i.test(what) ? 'a' : 'o'}: tra 30 secondi la tolgo dagli appunti.`);
    clearTimeout(clipT);
    clipT = setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}); }, 30000);
  } catch (e) { toast('Copia non riuscita.'); }
}

// ---------- generatore di password ----------
const SETS = { up: 'ABCDEFGHJKLMNPQRSTUVWXYZ', low: 'abcdefghijkmnpqrstuvwxyz', num: '23456789', sym: '!#$%&*+-=?@^_~.,:;' };
export function genPassword(len = 20, use = { up: 1, low: 1, num: 1, sym: 1 }) {
  const sets = Object.keys(SETS).filter(k => use[k]).map(k => SETS[k]);
  if (!sets.length) sets.push(SETS.low);
  const all = sets.join('');
  const lim = 256 - (256 % all.length);
  for (;;) {
    let s = '';
    while (s.length < len) for (const x of rand(len)) if (x < lim && s.length < len) s += all[x % all.length];
    if (len < sets.length || sets.every(set => [...s].some(c => set.includes(c)))) return s;
  }
}
function genDialog() {
  return new Promise(res => {
    let done = false;
    const st = (() => { try { return JSON.parse(localStorage.getItem('znk-vgen')) || null; } catch (e) { return null; } })() || { len: 20, up: 1, low: 1, num: 1, sym: 1 };
    const el = sheet(`<h3>Genera password</h3>
      <div class="vgen-out" id="gOut"></div>
      <label class="flab" for="gLen">Lunghezza: <span id="gLenV">${st.len}</span></label>
      <input type="range" id="gLen" min="8" max="64" value="${st.len}" style="width:100%">
      <div class="vgen-sets">${[['up', 'Maiuscole'], ['low', 'Minuscole'], ['num', 'Numeri'], ['sym', 'Simboli']].map(([k, l]) => `<label><input type="checkbox" data-s="${k}" ${st[k] ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="row-end"><button class="btn ghost" data-g="again">${ic('restore')}Rigenera</button><button class="btn ghost" data-close>Annulla</button><button class="btn primary" data-g="use">Usa questa</button></div>`,
    { onClose: () => { if (!done) res(null); }, label: 'Genera password' });
    let cur = '';
    const paint = () => { cur = genPassword(st.len, st); $('#gOut', el).textContent = cur; $('#gLenV', el).textContent = st.len; try { localStorage.setItem('znk-vgen', JSON.stringify(st)); } catch (e) { /* */ } };
    paint();
    $('#gLen', el).addEventListener('input', e => { st.len = +e.target.value; paint(); });
    el.addEventListener('change', e => { const s = e.target.dataset.s; if (s) { st[s] = e.target.checked ? 1 : 0; paint(); } });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-g]');
      if (!b) return;
      if (b.dataset.g === 'again') paint();
      else { done = true; closeOverlay(); res(cur); }
    });
  });
}

// ---------- albero (cartelle, tag, viste) ----------
const scope = () => app.R.vscope || 'all';
function treeHTML() {
  const cur = scope();
  const n = s => scopeEntries(s).length;
  const q = (id, icon, label) => `<button class="quick" data-v="scope" data-id="${id}" aria-current="${cur === id}">${ic(icon)}${esc(label)}<span class="vcnt">${n(id) || ''}</span></button>`;
  const fl = folders();
  const kids = pid => fl.filter(f => (f.parent_id || null) === pid || (pid === null && f.parent_id && !store.alive(store.get(f.parent_id))));
  const walk = (pid, depth) => kids(pid).map(f => `<div class="row"><button class="sec ${depth ? '' : 'top'}" style="padding-left:${10 + depth * 18}px" data-v="scope" data-id="f:${f.id}" aria-current="${cur === 'f:' + f.id}">${ic('folder', 'sm')}<span class="nm">${esc(f.d.name)}</span><span class="cnt">${n('f:' + f.id) || ''}</span></button>
      <button class="ib more needs-net" data-v="fmenu" data-id="${f.id}" aria-label="Azioni cartella ${esc(f.d.name)}">${ic('more')}</button></div>${depth < 5 ? walk(f.id, depth + 1) : ''}`).join('');
  const tags = allTags();
  return `<div class="dh"><div style="display:flex;align-items:center"><h2 class="big" style="font-size:24px;flex:1">I miei secrets</h2><button class="ib" data-only="desk" data-fold="tree" aria-label="Nascondi cartelle" title="Nascondi cartelle (Ctrl+\\)">${ic('panel')}</button></div></div>
    <div class="tree">
      ${q('all', 'key', 'Tutti')}
      ${q('fav', 'star', 'Preferiti')}
      ${q('shared', 'inbox', 'Condivisi con me')}
      ${q('byme', 'fwd', 'Condivisi da me')}
      <hr><div class="vhead">Cartelle</div>
      ${walk(null, 0) || '<div class="crumb" style="padding:6px 10px;color:var(--muted);font-size:13px">Nessuna cartella</div>'}
      <button class="add needs-net" data-v="newfolder">${ic('plus')}Nuova cartella</button>
      ${tags.length ? `<hr><div class="vhead">Tag</div><div class="vtags">${tags.map(([t, c]) => `<button class="chip list" data-v="scope" data-id="t:${esc(t)}" aria-current="${cur === 't:' + t}">#${esc(t)} <small>${c}</small></button>`).join('')}</div>` : ''}
      <hr>
      ${q('trash', 'trash', 'Cestino')}
      <button class="quick" data-v="myfp">${ic('shield')}Il mio codice di sicurezza</button>
    </div>`;
}
async function onTreeClick(e) {
  const b = e.target.closest('[data-v]');
  if (!b) return;
  switch (b.dataset.v) {
    case 'scope': closeOverlay(); app.go({ view: 'vault', vscope: b.dataset.id, vent: app.desk ? app.R.vent : null }); break;
    case 'newfolder': closeOverlay(); newFolder(scope().startsWith('f:') ? scope().slice(2) : null); break;
    case 'fmenu': folderMenu(b.dataset.id); break;
    case 'myfp': myFpDialog(); break;
  }
}
export function renderTree(el) {
  el.innerHTML = treeHTML();
  if (!el._vb) { el._vb = true; el.addEventListener('click', onTreeClick); }
}
function openDrawer() { const d = drawer(treeHTML()); d.addEventListener('click', onTreeClick); }

async function newFolder(parent = null) {
  if (!store.canWrite()) return;
  const r = await promptDialog(parent ? `Nuova cartella in «${folderName(parent)}»` : 'Nuova cartella', { label: 'Nome', placeholder: 'Es. Banche', ok: 'Crea' });
  if (!r || !r.value) return;
  const id = store.create(FOLDER, parent, { name: r.value });
  app.go({ view: 'vault', vscope: 'f:' + id, vent: null });
}
async function folderMenu(id) {
  const f = store.get(id);
  if (!f) return;
  const a = await choose(f.d.name, [
    { label: 'Rinomina', icon: 'pen', value: 'ren' },
    { label: 'Nuova sottocartella', icon: 'folder', value: 'sub' },
    { label: 'Elimina cartella', icon: 'trash', value: 'del', danger: true, hint: 'Le voci restano, fuori dalla cartella' },
  ]);
  if (!a || !store.canWrite()) return;
  if (a === 'ren') { const r = await promptDialog('Rinomina cartella', { label: 'Nome', value: f.d.name }); if (r && r.value) store.update(id, d => { d.name = r.value; }); }
  if (a === 'sub') newFolder(id);
  if (a === 'del') {
    if (!await confirmDialog('Eliminare la cartella?', `Le voci di «${esc(f.d.name)}» e delle sue sottocartelle non vengono eliminate: tornano fuori dalle cartelle.`, { ok: 'Elimina', danger: true })) return;
    const sub = store.descendants(id).filter(x => x.kind === FOLDER).map(x => x.id);
    const gone = new Set([id, ...sub]);
    for (const e of V.entries.values()) if (gone.has(e.row.folder_id)) await setMine(e.row.id, { folder_id: null }).catch(() => {});
    await store.purge(id);
    if (gone.has(scope().slice(2))) app.go({ vscope: 'all' });
    else app.render();
  }
}
async function myFpDialog() {
  try { await ensureKeys(); } catch (e) { toastErr(e); return; }
  sheet(`<h3>Il tuo codice di sicurezza</h3>
    <p class="muted">Chi condivide con te usa le tue chiavi pubbliche, che il sito custodisce. Per essere sicuri che il sito non le abbia scambiate, confrontate questo codice di persona o al telefono: nell'app dell'altro utente, alla voce «Condividi», deve comparire identico accanto al tuo nome.</p>
    <div class="vfp">${K.fmtFp(V.keys.fp)}</div>
    <div class="row-end"><button class="btn primary" data-close>Chiudi</button></div>`, { label: 'Codice di sicurezza' });
}

// ---------- elenco ----------
let filter = '';
export function renderList(el) {
  if ((!V.loaded && !V.failed) || (V.loaded && Date.now() - V.at > 5000)) refresh();
  if (!el._vb) {
    el._vb = true;
    el.innerHTML = `
      <div class="topbar">
        <button class="ib" data-v="drawer" data-only="phone" aria-label="Cartelle e viste">${ic('menu')}</button>
        <div class="grow" style="padding-left:6px"><div class="apptitle" id="vScope"></div></div>
        <button class="ib" data-v="lock" data-only="phone" aria-label="Blocca">${ic('lock')}</button>
        <button class="ib" data-only="desk" data-fold="list" aria-label="Nascondi elenco" title="Nascondi elenco dei secrets (Ctrl+\\)">${ic('panel')}</button>
      </div>
      <label class="searchbox">${ic('search')}<input id="vQ" type="search" placeholder="Cerca titolo, utente, indirizzo, tag" aria-label="Cerca nei secrets" autocomplete="off"></label>
      <div class="scroll" id="vRows"></div>
      <button class="fab needs-net" data-v="add">${ic('plus')}Secret</button>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      if (b.dataset.v === 'open') app.go({ view: 'vault', vent: b.dataset.id });
      else if (b.dataset.v === 'add') addEntry();
      else if (b.dataset.v === 'drawer') openDrawer();
      else if (b.dataset.v === 'lock') app.lock();
      else if (b.dataset.v === 'retry') { V.failed = null; refresh(true); app.render(); }
    });
    $('#vQ', el).addEventListener('input', e => { filter = e.target.value.trim().toLowerCase(); paintRows(el); });
  }
  $('#vScope', el).textContent = scopeTitle(scope());
  paintRows(el);
}
function matches(e) {
  if (!filter) return true;
  const d = e.d || {};
  return [d.title, d.user, d.url, d.notes, ...(d.tags || []).map(t => '#' + t), ...(d.fields || []).filter(f => !f.h).map(f => f.k + ' ' + f.v), isMine(e) ? '' : nameOf(e.row.owner)]
    .some(v => String(v || '').toLowerCase().includes(filter));
}
function rowChips(e) {
  const c = [];
  if (!isMine(e)) c.push(`<span class="chip mail">da ${esc(nameOf(e.row.owner))}</span>`);
  else if (e.row.members.length > 1) c.push(`<span class="chip tag">condivisa con ${e.row.members.length - 1}</span>`);
  if (!isMine(e) && permOf(e) === 'read') c.push('<span class="chip">sola lettura</span>');
  if (e.err || !e.check.ok) c.push('<span class="chip late">da verificare</span>');
  for (const t of ((e.d && e.d.tags) || []).slice(0, 3)) c.push(`<span class="chip">#${esc(t)}</span>`);
  return c.join(' ');
}
function paintRows(el) {
  const box = $('#vRows', el);
  if (!V.loaded) {
    box.innerHTML = V.failed ? `<div class="empty"><b>Non riesco ad aprire i secrets</b>${esc(V.failed)}<br><br><button class="btn ghost" data-v="retry">Riprova</button></div>` : '<div class="empty"><b>Apro i secrets…</b></div>';
    return;
  }
  const rows = scopeEntries(scope()).filter(matches).sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'it', { sensitivity: 'base' }));
  const cur = app.R.vent;
  const sc = scope();
  box.innerHTML = rows.length ? rows.map(e => `
    <div class="page-row ${e.row.id === cur ? 'sel' : ''}" data-v="open" data-id="${esc(e.row.id)}">
      <div class="vico">${ic(isMine(e) ? 'key' : 'inbox')}</div>
      <div class="pg"><div class="pt">${e.row.fav ? ic('star', 'vstar') : ''}${esc(titleOf(e))}</div>
        <div class="ps">${esc([e.d && e.d.user, e.d && e.d.url ? hostOf(e.d.url) : ''].filter(Boolean).join(' · ') || (e.err ? e.err : ''))}</div>
        <div class="vchips">${rowChips(e)}</div></div>
    </div>`).join('') + '<div style="height:90px"></div>'
    : `<div class="empty"><b>${filter ? 'Nessun secret trovato' : sc === 'shared' ? 'Nessuna condivisione' : sc === 'trash' ? 'Cestino vuoto' : 'Nessun secret'}</b>${
      filter ? 'Prova con altre parole.'
        : sc === 'shared' ? 'Qui compaiono le voci che altri utenti del sito condividono con te.'
          : sc === 'trash' ? 'Le voci eliminate restano qui finché non le elimini definitivamente.'
            : 'Salva qui accessi, password e codici: sono cifrati sul tuo dispositivo e puoi condividerli con altri utenti del sito.'}</div>`;
}

// ---------- dettaglio ----------
let D = null; // { id, edit }
let draftNew = null; // voce nuova non ancora salvata
export function flush() { /* le voci si salvano solo con «Salva» */ }
export const dirty = () => !!(D && D.edit && D.el && D.el.isConnected && D.changed);

function addEntry() {
  if (!store.canWrite()) return;
  const sc = scope();
  draftNew = { id: uuid(), folder_id: sc.startsWith('f:') ? sc.slice(2) : null, d: { title: '', user: '', pw: genPassword(), url: '', notes: '', tags: sc.startsWith('t:') ? [sc.slice(2)] : [], fields: [] } };
  app.go({ view: 'vault', vent: 'new' });
}

export function renderDetail(el, id) {
  if (!el) { D = null; return; }
  if (id === 'new') {
    if (!draftNew) { app.go({ vent: null }); return; }
    if (D && D.id === 'new' && D.el === el && el.isConnected) return;
    D = { id: 'new', edit: true, el };
    paintEdit(el, null, draftNew.d);
    return;
  }
  const e = V.entries.get(id);
  if (!e) {
    el.innerHTML = `<div class="topbar"><button class="ib" data-v="back" data-only="phone" aria-label="Indietro">${ic('back')}</button></div><div class="empty"><b>${V.loaded ? 'Voce non disponibile' : 'Apro…'}</b>${V.loaded ? 'Forse è stata eliminata o non è più condivisa con te.' : ''}</div>`;
    el.onclick = ev => { if (ev.target.closest('[data-v="back"]')) app.go({ vent: null }); };
    D = null;
    return;
  }
  // In modifica non si ridisegna (si perderebbe quello che si sta scrivendo).
  if (D && D.id === id && D.el === el && el.isConnected && (D.edit || D.rev === e.row.rev + ':' + e.row.fav + ':' + e.row.folder_id + ':' + e.row.members.length + ':' + e.row.trashed_at)) return;
  D = { id, edit: false, el, rev: e.row.rev + ':' + e.row.fav + ':' + e.row.folder_id + ':' + e.row.members.length + ':' + e.row.trashed_at };
  paintView(el, e);
}

function fieldRow(label, value, { secret = false, link = false, key = '' } = {}) {
  if (!value) return '';
  const shown = secret ? '••••••••••••' : esc(value);
  return `<div class="vfield"><div class="vlab">${esc(label)}</div>
    <div class="vval ${secret ? 'mono' : ''}" ${secret ? `data-secret="${esc(key)}"` : ''}>${link && safeUrl(value) ? `<a href="${esc(safeUrl(value))}" target="_blank" rel="noopener noreferrer">${shown}</a>` : shown}</div>
    <div class="vact">${secret ? `<button class="btn ghost small" data-v="reveal" data-k="${esc(key)}">Mostra</button>` : ''}<button class="ib" data-v="copy" data-k="${esc(key)}" aria-label="Copia ${esc(label)}" title="Copia">${ic('copy')}</button></div></div>`;
}

function valueOf(e, key) {
  const d = e.d;
  if (key === 'user') return d.user; if (key === 'pw') return d.pw; if (key === 'url') return d.url;
  if (key.startsWith('f')) { const f = (d.fields || [])[+key.slice(1)]; return f ? f.v : ''; }
  if (key.startsWith('h')) { const h = (d.hist || [])[+key.slice(1)]; return h ? h.pw : ''; }
  return '';
}

function paintView(el, e) {
  const d = e.d || {};
  const mine = isMine(e);
  const perm = permOf(e);
  const trashed = !!e.row.trashed_at;
  const others = e.row.members.filter(m => m.user_id !== e.row.owner);
  el.innerHTML = `
    <div class="topbar">
      <button class="ib" data-v="back" data-only="phone" aria-label="Indietro">${ic('back')}</button>
      <div class="grow" style="padding-left:6px"><div class="apptitle">${esc(titleOf(e))}</div></div>
      ${trashed ? '' : `<button class="ib ${e.row.fav ? 'on' : ''} needs-net" data-v="fav" aria-label="Preferito" title="Preferito">${ic('star')}</button>`}
      ${canEdit(e) ? `<button class="ib" data-v="edit" aria-label="Modifica" title="Modifica">${ic('pen')}</button>` : ''}
      ${trashed ? '' : `<button class="ib needs-net" data-v="menu" aria-label="Altre azioni">${ic('more')}</button>`}
    </div>
    <div class="scroll"><div class="form vform">
      ${S.offline ? '<div class="ro-note">Offline: sola lettura.</div>' : ''}
      ${trashed ? `<div class="warnbox">Nel cestino dal ${esc(fmtWhen(e.row.trashed_at))}: chi l'aveva ricevuta non la vede più.
        <div class="btnrow" style="margin-top:8px"><button class="btn primary small needs-net" data-v="restore">${ic('restore')}Ripristina</button><button class="btn danger small needs-net" data-v="purge">Elimina definitivamente</button></div></div>` : ''}
      ${e.err ? `<div class="warnbox">${esc(e.err)}</div>` : ''}
      ${!e.err && !e.check.ok ? `<div class="warnbox vwarn"><b>Attenzione</b>${e.check.notes.map(n => `<div>${esc(n)}</div>`).join('')}<div class="muted" style="margin-top:4px">Non fidarti di questi dati finché non hai verificato con ${esc(nameOf(e.row.owner))}.</div></div>` : ''}
      ${!mine ? `<div class="vshared">${ic('inbox')}<div>Condiviso da <b>${esc(nameOf(e.row.owner))}</b> · ${perm === 'write' ? 'puoi modificare i valori' : 'sola lettura'}</div></div>` : ''}
      ${e.d ? `
      ${fieldRow('Nome utente', d.user, { key: 'user' })}
      ${fieldRow('Password', d.pw, { secret: true, key: 'pw' })}
      ${fieldRow('Indirizzo', d.url, { link: true, key: 'url' })}
      ${(d.fields || []).map((f, i) => fieldRow(f.k || 'Campo', f.v, { secret: !!f.h, key: 'f' + i })).join('')}
      ${d.notes ? `<div class="vfield"><div class="vlab">Note</div><div class="vval vnotes">${esc(d.notes)}</div></div>` : ''}
      ${(d.tags || []).length ? `<div class="vfield"><div class="vlab">Tag</div><div class="vval">${d.tags.map(t => `<button class="chip list" data-v="tag" data-t="${esc(t)}">#${esc(t)}</button>`).join(' ')}</div></div>` : ''}
      <div class="vfield"><div class="vlab">Cartella</div><div class="vval">${esc(folderName(e.row.folder_id) || 'Nessuna')}</div><div class="vact">${trashed ? '' : `<button class="btn ghost small needs-net" data-v="move">Sposta</button>`}</div></div>
      ` : ''}
      ${mine && !trashed ? `<div class="vcard"><div class="vcard-h"><b>Condivisione</b><button class="btn ghost small needs-net" data-v="share">${ic('fwd')}${others.length ? 'Gestisci' : 'Condividi'}</button></div>
        ${others.length ? others.map(m => `<div class="vmem"><span>${esc(nameOf(m.user_id))}</span><span class="chip ${m.perm === 'write' ? 'tag' : ''}">${PERM[m.perm]}</span></div>`).join('') : '<div class="muted" style="font-size:13px">Solo tu vedi questa voce.</div>'}</div>` : ''}
      ${!mine && others.length > 1 ? `<div class="vcard"><div class="vcard-h"><b>Chi altro la vede</b></div>${others.filter(m => m.user_id !== me()).map(m => `<div class="vmem"><span>${esc(nameOf(m.user_id))}</span><span class="chip">${PERM[m.perm]}</span></div>`).join('')}</div>` : ''}
      ${(d.hist || []).length ? `<details class="vcard"><summary><b>Valori precedenti</b> (${d.hist.length})</summary>${d.hist.map((h, i) => `<div class="vfield"><div class="vlab">${esc(fmtWhen(h.at))} · ${esc(nameOf(h.by))}${h.user && h.user !== d.user ? ' · utente ' + esc(h.user) : ''}</div>
        <div class="vval mono" data-secret="h${i}">••••••••</div><div class="vact"><button class="btn ghost small" data-v="reveal" data-k="h${i}">Mostra</button><button class="ib" data-v="copy" data-k="h${i}" aria-label="Copia">${ic('copy')}</button></div></div>`).join('')}</details>` : ''}
      <div class="vmeta muted">Creata ${esc(fmtWhen(e.row.created_at))}${e.row.data && e.row.updated_at ? ` · modificata ${esc(fmtWhen(e.row.updated_at))} da ${esc(nameOf(e.row.data.by))}` : ''}${e.check.ok && !e.err ? ' · firma verificata' : ''}</div>
    </div></div>`;
  el.onclick = ev => onViewClick(ev, e.row.id, el);
}

async function onViewClick(ev, id, el) {
  const b = ev.target.closest('[data-v]');
  if (!b) return;
  const e = V.entries.get(id);
  if (!e) return;
  switch (b.dataset.v) {
    case 'back': app.go({ vent: null }); break;
    case 'copy': copy(valueOf(e, b.dataset.k), b.dataset.k === 'pw' || b.dataset.k.startsWith('h') ? 'Password' : b.dataset.k === 'user' ? 'Nome utente' : b.dataset.k === 'url' ? 'Indirizzo' : 'Valore'); break;
    case 'reveal': {
      const box = $(`[data-secret="${b.dataset.k}"]`, el);
      const on = b.textContent === 'Mostra';
      box.textContent = on ? valueOf(e, b.dataset.k) : '••••••••••••';
      b.textContent = on ? 'Nascondi' : 'Mostra';
      break;
    }
    case 'fav': setMine(id, { fav: !e.row.fav }).catch(toastErr); break;
    case 'edit': D = { id, edit: true, el }; paintEdit(el, e, e.d); break;
    case 'tag': app.go({ vscope: 't:' + b.dataset.t, vent: app.desk ? id : null }); break;
    case 'move': moveDialog(id); break;
    case 'share': shareDialog(id); break;
    case 'menu': entryMenu(id); break;
    case 'restore': try { await apiTrash(id, false); toast('Voce ripristinata.'); } catch (x) { toastErr(x); } break;
    case 'purge':
      if (!await confirmDialog('Eliminare definitivamente?', 'La voce viene cancellata dal sito e non si potrà recuperare.', { ok: 'Elimina', danger: true })) return;
      try { await api('DELETE', `vault/${encodeURIComponent(id)}`); V.entries.delete(id); app.go({ vent: null }); toast('Voce eliminata.'); } catch (x) { toastErr(x); }
      break;
  }
}

async function entryMenu(id) {
  const e = V.entries.get(id);
  const mine = isMine(e);
  const a = await choose(titleOf(e), [
    { label: 'Sposta in una cartella', icon: 'move', value: 'move' },
    ...(mine ? [{ label: 'Condividi', icon: 'fwd', value: 'share' }, { label: 'Duplica', icon: 'copy', value: 'dup' }, { sep: true }, { label: 'Sposta nel cestino', icon: 'trash', value: 'trash', danger: true }]
      : [{ label: 'Fai una mia copia', icon: 'copy', value: 'dup', hint: 'Una voce tua, non più collegata a quella condivisa' }, { sep: true }, { label: 'Togli dai miei secrets', icon: 'close', value: 'leave', danger: true }]),
  ]);
  if (!a || !store.canWrite()) return;
  if (a === 'move') moveDialog(id);
  if (a === 'share') shareDialog(id);
  if (a === 'dup') { draftNew = { id: uuid(), folder_id: e.row.folder_id, d: { ...structuredClone(e.d), title: (e.d.title || '') + ' (copia)', hist: [] } }; D = null; app.go({ vent: 'new' }); }
  if (a === 'trash') {
    const others = e.row.members.length - 1;
    if (!await confirmDialog('Spostare nel cestino?', others ? `La voce sparisce anche per le ${others === 1 ? 'una persona' : others + ' persone'} con cui l'hai condivisa (finché non la ripristini).` : 'Potrai ripristinarla dal cestino.', { ok: 'Sposta nel cestino', danger: true })) return;
    try { await apiTrash(id, true); app.go({ vent: null }); toast('Voce nel cestino.', 'Annulla', () => apiTrash(id, false).catch(toastErr)); } catch (x) { toastErr(x); }
  }
  if (a === 'leave') {
    if (!await confirmDialog('Togliere la voce?', `Non vedrai più questa voce condivisa da ${esc(nameOf(e.row.owner))}. Per riaverla dovrà condividerla di nuovo.`, { ok: 'Togli', danger: true })) return;
    try { await api('DELETE', `vault/${encodeURIComponent(id)}/mine`); V.entries.delete(id); app.go({ vent: null }); } catch (x) { toastErr(x); }
  }
}

async function apiTrash(id, on) {
  const r = await api('POST', `vault/${encodeURIComponent(id)}/trash`, { trashed: on });
  await applyRow(r);
}
async function setMine(id, patch) {
  const r = await api('PUT', `vault/${encodeURIComponent(id)}/mine`, patch);
  await applyRow(r);
}
/** Aggiorna una voce in memoria con la risposta del sito (senza aspettare il prossimo giro). */
async function applyRow(r) {
  if (!r || !r.id) return;
  const cur = V.entries.get(r.id);
  V.entries.set(r.id, cur && cur.row.rev === r.rev && cur.row.kv === r.kv && cur.d ? { ...cur, row: r } : await decryptEntry(r));
  V.stamp = null;
  app.render();
}

async function moveDialog(id) {
  const e = V.entries.get(id);
  const fl = folders();
  const path = f => { const p = []; let x = f; let n = 0; while (x && n++ < 10) { p.unshift(x.d.name); x = x.parent_id && store.get(x.parent_id); } return p.join(' › '); };
  const v = await choose('Sposta in', [{ label: 'Nessuna cartella', value: '' }, ...fl.map(f => ({ label: path(f), icon: 'folder', value: f.id })), { sep: true }, { label: 'Nuova cartella…', icon: 'plus', value: '+' }], { current: e.row.folder_id || '', text: isMine(e) ? '' : 'Le cartelle sono tue: chi ha condiviso la voce non vede dove la metti.' });
  if (v === null || v === undefined) return;
  let fid = v;
  if (v === '+') {
    const r = await promptDialog('Nuova cartella', { label: 'Nome', ok: 'Crea' });
    if (!r || !r.value) return;
    fid = store.create(FOLDER, null, { name: r.value });
  }
  try { await setMine(id, { folder_id: fid || null }); toast(fid ? `Spostata in ${folderName(fid)}.` : 'Tolta dalla cartella.'); } catch (x) { toastErr(x); }
}

// ---------- modifica ----------
function paintEdit(el, e, d0) {
  const d = structuredClone(d0 || {});
  const isNew = !e;
  el.innerHTML = `
    <div class="topbar">
      <button class="ib" data-v="cancel" aria-label="Annulla">${ic('close')}</button>
      <div class="grow" style="padding-left:6px"><div class="apptitle">${isNew ? 'Nuovo secret' : 'Modifica'}</div></div>
      <button class="btn primary small" data-v="save" style="margin-right:6px">Salva</button>
    </div>
    <div class="scroll"><form class="form vform" id="vEdit" autocomplete="off">
      ${e && !isMine(e) ? `<div class="vshared">${ic('inbox')}<div>Le modifiche arrivano anche a <b>${esc(nameOf(e.row.owner))}</b> e a chi vede questa voce.</div></div>` : ''}
      <label class="flab" for="vTitle">Titolo</label>
      <input class="field-in" id="vTitle" name="title" value="${esc(d.title || '')}" placeholder="Es. Home banking" spellcheck="false">
      <label class="flab" for="vUser">Nome utente</label>
      <input class="field-in" id="vUser" name="user" value="${esc(d.user || '')}" autocomplete="off" spellcheck="false">
      <label class="flab" for="vPw">Password</label>
      <div class="acc-pw">
        <input class="field-in mono" id="vPw" name="pw" type="password" value="${esc(d.pw || '')}" autocomplete="new-password" spellcheck="false">
        <button type="button" class="btn ghost small" data-v="pwshow">Mostra</button>
        <button type="button" class="ib" data-v="pwgen" aria-label="Genera password" title="Genera">${ic('restore')}</button>
      </div>
      <label class="flab" for="vUrl">Indirizzo</label>
      <input class="field-in" id="vUrl" name="url" type="url" value="${esc(d.url || '')}" placeholder="https://…" spellcheck="false">
      <label class="flab" for="vTags">Tag <span class="muted" style="font-weight:500">(separati da virgola)</span></label>
      <input class="field-in" id="vTags" name="tags" value="${esc((d.tags || []).join(', '))}" placeholder="lavoro, banca" spellcheck="false" list="vTagList">
      <datalist id="vTagList">${allTags().map(([t]) => `<option value="${esc(t)}">`).join('')}</datalist>
      <label class="flab">Campi aggiuntivi</label>
      <div id="vFields">${(d.fields || []).map(fieldEdit).join('')}</div>
      <button type="button" class="btn ghost small" data-v="addfield" style="align-self:flex-start">${ic('plus')}Aggiungi campo</button>
      <label class="flab" for="vNotes">Note</label>
      <textarea class="field-in" id="vNotes" name="notes" rows="4">${esc(d.notes || '')}</textarea>
      <div class="err"></div>
    </form></div>`;
  D.changed = false;
  D.base = e ? e.row.rev : 0;
  const form = $('#vEdit', el);
  form.addEventListener('input', () => { D.changed = true; });
  form.addEventListener('submit', ev => { ev.preventDefault(); doSave(el, e); });
  el.onclick = async ev => {
    const b = ev.target.closest('[data-v]');
    if (!b) return;
    const pw = $('#vPw', el);
    switch (b.dataset.v) {
      case 'cancel':
        if (D.changed && !await confirmDialog('Annullare le modifiche?', 'Quello che hai scritto non viene salvato.', { ok: 'Annulla modifiche', cancel: 'Continua', danger: true })) return;
        if (isNew) { draftNew = null; D = null; app.go({ vent: null }); } else { D = null; app.render(); }
        break;
      case 'save': doSave(el, e); break;
      case 'pwshow': pw.type = pw.type === 'password' ? 'text' : 'password'; b.textContent = pw.type === 'password' ? 'Mostra' : 'Nascondi'; break;
      case 'pwgen': { const p = await genDialog(); if (p) { pw.value = p; pw.type = 'text'; D.changed = true; } break; }
      case 'addfield': $('#vFields', el).insertAdjacentHTML('beforeend', fieldEdit({ k: '', v: '', h: false })); D.changed = true; break;
      case 'delfield': b.closest('.vfe').remove(); D.changed = true; break;
    }
  };
  if (isNew) setTimeout(() => { const t = $('#vTitle', el); if (t && !('ontouchstart' in window)) t.focus(); }, 50);
}
function fieldEdit(f) {
  return `<div class="vfe"><input class="field-in" data-f="k" value="${esc(f.k)}" placeholder="Nome (es. PIN)" spellcheck="false">
    <input class="field-in ${f.h ? 'mono' : ''}" data-f="v" value="${esc(f.v)}" placeholder="Valore" type="${f.h ? 'password' : 'text'}" autocomplete="off" spellcheck="false">
    <label class="vhid"><input type="checkbox" data-f="h" ${f.h ? 'checked' : ''}> nascosto</label>
    <button type="button" class="ib" data-v="delfield" aria-label="Togli campo">${ic('trash')}</button></div>`;
}
function readForm(el) {
  const f = $('#vEdit', el);
  const val = n => f.elements[n].value;
  const tags = [...new Set(val('tags').split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean))].slice(0, 30);
  const fields = $$('.vfe', el).map(r => ({ k: $('[data-f=k]', r).value.trim(), v: $('[data-f=v]', r).value, h: $('[data-f=h]', r).checked })).filter(x => x.k || x.v);
  return { title: val('title').trim(), user: val('user'), pw: val('pw'), url: val('url').trim(), notes: val('notes'), tags, fields };
}

let saving = false;
async function doSave(el, e, force = false) {
  if (saving || !store.canWrite()) return;
  const nd = readForm(el);
  if (!nd.title && !nd.user && !nd.url) { $('.err', el).textContent = 'Scrivi almeno un titolo.'; return; }
  saving = true;
  try {
    const keys = await ensureKeys();
    if (!e) {
      const id = draftNew.id;
      const key = K.newEntryKey();
      const body = {
        kv: 1,
        data: await K.sealEntry(key, keys, id, 1, 1, { ...nd, hist: [] }),
        wrapped: await K.wrapFor(key, keys.pub_enc, K.wrapCtx(id, keys.uid, 1)),
        acl: await K.signAcl(keys, id, 1, { [keys.uid]: 'owner' }),
        folder_id: draftNew.folder_id,
      };
      const r = await api('PUT', `vault/${encodeURIComponent(id)}`, body);
      draftNew = null;
      D = null;
      await applyRow(r);
      app.go({ vent: id }, { replace: true });
      toast('Secret salvato.');
      return;
    }
    const cur = V.entries.get(e.row.id) || e;
    if (cur.row.rev !== D.base && !force) {
      saving = false;
      return conflict(el, cur);
    }
    const old = cur.d;
    const hist = [...(old.hist || [])];
    if (old.pw && old.pw !== nd.pw) hist.unshift({ pw: old.pw, user: old.user, at: new Date().toISOString(), by: keys.uid });
    const obj = { ...nd, hist: hist.slice(0, 20) };
    const body = { kv: cur.row.kv, base_rev: cur.row.rev, data: await K.sealEntry(cur.key, keys, cur.row.id, cur.row.kv, cur.row.rev + 1, obj) };
    try {
      const r = await api('PUT', `vault/${encodeURIComponent(cur.row.id)}`, body);
      D = null;
      await applyRow(r);
      toast('Modifiche salvate.');
    } catch (x) {
      if (x.status === 409 && x.data && x.data.current) {
        await applyRow(x.data.current);
        saving = false;
        return conflict(el, V.entries.get(cur.row.id));
      }
      throw x;
    }
  } catch (x) {
    $('.err', el).textContent = x.message;
  } finally { saving = false; }
}
async function conflict(el, cur) {
  const ok = await confirmDialog('Modificata nel frattempo', `${esc(nameOf(cur.row.data.by))} ha salvato questa voce mentre la stavi modificando. Vuoi salvare comunque la tua versione? (Se la password era diversa, la loro resta tra i valori precedenti.)`, { ok: 'Salva la mia', cancel: 'Tieni la loro' });
  if (!ok) { D = null; app.render(); return; }
  D.base = cur.row.rev;
  return doSave(el, cur, true);
}

// ---------- condivisione ----------
async function shareDialog(id) {
  if (!store.canWrite()) return;
  const e = V.entries.get(id);
  if (!e || !isMine(e) || !e.d) return;
  let dir;
  try { dir = await loadDir(); } catch (x) { toastErr(x); return; }
  const fps = {};
  for (const p of dir) fps[p.id] = await personFp(p);
  const pinned = pins();
  const sel = {};
  for (const m of e.row.members) if (m.user_id !== me()) sel[m.user_id] = m.perm;
  const known = new Set(dir.map(p => p.id));
  const gone = e.row.members.filter(m => m.user_id !== me() && !known.has(m.user_id));
  const row = p => {
    const changed = pinned[p.id] && pinned[p.id] !== fps[p.id];
    const v = sel[p.id] || '';
    return `<div class="vsh ${changed ? 'bad' : ''}" data-u="${p.id}">
      <div class="vsh-n"><b>${esc(p.name)}</b> <span class="muted">${esc(p.login)}</span>
        <div class="vsh-fp">${changed ? '⚠ chiavi cambiate · ' : ''}codice ${K.fmtFp(fps[p.id])}</div></div>
      <select class="sel" data-perm="${p.id}" ${changed && !v ? 'disabled' : ''} aria-label="Permesso per ${esc(p.name)}">
        <option value="" ${!v ? 'selected' : ''}>Non condiviso</option>
        <option value="read" ${v === 'read' ? 'selected' : ''}>Sola lettura</option>
        <option value="write" ${v === 'write' ? 'selected' : ''}>Può modificare</option>
      </select></div>`;
  };
  const el = sheet(`<h3>Condividi «${esc(titleOf(e))}»</h3>
    <p class="muted" style="font-size:13px">Scegli con chi condividere e se può solo leggere o anche aggiornare i valori. Chi può modificare non può condividere ad altri né eliminare la voce.</p>
    ${dir.length > 6 ? `<input class="field-in" id="shQ" placeholder="Cerca utente" autocomplete="off" style="margin-bottom:8px">` : ''}
    <div class="vsh-list">${dir.length ? dir.map(row).join('') : '<div class="muted" style="padding:10px 0">Nessun altro utente pronto. Gli utenti compaiono qui dopo che l\'amministratore li ha abilitati e hanno aperto ZNoteKeeper almeno una volta.</div>'}
      ${gone.map(m => `<div class="vsh"><div class="vsh-n"><b>${esc(nameOf(m.user_id))}</b><div class="vsh-fp">non più abilitato</div></div><select class="sel" data-perm="${m.user_id}"><option value="">Togli</option><option value="${m.perm}" selected>${PERM[m.perm]}</option></select></div>`).join('')}</div>
    <div class="hint muted" style="font-size:12.5px;margin-top:8px">Il codice accanto a ogni nome deve essere uguale a quello che quella persona vede in «Il mio codice di sicurezza»: così sai che il sito non ha scambiato le chiavi. Togliere qualcuno cambia la chiave della voce.</div>
    <div class="err"></div>
    <div class="row-end"><button class="btn ghost" data-close>Annulla</button><button class="btn primary" id="shGo">Salva condivisione</button></div>`, { wide: true, label: 'Condividi' });
  const q = $('#shQ', el);
  if (q) q.addEventListener('input', () => { const s = q.value.trim().toLowerCase(); $$('.vsh', el).forEach(r => { r.hidden = s && !r.textContent.toLowerCase().includes(s); }); });
  $('#shGo', el).addEventListener('click', async () => {
    const go = $('#shGo', el);
    const want = {};
    $$('[data-perm]', el).forEach(s => { if (s.value) want[s.dataset.perm] = s.value; });
    go.disabled = true; go.textContent = 'Salvo…';
    try {
      const n = await applyShare(id, want, fps);
      closeOverlay();
      toast(n.removed ? 'Condivisione aggiornata: la voce ha una chiave nuova.' : 'Condivisione aggiornata.');
    } catch (x) {
      $('.err', el).textContent = x.message;
      go.disabled = false; go.textContent = 'Salva condivisione';
    }
  });
}

/** Applica il nuovo elenco dei membri. Se qualcuno esce, nuova chiave e contenuto ricifrato. */
async function applyShare(id, want, fps) {
  const keys = await ensureKeys();
  const e = V.entries.get(id);
  const old = {};
  for (const m of e.row.members) old[m.user_id] = m.perm;
  const removed = Object.keys(old).filter(u => +u !== me() && !want[u]);
  // Anche togliere il permesso di modifica cambia la chiave: così un vecchio elenco firmato non vale più.
  const downgraded = Object.keys(want).filter(u => old[u] === 'write' && want[u] === 'read');
  const added = Object.keys(want).filter(u => !old[u]);
  if (!removed.length && !added.length && Object.keys(want).every(u => want[u] === old[u])) return { removed: 0 };
  const rotate = removed.length > 0 || downgraded.length > 0;
  const kv = rotate ? e.row.kv + 1 : e.row.kv;
  const key = rotate ? K.newEntryKey() : e.key;
  const perms = { [me()]: 'owner', ...want };
  const members = [];
  const newPinsNow = {};
  for (const [u, perm] of Object.entries(perms)) {
    const uid = +u;
    let wrapped = null;
    if (rotate || !old[u]) {
      const pubEnc = uid === me() ? keys.pub_enc : (V.people.get(uid) || {}).pub_enc;
      if (!pubEnc) throw new Error(`Mancano le chiavi di ${nameOf(uid)}.`);
      if (uid !== me()) {
        const fp = fps[uid] || await personFp(V.people.get(uid));
        const pin = pins()[uid];
        if (pin && pin !== fp) throw new Error(`Le chiavi di ${nameOf(uid)} sono cambiate: prima verifica con lui o lei il codice di sicurezza.`);
        if (!pin) newPinsNow[uid] = fp;
      }
      wrapped = await K.wrapFor(key, pubEnc, K.wrapCtx(id, uid, kv));
    }
    members.push({ user_id: uid, perm, wrapped });
  }
  const body = { kv, base_rev: e.row.rev, members, acl: await K.signAcl(keys, id, kv, perms) };
  if (rotate) body.data = await K.sealEntry(key, keys, id, kv, e.row.rev + 1, e.d);
  const r = await api('PUT', `vault/${encodeURIComponent(id)}/access`, body);
  Object.assign(newPins, newPinsNow);
  savePins();
  await applyRow(r);
  return { removed: rotate ? 1 : 0 };
}
