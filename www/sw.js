/* Service worker: guarda la app para uso sin internet y cachea los
   mosaicos del mapa base que se hayan visto con conexión. */
const VERSION = 'ceron-v5';
const APP_CACHE = 'app-' + VERSION;
const TILE_CACHE = 'tiles-v2';
const MAX_TILES = 6000;
const APP_FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'georef.js', 'points.js', 'vectors.js', 'measure.js', 'library.js', 'lib/shp.min.js', 'lib/togeojson.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'lib/leaflet/leaflet.js', 'lib/leaflet/leaflet.css',
  'lib/leaflet/images/marker-icon.png', 'lib/leaflet/images/marker-icon-2x.png', 'lib/leaflet/images/marker-shadow.png',
  'lib/proj4.js', 'lib/geotiff.js', 'lib/pdfjs/pdf.min.js', 'lib/pdfjs/pdf.worker.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => (k.startsWith('app-') && k !== APP_CACHE) || (k.startsWith('tiles-') && k !== TILE_CACHE)).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

const isTile = (url) => /tile\.openstreetmap\.org|arcgisonline\.com|maptiles\.arcgis\.com/.test(url.hostname);

self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isTile(url)) {
    // Mosaicos: primero caché, si no hay, red y se guarda
    e.respondWith(caches.open(TILE_CACHE).then(async (c) => {
      const hit = await c.match(req); if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type !== 'opaque') { c.put(req, res.clone()); trim(c); }
        return res;
      } catch (err) { return new Response('', { status: 504 }); }
    }));
    return;
  }
  if (url.origin === location.origin) {
    // App: red primero (para recibir actualizaciones), caché si no hay internet
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP_CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});

let trimming = false;
async function trim(c) {
  if (trimming) return; trimming = true;
  try { const keys = await c.keys(); for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]); }
  finally { trimming = false; }
}
