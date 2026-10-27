// Context-sensitive interaction: finds the best nearby target and performs it.
import { G } from './state.js';
import { TILE } from '../config.js';
import { dist, angleDiff, angleTo } from '../util.js';
import { count } from './inventory.js';
import { interactNpc, npcPresent } from './npcs.js';
import { chopTree, jobProps, onDeliver, onLogDrop, onRepairTarget, onShed, onStoreCounter, onSupplyDrop } from './jobs.js';
import { installBoards, installBrace, installShutters, pickUpCover, repairNeed, startRepair, trapAt, rearmTrap, pickUpTrap } from './home.js';
import { atHome, chapter } from './chapters.js';
import { questProps, questPropAction } from './quests.js';
import { answerPhone, storyMail } from './story.js';
import { openBedMenu, openCraft, openActions, openShop, openJobBoard } from '../ui/menus.js';
import { playDialogue } from '../ui/dialogue.js';
import { toast } from '../ui/hud.js';
import { addJP, addXP } from './progression.js';
import { addThreat } from './siege.js';
import { sfx } from '../audio.js';
import { inCombat } from './player.js';

let travelFn = null;
export function setTravel(fn) { travelFn = fn; }

/** Gather candidate interactions near the player. */
function candidates() {
  const p = G.player;
  const m = G.map;
  const out = [];
  const add = (x, y, r, label, short, action, prio = 0) => {
    const d = dist(p.x, p.y, x, y);
    if (d > r) return;
    const facing = Math.abs(angleDiff(p.angle, angleTo(p.x, p.y, x, y))) < 1.2 ? 0 : 10;
    out.push({ x, y, label, short, action, score: d + facing - prio * 40 });
  };

  for (const n of G.npcs) {
    if (!n.present) continue;
    add(n.x, n.y, n.folk ? 50 : 64, `Talk to ${n.def.name}`, 'TALK', () => interactNpc(n), n.folk ? -1 : 2);
  }

  const props = [...m.props, ...jobProps(m.id), ...questProps(m.id)];
  for (const pr of props) {
    const a = propAction(pr);
    if (a) add(pr.x, pr.y, pr.r, a.label, a.short, a.action, a.prio || 0);
  }

  // Doors, windows and cover in nearby cells
  const pcx = Math.floor(p.x / TILE), pcy = Math.floor(p.y / TILE);
  for (let cy = pcy - 2; cy <= pcy + 2; cy++) {
    for (let cx = pcx - 2; cx <= pcx + 2; cx++) {
      const b = m.blockerAt(cx, cy);
      if (b) {
        const a = blockerAction(b);
        if (a) add(cx * TILE + 16, cy * TILE + 16, 46, a.label, a.short, a.action, a.prio || 0);
      }
      const trap = atHome() ? trapAt(cx, cy) : null;
      if (trap && !inCombat()) {
        if (!trap.armed) add(cx * TILE + 16, cy * TILE + 16, 44, 'Re-arm bear trap', 'ARM', () => rearmTrap(trap), 1);
        else add(cx * TILE + 16, cy * TILE + 16, 40, 'Pick up bear trap', 'TAKE', () => pickUpTrap(trap), -2);
      }
      const t = m.inBounds(cx, cy) ? m.trees.get(m.idx(cx, cy)) : null;
      if (t && !t.chopped) add(cx * TILE + 16, cy * TILE + 16, 42, `Chop tree (${3 - t.chops} swings left)`, 'CHOP', () => chopTree(t), -1);
    }
  }
  return out;
}

