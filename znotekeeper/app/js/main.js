// Avvio dell'app ZNoteKeeper: collegamento del dispositivo, sblocco, layout telefono/PC, navigazione.
import { CFG, api, setToken, setSession, onAuthError, isOffline } from './api.js';
import { kv } from './db.js';
import { installSprite, ic } from './icons.js';
import { $, $$, esc, closeOverlay, isOverlayOpen, toast, confirmDialog, choose } from './ui.js';
import { app } from './ctx.js';
import * as store from './store.js';
import { S } from './store.js';
import { renderSetup, renderLock, forgetRemember } from './lock.js';
import * as notes from './notes.js';
import * as ntree from './ntree.js';
import { migrate as migrateTree } from './struct.js';
import * as tasks from './tasks.js';
import * as search from './search.js';
import * as settings from './settings.js';
import * as access from './access.js';
import * as secrets from './secrets.js';
import * as vault from './vault.js';
import { importInbox } from './mailin.js';

const root = document.getElementById('app');
const mq = matchMedia('(min-width: 900px)');
let me = null;
let pollT = null;
let started = false;

// ---------- service worker e installazione ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; app.canInstall = true; });
app.install = async () => {
  if (!installEvt) return false;
  installEvt.prompt();
  const r = await installEvt.userChoice;
  installEvt = null; app.canInstall = false;
  return r.outcome === 'accepted';
};
app.standalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(CFG.sw, { scope: new URL('./', CFG.app).pathname }).catch(e => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'updated') app.updated = true; });
}

// Tastiera virtuale su iPhone: l'app segue l'area visibile.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fitVV = () => { root.style.height = vv.height + 'px'; root.style.bottom = 'auto'; };
  vv.addEventListener('resize', fitVV);
  fitVV();
}

function shell() {
  root.innerHTML = `
    <div id="screens"></div>
    <nav class="nav" id="nav" aria-label="Sezioni dell'app" hidden>
      <button data-nav="notes"><span class="pill">${ic('book')}</span>Taccuino</button>
      <button data-nav="tasks"><span class="pill">${ic('tasks')}</span>Attività</button>
      <button data-nav="vault"><span class="pill">${ic('key')}</span><span class="nl">I miei secrets</span><span class="ns">Secrets</span></button>
      <button data-nav="access" class="navx"><span class="pill">${ic('mail')}</span><span class="nl">Secrets clienti</span><span class="ns">Clienti</span></button>
      <button data-nav="secrets" class="navx"><span class="pill">${ic('shield')}</span><span class="nl">Foglio segreti</span><span class="ns">Foglio</span></button>
      <button data-nav="search"><span class="pill">${ic('search')}</span>Cerca</button>
      <button data-nav="settings" class="navx"><span class="pill">${ic('sliders')}</span>Impostazioni</button>
      <button data-nav="more" class="navmore" aria-label="Altre sezioni"><span class="pill">${ic('more')}</span>Altro</button>
      <button class="navlock" data-nav="lock" title="Blocca (Ctrl+Maiusc+L)"><span class="pill">${ic('lock')}</span>Blocca</button>
    </nav>
    <div id="overlay"></div><div id="toastRoot"></div>`;
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    if (b.dataset.nav === 'lock') return app.lock();
    if (b.dataset.nav === 'more') return moreMenu();
    go({ view: b.dataset.nav, page: app.R.view === b.dataset.nav ? null : app.R.page, task: app.R.view === b.dataset.nav ? null : app.R.task, acc: app.R.view === b.dataset.nav ? null : app.R.acc, vent: app.R.view === b.dataset.nav ? null : app.R.vent, sver: null }, { replace: true });
  });
}

// Telefono: le sezioni meno usate stanno in «Altro», così la barra in basso resta corta.
async function moreMenu() {
  const v = app.R && app.R.view;
  const a = await choose('Altro', [
    { label: 'Secrets clienti', icon: 'mail', value: 'access' },
    { label: 'Foglio segreti', icon: 'shield', value: 'secrets', hint: secrets.dirty() ? 'Modifiche non salvate' : '' },
    { label: 'Impostazioni', icon: 'sliders', value: 'settings' },
    { sep: true },
    { label: 'Blocca', icon: 'lock', value: 'lock' },
  ], { current: ['access', 'secrets', 'settings'].includes(v) ? v : null });
  if (!a) return;
  if (a === 'lock') { app.lock(); return; }
  go({ view: a, page: null, task: null, acc: null, vent: null, sver: null }, { replace: true });
}

