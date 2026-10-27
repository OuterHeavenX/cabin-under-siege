// The player character: movement, aiming, shooting, melee, dodge, damage.
import { G } from './state.js';
import { PLAYER_RADIUS, PLAYER_SPEED, SPRINT_SPEED, TILE } from '../config.js';
import { input, consume, readMove } from '../input.js';
import { derived, addJP } from './progression.js';
import { count, removeItem, quickItem, useConsumable } from './inventory.js';
import { spawnBullet, spawnParticles, addFloater, shake, damageEnemy } from './combat.js';
import { angleDiff, angleTo, clamp, dist } from '../util.js';
import { sfx } from '../audio.js';
import { toast } from '../ui/hud.js';
import { isNight } from './state.js';

export function createPlayer() {
  const sp = G.s.player;
  return {
    x: sp.x, y: sp.y, radius: PLAYER_RADIUS,
    hp: sp.hp, stamina: sp.stamina, mag: sp.mag,
    angle: sp.facing ?? -Math.PI / 2,
    vx: 0, vy: 0,
    fireCd: 0, reloadT: 0, meleeCd: 0, meleeAnim: 0,
    invuln: 0, dodgeT: 0, dodgeDx: 0, dodgeDy: 0,
    flinch: 0, muzzle: 0, lastHurt: 99, lastCombat: 99, regenBuff: 0,
    walkPhase: 0, inCover: false, chopAnim: 0,
    dead: false,
  };
}

export function inCombat() {
  return G.siegeActive || G.enemies.some((e) => e.alerted && !e.dead && !e.retreating);
}

/** Pick an aim target for aim assist or the FIRE button without a stick. */
function assistTarget(p, maxAngle) {
  let best = null, bestScore = Infinity;
  const d = derived();
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dd = dist(p.x, p.y, e.x, e.y);
    if (dd > 460) continue;
    if (isNight() && dd > d.seeRadius && !e.spotted) continue;
    if (!G.map.los(p.x, p.y, e.x, e.y)) continue;
    const ad = Math.abs(angleDiff(p.angle, angleTo(p.x, p.y, e.x, e.y)));
    if (ad > maxAngle) continue;
    const score = ad * 200 + dd;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}

export function updatePlayer(dt) {
  const p = G.player;
  const d = derived();
  const map = G.map;
  p.fireCd -= dt; p.meleeCd -= dt; p.invuln -= dt; p.muzzle -= dt; p.meleeAnim -= dt; p.chopAnim -= dt;
  p.lastHurt += dt; p.lastCombat += dt;
  p.flinch = Math.max(0, p.flinch - dt * 2.5);
  if (p.regenBuff > 0) p.regenBuff -= dt;
  if (p.hp > d.maxHp) p.hp = d.maxHp;

  // --- Movement ---
  const mv = readMove();
  const moving = Math.hypot(mv.x, mv.y) > 0.05;
  let sprint = false;
  const mvMag = Math.hypot(mv.x, mv.y);
  if (moving && (input.held.sprint || (input.touchMode && G.settings.autoSprint && mvMag > 0.97)) && p.stamina > 5) sprint = true;
  if (G.repairHold) sprint = false;

  if (p.dodgeT > 0) {
    p.dodgeT -= dt;
    map.moveCircle(p, p.dodgeDx * d.dodgeSpeed * dt, p.dodgeDy * d.dodgeSpeed * dt, 'player');
  } else if (!G.repairHold) {
    const speed = (sprint ? SPRINT_SPEED : PLAYER_SPEED) * (p.reloadT > 0 ? 0.85 : 1);
    p.vx = mv.x * speed; p.vy = mv.y * speed;
    if (moving) {
      map.moveCircle(p, p.vx * dt, p.vy * dt, 'player');
      p.walkPhase += dt * (sprint ? 14 : 10);
      if (Math.floor(p.walkPhase / Math.PI) !== Math.floor((p.walkPhase - dt * 10) / Math.PI)) sfx('step', { vol: sprint ? 1 : 0.6 });
    }
  }
  if (sprint) p.stamina -= 18 * d.staminaMult * dt;
  else {
    const regen = (p.regenBuff > 0 ? 30 : 18) * (moving ? 0.7 : 1);
    p.stamina = Math.min(d.maxStamina, p.stamina + regen * dt);
  }
  p.stamina = clamp(p.stamina, 0, d.maxStamina);

  // Out-of-combat health recovery up to the Resolve cap.
  if (!inCombat() && p.lastHurt > 6 && p.hp < d.maxHp * d.regenCap) {
    p.hp = Math.min(d.maxHp * d.regenCap, p.hp + 1.5 * dt);
  }

  // --- Aim ---
  if (input.aim.active && input.aim.source === 'stick') {
    p.angle = input.aim.angle;
    if (G.settings.aimAssist) {
      const t = assistTarget(p, 0.3);
      if (t) p.angle = p.angle + angleDiff(p.angle, angleTo(p.x, p.y, t.x, t.y)) * 0.6;
    }
  } else if (!input.touchMode && input.mouse.inside) {
    const c = G.camera;
    const wx = (input.mouse.x - G.view.w / 2) / c.zoom + c.x;
    const wy = (input.mouse.y - G.view.h / 2) / c.zoom + c.y;
    p.angle = angleTo(p.x, p.y, wx, wy);
  } else if (moving && !input.held.fire) {
    p.angle = Math.atan2(mv.y, mv.x);
  }

  // --- Shooting ---
  const firing = input.held.fire || consume('fireClick');
  if (firing && p.reloadT <= 0 && p.fireCd <= 0 && p.dodgeT <= 0 && !G.repairHold) {
    // FIRE button without stick aim: aim assist picks a target in a wide cone.
    if (input.touchMode && !(input.aim.active) && G.settings.aimAssist) {
      const t = assistTarget(p, 1.2);
      if (t) p.angle = angleTo(p.x, p.y, t.x, t.y);
    }
    if (p.mag > 0) {
      fire(p, d, moving);
    } else {
      sfx('empty');
      p.fireCd = 0.3;
      if (count('ammo') > 0) startReload(p, d);
      else toast('Out of ammo! Use MELEE or buy rounds at Marsh General.', 'warn', 2.5);
    }
  }

  if (consume('reload')) startReload(p, d);
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) finishReload(p, d);
  }

  if (consume('melee')) melee(p, d);
  if (consume('dodge')) dodge(p, d, mv);
  if (consume('use')) {
    const q = quickItem();
    if (q) useConsumable(q); else toast('No healing items or food. Buy some at Marsh General.', 'warn');
  }

  // Cover check: adjacent to bullet-blocking cover.
  p.inCover = false;
  const cx = Math.floor(p.x / TILE), cy = Math.floor(p.y / TILE);
  for (let oy = -1; oy <= 1 && !p.inCover; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    const ncx = cx + ox, ncy = cy + oy;
    if (!map.isCoverCell(ncx, ncy)) continue;
    const rx = ncx * TILE + TILE / 2, ry = ncy * TILE + TILE / 2;
    if (Math.abs(rx - p.x) < TILE * 0.5 + p.radius + 4 && Math.abs(ry - p.y) < TILE * 0.5 + p.radius + 4) { p.inCover = true; break; }
  }
}

