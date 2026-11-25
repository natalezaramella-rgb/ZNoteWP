// Accessi per i clienti: anagrafica cifrata (cliente, email, indirizzo, utente, password iniziale)
// e invio via email di un link monouso a scadenza per leggere la password.
import { api, isOffline, CFG } from './api.js';
import { S } from './store.js';
import * as store from './store.js';
import { app } from './ctx.js';
import { ic } from './icons.js';
import { $, $$, esc, debounce, sheet, closeOverlay, confirmDialog, toast, toastErr, fmtWhen } from './ui.js';
import { b64, rand, sha256hex } from './crypto.js';

const te = new TextEncoder();
const KIND = 'access';

export const DEFAULT_TPL = {
  subject: 'Accesso a {software}',
  body: `Gentile {cliente},

ecco i dati per accedere a {software}.

Indirizzo: {indirizzo}
Nome utente: {utente}

La password iniziale si legge una sola volta da questo link, valido fino al {scadenza}:
{link}

Al primo accesso ti consiglio di cambiarla.
Se il link è scaduto o è già stato usato, rispondi a questa email e te ne mando uno nuovo.

Cordiali saluti,
{mittente}`,
  fromName: '',
  fromEmail: '',
  hours: 48,
};
const PLACEHOLDERS = [
  ['cliente', 'nome del cliente'], ['software', 'nome del software'], ['indirizzo', 'indirizzo (link) del software'],
  ['utente', 'nome utente'], ['link', 'link monouso alla password (obbligatorio)'], ['scadenza', 'data e ora di scadenza del link'],
  ['ore', 'validità in ore'], ['mittente', 'il tuo nome'],
];

// ---------- dati ----------
export const list = () => store.all(KIND).sort((a, b) => (a.d.client || a.d.software || '').localeCompare(b.d.client || b.d.software || '', 'it', { sensitivity: 'base' }));
const label = it => it.d.client || it.d.software || 'Nuovo accesso';
export function tpl() { return { ...DEFAULT_TPL, ...(store.settings().accessTpl || {}) }; }
const myName = () => tpl().fromName || (S.me && S.me.user && S.me.user.name) || '';

let links = new Map(); // item_id → invii, dal più recente
let linksAt = 0;
let linksBusy = null;
window.addEventListener('focus', () => { if (S.space && app.R.view === 'access') loadLinks(true); });
export function loadLinks(force = false) {
  if (S.offline) return Promise.resolve();
  if (!force && (linksBusy || Date.now() - linksAt < 20000)) return linksBusy || Promise.resolve();
  linksBusy = api('GET', 'access/status', undefined, { quiet: true }).then(r => {
    const m = new Map();
    for (const l of r.links) { if (!m.has(l.item_id)) m.set(l.item_id, []); m.get(l.item_id).push(l); }
    links = m; linksAt = Date.now();
    app.render();
  }).catch(e => { if (!isOffline(e)) console.warn(e); }).finally(() => { linksBusy = null; });
  return linksBusy;
}
const lastLink = id => (links.get(id) || [])[0] || null;

function stateChip(l, short = false) {
  if (!l) return short ? '' : '<span class="chip">Mai inviato</span>';
  const st = l.state === 'active' && new Date(l.expires_at) <= new Date() ? 'expired' : l.state;
  if (st === 'active') return `<span class="chip tag">${ic('link')}${short ? 'Link attivo' : 'Link attivo fino a ' + esc(fmtWhen(l.expires_at))}</span>`;
  if (st === 'viewed') return `<span class="chip mail">${ic('check')}${short ? 'Aperto' : 'Aperto dal cliente ' + esc(fmtWhen(l.viewed_at))}</span>`;
  if (st === 'expired') return `<span class="chip late">${short ? 'Link scaduto' : 'Link scaduto ' + esc(fmtWhen(l.expires_at))}</span>`;
  return `<span class="chip">${short ? 'Link annullato' : 'Link annullato ' + esc(fmtWhen(l.revoked_at))}</span>`;
}

