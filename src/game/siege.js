// Threat ("Heat"), warning signs, siege scheduling and the siege encounter itself.
import { G, isNight } from './state.js';
import { TILE } from '../config.js';
import { choose, chance, clamp, dist, randInt, rand } from '../util.js';
import { spawnEnemy, pickSpawnTypes } from './enemies.js';
import { addXP, addJP, derived, relOf } from './progression.js';
import { addItem, count } from './inventory.js';
import { banner, toast, centerMessage } from '../ui/hud.js';
import { showDefeat, showSiegeSummary } from '../ui/menus.js';
import { sfx, setMusic } from '../audio.js';
import { saveGame } from './save.js';
import { fmtClock } from '../util.js';

export const absNow = () => G.s.time.day * 1440 + G.s.time.minute;
export const absOf = (s) => s.day * 1440 + s.minute;

export function heatLabel(t) {
  if (t < 25) return 'Low';
  if (t < 50) return 'Rising';
  if (t < 75) return 'High';
  return 'Severe';
}

export function addThreat(n, why) {
  const w = G.s.world;
  w.threat = clamp(w.threat + n, 0, 100);
  if (why && n > 0) toast(`Heat rising: ${why}`, 'danger', 3);
}

/* ---------------- planning ---------------- */
function dirsFor(n) {
  const all = Object.keys(G.maps.cabin.spawns);
  const out = [];
  while (out.length < n) { const d = choose(all); if (!out.includes(d)) out.push(d); }
  return out;
}

export function makeRaidPlan(size, kind = 'raid') {
  const lvl = G.s.stats.level;
  const n = clamp(size, 2, 8);
  const types = kind === 'ambush'
    ? pickSpawnTypes(n, [['scout', 0.8], ['gunman', 0.2]])
    : pickSpawnTypes(n, G.s.world.threat < 40 && lvl < 3
      ? [['scout', 0.7], ['gunman', 0.2], ['enforcer', 0.1]]
      : [['scout', 0.45], ['gunman', 0.3], ['enforcer', 0.25]]);
  const nd = n <= 3 ? 1 : n <= 5 ? 2 : 3;
  const dirs = kind === 'ambush' ? [choose(['east', 'southwest'])] : dirsFor(nd);
  const waves = dirs.map((dir, i) => ({ dir, types: [], delay: i * rand(14, 26) }));
  types.forEach((t, i) => waves[i % waves.length].types.push(t));
  const hpMult = 1 + Math.max(0, lvl - 3) * 0.05; // gentle scaling, never makes old enemies irrelevant
  return { kind, waves, hpMult };
}

export function storyPlan() {
  return {
    kind: 'story', hpMult: 1,
    waves: [
      { dir: 'north', types: ['scout', 'scout'], delay: 0 },
      { dir: 'east', types: ['gunman', 'scout'], delay: 22 },
      { dir: 'west', types: ['enforcer', 'gunman'], delay: 45, boss: 0 },
    ],
  };
}

export function scheduleSiege(plan, day, minute) {
  let d = day, m = minute;
  while (m >= 1440) { m -= 1440; d += 1; }
  G.s.world.siege = { day: d, minute: m, plan, warned: false };
}

export function siegeTonight() {
  const s = G.s.world.siege;
  if (!s) return false;
  return absOf(s) - absNow() < 18 * 60;
}

/* ---------------- daily processing (at dawn) ---------------- */
export function dailyProcess() {
  const w = G.s.world;
  const day = G.s.time.day;
  if (w.lastDayProcessed === day) return;
  w.lastDayProcessed = day;
  const story = G.s.story;
  const free = story.flags.firstSiegeDone;
  // Reset previous signs
  for (const k of Object.keys(w.signs)) if (w.signs[k].day < day) delete w.signs[k];
  G.map && G.map.id === 'cabin' && refreshSignProps();

  if (free) {
    w.threat = clamp(w.threat + 3, 0, 100);
    if (!w.siege && day >= w.quietUntilDay) {
      const p = 0.12 + w.threat / 160;
      if (chance(p)) {
        const size = 2 + Math.floor(w.threat / 25) + Math.floor(G.s.stats.level / 3) + randInt(0, 1);
        scheduleSiege(makeRaidPlan(size), day, 21 * 60 + randInt(0, 240));
      }
    }
  }
  // Signs: likely before a real attack, occasionally a false alarm.
  const attackSoon = !!w.siege && siegeTonight();
  if ((attackSoon && chance(0.8)) || (!attackSoon && free && chance(0.22))) {
    addSign(choose(['strange_car', 'footprints', 'phone_line', 'stranger']));
  }
}

