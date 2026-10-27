// Molotov lobs and burning ground. Fire hurts anyone standing in it, eats
// through doors, windows and placed cover, and lights up the night.
import { G } from './state.js';
import { TILE } from '../config.js';
import { dist } from '../util.js';
import { damagePlayer } from './player.js';
import { damageEnemy, spawnParticles } from './combat.js';
import { sfx } from '../audio.js';

export function throwMolotov(from, tx, ty) {
  const d = dist(from.x, from.y, tx, ty);
  G.lobs.push({ sx: from.x, sy: from.y, tx, ty, t: 0, dur: 0.45 + d / 600 });
  sfx('swing', { x: from.x, y: from.y });
}

export function startFire(x, y, r = 38, life = 6.5) {
  G.fires.push({ x, y, r, life, max: life, tick: 0 });
  sfx('molotov', { x, y });
  spawnParticles(x, y, '#ffb347', 14, 160, 0.5, 3);
}

export function updateFire(dt) {
  for (const l of G.lobs) {
    l.t += dt;
    if (l.t >= l.dur) { l.done = true; startFire(l.tx, l.ty); }
  }
  G.lobs = G.lobs.filter((l) => !l.done);
  const m = G.map;
  const p = G.player;
  for (const f of G.fires) {
    f.life -= dt;
    f.tick -= dt;
    if (f.tick > 0) continue;
    f.tick = 0.5; // damage pulses twice a second
    if (!p.dead && dist(p.x, p.y, f.x, f.y) < f.r + p.radius * 0.5) damagePlayer(9, f.x, f.y, 'fire');
    for (const e of G.enemies) if (!e.dead && !e.gone && e.type !== 'arsonist' && dist(e.x, e.y, f.x, f.y) < f.r) damageEnemy(e, 6, 0, 'fire', 0);
    const c0x = Math.floor((f.x - f.r - 16) / TILE), c1x = Math.floor((f.x + f.r + 16) / TILE);
    const c0y = Math.floor((f.y - f.r - 16) / TILE), c1y = Math.floor((f.y + f.r + 16) / TILE);
    for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
      const b = m.inBounds(cx, cy) ? m.blockerAt(cx, cy) : null;
      if (!b || b.rec.npc) continue;
      if (dist(cx * TILE + 16, cy * TILE + 16, f.x, f.y) > f.r + 20) continue;
      if (b.kind === 'door' && !b.passable) b.damage(9);
      else if (b.kind === 'window') b.damage(7);
      else if (b.kind === 'cover') b.damage(10);
    }
  }
  G.fires = G.fires.filter((f) => f.life > 0);
}

/** Is a point currently on fire? (AI avoids walking through flames.) */
export function burningAt(x, y) {
  return G.fires.some((f) => dist(x, y, f.x, f.y) < f.r);
}
