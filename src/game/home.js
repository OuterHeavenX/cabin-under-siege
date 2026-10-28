// Cabin defenses: repairs, reinforcements, placeable cover, upgrades, crafting.
import { G, hasSkill } from './state.js';
import { adoptDog } from './dog.js';
import { TILE } from '../config.js';
import { Cover, COVER_HP, GLASS_HP, defenseMult } from '../world/blockers.js';
import { ITEMS, RECIPES } from '../data/items.js';
import { addItem, count, removeItem } from './inventory.js';
import { addJP, derived } from './progression.js';
import { toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { inCombat } from './player.js';
import { saveGame } from './save.js';
import { dist } from '../util.js';
import { homeMap, atHome } from './chapters.js';
import { hasPerk } from './perks.js';
import { projectDone } from './projects.js';
import { damageEnemy } from './combat.js';

export const MAX_COVERS = 4;

const effWood = (n) => Math.max(1, n - (hasSkill('efficient_repairs') ? 1 : 0) - (hasPerk('mill_hand') ? 1 : 0));

/** Rebuild placed-cover blockers on the home map from the save. */
export function syncCovers() {
  const m = homeMap();
  if (!m) return;
  for (const [k, b] of [...m.blockers]) if (b.kind === 'cover') m.blockers.delete(k);
  for (const rec of G.s.home.covers) {
    if (rec.hp > 0) m.blockers.set(m.idx(rec.cx, rec.cy), new Cover(rec));
  }
}

export function initHomeEvents() {
  G.events.on('cover_destroyed', (c) => {
    G.s.home.covers = G.s.home.covers.filter((r) => r !== c.rec);
    syncCovers();
    sfx('wood');
    toast('Your cover was destroyed!', 'warn', 2);
  });
  G.events.on('door_broken', (d) => { if (!d.rec.npc) { sfx('doorBreak', { x: d.cx * 32 + 16, y: d.cy * 32 + 16 }); toast(`${d.label} has been broken down!`, 'danger', 3); } });
  G.events.on('boards_broken', (w) => { if (!w.rec.npc) toast(`Boards on the ${w.label} are gone!`, 'danger', 2.5); });
  G.events.on('glass_break', (w) => { sfx('glass', { x: w.cx * 32 + 16, y: w.cy * 32 + 16 }); });
}

/** Repair needs for a door/window: {cost, label} or null if nothing to fix. */
export function repairNeed(b) {
  if (b.kind === 'door') {
    const frac = b.rec.hp / b.maxHp;
    if (frac >= 0.999) return null;
    return { cost: effWood(Math.ceil((1 - frac) * 3)), label: `Repair ${b.label} (${Math.round(frac * 100)}%)` };
  }
  if (b.kind === 'window') {
    let n = 0;
    if (b.rec.glass < GLASS_HP) n++;
    if (b.rec.boards && b.rec.boardHp < b.boardMax) n++;
    if (b.rec.shutters && b.rec.shutterHp < b.shutterMax) n++;
    if (!n) return null;
    return { cost: effWood(n), label: `Repair ${b.label} (${Math.round(b.condition * 100)}%)` };
  }
  return null;
}

export function homeBlockers() {
  const m = homeMap();
  return [...m.blockers.values()].filter((b) => (b.kind === 'door' || b.kind === 'window') && !b.rec.npc);
}

export function startRepair(target, kind) {
  if (inCombat()) { toast('Too dangerous to repair right now!', 'danger'); return; }
  let cost = 0;
  if (kind === 'phone') {
    if (count('toolkit') < 1) { toast('You need a Toolkit to fix the phone line.', 'warn'); return; }
    cost = 1;
  } else {
    const need = repairNeed(target);
    if (!need) return;
    cost = need.cost;
  }
  if (count('wood') < cost) { toast(`Need ${cost} wood (you have ${count('wood')}). Chop trees or buy wood at Okafor Lumber.`, 'warn', 3); return; }
  const time = 2.4 / derived().repairSpeed;
  G.repairHold = { target, kind, t: 0, time, cost, x: G.player.x, y: G.player.y };
}

export function updateRepair(dt) {
  const r = G.repairHold;
  if (!r) return;
  const p = G.player;
  if (dist(p.x, p.y, r.x, r.y) > 6 || inCombat()) { G.repairHold = null; toast('Repair interrupted.', 'warn', 1.2); return; }
  r.t += dt;
  if (Math.floor(r.t * 3) !== Math.floor((r.t - dt) * 3)) sfx('hammer');
  if (r.t < r.time) return;
  G.repairHold = null;
  removeItem('wood', r.cost);
  if (r.kind === 'phone') {
    G.s.home.phoneLine = true;
    if (G.s.world.signs.phone_line) G.s.world.signs.phone_line.done = true;
    toast('Phone line spliced back together. Ruth can reach you again.', 'info', 3);
    addJP('handyman', 8, 'phone', 2);
  } else {
    const b = r.target;
    if (b.kind === 'door') { b.rec.hp = b.maxHp; b.rec.open = false; }
    else { b.rec.glass = GLASS_HP; if (b.rec.boards) b.rec.boardHp = b.boardMax; if (b.rec.shutters) b.rec.shutterHp = b.shutterMax; }
    toast(`${b.label} repaired.`, 'info', 2);
    addJP('handyman', 3, 'repair', 8);
  }
  sfx('chime');
  G.events.emit('repaired', r.target);
  saveGame('repair');
}

export function installBoards(w) {
  if (w.rec.boards) { toast('Already boarded.', 'warn'); return; }
  if (!removeItem('board_kit', 1)) { toast('You need a Window Board Kit (store or workbench).', 'warn'); return; }
  w.rec.boards = true;
  w.rec.boardHp = w.boardMax;
  sfx('hammer'); sfx('wood');
  toast(`${w.label} boarded up.`, 'info');
  addJP('handyman', 6, 'install', 6);
  G.events.emit('defenseInstalled', 'boards');
  saveGame('install');
}

export function installShutters(w) {
  if (w.rec.shutters) { toast('Already shuttered.', 'warn'); return; }
  if (!removeItem('shutter_kit', 1)) { toast('You need a Steel Shutter Kit.', 'warn'); return; }
  w.rec.shutters = true;
  w.rec.shutterHp = w.shutterMax;
  sfx('hammer'); sfx('door');
  toast(`${w.label}: steel shutters bolted on.`, 'info');
  addJP('handyman', 7, 'install', 6);
  G.events.emit('defenseInstalled', 'shutters');
  saveGame('install');
}

/* ---------------- bear traps ---------------- */
export const MAX_TRAPS = 6;

function placeTrap() {
  const traps = G.s.home.traps || (G.s.home.traps = []);
  if (traps.length >= MAX_TRAPS) { toast(`Trap limit reached (${MAX_TRAPS}).`, 'warn'); return false; }
  if (count('bear_trap') < 1) return false;
  const p = G.player;
  const m = G.map;
  const cx = Math.floor((p.x + Math.cos(p.angle) * 30) / TILE), cy = Math.floor((p.y + Math.sin(p.angle) * 30) / TILE);
  if (!m.inBounds(cx, cy) || m.blocksMove(cx, cy, 'enemy') || m.blockerAt(cx, cy) || traps.some((t) => t.cx === cx && t.cy === cy) || m.buildingAt(cx * TILE + 16, cy * TILE + 16)) {
    toast('Can\'t set a trap there. Face open ground outside.', 'warn'); return false;
  }
  removeItem('bear_trap', 1);
  traps.push({ cx, cy, armed: true });
  sfx('trap');
  toast('Bear trap set. Attackers who step on it get pinned.', 'info', 2.5);
  addJP('handyman', 3, 'install', 6);
  G.events.emit('defenseInstalled', 'trap');
  saveGame('install');
  return true;
}

/** Called for each attacker every frame: spring armed traps they step on. */
export function checkTrap(e) {
  if (!atHome() || !G.s.home.traps) return;
  const cx = Math.floor(e.x / TILE), cy = Math.floor(e.y / TILE);
  for (const t of G.s.home.traps) {
    if (!t.armed || t.cx !== cx || t.cy !== cy) continue;
    t.armed = false;
    e.stun = Math.max(e.stun, 2.6);
    e.trapped = 2.6;
    damageEnemy(e, 45, 0, 'trap', 0);
    sfx('trap');
    G.events.emit('trapSprung', e);
    addJP('handyman', 2, 'trapjp', 6);
  }
}

export function trapAt(cx, cy) { return (G.s.home.traps || []).find((t) => t.cx === cx && t.cy === cy) || null; }

export function rearmTrap(t) { t.armed = true; sfx('trap'); toast('Trap re-armed.', 'info', 1.2); }
export function pickUpTrap(t) {
  if (inCombat()) { toast('Not during a fight!', 'warn'); return; }
  G.s.home.traps = G.s.home.traps.filter((x) => x !== t);
  addItem('bear_trap', 1);
}

export function installBrace(d) {
  if (d.rec.reinforced) { toast('Already reinforced.', 'warn'); return; }
  if (!removeItem('door_brace', 1)) { toast('You need a Door Brace Kit (Okafor Lumber).', 'warn'); return; }
  const before = d.maxHp;
  d.rec.reinforced = true;
  d.rec.hp += d.maxHp - before;
  sfx('hammer'); sfx('door');
  toast(`${d.label} reinforced. (${d.maxHp} HP)`, 'info');
  addJP('handyman', 8, 'install', 6);
  G.events.emit('defenseInstalled', 'brace');
  saveGame('install');
}

/** Install a permanent upgrade item (floodlight, alarm, extended magazine). */
export function installUpgrade(id) {
  const def = ITEMS[id];
  if (!def || !def.install) return false;
  if (def.install === 'dog') { if (!adoptDog()) return false; removeItem(id, 1); saveGame('install'); return true; }
  const gunMod = ['extMag', 'scope', 'choke', 'suppressor'].includes(def.install);
  if (!gunMod && !atHome()) { toast('Install this at home.', 'warn'); return false; }
  const mods = G.s.weaponMods || (G.s.weaponMods = {});
  const has = gunMod ? mods[def.install] || (def.install === 'extMag' && G.s.home.upgrades.extMag) : G.s.home.upgrades[def.install];
  if (has) { toast('Already installed.', 'warn'); return false; }
  const needs = { scope: 'rifle', choke: 'shotgun' }[def.install];
  if (needs && count(needs) < 1) { toast(`You need the ${needs} first.`, 'warn'); return false; }
  if (!removeItem(id, 1)) return false;
  if (gunMod) mods[def.install] = true; else G.s.home.upgrades[def.install] = true;
  sfx('hammer'); sfx('chime');
  const msg = { camera: 'Cameras mounted on every corner. Nobody sneaks up on you now.', floodlight: 'Floodlight mounted over the porch.', alarm: 'Tripwires strung through the treeline. You\'ll hear them coming.', extMag: 'Extended magazine fitted: 12 rounds.', safeRoom: 'Steel plates bolted around the bedroom. When it gets bad, fall back to the bed.', scope: 'Scope mounted. The rifle reaches out and touches someone.', choke: 'Choke threaded on. Tighter pattern, longer reach.', suppressor: 'Suppressor fitted. Your handgun whispers now.' }[def.install];
  toast(msg, 'info', 3);
  if (!gunMod) { addJP('handyman', 8, 'install', 6); G.events.emit('defenseInstalled', def.install); }
  saveGame('install');
  return true;
}

export function placeCover(type) {
  if (!atHome()) { toast('You can only place this on your own property.', 'warn'); return false; }
  if (type === 'trap' || type === 'bear_trap') return placeTrap();
  if (G.s.home.covers.length >= MAX_COVERS) { toast(`Cover limit reached (${MAX_COVERS}). Pick one up first.`, 'warn'); return false; }
  if (count(type) < 1) return false;
  const p = G.player;
  const m = G.map;
  const tx = p.x + Math.cos(p.angle) * 30, ty = p.y + Math.sin(p.angle) * 30;
  const cx = Math.floor(tx / TILE), cy = Math.floor(ty / TILE);
  const pcx = Math.floor(p.x / TILE), pcy = Math.floor(p.y / TILE);
  if ((cx === pcx && cy === pcy) || !m.inBounds(cx, cy) || m.getSolid(cx, cy) !== 0 || m.blockerAt(cx, cy) || m.trees.has(m.idx(cx, cy))) {
    toast('Can\'t place cover there. Face an open spot.', 'warn'); return false;
  }
  // Keep it out of doorways so you can't wall yourself in.
  for (const b of homeBlockers()) if (b.kind === 'door' && Math.abs(b.cx - cx) + Math.abs(b.cy - cy) <= 1) { toast('Don\'t block the doorway.', 'warn'); return false; }
  const rec = { type, cx, cy, hp: Math.round(COVER_HP[type] * defenseMult()) };
  removeItem(type, 1);
  G.s.home.covers.push(rec);
  syncCovers();
  // Nudge the player out if overlapping
  m.pushOut(p, p.radius, 'player');
  sfx('wood');
  toast(`${ITEMS[type].name} placed. Bullets can't get through.`, 'info', 2);
  addJP('handyman', 4, 'install', 6);
  G.events.emit('defenseInstalled', 'cover');
  saveGame('install');
  return true;
}

export function pickUpCover(cover) {
  if (inCombat()) { toast('Not during a fight!', 'warn'); return; }
  const rec = cover.rec;
  G.s.home.covers = G.s.home.covers.filter((r) => r !== rec);
  syncCovers();
  if (rec.hp >= cover.maxHp * 0.5) { addItem(rec.type, 1); }
  else { addItem('wood', 1); toast('Too damaged to reuse — salvaged 1 wood.', 'info'); }
  sfx('wood');
  saveGame('cover');
}

export function recipeCost(r) { return effWood(r.wood - (projectDone('workshop') ? 1 : 0)); }

export function craft(id) {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) return false;
  const cost = recipeCost(r);
  if (count('wood') < cost) { toast(`Need ${cost} wood.`, 'warn'); return false; }
  if (count(id) >= ITEMS[id].cap) { toast('You can\'t carry more.', 'warn'); return false; }
  removeItem('wood', cost);
  addItem(id, 1);
  sfx('hammer');
  addJP('handyman', 3, 'craft', 5);
  return true;
}

