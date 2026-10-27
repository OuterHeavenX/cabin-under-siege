// NPC runtime: schedules, walking, talking, gifts and relationship benefits.
import { G, isNight } from './state.js';
import { TILE } from '../config.js';
import { NPCS, TOWNSFOLK, FOLK_LINES, relLevel } from '../data/npcs.js';
import { choose, dist } from '../util.js';
import { addRel, addJP, relOf } from './progression.js';
import { addItem, count, removeItem } from './inventory.js';
import { heatLabel, siegeTonight } from './siege.js';
import { storyDialogue } from './story.js';
import { playDialogue } from '../ui/dialogue.js';
import { openNpcMenu } from '../ui/menus.js';
import { toast } from '../ui/hud.js';
import { hasSkill } from './state.js';
import { dailyAllow } from './progression.js';

function npcCost(cx, cy) {
  const m = G.map;
  if (m.getSolid(cx, cy) !== 0) return Infinity;
  const b = m.blockerAt(cx, cy);
  if (b && b.kind !== 'door') return Infinity;
  return 0;
}

export function scheduleSpot(def, minute) {
  for (const [a, b, map, pt] of def.schedule) if (minute >= a && minute < b) return { map, pt };
  return { map: def.home[0], pt: def.home[1] };
}

/** Build NPC entities for the current map. */
export function spawnNpcs() {
  G.npcs = [];
  const m = G.map;
  const minute = G.s.time.minute;
  for (const [id, def] of Object.entries(NPCS)) {
    if (def.map !== m.id) continue;
    const spot = scheduleSpot(def, minute);
    const p = m.points[spot.pt];
    G.npcs.push({ id, def, named: true, x: p.x, y: p.y, radius: 10, angle: Math.PI / 2, spot: spot.pt, path: null, walkPhase: 0, idleT: 0 });
  }
  if (m.id === 'town') {
    for (const f of TOWNSFOLK) {
      const p = m.points[f.route[0]];
      G.npcs.push({ id: f.id, def: f, folk: true, x: p.x, y: p.y, radius: 10, angle: 0, routeIdx: 0, path: null, walkPhase: 0, idleT: Math.random() * 3, spot: f.route[0] });
    }
    G.npcs.push({ id: 'stranger', def: { name: 'Man in a Grey Coat', body: '#3b3f46', hair: '#111', skin: '#d6a98a' }, stranger: true,
      x: m.points.stranger.x, y: m.points.stranger.y, radius: 10, angle: Math.PI / 2, path: null, walkPhase: 0, spot: 'stranger' });
  }
}

export function npcPresent(n) {
  const minute = G.s.time.minute;
  if (n.folk) return minute >= 8 * 60 && minute < 19 * 60;
  if (n.stranger) {
    const s = G.s.world.signs.stranger;
    const storyWants = G.s.story.flags.strangerInTown && !G.s.story.flags.metStranger;
    const signActive = s && !s.done && s.day === G.s.time.day;
    return (storyWants || signActive) && minute >= 8 * 60 && minute < 19 * 60;
  }
  return true;
}

export function updateNpcs(dt) {
  const m = G.map;
  const minute = G.s.time.minute;
  for (const n of G.npcs) {
    n.present = npcPresent(n);
    if (!n.present) continue;
    let target = null;
    if (n.named) {
      const spot = scheduleSpot(n.def, minute);
      if (spot.pt !== n.spot) { n.spot = spot.pt; n.path = null; }
      target = m.points[n.spot];
    } else if (n.folk) {
      if (n.idleT > 0) { n.idleT -= dt; continue; }
      target = m.points[n.def.route[n.routeIdx]];
      if (dist(n.x, n.y, target.x, target.y) < 8) {
        n.routeIdx = (n.routeIdx + 1) % n.def.route.length;
        n.idleT = 3 + Math.random() * 5;
        n.path = null;
        continue;
      }
    } else continue;
    if (!target) continue;
    // Stop and face the player when they're close (feels responsive).
    const pd = dist(n.x, n.y, G.player.x, G.player.y);
    if (pd < 46) { n.angle = Math.atan2(G.player.y - n.y, G.player.x - n.x); continue; }
    const d = dist(n.x, n.y, target.x, target.y);
    if (d < 6) continue;
    if (!n.path) {
      n.path = m.findPath(Math.floor(n.x / TILE), Math.floor(n.y / TILE), Math.floor(target.x / TILE), Math.floor(target.y / TILE), npcCost, 4000) || [];
      n.path.push({ final: true });
    }
    const nx = n.path[0];
    if (!nx) { n.path = null; continue; }
    const tx = nx.final ? target.x : nx.cx * TILE + 16, ty = nx.final ? target.y : nx.cy * TILE + 16;
    const dd = dist(n.x, n.y, tx, ty);
    if (dd < 4) { n.path.shift(); continue; }
    const a = Math.atan2(ty - n.y, tx - n.x);
    const sp = 58;
    m.moveCircle(n, Math.cos(a) * sp * dt, Math.sin(a) * sp * dt, 'npc');
    n.angle = a;
    n.walkPhase += dt * 8;
  }
}

