// Being away from home has a price. A short trip is free. Stay too long and
// the family works out where Frank went and sends a crew to the old town; an
// empty house gets broken into; a story attack that finds nobody home doesn't
// go away — it grows, and it's waiting when he gets back. "Recently away"
// carries over between trips, so hopping back and forth doesn't reset it.
import { G, isNight } from './state.js';
import { AWAY, TILE } from '../config.js';
import { clamp, choose, randInt } from '../util.js';
import { chapter, here, visiting } from './chapters.js';
import { absNow, absOf, scheduleSiege } from './siege.js';
import { spawnEnemy, pickSpawnTypes } from './enemies.js';
import { addXP, addJP, relOf, addMoney } from './progression.js';
import { banner, toast, centerMessage } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { NPCS } from '../data/npcs.js';
import { projectDone, dogTrained, cacheProtects, PROJECTS } from './projects.js';
import { saveGame } from './save.js';
import { dialogueActive } from '../ui/dialogue.js';
import { oldHomeStatus } from './visits.js';

const firstName = (id) => NPCS[id].name.split(' ')[0].replace(/"/g, '');
const lifeRec = () => G.s.life;

/** Days spent in the old town on this trip. */
export const daysAway = () => (visiting() ? Math.max(0, (absNow() - G.s.visit.since) / 1440) : 0);
/** How exposed Frank is: this trip plus what's left of recent trips. */
export const exposure = () => (visiting() ? (G.s.visit.debt || 0) + daysAway() : lifeRec().awayDebt || 0);
/** Days left before the family notices (0 = they already have). */
export const safeDaysLeft = () => Math.max(0, AWAY.safeDays - exposure());
/** After the story the family is finished: old towns are open for as long as you like. */
const over = () => !!(G.s.life && G.s.life.post);
export const noticed = () => visiting() && !over() && exposure() >= AWAY.safeDays;

/** Journal line for the current trip. */
export function awayStatus() {
  if (over()) return visiting() ? 'Nobody is looking for you any more. Stay as long as you like.' : '';
  if (!visiting()) {
    const d = lifeRec().awayDebt || 0;
    return d >= 0.5 ? `You were away recently — another trip right now would be noticed sooner (${Math.max(0, AWAY.safeDays - d).toFixed(1)} safe days).` : '';
  }
  const left = safeDaysLeft();
  if (left > 0) return `Safe here for about ${left < 1 ? 'less than a day' : `${Math.floor(left)} more day${Math.floor(left) === 1 ? '' : 's'}`}. Stay longer and they'll find you — and your empty house is fair game.`;
  return 'They know you\'re here. Crews come after dark, more every night, and you\'re putting your friends in danger. Go home.';
}

/** Called by visits.js when a trip starts / ends. */
export function onVisitStart() {
  G.s.visit.debt = Math.min(AWAY.safeDays, lifeRec().awayDebt || 0);
}
export function onVisitEnd(v) {
  if (!v) return;
  const l = lifeRec();
  l.awayDebt = Math.min(AWAY.safeDays * 2, (v.debt || 0) + Math.max(0, (absNow() - v.since) / 1440));
  const w = G.s.world;
  // A story attack that kept missing him is parked in the drive when he gets home.
  if (w.siege && w.siege.plan && w.siege.plan.missed) {
    if (isNight() || absOf(w.siege) - absNow() < 3 * 60) {
      const at = absNow() + 20;
      w.siege.day = Math.floor(at / 1440); w.siege.minute = at % 1440; w.siege.warned = true;
      sfx('warning');
      banner('⚠ Cars in your drive, engines off. They waited for you.', 'danger', 7);
    } else banner(`They know you're back. They'll come tonight — ${w.siege.plan.missed + 1} nights' worth of them.`, 'danger', 7);
  } else if (w.siege && w.siege.warned) banner('⚠ A dark sedan idles at the end of your road. Whoever it is, they\'re coming tonight.', 'danger', 7);
  if (l.awayReport && l.awayReport.length) {
    const lines = l.awayReport.splice(0);
    setTimeout(() => toast(lines.join(' '), 'danger', 8), 3500);
  }
}

/* ---------------- the crew that follows Frank ---------------- */
function pursuitSize() {
  const over = Math.floor(Math.max(0, exposure() - AWAY.safeDays));
  return clamp(AWAY.pursuitBase + over * AWAY.pursuitPerDay + Math.floor((G.s.visit.beaten || 0) / 2), AWAY.pursuitBase, AWAY.pursuitMax);
}

function schedulePursuit() {
  const t = G.s.time, now = absNow();
  const at = t.minute >= 20 * 60 || t.minute < 4 * 60 ? now + randInt(20, 60) : t.day * 1440 + 21 * 60 + randInt(0, 120);
  G.s.visit.pursuit = { at, size: pursuitSize(), live: false };
}

/** A spot out of sight, a fair distance from Frank. */
function crewSpot() {
  const m = G.map, p = G.player;
  let best = null;
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2, r = (11 + Math.random() * 6) * TILE;
    const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    if (!m.inBounds(cx, cy) || m.blocksMove(cx, cy, 'enemy')) continue;
    const spot = { x: cx * TILE + 16, y: cy * TILE + 16 };
    if (!m.los(p.x, p.y, spot.x, spot.y)) return spot;
    best = best || spot;
  }
  return best || { x: p.x + 10 * TILE, y: p.y };
}

