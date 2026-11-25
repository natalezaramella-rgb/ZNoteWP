// Taccuino: un solo pannello ad albero (taccuino › sezione › gruppo › pagina › nota), PC e telefono.
import { ic } from './icons.js';
import { $, $$, esc, choose, confirmDialog, promptDialog, toast } from './ui.js';
import * as store from './store.js';
import { S } from './store.js';
import { app } from './ctx.js';
import { TK, title, notebooks, treeKids, levelOf, placement, isAnc, ancestors, nextSortIn } from './struct.js';
import { secColor, newPage, allTags, trashItems, colorPicker, bindColors, inboxBanner, cancelRecovery } from './notes.js';

export const LV = {
  notebook: { n: 'Taccuino', nn: 'Nuovo taccuino', ic: 'book' },
  section: { n: 'Sezione', nn: 'Nuova sezione', ic: 'section' },
  group: { n: 'Gruppo', nn: 'Nuovo gruppo', ic: 'folder' },
  page: { n: 'Pagina', nn: 'Nuova pagina', ic: 'page' },
  note: { n: 'Nota', nn: 'Nuova nota', ic: 'note' },
};
const KIDS = { notebook: ['section'], section: ['group', 'page'], group: ['page'], page: ['note'], note: [] };
const NAT = { notebook: 'section', section: 'page', group: 'page', page: 'note' };

// ---------- rami chiusi (per dispositivo) ----------
const collapsed = (() => { try { return new Set(JSON.parse(localStorage.getItem('znk-collapsed') || '[]')); } catch (e) { return new Set(); } })();
const saveCollapsed = () => { try { localStorage.setItem('znk-collapsed', JSON.stringify([...collapsed])); } catch (e) { /* */ } };
const isOpen = id => !collapsed.has(id);
function setOpen(id, v) { if (v) collapsed.delete(id); else collapsed.add(id); saveCollapsed(); }

const T = { q: '', el: null, renaming: null, renameNext: null, drag: null, lastSel: null, showQ: false };
const selId = () => app.R.page || app.R.node || null;
const colorOf = it => { const s = it && (it.kind === 'section' ? it : ancestors(it).find(x => x.kind === 'section')); return s ? secColor(s) : 'var(--muted)'; };
const pageCount = id => treeKids(id).reduce((n, k) => n + (k.kind === 'page' ? 1 : 0) + (k.kind === 'group' ? pageCount(k.id) : 0), 0);