// ---------- elenco ----------
let filter = '';
export function renderList(el) {
  loadLinks();
  if (!el._bound) {
    el._bound = true;
    el.innerHTML = `
      <div class="topbar">
        <div class="grow" style="padding-left:10px"><div class="apptitle">Secrets clienti</div></div>
        <button class="ib needs-net" data-a="tpl" aria-label="Modello dell'email" title="Modello dell'email">${ic('mail')}</button>
        <button class="ib" data-a="lock" data-only="phone" aria-label="Blocca">${ic('lock')}</button>
      </div>
      <label class="searchbox">${ic('search')}<input id="accQ" type="search" placeholder="Cerca cliente, software, email" aria-label="Cerca nei secrets clienti" autocomplete="off"></label>
      <div class="scroll" id="accRows"></div>
      <button class="fab needs-net" data-a="add">${ic('plus')}Accesso</button>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      if (b.dataset.a === 'open') app.go({ view: 'access', acc: b.dataset.id });
      else if (b.dataset.a === 'add') add();
      else if (b.dataset.a === 'tpl') editTemplate();
      else if (b.dataset.a === 'lock') app.lock();
    });
    $('#accQ', el).addEventListener('input', e => { filter = e.target.value.trim().toLowerCase(); paintRows(el); });
  }
  paintRows(el);
}

function paintRows(el) {
  const rows = list().filter(it => !filter || [it.d.client, it.d.software, it.d.email, it.d.username, it.d.url].some(v => (v || '').toLowerCase().includes(filter)));
  const cur = app.R.acc;
  $('#accRows', el).innerHTML = rows.length ? rows.map(it => `
    <div class="page-row ${it.id === cur ? 'sel' : ''}" data-a="open" data-id="${it.id}">
      <div class="pg"><div class="pt">${ic('key')}${esc(label(it))}</div>
        <div class="ps">${esc([it.d.client ? it.d.software : '', it.d.email].filter(Boolean).join(' · ') || 'Dati da completare')}</div>
        <div style="margin-top:4px">${stateChip(lastLink(it.id), true)}</div></div>
    </div>`).join('') + '<div style="height:90px"></div>'
    : `<div class="empty"><b>${filter ? 'Nessun accesso trovato' : 'Nessun accesso'}</b>${filter ? 'Prova con altre parole.' : 'Aggiungi un accesso con indirizzo, nome utente, password iniziale ed email del cliente, poi inviaglielo con un link monouso.'}</div>`;
}

function add() {
  if (!store.canWrite()) return;
  const id = store.create(KIND, null, { client: '', email: '', software: '', url: '', username: '', password: genPassword(), notes: '', hours: tpl().hours });
  app.go({ view: 'access', acc: id });
  setTimeout(() => { const f = $('#aClient'); if (f) f.focus(); }, 60);
}

// ---------- dettaglio ----------
let D = null; // { id, el }
const FIELDS = [
  ['client', 'aClient', 'Cliente', 'text', 'Nome e cognome o ragione sociale'],
  ['email', 'aEmail', 'Email del cliente', 'email', 'cliente@esempio.it'],
  ['software', 'aSoftware', 'Software', 'text', 'Es. Gestionale ordini'],
  ['url', 'aUrl', 'Indirizzo', 'url', 'https://…'],
  ['username', 'aUser', 'Nome utente', 'text', ''],
];

export function flush() { if (D && D.save) D.save.flush(); }

export function renderDetail(el, id) {
  if (!el) { flush(); D = null; return; }
  const it = store.get(id);
  if (!it || !it.d) return;
  if (D && D.id === id && D.el === el && el.isConnected) { paintStatus(); return; }
  flush();
  const ro = S.offline;
  const d = it.d;
  el.innerHTML = `
    <div class="topbar">
      <button class="ib" data-a="back" data-only="phone" aria-label="Indietro">${ic('back')}</button>
      <div class="grow" style="padding-left:6px"><div class="apptitle" id="aTitle">${esc(label(it))}</div></div>
      <button class="ib needs-net" data-a="del" aria-label="Elimina accesso">${ic('trash')}</button>
    </div>
    <div class="scroll"><div class="form acc-form">
      ${ro ? '<div class="ro-note">Offline: sola lettura.</div>' : ''}
      ${FIELDS.map(([k, fid, lab, type, ph]) => `<label class="flab" for="${fid}">${lab}</label>
        <input class="field-in" id="${fid}" data-k="${k}" type="${type}" value="${esc(d[k] || '')}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false" ${ro ? 'readonly' : ''}>`).join('')}
      <label class="flab" for="aPw">Password iniziale</label>
      <div class="acc-pw">
        <input class="field-in" id="aPw" data-k="password" type="password" value="${esc(d.password || '')}" autocomplete="new-password" spellcheck="false" ${ro ? 'readonly' : ''}>
        <button class="btn ghost small" data-a="pw-show" aria-label="Mostra o nascondi la password">Mostra</button>
        <button class="ib" data-a="pw-copy" aria-label="Copia password" title="Copia">${ic('copy')}</button>
        <button class="ib needs-net" data-a="pw-gen" aria-label="Genera password" title="Genera una nuova password">${ic('restore')}</button>
      </div>
      <label class="flab" for="aNotes">Note per te (non vengono inviate)</label>
      <textarea class="field-in" id="aNotes" data-k="notes" rows="3" ${ro ? 'readonly' : ''}>${esc(d.notes || '')}</textarea>
      <div class="acc-send">
        <h3>Invio al cliente</h3>
        <div id="aStatus"></div>
        <div class="btnrow needs-net" id="aBtns"></div>
        <div class="hint muted" style="font-size:12.5px;margin-top:10px">Il cliente riceve indirizzo e nome utente nell'email e un link che mostra la password una sola volta. La chiave per leggerla è solo nel link: il sito conserva la password cifrata, e la cancella appena il cliente la apre o il link scade.</div>
      </div>
    </div></div>`;
  D = { id, el };
  D.save = debounce(() => {
    const cur = store.get(id);
    if (!cur || !cur.d || S.offline) return;
    const patch = {};
    $$('[data-k]', el).forEach(f => { if ((cur.d[f.dataset.k] || '') !== f.value) patch[f.dataset.k] = f.value; });
    if (Object.keys(patch).length) store.update(id, x => Object.assign(x, patch));
  }, 500);
  if (!el._accBound) {
    el._accBound = true;
    el.addEventListener('input', e => {
      if (!D || !e.target.dataset.k) return;
      D.save();
      if (['client', 'software'].includes(e.target.dataset.k)) $('#aTitle', el).textContent = $('#aClient', el).value || $('#aSoftware', el).value || 'Nuovo accesso';
    });
    el.addEventListener('change', e => { if (e.target.dataset.k && D && D.save) D.save.flush(); });
    el.addEventListener('click', e => { if (D) onDetailClick(e, D.id, el); });
  }
  paintStatus();
  // Aprendo un accesso lo stato del link dev'essere fresco (il cliente potrebbe averlo appena aperto).
  if (Date.now() - linksAt > 3000) loadLinks(true); else loadLinks();
}

function paintStatus() {
  if (!D || !D.el.isConnected) return;
  const hist = links.get(D.id) || [];
  const l = hist[0];
  const active = l && l.state === 'active' && new Date(l.expires_at) > new Date();
  $('#aStatus', D.el).innerHTML = `<div>${stateChip(l)}</div>` + (hist.length ? `<div class="acc-hist">${hist.slice(0, 6).map(h => `<div>Inviato ${esc(fmtWhen(h.created_at))} · ${stateChip(h, true)}</div>`).join('')}</div>` : '');
  $('#aBtns', D.el).innerHTML = `<button class="btn primary" data-a="send">${ic('mail')}${l ? 'Invia nuovo link' : 'Invia accessi'}</button>`
    + (active ? '<button class="btn ghost" data-a="revoke">Annulla il link</button>' : '')
    + '<button class="btn ghost" data-a="tpl">Modello email</button>';
}

async function onDetailClick(e, id, el) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const pw = $('#aPw', el);
  switch (b.dataset.a) {
    case 'back': flush(); app.go({ acc: null }); break;
    case 'pw-show': pw.type = pw.type === 'password' ? 'text' : 'password'; b.textContent = pw.type === 'password' ? 'Mostra' : 'Nascondi'; break;
    case 'pw-copy': try { await navigator.clipboard.writeText(pw.value); toast('Password copiata.'); } catch (x) { toast('Copia non riuscita.'); } break;
    case 'pw-gen':
      if (!store.canWrite()) return;
      if (pw.value && !await confirmDialog('Nuova password', 'Sostituisco la password iniziale con una nuova generata a caso? Ricordati di impostarla anche nel software.', { ok: 'Genera' })) return;
      pw.value = genPassword(); pw.type = 'text'; D.save.flush(); break;
    case 'send': flush(); sendDialog(id); break;
    case 'revoke':
      if (!await confirmDialog('Annullare il link?', 'Il link inviato al cliente smetterà subito di funzionare. Potrai inviarne uno nuovo.', { ok: 'Annulla il link', danger: true, cancel: 'Indietro' })) return;
      try { await api('POST', 'access/revoke', { item_id: id }); toast('Link annullato.'); await loadLinks(true); } catch (x) { toastErr(x); }
      break;
    case 'tpl': editTemplate(); break;
    case 'del': {
      if (!await confirmDialog('Eliminare l\'accesso?', 'L\'accesso viene cancellato definitivamente da tutti i dispositivi e un eventuale link ancora valido smette di funzionare.', { ok: 'Elimina', danger: true })) return;
      try {
        await api('POST', 'access/revoke', { item_id: id });
        D = null;
        await store.purge(id);
        app.go({ acc: null });
        toast('Accesso eliminato.');
      } catch (x) { toastErr(x); }
      break;
    }
  }
}

// ---------- invio ----------
function fill(t, v) { return t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)); }
const pad = n => String(n).padStart(2, '0');
function fmtExpiry(ms) {
  const d = new Date(ms);
  return `${d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} alle ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function vars(d, hours, link) {
  return { cliente: d.client || '', software: d.software || '', indirizzo: d.url || '', utente: d.username || '', link, scadenza: fmtExpiry(Date.now() + hours * 3600e3), ore: String(hours), mittente: myName() };
}

function sendDialog(id) {
  const it = store.get(id);
  if (!it || !store.canWrite()) return;
  const d = it.d;
  const miss = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email || '')) miss.push('l\'email del cliente');
  if (!d.password) miss.push('la password iniziale');
  if (!d.username) miss.push('il nome utente');
  if (miss.length) { toast('Prima inserisci ' + miss.join(', ') + '.'); return; }
  const T = tpl();
  const hours0 = d.hours || T.hours || 48;
  const el = sheet(`<h3>${lastLink(id) ? 'Invia un nuovo link' : 'Invia gli accessi'}</h3>
    <form id="sendF">
      <label class="flab">A</label><div class="addr">${esc(d.email)}</div>
      <label class="flab" for="sHours">Il link vale per (ore)</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input class="field-in" id="sHours" type="number" min="1" max="720" value="${hours0}" style="width:110px">
        ${[24, 48, 72, 168].map(h => `<button type="button" class="chip list" data-h="${h}">${h === 168 ? '7 giorni' : h + ' ore'}</button>`).join('')}</div>
      <div class="hint muted" style="font-size:12.5px;margin-top:6px" id="sExp"></div>
      <label class="flab">Anteprima</label>
      <div class="acc-preview"><div class="acc-subj" id="sSubj"></div><pre id="sBody"></pre></div>
      ${lastLink(id) && lastLink(id).state === 'active' ? '<div class="warnbox">Il link inviato prima smetterà di funzionare.</div>' : ''}
      <div class="err"></div>
      <div class="row-end"><button type="button" class="btn ghost" data-a="tpl-edit">Modifica modello</button><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary" id="sGo">${ic('mail')}Invia</button></div>
    </form>`, { wide: true, label: 'Invia accessi' });
  const hoursIn = $('#sHours', el);
  const paint = () => {
    const h = Math.min(720, Math.max(1, parseInt(hoursIn.value, 10) || hours0));
    const v = vars(d, h, '🔗 link monouso alla password');
    $('#sSubj', el).textContent = fill(T.subject, v);
    $('#sBody', el).textContent = withLink(T.body, v);
    $('#sExp', el).textContent = 'Scade ' + v.scadenza + '.';
  };
  paint();
  hoursIn.addEventListener('input', paint);
  el.addEventListener('click', e => {
    const h = e.target.closest('[data-h]');
    if (h) { hoursIn.value = h.dataset.h; paint(); }
    if (e.target.closest('[data-a="tpl-edit"]')) editTemplate(() => sendDialog(id));
  });
  $('#sendF', el).addEventListener('submit', async e => {
    e.preventDefault();
    const h = parseInt(hoursIn.value, 10);
    if (!(h >= 1 && h <= 720)) { $('.err', el).textContent = 'Scegli una validità da 1 a 720 ore.'; return; }
    const go = $('#sGo', el);
    go.disabled = true; go.textContent = 'Invio…';
    try {
      await sendNow(id, h);
      closeOverlay();
      toast(`Accessi inviati a ${d.email}.`);
    } catch (x) {
      $('.err', el).textContent = x.message;
      go.disabled = false; go.innerHTML = `${ic('mail')}Invia`;
    }
  });
}

