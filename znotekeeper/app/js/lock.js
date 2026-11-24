// Primo avvio, sblocco (password, PIN, impronta/volto), recupero e conferma password per le azioni delicate.
import { api, setSession, isOffline } from './api.js';
import { kv } from './db.js';
import * as C from './crypto.js';
import { ic } from './icons.js';
import { $, esc, sheet, closeOverlay, toast, download, strengthMeter, confirmDialog, fmtWhen } from './ui.js';
import { S } from './store.js';

const ITER = C.PW_ITER;

// ---------- cassaforte ----------
export async function buildVault(space, password, code, keys) {
  const salt = C.b64(C.rand(16));
  const pw = await C.deriveSecret(password, salt, ITER);
  const rcSalt = C.b64(C.rand(16));
  const rc = await C.deriveSecret(C.normCode(code), rcSalt, C.RC_ITER);
  const vault = {
    v: 1,
    kdf: { alg: 'PBKDF2-SHA256', iter: ITER, salt },
    pw: await space.wrapWith(pw.kek),
    rc: { salt: rcSalt, iter: C.RC_ITER, ...(await space.wrapWith(rc.kek)) },
    pub: keys.pub,
    priv: keys.priv,
  };
  return { vault, pwAuth: pw.auth, rcAuth: rc.auth };
}

async function openSpace(vault, kek) {
  const space = await C.Space.unwrap(kek, vault.pw);
  return space;
}

export async function afterUnlock(space, vault) {
  S.space = space;
  S.vault = vault;
  try { S.priv = await C.openPrivKey(space, vault.priv); } catch (e) { S.priv = null; }
  await kv.set('vault', vault);
}