export function addSign(kind) {
  const w = G.s.world;
  const day = G.s.time.day;
  if (kind === 'phone_line') {
    G.s.home.phoneLine = false;
    w.signs.phone_line = { day, done: false };
  } else w.signs[kind] = { day, done: false };
  refreshSignProps();
}

/** Add/remove the world props for active warning signs on the cabin map. */
export function refreshSignProps() {
  const m = G.maps.cabin;
  if (!m) return;
  m.props = m.props.filter((p) => !p.sign);
  const w = G.s.world;
  const day = G.s.time.day;
  const min = G.s.time.minute;
  const fp = w.signs.footprints;
  if (fp && !fp.done && fp.day === day) {
    m.props.push({ id: 'footprints', kind: 'footprints', sign: true, x: m.points.footprints.x, y: m.points.footprints.y, r: 50, label: 'Footprints' });
  }
  const sc = w.signs.strange_car;
  if (sc && !sc.done && sc.day === day && min >= 17 * 60 && min < 23 * 60) {
    const p = m.points.strange_car;
    m.props.push({ id: 'strange_car', kind: 'strange_car', sign: true, x: p.x, y: p.y, r: 80, label: 'Dark Sedan',
      light: { x: p.x - 70, y: p.y, r: 120 } });
  }
}

/* ---------------- runtime ---------------- */
export function updateThreatClock() {
  const w = G.s.world;
  const s = w.siege;
  // Sign props appear/disappear with the clock.
  if (G.map.id === 'cabin') {
    const sc = w.signs.strange_car;
    const has = G.map.props.some((p) => p.id === 'strange_car');
    const should = sc && !sc.done && sc.day === G.s.time.day && G.s.time.minute >= 17 * 60 && G.s.time.minute < 23 * 60;
    if (!!has !== !!should) refreshSignProps();
  }
  // Ruth's warning call at 6 PM when an attack is coming and you're friends.
  if (s && !s.ruthCalled && siegeTonight() && relOf('ruth') >= 2 && G.s.time.minute >= 18 * 60 && G.s.time.minute < 21 * 60) {
    s.ruthCalled = true;
    if (G.s.home.phoneLine) {
      sfx('phone');
      banner('📞 Ruth called: "Headlights crawled past my gate twice. Lock up tonight, Frank."', 'danger', 7);
      s.extraLead = 60;
    } else {
      toast('The phone line is dead — if Ruth tried to call, it didn\'t get through.', 'warn', 4);
    }
  }
  if (!s || G.siegeActive) return;
  const now = absNow();
  const at = absOf(s);
  const d = derived();
  const lead = d.warnLead + (s.extraLead || 0);
  if (!s.warned && now >= at - lead && now < at) {
    s.warned = true;
    warn(s, d);
  }
  if (now >= at) {
    if (G.map.id === 'cabin' && !G.transition) startSiege(s);
    else if (G.s.time.minute >= 6 * 60 && G.s.time.minute < 12 * 60 && now - at > 60) missedSiege(s);
  }
}

function warn(s, d) {
  const alarm = G.s.home.upgrades.alarm;
  sfx(alarm ? 'alarm' : 'warning');
  const dirs = s.plan.waves.map((w) => G.maps.cabin.spawns[w.dir].label);
  let text = alarm ? '🔔 Tripwire alarm! Someone is coming' : '⚠ Something\'s wrong. Engines idling in the dark';
  if (d.showDirections) text += ` — from ${[...new Set(dirs)].join(', ')}`;
  text += `. Attack around ${fmtClock(s.minute)}.`;
  banner(text, 'danger', 9);
  if (G.sleeping) G.events.emit('wake', 'You wake with a start.');
  G.events.emit('siegeWarning', s);
}