/** Mette il link nel testo: se il modello non contiene {link}, lo aggiunge in fondo. */
function withLink(body, v) {
  const b = /\{link\}/.test(body) ? body : body + '\n\n{link}';
  return fill(b, v);
}

async function sendNow(id, hours) {
  const it = store.get(id);
  const d = it.d;
  const T = tpl();
  // Chiave monouso: sta solo nel frammento del link.
  const raw = rand(32);
  const keyStr = b64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = rand(12);
  const pt = te.encode(JSON.stringify({ v: 1, software: d.software || '', url: d.url || '', username: d.username || '', password: d.password, client: d.client || '' }));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('znk-access-v1') }, key, pt);
  const v = vars(d, hours, '[[ZNK_LINK]]');
  const body = {
    item_id: id,
    to: d.email.trim(),
    subject: fill(T.subject, v),
    body: withLink(T.body, v),
    from_name: T.fromName || myName(),
    from_email: T.fromEmail || '',
    hours,
    key: keyStr,
    key_check: await sha256hex('znk-kc:' + keyStr),
    payload: JSON.stringify({ iv: b64(iv), ct: b64(ct) }),
  };
  await api('POST', 'access/send', body);
  if ((d.hours || 0) !== hours) store.update(id, x => { x.hours = hours; });
  await loadLinks(true);
}

