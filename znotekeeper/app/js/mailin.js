// Email → nota: apre nel browser le email sigillate con la chiave pubblica e le trasforma in pagine o attività.
import { api } from './api.js';
import { unseal, unb64 } from './crypto.js';
import { mailTargets, notebooks } from './struct.js';
import * as store from './store.js';
import { S } from './store.js';
import { emailHtmlToMd } from './md.js';
import { toast } from './ui.js';
import { plainDue } from './tasks.js';

let running = false;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

function textToMd(text) {
  return String(text || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map(par => par.split('\n').map(l => l
    .replace(/([\\`*_[\]])/g, '\\$1')
    .replace(/^(\s*)(#|>|-|\+|\d+\.)(\s)/, '$1\\$2$3')).join('  \n')).join('\n\n').trim() + '\n';
}

/** Smistamento con #parola nell'oggetto (punto 30): #ricette → sezione «Ricette», #lavoro → lista «Lavoro». */
function route(subject, cfg) {
  const tags = [...subject.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map(m => m[1]);
  let mode = cfg.mode || 'page';
  let section = cfg.section, list = cfg.list;
  let used = null;
  for (const t of tags) {
    const n = norm(t);
    const s = mailTargets().find(x => norm(x.d.title) === n);
    if (s) { mode = 'page'; section = s.id; used = t; break; }
    const l = store.all('list').find(x => norm(x.d.title) === n);
    if (l) { mode = 'task'; list = l.id; used = t; break; }
  }
  const title = used ? subject.replace(new RegExp('(^|\\s)#' + used.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'u'), '$1').replace(/\s+/g, ' ').trim() : subject;
  return { mode, section, list, title };
}

export async function importInbox() {
  if (running || !S.priv || S.offline) return;
  running = true;
  let n = 0;
  try {
    for (let round = 0; round < 10; round++) {
      const rows = await api('GET', 'inbox');
      if (!rows.length) break;
      for (const row of rows) {
        let m;
        try { m = await unseal(S.priv, row.sealed); } catch (e) { console.warn('email non apribile', row.id); await api('DELETE', `inbox/${row.id}`); continue; }
        const cfg = (store.settings().mail) || {};
        const r = route(m.subject || '(senza oggetto)', cfg);
        let section = r.section && store.get(r.section) && store.alive(store.get(r.section)) ? r.section : null;
        let list = r.list && store.get(r.list) && store.alive(store.get(r.list)) ? r.list : null;
        if (r.mode === 'page' && !section) section = (mailTargets().find(s => s.d.inbox) || store.all('section')[0] || {}).id;
        if (r.mode === 'task' && !list) list = (store.all('list')[0] || {}).id;
        if (!section && !list) {
          const nb = (notebooks()[0] || {}).id || store.create('notebook', null, { title: 'Il mio taccuino', main: true }, { sort: 0 });
          section = store.create('section', nb, { title: 'Posta in arrivo', color: 6, inbox: true }, { sort: 0 });
        }
        const asTask = r.mode === 'task' && list;
        const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
        // Allegati: immagini e PDF entro 5 MB vengono importati cifrati; degli altri resta il nome (punto 29).
        const atts = [];
        const cid = {};
        for (const a of m.attachments || []) {
          const info = { name: a.name, type: a.type, size: a.size };
          if (a.data) {
            try {
              info.id = await store.putBlob({ name: a.name, type: a.type }, unb64(a.data), id);
              if (a.cid && a.type.startsWith('image/')) cid[a.cid] = 'img/' + info.id;
            } catch (e) { /* resta solo il nome */ }
          }
          atts.push(info);
        }
        let md = m.text && m.text.trim() ? textToMd(m.text) : (m.html ? emailHtmlToMd(m.html, cid) : '');
        const inline = Object.values(cid);
        if (m.text && inline.length) md += '\n' + inline.map(ref => `![immagine](znk:${ref})`).join('\n\n') + '\n';
        const mail = { from: m.from, from_name: m.from_name || '', at: m.date || row.at, attachments: atts };
        if (asTask) {
          store.save(id, { kind: 'task', parent_id: list, sort: store.nextSort(list, 'task', true), d: { title: r.title, notes: md, mail, repeat: { every: 'none' } }, ...plainDue(null) });
        } else {
          store.save(id, { kind: 'page', parent_id: section, sort: store.nextSort(section, 'page', true), d: { title: r.title, md, mail } });
        }
        await api('DELETE', `inbox/${row.id}`);
        n++;
      }
    }
  } catch (e) {
    console.warn(e);
  } finally {
    running = false;
    S.inbox = 0;
  }
  if (n) toast(n === 1 ? 'È arrivata 1 email: trovi la nota nella posta in arrivo.' : `Sono arrivate ${n} email: trovi le note nella posta in arrivo.`);
}
