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

export const JOB_TYPES = {
  woodcut: { name: 'Woodcutting', icon: '🪓', path: 'survivor' },
  delivery: { name: 'Delivery', icon: '📦', path: 'neighbor' },
  repair: { name: 'Repair Work', icon: '🔧', path: 'handyman' },
  supply: { name: 'Supply Run', icon: '🚚', path: 'neighbor', requires: 'good_reputation' },
};

function payMult() {
  let m = derived().jobPayMult;
  if (relOf('gus') >= 2) m *= 1.1;
  return m;
}

/** Today's offers on the job board (regenerated each day and after a job is taken). */
export function boardOffers() {
  const w = G.s.world;
  if (!w.board || w.board.day !== G.s.time.day) w.board = { day: G.s.time.day, offers: {} };
  const o = w.board.offers;
  const town = G.maps.town;
  if (!o.woodcut) { const need = randInt(4, 6); o.woodcut = { type: 'woodcut', need, pay: 25 + need * 9, desc: `Cut and deliver ${need} wood to the log drop-off at the yard.` }; }
  if (!o.delivery) { const t = choose(Object.keys(town.deliveryTargets)); o.delivery = { type: 'delivery', target: t, pay: 45, desc: `Pick up a parcel at Marsh General and deliver it to ${town.deliveryTargets[t].name} before time runs out.` }; }
  if (!o.repair) { const t = choose(Object.keys(town.repairTargets)); o.repair = { type: 'repair', target: t, pay: 55, desc: `Collect materials from the yard's supply shed, then fix ${town.repairTargets[t].name}. Needs a Toolkit.` }; }
  if (!o.supply) o.supply = { type: 'supply', pay: 70, desc: 'Load a crate of feed and supplies from the shed and drive it out to Ruth\'s farmhouse porch.' };
  return Object.values(o).map((x) => ({ ...x, pay: Math.round(x.pay * payMult()), locked: JOB_TYPES[x.type].requires && !hasSkill(JOB_TYPES[x.type].requires) }));
}

export function jobOpenHours() {
  const m = G.s.time.minute;
  return m >= 7 * 60 && m < 17 * 60;
}

export function acceptJob(type) {
  if (G.s.job) { toast('Finish or abandon your current job first.', 'warn'); return false; }
  if (!jobOpenHours()) { toast('The board is closed. Gus posts work from 7 AM to 5 PM.', 'warn'); return false; }
  const offer = boardOffers().find((o) => o.type === type);
  if (!offer || offer.locked) return false;
  const job = { ...offer, stage: 'start', accepted: G.s.time.day };
  if (type === 'woodcut') job.stage = 'gather';
  if (type === 'delivery') job.stage = 'pickup';
  if (type === 'repair') job.stage = 'materials';
  if (type === 'supply') job.stage = 'pickup';
  G.s.job = job;
  delete G.s.world.board.offers[type];
  sfx('blip');
  banner(`Job accepted: ${JOB_TYPES[type].name}. ${jobHint()}`, 'info', 4);
  G.events.emit('jobAccepted', type);
  return true;
}

export function abandonJob() {
  if (!G.s.job) return;
  toast(`Abandoned job: ${JOB_TYPES[G.s.job.type].name}. No hard feelings, says Gus.`, 'info');
  G.s.job = null;
}

/** One-line description of what to do next for the active job. */
export function jobHint() {
  const j = G.s.job;
  if (!j) return '';
  const town = G.maps.town;
  switch (j.type) {
    case 'woodcut': return count('wood') >= j.need ? `Bring ${j.need} wood to the log drop-off at Okafor Lumber.` : `Chop trees (wood ${count('wood')}/${j.need}). The woodlot east of the yard is closest.`;
    case 'delivery': return j.stage === 'pickup' ? 'Pick up the parcel at the Marsh General counter.' : `Deliver the parcel to ${town.deliveryTargets[j.target].name}.`;
    case 'repair': return j.stage === 'materials' ? 'Collect materials from the supply shed in the lumber yard.' : `Fix ${town.repairTargets[j.target].name}.`;
    case 'supply': return j.stage === 'pickup' ? 'Load the crate from the supply shed in the lumber yard.' : 'Drive home and leave the crate on Ruth\'s porch.';
    default: return '';
  }
}

