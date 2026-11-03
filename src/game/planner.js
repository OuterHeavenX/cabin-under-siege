// The Defense Plan: your property from above. Every door and window is
// coloured by how much it can still take, the roads they come in by are
// marked, and so are your cover, traps and Ruth's post. Between attacks you
// can place cover and traps on any open cell from here (they're in your
// pack, so you're the one setting them out), pick them back up, and mark a
// fallback point Ruth and Duke can be ordered back to.
import { G } from './state.js';
import { TILE } from '../config.js';
import { GR, SO } from '../world/map.js';
import { homeMap, atHome } from './chapters.js';
import { openingStrength } from './enemies.js';
import { COVER_HP } from '../world/blockers.js';
import { count } from './inventory.js';
import { placeCoverAt, placeTrapAt, coverBlocked, trapBlocked, trapAt, pickUpTrap, pickUpCover, MAX_COVERS, MAX_TRAPS } from './home.js';
import { inCombat } from './player.js';
import { toast } from '../ui/hud.js';
import { saveGame } from './save.js';
import { ITEMS } from '../data/items.js';

/** Tools you can use on the plan. Cover types come from what's in your pack. */
export function planTools() {
  const out = Object.keys(COVER_HP).map((id) => ({ id, label: `${ITEMS[id] ? ITEMS[id].name : id} (${count(id)})`, n: count(id) }));
  out.push({ id: 'bear_trap', label: `Bear trap (${count('bear_trap')})`, n: count('bear_trap') });
  out.push({ id: 'fallback', label: 'Fallback point', n: 1 });
  out.push({ id: 'remove', label: 'Pick up', n: 1 });
  return out;
}
export const canEditPlan = () => atHome() && !G.siegeActive && !inCombat() && !G.endless;
export { fallbackPoint } from './orders.js';

/** Use a tool on a cell. Returns a short result for the UI. */
export function applyTool(tool, cx, cy) {
  if (!canEditPlan()) { toast(G.siegeActive ? 'Not during an attack — you can look, but not build.' : 'You can only set things out when you\'re home.', 'warn'); return false; }
  const m = homeMap();
  if (!m.inBounds(cx, cy)) return false;
  if (tool === 'fallback') {
    if (m.getSolid(cx, cy) !== SO.NONE && m.getSolid(cx, cy) !== SO.FURN) { toast('Pick an open spot for the fallback point.', 'warn'); return false; }
    G.s.home.fallback = [cx, cy]; saveGame('install');
    toast('Fallback point marked. Order Ruth or Duke to fall back to it during an attack.', 'info', 3);
    return true;
  }
  if (tool === 'remove') {
    const t = trapAt(cx, cy);
    if (t) { pickUpTrap(t); saveGame('install'); return true; }
    const b = m.blockerAt(cx, cy);
    if (b && b.kind === 'cover') { pickUpCover(b); return true; }
    if (G.s.home.fallback && G.s.home.fallback[0] === cx && G.s.home.fallback[1] === cy) { G.s.home.fallback = null; saveGame('install'); return true; }
    return false;
  }
  if (tool === 'bear_trap') return placeTrapAt(cx, cy);
  if (COVER_HP[tool]) return placeCoverAt(tool, cx, cy);
  return false;
}
export const toolBlocked = (tool, cx, cy) => (tool === 'bear_trap' ? trapBlocked(cx, cy) : COVER_HP[tool] ? coverBlocked(tool, cx, cy) : null);

/* ---------------- drawing ---------------- */
const GROUND = { [GR.GRASS]: '#3f6a31', [GR.DIRT]: '#7a5c3a', [GR.ROAD]: '#3b3c40', [GR.FLOOR]: '#8a6a48', [GR.PORCH]: '#a3825a', [GR.WATER]: '#2d5e7e', [GR.GRAVEL]: '#77736b', [GR.SIDEWALK]: '#8e8d86', [GR.GARDEN]: '#5d4430', [GR.TILEFLOOR]: '#b8af99' };

