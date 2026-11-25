// Impostazioni: email → nota, sicurezza, app, account.
import { ic } from './icons.js';
import { $, esc, toast, confirmDialog, promptDialog, sheet, closeOverlay, fmtWhen } from './ui.js';
import { api, CFG } from './api.js';
import { kv, wipeAll } from './db.js';
import * as store from './store.js';
import { S } from './store.js';
import { app } from './ctx.js';
import * as L from './lock.js';
import { exportBackup, restoreBackup, exportMarkdown } from './transfer.js';
import { unb64 } from './crypto.js';
import { scheduleLocalReminders } from './tasks.js';

let mailInfo = null;
let local = { pin: false, bio: false, bioOk: false };

async function loadLocal() {
  local.pin = !!(await kv.get('pin')) && !!(S.me && S.me.device && S.me.device.pin);
  local.bio = !!(await kv.get('bio'));
  local.rem = !!(await kv.get('rem'));
  local.bioOk = await L.bioSupported();
}

const row = (icon, lab, hint, right) => `<div class="srow">${icon ? ic(icon) : ''}<div class="grow"><div class="lab">${lab}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>${right || ''}</div>`;
const sw = (id, on, label, extra = '') => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} aria-label="${esc(label)}" ${extra}><span></span></label>`;
const btn = (a, label, cls = 'ghost') => `<button class="btn ${cls} small" data-a="${a}">${label}</button>`;

export function render(el) {
  if (!el._bound) {
    el._bound = true;
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    loadLocal().then(() => paint(el));
    if (!S.offline) api('GET', 'mail').then(m => { mailInfo = m; paint(el); }).catch(() => {});
  }
  if (el.contains(document.activeElement) && document.activeElement.matches('input[type=email],input[type=text]')) return;
  paint(el);
}

function paint(el) {
  const st = store.settings();
  const me = S.me || { user: {}, recovery: {} };
  const mailCfg = st.mail || {};
  const secs = store.all('section').sort(store.bySort);
  const lists = store.all('list').sort(store.bySort);
  const er = S.recovery || me.recovery.email || 'off';
  const theme = localStorage.getItem('znk-theme') || 'auto';
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const notifOn = !!st.notify && 'Notification' in window && Notification.permission === 'granted';
  const scroll = $('.scroll', el);
  const top = scroll ? scroll.scrollTop : 0;
  el.innerHTML = `
    <div class="topbar"><div class="grow" style="padding-left:10px"><div class="apptitle">Impostazioni</div></div><button class="ib" data-a="lock" data-only="phone" aria-label="Blocca">${ic('lock')}</button></div>
    <div class="scroll">
      <div class="sect"><div class="secure">${ic('shield')}<div><b>Tutto è cifrato su questo dispositivo</b><span>Titoli, testi, disegni, immagini ed email importate arrivano al sito già cifrati (AES-256-GCM). La password delle note non lascia mai il dispositivo. In chiaro restano solo date di scadenza, stato completato e ordine, che servono a ordinare e ad avvisarti.</span></div></div></div>

      <div class="sect"><h3>Email → nota</h3><div class="card">
        ${mailInfo && mailInfo.address ? row('mail', 'Inoltra a questo indirizzo', `<div class="addr">${esc(mailInfo.address)}</div>`, `<button class="ib" data-a="copy-addr" aria-label="Copia indirizzo">${ic('copy')}</button>`)
          : row('mail', 'Indirizzo personale', mailInfo ? 'La casella email non è ancora configurata dall\'amministratore del sito (Utenti › ZNoteKeeper › Email → nota).' : (S.offline ? 'Non disponibile offline.' : 'Carico…'))}
        ${row('', 'Cosa viene importato', '<div class="flow"><span>Oggetto → titolo</span><span>Corpo → testo (Markdown)</span><span>Immagini e PDF fino a 5 MB → allegati cifrati</span><s>altri allegati: solo il nome</s></div>')}
        <div class="srow"><div class="grow"><div class="lab">Dove finisce</div><div class="hint">Scrivi <b>#nome</b> nell'oggetto per mandarla in una sezione o lista con quel nome (es. #ricette).</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            <select id="mMode" class="needs-net"><option value="page" ${mailCfg.mode !== 'task' ? 'selected' : ''}>Nuova pagina in</option><option value="task" ${mailCfg.mode === 'task' ? 'selected' : ''}>Nuova attività in</option></select>
            <select id="mDest" class="needs-net">${mailCfg.mode === 'task' ? lists.map(l => `<option value="${l.id}" ${l.id === mailCfg.list ? 'selected' : ''}>${esc(l.d.title)}</option>`).join('') : secs.map(s => `<option value="${s.id}" ${s.id === mailCfg.section ? 'selected' : ''}>${esc(s.d.title)}</option>`).join('')}</select>
          </div></div></div>
        <div class="srow"><div class="grow"><div class="lab">Mittenti ammessi</div><div class="hint">Solo le email da questi indirizzi diventano note, e solo se il loro dominio supera i controlli SPF/DKIM. Il sito conserva un'impronta dell'indirizzo, non l'indirizzo.</div>
          <div class="senders">${mailInfo ? (mailInfo.senders.length ? mailInfo.senders.map(s => `<span class="sender">${esc(s.hint)}<button data-a="rm-sender" data-h="${s.hash}" aria-label="Rimuovi" class="needs-net">${ic('close', 'sm')}</button></span>`).join('') : '<span class="hint">Nessun mittente: aggiungi i tuoi indirizzi.</span>') : ''}</div>
          <form id="addSender" class="needs-net" style="display:flex;gap:8px;margin-top:8px"><input class="field-in" type="email" placeholder="tuo@indirizzo.it" style="min-height:40px;padding:8px 12px" aria-label="Nuovo mittente"><button class="btn ghost small">Aggiungi</button></form></div></div>
        ${row('', 'Controllo della casella', mailInfo && mailInfo.last_check ? `Ultimo controllo: ${esc(fmtWhen(mailInfo.last_check))}` : 'Mai eseguito', btn('mail-test', 'Prova'))}
        ${row('', 'Indirizzo compromesso o pieno di spam?', 'Generane uno nuovo: quello vecchio smette subito di funzionare.', btn('mail-regen', 'Rigenera'))}
        <div class="srow"><div class="hint">L'email viaggia in chiaro dal tuo provider fino al sito; lì viene subito chiusa con la tua chiave pubblica e cancellata dalla casella. Da quel momento può leggerla solo chi conosce la tua password.</div></div>
      </div></div>

      <div class="sect"><h3>Sicurezza</h3><div class="card">
        ${row('lock', 'Blocco automatico', 'Dopo questo tempo senza attività l\'app si richiude.', `<select id="autolock"><option value="0">Subito</option><option value="1">1 minuto</option><option value="5">5 minuti</option><option value="15">15 minuti</option><option value="60">1 ora</option></select>`)}
        ${row('finger', 'Sblocco con impronta o volto', local.bioOk ? 'Su questo dispositivo. Richiede un browser che supporti le passkey con estensione PRF (Chrome/Edge recenti, Android, iPhone con iOS 18 o successivo).' : 'Non disponibile su questo dispositivo o browser: usa il PIN.', local.bioOk ? sw('bio', local.bio, 'Sblocco biometrico', 'class="needs-net"') : '')}
        ${row('phone', 'Ricorda questo dispositivo', 'Si apre senza password finché non premi «Blocca» o lo scolleghi. Il blocco automatico resta spento. Solo su un dispositivo che usi solo tu.', sw('remember', local.rem, 'Ricorda questo dispositivo', 'class="needs-net"'))}
        ${row('key', 'PIN di sblocco', 'Solo su questo dispositivo e solo online. Dopo 5 errori si disattiva.', sw('pin', local.pin, 'PIN', 'class="needs-net"'))}
        ${row('shield', 'Codice di recupero', me.recovery.code_created ? `Creato ${esc(fmtWhen(me.recovery.code_created))}. Quello vecchio smette di valere.` : '', btn('new-code', 'Nuovo'))}
        ${row('mail', 'Recupero via email', er === 'off' ? 'Spento. Con il recupero attivo il sito conserva una copia protetta della chiave, legata alla tua email e alla password WordPress attuali.' : er === 'pending' ? 'Recupero in corso: completabile dopo 24 ore.' : er === 'ready' ? 'Recupero pronto per essere completato.' : `Attivo per ${esc(me.user.email || '')}. Link monouso di 30 minuti, poi 24 ore di attesa.`, sw('mailrec', er !== 'off', 'Recupero via email', 'class="needs-net"'))}
        ${er === 'pending' || er === 'ready' ? row('', 'Non hai chiesto tu il recupero?', '', btn('er-cancel', 'Annulla recupero', 'danger')) : ''}
        ${row('phone', 'Dispositivi collegati', 'Scollega un dispositivo perso o che non usi più.', btn('devices', 'Gestisci'))}
        ${row('key', 'Cambia password delle note', 'Immediato: le note restano come sono.', btn('change-pw', 'Cambia'))}
      </div></div>

      <div class="sect"><h3>Backup ed esportazione</h3><div class="card">
        ${row('download', 'Backup cifrato', 'File .znk con tutto il tuo spazio, leggibile solo con la tua password.', btn('backup', 'Scarica'))}
        ${row('upload', 'Ripristina da backup', 'Aggiunge o sostituisce gli elementi presenti nel file.', btn('restore', 'Scegli file'))}
        ${row('md', 'Esportazione leggibile', 'Archivio .zip con pagine e attività in Markdown, immagini e disegni. Non cifrato.', btn('export-md', 'Esporta'))}
        ${row('trash', 'Cestino', 'Pagine, attività, sezioni e liste eliminate negli ultimi 30 giorni.', btn('trash', 'Apri'))}
      </div></div>

      <div class="sect"><h3>App sul telefono e sul PC</h3><div class="card">
        ${app.standalone() ? row('phone', 'App installata', 'Stai usando ZNoteKeeper come app.') :
          row('phone', 'Installa ZNoteKeeper', app.canInstall ? 'Finestra propria, icona nel menu Start o nella Home, apertura anche offline.' : isIOS ? 'In Safari: tocca Condividi, poi «Aggiungi alla schermata Home». Serve anche per ricevere i promemoria.' : 'Dal menu del browser: «Installa app» (Chrome, Edge) oppure l\'icona di installazione nella barra degli indirizzi.', app.canInstall ? btn('install', 'Installa', 'primary') : '')}
        ${row('bell', 'Promemoria delle scadenze', 'Con l\'app aperta il promemoria mostra il titolo; quando è chiusa arriva un avviso generico «Hai un\'attività in scadenza», perché il sito non può leggere i titoli.', sw('notif', notifOn, 'Promemoria', 'class="needs-net"'))}
        ${row('sliders', 'Aspetto', '', `<select id="theme"><option value="auto" ${theme === 'auto' ? 'selected' : ''}>Come il sistema</option><option value="light" ${theme === 'light' ? 'selected' : ''}>Chiaro</option><option value="dark" ${theme === 'dark' ? 'selected' : ''}>Scuro</option></select>`)}
        ${app.desk ? row('', 'Scorciatoie da tastiera', 'Ctrl+K cerca · Alt+N nuova pagina · Alt+T nuova attività · Alt+1…6 cambia sezione · Ctrl+S salva i segreti · Ctrl+Maiusc+L blocca · Ctrl+\\ nasconde i pannelli · nel testo: Ctrl+B, Ctrl+I, Ctrl+K link, Tab rientro') : ''}
      </div></div>

      <div class="sect" style="padding-bottom:28px"><h3>Account</h3><div class="card">
        <div class="srow"><div class="logo" style="width:38px;height:38px;font-size:15px;border-radius:11px">${esc((me.user.name || '?').slice(0, 1).toUpperCase())}</div><div class="grow"><div class="lab">${esc(me.user.name || '')}</div><div class="hint">Utente WordPress ${esc(me.user.login || '')} · ${esc(me.user.email || '')}</div></div></div>
        ${me.user.admin ? row('sliders', 'Utenti abilitati e casella email', 'Solo per gli amministratori del sito.', `<a class="btn ghost small" href="${esc(me.user.admin_url)}" target="_blank" rel="noopener">Apri</a>`) : ''}
        ${row('logout', 'Scollega questo dispositivo', 'Cancella la copia locale cifrata e il collegamento. Per riaprire servirà di nuovo l\'accesso al sito.', btn('unpair', 'Scollega', 'danger'))}
        ${row('', 'Versione', `ZNoteKeeper ${esc(CFG.version)} · ${esc(CFG.site)}`)}
      </div></div>
    </div>`;
  $('#autolock', el).value = String(st.autolock ?? 5);
  const sc = $('.scroll', el); if (sc) sc.scrollTop = top;
}

async function onChange(e) {
  const t = e.target;
  const el = t.closest('[data-pane]') || document;
  if (t.id === 'theme') { localStorage.setItem('znk-theme', t.value); applyTheme(); return; }
  if (t.id === 'autolock') { if (store.canWrite()) store.update('settings', d => { d.autolock = +t.value; }); return; }
  if (t.id === 'mMode') {
    if (!store.canWrite()) return;
    const mode = t.value;
    store.update('settings', d => { d.mail = { ...(d.mail || {}), mode }; if (mode === 'task' && !d.mail.list) d.mail.list = (store.all('list')[0] || {}).id; if (mode === 'page' && !d.mail.section) d.mail.section = (store.all('section')[0] || {}).id; });
    return;
  }
  if (t.id === 'mDest') { if (store.canWrite()) store.update('settings', d => { d.mail = { ...(d.mail || {}) }; d.mail[d.mail.mode === 'task' ? 'list' : 'section'] = t.value; }); return; }
  if (t.id === 'remember') {
    try {
      if (t.checked) { await L.enableRemember(); local.rem = true; try { localStorage.setItem('znk-remember', '1'); } catch (x) { /* */ } toast('Questo dispositivo ora si apre senza password.'); }
      else { await L.forgetRemember(); local.rem = false; try { localStorage.setItem('znk-remember', '0'); } catch (x) { /* */ } toast('Dispositivo dimenticato: al prossimo accesso servirà la password.'); }
    } catch (err) { toast(err.message); }
    paint(el); return;
  }
  if (t.id === 'pin') {
    t.checked = !t.checked;
    if (!local.pin) { const p = await L.askPassword('Attiva il PIN'); if (p && await L.enablePin(p.auth)) { local.pin = true; S.me.device.pin = true; toast('PIN attivo su questo dispositivo.'); } }
    else { await L.disablePin(); local.pin = false; S.me.device.pin = false; toast('PIN disattivato.'); }
    paint(el); return;
  }
  if (t.id === 'bio') {
    t.checked = !t.checked;
    if (!local.bio) {
      const p = await L.askPassword('Attiva impronta o volto');
      if (!p) return;
      try { await L.enableBio(); local.bio = true; toast('Sblocco con impronta o volto attivo su questo dispositivo.'); } catch (err) { toast(err.name === 'NotAllowedError' ? 'Operazione annullata.' : err.message); }
    } else { await L.disableBio(); local.bio = false; toast('Sblocco biometrico disattivato.'); }
    paint(el); return;
  }
  if (t.id === 'mailrec') {
    const on = t.checked;
    t.checked = !on;
    try { if (await L.toggleEmailRecovery(on)) { S.recovery = on ? 'on' : 'off'; } } catch (err) { toast(err.message); }
    paint(el); return;
  }
  if (t.id === 'notif') {
    t.checked = !t.checked;
    await toggleNotify(!store.settings().notify || Notification.permission !== 'granted');
    paint(el);
  }
}

async function toggleNotify(on) {
  if (!store.canWrite()) return;
  if (!on) {
    store.update('settings', d => { d.notify = false; });
    try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); await api('DELETE', 'push'); } catch (e) { /* */ }
    toast('Promemoria spenti su questo dispositivo.');
    return;
  }
  if (!('Notification' in window)) { toast('Questo browser non supporta le notifiche. Su iPhone aggiungi prima l\'app alla schermata Home.'); return; }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Permesso per le notifiche non concesso.'); return; }
  await store.update('settings', d => { d.notify = true; });
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.pushManager && S.me.push_key) {
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64(S.me.push_key.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((S.me.push_key.length + 3) % 4)) });
      await api('POST', 'push', { endpoint: sub.endpoint });
    }
    toast('Promemoria attivi.');
  } catch (e) { toast('Promemoria attivi solo con l\'app aperta: ' + e.message); }
  scheduleLocalReminders();
}

async function onClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const el = b.closest('[data-pane]');
  const a = b.dataset.a;
  try {
    switch (a) {
      case 'lock': app.lock(); break;
      case 'copy-addr': navigator.clipboard.writeText(mailInfo.address).then(() => toast('Indirizzo copiato.')); break;
      case 'rm-sender': mailInfo.senders = await api('DELETE', `mail/senders/${b.dataset.h}`); paint(el); break;
      case 'mail-test': await api('POST', 'mail/test', {}); toast('Email di prova creata: tra un attimo la trovi tra le note.'); setTimeout(async () => { await store.sync(); (await import('./mailin.js')).importInbox(); }, 500); break;
      case 'mail-regen':
        if (await confirmDialog('Generare un nuovo indirizzo?', 'Quello attuale smetterà subito di funzionare: aggiorna gli inoltri automatici che lo usano.', { ok: 'Rigenera', danger: true })) { const r = await api('POST', 'mail/regenerate', {}); mailInfo.address = r.address; paint(el); toast('Nuovo indirizzo pronto.'); }
        break;
      case 'new-code': await L.newRecoveryCodeFlow(); S.me = await api('GET', 'me'); paint(el); break;
      case 'er-cancel': await api('POST', 'recover/email/cancel', {}); S.recovery = 'on'; toast('Recupero annullato.'); paint(el); break;
      case 'devices': devices(); break;
      case 'change-pw': L.changePassword(); break;
      case 'backup': exportBackup(); break;
      case 'restore': restoreBackup(); break;
      case 'export-md': exportMarkdown(); break;
      case 'trash': app.go({ view: 'notes', section: 'v:trash', page: null }); break;
      case 'install': if (await app.install()) toast('ZNoteKeeper installata.'); paint(el); break;
      case 'unpair':
        if (await confirmDialog('Scollegare questo dispositivo?', 'La copia locale verrà cancellata. Le note restano sul sito, cifrate.', { ok: 'Scollega', danger: true })) {
          try { await api('DELETE', 'device'); } catch (err) { /* */ }
          await wipeAll();
          location.href = CFG.home;
        }
        break;
    }
  } catch (err) { toast(err.message); }
}

document.addEventListener('submit', async e => {
  if (e.target.id !== 'addSender') return;
  e.preventDefault();
  const inp = e.target.querySelector('input');
  try { mailInfo.senders = await api('POST', 'mail/senders', { email: inp.value.trim() }); inp.value = ''; paint(e.target.closest('[data-pane]')); toast('Mittente aggiunto.'); } catch (err) { toast(err.message); }
});

async function devices() {
  const p = await L.askPassword('Dispositivi collegati');
  if (!p) return;
  const list = await api('GET', 'devices');
  const el = sheet(`<h3>Dispositivi collegati</h3><p class="muted">Ogni dispositivo resta collegato per 180 giorni dall'ultimo uso.</p>
    ${list.map(d => `<div class="ver"><div class="grow"><b>${esc(d.name)}</b>${d.current ? ' <span class="chip tag">questo</span>' : ''}<div class="path">Ultimo uso ${esc(fmtWhen(d.last_seen))} · collegato ${esc(fmtWhen(d.created))}${d.pin ? ' · PIN' : ''}${d.remember ? ' · ricordato' : ''}${d.push ? ' · promemoria' : ''}</div></div>
      ${d.current ? '' : `<button class="btn ghost small" data-dev="${d.id}">Scollega</button>`}</div>`).join('')}
    <div class="row-end"><button class="btn primary" data-close>Fatto</button></div>`);
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-dev]');
    if (!b) return;
    try { await api('DELETE', `devices/${b.dataset.dev}`, { auth: p.auth }); b.closest('.ver').remove(); toast('Dispositivo scollegato.'); } catch (err) { toast(err.message); }
  });
}

export function applyTheme() {
  const t = localStorage.getItem('znk-theme') || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const m = document.querySelector('meta[name=theme-color]');
  if (m) {
    // colori dell'aspetto scelto per il sito (variabili CSS), con i valori originali come riserva
    const cs = getComputedStyle(document.documentElement);
    m.content = (cs.getPropertyValue(dark ? '--surface' : '--accent') || '').trim() || (dark ? '#131A18' : '#136F5E');
  }
}
try { applyTheme(); } catch (e) { /* */ }
export { closeOverlay, promptDialog };