/** Chiede la password e la verifica col server (limite ai tentativi). Restituisce { auth, password }. */
export function askPassword(title = 'Conferma con la password', text = 'Per sicurezza, inserisci la password delle note.') {
  return new Promise(res => {
    let done = false;
    const el = sheet(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>
      <form><input class="field-in" type="password" autocomplete="current-password" placeholder="Password delle note" aria-label="Password delle note">
      <div class="err"></div><div class="row-end"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Conferma</button></div></form>`,
    { onClose: () => { if (!done) res(null); } });
    const f = $('form', el);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const password = $('input', el).value;
      if (!password) return;
      f.classList.add('busy');
      try {
        const d = await C.deriveSecret(password, S.vault.kdf.salt, S.vault.kdf.iter);
        await api('POST', 'reauth', { auth: d.auth });
        done = true;
        closeOverlay();
        res({ auth: d.auth, password, kek: d.kek });
      } catch (err) {
        $('.err', el).textContent = err.message;
        f.classList.remove('busy');
      }
    });
  });
}

// ---------- codice di recupero: mostra e conferma ----------
function codeUI(code, positions) {
  const plain = code.replace(/-/g, '');
  let k = 0;
  return code.split('').map(ch => {
    if (ch === '-') return '-';
    const i = k++;
    return positions.includes(i) ? `<b>${ch}</b>` : ch;
  }).join('') + `<span hidden>${plain}</span>`;
}
function printCode(code) {
  const w = window.open('', '_blank', 'width=600,height=500');
  if (!w) { toast('Il browser ha bloccato la finestra di stampa.'); return; }
  w.document.write(`<!doctype html><title>Codice di recupero ZNoteKeeper</title><body style="font-family:system-ui;padding:40px"><h1>ZNoteKeeper</h1><p>Codice di recupero dello spazio di ${esc(S.me ? S.me.user.name : '')}, creato il ${new Date().toLocaleDateString('it-IT')}.</p><p style="font:600 26px monospace;letter-spacing:.08em;border:2px dashed #999;padding:20px;text-align:center">${esc(code)}</p><p>Conservalo in un posto sicuro, lontano dal telefono. Serve se dimentichi la password delle note.</p></body>`);
  w.document.close(); w.focus(); w.print();
}
export function codeBlockHTML(code, positions) {
  return `<div class="codebox">${codeUI(code, positions)}</div>
    <div class="btnrow"><button type="button" class="btn ghost" data-code="copy">${ic('copy', 'sm')}Copia</button><button type="button" class="btn ghost" data-code="print">${ic('print', 'sm')}Stampa</button><button type="button" class="btn ghost" data-code="dl">${ic('download', 'sm')}Scarica</button></div>`;
}
export function bindCodeButtons(root, code) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-code]');
    if (!b) return;
    if (b.dataset.code === 'copy') navigator.clipboard.writeText(code).then(() => toast('Codice copiato. Incollalo nel tuo gestore di password.'), () => toast('Copia non riuscita: selezionalo e copialo a mano.'));
    if (b.dataset.code === 'print') printCode(code);
    if (b.dataset.code === 'dl') download('codice-recupero-znotekeeper.txt', `Codice di recupero ZNoteKeeper\n${code}\n\nCreato il ${new Date().toLocaleString('it-IT')}.\nConservalo lontano dal telefono.\n`, 'text/plain');
  });
}
export const pickPositions = () => { const s = new Set(); while (s.size < 4) s.add(C.rand(1)[0] % 24); return [...s].sort((a, b) => a - b); };
export const checkPositions = (code, positions, typed) => {
  const plain = C.normCode(code);
  const want = positions.map(p => plain[p]).join('');
  return C.normCode(typed) === want;
};

// ---------- primo avvio ----------
export function renderSetup(root, { onDone }) {
  const st = { step: 1, pw: '', code: C.newRecoveryCode(), pos: pickPositions(), email: false };
  root.innerHTML = `<section class="screen full" data-screen="setup">
    <div class="topbar"><div class="grow" style="padding-left:10px"><div class="apptitle">Benvenuto in ZNoteKeeper</div><div class="crumb" id="sStep"></div></div></div>
    <div class="scroll"><div class="form" id="sBody" style="max-width:560px;margin:0 auto;width:100%"></div></div>
    <div class="bottombar" style="max-width:560px;margin:0 auto;width:100%;border-top:0"><button class="btn ghost" id="sBack">Indietro</button><button class="btn primary" id="sNext">Continua</button></div>
  </section>`;
  const body = $('#sBody', root);
  const draw = () => {
    $('#sStep', root).textContent = `Passo ${st.step} di 3`;
    $('#sBack', root).hidden = st.step === 1;
    $('#sNext', root).textContent = st.step === 3 ? 'Crea il mio spazio' : 'Continua';
    const steps = `<div class="steps">${[1, 2, 3].map(i => `<span class="${i <= st.step ? 'on' : ''}"></span>`).join('')}</div>`;
    if (st.step === 1) {
      body.innerHTML = `${steps}<h2 class="big" style="margin-bottom:8px">Scegli la password delle note</h2>
        <p class="lead">È diversa da quella di WordPress e apre solo il tuo spazio. Non viene mai salvata né inviata al sito: il sito conserva solo un'impronta che la riconosce. Nessuno, nemmeno l'amministratore, può reimpostarla.</p>
        <label class="flab" for="p1">Password delle note</label><input class="field-in" id="p1" type="password" autocomplete="new-password" value="${esc(st.pw)}">
        <div class="meter"><i></i></div><div class="ok" id="pm">Almeno 10 caratteri. Una frase di più parole va benissimo.</div>
        <label class="flab" for="p2">Ripeti la password</label><input class="field-in" id="p2" type="password" autocomplete="new-password" value="${esc(st.pw)}">
        <div class="err" id="se"></div>`;
      const upd = () => {
        const m = strengthMeter($('#p1', body).value, C.strength);
        const i = $('.meter i', body); i.style.width = m.w + '%'; i.style.background = m.col;
        $('#pm', body).textContent = $('#p1', body).value ? m.lab : 'Almeno 10 caratteri. Una frase di più parole va benissimo.';
      };
      $('#p1', body).addEventListener('input', upd); upd();
    } else if (st.step === 2) {
      body.innerHTML = `${steps}<h2 class="big" style="margin-bottom:8px">Salva il codice di recupero</h2>
        <p class="lead">Se dimentichi la password, questo codice ti fa rientrare senza perdere nulla. È mostrato <b>una sola volta</b>: stampalo o salvalo nel gestore di password, lontano dal telefono.</p>
        ${codeBlockHTML(st.code, st.pos)}
        <label class="check-line"><input type="checkbox" id="ack"> <span>Ho capito: senza password e senza codice i miei dati non si possono più aprire.</span></label>
        <label class="flab" for="cc">Per conferma, scrivi i 4 caratteri sottolineati</label>
        <input class="field-in" id="cc" autocomplete="off" maxlength="8" style="font-family:var(--f-mono);letter-spacing:.2em;text-transform:uppercase">
        <div class="err" id="se"></div>`;
    } else {
      body.innerHTML = `${steps}<h2 class="big" style="margin-bottom:8px">Recupero via email (facoltativo)</h2>
        <p class="lead">Se lo attivi, in caso di password dimenticata potrai rientrare anche con un link inviato a <b>${esc(S.me.user.email)}</b>.</p>
        <div class="card"><div class="srow"><div class="grow"><div class="lab">Attiva il recupero via email</div>
          <div class="hint">Link monouso valido 30 minuti, solo dopo l'accesso a WordPress, poi 24 ore di attesa durante le quali puoi annullare.</div></div>
          <label class="switch"><input type="checkbox" id="em" ${st.email ? 'checked' : ''} aria-label="Recupero via email"><span></span></label></div></div>
        <div class="warnbox"><b>Da sapere:</b> con il recupero via email il sito conserva una copia protetta della chiave del tuo spazio, legata al tuo indirizzo email e alla password WordPress attuali (se cambiano, il recupero si spegne). È comodo ma meno riservato del solo codice. Puoi attivarlo o spegnerlo quando vuoi da Impostazioni › Sicurezza.</div>
        <div class="err" id="se"></div>`;
    }
  };
  bindCodeButtons(body, st.code);
  $('#sBack', root).addEventListener('click', () => { st.step--; draw(); });
  $('#sNext', root).addEventListener('click', async () => {
    const err = m => { $('#se', body).textContent = m; };
    if (st.step === 1) {
      const a = $('#p1', body).value, b = $('#p2', body).value;
      if (a.length < 10) return err('La password deve avere almeno 10 caratteri.');
      if (C.strength(a) < 2) return err('Password troppo debole: allungala o aggiungi parole, numeri o simboli.');
      if (a !== b) return err('Le due password non coincidono.');
      st.pw = a; st.step = 2; return draw();
    }
    if (st.step === 2) {
      if (!$('#ack', body).checked) return err('Conferma di aver capito l\'importanza del codice.');
      if (!checkPositions(st.code, st.pos, $('#cc', body).value)) return err('I caratteri non corrispondono: controlla il codice salvato.');
      st.step = 3; return draw();
    }
    st.email = $('#em', body).checked;
    const btn = $('#sNext', root);
    btn.disabled = true; btn.textContent = 'Creo lo spazio cifrato…';
    try {
      const space = await C.Space.create();
      const keys = await C.newMailKeys(space);
      const v = await buildVault(space, st.pw, st.code, keys);
      const r = await api('POST', 'setup', { vault: v.vault, pw_auth: v.pwAuth, rc_auth: v.rcAuth, mk_auth: space.mkAuth });
      setSession(r.session);
      await afterUnlock(space, v.vault);
      if (st.email) {
        try { await enableEmailRecovery(v.pwAuth); } catch (e) { toast('Recupero via email non attivato: ' + e.message); }
      }
      st.pw = '';
      onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Crea il mio spazio';
      err(e.message);
    }
  });
  draw();
}

export async function enableEmailRecovery(auth) {
  const er = C.rand(32);
  const kek = await C.kekFrom(er, 'znk-er');
  const wrapped = await S.space.wrapWith(kek);
  return api('POST', 'vault/email-recovery', { auth, enable: true, er: C.b64(er), wrapped });
}

// ---------- sblocco ----------
let localFails = 0;
export function renderLock(root, { me, onUnlocked, offline }) {
  const pin = me && me.device && me.device.pin;
  root.innerHTML = `<section class="screen lock full" data-screen="lock">
    <div class="logo">ZN</div>
    <h2>Bentornato${me ? ', ' + esc(me.user.name.split(' ')[0]) : ''}</h2>
    <p>${offline ? 'Sei offline: puoi aprire in sola lettura le note già scaricate su questo dispositivo.' : 'Le tue note sono cifrate. Inserisci la password delle note per aprirle.'}</p>
    <div id="lockBanner"></div>
    <form id="unlockForm" autocomplete="on">
      <input type="text" name="username" autocomplete="username" value="${esc(me ? me.user.login + ' (ZNoteKeeper)' : '')}" hidden>
      <input class="field-in" id="pass" type="password" placeholder="Password delle note" autocomplete="current-password" aria-label="Password delle note">
      <button class="btn primary" type="submit">Sblocca</button>
      <div class="err" id="lerr" role="alert"></div>
    </form>
    <div class="alt">
      <button type="button" data-a="pin" ${pin && !offline ? '' : 'hidden'}>${ic('key')}Usa il PIN</button>
      <button type="button" data-a="bio" hidden>${ic('finger')}Impronta o volto</button>
    </div>
    <button class="forgot" data-a="forgot" ${offline ? 'hidden' : ''}>Password dimenticata?</button>
    <div class="tiny">${ic('shield', 'sm')}Cifrato su questo dispositivo · AES-256-GCM</div>
  </section>`;
  const sec = $('section', root);
  const errEl = $('#lerr', sec);
  const form = $('#unlockForm', sec);
  if (me && (me.recovery.email === 'pending' || me.recovery.email === 'ready')) {
    $('#lockBanner', sec).innerHTML = `<div class="banner"><div class="grow">${me.recovery.email === 'ready' ? 'Il recupero via email è pronto: puoi completarlo.' : `Recupero via email in corso: sarà possibile completarlo dal ${esc(fmtWhen(me.recovery.ready_at))}. Se non l'hai chiesto tu, annullalo.`}</div>
      ${me.recovery.email === 'ready' ? '<button class="btn small primary" data-a="er-complete">Completa</button>' : ''}<button class="btn small ghost" data-a="er-cancel">Annulla</button></div>`;
  }
  kv.get('bio').then(b => { if (b && b.cred && window.PublicKeyCredential) { $('[data-a=bio]', sec).hidden = false; if (!sessionStorage.getItem('znk-bio-tried')) { sessionStorage.setItem('znk-bio-tried', '1'); bioUnlock().catch(() => {}); } } });
  if (!('ontouchstart' in window)) setTimeout(() => $('#pass', sec).focus(), 50);
  if (me && me.wait > 0) errEl.textContent = `Troppi tentativi errati: riprova tra ${Math.ceil(me.wait / 60)} minuti.`;

  const busy = on => sec.classList.toggle('busy', on);
  const done = async (space, vault, ro) => { await afterUnlock(space, vault); onUnlocked({ readonly: ro }); };

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pw = $('#pass', sec).value;
    if (!pw) return;
    errEl.textContent = '';
    busy(true);
    try {
      const cached = await kv.get('vault');
      const kdf = (me && me.kdf) || (cached && cached.kdf);
      if (!kdf) throw new Error('Questo dispositivo non ha ancora dati: collegati a internet per il primo sblocco.');
      const d = await C.deriveSecret(pw, kdf.salt, kdf.iter);
      let vault, ro = false;
      try {
        const r = await api('POST', 'unlock', { auth: d.auth }, { quiet: true });
        setSession(r.session);
        vault = r.vault;
      } catch (err) {
        if (!isOffline(err) || !cached) throw err;
        if (localFails >= 5) { await new Promise(r => setTimeout(r, Math.min(60000, 2000 * 2 ** (localFails - 5)))); }
        vault = cached; ro = true;
      }
      let space;
      try { space = await openSpace(vault, d.kek); } catch (x) { localFails++; throw new Error('Password non corretta.'); }
      localFails = 0;
      await done(space, vault, ro);
    } catch (err) {
      errEl.textContent = err.message;
      busy(false);
      $('#pass', sec).select();
    }
  });

  sec.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    const act = a.dataset.a;
    if (act === 'forgot') return recoverSheet(me, onUnlocked);
    if (act === 'pin') return pinSheet(async (space, vault) => done(space, vault, false));
    if (act === 'bio') { busy(true); try { await bioUnlock(); } catch (err) { errEl.textContent = err.message; } busy(false); return; }
    if (act === 'er-cancel') { await api('POST', 'recover/email/cancel', {}); toast('Recupero annullato.'); $('#lockBanner', sec).innerHTML = ''; return; }
    if (act === 'er-complete') return emailComplete(onUnlocked);
  });

  async function bioUnlock() {
    const b = await kv.get('bio');
    const out = await prfEval(b);
    const kek = await C.kekFrom(out, 'znk-bio');
    let space;
    try { space = await C.Space.unwrap(kek, b.box); } catch (e) { throw new Error('Sblocco biometrico non riuscito: usa la password.'); }
    let vault = await kv.get('vault'), ro = false;
    try {
      const r = await api('POST', 'unlock/key', { mk_auth: space.mkAuth }, { quiet: true });
      setSession(r.session); vault = r.vault;
    } catch (err) {
      if (!isOffline(err)) throw err;
      ro = true;
    }
    await done(space, vault, ro);
  }
}

// ---------- PIN ----------
function pinSheet(onOk) {
  const el = sheet(`<h3>Sblocca con il PIN</h3><p class="muted">Dopo 5 PIN errati il PIN si disattiva e serve la password.</p>
    <form><div class="pinpad"><input class="field-in" type="password" inputmode="numeric" autocomplete="off" maxlength="12" aria-label="PIN"></div>
    <div class="err"></div><div class="row-end"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Sblocca</button></div></form>`);
  const f = $('form', el);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    f.classList.add('busy');
    try {
      const local = await kv.get('pin');
      if (!local) throw new Error('PIN non configurato su questo dispositivo.');
      const bits = await C.pbkdf2($('input', el).value, local.salt, C.PIN_ITER);
      const auth = C.b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('znk-auth') }, await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']), 256)));
      const r = await api('POST', 'pin/unlock', { pin_auth: auth }, { quiet: true });
      const mix = new Uint8Array([...bits, ...C.unb64(r.pepper)]);
      const kek = await C.kekFrom(mix, 'znk-pin');
      const space = await C.Space.unwrap(kek, local.box);
      setSession(r.session);
      closeOverlay();
      await onOk(space, r.vault);
    } catch (err) {
      if (err.code === 'znk_pin_off') await kv.del('pin');
      $('.err', el).textContent = err.message;
      f.classList.remove('busy');
    }
  });
}

export async function enablePin(auth) {
  return new Promise(res => {
    const el = sheet(`<h3>PIN di sblocco</h3><p class="muted">Un PIN breve (da 4 a 12 cifre) per aprire l'app su questo dispositivo senza scrivere la password. Funziona solo online: il sito conserva metà della chiave e la cancella dopo 5 PIN errati.</p>
      <form><label class="flab">PIN</label><input class="field-in" name="a" type="password" inputmode="numeric" maxlength="12" autocomplete="off">
      <label class="flab">Ripeti il PIN</label><input class="field-in" name="b" type="password" inputmode="numeric" maxlength="12" autocomplete="off">
      <div class="err"></div><div class="row-end"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Attiva</button></div></form>`,
    { onClose: () => res(false) });
    const f = $('form', el);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const a = f.a.value, b = f.b.value;
      const er = m => { $('.err', el).textContent = m; };
      if (!/^\d{4,12}$/.test(a)) return er('Il PIN deve avere da 4 a 12 cifre.');
      if (/^(\d)\1+$/.test(a) || '0123456789012'.includes(a) || '9876543210987'.includes(a)) return er('PIN troppo semplice.');
      if (a !== b) return er('I due PIN non coincidono.');
      f.classList.add('busy');
      try {
        const salt = C.b64(C.rand(16));
        const bits = await C.pbkdf2(a, salt, C.PIN_ITER);
        const pinAuth = C.b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('znk-auth') }, await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']), 256)));
        const r = await api('POST', 'pin', { auth, pin_auth: pinAuth });
        const mix = new Uint8Array([...bits, ...C.unb64(r.pepper)]);
        const box = await S.space.wrapWith(await C.kekFrom(mix, 'znk-pin'));
        await kv.set('pin', { salt, box });
        closeOverlay();
        res(true);
      } catch (err) { er(err.message); f.classList.remove('busy'); }
    });
  });
}
export async function disablePin() {
  await kv.del('pin');
  try { await api('DELETE', 'pin'); } catch (e) { /* */ }
}

// ---------- impronta / volto (WebAuthn PRF) ----------
async function prfEval(b) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: C.rand(32),
      allowCredentials: [{ type: 'public-key', id: C.unb64(b.cred) }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: C.unb64(b.salt) } } },
    },
  });
  const ext = cred.getClientExtensionResults();
  if (!ext.prf || !ext.prf.results || !ext.prf.results.first) throw new Error('Questo dispositivo non supporta lo sblocco biometrico sicuro.');
  return new Uint8Array(ext.prf.results.first);
}
export async function bioSupported() {
  if (!window.PublicKeyCredential || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (e) { return false; }
}
export async function enableBio() {
  const salt = C.rand(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: C.rand(32),
      rp: { name: 'ZNoteKeeper', id: location.hostname },
      user: { id: C.rand(16), name: (S.me && S.me.user.login) || 'znotekeeper', displayName: (S.me && S.me.user.name) || 'ZNoteKeeper' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const ext = cred.getClientExtensionResults();
  if (!ext.prf || ext.prf.enabled === false) throw new Error('Il browser di questo dispositivo non supporta ancora lo sblocco biometrico sicuro (estensione PRF). Usa il PIN.');
  const b = { cred: C.b64(new Uint8Array(cred.rawId)), salt: C.b64(salt) };
  let out = ext.prf.results && ext.prf.results.first ? new Uint8Array(ext.prf.results.first) : await prfEval(b);
  const box = await S.space.wrapWith(await C.kekFrom(out, 'znk-bio'));
  await kv.set('bio', { ...b, box });
}
export const disableBio = () => kv.del('bio');

// ---------- recupero ----------
function recoverSheet(me, onUnlocked) {
  const er = me && me.recovery.email;
  const el = sheet(`<h3>Recupera l'accesso</h3><p class="muted">Le tue note restano intatte: scegli come dimostrare che sei tu.</p>
    <button class="opt" data-r="code">${ic('key')}<span>Ho il codice di recupero<small>Nuova password subito</small></span></button>
    <button class="opt" data-r="mail" ${er === 'off' ? 'disabled style="opacity:.45"' : ''}>${ic('mail')}<span>Inviami un link via email<small>${er === 'off' ? 'Non attivato per il tuo utente' : 'A ' + esc(me.user.email) + ' · poi 24 ore di attesa'}</small></span></button>
    <p class="ok" style="margin-top:12px">Senza codice e senza recupero via email i dati non si possono più aprire: l'amministratore può solo cancellare lo spazio.</p>`);
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-r]');
    if (!b || b.disabled) return;
    if (b.dataset.r === 'code') return recoverCode(onUnlocked);
    try {
      const r = await api('POST', 'recover/email/request', {});
      if (r.state === 'sent') sheet(`<h3>Link inviato</h3><p>Abbiamo scritto a <b>${esc(r.email)}</b>. Apri il link entro 30 minuti, dopo aver effettuato l'accesso al sito con il tuo utente.</p><p class="muted">Dopo il clic partirà un'attesa di 24 ore: ti avviseremo via email e potrai annullare da qualsiasi dispositivo collegato.</p><div class="row-end"><button class="btn primary" data-close>Ho capito</button></div>`);
      else if (r.state === 'pending') sheet(`<h3>Recupero in corso</h3><p>Potrai completarlo dal <b>${esc(fmtWhen(r.ready_at))}</b>.</p><div class="row-end"><button class="btn primary" data-close>Ok</button></div>`);
      else if (r.state === 'ready') emailComplete(onUnlocked);
    } catch (err) { toast(err.message); }
  });
}

