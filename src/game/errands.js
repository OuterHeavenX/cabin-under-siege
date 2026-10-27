// Errands: small multi-step tasks that the main story is built around —
// chores that make a house a home, and favors for the townsfolk who decide
// whether the newcomer is one of them. Each errand is a list of stages:
//   bring   — have N of an item, then talk to the giver (items are handed over)
//   buy     — buy N things of a kind at a shop
//   chop    — swing an axe N times at a spot
//   repair  — the hammer minigame at a spot (optionally costs wood)
//   visit   — walk up to a spot and press ACT (optional lines play)
//   find    — search one of several spots (picked at random)
//   return  — talk to the giver
import { G } from './state.js';
import { TILE } from '../config.js';
import { NPCS, TOWNSFOLK } from '../data/npcs.js';
import { ITEMS } from '../data/items.js';
import { addItem, count, removeItem } from './inventory.js';
import { addJP, addMoney, addRel, addXP, derived } from './progression.js';
import { playDialogue } from '../ui/dialogue.js';
import { openRepairGame } from '../ui/menus.js';
import { banner, toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { choose } from '../util.js';
import { chapter } from './chapters.js';
import { hasSkill } from './state.js';

const T = (x, y) => ({ x: x * TILE, y: y * TILE });
const FOOD = new Set(['sandwich', 'stew']);

export const ERRANDS = {
  /* ---------------- Chapter 1, act 1: settling in ---------------- */
  chore_logs: {
    chapter: 1, chore: true, giver: 'ruth', title: 'A Cold Night',
    desc: 'Ruth\'s wood stove is out and her hands are too stiff to swing an axe. Bring her 10 wood.',
    stages: [{ type: 'bring', item: 'wood', n: 10, label: 'Bring Ruth 10 wood (chop any tree)' }],
    done: [
      { who: 'Ruth Calloway', text: 'Ten good splits, stacked neat. Harold never stacked neat.' },
      { who: 'Ruth Calloway', text: 'Sit. There\'s stew. ...You eat like a man who\'s been running a long time, Frank.' },
    ],
    reward: { xp: 40, rel: ['ruth', 16], jp: ['neighbor', 8], items: { stew: 2, bandage: 2 } },
  },
  chore_door: {
    chapter: 1, chore: true, title: 'The Back Door Sticks',
    desc: 'The cabin\'s back door swells shut. Plane it down so it closes — and locks.',
    stages: [{ type: 'repair', map: 'cabin', at: [24.5, 18.1], hits: 3, label: 'Plane down the sticking back door (Toolkit)' }],
    done: [{ who: 'Frank', text: 'Closes clean, locks tight. Harold, you owe me one.' }],
    reward: { xp: 25, jp: ['handyman', 6] },
  },
  chore_roof: {
    chapter: 1, chore: true, title: 'Leaky Roof',
    desc: 'Rain gets in over the west wall. Patch it before the weather turns (4 wood).',
    stages: [{ type: 'repair', map: 'cabin', at: [21.5, 24.6], hits: 4, wood: 4, label: 'Patch the roof leak (Toolkit + 4 wood)' }],
    done: [{ who: 'Frank', text: 'No more bucket under the drip. Small victories.' }],
    reward: { xp: 30, jp: ['handyman', 8], items: { wood: 1 } },
  },
  chore_pantry: {
    chapter: 1, chore: true, title: 'Stock the Pantry',
    desc: 'The cupboards hold two cans of beans and a mouse. Buy groceries at Marsh General in Pine Hollow.',
    stages: [{ type: 'buy', what: 'food', n: 3, label: 'Buy 3 groceries at Marsh General' }],
    done: [{ who: 'Dee Marsh', text: 'Three bags of real food. Good. A man who stocks a pantry is planning to stay.' }],
    reward: { xp: 20, rel: ['dee', 8], jp: ['neighbor', 4] },
  },
  chore_drive: {
    chapter: 1, chore: true, title: 'Clear the Driveway',
    desc: 'Last night\'s wind dropped a pine across your driveway. Until it\'s gone, the car stays put — you\'ll have to walk to town.',
    stages: [{ type: 'chop', map: 'cabin', at: [24.5, 36.2], n: 6, label: 'Saw through the pine across the driveway' }],
    done: [{ who: 'Frank', text: 'Driveway\'s clear. And I\'ve got firewood for a week.' }],
    reward: { xp: 25, jp: ['survivor', 6], items: { wood: 3 } },
  },

  /* ---------------- Chapter 1, act 2: the townsfolk ---------------- */
  abe_pies: {
    chapter: 1, giver: 'folk2', title: 'The Bake Sale',
    desc: 'Pastor Abe\'s bake sale needs Dee\'s pies carried over to the chapel.',
    offer: [{ who: 'Pastor Abe', text: 'You\'re Frank! Welcome, welcome. Could I trouble you? Dee baked six pies for Sunday\'s sale and my back is a sinner.' }],
    stages: [
      { type: 'visit', map: 'town', at: [12.5, 16.4], label: 'Pick up the pie boxes at Marsh General', lines: [{ who: 'Dee Marsh', text: 'Pies for Abe? Don\'t you dare tip them. And the cherry one is spoken for. By me.' }] },
      { type: 'visit', map: 'town', at: [39.5, 18.6], label: 'Leave the pies at the chapel door' },
    ],
    done: [{ who: 'Pastor Abe', text: 'Bless you. I\'ll tell the congregation the newcomer has a good heart and strong arms. Both are rarer than you\'d think.' }],
    reward: { money: 20, xp: 30, rel: ['dee', 4], jp: ['neighbor', 8], items: { sandwich: 2 } },
  },
  jenny_cat: {
    chapter: 1, giver: 'folk3', title: 'Up a Tree',
    desc: 'Jenny Miller\'s cat, Mittens, bolted out the door and is stuck somewhere high.',
    offer: [{ who: 'Jenny Miller', text: 'Mister! Have you seen a fat orange cat? Mittens got out and she can climb up but never down. She\'s somewhere around town.' }],
    stages: [
      { type: 'find', map: 'town', spots: [[30.5, 6.5], [4.5, 33.5], [58.5, 13.5], [45.5, 37.5]], animal: 'cat', label: 'Find Mittens the cat' },
      { type: 'return', label: 'Bring Mittens back to Jenny Miller' },
    ],
    found: 'Mittens glares at you from a branch, then drops onto your shoulder like she planned it.',
    done: [{ who: 'Jenny Miller', text: 'MITTENS! Oh, thank you! Mom says you can come to dinner. She makes the best pot roast in the county. That\'s a fact.' }],
    reward: { money: 15, xp: 30, jp: ['neighbor', 6], items: { stew: 1 } },
  },
  henderson_fence: {
    chapter: 1, giver: 'folk1', title: 'Fence Mending',
    desc: 'Mr. Henderson\'s back fence is down and the neighbor\'s goats are eating his tomatoes.',
    offer: [{ who: 'Mr. Henderson', text: 'You the fella fixing up the Calloway cabin? Then you can swing a hammer. My back fence is down and those goats are a plague.' }],
    stages: [
      { type: 'repair', map: 'town', at: [56.5, 16.2], hits: 3, wood: 2, label: 'Mend Mr. Henderson\'s fence (Toolkit + 2 wood)' },
      { type: 'return', label: 'Tell Mr. Henderson his fence is fixed' },
    ],
    done: [{ who: 'Mr. Henderson', text: 'Goats foiled. Tomatoes saved. Here — my late wife\'s first-aid kit. Never needed it. You look like you might.' }],
    reward: { money: 20, xp: 30, jp: ['handyman', 6], items: { medkit: 1 } },
  },
  tibbs_wood: {
    chapter: 1, giver: 'folk11', title: 'Old Man Tibbs\'s Firewood',
    desc: 'Old Man Tibbs can\'t split his winter wood anymore. Ten good swings at his woodpile.',
    offer: [{ who: 'Old Man Tibbs', text: 'Eighty-eight years old and the woodpile still wants splitting. Ten swings, young man, and I\'ll tell you about Korea.' }],
    stages: [
      { type: 'chop', map: 'town', at: [31.5, 31.5], n: 10, label: 'Split Old Man Tibbs\'s firewood' },
      { type: 'return', label: 'Tell Old Man Tibbs the wood\'s split' },
    ],
    done: [
      { who: 'Old Man Tibbs', text: 'Clean splits. You\'ve done this before. ...Funny, you hold an axe like you were taught to hold something else.' },
      { who: 'Old Man Tibbs', text: 'Here. My old army shells — they still fire. Don\'t tell the sheriff.' },
    ],
    reward: { money: 10, xp: 35, jp: ['survivor', 8], items: { ammo: 16 } },
  },

  /* ---------------- Chapter 1, act 2: the watcher ---------------- */
  trail: {
    chapter: 1, story: true, title: 'Boot Prints',
    desc: 'Someone has been standing outside your window at night.',
    stages: [
      { type: 'visit', map: 'cabin', at: [19.5, 28.6], label: 'Examine the boot prints by the window', lines: [
        { who: 'Frank', text: 'Size twelve. City shoes, not boots — the heel\'s too narrow. He stood here a long time; the grass is flat.' },
        { who: 'Frank', text: 'The prints go north, into the woods. Toward the hill.' },
      ] },
      { type: 'visit', map: 'cabin', at: [9.5, 7.5], label: 'Follow the trail to the hill in the north woods', lines: [
        { who: 'Frank', text: 'A hunting blind. Somebody\'s been living rough up here. A thermos, a folding chair, binoculars pointed straight at my cabin.' },
        { who: 'Frank', text: 'Cigarette butts. Parliament. Somebody brought these all the way from Jersey.' },
        { who: 'Frank', text: '...Leo always liked Parliaments.' },
      ] },
    ],
    done: [],
    reward: { xp: 40, jp: ['shadow', 12] },
  },

  /* ---------------- Chapter 5, act 1: coming home ---------------- */
  ch5_lane: {
    chapter: 5, chore: true, title: 'The Overgrown Lane',
    desc: 'Nobody has driven up to the watch house in twenty years. A dead oak lies across the lane.',
    stages: [{ type: 'chop', map: 'shorthills', at: [56.5, 19.6], n: 6, label: 'Cut up the dead oak across the lane' }],
    done: [{ who: 'Frank', text: 'Lane\'s clear. From the porch you can see the lights of Leo\'s house across the ravine.' }],
    reward: { xp: 25, jp: ['survivor', 6], items: { wood: 4 } },
  },
  ch5_gen: {
    chapter: 5, chore: true, title: 'Dead Generator',
    desc: 'Edward Whitcombe kept a generator behind the watch house. It hasn\'t run since the nineties.',
    stages: [{ type: 'repair', map: 'shorthills', at: [49.5, 4.8], hits: 4, wood: 2, label: 'Get the old generator running (Toolkit + 2 wood)' }],
    done: [{ who: 'Frank', text: 'It coughs, it shudders, and the lights come on. If Leo cuts the power, he\'ll have to try harder.' }],
    reward: { xp: 30, jp: ['handyman', 8] },
  },
  ch5_pantry: {
    chapter: 5, chore: true, title: 'Groceries from Marchetti\'s',
    desc: 'The watch house has a fridge full of nothing. Angie Marchetti\'s deli is on Millburn Avenue.',
    stages: [{ type: 'buy', what: 'food', n: 3, shop: 'angie', label: 'Buy 3 groceries at Marchetti\'s' }],
    done: [{ who: 'Angie Marchetti', text: 'Three sandwiches. You always did eat like a man about to be arrested.' }],
    reward: { xp: 20, rel: ['angie', 8], jp: ['neighbor', 4] },
  },
  ch5_candle: {
    chapter: 5, chore: true, title: 'A Candle for Mom',
    desc: 'Rosa Corsetti is buried behind St. Rose. You never came to the funeral.',
    stages: [{ type: 'visit', map: 'shorthills', at: [19.5, 15.4], label: 'Light a candle at St. Rose for your mother', lines: [
      { who: 'Frank', text: 'Thirty-one candles in the rack. One of them has a little card under it: R.C. — every Friday.' },
      { who: 'Frank', text: '...Sorry, Ma. I\'m home. For a little while.' },
    ] }],
    done: [],
    reward: { xp: 30, rel: ['dom', 10], jp: ['neighbor', 6] },
  },
  /* ---------------- Chapter 5, act 2: the avenue ---------------- */
  ferraro_rosary: {
    chapter: 5, giver: 'folk12', title: 'Mrs. Ferraro\'s Rosary',
    desc: 'Mrs. Ferraro dropped her mother\'s rosary somewhere on the way to Mass.',
    offer: [{ who: 'Mrs. Ferraro', text: 'Rosa Corsetti\'s boy! Help an old woman. My mother\'s rosary — I had it at the bakery, I had it at the church, and now I don\'t have it.' }],
    stages: [
      { type: 'find', map: 'shorthills', spots: [[12.5, 18.6], [24.5, 19.4], [38.5, 26.5], [21.5, 27.5]], label: 'Find Mrs. Ferraro\'s rosary' },
      { type: 'return', label: 'Bring the rosary back to Mrs. Ferraro' },
    ],
    found: 'Pearl beads and a silver cross, caught in a storm grate. Still warm from the sun.',
    done: [{ who: 'Mrs. Ferraro', text: 'God bless you. Your mother would be so proud. Here — I made too many pizzelle. I always make too many pizzelle.' }],
    reward: { money: 20, xp: 30, jp: ['neighbor', 8], items: { sandwich: 2 } },
  },
  paulie_papers: {
    chapter: 5, giver: 'folk13', title: 'The Paper Route',
    desc: 'Paulie\'s bike has a flat and the Star-Ledger waits for no one.',
    offer: [{ who: 'Paulie the paperboy', text: 'Mister, my bike\'s busted and Mr. Doyle and Father Dom both get the paper. Mr. Doyle yells. Father Dom prays at you. Which is worse?' }],
    stages: [
      { type: 'visit', map: 'shorthills', at: [29.5, 20.4], label: 'Drop a paper at the Doyle house' },
      { type: 'visit', map: 'shorthills', at: [18.5, 19.4], label: 'Drop a paper at the rectory', lines: [{ who: 'Frank', text: 'Front page: "ESSEX COUNTY GRAND JURY CONVENES." Somebody in Short Hills isn\'t sleeping well.' }] },
      { type: 'return', label: 'Tell Paulie the papers are delivered' },
    ],
    done: [{ who: 'Paulie the paperboy', text: 'You\'re a lifesaver! Here\'s three bucks. That\'s the whole tip economy of Short Hills, mister.' }],
    reward: { money: 3, xp: 25, jp: ['neighbor', 6] },
  },
  vito_bocce: {
    chapter: 5, giver: 'folk14', title: 'The Bocce Court',
    desc: 'Old Vito\'s bocce court has a broken backboard. The Sunday tournament is sacred.',
    offer: [{ who: 'Old Vito', text: 'Corsetti! I played bocce with your grandfather. He cheated. Fix my backboard and I won\'t tell anyone.' }],
    stages: [
      { type: 'repair', map: 'shorthills', at: [39, 25.6], hits: 3, wood: 2, label: 'Fix the bocce backboard (Toolkit + 2 wood)' },
      { type: 'return', label: 'Tell Old Vito the court is ready' },
    ],
    done: [{ who: 'Old Vito', text: 'Beautiful. Straight as a judge. ...Not one of Leo\'s judges. Here, my old service pistol rounds. Korea. Still good.' }],
    reward: { money: 10, xp: 30, jp: ['handyman', 6], items: { ammo: 16 } },
  },
  /* ---------------- Chapter 5, act 2: recon ---------------- */
  recon: {
    chapter: 5, story: true, title: 'Eyes on the House',
    desc: 'Watch Leo\'s compound from the ravine railing.',
    stages: [
      { type: 'visit', map: 'shorthills', at: [60.4, 9.5], label: 'Watch the front gate from the north overlook', lines: [
        { who: 'Frank', text: 'Front gate: iron, electric, two men in a hut. They change shifts at midnight. Nobody\'s getting through that without a truck.' },
      ] },
      { type: 'visit', map: 'shorthills', at: [60.4, 26.5], label: 'Watch the house from the middle overlook', lines: [
        { who: 'Frank', text: 'The study light is on. Second floor of nothing — Leo never liked stairs. North side, center. Dante Ruggiero sits outside it like a dog.' },
      ] },
      { type: 'visit', map: 'shorthills', at: [60.4, 41.5], label: 'Watch the grounds from the south overlook', lines: [
        { who: 'Frank', text: 'A service road on the west side, by the pool house. One gap in the wall. Dogs. More men than he needs.' },
        { who: 'Frank', text: 'I can\'t do this alone. Time to call in every favor I have.' },
      ] },
    ],
    done: [],
    reward: { xp: 50, jp: ['shadow', 15] },
  },
};

const est = () => G.s.errands || (G.s.errands = {});
export const errandState = (id) => est()[id] || null;
export const errandDone = (id) => (est()[id] || {}).state === 'done';

export function startErrand(id, quiet = false) {
  const e = ERRANDS[id];
  if (!e || est()[id]) return;
  const rec = { state: 'active', stage: 0, progress: 0 };
  est()[id] = rec;
  prepStage(id);
  if (!quiet) { sfx('blip'); banner(`${e.chore ? 'Chore' : 'Errand'}: ${e.title} — ${stageLabel(id)}`, 'objective', 4.5); }
}

function prepStage(id) {
  const rec = est()[id], st = ERRANDS[id].stages[rec.stage];
  rec.progress = 0;
  rec.spot = st && st.spots ? choose(st.spots) : null;
  if (st && st.type === 'buy') rec.progress = 0;
}

export function stageLabel(id) {
  const rec = est()[id], e = ERRANDS[id];
  if (!rec || rec.state === 'done') return 'Done';
  const st = e.stages[rec.stage];
  if (!st) return '';
  if (st.type === 'bring') return `${st.label} (${Math.min(count(st.item), st.n)}/${st.n})`;
  if (st.type === 'buy') return `${st.label} (${rec.progress}/${st.n})`;
  if (st.type === 'chop') return `${st.label} (${rec.progress}/${st.n})`;
  return st.label;
}

export function activeErrands() {
  return Object.entries(est()).filter(([id, r]) => ERRANDS[id] && r.state === 'active' && ERRANDS[id].chapter === G.s.chapter).map(([id, r]) => ({ id, ...ERRANDS[id], rec: r }));
}

export function choresStatus() {
  const ids = Object.keys(ERRANDS).filter((id) => ERRANDS[id].chore && ERRANDS[id].chapter === G.s.chapter);
  return { ids, done: ids.filter(errandDone).length, need: chapter().choresNeeded || 4 };
}

export function townErrandsDone() {
  return Object.keys(ERRANDS).filter((id) => ERRANDS[id].chapter === G.s.chapter && !ERRANDS[id].chore && !ERRANDS[id].story && errandDone(id)).length;
}

function advance(id) {
  const rec = est()[id], e = ERRANDS[id];
  rec.stage++;
  if (rec.stage >= e.stages.length) return complete(id);
  prepStage(id);
  sfx('chime');
  banner(`${e.title}: ${stageLabel(id)}`, 'objective', 4);
  saveGame('errand');
}

function complete(id) {
  const rec = est()[id], e = ERRANDS[id];
  rec.state = 'done';
  const r = e.reward || {};
  const finish = () => {
    sfx('jobDone');
    banner(`${e.chore ? 'Chore' : e.story ? 'Done' : 'Errand'} complete: ${e.title}`, 'good', 3.5);
    if (r.money) addMoney(r.money, 'errand');
    if (r.xp) addXP(r.xp, e.chore ? 'Chore' : 'Errand');
    if (r.rel) addRel(r.rel[0], r.rel[1]);
    if (r.jp) addJP(r.jp[0], r.jp[1]);
    for (const [item, n] of Object.entries(r.items || {})) {
      const got = addItem(item, n, true);
      if (got) toast(`Received: ${ITEMS[item].name}${n > 1 ? ' ×' + got : ''}`, 'item', 3);
    }
    G.events.emit('errandDone', id);
    saveGame('errand');
  };
  if (e.done && e.done.length) playDialogue(e.done, finish); else finish();
}

/** Props this map should show for active errands. */
export function errandProps(mapId) {
  const out = [];
  for (const e of activeErrands()) {
    const st = e.stages[e.rec.stage];
    if (!st || st.map !== mapId) continue;
    const base = { errand: e.id, id: 'er_' + e.id, label: stageLabel(e.id) };
    if (st.type === 'chop') out.push({ ...base, kind: 'quest_chop', ...T(...st.at), r: 52 });
    else if (st.type === 'repair') out.push({ ...base, kind: 'quest_repair', ...T(...st.at), r: 48 });
    else if (st.type === 'visit') out.push({ ...base, kind: 'quest_done', ...T(...st.at), r: 46, visit: true });
    else if (st.type === 'find') out.push({ ...base, kind: 'quest_find', ...T(...e.rec.spot), r: 46, animal: st.animal, label: st.animal === 'cat' ? 'Coax Mittens down' : 'Search here' });
  }
  return out;
}

/** Interacting with an errand prop. */
export function errandPropAction(pr) {
  const id = pr.errand, rec = est()[id];
  if (!rec || rec.state !== 'active') return;
  const st = ERRANDS[id].stages[rec.stage];
  if (st.type === 'chop') {
    const p = G.player;
    const cost = 8 * derived().staminaMult;
    if (p.stamina < cost) { toast('Too tired. Catch your breath.', 'warn'); return; }
    p.stamina -= cost; p.chopAnim = 0.25; sfx('chop');
    rec.progress++;
    if (rec.progress >= st.n) { sfx('treefall'); advance(id); }
  } else if (st.type === 'repair') {
    if (count('toolkit') < 1) { toast('You need a Toolkit for this (Okafor Lumber sells them).', 'warn', 3); return; }
    if (st.wood && count('wood') < st.wood) { toast(`You need ${st.wood} wood for this. Chop a tree.`, 'warn', 3); return; }
    openRepairGame({ title: ERRANDS[id].title, hits: st.hits || 3, wide: hasSkill('quick_fix'), onDone: () => { if (st.wood) removeItem('wood', st.wood); advance(id); } });
  } else if (st.type === 'visit') {
    sfx('pickup');
    if (st.lines) playDialogue(st.lines, () => advance(id)); else advance(id);
  } else if (st.type === 'find') {
    sfx('chime');
    const e = ERRANDS[id];
    if (e.found) playDialogue([{ who: 'Frank', text: e.found }], () => advance(id)); else advance(id);
  }
}

/** Talking to someone: hand in 'bring' / 'return' stages. Returns true if handled. */
export function errandTalk(npcId) {
  for (const e of activeErrands()) {
    if (e.giver !== npcId) continue;
    const st = e.stages[e.rec.stage];
    if (st.type === 'bring') {
      if (count(st.item) < st.n) continue;
      removeItem(st.item, st.n);
      advance(e.id);
      return true;
    }
    if (st.type === 'return') { advance(e.id); return true; }
  }
  return false;
}

/** A townsperson with an errand to offer right now, or null. */
export function errandOffer(npcId) {
  if (!G.s.story.flags.townOpen) return null;
  for (const [id, e] of Object.entries(ERRANDS)) {
    if (e.giver === npcId && e.offer && e.chapter === G.s.chapter && !est()[id]) return id;
  }
  return null;
}

export function offerErrand(npcId) {
  const id = errandOffer(npcId);
  if (!id) return false;
  const e = ERRANDS[id];
  const who = e.offer[0].who;
  playDialogue([...e.offer, {
    who, text: 'Could you help?',
    choices: [
      { text: '"Sure. Happy to."', effect: () => { startErrand(id); return []; } },
      { text: '"Not right now."', effect: () => [{ who, text: 'Oh — another time, then.' }] },
    ],
  }]);
  return true;
}

export function initErrandEvents() {
  G.events.on('itemBought', (item, n) => {
    for (const e of activeErrands()) {
      const st = e.stages[e.rec.stage];
      if (st.type !== 'buy') continue;
      if (st.what === 'food' && !FOOD.has(item)) continue;
      e.rec.progress = Math.min(st.n, e.rec.progress + 1);
      if (e.rec.progress >= st.n) advance(e.id);
      else toast(`${e.title}: ${stageLabel(e.id)}`, 'info', 2);
    }
  });
}

/** Where the first unfinished errand wants you (optionally only chores / only story). */
export function errandWaypoint(filter = () => true) {
  for (const e of activeErrands()) {
    if (!filter(e)) continue;
    const st = e.stages[e.rec.stage];
    if (st.type === 'bring' || st.type === 'return') {
      if (st.type === 'bring' && count(st.item) < st.n) continue;
      const n = G.npcs.find((x) => x.id === e.giver);
      if (n && G.map.id === mapOfGiver(e.giver)) return { map: G.map.id, x: n.x, y: n.y, label: shortName(e.giver) };
      const pt = giverPoint(e.giver);
      if (pt) return { ...pt, label: shortName(e.giver) };
      continue;
    }
    if (st.type === 'buy') { const wm = chapter().workMap; const pt = G.maps[wm] && G.maps[wm].points.store_door; if (pt) return { map: wm, ...pt, label: chapter().storeName }; continue; }
    const at = st.type === 'find' ? e.rec.spot : st.at;
    if (at) return { map: st.map, ...T(...at), label: e.title };
  }
  return null;
}

/** The nearest townsperson who still has an errand to offer. */
export function errandGiverWaypoint() {
  for (const [id, e] of Object.entries(ERRANDS)) {
    if (!e.offer || e.chapter !== G.s.chapter || est()[id]) continue;
    const n = G.npcs.find((x) => x.id === e.giver && x.present);
    if (n) return { map: G.map.id, x: n.x, y: n.y, label: shortName(e.giver) };
    const wm = chapter().workMap;
    const folk = (TOWNSFOLK[wm] || []).find((f) => f.id === e.giver);
    if (folk && G.maps[wm]) return { map: wm, ...G.maps[wm].points[folk.route[0]], label: folk.name };
  }
  return null;
}

function mapOfGiver(id) {
  if (NPCS[id]) return NPCS[id].map;
  for (const [m, list] of Object.entries(TOWNSFOLK)) if (list.some((f) => f.id === id)) return m;
  return null;
}
function giverPoint(id) {
  if (NPCS[id]) { const pt = G.maps[NPCS[id].map] && G.maps[NPCS[id].map].points[`${id}_porch`]; return pt ? { map: NPCS[id].map, ...pt } : null; }
  const m = mapOfGiver(id); const folk = m && TOWNSFOLK[m].find((f) => f.id === id);
  return folk && G.maps[m] ? { map: m, ...G.maps[m].points[folk.route[0]] } : null;
}
function shortName(id) {
  if (NPCS[id]) return NPCS[id].name.split(' ')[0].replace(/"/g, '');
  for (const list of Object.values(TOWNSFOLK)) { const f = list.find((x) => x.id === id); if (f) return f.name; }
  return id;
}
