// «I miei segreti»: un foglio Markdown cifrato che si salva solo con il pulsante Salva.
// Ogni salvataggio conserva la versione precedente sul server (cifrata); le versioni si aprono in sola lettura,
// con accanto le differenze rispetto alla versione in corso.
import { api } from './api.js';
import { S } from './store.js';
import * as store from './store.js';
import { app } from './ctx.js';
import { ic } from './icons.js';
import { $, $$, esc, confirmDialog, toast, fmtWhen, fmtSize } from './ui.js';
import { Editor, toolbarHTML, hydrate } from './editor.js';
import { mdToHtml } from './md.js';

const ID = 'secrets';
const KIND = 'secret';
const NOTOOLS = ['image', 'drawing', 'totask'];
const when = iso => { const d = new Date(iso); return fmtWhen(iso) + ':' + String(d.getSeconds()).padStart(2, '0'); };

let draft = null; // testo non ancora salvato (solo in memoria)
let baseRev = null; // revisione da cui è partita la bozza
let E = null; // { el, editor, mode }
let saving = false;

const item = () => { const it = store.get(ID); return it && it.d && !it.deleted_at ? it : null; };
const savedMd = () => (item() ? item().d.md || '' : '');
export const dirty = () => draft !== null && draft !== savedMd();

/** Dimentica bozza e versioni in memoria (al blocco). */
export function forget() { draft = null; baseRev = null; E = null; vers = null; versAt = 0; cache.clear(); }

window.addEventListener('beforeunload', e => { if (S.space && dirty()) { e.preventDefault(); e.returnValue = ''; } });

// ---------- versioni ----------
let vers = null; // [{ id, at, size }] dalla più recente
let versAt = 0;
let versRev = null;
let versBusy = null;
const cache = new Map(); // id versione → md
function loadVersions(force = false) {
  const it = item();
  if (!it || S.offline) return Promise.resolve();
  if (!force && vers && versRev === it.rev && Date.now() - versAt < 60000) return Promise.resolve();
  if (versBusy) return versBusy;
  versBusy = api('GET', `items/${ID}/versions?meta=1`, undefined, { quiet: true })
    .then(r => { vers = r; versAt = Date.now(); versRev = it.rev; app.render(); })
    .catch(e => console.warn(e))
    .finally(() => { versBusy = null; });
  return versBusy;
}
async function versionMd(vid) {
  if (cache.has(vid)) return cache.get(vid);
  const r = await api('GET', `items/${ID}/versions/${vid}`);
  const d = await S.space.decItem(ID, r.data);
  cache.set(vid, d.md || '');
  return d.md || '';
}

// ---------- salvataggio ----------
async function save() {
  if (saving || !store.canWrite()) return;
  if (E && E.editor) E.editor.flush();
  if (E && E.mode === 'md') draft = $('#sMd', E.el).value;
  if (!dirty()) { toast('Nessuna modifica da salvare.'); return; }
  const it = item();
  if (it && baseRev !== null && it.rev !== baseRev) {
    const ok = await confirmDialog('Salvato altrove nel frattempo', 'Da un altro dispositivo è stata salvata una versione più recente. Se salvi, la tua diventa la versione in corso e l\'altra resta tra le versioni precedenti.', { ok: 'Salva la mia' });
    if (!ok) return;
  }
  saving = true; paintHead();
  const md = draft;
  try {
    await store.save(ID, { kind: KIND, parent_id: null, sort: 0, d: { md } });
    draft = null; baseRev = null;
    vers = null;
    toast('Salvato. La versione precedente è tra le versioni.');
  } catch (e) { /* il messaggio d'errore arriva da store.save */ }
  saving = false;
  app.render();
  paintHead();
}

