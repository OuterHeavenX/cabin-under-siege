// Orders for the people (and the dog) fighting beside Frank. During an
// attack, walk up to Ruth or Duke and press ACT — or press O — to choose:
//   Ruth: hold the front window (her usual post), cover the back door, or stay with you.
//   Duke: go after them (his usual), guard you, or hold the porch.
// Orders last until the attack ends.
import { G } from './state.js';
import { TILE } from '../config.js';
import { toast } from '../ui/hud.js';
import { sfx } from '../audio.js';

export const RUTH_ORDERS = {
  post: { label: 'Hold the front window', say: '"Front window. Got it."' },
  back: { label: 'Cover the back door', say: '"Back door. Nobody comes through my kitchen."' },
  follow: { label: 'Stay with me', say: '"Right behind you, Frank."' },
  fallback: { label: 'Fall back to the fallback point', say: '"Falling back!"', needsFallback: true },
};
export const DUKE_ORDERS = {
  hunt: { label: 'Go get \'em', say: 'Duke is off like a shot.' },
  guard: { label: 'Guard me', say: 'Duke plants himself at your heel, hackles up.' },
  yard: { label: 'Hold the porch', say: 'Duke trots to the porch and lies down facing the dark.' },
  fallback: { label: 'Fall back', say: 'Duke wheels and runs for the fallback point.', needsFallback: true },
};

/** The spot marked on the Defense Plan (Home → Defense Plan). */
export const fallbackPoint = () => (G.s && G.s.home && G.s.home.fallback ? { x: G.s.home.fallback[0] * TILE + 16, y: G.s.home.fallback[1] * TILE + 16 } : null);

const ord = () => G.orders || (G.orders = { ruth: 'post', duke: 'hunt' });
export const ruthOrder = () => ord().ruth;
export const dukeOrder = () => ord().duke;
export function resetOrders() { G.orders = { ruth: 'post', duke: 'hunt' }; }
export function giveOrder(who, what) {
  const o = ord();
  const table = who === 'ruth' ? RUTH_ORDERS : DUKE_ORDERS;
  if (!table[what]) return false;
  o[who] = what;
  sfx('ui');
  toast(who === 'ruth' ? `Ruth: ${table[what].say}` : table[what].say, 'good', 2.5);
  G.events.emit('order', who, what);
  return true;
}

const ruthHere = () => { const r = G.npcs.find((n) => n.id === 'ruth'); return r && r.ally && !r.downed ? r : null; };
const dukeHere = () => (G.dog && !G.dog.hurt ? G.dog : null);
/** Anyone to give orders to right now? */
export const canOrder = () => !!(G.siegeActive && (ruthHere() || dukeHere()));

/** The actions for the quick menu (openActions-style). */
export function orderOptions() {
  const out = [];
  if (ruthHere()) for (const [k, v] of Object.entries(RUTH_ORDERS)) if (!v.needsFallback || fallbackPoint()) out.push({ label: `Ruth: ${v.label}${ruthOrder() === k ? ' ✓' : ''}`, action: () => giveOrder('ruth', k) });
  if (dukeHere()) for (const [k, v] of Object.entries(DUKE_ORDERS)) if (!v.needsFallback || fallbackPoint()) out.push({ label: `Duke: ${v.label}${dukeOrder() === k ? ' ✓' : ''}`, action: () => giveOrder('duke', k) });
  return out;
}

/** Where Ruth stands for the "cover the back" order: just inside the back door. */
export function backPost(m) {
  const hi = m.homeInfo;
  const back = [...m.blockers.values()].find((b) => b.kind === 'door' && !b.rec.npc && /back/.test(b.id));
  if (!back || !hi || !hi.interior) return hi && hi.allyPost;
  const ix = hi.interior.cx * TILE + 16, iy = hi.interior.cy * TILE + 16, bx = back.cx * TILE + 16, by = back.cy * TILE + 16;
  const d = Math.hypot(ix - bx, iy - by) || 1;
  return { x: bx + ((ix - bx) / d) * TILE * 1.6, y: by + ((iy - by) / d) * TILE * 1.6 };
}