function fire(p, d, moving) {
  p.mag--;
  p.fireCd = 0.26;
  p.muzzle = 0.06;
  p.lastCombat = 0;
  let spread = 0.075 * d.spreadMult;
  if (moving) spread += 0.06 * d.moveSpreadMult;
  spread += p.flinch * 0.2 * d.flinchMult;
  const a = p.angle + (Math.random() - 0.5) * 2 * spread;
  const mx = p.x + Math.cos(p.angle) * 16, my = p.y + Math.sin(p.angle) * 16;
  spawnBullet({ x: mx, y: my, angle: a, speed: 900, dmg: 26, owner: 'player', range: 520 });
  sfx('shot');
  shake(2);
  G.events.emit('shot', p.x, p.y);
  if (p.mag === 0 && count('ammo') > 0) startReload(p, d);
}

function startReload(p, d) {
  if (p.reloadT > 0 || p.mag >= d.magSize) return;
  if (count('ammo') <= 0) { toast('No spare ammo.', 'warn'); return; }
  p.reloadT = d.reloadTime;
  sfx('reload');
}

function finishReload(p, d) {
  const need = d.magSize - p.mag;
  const take = Math.min(need, count('ammo'));
  removeItem('ammo', take);
  p.mag += take;
  p.reloadT = 0;
  sfx('reloadDone');
}

function melee(p, d) {
  if (p.meleeCd > 0 || p.dodgeT > 0) return;
  const cost = 14 * d.staminaMult;
  if (p.stamina < cost) { toast('Too tired to strike.', 'warn', 1.2); return; }
  p.stamina -= cost;
  p.meleeCd = 0.55;
  p.meleeAnim = 0.18;
  p.lastCombat = 0;
  sfx('swing');
  let hit = false;
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dd = dist(p.x, p.y, e.x, e.y);
    if (dd > 44 + e.radius) continue;
    if (Math.abs(angleDiff(p.angle, angleTo(p.x, p.y, e.x, e.y))) > 1.1) continue;
    e.stun = 0.45;
    damageEnemy(e, 30, p.angle, 'melee');
    e.kx += Math.cos(p.angle) * 260; e.ky += Math.sin(p.angle) * 260;
    hit = true;
  }
  if (hit) { sfx('thud'); shake(4); }
}

function dodge(p, d, mv) {
  if (p.dodgeT > 0 || p.stamina < d.dodgeCost) {
    if (p.stamina < d.dodgeCost) toast('Not enough stamina to dodge.', 'warn', 1.2);
    return;
  }
  let dx = mv.x, dy = mv.y;
  const l = Math.hypot(dx, dy);
  if (l < 0.1) { dx = -Math.cos(p.angle); dy = -Math.sin(p.angle); } else { dx /= l; dy /= l; }
  p.dodgeDx = dx; p.dodgeDy = dy;
  p.dodgeT = d.dodgeTime;
  p.invuln = Math.max(p.invuln, d.dodgeIframes);
  p.stamina -= d.dodgeCost;
  sfx('dodge');
  if (inCombat()) addJP('shadow', 1, 'dodge', 6);
}

/** Apply damage to the player from a source point. Returns true if damage landed. */
export function damagePlayer(dmg, fromX, fromY, kind = 'bullet') {
  const p = G.player;
  if (p.invuln > 0 || p.dead || G.transition) return false;
  const d = derived();
  let amount = dmg;
  if (p.inCover && kind === 'bullet') amount *= 0.65;
  amount = Math.round(amount);
  p.hp -= amount;
  p.invuln = d.graceTime;
  p.lastHurt = 0;
  p.lastCombat = 0;
  p.flinch = Math.min(1, p.flinch + 0.6);
  G.hitFlash = 0.35;
  G.hurtDir = { angle: angleTo(p.x, p.y, fromX, fromY), t: 1.2 };
  sfx('hurt');
  shake(7);
  spawnParticles(p.x, p.y, '#c0392b', 6, 90);
  addFloater(p.x, p.y - 18, `-${amount}`, '#ff6b6b');
  if (p.hp <= 0) {
    p.hp = 0;
    p.dead = true;
    G.events.emit('playerDown');
  }
  return true;
}
