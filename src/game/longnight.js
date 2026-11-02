// The Long Night: a run of Endless Siege with an end. Ten waves from dusk to
// dawn at a random home in a random season, with a house that's already
// been through something. Between waves you pick one of three boons; every
// third wave the night adds an omen. Reach dawn and you've won. Each run
// earns embers, which buy permanent starting perks. The daily Long Night
// is the same seed for everyone.
import { G } from './state.js';
import { derived } from './progression.js';

export const RUN_WAVES = 10;
const KEY = 'cabin-under-siege-longnight';

/** What a boon does is read by derived() (progression.js) and a few hooks below. */
export const BOONS = {
  tough: { name: 'Thick Skin', icon: '❤', desc: '+25 maximum health.', apply: (R) => { R.hp += 25; } },
  iron: { name: 'Iron Will', icon: '🛡', desc: 'Take 15% less damage.', apply: (R) => { R.armor *= 0.85; } },
  quick_hands: { name: 'Quick Hands', icon: '⚡', desc: 'Reload 30% faster.', apply: (R) => { R.reload *= 0.7; } },
  ext_mag: { name: 'Extended Magazine', icon: '🔫', desc: 'Your handgun holds 12.', apply: (R) => { R.mag = 12; } },
  steady: { name: 'Steady Aim', icon: '🎯', desc: 'Tighter spread on every gun.', apply: (R) => { R.spread *= 0.7; } },
  second_wind: { name: 'Second Wind', icon: '🩸', desc: 'Every attacker you drop gives back 8 health.', apply: (R) => { R.vamp += 8; } },
  marathon: { name: 'Marathon', icon: '🏃', desc: '+40 stamina; dodging costs less.', apply: (R) => { R.stam += 40; R.dodge *= 0.7; } },
  scavenger: { name: 'Scavenger', icon: '🎒', desc: 'Double supplies between waves.', apply: (R) => { R.scav = 2; } },
  carpenter: { name: 'Carpenter', icon: '🔨', desc: '+12 wood and 2 board kits now; repairs go 50% faster.', apply: (R) => { R.repair *= 1.5; }, now: () => give({ wood: 12, board_kit: 2 }) },
  trapper: { name: 'Trapper', icon: '🪤', desc: 'Three bear traps to set.', now: () => give({ bear_trap: 3 }) },
  duke: { name: 'Duke', icon: '🐕', desc: 'A big dog turns up on the porch and decides you\'re his.', once: true, now: () => { G.s.companion.dog = { owned: true, name: 'Duke', hurtDay: -1 }; import('./dog.js').then((d) => d.spawnDog()); } },
  ruth: { name: 'Ruth', icon: '👵', desc: 'Ruth arrives with Harold\'s shotgun and fights beside you.', once: true, now: () => { G.s.rel.ruth = 80; G.s.companion.ruth = { joined: true, declined: false }; } },
  eagle_eye: { name: 'Eagle Eye', icon: '👁', desc: 'See farther in the dark; know which way each wave comes.', apply: (R) => { R.see += 80; R.dirs = true; } },
  shotgun: { name: 'Pump Shotgun', icon: '💥', desc: 'A shotgun and 20 shells.', needs: () => !G.s.inv.shotgun, once: true, now: () => give({ shotgun: 1, shells: 20 }) },
  rifle: { name: 'Hunting Rifle', icon: '🔭', desc: 'A rifle and 15 rounds.', needs: () => !G.s.inv.rifle, once: true, now: () => give({ rifle: 1, rifle_ammo: 15 }) },
  medic: { name: 'Field Medic', icon: '✚', desc: '+2 first-aid kits; healing works 30% better.', apply: (R) => { R.heal *= 1.3; }, now: () => give({ medkit: 2 }) },
  fortify: { name: 'Fortify', icon: '🧱', desc: 'Every door reinforced and every window boarded, right now.', now: () => fortifyAll() },
  cold_blood: { name: 'Cold Blood', icon: '🧊', desc: 'Getting hit never throws off your aim.', apply: (R) => { R.flinch = 0; } },
  lights: { name: 'Floodlight & Tripwires', icon: '💡', desc: 'A floodlight over the yard and an alarm on the treeline.', once: true, now: () => { G.s.home.upgrades.floodlight = true; G.s.home.upgrades.alarm = true; } },
};

