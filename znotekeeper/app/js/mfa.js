// Verifica in due passaggi: codice a 6 cifre da un'app di autenticazione (facoltativa, per utente).
import { api, ApiError, CFG } from './api.js';
import { $, esc, sheet, closeOverlay, toast, download, fmtWhen } from './ui.js';

/** Chiede il codice a 6 cifre (o un codice di riserva). Restituisce null se l'utente annulla. */
export function askCode(error = '', title = 'Verifica in due passaggi') {
  return new Promise(res => {
    let done = false;
    const el = sheet(`<h3>${esc(title)}</h3><p class="muted">Scrivi il codice a 6 cifre della tua app di autenticazione. Se non hai il telefono, usa un codice di riserva.</p>
      <form><input class="field-in" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="20" placeholder="Codice" aria-label="Codice di verifica" style="text-align:center;letter-spacing:.2em;font-size:20px">
      <div class="err" role="alert">${esc(error)}</div><div class="row-end"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Conferma</button></div></form>`,
    { onClose: () => { if (!done) res(null); } });
    $('form', el).addEventListener('submit', e => {
      e.preventDefault();
      const v = $('input', el).value.trim();
      if (!v) return;
      done = true;
      closeOverlay();
      res(v);
    });
    setTimeout(() => { const i = $('input', el); if (i) i.focus(); }, 60);
  });
}

/**
 * Come api(), ma se il sito chiede il secondo passaggio mostra la richiesta del codice
 * e ripete la stessa chiamata con il codice.
 */
export async function apiMfa(method, path, body, opts) {
  try {
    return await api(method, path, body, opts);
  } catch (e) {
    if (e.code !== 'znk_mfa_required') throw e;
  }
  let msg = '';
  for (;;) {
    const otp = await askCode(msg);
    if (!otp) throw new ApiError('Verifica in due passaggi annullata.', 0, 'znk_mfa_cancel');
    try {
      return await api(method, path, { ...(body || {}), otp }, opts);
    } catch (e) {
      if (e.code !== 'znk_mfa_bad' && e.code !== 'znk_wait') throw e;
      msg = e.message;
    }
  }
}

// ---------- QR (libreria caricata solo quando serve) ----------
let qrLib = null;
function loadQr() {
  if (window.qrcode) return Promise.resolve();
  if (!qrLib) {
    qrLib = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `${CFG.assets}vendor/qrcode.js?v=${encodeURIComponent(CFG.version)}`;
      s.onload = res;
      s.onerror = () => { qrLib = null; rej(new Error('QR non disponibile')); };
      document.head.appendChild(s);
    });
  }
  return qrLib;
}
async function drawQr(canvas, text) {
  await loadQr();
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = 5, pad = 4 * cell;
  canvas.width = canvas.height = n * cell + pad * 2;
  const g = canvas.getContext('2d');
  // Sempre scuro su bianco, anche con il tema scuro: così ogni telefono lo legge.
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(pad + c * cell, pad + r * cell, cell, cell);
}

// ---------- codici di riserva ----------
function showBackup(codes, first) {
  return new Promise(res => {
    const text = codes.join('\n');
    const el = sheet(`<h3>${first ? 'Verifica attivata' : 'Nuovi codici di riserva'}</h3>
      <p class="muted">Questi ${codes.length} codici servono se non hai il telefono. Ognuno vale <b>una sola volta</b> e sono mostrati solo adesso: salvali nel gestore di password o stampali.${first ? '' : ' I codici precedenti non valgono più.'}</p>
      <div class="codebox" style="font-size:16px;line-height:1.9;white-space:pre-line">${esc(text)}</div>
      <div class="btnrow"><button type="button" class="btn ghost" data-b="copy">Copia</button><button type="button" class="btn ghost" data-b="dl">Scarica</button></div>
      <label class="check-line"><input type="checkbox" id="mfaAck"> <span>Li ho salvati in un posto sicuro.</span></label>
      <div class="row-end"><button class="btn primary" data-b="ok" disabled>Fatto</button></div>`, { onClose: () => res() });
    $('#mfaAck', el).addEventListener('change', e => { $('[data-b=ok]', el).disabled = !e.target.checked; });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-b]');
      if (!b) return;
      if (b.dataset.b === 'copy') navigator.clipboard.writeText(text).then(() => toast('Codici copiati.'), () => toast('Copia non riuscita: selezionali e copiali a mano.'));
      if (b.dataset.b === 'dl') download('codici-riserva-znotekeeper.txt', `Codici di riserva ZNoteKeeper (verifica in due passaggi)\n\n${text}\n\nCreati il ${new Date().toLocaleString('it-IT')}. Ognuno vale una sola volta.\n`, 'text/plain');
      if (b.dataset.b === 'ok') closeOverlay();
    });
  });
}

