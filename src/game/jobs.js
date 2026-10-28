// Legal jobs: woodcutting, delivery, repair work and (unlockable) supply runs.
// Each job is a playable activity with stages, not an instant payout.
import { G, hasSkill } from './state.js';
import { TILE } from '../config.js';
import { choose, dist, randInt } from '../util.js';
import { addItem, count, removeItem } from './inventory.js';
import { addJP, addRel, addXP, addMoney, derived, relOf } from './progression.js';
import { toast, banner } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { openRepairGame } from '../ui/menus.js';
import { playDialogue } from '../ui/dialogue.js';
import { saveGame } from './save.js';
import { chapter, workMap, workMapId, homeMap, homeMapId } from './chapters.js';
import { NPCS } from '../data/npcs.js';
import { LATER_COURIER } from '../data/storylines.js';

const first = (id) => NPCS[id].name.split(' ')[0].replace(/"/g, '');
const C = () => chapter();

export const JOB_TYPES = {
  woodcut: { name: 'Woodcutting', icon: '🪓', path: 'survivor' },
  delivery: { name: 'Delivery', icon: '📦', path: 'neighbor' },
  repair: { name: 'Repair Work', icon: '🔧', path: 'handyman' },
  supply: { name: 'Supply Run', icon: '🚚', path: 'neighbor', requires: 'good_reputation' },
  harvest: { name: 'Harvest', icon: '🥕', path: 'survivor', item: 'vegetables' },
  fishing: { name: 'Fish Order', icon: '🎣', path: 'survivor', item: 'fish', needsItem: 'fishing_rod' },
  courier: { name: 'Courier', icon: '✉', path: 'shadow' },
};

/** Your standing with the people who hire you: better pay, better work. */
export const REP_TIERS = [
  { at: 0, name: 'New hand', mult: 1 },
  { at: 5, name: 'Reliable', mult: 1.1 },
  { at: 12, name: 'Trusted', mult: 1.2 },
  { at: 25, name: 'Best in town', mult: 1.3 },
];
export function repTier() {
  const n = G.s.jobsDone || 0;
  let t = REP_TIERS[0];
  for (const r of REP_TIERS) if (n >= r.at) t = r;
  const next = REP_TIERS[REP_TIERS.indexOf(t) + 1];
  return { ...t, next, toNext: next ? next.at - n : 0 };
}

/** Who sends sealed envelopes, and what's inside if you look (per chapter). */
export const COURIER = {
  1: {
    senders: ['Mr. Henderson', 'Old Man Tibbs', 'Jenny Miller', 'Pastor Abe'],
    contents: [
      'A birthday card with a twenty-dollar bill in it. "To Bobby, from Grandpa."',
      'Two pages of a love letter. You fold it back up quickly.',
      'A past-due notice from the county. Somebody\'s behind on their taxes.',
      'Seed catalog order form, filled out in careful pencil.',
      'A photograph of a dog, and on the back: "Still miss him."',
    ],
  },
};
Object.assign(COURIER, LATER_COURIER);
/** Story hooks: (job) => special contents line, or null. */
export const courierHooks = [];

/** First water cell on a map (for fishing waypoints). */
function pondPoint(m) {
  for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
    if (m.getSolid(cx, cy) === 3 && m.getSolid(cx, cy - 1) === 0) return { x: cx * TILE + 16, y: (cy - 1) * TILE + 16 };
  }
  return null;
}

function payMult() {
  let m = derived().jobPayMult * repTier().mult;
  if (relOf(C().jobContact) >= 2) m *= 1.1;
  return m;
}

