// Attività: liste, speciali, scadenze, ripetizioni, sotto-attività, riordino, dettaglio.
import { ic } from './icons.js';
import { $, $$, esc, debounce, sheet, closeOverlay, confirmDialog, promptDialog, choose, toast, autosize, fmtDay, fmtWhen, dayDiff, parseDay, isoDay, pad } from './ui.js';
import * as store from './store.js';
import { S } from './store.js';
import { app } from './ctx.js';
import { Editor, toolbarHTML } from './editor.js';
import { mdText, tagsIn } from './md.js';
import { pickDate } from './datepicker.js';
import { drawFor, mailCard, openRef } from './notes.js';
import { drawingToBlobURL } from './draw.js';
import { uuid } from './crypto.js';

const title = it => (it && it.d && it.d.title) || 'Senza titolo';
const REPEAT = { none: 'Non si ripete', day: 'Ogni giorno', week: 'Ogni settimana', month: 'Ogni mese', year: 'Ogni anno' };
const lists = () => store.all('list').sort(store.bySort);
const listOf = t => { let p = store.get(t.parent_id); if (p && p.kind === 'task') p = store.get(p.parent_id); return p; };
const isSub = t => { const p = store.get(t.parent_id); return p && p.kind === 'task'; };
const subs = id => store.children(id, 'task');

function currentList() {
  const R = app.R;
  if (R.list === 'starred') return 'starred';
  let l = R.list && store.get(R.list);
  if (!l || !store.alive(l)) l = lists()[0];
  R.list = l ? l.id : null;
  return R.list;
}

