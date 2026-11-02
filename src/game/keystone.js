// Chapter 6: Keystone — the epilogue chapter, played from the Short Hills
// watch house after the story ends. Marcus calls; Frank cases Carmine
// Ventura's title company on Broad Street (a clerk, a tail, a car in a
// garage); Carmine's nephew comes for the watch house; then a night inside
// Keystone, guards on their posts, and a choice about the list.
//   stage: null → 'case' → 'strike' → 'break' → 'done'
import { G } from './state.js';
import { TILE } from '../config.js';
import { visiting, atHome } from './chapters.js';
import { playDialogue } from '../ui/dialogue.js';
import { banner, toast, centerMessage } from '../ui/hud.js';
import { sfx, setMusic } from '../audio.js';
import { saveGame } from './save.js';
import { addXP, addJP, addMoney } from './progression.js';
import { count, removeItem } from './inventory.js';
import { spawnEnemy } from './enemies.js';
import { scheduleSiege, makeRaidPlan } from './siege.js';
import { quietMoment } from './life.js';
import { trailSolved } from './evidence.js';
import { CALL, STRIKE_WARNING, BREAK_READY, FINALE, OUTCOME, AFTER_LETTER } from '../data/keystone.js';
import { playCutscene } from '../ui/cutscene.js';

export const KS_ERRAND = 'k6_case';
export const ks = () => (G.s.keystone || (G.s.keystone = { stage: null }));
export const keystoneStage = () => (G.s && G.s.keystone ? G.s.keystone.stage : null);
export const keystoneActive = () => ['case', 'strike', 'break'].includes(keystoneStage());
const est = () => G.s.errands || (G.s.errands = {});
const h = () => G.s.time.minute / 60;
/** Keystone only opens up at night (9 PM – 4 AM). */
export const breakHours = () => h() >= 21 || h() < 4;

/** Marcus calls a few days into life after the story. */
export function canCall() {
  const s = G.s, L = s.life;
  if (!L || !L.post || keystoneStage() || G.endless || G.prequel || visiting() || !atHome()) return false;
  if (s.chapter !== 5 || s.time.day < (L.post.day || 0) + 3) return false;
  if (h() < 9 || h() >= 20) return false; // the call doesn't wait behind an ordinary quiet-day event
  return quietMoment();
}

export function startKeystone() {
  const k = ks();
  if (k.stage) return false;
  const solved = trailSolved();
  k.stage = 'case'; k.day = G.s.time.day; k.toldTrail = !solved;
  G.s.life.eventDay = G.s.time.day;
  sfx('phone');
  playDialogue(CALL(G.s, solved), () => {
    import('./errands.js').then((m) => { m.startErrand(KS_ERRAND, true); });
    banner('CHAPTER 6: KEYSTONE — Carmine Ventura\'s title company, Broad Street, Newark. Drive there from your car.', 'objective', 7);
    G.events.emit('keystoneStart');
    saveGame('chapter', { force: true });
  });
  return true;
}

/** The night they come for the watch house. */
function strikePlan() {
  const p = makeRaidPlan(7, 'raid');
  const waves = p.waves.map((w) => ({ ...w, types: [...w.types] }));
  const last = waves[waves.length - 1];
  let li = last.types.indexOf('lieutenant');
  if (li < 0) { last.types.push('lieutenant'); li = last.types.length - 1; }
  last.named = { [li]: 'Sonny Ventura' };
  return { ...p, kind: 'story', keystone: true, waves, hpMult: (p.hpMult || 1) * 1.1 };
}
function toStrike() {
  const k = ks();
  k.stage = 'strike';
  const t = G.s.time;
  const day = t.minute < 12 * 60 ? t.day : t.day + 1;
  scheduleSiege(strikePlan(), day, 22 * 60);
  k.strikeDay = day;
  banner('They\'ll come for the watch house first. Be home tonight-or-tomorrow by 10 PM.', 'danger', 6);
  saveGame('chapter', { force: true });
}