// ---------- scelta della versione (elenco a discesa, dalla più recente) ----------
function pickerHTML() {
  const it = item();
  const cur = app.R.sver && app.R.sver !== 'list' ? String(app.R.sver) : '';
  const opts = [];
  if (it) opts.push(`<option value="" ${cur ? '' : 'selected'}>Versione in corso${vers ? ` (${vers.length + 1})` : ''} · ${esc(when(it.updated_at))}${dirty() ? ' · non salvata' : ''}</option>`);
  else opts.push('<option value="" selected>Versione in corso · mai salvata</option>');
  (vers || []).forEach((v, i) => opts.push(`<option value="${esc(String(v.id))}" ${String(v.id) === cur ? 'selected' : ''}>Versione ${vers.length - i} · ${esc(when(v.at))} · ${esc(fmtSize(v.size))}</option>`));
  if (!vers && it && !S.offline) opts.push('<option disabled>Carico le versioni…</option>');
  if (S.offline) opts.push('<option disabled>Offline: versioni precedenti non disponibili</option>');
  if (it && vers && !vers.length) opts.push('<option disabled>Nessuna versione precedente</option>');
  return opts.join('');
}
function pickerTag() {
  return `<label class="sec-vpick" title="Versioni (dalla più recente)">${ic('history')}<select class="sel" data-a="pick" aria-label="Versione da mostrare">${pickerHTML()}</select></label>`;
}
function paintPicker(el) {
  const sel = el && $('select[data-a=pick]', el);
  if (!sel || document.activeElement === sel) return;
  const html = pickerHTML();
  if (sel._html !== html) { sel.innerHTML = html; sel._html = html; }
}
function bindPicker(el) {
  const sel = $('select[data-a=pick]', el);
  if (!sel) return;
  sel._html = sel.innerHTML;
  sel.addEventListener('change', () => app.go({ sver: sel.value || null }));
  sel.addEventListener('focus', () => loadVersions());
}

// ---------- foglio ----------
export function renderMain(el) {
  if (!el) { if (E && E.editor) E.editor.flush(); E = null; return; }
  const it = item();
  loadVersions();
  if (E && E.el === el && el.isConnected) {
    // Aggiornato da un altro dispositivo: se non ci sono modifiche in corso, mostra il testo nuovo.
    if (!dirty() && E.editor && E.editor.md !== savedMd() && !el.contains(document.activeElement)) { E.editor.setMd(savedMd()); draft = null; baseRev = null; }
    E.editor && E.editor.setReadonly(S.offline);
    paintHead();
    return;
  }
  const ro = S.offline;
  const desk = app.desk;
  const md = draft !== null ? draft : savedMd();
  el.innerHTML = `
    <div class="topbar">
      <div class="grow" style="padding-left:${desk ? '16px' : '10px'};min-width:0"><div class="apptitle">Foglio segreti</div><div class="sec-state" id="sState"></div></div>
      ${pickerTag()}
      <button class="btn primary sec-save needs-net" data-a="save" id="sSave" title="Salva (Ctrl+S)">Salva</button>
      <button class="ib" data-a="lock" data-only="phone" aria-label="Blocca">${ic('lock')}</button>
    </div>
    ${desk ? toolbarHTML(false, 'top sec-tools needs-net', NOTOOLS) : ''}
    <div class="scroll"><div class="form">
      ${ro ? '<div class="ro-note">Offline: sola lettura.</div>' : ''}
      <div class="pmeta"><span class="muted" style="font-size:12.5px">Cifrato nel browser · si salva solo con «Salva»</span>
        <div class="seg" role="group" aria-label="Modalità"><button data-a="mode" data-mode="vis" aria-pressed="true">Visuale</button><button data-a="mode" data-mode="md" aria-pressed="false">Markdown</button></div>
      </div>
      <div id="sEditor"></div>
      <div id="sMdWrap" hidden><textarea class="mdview" id="sMd" spellcheck="false" ${ro ? 'readonly' : ''}></textarea></div>
    </div></div>
    ${desk ? '' : toolbarHTML(false, 'needs-net', NOTOOLS)}`;
  const ed = new Editor($('#sEditor', el), {
    md, readonly: ro, ownerId: ID, placeholder: 'Foglio bianco: scrivi in Markdown (# titolo, - elenco, [] casella)…',
    onChange: v => { if (draft === null) baseRev = item() ? item().rev : null; draft = v; paintHead(); },
  });
  E = { el, editor: ed, mode: 'vis' };
  $$('.etools', el).forEach(t => ed.bindToolbar(t));
  const ta = $('#sMd', el);
  ta.addEventListener('input', () => { if (draft === null) baseRev = item() ? item().rev : null; draft = ta.value; paintHead(); });
  el.onclick = e => {
    const b = e.target.closest('[data-a]');
    if (!b || b.closest('#sEditor')) return;
    switch (b.dataset.a) {
      case 'save': save(); break;
      case 'lock': app.lock(); break;
      case 'mode': {
        const m = b.dataset.mode;
        if (E.mode === 'vis') ed.flush(); else draft = ta.value;
        const cur = draft !== null ? draft : savedMd();
        E.mode = m;
        $$('[data-a=mode]', el).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === m)));
        $('#sEditor', el).hidden = m === 'md';
        $('#sMdWrap', el).hidden = m !== 'md';
        $$('.etools', el).forEach(t => { t.hidden = m === 'md'; });
        if (m === 'md') { ta.value = cur; ta.style.height = 'auto'; ta.style.height = Math.max(320, ta.scrollHeight) + 'px'; } else ed.setMd(cur);
        break;
      }
    }
  };
  el.onkeydown = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); } };
  bindPicker(el);
  paintHead();
}

