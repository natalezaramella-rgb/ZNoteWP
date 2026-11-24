// Chiamate all'API REST del plugin.
export const CFG = JSON.parse(document.getElementById('znk-config').textContent);

let token = null;
let session = null;
let onAuth = null;

export const setToken = t => { token = t; };
export const getToken = () => token;
export const setSession = s => { session = s; };
export const hasSession = () => !!session;
export const onAuthError = fn => { onAuth = fn; };

export class ApiError extends Error {
  constructor(msg, status, code, data) { super(msg); this.status = status; this.code = code; this.data = data || {}; }
}

export function url(path) {
  const [p, q] = path.split('?');
  const base = CFG.rest;
  if (base.includes('?')) return base + p + (q ? '&' + q : '');
  return base + p + (q ? '?' + q : '');
}

export async function api(method, path, body, opts = {}) {
  const headers = { 'Accept': 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-ZNK-Token'] = token;
  if (session) headers['X-ZNK-Session'] = session;
  if (opts.nonce) headers['X-WP-Nonce'] = opts.nonce;
  let res;
  try {
    res = await fetch(url(path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: opts.nonce ? 'same-origin' : 'omit',
      cache: 'no-store',
    });
  } catch (e) {
    throw new ApiError('Nessuna connessione con il sito.', 0, 'offline');
  }
  let json = null;
  try { json = await res.json(); } catch (e) { /* risposta vuota */ }
  if (!res.ok) {
    const err = new ApiError((json && json.message) || `Errore del server (${res.status}).`, res.status, json && json.code, json && json.data);
    if (onAuth && ['znk_locked', 'znk_no_device', 'znk_disabled'].includes(err.code) && !opts.quiet) onAuth(err);
    throw err;
  }
  return json;
}

export const isOffline = e => e && e.code === 'offline';