/* ---------------- objective, waypoint, car ---------------- */
export function keystoneObjective(stageLabel) {
  switch (keystoneStage()) {
    case 'case': return `Chapter 6: Keystone. ${stageLabel || 'Case Keystone Title & Escrow on Broad Street, Newark (drive there from your car).'}`;
    case 'strike': return 'Chapter 6: Carmine\'s nephew is coming for the watch house. Be home by 10 PM and hold it.';
    case 'break': return 'Chapter 6: After 9 PM, drive to Broad Street. Get into Keystone, open the records room with Carmine\'s keycard, and take the list.';
    default: return null;
  }
}
export function keystoneWaypoint(errandWaypoint) {
  const st = keystoneStage();
  if (st === 'case') {
    if (G.map.id !== 'broad') return { map: 'shorthills', ...G.maps.shorthills.points.car, label: 'Car' };
    return errandWaypoint((e) => e.keystone);
  }
  if (st === 'strike') return { map: 'shorthills', ...G.maps.shorthills.points.cabin_in, label: 'Watch house' };
  if (st === 'break') {
    if (G.map.id === 'broad') return { map: 'broad', ...G.maps.broad.points.records, label: 'Records room' };
    return { map: 'shorthills', ...G.maps.shorthills.points.car, label: 'Car' };
  }
  return null;
}
/** Car options: Short Hills ⇄ Broad Street while the chapter is open. */
export function keystoneCar(travelFn) {
  const st = keystoneStage();
  if (!st || st === 'done' && G.map.id !== 'broad') return null;
  if (G.map.id === 'broad') {
    const N = G.ksNight;
    if (N && N.alarm && G.enemies.some((e) => !e.dead && !e.gone && e.alerted)) return { label: 'Not with Carmine\'s men shooting at you', short: 'CAR', action: () => toast('Deal with them first — they\'d follow you home.', 'danger') };
    return { label: 'Drive home to Short Hills (20 min)', short: 'DRIVE', prio: 2, action: () => { G.ksNight = null; for (const e of G.enemies) { e.gone = true; e.alerted = false; } travelFn('shorthills', 'car'); } };
  }
  if (st === 'strike') return null;
  if (st === 'break' && !breakHours()) return { label: 'Drive to Broad Street — but not until after 9 PM', short: 'CAR', action: () => toast('Keystone is full of people all day. Go after 9 PM.', 'warn', 3) };
  return { label: 'Drive to Broad Street, Newark (20 min)', short: 'DRIVE', prio: 2, action: () => travelFn('broad', 'car') };
}

/* ---------------- people and props on Broad Street ---------------- */
function caseStage() { const r = est()[KS_ERRAND]; return r && r.state === 'active' ? r.stage : -1; }
export function keystoneNpcs(m) {
  if (m.id !== 'broad') return [];
  const out = [];
  if (keystoneStage() === 'case' && caseStage() === 1) out.push({ id: 'gloria', scripted: true, present: true, def: { name: 'Gloria Pinto', body: '#8a6a9a', hair: '#3a2a1a', skin: '#e0b48e' }, x: m.points.gloria.x + 26, y: m.points.gloria.y, radius: 10, angle: Math.PI, path: null, walkPhase: 0 });
  if (keystoneStage() === 'break' && G.ksNight) out.push({ id: 'carmine', scripted: true, present: true, def: { name: 'Carmine Ventura', body: '#2a2a34', hair: '#bdbdbd', skin: '#d8b08a' }, x: m.points.records.x - 10, y: m.points.records.y + 8, radius: 10, angle: -Math.PI / 2, path: null, walkPhase: 0 });
  return out;
}
export function keystoneProps(mapId) {
  if (mapId !== 'broad' || keystoneStage() !== 'break' || !G.ksNight) return [];
  const p = G.maps.broad.points.list;
  return [{ id: 'k_list', kind: 'k_list', keystone: true, x: p.x, y: p.y, r: 50, label: 'Twenty-two boxes: the list' }];
}
export function keystonePropAction(pr) {
  if (pr.kind !== 'k_list') return null;
  return { label: 'The list — and Carmine Ventura', short: 'ACT', prio: 3, action: () => finale() };
}