// ---------- scadenze ----------
export function plainDue(due) {
  if (!due || !due.date) return { due_at: null, remind_at: null };
  const [y, m, d] = due.date.split('-').map(Number);
  const [hh, mm] = (due.time || '00:00').split(':').map(Number);
  const at = new Date(y, m - 1, d, hh, mm);
  const rem = due.time ? at : new Date(y, m - 1, d, 9, 0);
  return { due_at: at.toISOString(), remind_at: rem.toISOString() };
}
function dueChip(d) {
  if (!d.due || !d.due.date) return '';
  const diff = dayDiff(d.due.date);
  const cls = diff < 0 ? 'late' : diff === 0 ? 'today' : '';
  return `<span class="chip ${cls}">${ic('cal')}${esc(fmtDay(d.due.date))}${d.due.time ? ' ' + esc(d.due.time) : ''}</span>`;
}
function nextDate(date, rep) {
  const d = parseDay(date);
  const n = rep.n || 1;
  if (rep.every === 'day') d.setDate(d.getDate() + n);
  if (rep.every === 'week') d.setDate(d.getDate() + 7 * n);
  if (rep.every === 'month') { const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  if (rep.every === 'year') d.setFullYear(d.getFullYear() + n);
  return isoDay(d);
}

// ---------- elenco ----------
function taskRow(t, opts = {}) {
  const d = t.d;
  const kids = subs(t.id);
  const doneKids = kids.filter(k => k.completed).length;
  const sub = isSub(t);
  const chips = [
    dueChip(d),
    d.repeat && d.repeat.every && d.repeat.every !== 'none' ? `<span class="chip">${ic('repeat')}${esc(REPEAT[d.repeat.every])}</span>` : '',
    !sub && kids.length ? `<span class="chip">${ic('sub')}${doneKids}/${kids.length}</span>` : '',
    d.page ? `<span class="chip">${ic('page')}pagina</span>` : '',
    d.mail ? `<span class="chip mail">${ic('mail')}da email</span>` : '',
    (d.drawings || []).length ? `<span class="chip">${ic('sketch')}${d.drawings.length}</span>` : '',
    opts.showList && listOf(t) ? `<span class="chip list" style="padding:2px 7px;font-size:12px">${esc(title(listOf(t)))}</span>` : '',
    ...tagsIn(d.title + ' ' + (d.notes || '')).slice(0, 2).map(x => `<span class="chip tag">#${esc(x)}</span>`),
  ].join('');
  const sel = app.desk && t.id === app.R.task;
  return `<div class="task ${sub ? 'sub' : ''} ${t.completed ? 'done' : ''} ${sel ? 'sel' : ''}" data-id="${t.id}">
    ${opts.drag ? `<span class="handle" data-a="drag" aria-label="Trascina per riordinare">${ic('drag')}</span>` : '<span></span>'}
    <button class="check needs-net" data-a="check" aria-label="${t.completed ? 'Segna da fare' : 'Completa'}"><span>${ic('check')}</span></button>
    <div class="body" data-a="open"><div class="t">${esc(title(t))}</div>${d.notes ? `<div class="n">${esc(mdText(d.notes).slice(0, 120))}</div>` : ''}${chips ? `<div class="chips">${chips}</div>` : ''}</div>
    <button class="star needs-net ${d.star ? 'on' : ''}" data-a="star" aria-label="Speciale">${ic('star')}</button>
  </div>`;
}

let showDone = false;
let tabsPos = { x: 0, y: 0 };
export function renderList(el) {
  const cur = currentList();
  const st = store.settings();
  const ls = lists();
  const starred = cur === 'starred';
  const l = !starred && cur && store.get(cur);
  const mode = l ? ((st.sortTasks || {})[l.id] || 'manual') : 'date';
  let top, done;
  if (starred) {
    const all = store.all('task').filter(t => t.d.star && !isSub(t) && listOf(t) && store.alive(listOf(t)));
    top = all.filter(t => !t.completed); done = all.filter(t => t.completed);
  } else if (l) {
    const all = store.children(l.id, 'task');
    top = all.filter(t => !t.completed); done = all.filter(t => t.completed);
  } else { top = []; done = []; }
  if (mode === 'date' || starred) top.sort((a, b) => ((a.d.due && a.d.due.date) || '9999').localeCompare((b.d.due && b.d.due.date) || '9999') || ((a.d.due && a.d.due.time) || '').localeCompare((b.d.due && b.d.due.time) || '') || a.sort - b.sort);
  done.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const drag = mode === 'manual' && !starred && !S.offline;
  const rowWithSubs = t => taskRow(t, { drag, showList: starred }) + subs(t.id).map(s => taskRow(s, { drag: false })).join('');
  el.innerHTML = `
    <div class="topbar">
      <div class="grow" style="padding-left:10px"><div class="apptitle">Attività</div></div>
      <button class="ib" data-a="search" data-only="phone" aria-label="Cerca">${ic('search')}</button>
      <button class="ib needs-net" data-a="list-menu" aria-label="Azioni lista" ${l ? '' : 'disabled'}>${ic('more')}</button>
      <button class="ib" data-a="lock" data-only="phone" aria-label="Blocca">${ic('lock')}</button>
      <button class="ib" data-only="desk" data-fold="tlist" aria-label="Nascondi elenco" title="Nascondi elenco (Ctrl+\\)">${ic('panel')}</button>
    </div>
    <div class="tabs" role="tablist" aria-label="Liste">
      <button class="tab" role="tab" data-a="pick" data-id="starred" aria-selected="${starred}">${ic('star', 'sm')}Speciali</button>
      ${ls.map(x => { const n = store.children(x.id, 'task').filter(t => !t.completed).length; return `<button class="tab" role="tab" data-a="pick" data-id="${x.id}" data-droplist="${x.id}" aria-selected="${x.id === cur}">${esc(title(x))}${n ? ` <span class="muted" style="font-weight:500">${n}</span>` : ''}</button>`; }).join('')}
      <button class="tab needs-net" data-a="new-list" aria-label="Nuova lista">${ic('plus', 'sm')}Lista</button>
    </div>
    ${mode === 'date' && !starred ? '<div class="sortbar">Ordinate per data di scadenza</div>' : ''}
    <div class="scroll" id="taskScroll">
      ${top.length ? top.map(rowWithSubs).join('') : `<div class="empty"><b>${starred ? 'Nessuna attività speciale' : 'Tutto fatto'}</b>${starred ? 'Tocca la stella di un\'attività per vederla qui.' : 'Aggiungi un\'attività con il pulsante qui sotto.'}</div>`}
      ${done.length ? `<button class="donehead" data-a="toggle-done" aria-expanded="${showDone}">Completate (${done.length})${ic('chev')}</button>${showDone ? done.map(t => taskRow(t, { showList: starred })).join('') : ''}` : ''}
      <div style="height:90px"></div>
    </div>
    <button class="fab needs-net" data-a="add">${ic('plus')}Attività</button>`;
  const tabs = el.querySelector('.tabs');
  if (tabs) {
    tabs.scrollLeft = tabsPos.x; tabs.scrollTop = tabsPos.y;
    const on = tabs.querySelector('.tab[aria-selected="true"]');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    tabs.addEventListener('scroll', () => { tabsPos = { x: tabs.scrollLeft, y: tabs.scrollTop }; }, { passive: true });
    tabs.addEventListener('wheel', e => {
      if (tabs.scrollWidth > tabs.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabs.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });
  }
  if (!el._bound) bindList(el);
}

function bindList(el) {
  el._bound = true;
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const row = b.closest('.task');
    const id = row ? row.dataset.id : b.dataset.id;
    switch (b.dataset.a) {
      case 'pick': app.go({ list: id, task: null }); break;
      case 'open': app.go({ view: 'tasks', task: id }); break;
      case 'check': toggle(id); break;
      case 'star': if (store.canWrite()) store.update(id, d => { d.star = !d.star; }); break;
      case 'toggle-done': showDone = !showDone; app.render(); break;
      case 'add': quickAdd(); break;
      case 'new-list': newList(); break;
      case 'list-menu': listMenu(app.R.list); break;
      case 'search': app.go({ view: 'search' }); break;
      case 'lock': app.lock(); break;
    }
  });
  bindDrag(el);
  bindSwipe(el);
}

