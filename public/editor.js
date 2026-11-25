// Editor visual que el panel inyecta en una guía (modo «Editar texto").
// Los <script> de la guía llegan desactivados para que no cambien la página mientras se edita; al guardar se restauran.
(function () {
  'use strict';
  const CSRF = document.querySelector('meta[name="panel-csrf"]').content;
  const id = location.pathname.split('/').pop();
  const SEL = 'h1,h2,h3,h4,p,li,td,th,summary,dt,dd,figcaption,blockquote,label,.example,.eyebrow,.lead,.tag,.chip,footer,pre,code';
  const avisar = (tipo, texto) => parent.postMessage({ panel: true, tipo, texto }, location.origin);

  // marcar como editables solo los elementos más externos de cada bloque de texto
  for (const el of document.querySelectorAll(SEL)) {
    if (el.closest('[data-panel-editor]') || el.parentElement.closest('[contenteditable]')) continue;
    if (!el.textContent.trim()) continue;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'true');
  }
  // los enlaces no navegan mientras se edita
  document.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); }, true);
  // los <details> se abren todos para poder editar su contenido
  document.querySelectorAll('details').forEach((d) => { if (!d.open) { d.open = true; d.setAttribute('data-panel-cerrado', ''); } });

  const css = document.createElement('style');
  css.setAttribute('data-panel-editor', '');
  css.textContent = `[contenteditable]{outline:1px dashed rgba(162,0,0,.35);outline-offset:2px;border-radius:2px;cursor:text}
  [contenteditable]:hover{outline-color:rgba(162,0,0,.8)}[contenteditable]:focus{outline:2px solid #a20000;background:rgba(162,0,0,.04)}
  #panel-barra{position:fixed;top:12px;right:12px;z-index:2147483647;display:flex;gap:8px;background:#1a1f1d;padding:8px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.3);font:14px system-ui}
  #panel-barra button{border:0;border-radius:7px;padding:8px 14px;cursor:pointer;font:600 14px system-ui}
  #panel-barra .g{background:#a20000;color:#fff}#panel-barra .c{background:#3a423f;color:#fff}#panel-barra span{color:#cfd6d2;align-self:center;padding:0 6px}`;
  document.head.append(css);
  const barra = document.createElement('div');
  barra.id = 'panel-barra'; barra.setAttribute('data-panel-editor', '');
  barra.innerHTML = '<span>Editando</span><button type="button" class="c">Cancelar</button><button type="button" class="g">Guardar</button>';
  document.body.append(barra);
  let cambios = false;
  document.addEventListener('input', () => { cambios = true; });

  barra.querySelector('.c').onclick = () => avisar('cancelar');
  barra.querySelector('.g').onclick = async () => {
    if (!cambios) return avisar('cancelar');
    const doc = document.documentElement.cloneNode(true);
    doc.querySelectorAll('[data-panel-editor]').forEach((n) => n.remove());
    doc.querySelectorAll('[contenteditable]').forEach((n) => { n.removeAttribute('contenteditable'); n.removeAttribute('spellcheck'); });
    doc.querySelectorAll('[data-panel-cerrado]').forEach((n) => { n.removeAttribute('open'); n.removeAttribute('data-panel-cerrado'); });
    doc.querySelectorAll('script[type="text/x-panel-desactivado"]').forEach((s) => {
      const attrs = atob(s.getAttribute('data-panel-attrs') || '');
      const tmp = document.createElement('div');
      tmp.innerHTML = '<script' + attrs + '><\/script>';
      const orig = tmp.firstChild;
      const nuevo = document.createElement('script');
      for (const a of orig.attributes) nuevo.setAttribute(a.name, a.value);
      nuevo.textContent = s.textContent;
      s.replaceWith(nuevo);
    });
    const html = '<!doctype html>\n' + doc.outerHTML;
    try {
      const r = await fetch('/api/guias/' + id, { method: 'PUT', headers: { 'X-CSRF': CSRF, 'Content-Type': 'text/html' }, body: html });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Error ' + r.status);
      avisar('guardado');
    } catch (e) { avisar('error', 'No se pudo guardar: ' + e.message); }
  };
})();
