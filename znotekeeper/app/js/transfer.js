// Backup cifrato (.znk), ripristino ed esportazione Markdown leggibile (punti 14 e 28).
import { api } from './api.js';
import * as C from './crypto.js';
import * as store from './store.js';
import { S } from './store.js';
import { $, sheet, closeOverlay, toast, download, pickFile, choose, esc, isoDay } from './ui.js';
import { askPassword } from './lock.js';
import { Zip } from './zip.js';
import { drawingToPNG } from './draw.js';
import { fileName, sectionOf, notebooks } from './notes.js';
import { treeKids } from './struct.js';

function progress(title) {
  const el = sheet(`<h3>${esc(title)}</h3><p class="muted" id="prog">Preparo…</p>`);
  return t => { const p = $('#prog', el); if (p) p.textContent = t; };
}

export async function exportBackup() {
  const p = await askPassword('Backup cifrato', 'Il file si aprirà solo con la password delle note attuale.');
  if (!p) return;
  const say = progress('Backup cifrato');
  try {
    await store.sync();
    const out = [];
    const list = [...S.items.values()].filter(x => !x.purged);
    let i = 0;
    for (const it of list) {
      i++;
      if (i % 10 === 0) say(`Elemento ${i} di ${list.length}…`);
      let data = null;
      try { data = await store.rawOf(it.id); } catch (e) { continue; }
      if (!data) continue;
      out.push({ id: it.id, kind: it.kind, parent_id: it.parent_id, sort: it.sort, due_at: it.due_at, remind_at: it.remind_at, completed: !!it.completed, deleted_at: it.deleted_at, created_at: it.created_at, updated_at: it.updated_at, data });
    }
    const file = { format: 'znotekeeper-backup', v: 1, created: new Date().toISOString(), site: location.host, kdf: S.vault.kdf, pw: S.vault.pw, items: out };
    download(`znotekeeper-backup-${isoDay(new Date())}.znk`, JSON.stringify(file), 'application/json');
    closeOverlay();
    toast(`Backup creato: ${out.length} elementi, tutti cifrati.`);
  } catch (e) { closeOverlay(); toast(e.message); }
}

export async function restoreBackup() {
  if (!store.canWrite()) return;
  const [f] = await pickFile('.znk,application/json');
  if (!f) return;
  let file;
  try { file = JSON.parse(await f.text()); } catch (e) { toast('File non valido.'); return; }
  if (file.format !== 'znotekeeper-backup' || !Array.isArray(file.items)) { toast('Non è un backup di ZNoteKeeper.'); return; }
  const el = sheet(`<h3>Ripristina da backup</h3><p class="muted">Backup del ${esc(new Date(file.created).toLocaleString('it-IT'))} con ${file.items.length} elementi. Inserisci la password delle note che era in uso quando è stato creato.</p>
    <form><input class="field-in" type="password" autocomplete="off" placeholder="Password del backup">
    <label class="flab">Elementi già presenti</label><select class="sel" name="mode" style="width:100%"><option value="skip">Tieni quelli attuali, aggiungi solo i mancanti</option><option value="over">Sostituiscili con quelli del backup</option></select>
    <div class="err"></div><div class="row-end"><button type="button" class="btn ghost" data-close>Annulla</button><button class="btn primary">Ripristina</button></div></form>`);
  const form = $('form', el);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    form.classList.add('busy');
    try {
      const d = await C.deriveSecret($('input', el).value, file.kdf.salt, file.kdf.iter);
      let old;
      try { old = await C.Space.unwrap(d.kek, file.pw); } catch (x) { throw new Error('Password non corretta per questo backup.'); }
      const over = form.mode.value === 'over';
      const ops = [];
      let size = 0, done = 0, skipped = 0;
      const flush = async () => { if (!ops.length) return; await api('POST', 'items/batch', { ops: ops.splice(0) }); size = 0; };
      for (const it of file.items) {
        const cur = store.get(it.id);
        if (cur && !over) { skipped++; continue; }
        let data;
        if (it.data.startsWith('b1.')) { const b = await old.decBytes(it.id, it.data); data = await S.space.encBytes(it.id, b.meta, b.bytes); }
        else data = await S.space.encItem(it.id, await old.decItem(it.id, it.data));
        ops.push({ id: it.id, kind: it.kind, parent_id: it.parent_id, sort: it.sort, due_at: it.due_at, remind_at: it.remind_at, completed: it.completed, deleted: !!it.deleted_at, data, force: true });
        size += data.length; done++;
        if (size > 4 * 1024 * 1024 || ops.length >= 200) await flush();
        $('.err', el).textContent = `Ripristino ${done}…`;
      }
      await flush();
      await store.sync();
      closeOverlay();
      toast(`Ripristinati ${done} elementi${skipped ? `, ${skipped} già presenti lasciati com'erano` : ''}.`);
    } catch (err) { $('.err', el).textContent = err.message; form.classList.remove('busy'); }
  });
}

