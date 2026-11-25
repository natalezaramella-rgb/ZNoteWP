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
import { sectionOf, groupOf, pathOf, levelOf, treeKids, nextSortIn, ancestors, notebooks } from './struct.js';
import { create as createNode, moveDialog } from './ntree.js';

const COLORS = [1, 2, 3, 4, 5, 6];
export const secColor = s => `var(--s${Math.min(6, Math.max(1, parseInt(s && s.d && s.d.color, 10) || 3))})`;
const title = it => (it && it.d && it.d.title) || 'Senza titolo';

// ---------- struttura (vedi struct.js) ----------
export { sectionOf, groupOf, pathOf, notebooks, nbOf } from './struct.js';
export function allTags() {
  const m = new Map();
  for (const p of store.all('page')) for (const t of tagsIn(p.d.md)) m.set(t, (m.get(t) || 0) + 1);
  for (const t of store.all('task')) for (const x of tagsIn((t.d.title || '') + ' ' + (t.d.notes || ''))) m.set(x, (m.get(x) || 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'it'));
}
export function colorPicker(cur) {
  return `<label class="flab">Colore</label><div class="colors" role="radiogroup">${COLORS.map(c => `<button type="button" data-color="${c}" style="background:var(--s${c})" role="radio" aria-checked="${c === cur}" aria-label="Colore ${c}"></button>`).join('')}</div>`;
}
export function bindColors(el, st) {
  el.addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (!b) return; st.color = +b.dataset.color; $$('[data-color]', el).forEach(x => x.setAttribute('aria-checked', String(x === b))); });
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
    if (!it.deleted_at || it.purged || !it.d || !['page', 'section', 'group', 'notebook', 'task', 'list'].includes(it.kind)) continue;
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

/** Viste speciali del Taccuino: Preferiti, Recenti, un'etichetta, Cestino. */
export function renderList(el) {
  const cur = app.R.section;
  const st = store.settings();
  let head = '', body = '', bar = '', color = 'var(--line)', tabs = '';
  if (cur === 'v:fav' || cur === 'v:recent' || String(cur).startsWith('tag:')) {
    let pages;
    let name;
    if (cur === 'v:fav') { name = 'Preferiti'; pages = store.all('page').filter(p => p.d.fav).sort((a, b) => title(a).localeCompare(title(b), 'it')); }
    else if (cur === 'v:recent') { name = 'Recenti'; pages = (st.recents || []).map(id => store.get(id)).filter(p => p && store.alive(p) && p.kind === 'page'); }
    else { const t = cur.slice(4); name = '#' + t; pages = store.all('page').filter(p => tagsIn(p.d.md).includes(t)); }
    head = `<div class="head" style="padding-top:12px"><div class="grow"><div class="crumb">Taccuino ›</div><h2 class="big">${esc(name)}</h2><div class="meta">${pages.length} ${pages.length === 1 ? 'pagina' : 'pagine'}</div></div><button class="ib" data-only="desk" data-fold="list" aria-label="Nascondi pagine" title="Nascondi elenco delle pagine">${ic('panel')}</button></div>`;
    body = pages.length ? pages.map(p => pageRow(p, 0, { path: true })).join('') : `<div class="empty"><b>Niente qui</b>${cur === 'v:fav' ? 'Tocca la stella in una pagina per aggiungerla ai preferiti.' : cur === 'v:recent' ? 'Le pagine che apri compaiono qui.' : ''}</div>`;
    if (String(cur).startsWith('tag:')) {
      const t = cur.slice(4);
      const ts = store.all('task').filter(x => tagsIn((x.d.title || '') + ' ' + (x.d.notes || '')).includes(t));
      if (ts.length) body += `<div class="rhead">Attività</div>` + ts.map(x => `<div class="page-row" data-a="open-task" data-id="${x.id}"><div class="pg"><div class="pt">${ic('tasks', 'sm')}${esc(title(x))}</div></div></div>`).join('');
    }
  } else if (cur === 'v:trash') {
    const items = trashItems();
    head = `<div class="head" style="padding-top:12px"><div class="grow"><div class="crumb">Taccuino e attività ›</div><h2 class="big">Cestino</h2><div class="meta">Gli elementi vengono eliminati per sempre dopo 30 giorni.</div></div>
      ${items.length ? '<button class="btn ghost small needs-net" data-a="empty-trash">Svuota</button>' : ''}<button class="ib" data-only="desk" data-fold="list" aria-label="Nascondi pagine" title="Nascondi elenco delle pagine">${ic('panel')}</button></div>`;
    const kindName = { page: 'Pagina', section: 'Sezione', group: 'Gruppo', notebook: 'Taccuino', task: 'Attività', list: 'Lista' };
    body = items.length ? items.map(it => {
      const left = Math.max(0, 30 - Math.floor((Date.now() - new Date(it.deleted_at)) / 864e5));
      return `<div class="page-row" style="cursor:default"><div class="pg"><div class="pt">${esc(title(it))}</div><div class="path">${kindName[it.kind]} · eliminata ${esc(fmtWhen(it.deleted_at))} · ancora ${left} giorni</div></div>
        <button class="btn ghost small needs-net" data-a="restore" data-id="${it.id}">${ic('restore', 'sm')}Ripristina</button>
        <button class="ib needs-net" data-a="purge" data-id="${it.id}" aria-label="Elimina per sempre">${ic('trash')}</button></div>`;
    }).join('') : '<div class="empty"><b>Il cestino è vuoto</b></div>';
  }
  el.innerHTML = `
    <div class="topbar" data-only="phone">
      <button class="ib" data-a="totree" aria-label="Torna al taccuino">${ic('back')}</button>
      <div class="grow"><div class="apptitle">Taccuino</div></div>
      <button class="ib" data-a="search" aria-label="Cerca">${ic('search')}</button>
    </div>
    ${tabs}
    <div class="secbar" style="background:${color}"></div>
    ${inboxBanner()}
    <div class="scroll">${head}${bar}${body}<div style="height:90px"></div></div>
`;
  loadThumbs(el);
  if (!el._bound) bindList(el);
  const sel = $('.page-row.sel', el);
  if (sel && el._lastSel !== app.R.page) { sel.scrollIntoView({ block: 'nearest' }); el._lastSel = app.R.page; }
}
export function inboxBanner() {
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
      case 'totree': app.go({ section: null, page: null }); break;
      case 'search': app.go({ view: 'search' }); break;
      case 'lock': app.lock(); break;
      case 'sort': if (!store.canWrite()) return; store.update('settings', d => { d.sortPages = d.sortPages || {}; d.sortPages[app.R.section] = b.dataset.mode; }); break;
      case 'restore': await store.restore(id); toast('Ripristinato.'); break;
      case 'purge': if (await confirmDialog('Eliminare per sempre?', 'Non si potrà più recuperare.', { ok: 'Elimina', danger: true })) store.purge(id); break;
      case 'empty-trash':
        if (await confirmDialog('Svuotare il cestino?', 'Tutti gli elementi del cestino saranno eliminati per sempre.', { ok: 'Svuota', danger: true })) for (const it of trashItems()) await store.purge(it.id);
        break;
      case 'er-cancel': await cancelRecovery(); break;
    }
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.page-row')) e.target.click(); });
}

