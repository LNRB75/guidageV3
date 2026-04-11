

/* -----------------------------------------------------------
   SERVICE WORKER avec VERSIONING AUTOMATIQUE
   Force les mobiles (Android & iOS) à recharger les nouvelles
   versions du site, même si une version est déjà en cache.
------------------------------------------------------------ */

// 🟢 1. VERSION DU CACHE (à incrémenter à chaque mise en prod)
const CACHE_VERSION = 'v1.0.1';
const CACHE_NAME = `wayfinding-${CACHE_VERSION}`;

// 🟢 2. Liste des assets à pré-cacher
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './assets/plan.png',
  './assets/icons/icon-180.png',
  './manifest.webmanifest',
];

// 🟢 3. INSTALL → pré-caching des assets statiques
self.addEventListener('install', event => {
  console.log('[SW] Install - version', CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );

  // Force immédiatement l'activation du nouveau SW
  self.skipWaiting();
});

// 🟢 4. ACTIVATE → nettoyage des anciens caches
self.addEventListener('activate', event => {
  console.log('[SW] Activate - cleanup old caches');

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Suppression ancien cache :', key);
            return caches.delete(key);
          }
        })
      )
    )
  );

  // Prend immédiatement le contrôle des clients
  self.clientsClaim();
});

// 🟢 5. FETCH → stratégie NETWORK FIRST sauf pour plan_graph.json
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Cas particulier : toujours charger le JSON depuis le réseau
  if (url.pathname.endsWith('/data/plan_graph.json')) {
    return; // laisse passer la requête sans détour par le cache
  }

  // Stratégie Network-first (avec fallback cache)
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Si tout va bien → on met en cache la version fraîche
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // si offline → retourne la version cache si dispo
        return caches.match(event.request);
      })
  );
});