function startPursuit(pu) {
  if (G.sleeping) G.events.emit('wake', 'Someone is trying the door. They followed you here.');
  const n = pu.size;
  const types = pickSpawnTypes(n, n >= 4 ? [['scout', 0.3], ['gunman', 0.4], ['enforcer', 0.3]] : [['scout', 0.6], ['gunman', 0.4]]);
  const at = crewSpot();
  types.forEach((t, i) => {
    const e = spawnEnemy(t, at.x + (i % 3 - 1) * 26, at.y + Math.floor(i / 3) * 26, {});
    G.map.pushOut(e, e.radius, 'enemy');
    e.alerted = true; e.pursuit = true;
  });
  pu.live = true;
  sfx('warning');
  centerMessage('THEY FOLLOWED YOU', `${n} of them, here in ${here().place}.`, 3);
  G.events.emit('pursuitStart', n);
}

function endPursuit(won) {
  const v = G.s.visit, pu = v.pursuit;
  v.pursuit = null;
  // Driving across town doesn't shake them: they pick the trail up within the hour.
  if (!won) { v.pursuit = { at: absNow() + randInt(45, 75), size: pu.size, live: false }; return; }
  v.nextAfter = absNow() + 12 * 60;
  v.beaten = (v.beaten || 0) + 1;
  addXP(25 + pu.size * 6, 'Drove them off');
  addJP('gunhand', 6);
  toast(`They won't be the last. Every night you stay in ${here().place}, more will come.`, 'danger', 5);
  G.events.emit('pursuitWon', pu.size);
  saveGame('pursuit');
}

/** A friend who hosts Frank pays for every day he keeps the danger at their door. */
function hostCost() {
  const v = G.s.visit;
  if (!v || v.costDay === G.s.time.day) return;
  v.costDay = G.s.time.day;
  const keeper = oldHomeKeeper(v.ch);
  if (!keeper || G.s.rel[keeper] == null) return;
  G.s.rel[keeper] = Math.max(0, G.s.rel[keeper] - AWAY.hostRelLoss);
  const LINES = {
    ruth: 'Ruth: "Two men asked Dee which road the cabin\'s on. I love you, Frank. Go home."',
    gus: 'Gus: "Strangers at the lumberyard asking about you. You brought it back here. Go home."',
    marcus: 'Marcus: "A car\'s been parked across from the Nguyens\' for two nights. Go home, Frank — they have kids."',
    ingrid: 'Ingrid: "Somebody cut my fence last night. Not to steal cows. Go home, Frank."',
    eleanor: 'Eleanor: "There\'s a boat in the cove that isn\'t a fishing boat. I adore you, Frank. Leave."',
  };
  toast(LINES[keeper] || `${firstName(keeper)} wants you gone — you're bringing danger to their door.`, 'danger', 6);
}
const oldHomeKeeper = (ch) => oldHomeStatus(ch).keeper;

let tickT = 0;
/** Every frame (also while sleeping, so a crew can wake him). */
export function updateAway(dt) {
  if (!G.s || G.endless || G.prequel || !visiting() || G.transition || over()) return;
  const v = G.s.visit;
  const pu = v.pursuit;
  if (pu && pu.live) {
    const mine = G.enemies.filter((e) => e.pursuit);
    if (!mine.length) endPursuit(false); // he slipped them for now (a map change)
    else if (mine.every((e) => e.dead || e.gone)) endPursuit(true);
    return;
  }
  if (pu && absNow() >= pu.at && !G.siegeActive && !G.cutscene && !dialogueActive() && !G.tail) { startPursuit(pu); return; }
  tickT -= dt;
  if (tickT > 0) return;
  tickT = 1;
  const ex = exposure();
  if (!v.warnedAway && ex >= AWAY.safeDays - 1) {
    v.warnedAway = true;
    banner(`Someone at the diner asked about a man who looks like you. You can't stay in ${here().place} much longer.`, 'objective', 7);
  }
  if (ex >= AWAY.safeDays) {
    hostCost();
    if (!pu && absNow() >= (v.nextAfter || 0)) schedulePursuit();
  }
}