/** Keystone's doors at night: the front is locked; the back opens if Gloria left it, or can be forced; the records room takes the keycard. */
export function tryKeystoneDoor(b) {
  if (!G.map || G.map.id !== 'broad' || !b.rec.locked) return false;
  if (b.id === 'records_door') {
    if (count('keycard') > 0) { b.rec.locked = false; b.rec.open = true; sfx('door'); toast('The keycard reader blinks green. The steel door sighs open.', 'info', 3); return true; }
    toast('Steel door, keycard reader. Carmine keeps the card.', 'warn', 3); return true;
  }
  if (b.id === 'ks_back') {
    b.rec.locked = false; b.rec.open = true; sfx('wood');
    toast('You lean on the back door until the latch gives. It isn\'t quiet.', 'warn', 3);
    const near = G.enemies.filter((e) => !e.dead && e.guard).sort((a, c) => Math.hypot(a.x - b.cx * TILE, a.y - b.cy * TILE) - Math.hypot(c.x - b.cx * TILE, c.y - b.cy * TILE)).slice(0, 2);
    for (const e of near) { e.investigate = { x: b.cx * TILE + 16, y: b.cy * TILE + 16, t: 8 }; }
    return true;
  }
  toast(b.rec.lockedMsg || 'Locked for the night.', 'info', 3);
  return true;
}

/* ---------------- the night inside ---------------- */
const POSTS = [
  ['gunman', 'k_g1', 'k_g2'], ['scout', 'k_g5', 'k_g6'], ['enforcer', 'k_g3', null], ['gunman', 'k_g4', 'k_g1'],
  ['scout', 'k_g6', 'k_g5'], ['gunman', 'k_g7', null], ['enforcer', 'k_g2', 'k_g4'],
];
export function startNight() {
  const m = G.map;
  if (m.id !== 'broad' || keystoneStage() !== 'break' || G.ksNight || !breakHours()) return false;
  const choice = (est()[KS_ERRAND] || {}).choice;
  const n = choice === 'kind' ? 5 : choice === 'pay' ? 6 : 7;
  G.ksNight = { alarm: false, reinfT: -1, reinforced: false, marked: choice === 'pay' ? 90 : 0 };
  const dr = (id) => [...m.blockers.values()].find((b) => b.id === id);
  for (const id of ['ks_front_l', 'ks_front_r']) { const d = dr(id); if (d) { d.rec.locked = true; d.rec.open = false; d.rec.lockedMsg = 'Locked for the night. There\'s a back door on the alley.'; } }
  const back = dr('ks_back'); if (back) { back.rec.open = false; back.rec.locked = choice !== 'kind'; delete back.rec.lockedMsg; }
  const rec = dr('records_door'); if (rec) { rec.rec.locked = true; rec.rec.open = false; }
  for (const [type, a, b] of POSTS.slice(0, n)) {
    const pa = m.points[a], pb = b ? m.points[b] : null;
    const e = spawnEnemy(type, pa.x, pa.y, { hpMult: 1.15, name: type === 'enforcer' ? 'Keystone muscle' : null });
    e.guard = { pts: pb ? [pa, pb] : [pa], i: 0, wait: Math.random() * 3 };
    e.angle = Math.random() * Math.PI * 2;
    e.keystone = true;
  }
  G.npcs.push(...keystoneNpcs(m));
  setMusic('night');
  const notes = [choice === 'kind' ? 'Gloria left the back door on the latch' : choice === 'pay' ? 'Gloria\'s napkin: you know every guard\'s round' : 'Gloria made her phone call — they\'re expecting somebody'];
  if (count('keycard')) notes.push('Carmine\'s keycard in your pocket');
  playCutscene({ focus: { x: 20 * TILE, y: 10 * TILE }, zoom: 0.8, title: 'KEYSTONE TITLE & ESCROW', sub: notes.join(' · '), hold: 2.4 });
  return true;
}

