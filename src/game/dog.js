// Duke, the guard dog. Adopted from a store; lives at whatever home you have.
// He follows you around the property, barks when strangers come close (and
// marks them), and goes for attackers' legs during a siege — a bite that pins
// them for a moment. If he's hurt he limps off and is fine by morning.
import { G } from './state.js';
import { TILE } from '../config.js';
import { dist, angleTo } from '../util.js';
import { homeMapId } from './chapters.js';
import { damageEnemy, spawnParticles } from './combat.js';
import { sfx } from '../audio.js';
import { toast } from '../ui/hud.js';

export const DOG_MAX_HP = 90;

export function dogOwned() { return !!(G.s && G.s.companion && G.s.companion.dog && G.s.companion.dog.owned); }
export function dogName() { return (G.s.companion.dog && G.s.companion.dog.name) || 'Duke'; }

export function adoptDog() {
  const c = G.s.companion || (G.s.companion = { ruth: { joined: false, declined: false } });
  if (c.dog && c.dog.owned) { toast(`${dogName()} is already part of the family.`, 'warn'); return false; }
  c.dog = { owned: true, name: 'Duke', hurtDay: -1 };
  if (G.map && G.map.id === homeMapId()) spawnDog();
  sfx('bark');
  toast('Duke the German shepherd sniffs every corner of the place, then lies down by the door. He\'s home.', 'good', 4);
  return true;
}

/** Called when a map loads. */
export function spawnDog() {
  G.dog = null;
  if (!dogOwned() || !G.map || G.map.id !== homeMapId() || !G.player) return;
  const p = G.player;
  const hurt = G.s.companion.dog.hurtDay === G.s.time.day;
  G.dog = { x: p.x + 20, y: p.y + 10, radius: 8, angle: 0, hp: hurt ? DOG_MAX_HP * 0.4 : DOG_MAX_HP, walk: 0, biteCd: 0, barkCd: 0, target: null, hurt: false, hitT: 0 };
  G.map.pushOut(G.dog, 8, 'npc');
}

export function dogBulletCheck(b) {
  const d = G.dog;
  if (!d || d.hurt) return false;
  if ((d.x - b.x) ** 2 + (d.y - b.y) ** 2 > (d.radius + 1) ** 2) return false;
  d.hp -= b.dmg * 0.7; d.hitT = 0.15;
  spawnParticles(d.x, d.y, '#8a1a1a', 4, 80);
  if (d.hp <= 0) {
    d.hp = 0; d.hurt = true; d.target = null;
    G.s.companion.dog.hurtDay = G.s.time.day;
    toast(`${dogName()} yelps and limps under the porch. He'll pull through.`, 'danger', 3);
  }
  return true;
}

export function updateDog(dt) {
  const d = G.dog;
  if (!d) return;
  const m = G.map, p = G.player;
  d.biteCd -= dt; d.barkCd -= dt; d.hitT -= dt;
  let goal = null, speed = 120;
  if (d.hurt) {
    const hi = m.homeInfo && m.homeInfo.porch;
    goal = hi || null; speed = 40;
  } else {
    // Nearest attacker he can reach (within 260 px of him or you).
    let best = null, bd = 260;
    for (const e of G.enemies) {
      if (e.dead || e.gone || e.def.vehicle) continue;
      const de = Math.min(dist(d.x, d.y, e.x, e.y), dist(p.x, p.y, e.x, e.y) + 60);
      if (de < bd && m.los(d.x, d.y, e.x, e.y)) { bd = de; best = e; }
    }
    if (best) {
      if (!d.target && d.barkCd <= 0) { sfx('bark', { x: d.x, y: d.y }); d.barkCd = 3; }
      d.target = best;
      best.spotted = Math.max(best.spotted, 1.5); // he points them out
      goal = best; speed = 175;
      const dd = dist(d.x, d.y, best.x, best.y);
      if (dd < best.radius + d.radius + 6 && d.biteCd <= 0) {
        d.biteCd = 1.1;
        damageEnemy(best, 16, angleTo(d.x, d.y, best.x, best.y), 'melee', 30);
        best.stun = Math.max(best.stun || 0, 0.6);
        sfx('growl', { x: d.x, y: d.y });
      }
    } else {
      d.target = null;
      // Heel: trot after you, lie down when close.
      if (dist(d.x, d.y, p.x, p.y) > 46) { goal = { x: p.x - Math.cos(p.angle) * 26, y: p.y - Math.sin(p.angle) * 26 }; speed = dist(d.x, d.y, p.x, p.y) > 160 ? 160 : 95; }
    }
  }
  if (goal) {
    const dd = dist(d.x, d.y, goal.x, goal.y);
    if (dd > 6) {
      const a = Math.atan2(goal.y - d.y, goal.x - d.x);
      m.moveCircle(d, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt, 'npc');
      d.angle = a; d.walk += dt * 14;
    }
  }
  // Too far behind (you drove off, went through a door): catch up.
  if (dist(d.x, d.y, p.x, p.y) > 30 * TILE) { d.x = p.x + 20; d.y = p.y; m.pushOut(d, 8, 'npc'); }
}

/** Morning after a siege: patched up. */
export function dogMorning() { if (G.dog && G.dog.hurt) { G.dog.hurt = false; G.dog.hp = DOG_MAX_HP; } }