function recoverCode(onUnlocked) {
  const el = sheet(`<h3>Usa il codice di recupero</h3>
    <form><label class="flab">Codice di recupero (24 caratteri)</label><input class="field-in" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" style="font-family:var(--f-mono);text-transform:uppercase">
    <div class="err"></div><div class="row-end"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Continua</button></div></form>`);
  const f = $('form', el);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const code = C.normCode($('input', el).value);
    if (code.length !== 24) { $('.err', el).textContent = 'Il codice ha 24 caratteri (lettere e numeri).'; return; }
    f.classList.add('busy');
    try {
      const p = await api('GET', 'recover/params');
      const d = await C.deriveSecret(code, p.salt, p.iter || C.RC_ITER);
      const r = await api('POST', 'recover/code', { rc_auth: d.auth });
      const space = await C.Space.unwrap(d.kek, r.wrapped);
      newPasswordFlow(space, r.ticket, r.priv, onUnlocked);
    } catch (err) { $('.err', el).textContent = err.message; f.classList.remove('busy'); }
  });
}

async function emailComplete(onUnlocked) {
  try {
    const r = await api('POST', 'recover/email/complete', {});
    const kek = await C.kekFrom(C.unb64(r.er), 'znk-er');
    const space = await C.Space.unwrap(kek, r.wrapped);
    newPasswordFlow(space, r.ticket, r.priv, onUnlocked);
  } catch (e) { toast(e.message); }
}