function message(title, html) {
  $('#screens').innerHTML = `<section class="screen lock full"><div class="logo">ZN</div><h2>${esc(title)}</h2><p>${html}</p></section>`;
  $('#nav').hidden = true;
}

// ---------- avvio ----------
async function boot() {
  installSprite();
  shell();
  onAuthError(async err => {
    if (err.code === 'znk_no_device') { await kv.del('token'); location.href = CFG.pair; }
    else if (err.code === 'znk_disabled') { store.forgetMemory(); message('Accesso non abilitato', esc(err.message)); }
    else if (err.code === 'znk_locked' && S.space) { toast('Sessione scaduta: sblocca di nuovo.'); app.lock(true); }
  });
  const token = await kv.get('token');
  if (!token) { location.replace(CFG.pair); return; }
  setToken(token);
  try {
    me = await api('GET', 'me', undefined, { quiet: true });
    await kv.set('me', me);
    store.setOffline(false);
  } catch (e) {
    if (e.code === 'znk_no_device') { await kv.del('token'); location.replace(CFG.pair); return; }
    if (e.code === 'znk_disabled') { message('Accesso non abilitato', esc(e.message) + '<br><br>Chiedi all\'amministratore del sito di abilitarti da Utenti › ZNoteKeeper.'); return; }
    if (!isOffline(e)) { message('Errore', esc(e.message)); return; }
    me = await kv.get('me');
    store.setOffline(true);
    if (!me) { message('Sei offline', 'Collegati a internet per il primo avvio di ZNoteKeeper.'); return; }
  }
  S.me = me;
  if (!me.has_vault) {
    if (S.offline) { message('Sei offline', 'Collegati a internet per creare il tuo spazio.'); return; }
    renderSetup($('#screens'), { onDone: () => enter({ readonly: false, fresh: true }) });
    return;
  }
  showLock();
}

function showLock() {
  $('#nav').hidden = true;
  renderLock($('#screens'), { me, offline: S.offline, onUnlocked: enter });
}

async function enter({ readonly, fresh }) {
  app.readonly = !!readonly;
  if (readonly) store.setOffline(true);
  $('#screens').innerHTML = '<div class="boot"><div class="logo">ZN</div><p>Apro le note…</p></div>';
  await store.loadCache();
  if (!readonly) {
    try { await store.sync(); } catch (e) { toast(e.message); }
    if (fresh || !store.all('section').length && !store.all('list').length && !store.get('settings')) await createDefaults();
    // 1.7.0: un solo albero taccuino › sezione › gruppo › pagina › nota (prima: gruppo di sezioni › sezione).
    try { await migrateTree(); } catch (e) { console.warn('migrazione del taccuino', e); }
    importInbox().catch(e => console.warn(e));
    vault.ensureKeys().catch(e => console.warn('chiavi secrets', e));
  }
  started = true;
  buildScreens();
  const p = new URLSearchParams(location.search);
  const doIt = p.get('do');
  if (doIt) history.replaceState(null, '', location.pathname);
  const st = store.settings();
  app.R = { view: st.lastView || 'notes', section: st.lastSection || null, page: null, list: st.lastList || null, task: null, from: null };
  if (doIt === 'search') app.R.view = 'search';
  render();
  if (doIt === 'new-page') notes.newPage();
  if (doIt === 'new-task') tasks.quickAdd();
  startPolling();
  startAutolock();
  tasks.scheduleLocalReminders();
}

async function createDefaults() {
  const nb = (store.all('notebook')[0] || {}).id || store.create('notebook', null, { title: 'Il mio taccuino', main: true }, { sort: 0 });
  const inbox = store.create('section', nb, { title: 'Posta in arrivo', color: 6, inbox: true }, { sort: 1000 });
  const list = store.create('list', null, { title: 'Personale' }, { sort: 1000 });
  await store.save('settings', { kind: 'settings', parent_id: null, sort: 0, d: { autolock: 5, mail: { mode: 'page', section: inbox, list }, lastSection: inbox, lastList: list } });
}

