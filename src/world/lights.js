// Night lighting sources shared by the renderer and by AI (who can see whom).
import { G } from '../game/state.js';
import { TILE } from '../config.js';

export const FLOOD = { x: 24.5 * TILE, y: 28.6 * TILE, r: 270 };
export const PORCH = { x: 24.5 * TILE, y: 27.6 * TILE, r: 95 };

/** 0 = full day, 1 = deepest night. Smooth transitions at dusk and dawn. */
export function darkness() {
  const m = G.s.time.minute;
  const h = m / 60;
  if (h >= 7 && h < 18.5) return 0;
  if (h >= 18.5 && h < 21) return (h - 18.5) / 2.5;
  if (h >= 5 && h < 7) return 1 - (h - 5) / 2;
  return 1;
}

export function activeLights() {
  const dk = darkness();
  if (dk <= 0.05) return [];
  const out = [];
  const map = G.map;
  for (const l of map.lights) out.push(l);
  if (map.id === 'cabin') {
    if (G.s.home.porchLight) out.push(PORCH);
    if (G.s.home.upgrades.floodlight) out.push(FLOOD);
  }
  for (const pr of map.props) if (pr.light) out.push(pr.light);
  return out;
}

export function inFloodlight(x, y) {
  if (G.map.id !== 'cabin' || !G.s.home.upgrades.floodlight || darkness() < 0.3) return false;
  return (x - FLOOD.x) ** 2 + (y - FLOOD.y) ** 2 < FLOOD.r * FLOOD.r;
}

/** Is a point lit (by any light) — used for stealth/notice checks. */
export function isLit(x, y) {
  if (darkness() < 0.5) return true;
  for (const l of activeLights()) {
    if (l.building) continue;
    if ((x - l.x) ** 2 + (y - l.y) ** 2 < (l.r * 0.8) ** 2) return true;
  }
  return false;
}
