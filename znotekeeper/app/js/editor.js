// Editor visuale (contenteditable) che salva in Markdown.
import { ic } from './icons.js';
import { $, $$, esc, debounce, promptDialog, choose, toast, pickFile } from './ui.js';
import { mdToHtml, htmlToMd, sanitize } from './md.js';
import * as store from './store.js';
import { drawingToBlobURL } from './draw.js';

const FULL = ['p', 'h1', 'h2', 'h3', '|', 'bold', 'italic', 'strike', 'code', 'link', '|', 'ul', 'ol', 'todo', 'quote', 'table', 'hr', '|', 'image', 'drawing', 'totask', '|', 'undo', 'redo'];
const SMALL = ['bold', 'italic', 'strike', 'code', 'link', '|', 'ul', 'ol', 'todo', '|', 'image', 'drawing'];
const LABEL = {
  p: ['T', 'Testo normale'], h1: ['H1', 'Titolo 1'], h2: ['H2', 'Titolo 2'], h3: ['H3', 'Titolo 3'],
  bold: ['B', 'Grassetto (Ctrl+B)'], italic: ['<i style="font-family:Georgia,serif">I</i>', 'Corsivo (Ctrl+I)'], strike: ['<s>S</s>', 'Barrato'],
  code: [ic('code'), 'Codice'], link: [ic('link'), 'Link (Ctrl+K nel testo)'], ul: [ic('list'), 'Elenco puntato'], ol: [ic('ol'), 'Elenco numerato'],
  todo: [ic('todo'), 'Caselle da spuntare'], quote: [ic('quote'), 'Citazione'], table: [ic('table'), 'Tabella'], hr: [ic('hr'), 'Linea'],
  image: [ic('photo'), 'Immagine o foto'], drawing: [ic('pen'), 'Disegno'], totask: [ic('tasks'), 'Trasforma la casella in attività'],
  undo: [ic('undo'), 'Annulla'], redo: [ic('redo'), 'Ripristina'],
};

export function toolbarHTML(small = false, cls = '') {
  return `<div class="etools ${cls}" role="toolbar" aria-label="Formattazione">${(small ? SMALL : FULL).map(c => c === '|' ? '<span class="sep"></span>' :
    `<button type="button" data-cmd="${c}" title="${esc(LABEL[c][1])}" aria-label="${esc(LABEL[c][1])}">${LABEL[c][0]}</button>`).join('')}</div>`;
}

/** Ridimensiona un'immagine (max 1800 px, JPEG) prima di cifrarla. */
export async function prepareImage(file) {
  const type = file.type || 'image/png';
  if (!/^image\/(png|jpe?g|webp|gif|bmp)$/.test(type)) return { bytes: new Uint8Array(await file.arrayBuffer()), type, name: file.name };
  if (type === 'image/gif') return { bytes: new Uint8Array(await file.arrayBuffer()), type, name: file.name || 'immagine.gif' };
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return { bytes: new Uint8Array(await file.arrayBuffer()), type, name: file.name };
  const max = 1800;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (k === 1 && file.size < 900 * 1024) return { bytes: new Uint8Array(await file.arrayBuffer()), type, name: file.name || 'immagine' };
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg', name: (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg' };
}

/** Carica nel testo le immagini e i disegni cifrati. */
export async function hydrate(root) {
  for (const img of $$('img[data-znk]', root)) {
    const [type, id] = img.dataset.znk.split('/');
    if (img.dataset.loaded === id) continue;
    img.dataset.loaded = id;
    try {
      if (type === 'drawing') img.src = await drawingToBlobURL(await store.getDrawing(id), { maxW: 800 });
      else img.src = (await store.blobURL(id)).url;
      img.classList.remove('loading');
    } catch (e) {
      img.alt = 'Immagine non disponibile offline';
      img.classList.remove('loading');
    }
  }
  for (const a of $$('a.znk-task[data-znk]', root)) {
    const t = store.get(a.dataset.znk.split('/')[1]);
    a.classList.toggle('done', !!(t && t.completed));
    a.title = t && t.d ? 'Apri attività: ' + t.d.title : 'Attività eliminata';
  }
}