function startPolling() {
  clearInterval(pollT);
  pollT = setInterval(async () => {
    if (!S.space || document.hidden) return;
    try {
      const ok = await store.sync();
      if (ok && S.inbox) importInbox();
      if (ok && app.R && app.R.view === 'vault') vault.refresh();
      if (ok && app.readonly) { app.readonly = false; toast('Di nuovo online: puoi modificare le note.'); }
    } catch (e) { /* */ }
  }, 25000);
}
window.addEventListener('online', () => { if (S.space) store.sync().then(ok => { if (ok && S.inbox) importInbox(); }).catch(() => {}); });
window.addEventListener('focus', () => { if (S.space && !S.syncing) store.sync().catch(() => {}); });

// ---------- blocco automatico ----------
let lastAct = Date.now();
let hiddenAt = 0;
let lockT = null;
function startAutolock() {
  const bump = () => { lastAct = Date.now(); };
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, bump, { passive: true, capture: true }));
  clearInterval(lockT);
  lockT = setInterval(() => {
    if (!S.space || S.remembered) return;
    const m = store.settings().autolock ?? 5;
    if (m > 0 && Date.now() - lastAct > m * 60000) app.lock(false, { auto: true });
  }, 15000);
}
document.addEventListener('visibilitychange', () => {
  if (!S.space) return;
  const m = store.settings().autolock ?? 5;
  if (document.hidden) {
    hiddenAt = Date.now();
    notes.flush();
    tasks.flush();
    if (m === 0 && !S.remembered) setTimeout(() => { if (document.hidden) app.lock(false, { auto: true }); }, 1500);
  } else if (hiddenAt && m > 0 && !S.remembered && Date.now() - hiddenAt > m * 60000) app.lock(false, { auto: true });
});

app.lock = async (expired = false, { auto = false } = {}) => {
  if (!S.space) return;
  if (!expired && !auto && vault.dirty() && !await confirmDialog('Secret non salvato', 'Stai modificando una voce di «I miei secrets»: bloccando perdi le modifiche.', { ok: 'Blocca comunque', danger: true })) return;
  if (!expired && !auto && secrets.dirty() && !await confirmDialog('Segreti non salvati', 'Nel foglio «I miei segreti» ci sono modifiche non salvate: bloccando le perdi.', { ok: 'Blocca comunque', danger: true })) return;
  // «Blocca» scelto a mano su un dispositivo ricordato: lo dimentica, altrimenti si riaprirebbe da solo.
  if (!expired && S.remembered) { await forgetRemember(); toast('Questo dispositivo non è più ricordato: al prossimo accesso servirà la password.'); }
  notes.flush(); tasks.flush();
  secrets.forget();
  vault.forget();
  closeOverlay();
  if (!expired) api('POST', 'lock', {}, { quiet: true }).catch(() => {});
  setSession(null);
  store.forgetMemory();
  started = false;
  clearInterval(pollT);
  try { me = await api('GET', 'me', undefined, { quiet: true }); S.me = me; await kv.set('me', me); store.setOffline(false); } catch (e) { if (isOffline(e)) store.setOffline(true); }
  showLock();
};

// ---------- layout e navigazione ----------
const panes = {};
function buildScreens() {
  const sc = $('#screens');
  sc.innerHTML = `
    <section class="screen" id="nTree" data-pane="tree"></section>
    <section class="screen" id="nList" data-pane="nlist"></section>
    <section class="screen" id="nPage" data-pane="npage"></section>
    <section class="screen" id="nOver" data-pane="nover"></section>
    <section class="screen" id="tList" data-pane="tlist"></section>
    <section class="screen" id="tDetail" data-pane="tdetail"></section>
    <section class="screen" id="aList" data-pane="alist"></section>
    <section class="screen" id="aDetail" data-pane="adetail"></section>
    <section class="screen" id="vTree" data-pane="vtree"></section>
    <section class="screen" id="vList" data-pane="vlist"></section>
    <section class="screen" id="vMain" data-pane="vmain"></section>
    <section class="screen" id="sMain" data-pane="smain"></section>
    <section class="screen" id="sVer" data-pane="sver"></section>
    <section class="screen" id="sSearch" data-pane="search"></section>
    <section class="screen" id="sSettings" data-pane="settings"></section>
    <section class="screen" id="sEmpty" data-pane="empty"><div class="empty" style="margin:auto"></div></section>`;
  for (const el of $$('[data-pane]', sc)) panes[el.dataset.pane] = el;
  $('#nav').hidden = false;
}

