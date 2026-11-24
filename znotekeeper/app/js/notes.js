// Taccuino: gruppi di sezioni › sezioni › pagine (e sottopagine), editor della pagina.
import { ic } from './icons.js';
import { $, $$, esc, debounce, sheet, drawer, closeOverlay, confirmDialog, promptDialog, choose, toast, autosize, fmtShort, fmtWhen, download, fmtSize } from './ui.js';
import * as store from './store.js';
import { S } from './store.js';
import { app } from './ctx.js';
import { Editor, toolbarHTML, hydrate } from './editor.js';
import { mdText, mdToHtml, firstDrawing, firstImage, tagsIn } from './md.js';
import { openDrawEditor, emptyDrawing, drawingToBlobURL } from './draw.js';
import { api } from './api.js';
import { uuid } from './crypto.js';

const COLORS = [1, 2, 3, 4, 5, 6];
export const secColor = s => `var(--s${(s && s.d && s.d.color) || 3})`;
const title = it => (it && it.d && it.d.title) || 'Senza titolo';

// ---------- struttura ----------
export function sectionOf(page) {
  let it = page, n = 0;
  while (it && it.kind === 'page' && n++ < 20) it = store.get(it.parent_id);
  return it && it.kind === 'section' ? it : null;
}
export function groupOf(section) { const g = section && store.get(section.parent_id); return g && g.kind === 'group' && store.alive(g) ? g : null; }
export function pathOf(page) {
  const s = sectionOf(page); const g = groupOf(s);
  const parts = [];
  if (g) parts.push(title(g));
  if (s) parts.push(title(s));
  let p = store.get(page.parent_id); const chain = [];
  while (p && p.kind === 'page') { chain.unshift(title(p)); p = store.get(p.parent_id); }
  return [...parts, ...chain].join(' › ');
}
function pagesTree(sectionId, mode) {
  const out = [];
  const walk = (pid, depth) => {
    let kids = store.children(pid, 'page');
    if (mode === 'date') kids = kids.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    if (mode === 'title') kids = kids.sort((a, b) => title(a).localeCompare(title(b), 'it'));
    for (const k of kids) { out.push({ it: k, depth }); if (depth < 4) walk(k.id, depth + 1); }
  };
  walk(sectionId, 0);
  return out;
}
const countPages = sid => { let n = 0; const w = pid => { for (const k of store.children(pid, 'page')) { n++; w(k.id); } }; w(sid); return n; };
const ungrouped = () => store.all('section').filter(s => !s.parent_id || !store.alive(store.get(s.parent_id))).sort(store.bySort);
export function allTags() {
  const m = new Map();
  for (const p of store.all('page')) for (const t of tagsIn(p.d.md)) m.set(t, (m.get(t) || 0) + 1);
  for (const t of store.all('task')) for (const x of tagsIn((t.d.title || '') + ' ' + (t.d.notes || ''))) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'it'));
}
function currentSection() {
  const R = app.R;
  if (R.section && String(R.section).includes(':')) return R.section;
  let s = R.section && store.get(R.section);
  if (!s || !store.alive(s)) s = ungrouped()[0] || store.all('section').sort(store.bySort)[0];
  R.section = s ? s.id : null;
  return R.section;
}

// ---------- albero ----------
const collapsed = (() => { try { return new Set(JSON.parse(localStorage.getItem('znk-collapsed') || '[]')); } catch (e) { return new Set(); } })();
const saveCollapsed = () => { try { localStorage.setItem('znk-collapsed', JSON.stringify([...collapsed])); } catch (e) { /* */ } };

function treeHTML() {
  const cur = currentSection();
  const secRow = (s, top) => `<div class="row"><button class="sec ${top ? 'top' : ''}" data-a="pick-sec" data-id="${s.id}" aria-current="${s.id === cur}" data-drop="${s.id}">
      <span class="tab-color" style="background:${secColor(s)}"></span><span class="nm">${esc(title(s))}</span>${s.d.inbox ? ic('mail', 'sm') : ''}<span class="cnt">${countPages(s.id)}</span></button>
      <button class="ib more needs-net" data-a="sec-menu" data-id="${s.id}" aria-label="Azioni sezione ${esc(title(s))}">${ic('more')}</button></div>`;
  const groups = store.all('group').sort(store.bySort);
  const tags = allTags();
  const trashN = trashItems().length;
  return `<div class="dh"><div class="crumb">Il mio taccuino</div><h2 class="big" style="font-size:24px">Sezioni</h2></div>
    <div class="tree">
      <button class="quick" data-a="pick-sec" data-id="v:fav" aria-current="${cur === 'v:fav'}">${ic('star')}Preferiti</button>
      <button class="quick" data-a="pick-sec" data-id="v:recent" aria-current="${cur === 'v:recent'}">${ic('clock')}Recenti</button>
      ${tags.length ? `<button class="quick" data-a="tags" aria-current="${String(cur).startsWith('tag:')}">${ic('tag')}Etichette<span class="cnt" style="margin-left:auto;color:var(--muted);font-size:12px">${tags.length}</span></button>` : ''}
      <hr>
      ${ungrouped().map(s => secRow(s, true)).join('')}
      ${groups.map(g => {
        const open = !collapsed.has(g.id);
        const secs = store.children(g.id, 'section');
        return `<div class="row"><button class="grp" data-a="toggle-grp" data-id="${g.id}" aria-expanded="${open}">${ic('folder')}<span class="nm">${esc(title(g))}</span>${ic('chev', 'chev')}</button>
          <button class="ib more needs-net" data-a="grp-menu" data-id="${g.id}" aria-label="Azioni gruppo">${ic('more')}</button></div>
          ${open ? secs.map(s => secRow(s)).join('') || '<div class="crumb" style="padding:6px 34px">Nessuna sezione</div>' : ''}`;
      }).join('')}
      <hr>
      <button class="add needs-net" data-a="new-sec">${ic('plus')}Nuova sezione</button>
      <button class="add needs-net" data-a="new-grp">${ic('folder')}Nuovo gruppo di sezioni</button>
      <button class="quick" data-a="pick-sec" data-id="v:trash" aria-current="${cur === 'v:trash'}">${ic('trash')}Cestino${trashN ? `<span class="cnt" style="margin-left:auto;color:var(--muted);font-size:12px">${trashN}</span>` : ''}</button>
    </div>`;
}

