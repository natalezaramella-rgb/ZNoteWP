// Piccole utilità d'interfaccia: selettori, escape, fogli, dialoghi, messaggi.
import { ic } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = (...a) => { clearTimeout(t); fn(...a); }; f.cancel = () => clearTimeout(t); return f; };
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- date (sempre in italiano, formato gg/mm/aaaa) ----------
export const pad = n => String(n).padStart(2, '0');
export const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const dayDiff = s => Math.round((parseDay(s) - today()) / 864e5);
export function fmtDay(s, long = false) {
  const diff = dayDiff(s);
  if (diff === 0) return 'Oggi';
  if (diff === 1) return 'Domani';
  if (diff === -1) return 'Ieri';
  const d = parseDay(s);
  const opts = long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' };
  if (!long && d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('it-IT', opts);
}
export const fmtNum = s => { const d = parseDay(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
export function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = isoDay(d);
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const diff = dayDiff(day);
  if (diff === 0) return `oggi ${t}`;
  if (diff === -1) return `ieri ${t}`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }) + ' ' + t;
}
export const fmtShort = iso => {
  const d = new Date(iso); const diff = dayDiff(isoDay(d));
  if (diff === 0) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diff === -1) return 'Ieri';
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
};
export const fmtSize = b => b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`;

// ---------- overlay ----------
let overlayClose = null;
export function overlay() { return document.getElementById('overlay'); }
export function closeOverlay() {
  const o = overlay();
  if (!o) return;
  const fn = overlayClose; overlayClose = null;
  o.innerHTML = '';
  if (fn) fn();
}
export function isOverlayOpen() { const o = overlay(); return !!(o && o.firstChild); }

/** Apre un foglio (dal basso su telefono, dialogo al centro su PC). */
export function sheet(html, { wide = false, onClose = null, label = '' } = {}) {
  const o = overlay();
  if (overlayClose) { const f = overlayClose; overlayClose = null; f(); }
  o.innerHTML = `<div class="backdrop" data-close></div><div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="grab"></div>${html}</div>`;
  overlayClose = onClose;
  const el = o.querySelector('.sheet');
  o.querySelector('[data-close]').addEventListener('click', closeOverlay);
  el.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeOverlay(); });
  const f = el.querySelector('input:not([type=checkbox]):not([type=hidden]),textarea,select');
  if (f && !('ontouchstart' in window)) setTimeout(() => f.focus(), 40);
  return el;
}

export function drawer(html) {
  const o = overlay();
  o.innerHTML = `<div class="backdrop" data-close></div><aside class="drawer">${html}</aside>`;
  o.querySelector('[data-close]').addEventListener('click', closeOverlay);
  return o.querySelector('.drawer');
}

export function confirmDialog(title, text, { ok = 'Conferma', danger = false, cancel = 'Annulla' } = {}) {
  return new Promise(res => {
    let done = false;
    const el = sheet(`<h3>${esc(title)}</h3>${text ? `<p class="muted">${text}</p>` : ''}
      <div class="row-end"><button class="btn ghost" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`,
    { onClose: () => { if (!done) res(false); } });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      done = true; res(b.dataset.r === '1'); closeOverlay();
    });
  });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', ok = 'Salva', type = 'text', extra = '', validate = null } = {}) {
  return new Promise(res => {
    let done = false;
    const el = sheet(`<h3>${esc(title)}</h3><form>${label ? `<label class="flab">${esc(label)}</label>` : ''}
      <input class="field-in" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">${extra}
      <div class="err"></div>
      <div class="row-end"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">${esc(ok)}</button></div></form>`,
    { onClose: () => { if (!done) res(null); } });
    const inp = el.querySelector('input');
    if (inp && !('ontouchstart' in window)) setTimeout(() => { inp.focus(); inp.select(); }, 50);
    el.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const v = inp.value.trim();
      if (validate) { const m = await validate(v, el); if (m) { el.querySelector('.err').textContent = m; return; } }
      done = true; res({ value: v, el }); closeOverlay();
    });
  });
}

/** Scelta da un elenco di opzioni. */
export function choose(title, options, { current = null, text = '' } = {}) {
  return new Promise(res => {
    let done = false;
    const el = sheet(`<h3>${esc(title)}</h3>${text ? `<p class="muted">${text}</p>` : ''}${options.map((o, i) => o.sep ? '<hr style="border:0;border-top:1px solid var(--line);margin:6px 0">' :
      `<button class="opt ${o.danger ? 'danger' : ''}" data-i="${i}" ${current !== null ? `role="menuitemradio" aria-checked="${o.value === current}"` : ''} ${o.disabled ? 'disabled style="opacity:.45"' : ''}>${o.icon ? ic(o.icon) : ''}${o.html || `<span>${esc(o.label)}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</span>`}</button>`).join('')}`,
    { onClose: () => { if (!done) res(null); } });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b || b.disabled) return;
      done = true; const o = options[+b.dataset.i]; closeOverlay(); res(o.value !== undefined ? o.value : o);
    });
  });
}

// ---------- messaggi ----------
let toastTimer = null;
export function toast(msg, action, fn, ms = 4500) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  clearTimeout(toastTimer);
  root.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}</div>`;
  if (action) root.querySelector('button').addEventListener('click', () => { root.innerHTML = ''; fn && fn(); });
  toastTimer = setTimeout(() => { root.innerHTML = ''; }, ms);
}
export const toastErr = e => toast(e && e.message ? e.message : String(e));

export function autosize(el) { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function pickFile(accept, multiple = false) {
  return new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.style.display = 'none';
    document.body.appendChild(i);
    i.addEventListener('change', () => { res([...i.files]); i.remove(); });
    i.click();
  });
}

export function strengthMeter(v, strengthFn) {
  const s = strengthFn(v);
  const lab = ['Troppo corta', 'Debole', 'Discreta', 'Buona', 'Ottima'][s];
  const col = ['var(--danger)', 'var(--danger)', 'var(--due)', 'var(--accent)', 'var(--accent)'][s];
  return { s, lab, col, w: v ? (s + 1) * 20 : 0 };
}
