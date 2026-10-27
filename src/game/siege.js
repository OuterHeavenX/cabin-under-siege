// Threat ("Heat"), warning signs, siege scheduling and the siege encounter itself.
import { G, isNight } from './state.js';
import { TILE } from '../config.js';
import { choose, chance, clamp, dist, randInt, rand } from '../util.js';
import { spawnEnemy, pickSpawnTypes } from './enemies.js';
import { addXP, addJP, derived, relOf } from './progression.js';
import { addItem, count } from './inventory.js';
import { banner, toast, centerMessage, clearBanners } from '../ui/hud.js';
import { showDefeat, showSiegeSummary, showEndlessResult } from '../ui/menus.js';
import { endlessWaveCleared, endlessDefeat } from './endless.js';
import { sfx, setMusic } from '../audio.js';
import { saveGame } from './save.js';
import { fmtClock } from '../util.js';
import { chapter, homeMap, homeMapId, atHome } from './chapters.js';
import { NPCS } from '../data/npcs.js';
import { allyStartSiege, allyEndSiege } from './ally.js';
import { diff } from './difficulty.js';
import { playCutscene } from '../ui/cutscene.js';

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
  const all = Object.keys(homeMap().spawns);
  const out = [];
  while (out.length < n) { const d = choose(all); if (!out.includes(d)) out.push(d); }
  return out;
}

export function makeRaidPlan(size, kind = 'raid') {
  const lvl = G.s.stats.level;
  const n = clamp(size, 2, 8);
  const late = G.s.chapter >= 2 || G.s.world.threat >= 60;
  let types;
  if (kind === 'ambush') types = pickSpawnTypes(n, [['scout', 0.8], ['gunman', 0.2]]);
  else if (G.s.world.threat < 40 && lvl < 3 && G.s.chapter < 2) types = pickSpawnTypes(n, [['scout', 0.7], ['gunman', 0.2], ['enforcer', 0.1]]);
  else types = pickSpawnTypes(n, late
    ? [['scout', 0.32], ['gunman', 0.26], ['enforcer', 0.22], ['arsonist', 0.2]]
    : [['scout', 0.4], ['gunman', 0.28], ['enforcer', 0.22], ['arsonist', 0.1]]);
  // Big raids are led by a lieutenant.
  if (kind === 'raid' && n >= 6) types[types.length - 1] = 'lieutenant';
  const nd = n <= 3 ? 1 : n <= 5 ? 2 : 3;
  const dirs = kind === 'ambush' ? [choose(['east', 'southwest', 'west'].filter((d) => homeMap().spawns[d]))] : dirsFor(nd);
  const waves = dirs.map((dir, i) => ({ dir, types: [], delay: i * rand(14, 26) }));
  types.forEach((t, i) => waves[i % waves.length].types.push(t));
  const hpMult = 1 + Math.max(0, lvl - 3) * 0.05; // gentle scaling, never makes old enemies irrelevant
  return { kind, waves, hpMult };
}