export function renderTree(el) {
  el.innerHTML = treeHTML();
  bindTree(el);
}
function bindTree(el) {
  if (el._bound) return;
  el._bound = true;
  el.addEventListener('click', onTreeClick);
  // Trascinare una pagina su una sezione la sposta lì (PC).
  el.addEventListener('dragover', e => { const t = e.target.closest('[data-drop]'); if (t && dragId) { e.preventDefault(); $$('.drop', el).forEach(x => x.classList.remove('drop')); t.classList.add('drop'); } });
  el.addEventListener('dragleave', e => { const t = e.target.closest('[data-drop]'); if (t) t.classList.remove('drop'); });
  el.addEventListener('drop', e => {
    const t = e.target.closest('[data-drop]');
    if (!t || !dragId) return;
    e.preventDefault();
    const id = dragId; dragId = null;
    if (!store.canWrite()) return;
    store.batch([{ id, parent_id: t.dataset.drop, sort: store.nextSort(t.dataset.drop, 'page') }]);
    toast(`Pagina spostata in ${title(store.get(t.dataset.drop))}`);
  });
}
async function onTreeClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const id = b.dataset.id;
  switch (b.dataset.a) {
    case 'pick-sec': closeOverlay(); app.go({ view: 'notes', section: id, page: app.desk ? app.R.page : null }); if (app.desk) app.go({ page: null }); break;
    case 'toggle-grp': collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); saveCollapsed(); refreshTree(); break;
    case 'new-sec': closeOverlay(); newSection(); break;
    case 'new-grp': closeOverlay(); newGroup(); break;
    case 'sec-menu': sectionMenu(id); break;
    case 'grp-menu': groupMenu(id); break;
    case 'tags': {
      const t = await choose('Etichette', allTags().map(([k, n]) => ({ label: '#' + k, hint: `${n} elementi`, value: k, icon: 'tag' })), { text: 'Scrivi #parola nel testo di una pagina o di un\'attività per etichettarla.' });
      if (t) { closeOverlay(); app.go({ view: 'notes', section: 'tag:' + t, page: null }); }
      break;
    }
  }
}
function refreshTree() {
  const d = $('.drawer');
  if (d) { d.innerHTML = treeHTML(); }
  else app.render();
}
export function openDrawer() {
  const d = drawer(treeHTML());
  d.addEventListener('click', onTreeClick);
}