// Riordino con la maniglia (mouse, dito o penna).
function bindDrag(el) {
  let D = null;
  el.addEventListener('pointerdown', e => {
    const h = e.target.closest('[data-a=drag]');
    if (!h || S.offline) return;
    const row = h.closest('.task');
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    const rows = $$('.task:not(.sub):not(.done)', el);
    D = { row, rows, startY: e.clientY, id: row.dataset.id, target: null, h };
    row.classList.add('dragging');
  });
  el.addEventListener('pointermove', e => {
    if (!D) return;
    const dy = e.clientY - D.startY;
    D.row.style.transform = `translateY(${dy}px)`;
    $$('.drop-before', el).forEach(x => x.classList.remove('drop-before'));
    D.target = null;
    for (const r of D.rows) {
      if (r === D.row) continue;
      const rc = r.getBoundingClientRect();
      if (e.clientY < rc.top + rc.height / 2) { D.target = r; r.classList.add('drop-before'); break; }
    }
    if (!D.target) D.target = 'end';
    const sc = $('#taskScroll', el); const rc = sc.getBoundingClientRect();
    if (e.clientY < rc.top + 40) sc.scrollTop -= 8; else if (e.clientY > rc.bottom - 40) sc.scrollTop += 8;
  });
  const end = () => {
    if (!D) return;
    const { row, id, target } = D;
    row.style.transform = ''; row.classList.remove('dragging');
    $$('.drop-before', el).forEach(x => x.classList.remove('drop-before'));
    D = null;
    if (!target || !store.canWrite()) return;
    const t = store.get(id);
    const sibs = store.children(t.parent_id, 'task').filter(x => !x.completed && x.id !== id);
    let sort;
    if (target === 'end') sort = sibs.length ? sibs[sibs.length - 1].sort + 1000 : 1000;
    else {
      const tg = store.get(target.dataset.id);
      const i = sibs.findIndex(x => x.id === tg.id);
      sort = i > 0 ? (sibs[i - 1].sort + tg.sort) / 2 : tg.sort - 1000;
    }
    if (sort !== t.sort) store.batch([{ id, sort }]);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// Scorrimento laterale su telefono: a destra completa, a sinistra elimina (punto 37).
function bindSwipe(el) {
  let W = null;
  el.addEventListener('touchstart', e => {
    const row = e.target.closest('.task');
    if (!row || e.target.closest('[data-a=drag]') || app.desk || S.offline) return;
    W = { row, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, lock: null };
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!W) return;
    const dx = e.touches[0].clientX - W.x, dy = e.touches[0].clientY - W.y;
    if (W.lock === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) W.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (W.lock !== 'x') return;
    W.dx = dx;
    W.row.style.transform = `translateX(${dx}px)`;
    W.row.style.background = dx > 0 ? 'var(--accent-soft)' : 'var(--danger-soft)';
  }, { passive: true });
  el.addEventListener('touchend', () => {
    if (!W) return;
    const { row, dx } = W;
    W = null;
    row.style.transform = ''; row.style.background = '';
    if (Math.abs(dx) < 90) return;
    const id = row.dataset.id;
    if (dx > 0) toggle(id);
    else removeTask(id);
  });
}

export async function toggle(id) {
  if (!store.canWrite()) return;
  const t = store.get(id);
  if (!t) return;
  const was = t.completed;
  const ops = [{ id, completed: !was }];
  let nextId = null;
  if (!was && t.d.repeat && t.d.repeat.every && t.d.repeat.every !== 'none' && !isSub(t)) {
    // Attività ricorrente: compare subito la successiva.
    const base = (t.d.due && t.d.due.date) || isoDay(new Date());
    const due = { date: nextDate(base, t.d.repeat), time: t.d.due ? t.d.due.time : null };
    nextId = uuid();
    const nd = { ...structuredClone(t.d), due, drawings: [], mail: null };
    store.save(nextId, { kind: 'task', parent_id: t.parent_id, sort: t.sort + 0.5, d: nd, ...plainDue(due), completed: false });
    for (const s of subs(id)) store.save(uuid(), { kind: 'task', parent_id: nextId, sort: s.sort, d: { ...structuredClone(s.d), due: null }, completed: false });
  }
  await store.batch(ops);
  if (!was) toast(nextId ? `Completata. Prossima: ${fmtDay(store.get(nextId).d.due.date)}` : 'Attività completata', 'Annulla', () => {
    store.batch([{ id, completed: false }]);
    if (nextId) store.trash(nextId);
  });
}

async function removeTask(id) {
  if (!store.canWrite()) return;
  await store.trash(id);
  if (app.R.task === id) app.go({ task: null });
  toast('Attività nel cestino', 'Annulla', () => store.restore(id));
}

async function newList() {
  if (!store.canWrite()) return;
  const r = await promptDialog('Nuova lista', { label: 'Nome', placeholder: 'Es. Lavoro', ok: 'Crea' });
  if (!r || !r.value) return;
  const id = store.create('list', null, { title: r.value });
  app.go({ list: id, task: null });
}
async function listMenu(id) {
  const l = store.get(id);
  if (!l) return;
  const st = store.settings();
  const mode = (st.sortTasks || {})[id] || 'manual';
  const a = await choose(title(l), [
    { label: mode === 'date' ? 'Ordina a mano' : 'Ordina per data di scadenza', value: 'sort', icon: 'cal' },
    { label: 'Rinomina', value: 'rename', icon: 'pen' },
    { label: 'Sposta la lista a sinistra', value: 'up', icon: 'back' },
    { label: 'Sposta la lista a destra', value: 'down', icon: 'fwd' },
    { label: 'Elimina le completate', value: 'clear', icon: 'check' },
    { label: 'Elimina lista', value: 'del', icon: 'trash', danger: true },
  ]);
  if (!a || !store.canWrite()) return;
  if (a === 'sort') store.update('settings', d => { d.sortTasks = d.sortTasks || {}; d.sortTasks[id] = mode === 'date' ? 'manual' : 'date'; });
  if (a === 'rename') { const r = await promptDialog('Rinomina lista', { label: 'Nome', value: title(l) }); if (r && r.value) store.update(id, d => { d.title = r.value; }); }
  if (a === 'up' || a === 'down') {
    const ls = lists(); const i = ls.findIndex(x => x.id === id); const j = i + (a === 'up' ? -1 : 1);
    if (j >= 0 && j < ls.length) store.batch([{ id, sort: ls[j].sort }, { id: ls[j].id, sort: l.sort }]);
  }
  if (a === 'clear') {
    const done = store.children(id, 'task').filter(t => t.completed);
    if (!done.length) { toast('Nessuna attività completata.'); return; }
    if (await confirmDialog(`Eliminare ${done.length} attività completate?`, 'Vanno nel cestino per 30 giorni.', { ok: 'Elimina', danger: true })) {
      for (const t of done) await store.trash(t.id);
      toast('Completate eliminate.');
    }
  }
  if (a === 'del') {
    const n = store.children(id, 'task').length;
    if (await confirmDialog(`Eliminare la lista «${esc(title(l))}»?`, `La lista e le sue ${n} attività vanno nel cestino per 30 giorni.`, { ok: 'Elimina', danger: true })) {
      await store.trash(id);
      app.go({ list: null, task: null });
      toast('Lista nel cestino', 'Annulla', () => store.restore(id));
    }
  }
}

// ---------- aggiunta rapida ----------
export function quickAdd(state = null) {
  if (!store.canWrite()) return;
  const ls = lists();
  if (!ls.length) { newList(); return; }
  const cur = currentList();
  const st = state || { title: '', date: null, star: cur === 'starred', list: cur !== 'starred' ? cur : (store.settings().lastList && store.get(store.settings().lastList) ? store.settings().lastList : ls[0].id) };
  const el = sheet(`<h3>Nuova attività</h3><form>
    <input class="field-in" name="t" placeholder="Cosa devi fare?" value="${esc(st.title)}" autocomplete="off" enterkeyhint="done">
    <div class="chips" style="margin-top:10px;align-items:center;gap:8px">
      <button type="button" class="chip ${st.date ? 'today' : ''}" data-q="date" style="padding:7px 10px">${ic('cal')}${st.date ? esc(fmtDay(st.date)) : 'Data'}</button>
      <button type="button" class="chip" data-q="star" style="padding:7px 10px;${st.star ? 'color:var(--due)' : ''}">${ic('star')}${st.star ? 'Speciale' : 'Stella'}</button>
      <label class="chip" style="padding:3px 6px">${ic('list')}<select name="l" class="sel" style="border:0;background:transparent;min-height:30px;padding:2px">${ls.map(l => `<option value="${l.id}" ${l.id === st.list ? 'selected' : ''}>${esc(title(l))}</option>`).join('')}</select></label>
    </div>
    <p class="ok">Andrà nella lista «<b class="ln">${esc(title(store.get(st.list)))}</b>».</p>
    <div class="row-end"><button type="button" class="btn ghost" data-close>Chiudi</button><button class="btn primary">Aggiungi</button></div></form>`);
  const f = $('form', el);
  const sync = () => { st.title = f.t.value; st.list = f.l.value; $('.ln', el).textContent = title(store.get(st.list)); };
  f.l.addEventListener('change', sync);
  f.t.addEventListener('input', sync);
  el.addEventListener('click', async e => {
    const q = e.target.closest('[data-q]');
    if (!q) return;
    sync();
    if (q.dataset.q === 'star') { st.star = !st.star; quickAdd(st); }
    if (q.dataset.q === 'date') { const d = await pickDate(st.date, 'Scadenza'); if (d !== undefined) st.date = d || null; quickAdd(st); }
  });
  f.addEventListener('submit', e => {
    e.preventDefault();
    sync();
    const t = st.title.trim();
    if (!t) return;
    const due = st.date ? { date: st.date, time: null } : null;
    const id = store.create('task', st.list, { title: t, notes: '', star: st.star, due, repeat: { every: 'none' } }, { first: true, plain: plainDue(due) });
    toast(`Aggiunta a «${title(store.get(st.list))}»`, 'Apri', () => app.go({ view: 'tasks', list: st.list, task: id }));
    quickAdd({ title: '', date: null, star: st.star, list: st.list });
  });
  if (!('ontouchstart' in window) || state) setTimeout(() => f.t.focus(), 50);
}

// ---------- dettaglio ----------
let T = null;
const saveTitle = debounce((id, v) => { const it = store.get(id); if (it && it.d && it.d.title !== v) store.update(id, d => { d.title = v; }); }, 600);
export function flush() {
  if (!T) return;
  const ti = $('#dTitle', T.el);
  if (ti && T.titleDirty) saveTitle.flush(T.id, ti.value);
  if (T.editor) T.editor.flush();
}

export function renderDetail(el, id) {
  if (!el) { if (T) { flush(); T = null; } return; }
  const t = store.get(id);
  if (!t || !t.d) return;
  if (T && T.id === id && T.el === el && el.isConnected) { updateDetail(t); return; }
  if (T) flush();
  const ro = S.offline;
  el.innerHTML = `
    <div class="topbar">
      <button class="ib" data-a="back" data-only="phone" aria-label="Indietro">${ic('back')}</button>
      ${app.R.from === 'search' ? `<button class="btn ghost small" data-only="desk" data-a="to-search" style="margin-left:8px">${ic('back', 'sm')}Risultati</button>` : ''}
      <div class="grow" style="padding-left:6px"><button class="chip list needs-net" data-a="move" id="dList"></button></div>
      <button class="ib needs-net" data-a="star" id="dStar" aria-label="Speciale">${ic('star')}</button>
      <button class="ib needs-net" data-a="del" aria-label="Elimina">${ic('trash')}</button>
    </div>
    <div class="scroll"><div class="form">
      ${ro ? '<div class="ro-note">Offline: sola lettura.</div>' : ''}
      <div id="dParent"></div>
      <textarea id="dTitle" class="title-in" rows="1" placeholder="Titolo" aria-label="Titolo attività" ${ro ? 'readonly' : ''}>${esc(t.d.title || '')}</textarea>
      <div id="dTools"></div>
      <div id="dNotes"></div>
      <div id="dMail"></div>
      <div class="frow">${ic('cal')}<div class="grow" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="datebtn needs-net" data-a="date" id="dDate"></button>
        <input class="time needs-net" type="time" id="dTime" aria-label="Ora">
        <button class="ib needs-net" data-a="clear-date" id="dClear" aria-label="Togli data">${ic('close', 'sm')}</button></div></div>
      <div class="frow">${ic('repeat')}<select id="dRepeat" aria-label="Ripeti" class="needs-net">${Object.entries(REPEAT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <label id="dEveryWrap" class="muted" style="font-size:13px">ogni <input type="number" min="1" max="99" id="dEvery" class="time" style="width:70px"></label></div>
      <div class="frow" id="dSubsRow" style="align-items:flex-start">${ic('sub')}<div class="grow"><div class="subs" id="dSubs"></div>
        <div class="subrow needs-net"><span class="mini"><span style="border-style:dashed"></span></span><input type="text" id="dNewSub" placeholder="Aggiungi sotto-attività" aria-label="Nuova sotto-attività"></div></div></div>
      <div class="frow" style="align-items:flex-start">${ic('sketch')}<div class="grow"><div class="sketches" id="dSketches"></div>
        <button class="linkbtn needs-net" data-a="draw">${ic('pen', 'sm')}Nuovo disegno</button></div></div>
      <div class="frow" id="dPageRow">${ic('page')}<div class="grow" id="dPage"></div></div>
      <div class="frow muted" style="font-size:12.5px" id="dMeta"></div>
    </div></div>
    <div class="bottombar needs-net"><button class="btn primary" data-a="done" id="dDone"></button></div>`;
  const ed = new Editor($('#dNotes', el), {
    md: t.d.notes || '', small: true, readonly: ro, ownerId: id, placeholder: 'Aggiungi dettagli',
    onChange: md => { if (store.canWrite()) store.update(id, d => { d.notes = md; }); },
    onDraw: drawId => drawFor(id, drawId),
    onOpenRef: openRef,
  });
  $('#dTools', el).innerHTML = ro ? '' : toolbarHTML(true, 'inline');
  $$('.etools', el).forEach(b => ed.bindToolbar(b));
  T = { id, el, editor: ed };
  const ti = $('#dTitle', el);
  autosize(ti);
  ti.addEventListener('input', () => { autosize(ti); T.titleDirty = true; if (!S.offline) saveTitle(id, ti.value); });
  ti.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ed.focusEnd(); } });
  $('#dTime', el).addEventListener('change', e => setDue(id, { time: e.target.value || null }));
  $('#dRepeat', el).addEventListener('change', e => { if (store.canWrite()) store.update(id, d => { d.repeat = { every: e.target.value, n: d.repeat && d.repeat.n || 1 }; if (e.target.value !== 'none' && !(d.due && d.due.date)) toast('Aggiungi una data: la ripetizione parte da lì.'); }); });
  $('#dEvery', el).addEventListener('change', e => { if (store.canWrite()) store.update(id, d => { d.repeat = { ...(d.repeat || { every: 'day' }), n: Math.max(1, Math.min(99, +e.target.value || 1)) }; }); });
  $('#dNewSub', el).addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (!v || !store.canWrite()) return;
    store.create('task', id, { title: v, notes: '', repeat: { every: 'none' } });
    e.target.value = '';
  });
  el.onclick = e => onDetailClick(e, id);
  el.onchange = e => {
    const inp = e.target.closest('.subrow input[type=text][data-id]');
    if (inp && store.canWrite()) { const v = inp.value.trim(); if (v) store.update(inp.dataset.id, d => { d.title = v; }); }
  };
  updateDetail(t);
}

