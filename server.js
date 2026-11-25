// Panel de administración · Inspecciones Ferronol
// Node.js sin dependencias. Datos persistentes en DATA_DIR (volumen de EasyPanel).
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';
const SESSION_HOURS = +process.env.SESSION_HOURS || 12;
const MAX_VERSIONES = 50;

const GUIAS = {
  tecnico: { titulo: 'Manual técnico', sub: 'Solo para ti' },
  administrador: { titulo: 'Guía del administrador', sub: 'Para el cliente' },
  trabajador: { titulo: 'Guía del trabajador', sub: 'Para quien reporta' },
};

if (!ADMIN_USER || !ADMIN_PASSWORD || SESSION_SECRET.length < 32) {
  console.error('Faltan variables: ADMIN_USER, ADMIN_PASSWORD y SESSION_SECRET (mínimo 32 caracteres).');
  process.exit(1);
}

// ---------------------------------------------------------------- datos (siembra inicial en el volumen)
const dir = (...p) => path.join(DATA_DIR, ...p);
function sembrar() {
  fs.mkdirSync(dir('guias'), { recursive: true });
  fs.mkdirSync(dir('versiones'), { recursive: true });
  for (const id of Object.keys(GUIAS)) {
    if (!fs.existsSync(dir('guias', id + '.html'))) fs.copyFileSync(path.join(__dirname, 'seed', 'guias', id + '.html'), dir('guias', id + '.html'));
  }
  if (!fs.existsSync(dir('enlaces.json'))) fs.copyFileSync(path.join(__dirname, 'seed', 'enlaces.json'), dir('enlaces.json'));
}
sembrar();

