// Night lighting sources shared by the renderer and by AI (who can see whom).
import { G } from '../game/state.js';
import { TILE } from '../config.js';

import { homeMapId } from '../game/chapters.js';

const homeLights = () => (G.map && G.map.id === homeMapId() && G.map.homeInfo) || null;

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
  const h = homeLights();
  if (h) {
    const cut = G.siege && G.siege.powerOut; // somebody cut the line
    if (G.s.home.porchLight && !cut) out.push(h.porch);
    if (G.s.home.upgrades.floodlight && !cut) out.push(h.flood);
  }
  for (const f of G.fires || []) out.push({ x: f.x, y: f.y, r: 150 * Math.min(1, f.life / 2), fire: true });
  for (const pr of map.props) if (pr.light) out.push(pr.light);
  return out;
}

export function inFloodlight(x, y) {
  const h = homeLights();
  if (!h || !G.s.home.upgrades.floodlight || darkness() < 0.3 || (G.siege && G.siege.powerOut)) return false;
  return (x - h.flood.x) ** 2 + (y - h.flood.y) ** 2 < h.flood.r * h.flood.r;
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
