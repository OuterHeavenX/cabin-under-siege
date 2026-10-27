// The player character: movement, aiming, shooting, melee, dodge, damage.
import { G } from './state.js';
import { inSafeRoom } from './home.js';
import { PLAYER_RADIUS, PLAYER_SPEED, SPRINT_SPEED, TILE } from '../config.js';
import { input, consume, readMove } from '../input.js';
import { derived, addJP } from './progression.js';
import { count, removeItem, quickItem, useConsumable } from './inventory.js';
import { modStats } from './activities.js';
import { spawnBullet, spawnParticles, addFloater, shake, damageEnemy } from './combat.js';
import { angleDiff, angleTo, clamp, dist } from '../util.js';
import { sfx } from '../audio.js';
import { toast } from '../ui/hud.js';
import { isNight } from './state.js';
import { WEAPONS, WEAPON_ORDER } from '../data/weapons.js';
import { tryAllyRevive } from './ally.js';
import { assaultRevive } from './assault.js';

const SURFACE = { 0: 'grass', 1: 'dirt', 2: 'hard', 3: 'wood', 4: 'wood', 5: 'grass', 6: 'gravel', 7: 'hard', 8: 'dirt', 9: 'hard', 10: 'hard' };
function surfaceAt(map, x, y) {
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
  return map.inBounds(cx, cy) ? SURFACE[map.ground[map.idx(cx, cy)]] || 'grass' : 'grass';
}

