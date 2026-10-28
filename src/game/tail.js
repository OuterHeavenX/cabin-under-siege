// Tailing: follow someone through town without being seen. Stay close enough
// not to lose them, far enough not to be noticed — and out of sight when they
// stop and look back. Used by storylines and the rat mystery.
import { G } from './state.js';
import { TILE } from '../config.js';
import { dist, angleTo, angleDiff } from '../util.js';
import { banner, centerMessage } from '../ui/hud.js';
import { sfx } from '../audio.js';

const SPEED = 52;

/** route: [[x, y, lookBackSeconds?], ...] in tiles. Calls onDone(true|false). */
export function startTail({ name, look, route, onDone }) {
  if (G.tail) return;
  const P = (pt) => ({ x: pt[0] * TILE, y: pt[1] * TILE, wait: pt[2] || 0 });
  const pts = route.map(P);
  const n = { id: 'tail_target', scripted: true, def: { name, ...look }, x: pts[0].x, y: pts[0].y, radius: 10, angle: 0, walkPhase: 0, present: true, path: null };
  G.npcs.push(n);
  G.tail = { n, pts, i: 1, sus: 0, lostT: 0, waitT: 0, grace: 4, name, onDone, done: false };
  sfx('blip');
  banner(`Follow ${name}. Don't get close — and stay out of sight when they look back.`, 'objective', 5);
}

function finish(ok, why) {
  const T = G.tail;
  if (!T || T.done) return;
  T.done = true;
  G.npcs = G.npcs.filter((x) => x !== T.n);
  G.tail = null;
  if (!ok) { sfx('miss'); centerMessage(why === 'seen' ? 'SPOTTED' : 'LOST THEM', why === 'seen' ? `${T.name} saw you. Try again another time.` : `You lost ${T.name}. Try again another time.`, 3); }
  T.onDone && T.onDone(ok);
}

export function cancelTail() { if (G.tail) finish(false, 'lost'); }

export function updateTail(dt) {
  const T = G.tail;
  if (!T) return;
  const n = T.n, p = G.player, m = G.map;
  // Walk the route; at some points they stop and look around.
  if (T.waitT > 0) {
    T.waitT -= dt;
    n.angle += angleDiff(n.angle, angleTo(n.x, n.y, p.x, p.y)) * Math.min(1, dt * 2.5);
  } else {
    const tgt = T.pts[T.i];
    const d = dist(n.x, n.y, tgt.x, tgt.y);
    if (d < 6) {
      T.waitT = tgt.wait;
      T.i++;
      if (T.i >= T.pts.length) { finish(true); return; }
    } else {
      const a = Math.atan2(tgt.y - n.y, tgt.x - n.x);
      m.moveCircle(n, Math.cos(a) * SPEED * dt, Math.sin(a) * SPEED * dt, 'npc');
      n.angle = a; n.walkPhase += dt * 8;
    }
  }
  // Are they onto you? (A few seconds' grace to drop back when it starts.)
  if (T.grace > 0) { T.grace -= dt; return; }
  const pd = dist(n.x, n.y, p.x, p.y);
  const looking = Math.abs(angleDiff(n.angle, angleTo(n.x, n.y, p.x, p.y))) < (T.waitT > 0 ? 1.3 : 0.7);
  const loud = Math.hypot(p.vx || 0, p.vy || 0) > 150;
  if (pd < 55 || (loud && pd < 120)) T.sus += dt * 3;
  else if (looking && pd < 230 && m.los(n.x, n.y, p.x, p.y)) T.sus += dt * (pd < 140 ? 1.6 : 0.8);
  else T.sus = Math.max(0, T.sus - dt * 0.25);
  n.sus = T.sus; // drawn as the "?" over their head
  if (T.sus >= 1) { finish(false, 'seen'); return; }
  T.lostT = pd > 360 || !m.los(n.x, n.y, p.x, p.y) && pd > 220 ? T.lostT + dt : 0;
  if (T.lostT > 7) finish(false, 'lost');
}

/** HUD line while tailing. */
export function tailStatus() {
  const T = G.tail;
  if (!T) return null;
  const pd = dist(T.n.x, T.n.y, G.player.x, G.player.y);
  if (T.sus > 0.5) return `TAILING ${T.name.toUpperCase()} — they're getting suspicious!`;
  if (pd < 90) return `TAILING ${T.name.toUpperCase()} — too close, back off`;
  if (T.lostT > 2) return `TAILING ${T.name.toUpperCase()} — you're losing them`;
  return `TAILING ${T.name.toUpperCase()} — keep your distance`;
}