function colorPicker(cur) {
  return `<label class="flab">Colore</label><div class="colors" role="radiogroup">${COLORS.map(c => `<button type="button" data-color="${c}" style="background:var(--s${c})" role="radio" aria-checked="${c === cur}" aria-label="Colore ${c}"></button>`).join('')}</div>`;
}
function bindColors(el, st) {
  el.addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (!b) return; st.color = +b.dataset.color; $$('[data-color]', el).forEach(x => x.setAttribute('aria-checked', String(x === b))); });
}
export async function newSection(groupId = null) {
  if (!store.canWrite()) return;
  const st = { color: 1 + Math.floor(Math.random() * 6) };
  const groups = store.all('group').sort(store.bySort);
  const extra = colorPicker(st.color) + (groups.length ? `<label class="flab">Gruppo</label><select class="sel" name="grp" style="width:100%"><option value="">Nessun gruppo</option>${groups.map(g => `<option value="${g.id}" ${g.id === groupId ? 'selected' : ''}>${esc(title(g))}</option>`).join('')}</select>` : '');
  const p = promptDialog('Nuova sezione', { label: 'Nome', placeholder: 'Es. Ricette', ok: 'Crea', extra });
  setTimeout(() => { const el = $('.sheet'); if (el) bindColors(el, st); }, 0);
  const r = await p;
  if (!r || !r.value) return;
  const sel = r.el.querySelector('[name=grp]');
  const gid = sel ? sel.value || null : groupId;
  const id = store.create('section', gid, { title: r.value, color: st.color });
  if (gid) collapsed.delete(gid);
  app.go({ view: 'notes', section: id, page: null });
}
export async function newGroup() {
  if (!store.canWrite()) return;
  const r = await promptDialog('Nuovo gruppo di sezioni', { label: 'Nome', placeholder: 'Es. Casa', ok: 'Crea' });
  if (!r || !r.value) return;
  store.create('group', null, { title: r.value });
  toast('Gruppo creato: aggiungi una sezione dal suo menu ⋯');
}
async function sectionMenu(id) {
  const s = store.get(id);
  if (!s) return;
  const a = await choose(title(s), [
    { label: 'Rinomina e colore', value: 'rename', icon: 'pen' },
    { label: 'Sposta in un gruppo', value: 'move', icon: 'move' },
    { label: 'Sposta su', value: 'up', icon: 'up' },
    { label: 'Sposta giù', value: 'down', icon: 'down' },
    { label: 'Elimina sezione', value: 'del', icon: 'trash', danger: true, disabled: !!s.d.inbox && store.all('section').length === 1 },
  ]);
  if (!a || !store.canWrite()) return;
  if (a === 'rename') {
    const st = { color: s.d.color || 3 };
    const p = promptDialog('Modifica sezione', { label: 'Nome', value: title(s), extra: colorPicker(st.color) });
    setTimeout(() => { const el = $('.sheet'); if (el) bindColors(el, st); }, 0);
    const r = await p;
    if (r && r.value) store.update(id, d => { d.title = r.value; d.color = st.color; });
  } else if (a === 'move') {
    const g = await choose('Sposta in', [{ label: 'Nessun gruppo', value: '-' }, ...store.all('group').sort(store.bySort).map(x => ({ label: title(x), value: x.id, icon: 'folder' }))], { current: s.parent_id || '-' });
    if (g) store.batch([{ id, parent_id: g === '-' ? null : g, sort: store.nextSort(g === '-' ? null : g, 'section') }]);
  } else if (a === 'up' || a === 'down') {
    moveSibling(s, a === 'up' ? -1 : 1, s.parent_id && store.alive(store.get(s.parent_id)) ? store.children(s.parent_id, 'section') : ungrouped());
  } else if (a === 'del') {
    const n = countPages(id);
    if (await confirmDialog(`Eliminare «${esc(title(s))}»?`, `La sezione e le sue ${n} pagine vanno nel cestino per 30 giorni.`, { ok: 'Sposta nel cestino', danger: true })) {
      await store.trash(id);
      if (app.R.section === id) app.go({ section: null, page: null });
      toast('Sezione nel cestino', 'Annulla', () => store.restore(id));
    }
  }
}
async function groupMenu(id) {
  const g = store.get(id);
  const a = await choose(title(g), [
    { label: 'Nuova sezione nel gruppo', value: 'sec', icon: 'plus' },
    { label: 'Rinomina', value: 'rename', icon: 'pen' },
    { label: 'Sposta su', value: 'up', icon: 'up' },
    { label: 'Sposta giù', value: 'down', icon: 'down' },
    { label: 'Elimina gruppo', value: 'del', icon: 'trash', danger: true },
  ]);
  if (!a || !store.canWrite()) return;
  if (a === 'sec') newSection(id);
  if (a === 'rename') { const r = await promptDialog('Rinomina gruppo', { label: 'Nome', value: title(g) }); if (r && r.value) store.update(id, d => { d.title = r.value; }); }
  if (a === 'up' || a === 'down') moveSibling(g, a === 'up' ? -1 : 1, store.all('group').sort(store.bySort));
  if (a === 'del') {
    const secs = store.children(id, 'section');
    const keep = secs.length ? await choose('Elimina gruppo', [{ label: 'Tieni le sezioni (fuori dai gruppi)', value: 'keep' }, { label: 'Metti anche le sezioni nel cestino', value: 'all', danger: true }]) : 'all';
    if (!keep) return;
    if (keep === 'keep') await store.batch(secs.map((s, i) => ({ id: s.id, parent_id: null, sort: store.nextSort(null, 'section') + i * 1000 })));
    await store.trash(id);
    toast('Gruppo nel cestino', 'Annulla', () => store.restore(id));
  }
}
function moveSibling(it, dir, list) {
  const i = list.findIndex(x => x.id === it.id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  const other = list[j];
  store.batch([{ id: it.id, sort: other.sort }, { id: other.id, sort: it.sort }]);
}

// ---------- elenco delle pagine ----------
export function trashItems() {
  const out = [];
  for (const it of S.items.values()) {
    if (!it.deleted_at || it.purged || !it.d || !['page', 'section', 'group', 'task', 'list'].includes(it.kind)) continue;
    const p = it.parent_id && store.get(it.parent_id);
    if (p && p.deleted_at) continue;
    out.push(it);
  }
  return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

function pageRow(p, depth, opts = {}) {
  const md = p.d.md || '';
  const thumbId = firstDrawing(md) || firstImage(md);
  const thumbType = firstDrawing(md) ? 'drawing' : 'img';
  const tags = tagsIn(md).slice(0, 3);
  const sel = app.desk && p.id === app.R.page;
  return `<div class="page-row ${sel ? 'sel' : ''}" data-a="open" data-id="${p.id}" style="${depth ? `padding-left:${16 + depth * 22}px` : ''}" ${opts.drag ? 'draggable="true"' : ''} tabindex="0">
    <div class="pg"><div class="pt">${depth ? ic('sub', 'sm') : ''}${p.d.mail ? ic('mail', 'sm') : ''}${esc(title(p))}${p.d.fav ? `<span style="color:var(--due)">${ic('star', 'sm')}</span>` : ''}</div>
      ${opts.path ? `<div class="path">${esc(pathOf(p))}</div>` : ''}
      <div class="ps">${esc(mdText(md).slice(0, 160)) || '<i>Pagina vuota</i>'}</div>
      ${tags.length ? `<div class="chips">${tags.map(t => `<span class="chip tag">#${esc(t)}</span>`).join('')}</div>` : ''}</div>
    ${thumbId ? `<img class="thumb" data-thumb="${thumbType}/${thumbId}" alt="">` : ''}
    <div class="pd">${esc(fmtShort(p.updated_at))}</div></div>`;
}
async function loadThumbs(el) {
  for (const img of $$('img[data-thumb]', el)) {
    const [type, id] = img.dataset.thumb.split('/');
    try {
      img.src = type === 'drawing' ? await drawingToBlobURL(await store.getDrawing(id), { maxW: 120, scale: 1 }) : (await store.blobURL(id)).url;
    } catch (e) { img.remove(); }
  }
}

let dragId = null;
export function renderList(el) {
  const cur = currentSection();
  const st = store.settings();
  let head = '', body = '', bar = '', color = 'var(--line)', tabs = '';
  if (cur === 'v:fav' || cur === 'v:recent' || String(cur).startsWith('tag:')) {
    let pages;
    let name;
    if (cur === 'v:fav') { name = 'Preferiti'; pages = store.all('page').filter(p => p.d.fav).sort((a, b) => title(a).localeCompare(title(b), 'it')); }
    else if (cur === 'v:recent') { name = 'Recenti'; pages = (st.recents || []).map(id => store.get(id)).filter(p => p && store.alive(p) && p.kind === 'page'); }
    else { const t = cur.slice(4); name = '#' + t; pages = store.all('page').filter(p => tagsIn(p.d.md).includes(t)); }
    head = `<div class="head" style="padding-top:12px"><div class="grow"><div class="crumb">Taccuino ›</div><h2 class="big">${esc(name)}</h2><div class="meta">${pages.length} ${pages.length === 1 ? 'pagina' : 'pagine'}</div></div></div>`;
    body = pages.length ? pages.map(p => pageRow(p, 0, { path: true })).join('') : `<div class="empty"><b>Niente qui</b>${cur === 'v:fav' ? 'Tocca la stella in una pagina per aggiungerla ai preferiti.' : cur === 'v:recent' ? 'Le pagine che apri compaiono qui.' : ''}</div>`;
    if (String(cur).startsWith('tag:')) {
      const t = cur.slice(4);
      const ts = store.all('task').filter(x => tagsIn((x.d.title || '') + ' ' + (x.d.notes || '')).includes(t));
      if (ts.length) body += `<div class="rhead">Attività</div>` + ts.map(x => `<div class="page-row" data-a="open-task" data-id="${x.id}"><div class="pg"><div class="pt">${ic('tasks', 'sm')}${esc(title(x))}</div></div></div>`).join('');
    }
  } else if (cur === 'v:trash') {
    const items = trashItems();
    head = `<div class="head" style="padding-top:12px"><div class="grow"><div class="crumb">Taccuino e attività ›</div><h2 class="big">Cestino</h2><div class="meta">Gli elementi vengono eliminati per sempre dopo 30 giorni.</div></div>
      ${items.length ? '<button class="btn ghost small needs-net" data-a="empty-trash">Svuota</button>' : ''}</div>`;
    const kindName = { page: 'Pagina', section: 'Sezione', group: 'Gruppo', task: 'Attività', list: 'Lista' };
    body = items.length ? items.map(it => {
      const left = Math.max(0, 30 - Math.floor((Date.now() - new Date(it.deleted_at)) / 864e5));
      return `<div class="page-row" style="cursor:default"><div class="pg"><div class="pt">${esc(title(it))}</div><div class="path">${kindName[it.kind]} · eliminata ${esc(fmtWhen(it.deleted_at))} · ancora ${left} giorni</div></div>
        <button class="btn ghost small needs-net" data-a="restore" data-id="${it.id}">${ic('restore', 'sm')}Ripristina</button>
        <button class="ib needs-net" data-a="purge" data-id="${it.id}" aria-label="Elimina per sempre">${ic('trash')}</button></div>`;
    }).join('') : '<div class="empty"><b>Il cestino è vuoto</b></div>';
  } else {
    const s = cur && store.get(cur);
    if (!s) {
      head = '';
      body = `<div class="empty"><b>Nessuna sezione</b>Crea una sezione per iniziare a scrivere.<br><br><button class="btn primary needs-net" data-a="new-sec">${ic('plus')}Nuova sezione</button></div>`;
    } else {
      const g = groupOf(s);
      color = secColor(s);
      const mode = (st.sortPages || {})[s.id] || 'manual';
      const rows = pagesTree(s.id, mode);
      head = `<div class="head" style="padding-top:12px"><div class="grow">
        <div class="crumb">${g ? esc(title(g)) + ' ›' : 'Senza gruppo ›'}</div>
        <h2 class="big">${esc(title(s))}</h2>
        <div class="meta">${rows.length} ${rows.length === 1 ? 'pagina' : 'pagine'}${s.d.inbox ? ' · qui arrivano le email' : ''}</div></div>
        <button class="btn primary small needs-net" data-only="desk" data-a="new-page">${ic('plus', 'sm')}Pagina</button>
        <button class="ib needs-net" data-a="sec-menu" data-id="${s.id}" aria-label="Azioni sezione">${ic('more')}</button></div>`;
      bar = `<div class="sortbar">Ordina: <div class="seg" role="group" aria-label="Ordine delle pagine">${[['manual', 'Manuale'], ['date', 'Data'], ['title', 'Titolo']].map(([k, l]) => `<button data-a="sort" data-mode="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div></div>`;
      body = rows.length ? rows.map(r => pageRow(r.it, r.depth, { drag: mode === 'manual' && !S.offline })).join('') : `<div class="empty"><b>Sezione vuota</b>Tocca «Pagina» per scrivere la prima nota.</div>`;
      // Su telefono: schede delle sezioni dello stesso gruppo (punto 36).
      const sibs = g ? store.children(g.id, 'section') : ungrouped();
      if (sibs.length > 1) tabs = `<div class="tabs" data-only="phone" role="tablist">${sibs.map(x => `<button class="tab" role="tab" data-a="pick-sec" data-id="${x.id}" aria-selected="${x.id === s.id}"><span class="tab-color" style="background:${secColor(x)}"></span>${esc(title(x))}</button>`).join('')}</div>`;
    }
  }
  el.innerHTML = `
    <div class="topbar" data-only="phone">
      <button class="ib" data-a="drawer" aria-label="Apri gruppi e sezioni">${ic('menu')}</button>
      <div class="grow"><div class="apptitle">Taccuino</div></div>
      <button class="ib" data-a="search" aria-label="Cerca">${ic('search')}</button>
      <button class="ib" data-a="lock" aria-label="Blocca">${ic('lock')}</button>
    </div>
    ${tabs}
    <div class="secbar" style="background:${color}"></div>
    ${inboxBanner()}
    <div class="scroll">${head}${bar}${body}<div style="height:90px"></div></div>
    ${cur && !String(cur).includes(':') && store.get(cur) ? `<button class="fab needs-net" data-only="phone" data-a="new-page">${ic('plus')}Pagina</button>` : ''}`;
  loadThumbs(el);
  if (!el._bound) bindList(el);
  const sel = $('.page-row.sel', el);
  if (sel && el._lastSel !== app.R.page) { sel.scrollIntoView({ block: 'nearest' }); el._lastSel = app.R.page; }
}
function inboxBanner() {
  if (S.recovery === 'pending' || S.recovery === 'ready') return `<div class="banner"><div class="grow">${S.recovery === 'ready' ? 'Recupero via email pronto.' : 'È in corso un recupero dell\'accesso via email. Se non l\'hai chiesto tu, annullalo.'}</div><button class="btn small ghost" data-a="er-cancel">Annulla recupero</button></div>`;
  return '';
}

function bindList(el) {
  el._bound = true;
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.a) {
      case 'open': app.go({ view: 'notes', page: id, from: null }); break;
      case 'open-task': app.go({ view: 'tasks', task: id }); break;
      case 'drawer': openDrawer(); break;
      case 'search': app.go({ view: 'search' }); break;
      case 'lock': app.lock(); break;
      case 'pick-sec': app.go({ section: id, page: null }); break;
      case 'new-page': newPage(); break;
      case 'new-sec': newSection(); break;
      case 'sec-menu': sectionMenu(id); break;
      case 'sort': if (!store.canWrite()) return; store.update('settings', d => { d.sortPages = d.sortPages || {}; d.sortPages[app.R.section] = b.dataset.mode; }); break;
      case 'restore': await store.restore(id); toast('Ripristinato.'); break;
      case 'purge': if (await confirmDialog('Eliminare per sempre?', 'Non si potrà più recuperare.', { ok: 'Elimina', danger: true })) store.purge(id); break;
      case 'empty-trash':
        if (await confirmDialog('Svuotare il cestino?', 'Tutti gli elementi del cestino saranno eliminati per sempre.', { ok: 'Svuota', danger: true })) for (const it of trashItems()) await store.purge(it.id);
        break;
      case 'er-cancel': await api('POST', 'recover/email/cancel', {}); S.recovery = 'on'; toast('Recupero annullato.'); app.render(); break;
    }
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.page-row')) e.target.click(); });
  // Riordino e sottopagine con il trascinamento (PC).
  el.addEventListener('dragstart', e => { const r = e.target.closest('.page-row[draggable]'); if (!r) return; dragId = r.dataset.id; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', title(store.get(dragId))); });
  el.addEventListener('dragend', () => { dragId = null; $$('.dragging,.drop-before,.drop-into', el).forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-into')); });
  el.addEventListener('dragover', e => {
    const r = e.target.closest('.page-row[draggable]');
    if (!r || !dragId || r.dataset.id === dragId) return;
    e.preventDefault();
    const rect = r.getBoundingClientRect();
    const into = e.clientX - rect.left > 120 && e.clientY - rect.top > rect.height * 0.35;
    $$('.drop-before,.drop-into', el).forEach(x => x.classList.remove('drop-before', 'drop-into'));
    r.classList.add(into ? 'drop-into' : 'drop-before');
  });
  el.addEventListener('drop', e => {
    const r = e.target.closest('.page-row[draggable]');
    if (!r || !dragId) return;
    e.preventDefault();
    const target = store.get(r.dataset.id);
    const id = dragId; dragId = null;
    if (!store.canWrite() || id === target.id || store.descendants(id).some(x => x.id === target.id)) return;
    if (r.classList.contains('drop-into')) {
      store.batch([{ id, parent_id: target.id, sort: store.nextSort(target.id, 'page') }]);
    } else {
      const sibs = store.children(target.parent_id, 'page');
      const i = sibs.findIndex(x => x.id === target.id);
      const prev = sibs[i - 1];
      const sort = prev && prev.id !== id ? (prev.sort + target.sort) / 2 : target.sort - 1000;
      store.batch([{ id, parent_id: target.parent_id, sort }]);
    }
  });
}

export async function newPage(parentPage = null) {
  if (!store.canWrite()) return;
  let sid = parentPage ? null : currentSection();
  if (!parentPage && (!sid || String(sid).includes(':'))) {
    const s = ungrouped()[0] || store.all('section')[0];
    if (!s) { newSection(); return; }
    sid = s.id;
  }
  const parent = parentPage || sid;
  const id = store.create('page', parent, { title: '', md: '' });
  app.go({ view: 'notes', section: parentPage ? app.R.section : sid, page: id, from: null });
  setTimeout(() => { const t = $('#pTitle'); if (t && (document.activeElement === document.body || !document.activeElement)) t.focus(); }, 60);
}

// ---------- pagina ----------
let P = null; // { id, el, editor, mode }
const saveTitle = debounce((id, v) => { const it = store.get(id); if (it && it.d && it.d.title !== v) store.update(id, d => { d.title = v; }); }, 600);

export function flush() {
  saveTitle.flush && P && P.titleDirty && saveTitle.flush(P.id, $('#pTitle') ? $('#pTitle').value : '');
  if (P && P.editor) P.editor.flush();
}

function addRecent(id) {
  const st = store.settings();
  const rec = [id, ...(st.recents || []).filter(x => x !== id)].slice(0, 20);
  if (JSON.stringify(rec) === JSON.stringify(st.recents || []) || S.offline) return;
  const it = store.get('settings');
  if (it && it.d) { it.d.recents = rec; recentSave(); }
}
const recentSave = debounce(() => { const it = store.get('settings'); if (it && it.d && !S.offline) store.save('settings', { d: it.d }, { quiet: true }).catch(() => {}); }, 4000);

export function renderPage(el, id) {
  if (!el) {
    if (P) { flush(); P = null; }
    return;
  }
  const p = store.get(id);
  if (!p || !p.d) return;
  if (P && P.id === id && P.el === el && el.isConnected && P.rev !== undefined) {
    // Aggiorna solo l'intestazione; il testo viene ricaricato se è cambiato altrove e non stai scrivendo.
    updatePageHead(p);
    const editing = el.contains(document.activeElement);
    if (!editing && P.editor && p.d.md !== P.editor.md && !P.editor.changed._pending) { P.editor.setMd(p.d.md || ''); }
    if (!editing && $('#pTitle', el) && $('#pTitle', el).value !== (p.d.title || '')) { $('#pTitle', el).value = p.d.title || ''; autosize($('#pTitle', el)); }
    P.editor && P.editor.setReadonly(S.offline);
    return;
  }
  if (P) flush();
  const s = sectionOf(p);
  const ro = S.offline;
  const desk = app.desk;
  el.innerHTML = `
    <div class="topbar">
      <button class="ib" data-a="back" data-only="phone" aria-label="Indietro">${ic('back')}</button>
      ${app.R.from === 'search' ? `<button class="btn ghost small" data-only="desk" data-a="to-search" style="margin-left:8px">${ic('back', 'sm')}Risultati</button>` : ''}
      <div class="grow" style="display:flex;align-items:center;gap:8px;padding-left:${desk ? '16px' : '0'}"><span class="dot" style="background:${secColor(s)}"></span><span class="crumb" id="pCrumb"></span></div>
      <button class="ib needs-net" data-a="fav" aria-label="Preferito" id="pFav">${ic('star')}</button>
      <button class="ib" data-a="menu" aria-label="Altre azioni">${ic('more')}</button>
    </div>
    ${desk ? toolbarHTML(false, 'top needs-net') : ''}
    <div class="scroll" id="pScroll">
      <div class="form">
        ${ro ? '<div class="ro-note">Offline: sola lettura.</div>' : ''}
        <textarea id="pTitle" class="title-in" rows="1" placeholder="Titolo pagina" aria-label="Titolo pagina" ${ro ? 'readonly' : ''}>${esc(p.d.title || '')}</textarea>
        <div class="pmeta"><span id="pDate"></span>
          <div class="seg" role="group" aria-label="Modalità"><button data-a="mode" data-mode="vis" aria-pressed="true">Visuale</button><button data-a="mode" data-mode="md" aria-pressed="false">Markdown</button></div>
        </div>
        <div id="pMail"></div>
        <div id="pEditor"></div>
        <div id="pMdWrap" hidden><p class="ok" style="margin:0 0 8px">Questo è il testo esattamente come viene salvato (poi cifrato). Puoi modificarlo anche qui.</p><textarea class="mdview" id="pMd" spellcheck="false" ${ro ? 'readonly' : ''}></textarea></div>
      </div>
    </div>
    ${desk ? '' : toolbarHTML(false, 'needs-net')}`;
  const ed = new Editor($('#pEditor', el), {
    md: p.d.md || '', readonly: ro, ownerId: id, placeholder: 'Scrivi qui… (# titolo, - elenco, [] casella)',
    onChange: md => { if (store.canWrite()) store.update(id, d => { d.md = md; }); },
    onDraw: drawId => drawFor(id, drawId),
    onToTask: text => taskFromCheckbox(id, text),
    onOpenRef: openRef,
  });
  P = { id, el, editor: ed, mode: 'vis', rev: p.rev };
  $$('.etools', el).forEach(t => ed.bindToolbar(t));
  const ti = $('#pTitle', el);
  autosize(ti);
  ti.addEventListener('input', () => { autosize(ti); P.titleDirty = true; if (!S.offline) saveTitle(id, ti.value); });
  ti.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ed.focusEnd(); } });
  const mdTa = $('#pMd', el);
  mdTa.addEventListener('input', debounce(() => { if (store.canWrite()) store.update(id, d => { d.md = mdTa.value; }); }, 700));
  el.onclick = async e => {
    const b = e.target.closest('[data-a]');
    if (!b || b.closest('#pEditor')) return;
    switch (b.dataset.a) {
      case 'back': history.length > 1 && history.state && history.state.znk ? history.back() : app.go({ page: null }); break;
      case 'to-search': app.go({ view: 'search', page: null, from: null }); break;
      case 'fav': if (store.canWrite()) store.update(id, d => { d.fav = !d.fav; }); break;
      case 'menu': pageMenu(id); break;
      case 'mode': {
        const m = b.dataset.mode;
        flush();
        P.mode = m;
        $$('[data-a=mode]', el).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === m)));
        $('#pEditor', el).hidden = m === 'md';
        $('#pMdWrap', el).hidden = m !== 'md';
        $$('.etools', el).forEach(t => { t.hidden = m === 'md'; });
        if (m === 'md') { mdTa.value = store.get(id).d.md || ''; autosize(mdTa); }
        else ed.setMd(store.get(id).d.md || '');
        break;
      }
      case 'att': openRef('att/' + b.dataset.id); break;
    }
  };
  updatePageHead(p);
  addRecent(id);
}

