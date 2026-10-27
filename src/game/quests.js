// Side requests ("favors") from named NPCs. Each is a small playable task:
// find something, deliver something, clear or fix something, or bring materials.
// Favors unlock at friendship level 1 and are turned in by talking to the NPC.
import { G } from './state.js';
import { TILE } from '../config.js';
import { NPCS } from '../data/npcs.js';
import { addItem, count, removeItem } from './inventory.js';
import { addJP, addMoney, addRel, addXP, derived, relOf } from './progression.js';
import { playDialogue } from '../ui/dialogue.js';
import { openRepairGame } from '../ui/menus.js';
import { banner, toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { choose } from '../util.js';
import { hasSkill } from './state.js';
import { ITEMS } from '../data/items.js';
import { scheduleSpot } from './npcs.js';
import { chapter } from './chapters.js';

const T = (x, y) => ({ x: x * TILE, y: y * TILE });

export const QUESTS = {
  ruth_watch: {
    npc: 'ruth', map: 'cabin', type: 'find', title: "Harold's Pocket Watch",
    spots: [[46.5, 12.5], [53.5, 12.5], [43.5, 9.5], [56.5, 8.5]], label: 'Something glinting in the grass',
    objective: "Search the banks of Still Pond for Harold's pocket watch.",
    offer: [
      { who: 'Ruth Calloway', text: 'I lost Harold\'s pocket watch down by the pond last fall. Silly old thing — doesn\'t even keep time.' },
      { who: 'Ruth Calloway', text: 'It\'s the only thing of his I carried every day. If you\'re ever out that way...' },
    ],
    found: 'A tarnished silver pocket watch, engraved "H.C. — 1971".',
    done: [
      { who: 'Ruth Calloway', text: '...Oh. Oh, Frank. You found it.' },
      { who: 'Ruth Calloway', text: 'Harold kept two guns: his deer rifle and the old pump shotgun by the back door. He\'d want you to have the rifle. It\'s been sitting in the closet since the funeral. Take it — and the shells. Don\'t argue.' },
      { who: 'Ruth Calloway', text: 'The shotgun stays with me. A woman alone at the end of a dirt road keeps one thing by the door.' },
    ],
    reward: { money: 0, xp: 50, rel: 14, jp: ['neighbor', 8], items: { rifle: 1, rifle_ammo: 10 } },
  },
  dee_pie: {
    npc: 'dee', map: 'town', type: 'deliver', title: 'Pie for the Pastor',
    target: [39.5, 18.6], label: 'Deliver the pie to Pastor Abe',
    objective: 'Carry Dee\'s pie to the Hollow Chapel door.',
    offer: [
      { who: 'Dee Marsh', text: 'Pastor Abe\'s birthday is today and I can\'t leave the register. Would you run this pie over to the chapel?' },
      { who: 'Dee Marsh', text: 'Don\'t you dare peek. Or taste. I\'ll know.' },
    ],
    found: 'Pastor Abe beams and swears he\'ll save you a slice.',
    done: [{ who: 'Dee Marsh', text: 'He called already. Cried a little, I think. You\'re a good egg, Frank. Here — on the house.' }],
    reward: { money: 25, xp: 35, rel: 12, jp: ['neighbor', 8], items: { stew: 2, medkit: 1 } },
  },
  gus_log: {
    npc: 'gus', map: 'town', type: 'chop', title: 'Fallen Tree', chops: 5,
    target: [32.5, 2.6], label: 'Saw through the fallen tree',
    objective: 'Clear the tree that fell across the north road (5 swings).',
    offer: [
      { who: 'Gus Okafor', text: 'Storm dropped an oak across the north road. County won\'t get to it for a week.' },
      { who: 'Gus Okafor', text: 'Clear it and I\'ll pay you, plus you keep the wood.' },
    ],
    found: 'The road is clear. You stack the best of the wood.',
    done: [{ who: 'Gus Okafor', text: 'Road\'s open. Nice work. Here\'s your money — and I threw in some door hardware I had lying around.' }],
    reward: { money: 50, xp: 35, rel: 12, jp: ['survivor', 6], items: { wood: 4, door_brace: 1 } },
  },
  marcus_antenna: {
    npc: 'marcus', map: 'millbrook', type: 'repair', title: 'Static on the Line',
    target: [16.5, 23.6], label: 'Fix Marcus\'s radio antenna',
    objective: 'Repair the ham radio antenna beside Marcus\'s house (Toolkit).',
    offer: [
      { who: 'Marcus Bell', text: 'Wind bent my antenna mast. My hands aren\'t what they used to be, and I don\'t like being off the air.' },
      { who: 'Marcus Bell', text: 'You handy with a wrench? I\'ll make it worth your while.' },
    ],
    found: 'The mast is straight and the radio crackles back to life.',
    done: [
      { who: 'Marcus Bell', text: 'Clear as a bell. Ha. Thank you.' },
      { who: 'Marcus Bell', text: 'Take these — cameras from an old job of mine. Mount them on your place. Trust me.' },
    ],
    reward: { money: 20, xp: 45, rel: 14, jp: ['handyman', 8], items: { camera_kit: 1 } },
  },
  rosa_shelves: {
    npc: 'rosa', map: 'millbrook', type: 'bring', title: 'Shelf Lumber', needItem: 'wood', needCount: 6,
    objective: 'Bring Rosa 6 wood for the store\'s new shelves.',
    offer: [
      { who: 'Rosa Delgado', text: 'My supplier shorted me on shelf lumber again. Six good pieces of wood and I can finish the back wall.' },
      { who: 'Rosa Delgado', text: 'I\'ll pay, and I\'ll throw in something from the back room.' },
    ],
    done: [{ who: 'Rosa Delgado', text: 'Perfect — straight grain and everything. Here: steel shutters. Your windows will thank me.' }],
    reward: { money: 45, xp: 35, rel: 12, jp: ['neighbor', 6], items: { shutter_kit: 1 } },
  },
  pete_dog: {
    npc: 'pete', map: 'millbrook', type: 'find', title: 'Where\'s Biscuit?', dog: true,
    spots: [[6.5, 6.5], [21.5, 9.5], [9.5, 14.5], [24.5, 4.5]], label: 'Biscuit the beagle',
    objective: 'Find Pete\'s beagle, Biscuit, somewhere in Millbrook Park.',
    offer: [
      { who: 'Pete Kowalski', text: 'Buddy, I need help. Biscuit slipped his collar and bolted into the park. He\'s a beagle — follows his nose and nothing else.' },
      { who: 'Pete Kowalski', text: 'My kids are a wreck. Please?' },
    ],
    found: 'Biscuit sniffs your hand, decides you\'re acceptable, and trots along behind you.',
    done: [{ who: 'Pete Kowalski', text: 'BISCUIT! Oh, buddy. Frank, I owe you big. Here — and I got you a box of shells from Rosa\'s.' }],
    reward: { money: 40, xp: 40, rel: 14, jp: ['survivor', 6], items: { shells: 16 } },
  },
  ingrid_calf: {
    npc: 'ingrid', map: 'farm', type: 'find', title: 'The Runaway Calf', animal: 'calf',
    spots: [[62.5, 44.5], [4.5, 46.5], [44.5, 47.5], [70.5, 30.5]], label: 'Clover the calf',
    objective: 'Find Ingrid\'s calf, Clover, somewhere out past the fields.',
    offer: [
      { who: 'Ingrid Haugen', text: 'Clover got through the wire again. Six hundred pounds of stupid with a bell on.' },
      { who: 'Ingrid Haugen', text: 'Coyotes are bad this year. Find her before they do and I\'ll make it right.' },
    ],
    found: 'Clover moos at you, offended, then follows you home like it was her idea.',
    done: [
      { who: 'Ingrid Haugen', text: 'There\'s my idiot. Thank you, Frank.' },
      { who: 'Ingrid Haugen', text: 'Pa\'s old hunting scope. Bolt it on that rifle of yours. Out here the trouble comes from a long way off.' },
    ],
    reward: { money: 30, xp: 45, rel: 14, jp: ['survivor', 8], items: { scope: 1 } },
  },
  bo_fish: {
    npc: 'bo', map: 'farm', type: 'bring', title: 'Friday Fish Fry', needItem: 'fish', needCount: 3,
    objective: 'Catch 3 fish at the pond for Bo\'s Friday fish fry (needs a Fishing Rod).',
    offer: [
      { who: 'Bo Lindqvist', text: 'Whole town comes out for the Friday fish fry, and my supplier in Green Bay flaked.' },
      { who: 'Bo Lindqvist', text: 'Three fish from the pond would save my reputation. You have a rod? I sell rods. Funny how that works.' },
    ],
    done: [{ who: 'Bo Lindqvist', text: 'Look at these! Here, for the trouble — and a choke for that scattergun. Tightens the spread.' }],
    reward: { money: 55, xp: 35, rel: 12, jp: ['neighbor', 6], items: { choke: 1 } },
  },
  tess_scale: {
    npc: 'tess', map: 'farm', type: 'repair', title: 'Crooked Scale',
    target: [50.5, 12.6], label: 'Fix the co-op truck scale',
    objective: 'Repair the truck scale outside the Grain Co-op (Toolkit).',
    offer: [
      { who: 'Tess Albright', text: 'The truck scale\'s reading forty pounds heavy. Half the county thinks I\'m robbing them.' },
      { who: 'Tess Albright', text: 'You\'ve got a toolkit. I\'ve got a problem. Let\'s make a deal.' },
    ],
    found: 'The needle settles on zero. Honest weight again.',
    done: [{ who: 'Tess Albright', text: 'Dead on. You\'re hired for life, whether you like it or not. Here — and take some shutters from the back.' }],
    reward: { money: 60, xp: 45, rel: 14, jp: ['handyman', 8], items: { shutter_kit: 1 } },
  },
  ruth_supper: {
    npc: 'ruth', map: 'farm', type: 'bring', title: 'Supper Like Harold Made', needItem: 'vegetables', needCount: 4, companion: true,
    objective: 'Pick 4 vegetables from the farm garden for Ruth.',
    offer: [
      { who: 'Ruth Calloway', text: 'Harold used to make a garden stew every fall. I never wrote it down. I think I remember it.' },
      { who: 'Ruth Calloway', text: 'Bring me four good vegetables from that garden and I\'ll try. Don\'t expect miracles.' },
    ],
    done: [
      { who: 'Ruth Calloway', text: 'It\'s not his. But it\'s close. ...Thank you, Frank. For bringing me along.' },
      { who: 'Ruth Calloway', text: 'I made extra. Take it for the long nights.' },
    ],
    reward: { money: 0, xp: 40, rel: 10, jp: ['neighbor', 8], items: { hearty_meal: 2, medkit: 1 } },
  },
};

const qstate = () => G.s.quests || (G.s.quests = {});

/** A favor this NPC can offer right now, or null. */
export function questOffer(npc) {
  const st = qstate();
  const maps = chapter().maps;
  for (const [id, q] of Object.entries(QUESTS)) {
    if (q.npc !== npc || st[id] || !maps.includes(q.map)) continue;
    if (relOf(npc) < 1) return null;
    if (Object.entries(st).some(([qid, s]) => QUESTS[qid] && QUESTS[qid].npc === npc && maps.includes(QUESTS[qid].map) && s.state !== 'done')) return null;
    return id;
  }
  return null;
}

export function offerQuest(npc) {
  const id = questOffer(npc);
  if (!id) return;
  const q = QUESTS[id];
  playDialogue([...q.offer, {
    who: NPCS[npc].name, text: 'Can you help?',
    choices: [
      { text: `"Sure, I'll take care of it."`, effect: () => { startQuest(id); return []; } },
      { text: '"Not right now."', effect: () => [{ who: NPCS[npc].name, text: 'No rush. Offer stands.' }] },
    ],
  }]);
}

function startQuest(id) {
  const q = QUESTS[id];
  const rec = { state: 'active', progress: 0 };
  if (q.spots) rec.spot = choose(q.spots);
  qstate()[id] = rec;
  sfx('blip');
  banner(`Favor: ${q.title} — ${q.objective}`, 'objective', 5);
  saveGame('quest');
}

export function activeQuests() {
  const maps = chapter().maps;
  return Object.entries(qstate()).filter(([id, s]) => QUESTS[id] && s.state !== 'done' && maps.includes(QUESTS[id].map)).map(([id, s]) => ({ id, ...QUESTS[id], rec: s }));
}

export function questHint(q) {
  if (q.rec.state === 'return') return `Return to ${NPCS[q.npc].name.split(' ')[0].replace(/"/g, '')}.`;
  if (q.type === 'bring') return `${q.objective} (${count(q.needItem)}/${q.needCount})`;
  return q.objective;
}

/** Temporary interactive props for active favors on this map. */
export function questProps(mapId) {
  const out = [];
  for (const q of activeQuests()) {
    if (q.map !== mapId || q.rec.state !== 'active') continue;
    if (q.type === 'find') out.push({ id: 'q_' + q.id, kind: 'quest_find', quest: q.id, ...T(...q.rec.spot), r: 46, label: q.dog ? 'Call Biscuit' : q.animal === 'calf' ? 'Lead Clover home' : 'Search here', dog: q.dog, animal: q.animal });
    else if (q.type === 'deliver') out.push({ id: 'q_' + q.id, kind: 'quest_done', quest: q.id, ...T(...q.target), r: 46, label: q.label });
    else if (q.type === 'chop') out.push({ id: 'q_' + q.id, kind: 'quest_chop', quest: q.id, ...T(...q.target), r: 52, label: `${q.label} (${q.chops - q.rec.progress} swings left)` });
    else if (q.type === 'repair') out.push({ id: 'q_' + q.id, kind: 'quest_repair', quest: q.id, ...T(...q.target), r: 48, label: q.label });
  }
  return out;
}

export function questWaypoint() {
  for (const q of activeQuests()) {
    if (q.rec.state === 'return' || q.type === 'bring') {
      if (q.type === 'bring' && count(q.needItem) < q.needCount) continue;
      const spot = q.companion ? { map: G.map.id, pt: companionSpot() } : scheduleSpot(NPCS[q.npc], G.s.time.minute);
      const pt = G.maps[spot.map] && G.maps[spot.map].points[spot.pt];
      if (pt) return { map: spot.map, ...pt, label: NPCS[q.npc].name.split(' ')[0].replace(/"/g, '') };
      continue;
    }
    const pt = q.rec.spot || q.target;
    if (pt) return { map: q.map, ...T(...pt), label: q.title };
  }
  return null;
}

function companionSpot() {
  const r = G.npcs.find((n) => n.id === 'ruth');
  return r ? r.spot : 'ruth_c_day';
}

function progressDone(id) {
  const q = QUESTS[id];
  qstate()[id].state = 'return';
  sfx('chime');
  if (q.found) playDialogue([{ who: 'Frank', text: q.found }]);
  banner(`${q.title}: return to ${NPCS[q.npc].name}.`, 'objective', 4);
}

/** Handle interacting with a favor prop. */
export function questPropAction(pr) {
  const q = QUESTS[pr.quest];
  const rec = qstate()[pr.quest];
  if (!rec || rec.state !== 'active') return;
  if (pr.kind === 'quest_find' || pr.kind === 'quest_done') progressDone(pr.quest);
  else if (pr.kind === 'quest_chop') {
    const p = G.player;
    const cost = 8 * derived().staminaMult;
    if (p.stamina < cost) { toast('Too tired. Catch your breath.', 'warn'); return; }
    p.stamina -= cost;
    p.chopAnim = 0.25;
    sfx('chop');
    rec.progress++;
    if (rec.progress >= q.chops) { sfx('treefall'); progressDone(pr.quest); }
  } else if (pr.kind === 'quest_repair') {
    if (count('toolkit') < 1) { toast('You need a Toolkit for this.', 'warn'); return; }
    openRepairGame({ title: q.title, hits: 3, wide: hasSkill('quick_fix'), onDone: () => progressDone(pr.quest) });
  }
}

/** Turn in a finished favor when talking to its NPC. Returns true if handled. */
export function questTalk(npc) {
  for (const q of activeQuests()) {
    if (q.npc !== npc) continue;
    const ready = q.rec.state === 'return' || (q.type === 'bring' && count(q.needItem) >= q.needCount);
    if (!ready) continue;
    if (q.type === 'bring') removeItem(q.needItem, q.needCount);
    playDialogue(q.done, () => completeQuest(q.id));
    return true;
  }
  return false;
}

function completeQuest(id) {
  const q = QUESTS[id];
  qstate()[id].state = 'done';
  const r = q.reward;
  sfx('jobDone');
  banner(`Favor complete: ${q.title}`, 'good', 4);
  if (r.money) addMoney(r.money, 'favor');
  addXP(r.xp, 'Favor');
  addRel(q.npc, r.rel);
  addJP(r.jp[0], r.jp[1]);
  for (const [item, n] of Object.entries(r.items || {})) {
    const got = addItem(item, n, true);
    if (got) toast(`Received: ${ITEMS[item].name}${n > 1 ? ' ×' + got : ''}`, 'item', 3);
  }
  G.events.emit('questDone', id);
  saveGame('quest');
}
