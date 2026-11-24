// Disegno a mano libera: tratti vettoriali su un foglio fisso 800×1000, uguale su telefono e PC.
import { ic } from './icons.js';
import { $, $$, esc, confirmDialog } from './ui.js';

export const SHEET_W = 800;
export const SHEET_H = 1000;
const COLORS = ['#17211E', '#B3261E', '#D9640F', '#F2C200', '#1E8A4C', '#2F62C9', '#7A47C2'];

export const emptyDrawing = () => ({ v: 1, w: SHEET_W, h: SHEET_H, strokes: [] });

function pathStroke(cx, s) {
  const p = s.p;
  cx.strokeStyle = s.c;
  cx.fillStyle = s.c;
  cx.lineWidth = s.t === 'hl' ? s.s * 3 : s.s;
  cx.globalAlpha = s.t === 'hl' ? 0.35 : 1;
  cx.lineCap = s.t === 'hl' ? 'butt' : 'round';
  cx.lineJoin = 'round';
  cx.beginPath();
  if (s.t === 'pen' || s.t === 'hl') {
    if (p.length === 2) { cx.arc(p[0], p[1], cx.lineWidth / 2, 0, Math.PI * 2); cx.fill(); cx.globalAlpha = 1; return; }
    cx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) {
      const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      cx.quadraticCurveTo(p[i], p[i + 1], mx, my);
    }
    cx.lineTo(p[p.length - 2], p[p.length - 1]);
  } else {
    const [x1, y1, x2, y2] = [p[0], p[1], p[p.length - 2], p[p.length - 1]];
    if (s.t === 'line' || s.t === 'arrow') {
      cx.moveTo(x1, y1); cx.lineTo(x2, y2);
      if (s.t === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1), L = 14 + s.s * 2;
        cx.moveTo(x2, y2); cx.lineTo(x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45));
        cx.moveTo(x2, y2); cx.lineTo(x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45));
      }
    } else if (s.t === 'rect') {
      cx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (s.t === 'ellipse') {
      cx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    }
  }
  cx.stroke();
  cx.globalAlpha = 1;
}

function bbox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const w = (s.t === 'hl' ? s.s * 3 : s.s) / 2 + 16;
    for (let i = 0; i < s.p.length; i += 2) {
      x0 = Math.min(x0, s.p[i] - w); y0 = Math.min(y0, s.p[i + 1] - w);
      x1 = Math.max(x1, s.p[i] + w); y1 = Math.max(y1, s.p[i + 1] + w);
    }
  }
  return x0 === Infinity ? null : { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(SHEET_W, x1), y1: Math.min(SHEET_H, y1) };
}

/** Disegna su canvas; con crop l'anteprima è ritagliata sui tratti. */
export function renderDrawing(data, { maxW = 800, crop = true, scale = 2 } = {}) {
  const strokes = (data && data.strokes) || [];
  let b = crop ? bbox(strokes) : null;
  if (!b) b = { x0: 0, y0: 0, x1: crop ? 400 : SHEET_W, y1: crop ? 160 : SHEET_H };
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const k = Math.min(1, maxW / w) * scale;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const cx = c.getContext('2d');
  cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, c.width, c.height);
  cx.setTransform(k, 0, 0, k, -b.x0 * k, -b.y0 * k);
  for (const s of strokes) pathStroke(cx, s);
  return c;
}
export function drawingToBlobURL(data, opts) {
  const c = renderDrawing(data, opts);
  return new Promise(res => c.toBlob(b => res(URL.createObjectURL(b)), 'image/png'));
}
export function drawingToPNG(data, opts) {
  const c = renderDrawing(data, opts);
  return new Promise(res => c.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), 'image/png'));
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l = dx * dx + dy * dy;
  let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function hits(s, x, y, r) {
  const p = s.p;
  const w = (s.t === 'hl' ? s.s * 3 : s.s) / 2 + r;
  if (s.t === 'pen' || s.t === 'hl' || s.t === 'line' || s.t === 'arrow') {
    if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) < w;
    for (let i = 0; i < p.length - 2; i += 2) if (distToSeg(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) < w) return true;
    return false;
  }
  const [x1, y1, x2, y2] = [p[0], p[1], p[p.length - 2], p[p.length - 1]];
  const l = Math.min(x1, x2), rr = Math.max(x1, x2), t = Math.min(y1, y2), bb = Math.max(y1, y2);
  if (s.t === 'rect') {
    const near = (v, a) => Math.abs(v - a) < w;
    return ((near(x, l) || near(x, rr)) && y > t - w && y < bb + w) || ((near(y, t) || near(y, bb)) && x > l - w && x < rr + w);
  }
  const cxx = (l + rr) / 2, cyy = (t + bb) / 2, ax = (rr - l) / 2 || 1, ay = (bb - t) / 2 || 1;
  const d = Math.hypot((x - cxx) / ax, (y - cyy) / ay);
  return Math.abs(d - 1) * Math.min(ax, ay) < w;
}

