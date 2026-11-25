'use strict';
const CSRF = document.querySelector('meta[name=csrf]').content;
const main = document.getElementById('main');
const GUIAS = { tecnico: 'Manual técnico', administrador: 'Guía del administrador', trabajador: 'Guía del trabajador' };

const h = (tag, attrs = {}, ...hijos) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (v !== false && v !== undefined && v !== null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
};
const fecha = (iso) => iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
function aviso(texto, err = false) {
  const a = h('div', { class: 'aviso' + (err ? ' err' : ''), role: 'status' }, texto);
  document.body.append(a); setTimeout(() => a.remove(), err ? 6000 : 2500);
}
async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'X-CSRF': CSRF, ...(opts.headers || {}) } });
  if (r.status === 401) { location.href = '/login'; throw new Error('sesión'); }
  const t = await r.text();
  if (!r.ok) { let m = t; try { m = JSON.parse(t).error; } catch {} throw new Error(m || 'Error ' + r.status); }
  return (r.headers.get('content-type') || '').includes('json') ? JSON.parse(t) : t;
}

// ------------------------------------------------------------------ Inicio: estado y accesos
async function vistaInicio() {
  const v = h('div', { class: 'vista' },
    h('div', { class: 'cabecera' }, h('div', {}, h('h1', {}, 'Estado de la automatización'),
      h('p', { id: 'act' }, 'Cargando…')), h('button', { class: 'btn', on: { click: () => render() } }, 'Actualizar')),
    h('div', { class: 'rejilla', id: 'estado' }),
    h('h2', { class: 'sec' }, 'Manuales'), h('div', { class: 'rejilla', id: 'manuales' }),
    h('h2', { class: 'sec' }, 'Accesos directos'), h('div', { class: 'enlaces', id: 'enlaces' }));
  main.replaceChildren(v);
  api('/api/guias').then((gs) => document.getElementById('manuales').replaceChildren(...gs.map((g) =>
    h('a', { class: 'tarjeta', href: '#' + g.id, style: 'text-decoration:none' }, h('h3', {}, g.titulo),
      h('span', { class: 'nota' }, `${g.sub} · modificado ${fecha(g.modificado)} · ${g.versiones} versiones guardadas`)))));
  api('/api/enlaces').then((gs) => document.getElementById('enlaces').replaceChildren(...gs.map((g) =>
    h('div', { class: 'tarjeta' }, h('h3', {}, g.grupo), ...g.enlaces.filter((e) => /^https:\/\//.test(e.url))
      .map((e) => h('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.nombre + ' ↗')))))).catch(() => {});
  try {
    const s = await api('/api/estado');
    document.getElementById('act').textContent = 'Actualizado ' + fecha(s.actualizado) + ' · se refresca cada 30 s como máximo';
    const cont = document.getElementById('estado'); cont.replaceChildren();
    if (s.evolution) {
      const ok = s.evolution.estado === 'open';
      cont.append(h('div', { class: 'tarjeta' }, h('h3', {}, 'Línea de WhatsApp · ' + s.evolution.instancia),
        s.evolution.error ? h('span', { class: 'pastilla p-err' }, 'Sin respuesta') : h('span', { class: 'pastilla ' + (ok ? 'p-ok' : 'p-err') }, ok ? 'Conectada' : 'Desconectada (' + s.evolution.estado + ')'),
        h('span', { class: 'nota' }, s.evolution.error || (ok ? 'Recibiendo mensajes de los grupos.' : 'Reconecta escaneando el QR en el manager de Evolution.'))));
    } else cont.append(h('div', { class: 'tarjeta' }, h('h3', {}, 'Línea de WhatsApp'), h('span', { class: 'nota' }, 'Sin configurar (EVOLUTION_URL / EVOLUTION_APIKEY).')));
    if (s.n8n && s.n8n.workflows) {
      for (const w of s.n8n.workflows) {
        const err = w.error24 > 0;
        cont.append(h('div', { class: 'tarjeta' }, h('h3', {}, w.nombre.replace(/^Inspecciones · /, '')),
          h('div', {}, h('span', { class: 'pastilla ' + (w.activo ? (err ? 'p-warn' : 'p-ok') : 'p-err') }, w.activo ? (err ? 'Activo con errores' : 'Activo') : 'Desactivado')),
          h('div', { class: 'cifras' }, h('div', {}, h('b', {}, w.ok24), h('span', {}, 'correctas (24 h)')), h('div', {}, h('b', {}, w.error24), h('span', {}, 'con error (24 h)'))),
          h('span', { class: 'nota' }, w.ultima ? `Última: ${fecha(w.ultima.fecha)} · ${w.ultima.estado}` : 'Sin ejecuciones'),
          w.errores.length ? h('ul', { class: 'lista' }, w.errores.map((e) => h('li', {}, h('span', {}, fecha(e.fecha)),
            h('a', { href: `${s.n8nUrl}/workflow/${w.id}/executions/${e.id}`, target: '_blank', rel: 'noopener' }, 'Ver en n8n ↗')))) : null));
      }
    } else cont.append(h('div', { class: 'tarjeta' }, h('h3', {}, 'Workflows de n8n'), h('span', { class: 'nota' }, (s.n8n && s.n8n.error) || 'Sin configurar (N8N_URL / N8N_API_KEY).')));
  } catch (e) { document.getElementById('act').textContent = 'No se pudo cargar el estado: ' + e.message; }
}

// ------------------------------------------------------------------ Guías: ver, editar, código, versiones
let modo = 'ver';
function vistaGuia(id) {
  const marco = h('div', { class: 'marco' });
  const estado = h('span', { class: 'estado' });
  const b = (m, txt) => h('button', { class: 'btn', 'aria-pressed': String(modo === m), on: { click: () => { modo = m; render(); } } }, txt);
  const v = h('div', { class: 'vista guia' },
    h('div', { class: 'barra' }, h('h1', {}, GUIAS[id]), estado,
      b('ver', 'Ver'), b('editar', 'Editar texto'), b('codigo', 'Editar código'), b('versiones', 'Versiones'),
      h('button', { class: 'btn', on: { click: () => { const f = marco.querySelector('iframe'); if (f) f.contentWindow.print(); else aviso('Abre «Ver» para imprimir', true); } } }, 'PDF / imprimir'),
      h('a', { class: 'btn', href: `/api/guias/${id}/descargar` }, 'Descargar HTML')),
    marco);
  main.replaceChildren(v);

  if (modo === 'ver' || modo === 'editar') {
    estado.textContent = modo === 'editar' ? 'Haz clic en cualquier texto para cambiarlo. Guarda con el botón de arriba a la derecha de la guía.' : '';
    const f = h('iframe', { src: `/guia/${id}${modo === 'editar' ? '?editar=1' : ''}`, title: GUIAS[id] });
    marco.append(f);
    window.onmessage = (e) => {
      if (e.origin !== location.origin || !e.data || e.data.panel !== true) return;
      if (e.data.tipo === 'guardado') { aviso('Guardado'); modo = 'ver'; render(); }
      if (e.data.tipo === 'error') aviso(e.data.texto, true);
      if (e.data.tipo === 'cancelar') { modo = 'ver'; render(); }
    };
  } else if (modo === 'codigo') {
    const ta = h('textarea', { spellcheck: 'false', 'aria-label': 'Código HTML de la guía', id: 'cod-' + id });
    const guardar = h('button', { class: 'btn primario', on: { click: async () => {
      try { await api(`/api/guias/${id}`, { method: 'PUT', body: ta.value, headers: { 'Content-Type': 'text/html' } }); aviso('Guardado'); modo = 'ver'; render(); }
      catch (e) { aviso(e.message, true); } } } }, 'Guardar');
    marco.append(h('div', { class: 'codigo' },
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, guardar,
        h('span', { class: 'nota' }, 'Editas el HTML completo de la guía. Cada vez que guardas se conserva la versión anterior en «Versiones».')), ta));
    api(`/api/guias/${id}/fuente`).then((t) => { ta.value = t; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); } });
  } else if (modo === 'versiones') {
    const cont = h('div', { class: 'versiones' }, h('p', { class: 'nota' }, 'Cargando…'));
    marco.append(cont);
    api(`/api/guias/${id}/versiones`).then((vs) => {
      if (!vs.length) return cont.replaceChildren(h('p', { class: 'nota' }, 'Todavía no hay versiones anteriores: se crean al guardar un cambio.'));
      const nombre = (v) => { const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d)-(\d\d)-(\d\d)/.exec(v); return m ? fecha(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : v; };
      cont.replaceChildren(h('p', { class: 'nota' }, `Se guardan las ${vs.length} últimas versiones (máximo 50). Restaurar guarda también la actual como versión.`),
        h('table', {}, h('tbody', {}, vs.map((v) => h('tr', {}, h('td', {}, 'Versión del ' + nombre(v)),
          h('td', {}, h('a', { class: 'btn', href: `/api/guias/${id}/versiones/${encodeURIComponent(v)}`, target: '_blank' }, 'Ver')),
          h('td', {}, h('button', { class: 'btn', on: { click: async () => {
            try { await api(`/api/guias/${id}/restaurar/${encodeURIComponent(v)}`, { method: 'POST' }); aviso('Versión restaurada'); modo = 'ver'; render(); }
            catch (e) { aviso(e.message, true); } } } }, 'Restaurar')))))));
    });
  }
}

// ------------------------------------------------------------------ Accesos directos
async function vistaEnlaces() {
  const ta = h('textarea', { class: 'json', spellcheck: 'false', id: 'enlaces-json', 'aria-label': 'Accesos directos en JSON' });
  main.replaceChildren(h('div', { class: 'vista' },
    h('div', { class: 'cabecera' }, h('div', {}, h('h1', {}, 'Accesos directos'),
      h('p', {}, 'Grupos de enlaces de la página de inicio. Solo direcciones https://.')),
      h('button', { class: 'btn primario', on: { click: async () => {
        try { JSON.parse(ta.value); } catch { return aviso('El texto no es JSON válido', true); }
        try { await api('/api/enlaces', { method: 'PUT', body: ta.value, headers: { 'Content-Type': 'application/json' } }); aviso('Guardado'); }
        catch (e) { aviso(e.message, true); } } } }, 'Guardar')), ta));
  ta.value = JSON.stringify(await api('/api/enlaces'), null, 2);
}

// ------------------------------------------------------------------ navegación
let anterior = '';
function render() {
  const v = (location.hash || '#inicio').slice(1);
  if (v !== anterior && GUIAS[v]) modo = 'ver';
  anterior = v;
  document.querySelectorAll('aside a[data-v]').forEach((a) => { if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (GUIAS[v]) vistaGuia(v);
  else if (v === 'enlaces') vistaEnlaces();
  else vistaInicio();
}
window.addEventListener('hashchange', render);
render();
