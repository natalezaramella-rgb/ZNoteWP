// Avvio dell'app ZNoteKeeper: collegamento del dispositivo, sblocco, layout telefono/PC, navigazione.
import { CFG, api, setToken, setSession, onAuthError, isOffline } from './api.js';
import { kv } from './db.js';
import { installSprite, ic } from './icons.js';
import { $, $$, esc, closeOverlay, isOverlayOpen, toast, confirmDialog } from './ui.js';
import { app } from './ctx.js';
import * as store from './store.js';
import { S } from './store.js';
import { renderSetup, renderLock, forgetRemember } from './lock.js';
import * as notes from './notes.js';
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
      <button data-nav="access"><span class="pill">${ic('mail')}</span><span class="nl">Secrets clienti</span><span class="ns">Clienti</span></button>
      <button data-nav="secrets"><span class="pill">${ic('shield')}</span><span class="nl">Foglio segreti</span><span class="ns">Foglio</span></button>
      <button data-nav="search"><span class="pill">${ic('search')}</span>Cerca</button>
      <button data-nav="settings"><span class="pill">${ic('sliders')}</span>Impostazioni</button>
      <button class="navlock" data-nav="lock" title="Blocca (Ctrl+Maiusc+L)"><span class="pill">${ic('lock')}</span>Blocca</button>
    </nav>
    <div id="overlay"></div><div id="toastRoot"></div>`;
  $('#nav').addEventListener('click', e => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    if (b.dataset.nav === 'lock') return app.lock();
    go({ view: b.dataset.nav, page: app.R.view === b.dataset.nav ? null : app.R.page, task: app.R.view === b.dataset.nav ? null : app.R.task, acc: app.R.view === b.dataset.nav ? null : app.R.acc, vent: app.R.view === b.dataset.nav ? null : app.R.vent, sver: null }, { replace: true });
  });
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
  const inbox = store.create('section', null, { title: 'Posta in arrivo', color: 6, inbox: true }, { sort: 0 });
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
    <section class="screen" id="tList" data-pane="tlist"></section>
    <section class="screen" id="tDetail" data-pane="tdetail"></section>
    <section class="screen" id="aList" data-pane="alist"></section>
    <section class="screen" id="aDetail" data-pane="adetail"></section>
    <section class="screen" id="vTree" data-pane="vtree"></section>
    <section class="screen" id="vList" data-pane="vlist"></section>
    <section class="screen" id="vMain" data-pane="vmain"></section>
    <section class="screen" id="sVers" data-pane="slist"></section>
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
}

// ---------- pannelli richiudibili (PC) ----------
const FOLD_KEY = 'znk-fold';
function getFold() { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (e) { return {}; } }
function setFold(k, v) { const f = getFold(); f[k] = v; try { localStorage.setItem(FOLD_KEY, JSON.stringify(f)); } catch (e) { /* */ } render(); }
function foldRail(view, fold) {
  let rail = $('#foldRail');
  const btns = [];
  if (view === 'notes' && fold.tree) btns.push(['tree', 'folder', 'Mostra sezioni']);
  if (view === 'notes' && fold.list) btns.push(['list', 'page', 'Mostra pagine']);
  if (view === 'tasks' && fold.tlist) btns.push(['tlist', 'list', 'Mostra elenco']);
  if (!btns.length) { if (rail) rail.remove(); return; }
  if (!rail) { rail = document.createElement('div'); rail.id = 'foldRail'; rail.className = 'foldrail'; root.appendChild(rail); }
  rail.style.left = view === 'notes' && fold.list && !fold.tree ? '344px' : '84px';
  rail.innerHTML = btns.map(([k, i, l]) => `<button class="ib" data-unfold="${k}" aria-label="${l}" title="${l}">${ic(i)}</button>`).join('');
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
  $$('#nav [data-nav]').forEach(b => b.setAttribute('aria-current', String(b.dataset.nav === nav)));
  const offlineBar = $('#offlineBar');
  if (S.offline && !offlineBar) root.insertAdjacentHTML('afterbegin', '<div class="offline-bar" id="offlineBar">Offline · sola lettura delle note già scaricate</div>');
  if (!S.offline && offlineBar) offlineBar.remove();

  let showNav = true;
  if (R.view !== 'access') access.renderDetail(null);
  if (R.view !== 'vault') vault.renderDetail(null);
  if (R.view !== 'secrets') { secrets.renderMain(null); secrets.renderVersion(null); }
  const fold = desk ? getFold() : {};
  root.classList.toggle('fold-tree', !!(desk && R.view === 'notes' && fold.tree));
  root.classList.toggle('fold-list', !!(desk && ((R.view === 'notes' && fold.list) || (R.view === 'tasks' && fold.tlist))));
  foldRail(desk ? R.view : null, fold);
  if (R.view === 'notes') {
    if (desk) {
      if (!fold.tree) { setPane(panes.tree, 'pane-tree'); notes.renderTree(panes.tree); }
      if (!fold.list) { setPane(panes.nlist, 'pane-list after-tree'); notes.renderList(panes.nlist); }
      if (R.page && store.get(R.page)) { setPane(panes.npage, 'pane-main after-tree'); notes.renderPage(panes.npage, R.page); }
      else { setPane(panes.empty, 'pane-main after-tree'); emptyMsg('Nessuna pagina aperta', 'Scegli una pagina dall\'elenco o creane una nuova (Alt+N).'); notes.renderPage(null); }
    } else if (R.page && store.get(R.page)) {
      setPane(panes.npage, 'full'); notes.renderPage(panes.npage, R.page); showNav = false;
    } else {
      setPane(panes.nlist, 'has-nav'); notes.renderList(panes.nlist); notes.renderPage(null);
    }
  } else if (R.view === 'tasks') {
    notes.renderPage(null);
    if (desk) {
      if (!fold.tlist) { setPane(panes.tlist, 'pane-list'); tasks.renderList(panes.tlist); }
      if (R.task && store.get(R.task)) { setPane(panes.tdetail, 'pane-main'); tasks.renderDetail(panes.tdetail, R.task); }
      else { setPane(panes.empty, 'pane-main'); emptyMsg('Nessuna attività aperta', 'Scegli un\'attività per vederne i dettagli qui accanto, o aggiungine una (Alt+T).'); tasks.renderDetail(null); }
    } else if (R.task && store.get(R.task)) {
      setPane(panes.tdetail, 'full'); tasks.renderDetail(panes.tdetail, R.task); showNav = false;
    } else {
      setPane(panes.tlist, 'has-nav'); tasks.renderList(panes.tlist); tasks.renderDetail(null);
    }
  } else if (R.view === 'vault') {
    notes.renderPage(null); tasks.renderDetail(null);
    const ve = R.vent;
    if (desk) {
      setPane(panes.vtree, 'pane-tree'); vault.renderTree(panes.vtree);
      setPane(panes.vlist, 'pane-list after-tree'); vault.renderList(panes.vlist);
      if (ve) { setPane(panes.vmain, 'pane-main after-tree'); vault.renderDetail(panes.vmain, ve); }
      else { setPane(panes.empty, 'pane-main after-tree'); emptyMsg('Nessun secret aperto', 'Scegli una voce dall\'elenco o aggiungine una nuova.'); vault.renderDetail(null); }
    } else if (ve) {
      setPane(panes.vmain, 'full'); vault.renderDetail(panes.vmain, ve); showNav = false;
    } else {
      setPane(panes.vlist, 'has-nav'); vault.renderList(panes.vlist); vault.renderDetail(null);
    }
  } else if (R.view === 'access') {
    notes.renderPage(null); tasks.renderDetail(null);
    if (desk) {
      setPane(panes.alist, 'pane-list'); access.renderList(panes.alist);
      if (R.acc && store.get(R.acc)) { setPane(panes.adetail, 'pane-main'); access.renderDetail(panes.adetail, R.acc); }
      else { setPane(panes.empty, 'pane-main'); emptyMsg('Nessun secret cliente aperto', 'Scegli un cliente dall\'elenco o aggiungine uno nuovo.'); access.renderDetail(null); }
    } else if (R.acc && store.get(R.acc)) {
      setPane(panes.adetail, 'full'); access.renderDetail(panes.adetail, R.acc); showNav = false;
    } else {
      setPane(panes.alist, 'has-nav'); access.renderList(panes.alist); access.renderDetail(null);
    }
  } else if (R.view === 'secrets') {
    notes.renderPage(null); tasks.renderDetail(null);
    const v = R.sver && R.sver !== 'list' ? R.sver : null;
    if (desk) {
      setPane(panes.slist, 'pane-list'); secrets.renderList(panes.slist);
      if (v) { secrets.renderMain(null); setPane(panes.sver, 'pane-main'); secrets.renderVersion(panes.sver, v); }
      else { secrets.renderVersion(null); setPane(panes.smain, 'pane-main'); secrets.renderMain(panes.smain); }
    } else if (v) {
      secrets.renderMain(null); setPane(panes.sver, 'full'); secrets.renderVersion(panes.sver, v); showNav = false;
    } else if (R.sver === 'list') {
      secrets.renderMain(null); secrets.renderVersion(null); setPane(panes.slist, 'full'); secrets.renderList(panes.slist); showNav = false;
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
function emptyMsg(t, s) { $('.empty', panes.empty).innerHTML = `<b>${esc(t)}</b>${esc(s)}`; }

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
    const f = getFold();
    if (app.R.view === 'tasks') setFold('tlist', !f.tlist);
    else if (app.R.view === 'notes') { const all = f.tree && f.list; f.tree = !all; f.list = !all; try { localStorage.setItem(FOLD_KEY, JSON.stringify(f)); } catch (x) { /* */ } render(); }
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
    if (app.R.page) go({ page: null }); else if (app.R.task) go({ task: null }); else if (app.R.acc) go({ acc: null }); else if (app.R.vent && app.R.vent !== 'new') go({ vent: null }); else if (app.R.sver) go({ sver: app.desk || app.R.sver === 'list' ? null : 'list' });
  }
});

boot().catch(e => { console.error(e); message('Errore di avvio', esc(e.message)); });