/**
 * Apre l'editor di disegno a tutto schermo.
 * @returns {Promise<object|null>} i dati salvati, oppure null se si chiude senza salvare.
 */
export function openDrawEditor({ data, title = 'Disegno', readonly = false }) {
  return new Promise(resolve => {
    const host = document.getElementById('app');
    const el = document.createElement('section');
    el.className = 'screen drawscreen full';
    el.innerHTML = `
      <div class="topbar">
        <button class="ib" data-a="close" aria-label="Chiudi">${ic('close')}</button>
        <div class="grow"><div class="apptitle">Disegno</div><div class="crumb">${esc(title)}</div></div>
        <button class="ib" data-a="undo" aria-label="Annulla" title="Annulla (Ctrl+Z)">${ic('undo')}</button>
        <button class="ib" data-a="redo" aria-label="Ripristina" title="Ripristina (Ctrl+Y)">${ic('redo')}</button>
        ${readonly ? '' : '<button class="btn primary small" data-a="save">Salva</button>'}
      </div>
      <div class="paper"><canvas></canvas><div class="zoominfo"><button data-a="zout" aria-label="Riduci">−</button><span class="zl">100%</span><button data-a="zin" aria-label="Ingrandisci">+</button><button data-a="fit" aria-label="Adatta">${ic('zoomfit', 'sm')}</button></div></div>
      <div class="dtools" ${readonly ? 'hidden' : ''}>
        <div class="r">
          <button class="tool" data-tool="pen" aria-pressed="true" aria-label="Penna" title="Penna (P)">${ic('pen')}</button>
          <button class="tool" data-tool="hl" aria-pressed="false" aria-label="Evidenziatore" title="Evidenziatore (H)">${ic('hl')}</button>
          <button class="tool" data-tool="eraser" aria-pressed="false" aria-label="Gomma" title="Gomma: cancella i tratti toccati (E)">${ic('eraser')}</button>
          <button class="tool" data-tool="line" aria-pressed="false" aria-label="Linea">${ic('line')}</button>
          <button class="tool" data-tool="arrow" aria-pressed="false" aria-label="Freccia">${ic('arrow')}</button>
          <button class="tool" data-tool="rect" aria-pressed="false" aria-label="Rettangolo">${ic('rect')}</button>
          <button class="tool" data-tool="ellipse" aria-pressed="false" aria-label="Ellisse">${ic('circle')}</button>
          <button class="tool" data-tool="hand" aria-pressed="false" aria-label="Sposta il foglio" title="Sposta (barra spaziatrice)">${ic('hand')}</button>
          <span style="flex:1"></span>
          <button class="tool" data-a="clear" aria-label="Cancella tutto">${ic('trash')}</button>
        </div>
        <div class="r">${COLORS.map((c, i) => `<button class="sw" data-color="${c}" aria-pressed="${i === 0}" style="background:${c}" aria-label="Colore ${i + 1}"></button>`).join('')}
          <span class="lbl" style="margin-left:8px">Spessore</span><input type="range" min="1" max="30" value="4" aria-label="Spessore"></div>
      </div>`;
    host.appendChild(el);
    const paper = $('.paper', el);
    const cv = $('canvas', el);
    const cx = cv.getContext('2d');
    const D = {
      strokes: structuredClone((data && data.strokes) || []),
      undo: [], redo: [], tool: 'pen', color: COLORS[0], size: 4,
      s: 1, ox: 0, oy: 0, cur: null, pointers: new Map(), pinch: null, pan: null, dirty: false, penSeen: false, space: false,
    };
    let dpr = window.devicePixelRatio || 1;
    let cache = document.createElement('canvas');
    let cacheValid = false;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const r = paper.getBoundingClientRect();
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      cache.width = cv.width; cache.height = cv.height;
      cacheValid = false;
      paint();
    };
    const fit = () => {
      const r = paper.getBoundingClientRect();
      D.s = Math.min((r.width - 24) / SHEET_W, (r.height - 24) / SHEET_H);
      if (r.width < 600) D.s = Math.max(D.s, (r.width - 16) / SHEET_W);
      D.ox = (r.width - SHEET_W * D.s) / 2;
      D.oy = Math.max(12, (r.height - SHEET_H * D.s) / 2);
      cacheValid = false;
      paint();
    };
    const toSheet = (e) => {
      const r = cv.getBoundingClientRect();
      return [Math.round(((e.clientX - r.left) - D.ox) / D.s * 10) / 10, Math.round(((e.clientY - r.top) - D.oy) / D.s * 10) / 10];
    };
    function renderCache() {
      const c = cache.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cache.width, cache.height);
      c.setTransform(dpr * D.s, 0, 0, dpr * D.s, dpr * D.ox, dpr * D.oy);
      c.fillStyle = '#FFFFFF';
      c.shadowColor = 'rgba(0,0,0,.18)'; c.shadowBlur = 12;
      c.fillRect(0, 0, SHEET_W, SHEET_H);
      c.shadowBlur = 0;
      c.fillStyle = '#D5DCD9';
      for (let x = 20; x < SHEET_W; x += 25) for (let y = 20; y < SHEET_H; y += 25) c.fillRect(x - 0.9, y - 0.9, 1.8, 1.8);
      c.save(); c.beginPath(); c.rect(0, 0, SHEET_W, SHEET_H); c.clip();
      for (const s of D.strokes) pathStroke(c, s);
      c.restore();
      cacheValid = true;
    }
    function paint() {
      if (!cacheValid) renderCache();
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.drawImage(cache, 0, 0);
      if (D.cur) {
        cx.setTransform(dpr * D.s, 0, 0, dpr * D.s, dpr * D.ox, dpr * D.oy);
        cx.save(); cx.beginPath(); cx.rect(0, 0, SHEET_W, SHEET_H); cx.clip();
        pathStroke(cx, D.cur);
        cx.restore();
      }
      $('.zl', el).textContent = Math.round(D.s * 100) + '%';
    }
    const snapshot = () => { D.undo.push(D.strokes.slice()); if (D.undo.length > 200) D.undo.shift(); D.redo = []; D.dirty = true; };
    const zoomAt = (f, px, py) => {
      const ns = Math.max(0.2, Math.min(6, D.s * f));
      D.ox = px - (px - D.ox) * (ns / D.s);
      D.oy = py - (py - D.oy) * (ns / D.s);
      D.s = ns; cacheValid = false; paint();
    };
    const erase = (x, y) => {
      const r = 8 / D.s;
      const keep = D.strokes.filter(s => !hits(s, x, y, r));
      if (keep.length !== D.strokes.length) { D.strokes = keep; cacheValid = false; paint(); }
    };

    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      if (e.pointerType === 'pen') D.penSeen = true;
      D.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      const touches = [...D.pointers.values()].filter(p => p.type === 'touch');
      if (touches.length >= 2) {
        D.cur = null;
        const [a, b] = touches;
        D.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, s: D.s, ox: D.ox, oy: D.oy };
        if (D.undo.length && D.pendingTouchStroke) { D.strokes = D.undo.pop(); cacheValid = false; }
        D.pendingTouchStroke = false;
        paint();
        return;
      }
      const panning = readonly || D.tool === 'hand' || D.space || e.button === 1 || (e.pointerType === 'touch' && D.penSeen);
      if (panning) { D.pan = { x: e.clientX, y: e.clientY, ox: D.ox, oy: D.oy }; return; }
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const [x, y] = toSheet(e);
      if (D.tool === 'eraser') { snapshot(); D.erasing = true; erase(x, y); return; }
      D.cur = { t: D.tool, c: D.color, s: D.size, p: [x, y] };
      paint();
    });
    cv.addEventListener('pointermove', e => {
      if (!D.pointers.has(e.pointerId)) return;
      D.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      if (D.pinch) {
        const touches = [...D.pointers.values()].filter(p => p.type === 'touch');
        if (touches.length < 2) return;
        const [a, b] = touches;
        const r = cv.getBoundingClientRect();
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const ns = Math.max(0.2, Math.min(6, D.pinch.s * d / D.pinch.d));
        const px = D.pinch.mx - r.left, py = D.pinch.my - r.top;
        D.ox = px - (px - D.pinch.ox) * (ns / D.pinch.s) + (mx - D.pinch.mx);
        D.oy = py - (py - D.pinch.oy) * (ns / D.pinch.s) + (my - D.pinch.my);
        D.s = ns; cacheValid = false; paint();
        return;
      }
      if (D.pan) { D.ox = D.pan.ox + e.clientX - D.pan.x; D.oy = D.pan.oy + e.clientY - D.pan.y; cacheValid = false; paint(); return; }
      if (D.erasing) { const [x, y] = toSheet(e); erase(x, y); return; }
      if (!D.cur) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs) {
        const [x, y] = toSheet(ev);
        if (D.cur.t === 'pen' || D.cur.t === 'hl') {
          const p = D.cur.p;
          if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) >= 1.2) p.push(x, y);
        } else {
          D.cur.p = [D.cur.p[0], D.cur.p[1], x, y];
        }
      }
      paint();
    });
    const end = e => {
      D.pointers.delete(e.pointerId);
      if (D.pinch) { if (D.pointers.size === 0) D.pinch = null; return; }
      if (D.pan) { D.pan = null; return; }
      if (D.erasing) { D.erasing = false; return; }
      if (D.cur) {
        snapshot();
        D.pendingTouchStroke = e.pointerType === 'touch';
        setTimeout(() => { D.pendingTouchStroke = false; }, 250);
        D.strokes.push(D.cur);
        D.cur = null;
        cacheValid = false; paint();
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', e => { D.cur = null; end(e); paint(); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      else { D.ox -= e.deltaX; D.oy -= e.deltaY; cacheValid = false; paint(); }
    }, { passive: false });

    const setTool = t => { D.tool = t; $$('[data-tool]', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t))); };
    const doUndo = () => { if (!D.undo.length) return; D.redo.push(D.strokes); D.strokes = D.undo.pop(); D.dirty = true; cacheValid = false; paint(); };
    const doRedo = () => { if (!D.redo.length) return; D.undo.push(D.strokes); D.strokes = D.redo.pop(); D.dirty = true; cacheValid = false; paint(); };
    const finish = async save => {
      if (!save && D.dirty && !readonly && !(await confirmDialog('Chiudere senza salvare?', 'Le modifiche al disegno andranno perse.', { ok: 'Chiudi', danger: true }))) return;
      cleanup();
      resolve(save ? { v: 1, w: SHEET_W, h: SHEET_H, strokes: D.strokes } : null);
    };
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-tool]');
      if (t) return setTool(t.dataset.tool);
      const c = e.target.closest('[data-color]');
      if (c) { D.color = c.dataset.color; $$('[data-color]', el).forEach(b => b.setAttribute('aria-pressed', String(b === c))); if (D.tool === 'eraser' || D.tool === 'hand') setTool('pen'); return; }
      const a = e.target.closest('[data-a]');
      if (!a) return;
      const r = cv.getBoundingClientRect();
      ({
        close: () => finish(false),
        save: () => finish(true),
        undo: doUndo,
        redo: doRedo,
        clear: async () => { if (!D.strokes.length) return; if (await confirmDialog('Cancellare tutto il foglio?', 'Puoi annullare subito dopo.', { ok: 'Cancella', danger: true })) { snapshot(); D.strokes = []; cacheValid = false; paint(); } },
        zin: () => zoomAt(1.25, r.width / 2, r.height / 2),
        zout: () => zoomAt(0.8, r.width / 2, r.height / 2),
        fit,
      })[a.dataset.a]?.();
    });
    $('input[type=range]', el).addEventListener('input', e => { D.size = +e.target.value; });
    const onKey = e => {
      if (e.target.closest && e.target.closest('input,textarea')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); finish(true); }
      else if (k === 'escape') finish(false);
      else if (k === ' ') { D.space = true; e.preventDefault(); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const map = { p: 'pen', h: 'hl', e: 'eraser', l: 'line', r: 'rect', o: 'ellipse', a: 'arrow' };
        if (map[k]) setTool(map[k]);
      }
    };
    const onKeyUp = e => { if (e.key === ' ') D.space = false; };
    const ro = new ResizeObserver(() => resize());
    function cleanup() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKeyUp, true);
      ro.disconnect();
      el.remove();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);
    ro.observe(paper);
    requestAnimationFrame(() => { resize(); fit(); });
  });
}
