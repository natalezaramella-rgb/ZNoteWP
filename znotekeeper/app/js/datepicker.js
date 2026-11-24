// Selettore di data in italiano (punto 24): settimana da lunedì, formato gg/mm/aaaa.
import { ic } from './icons.js';
import { sheet, closeOverlay, isoDay, today, parseDay, esc } from './ui.js';

const WD = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];

/** @returns {Promise<string|null|undefined>} 'AAAA-MM-GG', '' per togliere la data, undefined se annullato. */
export function pickDate(current, title = 'Scadenza') {
  return new Promise(res => {
    let done = false;
    const t = today();
    let view = current ? parseDay(current) : new Date(t);
    view.setDate(1);
    const add = n => { const d = new Date(t); d.setDate(d.getDate() + n); return isoDay(d); };
    const nextMon = () => { const d = new Date(t); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return isoDay(d); };
    const el = sheet(`<h3>${esc(title)}</h3><div class="cal">
      <div class="quick"><button class="chip" data-d="${add(0)}">Oggi</button><button class="chip" data-d="${add(1)}">Domani</button><button class="chip" data-d="${nextMon()}">Lunedì prossimo</button><button class="chip" data-d="${add(7)}">Tra una settimana</button>${current ? '<button class="chip late" data-d="">Nessuna data</button>' : ''}</div>
      <div class="ch"><button class="ib" data-m="-1" aria-label="Mese precedente">${ic('back')}</button><b></b><button class="ib" data-m="1" aria-label="Mese successivo">${ic('fwd')}</button></div>
      <table><thead><tr>${WD.map(d => `<th>${d}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
      <div class="row-end"><button class="btn ghost" data-close>Annulla</button></div>`, { onClose: () => { if (!done) res(undefined); } });
    const draw = () => {
      el.querySelector('.ch b').textContent = view.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
      const start = new Date(view);
      start.setDate(1 - ((view.getDay() + 6) % 7));
      let html = '';
      for (let w = 0; w < 6; w++) {
        html += '<tr>';
        for (let i = 0; i < 7; i++) {
          const d = new Date(start); d.setDate(start.getDate() + w * 7 + i);
          const iso = isoDay(d);
          const cls = [d.getMonth() !== view.getMonth() ? 'other' : '', iso === isoDay(t) ? 'today' : '', iso === current ? 'on' : ''].join(' ');
          html += `<td><button class="${cls}" data-d="${iso}" aria-label="${d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}">${d.getDate()}</button></td>`;
        }
        html += '</tr>';
        if (w >= 4) { const n = new Date(start); n.setDate(start.getDate() + (w + 1) * 7); if (n.getMonth() !== view.getMonth()) break; }
      }
      el.querySelector('tbody').innerHTML = html;
    };
    el.addEventListener('click', e => {
      const m = e.target.closest('[data-m]');
      if (m) { view.setMonth(view.getMonth() + +m.dataset.m); draw(); return; }
      const d = e.target.closest('[data-d]');
      if (d) { done = true; closeOverlay(); res(d.dataset.d); }
    });
    draw();
  });
}