// ---------------------------------------------------------------- sesión
const b64 = (s) => Buffer.from(s).toString('base64url');
const firma = (s) => crypto.createHmac('sha256', SESSION_SECRET).update(s).digest('base64url');
function crearSesion() {
  const datos = b64(JSON.stringify({ u: ADMIN_USER, sid: crypto.randomBytes(12).toString('hex'), exp: Date.now() + SESSION_HOURS * 3600e3 }));
  return datos + '.' + firma(datos);
}
function leerSesion(req) {
  const m = /(?:^|;\s*)panel=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [datos, f] = m[1].split('.');
  if (!datos || !f) return null;
  const esperado = firma(datos);
  if (f.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(f), Buffer.from(esperado))) return null;
  try {
    const s = JSON.parse(Buffer.from(datos, 'base64url').toString());
    return s.exp > Date.now() && s.u === ADMIN_USER ? s : null;
  } catch { return null; }
}
const csrfDe = (s) => firma('csrf:' + s.sid);
const cookie = (v, maxAge) => `panel=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;
const igual = (a, b) => { const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest(); return crypto.timingSafeEqual(x, y); };

// límite de intentos de acceso: 5 fallos por IP en 15 minutos
const fallos = new Map();
const ipDe = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
function bloqueado(ip) {
  const f = fallos.get(ip);
  if (!f) return false;
  if (Date.now() - f.desde > 15 * 60e3) { fallos.delete(ip); return false; }
  return f.n >= 5;
}

// ---------------------------------------------------------------- utilidades HTTP
const SEG = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN',
  'Strict-Transport-Security': 'max-age=31536000',
};
function enviar(res, code, body, tipo = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': tipo, 'Cache-Control': 'no-store', ...SEG, ...extra });
  res.end(body);
}
const json = (res, code, obj) => enviar(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
function cuerpo(req, max = 5 * 1024 * 1024) {
  return new Promise((ok, ko) => {
    let n = 0; const partes = [];
    req.on('data', (c) => { n += c.length; if (n > max) { ko(new Error('demasiado grande')); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', ko);
  });
}
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
async function estatico(res, nombre) {
  const f = path.join(__dirname, 'public', path.basename(nombre));
  try { enviar(res, 200, await fsp.readFile(f), TIPOS[path.extname(f)] || 'application/octet-stream'); }
  catch { enviar(res, 404, 'No encontrado', 'text/plain; charset=utf-8'); }
}

// ---------------------------------------------------------------- guías
const rutaGuia = (id) => dir('guias', id + '.html');
async function guardarGuia(id, html) {
  const actual = await fsp.readFile(rutaGuia(id), 'utf8');
  if (actual === html) return;
  const vdir = dir('versiones', id);
  await fsp.mkdir(vdir, { recursive: true });
  await fsp.writeFile(path.join(vdir, new Date().toISOString().replace(/[:.]/g, '-') + '.html'), actual);
  const vs = (await fsp.readdir(vdir)).sort();
  for (const v of vs.slice(0, Math.max(0, vs.length - MAX_VERSIONES))) await fsp.unlink(path.join(vdir, v));
  const tmp = rutaGuia(id) + '.tmp';
  await fsp.writeFile(tmp, html);
  await fsp.rename(tmp, rutaGuia(id));
}
async function versiones(id) {
  try { return (await fsp.readdir(dir('versiones', id))).filter((v) => v.endsWith('.html')).sort().reverse(); }
  catch { return []; }
}
// modo edición: los <script> de la guía se desactivan (para que no modifiquen la página mientras se edita)
// y se inyecta el editor. Al guardar, el editor los restaura tal cual.
function modoEdicion(html, csrf) {
  const desactivado = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, js) =>
    `<script type="text/x-panel-desactivado" data-panel-attrs="${Buffer.from(attrs).toString('base64')}">${js}</script>`);
  const inyectar = `<meta name="panel-csrf" content="${csrf}" data-panel-editor><script src="/static/editor.js" data-panel-editor></script>`;
  return desactivado.includes('</body>') ? desactivado.replace('</body>', inyectar + '</body>') : desactivado + inyectar;
}

// ---------------------------------------------------------------- estado del sistema (n8n + Evolution), caché 30 s
let cacheEstado = { t: 0, v: null };
async function pedir(url, headers) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    const t = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return JSON.parse(t);
  } finally { clearTimeout(to); }
}
async function estado() {
  if (Date.now() - cacheEstado.t < 30e3 && cacheEstado.v) return cacheEstado.v;
  const N8N = (process.env.N8N_URL || '').replace(/\/$/, ''), NK = process.env.N8N_API_KEY;
  const EVO = (process.env.EVOLUTION_URL || '').replace(/\/$/, ''), EK = process.env.EVOLUTION_APIKEY, INST = process.env.EVOLUTION_INSTANCE || 'optimizador';
  const PREF = process.env.WORKFLOW_PREFIX || 'Inspecciones';
  const out = { actualizado: new Date().toISOString(), n8n: null, evolution: null, n8nUrl: N8N };
  if (N8N && NK) {
    try {
      const H = { 'X-N8N-API-KEY': NK };
      const wfs = (await pedir(`${N8N}/api/v1/workflows?limit=250`, H)).data.filter((w) => w.name.startsWith(PREF) && !w.isArchived);
      out.n8n = { workflows: [] };
      for (const w of wfs) {
        const ex = (await pedir(`${N8N}/api/v1/executions?workflowId=${w.id}&limit=50`, H)).data || [];
        const dia = ex.filter((e) => Date.now() - new Date(e.startedAt) < 24 * 3600e3);
        out.n8n.workflows.push({
          id: w.id, nombre: w.name, activo: w.active,
          ultima: ex[0] ? { estado: ex[0].status, fecha: ex[0].startedAt } : null,
          ok24: dia.filter((e) => e.status === 'success').length, error24: dia.filter((e) => e.status === 'error').length,
          errores: ex.filter((e) => e.status === 'error').slice(0, 5).map((e) => ({ id: e.id, fecha: e.startedAt })),
        });
      }
    } catch (e) { out.n8n = { error: 'No se pudo leer n8n: ' + e.message }; }
  }
  if (EVO && EK) {
    try {
      const s = await pedir(`${EVO}/instance/connectionState/${encodeURIComponent(INST)}`, { apikey: EK });
      out.evolution = { instancia: INST, estado: (s.instance && s.instance.state) || 'desconocido' };
    } catch (e) { out.evolution = { instancia: INST, error: 'No se pudo leer Evolution: ' + e.message }; }
  }
  cacheEstado = { t: Date.now(), v: out };
  return out;
}

// ---------------------------------------------------------------- rutas
async function manejar(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/salud') return enviar(res, 200, 'ok', 'text/plain');
  if (p === '/static/login.css' || p === '/static/app.css') return estatico(res, p.slice(8));

  if (p === '/login' && req.method === 'GET') return estatico(res, 'login.html');
  if (p === '/login' && req.method === 'POST') {
    const ip = ipDe(req);
    if (bloqueado(ip)) return enviar(res, 302, '', 'text/plain', { Location: '/login?e=bloqueado' });
    const f = new URLSearchParams(await cuerpo(req, 10e3));
    if (igual(f.get('usuario') || '', ADMIN_USER) && igual(f.get('clave') || '', ADMIN_PASSWORD)) {
      fallos.delete(ip);
      return enviar(res, 302, '', 'text/plain', { Location: '/', 'Set-Cookie': cookie(crearSesion(), SESSION_HOURS * 3600) });
    }
    const x = fallos.get(ip) || { n: 0, desde: Date.now() }; x.n++; fallos.set(ip, x);
    await new Promise((r) => setTimeout(r, 600));
    return enviar(res, 302, '', 'text/plain', { Location: '/login?e=1' });
  }

  const s = leerSesion(req);
  if (!s) {
    if (p.startsWith('/api/')) return json(res, 401, { error: 'Sesión caducada' });
    return enviar(res, 302, '', 'text/plain', { Location: '/login' });
  }
  // cerrar sesión: formulario normal (la cookie SameSite=Strict ya impide que otra web lo dispare)
  if (p === '/logout' && req.method === 'POST') return enviar(res, 302, '', 'text/plain', { Location: '/login', 'Set-Cookie': cookie('', 0) });
  const csrf = csrfDe(s);
  const cambia = !['GET', 'HEAD'].includes(req.method);
  if (cambia && req.headers['x-csrf'] !== csrf) return json(res, 403, { error: 'Petición no válida (CSRF)' });
  if (p === '/' ) {
    const html = (await fsp.readFile(path.join(__dirname, 'public', 'app.html'), 'utf8')).replace('__CSRF__', csrf);
    return enviar(res, 200, html);
  }
  if (p.startsWith('/static/')) return estatico(res, p.slice(8));

  if (p === '/api/estado') return json(res, 200, await estado());
  if (p === '/api/guias') {
    const lista = [];
    for (const [id, g] of Object.entries(GUIAS)) {
      const st = await fsp.stat(rutaGuia(id));
      lista.push({ id, ...g, modificado: st.mtime, versiones: (await versiones(id)).length });
    }
    return json(res, 200, lista);
  }
  if (p === '/api/enlaces' && req.method === 'GET') return enviar(res, 200, await fsp.readFile(dir('enlaces.json')), 'application/json; charset=utf-8');
  if (p === '/api/enlaces' && req.method === 'PUT') {
    let datos;
    try { datos = JSON.parse(await cuerpo(req, 200e3)); } catch { return json(res, 400, { error: 'JSON no válido' }); }
    if (!Array.isArray(datos) || datos.some((g) => !g || typeof g.grupo !== 'string' || !Array.isArray(g.enlaces)
      || g.enlaces.some((e) => typeof e.nombre !== 'string' || !/^https:\/\//.test(e.url || '')))) {
      return json(res, 400, { error: 'Formato: [{ "grupo": "...", "enlaces": [{ "nombre": "...", "url": "https://..." }] }]' });
    }
    await fsp.writeFile(dir('enlaces.json'), JSON.stringify(datos, null, 2));
    return json(res, 200, { ok: true });
  }

  const m = /^\/(guia|api\/guias)\/([a-z]+)(?:\/(fuente|versiones|descargar|restaurar))?(?:\/([\w.-]+))?$/.exec(p);
  if (m && GUIAS[m[2]]) {
    const [, tipo, id, accion, arg] = m;
    if (tipo === 'guia') {
      const html = await fsp.readFile(rutaGuia(id), 'utf8');
      return enviar(res, 200, url.searchParams.get('editar') === '1' ? modoEdicion(html, csrf) : html);
    }
    if (!accion && req.method === 'PUT') {
      const html = await cuerpo(req);
      if (!/<\/html>\s*$/i.test(html.trim()) || html.length < 200) return json(res, 400, { error: 'El documento no parece HTML completo' });
      await guardarGuia(id, html);
      return json(res, 200, { ok: true });
    }
    if (accion === 'fuente') return enviar(res, 200, await fsp.readFile(rutaGuia(id), 'utf8'), 'text/plain; charset=utf-8');
    if (accion === 'descargar') {
      return enviar(res, 200, await fsp.readFile(rutaGuia(id)), 'text/html; charset=utf-8',
        { 'Content-Disposition': `attachment; filename="${id}.html"` });
    }
    if (accion === 'versiones' && !arg) return json(res, 200, await versiones(id));
    if (accion === 'versiones' && arg) {
      if (!(await versiones(id)).includes(arg)) return enviar(res, 404, 'No existe', 'text/plain');
      return enviar(res, 200, await fsp.readFile(dir('versiones', id, arg)));
    }
    if (accion === 'restaurar' && arg && req.method === 'POST') {
      if (!(await versiones(id)).includes(arg)) return json(res, 404, { error: 'No existe esa versión' });
      await guardarGuia(id, await fsp.readFile(dir('versiones', id, arg), 'utf8'));
      return json(res, 200, { ok: true });
    }
  }
  return enviar(res, 404, 'No encontrado', 'text/plain; charset=utf-8');
}

http.createServer((req, res) => {
  manejar(req, res).catch((e) => { console.error(e); if (!res.headersSent) json(res, 500, { error: 'Error interno' }); });
}).listen(PORT, () => console.log(`Panel en el puerto ${PORT} · datos en ${DATA_DIR}`));
