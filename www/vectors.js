/* vectors.js — Capas vectoriales: Shapefile (.zip o .shp/.dbf/.shx/.prj/.cpg), KML y KMZ.
   Se guardan en el celular (IndexedDB), se ven sobre los mapas, al tocar muestran atributos
   y con el GPS indican en qué polígono (predio) estás. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const { map, DB, toast } = window.__app;
  const store = DB.store('vectors');
  map.createPane('vectors'); map.getPane('vectors').style.zIndex = 450;
  const renderer = L.canvas({ pane: 'vectors', padding: 0.5, tolerance: 8 });
  const labelGroup = L.layerGroup().addTo(map);
  const COLORS = ['#ffd400', '#ff3b30', '#00e5ff', '#ff9500', '#d500f9', '#00e676', '#2979ff', '#ffffff'];
  let items = []; // {meta, layer, feats:[{f, bbox, layer}]}

  // ---------- ZIP (para .zip de shapefile y .kmz) ----------
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  async function unzip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('El .zip/.kmz está dañado o no es un zip');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const out = [], dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith('/') || /(^|\/)__MACOSX\//.test(name)) continue;
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const raw = u8.subarray(start, start + csize);
      const data = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
      if (data) out.push({ name, data });
    }
    return out;
  }

  // ---------- Sistemas de coordenadas ----------
  function crsFromPrj(wkt) {
    const s = wkt.replace(/\s+/g, ' ');
    const bog = /Bogota/i.test(s) && !/MAGNA/i.test(s);
    if (!/PROJCS|PROJCRS/i.test(s)) {
      if (bog) { proj4.defs('EPSG:4218', '+proj=longlat +ellps=intl +towgs84=307,304,-318,0,0,0,0 +no_defs'); return 'EPSG:4218'; }
      return 'EPSG:4326';
    }
    const num = (n) => { const m = s.match(new RegExp('PARAMETER\\["' + n + '"\\s*,\\s*([-+\\d.eE]+)', 'i')); return m ? +m[1] : null; };
    const cm = num('central_meridian') ?? num('longitude_of_origin') ?? num('longitude_of_center'), fe = num('false_easting');
    if (/Origen.?Nacional|CTM.?12/i.test(s) || (cm !== null && Math.abs(cm + 73) < 1e-6 && Math.abs(fe - 5000000) < 1)) return 'EPSG:9377';
    const utm = s.match(/UTM[_ ]zone[_ ](\d+)\s*([NS])/i);
    if (utm) { const c = 'EPSG:' + ((utm[2].toUpperCase() === 'N' ? 32600 : 32700) + +utm[1]); Georef.ensureCrs(c); return c; }
    if (cm !== null && fe !== null && Math.abs(fe - 1000000) < 1) {
      const z = bog ? [[-77.0809, 21896], [-74.0809, 21897], [-71.0809, 21898], [-68.0809, 21899]]
        : [[-77.0775, 3115], [-74.0775, 3116], [-71.0775, 3117], [-68.0775, 3118], [-80.0775, 3114]];
      for (const [c, code] of z) if (Math.abs(cm - c) < 0.001) return 'EPSG:' + code;
    }
    try { const id = 'PRJ:' + s.length + ':' + s.slice(0, 40); proj4.defs(id, wkt); proj4(id, 'EPSG:4326'); return id; } catch (e) { return null; }
  }
  function firstCoord(fc) {
    for (const f of fc.features) { if (!f.geometry) continue; let c = f.geometry.coordinates; while (Array.isArray(c[0])) c = c[0]; return c; }
    return null;
  }
  function guessCrs(fc) {
    const c = firstCoord(fc); if (!c) return 'EPSG:4326';
    const [x, y] = c;
    if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return 'EPSG:4326';
    if (x > 3.8e6 && x < 6.2e6 && y > 1.0e6 && y < 3.5e6) return 'EPSG:9377';
    return null; // ambiguo (MAGNA por zonas vs UTM): hay que preguntar
  }
  function mapCoords(g, fn) {
    if (!g) return g;
    const walk = (c) => typeof c[0] === 'number' ? fn(c) : c.map(walk);
    if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map(x => mapCoords(x, fn)) };
    return { ...g, coordinates: walk(g.coordinates) };
  }
  function reproject(fc, code) {
    if (code === 'EPSG:4326' || code === 'EPSG:4686') return fc;
    const p = proj4(code, 'EPSG:4326');
    fc.features.forEach(f => { f.geometry = mapCoords(f.geometry, (c) => { const r = p.forward([c[0], c[1]]); return c.length > 2 ? [r[0], r[1], c[2]] : r; }); });
    return fc;
  }

  // ---------- Lectura de archivos ----------
  async function decodeDbfEncoding(dbf, cpg) {
    if (cpg) return cpg;
    try { new TextDecoder('utf-8', { fatal: true }).decode(dbf); return 'utf-8'; } catch (e) { return 'windows-1252'; }
  }
  async function readShapefile(set) {
    let fc = shp.parseShp(set.shp.buffer.slice(set.shp.byteOffset, set.shp.byteOffset + set.shp.byteLength));
    let props = null;
    if (set.dbf) {
      const enc = await decodeDbfEncoding(set.dbf, set.cpg && new TextDecoder().decode(set.cpg).trim());
      props = shp.parseDbf(set.dbf.buffer.slice(set.dbf.byteOffset, set.dbf.byteOffset + set.dbf.byteLength), enc);
    }
    const out = { type: 'FeatureCollection', features: fc.map((g, i) => ({ type: 'Feature', geometry: g, properties: props ? props[i] || {} : {} })) };
    return { fc: out, prj: set.prj ? new TextDecoder().decode(set.prj) : null };
  }
  function cleanKmlProps(fc) {
    fc.features.forEach(f => {
      const p = f.properties || {}; const o = {};
      for (const [k, v] of Object.entries(p)) {
        if (/^(style|styleUrl|styleHash|styleMap|stroke|fill|icon|label|visibility|timespan|timestamp)/i.test(k) || typeof v === 'object') continue;
        o[k] = typeof v === 'string' ? v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : v;
      }
      f.properties = o;
    });
    return fc;
  }
  function readKml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('El KML no es válido');
    return cleanKmlProps(toGeoJSON.kml(doc));
  }

  /* files: File[]; crsOverride: 'auto' o 'EPSG:xxxx' */
  async function importFiles(files, baseName, crsOverride, status) {
    const entries = [];
    for (const f of files) {
      const u8 = new Uint8Array(await f.arrayBuffer());
      if (/\.(zip|kmz)$/i.test(f.name)) { status('Descomprimiendo ' + f.name + '…'); (await unzip(u8)).forEach(e => entries.push(e)); }
      else entries.push({ name: f.name, data: u8 });
    }
    const sets = {}, datasets = [];
    for (const e of entries) {
      const m = e.name.match(/^(.*?)([^/]+)\.(shp|dbf|shx|prj|cpg|kml)$/i); if (!m) continue;
      const ext = m[3].toLowerCase();
      if (ext === 'kml') { datasets.push({ name: m[2], kml: new TextDecoder().decode(e.data) }); continue; }
      const key = (m[1] + m[2]).toLowerCase();
      (sets[key] = sets[key] || { name: m[2] })[ext] = e.data;
    }
    Object.values(sets).forEach(s => { if (s.shp) datasets.push(s); });
    const orphan = Object.values(sets).find(s => !s.shp && s.dbf);
    if (!datasets.length) throw new Error(orphan ? 'Falta el archivo .shp de "' + orphan.name + '". Selecciona todos los archivos del shapefile o un .zip.' : 'No se encontró ningún .shp ni .kml');
    const saved = [];
    for (const d of datasets) {
      status('Leyendo ' + d.name + '…');
      let fc, crs = 'EPSG:4326';
      if (d.kml) fc = readKml(d.kml);
      else {
        const r = await readShapefile(d); fc = r.fc;
        crs = crsOverride && crsOverride !== 'auto' ? crsOverride : (r.prj ? crsFromPrj(r.prj) : guessCrs(fc));
        if (!crs) { const err = new Error(`"${d.name}" no trae archivo .prj y no se puede adivinar su sistema de coordenadas. Elígelo en la lista y vuelve a tocar Importar.`); err.needCrs = true; throw err; }
        fc = reproject(fc, crs);
      }
      fc.features = fc.features.filter(f => f.geometry);
      if (!fc.features.length) throw new Error(`"${d.name}" no tiene geometrías`);
      const c = firstCoord(fc);
      if (!c || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) throw new Error(`Las coordenadas de "${d.name}" no quedaron bien. Prueba eligiendo el sistema de coordenadas a mano.`);
      const b = L.geoJSON(fc).getBounds();
      const meta = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: datasets.length === 1 && baseName ? baseName : (baseName ? baseName + ' – ' : '') + d.name,
        geojson: fc, created: Date.now(), visible: true, crs,
        color: COLORS[(items.length + saved.length) % COLORS.length],
        labelField: guessLabel(fc), count: fc.features.length, gtype: geomSummary(fc),
        bounds: [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]], source: d.kml ? 'KML' : 'Shapefile'
      };
      await store.put(meta); add(meta); saved.push(meta);
    }
    renderList(); refreshLabels();
    map.fitBounds(saved.length === 1 ? saved[0].bounds : saved.reduce((acc, m) => acc.extend(m.bounds), L.latLngBounds(saved[0].bounds)));
    return saved;
  }
  function guessLabel(fc) {
    const keys = Object.keys((fc.features[0] || {}).properties || {});
    const pri = [/^(npn|numero_?pre(dial)?|num_?pre|cod(igo)?_?pre(dial)?|codigo)$/i, /pre(dial)?|codigo|cod_/i, /^(name|nombre)$/i, /nombre|name|label|etiqueta/i, /^id$/i];
    for (const r of pri) { const k = keys.find(x => r.test(x)); if (k) return k; }
    return '';
  }
  function geomSummary(fc) {
    const t = new Set(fc.features.map(f => f.geometry.type.replace('Multi', '')));
    return [...t].map(x => ({ Polygon: 'polígonos', LineString: 'líneas', Point: 'puntos' }[x] || x)).join(', ');
  }

  // ---------- Dibujo ----------
  function add(meta) {
    const color = meta.color, feats = [];
    const layer = L.geoJSON(meta.geojson, {
      renderer,
      style: (f) => /Polygon/.test(f.geometry.type) ? { color, weight: 2, opacity: 1, fillColor: color, fillOpacity: 0.08 } : { color, weight: 3, opacity: 1 },
      pointToLayer: (f, ll) => L.circleMarker(ll, { renderer, radius: 6, color: '#222', weight: 1.5, fillColor: color, fillOpacity: 1 }),
      onEachFeature: (f, l) => {
        feats.push({ f, l, bbox: bboxOf(f.geometry) });
        l.on('click', (e) => { L.DomEvent.stop(e); showAttrs(meta, f, e.latlng); });
      }
    });
    if (meta.visible) layer.addTo(map);
    items.push({ meta, layer, feats });
  }
  function bboxOf(g) {
    let b = [Infinity, Infinity, -Infinity, -Infinity];
    mapCoords(g, (c) => { if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1]; if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1]; return c; });
    return b;
  }
  function showAttrs(meta, f, latlng) {
    const div = document.createElement('div'); div.className = 'attr-pop';
    const h = document.createElement('b'); h.textContent = (meta.labelField && f.properties[meta.labelField]) || meta.name; div.appendChild(h);
    const sub = document.createElement('div'); sub.className = 'small muted'; sub.textContent = meta.name; div.appendChild(sub);
    const t = document.createElement('table');
    const rows = Object.entries(f.properties || {}).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
    if (/Polygon/.test(f.geometry.type)) { const a = areaM2(f.geometry); rows.push(['Área calculada', a >= 10000 ? (a / 10000).toFixed(4) + ' ha' : a.toFixed(1) + ' m²']); }
    if (/LineString/.test(f.geometry.type)) rows.push(['Longitud calculada', lengthM(f.geometry).toFixed(1) + ' m']);
    rows.forEach(([k, v]) => { const tr = t.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4)) : v; });
    div.appendChild(t);
    L.popup({ maxWidth: 300, maxHeight: 320 }).setLatLng(latlng).setContent(div).openOn(map);
  }
  // Área y longitud en el plano CTM12 (Origen Nacional), adecuado para Colombia
  function areaM2(g) {
    const ring = (r) => { const p = r.map(c => ProjUtil.toCtm12(c[0], c[1])); let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(s / 2); };
    const poly = (rs) => rs.reduce((a, r, i) => a + (i ? -ring(r) : ring(r)), 0);
    return g.type === 'Polygon' ? poly(g.coordinates) : g.coordinates.reduce((a, p) => a + poly(p), 0);
  }
  function lengthM(g) {
    const line = (l) => { let s = 0; for (let i = 1; i < l.length; i++) s += L.latLng(l[i - 1][1], l[i - 1][0]).distanceTo([l[i][1], l[i][0]]); return s; };
    return g.type === 'LineString' ? line(g.coordinates) : g.coordinates.reduce((a, l) => a + line(l), 0);
  }

  // Etiquetas (solo con zoom cercano, para no saturar)
  let labelTimer;
  function refreshLabels() {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => {
      labelGroup.clearLayers();
      if (map.getZoom() < 16) return;
      const vb = map.getBounds().pad(0.1); let n = 0;
      for (const it of items) {
        if (!it.meta.visible || !it.meta.labelField) continue;
        for (const ft of it.feats) {
          if (n >= 300) return;
          const b = ft.bbox; if (!vb.intersects([[b[1], b[0]], [b[3], b[2]]])) continue;
          const v = ft.f.properties[it.meta.labelField]; if (v === null || v === undefined || v === '') continue;
          if (/Polygon/.test(ft.f.geometry.type)) { // solo si el texto cabe dentro del predio en pantalla
            const p1 = map.latLngToContainerPoint([b[1], b[0]]), p2 = map.latLngToContainerPoint([b[3], b[2]]);
            if (Math.abs(p2.x - p1.x) < String(v).length * 6.2 + 8 || Math.abs(p2.y - p1.y) < 16) continue;
          }
          const pos = /Polygon/.test(ft.f.geometry.type) ? labelPoint(ft.f.geometry) : ft.l.getLatLng ? ft.l.getLatLng() : ft.l.getCenter();
          labelGroup.addLayer(L.tooltip({ permanent: true, direction: 'center', className: 'vec-label', interactive: false }).setLatLng(pos).setContent(String(v)));
          n++;
        }
      }
    }, 150);
  }
  function labelPoint(g) {
    // centroide del anillo exterior más grande; si cae fuera, centro del bbox
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    let best = polys[0], ba = 0; polys.forEach(p => { const a = Math.abs(ringArea(p[0])); if (a > ba) { ba = a; best = p; } });
    const r = best[0]; let A = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; A += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; }
    let c = A ? [cx / (3 * A), cy / (3 * A)] : r[0];
    if (!pip(c, best)) { const b = bboxOf({ type: 'Polygon', coordinates: best }); c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
    return [c[1], c[0]];
  }
  const ringArea = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; };
  function inRing(pt, r) {
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  const pip = (pt, poly) => inRing(pt, poly[0]) && !poly.slice(1).some(h => inRing(pt, h));
  map.on('zoomend moveend', refreshLabels);

  // ---------- ¿En qué polígono estoy? ----------
  function whereAmI(latlng) {
    const pt = [latlng.lng, latlng.lat], hits = [];
    for (const it of items) {
      if (!it.meta.visible) continue;
      for (const ft of it.feats) {
        const g = ft.f.geometry, b = ft.bbox;
        if (!/Polygon/.test(g.type) || pt[0] < b[0] || pt[0] > b[2] || pt[1] < b[1] || pt[1] > b[3]) continue;
        const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        if (polys.some(p => pip(pt, p))) hits.push({ it, ft });
      }
    }
    return hits;
  }
  function onGps(latlng) {
    const el = $('cIn'); if (!el) return;
    const hits = whereAmI(latlng);
    if (!hits.length) { el.classList.add('hidden'); return; }
    el.textContent = 'Dentro de: ' + hits.slice(0, 2).map(h => {
      const v = h.it.meta.labelField ? h.ft.f.properties[h.it.meta.labelField] : null;
      return (v !== null && v !== undefined && v !== '' ? v : 'polígono') + ' (' + h.it.meta.name + ')';
    }).join(' · ');
    el.classList.remove('hidden');
  }

  // ---------- Lista en el panel ----------
  function renderList() {
    if (window.Library) setTimeout(() => Library.render(), 0);
    const ul = $('vecList'); ul.innerHTML = '';
    $('emptyVec').classList.toggle('hidden', items.length > 0);
    for (const it of [...items].reverse()) {
      const m = it.meta, li = document.createElement('li');
      const fields = Object.keys((m.geojson.features[0] || {}).properties || {});
      li.innerHTML = `<div class="name"><input type="checkbox" ${m.visible ? 'checked' : ''}><span></span></div>
        <div class="meta">${m.source} · ${m.count} ${m.gtype} · ${m.crs || ''}</div>
        <div class="actions">
          <input type="color" value="${m.color}" title="Color">
          <select title="Etiqueta"><option value="">Sin etiqueta</option></select>
          <button data-a="go">Ir</button><button data-a="kml" title="Exportar KML">⇩</button><button data-a="del">🗑</button>
        </div>`;
      li.querySelector('.name span').textContent = m.name;
      const sel = li.querySelector('select');
      fields.forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = 'Etiqueta: ' + k; sel.appendChild(o); });
      sel.value = m.labelField || '';
      sel.onchange = async () => { m.labelField = sel.value; await store.put(m); refreshLabels(); };
      li.querySelector('input[type=checkbox]').onchange = async (e) => {
        m.visible = e.target.checked; await store.put(m);
        m.visible ? it.layer.addTo(map) : map.removeLayer(it.layer); refreshLabels();
      };
      li.querySelector('input[type=color]').onchange = async (e) => { m.color = e.target.value; await store.put(m); redraw(it); };
      li.querySelector('[data-a=go]').onclick = () => { $('drawer').classList.add('hidden'); map.fitBounds(m.bounds); };
      li.querySelector('[data-a=del]').onclick = () => remove(m.id);
      li.querySelector('[data-a=kml]').onclick = () => exportKml(m.id);
      ul.appendChild(li);
    }
  }
  function redraw(it) {
    map.removeLayer(it.layer); items = items.filter(x => x !== it); add(it.meta); renderList(); refreshLabels();
  }

  async function setVisible(id, v) {
    const it = items.find(x => x.meta.id === id); if (!it) return;
    it.meta.visible = v; await store.put(it.meta); v ? it.layer.addTo(map) : map.removeLayer(it.layer); renderList(); refreshLabels();
  }
  async function remove(id, ask = true) {
    const it = items.find(x => x.meta.id === id); if (!it) return;
    if (ask && !confirm(`¿Eliminar la capa "${it.meta.name}" del celular?`)) return;
    await store.del(id); map.removeLayer(it.layer); items = items.filter(x => x !== it); renderList(); refreshLabels();
  }
  // Agrega una entidad a una capa por nombre (la crea si no existe). Usado por "Medir → Guardar".
  async function addFeature(layerName, feature, color = '#f2a541') {
    let it = items.find(x => x.meta.name === layerName);
    if (it) {
      const m = it.meta; m.geojson.features.push(feature); m.count = m.geojson.features.length; m.gtype = geomSummary(m.geojson);
      const b = L.geoJSON(m.geojson).getBounds(); m.bounds = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
      await store.put(m); map.removeLayer(it.layer); items = items.filter(x => x !== it); add(m);
    } else {
      const fc = { type: 'FeatureCollection', features: [feature] }, b = L.geoJSON(fc).getBounds();
      const m = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: layerName, geojson: fc, created: Date.now(), visible: true,
        crs: 'EPSG:4326', color, labelField: 'nombre', count: 1, gtype: geomSummary(fc), bounds: [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]], source: 'Mediciones' };
      await store.put(m); add(m);
    }
    renderList(); refreshLabels();
  }
  // Exportar capa a KML
  function toKml(meta) {
    const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
    const cs = (a) => a.map(c => `${c[0].toFixed(7)},${c[1].toFixed(7)}`).join(' ');
    const poly = (p) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${cs(p[0])}</coordinates></LinearRing></outerBoundaryIs>${p.slice(1).map(h => `<innerBoundaryIs><LinearRing><coordinates>${cs(h)}</coordinates></LinearRing></innerBoundaryIs>`).join('')}</Polygon>`;
    const geom = (g) => ({
      Point: () => `<Point><coordinates>${cs([g.coordinates])}</coordinates></Point>`,
      LineString: () => `<LineString><coordinates>${cs(g.coordinates)}</coordinates></LineString>`,
      Polygon: () => poly(g.coordinates),
      MultiPoint: () => `<MultiGeometry>${g.coordinates.map(c => `<Point><coordinates>${cs([c])}</coordinates></Point>`).join('')}</MultiGeometry>`,
      MultiLineString: () => `<MultiGeometry>${g.coordinates.map(l => `<LineString><coordinates>${cs(l)}</coordinates></LineString>`).join('')}</MultiGeometry>`,
      MultiPolygon: () => `<MultiGeometry>${g.coordinates.map(poly).join('')}</MultiGeometry>`,
    }[g.type] || (() => ''))();
    const col = meta.color.replace('#', ''), kc = col.slice(4, 6) + col.slice(2, 4) + col.slice(0, 2);
    const pms = meta.geojson.features.map(f => {
      const p = f.properties || {}, nm = (meta.labelField && p[meta.labelField]) || p.name || p.nombre || '';
      return `<Placemark><name>${esc(nm)}</name><styleUrl>#s</styleUrl><ExtendedData>${Object.entries(p).map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(v)}</value></Data>`).join('')}</ExtendedData>${geom(f.geometry)}</Placemark>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(meta.name)}</name>
<Style id="s"><LineStyle><color>ff${kc}</color><width>2</width></LineStyle><PolyStyle><color>33${kc}</color></PolyStyle></Style>\n${pms}\n</Document></kml>`;
  }
  function exportKml(id) {
    const it = items.find(x => x.meta.id === id); if (!it) return;
    const blob = new Blob([toKml(it.meta)], { type: 'application/vnd.google-earth.kml+xml' });
    window.saveFile(blob, it.meta.name.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_') + '.kml');
  }

  async function load() {
    const all = (await store.all()).sort((a, b) => a.created - b.created);
    all.forEach(add); renderList(); refreshLabels();
  }

  window.Vectors = { importFiles, onGps, whereAmI, all: () => items.map(i => i.meta), setVisible, remove, addFeature, exportKml, toKml, areaM2, lengthM, onChange: null, _crsFromPrj: crsFromPrj, _unzip: unzip };
  load().catch(e => { console.error(e); toast('Error leyendo capas guardadas'); });
})();