/** Today's offers on the job board (regenerated each day and after a job is taken). */
export function boardOffers() {
  const w = G.s.world;
  if (!w.board || w.board.day !== G.s.time.day) w.board = { day: G.s.time.day, offers: {} };
  const o = w.board.offers;
  const town = workMap();
  if (!o.woodcut) { const need = randInt(4, 6); o.woodcut = { type: 'woodcut', need, pay: 25 + need * 9, desc: `Cut and deliver ${need} wood to the log drop-off at the yard.` }; }
  if (!o.delivery) { const t = choose(Object.keys(town.deliveryTargets)); o.delivery = { type: 'delivery', target: t, pay: 45, desc: `Pick up a parcel at ${C().storeName} and deliver it to ${town.deliveryTargets[t].name} before time runs out.` }; }
  if (!o.repair) { const t = choose(Object.keys(town.repairTargets)); o.repair = { type: 'repair', target: t, pay: 55, desc: `Collect materials from the yard's supply crates, then fix ${town.repairTargets[t].name}. Needs a Toolkit.` }; }
  if (town.cropsPickable && !o.harvest) { const need = randInt(5, 8); o.harvest = { type: 'harvest', need, pay: 20 + need * 8, desc: `Pick ${need} vegetables from your garden and bring them to the drop-off at ${C().jobPlace}.` }; }
  if (!o.fishing && pondPoint(town) || !o.fishing && pondPoint(homeMap())) { const need = randInt(2, 3); o.fishing = { type: 'fishing', need, pay: 30 + need * 15, desc: `A restaurant wants ${need} fresh fish. Catch them in the pond and bring them to the drop-off. Needs a Fishing Rod.` }; }
  if (!o.supply) o.supply = { type: 'supply', pay: 70, desc: `Load a crate of supplies from the yard and take it to ${first(C().neighbor)}'s porch.` };
  const cz = COURIER[C().id];
  if (cz && !o.courier && town.deliveryTargets) {
    const t = choose(Object.keys(town.deliveryTargets));
    const from = choose(cz.senders);
    o.courier = { type: 'courier', target: t, from, pay: 40, desc: `${from} needs a sealed envelope taken to ${town.deliveryTargets[t].name}. Discreetly. Don't open it.` };
  }
  return Object.values(o).map((x) => ({ ...x, pay: Math.round(x.pay * payMult()), locked: JOB_TYPES[x.type].requires && !hasSkill(JOB_TYPES[x.type].requires), needs: JOB_TYPES[x.type].needsItem && count(JOB_TYPES[x.type].needsItem) < 1 ? JOB_TYPES[x.type].needsItem : null }));
}

export function jobOpenHours() {
  const m = G.s.time.minute;
  return m >= 7 * 60 && m < 17 * 60;
}

export function acceptJob(type) {
  if (G.s.job) { toast('Finish or abandon your current job first.', 'warn'); return false; }
  if (!jobOpenHours()) { toast(`The board is closed. ${first(C().jobContact)} posts work from 7 AM to 5 PM.`, 'warn'); return false; }
  const offer = boardOffers().find((o) => o.type === type);
  if (!offer || offer.locked) return false;
  if (offer.needs) { toast('You need a Fishing Rod for this one.', 'warn'); return false; }
  const job = { ...offer, stage: 'start', accepted: G.s.time.day };
  if (type === 'woodcut' || type === 'harvest' || type === 'fishing') job.stage = 'gather';
  if (type === 'delivery') job.stage = 'pickup';
  if (type === 'repair') job.stage = 'materials';
  if (type === 'supply') job.stage = 'pickup';
  if (type === 'courier') { job.stage = 'deliver'; addItem('envelope', 1, true); }
  if (type === 'delivery' && Math.random() < 0.3) { job.rush = true; job.pay = Math.round(job.pay * 1.4); }
  G.s.job = job;
  delete G.s.world.board.offers[type];
  sfx('blip');
  banner(`Job accepted: ${JOB_TYPES[type].name}. ${jobHint()}`, 'info', 4);
  G.events.emit('jobAccepted', type);
  return true;
}

export function abandonJob() {
  if (!G.s.job) return;
  toast(`Abandoned job: ${JOB_TYPES[G.s.job.type].name}. No hard feelings, says ${first(C().jobContact)}.`, 'info');
  G.s.job = null;
}