/* ---------------- an empty house ---------------- */
const report = (text) => { const l = lifeRec(); (l.awayReport = l.awayReport || []).push(text); };

/** Somebody hits the house while Frank is in another town. */
export function breakIn(s) {
  const home = G.s.home, l = lifeRec();
  const n = s.plan.waves.reduce((a, w) => a + w.types.length, 0);
  const dog = G.s.companion && G.s.companion.dog && G.s.companion.dog.owned;
  const f = dogTrained() ? 0.4 : dog ? 0.7 : 1;
  const out = [];
  // Doors and windows.
  const ops = Object.values(home.openings).filter((o) => !o.gate);
  for (let i = 0; i < Math.min(ops.length, Math.ceil(n / 2)); i++) {
    const o = choose(ops);
    if (o.kind === 'door') { o.hp = Math.max(10, o.hp - Math.round(AWAY.breakInDoor * f)); o.open = false; }
    else { o.glass = 0; o.boardHp = Math.round((o.boardHp || 0) * (1 - 0.5 * f)); if (o.boardHp <= 0) o.boards = false; }
  }
  out.push('Doors forced and windows broken.');
  // Cash kept at the house.
  if (cacheProtects()) out.push('They never found the cache.');
  else {
    const took = Math.min(AWAY.breakInCashCap, Math.floor(G.s.money * AWAY.breakInCash * f));
    if (took > 0) { addMoney(-took); out.push(`$${took} you kept at the house is gone.`); }
  }
  // Something half-built gets wrecked.
  const pr = Object.entries(home.projects || {}).find(([id, r]) => r && !r.done && r.progress > 0 && PROJECTS[id]);
  if (pr) { pr[1].progress -= 1; out.push(`They wrecked a day of work on the ${PROJECTS[pr[0]].name.toLowerCase()}.`); }
  if (dog) out.push(dogTrained() ? 'Duke ran them off before they got far.' : 'Duke barked the whole street awake; they didn\'t stay long.');
  l.breakIns = (l.breakIns || 0) + 1;
  const text = `Your house in ${chapter().place} was broken into while you were away. ${out.join(' ')}`;
  if (visiting() && (home.upgrades.alarm || home.upgrades.camera || projectDone('watchtower'))) {
    sfx('phone');
    banner(`📞 ${home.upgrades.alarm ? 'The alarm went off at home' : 'Your cameras caught them'}: ${text}`, 'danger', 9);
  } else report(text);
  G.events.emit('breakIn', n);
}

/** A story attack (or a probe that retries) found nobody home. */
export function storyMissedAway(s) {
  const plan = s.plan;
  plan.missed = (plan.missed || 0) + 1;
  const t = G.s.time;
  const day = t.minute < 12 * 60 ? t.day : t.day + 1;
  scheduleSiege(plan, day, 22 * 60);
  const nb = chapter().neighbor;
  const grow = Math.min(AWAY.missedGrowthMax, plan.missed * AWAY.missedGrowth);
  if (relOf(nb) >= 1) {
    sfx('phone');
    banner(`📞 ${firstName(nb)} tracked you down: "They came to your place tonight, Frank. Lights in every window. They'll be back — with more." (+${grow} next time)`, 'danger', 9);
  } else {
    toast(`Far away in ${chapter().place}, someone came to your door tonight and found it empty. They'll be back — with more.`, 'danger', 6);
  }
  G.events.emit('siegeMissedAway', plan.missed);
}

/** Extra attackers for an attack that kept finding nobody home. */
export function missedReinforcements(plan) {
  const k = Math.min(AWAY.missedGrowthMax, (plan.missed || 0) * AWAY.missedGrowth);
  if (!k || !plan.waves.length) return plan;
  const waves = plan.waves.map((w) => ({ ...w, types: [...w.types] }));
  waves[waves.length - 1].types.push(...pickSpawnTypes(k, [['gunman', 0.5], ['enforcer', 0.5]]));
  return { ...plan, waves };
}

/** Each morning back home forgives a day of "recently away". */
export function initAwayEvents() {
  G.events.on('newDay', () => {
    if (!G.s || visiting()) return;
    const l = lifeRec();
    if (l.awayDebt) l.awayDebt = Math.max(0, l.awayDebt - AWAY.debtDecay);
  });
}