function missedSiege(s) {
  const w = G.s.world;
  w.siege = null;
  if (s.plan.kind === 'story') {
    // The story attack waits for you: they come back the next night.
    scheduleSiege(s.plan, G.s.time.day, 22 * 60);
    G.s.world.siege.warned = false;
    toast('You weren\'t home last night. Whoever came will be back tonight.', 'danger', 5);
  } else {
    const back = G.s.home.openings.back_door;
    back.hp = Math.max(10, back.hp - 35);
    toast('Someone came by the cabin while you were away. The back door has been forced.', 'danger', 5);
    w.quietUntilDay = G.s.time.day + 1;
  }
}

export function startSiege(s, immediate = false) {
  G.siegeActive = true;
  G.siege = { plan: s.plan, t: 0, waveIdx: 0, spawned: 0, killed: 0, fled: 0, total: s.plan.waves.reduce((a, w) => a + w.types.length, 0), startHp: G.player.hp };
  G.s.world.siege = null;
  setMusic('tense');
  sfx('warning');
  const label = s.plan.kind === 'story' ? 'THEY FOUND YOU' : s.plan.kind === 'ambush' ? 'AMBUSH' : 'SIEGE';
  centerMessage(label, s.plan.kind === 'ambush' ? 'Get to cover!' : 'Defend the cabin', 2.6);
  if (G.sleeping) G.events.emit('wake', 'Shouts outside! You scramble out of bed.');
  G.events.emit('siegeStart', s.plan);
}

export function updateSiege(dt) {
  if (!G.siegeActive) return;
  const sg = G.siege;
  sg.t += dt;
  const map = G.map;
  while (sg.waveIdx < sg.plan.waves.length && sg.t >= sg.plan.waves[sg.waveIdx].delay) {
    const wave = sg.plan.waves[sg.waveIdx];
    const sp = map.spawns[wave.dir] || Object.values(map.spawns)[0];
    wave.types.forEach((t, i) => {
      const pos = freeSpot(sp.x + rand(-40, 40), sp.y + rand(-40, 40));
      const opts = { hpMult: sg.plan.hpMult };
      if (sg.plan.kind === 'story' && wave.boss === i) { opts.name = 'Big Carmine'; opts.hpMult = 1.35; opts.carriesNote = true; }
      const e = spawnEnemy(t, pos.x, pos.y, opts);
      if (sg.plan.kind === 'ambush') e.alerted = true;
      sg.spawned++;
    });
    const d = derived();
    if (d.showDirections || sg.waveIdx === 0) banner(`Attackers approaching from ${sp.label}!`, 'danger', 4);
    G.events.emit('waveSpawn', wave);
    sg.waveIdx++;
  }
  const alive = G.enemies.filter((e) => !e.dead && !e.gone).length;
  if (sg.waveIdx >= sg.plan.waves.length && alive === 0 && !G.player.dead) endSiege();
}

function freeSpot(x, y) {
  const m = G.map;
  for (let r = 0; r < 6; r++) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const px = x + Math.cos(a) * r * TILE, py = y + Math.sin(a) * r * TILE;
      const cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
      if (m.inBounds(cx, cy) && !m.blocksMove(cx, cy, 'enemy')) return { x: cx * TILE + 16, y: cy * TILE + 16 };
    }
  }
  return { x, y };
}

export function initSiegeEvents() {
  G.events.on('enemyKilled', (e) => {
    if (G.siege) G.siege.killed++;
    addXP(e.def.xp, null);
    addJP('gunhand', 4);
  });
  G.events.on('enemyFled', () => {
    if (G.siege) G.siege.fled++;
    addJP('gunhand', 2);
    toast('An attacker fled into the dark.', 'info', 2);
  });
  G.events.on('enemyRetreat', (e) => { toast(`${e.name} is retreating!`, 'info', 1.8); });
}

