// Service worker: lets the game run offline after the first visit.
// Network-first for freshness, falling back to the cache when offline.
// Bump CACHE when shipping a new version.
const CACHE = 'cabin-under-siege-v0.11.0';
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
  "./src/game/calendar.js",
  "./src/game/hunting.js",
  "./src/game/perks.js",
  "./src/game/poker.js",
  "./src/game/projects.js",
  "./src/game/rat.js",
  "./src/game/tail.js",
  "./src/game/townlife.js",
  "./src/ui/poker.js",
  "./src/data/storylines.js",
  "./src/data/counter.js",
  "./src/data/evidence.js",
  "./src/data/letters.js",
  "./src/data/life.js",
  "./src/data/reunions.js",
  "./src/data/sidestories.js",
  "./src/data/watch.js",
  "./src/game/abilities.js",
  "./src/game/evidence.js",
  "./src/game/letters.js",
  "./src/game/life.js",
  "./src/game/visits.js",
  "./src/game/watch.js",
  "./src/game/activities.js",
  "./src/game/ally.js",
  "./src/game/chapters.js",
  "./src/game/difficulty.js",
  "./src/game/dog.js",
  "./src/game/endless.js",
  "./src/game/assault.js",
  "./src/game/achievements.js",
  "./src/game/cloud.js",
  "./src/game/ngplus.js",
  "./src/game/prequel.js",
  "./src/game/errands.js",
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
  "./src/game/weather.js",
  "./src/input.js",
  "./src/gamepad.js",
  "./src/main.js",
  "./src/ui/cutscene.js",
  "./src/ui/dialogue.js",
  "./src/ui/hud.js",
  "./src/ui/menus.js",
  "./src/ui/portraits.js",
  "./src/util.js",
  "./src/world/atmosphere.js",
  "./src/world/blockers.js",
  "./src/world/lights.js",
  "./src/world/map.js",
  "./src/world/mapgen.js",
  "./src/world/render.js",
  "./src/world/shadowcast.js",
  "./src/world/terrain.js",
  "./src/world/fx.js",
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