function newPasswordFlow(space, ticket, priv, onUnlocked) {
  const code = C.newRecoveryCode();
  const pos = pickPositions();
  const el = sheet(`<h3>Scegli una nuova password</h3>
    <form><label class="flab">Nuova password delle note</label><input class="field-in" name="a" type="password" autocomplete="new-password">
    <div class="meter"><i></i></div>
    <label class="flab">Ripeti</label><input class="field-in" name="b" type="password" autocomplete="new-password">
    <label class="flab">Il tuo nuovo codice di recupero</label>${codeBlockHTML(code, pos)}
    <p class="ok">Il vecchio codice smette di valere. Gli altri dispositivi verranno scollegati e il recupero via email andrà riattivato.</p>
    <label class="check-line"><input type="checkbox" name="ack"> <span>Ho salvato il nuovo codice.</span></label>
    <label class="flab">Scrivi i 4 caratteri sottolineati</label><input class="field-in" name="c" autocomplete="off" style="font-family:var(--f-mono);text-transform:uppercase">
    <div class="err"></div><div class="row-end"><button class="btn primary">Salva e apri</button></div></form>`, { wide: true });
  bindCodeButtons(el, code);
  const f = $('form', el);
  f.a.addEventListener('input', () => { const m = strengthMeter(f.a.value, C.strength); const i = $('.meter i', el); i.style.width = m.w + '%'; i.style.background = m.col; });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const er = m => { $('.err', el).textContent = m; };
    if (f.a.value.length < 10 || C.strength(f.a.value) < 2) return er('Password troppo corta o debole (almeno 10 caratteri).');
    if (f.a.value !== f.b.value) return er('Le due password non coincidono.');
    if (!f.ack.checked) return er('Conferma di aver salvato il nuovo codice.');
    if (!checkPositions(code, pos, f.c.value)) return er('I caratteri del codice non corrispondono.');
    f.classList.add('busy');
    try {
      const v = await buildVault(space, f.a.value, code, { pub: 'kept', priv });
      const r = await api('POST', 'recover/reset', { ticket, vault: { ...v.vault, pub: '-----BEGIN PUBLIC KEY-----' }, pw_auth: v.pwAuth, rc_auth: v.rcAuth });
      setSession(r.session);
      const vault = { ...v.vault, priv };
      const me = await api('GET', 'me');
      S.me = me;
      vault.pub = null;
      closeOverlay();
      await afterUnlock(space, vault);
      await kv.del('pin'); await kv.del('bio');
      toast('Accesso recuperato. Gli altri dispositivi sono stati scollegati.');
      onUnlocked({ readonly: false });
    } catch (err) { er(err.message); f.classList.remove('busy'); }
  });
}