/** Draw the plan into a canvas at `s` pixels per cell, with an optional cursor cell. */
export function drawPlan(cv, s, cursor = null, tool = null) {
  const m = homeMap();
  if (!m) return;
  cv.width = m.w * s; cv.height = m.h * s;
  const g = cv.getContext('2d');
  for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
    const i = m.idx(cx, cy), so = m.solid[i];
    g.fillStyle = so === SO.WALL ? '#1b1b1f' : so === SO.ROCK ? '#6a6a6a' : so === SO.FENCE ? '#5a4632' : so === SO.TREE ? '#1f3a1c' : so === SO.CAR ? '#7a2a2a' : so === SO.FURN || so === SO.COUNTER ? '#5a4a3a' : GROUND[m.ground[i]] || '#3f6a31';
    g.fillRect(cx * s, cy * s, s, s);
  }
  for (const t of m.trees.values()) if (!t.chopped) { g.fillStyle = '#16301a'; g.beginPath(); g.arc(t.cx * s + s / 2, t.cy * s + s / 2, s * 0.45, 0, Math.PI * 2); g.fill(); }
  // Doors and windows by strength.
  for (const b of m.blockers.values()) {
    if (b.kind === 'cover') { g.fillStyle = '#c8a46a'; g.fillRect(b.cx * s + 1, b.cy * s + 1, s - 2, s - 2); g.strokeStyle = '#000'; g.strokeRect(b.cx * s + 1.5, b.cy * s + 1.5, s - 3, s - 3); continue; }
    if (b.rec && b.rec.npc) continue;
    const st = openingStrength(b), max = b.kind === 'door' ? (b.maxHp || 100) : 140;
    const f = Math.max(0, Math.min(1, st / max));
    g.fillStyle = f < 0.3 ? '#e0402f' : f < 0.65 ? '#e8b030' : '#5bc06a';
    g.fillRect(b.cx * s, b.cy * s, s, s);
    g.fillStyle = '#000'; g.font = `bold ${Math.max(8, s - 3)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(b.kind === 'door' ? 'D' : 'W', b.cx * s + s / 2, b.cy * s + s / 2 + 1);
  }
  // Traps.
  for (const t of G.s.home.traps || []) { g.strokeStyle = t.armed ? '#ff5a4a' : '#888'; g.lineWidth = 2; g.beginPath(); g.arc(t.cx * s + s / 2, t.cy * s + s / 2, s * 0.38, 0, Math.PI * 2); g.stroke(); }
  // Where they come from.
  g.font = `bold ${Math.max(9, s)}px system-ui`;
  for (const sp of Object.values(m.spawns || {})) {
    const x = sp.x / TILE * s, y = sp.y / TILE * s;
    g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(x, y, s * 0.7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', x, y + 1);
  }
  // Ruth's post, the fallback point, you.
  const hi = m.homeInfo;
  if (hi && hi.allyPost) { g.fillStyle = '#6db3ff'; g.beginPath(); g.arc(hi.allyPost.x / TILE * s, hi.allyPost.y / TILE * s, s * 0.45, 0, Math.PI * 2); g.fill(); }
  const fb = G.s.home.fallback;
  if (fb) { g.fillStyle = '#ffd166'; g.beginPath(); g.moveTo(fb[0] * s + s * 0.2, fb[1] * s + s); g.lineTo(fb[0] * s + s * 0.2, fb[1] * s); g.lineTo(fb[0] * s + s, fb[1] * s + s * 0.3); g.lineTo(fb[0] * s + s * 0.2, fb[1] * s + s * 0.6); g.fill(); }
  if (G.player && G.map === m) { g.fillStyle = '#fff'; g.beginPath(); g.arc(G.player.x / TILE * s, G.player.y / TILE * s, s * 0.45, 0, Math.PI * 2); g.fill(); }
  if (cursor) {
    const bad = tool && tool !== 'remove' && tool !== 'fallback' ? toolBlocked(tool, cursor[0], cursor[1]) : null;
    g.strokeStyle = bad ? '#ff5a4a' : '#ffffff'; g.lineWidth = 2;
    g.strokeRect(cursor[0] * s + 1, cursor[1] * s + 1, s - 2, s - 2);
  }
}

/** The area worth showing: the house and the yard around it. */
export function planView() {
  const m = homeMap();
  return { w: m.w, h: m.h, covers: `${G.s.home.covers.length}/${MAX_COVERS}`, traps: `${(G.s.home.traps || []).length}/${MAX_TRAPS}` };
}
