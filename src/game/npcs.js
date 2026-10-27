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
import { chapter, workMapId, homeMapId } from './chapters.js';
import { ruthJoined, companionSchedule, updateAlly, COMPANION_LINES } from './ally.js';
import { questOffer, questTalk } from './quests.js';
import { errandTalk, offerErrand } from './errands.js';

function npcCost(cx, cy) {
  const m = G.map;
  if (m.getSolid(cx, cy) !== 0) return Infinity;
  const b = m.blockerAt(cx, cy);
  if (b && b.kind !== 'door') return Infinity;
  return 0;
}

export function scheduleSpot(def, minute) {
  if (def === NPCS.ruth && G.s && G.s.chapter > 1 && ruthJoined()) return { map: homeMapId(), pt: companionSchedule(minute) };
  for (const [a, b, map, pt] of def.schedule) if (minute >= a && minute < b) return { map, pt };
  return { map: def.home[0], pt: def.home[1] };
}

/** Build NPC entities for the current map. */
export function spawnNpcs() {
  G.npcs = [];
  const m = G.map;
  const minute = G.s.time.minute;
  for (const [id, def] of Object.entries(NPCS)) {
    const followsYou = id === 'ruth' && G.s.chapter > 1 && ruthJoined() && m.id === homeMapId();
    if (def.map !== m.id && !followsYou) continue;
    if (id === 'ruth' && G.s.chapter > 1 && !followsYou) continue;
    if (id === 'leo' && (G.s.story.done || {})[5] && G.s.ending !== 'walk') continue; // the study is empty now
    const spot = scheduleSpot(def, minute);
    const p = m.points[spot.pt];
    G.npcs.push({ id, def, named: true, x: p.x, y: p.y, radius: 10, angle: Math.PI / 2, spot: spot.pt, path: null, walkPhase: 0, idleT: 0 });
  }
  if (m.id === workMapId()) {
    for (const f of TOWNSFOLK[m.id] || []) {
      const p = m.points[f.route[0]];
      G.npcs.push({ id: f.id, def: f, folk: true, x: p.x, y: p.y, radius: 10, angle: 0, routeIdx: 0, path: null, walkPhase: 0, idleT: Math.random() * 3, spot: f.route[0] });
    }
    G.npcs.push({ id: 'stranger', def: { name: 'Man in a Grey Coat', body: '#3b3f46', hair: '#111', skin: '#d6a98a' }, stranger: true,
      x: m.points.stranger.x, y: m.points.stranger.y, radius: 10, angle: Math.PI / 2, path: null, walkPhase: 0, spot: 'stranger' });
  }
  if (m.points.reyes) {
    G.npcs.push({ id: 'reyes', def: { name: 'Agent Dana Reyes', body: '#1d2230', hair: '#1a1210', skin: '#b88660' }, reyes: true,
      x: m.points.reyes.x, y: m.points.reyes.y, radius: 10, angle: Math.PI, path: null, walkPhase: 0, spot: 'reyes' });
  }
  if (m.points.deputy) {
    G.npcs.push({ id: 'deputy', def: { name: 'Deputy Carl Mott', body: '#6b5a3a', hair: '#3a2a1a', skin: '#e0b08a', hat: true }, deputy: true,
      x: m.points.deputy.x, y: m.points.deputy.y, radius: 10, angle: -Math.PI / 2, path: null, walkPhase: 0, spot: 'deputy' });
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
  if (n.reyes) return G.s.story.step === 'ch4_reyes' && minute >= 8 * 60 && minute < 19 * 60;
  if (n.deputy) return G.s.story.step === 'ch3_deputy' && minute >= 8 * 60 && minute < 19 * 60;
  return true;
}

export function updateNpcs(dt) {
  const m = G.map;
  const minute = G.s.time.minute;
  for (const n of G.npcs) {
    n.present = npcPresent(n);
    if (!n.present) continue;
    if (n.id === 'ruth' && updateAlly(dt)) continue;
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
    if (errandTalk(n.id) || offerErrand(n.id)) return;
    playDialogue([{ who: n.def.name, text: choose(FOLK_LINES[G.map.id] || FOLK_LINES.town) }]);
    if (dailyAllow('folk:' + n.id)) addJP('neighbor', 1);
    return;
  }
  if (n.stranger) { G.events.emit('talkStranger', n); return; }
  if (n.deputy) { G.events.emit('talkDeputy', n); return; }
  if (n.reyes) { G.events.emit('talkReyes', n); return; }
  // Story conversations take priority over the menu.
  const story = storyDialogue(n.id);
  if (story) { playDialogue(story.lines, story.onEnd); firstTalkBonus(n.id); return; }
  if (errandTalk(n.id)) return;
  if (questTalk(n.id)) return;
  openNpcMenu(n);
}

function firstTalkBonus(id) {
  if (dailyAllow('talk:' + id)) {
    addRel(id, 3);
    addJP('neighbor', 2);
  }
}

/** NPCs remember what you did: favors, story choices, recent fights. One line, picked at random. */
function memoryLine(id) {
  const s = G.s, q = s.quests || {}, c = s.choices || {}, w = s.world;
  const done = (qid) => q[qid] && q[qid].state === 'done';
  const out = [];
  if (w.lastAttackDay && s.time.day - w.lastAttackDay <= 1) out.push({
    ruth: 'I counted the shell casings this morning. Forty-one. Harold would\'ve had something to say about that.',
    dee: 'Heard the shooting all the way from the store last night. You look like you haven\'t slept. Sit down a minute.',
    marcus: 'Sounded like a war over at your place. I had the radio scanner on. Nobody called it in. Interesting, isn\'t it?',
    ingrid: 'Cows wouldn\'t give milk this morning. Can\'t imagine why. You hurt?',
    rosa: 'You\'re on the morning gossip circuit, Frank. Somebody heard firecrackers. I said firecrackers.',
    bo: 'Couple of fellas asked me who bought all those shells. I said hunters. Hunt something, will you?',
  }[id]);
  if (id === 'ruth') {
    if (done('ruth_watch')) out.push('I wind Harold\'s watch every morning now. Then I give it back to you. You always forget it, Frank.');
    if (c.stranger === 'threaten') out.push('That man in the grey coat — you threatened him, didn\'t you? Men like that remember.');
    if (s.chapter >= 3 && c.deputy === 'bribe') out.push('Paying off a deputy. Harold paid off a building inspector once. The roof fell in anyway.');
    if (s.chapter >= 2) out.push('Pine Hollow seems a long way off now. I don\'t miss the winters. I miss the pond.');
  }
  if (id === 'dee' && done('dee_pie')) out.push('Pastor Abe still talks about that pie. Says it was delivered by an angel. I didn\'t correct him.');
  if (id === 'gus' && done('gus_log')) out.push('County finally came to look at that tree you cleared. Took the credit, too.');
  if (id === 'marcus' && done('marcus_antenna')) out.push('Antenna\'s holding. Picked up a trucker in Toledo last night singing to his cat. Worth it.');
  if (id === 'pete' && done('pete_dog')) out.push('Biscuit sleeps by the door now. Waiting for you, I think. Traitor.');
  if (id === 'ingrid') {
    if (c.marcusHelp) out.push('Marcus Bell called again. Asked if you\'re eating. I said you\'re eating my food, so yes.');
    if (c.deputy === 'refuse') out.push('Mott\'s been parking at the crossroads every night since you ran him off. Good. Let him get cold.');
    if (done('ingrid_calf')) out.push('Clover\'s been following the tractor around like a dog. Your fault, I think.');
    if (ruthJoined()) out.push('Your Ruth beat me at cribbage three times. I don\'t lose at cribbage, Frank.');
  }
  if (id === 'bo' && done('bo_fish')) out.push('Best fish fry in ten years. People asked who caught them. I said a mysterious stranger. Fits.');
  if (id === 'eleanor') {
    if (done('eleanor_brooch')) out.push('I wore Mother\'s cameo to the club. Commodore Ames asked where I found it. I said, "Under a hedge, like most things worth having."');
    if (c.reyes === 'give') out.push('An FBI agent in my rose garden. Edward is spinning in his mausoleum. I find I don\'t mind.');
    if (c.reyes === 'keep') out.push('You kept the book. Edward kept things too. It did not end well for him, Mr. Lowe.');
    if (ruthJoined()) out.push('Your Mrs. Calloway corrected my roses. Nobody corrects my roses. I have invited her to tea.');
  }
  if (id === 'theo' && done('theo_motor')) out.push('The charter guys caught a forty-pound pike. I told them my caretaker friend fixed the motor. They think you\'re a legend.');
  if (id === 'walt' && done('walt_logs')) out.push('Club voted to name the path after you. I vetoed it. You\'d hate that.');
  if (id === 'tess' && done('tess_scale')) out.push('Scale\'s still reading true. The Johansson boys are furious. They were the ones getting the deal.');
  return out.length ? choose(out) : null;
}

/** Everyday chat, with context-aware hints that are relationship benefits. */
export function chatWith(id) {
  const def = NPCS[id];
  const lv = relOf(id);
  const lines = [];
  const pool = id === 'ruth' && G.s.chapter > 1 ? [...COMPANION_LINES] : [...def.idle];
  if (hasSkill('familiar_face') || lv >= 3) pool.push(...def.friendly);
  const mem = memoryLine(id);
  lines.push({ who: def.name, text: mem && Math.random() < 0.6 ? mem : choose(pool) });
  const w = G.s.world;
  const ch = chapter();
  const first = def.name.split(' ')[0].replace(/"/g, '');
  if (id === ch.neighbor || (id === 'ruth' && G.s.chapter > 1)) {
    if (lv >= 2 && siegeTonight()) {
      lines.push({ who: def.name, text: id === 'ruth'
        ? 'Frank. I saw a car idling by your mailbox with its lights off. Twice. I\'ve got a bad feeling about tonight.'
        : 'Same sedan\'s been around the block four times since noon. Illinois plates. They\'re coming tonight, Frank. I\'d bet my pension on it.' });
      if (w.siege) w.siege.extraLead = Math.max(w.siege.extraLead || 0, 60);
      lines.push({ who: 'You', text: `(${first}'s warning: an attack is likely tonight. You'll get an earlier alert.)` });
    } else if (lv >= 2) {
      lines.push({ who: def.name, text: 'Street\'s been quiet. Quiet\'s good.' });
    } else {
      lines.push({ who: 'You', text: `(Get closer to ${first} and they'll tell you when trouble is coming.)` });
    }
    if (lv >= 3 && dailyAllow('neighborgift') && (G.s.time.day % 2) === 0) {
      lines.push({ who: def.name, text: 'Here — take these. You go through them faster than anyone I know.' });
      addItem('bandage', 2);
    }
  } else if (id === ch.shopkeeper) {
    if (lv >= 1) {
      const signs = Object.keys(w.signs).filter((k) => w.signs[k].day === G.s.time.day && !w.signs[k].done);
      if (signs.includes('stranger')) lines.push({ who: def.name, text: 'There\'s a fella in a grey coat hanging around outside, asking about newcomers. I didn\'t tell him a thing.' });
      else if (w.threat >= 50) lines.push({ who: def.name, text: 'Couple of out-of-state cars through town this week. Not tourists. Too clean.' });
      else lines.push({ who: def.name, text: 'Nothing new to report. Town\'s as boring as ever, thank God.' });
    }
    if (lv >= 2) lines.push({ who: 'You', text: `(${first} gives you a ${lv >= 4 ? 10 : 5}% friends discount.)` });
  } else if (id === ch.jobContact) {
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
  const reply = {
    ruth: 'Well aren\'t you sweet. I\'ll pretend I didn\'t see the price tag.', dee: 'From my own shelves? Ha! It\'s the thought, honey.', gus: 'Huh. Thanks. I skipped lunch.',
    marcus: 'Thoughtful. I\'ll eat it at the radio. Thank you, Frank.', rosa: 'Food from a customer? That\'s a first. Gracias.', pete: 'Oh, buddy. You\'re my favorite person today.',
  }[id];
  playDialogue([{ who: def.name, text: reply }]);
}

export function npcAvailableServices(n) {
  const minute = G.s.time.minute;
  const out = [];
  const ch = chapter();
  if (n.id === ch.shopkeeper && n.spot === `${n.id}_store` && minute >= 8 * 60 && minute < 20 * 60) out.push('shop');
  if (n.id === ch.jobContact && n.spot === `${n.id}_yard` && minute >= 7 * 60 && minute < 17 * 60) { out.push('jobs'); if (n.id === 'gus') out.push('shop'); }
  if (questOffer(n.id)) out.push('favor');
  return out;
}

export { relLevel, isNight };