function updateDetail(t) {
  const el = T.el;
  const d = t.d;
  const l = listOf(t);
  const sub = isSub(t);
  $('#dList', el).innerHTML = `${ic('list')}${esc(l ? title(l) : '')}`;
  $('#dStar', el).classList.toggle('on', !!d.star);
  $('#dStar', el).style.color = d.star ? 'var(--due)' : '';
  $('#dParent', el).innerHTML = sub ? `<button class="linkbtn" data-a="parent">${ic('back', 'sm')}Sotto-attività di «${esc(title(store.get(t.parent_id)))}»</button>` : '';
  const ti = $('#dTitle', el);
  if (document.activeElement !== ti && ti.value !== (d.title || '')) { ti.value = d.title || ''; autosize(ti); }
  if (T.editor && !el.contains(document.activeElement) && d.notes !== T.editor.md) T.editor.setMd(d.notes || '');
  T.editor.setReadonly(S.offline);
  const db = $('#dDate', el);
  db.textContent = d.due && d.due.date ? fmtDay(d.due.date, true) : 'Aggiungi data';
  db.classList.toggle('empty', !(d.due && d.due.date));
  $('#dTime', el).value = d.due && d.due.time ? d.due.time : '';
  $('#dTime', el).hidden = !(d.due && d.due.date);
  $('#dClear', el).hidden = !(d.due && d.due.date);
  const rep = (d.repeat && d.repeat.every) || 'none';
  $('#dRepeat', el).value = rep;
  $('#dEveryWrap', el).hidden = rep === 'none';
  $('#dEvery', el).value = (d.repeat && d.repeat.n) || 1;
  $('#dRepeat', el).closest('.frow').hidden = sub;
  $('#dMail', el).innerHTML = d.mail ? mailCard(d.mail) : '';
  // Sotto-attività: riordinabili, con scadenza propria, promuovibili (punto 33).
  $('#dSubsRow', el).hidden = sub;
  if (!sub) {
    const ks = subs(t.id);
    $('#dSubs', el).innerHTML = ks.map((k, i) => `<div class="subrow ${k.completed ? 'done' : ''}">
      <button class="mini needs-net" data-a="sub-check" data-id="${k.id}" aria-label="Completa"><span>${ic('check')}</span></button>
      <input type="text" value="${esc(k.d.title)}" data-id="${k.id}" aria-label="Sotto-attività" ${S.offline ? 'readonly' : ''}>
      ${k.d.due && k.d.due.date ? dueChip(k.d) : ''}
      <button class="ib needs-net" data-a="sub-menu" data-id="${k.id}" data-i="${i}" aria-label="Azioni sotto-attività" style="width:36px;height:36px">${ic('more')}</button></div>`).join('');
  }
  const sk = $('#dSketches', el);
  const ids = (d.drawings || []).filter(x => store.get(x));
  if (sk.dataset.ids !== ids.join(',')) {
    sk.dataset.ids = ids.join(',');
    sk.innerHTML = ids.map(x => `<img data-draw="${x}" alt="Disegno">`).join('');
    for (const img of $$('img', sk)) store.getDrawing(img.dataset.draw).then(dd => drawingToBlobURL(dd, { maxW: 220, scale: 1 })).then(u => { img.src = u; }).catch(() => { img.alt = 'Non disponibile'; });
  }
  const pg = d.page && store.get(d.page);
  $('#dPageRow', el).hidden = !pg;
  $('#dPage', el).innerHTML = pg ? `<button class="linkbtn" data-a="open-page">${ic('page', 'sm')}${esc(title(pg))}${!store.alive(pg) ? ' (nel cestino)' : ''}</button>` : '';
  $('#dMeta', el).textContent = `Creata ${fmtWhen(t.created_at)} · modificata ${fmtWhen(t.updated_at)}`;
  $('#dDone', el).textContent = t.completed ? 'Segna come da fare' : 'Segna come completata';
}