/** Human-readable status of every cabin defense, for the Home tab. */
export function homeStatus() {
  const rows = [];
  for (const b of homeBlockers()) {
    const need = repairNeed(b);
    let status;
    if (b.kind === 'door') status = b.rec.hp <= 0 ? 'BROKEN' : b.condition < 0.5 ? 'Damaged' : b.condition < 1 ? 'Scuffed' : 'Solid';
    else status = b.broken ? 'BROKEN' : b.rec.glass <= 0 ? 'Glass smashed' : b.condition < 1 ? 'Damaged' : 'Intact';
    const extras = [];
    if (b.kind === 'door' && b.rec.reinforced) extras.push('Braced');
    if (b.kind === 'window' && b.rec.boards) extras.push('Boarded');
    if (b.kind === 'window' && b.rec.shutters) extras.push('Shutters');
    rows.push({ label: b.label, kind: b.kind, cond: b.condition, status, extras, repair: need ? need.cost : 0 });
  }
  return rows;
}

/** Standing in the steel-plated bedroom during an attack. */
export function inSafeRoom() {
  if (!G.siegeActive || !G.s.home.upgrades.safeRoom || !atHome() || !G.player) return false;
  const bed = G.map.props.find((p) => p.id === 'bed');
  return !!bed && Math.hypot(G.player.x - bed.x, G.player.y - bed.y) < 52;
}