// ---------- disegno ----------
function visible() {
  const q = T.q.trim().toLowerCase();
  const out = [];
  const match = it => title(it).toLowerCase().includes(q) || treeKids(it.id).some(match);
  const walk = (it, d) => {
    if (q && !match(it)) return;
    out.push([it, d]);
    if (d > 8) return;
    if (q || isOpen(it.id)) for (const k of treeKids(it.id)) walk(k, d + 1);
  };
  for (const nb of treeKids(null)) walk(nb, 0);
  return out;
}
function rowHTML(it, d) {
  const lv = levelOf(it), q = T.q.trim();
  let name = esc(title(it));
  if (q) { const i = title(it).toLowerCase().indexOf(q.toLowerCase()); if (i >= 0) { const t = title(it); name = esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)); } }
  const kids = treeKids(it.id).length;
  const cnt = lv === 'section' || lv === 'group' ? pageCount(it.id) : lv === 'notebook' ? treeKids(it.id).length : kids;
  const sel = selId() === it.id;
  const nat = NAT[lv] && lv !== 'note' ? NAT[lv] : null;
  const extra = (it.d.inbox ? ic('mail', 'sm mk') : '') + (it.d.mail ? ic('mail', 'sm mk') : '') + (it.d.fav ? `<span class="mk fav">${ic('star', 'sm')}</span>` : '');
  return `<div class="nt-row lv-${lv}" role="treeitem" tabindex="${sel ? 0 : -1}" data-id="${it.id}" aria-level="${d + 1}" ${kids ? `aria-expanded="${!!q || isOpen(it.id)}"` : ''} aria-selected="${sel}" style="--d:${d};--sc:${colorOf(it)}">
    <button type="button" class="tw ${kids ? '' : 'none'}" data-a="tw" tabindex="-1" aria-label="${isOpen(it.id) ? 'Comprimi' : 'Espandi'}">${ic('chev')}</button>
    <span class="nic" title="${LV[lv].n}">${ic(LV[lv].ic)}</span>
    <span class="nm">${name}</span>${extra}
    ${cnt ? `<span class="cnt">${cnt}</span>` : ''}
    ${nat ? `<button type="button" class="ra needs-net" data-only="desk" data-a="add" tabindex="-1" title="${LV[nat].nn}" aria-label="${LV[nat].nn}">${ic('plus', 'sm')}</button>` : ''}
    <button type="button" class="ra more" data-a="more" tabindex="-1" title="Azioni" aria-label="Azioni su ${esc(title(it))}">${ic('more', 'sm')}</button>
  </div>`;
}
function quickHTML() {
  const cur = app.R.section || '';
  const tags = allTags().length;
  const tn = trashItems().length;
  const q = (v, i, l, n) => `<button type="button" class="ntq" data-a="quick" data-v="${v}" aria-current="${cur === v || (v === 'tags' && String(cur).startsWith('tag:'))}">${ic(i, 'sm')}<span>${l}</span>${n ? `<small>${n}</small>` : ''}</button>`;
  return q('v:fav', 'star', 'Preferiti') + q('v:recent', 'clock', 'Recenti') + (tags ? q('tags', 'tag', 'Etichette', tags) : '') + q('v:trash', 'trash', 'Cestino', tn);
}
function rowsHTML() {
  const rows = visible();
  if (!rows.length) return `<div class="nt-empty">${T.q ? 'Nessun elemento con questo nome.' : 'Il taccuino è vuoto.'}</div>`;
  return rows.map(([it, d]) => rowHTML(it, d)).join('');
}

export function renderTree(el) {
  T.el = el;
  if (!el._nt) {
    el._nt = true;
    el.innerHTML = `
      <div class="nt-head">
        <h2 class="big">Taccuino</h2>
        <button class="ib nt-new needs-net" data-only="desk" data-a="new" title="Crea (Alt+N)" aria-label="Crea">${ic('plus')}</button>
        <button class="ib" data-only="phone" data-a="showq" aria-label="Filtra l'albero">${ic('search')}</button>
        <button class="ib" data-a="treemenu" aria-label="Altre azioni del taccuino" title="Espandi, comprimi, nuovo taccuino">${ic('more')}</button>
        <button class="ib" data-only="desk" data-fold="tree" aria-label="Nascondi il taccuino" title="Nascondi il taccuino (Ctrl+\\)">${ic('panel')}</button>
      </div>
      <label class="nt-q"><span>${ic('search', 'sm')}</span><input id="ntQ" type="search" placeholder="Filtra l'albero" autocomplete="off" aria-label="Filtra l'albero"></label>
      <div class="nt-banner"></div>
      <div class="nt-quick" role="group" aria-label="Viste"></div>
      <div class="nt-tree scroll" role="tree" aria-label="Taccuino"></div>
      <button class="fab needs-net" data-only="phone" data-a="new">${ic('plus')}Nuovo</button>`;
    bind(el);
  }
  el.classList.toggle('show-q', T.showQ || !!T.q);
  $('.nt-quick', el).innerHTML = quickHTML();
  $('.nt-banner', el).innerHTML = inboxBanner();
  if (T.renaming || (T.drag && T.drag.active)) return;
  // Una pagina aperta da fuori (ricerca, preferiti) apre i rami che la contengono.
  const sel = selId();
  if (sel && sel !== T.lastSel && store.get(sel)) { ancestors(store.get(sel)).forEach(a => collapsed.delete(a.id)); saveCollapsed(); }
  const tree = $('.nt-tree', el);
  const top = tree.scrollTop;
  tree.innerHTML = rowsHTML();
  tree.scrollTop = top;
  if (sel && sel !== T.lastSel) { const r = $(`.nt-row[data-id="${sel}"]`, tree); if (r) r.scrollIntoView({ block: 'nearest' }); }
  T.lastSel = sel;
  if (T.renameNext && store.get(T.renameNext)) { const id = T.renameNext; T.renameNext = null; setTimeout(() => rename(id), 0); }
}
const refresh = () => { if (T.el && T.el.isConnected) renderTree(T.el); };