export async function changePassword() {
  const p = await askPassword('Cambia password delle note', 'Inserisci la password attuale.');
  if (!p) return;
  const el = sheet(`<h3>Nuova password</h3><form><label class="flab">Nuova password delle note</label><input class="field-in" name="a" type="password" autocomplete="new-password"><div class="meter"><i></i></div>
    <label class="flab">Ripeti</label><input class="field-in" name="b" type="password" autocomplete="new-password"><p class="ok">Le note non vengono ricifrate: cambia solo la serratura della chiave. Il PIN e lo sblocco biometrico restano validi.</p>
    <div class="err"></div><div class="row-end"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Cambia</button></div></form>`);
  const f = $('form', el);
  f.a.addEventListener('input', () => { const m = strengthMeter(f.a.value, C.strength); const i = $('.meter i', el); i.style.width = m.w + '%'; i.style.background = m.col; });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const er = m => { $('.err', el).textContent = m; };
    if (f.a.value.length < 10 || C.strength(f.a.value) < 2) return er('Password troppo corta o debole.');
    if (f.a.value !== f.b.value) return er('Le due password non coincidono.');
    f.classList.add('busy');
    try {
      const salt = C.b64(C.rand(16));
      const d = await C.deriveSecret(f.a.value, salt, ITER);
      const pw = await S.space.wrapWith(d.kek);
      const kdf = { alg: 'PBKDF2-SHA256', iter: ITER, salt };
      await api('POST', 'vault/password', { auth: p.auth, kdf, pw, new_auth: d.auth });
      S.vault = { ...S.vault, kdf, pw };
      await kv.set('vault', S.vault);
      if (S.me) S.me.kdf = kdf;
      closeOverlay();
      toast('Password cambiata.');
    } catch (err) { er(err.message); f.classList.remove('busy'); }
  });
}

