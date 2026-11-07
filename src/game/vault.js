// The fence vault: Frank presses DODGE while pushing into a fence and goes over it.
// Pure planning (a map and a circle in, a path out) so it runs in node for the tests;
// player.js owns the timer, the stamina and the input.
import { TILE } from '../config.js';
import { SO, GR } from '../world/map.js';

// T: seconds over the fence. reach: how far (px) the circle's edge may be from the fence
// cell's face. land: clearance past the fence cell on landing. cost: stamina (× staminaMult).
// minAxis: the push must be mostly toward the fence (cos ≥ 0.55, within ~57° of square on). side: how far right of the
// post (px) he passes.
export const VAULT = { T: 0.45, reach: 14, land: 4, cost: 12, minAxis: 0.55, side: 5.5 };

/**
 * Can a circle (x, y, radius r) pushing along (dx, dy) vault the fence in front of it?
 * Only a plain fence (SO.FENCE, not a hedge, no door or gate blocker on it) directly ahead
 * on the push's main axis, with the circle within VAULT.reach of it, and a landing cell on
 * the far side that is in bounds, open (no solid of any kind, no water) and where the circle
 * fits. Returns the path { x0, y0, x1, y1, fx, fy (the fence cell's centre), dx, dy (unit
 * axis), T } or null.
 */
export function planVault(m, x, y, r, dx, dy) {
  const l = Math.hypot(dx, dy);
  if (!m || !(l > 0.1)) return null;
  dx /= l; dy /= l;
  const horiz = Math.abs(dx) >= Math.abs(dy);
  if (Math.abs(horiz ? dx : dy) < VAULT.minAxis) return null;
  const ax = horiz ? Math.sign(dx) : 0, ay = horiz ? 0 : Math.sign(dy);
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
  const fx = cx + ax, fy = cy + ay;
  if (!m.inBounds(fx, fy)) return null;
  const fi = m.idx(fx, fy);
  if (m.solid[fi] !== SO.FENCE || m.blockerAt(fx, fy) || (m.hedge && m.hedge.has(fi))) return null;
  // standing next to it: the gap between the circle and the fence cell's near face
  const face = ax > 0 ? fx * TILE : ax < 0 ? (fx + 1) * TILE : ay > 0 ? fy * TILE : (fy + 1) * TILE;
  const gap = Math.abs(face - (horiz ? x : y)) - r;
  if (gap > VAULT.reach) return null;
  // the landing cell: in bounds, nothing solid (walls, rocks, water, cars, counters, furniture, more fence), no water
  // ground, no closed door or gate
  const lx = fx + ax, ly = fy + ay;
  if (!m.inBounds(lx, ly)) return null;
  const li = m.idx(lx, ly);
  if (m.solid[li] !== SO.NONE || m.ground[li] === GR.WATER || m.blocksMove(lx, ly, 'player')) return null;
  // the path stays inside the fence's own row or column (no corner of a neighbouring cell is crossed), passing with the
  // fence's post (at the cell centre) on his left, under the hand he plants on it, and lands just clear of the fence cell
  const lo = (horiz ? cy : cx) * TILE + r + 0.5, hi = (horiz ? cy + 1 : cx + 1) * TILE - r - 0.5;
  const post = (horiz ? cy : cx) * TILE + TILE / 2, right = horiz ? ax : -ay; // his right, along the row or column
  const perp = Math.min(hi, Math.max(lo, post + right * VAULT.side));
  const along = (horiz ? (ax > 0 ? lx * TILE + r : (lx + 1) * TILE - r) : (ay > 0 ? ly * TILE + r : (ly + 1) * TILE - r)) + (horiz ? ax : ay) * VAULT.land;
  const x1 = horiz ? along : perp, y1 = horiz ? perp : along;
  // he must fit there (the collision would push him out of anything in reach)
  const t = { x: x1, y: y1 };
  m.pushOut(t, r, 'player');
  if (Math.hypot(t.x - x1, t.y - y1) > 0.5) return null;
  return { x0: x, y0: y, x1, y1, fx: fx * TILE + TILE / 2, fy: fy * TILE + TILE / 2, dx: ax, dy: ay, T: VAULT.T };
}

/** Where the vault puts him at progress u (0..1): along the axis with a mild ease, sideways onto the line early. */
export function vaultPos(v, u, out) {
  const k = Math.min(1, Math.max(0, u));
  const s = 0.7 * k + 0.3 * k * k * (3 - 2 * k), q = Math.min(1, k / 0.3), w = q * q * (3 - 2 * q);
  const horiz = v.dx !== 0;
  const a0 = horiz ? v.x0 : v.y0, a1 = horiz ? v.x1 : v.y1, p0 = horiz ? v.y0 : v.x0, p1 = horiz ? v.y1 : v.x1;
  const a = a0 + (a1 - a0) * s, pp = p0 + (p1 - p0) * w;
  out.x = horiz ? a : pp; out.y = horiz ? pp : a;
  return out;
}