function propAction(pr) {
  const s = G.s;
  switch (pr.kind) {
    case 'bed': return { label: 'Use bed (sleep / save)', short: 'REST', action: () => openBedMenu() };
    case 'workbench': return { label: 'Use workbench (craft)', short: 'CRAFT', action: () => openCraft() };
    case 'phone': return { label: s.story.step === 'phone_call' ? 'Answer the ringing phone' : 'Use telephone', short: 'PHONE', action: () => answerPhone(), prio: s.story.step === 'phone_call' ? 3 : 0 };
    case 'car': return carAction();
    case 'exit': return { label: G.map.id === 'cabin' ? 'Walk to Pine Hollow (1 hr)' : 'Walk home (1 hr)', short: 'WALK', action: () => travelFn && travelFn(pr.target, 'walk') };
    case 'phonepole':
      if (s.home.phoneLine) return { label: 'Phone line (working)', short: 'LOOK', action: () => toast('The phone line hums. All good.', 'info') };
      return { label: 'Repair the cut phone line (Toolkit + 1 wood)', short: 'FIX', action: () => startRepair(null, 'phone'), prio: 2 };
    case 'mailbox': return { label: 'Check mailbox', short: 'MAIL', action: () => checkMail(), prio: G.s.story.step === 'ch2_letter' ? 4 : 0 };
    case 'jobboard': return { label: 'Read the job board', short: 'JOBS', action: () => openJobBoard() };
    case 'logdrop': return { label: s.job && s.job.type === 'woodcut' ? `Drop off wood (${count('wood')}/${s.job.need})` : 'Log drop-off', short: 'DROP', action: () => onLogDrop(), prio: s.job && s.job.type === 'woodcut' ? 2 : 0 };
    case 'shed': {
      const j = s.job;
      const want = j && ((j.type === 'repair' && j.stage === 'materials') || (j.type === 'supply' && j.stage === 'pickup'));
      return { label: want ? 'Collect job materials' : 'Supply shed (locked)', short: want ? 'TAKE' : 'LOOK', action: () => { if (!onShed()) toast('Gus keeps the shed for job materials.', 'info'); }, prio: want ? 2 : 0 };
    }
    case 'counter': {
      const j = s.job;
      if (j && j.type === 'delivery' && j.stage === 'pickup') return { label: 'Pick up the parcel', short: 'TAKE', action: () => onStoreCounter(), prio: 3 };
      const sk = chapter().shopkeeper;
      const keeper = G.npcs.find((n) => n.id === sk && n.present && n.spot === `${sk}_store`);
      const open = s.time.minute >= 8 * 60 && s.time.minute < 20 * 60;
      return { label: keeper && open ? 'Shop at the counter' : 'Counter (closed)', short: 'SHOP', action: () => { if (keeper && open) openShop(sk); else toast('The store is closed. Open 8 AM – 8 PM.', 'info'); } };
    }
    case 'footprints': return { label: 'Examine footprints', short: 'LOOK', action: () => examineSign('footprints'), prio: 2 };
    case 'strange_car': return { label: 'Approach the dark sedan', short: 'LOOK', action: () => examineSign('strange_car'), prio: 2 };
    case 'job_deliver': return { label: pr.label, short: 'GIVE', action: () => onDeliver(), prio: 3 };
    case 'job_repair': return { label: pr.label, short: 'FIX', action: () => onRepairTarget(), prio: 3 };
    case 'job_supply': return { label: pr.label, short: 'DROP', action: () => onSupplyDrop(), prio: 3 };
    case 'quest_find': return { label: pr.label, short: pr.dog ? 'CALL' : 'LOOK', action: () => questPropAction(pr), prio: 3 };
    case 'quest_done': return { label: pr.label, short: 'GIVE', action: () => questPropAction(pr), prio: 3 };
    case 'quest_chop': return { label: pr.label, short: 'CHOP', action: () => questPropAction(pr), prio: 3 };
    case 'quest_repair': return { label: pr.label, short: 'FIX', action: () => questPropAction(pr), prio: 3 };
    default: return null;
  }
}

function carAction() {
  const ch = chapter();
  const opts = [];
  if (ch.maps.length > 1) {
    const toWork = G.map.id === ch.homeMap;
    opts.push({ label: toWork ? `Drive to ${ch.place} (20 min)` : 'Drive home (20 min)', action: () => travelFn && travelFn(toWork ? ch.workMap : ch.homeMap, 'car') });
  }
  if (G.s.story.step === 'leave_town' && G.map.id === ch.homeMap) opts.push({ label: 'Leave for good — start the next chapter', action: () => G.events.emit('requestMove') });
  if (!opts.length) return { label: 'Your car (everything here is within walking distance)', short: 'CAR', action: () => toast('Everything in Millbrook is within walking distance.', 'info') };
  if (opts.length === 1) return { label: opts[0].label, short: 'DRIVE', action: opts[0].action, prio: G.s.story.step === 'leave_town' ? 3 : 0 };
  return { label: 'Your car: 2 options', short: 'DRIVE', action: () => openActions('Your Car', opts), prio: 3 };
}