function updatePageHead(p) {
  if (!P) return;
  const el = P.el;
  const s = sectionOf(p);
  const crumb = $('#pCrumb', el);
  if (crumb) crumb.textContent = pathOf(p) || (s ? title(s) : '');
  const fav = $('#pFav', el);
  if (fav) { fav.classList.toggle('on', !!p.d.fav); fav.style.color = p.d.fav ? 'var(--due)' : ''; fav.innerHTML = ic('star', p.d.fav ? 'fill' : ''); if (p.d.fav) fav.querySelector('svg').style.fill = 'currentColor'; }
  const dt = $('#pDate', el);
  if (dt) dt.textContent = 'Modificata ' + fmtWhen(p.updated_at) + (tagsIn(p.d.md).length ? ' · ' + tagsIn(p.d.md).map(t => '#' + t).join(' ') : '');
  const mail = $('#pMail', el);
  if (mail) mail.innerHTML = p.d.mail ? mailCard(p.d.mail) : '';
}

export function mailCard(m) {
  const atts = (m.attachments || []);
  return `<div class="mailcard">${ic('mail')}<div><b>Arrivata via email</b> da ${esc(m.from_name ? m.from_name + ' <' + m.from + '>' : m.from)} · ${esc(fmtWhen(m.at))}<br>
    <span class="muted">L'email ha viaggiato in chiaro fino al sito, poi è stata cifrata e cancellata dalla casella.</span>
    ${atts.length ? `<div class="atts">${atts.map(a => a.id ? `<button class="chip" data-a="att" data-id="${a.id}">${ic('download')}${esc(a.name)} · ${fmtSize(a.size)}</button>` : `<span class="chip" title="Non importato (tipo o dimensione)">${esc(a.name)} · ${fmtSize(a.size)} · non importato</span>`).join('')}</div>` : ''}</div></div>`;
}

