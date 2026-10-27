// Enemy AI: approach, notice, take cover, shoot with telegraphs, breach doors
// and windows, and retreat when hurt or outnumbered.
import { G, isNight } from './state.js';
import { TILE } from '../config.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { angleDiff, angleTo, dist, rand, choose } from '../util.js';
import { spawnBullet, spawnParticles, shake } from './combat.js';
import { damagePlayer } from './player.js';
import { derived, addJP } from './progression.js';
import { inFloodlight, isLit } from '../world/lights.js';
import { sfx } from '../audio.js';
import { throwMolotov } from './fire.js';
import { homeInterior, homeMapId } from './chapters.js';
import { checkTrap } from './home.js';

let nextId = 1;

export function spawnEnemy(type, x, y, opts = {}) {
  const def = ENEMY_TYPES[type];
  const e = {
    id: nextId++, type, def, x, y, radius: def.radius,
    hp: Math.round(def.hp * (opts.hpMult || 1)), maxHp: Math.round(def.hp * (opts.hpMult || 1)),
    angle: 0, alerted: false, path: null, pathT: Math.random() * 0.5, goalKey: '',
    fireCd: rand(0.8, 1.6), aimT: 0, aimAngle: 0, stun: 0, kx: 0, ky: 0,
    cover: null, coverT: 0, spotted: 0, spottedOnce: false, dead: false, deadT: 0, gone: false,
    hitT: 0, lastHit: 99, retreating: false, retreatRolled: false, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0,
    breach: null, breachCd: 0, name: opts.name || def.name, carriesNote: opts.carriesNote || null,
    entry: opts.entry || null, walkPhase: 0, hpMultApplied: opts.hpMult || 1,
  };
  G.enemies.push(e);
  return e;
}

/** How much punishment an opening can still take (attackers probe for the weakest). */
export function openingStrength(b) {
  if (b.kind === 'door') return b.passable ? 0 : b.rec.hp;
  return b.rec.glass + (b.rec.boards ? b.rec.boardHp : 0) + (b.rec.shutters ? b.rec.shutterHp : 0);
}

/** Per-attacker path cost: weak doors/windows are cheap, braced ones expensive,
 *  with a small personal bias so a squad splits between a couple of weak points. */
function makeCost(e) {
  return (cx, cy) => {
    const m = G.map;
    const s = m.getSolid(cx, cy);
    if (s !== 0) return Infinity;
    const b = m.blockerAt(cx, cy);
    if (b) {
      if (b.kind === 'cover') return Infinity;
      if (b.blocksMove('enemy')) {
        if (b.rec.npc) return Infinity;
        const bias = ((e.id * 7 + cx * 3 + cy * 5) % 7);
        return 3 + openingStrength(b) / 12 + bias;
      }
    }
    return 0;
  };
}
const costFn = makeCost({ id: 0 });

function alertEnemy(e) {
  if (e.alerted || e.dead) return;
  e.alerted = true;
  e.path = null;
  e.fireCd = Math.max(e.fireCd, 0.6);
  // Nearby allies hear the shout.
  for (const o of G.enemies) {
    if (o !== e && !o.alerted && !o.dead && dist(o.x, o.y, e.x, e.y) < 360) { o.alerted = true; o.path = null; }
  }
}

export function initEnemyEvents() {
  G.events.on('enemyAlert', (e) => alertEnemy(e));
  G.events.on('shot', (x, y) => {
    for (const e of G.enemies) if (!e.dead && !e.alerted && dist(e.x, e.y, x, y) < 420) alertEnemy(e);
  });
}