async function setDue(id, patch) {
  if (!store.canWrite()) return;
  const t = store.get(id);
  const due = { ...(t.d.due || {}), ...patch };
  const nd = due.date ? due : null;
  await store.save(id, { d: { ...structuredClone(t.d), due: nd }, ...plainDue(nd) });
  scheduleLocalReminders();
}

async function onDetailClick(e, id) {
  const b = e.target.closest('[data-a]');
  if (!b || b.closest('#dNotes')) return;
  const t = store.get(id);
  switch (b.dataset.a) {
    case 'back': history.state && history.state.znk ? history.back() : app.go({ task: null }); break;
    case 'to-search': app.go({ view: 'search', task: null, from: null }); break;
    case 'star': if (store.canWrite()) store.update(id, d => { d.star = !d.star; }); break;
    case 'del': removeTask(id); break;
    case 'done': toggle(id); break;
    case 'parent': app.go({ task: t.parent_id }); break;
    case 'open-page': openRef('page/' + t.d.page); break;
    case 'date': { const d = await pickDate(t.d.due && t.d.due.date); if (d !== undefined) setDue(id, d ? { date: d } : { date: null, time: null }); break; }
    case 'clear-date': setDue(id, { date: null, time: null }); break;
    case 'move': {
      if (!store.canWrite() || isSub(t)) { if (isSub(t)) toast('Sposta l\'attività principale, oppure promuovi prima la sotto-attività.'); return; }
      const to = await choose('Sposta in', lists().map(l => ({ label: title(l), value: l.id, icon: 'list' })), { current: t.parent_id });
      if (to && to !== t.parent_id) { await store.batch([{ id, parent_id: to, sort: store.nextSort(to, 'task', true) }]); app.go({ list: to }); toast(`Spostata in «${title(store.get(to))}»`); }
      break;
    }
    case 'draw': {
      const did = await drawFor(id, null);
      if (did) store.update(id, d => { d.drawings = [...(d.drawings || []), did]; });
      break;
    }
    case 'sub-check': toggle(b.dataset.id); break;
    case 'sub-menu': subMenu(id, b.dataset.id); break;
  }
  const img = e.target.closest('img[data-draw]');
  if (img) {
    const a = await choose('Disegno', [{ label: 'Apri e modifica', value: 'edit', icon: 'pen' }, { label: 'Togli dall\'attività', value: 'rm', icon: 'trash', danger: true }]);
    if (a === 'edit') { const did = await drawFor(id, img.dataset.draw); if (did) { $('#dSketches', T.el).dataset.ids = ''; updateDetail(store.get(id)); } }
    if (a === 'rm' && store.canWrite()) { store.update(id, d => { d.drawings = (d.drawings || []).filter(x => x !== img.dataset.draw); }); store.trash(img.dataset.draw); }
  }
}

