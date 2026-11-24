// Ricerca sul dispositivo, sui dati decifrati: pagine e attività, con filtri e percorso (punto 41).
import { ic } from './icons.js';
import { $, esc, debounce, fmtShort } from './ui.js';
import * as store from './store.js';
import { app } from './ctx.js';
import { mdText, hasDrawing } from './md.js';
import { pathOf, sectionOf } from './notes.js';

const Q = { q: '', type: 'all', where: '', period: '0', draw: false };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function hl(text, terms) {
  let out = esc(text);
  for (const t of terms) {
    if (!t) continue;
    const re = new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}
function snippet(text, terms) {
  const n = norm(text);
  let i = -1;
  for (const t of terms) { i = n.indexOf(t); if (i >= 0) break; }
  if (i < 0) return text.slice(0, 140);
  const s = Math.max(0, i - 50);
  return (s ? '…' : '') + text.slice(s, s + 160) + (s + 160 < text.length ? '…' : '');
}

function results() {
  const terms = norm(Q.q).split(/\s+/).filter(Boolean);
  const since = +Q.period ? Date.now() - +Q.period * 864e5 : 0;
  const okTime = it => !since || new Date(it.updated_at).getTime() >= since;
  const match = (txt) => terms.every(t => txt.includes(t));
  const pages = [], tasks = [];
  if (Q.type !== 'tasks') {
    for (const p of store.all('page')) {
      if (!okTime(p)) continue;
      if (Q.where && Q.where.startsWith('s:') && (!sectionOf(p) || sectionOf(p).id !== Q.where.slice(2))) continue;
      if (Q.where && Q.where.startsWith('l:')) continue;
      if (Q.draw && !hasDrawing(p.d.md)) continue;
      const body = mdText(p.d.md);
      const hay = norm((p.d.title || '') + ' ' + body);
      if (terms.length && !match(hay)) continue;
      pages.push({ p, body, score: terms.length ? terms.filter(t => norm(p.d.title).includes(t)).length : 0 });
    }
  }
  if (Q.type !== 'pages') {
    for (const t of store.all('task')) {
      if (!okTime(t)) continue;
      let l = store.get(t.parent_id); if (l && l.kind === 'task') l = store.get(l.parent_id);
      if (!l || !store.alive(l)) continue;
      if (Q.where && Q.where.startsWith('l:') && l.id !== Q.where.slice(2)) continue;
      if (Q.where && Q.where.startsWith('s:')) continue;
      if (Q.draw && !(t.d.drawings || []).length && !hasDrawing(t.d.notes)) continue;
      const body = mdText(t.d.notes);
      const hay = norm((t.d.title || '') + ' ' + body);
      if (terms.length && !match(hay)) continue;
      tasks.push({ t, l, body });
    }
  }
  pages.sort((a, b) => b.score - a.score || (b.p.updated_at || '').localeCompare(a.p.updated_at || ''));
  tasks.sort((a, b) => Number(a.t.completed) - Number(b.t.completed) || (b.t.updated_at || '').localeCompare(a.t.updated_at || ''));
  return { pages, tasks, terms };
}

function resultsHTML() {
  const active = Q.q.trim() || Q.where || Q.draw || +Q.period;
  if (!active) return `<div class="empty"><b>Cerca nelle tue note</b>La ricerca avviene su questo dispositivo, sui dati già decifrati: il sito non vede cosa cerchi.</div>`;
  const { pages, tasks, terms } = results();
  if (!pages.length && !tasks.length) return `<div class="empty"><b>Nessun risultato</b>Prova con meno parole o togli i filtri.</div>`;
  let h = '';
  if (pages.length) h += `<div class="rhead">Pagine · ${pages.length}</div>` + pages.slice(0, 200).map(({ p, body }) => `
    <div class="page-row" data-a="page" data-id="${p.id}"><div class="pg">
      <div class="pt">${p.d.mail ? ic('mail', 'sm') : ''}${hl(p.d.title || 'Senza titolo', terms)}</div>
      <div class="path">${esc(pathOf(p))}</div>
      <div class="ps">${hl(snippet(body, terms), terms)}</div></div><div class="pd">${esc(fmtShort(p.updated_at))}</div></div>`).join('');
  if (tasks.length) h += `<div class="rhead">Attività · ${tasks.length}</div>` + tasks.slice(0, 200).map(({ t, l, body }) => `
    <div class="page-row" data-a="task" data-id="${t.id}"><div class="pg">
      <div class="pt">${ic(t.completed ? 'check' : 'tasks', 'sm')}${hl(t.d.title || 'Senza titolo', terms)}</div>
      <div class="path">${esc(l.d.title)}${t.completed ? ' · completata' : ''}</div>
      ${body ? `<div class="ps">${hl(snippet(body, terms), terms)}</div>` : ''}</div></div>`).join('');
  return h;
}

export function render(el) {
  if (el._built) { $('#searchRes', el).innerHTML = `<div class="resw">${resultsHTML()}</div>`; return; }
  el._built = true;
  const secs = store.all('section').sort(store.bySort);
  const lists = store.all('list').sort(store.bySort);
  el.innerHTML = `
    <div class="topbar"><div class="grow" style="padding-left:10px"><div class="apptitle">Cerca</div></div></div>
    <label class="searchbox">${ic('search')}<input id="q" type="search" placeholder="Cerca in pagine e attività" value="${esc(Q.q)}" aria-label="Cerca" autocomplete="off"></label>
    <div class="filters">
      <select id="fType" aria-label="Tipo"><option value="all">Tutto</option><option value="pages">Solo pagine</option><option value="tasks">Solo attività</option></select>
      <select id="fWhere" aria-label="Dove"><option value="">Ovunque</option>${secs.length ? `<optgroup label="Sezioni">${secs.map(s => `<option value="s:${s.id}">${esc(s.d.title)}</option>`).join('')}</optgroup>` : ''}${lists.length ? `<optgroup label="Liste">${lists.map(l => `<option value="l:${l.id}">${esc(l.d.title)}</option>`).join('')}</optgroup>` : ''}</select>
      <select id="fPeriod" aria-label="Periodo"><option value="0">Qualsiasi data</option><option value="7">Ultimi 7 giorni</option><option value="30">Ultimi 30 giorni</option><option value="365">Ultimo anno</option></select>
      <label class="chip" style="padding:6px 10px;cursor:pointer"><input type="checkbox" id="fDraw" style="accent-color:var(--accent)"> con disegni</label>
    </div>
    <div class="scroll" id="searchRes"><div class="resw">${resultsHTML()}</div></div>`;
  $('#fType', el).value = Q.type; $('#fWhere', el).value = Q.where; $('#fPeriod', el).value = Q.period; $('#fDraw', el).checked = Q.draw;
  const upd = debounce(() => { $('#searchRes', el).innerHTML = `<div class="resw">${resultsHTML()}</div>`; }, 150);
  $('#q', el).addEventListener('input', e => { Q.q = e.target.value; upd(); });
  el.addEventListener('change', e => {
    if (e.target.id === 'fType') Q.type = e.target.value;
    if (e.target.id === 'fWhere') Q.where = e.target.value;
    if (e.target.id === 'fPeriod') Q.period = e.target.value;
    if (e.target.id === 'fDraw') Q.draw = e.target.checked;
    upd();
  });
  el.addEventListener('click', e => {
    const r = e.target.closest('[data-a]');
    if (!r) return;
    if (r.dataset.a === 'page') app.go({ view: 'notes', page: r.dataset.id, from: 'search' });
    if (r.dataset.a === 'task') {
      const t = store.get(r.dataset.id);
      let l = store.get(t.parent_id); if (l && l.kind === 'task') l = store.get(l.parent_id);
      app.go({ view: 'tasks', list: l.id, task: r.dataset.id, from: 'search' });
    }
  });
  if (!('ontouchstart' in window)) setTimeout(() => $('#q', el).focus(), 30);
}
