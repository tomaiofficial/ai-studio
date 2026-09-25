/* Assistant Vocal IA — Service Worker */
const CACHE = 'assistvocal-v149';
const STATIC = [
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  /* NE PAS intercepter les requetes CROSS-ORIGIN (translate.google.com pour la
     voix TTS, huggingface.co pour les modeles IA, cdn.jsdelivr.net pour
     transformers.js, etc.) : le navigateur les gere directement. Si le SW les
     intercepte, l'audio TTS et les modeles peuvent echouer (fetch no-cors
     casse, cache opaque, etc.) -> 'Voix en echec'. */
  if (url.origin !== self.location.origin) return;
  /* Network-first pour le code ET version.json (sinon le bandeau de mise à jour
     voit toujours l'ancienne version en cache) */
  const isMain = e.request.mode === 'navigate' || /\.(html|js|css|json)$/.test(url.pathname);
  if (isMain){
    /* Network-first : toujours la dernière version, cache en secours hors-ligne */
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
  } else {
    /* Cache-first pour les fichiers statiques (icônes, manifest) */
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match('./index.html')))
    );
  }
});