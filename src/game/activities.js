// Everyday life between attacks: fishing, picking the garden, cooking,
// weapon mods, and how your behaviour moves the family's Heat.
import { G } from './state.js';
import { TILE } from '../config.js';
import { GR, SO } from '../world/map.js';
import { ITEMS, COOK_RECIPES } from '../data/items.js';
import { addItem, count, removeItem } from './inventory.js';
import { addJP, addXP, dailyAllow } from './progression.js';
import { advanceMinutes } from './time.js';
import { homeMapId, workMapId } from './chapters.js';
import { toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { clamp } from '../util.js';

export const REGROW_DAYS = 3;

/* ---------------- fishing ---------------- */
/** Nearest water cell the player is standing beside, or null. */
export function waterNear(p) {
  const m = G.map;
  const pcx = Math.floor(p.x / TILE), pcy = Math.floor(p.y / TILE);
  let best = null, bd = 30;
  for (let cy = pcy - 1; cy <= pcy + 1; cy++) for (let cx = pcx - 1; cx <= pcx + 1; cx++) {
    if (!m.inBounds(cx, cy) || m.getSolid(cx, cy) !== SO.WATER) continue;
    const nx = clamp(p.x, cx * TILE, cx * TILE + TILE), ny = clamp(p.y, cy * TILE, cy * TILE + TILE);
    const d = Math.hypot(p.x - nx, p.y - ny);
    if (d < bd) { bd = d; best = { cx, cy, x: cx * TILE + 16, y: cy * TILE + 16 }; }
  }
  return best;
}

/** Called after a successful fishing minigame. */
export function landFish() {
  const n = Math.random() < 0.2 ? 2 : 1;
  const got = addItem('fish', n, true);
  if (!got) { toast('Your cooler is full of fish already.', 'warn'); return; }
  sfx('pickup');
  toast(`Caught ${got > 1 ? got + ' fish' : 'a fish'}! 🐟`, 'item', 2);
  advanceMinutes(15);
  addXP(4, 'Fishing');
  addJP('survivor', 2, 'fish', 8);
  G.events.emit('fishCaught', got);
}

/* ---------------- garden ---------------- */
const pickedMap = () => {
  const w = G.s.world;
  if (!w.picked) w.picked = {};
  return w.picked[G.map.id] || (w.picked[G.map.id] = {});
};

export function cropReady(cx, cy) {
  const m = G.map;
  if (!m.cropsPickable || m.getGround(cx, cy) !== GR.GARDEN) return false;
  const day = pickedMap()[m.idx(cx, cy)];
  return day == null || G.s.time.day - day >= REGROW_DAYS;
}

/** A ripe garden cell next to the player, or null. */
export function gardenNear(p) {
  const m = G.map;
  if (!m.cropsPickable) return null;
  const pcx = Math.floor(p.x / TILE), pcy = Math.floor(p.y / TILE);
  let best = null, bd = Infinity;
  for (let cy = pcy - 1; cy <= pcy + 1; cy++) for (let cx = pcx - 1; cx <= pcx + 1; cx++) {
    if (!m.inBounds(cx, cy) || !cropReady(cx, cy)) continue;
    const d = Math.hypot(p.x - (cx * TILE + 16), p.y - (cy * TILE + 16));
    if (d < bd && d < 40) { bd = d; best = { cx, cy, x: cx * TILE + 16, y: cy * TILE + 16 }; }
  }
  return best;
}

export function pickGarden(c) {
  if (!cropReady(c.cx, c.cy)) return;
  const n = Math.random() < 0.35 ? 2 : 1;
  const got = addItem('vegetables', n, true);
  if (!got) { toast('You can\'t carry any more vegetables.', 'warn'); return; }
  pickedMap()[G.map.idx(c.cx, c.cy)] = G.s.time.day;
  G.player.chopAnim = 0.2;
  sfx('dig');
  toast(`+${got} Vegetables 🥕`, 'item', 1.2);
  addJP('survivor', 1, 'pick', 10);
  G.events.emit('cropPicked', got);
}

/* ---------------- cooking ---------------- */
export function canCook(r) { return Object.entries(r.needs).every(([id, n]) => count(id) >= n); }

export function cook(id) {
  const r = COOK_RECIPES.find((x) => x.id === id);
  if (!r || !canCook(r)) return false;
  if (count(id) >= ITEMS[id].cap) { toast('You can\'t carry any more of that.', 'warn'); return false; }
  for (const [it, n] of Object.entries(r.needs)) removeItem(it, n);
  addItem(id, 1, true);
  advanceMinutes(20);
  sfx('fire', { vol: 1 }); sfx('chime');
  toast(`Cooked: ${ITEMS[id].name}`, 'item', 2);
  if (dailyAllow('cook', 3)) { addXP(6, 'Cooking'); addJP('survivor', 3); }
  return true;
}

/* ---------------- weapon mods ---------------- */
export function mods() { return G.s.weaponMods || (G.s.weaponMods = {}); }

/** Multipliers a weapon gets from installed mods. */
export function modStats(weapon) {
  const md = mods();
  if (weapon === 'rifle' && md.scope) return { spread: 0.5, range: 1.3, quiet: false };
  if (weapon === 'shotgun' && md.choke) return { spread: 0.7, range: 1.25, quiet: false };
  if (weapon === 'pistol' && md.suppressor) return { spread: 1, range: 1, quiet: true };
  return { spread: 1, range: 1, quiet: false };
}

/* ---------------- reactive heat ---------------- */
// Gunfire where people can hear it raises Heat (a little, capped per day);
// quiet nights and honest work bring it down. Logged so players can see why.
export function logHeat(n, why) {
  const w = G.s.world;
  const before = w.threat;
  w.threat = clamp(w.threat + n, 0, 100);
  const delta = Math.round((w.threat - before) * 10) / 10;
  if (!delta) return;
  w.heatLog = w.heatLog || [];
  w.heatLog.unshift({ day: G.s.time.day, n: delta, why });
  if (w.heatLog.length > 8) w.heatLog.length = 8;
}

export function initActivityEvents() {
  G.events.on('shot', () => {
    if (G.siegeActive || G.enemies.some((e) => !e.dead && !e.gone)) return;
    if (modStats(G.player.weapon).quiet) return;
    // Target practice on your own land is your business; anywhere people live, it isn't.
    let inTown = G.map.id === workMapId() && G.map.id !== homeMapId();
    if (!inTown) {
      const hi = G.map.homeInfo && G.map.homeInfo.interior;
      if (!hi) return;
      inTown = Math.hypot(G.player.x - (hi.cx * TILE + 16), G.player.y - (hi.cy * TILE + 16)) > 16 * TILE;
    }
    if (!inTown) return;
    if (!dailyAllow('heat:shots', 3)) return;
    logHeat(3, 'gunfire where people could hear it');
    toast('Gunshots where people live. They\'ll talk — Heat rising.', 'danger', 2.5);
  });
  G.events.on('jobDone', () => { if (dailyAllow('heat:job', 2)) logHeat(-1, 'keeping your head down at work'); });
  G.events.on('newDay', () => {
    const w = G.s.world;
    if (G.s.story.flags.firstSiegeDone && !w.siege && (w.lastAttackDay || 0) < G.s.time.day - 1) logHeat(-2, 'a quiet night');
  });
  G.events.on('siegeStart', () => { G.s.world.lastAttackDay = G.s.time.day; });
}

export function wellFedActive() { return G.player && G.player.wellFed > 0; }