export async function drawFor(ownerId, drawId) {
  if (!store.canWrite()) return null;
  let data = emptyDrawing();
  if (drawId) { try { data = await store.getDrawing(drawId); } catch (e) { toast('Disegno non disponibile.'); return null; } }
  const owner = store.get(ownerId);
  const out = await openDrawEditor({ data, title: owner && owner.d ? title(owner) : '' });
  if (!out) return null;
  const id = drawId || uuid();
  await store.saveDrawing(id, ownerId, out);
  return id;
}

async function taskFromCheckbox(pageId, text) {
  if (!store.canWrite()) return null;
  const lists = store.all('list').sort(store.bySort);
  if (!lists.length) { toast('Crea prima una lista di attività.'); return null; }
  const st = store.settings();
  const def = lists.find(l => l.id === st.lastList) || lists[0];
  const lid = lists.length === 1 ? def.id : await choose('In quale lista?', lists.map(l => ({ label: title(l), value: l.id, icon: 'list' })), { current: def.id });
  if (!lid) return null;
  const id = store.create('task', lid, { title: text, notes: '', page: pageId }, { first: true });
  toast(`Attività creata in «${title(store.get(lid))}»`, 'Apri', () => app.go({ view: 'tasks', list: lid, task: id }));
  return id;
}

