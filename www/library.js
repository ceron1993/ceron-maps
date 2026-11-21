/* library.js — Pantalla de biblioteca de Cerón Maps: mapas con miniatura,
   indicador de ubicación (estás aquí / a X km) y capas. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const A = window.__app;
  const { map, DB, toast, fmtDist } = A;
  const thumbUrls = new Map();
  let tab = 'maps', gps = null, gpsAcc = null, lastRender = 0, pending = null, thumbing = false;

  // ---------- Navegación ----------
  function show() {
    $('library').classList.remove('hidden'); render(true);
  }
  function hide(title) {
    $('library').classList.add('hidden');
    if (title) $('title').textContent = title;
    setTimeout(() => map.invalidateSize(), 50);
    if (history.state?.v !== 'map') history.pushState({ v: 'map' }, '');
  }
  window.addEventListener('popstate', () => { if ($('library').classList.contains('hidden')) show(); });
  $('btnLib').onclick = () => { if (history.state?.v === 'map') history.back(); else show(); };

  async function openMap(m) {
    for (const x of A.maps()) if ((x.id === m.id) !== !!x.visible) await A.setMapVisible(x, x.id === m.id);
    A.renderList();
    hide(m.name); map.fitBounds(m.bounds);
  }
  async function openAll() {
    const ms = A.maps();
    for (const x of ms) if (!x.visible) await A.setMapVisible(x, true);
    A.renderList();
    hide('Todos los mapas');
    const all = [...ms.map(m => m.bounds), ...(window.Vectors ? Vectors.all().filter(v => v.visible).map(v => v.bounds) : [])];
    if (all.length) map.fitBounds(all.reduce((b, x) => b.extend(x), L.latLngBounds(all[0])));
  }
  function openLayer(v) {
    if (!v.visible) Vectors.setVisible(v.id, true);
    hide(v.name); map.fitBounds(v.bounds);
  }

  // ---------- Ubicación ----------
  function locChip(bounds) {
    if (!gps) return '';
    const b = L.latLngBounds(bounds);
    if (b.contains(gps)) return '<span class="chip here">📍 Estás aquí</span>';
    const d = gps.distanceTo(b.getCenter());
    return `<span class="chip">a ${fmtDist(d)} ${dirTxt(gps, b.getCenter())}</span>`;
  }
  function dirTxt(a, b) {
    const dy = b.lat - a.lat, dx = (b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180);
    const deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    return ['al N', 'al NE', 'al E', 'al SE', 'al S', 'al SO', 'al O', 'al NO'][Math.round(deg / 45) % 8];
  }
  function onGps(latlng, acc) {
    gps = latlng; gpsAcc = acc;
    if (!$('library').classList.contains('hidden') && Date.now() - lastRender > 3000) render();
  }

  // ---------- Render ----------
  const fmtSize = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const georefTxt = (g) => ({ geopdf: 'GeoPDF', geotiff: 'GeoTIFF', worldfile: 'Imagen + mundo', corners: 'Imagen' }[g] || g || '');
  function render(force) {
    if (!force && $('library').classList.contains('hidden')) return;
    lastRender = Date.now();
    const maps = A.maps(), vecs = window.Vectors ? Vectors.all() : [];
    $('libCountMaps').textContent = maps.length ? `(${maps.length})` : '';
    $('libCountVec').textContent = vecs.length ? `(${vecs.length})` : '';
    // Estado del GPS
    const g = $('libGps');
    if (gps) {
      const here = maps.filter(m => L.latLngBounds(m.bounds).contains(gps)).map(m => m.name);
      g.innerHTML = `📍 GPS activo ±${Math.round(gpsAcc || 0)} m` + (here.length ? ` — estás en <b></b>` : ' — fuera de tus mapas');
      if (here.length) g.querySelector('b').textContent = here.join(', ');
      g.classList.add('on');
    } else {
      g.textContent = A.gpsOn() ? '📍 Buscando señal GPS…' : '📍 Toca aquí para activar el GPS y ver en qué mapa estás';
      g.classList.remove('on');
    }
    const empty = tab === 'maps' ? !maps.length : !vecs.length;
    $('libMaps').classList.toggle('hidden', tab !== 'maps' || empty);
    $('libLayers').classList.toggle('hidden', tab !== 'layers' || empty);
    $('libEmpty').classList.toggle('hidden', !empty);
    $('libEmpty').querySelector('h3').textContent = tab === 'maps' ? 'Aún no tienes mapas' : 'Aún no tienes capas';
    // Mapas, ordenados: primero donde estás, luego por cercanía
    const ordered = [...maps];
    if (gps) ordered.sort((a, b) => gps.distanceTo(L.latLngBounds(a.bounds).getCenter()) - gps.distanceTo(L.latLngBounds(b.bounds).getCenter()));
    const ul = $('libMaps'); ul.innerHTML = '';
    for (const m of ordered) {
      const li = document.createElement('li'); li.className = 'lib-card';
      li.innerHTML = `<img class="lib-thumb" alt=""><div class="lib-info"><div class="lib-name"></div>
        <div class="lib-meta">${georefTxt(m.georef)} · ${fmtSize(m.blob.size)} · ${new Date(m.created).toLocaleDateString('es-CO')}</div>${locChip(m.bounds)}</div>
        <button class="lib-more" aria-label="Opciones">⋮</button>`;
      li.querySelector('.lib-name').textContent = m.name;
      const img = li.querySelector('img');
      if (m.thumb) { if (!thumbUrls.has(m.id)) thumbUrls.set(m.id, URL.createObjectURL(m.thumb)); img.src = thumbUrls.get(m.id); }
      li.onclick = (e) => { if (!e.target.closest('.lib-more')) openMap(m); };
      li.querySelector('.lib-more').onclick = (e) => menu(e, [
        ['Abrir', () => openMap(m)],
        ['Renombrar', async () => { const n = prompt('Nuevo nombre', m.name); if (n && n.trim()) { m.name = n.trim(); await DB.put(m); A.renderList(); } }],
        ['Eliminar', async () => { if (confirm(`¿Eliminar "${m.name}" del celular?`)) { await A.deleteMap(m); thumbUrls.delete(m.id); } }],
      ]);
      ul.appendChild(li);
    }
    makeMissingThumbs();
    // Capas
    const ul2 = $('libLayers'); ul2.innerHTML = '';
    for (const v of [...vecs].reverse()) {
      const li = document.createElement('li'); li.className = 'lib-card';
      const ico = /polígono/.test(v.gtype) ? '⬠' : /línea/.test(v.gtype) ? '〰' : '•';
      li.innerHTML = `<div class="lib-thumb vec" style="color:${v.color}">${ico}</div><div class="lib-info"><div class="lib-name"></div>
        <div class="lib-meta">${v.source} · ${v.count} ${v.gtype}${v.visible ? '' : ' · oculta'}</div>${locChip(v.bounds)}</div>
        <button class="lib-more" aria-label="Opciones">⋮</button>`;
      li.querySelector('.lib-name').textContent = v.name;
      li.onclick = (e) => { if (!e.target.closest('.lib-more')) openLayer(v); };
      li.querySelector('.lib-more').onclick = (e) => menu(e, [
        ['Ver en el mapa', () => openLayer(v)],
        [v.visible ? 'Ocultar' : 'Mostrar', () => Vectors.setVisible(v.id, !v.visible)],
        ['Exportar KML', () => Vectors.exportKml(v.id)],
        ['Eliminar', () => Vectors.remove(v.id)],
      ]);
      ul2.appendChild(li);
    }
  }
  async function makeMissingThumbs() {
    if (thumbing) return; thumbing = true;
    try {
      for (const m of A.maps()) if (!m.thumb) { m.thumb = await A.makeThumb(m.blob); await DB.put(m); render(true); }
    } catch (e) { console.warn(e); } finally { thumbing = false; }
  }

  // Menú contextual
  function menu(ev, opts) {
    ev.stopPropagation(); closeMenu();
    const d = document.createElement('div'); d.className = 'lib-menu'; d.id = 'libMenu';
    opts.forEach(([t, fn]) => { const b = document.createElement('button'); b.textContent = t; b.onclick = () => { closeMenu(); fn(); }; d.appendChild(b); });
    document.body.appendChild(d);
    const r = ev.target.getBoundingClientRect();
    d.style.top = Math.min(r.bottom, innerHeight - d.offsetHeight - 10) + 'px'; d.style.right = (innerWidth - r.right + 4) + 'px';
    setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
  }
  function closeMenu() { const m = $('libMenu'); if (m) m.remove(); }

  // ---------- Eventos ----------
  document.querySelectorAll('.lib-tab').forEach(b => b.onclick = () => {
    tab = b.dataset.tab; document.querySelectorAll('.lib-tab').forEach(x => x.classList.toggle('active', x === b)); render(true);
  });
  $('libGps').onclick = () => { if (!A.gpsOn()) { A.startGps(); render(true); } };
  $('libImport').onclick = () => A.openImport();
  $('libOpenAll').onclick = openAll;
  function afterImport(m) {
    if ($('library').classList.contains('hidden')) return;
    if (m) openMap(m); else { tab = 'layers'; hide(Vectors.all().slice(-1)[0]?.name || 'Capas'); }
  }

  // Si el hosting agrega una insignia fija abajo a la derecha (p. ej. "Powered by Netlify"
  // en el plan gratis), se sube la interfaz para que no tape los botones. No se oculta la insignia.
  function fitBadge() {
    const ours = ['library', 'toolbar', 'map', 'coords', 'measureBar', 'placeBar', 'drawer', 'toast'];
    let h = 0;
    for (const [x, y] of [[innerWidth - 12, innerHeight - 12], [innerWidth - 60, innerHeight - 20]]) {
      const el = document.elementFromPoint(x, y);
      if (!el || ours.some(id => { const o = $(id); return o && o.contains(el); }) || el === document.body || el === document.documentElement) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < 140 && r.width < innerWidth * 0.9) h = Math.max(h, Math.ceil(innerHeight - r.top) + 6);
    }
    document.documentElement.style.setProperty('--badge-h', h + 'px');
  }
  [500, 1500, 3000, 6000, 10000].forEach(t => setTimeout(fitBadge, t));
  addEventListener('resize', () => setTimeout(fitBadge, 300));

  window.Library = { show, hide, render, onGps, afterImport, openMap };
  history.replaceState({ v: 'lib' }, '');
  show();
})();