/** Omens: every third wave the night gets worse. */
export const OMENS = {
  fog: { name: 'Fog Rolls In', desc: 'Thick fog for the rest of the night.' },
  fire: { name: 'Bottles', desc: 'Every crew brings firestarters now.' },
  snipers: { name: 'Long Guns', desc: 'Snipers in the treeline.' },
  dogs: { name: 'Dogs', desc: 'Handlers and their dogs join every wave.' },
  horde: { name: 'More of Them', desc: 'A third more attackers in every wave.' },
};

/** Meta-progression: embers buy starting perks that last across runs. */
export const PERKS = {
  start_shotgun: { name: 'Harold\'s Shotgun', cost: 10, desc: 'Start every run with the pump shotgun.' },
  start_medkit: { name: 'Go-Bag', cost: 8, desc: 'Start with two extra first-aid kits.' },
  reroll: { name: 'Second Thoughts', cost: 15, desc: 'Once per run, reroll the boons you\'re offered.' },
  fourth: { name: 'Options', cost: 25, desc: 'Four boons to choose from instead of three.' },
  start_boon: { name: 'Head Start', cost: 20, desc: 'Pick a boon before the first wave.' },
};

export function nightData() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch { d = null; }
  d = d && typeof d === 'object' ? d : {};
  d.embers = Number(d.embers) || 0;
  d.perks = d.perks && typeof d.perks === 'object' ? d.perks : {};
  d.best = d.best && typeof d.best === 'object' ? d.best : { wave: 0, kills: 0 };
  d.dawns = Number(d.dawns) || 0;
  d.runs = Number(d.runs) || 0;
  return d;
}
export function writeNight(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode */ } }
export function buyPerk(id) {
  const d = nightData(), p = PERKS[id];
  if (!p || d.perks[id] || d.embers < p.cost) return false;
  d.embers -= p.cost; d.perks[id] = true; writeNight(d);
  return true;
}
/** Cloud sync: keep whichever side has done more. */
export function mergeNight(o) {
  if (!o || typeof o !== 'object') return;
  const d = nightData();
  for (const k of Object.keys(o.perks || {})) d.perks[k] = true;
  d.embers = Math.max(d.embers, Number(o.embers) || 0);
  if (o.best && (o.best.wave > d.best.wave || (o.best.wave === d.best.wave && o.best.kills > d.best.kills))) d.best = o.best;
  d.dawns = Math.max(d.dawns, Number(o.dawns) || 0); d.runs = Math.max(d.runs, Number(o.runs) || 0);
  writeNight(d);
}

/* ---------------- a run ---------------- */
export const run = () => (G.endless && G.endless.run) || null;
const rnd = () => { const R = run(); return R && R.rng ? R.rng() : Math.random(); };
function pickN(list, n) { const a = [...list], out = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; }

/** Stat modifiers for derived(): neutral when not in a run. */
const NEUTRAL = { hp: 0, stam: 0, armor: 1, reload: 1, spread: 1, mag: 0, vamp: 0, dodge: 1, scav: 1, repair: 1, heal: 1, see: 0, dirs: false, flinch: 1 };
export function runMods() {
  const R = run();
  if (!R) return NEUTRAL;
  if (!R.mods || R.modsKey !== R.boons.length) {
    const m = { ...NEUTRAL };
    for (const id of R.boons) if (BOONS[id] && BOONS[id].apply) BOONS[id].apply(m);
    R.mods = m; R.modsKey = R.boons.length;
  }
  return R.mods;
}

function give(items) {
  for (const [id, n] of Object.entries(items)) G.s.inv[id] = (G.s.inv[id] || 0) + n;
}
function fortifyAll() {
  for (const o of Object.values(G.s.home.openings)) {
    if (o.gate) continue;
    if (o.kind === 'door') { o.reinforced = true; o.hp = Math.max(o.hp, (o.baseHp || 100) + 150); o.open = false; }
    else { o.boards = true; o.boardHp = Math.max(o.boardHp || 0, 60); }
  }
  G.events.emit('projectsChanged');
}

