// Pagina pubblica del link monouso: legge la chiave dal frammento "#", che non arriva mai al sito,
// chiede il dato cifrato solo quando il cliente preme "Mostra" e lo decifra nel browser.
(function () {
  'use strict';
  var CFG = JSON.parse(document.getElementById('znk-access').textContent);
  var box = document.getElementById('box');
  var te = new TextEncoder();
  var td = new TextDecoder();

  var params = new URLSearchParams(location.search);
  var token = params.get('t') || '';
  var key = location.hash.replace(/^#/, '');
  // Il frammento non resta nella barra degli indirizzi né nella cronologia.
  if (key) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* */ } }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function clear() { while (box.children.length > 1) box.removeChild(box.lastChild); }
  function say(title, text, cls) {
    clear();
    box.appendChild(el('h1', null, title));
    var p = el('p', cls ? { 'class': cls } : null, text);
    box.appendChild(p);
    return p;
  }
  function when(iso) {
    var d = new Date(iso);
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) + ' alle ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function url(path) {
    // Senza permalink il prefisso REST è "?rest_route=/znk/v1/": il percorso va attaccato così com'è.
    return CFG.rest + path;
  }
  function post(path, body) {
    return fetch(url(path), { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); });
  }
  function unb64(s) {
    var b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    var u = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  function sha256hex(s) {
    return crypto.subtle.digest('SHA-256', te.encode(s)).then(function (h) {
      return Array.prototype.map.call(new Uint8Array(h), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function gone(st) {
    if (st.state === 'viewed') say('Link già usato', 'Questo link è già stato aperto' + (st.viewed_at ? ' il ' + when(st.viewed_at) : '') + ' e la password non si può più vedere. Se non sei stato tu, o l\'hai persa, rispondi all\'email che hai ricevuto e chiedi un nuovo link.', 'bad');
    else if (st.state === 'expired') say('Link scaduto', 'Il link non è più valido. Rispondi all\'email che hai ricevuto e chiedi un nuovo link.', 'bad');
    else if (st.state === 'revoked') say('Link non più valido', 'Questo link è stato sostituito o annullato. Usa il link dell\'email più recente, oppure chiedine uno nuovo.', 'bad');
    else say('Link non valido', 'Controlla di aver aperto il link per intero, così come è arrivato nell\'email.', 'bad');
  }
  function field(label, value, opts) {
    opts = opts || {};
    var row = el('div', { 'class': 'field' });
    row.appendChild(el('div', { 'class': 'lab' }, label));
    var line = el('div', { 'class': 'val' });
    var v;
    if (opts.link && /^https?:\/\//i.test(value)) v = el('a', { href: value, rel: 'noopener noreferrer', target: '_blank' }, value);
    else v = el('code', null, value);
    if (opts.secret) v.className = 'secret';
    line.appendChild(v);
    var b = el('button', { type: 'button' }, 'Copia');
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(value).then(function () { b.textContent = 'Copiata'; setTimeout(function () { b.textContent = 'Copia'; }, 1800); }, function () { b.textContent = 'Seleziona e copia'; });
    });
    line.appendChild(b);
    row.appendChild(line);
    return row;
  }

  if (!token || !key || !/^[A-Za-z0-9_-]{43}$/.test(key)) {
    gone({ state: 'invalid' });
    return;
  }
  if (!window.crypto || !crypto.subtle) {
    say('Browser non adatto', 'Apri il link con un browser aggiornato (Chrome, Edge, Firefox o Safari).', 'bad');
    return;
  }

  post('access/check', { t: token }).then(function (r) {
    var st = r.j || {};
    if (st.state !== 'active') { gone(st); return; }
    var p = say('Dati di accesso', 'Qui puoi leggere la tua password iniziale. Si può vedere una sola volta: tienila a portata di mano per copiarla subito.');
    p.after(el('p', { 'class': 'muted' }, 'Il link vale fino al ' + when(st.expires_at) + '.'));
    var btn = el('button', { type: 'button', 'class': 'primary' }, 'Mostra la password');
    box.appendChild(btn);
    btn.addEventListener('click', function () {
      btn.disabled = true; btn.textContent = 'Un attimo…';
      sha256hex('znk-kc:' + key).then(function (kc) { return post('access/reveal', { t: token, key_check: kc }); }).then(function (r2) {
        if (!r2.ok) {
          if (r2.j && r2.j.code === 'znk_bad_key') { say('Link incompleto', r2.j.message, 'bad'); return; }
          gone(r2.j || {});
          return;
        }
        var pl = r2.j.payload;
        return crypto.subtle.importKey('raw', unb64(key), { name: 'AES-GCM' }, false, ['decrypt'])
          .then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(pl.iv), additionalData: te.encode('znk-access-v1') }, k, unb64(pl.ct)); })
          .then(function (buf) {
            var d = JSON.parse(td.decode(buf));
            clear();
            box.appendChild(el('h1', null, d.software ? 'Accesso a ' + d.software : 'Dati di accesso'));
            if (d.client) box.appendChild(el('p', { 'class': 'muted' }, 'Per ' + d.client));
            if (d.url) box.appendChild(field('Indirizzo', d.url, { link: true }));
            if (d.username) box.appendChild(field('Nome utente', d.username));
            box.appendChild(field('Password iniziale', d.password, { secret: true }));
            box.appendChild(el('p', { 'class': 'warn' }, 'Copia la password adesso: chiudendo o ricaricando questa pagina non sarà più visibile. Al primo accesso cambiala con una tua.'));
          }, function () {
            say('Link incompleto', 'Non riesco a leggere la password: il link non è arrivato per intero. Chiedi un nuovo link rispondendo all\'email.', 'bad');
          });
      }).catch(function () {
        btn.disabled = false; btn.textContent = 'Riprova';
      });
    });
  }).catch(function () {
    say('Nessuna connessione', 'Non riesco a contattare il sito. Controlla la connessione e ricarica la pagina.', 'bad');
  });
})();