export class Editor {
  /**
   * @param {HTMLElement} el contenitore contenteditable
   * @param {object} o opzioni: md, onChange(md), small, readonly, ownerId, onDraw(id|null) → Promise<id>, onToTask(text) → id, onOpenRef(ref)
   */
  constructor(el, o) {
    this.el = el; this.o = o;
    el.classList.add('editor');
    if (o.small) el.classList.add('small');
    el.setAttribute('data-placeholder', o.placeholder || 'Scrivi qui…');
    this.setMd(o.md || '');
    this.setReadonly(!!o.readonly);
    this.changed = debounce(() => this.emit(), 700);
    el.addEventListener('input', () => {
      // Il testo scritto direttamente nell'editor vuoto va in un paragrafo (serve alle scorciatoie "# ", "- ").
      const f = this.el.firstChild;
      if (f && f.nodeType === 3 && f.textContent.trim()) { try { document.execCommand('formatBlock', false, 'P'); } catch (e) { /* */ } }
      this.changed();
    });
    el.addEventListener('keydown', e => this.onKey(e));
    el.addEventListener('click', e => this.onClick(e));
    el.addEventListener('paste', e => this.onPaste(e));
    el.addEventListener('drop', e => this.onDrop(e));
    el.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* */ }
  }
  setMd(md) { this.md = md; this.el.innerHTML = mdToHtml(md); hydrate(this.el); }
  setReadonly(ro) { this.ro = ro; this.el.contentEditable = ro ? 'false' : 'true'; }
  getMd() { return htmlToMd(this.el); }
  emit() {
    if (this.ro) return;
    const md = this.getMd();
    if (md === this.md) return;
    this.md = md;
    this.o.onChange && this.o.onChange(md);
  }
  flush() { this.changed.cancel(); this.emit(); }

  bindToolbar(bar) {
    bar.addEventListener('mousedown', e => { if (e.target.closest('[data-cmd]')) e.preventDefault(); });
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-cmd]');
      if (!b || this.ro) return;
      this.cmd(b.dataset.cmd);
    });
  }

  focusEnd() {
    this.el.focus();
    const r = document.createRange(); r.selectNodeContents(this.el); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  ensureFocus() {
    const s = getSelection();
    if (!s.rangeCount || !this.el.contains(s.anchorNode)) this.focusEnd();
    return getSelection().getRangeAt(0);
  }
  saveRange() { const s = getSelection(); this.range = s.rangeCount && this.el.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; }
  restoreRange() { if (!this.range) return this.focusEnd(); this.el.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(this.range); }
  blockAt() {
    const s = getSelection();
    let n = s.anchorNode;
    while (n && n !== this.el) { if (n.nodeType === 1 && /^(P|H[1-6]|LI|BLOCKQUOTE|PRE|DIV|TD|TH)$/.test(n.tagName)) return n; n = n.parentNode; }
    return null;
  }
  closest(sel) { const s = getSelection(); let n = s.anchorNode; if (n && n.nodeType === 3) n = n.parentNode; const c = n && n.closest ? n.closest(sel) : null; return c && this.el.contains(c) ? c : null; }

  insertHTML(html) { this.ensureFocus(); document.execCommand('insertHTML', false, html); this.changed(); }

  async cmd(c) {
    const ex = (k, v = null) => { this.ensureFocus(); document.execCommand(k, false, v); this.fixLists(); this.changed(); };
    switch (c) {
      case 'p': return ex('formatBlock', 'P');
      case 'h1': return ex('formatBlock', 'H1');
      case 'h2': return ex('formatBlock', 'H2');
      case 'h3': return ex('formatBlock', 'H3');
      case 'bold': return ex('bold');
      case 'italic': return ex('italic');
      case 'strike': return ex('strikeThrough');
      case 'undo': return ex('undo');
      case 'redo': return ex('redo');
      case 'hr': return ex('insertHorizontalRule');
      case 'ul': { const ul = this.closest('ul'); if (ul && ul.classList.contains('todo')) { this.untodo(ul); return; } return ex('insertUnorderedList'); }
      case 'ol': return ex('insertOrderedList');
      case 'quote': { const q = this.closest('blockquote'); return ex('formatBlock', q ? 'P' : 'BLOCKQUOTE'); }
      case 'code': {
        this.ensureFocus();
        const s = getSelection();
        const code = this.closest('code');
        if (code) { code.replaceWith(document.createTextNode(code.textContent)); this.changed(); return; }
        const t = s.toString();
        if (t.includes('\n')) return this.insertHTML(`<pre><code>${esc(t)}</code></pre><p><br></p>`);
        return this.insertHTML(`<code>${esc(t || 'codice')}</code>&#8203;`);
      }
      case 'link': return this.link();
      case 'todo': return this.todo();
      case 'table': return this.table();
      case 'image': return this.image();
      case 'drawing': return this.drawing();
      case 'totask': return this.toTask();
    }
  }

  /** Chrome a volte crea <p><ul>…</ul></p>: porta la lista fuori dal paragrafo mantenendo il cursore. */
  fixLists() {
    const bad = $$('p > ul, p > ol', this.el);
    if (!bad.length) return;
    const s = getSelection();
    const a = s.rangeCount ? [s.anchorNode, s.anchorOffset] : null;
    for (const l of bad) {
      const par = l.parentNode;
      par.after(l);
      if (!par.textContent.trim() && !par.querySelector('img')) par.replaceWith();
    }
    if (a && a[0] && this.el.contains(a[0])) { try { s.collapse(a[0], a[1]); } catch (e) { /* */ } }
  }
  untodo(ul) { ul.classList.remove('todo'); $$(':scope > li', ul).forEach(li => li.classList.remove('task-item', 'done')); this.changed(); }
  /** Trasforma il paragrafo corrente in una lista nuova (senza fonderla con quella vicina, come farebbe il browser). */
  newList(tag, todo = false) {
    const b = this.blockAt();
    if (!b || !/^(P|DIV|H[1-6])$/.test(b.tagName)) return false;
    const l = document.createElement(tag);
    if (todo) l.className = 'todo';
    const li = document.createElement('li');
    if (todo) li.className = 'task-item';
    while (b.firstChild) li.appendChild(b.firstChild);
    if (!li.textContent && !li.querySelector('img,br')) li.appendChild(document.createElement('br'));
    l.appendChild(li);
    b.replaceWith(l);
    const s = getSelection();
    const r = document.createRange();
    if (li.lastChild && li.lastChild.nodeName === 'BR' && li.childNodes.length === 1) r.setStart(li, 0); else { r.selectNodeContents(li); r.collapse(false); }
    s.removeAllRanges(); s.addRange(r);
    this.changed();
    return true;
  }
  todo() {
    this.ensureFocus();
    let ul = this.closest('ul');
    if (!ul) {
      if (this.newList('ul', true)) return;
      document.execCommand('insertUnorderedList');
      ul = this.closest('ul');
    } else if (ul.classList.contains('todo')) return this.untodo(ul);
    if (!ul) return;
    ul.classList.add('todo');
    $$(':scope > li', ul).forEach(li => li.classList.add('task-item'));
    this.changed();
  }

  async link() {
    this.saveRange();
    const sel = this.range ? this.range.toString() : '';
    const a = this.closest('a');
    const r = await promptDialog(a ? 'Modifica link' : 'Inserisci link', {
      label: 'Indirizzo', value: a ? a.getAttribute('href') : (/^https?:\/\//.test(sel) ? sel : 'https://'), ok: a ? 'Salva' : 'Inserisci', type: 'url',
      extra: sel || a ? '' : '<label class="flab">Testo</label><input class="field-in" name="txt" placeholder="Testo del link">',
    });
    if (!r) return;
    const href = r.value;
    if (!/^(https?:|mailto:|tel:)/i.test(href)) { toast('Usa un indirizzo che inizia con https://, mailto: o tel:'); return; }
    this.restoreRange();
    if (a) { if (href) a.href = href; this.changed(); return; }
    if (sel) { document.execCommand('createLink', false, href); }
    else {
      const txt = (r.el.querySelector('[name=txt]') || {}).value || href;
      document.execCommand('insertHTML', false, `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(txt)}</a>&nbsp;`);
    }
    this.changed();
  }

  async table() {
    const t = this.closest('table');
    if (t) {
      this.saveRange();
      const cell = this.closest('td,th');
      const op = await choose('Tabella', [
        { label: 'Aggiungi riga sotto', value: 'row', icon: 'plus' },
        { label: 'Aggiungi colonna a destra', value: 'col', icon: 'plus' },
        { label: 'Elimina riga', value: 'delrow', icon: 'trash' },
        { label: 'Elimina colonna', value: 'delcol', icon: 'trash' },
        { label: 'Elimina tabella', value: 'del', icon: 'trash', danger: true },
      ]);
      if (!op || !cell) return;
      const tr = cell.parentElement;
      const idx = [...tr.children].indexOf(cell);
      if (op === 'row') { const n = document.createElement('tr'); n.innerHTML = [...tr.children].map(() => '<td><br></td>').join(''); (tr.parentElement.tagName === 'THEAD' ? t.tBodies[0] || t.createTBody() : tr.parentElement).insertBefore(n, tr.parentElement.tagName === 'THEAD' ? (t.tBodies[0] || {}).firstChild || null : tr.nextSibling); }
      if (op === 'col') $$('tr', t).forEach(r => { const c = document.createElement(r.parentElement.tagName === 'THEAD' ? 'th' : 'td'); c.innerHTML = '<br>'; r.insertBefore(c, r.children[idx + 1] || null); });
      if (op === 'delrow' && tr.parentElement.tagName !== 'THEAD') tr.remove();
      if (op === 'delcol') $$('tr', t).forEach(r => r.children[idx] && r.children[idx].remove());
      if (op === 'del') t.remove();
      this.changed();
      return;
    }
    this.insertHTML('<table><thead><tr><th>Colonna 1</th><th>Colonna 2</th><th>Colonna 3</th></tr></thead><tbody><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table><p><br></p>');
  }

  async image(files) {
    this.saveRange();
    files = files || await pickFile('image/*', true);
    if (!files || !files.length) return;
    if (!store.canWrite()) return;
    for (const f of files) {
      try {
        const p = await prepareImage(f);
        if (p.bytes.length > 12 * 1024 * 1024) { toast('Immagine troppo grande (max 12 MB).'); continue; }
        const id = await store.putBlob({ name: p.name, type: p.type }, p.bytes, this.o.ownerId);
        this.restoreRange();
        document.execCommand('insertHTML', false, `<img data-znk="img/${id}" alt="${esc(p.name)}" class="znk-img loading"><p><br></p>`);
        this.saveRange();
      } catch (e) { toast('Immagine non caricata: ' + e.message); }
    }
    hydrate(this.el);
    this.changed();
  }

  async drawing(existing) {
    if (!this.o.onDraw) return;
    this.saveRange();
    const id = await this.o.onDraw(existing || null);
    if (!id) return;
    if (existing) {
      const img = this.el.querySelector(`img[data-znk="drawing/${existing}"]`);
      if (img) { img.dataset.loaded = ''; hydrate(this.el); }
      this.changed();
      return;
    }
    this.restoreRange();
    document.execCommand('insertHTML', false, `<img data-znk="drawing/${id}" alt="Disegno" class="znk-drawing loading"><p><br></p>`);
    hydrate(this.el);
    this.changed();
  }

  async toTask() {
    const li = this.closest('li.task-item');
    if (!li) { toast('Metti il cursore su una casella da spuntare, poi tocca di nuovo.'); return; }
    if (li.querySelector('a.znk-task')) { toast('Questa casella è già collegata a un\'attività.'); return; }
    if (!this.o.onToTask) return;
    const text = [...li.childNodes].filter(n => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))).map(n => n.textContent).join('').trim();
    if (!text) { toast('Scrivi prima il testo della casella.'); return; }
    const id = await this.o.onToTask(text);
    if (!id) return;
    const a = document.createElement('a');
    a.className = 'znk-task'; a.href = '#'; a.dataset.znk = 'task/' + id; a.textContent = '↗ attività';
    const sub = li.querySelector(':scope > ul, :scope > ol');
    li.insertBefore(document.createTextNode(' '), sub);
    li.insertBefore(a, sub);
    this.changed();
  }

  onKey(e) {
    if (this.ro) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); this.link(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.flush(); toast('Salvato'); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      // Invio alla fine di una citazione: si esce dalla citazione (Maiusc+Invio va a capo dentro).
      const bq = this.closest('blockquote');
      const s = getSelection();
      if (bq && s.rangeCount && s.isCollapsed) {
        const after = document.createRange(); after.selectNodeContents(bq); after.setStart(s.anchorNode, s.anchorOffset);
        if (!after.toString().trim() && !after.cloneContents().querySelector('img,table')) {
          e.preventDefault();
          // Toglie le righe vuote rimaste in fondo alla citazione.
          while (bq.lastChild && ((bq.lastChild.nodeName === 'BR') || (bq.lastChild.nodeType === 1 && /^(P|DIV)$/.test(bq.lastChild.nodeName) && !bq.lastChild.textContent.trim() && !bq.lastChild.querySelector('img')) || (bq.lastChild.nodeType === 3 && !bq.lastChild.textContent.trim()))) bq.lastChild.replaceWith();
          const p = document.createElement('p'); p.appendChild(document.createElement('br'));
          bq.after(p);
          if (!bq.textContent.trim() && !bq.querySelector('img')) bq.replaceWith();
          const r = document.createRange(); r.setStart(p, 0); r.collapse(true); s.removeAllRanges(); s.addRange(r);
          this.changed();
          return;
        }
      }
      const li = this.closest('li.task-item');
      if (li) {
        // Una nuova casella nasce sempre vuota (punto 18).
        setTimeout(() => {
          const cur = this.closest('li');
          if (cur && cur !== li) { cur.classList.add('task-item'); cur.classList.remove('done'); $$('a.znk-task', cur).forEach(a => a.remove()); }
        }, 0);
      }
    }
    if (e.key === 'Tab') {
      const li = this.closest('li');
      if (li) { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); this.changed(); }
    }
    // Scorciatoie Markdown all'inizio di una riga: "# ", "## ", "- ", "1. ", "[] ", "> ".
    if (e.key === ' ') {
      const b = this.blockAt();
      if (b && (b.tagName === 'P' || b.tagName === 'DIV')) {
        const s = getSelection();
        const txt = b.textContent;
        const r = s.getRangeAt(0);
        const pre = document.createRange(); pre.selectNodeContents(b); pre.setEnd(r.endContainer, r.endOffset);
        const before = pre.toString();
        const map = { '#': 'H1', '##': 'H2', '###': 'H3', '>': 'BLOCKQUOTE' };
        if (before === txt && (map[before] || before === '-' || before === '*' || before === '1.' || before === '[]')) {
          e.preventDefault();
          b.textContent = '';
          b.appendChild(document.createElement('br'));
          const rr = document.createRange(); rr.setStart(b, 0); rr.collapse(true); s.removeAllRanges(); s.addRange(rr);
          if (map[before]) document.execCommand('formatBlock', false, map[before]);
          else if (!this.newList(before === '1.' ? 'ol' : 'ul', before === '[]')) document.execCommand(before === '1.' ? 'insertOrderedList' : 'insertUnorderedList');
          this.fixLists();
          this.changed();
        }
      }
    }
  }

  onClick(e) {
    const li = e.target.closest('li.task-item');
    if (li && e.target === li) {
      const r = li.getBoundingClientRect();
      if (e.clientX - r.left < 28) {
        e.preventDefault();
        if (this.ro && !this.o.allowCheck) return;
        li.classList.toggle('done');
        if (this.ro) { this.o.onCheck && this.o.onCheck(htmlToMd(this.el)); return; }
        this.emit();
        return;
      }
    }
    const ref = e.target.closest('[data-znk]');
    if (ref) {
      const v = ref.dataset.znk;
      if (ref.tagName === 'A') e.preventDefault();
      if (v.startsWith('drawing/')) { if (!this.ro) this.drawing(v.split('/')[1]); else this.o.onOpenRef && this.o.onOpenRef(v); return; }
      if (ref.tagName === 'A' || ref.tagName === 'IMG') { this.o.onOpenRef && this.o.onOpenRef(v); return; }
    }
    const a = e.target.closest('a[href]');
    if (a && !a.dataset.znk && (this.ro || e.ctrlKey || e.metaKey)) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
  }

  onPaste(e) {
    if (this.ro) { e.preventDefault(); return; }
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...cd.files].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); this.image(files); return; }
    const html = cd.getData('text/html');
    if (html) {
      e.preventDefault();
      // Il contenuto incollato passa dal Markdown: resta solo ciò che si può salvare.
      const md = htmlToMd(sanitize(html).replace(/<img[^>]*>/gi, ''));
      document.execCommand('insertHTML', false, mdToHtml(md));
      this.changed();
      return;
    }
    const text = cd.getData('text/plain');
    if (text && /(^|\n)(#{1,3} |- \[[ x]\] |[-*] |\d+\. |> )/.test(text)) {
      e.preventDefault();
      document.execCommand('insertHTML', false, mdToHtml(text));
      this.changed();
    }
  }

  onDrop(e) {
    if (this.ro) return;
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (pos) { const s = getSelection(); s.removeAllRanges(); s.addRange(pos); }
    this.image(files);
  }
}