// ---------- azioni ----------
function open(id) {
  const it = store.get(id);
  if (!it) return;
  const lv = levelOf(it);
  const special = String(app.R.section || '').includes(':');
  if (lv === 'page' || lv === 'note') { app.go({ view: 'notes', page: id, node: null, from: null, ...(special ? { section: null } : {}) }); return; }
  if (!app.desk) { setOpen(id, !isOpen(id)); app.go({ node: id, ...(special ? { section: null } : {}) }); return; }
  if (app.R.node === id && !app.R.page && treeKids(id).length) { setOpen(id, !isOpen(id)); refresh(); return; }
  app.go({ view: 'notes', node: id, page: null, ...(special ? { section: null } : {}) });
}
export async function create(lv, parentId) {
  if (!store.canWrite()) return;
  if (lv === 'page' || lv === 'note') { if (parentId) setOpen(parentId, true); newPage(parentId); return; }
  const d = { title: LV[lv].nn };
  if (lv === 'section') d.color = 1 + (store.all('section').length % 6);
  if (lv === 'notebook' && !notebooks().length) d.main = true;
  const id = store.create(lv, parentId || null, d, { sort: nextSortIn(parentId || null) });
  if (parentId) setOpen(parentId, true);
  T.renameNext = id;
  app.go({ view: 'notes', node: id, page: null });
}
/** Dove creare con «Nuovo» (telefono) o con il + in alto (PC): nel punto in cui ti trovi. */
async function createMenu() {
  const cur = selId() && store.get(selId());
  const chain = cur ? [...ancestors(cur), cur] : [];
  const near = k => [...chain].reverse().find(x => levelOf(x) === k);
  const page = near('page'), cont = near('group') || near('section'), sec = near('section');
  const nb = near('notebook') || notebooks()[0];
  const short = s => { const t = title(s); return t.length > 22 ? t.slice(0, 21) + '…' : t; };
  const opts = [];
  if (page) opts.push({ label: 'Nuova nota', hint: `in «${short(page)}»`, value: ['note', page.id], icon: 'note' });
  if (cont) opts.push({ label: 'Nuova pagina', hint: `in «${short(cont)}»`, value: ['page', cont.id], icon: 'page' });
  if (sec) opts.push({ label: 'Nuovo gruppo', hint: `in «${short(sec)}»`, value: ['group', sec.id], icon: 'folder' });
  if (nb) opts.push({ label: 'Nuova sezione', hint: `in «${short(nb)}»`, value: ['section', nb.id], icon: 'section' });
  opts.push({ label: 'Nuovo taccuino', value: ['notebook', null], icon: 'book' });
  const r = await choose('Crea', opts);
  if (r) create(r[0], r[1]);
}
async function treeMenu() {
  const a = await choose('Taccuino', [
    { label: 'Espandi tutto', value: 'exp', icon: 'down' },
    { label: 'Comprimi tutto', value: 'col', icon: 'up' },
    { sep: true },
    { label: 'Nuovo taccuino', value: 'nb', icon: 'book', disabled: S.offline },
  ]);
  if (a === 'exp') { collapsed.clear(); saveCollapsed(); refresh(); }
  if (a === 'col') { for (const it of S.items.values()) if (TK.has(it.kind) && it.kind !== 'notebook' && store.alive(it)) collapsed.add(it.id); saveCollapsed(); refresh(); }
  if (a === 'nb') create('notebook', null);
}
export function rename(id) {
  const tree = T.el && $('.nt-tree', T.el);
  const row = tree && $(`.nt-row[data-id="${id}"]`, tree);
  const it = store.get(id);
  if (!row || !it) return;
  if (!store.canWrite()) return;
  const nm = $('.nm', row);
  const inp = document.createElement('input');
  inp.className = 'nt-ren'; inp.value = title(it) === 'Senza titolo' && !it.d.title ? '' : title(it); inp.setAttribute('aria-label', 'Nuovo nome');
  nm.replaceWith(inp);
  T.renaming = id;
  inp.focus(); inp.select();
  let done = false;
  const fin = ok => {
    if (done) return; done = true; T.renaming = null;
    const v = inp.value.trim();
    if (ok && v && v !== it.d.title) store.update(id, d => { d.title = v; }); else refresh();
    setTimeout(() => { const r = $(`.nt-row[data-id="${id}"]`, tree); if (r && app.desk) r.focus({ preventScroll: true }); }, 30);
  };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); fin(true); } if (e.key === 'Escape') fin(false); });
  inp.addEventListener('blur', () => fin(true));
  inp.addEventListener('pointerdown', e => e.stopPropagation());
  inp.addEventListener('click', e => e.stopPropagation());
}
function siblingsOf(it) { return it.kind === 'notebook' ? notebooks() : treeKids(it.parent_id); }
function nudge(id, dir) {
  if (!store.canWrite()) return;
  const it = store.get(id), list = siblingsOf(it), i = list.findIndex(x => x.id === id), j = i + dir;
  if (j < 0 || j >= list.length) return;
  const other = list[j];
  const a = it.sort, b = other.sort === a ? a + dir : other.sort;
  store.batch([{ id, sort: b }, { id: other.id, sort: a }]);
}
export function doMove(id, pl) {
  if (!pl || !store.canWrite()) return;
  const it = store.get(id);
  store.batch([{ id, parent_id: pl.parent, sort: pl.sort }]);
  if (pl.parent) setOpen(pl.parent, true);
  const where = pl.parent ? `in «${title(store.get(pl.parent))}»` : 'tra i taccuini';
  toast(pl.conv ? `«${title(it)}» ora è ${LV[pl.conv].n.toLowerCase()} ${where}` : `Spostata ${where}`);
}
export async function moveDialog(id) {
  const it = store.get(id);
  if (!it) return;
  const opts = [];
  const walk = (x, d) => {
    const lv = levelOf(x);
    if (lv === 'note' || x.id === id) return;
    const pl = placement(id, x.id, 'in');
    const here = it.parent_id === x.id;
    opts.push({ value: x.id, disabled: !pl || here, html: `<span class="nt-dest lv-${lv}" style="--d:${d};--sc:${colorOf(x)}"><span class="nic">${ic(LV[lv].ic, 'sm')}</span><span class="nm">${esc(title(x))}</span>${here ? '<small>qui ora</small>' : pl && pl.conv ? `<small>diventa ${LV[pl.conv].n.toLowerCase()}</small>` : ''}</span>` });
    for (const k of treeKids(x.id)) walk(k, d + 1);
  };
  for (const nb of notebooks()) walk(nb, 0);
  const to = await choose(`Sposta «${title(it)}» in`, opts);
  if (to) doMove(id, placement(id, to, 'in'));
}
async function remove(id) {
  const it = store.get(id);
  if (!it || !store.canWrite()) return;
  const lv = levelOf(it);
  const inside = store.descendants(id).filter(x => TK.has(x.kind) && !x.deleted_at);
  if (lv === 'notebook' && notebooks().length < 2) { toast('Serve almeno un taccuino: creane un altro prima di eliminare questo.'); return; }
  if (['notebook', 'section', 'group'].includes(lv) && inside.length) {
    const pages = inside.filter(x => x.kind === 'page').length;
    if (!(await confirmDialog(`Eliminare «${esc(title(it))}»?`, `${LV[lv].n} e tutto quello che contiene (${pages} ${pages === 1 ? 'pagina' : 'pagine'}) vanno nel cestino per 30 giorni.`, { ok: 'Sposta nel cestino', danger: true }))) return;
  }
  await store.trash(id);
  if (app.R.page && (app.R.page === id || isAnc(id, app.R.page))) app.go({ page: null });
  else if (app.R.node && (app.R.node === id || isAnc(id, app.R.node))) app.go({ node: null });
  const extra = lv === 'page' && inside.length ? ` con ${inside.length} ${inside.length === 1 ? 'nota' : 'note'}` : '';
  toast(`${LV[lv].n} nel cestino${extra}`, 'Annulla', () => store.restore(id));
}
export async function nodeMenu(id) {
  const it = store.get(id);
  if (!it) return;
  const lv = levelOf(it);
  const list = siblingsOf(it), i = list.findIndex(x => x.id === id);
  const ro = S.offline;
  const opts = [];
  for (const k of KIDS[lv]) opts.push({ label: LV[k].nn, value: 'new:' + k, icon: LV[k].ic, disabled: ro });
  if (opts.length) opts.push({ sep: true });
  if (lv === 'page' || lv === 'note') opts.push({ label: it.d.fav ? 'Togli dai preferiti' : 'Aggiungi ai preferiti', value: 'fav', icon: 'star', disabled: ro });
  opts.push({ label: lv === 'section' ? 'Rinomina e colore' : 'Rinomina', hint: app.desk ? 'F2' : '', value: 'ren', icon: 'pen', disabled: ro });
  if (lv !== 'notebook') opts.push({ label: 'Sposta in…', value: 'move', icon: 'move', disabled: ro });
  opts.push({ label: 'Sposta su', hint: app.desk ? 'Alt+↑' : '', value: 'up', icon: 'up', disabled: ro || i <= 0 });
  opts.push({ label: 'Sposta giù', hint: app.desk ? 'Alt+↓' : '', value: 'down', icon: 'down', disabled: ro || i >= list.length - 1 });
  if (lv === 'note') opts.push({ label: 'Trasforma in pagina', value: 'topage', icon: 'page', disabled: ro });
  opts.push({ sep: true });
  opts.push({ label: 'Elimina', hint: app.desk ? 'Canc' : '', value: 'del', icon: 'trash', danger: true, disabled: ro });
  const a = await choose(`${LV[lv].n} · ${title(it)}`, opts);
  if (!a || !store.canWrite()) return;
  if (a.startsWith('new:')) return create(a.slice(4), id);
  if (a === 'fav') return store.update(id, d => { d.fav = !d.fav; });
  if (a === 'ren') {
    if (lv === 'section') {
      const st = { color: +it.d.color || 3 };
      const p = promptDialog('Sezione', { label: 'Nome', value: title(it), extra: colorPicker(st.color) });
      setTimeout(() => { const el = $('.sheet'); if (el) bindColors(el, st); }, 0);
      const r = await p;
      if (r && r.value) store.update(id, d => { d.title = r.value; d.color = st.color; });
      return;
    }
    if (!app.desk && (lv === 'page' || lv === 'note') && app.R.page === id) { const t = $('#pTitle'); if (t) { t.focus(); t.select(); } return; }
    if (T.el && $(`.nt-row[data-id="${id}"]`, T.el)) return rename(id);
    const r = await promptDialog('Rinomina', { label: 'Nome', value: title(it) });
    if (r && r.value) store.update(id, d => { d.title = r.value; });
    return;
  }
  if (a === 'move') return moveDialog(id);
  if (a === 'up' || a === 'down') return nudge(id, a === 'up' ? -1 : 1);
  if (a === 'topage') { const c = ancestors(it).reverse().find(x => x.kind === 'group' || x.kind === 'section'); if (c) doMove(id, placement(id, c.id, 'in')); return; }
  if (a === 'del') return remove(id);
}