export async function newRecoveryCodeFlow() {
  const p = await askPassword('Nuovo codice di recupero', 'Il codice attuale smetterà di funzionare.');
  if (!p) return;
  const code = C.newRecoveryCode();
  const pos = pickPositions();
  const el = sheet(`<h3>Il tuo nuovo codice di recupero</h3>${codeBlockHTML(code, pos)}
    <form><label class="check-line"><input type="checkbox" name="ack"> <span>Ho salvato il nuovo codice in un posto sicuro.</span></label>
    <label class="flab">Scrivi i 4 caratteri sottolineati</label><input class="field-in" name="c" autocomplete="off" style="font-family:var(--f-mono);text-transform:uppercase">
    <div class="err"></div><div class="row-end"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Attiva il nuovo codice</button></div></form>`);
  bindCodeButtons(el, code);
  const f = $('form', el);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!f.ack.checked || !checkPositions(code, pos, f.c.value)) { $('.err', el).textContent = 'Conferma di aver salvato il codice e riscrivi i caratteri sottolineati.'; return; }
    f.classList.add('busy');
    try {
      const salt = C.b64(C.rand(16));
      const d = await C.deriveSecret(C.normCode(code), salt, C.RC_ITER);
      const rc = { salt, iter: C.RC_ITER, ...(await S.space.wrapWith(d.kek)) };
      await api('POST', 'vault/recovery-code', { auth: p.auth, rc, rc_auth: d.auth });
      S.vault = { ...S.vault, rc };
      await kv.set('vault', S.vault);
      closeOverlay();
      toast('Nuovo codice attivo. Il vecchio non vale più.');
    } catch (err) { $('.err', el).textContent = err.message; f.classList.remove('busy'); }
  });
}

export async function toggleEmailRecovery(on) {
  if (on && !(await confirmDialog('Attivare il recupero via email?', 'Il sito conserverà una copia protetta della chiave del tuo spazio, legata al tuo indirizzo email e alla password WordPress attuali. Il recupero richiede l\'accesso al sito, un link valido 30 minuti e 24 ore di attesa.', { ok: 'Continua' }))) return false;
  const p = await askPassword(on ? 'Attiva recupero via email' : 'Spegni recupero via email');
  if (!p) return false;
  if (on) await enableEmailRecovery(p.auth);
  else await api('POST', 'vault/email-recovery', { auth: p.auth, enable: false });
  toast(on ? 'Recupero via email attivato.' : 'Recupero via email spento.');
  return true;
}