export async function openRef(ref) {
  const [type, id] = ref.split('/');
  if (type === 'task') {
    const t = store.get(id);
    if (!t || !store.alive(t)) { toast('Attività eliminata.'); return; }
    let l = store.get(t.parent_id); if (l && l.kind === 'task') l = store.get(l.parent_id);
    app.go({ view: 'tasks', list: l ? l.id : app.R.list, task: id });
  } else if (type === 'page') {
    app.go({ view: 'notes', page: id });
  } else if (type === 'img' || type === 'att') {
    try {
      const b = await store.blobURL(id);
      if (type === 'img') {
        sheet(`<h3>${esc(b.meta.name || 'Immagine')}</h3><img src="${b.url}" alt="" style="max-width:100%;border-radius:12px;display:block;margin:0 auto">
          <div class="row-end"><button class="btn ghost" data-dl>${ic('download', 'sm')}Scarica</button><button class="btn primary" data-close>Chiudi</button></div>`, { wide: true })
          .querySelector('[data-dl]').addEventListener('click', () => { const a = document.createElement('a'); a.href = b.url; a.download = b.meta.name || 'immagine'; a.click(); });
      } else if (b.meta.type === 'application/pdf' || b.meta.type.startsWith('image/')) {
        window.open(b.url, '_blank', 'noopener');
      } else {
        const a = document.createElement('a'); a.href = b.url; a.download = b.meta.name || 'allegato'; a.click();
      }
    } catch (e) { toast('Contenuto non disponibile' + (S.offline ? ' offline.' : '.')); }
  }
}