// ---------- eventi ----------
function bind(el) {
  el.addEventListener('click', async e => {
    if (T.justDragged) { e.preventDefault(); e.stopPropagation(); return; }
    const b = e.target.closest('[data-a]');
    const row = e.target.closest('.nt-row');
    const a = b && el.contains(b) ? b.dataset.a : null;
    if (a === 'tw') { const id = row.dataset.id; setOpen(id, !isOpen(id)); refresh(); return; }
    if (a === 'add') { const id = row.dataset.id; create(NAT[levelOf(store.get(id))], id); return; }
    if (a === 'more') { nodeMenu(row.dataset.id); return; }
    if (a === 'new') { createMenu(); return; }
    if (a === 'treemenu') { treeMenu(); return; }
    if (a === 'er-cancel') { cancelRecovery(); return; }
    if (a === 'showq') { T.showQ = !T.showQ; if (!T.showQ) { T.q = ''; $('#ntQ', el).value = ''; } refresh(); if (T.showQ) $('#ntQ', el).focus(); return; }
    if (a === 'quick') {
      const v = b.dataset.v;
      if (v === 'tags') {
        const t = await choose('Etichette', allTags().map(([k, n]) => ({ label: '#' + k, hint: `${n} elementi`, value: k, icon: 'tag' })), { text: 'Scrivi #parola nel testo di una pagina o di un\'attività per etichettarla.' });
        if (t) app.go({ view: 'notes', section: 'tag:' + t, page: null, node: null });
        return;
      }
      app.go({ view: 'notes', section: app.R.section === v && app.desk ? null : v, page: null, node: null });
      return;
    }
    if (row && !e.target.closest('input')) open(row.dataset.id);
  });
  el.addEventListener('dblclick', e => { const row = e.target.closest('.nt-row'); if (row && app.desk && !e.target.closest('[data-a]')) rename(row.dataset.id); });
  const q = $('#ntQ', el);
  q.addEventListener('input', () => { T.q = q.value; refresh(); });
  q.addEventListener('keydown', e => { if (e.key === 'Escape' && q.value) { e.stopPropagation(); q.value = ''; T.q = ''; refresh(); } });
  el.addEventListener('keydown', e => {
    const row = e.target.closest && e.target.closest('.nt-row');
    if (!row || e.target.tagName === 'INPUT') return;
    const id = row.dataset.id, it = store.get(id);
    const rows = $$('.nt-row', el);
    const go = r => { if (r) { r.focus(); r.scrollIntoView({ block: 'nearest' }); } };
    if (e.key === 'F2') { e.preventDefault(); rename(id); }
    else if (e.key === 'Delete') { e.preventDefault(); remove(id); }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); nudge(id, e.key === 'ArrowUp' ? -1 : 1); setTimeout(() => go($(`.nt-row[data-id="${id}"]`, el)), 80); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); go(rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)]); }
    else if (e.key === 'ArrowRight' && treeKids(id).length && !isOpen(id)) { e.preventDefault(); setOpen(id, true); refresh(); go($(`.nt-row[data-id="${id}"]`, el)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (treeKids(id).length && isOpen(id)) { setOpen(id, false); refresh(); go($(`.nt-row[data-id="${id}"]`, el)); } else if (it.parent_id) go($(`.nt-row[data-id="${it.parent_id}"]`, el)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id); }
  });
  bindDrag(el);
}