function endSiege() {
  const sg = G.siege;
  const w = G.s.world;
  const kind = sg.plan.kind;
  G.siegeActive = false;
  w.threat = clamp(w.threat - (kind === 'ambush' ? 8 : 20), 0, 100);
  w.lastSiegeDay = G.s.time.day;
  w.quietUntilDay = G.s.time.day + (kind === 'ambush' ? 1 : 2);
  w.sieges++;
  const xp = (kind === 'story' ? 120 : kind === 'ambush' ? 30 : 60) + sg.total * 8;
  addXP(xp, 'Survived');
  addJP('gunhand', kind === 'ambush' ? 8 : 18);
  addJP('survivor', 4);
  sfx('victory');
  setMusic(isNight() ? 'night' : 'day');
  centerMessage(kind === 'story' ? 'YOU SURVIVED THE NIGHT' : 'ATTACK REPELLED', `${sg.killed} down · ${sg.fled} fled`, 3.5);
  G.events.emit('siegeWon', sg);
  G.siege = null;
  // Shells for the next fight so a long siege can't leave you stranded.
  if (count('ammo') < 16) { addItem('ammo', 16 - count('ammo'), true); toast('You scrounge spare rounds from the yard.', 'item', 3); }
  showSiegeSummary({ kind, killed: sg.killed, fled: sg.fled, xp, total: sg.total });
  saveGame('siege');
}

/** Repeatable small ambush when arriving home at night with high Heat. */
export function maybeAmbushOnArrival() {
  const w = G.s.world;
  if (!G.s.story.flags.firstSiegeDone || G.siegeActive || w.siege) return;
  if (!isNight() || w.threat < 30 || G.s.time.day < w.quietUntilDay) return;
  if (!chance(0.3)) return;
  const plan = makeRaidPlan(2 + (w.threat > 60 ? 1 : 0), 'ambush');
  startSiege({ plan });
}

/* ---------------- defeat ---------------- */
export function handleDefeat() {
  if (G.transition && G.transition.kind === 'defeat') return;
  G.transition = { kind: 'defeat', phase: 'hold', fade: 0.65, t: 0 };
  const w = G.s.world;
  const story = G.siege && G.siege.plan.kind === 'story';
  const lost = Math.min(150, Math.floor(G.s.money * 0.2));
  sfx('defeat');
  setMusic('night');
  const onCabin = G.map.id === 'cabin';
  const ruthFriend = relOf('ruth') >= 1;
  const rescuer = onCabin ? (ruthFriend ? 'Ruth' : 'Ruth') : 'Dee';
  showDefeat({
    lost,
    rescuer,
    text: onCabin
      ? (ruthFriend
        ? 'Ruth heard the shots and came with her late husband\'s shotgun. The attackers scattered. She dragged you to her farmhouse and patched you up through the night.'
        : 'Ruth heard the shots and called the county sheriff. By the time the sirens came, the attackers were gone. She found you on the porch and took you in.')
      : 'Dee found you slumped behind the store and hauled you inside. "Whoever they were, they took off when I hit the lights."',
    story,
    onContinue: () => recoverFromDefeat({ lost, story, onCabin }),
  });
  w.defeats++;
}

function recoverFromDefeat({ lost, story, onCabin }) {
  const w = G.s.world;
  const plan = G.siege ? G.siege.plan : null;
  G.siegeActive = false;
  G.siege = null;
  G.enemies = [];
  G.bullets = [];
  G.s.money -= lost;
  w.threat = clamp(w.threat + 5, 0, 100);
  // Property damage: the attackers trashed the place on the way out.
  if (onCabin) {
    for (const o of Object.values(G.s.home.openings)) {
      if (o.kind === 'door') { o.hp = Math.max(15, Math.round(o.hp * 0.6)); o.open = false; }
      else { o.glass = 0; o.boardHp = Math.round(o.boardHp * 0.5); if (o.boardHp <= 0) o.boards = false; }
    }
  }
  // Time skips to the next morning.
  if (G.s.time.minute >= 6 * 60) G.s.time.day += 1;
  G.s.time.minute = 9 * 60;
  const d = derived();
  G.player.dead = false;
  G.player.hp = Math.round(d.maxHp * 0.75);
  G.player.stamina = d.maxStamina;
  // Never leave the player stranded without the means to fight back.
  const gifts = [];
  if (count('ammo') + G.player.mag < 24) { addItem('ammo', 24, true); gifts.push('24 rounds'); }
  if (count('bandage') < 2) { addItem('bandage', 2, true); gifts.push('2 bandages'); }
  w.quietUntilDay = G.s.time.day + 1;
  if (story && plan) scheduleSiege(plan, G.s.time.day, 22 * 60);
  G.events.emit('recovered', { onCabin, gifts, story });
}
