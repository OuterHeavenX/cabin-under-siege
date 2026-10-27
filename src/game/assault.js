// The finale: Frank takes the fight to Leo Vescari's mansion. Guards stand
// their posts and walk short patrols until someone raises the alarm; the
// friends Frank made along the way each change the night (an open gate,
// fewer guards, a marked map, no reinforcements, a second chance). Dante
// Ruggiero carries the key to Leo's study.
import { G } from './state.js';
import { TILE } from '../config.js';
import { SO } from '../world/map.js';
import { spawnEnemy } from './enemies.js';
import { count } from './inventory.js';
import { banner, toast, centerMessage } from '../ui/hud.js';
import { sfx, setMusic } from '../audio.js';
import { derived } from './progression.js';
import { playCutscene } from '../ui/cutscene.js';

/** Who's helping tonight (decided when you call in favors). */
export const allies = () => (G.s.allies || []);
export const hasAlly = (id) => allies().includes(id);

const POSTS = [
  ['gunman', 'g_gate1', 'g_gate2'], ['scout', 'g_gate2', 'g_gate1'], ['gunman', 'g_drive', 'g_terrace'],
  ['handler', 'g_west1', 'g_west2'], ['gunman', 'g_east1', 'g_east2'], ['sniper', 'g_south1', 'g_south2'],
  ['enforcer', 'g_pool', null, 'walt'], ['scout', 'g_garage', 'g_east1', 'walt'],
  ['gunman', 'g_hall1', 'g_hall2'], ['enforcer', 'g_kitchen', null], ['scout', 'g_dining', 'g_hall1'],
  ['gunman', 'g_wingw', null], ['gunman', 'g_winge', null],
];

export function startAssault() {
  const m = G.map;
  if (m.id !== 'mansion' || G.assault) return;
  G.assault = { t: 0, alarm: false, reinfT: -1, reinforced: false, ruthRevive: hasAlly('ruth'), marked: hasAlly('marcus') ? 90 : 0 };
  // Ingrid's truck through the front gate.
  if (hasAlly('ingrid')) {
    for (const [cx, cy] of m.gateCells) { m.setSolid(cx, cy, SO.NONE); m.stone.delete(m.idx(cx, cy)); }
    m.gateRammed = true;
    const gd = m.decor.find((d) => d.kind === 'irongate'); if (gd) gd.rammed = true;
  }
  for (const [type, a, b, removedBy] of POSTS) {
    if (removedBy && hasAlly(removedBy)) continue;
    const pa = m.points[a], pb = b ? m.points[b] : null;
    const e = spawnEnemy(type, pa.x, pa.y, { hpMult: 1.15 });
    e.guard = { pts: pb ? [pa, pb] : [pa], i: 0, wait: Math.random() * 3 };
    e.angle = Math.random() * Math.PI * 2;
    // A handler's dogs sit at his post with him.
    for (const d of G.enemies) if (!d.guard && d !== e) d.guard = { pts: e.guard.pts, i: 0, wait: e.guard.wait };
  }
  const d = m.points.dante;
  const boss = spawnEnemy('lieutenant', d.x, d.y, { name: 'Dante Ruggiero', hpMult: 1.4, carriesNote: 'study_key' });
  boss.guard = { pts: [d], i: 0, wait: 0 };
  setMusic('night');
  const notes = [];
  if (hasAlly('ingrid')) notes.push('Ingrid\'s truck took the front gate off its hinges');
  if (hasAlly('walt')) notes.push('Walt\'s flares drew the pool guards down to the water');
  if (hasAlly('marcus')) notes.push('Marcus is reading you their radio chatter — every guard is marked');
  if (hasAlly('mickey')) notes.push('Mickey\'s tow trucks are blocking the road: no reinforcements');
  if (hasAlly('ruth')) notes.push('Ruth is waiting in the car with her bag');
  playCutscene({ focus: { x: 35 * TILE, y: 27 * TILE }, zoom: 0.75, title: 'THE VESCARI HOUSE', sub: notes.length ? notes.join(' · ') : 'Alone, then. Quiet as you can.', hold: 2.6 });
}

export function endAssault() {
  G.assault = null;
}

/** Guards walk their posts until the alarm. Called by the enemy AI. */
export function guardGoal(e) {
  const g = e.guard;
  return g.pts[g.i];
}

export function updateGuard(e, dt) {
  const g = e.guard;
  const pt = g.pts[g.i];
  const d = Math.hypot(e.x - pt.x, e.y - pt.y);
  if (d < 10) {
    g.wait -= dt;
    if (g.wait <= 0 && g.pts.length > 1) { g.i = (g.i + 1) % g.pts.length; g.wait = 2 + Math.random() * 3; e.path = null; }
    if (Math.random() < dt * 0.4) e.angle += (Math.random() - 0.5) * 1.5; // look around
    return true; // standing still
  }
  return false;
}

export function updateAssault(dt) {
  const A = G.assault;
  if (!A || G.map.id !== 'mansion') return;
  A.t += dt;
  if (A.marked > 0) { A.marked -= dt; for (const e of G.enemies) if (!e.dead) e.spotted = Math.max(e.spotted, 0.3); }
  if (!A.alarm && G.enemies.some((e) => !e.dead && !e.gone && e.alerted)) {
    A.alarm = true;
    sfx('alarm');
    setMusic('tense');
    centerMessage('ALARM', hasAlly('mickey') ? 'The whole house is awake — but nobody is coming up the road' : 'The whole house is awake. More are coming.', 2.6);
    if (!hasAlly('mickey')) A.reinfT = 35;
  }
  if (A.reinfT > 0) {
    A.reinfT -= dt;
    if (A.reinfT <= 0 && !A.reinforced) {
      A.reinforced = true;
      const sp = G.map.spawns.north;
      for (const t of ['gunman', 'gunman', 'enforcer']) { const e = spawnEnemy(t, sp.x + (Math.random() - 0.5) * 60, sp.y + 30, { hpMult: 1.1 }); e.alerted = true; }
      banner('Headlights on the drive — reinforcements!', 'danger', 4);
    }
  }
}

/** Ruth waits in the car: one second chance during the assault. */
export function assaultRevive() {
  const A = G.assault;
  if (!A || !A.ruthRevive) return false;
  A.ruthRevive = false;
  const p = G.player;
  p.hp = Math.round(derived().maxHp * 0.5); p.invuln = 2.5; p.dead = false;
  sfx('heal');
  banner('Ruth runs in from the car and drags you behind a wall. "Not tonight, Frank." (once)', 'good', 4);
  return true;
}

/** The study door opens with Dante's key. */
export function tryStudyDoor(b) {
  if (!b.rec.locked) return false;
  if (count('study_key') > 0) { b.rec.locked = false; b.rec.open = true; sfx('door'); toast('Dante\'s brass key turns. The study door swings open.', 'info', 3); return true; }
  toast('Locked. Dante Ruggiero keeps the key to Leo\'s study.', 'warn', 3);
  return true;
}