// ---------- trascinamento: mouse e dito (tieni premuto mezzo secondo) ----------
function bindDrag(el) {
  const tree = $('.nt-tree', el);
  const clear = () => $$('.drop-in,.drop-before,.drop-after', tree).forEach(r => r.classList.remove('drop-in', 'drop-before', 'drop-after'));
  const why = (id, tid) => {
    const it = store.get(id), t = store.get(tid);
    if (tid === id || isAnc(id, tid)) return 'non dentro se stessa';
    if (it.kind === 'page' && t.kind === 'page' && store.children(id, 'page').length) return 'una pagina con note non diventa nota';
    return `${LV[levelOf(it)].n.toLowerCase()} non va in ${LV[levelOf(t)].n.toLowerCase()}`;
  };
  const end = drop => {
    const st = T.drag;
    if (!st) return;
    clearTimeout(st.hold); clearTimeout(st.openT); cancelAnimationFrame(st.raf);
    T.drag = null;
    if (st.active) {
      const tg = st.target;
      clear();
      if (st.ghost) st.ghost.remove();
      document.body.classList.remove('nt-dragging');
      T.justDragged = true; setTimeout(() => { T.justDragged = false; }, 80);
      if (drop && tg && tg.pl) doMove(st.id, tg.pl);
      else if (drop && tg && !tg.pl) toast('Qui non può stare: ' + tg.why + '.');
      refresh();
    }
  };
  const update = (x, y) => {
    const st = T.drag;
    st.x = x; st.y = y;
    if (!st.active) return;
    st.ghost.style.left = x + 'px'; st.ghost.style.top = y + 'px';
    const hit = document.elementFromPoint(x, y);
    const row = hit && hit.closest && hit.closest('.nt-row');
    clear();
    let tg = null;
    if (row && tree.contains(row) && row.dataset.id !== st.id) {
      const tid = row.dataset.id, r = row.getBoundingClientRect(), f = (y - r.top) / r.height;
      let pos = f < 0.28 ? 'before' : f > 0.72 ? 'after' : 'in';
      let pl = placement(st.id, tid, pos);
      if (!pl && pos === 'in') { const alt = f < 0.5 ? 'before' : 'after'; const p2 = placement(st.id, tid, alt); if (p2) { pos = alt; pl = p2; } }
      if (!pl && pos !== 'in') { const p2 = placement(st.id, tid, 'in'); if (p2) { pos = 'in'; pl = p2; } }
      tg = { pos, pl, why: pl ? '' : why(st.id, tid), tid };
      if (pl) {
        row.classList.add('drop-' + pos);
        if (pos === 'in' && treeKids(tid).length && !isOpen(tid)) {
          if (st.openId !== tid) { clearTimeout(st.openT); st.openId = tid; st.openT = setTimeout(() => { setOpen(tid, true); tree.innerHTML = rowsHTML(); const s = $(`.nt-row[data-id="${st.id}"]`, tree); if (s) s.classList.add('dragging'); }, 650); }
        } else { clearTimeout(st.openT); st.openId = null; }
      }
    } else { clearTimeout(st.openT); st.openId = null; }
    st.target = tg;
    const hint = $('.hint', st.ghost);
    st.ghost.classList.toggle('no', !!(tg && !tg.pl));
    if (!tg) hint.textContent = '';
    else if (!tg.pl) hint.textContent = '· non qui';
    else {
      const p = tg.pl.parent ? title(store.get(tg.pl.parent)) : '';
      hint.textContent = (tg.pl.conv ? `→ diventa ${LV[tg.pl.conv].n.toLowerCase()} ` : '→ ') + (tg.pos === 'in' ? `in «${p}»` : tg.pos === 'before' ? 'prima' : 'dopo');
    }
    cancelAnimationFrame(st.raf);
    const tr = tree.getBoundingClientRect(), edge = 44;
    const dy = y < tr.top + edge ? -9 : y > tr.bottom - edge ? 9 : 0;
    if (dy) { const tick = () => { if (!T.drag || !T.drag.active) return; tree.scrollTop += dy; T.drag.raf = requestAnimationFrame(tick); }; st.raf = requestAnimationFrame(tick); }
  };
  const activate = () => {
    const st = T.drag;
    if (S.offline) { toast('Sei offline: non puoi spostare.'); T.drag = null; return; }
    st.active = true;
    const it = store.get(st.id);
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) { /* */ }
    st.row.classList.add('dragging');
    document.body.classList.add('nt-dragging');
    const g = document.createElement('div');
    g.className = 'nt-ghost';
    g.innerHTML = `${ic(LV[levelOf(it)].ic, 'sm')}<span>${esc(title(it))}</span><span class="hint"></span>`;
    document.body.appendChild(g);
    st.ghost = g;
    update(st.x, st.y);
  };
  tree.addEventListener('pointerdown', e => {
    const row = e.target.closest('.nt-row');
    if (!row || e.button > 0 || e.target.closest('[data-a],input') || T.renaming) return;
    T.drag = { id: row.dataset.id, row, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, active: false, touch: e.pointerType !== 'mouse', pid: e.pointerId };
    if (T.drag.touch) T.drag.hold = setTimeout(() => { if (T.drag && !T.drag.active) activate(); }, 450);
  });
  window.addEventListener('pointermove', e => {
    const st = T.drag;
    if (!st || e.pointerId !== st.pid) return;
    const dist = Math.hypot(e.clientX - st.sx, e.clientY - st.sy);
    if (!st.active) {
      if (st.touch) { if (dist > 8) { clearTimeout(st.hold); T.drag = null; } return; }
      if (dist < 6) return;
      activate();
      if (!T.drag) return;
    }
    e.preventDefault();
    update(e.clientX, e.clientY);
  }, { passive: false });
  window.addEventListener('pointerup', e => { if (T.drag && e.pointerId === T.drag.pid) end(true); });
  window.addEventListener('pointercancel', e => { if (T.drag && e.pointerId === T.drag.pid) end(false); });
  tree.addEventListener('touchmove', e => { if (T.drag && T.drag.active) e.preventDefault(); }, { passive: false });
  tree.addEventListener('contextmenu', e => { if (e.target.closest('.nt-row') && (!app.desk || (T.drag && T.drag.active))) e.preventDefault(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && T.drag && T.drag.active) end(false); });
}