function nearestExit(e) {
  let best = null, bd = Infinity;
  for (const k of Object.keys(G.map.spawns)) {
    const s = G.map.spawns[k];
    const d = dist(e.x, e.y, s.x, s.y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/** Choose a cover cell near the enemy with line of sight to the player. */
function findCover(e, p) {
  const m = G.map;
  const ecx = Math.floor(e.x / TILE), ecy = Math.floor(e.y / TILE);
  const [minD, maxD] = e.def.preferDist;
  let best = null, bestScore = Infinity;
  for (let i = 0; i < 70; i++) {
    const cx = ecx + Math.round(rand(-8, 8)), cy = ecy + Math.round(rand(-8, 8));
    if (!m.inBounds(cx, cy) || costFn(cx, cy) !== 0) continue;
    const x = cx * TILE + 16, y = cy * TILE + 16;
    const d = dist(x, y, p.x, p.y);
    if (d < minD || d > maxD) continue;
    let adj = false;
    for (let oy = -1; oy <= 1 && !adj; oy++) for (let ox = -1; ox <= 1; ox++) if ((ox || oy) && m.isCoverCell(cx + ox, cy + oy) && !m.blockerAt(cx + ox, cy + oy)?.rec?.npc) { adj = true; break; }
    if (!adj) continue;
    if (!m.los(x, y, p.x, p.y)) continue;
    if (G.enemies.some((o) => o !== e && o.cover && o.cover.cx === cx && o.cover.cy === cy)) continue;
    const score = Math.abs(d - (minD + maxD) / 2) * 0.6 + dist(x, y, e.x, e.y) * 0.5 + Math.random() * 30;
    if (score < bestScore) { bestScore = score; best = { cx, cy, x, y }; }
  }
  return best;
}

/** Unalerted attackers search the cabin: A* routes them through the cheapest
 *  door or window nearest their approach, which they then breach. */
function entryGoal() {
  return homeInterior(G.map.id);
}

function goalCellFor(e, p) {
  const m = G.map;
  if (e.retreating) {
    const ex = nearestExit(e);
    return ex ? { cx: Math.floor(ex.x / TILE), cy: Math.floor(ex.y / TILE) } : null;
  }
  if (!e.alerted) {
    const g = entryGoal();
    if (g) return g;
  }
  if (e.type === 'gunman' && e.cover) return { cx: e.cover.cx, cy: e.cover.cy };
  return { cx: Math.floor(p.x / TILE), cy: Math.floor(p.y / TILE) };
}

function followPath(e, dt, speed) {
  const m = G.map;
  if (!e.path || !e.path.length) return false;
  const n = e.path[0];
  const b = m.blockerAt(n.cx, n.cy);
  if (b && b.kind !== 'cover' && b.blocksMove('enemy')) {
    const tx = n.cx * TILE + 16, ty = n.cy * TILE + 16;
    if (dist(e.x, e.y, tx, ty) < TILE * 1.3) { e.breach = b; return true; }
  }
  if (b && b.kind === 'cover') { e.path = null; return false; }
  const tx = n.cx * TILE + 16, ty = n.cy * TILE + 16;
  const d = dist(e.x, e.y, tx, ty);
  if (d < 6) { e.path.shift(); return true; }
  const a = Math.atan2(ty - e.y, tx - e.x);
  m.moveCircle(e, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt, 'enemy');
  e.walkPhase += dt * 9;
  if (!e.aimT) e.angle = a;
  return true;
}

function startAim(e, p) {
  e.aimT = e.def.telegraph;
  e.aimAngle = angleTo(e.x, e.y, p.x, p.y);
}

function doFire(e, p) {
  const def = e.def;
  if (def.weapon === 'bat') {
    sfx('swing', { x: e.x, y: e.y });
    const d = dist(e.x, e.y, p.x, p.y);
    if (d < def.range + p.radius + e.radius + 10 && Math.abs(angleDiff(e.aimAngle, angleTo(e.x, e.y, p.x, p.y))) < 1.2) {
      if (damagePlayer(def.damage, e.x, e.y, 'melee')) {
        p.x += Math.cos(e.aimAngle) * 6; p.y += Math.sin(e.aimAngle) * 6;
      }
    }
  } else if (def.weapon === 'molotov') {
    const t = e.throwAt || { x: p.x, y: p.y };
    const sp = def.spread * dist(e.x, e.y, t.x, t.y);
    throwMolotov(e, t.x + (Math.random() - 0.5) * sp, t.y + (Math.random() - 0.5) * sp);
    e.throwAt = null;
  } else if (def.weapon === 'eshotgun') {
    for (let i = 0; i < def.pellets; i++) {
      const a = e.aimAngle + ((i / (def.pellets - 1)) - 0.5) * 2 * def.spread;
      spawnBullet({ x: e.x + Math.cos(a) * 16, y: e.y + Math.sin(a) * 16, angle: a, speed: 620, dmg: def.damage, owner: 'enemy', range: def.range + 40, source: e });
    }
    sfx('shotgun', { x: e.x, y: e.y });
    e.spotted = Math.max(e.spotted, 1.6);
    e.muzzle = 0.09;
  } else {
    let spread = def.spread;
    if (inFloodlight(e.x, e.y)) spread *= 1.5; // glare
    if (G.player.dodgeT > 0) spread *= 1.3;
    const a = e.aimAngle + (Math.random() - 0.5) * 2 * spread;
    spawnBullet({ x: e.x + Math.cos(a) * 14, y: e.y + Math.sin(a) * 14, angle: a, speed: def.weapon === 'rifle' ? 820 : 640, dmg: def.damage, owner: 'enemy', range: def.range + 80, source: e });
    const pd = dist(e.x, e.y, p.x, p.y);
    sfx(def.weapon === 'rifle' ? 'rifle' : 'enemyShot', { x: e.x, y: e.y });
    e.spotted = Math.max(e.spotted, 1.6); // muzzle flash reveals the shooter
    e.muzzle = 0.07;
  }
  e.fireCd = def.fireCooldown * rand(0.8, 1.25) * (e.inspired ? 0.75 : 1);
}

export function updateEnemies(dt) {
  const p = G.player;
  const m = G.map;
  const d = derived();
  const alive = G.enemies.filter((e) => !e.dead && !e.gone);
  const bosses = alive.filter((e) => e.def.boss);
  const camera = G.s.home.upgrades.camera && G.map.id === homeMapId() && G.siegeActive;
  for (const e of alive) {
    e.inspired = !e.def.boss && bosses.some((b) => dist(b.x, b.y, e.x, e.y) < 240);
    if (camera) e.spotted = Math.max(e.spotted, 0.4);
    checkTrap(e);
  }

  for (const e of G.enemies) {
    if (e.gone) continue;
    if (e.dead) { e.deadT += dt; continue; }
    e.hitT -= dt; e.lastHit += dt; e.stun -= dt; e.spotted -= dt; e.pathT -= dt; e.coverT -= dt; e.breachCd -= dt; e.strafeT -= dt;
    if (e.muzzle) e.muzzle -= dt;

    // knockback
    if (Math.abs(e.kx) + Math.abs(e.ky) > 1) {
      m.moveCircle(e, e.kx * dt, e.ky * dt, 'enemy');
      e.kx *= Math.pow(0.002, dt); e.ky *= Math.pow(0.002, dt);
    }
    if (e.stun > 0) { e.aimT = 0; continue; }

    const pd = dist(e.x, e.y, p.x, p.y);
    const hpFrac = e.hp / e.maxHp;

    // Retreat decision (rolled once when badly hurt, or when left alone).
    if (!e.retreating && !e.retreatRolled && !e.inspired && hpFrac < e.def.retreatAt + 0.05) {
      e.retreatRolled = true;
      if (Math.random() > e.def.bravery) { e.retreating = true; e.path = null; e.aimT = 0; G.events.emit('enemyRetreat', e); }
    }
    if (!e.retreating && !e.lonelyRolled && !e.def.boss && alive.length === 1 && G.siegeActive && G.siege && G.siege.spawned >= 3 && hpFrac < 0.75) {
      e.lonelyRolled = true;
      if (Math.random() < 0.55) { e.retreating = true; e.path = null; e.aimT = 0; G.events.emit('enemyRetreat', e); }
    }

    // Perception
    const canSee = pd < 520 && m.los(e.x, e.y, p.x, p.y);
    if (!e.alerted && !p.dead) {
      const lit = isLit(p.x, p.y) || p.muzzle > 0;
      const base = isNight() && !lit ? 140 : 240;
      if (canSee && pd < base * d.noticeMult) alertEnemy(e);
      else if (pd < 50) alertEnemy(e);
      // Searching attackers eventually start hunting (no endless stalemates).
      e.searchT = (e.searchT || 0) + dt;
      if (e.searchT > 22 && !e.dead) alertEnemy(e);
    }
    // Player spotting unalerted attackers -> Shadow JP
    if (!e.spottedOnce && !e.alerted && canSee && pd < d.seeRadius + 40) {
      e.spottedOnce = true;
      addJP('shadow', 2, 'spot', 12);
    }

    // Path refresh
    const goal = goalCellFor(e, p);
    const gk = goal ? goal.cx + ',' + goal.cy : '';
    if (goal && (e.pathT <= 0 || gk !== e.goalKey || !e.path)) {
      e.goalKey = gk;
      e.pathT = 0.6 + Math.random() * 0.5;
      e.path = m.findPath(Math.floor(e.x / TILE), Math.floor(e.y / TILE), goal.cx, goal.cy, e.cost || (e.cost = makeCost(e)), 3500);
      e.breach = null;
    }

    // Retreating: run for the edge.
    if (e.retreating) {
      followPath(e, dt, e.def.speed * 1.15);
      const ex = nearestExit(e);
      if (!e.path || !e.path.length || (ex && dist(e.x, e.y, ex.x, ex.y) < 40)) {
        if (ex && dist(e.x, e.y, ex.x, ex.y) < 60) { e.gone = true; G.events.emit('enemyFled', e); }
        else if (ex) { const a = angleTo(e.x, e.y, ex.x, ex.y); m.moveCircle(e, Math.cos(a) * e.def.speed * dt, Math.sin(a) * e.def.speed * dt, 'enemy'); }
      }
      continue;
    }

    // Telegraphed attack in progress
    if (e.aimT > 0) {
      e.aimT -= dt;
      // Track the player for the first part of the windup, then lock in.
      if (e.aimT > e.def.telegraph * 0.4 && !(e.def.weapon === 'molotov' && e.throwAt)) e.aimAngle = angleTo(e.x, e.y, p.x, p.y);
      else if (e.def.weapon === 'molotov' && !e.throwAt) e.throwAt = { x: p.x, y: p.y };
      e.angle = e.aimAngle;
      if (e.aimT <= 0) { e.aimT = 0; if (!p.dead) doFire(e, p); }
      continue;
    }

    // Breaching a door/window
    if (e.breach) {
      const b = e.breach;
      if (!b.blocksMove('enemy')) { e.breach = null; e.path = null; }
      else {
        e.angle = angleTo(e.x, e.y, b.cx * TILE + 16, b.cy * TILE + 16);
        // Shooters stop to fire at a visible player rather than bashing.
        if (e.def.weapon === 'molotov' && e.fireCd <= 0) {
          // Back off and set the opening on fire.
          e.throwAt = { x: b.cx * TILE + 16, y: b.cy * TILE + 16 };
          e.aimT = e.def.telegraph; e.aimAngle = angleTo(e.x, e.y, e.throwAt.x, e.throwAt.y);
          continue;
        }
        if (e.alerted && canSee && e.def.weapon !== 'bat' && pd < e.def.range && e.fireCd <= 0) { startAim(e, p); continue; }
        if (e.breachCd <= 0) {
          b.damage(e.def.breachDamage);
          e.breachCd = e.type === 'enforcer' ? 1.0 : 1.3;
          const bd = dist(p.x, p.y, b.cx * TILE, b.cy * TILE);
          sfx(b.kind === 'window' && !b.rec.boards && !b.rec.shutters ? 'glass' : b.kind === 'window' && b.rec.shutters ? 'hammer' : 'wood', { x: b.cx * TILE + 16, y: b.cy * TILE + 16 });
          spawnParticles(b.cx * TILE + 16, b.cy * TILE + 16, '#a0784a', 5, 90);
          if (bd < 200) shake(2);
          G.events.emit('breachHit', b);
        }
        e.fireCd -= dt;
        continue;
      }
    }

    e.fireCd -= dt;
    if (!e.alerted) { followPath(e, dt, e.def.speed * 0.8); continue; }

    // --- Alerted behaviours ---
    const [minD, maxD] = e.def.preferDist;
    if (e.type === 'enforcer') {
      if (pd < e.def.range + p.radius + e.radius && canSee) {
        if (e.fireCd <= 0) startAim(e, p);
        e.angle = angleTo(e.x, e.y, p.x, p.y);
      } else if (canSee && pd < 140) {
        const a = angleTo(e.x, e.y, p.x, p.y);
        m.moveCircle(e, Math.cos(a) * e.def.speed * 1.1 * dt, Math.sin(a) * e.def.speed * 1.1 * dt, 'enemy');
        e.angle = a; e.walkPhase += dt * 9;
      } else followPath(e, dt, e.def.speed);
    } else {
      if (e.type === 'gunman' && (e.coverT <= 0 || (e.cover && !m.los(e.cover.x, e.cover.y, p.x, p.y)))) {
        e.cover = findCover(e, p);
        e.coverT = 3.5 + Math.random() * 1.5;
      }
      const atCover = e.cover && dist(e.x, e.y, e.cover.x, e.cover.y) < 10;
      if (canSee && pd <= e.def.range && (pd >= minD || e.type === 'scout') && (!e.cover || atCover || pd < maxD)) {
        e.angle = angleTo(e.x, e.y, p.x, p.y);
        if (e.fireCd <= 0) { startAim(e, p); continue; }
        if (e.type === 'scout' || !e.cover) {
          // strafe / keep distance
          if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = rand(1, 2.2); }
          const a = e.angle + (Math.PI / 2) * e.strafe;
          let mx = Math.cos(a) * e.def.speed * 0.55, my = Math.sin(a) * e.def.speed * 0.55;
          if (pd < minD) { mx -= Math.cos(e.angle) * e.def.speed * 0.7; my -= Math.sin(e.angle) * e.def.speed * 0.7; }
          else if (pd > maxD) { mx += Math.cos(e.angle) * e.def.speed * 0.6; my += Math.sin(e.angle) * e.def.speed * 0.6; }
          m.moveCircle(e, mx * dt, my * dt, 'enemy');
          e.walkPhase += dt * 7;
        } else if (!atCover) followPath(e, dt, e.def.speed);
      } else {
        followPath(e, dt, e.def.speed);
      }
    }
  }

  // Separation so attackers don't stack into one blob.
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      const dd = dist(a.x, a.y, b.x, b.y), min = a.radius + b.radius;
      if (dd > 0 && dd < min) {
        const push = (min - dd) / 2;
        const nx = (b.x - a.x) / dd, ny = (b.y - a.y) / dd;
        m.moveCircle(a, -nx * push, -ny * push, 'enemy');
        m.moveCircle(b, nx * push, ny * push, 'enemy');
      }
    }
  }

  // Remove long-dead bodies and those who fled.
  G.enemies = G.enemies.filter((e) => !e.gone && !(e.dead && e.deadT > 25));
}

export function pickSpawnTypes(n, weights) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    let acc = 0;
    for (const [t, w] of weights) { acc += w; if (r <= acc) { out.push(t); break; } }
    if (out.length < i + 1) out.push(choose(weights)[0]);
  }
  return out;
}