/* ---------------- talking ---------------- */
export function interactNpc(n) {
  if (n.folk) {
    playDialogue([{ who: n.def.name, text: choose(FOLK_LINES) }]);
    if (dailyAllow('folk:' + n.id)) addJP('neighbor', 1);
    return;
  }
  if (n.stranger) { G.events.emit('talkStranger', n); return; }
  // Story conversations take priority over the menu.
  const story = storyDialogue(n.id);
  if (story) { playDialogue(story.lines, story.onEnd); firstTalkBonus(n.id); return; }
  openNpcMenu(n);
}

function firstTalkBonus(id) {
  if (dailyAllow('talk:' + id)) {
    addRel(id, 3);
    addJP('neighbor', 2);
  }
}

/** Everyday chat, with context-aware hints that are relationship benefits. */
export function chatWith(id) {
  const def = NPCS[id];
  const lv = relOf(id);
  const lines = [];
  const pool = [...def.idle];
  if (hasSkill('familiar_face') || lv >= 3) pool.push(...def.friendly);
  lines.push({ who: def.name, text: choose(pool) });
  const w = G.s.world;
  if (id === 'ruth') {
    if (lv >= 2 && siegeTonight()) {
      lines.push({ who: def.name, text: 'Frank. I saw a car idling by your mailbox with its lights off. Twice. I\'ve got a bad feeling about tonight.' });
      if (w.siege) w.siege.extraLead = Math.max(w.siege.extraLead || 0, 60);
      lines.push({ who: 'You', text: '(Ruth\'s warning: an attack is likely tonight. You\'ll get an earlier alert.)' });
    } else if (lv >= 2) {
      lines.push({ who: def.name, text: 'Road\'s been quiet. Quiet\'s good.' });
    } else if (lv < 2) {
      lines.push({ who: 'You', text: '(Get closer to Ruth and she\'ll tell you when trouble is coming.)' });
    }
    if (lv >= 3 && dailyAllow('ruthgift')) {
      if ((G.s.time.day % 2) === 0) {
        lines.push({ who: def.name, text: 'Here — old habit from the hospital. Take these.' });
        addItem('bandage', 2);
      }
    }
  } else if (id === 'dee') {
    if (lv >= 1) {
      const signs = Object.keys(w.signs).filter((k) => w.signs[k].day === G.s.time.day && !w.signs[k].done);
      if (signs.includes('stranger')) lines.push({ who: def.name, text: 'There\'s a fella in a grey coat out by the diner, asking about newcomers. I didn\'t tell him a thing.' });
      else if (w.threat >= 50) lines.push({ who: def.name, text: 'Couple of out-of-state cars through town this week. Not hunters. Too clean.' });
      else lines.push({ who: def.name, text: 'Nothing new to report. Town\'s as boring as ever, thank God.' });
    }
    if (lv >= 2) lines.push({ who: 'You', text: `(Dee gives you a ${lv >= 4 ? 10 : 5}% friends discount.)` });
  } else if (id === 'gus') {
    if (lv >= 2) lines.push({ who: def.name, text: 'You\'ve earned a raise. Jobs pay 10% more from now on.' });
    if (lv >= 1 && w.threat >= 40) lines.push({ who: def.name, text: `Heat on you feels ${heatLabel(w.threat).toLowerCase()}, if you want my read. Keep your eyes open.` });
  }
  firstTalkBonus(id);
  playDialogue(lines);
}

export function giveGift(id) {
  const food = ['stew', 'sandwich'].find((f) => count(f) > 0);
  if (!food) { toast('You have no food to give.', 'warn'); return; }
  if (!dailyAllow('gift:' + id)) { toast('You already gave a gift today.', 'warn'); return; }
  removeItem(food, 1);
  addRel(id, 6);
  addJP('neighbor', 3);
  const def = NPCS[id];
  const reply = { ruth: 'Well aren\'t you sweet. I\'ll pretend I didn\'t see the price tag.', dee: 'From my own shelves? Ha! It\'s the thought, honey.', gus: 'Huh. Thanks. I skipped lunch.' }[id];
  playDialogue([{ who: def.name, text: reply }]);
}

export function npcAvailableServices(n) {
  const minute = G.s.time.minute;
  const out = [];
  if (n.id === 'dee' && n.spot === 'dee_store' && minute >= 8 * 60 && minute < 20 * 60) out.push('shop');
  if (n.id === 'gus' && n.spot === 'gus_yard' && minute >= 7 * 60 && minute < 17 * 60) { out.push('jobs'); out.push('shop'); }
  return out;
}

export { relLevel, isNight };