/**
 * Nuova pagina (o nota, se `parentId` è una pagina). Senza destinazione: accanto alla pagina aperta,
 * oppure nella sezione o nel gruppo selezionati, oppure nella prima sezione.
 */
export async function newPage(parentId = null) {
  if (!store.canWrite()) return;
  let parent = parentId ? store.get(parentId) : null;
  if (!parent) {
    const cur = store.get(app.R.page) || store.get(app.R.node);
    const chain = cur ? [...ancestors(cur), cur] : [];
    parent = chain.reverse().find(x => x.kind === 'group' || x.kind === 'section');
    if (!parent) parent = store.all('section').sort(store.bySort)[0];
  }
  if (!parent) {
    const nb = notebooks()[0];
    if (!nb) { createNode('notebook', null); return; }
    createNode('section', nb.id);
    toast('Prima serve una sezione: dalle un nome, poi crea la pagina.');
    return;
  }
  const id = store.create('page', parent.id, { title: '', md: '' }, { sort: nextSortIn(parent.id) });
  app.go({ view: 'notes', page: id, node: null, from: null, ...(String(app.R.section || '').includes(':') ? { section: null } : {}) });
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
      } else if (b.meta.type === 'application/pdf' || /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(b.meta.type || '')) {
        // Mai aprire come documento un SVG o un HTML: conterrebbe script eseguiti con l'origine dell'app.
        // Gli altri tipi vengono solo scaricati.
        window.open(b.url, '_blank', 'noopener');
      } else {
        const a = document.createElement('a'); a.href = b.url; a.download = b.meta.name || 'allegato'; a.click();
      }
    } catch (e) { toast('Contenuto non disponibile' + (S.offline ? ' offline.' : '.')); }
  }
}

async function pageMenu(id) {
  const p = store.get(id);
  const isSub = levelOf(p) === 'note';
  const a = await choose(title(p), [
    { label: p.d.fav ? 'Togli dai preferiti' : 'Aggiungi ai preferiti', value: 'fav', icon: 'star' },
    ...(isSub ? [] : [{ label: 'Nuova nota in questa pagina', value: 'sub', icon: 'plus' }]),
    { label: 'Sposta in…', value: 'move', icon: 'move' },
    ...(isSub ? [{ label: 'Trasforma in pagina', value: 'nest', icon: 'page' }] : []),
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
  if (a === 'move') moveDialog(id);
  if (a === 'nest') {
    const c = ancestors(p).reverse().find(x => x.kind === 'group' || x.kind === 'section');
    if (c) { store.batch([{ id, parent_id: c.id, sort: nextSortIn(c.id) }]); toast(`«${title(p)}» ora è una pagina`); }
  }
  if (a === 'up' || a === 'down') moveSibling(p, a === 'up' ? -1 : 1, treeKids(p.parent_id));
  if (a === 'del') {
    const n = store.descendants(id).filter(x => x.kind === 'page').length;
    await store.trash(id);
    app.go({ page: null });
    toast(n ? `${isSub ? 'Nota' : 'Pagina'} e ${n} note nel cestino` : `${isSub ? 'Nota' : 'Pagina'} nel cestino`, 'Annulla', () => store.restore(id));
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

export async function cancelRecovery() {
  await api('POST', 'recover/email/cancel', {});
  S.recovery = 'on';
  toast('Recupero annullato.');
  app.render();
}
