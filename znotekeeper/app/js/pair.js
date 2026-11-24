// Collegamento del dispositivo (dopo l'accesso a WordPress) e conferma del link di recupero.
import { CFG, api } from './api.js';
import { kv } from './db.js';

const P = JSON.parse(document.getElementById('znk-pair').textContent);
const msg = document.getElementById('msg');

function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? (navigator.maxTouchPoints > 1 ? 'iPad' : 'Mac') : /Linux/.test(ua) ? 'Linux' : 'dispositivo';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${br} su ${os}`;
}

async function pair() {
  if (!P.enabled) return;
  try {
    const r = await api('POST', 'pair', { name: deviceName() }, { nonce: P.nonce });
    await kv.set('token', r.token);
    msg.textContent = 'Fatto. Apro ZNoteKeeper…';
    location.replace(CFG.app);
  } catch (e) {
    msg.textContent = e.message;
  }
}

async function confirmRecover() {
  const t = new URLSearchParams(location.search).get('t');
  const go = document.getElementById('go');
  try {
    const r = await api('POST', 'recover/email/confirm', { t }, { nonce: P.nonce });
    const when = new Date(r.ready_at).toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    msg.innerHTML = '';
    msg.append(`Recupero avviato. Per sicurezza potrai completarlo da ${when}: apri ZNoteKeeper e scegli «Completa» nella schermata di sblocco. Ti abbiamo mandato un'email di avviso.`);
  } catch (e) {
    msg.textContent = e.message;
  }
  history.replaceState(null, '', location.pathname);
  go.hidden = false;
}

if (P.mode === 'recover') confirmRecover(); else pair();