export function createPlayer() {
  const sp = G.s.player;
  return {
    x: sp.x, y: sp.y, radius: PLAYER_RADIUS,
    hp: sp.hp, stamina: sp.stamina, mag: sp.mag,
    weapon: sp.weapon && WEAPONS[sp.weapon] ? sp.weapon : 'pistol',
    mags: { pistol: 0, shotgun: 0, rifle: 0, ...(sp.mags || {}) }, swapT: 0, casings: [],
    angle: sp.facing ?? -Math.PI / 2,
    vx: 0, vy: 0,
    fireCd: 0, reloadT: 0, meleeCd: 0, meleeAnim: 0,
    invuln: 0, dodgeT: 0, dodgeDx: 0, dodgeDy: 0,
    flinch: 0, muzzle: 0, lastHurt: 99, lastCombat: 99, regenBuff: 0, wellFed: 0,
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
  if (inSafeRoom() && !p.dead && p.hp < d.maxHp * 0.6) p.hp = Math.min(d.maxHp * 0.6, p.hp + 3 * dt);
  if (p.wellFed > 0) { p.wellFed -= dt; if (p.wellFed <= 0) { const d0 = derived(); p.hp = Math.min(p.hp, d0.maxHp); p.stamina = Math.min(p.stamina, d0.maxStamina); } }
  if (p.hp > d.maxHp) p.hp = d.maxHp;

  // --- Movement ---
  const mv = readMove();
  const moving = Math.hypot(mv.x, mv.y) > 0.05;
  let sprint = false;
  const mvMag = Math.hypot(mv.x, mv.y);
  if (moving && (input.held.sprint || ((input.touchMode || input.padMode) && G.settings.autoSprint && mvMag > 0.97)) && p.stamina > 5) sprint = true;
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
      if (Math.floor(p.walkPhase / Math.PI) !== Math.floor((p.walkPhase - dt * 10) / Math.PI)) sfx('step', { vol: sprint ? 1 : 0.6, surface: surfaceAt(map, p.x, p.y) });
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
  } else if (!input.touchMode && !input.padMode && input.mouse.inside) {
    const c = G.camera;
    const wx = (input.mouse.x - G.view.w / 2) / c.zoom + c.x;
    const wy = (input.mouse.y - G.view.h / 2) / c.zoom + c.y;
    p.angle = angleTo(p.x, p.y, wx, wy);
  } else if (moving && !input.held.fire) {
    p.angle = Math.atan2(mv.y, mv.x);
  }

  // --- Weapon switching ---
  p.swapT -= dt;
  if (consume('swap')) cycleWeapon(p, 1);
  for (const [i, id] of WEAPON_ORDER.entries()) if (consume('weapon' + (i + 1))) equipWeapon(p, id);

  // --- Shooting ---
  const w = WEAPONS[p.weapon];
  const firing = input.held.fire || consume('fireClick');
  // Shell-by-shell reloads can be interrupted by firing.
  if (firing && p.reloadT > 0 && w.perRound && p.mag > 0) { p.reloadT = 0; }
  if (firing && p.reloadT <= 0 && p.fireCd <= 0 && p.dodgeT <= 0 && p.swapT <= 0 && !G.repairHold) {
    // FIRE button without stick aim: aim assist picks a target in a wide cone.
    if ((input.touchMode || input.padMode) && !(input.aim.active) && G.settings.aimAssist) {
      const t = assistTarget(p, 1.2);
      if (t) p.angle = angleTo(p.x, p.y, t.x, t.y);
    }
    if (p.mag > 0) {
      fire(p, d, moving, w);
    } else {
      sfx('empty');
      p.fireCd = 0.3;
      if (count(w.ammo) > 0) startReload(p, d);
      else toast(`Out of ${w.short.toLowerCase()} ammo! Switch weapons, use MELEE, or buy more.`, 'warn', 2.5);
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

export function ownsWeapon(id) { return id === 'pistol' || count(id) > 0; }

export function magSize(id) {
  if (id === 'pistol') return G.s.home.upgrades.extMag || G.s.weaponMods?.extMag ? WEAPONS.pistol.extMag : WEAPONS.pistol.mag;
  return WEAPONS[id].mag;
}

export function reloadTime(id) {
  const w = WEAPONS[id];
  return w.reload * (derived().reloadTime / 1.45);
}

export function equipWeapon(p, id) {
  if (!WEAPONS[id] || p.weapon === id) return;
  if (!ownsWeapon(id)) { toast(`You don't own a ${WEAPONS[id].name}.`, 'warn', 1.5); return; }
  p.mags[p.weapon] = p.mag;
  p.weapon = id;
  p.mag = p.mags[id] || 0;
  p.reloadT = 0;
  p.swapT = 0.35;
  sfx('swap');
  toast(`${WEAPONS[id].icon} ${WEAPONS[id].name}`, 'info', 1);
}

export function cycleWeapon(p, dir) {
  const owned = WEAPON_ORDER.filter(ownsWeapon);
  if (owned.length < 2) { toast('You only have the handgun. Marsh General sells long guns.', 'info', 1.6); return; }
  const i = owned.indexOf(p.weapon);
  equipWeapon(p, owned[(i + dir + owned.length) % owned.length]);
}

function fire(p, d, moving, w) {
  p.mag--;
  p.fireCd = w.fireCd;
  p.muzzle = w.pellets > 1 ? 0.09 : 0.06;
  p.lastCombat = 0;
  const md = modStats(p.weapon);
  let spread = w.spread * (w.pellets > 1 ? 1 : d.spreadMult) * md.spread;
  if (moving) spread += w.moveSpread * d.moveSpreadMult;
  spread += p.flinch * 0.2 * d.flinchMult;
  const mx = p.x + Math.cos(p.angle) * 18, my = p.y + Math.sin(p.angle) * 18;
  for (let i = 0; i < w.pellets; i++) {
    const a = w.pellets > 1
      ? p.angle + ((i / (w.pellets - 1)) - 0.5) * 2 * spread * (0.75 + Math.random() * 0.25) + (Math.random() - 0.5) * 0.04
      : p.angle + (Math.random() - 0.5) * 2 * spread;
    spawnBullet({ x: mx, y: my, angle: a, speed: w.speed * (0.92 + Math.random() * 0.16), dmg: w.dmg, owner: 'player', range: w.range * md.range * (w.pellets > 1 ? 0.85 + Math.random() * 0.3 : 1), pierce: w.pierce || 0, knock: w.knock, weapon: p.weapon });
  }
  // Ejected casing (visual)
  G.casings = G.casings || [];
  if (G.casings.length > 40) G.casings.shift();
  const side = p.angle + Math.PI / 2;
  G.casings.push({ x: p.x, y: p.y, vx: Math.cos(side) * 90 + (Math.random() - 0.5) * 40, vy: Math.sin(side) * 90 + (Math.random() - 0.5) * 40, t: 0, rot: Math.random() * 6, color: p.weapon === 'shotgun' ? '#c0392b' : '#d9b84a' });
  sfx(md.quiet ? 'suppressed' : w.sound);
  shake(md.quiet ? 1 : w.shake);
  if (p.weapon !== 'pistol') { p.x -= Math.cos(p.angle) * 3; p.y -= Math.sin(p.angle) * 3; }
  G.events.emit('shot', p.x, p.y, md.quiet);
  if (p.mag === 0 && count(w.ammo) > 0) startReload(p, d);
}

function startReload(p, d) {
  const w = WEAPONS[p.weapon];
  if (p.reloadT > 0 || p.mag >= magSize(p.weapon)) return;
  if (count(w.ammo) <= 0) { toast(`No spare ${ITEM_NAME(w.ammo)}.`, 'warn'); return; }
  p.reloadT = reloadTime(p.weapon);
  sfx(w.perRound ? 'shell' : 'reload');
}

function finishReload(p, d) {
  const w = WEAPONS[p.weapon];
  const need = magSize(p.weapon) - p.mag;
  const take = Math.min(w.perRound ? 1 : need, count(w.ammo));
  removeItem(w.ammo, take);
  p.mag += take;
  p.reloadT = 0;
  // Shotgun keeps loading shells until full (or until you fire).
  if (w.perRound && p.mag < magSize(p.weapon) && count(w.ammo) > 0) { p.reloadT = reloadTime(p.weapon); sfx('shell'); }
  else sfx('reloadDone');
}

const ITEM_NAME = (id) => ({ ammo: '9mm rounds', shells: 'shotgun shells', rifle_ammo: 'rifle rounds' }[id] || id);

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
  sfx('dodge', { surface: surfaceAt(G.map, p.x, p.y) });
  if (inCombat()) addJP('shadow', 1, 'dodge', 6);
}

/** Apply damage to the player from a source point. Returns true if damage landed. */
export function damagePlayer(dmg, fromX, fromY, kind = 'bullet') {
  const p = G.player;
  if (p.invuln > 0 || p.dead || G.transition) return false;
  const d = derived();
  let amount = dmg;
  if (p.inCover && kind === 'bullet') amount *= 0.65;
  if (inSafeRoom()) amount *= 0.5;
  amount = Math.round(amount);
  p.hp -= amount;
  G.events.emit('playerHurt', p.x, p.y, amount);
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
    if (tryAllyRevive() || assaultRevive()) return true;
    p.dead = true;
    G.events.emit('playerDown');
  }
  return true;
}
