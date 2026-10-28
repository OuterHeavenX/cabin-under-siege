// Active skills (Tier 2): one ability slot, fired with G / R3 / the on-screen
// button. Controlled Fire steadies your aim, Emergency Repair patches a door
// or window mid-fight, Misdirection tosses a stone to pull attackers away.
import { G, hasSkill } from './state.js';
import { TILE } from '../config.js';
import { SKILLS } from '../data/skills.js';
import { count, removeItem } from './inventory.js';
import { toast, banner } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { addFloater, spawnParticles } from './combat.js';
import { distract, breakContact } from './enemies.js';
import { homeBlockers } from './home.js';
import { atHome } from './chapters.js';
import { powerOut, restorePower } from './watch.js';
import { addJP } from './progression.js';

export const ACTIVE = () => Object.keys(SKILLS).filter((id) => SKILLS[id].active);
const cds = () => G.abilityCd || (G.abilityCd = {});

/** The ability in the slot: the one you picked in the Skills tab, else the first you own. */
export function currentAbility() {
  if (!G.s) return null;
  const own = ACTIVE().filter(hasSkill);
  if (!own.length) return null;
  return own.includes(G.s.ability) ? G.s.ability : own[0];
}
export function setAbility(id) { if (SKILLS[id] && SKILLS[id].active && hasSkill(id)) { G.s.ability = id; toast(`${SKILLS[id].name} is now your ability (G / R3 / ${SKILLS[id].short}).`, 'info', 3); } }
export const abilityReadyIn = (id) => Math.max(0, cds()[id] || 0);

export function updateAbilities(dt) {
  const c = cds();
  for (const k of Object.keys(c)) c[k] = Math.max(0, c[k] - dt);
  const p = G.player;
  if (p && p.steadyT > 0) p.steadyT -= dt;
}

/** HUD label for the ability button, or null if there's none. */
export function abilityLabel() {
  const id = currentAbility();
  if (!id) return null;
  const left = abilityReadyIn(id);
  return { id, short: SKILLS[id].short, left: Math.ceil(left), ready: left <= 0 };
}

export function useAbility() {
  const id = currentAbility();
  const p = G.player;
  if (!id || !p || p.dead) { if (!id) toast('No ability yet — Tier 2 skills (Skills tab) give you one.', 'info', 2.5); return false; }
  const left = abilityReadyIn(id);
  if (left > 0) { toast(`${SKILLS[id].name} is ready in ${Math.ceil(left)} s.`, 'warn', 1.5); return false; }
  const ok = { controlled_fire: steady, emergency_repair: patch, misdirection: toss }[id]();
  if (ok) { cds()[id] = SKILLS[id].cooldown; G.events.emit('ability', id); }
  return ok;
}

function steady() {
  const p = G.player;
  p.steadyT = 6;
  p.flinch = 0;
  sfx('reload');
  addFloater(p.x, p.y - 24, 'STEADY', '#8fd3ff');
  if (G.siegeActive) addJP('gunhand', 2, 'ability', 6);
  return true;
}

function patch() {
  const p = G.player;
  if (!atHome()) { toast('Emergency Repair works on your own home.', 'warn', 2); return false; }
  if (powerOut()) { restorePower(); return true; }
  if (count('wood') < 1) { toast('You need 1 wood to patch anything.', 'warn', 2); return false; }
  let best = null, bd = 80;
  for (const b of homeBlockers()) {
    const d = Math.hypot(b.cx * TILE + 16 - p.x, b.cy * TILE + 16 - p.y);
    if (d < bd && b.condition < 0.999) { bd = d; best = b; }
  }
  if (!best) { toast('Nothing damaged within reach. Stand next to a door or window.', 'info', 2); return false; }
  removeItem('wood', 1);
  const r = best.rec;
  if (best.kind === 'door') r.hp = Math.min(best.maxHp, r.hp + best.maxHp * 0.4);
  else if (r.shutters) r.shutterHp = Math.min(best.shutterMax, r.shutterHp + best.shutterMax * 0.4);
  else { r.boards = true; r.boardHp = Math.min(best.boardMax, (r.boardHp || 0) + best.boardMax * 0.4); } // a plank nailed across
  sfx('hammer');
  spawnParticles(best.cx * TILE + 16, best.cy * TILE + 16, '#c8a070', 8, 70);
  addFloater(best.cx * TILE + 16, best.cy * TILE, 'PATCHED', '#ffd166');
  addJP('handyman', 3, 'ability', 6);
  return true;
}

function toss() {
  const p = G.player;
  const d = 200;
  const x = p.x + Math.cos(p.angle) * d, y = p.y + Math.sin(p.angle) * d;
  sfx('impact', { x, y });
  spawnParticles(x, y, '#9a8f80', 6, 60);
  const n = distract(x, y);
  addFloater(x, y - 10, n ? `${n} turn${n > 1 ? '' : 's'} to look` : 'clatter', '#c8d6ff');
  if (n) addJP('shadow', 2, 'ability', 6);
  return true;
}

/** Vanish: dodging while nobody can see you breaks contact. */
export function onDodge() {
  if (!hasSkill('vanish') || !G.siegeActive) return;
  const n = breakContact();
  if (n) { addFloater(G.player.x, G.player.y - 22, 'VANISHED', '#b9a4e0'); banner(`Out of sight — ${n} of them lost you.`, 'info', 2.5); }
}
