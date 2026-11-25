// Markdown ⇄ HTML per l'editor visuale. Il testo è sempre salvato in Markdown.
/* global marked, DOMPurify, TurndownService, turndownPluginGfm */

const URI_OK = /^(?:(?:https?|mailto|tel|znk):|#|\/|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

marked.use({ gfm: true, breaks: false });

const purifyCfg = {
  ALLOWED_URI_REGEXP: URI_OK,
  ADD_ATTR: ['data-znk', 'target'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'source', 'svg', 'math'],
  FORBID_ATTR: ['style', 'srcset'],
};

export function sanitize(html) {
  return DOMPurify.sanitize(html, purifyCfg);
}

/** Markdown → HTML pronto per l'editor (caselle, riferimenti znk: a disegni, immagini e attività). */
export function mdToHtml(md) {
  const raw = marked.parse(String(md || ''));
  const clean = DOMPurify.sanitize(raw, { ...purifyCfg, FORBID_TAGS: purifyCfg.FORBID_TAGS.filter(t => t !== 'input'), ADD_ATTR: ['data-znk', 'target', 'checked', 'type', 'disabled'] });
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  const root = tpl.content;
  root.querySelectorAll('li').forEach(li => {
    let first = li.firstElementChild;
    if (first && first.tagName === 'P') first = first.firstElementChild || first;
    const box = li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]');
    if (box) {
      li.classList.add('task-item');
      if (box.checked || box.hasAttribute('checked')) li.classList.add('done');
      const next = box.nextSibling;
      if (next && next.nodeType === 3) next.textContent = next.textContent.replace(/^\s+/, '');
      box.remove();
      const ul = li.parentElement;
      if (ul) ul.classList.add('todo');
    }
  });
  root.querySelectorAll('input').forEach(i => i.remove());
  root.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (src.startsWith('znk:')) {
      const ref = src.slice(4);
      img.setAttribute('data-znk', ref);
      img.removeAttribute('src');
      img.classList.add(ref.startsWith('drawing/') ? 'znk-drawing' : 'znk-img', 'loading');
      img.setAttribute('draggable', 'false');
    } else if (!src.startsWith('data:image/')) {
      // Immagini esterne non caricate: proteggono la riservatezza (niente richieste verso altri siti).
      const a = document.createElement('a');
      a.href = src; a.textContent = img.alt || 'immagine esterna';
      img.replaceWith(a);
    }
  });
  root.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href.startsWith('znk:')) {
      a.setAttribute('data-znk', href.slice(4));
      a.classList.add(href.startsWith('znk:task/') ? 'znk-task' : href.startsWith('znk:att/') ? 'znk-att' : 'znk-link');
      a.setAttribute('href', '#');
    } else {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });
  const div = document.createElement('div');
  div.appendChild(root);
  return div.innerHTML;
}

// ---------- HTML → Markdown ----------
const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**', hr: '---' });
td.use([turndownPluginGfm.tables, turndownPluginGfm.strikethrough]);
td.addRule('taskItem', {
  filter: node => node.nodeName === 'LI' && node.classList.contains('task-item'),
  replacement: (content, node) => {
    content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n    ');
    const box = node.classList.contains('done') ? '[x] ' : '[ ] ';
    return '- ' + box + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
  },
});
td.addRule('znkImg', {
  filter: node => node.nodeName === 'IMG' && node.hasAttribute('data-znk'),
  replacement: (c, node) => `![${(node.getAttribute('alt') || '').replace(/[[\]]/g, '')}](znk:${node.getAttribute('data-znk')})`,
});
td.addRule('znkLink', {
  filter: node => node.nodeName === 'A' && node.hasAttribute('data-znk'),
  replacement: (c, node) => `[${c.replace(/[[\]]/g, '')}](znk:${node.getAttribute('data-znk')})`,
});
td.addRule('strikeS', { filter: ['s', 'strike'], replacement: c => `~~${c}~~` });
td.addRule('underline', { filter: ['u'], replacement: c => c });
td.addRule('divs', { filter: node => node.nodeName === 'DIV' && !node.classList.length, replacement: c => `\n\n${c}\n\n` });
// Due elenchi uno dopo l'altro in Markdown diventerebbero uno solo: un commento vuoto li tiene separati.
td.addRule('listSep', {
  filter: node => (node.nodeName === 'UL' || node.nodeName === 'OL') && node.previousElementSibling && /^(UL|OL)$/.test(node.previousElementSibling.nodeName) && node.parentNode && !/^(LI)$/.test(node.parentNode.nodeName),
  replacement: content => '\n\n<!-- -->\n\n' + content.replace(/^\n+/, '') + '\n\n',
});
// Un paragrafo vuoto (solo <br>) non produce righe di spazi.
td.addRule('emptyP', { filter: node => node.nodeName === 'P' && !node.textContent.trim() && !node.querySelector('img'), replacement: () => '\n\n' });
// Un a capo dentro una cella spezzerebbe la riga della tabella Markdown.
td.addRule('cellBr', { filter: node => node.nodeName === 'BR' && !!node.parentNode && !!node.parentNode.closest && !!node.parentNode.closest('td,th'), replacement: () => ' ' });
td.remove(['style', 'script', 'meta', 'title']);

export function htmlToMd(el) {
  const html = typeof el === 'string' ? el : el.innerHTML;
  return td.turndown(html).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** HTML di un'email → Markdown (immagini esterne tolte, quelle allegate collegate). */
export function emailHtmlToMd(html, cidMap = {}) {
  const clean = DOMPurify.sanitize(html, { ...purifyCfg, FORBID_TAGS: [...purifyCfg.FORBID_TAGS, 'img'], WHOLE_DOCUMENT: false });
  let md = td.turndown(clean);
  for (const [cid, ref] of Object.entries(cidMap)) md = md.replaceAll(`cid:${cid}`, `znk:${ref}`);
  return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Testo semplice per anteprime e ricerca. */
export function mdText(md) {
  return String(md || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+\.)\s+/gm, '')
    .replace(/^-{3,}$/gm, ' ')
    .replace(/\\([\\`*_{}\[\]()#+\-.!|~>])/g, (m, c) => c === '*' || c === '_' || c === '~' || c === '`' || c === '|' ? '\u0001' + c : c)
    .replace(/(^|[^\u0001])[*_~`|]/g, '$1')
    .replace(/(^|[^\u0001])[*_~`|]/g, '$1')
    .replace(/\u0001/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const hasDrawing = md => /\]\(znk:drawing\//.test(md || '');
export const firstDrawing = md => { const m = /\]\(znk:drawing\/([A-Za-z0-9_-]+)\)/.exec(md || ''); return m ? m[1] : null; };
export const firstImage = md => { const m = /\]\(znk:img\/([A-Za-z0-9_-]+)\)/.exec(md || ''); return m ? m[1] : null; };
export const refsIn = md => [...String(md || '').matchAll(/\(znk:(drawing|img|att)\/([A-Za-z0-9_-]+)\)/g)].map(m => ({ type: m[1], id: m[2] }));
export const tagsIn = md => [...new Set([...String(md || '').matchAll(/(?:^|\s)\\?#([\p{L}\p{N}_-]{2,40})/gu)].map(m => m[1].toLowerCase()))];