async function pageMenu(id) {
  const p = store.get(id);
  const isSub = store.get(p.parent_id) && store.get(p.parent_id).kind === 'page';
  const a = await choose(title(p), [
    { label: p.d.fav ? 'Togli dai preferiti' : 'Aggiungi ai preferiti', value: 'fav', icon: 'star' },
    { label: 'Nuova sottopagina', value: 'sub', icon: 'plus' },
    { label: 'Sposta in un\'altra sezione', value: 'move', icon: 'move' },
    { label: isSub ? 'Porta al primo livello' : 'Rendi sottopagina di…', value: 'nest', icon: 'sub' },
    { label: 'Sposta su', value: 'up', icon: 'up' },
    { label: 'Sposta giù', value: 'down', icon: 'down' },
    { label: 'Cronologia delle versioni', value: 'hist', icon: 'history' },
    { label: 'Scarica come Markdown (.md)', value: 'md', icon: 'md' },
    { label: 'Stampa', value: 'print', icon: 'print' },
    { label: 'Sposta nel cestino', value: 'del', icon: 'trash', danger: true },
  ]);
  if (!a) return;
  if (a === 'md') { flush(); download(fileName(title(p)) + '.md', `# ${title(p)}\n\n${store.get(id).d.md || ''}`, 'text/markdown'); return; }
  if (a === 'print') { flush(); printPage(p); return; }
  if (a === 'hist') { flush(); history_(id); return; }
  if (!store.canWrite()) return;
  if (a === 'fav') store.update(id, d => { d.fav = !d.fav; });
  if (a === 'sub') newPage(id);
  if (a === 'move') {
    const opts = [];
    for (const s of ungrouped()) opts.push({ label: title(s), value: s.id, html: `<span class="tab-color" style="width:6px;height:22px;border-radius:3px;background:${secColor(s)}"></span><span>${esc(title(s))}</span>` });
    for (const g of store.all('group').sort(store.bySort)) for (const s of store.children(g.id, 'section')) opts.push({ label: title(s), value: s.id, html: `<span class="tab-color" style="width:6px;height:22px;border-radius:3px;background:${secColor(s)}"></span><span>${esc(title(s))}<small>${esc(title(g))}</small></span>` });
    const to = await choose('Sposta in', opts, { current: sectionOf(p) && sectionOf(p).id });
    if (to) { await store.batch([{ id, parent_id: to, sort: store.nextSort(to, 'page') }]); app.go({ section: to }); toast(`Spostata in «${title(store.get(to))}»`); }
  }
  if (a === 'nest') {
    if (isSub) { const s = sectionOf(p); store.batch([{ id, parent_id: s.id, sort: store.nextSort(s.id, 'page') }]); return; }
    const s = sectionOf(p);
    const banned = new Set([id, ...store.descendants(id).map(x => x.id)]);
    const cands = pagesTree(s.id, 'manual').filter(r => !banned.has(r.it.id));
    if (!cands.length) { toast('Nessun\'altra pagina in questa sezione.'); return; }
    const to = await choose('Sottopagina di', cands.map(r => ({ label: ' '.repeat(r.depth * 2) + title(r.it), value: r.it.id, icon: r.depth ? 'sub' : 'page' })));
    if (to) store.batch([{ id, parent_id: to, sort: store.nextSort(to, 'page') }]);
  }
  if (a === 'up' || a === 'down') moveSibling(p, a === 'up' ? -1 : 1, store.children(p.parent_id, 'page'));
  if (a === 'del') {
    const n = store.descendants(id).filter(x => x.kind === 'page').length;
    await store.trash(id);
    app.go({ page: null });
    toast(n ? `Pagina e ${n} sottopagine nel cestino` : 'Pagina nel cestino', 'Annulla', () => store.restore(id));
  }
}

