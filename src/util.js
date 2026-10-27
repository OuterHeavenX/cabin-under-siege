// Small math and helper utilities shared across the game.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax, ay, bx, by) => (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const choose = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;

/** Smallest signed difference between two angles. */
export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Deterministic seeded PRNG (mulberry32). */
export function seeded(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap deterministic hash of two ints into [0,1). */
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Format minutes-since-midnight as a 12-hour clock string. */
export function fmtClock(minute) {
  const m = Math.floor(minute) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, '0')} ${ampm}`;
}

export function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** Recursively fill missing keys of `target` from `defaults` (used for save migration). */
export function fillDefaults(target, defaults) {
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) return target;
  for (const k of Object.keys(defaults)) {
    const dv = defaults[k];
    if (!(k in target) || target[k] === undefined || target[k] === null && dv !== null) {
      target[k] = deepClone(dv);
    } else if (typeof dv === 'object' && dv !== null && !Array.isArray(dv) && typeof target[k] === 'object' && target[k] !== null && !Array.isArray(target[k])) {
      fillDefaults(target[k], dv);
    }
  }
  return target;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
