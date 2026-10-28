// The Longer Life: each chapter is a stretch of Frank's life, not a stop
// between sieges. This module tracks where a chapter is (its phase), the
// "make it home" step (any few of many everyday moments), quiet-day events
// (drop-ins, invitations, storms, car trouble), friends who come to stay,
// Ruth's conversations and farewells before a move.
import { G, newLife } from './state.js';
import { TILE } from '../config.js';
import { chapter, here, hereN, atHome, visiting, homeMapId, CHAPTERS } from './chapters.js';
import { NPCS } from '../data/npcs.js';
import { addItem } from './inventory.js';
import { addJP, addMoney, addRel, addXP, relOf } from './progression.js';
import { playDialogue, dialogueActive } from '../ui/dialogue.js';
import { banner, toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { inHours, weekday } from './calendar.js';
import { siegeTonight } from './siege.js';
import { setWeather } from './weather.js';
import { ITEMS } from '../data/items.js';
import { LIFE_STEPS, MOMENTS, LIFE_EVENTS, GUESTS, FAREWELLS, RUTH_TALKS } from '../data/life.js';

/* ---------------- phases ---------------- */
export const PHASES = {
  A: { name: 'Arrival', desc: 'Find your feet: the house, the neighbors, a job.' },
  B: { name: 'Building a life', desc: 'Work, people, projects — quiet days are the point.' },
  C: { name: 'Something is wrong', desc: 'Small things that don\'t add up.' },
  D: { name: 'The threat closes in', desc: 'They\'ve tested you. Find out how much they know.' },
  E: { name: 'Final preparation', desc: 'A real attack is coming. Get ready, and ask for help.' },
  F: { name: 'Aftermath', desc: 'Count the damage. Say what needs saying.' },
};

/** Story steps in order, per chapter, with the phase each belongs to. */
export const STEP_ORDER = {
  1: [['arrive', 'A'], ['meet_ruth', 'A'], ['go_town', 'A'], ['settle_in', 'A'], ['find_work', 'A'], ['first_job', 'A'], ['town_trust', 'B'], ['ch1_life', 'B'], ['rest', 'C'], ['trail', 'C'], ['see_dee', 'C'], ['stranger', 'C'], ['probe', 'D'], ['prepare', 'D'], ['ch1_rat', 'E'], ['reinforce', 'E'], ['first_siege', 'E'], ['search_body', 'F'], ['show_ruth', 'F'], ['phone_call', 'F'], ['free', 'F'], ['leave_town', 'F']],
  2: [['ch2_arrive', 'A'], ['ch2_meet_marcus', 'A'], ['ch2_find_work', 'A'], ['ch2_job', 'A'], ['ch2_life', 'B'], ['ch2_rosa', 'C'], ['ch2_letter', 'C'], ['ch2_watch', 'C'], ['ch2_probe', 'D'], ['ch2_rat', 'E'], ['ch2_fortify', 'E'], ['ch2_siege', 'E'], ['ch2_phone', 'F'], ['ch2_marcus_truth', 'F'], ['ch2_free', 'F']],
  3: [['ch3_arrive', 'A'], ['ch3_meet_ingrid', 'A'], ['ch3_find_work', 'A'], ['ch3_job', 'A'], ['ch3_life', 'B'], ['ch3_deputy', 'C'], ['ch3_watch', 'C'], ['ch3_probe', 'D'], ['ch3_rat', 'E'], ['ch3_fortify', 'E'], ['ch3_siege', 'E'], ['ch3_ledger', 'F'], ['ch3_ingrid_truth', 'F'], ['ch3_free', 'F']],
  4: [['ch4_arrive', 'A'], ['ch4_meet_eleanor', 'A'], ['ch4_find_work', 'A'], ['ch4_job', 'A'], ['ch4_life', 'B'], ['ch4_reyes', 'C'], ['ch4_watch', 'C'], ['ch4_probe', 'D'], ['ch4_rat', 'E'], ['ch4_fortify', 'E'], ['ch4_siege', 'E'], ['ch4_ring', 'F'], ['ch4_eleanor_truth', 'F'], ['ch4_free', 'F']],
  5: [['ch5_arrive', 'A'], ['ch5_meet_dom', 'A'], ['ch5_settle', 'A'], ['ch5_find_work', 'A'], ['ch5_trust', 'B'], ['ch5_life', 'B'], ['ch5_watch', 'C'], ['ch5_probe', 'D'], ['ch5_recon', 'D'], ['ch5_rat', 'E'], ['ch5_allies', 'E'], ['ch5_siege', 'E'], ['ch5_plans', 'E'], ['ch5_assault', 'E'], ['ch5_free', 'F']],
};

export function stepIndex(step, ch = G.s.chapter) {
  const list = STEP_ORDER[ch] || [];
  return list.findIndex(([s]) => s === step);
}
/** Has the active chapter's story reached (or passed) this step? */
export function stepAtLeast(step) {
  if (!step) return true;
  const a = stepIndex(G.s.story.step), b = stepIndex(step);
  return a >= 0 && b >= 0 && a >= b;
}
export const stepBefore = (step) => !step || !stepAtLeast(step);
export function phaseOf(step = G.s.story.step, ch = G.s.chapter) {
  const e = (STEP_ORDER[ch] || []).find(([s]) => s === step);
  return e ? e[1] : 'F';
}

/** Per-chapter expansion record. */
export function lifeCh(n = G.s.chapter) {
  const L = G.s.life || (G.s.life = newLife());
  return L.ch[n] || (L.ch[n] = { moments: {}, events: {}, watch: {}, counter: {}, farewell: {} });
}
const absNow = () => G.s.time.day * 1440 + G.s.time.minute;

/* ---------------- "make it home" ---------------- */
export const LIFE_NEED = 3;
const lifeStepOf = (n = G.s.chapter) => LIFE_STEPS[n] || null;
export const inLifeStep = () => { const ls = lifeStepOf(); return !!ls && G.s.story.step === ls.step && !visiting(); };

/** Moments since the "make it home" step began (distinct kinds). */
// Moments are numbered in order, so the step only counts what happens after it starts.
const nextSeq = () => { const L = G.s.life; L.seq = (L.seq || 0) + 1; return L.seq; };
export function lifeMomentsDone() {
  const c = lifeCh();
  const from = c.lifeFrom || 0;
  return Object.entries(c.moments).filter(([, t]) => t > from).map(([k]) => k);
}

export function startLifeStep() {
  const c = lifeCh();
  c.lifeFrom = nextSeq();
}

/** Something that made the place feel like home. Counted per chapter, where Frank lives. */
export function lifeMoment(kind) {
  if (!G.s || G.endless || G.prequel || visiting() || !MOMENTS[kind]) return;
  const c = lifeCh();
  const fresh = !(c.moments[kind] > (c.lifeFrom || 0));
  c.moments[kind] = nextSeq();
  if (!inLifeStep() || !fresh) return;
  const n = lifeMomentsDone().length;
  if (n >= LIFE_NEED) { finishLifeStep(); return; }
  toast(`🏡 ${MOMENTS[kind].done} (${n}/${LIFE_NEED} — making ${chapter().place} home)`, 'good', 3.5);
}

function finishLifeStep() {
  const ls = lifeStepOf();
  if (!ls || G.s.story.step !== ls.step || lifeCh().lifeDone) return;
  lifeCh().lifeDone = G.s.time.day;
  const go = () => { addXP(60, 'A life here'); addJP('neighbor', 8); G.events.emit('lifeStepDone', G.s.chapter); };
  // Never cut into another conversation: wait for it to end.
  const run = () => (dialogueActive() || G.modal ? setTimeout(run, 400) : playDialogue(ls.done(G.s), go));
  setTimeout(run, 300);
}

export function lifeObjective() {
  const ls = lifeStepOf();
  const n = lifeMomentsDone().length;
  return `${ls.obj} (${Math.min(n, LIFE_NEED)}/${LIFE_NEED}) — any few: cards, supper, the market, fishing or hunting, a meal, a gift, a day on a project, helping someone… (Journal)`;
}

/** Journal: the menu of everyday things, and which you've done. */
export function lifeIdeas() {
  const have = new Set(lifeMomentsDone());
  return Object.entries(MOMENTS).map(([k, m]) => ({ id: k, label: m.label, done: have.has(k) }));
}

export function initLifeEvents() {
  const ev = G.events;
  ev.on('pokerHand', () => lifeMoment('cards'));
  ev.on('supper', () => lifeMoment('supper'));
  ev.on('itemBought', () => { if (weekday() === 'Friday' && G.map && G.map.id === here().workMap) lifeMoment('market'); });
  ev.on('galleryScore', () => lifeMoment('fair'));
  ev.on('fishCaught', () => lifeMoment('outdoors'));
  ev.on('deerDressed', () => lifeMoment('outdoors'));
  ev.on('cooked', () => lifeMoment('meal'));
  ev.on('cropPicked', () => lifeMoment('garden'));
  ev.on('gift', () => lifeMoment('gift'));
  ev.on('projectsChanged', () => { if (atHome()) lifeMoment('project'); });
  ev.on('questDone', () => lifeMoment('help'));
  ev.on('errandDone', (id) => import('./errands.js').then(({ ERRANDS }) => {
    const e = ERRANDS[id];
    if (!e || e.chore || e.story || e.counter) return;
    lifeMoment(e.event ? 'event' : 'help');
  }));
  ev.on('newDay', () => { guestCheck(); });
}

/* ---------------- quiet-day events ---------------- */
/** Is now a good moment to interrupt? Never in a fight, a conversation, a cutscene or with an attack due. */
export function quietMoment() {
  if (!G.s || G.endless || G.prequel || !G.player || G.player.dead) return false;
  if (G.siegeActive || G.transition || G.modal || dialogueActive() || G.cutscene || G.tail || G.gallery || G.assault || G.sleeping || G.repairHold) return false;
  if (G.enemies.some((e) => !e.dead && !e.gone)) return false;
  if (G.s.world.siege && (G.s.world.siege.warned || siegeTonight())) return false;
  return true;
}

function eventEligible(e) {
  const s = G.s;
  if (e.arrival && !(G.time - (G.arrivedByCar ?? -99) < 20)) return false; // only just after you pull in
  const away = visiting();
  if (e.visit ? (!away || e.chapter !== hereN()) : (away || e.chapter !== s.chapter)) return false;
  const c = lifeCh(e.chapter);
  if (c.events[e.id]) return false;
  if (!e.visit) {
    if (e.after && !stepAtLeast(e.after)) return false;
    if (e.before && stepAtLeast(e.before)) return false;
    if (e.postOnly && !s.life.post) return false;
  }
  if (e.where === 'home' && !atHome()) return false;
  if (e.where === 'town' && G.map.id !== here().workMap) return false;
  if (e.map && G.map.id !== e.map) return false;
  if (e.hours && !inHours(e.hours)) return false;
  if (e.weekday && weekday() !== e.weekday) return false;
  if (e.minDay && s.time.day < (s.story.flags.chapterStartDay || 0) + e.minDay) return false;
  if (e.needs && !e.needs(s)) return false;
  return true;
}

let lifeTick = 0;
/** The automated test can switch off optional interruptions for the older checks. */
const quietTest = () => typeof window !== 'undefined' && !!window.__cusNoEvents;

export function updateLife(dt) {
  lifeTick -= dt;
  if (lifeTick > 0 || quietTest()) return;
  lifeTick = 1.5;
  if (!quietMoment()) return;
  const L = G.s.life;
  if (L.eventDay === G.s.time.day) return; // one quiet-day event a day at most
  if (G.s.time.day <= (G.s.story.flags.chapterStartDay || 0) - 1) return;
  const e = LIFE_EVENTS.find(eventEligible);
  if (e) fireEvent(e);
}

/** Lines may carry choices `{ text, value, cost, lines }`; the event's `result(s, value)` runs after. */
function withChoices(lines, pick) {
  return lines.map((l) => (!l.choices ? l : { ...l, choices: l.choices.map((c) => ({
    text: c.cost ? `${c.text} ($${c.cost})` : c.text,
    effect: () => {
      if (c.cost && G.s.money < c.cost) { pick.value = c.fallback || 'no'; return [{ who: 'Frank', text: `(You don't have $${c.cost}.)` }]; }
      if (c.cost) addMoney(-c.cost);
      pick.value = c.value;
      return c.lines || [];
    },
  })) }));
}

export function fireEvent(e) {
  const s = G.s, c = lifeCh(e.chapter);
  c.events[e.id] = s.time.day;
  s.life.eventDay = s.time.day;
  const pick = { value: null };
  const lines = typeof e.lines === 'function' ? e.lines(s) : e.lines;
  if (e.weather) setWeather(e.weather);
  sfx(e.sound || 'chime');
  playDialogue(withChoices(lines, pick), () => {
    const r = e.reward && (!e.rewardIf || e.rewardIf === pick.value || (Array.isArray(e.rewardIf) && e.rewardIf.includes(pick.value))) ? e.reward : null;
    if (r) grant(r);
    if (e.result) { try { e.result(s, pick.value); } catch (err) { console.error(err); } }
    if (e.errand && (!e.errandIf || e.errandIf === pick.value)) import('./errands.js').then((m) => m.startErrand(e.errand));
    if (e.moment && (!e.momentIf || e.momentIf === pick.value)) lifeMoment('event');
    if (e.note) banner(e.note, 'info', 5);
    G.events.emit('lifeEvent', e.id, pick.value);
    saveGame('event');
  });
}

export function grant(r) {
  if (r.money) addMoney(r.money, r.why || '');
  if (r.xp) addXP(r.xp, r.why || null);
  if (r.rel) addRel(r.rel[0], r.rel[1]);
  if (r.rel2) addRel(r.rel2[0], r.rel2[1]);
  if (r.jp) addJP(r.jp[0], r.jp[1]);
  for (const [item, n] of Object.entries(r.items || {})) {
    const got = addItem(item, n, true);
    if (got && ITEMS[item]) toast(`Received: ${ITEMS[item].name}${n > 1 ? ' ×' + got : ''}`, 'item', 3);
  }
}

/** Upcoming / recent quiet-day events for the journal's calendar. */
export function eventLog() {
  const out = [];
  for (const e of LIFE_EVENTS) {
    if (e.chapter !== G.s.chapter || e.visit) continue;
    const d = lifeCh(e.chapter).events[e.id];
    if (d) out.push({ title: e.title, day: d });
  }
  return out.sort((a, b) => b.day - a.day).slice(0, 6);
}

/* ---------------- friends who come to stay ---------------- */
function guestCheck() {
  const g = G.s.life.guest;
  if (!g) return;
  if (G.s.time.day > g.until) {
    const def = GUESTS[g.id];
    G.s.life.guest = null;
    if (def && def.leave) playDialogue(def.leave(G.s));
    G.npcs = G.npcs.filter((n) => !n.guest);
    if (def && def.gift) grant(def.gift);
  }
}

export function startGuest(key) {
  const def = GUESTS[key];
  if (!def) return;
  G.s.life.guest = { id: key, until: G.s.time.day + (def.days || 2), talks: 0 };
  lifeCh().guested = key;
  if (G.map && G.map.id === homeMapId()) { const n = guestSpawn(G.map); if (n) { G.npcs = G.npcs.filter((x) => !x.guest); G.npcs.push(n); } }
}

/** The guest stands about the porch of the active home while they're staying. */
export function guestSpawn(m) {
  const g = G.s && G.s.life && G.s.life.guest;
  if (!g || visiting() || m.id !== homeMapId() || G.endless || G.prequel) return null;
  const def = GUESTS[g.id];
  const npc = def && NPCS[def.npc];
  const pt = m.points.porch || m.points.cabin_front || m.points.start;
  if (!npc || !pt) return null;
  return { id: 'guest_' + g.id, guestOf: def.npc, def: { ...npc, name: npc.name }, guest: true, x: pt.x + 34, y: pt.y + 10, radius: 10, angle: Math.PI / 2, path: null, walkPhase: 0, spot: 'porch' };
}

function guestTalk(n) {
  const g = G.s.life.guest, def = GUESTS[g.id];
  const pool = def.talks(G.s);
  const line = pool[g.talks % pool.length];
  g.talks++;
  playDialogue(Array.isArray(line) ? line : [line]);
  if (g.talks === 1) addRel(def.npc, 6);
}

/* ---------------- conversations that belong to the expansion ---------------- */
/** Called before the usual NPC menu. Returns true if it took the conversation. */
export function lifeTalk(n) {
  if (!G.s || G.endless || G.prequel) return false;
  if (quietTest() && !n.guest) return false;
  if (n.guest) { guestTalk(n); return true; }
  if (farewellTalk(n.id)) return true;
  if (n.id === 'ruth' && ruthTalk()) return true;
  for (const f of talkHooks) if (f(n)) return true;
  return false;
}
/** Other modules (letters, romance, investigations) add conversation hooks here. */
export const talkHooks = [];

function ruthTalk() {
  const s = G.s;
  if (visiting()) return false;
  const L = s.life;
  const today = s.time.day;
  if (Object.values(L.ruthTalks).includes(today)) return false; // one heart-to-heart a day
  const joined = s.companion && s.companion.ruth && s.companion.ruth.joined;
  const t = RUTH_TALKS.find((x) => !L.ruthTalks[x.id] && x.chapter === s.chapter && (x.joined == null || x.joined === !!joined) && (!x.after || stepAtLeast(x.after)) && (!x.needs || x.needs(s)));
  if (!t) return false;
  L.ruthTalks[t.id] = today;
  const pick = { value: null };
  playDialogue(withChoices(t.lines(s), pick), () => {
    if (t.reward) grant(t.reward);
    if (t.result) t.result(s, pick.value);
    addRel('ruth', 3);
    saveGame('talk');
  });
  return true;
}

/* ---------------- farewells ---------------- */
const chapterDone = () => !!((G.s.story.done || {})[G.s.chapter] || (G.s.chapter === 1 && G.s.story.chapterComplete));
export const farewellPeople = () => { const ch = chapter(); return [ch.neighbor, ch.shopkeeper, ch.jobContact].filter((id) => FAREWELLS[id]); };

function farewellTalk(id) {
  if (visiting() || !chapterDone() || G.s.chapter >= 5 || !FAREWELLS[id] || !farewellPeople().includes(id)) return false;
  const c = lifeCh();
  if (c.farewell[id]) return false;
  c.farewell[id] = G.s.time.day;
  const f = FAREWELLS[id];
  const pick = { value: null };
  playDialogue(withChoices(f.lines(G.s), pick), () => {
    if (f.gift) grant(f.gift);
    if (f.result) f.result(G.s, pick.value);
    addRel(id, 6);
    banner(`${NPCS[id].name.split(' ')[0].replace(/"/g, '')} will write. (${farewellsSaid()}/${farewellPeople().length} goodbyes said)`, 'good', 4);
    saveGame('farewell');
  });
  return true;
}
export const farewellsSaid = () => farewellPeople().filter((id) => lifeCh().farewell[id]).length;
export const farewellPending = () => chapterDone() && G.s.chapter < 5 && farewellsSaid() < farewellPeople().length;
export const saidGoodbye = (id, ch) => { for (let n = 1; n <= 5; n++) if ((ch == null || ch === n) && G.s.life.ch[n] && G.s.life.ch[n].farewell && G.s.life.ch[n].farewell[id]) return true; return false; };

export { CHAPTERS, TILE, relOf };