async function subMenu(parentId, sid) {
  const k = store.get(sid);
  const ks = subs(parentId);
  const i = ks.findIndex(x => x.id === sid);
  const a = await choose(title(k), [
    { label: k.d.due && k.d.due.date ? `Scadenza: ${fmtDay(k.d.due.date)}` : 'Aggiungi scadenza', value: 'date', icon: 'cal' },
    { label: 'Apri i dettagli', value: 'open', icon: 'fwd' },
    { label: 'Sposta su', value: 'up', icon: 'up', disabled: i === 0 },
    { label: 'Sposta giù', value: 'down', icon: 'down', disabled: i === ks.length - 1 },
    { label: 'Promuovi ad attività', value: 'promote', icon: 'tasks' },
    { label: 'Elimina', value: 'del', icon: 'trash', danger: true },
  ]);
  if (!a) return;
  if (a === 'open') { app.go({ task: sid }); return; }
  if (!store.canWrite()) return;
  if (a === 'date') { const d = await pickDate(k.d.due && k.d.due.date); if (d !== undefined) setDue(sid, d ? { date: d } : { date: null, time: null }); }
  if (a === 'up' || a === 'down') { const j = i + (a === 'up' ? -1 : 1); store.batch([{ id: sid, sort: ks[j].sort }, { id: ks[j].id, sort: k.sort }]); }
  if (a === 'promote') { const l = listOf(store.get(parentId)); await store.batch([{ id: sid, parent_id: l.id, sort: store.get(parentId).sort + 1 }]); toast('Ora è un\'attività della lista.'); }
  if (a === 'del') { await store.trash(sid); toast('Sotto-attività nel cestino', 'Annulla', () => store.restore(sid)); }
}

// ---------- promemoria creati dal dispositivo (con il titolo, finché l'app è aperta) ----------
let remT = [];
export function scheduleLocalReminders() {
  remT.forEach(clearTimeout); remT = [];
  if (!('Notification' in window) || Notification.permission !== 'granted' || !store.settings().notify) return;
  const now = Date.now();
  for (const t of store.all('task')) {
    if (t.completed || !t.remind_at) continue;
    const at = new Date(t.remind_at).getTime();
    if (at <= now || at - now > 864e5) continue;
    remT.push(setTimeout(async () => {
      const cur = store.get(t.id);
      if (!cur || cur.completed || !S.space) return;
      const reg = await navigator.serviceWorker.getRegistration();
      const opts = { body: cur.d.due && cur.d.due.time ? `Alle ${cur.d.due.time}` : 'In scadenza oggi', tag: 'znk-' + t.id, icon: undefined, data: { task: t.id } };
      if (reg) reg.showNotification(cur.d.title || 'Attività in scadenza', opts); else new Notification(cur.d.title || 'Attività in scadenza', opts);
    }, at - now));
  }
}
store.onChange(debounce(scheduleLocalReminders, 2000));
export { pad };