/** One-line description of what to do next for the active job. */
export function jobHint() {
  const j = G.s.job;
  if (!j) return '';
  const town = workMap();
  switch (j.type) {
    case 'woodcut': return count('wood') >= j.need ? `Bring ${j.need} wood to the drop-off at ${C().jobPlace}.` : `Chop trees (wood ${count('wood')}/${j.need}). ${{ 1: 'The woodlot east of the yard is closest.', 2: 'Millbrook Park has plenty of deadfall.', 3: 'The windbreaks along the fields are full of trees.', 4: 'The west woods past the lane are thick with timber.' }[C().id] || ''}`;
    case 'harvest': return count('vegetables') >= j.need ? `Bring ${j.need} vegetables to the drop-off at ${C().jobPlace}.` : `Pick vegetables in your garden (${count('vegetables')}/${j.need}).`;
    case 'fishing': return count('fish') >= j.need ? `Bring ${j.need} fish to the drop-off at ${C().jobPlace}.` : `Catch fish at the pond (${count('fish')}/${j.need}).`;
    case 'delivery': return j.stage === 'pickup' ? `Pick up the parcel at the ${C().storeName} counter.` : `Deliver the parcel to ${town.deliveryTargets[j.target].name}.`;
    case 'repair': return j.stage === 'materials' ? `Collect materials from the supply crates at ${C().jobPlace}.` : `Fix ${town.repairTargets[j.target].name}.`;
    case 'supply': return j.stage === 'pickup' ? `Load the crate at ${C().jobPlace}.` : `Leave the crate on ${first(C().neighbor)}'s porch.`;
    case 'courier': return `Take ${j.from}'s envelope to ${town.deliveryTargets[j.target].name}. Don't open it.`;
    default: return '';
  }
}

/** Where the active job wants you to go: {map, x, y, label}. */
export function jobWaypoint() {
  const j = G.s.job;
  if (!j) return null;
  const town = workMap();
  const wm = workMapId();
  const tp = (name) => ({ map: wm, ...town.points[name] });
  switch (j.type) {
    case 'woodcut': {
      if (count('wood') >= j.need) { const pr = town.props.find((p) => p.id === 'logdrop'); return { map: wm, x: pr.x, y: pr.y, label: 'Drop-off' }; }
      return { map: wm, ...town.points.woodlot, label: 'Woodlot' };
    }
    case 'harvest': case 'fishing': {
      if (count(JOB_TYPES[j.type].item) >= j.need) { const pr = town.props.find((p) => p.id === 'logdrop'); return { map: wm, x: pr.x, y: pr.y, label: 'Drop-off' }; }
      if (j.type === 'harvest') return { map: wm, ...(town.points.garden || town.points.start), label: 'Garden' };
      const hp = pondPoint(homeMap()), wp = pondPoint(town);
      return wp ? { map: wm, ...wp, label: 'Pond' } : { map: homeMapId(), ...hp, label: 'Pond' };
    }
    case 'delivery': return j.stage === 'pickup' ? { ...tp('store_door'), label: C().storeName } : { map: wm, ...town.deliveryTargets[j.target], label: 'Delivery' };
    case 'courier': return { map: wm, ...town.deliveryTargets[j.target], label: 'Envelope' };
    case 'repair': {
      if (j.stage === 'materials') { const pr = town.props.find((p) => p.id === 'shed'); return { map: wm, x: pr.x, y: pr.y, label: 'Supplies' }; }
      return { map: wm, ...town.repairTargets[j.target], label: 'Repair' };
    }
    case 'supply': {
      if (j.stage === 'pickup') { const pr = town.props.find((p) => p.id === 'shed'); return { map: wm, x: pr.x, y: pr.y, label: 'Supplies' }; }
      return { map: homeMapId(), ...neighborPorch(), label: `${first(C().neighbor)}'s porch` };
    }
    default: return null;
  }
}

/** Temporary interactive props the active job adds to the world. */
export function jobProps(mapId) {
  const j = G.s.job;
  if (!j) return [];
  const town = workMap();
  const out = [];
  if (mapId === workMapId() && j.type === 'delivery' && j.stage === 'deliver') {
    const t = town.deliveryTargets[j.target];
    out.push({ id: 'job_deliver', kind: 'job_deliver', x: t.x, y: t.y, r: 46, label: `Deliver parcel to ${t.name}` });
  }
  if (mapId === workMapId() && j.type === 'courier') {
    const t = town.deliveryTargets[j.target];
    out.push({ id: 'job_courier', kind: 'job_courier', x: t.x, y: t.y, r: 46, label: `Hand over ${j.from}'s envelope` });
  }
  if (mapId === workMapId() && j.type === 'repair' && j.stage === 'fix') {
    const t = town.repairTargets[j.target];
    out.push({ id: 'job_repair', kind: 'job_repair', x: t.x, y: t.y, r: 48, label: `Fix ${t.name}`, broken: true });
  }
  if (mapId === homeMapId() && j.type === 'supply' && j.stage === 'deliver') {
    const p = neighborPorch();
    out.push({ id: 'job_supply', kind: 'job_supply', x: p.x, y: p.y + 8, r: 46, label: `Leave the crate on ${first(C().neighbor)}'s porch` });
  }
  return out;
}