function setPane(el, cls) {
  el.hidden = !cls;
  el.className = 'screen' + (cls ? ' ' + cls : '');
  el.style.left = el.style.width = el.style.right = '';
}

// ---------- pannelli richiudibili (PC) ----------
// Due interruttori validi per tutte le sezioni: «tree» (colonna di navigazione: sezioni, cartelle)
// e «list» (elenco: pagine, attività, secrets, clienti). Aprendo un'altra sezione la scelta resta.
const FOLD_KEY = 'znk-fold';
const NAVW = 84, RAILW = 44;
function getFold() {
  let f = {};
  try { f = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (e) { /* */ }
  if ('tlist' in f) { f.list = !!(f.list || f.tlist); delete f.tlist; try { localStorage.setItem(FOLD_KEY, JSON.stringify(f)); } catch (e) { /* */ } }
  return f;
}
function saveFold(f) { try { localStorage.setItem(FOLD_KEY, JSON.stringify(f)); } catch (e) { /* */ } render(); }
function setFold(k, v) { const f = getFold(); f[k] = v; saveFold(f); }
const RAIL = {
  notes: { tree: ['book', 'Mostra il taccuino'], list: ['page', 'Mostra l\'elenco'] },
  tasks: { list: ['list', 'Mostra elenco delle attività'] },
  vault: { tree: ['folder', 'Mostra cartelle'], list: ['key', 'Mostra elenco dei secrets'] },
  access: { list: ['mail', 'Mostra elenco dei clienti'] },
};
function foldRail(view, keys) {
  let rail = $('#foldRail');
  if (!keys.length) { if (rail) rail.remove(); return; }
  if (!rail) { rail = document.createElement('div'); rail.id = 'foldRail'; rail.className = 'foldrail'; root.appendChild(rail); }
  rail.style.left = NAVW + 'px';
  rail.innerHTML = keys.map(k => { const [i, l] = RAIL[view][k]; return `<button class="ib" data-unfold="${k}" aria-label="${l}" title="${l} (Ctrl+\\)">${ic(i)}</button>`; }).join('');
}
function place(el, left, width) {
  el.style.left = left + 'px';
  el.style.width = width ? width + 'px' : '';
  el.style.right = width ? 'auto' : '0';
}
/** PC: dispone le colonne richiudibili di una sezione e restituisce dove comincia l'area di lavoro. */
function columns(view, fold, cols) {
  const folded = cols.filter(c => fold[c.k]).map(c => c.k);
  foldRail(view, folded);
  let x = NAVW + (folded.length ? RAILW : 0);
  for (const c of cols) {
    if (fold[c.k]) continue;
    setPane(c.el, c.cls); place(c.el, x, c.w); c.render(c.el); x += c.w;
  }
  return x;
}
function mainPane(el, x) { setPane(el, 'pane-main'); place(el, x, 0); }
function toggleAllFolds() {
  const keys = Object.keys(RAIL[app.R.view] || {});
  if (!keys.length) return;
  const f = getFold();
  const all = keys.every(k => f[k]);
  keys.forEach(k => { f[k] = !all; });
  saveFold(f);
}
document.addEventListener('click', e => {
  const f = e.target.closest('[data-fold],[data-unfold]');
  if (!f) return;
  e.preventDefault(); e.stopPropagation();
  if (f.dataset.fold) setFold(f.dataset.fold, true); else setFold(f.dataset.unfold, false);
}, true);

let lastRendered = {};
export function render() {
  if (!started) return;
  const R = app.R;
  const desk = app.desk = mq.matches;
  root.classList.toggle('desk', desk);
  for (const p of Object.values(panes)) p.hidden = true;
  const nav = R.view;
  const inMore = ['access', 'secrets', 'settings'].includes(nav);
  $$('#nav [data-nav]').forEach(b => b.setAttribute('aria-current', String(b.dataset.nav === nav || (b.dataset.nav === 'more' && inMore))));
  const offlineBar = $('#offlineBar');
  if (S.offline && !offlineBar) root.insertAdjacentHTML('afterbegin', '<div class="offline-bar" id="offlineBar">Offline · sola lettura delle note già scaricate</div>');
  if (!S.offline && offlineBar) offlineBar.remove();

  let showNav = true;
  if (R.view !== 'access') access.renderDetail(null);
  if (R.view !== 'vault') vault.renderDetail(null);
  if (R.view !== 'secrets') { secrets.renderMain(null); secrets.renderVersion(null); }
  const fold = desk ? getFold() : {};
  if (!desk || !RAIL[R.view]) foldRail(null, []);
  const unfoldBtn = fold.list ? '<br><br><button class="btn ghost small" data-unfold="list">Mostra l\'elenco</button>' : '';
  if (R.view === 'notes') {
    // Un solo pannello ad albero; l'elenco compare solo per Preferiti, Recenti, etichette e Cestino.
    const special = String(R.section || '').includes(':');
    if (R.node && !store.alive(store.get(R.node))) R.node = null;
    if (desk) {
      const cols = [{ k: 'tree', el: panes.tree, cls: 'pane-tree pane-ntree', w: 320, render: ntree.renderTree }];
      if (special) cols.push({ k: 'list', el: panes.nlist, cls: 'pane-list', w: 340, render: notes.renderList });
      const x = columns('notes', fold, cols);
      if (R.page && store.get(R.page)) { mainPane(panes.npage, x); notes.renderPage(panes.npage, R.page); }
      else if (R.node && !special) { notes.renderPage(null); mainPane(panes.nover, x); ntree.renderOverview(panes.nover, R.node); }
      else { mainPane(panes.empty, x); emptyMsg('Nessuna pagina aperta', 'Scegli una pagina o una nota nell\'albero, oppure creane una nuova (Alt+N).', fold.tree ? '<br><br><button class="btn ghost small" data-unfold="tree">Mostra il taccuino</button>' : ''); notes.renderPage(null); }
    } else if (R.page && store.get(R.page)) {
      setPane(panes.npage, 'full'); notes.renderPage(panes.npage, R.page); showNav = false;
    } else if (special) {
      setPane(panes.nlist, 'has-nav'); notes.renderList(panes.nlist); notes.renderPage(null);
    } else {
      setPane(panes.tree, 'has-nav pane-ntree'); ntree.renderTree(panes.tree); notes.renderPage(null);
    }
  } else if (R.view === 'tasks') {
    notes.renderPage(null);
    if (desk) {
      const x = columns('tasks', fold, [{ k: 'list', el: panes.tlist, cls: 'pane-list', w: 380, render: tasks.renderList }]);
      if (R.task && store.get(R.task)) { mainPane(panes.tdetail, x); tasks.renderDetail(panes.tdetail, R.task); }
      else { mainPane(panes.empty, x); emptyMsg('Nessuna attività aperta', 'Scegli un\'attività per vederne i dettagli qui accanto, o aggiungine una (Alt+T).', unfoldBtn); tasks.renderDetail(null); }
    } else if (R.task && store.get(R.task)) {
      setPane(panes.tdetail, 'full'); tasks.renderDetail(panes.tdetail, R.task); showNav = false;
    } else {
      setPane(panes.tlist, 'has-nav'); tasks.renderList(panes.tlist); tasks.renderDetail(null);
    }
  } else if (R.view === 'vault') {
    notes.renderPage(null); tasks.renderDetail(null);
    const ve = R.vent;
    if (desk) {
      const x = columns('vault', fold, [
        { k: 'tree', el: panes.vtree, cls: 'pane-tree', w: 260, render: vault.renderTree },
        { k: 'list', el: panes.vlist, cls: 'pane-list', w: 340, render: vault.renderList },
      ]);
      if (ve) { mainPane(panes.vmain, x); vault.renderDetail(panes.vmain, ve); }
      else { mainPane(panes.empty, x); emptyMsg('Nessun secret aperto', 'Scegli una voce dall\'elenco o aggiungine una nuova.', unfoldBtn); vault.renderDetail(null); }
    } else if (ve) {
      setPane(panes.vmain, 'full'); vault.renderDetail(panes.vmain, ve); showNav = false;
    } else {
      setPane(panes.vlist, 'has-nav'); vault.renderList(panes.vlist); vault.renderDetail(null);
    }
  } else if (R.view === 'access') {
    notes.renderPage(null); tasks.renderDetail(null);
    if (desk) {
      const x = columns('access', fold, [{ k: 'list', el: panes.alist, cls: 'pane-list', w: 380, render: access.renderList }]);
      if (R.acc && store.get(R.acc)) { mainPane(panes.adetail, x); access.renderDetail(panes.adetail, R.acc); }
      else { mainPane(panes.empty, x); emptyMsg('Nessun secret cliente aperto', 'Scegli un cliente dall\'elenco o aggiungine uno nuovo.', unfoldBtn); access.renderDetail(null); }
    } else if (R.acc && store.get(R.acc)) {
      setPane(panes.adetail, 'full'); access.renderDetail(panes.adetail, R.acc); showNav = false;
    } else {
      setPane(panes.alist, 'has-nav'); access.renderList(panes.alist); access.renderDetail(null);
    }
  } else if (R.view === 'secrets') {
    notes.renderPage(null); tasks.renderDetail(null);
    // Le versioni si scelgono dall'elenco a discesa in alto: niente colonna dedicata.
    const v = R.sver && R.sver !== 'list' ? R.sver : null;
    if (desk) {
      if (v) { secrets.renderMain(null); mainPane(panes.sver, NAVW); secrets.renderVersion(panes.sver, v); }
      else { secrets.renderVersion(null); mainPane(panes.smain, NAVW); secrets.renderMain(panes.smain); }
    } else if (v) {
      secrets.renderMain(null); setPane(panes.sver, 'full'); secrets.renderVersion(panes.sver, v); showNav = false;
    } else {
      secrets.renderVersion(null); setPane(panes.smain, 'has-nav'); secrets.renderMain(panes.smain);
    }
  } else if (R.view === 'search') {
    notes.renderPage(null); tasks.renderDetail(null);
    setPane(panes.search, 'has-nav pane-full'); search.render(panes.search);
  } else if (R.view === 'settings') {
    notes.renderPage(null); tasks.renderDetail(null);
    setPane(panes.settings, 'has-nav pane-full'); settings.render(panes.settings);
  }
  $('#nav').hidden = !showNav && !desk;
  lastRendered = { ...R };
}
function emptyMsg(t, s, extra = '') { $('.empty', panes.empty).innerHTML = `<b>${esc(t)}</b>${esc(s)}${extra}`; }

/** Cambia schermata. Su telefono le schermate di dettaglio entrano nella cronologia (tasto indietro). */
function go(patch, { replace = false } = {}) {
  notes.flush(); tasks.flush(); access.flush();
  const prev = { ...app.R };
  Object.assign(app.R, patch);
  const R = app.R;
  const deeper = (R.page && R.page !== prev.page) || (R.task && R.task !== prev.task) || (R.acc && R.acc !== prev.acc) || (R.vent && R.vent !== prev.vent) || (R.sver && R.sver !== prev.sver);
  if (!mq.matches && deeper && !replace) history.pushState({ znk: { ...R } }, '');
  else history.replaceState({ znk: { ...R } }, '');
  const st = store.settings();
  if (S.space && !S.offline && (st.lastView !== R.view || (R.section && st.lastSection !== R.section) || (R.list && st.lastList !== R.list))) {
    saveNav();
  }
  closeOverlay();
  if (prev.view !== R.view || deeper) root.classList.remove('chrome-hidden');
  render();
}
let navT = null;
function saveNav() {
  clearTimeout(navT);
  navT = setTimeout(() => {
    const R = app.R;
    const it = store.get('settings');
    if (!it || !it.d) return;
    const recents = it.d.recents || [];
    store.update('settings', d => {
      d.lastView = R.view;
      if (R.section && !String(R.section).includes(':')) d.lastSection = R.section;
      if (R.list && R.list !== 'starred') d.lastList = R.list;
      d.recents = recents;
    });
  }, 1500);
}
app.go = go;
app.render = render;

window.addEventListener('popstate', e => {
  if (isOverlayOpen()) { closeOverlay(); history.pushState({ znk: { ...app.R } }, ''); return; }
  const st = e.state && e.state.znk;
  notes.flush(); tasks.flush(); access.flush();
  if (st) Object.assign(app.R, st);
  else Object.assign(app.R, { page: null, task: null, acc: null, vent: null, sver: null });
  render();
});
mq.addEventListener('change', () => render());
store.onChange(() => { if (started) render(); });

// ---------- scorciatoie da tastiera (PC) ----------
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isOverlayOpen() && !document.querySelector('.drawscreen')) { e.preventDefault(); closeOverlay(); return; }
  if (!S.space || !started) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const typing = e.target.closest && e.target.closest('input,textarea,[contenteditable=true]');
  if (mod && e.shiftKey && k === 'l') { e.preventDefault(); app.lock(); return; }
  if (mod && e.key === '\\' && app.desk) {
    e.preventDefault();
    toggleAllFolds();
    return;
  }
  if (mod && k === 'k' && !typing) { e.preventDefault(); go({ view: 'search' }); setTimeout(() => { const q = $('#q'); if (q) q.focus(); }, 30); return; }
  if (mod && e.shiftKey && k === 'f') { e.preventDefault(); go({ view: 'search' }); setTimeout(() => { const q = $('#q'); if (q) q.focus(); }, 30); return; }
  if (e.altKey && !mod) {
    if (k === 'n') { e.preventDefault(); notes.newPage(); return; }
    if (k === 't') { e.preventDefault(); tasks.quickAdd(); return; }
    if (['1', '2', '3', '4', '5', '6', '7'].includes(k)) { e.preventDefault(); go({ view: ['notes', 'tasks', 'vault', 'access', 'secrets', 'search', 'settings'][+k - 1] }); return; }
  }
  if (k === 'escape' && !isOverlayOpen() && !typing) {
    if (app.R.page) go({ page: null }); else if (app.R.task) go({ task: null }); else if (app.R.acc) go({ acc: null }); else if (app.R.vent && app.R.vent !== 'new') go({ vent: null }); else if (app.R.sver) go({ sver: null });
  }
});

