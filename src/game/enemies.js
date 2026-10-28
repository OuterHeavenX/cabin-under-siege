// Enemy AI: approach, notice, take cover, shoot with telegraphs, breach doors
// and windows, and retreat when hurt or outnumbered.
import { G, isNight, hasSkill } from './state.js';
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
import { diff } from './difficulty.js';
import { weatherMods } from './weather.js';
import { guardGoal, updateGuard } from './assault.js';

let nextId = 1;

export function spawnEnemy(type, x, y, opts = {}) {
  const def = ENEMY_TYPES[type];
  if (!opts.noDiff) opts = { ...opts, hpMult: (opts.hpMult || 1) * diff().hp };
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
  // Handlers bring their dogs.
  if (def.pack) for (let i = 0; i < def.pack; i++) {
    const a = Math.random() * Math.PI * 2;
    const dgo = spawnEnemy('attack_dog', x + Math.cos(a) * 24, y + Math.sin(a) * 24, { hpMult: opts.hpMult, noDiff: true });
    G.map && G.map.pushOut(dgo, dgo.radius, 'enemy');
  }
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

/** Attacks where the crew has to find you (story nights, raids, ambushes) —
 *  not Endless Siege, the mansion or the Newark episode, which play as before. */
export function huntMode() {
  return !!(G.siegeActive && G.siege && G.siege.plan.kind !== 'endless' && !G.endless && !G.prequel && !G.assault);
}
const nowMin = () => G.s.time.day * 1440 + G.s.time.minute;

/** `at` is where they think you are: what they saw or heard, not where you really are. */
function alertEnemy(e, at = null) {
  if (e.alerted || e.dead) return;
  const p = G.player;
  e.alerted = true;
  e.alertPop = 0.7;
  e.sus = 0;
  e.searching = false;
  e.lastSeen = at ? { x: at.x, y: at.y } : { x: p.x, y: p.y };
  e.lostT = 0;
  if (e.def.dog) sfx('bark', { x: e.x, y: e.y });
  e.path = null;
  e.fireCd = Math.max(e.fireCd, 0.6);
  if (G.siege) G.siege.lastSpot = nowMin();
  // Nearby allies hear the shout — and go where the shouter thinks you are.
  for (const o of G.enemies) {
    if (o !== e && !o.alerted && !o.dead && dist(o.x, o.y, e.x, e.y) < 360) { o.alerted = true; o.searching = false; o.lastSeen = { ...e.lastSeen }; o.lostT = 0; o.path = null; }
  }
}

/** A silent takedown: a witness who can see the body raises the alarm, nobody else hears a thing. */
export function witnessTakedown(victim) {
  const p = G.player;
  for (const o of G.enemies) {
    if (o === victim || o.dead || o.gone || o.alerted) continue;
    const d = dist(o.x, o.y, victim.x, victim.y);
    const facing = Math.abs(angleDiff(o.angle, angleTo(o.x, o.y, victim.x, victim.y))) < 1.4;
    if (d < 230 && facing && G.map.los(o.x, o.y, victim.x, victim.y)) alertEnemy(o, { x: p.x, y: p.y });
  }
}

/** Where a searcher looks next: places on the map, spreading out across the crew. */
function searchGoal(e) {
  const sg = G.siege, m = G.map;
  if (e.searchGoal && e.searchGoalT > 0 && dist(e.x, e.y, e.searchGoal.x, e.searchGoal.y) > 36) return e.searchGoal;
  if (!sg.spots) {
    const pts = [...Object.values(m.points || {}), ...Object.values(m.spawns || {})].filter((pt) => pt && isFinite(pt.x));
    sg.spots = pts.filter((pt) => { const cx = Math.floor(pt.x / TILE), cy = Math.floor(pt.y / TILE); return m.inBounds(cx, cy) && costFn(cx, cy) === 0; });
    sg.looked = new Set();
  }
  if (!sg.spots.length) return null;
  let pick = null, best = Infinity;
  for (let i = 0; i < 8; i++) {
    const pt = choose(sg.spots);
    const score = (sg.looked.has(pt) ? 900 : 0) + dist(e.x, e.y, pt.x, pt.y) * (0.5 + Math.random());
    if (score < best) { best = score; pick = pt; }
  }
  sg.looked.add(pick);
  if (sg.looked.size > sg.spots.length * 0.8) sg.looked.clear();
  e.searchGoal = pick;
  e.searchGoalT = 30;
  return pick;
}

export function initEnemyEvents() {
  G.events.on('enemyAlert', (e, src) => {
    // Getting hurt only gives you away if you did it. Fire and traps tell them nothing about where you are.
    if (src === 'fire') return;
    if (src === 'trap') { alertEnemy(e, { x: e.x, y: e.y }); return; }
    alertEnemy(e);
  });
  G.events.on('shot', (x, y, quiet) => {
    const r = quiet ? 110 : 420;
    for (const e of G.enemies) if (!e.dead && !e.alerted && dist(e.x, e.y, x, y) < r) alertEnemy(e, { x, y });
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
  const cell = (pt) => ({ cx: Math.floor(pt.x / TILE), cy: Math.floor(pt.y / TILE) });
  if (!e.alerted) {
    if (e.investigate) return cell(e.investigate); // a noise over there (Misdirection)
    if (e.guard) return cell(guardGoal(e));
    if (huntMode()) {
      // First they hit the house. Only when it's empty do they start searching.
      const sg = G.siege;
      const g = !sg.homeCleared ? entryGoal() : null;
      if (g) {
        if (Math.abs(Math.floor(e.x / TILE) - g.cx) <= 1 && Math.abs(Math.floor(e.y / TILE) - g.cy) <= 1) sg.homeCleared = true;
        else return g;
      } else sg.homeCleared = true;
      const s = searchGoal(e);
      return s ? cell(s) : null;
    }
    const g = entryGoal();
    if (g) return g;
  }
  // Out of sight, they go where they last saw (or heard) you.
  if (e.alerted && huntMode() && !e.canSee && e.lastSeen) return cell(e.lastSeen);
  if ((e.type === 'gunman' || e.type === 'sniper') && e.cover) return { cx: e.cover.cx, cy: e.cover.cy };
  return cell(p);
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
  if (def.weapon === 'bat' || def.weapon === 'bite') {
    sfx(def.weapon === 'bite' ? 'growl' : 'swing', { x: e.x, y: e.y, vol: 0.8 });
    const d = dist(e.x, e.y, p.x, p.y);
    if (d < def.range + p.radius + e.radius + 10 && Math.abs(angleDiff(e.aimAngle, angleTo(e.x, e.y, p.x, p.y))) < 1.2) {
      if (damagePlayer(def.damage * diff().dmg, e.x, e.y, 'melee')) {
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
      spawnBullet({ x: e.x + Math.cos(a) * 16, y: e.y + Math.sin(a) * 16, angle: a, speed: 620, dmg: def.damage * diff().dmg, owner: 'enemy', range: def.range + 40, source: e });
    }
    sfx('shotgun', { x: e.x, y: e.y });
    e.spotted = Math.max(e.spotted, 1.6);
    e.muzzle = 0.09;
  } else {
    let spread = def.spread;
    if (inFloodlight(e.x, e.y)) spread *= 1.5; // glare
    if (G.player.dodgeT > 0) spread *= 1.3;
    const a = e.aimAngle + (Math.random() - 0.5) * 2 * spread;
    spawnBullet({ x: e.x + Math.cos(a) * 14, y: e.y + Math.sin(a) * 14, angle: a, speed: def.weapon === 'srifle' ? 1150 : def.weapon === 'rifle' ? 820 : 640, dmg: def.damage * diff().dmg, owner: 'enemy', range: def.range + 80, source: e });
    sfx(def.weapon === 'rifle' || def.weapon === 'srifle' ? 'rifle' : 'enemyShot', { x: e.x, y: e.y });
    e.spotted = Math.max(e.spotted, 1.6); // muzzle flash reveals the shooter
    e.muzzle = 0.07;
  }
  e.fireCd = def.fireCooldown * rand(0.8, 1.25) * (e.inspired ? 0.75 : 1);
}

/* ---------------- ram truck ---------------- */
// Drives up the road to the gate (or the nearest weak opening), smashes it,
// drops off a couple of attackers and leaves. Can be shot up and destroyed.
function truckCost(cx, cy) {
  const m = G.map;
  if (m.getSolid(cx, cy) !== 0) return Infinity;
  const b = m.blockerAt(cx, cy);
  if (b && (b.kind === 'cover' || b.blocksMove('enemy'))) return Infinity;
  let pen = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (m.getSolid(cx + dx, cy + dy) !== 0) pen += 4;
  return pen;
}

function truckTarget(e, m) {
  if (e.phase === 'leave') return nearestExit(e);
  const g = m.homeInfo && m.homeInfo.gate;
  if (g) return { x: g.cx * TILE + 16, y: (g.cy - 1) * TILE + 16, cells: [[g.cx, g.cy], [g.cx - 1, g.cy], [g.cx + 1, g.cy]] };
  // No gate: aim for the weakest opening of the home.
  let best = null, bs = Infinity;
  for (const b of m.blockers.values ? m.blockers.values() : []) {
    if (b.kind === 'cover' || !b.blocksMove('enemy')) continue;
    const st = openingStrength(b);
    if (st < bs) { bs = st; best = b; }
  }
  if (!best) return null;
  return { x: best.cx * TILE + 16, y: best.cy * TILE + 16, cells: [[best.cx, best.cy]] };
}

function updateTruck(e, dt, p, m) {
  e.phase = e.phase || 'drive';
  e.ramCd = (e.ramCd || 0) - dt;
  e.engineT = (e.engineT || 0) - dt;
  if (e.engineT <= 0) { e.engineT = 2.2; sfx('car', { x: e.x, y: e.y, vol: 0.7 }); }
  if (e.phase === 'unload') {
    e.unloadT -= dt;
    if (e.unloadT <= 0) { e.phase = 'leave'; e.path = null; }
    return;
  }
  const t = truckTarget(e, m);
  if (!t) { e.phase = 'leave'; return; }
  if (!e.path || e.pathT <= 0) {
    e.pathT = 1.5;
    e.path = m.findPath(Math.floor(e.x / TILE), Math.floor(e.y / TILE), Math.floor(t.x / TILE), Math.floor(t.y / TILE), truckCost, 6000) || [];
  }
  const td = dist(e.x, e.y, t.x, t.y);
  if (e.phase === 'drive' && td < 30) return truckRam(e, t, m);
  if (e.phase === 'leave' && td < 50) { e.gone = true; G.events.emit('enemyFled', e); return; }
  const n = e.path[0];
  const tx = n ? n.cx * TILE + 16 : t.x, ty = n ? n.cy * TILE + 16 : t.y;
  if (n && dist(e.x, e.y, tx, ty) < 10) { e.path.shift(); return; }
  e.spd = Math.min(e.def.speed, (e.spd || 0) + 90 * dt);
  const want = Math.atan2(ty - e.y, tx - e.x);
  const turn = angleDiff(e.angle, want);
  e.angle += Math.max(-dt * 4, Math.min(dt * 4, turn));
  if (Math.abs(turn) > 1.2) e.spd = Math.min(e.spd, 50); // slow for sharp turns
  const ox = e.x, oy = e.y;
  m.moveCircle(e, Math.cos(e.angle) * e.spd * dt, Math.sin(e.angle) * e.spd * dt, 'enemy');
  const moved = dist(ox, oy, e.x, e.y);
  e.stuckT = moved < e.spd * dt * 0.25 ? (e.stuckT || 0) + dt : 0;
  if (e.stuckT > 3) {
    e.stuckT = 0;
    if (e.phase === 'leave') { e.gone = true; G.events.emit('enemyFled', e); return; }
    if (td < 120) return truckRam(e, t, m);
    e.path = null; e.spd = 0;
  }
  // Running someone over.
  const pd = dist(e.x, e.y, p.x, p.y);
  if (pd < e.radius + p.radius + 2 && e.ramCd <= 0 && e.spd > 50 && !p.dead) {
    e.ramCd = 1.2;
    if (damagePlayer(28 * diff().dmg, e.x, e.y, 'melee')) { p.x += Math.cos(e.angle) * 26; p.y += Math.sin(e.angle) * 26; m.pushOut(p, p.radius, 'player'); shake(6); }
  }
}

function truckRam(e, t, m) {
  for (const [cx, cy] of t.cells) {
    const b = m.blockerAt(cx, cy);
    if (b && b.kind !== 'cover' && b.blocksMove('enemy')) { b.damage(e.def.breachDamage); G.events.emit('breachHit', b); }
  }
  sfx('crash', { x: t.x, y: t.y });
  shake(8);
  spawnParticles(t.x, t.y + 16, '#a0784a', 16, 160);
  // Drop off the passengers.
  const types = ['gunman', 'enforcer'];
  if (G.s.difficulty === 'hard' || Math.random() < 0.4) types.push('scout');
  types.forEach((ty, i) => {
    const a = e.angle + Math.PI / 2 * (i % 2 ? 1 : -1);
    const x = e.x + Math.cos(a) * 34 - Math.cos(e.angle) * 10, y = e.y + Math.sin(a) * 34 - Math.sin(e.angle) * 10;
    const q = spawnEnemy(ty, x, y, { hpMult: e.hpMultApplied, noDiff: true });
    m.pushOut(q, q.radius, 'enemy');
    // Where they have to find you, the passengers search like everyone else;
    // otherwise they pile out already knowing where you are.
    if (!huntMode()) q.alerted = true;
    if (G.siege) G.siege.spawned++;
  });
  G.events.emit('truckRammed', e);
  e.phase = 'unload'; e.unloadT = 1.6; e.spd = 0; e.path = null;
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
    if ((camera && !e.camBlind) || e.spotForever) e.spotted = Math.max(e.spotted, 0.4);
    if (!e.def.vehicle) checkTrap(e);
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
    if (e.def.vehicle) { updateTruck(e, dt, p, m); continue; }
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
    const wx = weatherMods();
    const canSee = pd < Math.max(520, e.def.range) * wx.range && m.los(e.x, e.y, p.x, p.y);
    e.canSee = canSee;
    if (!e.alerted && !p.dead) {
      const lit = isLit(p.x, p.y) || p.muzzle > 0;
      // They see poorly behind them: that's how you sneak up.
      const behind = Math.abs(angleDiff(e.angle, angleTo(e.x, e.y, p.x, p.y))) > 1.75;
      const loud = Math.hypot(p.vx || 0, p.vy || 0) > 150 && p.dodgeT <= 0; // sprinting footsteps
      const base = (isNight() && !lit ? 140 : 240) * wx.notice * (behind ? 0.4 : 1) * d.noticeMult;
      // Suspicion builds before they're sure: fast up close, slowly at the edge of their sight.
      if (canSee && pd < base) e.sus = (e.sus || 0) + dt * (behind ? 2.2 : 4.5);
      else if (canSee && pd < base * 1.9) e.sus = (e.sus || 0) + dt * 0.75;
      else e.sus = Math.max(0, (e.sus || 0) - dt * 0.3);
      if (e.sus >= 1) alertEnemy(e);
      else if (pd < (behind ? (loud ? 90 : 22) : 50)) alertEnemy(e);
      else if (loud && pd < 100) alertEnemy(e);
      else if (e.sus > 0.35 && canSee && !e.guard) {
        // Something's there: stop and stare.
        const want = angleTo(e.x, e.y, p.x, p.y);
        e.angle += angleDiff(e.angle, want) * Math.min(1, dt * 4);
        e.staring = 0.3;
      }
      // Endless Siege: searching attackers eventually start hunting (no stalemates).
      if (!huntMode()) {
        e.searchT = (e.searchT || 0) + dt;
        if (e.searchT > 22 && !e.dead && !e.guard) alertEnemy(e);
      }
    } else if (e.alerted && huntMode() && !e.guard) {
      // Lose you: they go to where you were, look around, and go back to searching.
      if (canSee) { e.lastSeen = { x: p.x, y: p.y }; e.lostT = 0; G.siege.lastSpot = nowMin(); }
      else {
        e.lostT = (e.lostT || 0) + dt;
        const there = e.lastSeen && dist(e.x, e.y, e.lastSeen.x, e.lastSeen.y) < 40;
        const fast = hasSkill('vanish') ? 0.5 : 1; // Vanish: they give up on you twice as fast
        if (e.lostT > 16 * fast || (there && e.lostT > 4 * fast)) {
          e.alerted = false; e.searching = true; e.cover = null; e.path = null; e.aimT = 0;
          e.searchGoal = null; e.searchGoalT = 0;
        }
      }
    }
    if (e.searchGoalT) e.searchGoalT -= dt;
    if (e.investigate) { e.investigate.t -= dt; if (e.investigate.t <= 0 || e.alerted) { e.investigate = null; e.path = null; } }
    if (e.alertPop > 0) e.alertPop -= dt;
    e.viaWindow = canSee && (e.alerted || e.sus > 0.1) ? m.throughWindow(e.x, e.y, p.x, p.y) : false;
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
    if (e.staring > 0) { e.staring -= dt; if (!e.alerted) continue; }
    if (!e.alerted) {
      if (e.guard) { if (!updateGuard(e, dt)) followPath(e, dt, e.def.speed * 0.45); continue; }
      const searching = huntMode() && G.siege.homeCleared;
      if (!followPath(e, dt, e.def.speed * (searching ? 0.55 : 0.8)) && searching) {
        // Reached a spot: look around before moving on.
        if (Math.random() < dt * 1.2) e.angle += (Math.random() - 0.5) * 2.2;
        e.searchGoalT = Math.min(e.searchGoalT || 0, 1.2);
      }
      continue;
    }

    // --- Alerted behaviours ---
    const [minD, maxD] = e.def.preferDist;
    if (e.type === 'enforcer' || e.def.melee) {
      if (pd < e.def.range + p.radius + e.radius && canSee) {
        if (e.fireCd <= 0) startAim(e, p);
        e.angle = angleTo(e.x, e.y, p.x, p.y);
      } else if (canSee && pd < 140) {
        const a = angleTo(e.x, e.y, p.x, p.y);
        m.moveCircle(e, Math.cos(a) * e.def.speed * 1.1 * dt, Math.sin(a) * e.def.speed * 1.1 * dt, 'enemy');
        e.angle = a; e.walkPhase += dt * 9;
      } else followPath(e, dt, e.def.speed);
    } else {
      if ((e.type === 'gunman' || e.type === 'sniper') && (e.coverT <= 0 || (e.cover && !m.los(e.cover.x, e.cover.y, p.x, p.y)))) {
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

/** Misdirection: a thrown stone. Attackers who haven't spotted you go to look. Returns how many turned. */
export function distract(x, y) {
  let n = 0;
  for (const e of G.enemies) {
    if (e.dead || e.gone || e.alerted || e.def.vehicle || e.retreating) continue;
    if (dist(e.x, e.y, x, y) > 280) continue;
    e.investigate = { x, y, t: 9 };
    e.path = null; e.sus = Math.max(0, (e.sus || 0) - 0.3);
    e.angle = angleTo(e.x, e.y, x, y);
    n++;
  }
  return n;
}

/** Vanish: a dodge roll out of everyone's sight breaks contact on the spot. */
export function breakContact() {
  if (!huntMode()) return 0;
  let n = 0;
  for (const e of G.enemies) {
    if (e.dead || e.gone || !e.alerted || e.canSee || e.def.boss) continue;
    e.alerted = false; e.searching = true; e.cover = null; e.path = null; e.aimT = 0; e.searchGoal = null; e.searchGoalT = 0;
    n++;
  }
  return n;
}