// ---------- attivazione ----------
async function enableFlow(askPassword) {
  const p = await askPassword('Attiva la verifica in due passaggi');
  if (!p) return false;
  let st;
  try { st = await api('POST', 'mfa/start', { auth: p.auth }); } catch (e) { toast(e.message); return false; }
  const pretty = st.secret.match(/.{1,4}/g).join(' ');
  const codes = await new Promise(res => {
    let out = null;
    const el = sheet(`<h3>Collega l'app di autenticazione</h3>
      <p class="muted">Apri la tua app (Google Authenticator, Microsoft Authenticator, Aegis, 1Password…) e inquadra il codice. Poi scrivi qui le 6 cifre che mostra.</p>
      <div style="text-align:center"><canvas id="mfaQr" width="10" height="10" style="max-width:220px;width:100%;height:auto;border-radius:10px;image-rendering:pixelated" role="img" aria-label="Codice QR da inquadrare"></canvas></div>
      <p class="muted" style="text-align:center;margin-top:8px">Non puoi inquadrarlo? <a id="mfaUri" rel="noopener">Apri nell'app</a> oppure inserisci questa chiave a mano:</p>
      <div class="codebox" style="font-size:15px">${esc(pretty)}</div>
      <form><input class="field-in" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="Codice a 6 cifre" aria-label="Codice a 6 cifre" style="text-align:center;letter-spacing:.2em;font-size:20px;margin-top:12px">
      <div class="err" role="alert"></div><div class="row-end"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Attiva</button></div></form>`,
    { onClose: () => res(out) });
    $('#mfaUri', el).href = st.uri;
    drawQr($('#mfaQr', el), st.uri).catch(() => { $('#mfaQr', el).hidden = true; });
    const f = $('form', el);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      f.classList.add('busy');
      try {
        const r = await api('POST', 'mfa/enable', { otp: $('input', el).value.trim() });
        out = r.backup;
        closeOverlay();
      } catch (err) { $('.err', el).textContent = err.message; f.classList.remove('busy'); $('input', el).select(); }
    });
  });
  if (!codes) return false;
  await showBackup(codes, true);
  return true;
}

/** Azione protetta da password + codice. Restituisce la risposta, o null se annullata. */
async function guarded(askPassword, title, path, extra = {}, needCode = true) {
  const p = await askPassword(title);
  if (!p) return null;
  let msg = '';
  for (;;) {
    const otp = needCode ? await askCode(msg, title) : undefined;
    if (needCode && !otp) return null;
    try {
      return await api('POST', path, { auth: p.auth, otp, ...extra });
    } catch (e) {
      if (needCode && (e.code === 'znk_mfa_bad' || e.code === 'znk_wait')) { msg = e.message; continue; }
      toast(e.message);
      return null;
    }
  }
}

/** Pannello in Impostazioni › Sicurezza. Si risolve quando viene chiuso. */
export async function manage(askPassword) {
  let st;
  try { st = await api('GET', 'mfa'); } catch (e) { toast(e.message); return; }
  if (!st.on) {
    const go = await new Promise(res => {
      let yes = false;
      const el = sheet(`<h3>Verifica in due passaggi</h3>
        <p class="muted">Oltre alla password delle note, per aprire lo spazio servirà un codice a 6 cifre generato da un'app sul tuo telefono. Chi scopre la password non entra senza il telefono.</p>
        <p class="muted">Ti servono: un'app di autenticazione sul telefono e un posto sicuro per i codici di riserva. Se perdi telefono e codici di riserva, rientri con il codice di recupero di 24 caratteri.</p>
        <p class="muted">Da sapere: senza rete, le note già scaricate su questo dispositivo si aprono in sola lettura con la sola password.</p>
        <div class="row-end"><button class="btn ghost" data-close>Non ora</button><button class="btn primary" data-go>Attiva</button></div>`, { onClose: () => res(yes) });
      $('[data-go]', el).addEventListener('click', () => { yes = true; closeOverlay(); });
    });
    if (go && await enableFlow(askPassword)) toast('Verifica in due passaggi attiva.');
    return;
  }
  const action = await new Promise(res => {
    let a = null;
    const opt = (v, t) => `<option value="${v}" ${st.days === v ? 'selected' : ''}>${t}</option>`;
    const el = sheet(`<h3>Verifica in due passaggi</h3>
      <p class="muted">Attiva${st.enabled_at ? ' dal ' + esc(fmtWhen(st.enabled_at)) : ''}. Codici di riserva rimasti: <b>${st.backup_left}</b>.${st.trusted_until ? ' Questo dispositivo non chiederà il codice fino al ' + esc(fmtWhen(st.trusted_until)) + '.' : ''}</p>
      <label class="flab" for="mfaDays">Chiedi il codice</label>
      <select class="sel" id="mfaDays" style="width:100%">${opt(0, 'A ogni sblocco')}${opt(1, 'Una volta al giorno per dispositivo')}${opt(7, 'Ogni 7 giorni per dispositivo')}${opt(30, 'Ogni 30 giorni per dispositivo')}</select>
      <div class="btnrow"><button class="btn ghost" data-m="backup">Nuovi codici di riserva</button><button class="btn danger" data-m="off">Spegni</button></div>
      <div class="row-end"><button class="btn primary" data-close>Chiudi</button></div>`, { onClose: () => res(a) });
    el.addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) { a = { type: b.dataset.m }; closeOverlay(); } });
    $('#mfaDays', el).addEventListener('change', e => { a = { type: 'days', days: +e.target.value }; closeOverlay(); });
  });
  if (!action) return;
  if (action.type === 'days') {
    const r = await guarded(askPassword, 'Cambia la frequenza del codice', 'mfa/days', { days: action.days }, false);
    if (r) toast('Fatto. Gli altri dispositivi chiederanno di nuovo il codice.');
  } else if (action.type === 'backup') {
    const r = await guarded(askPassword, 'Nuovi codici di riserva', 'mfa/backup');
    if (r) await showBackup(r.backup, false);
  } else if (action.type === 'off') {
    const r = await guarded(askPassword, 'Spegni la verifica in due passaggi', 'mfa/disable');
    if (r) toast('Verifica in due passaggi spenta.');
  }
}