/** Set up a run's record on G.endless (endless.js calls this). */
export function newRun(opts, seeded) {
  const d = nightData();
  return { boons: [], omens: [], daily: opts.daily || null, rng: seeded || null, rerolled: false, perks: { ...d.perks }, offer: null, startPick: !!d.perks.start_boon };
}

/** Right after the run's world exists: a house that's been through something, a random loadout. */
export function setupRun() {
  const R = run();
  if (!R) return;
  const s = G.s;
  for (const o of Object.values(s.home.openings)) {
    if (o.gate) continue;
    const r = rnd();
    if (o.kind === 'door') o.hp = Math.round((o.baseHp || 100) * (0.45 + r * 0.55));
    else if (r < 0.3) o.glass = 0; else if (r > 0.75) { o.boards = true; o.boardHp = 40; }
  }
  const r = rnd();
  if (R.perks.start_shotgun || r < 0.35) give({ shotgun: 1, shells: 12 }); else { delete s.inv.shotgun; delete s.inv.shells; }
  if (r > 0.7) give({ rifle: 1, rifle_ammo: 8 }); else { delete s.inv.rifle; delete s.inv.rifle_ammo; }
  if (R.perks.start_medkit) give({ medkit: 2 });
  s.player.weapon = 'pistol';
}

/** Offer boons (3, or 4 with the perk). */
export function drawOffer() {
  const R = run();
  const pool = Object.entries(BOONS).filter(([id, b]) => (!b.once || !R.boons.includes(id)) && (!b.needs || b.needs())).map(([id]) => id);
  R.offer = pickN(pool, R.perks.fourth ? 4 : 3);
  return R.offer;
}
export function takeBoon(id) {
  const R = run();
  if (!R || !BOONS[id] || (R.offer && !R.offer.includes(id))) return false;
  R.boons.push(id); R.offer = null;
  if (BOONS[id].now) BOONS[id].now();
  G.events.emit('boonTaken', id);
  return true;
}
export function rerollOffer() {
  const R = run();
  if (!R || !R.perks.reroll || R.rerolled) return null;
  R.rerolled = true;
  return drawOffer();
}

/** After waves 3, 6 and 9: an omen. */
export function maybeOmen(wave) {
  const R = run();
  if (!R || wave % 3 !== 0) return null;
  const left = Object.keys(OMENS).filter((k) => !R.omens.includes(k));
  if (!left.length) return null;
  const o = left[Math.floor(rnd() * left.length)];
  R.omens.push(o);
  return o;
}
export const hasOmen = (k) => !!(run() && run().omens.includes(k));

/** Extra attackers the omens bring to a wave plan. */
export function omenTypes(n) {
  const out = [];
  if (hasOmen('fire')) out.push('arsonist');
  if (hasOmen('snipers')) out.push('sniper');
  if (hasOmen('dogs')) out.push('handler');
  if (hasOmen('horde')) for (let i = 0; i < Math.ceil(n / 3); i++) out.push('gunman');
  return out;
}

/** The clock for the HUD: dusk at 8 PM, an hour a wave, dawn at 6 AM. */
export const runMinute = (wave) => (20 * 60 + Math.min(RUN_WAVES, wave) * 60) % 1440;

/** The end of a run: embers and records. */
export function finishRun(won, survived, kills) {
  const R = run();
  const d = nightData();
  const embers = survived + Math.floor(kills / 10) + (won ? 10 : 0);
  d.embers += embers; d.runs += 1;
  if (won) d.dawns += 1;
  const record = survived > d.best.wave || (survived === d.best.wave && kills > d.best.kills);
  if (record) d.best = { wave: survived, kills };
  writeNight(d);
  return { won, survived, kills, embers, record, best: d.best, boons: R ? [...R.boons] : [], omens: R ? [...R.omens] : [], daily: R && R.daily, total: d.embers };
}

export function initLongNightEvents() {
  G.events.on('enemyKilled', () => {
    const m = runMods();
    if (!m.vamp || !G.player || G.player.dead) return;
    G.player.hp = Math.min(G.player.hp + m.vamp, derived().maxHp);
  });
}
