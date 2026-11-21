/* measure.js — Medir distancias y áreas con el puntero o con el GPS */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const { map, toast, getGps, setFollow } = window.__app;
  const C = '#e07a10';
  let mode = 'dist', verts = [], active = false;
  const group = L.layerGroup();
  const line = L.polyline([], { color: C, weight: 3 }), poly = L.polygon([], { color: C, weight: 3, fillColor: C, fillOpacity: 0.15 });
  const rubber = L.polyline([], { color: C, weight: 2, dashArray: '6 6', opacity: 0.9 });
  const vtx = L.layerGroup();
  group.addLayer(line).addLayer(poly).addLayer(rubber).addLayer(vtx);

  const fmtLen = (m) => m >= 1000 ? (m / 1000).toFixed(3) + ' km' : m.toFixed(2) + ' m';
  const fmtArea = (a) => a >= 10000 ? (a / 10000).toFixed(4) + ' ha (' + Math.round(a).toLocaleString('es-CO') + ' m²)' : a.toFixed(1) + ' m²';
  const pathLen = (pts) => pts.reduce((s, p, i) => i ? s + pts[i - 1].distanceTo(p) : 0, 0);
  const ringGeo = (pts) => ({ type: 'Polygon', coordinates: [[...pts, pts[0]].map(p => [p.lng, p.lat])] });

  function start() {
    active = true; document.body.classList.add('measuring');
    $('crosshair').classList.remove('hidden'); $('measureBar').classList.remove('hidden');
    $('btnMeasure').classList.add('active');
    setFollow(false); group.addTo(map); draw();
  }
  function stop() {
    active = false; document.body.classList.remove('measuring');
    $('crosshair').classList.add('hidden'); $('measureBar').classList.add('hidden');
    $('btnMeasure').classList.remove('active');
    verts = []; draw(); map.removeLayer(group);
  }
  function setMode(m) {
    mode = m; $('mDist').classList.toggle('active', m === 'dist'); $('mArea').classList.toggle('active', m === 'area'); draw();
  }
  function draw() {
    const c = map.getCenter();
    line.setLatLngs(mode === 'dist' ? verts : []);
    poly.setLatLngs(mode === 'area' && verts.length >= 3 ? verts : []);
    if (mode === 'area' && verts.length > 0 && verts.length < 3) line.setLatLngs(verts);
    rubber.setLatLngs(!active || !verts.length ? [] : mode === 'area' && verts.length >= 2 ? [verts[verts.length - 1], c, verts[0]] : [verts[verts.length - 1], c]);
    vtx.clearLayers();
    verts.forEach((p, i) => vtx.addLayer(L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: C, fillOpacity: 1 })
      .bindTooltip(String(i + 1), { permanent: true, direction: 'top', offset: [0, -6], className: 'measure-label' })));
    // Resultado
    let res, live = '';
    if (mode === 'dist') {
      res = verts.length < 2 ? (verts.length ? 'Agrega el siguiente vértice' : 'Agrega el primer vértice') : 'Distancia: ' + fmtLen(pathLen(verts));
      if (verts.length) live = `Hasta el puntero: +${fmtLen(verts[verts.length - 1].distanceTo(c))} → total ${fmtLen(pathLen([...verts, c]))}`;
    } else {
      res = verts.length < 3 ? `Área: agrega ${3 - verts.length} vértice(s) más` : 'Área: ' + fmtArea(Vectors.areaM2(ringGeo(verts)));
      if (verts.length >= 3) live = 'Perímetro: ' + fmtLen(pathLen([...verts, verts[0]]));
      if (verts.length >= 2) live += (live ? ' · ' : '') + 'con el puntero: ' + fmtArea(Vectors.areaM2(ringGeo([...verts, c])));
    }
    $('mResult').textContent = res; $('mLive').textContent = live;
    $('mGps').disabled = !getGps();
    $('mUndo').disabled = $('mClear').disabled = !verts.length;
    $('mSave').disabled = mode === 'dist' ? verts.length < 2 : verts.length < 3;
  }
  map.on('move', () => { if (active) draw(); });

  async function save() {
    const n = (window.Vectors.all().find(m => m.name === 'Mediciones') || { count: 0 }).count + 1;
    const def = (mode === 'dist' ? 'Distancia ' : 'Área ') + n;
    let nombre = prompt('Nombre de la medición', def);
    if (nombre === null) return;
    nombre = nombre.trim() || def;
    const fecha = new Date().toISOString();
    let f;
    if (mode === 'dist') {
      const d = pathLen(verts);
      f = { type: 'Feature', geometry: { type: 'LineString', coordinates: verts.map(p => [p.lng, p.lat]) },
        properties: { nombre, tipo: 'Distancia', distancia_m: +d.toFixed(2), vertices: verts.length, fecha } };
    } else {
      const g = ringGeo(verts), a = Vectors.areaM2(g);
      f = { type: 'Feature', geometry: g,
        properties: { nombre, tipo: 'Área', area_m2: +a.toFixed(2), area_ha: +(a / 10000).toFixed(4), perimetro_m: +pathLen([...verts, verts[0]]).toFixed(2), vertices: verts.length, fecha } };
    }
    await Vectors.addFeature('Mediciones', f);
    toast(`"${nombre}" guardada en la capa Mediciones`);
    verts = []; draw();
  }

  $('btnMeasure').onclick = () => (active ? stop() : start());
  $('mClose').onclick = stop;
  $('mDist').onclick = () => setMode('dist');
  $('mArea').onclick = () => setMode('area');
  $('mAdd').onclick = () => { verts.push(map.getCenter()); draw(); };
  $('mGps').onclick = () => { const g = getGps(); if (!g) return; verts.push(g.latlng); map.panTo(g.latlng); draw(); };
  $('mUndo').onclick = () => { verts.pop(); draw(); };
  $('mClear').onclick = () => { verts = []; draw(); };
  $('mSave').onclick = save;
  setInterval(() => { if (active) $('mGps').disabled = !getGps(); }, 2000);

  window.Measure = { start, stop, _verts: () => verts };
})();