export function updateKeystone(dt) {
  if (!G.s || G.endless || G.prequel) return;
  const N = G.ksNight;
  if (N && G.map && G.map.id === 'broad') {
    if (N.marked > 0) { N.marked -= dt; for (const e of G.enemies) if (!e.dead && e.keystone) e.spotted = Math.max(e.spotted, 0.3); }
    if (!N.alarm && !N.over && G.enemies.some((e) => e.keystone && !e.dead && !e.gone && e.alerted)) {
      N.alarm = true; N.reinfT = 40;
      sfx('alarm'); setMusic('tense');
      centerMessage('ALARM', 'Somebody\'s on the phone to Club Ventura. More are coming.', 2.6);
    }
    if (N.reinfT > 0 && !N.over) {
      N.reinfT -= dt;
      if (N.reinfT <= 0 && !N.reinforced) {
        N.reinforced = true;
        const sp = G.map.spawns.east;
        for (const t of ['gunman', 'gunman', 'enforcer']) { const e = spawnEnemy(t, sp.x - 30, sp.y + (Math.random() - 0.5) * 40, { hpMult: 1.1 }); e.alerted = true; e.keystone = true; }
        banner('Car doors on Broad Street — Club Ventura sent help!', 'danger', 4);
      }
    }
  }
  tick -= dt;
  if (tick > 0) return;
  tick = 1.5;
  if (typeof window !== 'undefined' && window.__cusNoEvents) return;
  const k = G.s.keystone;
  if (!k || !k.stage) { if (canCall()) startKeystone(); return; }
  // Gloria takes her lunch at the luncheonette while that part of the case is open.
  if (G.map && G.map.id === 'broad') {
    const want = keystoneNpcs(G.map).filter((n) => n.id === 'gloria'), has = G.npcs.some((n) => n.id === 'gloria');
    if (want.length && !has) G.npcs.push(...want); else if (!want.length && has) G.npcs = G.npcs.filter((n) => n.id !== 'gloria');
  }
  if (k.stage === 'strike' && !k.warned && G.s.world.siege && G.s.world.siege.plan.keystone && G.s.time.day === G.s.world.siege.day && h() >= 17 && quietMoment()) {
    k.warned = true; sfx('phone'); playDialogue(STRIKE_WARNING);
  }
  if (k.stage === 'done' && !k.letter && G.s.time.day >= (k.doneDay || 0) + 5 && atHome() && quietMoment() && G.s.life.eventDay !== G.s.time.day) {
    k.letter = true; G.s.life.eventDay = G.s.time.day;
    const l = AFTER_LETTER[k.choice];
    if (l) { sfx('chime'); playDialogue([{ who: '', text: '(A letter in the mailbox.)' }, l]); }
  }
}
let tick = 0;

function finale() {
  const k = ks();
  if (k.stage !== 'break' || k.finale) return;
  k.finale = true;
  let pick = null;
  const lines = FINALE(G.s).map((l) => (!l.choices ? l : { ...l, choices: l.choices.map((c) => ({ text: c.text, effect: () => { pick = c.value; return OUTCOME[c.value]; } })) }));
  playDialogue(lines, () => {
    if (!pick) { k.finale = false; return; }
    k.choice = pick; k.stage = 'done'; k.doneDay = G.s.time.day;
    G.s.choices.keystone = pick;
    if (G.ksNight) G.ksNight.over = true;
    for (const e of G.enemies) if (!e.dead && e.keystone) { e.retreating = true; e.alerted = false; }
    G.npcs = G.npcs.filter((n) => n.id !== 'carmine');
    if (count('keycard')) removeItem('keycard', count('keycard'));
    addXP(250, 'Keystone'); addJP('shadow', 20);
    if (pick === 'keep') addMoney(300, 'Carmine\'s "consulting fee"');
    centerMessage('CHAPTER 6 COMPLETE', { reyes: 'The list is evidence now.', press: 'Keystone is front-page news.', burn: 'The list is ash.', keep: 'The list is yours.' }[pick], 4);
    G.events.emit('keystoneDone', pick);
    saveGame('chapter', { force: true });
  });
}

export function initKeystoneEvents() {
  G.events.on('errandDone', (id) => { if (id === KS_ERRAND && keystoneStage() === 'case') toStrike(); });
  G.events.on('siegeWon', (sg) => {
    if (!sg.plan.keystone || keystoneStage() !== 'strike') return;
    ks().stage = 'break';
    setTimeout(() => playDialogue(BREAK_READY), 3200);
    saveGame('chapter', { force: true });
  });
  G.events.on('mapLoaded', (id) => {
    if (id !== 'broad') { G.ksNight = null; return; }
    G.npcs.push(...keystoneNpcs(G.map).filter((n) => n.id !== 'carmine'));
    if (keystoneStage() === 'break' && breakHours()) startNight();
    else if (keystoneStage() === 'break') toast('Keystone is open for business. Come back after 9 PM.', 'info', 4);
  });
}

