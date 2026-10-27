// Service worker: lets the game run offline after the first visit.
// Network-first for freshness, falling back to the cache when offline.
// Bump CACHE when shipping a new version.
const CACHE = 'cabin-under-siege-v0.2.2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './audio/manifest.json',
  "./css/style.css",
  "./src/audio.js",
  "./src/config.js",
  "./src/data/enemies.js",
  "./src/data/homes.js",
  "./src/data/items.js",
  "./src/data/npcs.js",
  "./src/data/skills.js",
  "./src/data/weapons.js",
  "./src/game/chapters.js",
  "./src/game/combat.js",
  "./src/game/enemies.js",
  "./src/game/fire.js",
  "./src/game/home.js",
  "./src/game/interact.js",
  "./src/game/inventory.js",
  "./src/game/jobs.js",
  "./src/game/npcs.js",
  "./src/game/player.js",
  "./src/game/progression.js",
  "./src/game/quests.js",
  "./src/game/save.js",
  "./src/game/siege.js",
  "./src/game/state.js",
  "./src/game/story.js",
  "./src/game/time.js",
  "./src/input.js",
  "./src/main.js",
  "./src/ui/dialogue.js",
  "./src/ui/hud.js",
  "./src/ui/menus.js",
  "./src/util.js",
  "./src/world/blockers.js",
  "./src/world/lights.js",
  "./src/world/map.js",
  "./src/world/mapgen.js",
  "./src/world/render.js",
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