function blockerAction(b) {
  if (b.kind === 'cover') return { label: `Pick up ${b.rec.type} (${Math.round(b.condition * 100)}%)`, short: 'TAKE', action: () => pickUpCover(b), prio: -1 };
  if (b.rec.npc) {
    if (b.kind !== 'door') return null;
    return { label: b.rec.open ? `Close ${b.label}` : `Open ${b.label}`, short: b.rec.open ? 'CLOSE' : 'OPEN', action: () => toggleDoor(b) };
  }
  const combat = inCombat();
  const opts = [];
  if (b.kind === 'door') {
    if (!b.broken) opts.push({ label: b.rec.open ? `Close ${b.label}` : `Open ${b.label}`, action: () => toggleDoor(b) });
    const need = repairNeed(b);
    if (need && !combat) opts.push({ label: `${need.label} — ${need.cost} wood`, action: () => startRepair(b, 'door'), disabled: count('wood') < need.cost });
    if (!b.rec.reinforced && count('door_brace') > 0 && !combat) opts.push({ label: 'Reinforce with Door Brace Kit', action: () => installBrace(b) });
  } else {
    const need = repairNeed(b);
    if (need && !combat) opts.push({ label: `${need.label} — ${need.cost} wood`, action: () => startRepair(b, 'window'), disabled: count('wood') < need.cost });
    if (!b.rec.boards && count('board_kit') > 0 && !combat) opts.push({ label: 'Board up with a Window Board Kit', action: () => installBoards(b) });
    if (!b.rec.shutters && count('shutter_kit') > 0 && !combat) opts.push({ label: 'Bolt on Steel Shutters', action: () => installShutters(b) });
    if (!opts.length) {
      const st = b.shuttered ? 'shuttered' : b.boarded ? 'boarded' : b.rec.glass > 0 ? 'intact' : 'smashed';
      return { label: `${b.label} (${st})`, short: 'LOOK', action: () => toast(b.rec.boards ? 'Boarded tight.' : 'Board kits from Marsh General, Okafor Lumber or the workbench can reinforce this window.', 'info', 2.5), prio: -2 };
    }
  }
  if (!opts.length) return null;
  if (opts.length === 1) return { label: opts[0].label, short: b.kind === 'door' && opts[0].label.startsWith('O') ? 'OPEN' : b.kind === 'door' && opts[0].label.startsWith('C') ? 'CLOSE' : 'FIX', action: opts[0].action, prio: 1 };
  return { label: `${b.label}: ${opts.length} options`, short: 'ACT', action: () => openActions(b.label, opts), prio: 1 };
}

function toggleDoor(b) {
  if (b.broken) return;
  if (b.rec.open) {
    // Don't close a door on top of someone.
    const cx = b.cx * TILE + 16, cy = b.cy * TILE + 16;
    const occupied = [G.player, ...G.enemies.filter((e) => !e.dead), ...G.npcs].some((e) => Math.abs(e.x - cx) < 16 + e.radius && Math.abs(e.y - cy) < 16 + e.radius);
    if (occupied) { toast('Something is in the doorway.', 'warn', 1.2); return; }
  }
  b.rec.open = !b.rec.open;
  sfx('door');
}

function examineSign(kind) {
  const w = G.s.world;
  const sign = w.signs[kind];
  if (!sign || sign.done) return;
  sign.done = true;
  if (kind === 'footprints') {
    playDialogue([
      { who: 'Frank', text: 'Footprints under the window. Size eleven dress shoes, not boots. Nobody hunts in loafers.' },
      { who: 'Frank', text: 'Someone stood here looking in. Recently.' },
    ]);
    addJP('shadow', 8);
    addXP(10, 'Investigated');
  } else if (kind === 'strange_car') {
    playDialogue([
      { who: 'Frank', text: 'A black sedan, engine ticking. Out-of-state plates — New Jersey.' },
      { who: 'Frank', text: 'The driver sees you coming. The headlights snap on and the car pulls away fast.' },
      { who: 'Frank', text: '(You memorized the plate. Whoever it is knows you\'re watching.)' },
    ]);
    addJP('shadow', 10);
    addXP(10, 'Investigated');
    addThreat(-3);
  }
  sfx('blip');
  G.map.props = G.map.props.filter((p) => p.id !== kind);
}

const MAIL = [
  'An electric bill addressed to "F. Lowe". Paid in full. Feels good.',
  'A seed catalog. Ruth must have put your name on a list.',
  'A flyer: "Pine Hollow Harvest Supper — all welcome." Nobody here knows who you were.',
  'A postcard with no message. Postmarked Newark. Your stomach drops.',
  'Junk mail. A credit card offer for a man who doesn\'t exist.',
];

function checkMail() {
  if (storyMail()) return;
  const day = G.s.time.day;
  if (G.s.world.mailDay === day) { toast('Nothing new today.', 'info'); return; }
  G.s.world.mailDay = day;
  const text = MAIL[day % MAIL.length];
  playDialogue([{ who: 'Mailbox', text }]);
  if (text.includes('Newark')) addThreat(2);
}

/** Current best interaction target (for HUD prompt), or null. */
export function findTarget() {
  if (!G.player || G.player.dead) return null;
  const c = candidates();
  if (!c.length) return null;
  c.sort((a, b) => a.score - b.score);
  return c[0];
}

export function doInteract(target) {
  if (!target) return;
  sfx('ui');
  target.action();
}

export { npcPresent };