export function updateJobs(dt) {
  const j = G.s.job;
  if (!j || j.type !== 'delivery' || j.stage !== 'deliver') return;
  if (j.timeLeft > 0) {
    j.timeLeft -= dt;
    if (j.timeLeft <= 0) { j.timeLeft = 0; toast('The delivery is running late. You\'ll still get paid, just less.', 'warn', 3); }
  }
}

/* ---------------- stage handlers (called from interactions) ---------------- */
export function onStoreCounter() {
  const j = G.s.job;
  if (j && j.type === 'delivery' && j.stage === 'pickup') {
    j.stage = 'deliver';
    const town = workMap();
    const t = town.deliveryTargets[j.target];
    const d = dist(town.points.store_door.x, town.points.store_door.y, t.x, t.y);
    j.timeLimit = Math.round((25 + d / 55) * (j.rush ? 0.75 : 1));
    j.timeLeft = j.timeLimit;
    sfx('pickup');
    playDialogue([{ who: NPCS[C().shopkeeper].name, text: `${j.rush ? 'RUSH ORDER — they\'re paying extra. ' : ''}Here's the parcel for ${t.name}. They're expecting it — you've got about ${j.timeLimit} seconds before they start calling me.` }]);
    return true;
  }
  return false;
}

export function onShed() {
  const j = G.s.job;
  if (j && j.type === 'repair' && j.stage === 'materials') {
    j.stage = 'fix';
    sfx('pickup');
    toast('Picked up planks, nails and brackets.', 'item');
    banner(jobHint(), 'info', 3);
    return true;
  }
  if (j && j.type === 'supply' && j.stage === 'pickup') {
    j.stage = 'deliver';
    sfx('pickup');
    toast('Crate loaded into your car.', 'item');
    banner(jobHint(), 'info', 3);
    return true;
  }
  return false;
}

export function onLogDrop() {
  const j = G.s.job;
  if (j && (j.type === 'harvest' || j.type === 'fishing')) {
    const item = JOB_TYPES[j.type].item;
    if (count(item) < j.need) { toast(`${first(C().jobContact)} needs ${j.need}. You have ${count(item)}.`, 'warn'); return; }
    removeItem(item, j.need);
    completeJob({ xp: 25, jp: ['survivor', 6], rel: [[C().jobContact, 4]] });
    return;
  }
  if (!j || j.type !== 'woodcut') { toast('Nothing to drop off. Take a job from the board.', 'info'); return; }
  if (count('wood') < j.need) { toast(`${first(C().jobContact)} needs ${j.need} wood. You have ${count('wood')}.`, 'warn'); return; }
  removeItem('wood', j.need);
  completeJob({ xp: 25, jp: ['survivor', 5], rel: [[C().jobContact, 5]] });
}

export function onDeliver() {
  const j = G.s.job;
  const late = j.timeLeft <= 0;
  if (late) j.pay = Math.round(j.pay * 0.55);
  // Regulars remember you, and sometimes tip.
  const reg = (G.s.regulars || (G.s.regulars = {}));
  reg[j.target] = (reg[j.target] || 0) + 1;
  const name = workMap().deliveryTargets[j.target].name;
  if (!late && (reg[j.target] >= 3 || Math.random() < 0.25)) {
    const tip = choose([['pie', 'a slice of pie'], ['sandwich', 'a sandwich for the road'], [null, '$10']]);
    if (tip[0]) addItem(tip[0], 1, true); else addMoney(10, 'tip');
    toast(reg[j.target] >= 3 ? `"Frank! My favorite delivery man." (${name} tips ${tip[1]})` : `A tip from ${name}: ${tip[1]}.`, 'good', 3.5);
  }
  completeJob({ xp: 25, jp: ['neighbor', 10], rel: [[C().shopkeeper, 3], [C().jobContact, 2]], note: late ? 'Late, but delivered.' : j.rush ? 'Rush order, on time!' : 'Right on time!' });
}

