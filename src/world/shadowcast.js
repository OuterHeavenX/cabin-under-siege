// Light that walls actually stop. Each light casts rays across the tile grid
// and stops at walls, rocks, closed doors and shutters; glass lets light out,
// so a lit window throws a pool of light onto the yard. Static lights are
// cached briefly; the flashlight is cast fresh every frame.
import { G } from '../game/state.js';
import { TILE } from '../config.js';
import { SO } from './map.js';

function opaque(m, cx, cy) {
  if (!m.inBounds(cx, cy)) return true;
  const s = m.solid[m.idx(cx, cy)];
  if (s === SO.WALL || s === SO.ROCK) return true;
  const b = m.blockers.get(m.idx(cx, cy));
  if (b) {
    if (b.kind === 'door') return !b.rec.open && !b.broken && !b.rec.gate;
    if (b.kind === 'window') return !!b.shuttered;
  }
  return false;
}

/** Ray-cast visibility polygon around (x, y): array of [x, y] world points. */
export function castPoly(m, x, y, r, a0 = 0, a1 = Math.PI * 2, rays = 72) {
  const pts = [];
  const full = a1 - a0 >= Math.PI * 2 - 1e-6;
  const n = full ? rays : rays + 1;
  const step = 5;
  const sx = Math.floor(x / TILE), sy = Math.floor(y / TILE);
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i / (full ? rays : rays));
    const dx = Math.cos(a), dy = Math.sin(a);
    let d = step;
    for (; d < r; d += step) {
      const cx = Math.floor((x + dx * d) / TILE), cy = Math.floor((y + dy * d) / TILE);
      if ((cx !== sx || cy !== sy) && opaque(m, cx, cy)) { d += 4; break; } // let light lick the wall face
    }
    d = Math.min(d, r);
    pts.push([x + dx * d, y + dy * d]);
  }
  return pts;
}

const cache = new Map();
/** Cached polygon for a static light (re-cast every half second so doors and shutters count). */
export function lightPoly(m, li) {
  const key = `${m.id}:${li.x | 0}:${li.y | 0}:${li.r | 0}`;
  const c = cache.get(key);
  if (c && G.time - c.t < 0.5) return c.pts;
  const pts = castPoly(m, li.x, li.y, li.r, 0, Math.PI * 2, li.r > 200 ? 96 : 64);
  cache.set(key, { t: G.time, pts });
  if (cache.size > 300) cache.clear();
  return pts;
}

export const FLASH_ANGLE = 0.46;
export const FLASH_RANGE = 320;
