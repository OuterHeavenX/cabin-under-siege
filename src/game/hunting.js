// Deer in the woods at dawn and dusk. They graze, lift their heads, and bolt
// from noise or anyone who walks straight at them. Bring one down and
// field-dress it: venison to cook, smoke or sell, and a pelt the store buys.
import { G } from './state.js';
import { TILE } from '../config.js';
import { dist, angleTo, rand } from '../util.js';
import { addItem } from './inventory.js';
import { addJP, addXP } from './progression.js';
import { hasPerk } from './perks.js';
import { toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { inHours } from './calendar.js';

const DEER_HP = 40;

/** Deer show up where a map defines a huntZone (tiles: [x0, y0, x1, y1]). */
const huntHours = () => inHours([5, 9]) || inHours([17, 21]);

export function spawnDeer() {
  G.animals = [];
  const m = G.map;
  if (!m || !m.huntZone || G.endless || G.prequel || G.siegeActive) return;
  if (!huntHours()) return;
  const n = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) addDeer();
}

function addDeer() {
  const m = G.map, [x0, y0, x1, y1] = m.huntZone;
  for (let tries = 0; tries < 30; tries++) {
    const cx = Math.floor(rand(x0, x1)), cy = Math.floor(rand(y0, y1));
    if (!m.inBounds(cx, cy) || m.blocksMove(cx, cy, 'npc')) continue;
    const x = cx * TILE + 16, y = cy * TILE + 16;
    if (G.player && dist(x, y, G.player.x, G.player.y) < 260) continue;
    G.animals.push({ kind: 'deer', x, y, radius: 9, angle: rand(0, Math.PI * 2), hp: DEER_HP, state: 'graze', t: rand(1, 4), walk: 0, fleeT: 0, dead: false, dressed: false, buck: Math.random() < 0.35 });
    return;
  }
}

let checkT = 0;
export function updateAnimals(dt) {
  const m = G.map, p = G.player;
  if (!m || !p) return;
  if (!G.animals) G.animals = [];
  // Every so often, top the herd up (or let them melt away when the light changes).
  checkT -= dt;
  if (checkT <= 0) {
    checkT = 8;
    const live = G.animals.filter((a) => !a.dead);
    if (m.huntZone && huntHours() && !G.siegeActive && live.length < 2 && Math.random() < 0.5) addDeer();
    if (!huntHours()) G.animals = G.animals.filter((a) => a.dead || dist(a.x, a.y, p.x, p.y) < 300);
  }
  const sprint = Math.hypot(p.vx || 0, p.vy || 0) > 150;
  const walking = Math.hypot(p.vx || 0, p.vy || 0) > 20;
  const shy = hasPerk('tracker') ? 0.65 : 1;
  for (const a of G.animals) {
    if (a.dead) continue;
    const pd = dist(a.x, a.y, p.x, p.y);
    const sees = m.los(a.x, a.y, p.x, p.y);
    // Spook: noise, or being walked up on in plain sight.
    const spook = (sprint && pd < 260 * shy) || (walking && sees && pd < 150 * shy && !G.s.skills.includes('trail_sense')) || pd < 70;
    if (spook && a.state !== 'flee') { a.state = 'flee'; a.fleeT = 4; sfx('dodge', { x: a.x, y: a.y, vol: 0.4 }); }
    a.t -= dt;
    if (a.state === 'flee') {
      const away = angleTo(p.x, p.y, a.x, a.y) + Math.sin(G.time * 3 + a.x) * 0.3;
      m.moveCircle(a, Math.cos(away) * 230 * dt, Math.sin(away) * 230 * dt, 'npc');
      a.angle = away; a.walk += dt * 18;
      a.fleeT -= dt;
      if (a.fleeT <= 0) { a.state = 'graze'; a.t = rand(2, 5); }
      if (a.x < 4 || a.y < 4 || a.x > m.w * TILE - 4 || a.y > m.h * TILE - 4) a.gone = true;
    } else if (a.state === 'walk') {
      m.moveCircle(a, Math.cos(a.angle) * 34 * dt, Math.sin(a.angle) * 34 * dt, 'npc');
      a.walk += dt * 6;
      if (a.t <= 0) { a.state = 'graze'; a.t = rand(2, 6); }
    } else if (a.t <= 0) { a.state = 'walk'; a.angle += rand(-1.4, 1.4); a.t = rand(1, 3); }
    a.alert = a.state === 'graze' && sees && pd < 230 * shy; // head up
  }
  G.animals = G.animals.filter((a) => !a.gone);
}

/** Player bullets hit deer too. Returns true if the bullet stopped. */
export function animalBulletCheck(b) {
  if (!G.animals) return false;
  for (const a of G.animals) {
    if (a.dead) continue;
    if ((a.x - b.x) ** 2 + (a.y - b.y) ** 2 > (a.radius + 2) ** 2) continue;
    a.hp -= b.dmg;
    if (a.hp <= 0) {
      a.dead = true; a.state = 'dead';
      sfx('thud', { x: a.x, y: a.y, vol: 0.6 });
      G.events.emit('deerKilled', a);
    } else { a.state = 'flee'; a.fleeT = 5; }
    return true;
  }
  return false;
}

/** Interaction: field-dress a downed deer. */
export function deerTargets() {
  return (G.animals || []).filter((a) => a.dead && !a.dressed);
}

export function fieldDress(a) {
  if (a.dressed) return;
  a.dressed = true;
  const meat = 2 + (hasPerk('tracker') ? 1 : 0) + (a.buck ? 1 : 0);
  const got = addItem('venison', meat, true);
  addItem('pelt', 1, true);
  addXP(15, 'Hunting'); addJP('survivor', 4, 'hunt', 12);
  sfx('pickup');
  toast(`Field-dressed the ${a.buck ? 'buck' : 'doe'}: ${got} venison and a pelt.`, 'item', 3.5);
  G.events.emit('deerDressed', a);
}