// ---------- modello dell'email ----------
export function editTemplate(after) {
  const T = tpl();
  const el = sheet(`<h3>Modello dell'email</h3>
    <form id="tplF">
      <label class="flab" for="tFrom">Nome del mittente</label>
      <input class="field-in" id="tFrom" value="${esc(T.fromName)}" placeholder="${esc((S.me && S.me.user && S.me.user.name) || 'Il tuo nome')}">
      <label class="flab" for="tFromEmail">Indirizzo mittente</label>
      <input class="field-in" id="tFromEmail" type="email" value="${esc(T.fromEmail)}" placeholder="es. info@${esc(siteDomain())}" autocomplete="off">
      <div class="hint muted" style="font-size:12.5px;margin-top:4px">Deve essere un indirizzo di ${esc(siteDomain())}. Vuoto = quello predefinito di WordPress.</div>
      <label class="flab" for="tSubj">Oggetto</label>
      <input class="field-in" id="tSubj" value="${esc(T.subject)}">
      <label class="flab" for="tBody">Testo</label>
      <textarea class="field-in" id="tBody" rows="14" style="font-family:var(--f-mono,monospace);font-size:13.5px">${esc(T.body)}</textarea>
      <label class="flab" for="tHours">Validità predefinita del link (ore)</label>
      <input class="field-in" id="tHours" type="number" min="1" max="720" value="${T.hours}" style="width:110px">
      <div class="acc-ph"><b>Segnaposto</b>${PLACEHOLDERS.map(([k, h]) => `<button type="button" class="chip list" data-ph="${k}" title="${esc(h)}">{${k}}</button>`).join('')}
        <div class="hint muted" style="font-size:12.5px;margin-top:6px">Tocca un segnaposto per inserirlo nel testo. La password non va mai nell'email: il cliente la legge dal {link}. Le risposte del cliente arrivano al tuo indirizzo del sito.</div></div>
      <div class="err"></div>
      <div class="row-end"><button type="button" class="btn ghost" data-a="reset">Ripristina</button><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Salva</button></div>
    </form>`, { wide: true, label: 'Modello dell\'email' });
  const body = $('#tBody', el);
  el.addEventListener('click', e => {
    const p = e.target.closest('[data-ph]');
    if (p) {
      const s = body.selectionStart ?? body.value.length;
      const ins = `{${p.dataset.ph}}`;
      body.value = body.value.slice(0, s) + ins + body.value.slice(body.selectionEnd ?? s);
      body.focus(); body.selectionStart = body.selectionEnd = s + ins.length;
    }
    if (e.target.closest('[data-a="reset"]')) { $('#tSubj', el).value = DEFAULT_TPL.subject; body.value = DEFAULT_TPL.body; $('#tHours', el).value = DEFAULT_TPL.hours; }
  });
  $('#tplF', el).addEventListener('submit', async e => {
    e.preventDefault();
    if (!store.canWrite()) return;
    const subject = $('#tSubj', el).value.trim();
    const text = body.value.replace(/\s+$/, '');
    const hours = parseInt($('#tHours', el).value, 10);
    const fromEmail = $('#tFromEmail', el).value.trim().toLowerCase();
    if (fromEmail && !fromOk(fromEmail)) { $('.err', el).textContent = `L'indirizzo mittente deve essere di ${siteDomain()} (es. info@${siteDomain()}).`; return; }
    if (!subject) { $('.err', el).textContent = 'Scrivi un oggetto.'; return; }
    if (!text.includes('{link}')) { $('.err', el).textContent = 'Il testo deve contenere {link}: è da lì che il cliente legge la password.'; return; }
    if (!(hours >= 1 && hours <= 720)) { $('.err', el).textContent = 'La validità va da 1 a 720 ore.'; return; }
    store.update('settings', d => { d.accessTpl = { subject, body: text, fromName: $('#tFrom', el).value.trim(), fromEmail, hours }; });
    closeOverlay();
    toast('Modello salvato.');
    if (after) after();
  });
}

const siteDomain = () => new URL(CFG.home).hostname.toLowerCase().replace(/^www\./, '');
function fromOk(e) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return false;
  const dom = e.split('@')[1]; const s = siteDomain();
  return dom === s || dom.endsWith('.' + s);
}

// ---------- password ----------
export function genPassword(n = 16) {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!#%+-=?@_'];
  const all = sets.join('');
  const lim = 256 - (256 % all.length); // niente sbilanciamenti del modulo
  for (;;) {
    let s = '';
    while (s.length < n) for (const x of rand(n)) if (x < lim && s.length < n) s += all[x % all.length];
    if (sets.every(set => [...s].some(c => set.includes(c)))) return s;
  }
}
