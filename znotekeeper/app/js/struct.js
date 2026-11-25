// Struttura del Taccuino (dalla 1.7.0): taccuino › sezione › gruppo › pagina › nota.
// Una «nota» è una pagina dentro un'altra pagina (sottopagina). Le pagine stanno in una sezione o in un gruppo.
import * as store from './store.js';
import { S } from './store.js';

export const TK = new Set(['notebook', 'section', 'group', 'page']);
export const title = it => (it && it.d && it.d.title) || 'Senza titolo';
export const notebooks = () => store.all('notebook').sort(store.bySort);
const parentOf = it => (it && it.parent_id ? store.get(it.parent_id) : null);

export function up(it, kind) {
  let x = it, n = 0;
  while (x && n++ < 40) { if (x.kind === kind) return x; x = parentOf(x); }
  return null;
}
export const sectionOf = it => up(it, 'section');
/** Il gruppo che contiene la pagina (o la nota), se c'è. */
export function groupOf(it) {
  let x = parentOf(it), n = 0;
  while (x && x.kind === 'page' && n++ < 40) x = parentOf(x);
  return x && x.kind === 'group' ? x : null;
}
export const nbOf = it => up(it, 'notebook') || notebooks()[0] || null;
/** Livello nell'albero: notebook, section, group, page o note. */
export function levelOf(it) {
  if (!it) return null;
  if (it.kind !== 'page') return it.kind;
  const p = parentOf(it);
  return p && p.kind === 'page' ? 'note' : 'page';
}
export function ancestors(it) {
  const out = [];
  let x = parentOf(it), n = 0;
  while (x && n++ < 40) { out.unshift(x); x = parentOf(x); }
  return out;
}
export function isAnc(a, b) { let x = store.get(b), n = 0; while (x && n++ < 40) { if (x.id === a) return true; x = parentOf(x); } return false; }
/** Percorso leggibile (il taccuino compare solo se ce n'è più di uno). */
export function pathOf(it) {
  const multi = notebooks().length > 1;
  return ancestors(it).filter(x => TK.has(x.kind) && (multi || x.kind !== 'notebook')).map(title).join(' › ');
}
const liveNb = id => { const n = id && store.get(id); return n && n.kind === 'notebook' && store.alive(n) ? n : null; };
/** Figli nell'albero. Le sezioni rimaste senza taccuino valido compaiono nel primo. */
export function treeKids(id) {
  if (!id) return notebooks();
  const it = store.get(id);
  const out = store.children(id).filter(x => TK.has(x.kind) && x.kind !== 'notebook');
  if (it && it.kind === 'notebook' && notebooks()[0] && notebooks()[0].id === id) {
    for (const s of store.all('section')) if (!liveNb(s.parent_id)) out.push(s);
  }
  return out;
}
export function nextSortIn(parentId) {
  const k = treeKids(parentId);
  return k.length ? Math.max(...k.map(x => x.sort || 0)) + 1000 : 1000;
}
/** Contenitori dove possono arrivare le email (sezioni e gruppi). */
export const mailTargets = () => [...store.all('section'), ...store.all('group')];

const ACCEPT = { root: ['notebook'], notebook: ['section'], section: ['group', 'page'], group: ['page'], page: ['page'] };
/**
 * Dove finisce l'elemento `id` lasciato su `targetId` in posizione before/after/in.
 * Restituisce { parent, sort, conv } (conv = nuovo livello: «page» o «note») oppure null se non può stare lì.
 */
export function placement(id, targetId, pos) {
  const it = store.get(id), tg = store.get(targetId);
  if (!it || !tg || id === targetId) return null;
  let p;
  if (pos === 'in') p = tg;
  else p = tg.kind === 'notebook' ? null : (tg.kind === 'section' && !liveNb(tg.parent_id) ? notebooks()[0] : parentOf(tg));
  const pk = p ? p.kind : 'root';
  if (!ACCEPT[pk] || !ACCEPT[pk].includes(it.kind)) return null;
  if (p && (p.id === id || isAnc(id, p.id))) return null;
  if (it.kind === 'page' && pk === 'page' && store.children(id, 'page').length) return null;
  const sibs = treeKids(p ? p.id : null).filter(x => x.id !== id);
  let sort;
  if (pos === 'in') sort = sibs.length ? Math.max(...sibs.map(x => x.sort || 0)) + 1000 : 1000;
  else {
    const i = sibs.findIndex(x => x.id === targetId);
    if (pos === 'before') { const prev = sibs[i - 1]; sort = prev ? (prev.sort + tg.sort) / 2 : tg.sort - 1000; }
    else { const next = sibs[i + 1]; sort = next ? (tg.sort + next.sort) / 2 : tg.sort + 1000; }
  }
  const to = it.kind === 'page' ? (pk === 'page' ? 'note' : 'page') : it.kind;
  return { parent: p ? p.id : null, sort, conv: to !== levelOf(it) ? to : null };
}

/**
 * Migrazione dalla struttura fino alla 1.6.x (gruppo di sezioni › sezione › pagine):
 * il vecchio gruppo diventa una sezione del suo taccuino e le sue sezioni diventano gruppi,
 * con le stesse pagine. Le sezioni fuori dai gruppi entrano nel loro taccuino.
 * Si ripete senza danni: lavora solo su ciò che è ancora nella forma vecchia.
 */
export async function migrate() {
  if (S.offline) return false;
  const items = [...S.items.values()].filter(x => !x.purged && x.d);
  const oldGroups = items.filter(x => x.kind === 'group' && !x.parent_id);
  const loose = items.filter(x => x.kind === 'section' && !liveNb(x.parent_id) && !(oldGroups.some(g => g.id === x.parent_id)));
  if (!oldGroups.length && !loose.length) return false;
  let nbs = items.filter(x => x.kind === 'notebook' && !x.deleted_at).sort(store.bySort);
  let def = nbs.find(n => n.d.main) || nbs[0];
  const jobs = [];
  if (!def) {
    const id = store.create('notebook', null, { title: 'Il mio taccuino', main: true }, { sort: 0 });
    jobs.push(Promise.resolve());
    def = store.get(id);
  }
  const nbFor = x => liveNb(x.d && x.d.nb) || def;
  // Ordine nel taccuino: prima le sezioni che erano fuori dai gruppi, poi i gruppi (come si vedevano prima).
  const byNb = new Map();
  for (const x of [...loose.sort(store.bySort), ...oldGroups.sort(store.bySort)]) {
    const nb = nbFor(x);
    if (!byNb.has(nb.id)) byNb.set(nb.id, []);
    byNb.get(nb.id).push(x);
  }
  for (const [nbId, list] of byNb) {
    let sort = store.children(nbId, 'section').reduce((m, s) => Math.max(m, s.sort || 0), 0);
    for (const x of list) {
      sort += 1000;
      if (x.kind === 'section') { jobs.push(store.save(x.id, { parent_id: nbId, sort })); continue; }
      const secs = items.filter(s => s.kind === 'section' && s.parent_id === x.id);
      const first = secs.filter(s => !s.deleted_at).sort(store.bySort)[0];
      const d = { ...x.d, color: (first && first.d.color) || x.d.color || 3 };
      delete d.nb;
      jobs.push(store.save(x.id, { kind: 'section', parent_id: nbId, sort, d }));
      for (const s of secs) jobs.push(store.save(s.id, { kind: 'group' }));
    }
  }
  await Promise.allSettled(jobs);
  return true;
}
