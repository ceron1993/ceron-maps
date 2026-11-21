/* georef.js — Lectura de GeoPDF / GeoTIFF / imagen + archivo de mundo,
   y reproyección (warp) a Web Mercator para mostrarlos en Leaflet. */
(function (global) {
  'use strict';

  // ---------- Sistemas de coordenadas usados en Colombia ----------
  const CRS = {
    'EPSG:9377': { name: 'MAGNA-SIRGAS Origen Nacional (CTM12)', def: '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    'EPSG:3116': { name: 'MAGNA-SIRGAS Colombia Bogotá', def: '+proj=tmerc +lat_0=4.596200416666666 +lon_0=-74.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    'EPSG:3115': { name: 'MAGNA-SIRGAS Colombia Oeste', def: '+proj=tmerc +lat_0=4.596200416666666 +lon_0=-77.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    'EPSG:3117': { name: 'MAGNA-SIRGAS Colombia Este Central', def: '+proj=tmerc +lat_0=4.596200416666666 +lon_0=-71.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    'EPSG:3118': { name: 'MAGNA-SIRGAS Colombia Este', def: '+proj=tmerc +lat_0=4.596200416666666 +lon_0=-68.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    'EPSG:3114': { name: 'MAGNA-SIRGAS Colombia Oeste Oeste', def: '+proj=tmerc +lat_0=4.596200416666666 +lon_0=-80.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs' },
    'EPSG:21896': { name: 'Datum Bogotá 1975 / Colombia Oeste', def: '+proj=tmerc +lat_0=4.599047222222222 +lon_0=-77.08091666666667 +k=1 +x_0=1000000 +y_0=1000000 +ellps=intl +towgs84=307,304,-318,0,0,0,0 +units=m +no_defs' },
    'EPSG:21897': { name: 'Datum Bogotá 1975 / Colombia Bogotá', def: '+proj=tmerc +lat_0=4.599047222222222 +lon_0=-74.08091666666667 +k=1 +x_0=1000000 +y_0=1000000 +ellps=intl +towgs84=307,304,-318,0,0,0,0 +units=m +no_defs' },
    'EPSG:21898': { name: 'Datum Bogotá 1975 / Colombia Este Central', def: '+proj=tmerc +lat_0=4.599047222222222 +lon_0=-71.08091666666667 +k=1 +x_0=1000000 +y_0=1000000 +ellps=intl +towgs84=307,304,-318,0,0,0,0 +units=m +no_defs' },
    'EPSG:21899': { name: 'Datum Bogotá 1975 / Colombia Este', def: '+proj=tmerc +lat_0=4.599047222222222 +lon_0=-68.08091666666667 +k=1 +x_0=1000000 +y_0=1000000 +ellps=intl +towgs84=307,304,-318,0,0,0,0 +units=m +no_defs' },
    'EPSG:32617': { name: 'WGS84 / UTM 17N', def: '+proj=utm +zone=17 +datum=WGS84 +units=m +no_defs' },
    'EPSG:32618': { name: 'WGS84 / UTM 18N', def: '+proj=utm +zone=18 +datum=WGS84 +units=m +no_defs' },
    'EPSG:32619': { name: 'WGS84 / UTM 19N', def: '+proj=utm +zone=19 +datum=WGS84 +units=m +no_defs' },
    'EPSG:32718': { name: 'WGS84 / UTM 18S', def: '+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs' },
    'EPSG:4326': { name: 'WGS84 geográficas (lat/lon)', def: '+proj=longlat +datum=WGS84 +no_defs' },
    'EPSG:4686': { name: 'MAGNA-SIRGAS geográficas (lat/lon)', def: '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs' },
    'EPSG:3857': { name: 'Web Mercator', def: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs' }
  };
  Object.entries(CRS).forEach(([k, v]) => proj4.defs(k, v.def));

  function ensureCrs(code) {
    if (CRS[code] || proj4.defs(code)) return true;
    const n = +String(code).split(':')[1];
    if (n >= 32601 && n <= 32660) { proj4.defs(code, `+proj=utm +zone=${n - 32600} +datum=WGS84 +units=m +no_defs`); return true; }
    if (n >= 32701 && n <= 32760) { proj4.defs(code, `+proj=utm +zone=${n - 32700} +south +datum=WGS84 +units=m +no_defs`); return true; }
    return false;
  }
  const toWgs = (code) => { const p = proj4(code, 'EPSG:4326'); return (x, y) => p.forward([x, y]); };

  // ---------- Utilidades ----------
  const R = 6378137;
  const merc = (lon, lat) => [R * lon * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
  const unmerc = (x, y) => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];

  // Ajuste afín por mínimos cuadrados: (u,v) -> (x,y). Devuelve [a,b,c,d,e,f] con
  // x = a*u + c*v + e ; y = b*u + d*v + f  (mismo orden que canvas.setTransform)
  function fitAffine(src, dst) {
    const solve = (vals) => {
      let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], t = [0, 0, 0];
      src.forEach(([u, v], i) => {
        const r = [u, v, 1];
        for (let a = 0; a < 3; a++) { t[a] += r[a] * vals[i]; for (let b = 0; b < 3; b++) S[a][b] += r[a] * r[b]; }
      });
      return gauss(S, t);
    };
    const px = solve(dst.map(p => p[0])), py = solve(dst.map(p => p[1]));
    return [px[0], py[0], px[1], py[1], px[2], py[2]];
  }
  function gauss(A, b) {
    const n = b.length; A = A.map((r, i) => [...r, b[i]]);
    for (let i = 0; i < n; i++) {
      let m = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k;
      [A[i], A[m]] = [A[m], A[i]];
      if (Math.abs(A[i][i]) < 1e-18) throw new Error('Georreferencia degenerada');
      for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j <= n; j++) A[k][j] -= f * A[i][j]; }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = A[i][n]; for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
    return x;
  }

  /* Reproyecta una imagen fuente a Web Mercator norte-arriba.
     src: canvas/imagen; w,h: tamaño; pix2ll(px,py) -> [lon,lat]; maxDim: lado máximo de salida. */
  async function warpToMercator(src, w, h, pix2ll, maxDim) {
    const N = 8, sp = [], mp = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const px = w * i / N, py = h * j / N, ll = pix2ll(px, py);
      if (!isFinite(ll[0]) || !isFinite(ll[1]) || Math.abs(ll[1]) > 85) throw new Error('Coordenadas fuera de rango: revisa el sistema de coordenadas');
      sp.push([px, py]); mp.push(merc(ll[0], ll[1]));
    }
    const xs = mp.map(p => p[0]), ys = mp.map(p => p[1]);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const dx = maxx - minx, dy = maxy - miny;
    // Conserva aprox. la resolución de la fuente sin pasar de maxDim
    const srcDiag = Math.hypot(w, h), outDiag = Math.min(maxDim * Math.SQRT2, srcDiag * 1.05);
    const scale = outDiag / Math.hypot(dx, dy);
    let ow = Math.max(1, Math.round(dx * scale)), oh = Math.max(1, Math.round(dy * scale));
    const k = Math.min(1, maxDim / Math.max(ow, oh)); ow = Math.round(ow * k); oh = Math.round(oh * k);
    const sx = ow / dx, sy = oh / dy;
    const op = mp.map(([x, y]) => [(x - minx) * sx, (maxy - y) * sy]);
    const T = fitAffine(sp, op);
    // error residual del ajuste afín (en píxeles de salida)
    let maxErr = 0; sp.forEach(([u, v], i) => {
      const x = T[0] * u + T[2] * v + T[4], y = T[1] * u + T[3] * v + T[5];
      maxErr = Math.max(maxErr, Math.hypot(x - op[i][0], y - op[i][1]));
    });
    const out = document.createElement('canvas'); out.width = ow; out.height = oh;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]);
    ctx.drawImage(src, 0, 0);
    const blob = await canvasToBlob(out);
    const sw = unmerc(minx, miny), ne = unmerc(maxx, maxy);
    out.width = out.height = 0; // libera memoria
    return { blob, bounds: [[sw[1], sw[0]], [ne[1], ne[0]]], width: ow, height: oh, residualPx: maxErr };
  }
  function canvasToBlob(c) {
    return new Promise((res, rej) => {
      c.toBlob(b => {
        if (b && b.type === 'image/webp') return res(b);
        c.toBlob(b2 => b2 ? res(b2) : rej(new Error('No se pudo generar la imagen (¿muy grande para este celular?)')), 'image/png');
      }, 'image/webp', 0.9);
    });
  }

  // ---------- GeoPDF ----------
  const latin1 = (u8) => { let s = ''; const C = 0x8000; for (let i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C)); return s; };
  async function inflate(bytes) {
    if (!('DecompressionStream' in global)) return null;
    for (const fmt of ['deflate', 'deflate-raw']) {
      try {
        const ds = new DecompressionStream(fmt), w = ds.writable.getWriter(), rd = ds.readable.getReader();
        w.write(bytes).catch(() => { }); w.close().catch(() => { });
        const parts = []; let n = 0;
        try { for (; ;) { const { value, done } = await rd.read(); if (done) break; parts.push(value); n += value.length; } }
        catch (e) { if (!n) throw e; } // conserva lo descomprimido aunque haya basura al final
        const out = new Uint8Array(n); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; });
        return latin1(out);
      } catch (e) { /* prueba siguiente */ }
    }
    return null;
  }
  const nums = (s) => (s.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number);

  /* Busca diccionarios de georreferencia ISO 32000 (/VP → /Measure /GEO con /GPTS y /LPTS).
     Revisa el texto plano del PDF y los object streams comprimidos. */
  async function findGeoPdfMeasures(u8) {
    const raw = latin1(u8), texts = [raw];
    const re = /\/Type\s*\/ObjStm[^]*?stream\r?\n/g; let m;
    while ((m = re.exec(raw))) {
      const start = m.index + m[0].length, end = raw.indexOf('endstream', start);
      if (end < 0) continue;
      const dictStart = raw.lastIndexOf('<<', m.index), dict = raw.slice(dictStart, start);
      if (!/FlateDecode/.test(dict)) continue;
      const lm = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
      let stop = lm ? Math.min(start + +lm[1], end) : end;
      if (!lm) while (stop > start && (raw.charCodeAt(stop - 1) === 10 || raw.charCodeAt(stop - 1) === 13)) stop--;
      const t = await inflate(u8.subarray(start, stop));
      if (t) texts.push(t);
    }
    const all = texts.join('\n');
    const found = [];
    const reG = /\/GPTS\s*\[([^\]]*)\]/g;
    while ((m = reG.exec(all))) {
      const g = nums(m[1]); if (g.length < 6) continue;
      // LPTS y BBox cercanos (mismo diccionario o viewport que lo contiene)
      const win = all.slice(Math.max(0, m.index - 1500), m.index + 1500);
      const lm = win.match(/\/LPTS\s*\[([^\]]*)\]/);
      const l = lm ? nums(lm[1]) : null;
      const bbs = [...win.matchAll(/\/BBox\s*\[([^\]]*)\]/g)].map(b => nums(b[1])).filter(b => b.length === 4);
      found.push({ gpts: g, lpts: l, bbox: bbs.length ? bbs.sort((a, b) => area(b) - area(a))[0] : null });
    }
    // Viewports con BBox que referencian Measure indirecto
    if (found.some(f => !f.bbox)) {
      const vbs = [...all.matchAll(/\/VP\s*\[[^]*?\/BBox\s*\[([^\]]*)\]/g)].map(b => nums(b[1])).filter(b => b.length === 4);
      if (vbs.length) { const big = vbs.sort((a, b) => area(b) - area(a))[0]; found.forEach(f => { if (!f.bbox) f.bbox = big; }); }
    }
    return found;
    function area(b) { return Math.abs((b[2] - b[0]) * (b[3] - b[1])); }
  }

  // Devuelve función punto PDF (x,y) -> [lon,lat]
  function geoPdfTransform(meas, pageView) {
    const g = meas.gpts, n = Math.floor(g.length / 2);
    let l = meas.lpts && meas.lpts.length >= n * 2 ? meas.lpts : [0, 0, 0, 1, 1, 1, 1, 0].slice(0, n * 2);
    const bb = meas.bbox || pageView; // [x1,y1,x2,y2]
    const x1 = Math.min(bb[0], bb[2]), x2 = Math.max(bb[0], bb[2]), y1 = Math.min(bb[1], bb[3]), y2 = Math.max(bb[1], bb[3]);
    const src = [], dst = [];
    for (let i = 0; i < n; i++) {
      src.push([x1 + l[2 * i] * (x2 - x1), y1 + l[2 * i + 1] * (y2 - y1)]);
      dst.push([g[2 * i + 1], g[2 * i]]); // GPTS = lat, lon
    }
    // Si las "lat" parecen longitudes (algunos PDFs las invierten), corrige
    if (dst.every(([lon, lat]) => Math.abs(lat) > 90 || (Math.abs(lon) <= 15 && Math.abs(lat) > 60))) dst.forEach(p => p.reverse());
    const T = fitAffine(src, dst);
    return (x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]];
  }

  async function loadPdf(file, pageNum, maxDim, onStatus) {
    const u8 = new Uint8Array(await file.arrayBuffer());
    onStatus && onStatus('Buscando georreferencia en el PDF…');
    const measures = await findGeoPdfMeasures(u8);
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdfjs/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: u8.slice() }).promise;
    const page = await pdf.getPage(Math.min(Math.max(1, pageNum || 1), pdf.numPages));
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(maxDim / Math.max(v1.width, v1.height), 8);
    const vp = page.getViewport({ scale });
    onStatus && onStatus(`Dibujando página (${Math.round(vp.width)}×${Math.round(vp.height)} px)…`);
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    let pix2ll = null, georef = 'none';
    if (measures.length) {
      const meas = measures.sort((a, b) => (b.bbox ? 1 : 0) - (a.bbox ? 1 : 0))[0];
      const pdf2ll = geoPdfTransform(meas, page.view);
      pix2ll = (px, py) => { const [x, y] = vp.convertToPdfPoint(px, py); return pdf2ll(x, y); };
      georef = 'geopdf';
    }
    return { canvas: c, width: c.width, height: c.height, pix2ll, georef, numPages: pdf.numPages };
  }

  // ---------- GeoTIFF ----------
  async function loadTiff(file, maxDim, crsOverride, onStatus) {
    const tiff = await GeoTIFF.fromBlob(file);
    const img = await tiff.getImage();
    const W = img.getWidth(), H = img.getHeight();
    const gk = img.getGeoKeys() || {};
    let code = crsOverride || null;
    if (!code) {
      const epsg = gk.ProjectedCSTypeGeoKey || gk.GeographicTypeGeoKey;
      if (epsg && epsg !== 32767) code = 'EPSG:' + epsg;
    }
    if (!code || !ensureCrs(code)) return { needCrs: true, detected: code };
    const origin = img.getOrigin(), res = img.getResolution();
    const k = Math.min(1, maxDim / Math.max(W, H));
    const w = Math.round(W * k), h = Math.round(H * k);
    onStatus && onStatus(`Leyendo GeoTIFF ${W}×${H} px…`);
    const rgb = await img.readRGB({ width: w, height: h, interleave: true, enableAlpha: true, resampleMethod: 'bilinear' });
    const ch = rgb.length / (w * h);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); const id = ctx.createImageData(w, h);
    for (let i = 0, j = 0; i < w * h; i++, j += ch) {
      id.data[4 * i] = rgb[j]; id.data[4 * i + 1] = rgb[j + 1]; id.data[4 * i + 2] = rgb[j + 2];
      id.data[4 * i + 3] = ch === 4 ? rgb[j + 3] : 255;
    }
    ctx.putImageData(id, 0, 0);
    const f = toWgs(code);
    const pix2ll = (px, py) => f(origin[0] + (px / k) * res[0], origin[1] + (py / k) * res[1]);
    return { canvas: c, width: w, height: h, pix2ll, georef: 'geotiff', crs: code };
  }

  // ---------- Imagen + archivo de mundo / esquinas ----------
  async function loadImage(file, worldText, crs, corners, maxDim) {
    const bmp = await createImageBitmap(file);
    let W = bmp.width, H = bmp.height, src = bmp, k = 1;
    if (Math.max(W, H) > maxDim * 1.5) {
      k = maxDim / Math.max(W, H);
      const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); src = c;
    }
    const w = Math.round(W * k), h = Math.round(H * k);
    let pix2ll = null, georef = 'none';
    if (worldText) {
      const [A, D, B, E, C, F] = nums(worldText);
      if (!ensureCrs(crs)) throw new Error('Sistema de coordenadas no soportado');
      const f = toWgs(crs);
      pix2ll = (px, py) => { const X = px / k - 0.5, Y = py / k - 0.5; return f(A * X + B * Y + C, D * X + E * Y + F); };
      georef = 'worldfile';
    } else if (corners) {
      const { n, s, w: we, e } = corners;
      pix2ll = (px, py) => [we + (e - we) * px / w, n - (n - s) * py / h];
      georef = 'corners';
    }
    return { canvas: src, width: w, height: h, pix2ll, georef };
  }

  global.Georef = { CRS, ensureCrs, warpToMercator, loadPdf, loadTiff, loadImage, fitAffine, _findGeoPdfMeasures: findGeoPdfMeasures, _geoPdfTransform: geoPdfTransform };
  global.ProjUtil = { toCtm12: (lon, lat) => proj4('EPSG:4326', 'EPSG:9377').forward([lon, lat]) };
})(window);