function paintHead() {
  if (!E || !E.el.isConnected) return;
  const it = item();
  const st = $('#sState', E.el);
  const d = dirty();
  if (st) st.innerHTML = saving ? 'Salvataggio…' : d ? '<b style="color:var(--due)">Modifiche non salvate</b>' : it ? 'Salvato ' + esc(fmtWhen(it.updated_at)) : 'Mai salvato';
  paintPicker(E.el);
  const b = $('#sSave', E.el);
  if (b) { b.disabled = saving || !d || S.offline; b.classList.toggle('pulse', d); }
  ['secrets', 'more'].forEach(k => { const nb = document.querySelector(`#nav [data-nav=${k}]`); if (nb) nb.classList.toggle('dirty', d); });
}

// ---------- versione precedente (sola lettura + differenze) ----------
let V = null; // { el, vid }
export function renderVersion(el, vid) {
  if (!el) { V = null; return; }
  loadVersions();
  const nv = vers ? vers.length : -1;
  if (V && V.el === el && V.vid === vid && el.isConnected && V.cur === currentMd() && V.nv === nv) return;
  V = { el, vid, cur: currentMd(), nv };
  const vi = (vers || []).findIndex(x => String(x.id) === String(vid));
  const v = vi >= 0 ? vers[vi] : null;
  el.innerHTML = `
    <div class="topbar">
      <button class="ib" data-a="close" aria-label="Torna alla versione in corso" data-only="phone">${ic('back')}</button>
      <div class="grow" style="padding-left:${app.desk ? '16px' : '4px'};min-width:0"><div class="apptitle">${v ? `Versione ${vers.length - vi}` : 'Versione precedente'}</div><div class="sec-state">${v ? esc(when(v.at)) + ' · ' : ''}sola lettura</div></div>
      ${pickerTag()}
      <button class="btn ghost small needs-net" data-a="restore" title="Copia questo testo nel foglio: poi premi Salva">${ic('restore', 'sm')}<span class="sec-rlab">Ripristina</span></button>
      <button class="ib" data-a="close" data-only="desk" aria-label="Torna alla versione in corso" title="Torna alla versione in corso">${ic('close')}</button>
    </div>
    <div class="seg sec-tabs" role="group" aria-label="Vista" data-only="phone"><button data-a="tab" data-t="diff" aria-pressed="true">Differenze</button><button data-a="tab" data-t="text" aria-pressed="false">Testo</button></div>
    <div class="sec-ver" data-t="diff"><div class="sec-diff"><p class="muted" style="padding:16px">Carico…</p></div><div class="sec-text"></div></div>`;
  el.onclick = async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'close') app.go({ sver: null });
    if (b.dataset.a === 'tab') { $$('[data-a=tab]', el).forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('.sec-ver', el).dataset.t = b.dataset.t; }
    if (b.dataset.a === 'restore') {
      if (!store.canWrite()) return;
      let md; try { md = await versionMd(vid); } catch (x) { toast(x.message); return; }
      if (dirty() && !await confirmDialog('Modifiche non salvate', 'Il foglio ha modifiche non salvate: ripristinando questa versione le sostituisci.', { ok: 'Ripristina', danger: true })) return;
      baseRev = item() ? item().rev : null;
      draft = md;
      if (E && E.editor) { E.editor.setMd(md); if (E.mode === 'md') $('#sMd', E.el).value = md; }
      app.go({ sver: null });
      toast('Testo ripristinato nel foglio: premi Salva per renderlo la versione in corso.');
    }
  };
  bindPicker(el);
  versionMd(vid).then(md => {
    if (!V || V.el !== el || V.vid !== vid) return;
    $('.sec-text', el).innerHTML = `<div class="sec-colhead">Testo di questa versione</div><div class="editor sec-read">${mdToHtml(md) || '<p class="muted">(vuoto)</p>'}</div>`;
    hydrate($('.sec-text .editor', el));
    $('.sec-diff', el).innerHTML = diffHTML(md, currentMd());
  }).catch(e => { $('.sec-diff', el).innerHTML = `<p class="muted" style="padding:16px">${esc(e.message || 'Versione non disponibile.')}</p>`; });
}
const currentMd = () => savedMd();