export async function exportMarkdown() {
  const ok = await choose('Esportazione leggibile', [{ label: 'Scarica l\'archivio .zip in chiaro', value: 'go', icon: 'download' }],
    { text: 'L\'archivio contiene note e attività <b>non cifrate</b> (file Markdown, immagini e disegni): conservalo in un posto sicuro.' });
  if (!ok) return;
  const p = await askPassword('Esportazione in chiaro');
  if (!p) return;
  const say = progress('Esportazione Markdown');
  try {
    const z = new Zip();
    const assets = new Map();
    const asset = async (type, id) => {
      const key = type + '/' + id;
      if (assets.has(key)) return assets.get(key);
      let name = null;
      try {
        if (type === 'drawing') name = z.add(`_allegati/disegno-${id.slice(0, 8)}.png`, await drawingToPNG(await store.getDrawing(id), { crop: true, scale: 1.5 }));
        else { const b = await store.blobBytes(id); name = z.add(`_allegati/${fileName(b.meta.name || id)}`, b.bytes); }
      } catch (e) { name = null; }
      assets.set(key, name);
      return name;
    };
    const fixRefs = async (md, depth) => {
      const up = '../'.repeat(depth);
      const refs = [...String(md || '').matchAll(/\]\(znk:(drawing|img|att|task)\/([A-Za-z0-9_-]+)\)/g)];
      for (const m of refs) {
        if (m[1] === 'task') { md = md.replace(m[0], '](#)'); continue; }
        const n = await asset(m[1], m[2]);
        md = md.replace(m[0], n ? `](${up}${encodeURI(n)})` : '](#)');
      }
      return md;
    };
    let n = 0;
    const writePage = async (pg, dir, depth) => {
      n++; if (n % 5 === 0) say(`Pagina ${n}…`);
      const t = pg.d.title || 'Senza titolo';
      let md = `# ${t}\n\n`;
      if (pg.d.mail) md += `> Arrivata via email da ${pg.d.mail.from} il ${new Date(pg.d.mail.at).toLocaleString('it-IT')}\n\n`;
      md += await fixRefs(pg.d.md || '', depth);
      for (const a of (pg.d.mail && pg.d.mail.attachments) || []) if (a.id) { const nm = await asset('att', a.id); if (nm) md += `\n- Allegato: [${a.name}](${'../'.repeat(depth)}${encodeURI(nm)})`; }
      z.add(`${dir}${fileName(t)}.md`, md, pg.updated_at);
      const kids = store.children(pg.id, 'page');
      for (const k of kids) await writePage(k, `${dir}${fileName(t)}/`, depth + 1);
    };
    // Cartelle: Taccuino/[taccuino/]sezione/[gruppo/]pagina.md, le note dentro la cartella della pagina.
    const multi = notebooks().length > 1;
    const walk = async (id, dir) => {
      for (const k of treeKids(id)) {
        if (k.kind === 'page') await writePage(k, dir, dir.split('/').length - 1);
        else await walk(k.id, k.kind === 'notebook' && !multi ? dir : `${dir}${fileName(k.d.title)}/`);
      }
    };
    await walk(null, 'Taccuino/');
    for (const l of store.all('list').sort(store.bySort)) {
      let md = `# ${l.d.title}\n\n`;
      const line = async (t, ind) => {
        let s = `${ind}- [${t.completed ? 'x' : ' '}] ${t.d.title || ''}`;
        if (t.d.due && t.d.due.date) s += ` (scadenza ${t.d.due.date.split('-').reverse().join('/')}${t.d.due.time ? ' ' + t.d.due.time : ''})`;
        if (t.d.repeat && t.d.repeat.every && t.d.repeat.every !== 'none') s += ` · si ripete`;
        if (t.d.star) s += ' ★';
        s += '\n';
        if (t.d.notes) s += (await fixRefs(t.d.notes, 1)).trim().split('\n').map(x => ind + '    ' + x).join('\n') + '\n';
        for (const dId of t.d.drawings || []) { const nm = await asset('drawing', dId); if (nm) s += `${ind}    ![disegno](../${encodeURI(nm)})\n`; }
        return s;
      };
      for (const t of store.children(l.id, 'task')) { md += await line(t, ''); for (const sb of store.children(t.id, 'task')) md += await line(sb, '    '); }
      z.add(`Attività/${fileName(l.d.title)}.md`, md);
    }
    z.add('LEGGIMI.txt', `Esportazione di ZNoteKeeper del ${new Date().toLocaleString('it-IT')}.\nI file .md si aprono con qualsiasi editor di testo o programma Markdown (Obsidian, Typora, VS Code...).\nQuesto archivio NON è cifrato.\n`);
    say('Creo l\'archivio…');
    download(`znotekeeper-markdown-${isoDay(new Date())}.zip`, z.blob());
    closeOverlay();
    toast('Esportazione pronta.');
  } catch (e) { closeOverlay(); toast(e.message); }
}
export { sectionOf };