export function storyPlan() {
  const ch = G.s.choices || {};
  if (G.s.chapter === 3) {
    const waves = [
      { dir: 'west', types: ['truck', 'scout', 'scout'], delay: 0 },
      { dir: 'east', types: ['sniper', 'gunman'], delay: 18 },
      { dir: 'south', types: ['lieutenant', 'enforcer', 'arsonist'], delay: 42, boss: 0 },
    ];
    if (ch.deputy === 'refuse') waves[1].types.push('sniper');
    if (ch.deputy === 'cooperate') waves[0].types.pop();
    return { kind: 'story', hpMult: 1.15, bossName: 'Vinnie Vescari', bossItem: 'ledger', waves };
  }
  if (G.s.chapter === 2) {
    return {
      kind: 'story', hpMult: 1.1, bossName: 'Sal "the Knife" Benedetto', bossItem: 'burner',
      waves: [
        { dir: 'west', types: ['scout', 'scout', 'arsonist'], delay: 0 },
        { dir: 'south', types: ['gunman', 'enforcer'], delay: 22 },
        { dir: 'east', types: ['lieutenant', 'gunman', 'arsonist'], delay: 48, boss: 0 },
      ],
    };
  }
  return {
    kind: 'story', hpMult: 1, bossName: 'Big Carmine', bossItem: 'note',
    waves: [
      { dir: 'north', types: ch.stranger === 'threaten' ? ['scout', 'scout', 'gunman'] : ['scout', 'scout'], delay: 0, named: ch.stranger === 'threaten' ? { 2: 'The Grey Coat' } : null },
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
  if (G.endless) return;
  const w = G.s.world;
  const day = G.s.time.day;
  if (w.lastDayProcessed === day) return;
  w.lastDayProcessed = day;
  const story = G.s.story;
  const free = story.flags.firstSiegeDone;
  // Reset previous signs
  for (const k of Object.keys(w.signs)) if (w.signs[k].day < day) delete w.signs[k];
  G.map && atHome() && refreshSignProps();

  if (free) {
    w.threat = clamp(w.threat + 3, 0, 100);
    if (!w.siege && day >= w.quietUntilDay) {
      const p = (0.12 + w.threat / 160) * diff().raid;
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

/** Add/remove the world props for active warning signs on the home map. */
export function refreshSignProps() {
  const m = homeMap();
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
  if (G.endless) return;
  const w = G.s.world;
  const s = w.siege;
  // Sign props appear/disappear with the clock.
  if (atHome()) {
    const sc = w.signs.strange_car;
    const has = G.map.props.some((p) => p.id === 'strange_car');
    const should = sc && !sc.done && sc.day === G.s.time.day && G.s.time.minute >= 17 * 60 && G.s.time.minute < 23 * 60;
    if (!!has !== !!should) refreshSignProps();
  }
  // The neighbor's warning call at 6 PM when an attack is coming and you're friends.
  const nb = chapter().neighbor;
  const nbName = NPCS[nb].name.split(' ')[0];
  if (s && !s.ruthCalled && siegeTonight() && relOf(nb) >= 2 && G.s.time.minute >= 18 * 60 && G.s.time.minute < 21 * 60) {
    s.ruthCalled = true;
    if (G.s.home.phoneLine) {
      sfx('phone');
      banner(nb === 'ruth' ? '📞 Ruth called: "Headlights crawled past my gate twice. Lock up tonight, Frank."' : `📞 ${nbName} called: "Same sedan, fourth pass tonight. They're coming, Frank. Get ready."`, 'danger', 7);
      s.extraLead = 60;
    } else {
      toast(`The phone line is dead — if ${nbName} tried to call, it didn't get through.`, 'warn', 4);
    }
  }
  if (s && !s.mottCalled && s.plan.kind === 'story' && G.s.chapter === 3 && (G.s.choices || {}).deputy === 'bribe' && siegeTonight() && G.s.time.minute >= 17 * 60) {
    s.mottCalled = true; s.extraLead = Math.max(s.extraLead || 0, 90);
    sfx('phone');
    banner('📞 Deputy Mott: "Friendly call. Trucks on the county road tonight, around ten. You didn\'t hear it from me."', 'danger', 7);
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
    if (atHome() && !G.transition) startSiege(s);
    else if (G.s.time.minute >= 6 * 60 && G.s.time.minute < 12 * 60 && now - at > 60) missedSiege(s);
  }
}

function warn(s, d) {
  const alarm = G.s.home.upgrades.alarm;
  sfx(alarm ? 'alarm' : 'warning');
  const dirs = s.plan.waves.map((w) => (homeMap().spawns[w.dir] || {}).label || w.dir);
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
    toast('Someone came by the house while you were away. The back door has been forced.', 'danger', 5);
    w.quietUntilDay = G.s.time.day + 1;
  }
}

export function startSiege(s, immediate = false) {
  G.siegeActive = true;
  clearBanners('danger');
  allyStartSiege();
  G.siege = { plan: s.plan, t: 0, waveIdx: 0, spawned: 0, killed: 0, fled: 0, total: s.plan.waves.reduce((a, w) => a + w.types.length, 0), startHp: G.player.hp };
  G.s.world.siege = null;
  setMusic('tense');
  sfx('warning');
  const label = s.plan.kind === 'story' ? 'THEY FOUND YOU' : s.plan.kind === 'ambush' ? 'AMBUSH' : 'SIEGE';
  const first = s.plan.waves[0] && homeMap().spawns[s.plan.waves[0].dir];
  if (s.plan.kind === 'story' && first && !G.sleeping) playCutscene({ focus: first, zoom: 1.1, title: label, sub: `Headlights on ${first.label}.`, hold: 1.6 });
  else centerMessage(label, s.plan.kind === 'ambush' ? 'Get to cover!' : 'Defend your home', 2.6);
  if (G.sleeping) G.events.emit('wake', 'Shouts outside! You scramble out of bed.');
  G.events.emit('siegeStart', s.plan);
}

const BOSS_LINES = {
  'Big Carmine': ['The family\'s collector', '"Frankie! Come out and say hello to your family!"'],
  'Sal Benedetto': ['Leo\'s accountant', '"Nobody walks away from the books, Frankie. Nobody."'],
  'Vinnie Vescari': ['Leo\'s nephew', '"You took something of ours. I\'m here to collect."'],
  'Nico Vescari': ['Leo\'s son', '"My father sends his love. I came to deliver it."'],
};
function bossEntrance(e) {
  const [role, line] = BOSS_LINES[e.name] || ['', ''];
  playCutscene({ focus: { x: e.x, y: e.y }, zoom: 1.45, title: e.name.toUpperCase(), sub: role ? `${role} — ${line}` : '', hold: 2.2 });
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
      if (sg.plan.kind === 'story' && wave.boss === i) { opts.name = sg.plan.bossName || 'Big Carmine'; opts.hpMult = t === 'lieutenant' ? 1 : 1.35; opts.carriesNote = sg.plan.bossItem || 'note'; }
      else if (t === 'lieutenant') opts.name = 'Lieutenant';
      if (wave.named && wave.named[i]) opts.name = wave.named[i];
      const e = spawnEnemy(t, pos.x, pos.y, opts);
      if (opts.carriesNote && sg.plan.kind === 'story') bossEntrance(e);
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
  allyEndSiege();
  if (kind === 'endless') { G.siege = null; addXP(20 + sg.total * 4, null); endlessWaveCleared(sg); return; }
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
  if (G.endless) return;
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
  if (G.endless) {
    const res = endlessDefeat();
    allyEndSiege();
    sfx('defeat');
    setMusic('night');
    showEndlessResult(res);
    return;
  }
  const w = G.s.world;
  const story = G.siege && G.siege.plan.kind === 'story';
  const lost = Math.min(150, Math.floor(G.s.money * diff().loss));
  sfx('defeat');
  setMusic('night');
  const onCabin = atHome();
  const nb = chapter().neighbor;
  const nbName = NPCS[nb].name.split(' ')[0];
  const skName = NPCS[chapter().shopkeeper].name.split(' ')[0].replace(/"/g, '');
  const friend = relOf(nb) >= 1;
  const rescuer = onCabin ? nbName : skName;
  const RESCUE = {
    ruth: [
      'Ruth heard the shots and came with her late husband\'s shotgun. The attackers scattered. She dragged you to her farmhouse and patched you up through the night.',
      'Ruth heard the shots and called the county sheriff. By the time the sirens came, the attackers were gone. She found you on the porch and took you in.',
    ],
    ingrid: [
      'Ingrid came over the pasture on her tractor with the high beams on and a deer rifle across her knees. They ran. She hauled you into her kitchen and stitched you up herself.',
      'Ingrid called the county — not Mott, the state patrol. Lights on the road scattered them. She found you by the gate and took you in.',
    ],
    marcus: [
      'Marcus came across the street with a revolver you\'ve never seen and a calm you didn\'t expect. Two shots in the air and they ran. He carried you to his couch.',
      'Marcus called it in on his radio. Sirens scattered them. He found you in the yard and took you in for the night.',
    ],
  };
  showDefeat({
    lost,
    rescuer,
    text: onCabin
      ? (RESCUE[nb] || RESCUE.ruth)[friend ? 0 : 1]
      : `${skName} found you slumped behind the store and hauled you inside. "Whoever they were, they took off when I hit the lights."`,
    story,
    onContinue: () => recoverFromDefeat({ lost, story, onCabin }),
  });
  w.defeats++;
}

function recoverFromDefeat({ lost, story, onCabin }) {
  const w = G.s.world;
  const plan = G.siege ? G.siege.plan : null;
  G.siegeActive = false;
  allyEndSiege();
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
