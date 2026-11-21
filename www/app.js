/* app.js — Interfaz, almacenamiento offline (IndexedDB) y GPS */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // ---------- Almacenamiento (IndexedDB) ----------
  const DB = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('mapas-campo', 3);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('maps')) db.createObjectStore('maps', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('points')) db.createObjectStore('points', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('vectors')) db.createObjectStore('vectors', { keyPath: 'id' });
        };
        r.onsuccess = () => res(this._db = r.result);
        r.onerror = () => rej(r.error);
      });
    },
    async tx(mode, fn, store = 'maps') {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction(store, mode), s = t.objectStore(store); const out = fn(s);
        t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
        t.onerror = () => rej(t.error);
      });
    },
    all() { return this.tx('readonly', s => s.getAll()); },
    put(m) { return this.tx('readwrite', s => s.put(m)); },
    del(id) { return this.tx('readwrite', s => s.delete(id)); },
    store(name) {
      return {
        all: () => this.tx('readonly', s => s.getAll(), name),
        put: (o) => this.tx('readwrite', s => s.put(o), name),
        del: (id) => this.tx('readwrite', s => s.delete(id), name)
      };
    }
  };

  // ---------- Mapa ----------
  const map = L.map('map', { zoomControl: false, maxZoom: 22, attributionControl: true }).setView([1.6144, -75.6062], 13); // Florencia
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 22, crossOrigin: true, attribution: '© OpenStreetMap' });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, crossOrigin: true, attribution: 'Esri, Maxar' });
  const clarity = L.tileLayer('https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 22, crossOrigin: true, attribution: 'Esri World Imagery (Clarity)' });
  osm.addTo(map);
  map.createPane('userMaps'); map.getPane('userMaps').style.zIndex = 350;

  const layers = new Map(); // id -> {meta, layer, url}
  let maps = [];

  async function loadMaps() {
    maps = (await DB.all()).sort((a, b) => b.created - a.created);
    for (const m of maps) addLayer(m);
    renderList();
    if (maps.length) { const v = maps.filter(m => m.visible); if (v.length) map.fitBounds(v[0].bounds); }
  }
  function addLayer(m) {
    if (layers.has(m.id)) return;
    const url = URL.createObjectURL(m.blob);
    const layer = L.imageOverlay(url, m.bounds, { pane: 'userMaps', opacity: m.opacity ?? 1, interactive: false });
    if (m.visible) layer.addTo(map);
    layers.set(m.id, { meta: m, layer, url });
  }
  function removeLayer(id) {
    const l = layers.get(id); if (!l) return;
    map.removeLayer(l.layer); URL.revokeObjectURL(l.url); layers.delete(id);
  }

  function renderList() {
    const ul = $('mapList'); ul.innerHTML = '';
    $('emptyList').classList.toggle('hidden', maps.length > 0);
    for (const m of maps) {
      const li = document.createElement('li');
      const kb = Math.round(m.blob.size / 1024);
      li.innerHTML = `
        <div class="name"><input type="checkbox" ${m.visible ? 'checked' : ''}><span></span></div>
        <div class="meta">${labelGeoref(m.georef)} · ${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'} · ${new Date(m.created).toLocaleDateString('es-CO')}</div>
        <div class="actions">
          <button data-a="go">Ir</button>
          <input type="range" min="0.2" max="1" step="0.05" value="${m.opacity ?? 1}" title="Transparencia">
          <button data-a="ren">✎</button>
          <button data-a="del">🗑</button>
        </div>`;
      li.querySelector('.name span').textContent = m.name;
      li.querySelector('input[type=checkbox]').onchange = async (e) => {
        m.visible = e.target.checked; await DB.put(m);
        const l = layers.get(m.id); m.visible ? l.layer.addTo(map) : map.removeLayer(l.layer); updateOutOfMap();
      };
      li.querySelector('input[type=range]').oninput = (e) => { m.opacity = +e.target.value; layers.get(m.id).layer.setOpacity(m.opacity); };
      li.querySelector('input[type=range]').onchange = () => DB.put(m);
      li.querySelector('[data-a=go]').onclick = () => { map.fitBounds(m.bounds); closeDrawer(); };
      li.querySelector('[data-a=ren]').onclick = async () => {
        const n = prompt('Nuevo nombre', m.name); if (n) { m.name = n.trim(); await DB.put(m); renderList(); }
      };
      li.querySelector('[data-a=del]').onclick = async () => {
        if (!confirm(`¿Eliminar "${m.name}" del celular?`)) return;
        await DB.del(m.id); removeLayer(m.id); maps = maps.filter(x => x.id !== m.id); renderList(); updateStorage();
      };
      ul.appendChild(li);
    }
    updateStorage();
    if (window.Library) Library.render();
  }
  // Miniatura para la biblioteca
  async function makeThumb(blob, size = 220) {
    const bmp = await createImageBitmap(blob);
    const k = size / Math.max(bmp.width, bmp.height);
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
  }
  async function setMapVisible(m, v) {
    m.visible = v; await DB.put(m);
    const l = layers.get(m.id); if (l) { v ? l.layer.addTo(map) : map.removeLayer(l.layer); }
  }
  const labelGeoref = (g) => ({ geopdf: 'GeoPDF', geotiff: 'GeoTIFF', worldfile: 'Imagen + archivo de mundo', corners: 'Imagen por esquinas' }[g] || g);

  async function updateStorage() {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    $('storageInfo').textContent = `Espacio usado: ${(e.usage / 1048576).toFixed(1)} MB de ${(e.quota / 1048576 / 1024).toFixed(1)} GB disponibles.` +
      (persisted ? ' Almacenamiento protegido ✔' : ' (el navegador podría borrar datos si falta espacio)');
  }

  // ---------- Panel lateral ----------
  const openDrawer = () => $('drawer').classList.remove('hidden');
  const closeDrawer = () => $('drawer').classList.add('hidden');
  $('btnMenu').onclick = openDrawer; $('btnCloseDrawer').onclick = closeDrawer;
  $('chkBase').onchange = (e) => e.target.checked ? osm.addTo(map) : map.removeLayer(osm);
  $('chkSat').onchange = (e) => e.target.checked ? sat.addTo(map) : map.removeLayer(sat);
  $('chkClarity').onchange = (e) => e.target.checked ? clarity.addTo(map) : map.removeLayer(clarity);

  // ---------- Google satélite (Map Tiles API oficial) ----------
  // Requiere clave API propia con "Map Tiles API" habilitada. Las imágenes de Google
  // no se guardan offline (condiciones de Google Maps Platform).
  let gLayer = null, gTimer = null;
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } } };
  $('gKey').value = LS.get('gKey') || '';
  $('gType').value = LS.get('gType') || 'sat';
  const gMsg = (t) => { $('gMsg').textContent = t; };

  async function gSession(key, type) {
    const cacheKey = 'gSess_' + type, c = JSON.parse(LS.get(cacheKey) || 'null');
    if (c && c.key === key && c.expiry * 1000 > Date.now() + 3600e3) return c.session;
    const body = { mapType: 'satellite', language: 'es-419', region: 'CO' };
    if (type === 'hyb') { body.layerTypes = ['layerRoadmap']; body.overlay = false; }
    const r = await fetch('https://tile.googleapis.com/v1/createSession?key=' + encodeURIComponent(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('Error ' + r.status));
    LS.set(cacheKey, JSON.stringify({ key, session: j.session, expiry: +j.expiry }));
    return j.session;
  }
  async function gEnable() {
    const key = $('gKey').value.trim(), type = $('gType').value;
    if (!key) { $('gBox').classList.remove('hidden'); gMsg('Escribe tu clave API y toca Guardar.'); return; }
    if (!navigator.onLine) { gMsg('Sin internet: Google no está disponible offline.'); $('chkGoogle').checked = false; return; }
    gMsg('Conectando con Google…');
    try {
      const session = await gSession(key, type);
      gDisable();
      gLayer = L.tileLayer(`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${encodeURIComponent(key)}`,
        { maxNativeZoom: 20, maxZoom: 22, attribution: '<b>Google</b>' }).addTo(map);
      gLayer.on('tileerror', () => gMsg('Algunas imágenes de Google no cargaron (zona sin cobertura a ese zoom o cuota agotada).'));
      map.on('moveend', gAttribDebounced); gAttrib();
      LS.set('gOn', '1'); gMsg('Google satélite activo ✔');
    } catch (err) {
      $('chkGoogle').checked = false; LS.set('gOn', '0');
      gMsg('No se pudo activar: ' + err.message + '. Revisa que la clave tenga habilitada "Map Tiles API" y facturación activa.');
    }
  }
  function gDisable() {
    if (gLayer) { map.removeLayer(gLayer); gLayer = null; }
    map.off('moveend', gAttribDebounced);
  }
  function gAttribDebounced() { clearTimeout(gTimer); gTimer = setTimeout(gAttrib, 600); }
  async function gAttrib() {
    // Atribución obligatoria: créditos de la zona visible
    if (!gLayer) return;
    try {
      const b = map.getBounds(), key = $('gKey').value.trim(), u = gLayer._url.match(/session=([^&]+)/)[1];
      const q = `session=${u}&key=${encodeURIComponent(key)}&zoom=${Math.round(map.getZoom())}&north=${b.getNorth()}&south=${b.getSouth()}&east=${b.getEast()}&west=${b.getWest()}`;
      const j = await (await fetch('https://tile.googleapis.com/tile/v1/viewport?' + q)).json();
      if (j.maxZoom && gLayer) gLayer.options.maxNativeZoom = Math.min(j.maxZoom, 22);
      const txt = '<b>Google</b>' + (j.copyright ? ' · ' + j.copyright.replace(/[<>]/g, '') : '');
      map.attributionControl.removeAttribution(gLayer.getAttribution()); gLayer.options.attribution = txt; map.attributionControl.addAttribution(txt);
    } catch (e) { /* sin red: se mantiene la atribución básica */ }
  }
  $('chkGoogle').onchange = (e) => {
    $('gBox').classList.toggle('hidden', !e.target.checked && !!$('gKey').value);
    if (e.target.checked) gEnable(); else { gDisable(); LS.set('gOn', '0'); gMsg(''); }
  };
  $('gSave').onclick = () => { LS.set('gKey', $('gKey').value.trim()); LS.set('gType', $('gType').value); $('chkGoogle').checked = true; gEnable(); };
  $('gType').onchange = () => { LS.set('gType', $('gType').value); if ($('chkGoogle').checked) gEnable(); };
  if (LS.get('gOn') === '1' && LS.get('gKey')) { $('chkGoogle').checked = true; $('gBox').classList.remove('hidden'); gEnable(); }

  // ---------- Importación ----------
  const dlg = $('dlgImport');
  const sel = $('impCrs');
  Object.entries(Georef.CRS).forEach(([k, v]) => { const o = document.createElement('option'); o.value = k; o.textContent = `${v.name} (${k})`; sel.appendChild(o); });
  sel.value = 'EPSG:9377';
  let pending = null; // {main, world, kind}

  $('btnAdd').onclick = () => {
    $('formImport').reset(); if (autoOpt.parentNode) autoOpt.remove(); sel.value = 'EPSG:9377'; pending = null; $('qualityBox').classList.remove('hidden');
    ['crsBox', 'cornersBox', 'pdfPageBox'].forEach(id => $(id).classList.add('hidden'));
    setStatus(''); dlg.showModal();
  };
  $('btnImpCancel').onclick = () => dlg.close();
  const autoOpt = document.createElement('option'); autoOpt.value = 'auto'; autoOpt.textContent = 'Automático (según el .prj del shapefile)';
  $('fileInput').onchange = (e) => {
    const files = [...e.target.files];
    $('qualityBox').classList.remove('hidden');
    if (autoOpt.parentNode) autoOpt.remove();
    if (files.some(f => /\.(zip|shp|kml|kmz)$/i.test(f.name))) {
      pending = { files, kind: 'vector', main: files[0] };
      if (!$('impName').value) $('impName').value = files.find(f => /\.(zip|shp|kml|kmz)$/i.test(f.name)).name.replace(/\.[^.]+$/, '');
      ['pdfPageBox', 'cornersBox', 'qualityBox'].forEach(id => $(id).classList.add('hidden'));
      sel.prepend(autoOpt); sel.value = 'auto';
      $('crsBox').classList.toggle('hidden', !files.some(f => /\.(zip|shp)$/i.test(f.name)));
      setStatus('Capa vectorial: ' + files.map(f => f.name).join(', '));
      return;
    }
    if (sel.value === 'auto') sel.value = 'EPSG:9377';
    const main = files.find(f => /\.(pdf|tiff?|jpe?g|png)$/i.test(f.name));
    const world = files.find(f => /\.(jgw|pgw|tfw|wld)$/i.test(f.name));
    if (!main) { setStatus('Selecciona un archivo .pdf, .tif, .jpg o .png', true); return; }
    const kind = /\.pdf$/i.test(main.name) ? 'pdf' : /\.tiff?$/i.test(main.name) ? 'tiff' : 'img';
    pending = { main, world, kind };
    if (!$('impName').value) $('impName').value = main.name.replace(/\.[^.]+$/, '');
    $('pdfPageBox').classList.toggle('hidden', kind !== 'pdf');
    $('crsBox').classList.toggle('hidden', !(kind === 'img' && world));
    $('cornersBox').classList.toggle('hidden', !(kind === 'img' && !world));
    setStatus(kind === 'img' && !world ? 'Imagen sin georreferencia: puedes seleccionar también su .jgw/.pgw, o escribir las esquinas.' : '');
  };
  function setStatus(t, err) { const s = $('impStatus'); s.textContent = t; s.classList.toggle('err', !!err); }

  $('btnImpOk').onclick = async () => {
    if (!pending) { setStatus('Primero selecciona un archivo', true); return; }
    const btn = $('btnImpOk'); btn.disabled = true;
    try {
      if (pending.kind === 'vector') {
        try {
          const saved = await Vectors.importFiles(pending.files, $('impName').value.trim(), sel.value, setStatus);
          dlg.close(); if (window.Library) Library.afterImport(null); toast(saved.length === 1 ? `Capa "${saved[0].name}" cargada (${saved[0].count} elementos) ✔` : `${saved.length} capas cargadas ✔`);
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(updateStorage);
        } catch (err) {
          if (err.needCrs) { $('crsBox').classList.remove('hidden'); if (sel.value === 'auto') sel.value = 'EPSG:9377'; }
          throw err;
        }
        return;
      }
      const maxDim = +$('impQuality').value;
      let r;
      if (pending.kind === 'pdf') {
        r = await Georef.loadPdf(pending.main, +$('pdfPage').value, maxDim, setStatus);
        if (r.georef === 'none') {
          if (!$('cornersBox').classList.contains('hidden') && readCorners()) {
            const c = readCorners(), w = r.width, h = r.height;
            r.pix2ll = (px, py) => [c.w + (c.e - c.w) * px / w, c.n - (c.n - c.s) * py / h]; r.georef = 'corners';
          } else {
            $('cornersBox').classList.remove('hidden');
            throw new Error('Este PDF no tiene georreferencia reconocible. Escribe las esquinas y vuelve a tocar Importar.');
          }
        }
      } else if (pending.kind === 'tiff') {
        const crs = $('crsBox').classList.contains('hidden') ? null : sel.value;
        setStatus('Leyendo GeoTIFF…');
        r = await Georef.loadTiff(pending.main, maxDim, crs, setStatus);
        if (r.needCrs) {
          $('crsBox').classList.remove('hidden');
          throw new Error(`No se pudo identificar el sistema de coordenadas${r.detected ? ' (' + r.detected + ')' : ''}. Elígelo y vuelve a tocar Importar.`);
        }
      } else {
        const world = pending.world ? await pending.world.text() : null;
        const corners = world ? null : readCorners();
        if (!world && !corners) throw new Error('Completa las 4 esquinas (N, S, O, E) o selecciona el archivo de mundo.');
        r = await Georef.loadImage(pending.main, world, sel.value, corners, maxDim);
      }
      setStatus('Ajustando el mapa a coordenadas…');
      const w = await Georef.warpToMercator(r.canvas, r.width, r.height, r.pix2ll, maxDim);
      if (r.canvas instanceof HTMLCanvasElement) r.canvas.width = r.canvas.height = 0;
      else if (r.canvas && r.canvas.close) r.canvas.close();
      const m = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: $('impName').value.trim() || pending.main.name, blob: w.blob, bounds: w.bounds,
        georef: r.georef, crs: r.crs || null, created: Date.now(), visible: true, opacity: 1, sourceName: pending.main.name
      };
      try { m.thumb = await makeThumb(w.blob); } catch (e) { }
      await DB.put(m); maps.unshift(m); addLayer(m); renderList();
      map.fitBounds(m.bounds);
      if (window.Library) Library.afterImport(m);
      dlg.close(); toast(`Mapa "${m.name}" guardado en el celular ✔`);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(updateStorage);
    } catch (err) {
      console.error(err); setStatus(err.message || String(err), true);
    } finally { btn.disabled = false; }
  };
  function readCorners() {
    const v = ['cN', 'cS', 'cW', 'cE'].map(id => parseFloat($(id).value));
    if (v.some(x => !isFinite(x))) return null;
    return { n: v[0], s: v[1], w: v[2], e: v[3] };
  }

  // ---------- GPS ----------
  let lastAcc = null, lastAlt = null;
  let watchId = null, follow = true, last = null, gpsMarker = null, accCircle = null, heading = null, wakeLock = null;
  const icon = L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: '<div class="gps-wrap"><div class="gps-head hidden"></div><div class="gps-dot"></div></div>' });

  $('btnGps').onclick = () => (watchId === null ? startGps() : stopGps());
  $('btnFollow').onclick = () => { if (watchId === null) return; follow = !follow; $('btnFollow').classList.toggle('active', follow); if (follow && last) map.panTo(last); };
  map.on('dragstart', () => { if (follow) { follow = false; $('btnFollow').classList.remove('active'); } });

  function startGps() {
    if (!('geolocation' in navigator)) return toast('Este dispositivo no tiene GPS disponible');
    follow = true;
    $('btnGps').classList.add('active'); $('btnFollow').disabled = false; $('btnFollow').classList.add('active');
    $('coords').classList.remove('hidden');
    $('cAcc').textContent = 'Buscando señal GPS…';
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
    startCompass(); keepAwake();
  }
  function stopGps() {
    navigator.geolocation.clearWatch(watchId); watchId = null;
    $('btnGps').classList.remove('active'); $('btnFollow').disabled = true; $('btnFollow').classList.remove('active'); $('coords').classList.add('hidden');
    last = null; if (window.Library) Library.onGps(null);
    if (gpsMarker) { map.removeLayer(gpsMarker); map.removeLayer(accCircle); gpsMarker = accCircle = null; }
    if (wakeLock) { wakeLock.release().catch(() => { }); wakeLock = null; }
  }
  function onPos(p) {
    const { latitude: lat, longitude: lon, accuracy, altitude } = p.coords;
    last = L.latLng(lat, lon); lastAcc = accuracy; lastAlt = altitude;
    if (!gpsMarker) {
      gpsMarker = L.marker(last, { icon, interactive: false, zIndexOffset: 1000 }).addTo(map);
      accCircle = L.circle(last, { radius: accuracy, color: '#1a73e8', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
      map.setView(last, Math.max(map.getZoom(), 17));
    } else { gpsMarker.setLatLng(last); accCircle.setLatLng(last).setRadius(accuracy); }
    if (p.coords.heading != null && !isNaN(p.coords.heading) && p.coords.speed > 0.5) setHeading(p.coords.heading);
    if (follow) map.panTo(last, { animate: true });
    const [E, N] = ProjUtil.toCtm12(lon, lat);
    $('cLatLon').textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    $('cDms').textContent = `${dms(lat, 'N', 'S')}  ${dms(lon, 'E', 'W')}`;
    $('cCtm').textContent = `E ${E.toFixed(2)}  N ${N.toFixed(2)}`;
    $('cAcc').textContent = `Precisión ±${Math.round(accuracy)} m`;
    $('cAlt').textContent = altitude != null ? `Altitud ${Math.round(altitude)} m` : '';
    updateOutOfMap();
    if (window.Vectors) Vectors.onGps(last);
    if (window.Library) Library.onGps(last, accuracy);
  }
  function onPosErr(e) {
    const msg = { 1: 'Permiso de ubicación denegado. Actívalo en la configuración del navegador.', 2: 'No hay señal GPS. Sal a cielo abierto.', 3: 'El GPS está tardando… sigue intentando.' }[e.code] || e.message;
    $('cAcc').textContent = msg; if (e.code === 1) { toast(msg); stopGps(); }
  }
  function dms(v, pos, neg) {
    const s = v >= 0 ? pos : neg; v = Math.abs(v);
    const d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), sec = (mf - m) * 60;
    return `${d}°${String(m).padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}"${s}`;
  }
  function setHeading(h) {
    heading = h; const el = gpsMarker && gpsMarker.getElement(); if (!el) return;
    const hd = el.querySelector('.gps-head'); hd.classList.remove('hidden'); hd.style.transform = `rotate(${h}deg)`;
  }
  function startCompass() {
    const handler = (e) => {
      let h = e.webkitCompassHeading != null ? e.webkitCompassHeading : (e.absolute && e.alpha != null ? 360 - e.alpha : null);
      if (h != null) setHeading((h + (screen.orientation ? screen.orientation.angle : 0)) % 360);
    };
    const add = () => window.addEventListener('ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation', handler);
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(s => s === 'granted' && add()).catch(() => { });
    } else add();
  }
  async function keepAwake() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && watchId !== null) keepAwake(); });

  function updateOutOfMap() {
    const box = $('cOut'); const vis = maps.filter(m => m.visible);
    if (!last || !vis.length) return box.classList.add('hidden');
    if (vis.some(m => L.latLngBounds(m.bounds).contains(last))) return box.classList.add('hidden');
    let best = null;
    for (const m of vis) { const c = L.latLngBounds(m.bounds).getCenter(); const d = last.distanceTo(c); if (!best || d < best.d) best = { m, c, d }; }
    box.textContent = `Estás fuera de tus mapas. "${best.m.name}" está a ${fmtDist(best.d)} hacia el ${bearingTxt(last, best.c)}.`;
    box.classList.remove('hidden');
  }
  const fmtDist = (d) => d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
  function bearingTxt(a, b) {
    const t = Math.atan2(Math.sin((b.lng - a.lng) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180),
      Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lng - a.lng) * Math.PI / 180));
    const deg = (t * 180 / Math.PI + 360) % 360;
    return ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'][Math.round(deg / 45) % 8];
  }

  // Tocar el mapa: coordenadas del punto (útil para comparar con linderos)
  // (mantener presionado en el celular = 'contextmenu')
  map.on('contextmenu', (e) => {
    const { lat, lng } = e.latlng; const [E, N] = ProjUtil.toCtm12(lng, lat);
    let html = `<b>Punto</b><br>${lat.toFixed(6)}, ${lng.toFixed(6)}<br>CTM12: E ${E.toFixed(2)} N ${N.toFixed(2)}`;
    if (last) html += `<br>A ${fmtDist(last.distanceTo(e.latlng))} de tu posición`;
    html += `<br><button class="pop-btn" id="popAddPt">📌 Agregar punto aquí</button>`;
    L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
    const b = document.getElementById('popAddPt');
    if (b) b.onclick = () => { map.closePopup(); window.Points && Points.openNew(e.latlng, null); };
  });

  // ---------- Estado de red ----------
  function net() { const on = navigator.onLine; ['netBadge', 'libNet'].forEach(id => { const b = $(id); if (!b) return; b.textContent = on ? 'En línea' : 'Sin internet'; b.classList.toggle('off', !on); }); }
  window.addEventListener('online', net); window.addEventListener('offline', net); net();

  // ---------- Toast ----------
  let tt; function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(tt); tt = setTimeout(() => el.classList.add('hidden'), 3500); }

  // ---------- Service worker (offline) ----------
  // ---------- Guardar / compartir archivos (web y APK) ----------
  const isNative = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  async function blobToBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer()); let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }
  window.saveFile = async function (blob, filename) {
    if (isNative) {
      // En el APK: se guarda en la memoria de la app y se abre el menú Compartir (WhatsApp, Drive, Gmail, Archivos…)
      try {
        const { Filesystem, Share } = Capacitor.Plugins;
        const r = await Filesystem.writeFile({ path: filename, data: await blobToBase64(blob), directory: 'CACHE' });
        await Share.share({ title: filename, files: [r.uri], dialogTitle: 'Guardar o enviar ' + filename });
      } catch (e) { if (!/cancel/i.test(String(e && (e.message || e)))) toast('No se pudo compartir: ' + (e.message || e)); }
      return;
    }
    const file = new File([blob], filename, { type: blob.type });
    if (matchMedia('(pointer:coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`${filename} guardado en Descargas`);
  };

  if (!isNative && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  }

  window.__app = { map, DB, maps: () => maps, toast, setMapVisible, makeThumb, renderList, startGps: () => { if (watchId === null) startGps(); }, gpsOn: () => watchId !== null,
    openImport: () => $('btnAdd').click(), deleteMap: async (m) => { await DB.del(m.id); removeLayer(m.id); maps = maps.filter(x => x.id !== m.id); renderList(); updateStorage(); }, setFollow: (v) => { follow = v; $('btnFollow').classList.toggle('active', v); }, getGps: () => (last ? { latlng: last, acc: lastAcc, alt: lastAlt } : null), fmtDist };
  loadMaps().catch(e => { console.error(e); toast('Error leyendo mapas guardados'); });
})();
