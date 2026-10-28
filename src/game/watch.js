// The threat closing in: watcher signs to look into, the probing attack, what
// it leaves behind, counter-moves, friends' help, and how the real attack
// adapts to Frank's defenses. Content lives in data/watch.js and data/counter.js.
import { G } from './state.js';
import { TILE } from '../config.js';
import { chapter, homeMapId, homeMap, atHome, visiting } from './chapters.js';
import { addJP, addXP, relOf, addMoney } from './progression.js';
import { addItem } from './inventory.js';
import { playDialogue, dialogueActive } from '../ui/dialogue.js';
import { banner, toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { inHours, fmtWindow } from './calendar.js';
import { scheduleSiege } from './siege.js';
import { lifeCh, stepAtLeast, talkHooks } from './life.js';
import { addEvidence } from './evidence.js';
import { projectDone } from './projects.js';
import { WATCH } from '../data/watch.js';
import { COUNTER_ERRANDS, ALLY_HELP } from '../data/counter.js';
import { NPCS } from '../data/npcs.js';
import { hasPerk } from './perks.js';

const W = (n = G.s.chapter) => WATCH[n];
const wst = (n = G.s.chapter) => { const c = lifeCh(n); return c.watch || (c.watch = {}); };
const T = (x, y) => ({ x: x * TILE, y: y * TILE });

let story = null; // story.js hands over setStep and what comes after the probe
export function setWatchStory(s) { story = s; }

/** Nearest walkable cell to a tile position on a map (props must be reachable). */
export function freeSpot(m, x, y) {
  const cx0 = Math.floor(x), cy0 = Math.floor(y);
  for (let r = 0; r < 6; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const cx = cx0 + dx, cy = cy0 + dy;
    if (m.inBounds(cx, cy) && m.getSolid(cx, cy) === 0 && !m.blockerAt(cx, cy)) return r === 0 ? T(x, y) : { x: cx * TILE + 16, y: cy * TILE + 16 };
  }
  return T(x, y);
}

/* ---------------- the watcher phase ---------------- */
export const inWatch = () => !!(W() && W().step && G.s.story.step === W().step);
export const signsFound = (n = G.s.chapter) => Object.keys((wst(n).found) || {});

export function startWatch() {
  const w = W();
  if (!w || !w.step) return false;
  wst().found = wst().found || {};
  // Local Knowledge: one of the signs reached you through the grapevine.
  if (G.s.skills.includes('local_knowledge')) {
    const [id, sg] = Object.entries(w.signs).find(([, x]) => x.talk) || Object.entries(w.signs)[0];
    if (!wst().found[id]) { wst().found[id] = G.s.time.day; setTimeout(() => banner(`🔎 Local Knowledge — ${sg.note}`, 'objective', 6), 2500); }
  }
  playDialogue(w.intro, () => { story.setStep(w.step); if (G.map && G.map.id === homeMapId()) G.npcs.push(...watchVisitors(G.map)); });
  return true;
}

function signOpen(id) { return inWatch() && !wst().found[id]; }

/** Props for watcher signs and the aftermath on the home map. */
export function watchProps(mapId) {
  if (!G.s || G.endless || G.prequel || visiting() || mapId !== homeMapId()) return [];
  const w = W(), m = G.maps[mapId];
  if (!w || !m) return [];
  const out = [];
  if (inWatch()) {
    for (const [id, sg] of Object.entries(w.signs)) {
      if (!signOpen(id) || sg.talk || sg.visitor) continue;
      out.push({ watch: id, id: 'w_' + id, kind: 'watch', ...freeSpot(m, ...sg.at), r: 48, label: hasPerk('surveillance') ? `◎ ${sg.label}` : sg.label, mark: hasPerk('surveillance') });
    }
  }
  const a = w.aftermath, st = wst();
  if (a && st.after === 'pending') out.push({ watch: '_after', id: 'w_after', kind: 'watch', ...freeSpot(m, ...a.at), r: 52, label: a.label });
  return out;
}

export function watchPropAction(pr) {
  if (pr.watch === '_after') { examineAftermath(); return; }
  readSign(pr.watch);
}

function readSign(id) {
  const w = W(), sg = w.signs[id];
  if (!sg || !signOpen(id)) return;
  let pick = null;
  const lines = sg.lines.map((l) => (!l.choices ? l : { ...l, choices: l.choices.map((c) => ({ text: c.text, effect: () => { pick = c; return c.lines || []; } })) }));
  playDialogue(lines, () => {
    const st = wst();
    st.found[id] = G.s.time.day;
    if (pick) { (st.choices || (st.choices = {}))[id] = pick.value; if (pick.evidence) addEvidence(pick.evidence, true); }
    if (sg.evidence) addEvidence(sg.evidence, true);
    sfx('chime');
    addXP(15, 'Investigated'); addJP('shadow', hasPerk('surveillance') ? 10 : 6);
    G.npcs = G.npcs.filter((n) => n.watchSign !== id);
    const n = signsFound().length;
    if (n >= w.need) setTimeout(() => finishWatch(), 400);
    else banner(`🔎 ${sg.note} (${n}/${w.need} — something isn't right)`, 'objective', 5);
    saveGame('watch');
  });
}

function finishWatch() {
  const w = W();
  if (!inWatch() || wst().probeSet) return;
  wst().probeSet = true;
  playDialogue(w.done, () => { scheduleProbe(); story.setStep(w.probeStep); });
}

/** The small test attack: tonight at eleven (or tomorrow if it's already late). */
export function scheduleProbe() {
  const w = W(), t = G.s.time;
  const day = t.minute < 22 * 60 ? t.day : t.day + 1;
  scheduleSiege({ kind: 'probe', retry: true, hpMult: w.probe.hpMult || 1, waves: w.probe.waves.map((x) => ({ ...x, types: [...x.types] })) }, day, 23 * 60);
}

export const watchObjective = () => {
  const w = W(), n = signsFound().length;
  return `${w.title} Look into what doesn't fit around the house (${Math.min(n, w.need)}/${w.need}) — Journal → Cases lists what you've noticed.`;
};
export const probeObjective = () => (wst().after === 'pending' ? `They tested the house and ran. Look around for what they left behind.` : 'Someone will test the house tonight. Be home after dark — and stay alive.');

export function watchWaypoint() {
  const w = W(), m = homeMap();
  if (!w || !m) return null;
  if (wst().after === 'pending' && w.aftermath) return { map: m.id, ...freeSpot(m, ...w.aftermath.at), label: 'Look around' };
  if (inWatch()) {
    for (const [id, sg] of Object.entries(w.signs)) {
      if (!signOpen(id)) continue;
      if (sg.visitor && !inHours(sg.visitor.hours)) continue;
      if (sg.talk) { const n = G.npcs.find((x) => x.id === sg.talk && x.present); if (n) return { map: G.map.id, x: n.x, y: n.y, label: 'Ask' }; continue; }
      return { map: m.id, ...freeSpot(m, ...sg.at), label: 'Look' };
    }
  }
  if (G.s.story.step === w.probeStep) { const p = m.points.cabin_in; return p ? { map: m.id, ...p, label: 'Home' } : null; }
  return null;
}

/* ---------------- talk & visitor signs ---------------- */
talkHooks.push((n) => {
  const w = W();
  if (!w || !inWatch() || visiting()) return false;
  const e = Object.entries(w.signs).find(([id, sg]) => sg.talk === n.id && signOpen(id));
  if (!e) return false;
  readSign(e[0]);
  return true;
});

/** People who are part of a sign (the meter man, Richie on the ridge). */
export function watchVisitors(m) {
  const w = W();
  if (!w || !inWatch() || m.id !== homeMapId() || visiting()) return [];
  const out = [];
  for (const [id, sg] of Object.entries(w.signs)) {
    if (!sg.visitor || !signOpen(id)) continue;
    const p = freeSpot(m, ...sg.at);
    out.push({ id: 'visitor_' + id, watchSign: id, visitor: sg.visitor, def: { name: sg.visitor.name, body: sg.visitor.body, hair: sg.visitor.hair, skin: sg.visitor.skin }, x: p.x, y: p.y, radius: 10, angle: Math.PI / 2, path: null, walkPhase: 0, spot: id });
  }
  return out;
}
export const visitorPresent = (n) => inWatch() && !wst().found[n.watchSign] && inHours(n.visitor.hours);
export function visitorTalk(n) { readSign(n.watchSign); }

/* ---------------- after the probe ---------------- */
export function onProbeWon() {
  const w = W();
  if (!w || G.s.story.step !== w.probeStep) return false;
  if (G.s.chapter === 1) return false; // Chapter 1's own beats handle the rest
  setTimeout(() => {
    wst().after = 'pending';
    playDialogue(w.probeWon, () => { banner('Look around the property for what they left behind.', 'objective', 5); saveGame('probe'); });
  }, 2600);
  return true;
}

/** Chapter 1: the probe crew's parking spot, an optional clue. */
export function chapter1Aftermath() {
  if (G.s.chapter !== 1 || wst(1).after) return;
  wst(1).after = 'pending';
}

function examineAftermath() {
  const w = W(), st = wst();
  if (st.after !== 'pending') return;
  st.after = 'done';
  const a = w.aftermath;
  playDialogue(a.lines, () => {
    if (a.evidence) addEvidence(a.evidence, true);
    addXP(20, 'Aftermath'); addJP('shadow', 6);
    if (a.lead && COUNTER_ERRANDS[a.lead]) import('./errands.js').then((m) => { m.startErrand(a.lead); toast('A counter-move: you can use this before the real attack. (Journal → Side stories)', 'info', 5); });
    if (!a.optional && story.afterProbe) story.afterProbe(G.s.chapter);
    saveGame('aftermath');
  });
}

/* ---------------- friends' help in the last days ---------------- */
export const helpWindow = (n = G.s.chapter) => {
  const rat = { 1: 'ch1_rat', 2: 'ch2_rat', 3: 'ch3_rat', 4: 'ch4_rat', 5: 'ch5_rat' }[n];
  return n === G.s.chapter && stepAtLeast(rat) && !lifeCh(n).siegeStarted && !(G.s.story.done || {})[n];
};
talkHooks.push((n) => {
  const h = ALLY_HELP[n.id];
  if (!h || h.ch !== G.s.chapter || visiting() || !helpWindow()) return false;
  const c = lifeCh();
  c.help = c.help || {};
  if (c.help[n.id] || relOf(n.id) < h.minRel) return false;
  let v = null;
  const lines = h.lines.map((l) => (!l.choices ? l : { ...l, choices: l.choices.map((x) => ({ text: x.text, effect: () => { v = x.value; return x.lines || []; } })) }));
  playDialogue(lines, () => {
    c.help[n.id] = v || 'no';
    if (v === 'yes') {
      if (n.id === 'gus') addItem('wood', 4, true);
      banner(`${NPCS[n.id].name.split(' ')[0]} will help when the attack comes. ${COUNTER_ERRANDS[`k${G.s.chapter}_help_${n.id}`].effect}`, 'good', 7);
    }
    saveGame('help');
  });
  return true;
});

/** Who could still be asked for help this chapter (for the Journal). */
export function helpOptions() {
  const out = [];
  for (const [id, h] of Object.entries(ALLY_HELP)) {
    if (h.ch !== G.s.chapter) continue;
    const c = lifeCh().help || {};
    out.push({ id, name: NPCS[id].name, asked: c[id] || null, ok: relOf(id) >= h.minRel, open: helpWindow(), effect: COUNTER_ERRANDS[`k${G.s.chapter}_help_${id}`].effect, minRel: h.minRel });
  }
  return out;
}

/* ---------------- how the real attack adapts ---------------- */
/** What the crew has learned about the house, and what they'll do about it. Max two, always telegraphed. */
export function predictAdapt() {
  const s = G.s, h = s.home, o = h.openings || {};
  const out = [];
  const lights = h.upgrades.floodlight;
  if (lights) out.push({ id: 'power', text: 'They\'ve seen your floodlight. Expect someone to cut the power when it starts.', counter: projectDone('generator') ? 'Your backup generator will bring the lights back.' : 'A backup generator (Home tab) would bring the lights back.' });
  const front = o.front_door || o.front_l;
  if (front && front.reinforced) out.push({ id: 'flank', text: 'The front door is braced. One crew will try another side.', counter: 'Fortify the back and sides too.' });
  if (h.upgrades.camera && out.length < 2) out.push({ id: 'cams', text: 'They know about the cameras. The first crew will try to keep out of their sight.', counter: 'Watch the first wave yourself.' });
  return out.slice(0, 2);
}

/** Apply counter-moves, help, watcher choices and adaptations to a story or probe plan as the attack starts. */
export function adaptPlan(plan) {
  if (!plan || plan.adapted || G.endless || G.prequel) return plan;
  const n = G.s.chapter, c = lifeCh(n), k = (id) => (G.s.errands[id] || {}).state === 'done', help = c.help || {}, wc = (c.watch || {}).choices || {};
  plan.adapted = true;
  plan.notes = [];
  const waves = plan.waves;
  const wave = (dir) => waves.find((w) => w.dir === dir);
  const drop = (w, t) => { if (!w) return; const i = t ? w.types.lastIndexOf(t) : w.types.length - 1; if (i >= 0 && w.types.length > 1 && i !== w.boss) w.types.splice(i, 1); };
  if (plan.kind === 'story') {
    c.siegeStarted = G.s.time.day;
    if (n === 1 && k('k1_blind')) { drop(waves[0], 'scout'); plan.notes.push('No spotter: one fewer scout.'); }
    if (n === 1 && help.gus === 'yes') { const w = wave('west'); if (w) w.delay += 25; plan.notes.push('Gus\'s truck blocks the west trail.'); }
    if (n === 2 && G.s.errands.k2_lot && G.s.errands.k2_lot.state === 'done' && G.s.errands.k2_lot.choice === 'tires') { waves[0].delay += 15; for (const w of waves.slice(1)) w.delay += 15; plan.notes.push('Flat tires: they\'re late.'); }
    if (n === 2 && help.marcus === 'yes') { waves[0].spot = true; plan.notes.push('Marcus marks the first crew.'); }
    if (n === 3 && k('k3_ford')) { const w = wave('south'); if (w) { w.delay += 20; drop(w, 'arsonist'); } plan.notes.push('The ford is blocked.'); }
    if (n === 3 && help.ingrid === 'yes') { const w = wave('east'); if (w) w.spot = true; plan.notes.push('Ingrid\'s tractor lights the east field.'); }
    if (n === 4 && k('k4_channel')) { const w = wave('lake'); if (w) { w.delay += 20; drop(w, 'gunman'); } plan.notes.push('The channel is chained.'); }
    if (n === 4 && help.walt === 'yes') { const w = wave('lake'); if (w) w.spot = true; plan.notes.push('Walt marks the boats.'); }
    if (n === 4 && wc.gate === 'feed') { const w = wave('west'); if (w) w.delay += 15; }
    if (n === 5 && k('k5_richie')) { drop(wave('north'), 'scout'); plan.notes.push('Richie didn\'t drive.'); }
    if (n === 5 && G.s.life.deduced === 'title') { drop(wave('ravine'), 'scout'); plan.notes.push('Leo\'s paper eyes are gone.'); }
    // The crew answers your preparations — fairly, and you were told.
    for (const a of predictAdapt()) {
      if (a.id === 'power') plan.cutPower = true;
      if (a.id === 'flank' && waves.length > 1) { const spots = Object.keys(homeMap().spawns); const used = new Set(waves.map((w) => w.dir)); const alt = spots.find((d) => !used.has(d) && !['lake', 'shore'].includes(d)); if (alt) waves[1].dir = alt; }
      if (a.id === 'cams') waves[0].noCam = true;
    }
  }
  if (plan.kind === 'probe') {
    if (n === 3 && wc.fence === 'mend') { const w = wave('westfield'); if (w) w.dir = 'southwest'; }
  }
  return plan;
}

/** Extra minutes of warning from what Frank set up this chapter. */
export function leadBonus(plan) {
  if (!plan || G.endless || G.prequel) return 0;
  const n = G.s.chapter, c = lifeCh(n), help = c.help || {}, wc = (c.watch || {}).choices || {};
  let m = c.roadWatch ? 60 : 0; // Trusted Friend: someone's watching the road
  if (plan.kind !== 'story' && plan.kind !== 'probe') return m;
  if (plan.kind === 'story') {
    if (n === 2 && help.marcus === 'yes') m += 60;
    if (n === 2 && G.s.errands.k2_lot && G.s.errands.k2_lot.state === 'done' && G.s.errands.k2_lot.choice === 'plate') m += 60;
    if (n === 4 && help.walt === 'yes') m += 60;
    if (n === 3 && wc.fence === 'watch') m += 45;
    if (n === 5 && wc.richie === 'hi') m += 60;
  }
  if (n === 2 && wc.package === 'feed') m += 45;
  return m;
}

/* ---------------- power cuts ---------------- */
export function updatePower(dt) {
  const sg = G.siege;
  if (!sg || !sg.plan.cutPower || !atHome()) return;
  sg.powerT = (sg.powerT || 0) + dt;
  if (!sg.powerCut && sg.waveIdx >= 1 && sg.powerT > 12) {
    sg.powerCut = true;
    sg.powerOut = true;
    sfx('warning');
    banner('The lights die. Somebody cut the power line.', 'danger', 4);
    if (projectDone('generator')) sg.genAt = sg.powerT + 10;
  }
  if (sg.powerOut && sg.genAt && sg.powerT >= sg.genAt) { sg.powerOut = false; sg.genAt = 0; sfx('chime'); banner('The backup generator coughs to life. Lights back on.', 'good', 4); }
}
export const powerOut = () => !!(G.siege && G.siege.powerOut && atHome());
export function restorePower() { if (!powerOut()) return false; G.siege.powerOut = false; sfx('hammer'); banner('You splice the line back together. Lights on.', 'good', 3); return true; }

/* ---------------- errands ---------------- */
export const WATCH_ERRANDS = Object.fromEntries(Object.entries(COUNTER_ERRANDS).filter(([, e]) => !e.help));

/* ---------------- people who know something about the Paper Trail ---------------- */
const TRAIL_TALKS = [
  { npc: 'dee', ch: 1, ev: 't1_realtor', ready: () => stepAtLeast('prepare'), lines: [
    { who: 'Dee Marsh', text: 'Frank, something\'s been bugging me. When you bought the cabin, the realtor told me a "title clerk from New Jersey" phoned her to confirm the buyer\'s name.' },
    { who: 'Dee Marsh', text: 'That was weeks before that grey coat showed up. Title clerks don\'t call realtors in Pine Hollow. Nobody calls realtors in Pine Hollow.' },
  ] },
  { npc: 'marcus', ch: 2, ev: 't2_marcus', ready: () => !!(G.s.life.evidence.t2_parcel || G.s.life.evidence.t1_closing) && relOf('marcus') >= 1, lines: [
    { who: 'Marcus Bell', text: '(He looks at the printout a long time.) You paid cash for this house. And the cabin before it.' },
    { who: 'Marcus Bell', text: 'WITSEC rule one: never buy with cash. Cash closings get flagged — by the banks, by the IRS, and by anybody who owns a title company. I\'d have told you, if you\'d asked.' },
  ] },
];
talkHooks.push((n) => {
  if (visiting()) return false;
  const t = TRAIL_TALKS.find((x) => x.npc === n.id && x.ch === G.s.chapter && !G.s.life.evidence[x.ev] && x.ready());
  if (!t) return false;
  playDialogue(t.lines, () => addEvidence(t.ev, true));
  return true;
});

export function initWatchEvents() {
  G.events.on('errandDone', (id) => {
    if (id === 'eleanor_1') addEvidence('t4_edward');
    if (id === 'angie_2') addEvidence('t5_joey');
  });
  G.events.on('siegeWon', (sg) => { if (sg.plan.kind === 'probe' && G.s.chapter === 1 && G.s.story.step === 'probe') chapter1Aftermath(); });
  G.events.on('siegeStart', () => { if (!G.endless && !G.prequel) lifeCh().roadWatch = false; });
  // When the real attack is set, say what the crew has learned about the house.
  G.events.on('storyStep', (step) => {
    if (!/^(first_siege|ch\d_siege)$/.test(step)) return;
    const a = predictAdapt();
    if (!a.length) return;
    setTimeout(() => { for (const x of a) toast(`⚠ ${x.text} ${x.counter}`, 'warn', 7); }, 2500);
  });
}

/** Every tile spot the watcher phase may use on a map (kept clear of building sites). */
export function watchSpots(mapId) {
  const out = [];
  for (const [n, w] of Object.entries(WATCH)) {
    const ch = Number(n);
    const map = { 1: 'cabin', 2: 'millbrook', 3: 'farm', 4: 'estate', 5: 'shorthills' }[ch];
    if (map !== mapId) continue;
    for (const sg of Object.values(w.signs || {})) if (sg.at) out.push(sg.at);
    if (w.aftermath) out.push(w.aftermath.at);
  }
  return out;
}