/** The courier's choice at the door: hand it over, or look first. */
export function onCourier() {
  const j = G.s.job;
  const t = workMap().deliveryTargets[j.target];
  const deliver = (peeked) => {
    removeItem('envelope', 1);
    const noticed = peeked && Math.random() < 0.35;
    if (noticed) { j.pay = Math.round(j.pay * 0.5); toast('"This seal\'s been lifted." Half pay, and a look you won\'t forget.', 'warn', 4); }
    completeJob({ xp: 25, jp: ['shadow', peeked ? 8 : 4], rel: [[C().jobContact, 2]], note: noticed ? 'They noticed.' : 'Delivered, no questions asked.' });
  };
  playDialogue([{ who: 'Frank', text: `${j.from}'s envelope for ${t.name}. Light. Sealed with a lick and a prayer.`, choices: [
    { text: 'Hand it over.', effect: () => { deliver(false); return []; } },
    { text: '(Steam it open first.)', effect: () => {
      let line = null;
      for (const f of courierHooks) { line = f(j); if (line) break; }
      if (!line) line = choose((COURIER[C().id] || COURIER[1]).contents);
      deliver(true);
      return [{ who: 'Frank', text: `(Inside: ${line})` }];
    } },
  ] }]);
}

export function onRepairTarget() {
  if (count('toolkit') < 1) { toast(`You need a Toolkit. ${C().hardwareName} sells them.`, 'warn', 3); return; }
  openRepairGame({
    title: 'Repair Work',
    hits: 3,
    wide: hasSkill('quick_fix'),
    onDone: () => completeJob({ xp: 35, jp: ['handyman', 12], rel: [[C().jobContact, 5]] }),
  });
}

export function onSupplyDrop() {
  completeJob({ xp: 30, jp: ['neighbor', 10], rel: [[C().neighbor, 6], [C().jobContact, 3]], note: `${first(C().neighbor)} will be glad of the delivery.` });
}

function completeJob({ xp, jp, rel, note }) {
  const j = G.s.job;
  G.s.job = null;
  G.s.jobsDone++;
  sfx('jobDone');
  banner(`Job complete: ${JOB_TYPES[j.type].name}! ${note || ''}`, 'good', 4);
  addMoney(j.pay, 'job pay');
  addXP(xp, 'Job');
  addJP(jp[0], jp[1]);
  for (const [id, n] of rel) addRel(id, n);
  G.events.emit('jobDone', j.type);
  saveGame('job');
}

/* ---------------- woodcutting (trees anywhere) ---------------- */
export const TREE_REGROW_DAYS = 3;

function neighborPorch() { return homeMap().points[`${C().neighbor}_porch`]; }

export function chopTree(tree) {
  const p = G.player;
  const d = derived();
  const cost = 8 * d.staminaMult;
  if (p.stamina < cost) { toast('Too tired to swing the axe. Rest a moment or eat something.', 'warn', 2); return; }
  p.stamina -= cost;
  p.chopAnim = 0.25;
  p.angle = Math.atan2(tree.cy * TILE + 16 - p.y, tree.cx * TILE + 16 - p.x);
  tree.chops++;
  tree.shake = 0.25;
  sfx('chop');
  if (tree.chops >= 3) {
    const m = G.map;
    tree.chopped = true;
    m.setSolid(tree.cx, tree.cy, 0);
    G.s.world.chopped[m.id][m.idx(tree.cx, tree.cy)] = G.s.time.day;
    const n = 2 + d.woodBonus;
    addItem('wood', n);
    sfx('treefall');
    addJP('survivor', 2, 'chop', 10);
    G.events.emit('treeChopped', tree);
    if (G.s.job && G.s.job.type === 'woodcut' && count('wood') >= G.s.job.need) banner(`You have enough wood (${count('wood')}/${G.s.job.need}). Deliver it to ${C().jobPlace}.`, 'info', 3);
  }
}

/** Apply chopped/regrown state from the save to a freshly built map. */
export function applyChopped(m) {
  const rec = G.s.world.chopped[m.id] || (G.s.world.chopped[m.id] = {});
  for (const [k, day] of Object.entries(rec)) {
    const idx = Number(k);
    const t = m.trees.get(idx);
    if (!t) { delete rec[k]; continue; }
    if (G.s.time.day - day >= TREE_REGROW_DAYS) { delete rec[k]; t.chopped = false; t.chops = 0; m.solid[idx] = 7; }
    else { t.chopped = true; m.solid[idx] = 0; }
  }
}