// ---------- differenze per righe (LCS) ----------
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const a2 = A.slice(s, ea), b2 = B.slice(s, eb);
  const n = a2.length, m = b2.length;
  const mid = [];
  if (n * m > 4e6) {
    // Testi enormi e molto diversi: niente allineamento fine.
    a2.forEach(x => mid.push(['-', x])); b2.forEach(x => mid.push(['+', x]));
  } else {
    const L = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      L[i * (m + 1) + j] = a2[i] === b2[j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
    }
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) { mid.push([' ', a2[i]]); i++; j++; }
      else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) { mid.push(['-', a2[i]]); i++; } else { mid.push(['+', b2[j]]); j++; }
    }
    while (i < n) mid.push(['-', a2[i++]]);
    while (j < m) mid.push(['+', b2[j++]]);
  }
  return [...A.slice(0, s).map(x => [' ', x]), ...mid, ...A.slice(ea).map(x => [' ', x])];
}

function diffHTML(oldMd, curMd) {
  const head = '<div class="sec-colhead">Differenze con la versione in corso</div>';
  if (oldMd === curMd) return head + '<p class="muted" style="padding:12px 14px">Questa versione è uguale a quella in corso.</p>';
  const rows = diffLines(oldMd, curMd);
  const del = rows.filter(r => r[0] === '-').length, add = rows.filter(r => r[0] === '+').length;
  const CTX = 3;
  const keep = rows.map((r, i) => r[0] !== ' ' || rows.slice(Math.max(0, i - CTX), i + CTX + 1).some(x => x[0] !== ' '));
  let out = '', skip = 0, na = 0, nb = 0;
  rows.forEach((r, i) => {
    if (r[0] !== '+') na++;
    if (r[0] !== '-') nb++;
    if (!keep[i]) { skip++; return; }
    if (skip) { out += `<div class="dl skip">··· ${skip} ${skip === 1 ? 'riga uguale' : 'righe uguali'} ···</div>`; skip = 0; }
    const cls = r[0] === '-' ? 'del' : r[0] === '+' ? 'add' : '';
    out += `<div class="dl ${cls}"><span class="dn">${r[0] === '+' ? '' : na}</span><span class="dn">${r[0] === '-' ? '' : nb}</span><span class="dm">${r[0] === ' ' ? '' : r[0] === '-' ? '−' : '+'}</span><span class="dt">${esc(r[1]) || '&nbsp;'}</span></div>`;
  });
  if (skip) out += `<div class="dl skip">··· ${skip} ${skip === 1 ? 'riga uguale' : 'righe uguali'} ···</div>`;
  return head + `<div class="sec-legend"><span class="del">− ${del} ${del === 1 ? 'riga tolta' : 'righe tolte'}</span><span class="add">+ ${add} ${add === 1 ? 'riga aggiunta' : 'righe aggiunte'}</span><span class="muted">rispetto a questa versione</span></div><div class="sec-lines">${out}</div>`;
}