export const fileName = s => String(s || 'senza-titolo').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'senza-titolo';

async function printPage(p) {
  const w = window.open('', '_blank');
  if (!w) { toast('Il browser ha bloccato la finestra di stampa.'); return; }
  const div = document.createElement('div');
  div.innerHTML = mdToHtml(p.d.md || '');
  await hydrate(div);
  // Le immagini cifrate vanno convertite in dati incorporati per la nuova finestra.
  for (const img of $$('img', div)) {
    try { const r = await fetch(img.src); const b = await r.blob(); img.src = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); } catch (e) { /* */ }
  }
  w.document.write(`<!doctype html><title>${esc(title(p))}</title><style>body{font:15px/1.6 system-ui;max-width:760px;margin:30px auto;padding:0 20px}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}li.task-item{list-style:none}li.task-item::before{content:"☐ "}li.task-item.done::before{content:"☑ "}</style><h1>${esc(title(p))}</h1>${div.innerHTML}`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
}

async function history_(id) {
  let vers;
  try { vers = await api('GET', `items/${encodeURIComponent(id)}/versions`); } catch (e) { toast(e.message); return; }
  if (!vers.length) { sheet(`<h3>Cronologia delle versioni</h3><p class="muted">Ancora nessuna versione precedente. Mentre scrivi, il sito conserva una copia ogni 10 minuti (fino a 50).</p><div class="row-end"><button class="btn primary" data-close>Ok</button></div>`); return; }
  const dec = [];
  for (const v of vers) { try { dec.push({ at: v.at, d: await S.space.decItem(id, v.data) }); } catch (e) { /* */ } }
  const el = sheet(`<h3>Cronologia delle versioni</h3><p class="muted">Scegli una versione per vederla; ripristinandola, il testo attuale diventa a sua volta una versione.</p>
    <div>${dec.map((v, i) => `<div class="ver"><div class="grow"><b>${esc(fmtWhen(v.at))}</b><div class="path">${esc(mdText(v.d.md).slice(0, 90))}</div></div><button class="btn ghost small" data-v="${i}">Vedi</button></div>`).join('')}</div>
    <div id="verPrev"></div>`, { wide: true });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-v]');
    if (b) {
      const v = dec[+b.dataset.v];
      $('#verPrev', el).innerHTML = `<div class="verprev editor">${mdToHtml(v.d.md || '')}</div><div class="row-end"><button class="btn primary needs-net" data-restore="${b.dataset.v}">Ripristina questa versione</button></div>`;
      hydrate($('#verPrev', el));
      $('#verPrev', el).scrollIntoView({ behavior: 'smooth' });
    }
    const r = e.target.closest('[data-restore]');
    if (r && store.canWrite()) {
      const v = dec[+r.dataset.restore];
      await store.update(id, d => { d.md = v.d.md; d.title = v.d.title; });
      closeOverlay();
      if (P && P.id === id) P.editor.setMd(v.d.md || '');
      const t = $('#pTitle'); if (t) { t.value = v.d.title || ''; autosize(t); }
      toast('Versione ripristinata.');
    }
  });
}