/** Where the active job wants you to go: {map, x, y, label}. */
export function jobWaypoint() {
  const j = G.s.job;
  if (!j) return null;
  const town = G.maps.town;
  const tp = (name) => ({ map: 'town', ...town.points[name] });
  switch (j.type) {
    case 'woodcut': {
      if (count('wood') >= j.need) { const pr = town.props.find((p) => p.id === 'logdrop'); return { map: 'town', x: pr.x, y: pr.y, label: 'Log drop-off' }; }
      return { map: 'town', x: 61 * TILE, y: 30 * TILE, label: 'Woodlot' };
    }
    case 'delivery': return j.stage === 'pickup' ? { ...tp('store_door'), label: 'Marsh General' } : { map: 'town', ...town.deliveryTargets[j.target], label: 'Delivery' };
    case 'repair': {
      if (j.stage === 'materials') { const pr = town.props.find((p) => p.id === 'shed'); return { map: 'town', x: pr.x, y: pr.y, label: 'Supply shed' }; }
      return { map: 'town', ...town.repairTargets[j.target], label: 'Repair' };
    }
    case 'supply': {
      if (j.stage === 'pickup') { const pr = town.props.find((p) => p.id === 'shed'); return { map: 'town', x: pr.x, y: pr.y, label: 'Supply shed' }; }
      return { map: 'cabin', ...G.maps.cabin.points.ruth_porch, label: "Ruth's porch" };
    }
    default: return null;
  }
}

/** Temporary interactive props the active job adds to the world. */
export function jobProps(mapId) {
  const j = G.s.job;
  if (!j) return [];
  const town = G.maps.town;
  const out = [];
  if (mapId === 'town' && j.type === 'delivery' && j.stage === 'deliver') {
    const t = town.deliveryTargets[j.target];
    out.push({ id: 'job_deliver', kind: 'job_deliver', x: t.x, y: t.y, r: 46, label: `Deliver parcel to ${t.name}` });
  }
  if (mapId === 'town' && j.type === 'repair' && j.stage === 'fix') {
    const t = town.repairTargets[j.target];
    out.push({ id: 'job_repair', kind: 'job_repair', x: t.x, y: t.y, r: 48, label: `Fix ${t.name}`, broken: true });
  }
  if (mapId === 'cabin' && j.type === 'supply' && j.stage === 'deliver') {
    const p = G.maps.cabin.points.ruth_porch;
    out.push({ id: 'job_supply', kind: 'job_supply', x: p.x, y: p.y + 8, r: 46, label: 'Leave the crate on Ruth\'s porch' });
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
    const town = G.maps.town;
    const t = town.deliveryTargets[j.target];
    const d = dist(town.points.store_door.x, town.points.store_door.y, t.x, t.y);
    j.timeLimit = Math.round(25 + d / 55);
    j.timeLeft = j.timeLimit;
    sfx('pickup');
    playDialogue([{ who: 'Dee Marsh', text: `Here's the parcel for ${t.name}. They're expecting it — you've got about ${j.timeLimit} seconds before they start calling me.` }]);
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
  if (!j || j.type !== 'woodcut') { toast('Nothing to drop off. Take a woodcutting job from the board.', 'info'); return; }
  if (count('wood') < j.need) { toast(`Gus needs ${j.need} wood. You have ${count('wood')}.`, 'warn'); return; }
  removeItem('wood', j.need);
  completeJob({ xp: 25, jp: ['survivor', 5], rel: [['gus', 5]] });
}

export function onDeliver() {
  const j = G.s.job;
  const late = j.timeLeft <= 0;
  if (late) j.pay = Math.round(j.pay * 0.55);
  completeJob({ xp: 25, jp: ['neighbor', 10], rel: [['dee', 3], ['gus', 2]], note: late ? 'Late, but delivered.' : 'Right on time!' });
}

export function onRepairTarget() {
  if (count('toolkit') < 1) { toast('You need a Toolkit. Okafor Lumber sells them.', 'warn', 3); return; }
  openRepairGame({
    title: 'Repair Work',
    hits: 3,
    wide: hasSkill('quick_fix'),
    onDone: () => completeJob({ xp: 35, jp: ['handyman', 12], rel: [['gus', 5]] }),
  });
}

export function onSupplyDrop() {
  completeJob({ xp: 30, jp: ['neighbor', 10], rel: [['ruth', 6], ['gus', 3]], note: 'Ruth will be glad of the feed.' });
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
    if (G.s.job && G.s.job.type === 'woodcut' && count('wood') >= G.s.job.need) banner(`You have enough wood (${count('wood')}/${G.s.job.need}). Deliver it to Okafor Lumber.`, 'info', 3);
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