// ---------- telefono: barre che si fanno da parte ----------
// Scorrendo verso il basso la barra delle sezioni scompare (torna scorrendo in su);
// mentre si scrive sparisce del tutto e compare la barra di formattazione.
const lastY = new WeakMap();
document.addEventListener('scroll', e => {
  if (app.desk || !started) return;
  const t = e.target;
  if (!(t instanceof Element) || !t.closest('.screen.has-nav')) return;
  const y = t.scrollTop, p = lastY.has(t) ? lastY.get(t) : 0;
  lastY.set(t, y);
  if (y < 24) root.classList.remove('chrome-hidden');
  else if (y > p + 8) root.classList.add('chrome-hidden');
  else if (y < p - 8) root.classList.remove('chrome-hidden');
}, true);
const isTyping = el => !!(el && el.closest && el.closest('input:not([type=checkbox]):not([type=radio]):not([type=button]),textarea,[contenteditable=true],.etools'));
let typingT = null;
document.addEventListener('focusin', e => { clearTimeout(typingT); if (isTyping(e.target) && !e.target.closest('.sheet')) root.classList.add('typing'); });
document.addEventListener('focusout', () => {
  clearTimeout(typingT);
  typingT = setTimeout(() => { if (!isTyping(document.activeElement)) root.classList.remove('typing'); }, 150);
});

boot().catch(e => { console.error(e); message('Errore di avvio', esc(e.message)); });