// ---------- panoramica di taccuino, sezione o gruppo (PC, area di lavoro) ----------
export function renderOverview(el, id) {
  const it = store.get(id);
  if (!it) return;
  const lv = levelOf(it);
  const kids = treeKids(id);
  const crumbs = ancestors(it).filter(x => TK.has(x.kind)).map(x => `<button type="button" data-a="go" data-id="${x.id}">${ic(LV[levelOf(x)].ic, 'sm')}<span>${esc(title(x))}</span></button><span class="sep">›</span>`).join('');
  el.innerHTML = `<div class="topbar"><div class="grow nt-crumbs" style="padding-left:16px">${crumbs}<span class="last">${esc(title(it))}</span></div>
      <button class="ib" data-a="more" aria-label="Azioni">${ic('more')}</button></div>
    <div class="scroll"><div class="form nt-ov" style="--sc:${colorOf(it)}">
      <span class="nt-kind lv-${lv}">${ic(LV[lv].ic, 'sm')}${LV[lv].n}${it.d.inbox ? ' · qui arrivano le email' : ''}</span>
      <h2 class="big">${esc(title(it))}</h2>
      <div class="meta">${kids.length ? `${kids.length} element${kids.length === 1 ? 'o' : 'i'} dentro` : 'Vuoto'}</div>
      ${kids.length ? `<div class="nt-ovlist">${kids.map(k => { const l = levelOf(k); const sub = l === 'page' ? (treeKids(k.id).length ? treeKids(k.id).length + ' note' : '') : `${pageCount(k.id)} pagine`;
        return `<button type="button" class="nt-ovi lv-${l}" data-a="go" data-id="${k.id}" style="--sc:${colorOf(k)}"><span class="nic">${ic(LV[l].ic)}</span><span class="nm">${esc(title(k))}</span><small>${LV[l].n}${sub ? ' · ' + sub : ''}</small></button>`; }).join('')}</div>` : ''}
      <div class="row-end" style="justify-content:flex-start">${KIDS[lv].map(k => `<button type="button" class="btn ${k === NAT[lv] ? 'primary' : 'ghost'} needs-net" data-a="mk" data-k="${k}">${ic('plus', 'sm')}${LV[k].nn}</button>`).join('')}</div>
    </div></div>`;
  el.onclick = e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'go') open(b.dataset.id);
    if (b.dataset.a === 'more') nodeMenu(id);
    if (b.dataset.a === 'mk') create(b.dataset.k, id);
  };
}
