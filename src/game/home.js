// Cabin defenses: repairs, reinforcements, placeable cover, upgrades, crafting.
import { G, hasSkill } from './state.js';
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

export const MAX_COVERS = 4;

const effWood = (n) => Math.max(1, n - (hasSkill('efficient_repairs') ? 1 : 0));

/** Rebuild placed-cover blockers on the cabin map from the save. */
export function syncCovers() {
  const m = G.maps.cabin;
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
  G.events.on('door_broken', (d) => { if (!d.rec.npc) { sfx('doorBreak'); toast(`${d.label} has been broken down!`, 'danger', 3); } });
  G.events.on('boards_broken', (w) => { if (!w.rec.npc) toast(`Boards on the ${w.label} are gone!`, 'danger', 2.5); });
  G.events.on('glass_break', (w) => { sfx('glass', { vol: 0.8 }); });
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
    if (!n) return null;
    return { cost: effWood(n), label: `Repair ${b.label} (${Math.round(b.condition * 100)}%)` };
  }
  return null;
}

export function homeBlockers() {
  const m = G.maps.cabin;
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
    else { b.rec.glass = GLASS_HP; if (b.rec.boards) b.rec.boardHp = b.boardMax; }
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
  if (def.install !== 'extMag' && G.map.id !== 'cabin') { toast('Install this at your cabin.', 'warn'); return false; }
  if (G.s.home.upgrades[def.install]) { toast('Already installed.', 'warn'); return false; }
  if (!removeItem(id, 1)) return false;
  G.s.home.upgrades[def.install] = true;
  sfx('hammer'); sfx('chime');
  const msg = { floodlight: 'Floodlight mounted over the porch.', alarm: 'Tripwires strung through the treeline. You\'ll hear them coming.', extMag: 'Extended magazine fitted: 12 rounds.' }[def.install];
  toast(msg, 'info', 3);
  if (def.install !== 'extMag') { addJP('handyman', 8, 'install', 6); G.events.emit('defenseInstalled', def.install); }
  saveGame('install');
  return true;
}

export function placeCover(type) {
  if (G.map.id !== 'cabin') { toast('You can only place cover on your property.', 'warn'); return false; }
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

export function recipeCost(r) { return effWood(r.wood); }

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
    rows.push({ label: b.label, kind: b.kind, cond: b.condition, status, extras, repair: need ? need.cost : 0 });
  }
  return rows;
}
