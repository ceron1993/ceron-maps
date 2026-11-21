/* points.js — Puntos de campo (con foto opcional) y exportación KML / KMZ */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const { map, DB, toast, getGps, fmtDist } = window.__app;
  const store = DB.store('points');
  const group = L.layerGroup().addTo(map);
  map.createPane('points'); map.getPane('points').style.zIndex = 620;
  let points = [], editing = null, photoBlob = null, photoUrl = null, showLabels = true;

  // ---------- Carga y dibujo ----------
  async function load() {
    points = (await store.all()).sort((a, b) => a.created - b.created);
    draw(); renderList();
  }
  function draw() {
    group.clearLayers();
    for (const p of points) {
      const m = L.circleMarker([p.lat, p.lon], { pane: 'points', radius: 8, color: '#fff', weight: 2, fillColor: '#e8590c', fillOpacity: 1 });
      if (showLabels) m.bindTooltip(esc(p.name), { permanent: true, direction: 'right', offset: [8, 0], className: 'pt-label' });
      m.on('click', () => openPopup(p, m));
      group.addLayer(m);
    }
    $('ptCount').textContent = points.length ? `(${points.length})` : '';
  }
  function openPopup(p, m) {
    const [E, N] = ProjUtil.toCtm12(p.lon, p.lat), g = getGps();
    const div = document.createElement('div'); div.className = 'pt-pop';
    div.innerHTML = `<b></b><div class="d"></div>${p.photo ? '<img>' : ''}
      <div class="small">${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}<br>CTM12: E ${E.toFixed(2)} N ${N.toFixed(2)}
      ${p.acc != null ? `<br>Precisión ±${Math.round(p.acc)} m` : ''}<br>${new Date(p.created).toLocaleString('es-CO')}
      ${g ? `<br>A ${fmtDist(g.latlng.distanceTo([p.lat, p.lon]))} de ti` : ''}</div>
      <div class="acts"><button data-a="e">✎ Editar</button><button data-a="d">🗑 Borrar</button></div>`;
    div.querySelector('b').textContent = p.name;
    div.querySelector('.d').textContent = p.desc || '';
    if (p.photo) div.querySelector('img').src = URL.createObjectURL(p.photo);
    div.querySelector('[data-a=e]').onclick = () => { map.closePopup(); openEdit(p); };
    div.querySelector('[data-a=d]').onclick = () => { map.closePopup(); remove(p); };
    L.popup().setLatLng([p.lat, p.lon]).setContent(div).openOn(map);
  }
  function renderList() {
    const ul = $('ptList'); ul.innerHTML = '';
    $('emptyPts').classList.toggle('hidden', points.length > 0);
    [...points].reverse().forEach(p => {
      const li = document.createElement('li');
      li.innerHTML = `${p.photo ? '<img>' : ''}<div class="pn"><b></b><span>${new Date(p.created).toLocaleString('es-CO')}</span></div>
        <button data-a="go">Ir</button><button data-a="e">✎</button><button data-a="d">🗑</button>`;
      li.querySelector('b').textContent = p.name;
      if (p.photo) li.querySelector('img').src = URL.createObjectURL(p.photo);
      li.querySelector('[data-a=go]').onclick = () => { $('drawer').classList.add('hidden'); map.setView([p.lat, p.lon], Math.max(map.getZoom(), 18)); };
      li.querySelector('[data-a=e]').onclick = () => openEdit(p);
      li.querySelector('[data-a=d]').onclick = () => remove(p);
      ul.appendChild(li);
    });
  }
  async function remove(p) {
    if (!confirm(`¿Eliminar el punto "${p.name}"? No se puede deshacer.`)) return false;
    await store.del(p.id); points = points.filter(x => x.id !== p.id); draw(); renderList();
    toast(`Punto "${p.name}" eliminado`); return true;
  }

  // ---------- Diálogo nuevo / editar ----------
  const dlg = $('dlgPoint');
  function nextName() {
    let max = 0; points.forEach(p => { const m = /^P(\d+)$/.exec(p.name); if (m) max = Math.max(max, +m[1]); });
    return 'P' + String(max + 1).padStart(3, '0');
  }
  function openNew(latlng, gps) {
    editing = { id: null, lat: latlng.lat, lon: latlng.lng, acc: gps ? gps.acc : null, alt: gps ? gps.alt : null, source: gps ? 'GPS' : 'Mapa' };
    $('ptTitle').textContent = 'Nuevo punto'; $('ptName').value = nextName(); $('ptDesc').value = '';
    $('ptDelete').classList.add('hidden');
    setPhoto(null); showCoords(); dlg.showModal();
  }
  function openEdit(p) {
    editing = { ...p }; $('ptTitle').textContent = 'Editar punto';
    $('ptDelete').classList.remove('hidden');
    $('ptName').value = p.name; $('ptDesc').value = p.desc || ''; setPhoto(p.photo || null); showCoords(); dlg.showModal();
  }
  function showCoords() {
    const [E, N] = ProjUtil.toCtm12(editing.lon, editing.lat);
    $('ptCoords').textContent = `${editing.source === 'GPS' ? '📍 GPS' : '🗺 Punto del mapa'} · ${editing.lat.toFixed(6)}, ${editing.lon.toFixed(6)} · CTM12 E ${E.toFixed(2)} N ${N.toFixed(2)}` +
      (editing.acc != null ? ` · ±${Math.round(editing.acc)} m` : '');
  }
  function setPhoto(blob) {
    photoBlob = blob; if (photoUrl) URL.revokeObjectURL(photoUrl); photoUrl = null;
    $('ptPhoto').value = '';
    $('ptPhotoPrev').classList.toggle('hidden', !blob); $('ptPhotoDel').classList.toggle('hidden', !blob);
    if (blob) $('ptPhotoPrev').src = photoUrl = URL.createObjectURL(blob);
  }
  $('ptPhoto').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { setPhoto(await resizePhoto(f, 1600)); } catch (err) { toast('No se pudo leer la foto'); }
  };
  $('ptPhotoDel').onclick = () => setPhoto(null);
  $('ptCancel').onclick = () => dlg.close();
  $('ptDelete').onclick = async () => {
    const p = points.find(x => x.id === editing.id); if (!p) return dlg.close();
    if (await remove(p)) dlg.close();
  };
  $('ptSave').onclick = async () => {
    const p = {
      ...editing, id: editing.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: $('ptName').value.trim() || nextName(), desc: $('ptDesc').value.trim(),
      photo: photoBlob, created: editing.created || Date.now()
    };
    await store.put(p);
    points = points.filter(x => x.id !== p.id).concat(p).sort((a, b) => a.created - b.created);
    draw(); renderList(); dlg.close(); toast(`Punto "${p.name}" guardado`);
  };
  async function resizePhoto(file, max) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(), 'image/jpeg', 0.85));
  }

  // ---------- Modo "ubicar punto" con puntero ----------
  // 📌 muestra un puntero fijo en el centro; se mueve el mapa debajo. Se puede tomar
  // el punto en la posición GPS exacta o donde esté el puntero.
  let placing = false;
  function startPlacing() {
    placing = true; document.body.classList.add('placing');
    $('crosshair').classList.remove('hidden'); $('placeBar').classList.remove('hidden');
    const g = getGps();
    if (window.__app.setFollow) window.__app.setFollow(false);
    if (g) map.setView(g.latlng, Math.max(map.getZoom(), 18));
    updatePlaceBar();
  }
  function stopPlacing() {
    placing = false; document.body.classList.remove('placing');
    $('crosshair').classList.add('hidden'); $('placeBar').classList.add('hidden');
  }
  function updatePlaceBar() {
    if (!placing) return;
    const c = map.getCenter(), [E, N] = ProjUtil.toCtm12(c.lng, c.lat), g = getGps();
    let t = `Puntero: ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)} · CTM12 E ${E.toFixed(1)} N ${N.toFixed(1)}`;
    if (g) t += ` · a ${fmtDist(g.latlng.distanceTo(c))} de tu GPS (±${Math.round(g.acc)} m)`;
    if (window.Vectors) { const h = Vectors.whereAmI(c)[0]; if (h) { const v = h.it.meta.labelField ? h.ft.f.properties[h.it.meta.labelField] : ''; t += ` · en ${v || 'polígono'} (${h.it.meta.name})`; } }
    $('pbCoords').textContent = t;
    $('pbGps').disabled = !g; $('pbCenter').disabled = !g;
    $('pbGps').textContent = g ? '📍 Tomar en mi GPS' : '📍 GPS sin señal';
  }
  map.on('move', updatePlaceBar);
  setInterval(updatePlaceBar, 2000); // refresca la distancia mientras el GPS se mueve
  $('btnPoint').onclick = () => {
    if (window.Measure) Measure.stop();
    if (!getGps()) toast('Tip: activa 📍 para poder tomar el punto con tu GPS');
    startPlacing();
  };
  $('pbGps').onclick = () => { const g = getGps(); if (!g) return; stopPlacing(); openNew(g.latlng, g); };
  $('pbHere').onclick = () => { const c = map.getCenter(); stopPlacing(); openNew(c, null); };
  $('pbCenter').onclick = () => { const g = getGps(); if (g) map.setView(g.latlng, Math.max(map.getZoom(), 18)); };
  $('pbCancel').onclick = stopPlacing;
  $('chkPtLabels').onchange = (e) => { showLabels = e.target.checked; draw(); };

  // ---------- Exportación ----------
  const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  function buildKml(withPhotos) {
    const now = new Date();
    const pm = points.map(p => {
      const [E, N] = ProjUtil.toCtm12(p.lon, p.lat);
      const fecha = new Date(p.created);
      let html = p.desc ? esc(p.desc).replace(/\n/g, '<br>') : '';
      if (withPhotos && p.photo) html += `${html ? '<br>' : ''}<img src="files/${p.id}.jpg" width="400">`;
      const data = {
        descripcion: p.desc || '', fecha: fecha.toISOString(), latitud: p.lat.toFixed(7), longitud: p.lon.toFixed(7),
        este_ctm12: E.toFixed(2), norte_ctm12: N.toFixed(2),
        precision_m: p.acc != null ? p.acc.toFixed(1) : '', altitud_m: p.alt != null ? p.alt.toFixed(1) : '',
        origen: p.source || '', foto: withPhotos && p.photo ? `files/${p.id}.jpg` : ''
      };
      return `    <Placemark>
      <name>${esc(p.name)}</name>
      <description><![CDATA[${html}]]></description>
      <TimeStamp><when>${fecha.toISOString()}</when></TimeStamp>
      <styleUrl>#pt</styleUrl>
      <ExtendedData>
${Object.entries(data).map(([k, v]) => `        <Data name="${k}"><value>${esc(v)}</value></Data>`).join('\n')}
      </ExtendedData>
      <Point><coordinates>${p.lon.toFixed(7)},${p.lat.toFixed(7)}${p.alt != null ? ',' + p.alt.toFixed(1) : ''}</coordinates></Point>
    </Placemark>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Puntos de campo ${now.toLocaleDateString('es-CO')}</name>
    <Style id="pt"><IconStyle><color>ff0c59e8</color><scale>1.1</scale>
      <Icon><href>http://maps.google.com/mapfiles/kml/paddle/orange-circle.png</href></Icon></IconStyle></Style>
${pm}
  </Document>
</kml>`;
  }

  // ZIP mínimo (sin compresión) para KMZ
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) { // files: [{name, data: Uint8Array}]
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    const d = new Date(), dt = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)), dd = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate());
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + sz;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/vnd.google-earth.kmz' });
  }

  const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };
  const deliver = (blob, filename) => window.saveFile(blob, filename);
  $('btnExpKml').onclick = () => {
    if (!points.length) return toast('No hay puntos para exportar');
    deliver(new Blob([buildKml(false)], { type: 'application/vnd.google-earth.kml+xml' }), `puntos_${stamp()}.kml`);
  };
  $('btnExpKmz').onclick = async () => {
    if (!points.length) return toast('No hay puntos para exportar');
    const files = [{ name: 'doc.kml', data: new TextEncoder().encode(buildKml(true)) }];
    for (const p of points) if (p.photo) files.push({ name: `files/${p.id}.jpg`, data: new Uint8Array(await p.photo.arrayBuffer()) });
    deliver(zip(files), `puntos_${stamp()}.kmz`);
  };

  window.Points = { openNew, openEdit, all: () => points, buildKml, _zip: zip };
  load().catch(e => { console.error(e); toast('Error leyendo puntos guardados'); });
})();
