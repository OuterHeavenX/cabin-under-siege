// Boot, main loop, map loading, travel, pause handling and the title screen.
import { G, newSave, isNight } from './game/state.js';
import { TILE } from './config.js';
import { clamp, dist, fmtClock, escapeHtml } from './util.js';
import { buildCabinMap, buildTownMap, buildMillbrookMap, buildFarmMap, buildEstateMap } from './world/mapgen.js';
import { chapter, homeMapId, workMapId, atHome, LAST_CHAPTER } from './game/chapters.js';
import { QUESTS, questWaypoint } from './game/quests.js';
import { newHome } from './game/state.js';
import { showChapterStart, openDifficultyPicker, openEndlessPicker } from './ui/menus.js';
import { buildGroundCanvas, buildRoofCanvas, render } from './world/render.js';
import { initInput, consume, endFrame, resetInput, setTouchMode, input, suppressGhostClick } from './input.js';
import { initAudio, setVolumes, updateAudio, setMusic, setAmbient, suspendAudio, resumeAudio, sfx, setListener, setFireLevel, audioDebug, renderOffline, musicBar, birdCall } from './audio.js';
import { initHud, updateHud, toast, banner } from './ui/hud.js';
import { initDialogue, updateDialogue, playDialogue } from './ui/dialogue.js';
import { initReliableTaps, openMenu, closeModal, topModal, setMenuHooks, openHelp, confirmBox, pickImport, modalOpen, closeAllModals } from './ui/menus.js';
import { createPlayer, updatePlayer, inCombat } from './game/player.js';
import { updateBullets, updateEffects } from './game/combat.js';
import { updateEnemies, initEnemyEvents } from './game/enemies.js';
import { updateSiege, updateThreatClock, initSiegeEvents, handleDefeat, maybeAmbushOnArrival, refreshSignProps, absNow, absOf } from './game/siege.js';
import { updateTime, initTimeEvents, advanceMinutes } from './game/time.js';
import { spawnNpcs, updateNpcs } from './game/npcs.js';
import { updateJobs, applyChopped, jobHint, JOB_TYPES } from './game/jobs.js';
import { initStoryEvents, updateStory, objectiveText, storyWaypoint, newGameIntro } from './game/story.js';
import { initHomeEvents, syncCovers, updateRepair } from './game/home.js';
import { findTarget, doInteract, setTravel } from './game/interact.js';
import { derived, addXP, addJP, relOf } from './game/progression.js';
import { quickItem, count, addItem } from './game/inventory.js';
import { ITEMS } from './data/items.js';
import { NPCS } from './data/npcs.js';
import { TRUST_LEVEL } from './game/ally.js';
import { WEAPONS, WEAPON_ORDER } from './data/weapons.js';
import { ownsWeapon, reloadTime } from './game/player.js';
import { saveGame, hasSave, readSaveRaw, migrate, validateSave, deleteSave, loadSettings, canSaveNow } from './game/save.js';
import { addPickup, damageEnemy } from './game/combat.js';
import { updateFire, startFire } from './game/fire.js';
import { spawnEnemy, openingStrength } from './game/enemies.js';
import { initActivityEvents } from './game/activities.js';
import { spawnDog, updateDog, dogMorning } from './game/dog.js';
import { setWeather } from './game/weather.js';
import { initAtmosphere, updateAtmosphere } from './world/atmosphere.js';
import { updateCutscene, skipCutscene, endCutscene, playCutscene } from './ui/cutscene.js';
import { lowQuality } from './game/difficulty.js';
import { startEndless, updateEndless, unlockEndlessFor } from './game/endless.js';
import { startSiege, makeRaidPlan, scheduleSiege, addSign, storyPlan } from './game/siege.js';
import { buySkill } from './game/progression.js';
import { damagePlayer } from './game/player.js';

/* ---------------- tiny event bus ---------------- */
class Emitter {
  constructor() { this.h = {}; }
  on(n, f) { (this.h[n] = this.h[n] || []).push(f); }
  emit(n, ...a) { (this.h[n] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(`[event ${n}]`, e); } }); }
}
G.events = new Emitter();

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
let last = performance.now();
let hudInfoT = 0;
let hudInfo = { maxHp: 100, maxStamina: 100, objective: '', reloadTime: 1.4, quickLabel: 'USE' };
let autosaveT = 0;

/* ---------------- sizing ---------------- */
function resize() {
  const vv = window.visualViewport;
  const w = Math.round(vv ? vv.width : window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  const dpr = lowQuality() ? 1 : Math.min(2, window.devicePixelRatio || 1);
  G.view = { w, h, dpr };
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  G.camera.baseZoom = clamp(Math.min(w / 900, h / 480), 0.82, 2.4);
  if (!G.cutscene) G.camera.zoom = G.camera.baseZoom;
  document.body.classList.toggle('portrait', h > w);
}

/* ---------------- maps ---------------- */
const MAP_BUILDERS = {
  cabin: () => buildCabinMap(G.s.home),
  town: () => buildTownMap(),
  millbrook: () => buildMillbrookMap(G.s.home),
  farm: () => buildFarmMap(G.s.home),
  estate: () => buildEstateMap(G.s.home),
};

function buildMaps() {
  G.maps = {};
  for (const id of chapter().maps) {
    const m = MAP_BUILDERS[id]();
    m.groundCanvas = buildGroundCanvas(m);
    for (const b of m.buildings) b.roofCanvas = buildRoofCanvas(b);
    G.maps[id] = m;
    // Keep favor spots reachable: no trees on them.
    for (const q of Object.values(QUESTS)) {
      if (q.map !== id) continue;
      for (const [x, y] of [...(q.spots || []), ...(q.target ? [q.target] : [])]) {
        const cx = Math.floor(x), cy = Math.floor(y);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const i = m.idx(cx + ox, cy + oy);
          if (m.trees.has(i)) { m.trees.delete(i); m.solid[i] = 0; }
        }
      }
    }
    applyChopped(m);
  }
  syncCovers();
}

export function loadMap(id, pos) {
  G.map = G.maps[id];
  G.enemies = [];
  G.bullets = [];
  G.pickups = G.pickups.filter((p) => (p.kind === 'note' || p.kind === 'burner' || p.kind === 'ledger' || p.kind === 'signet') && p.map === id);
  G.particles = [];
  G.floaters = [];
  G.fires = []; G.lobs = []; G.casings = []; G.smoke = []; G.boats = [];
  applyChopped(G.map);
  if (id === homeMapId()) refreshSignProps();
  const p = G.player;
  if (pos) { p.x = pos.x; p.y = pos.y; }
  G.map.pushOut(p, p.radius, 'player');
  G.camera.x = p.x; G.camera.y = p.y;
  spawnNpcs();
  spawnDog();
  G.events.emit('mapLoaded', id);
  updateMood(true);
}

function travel(target, mode) {
  if (G.transition) return;
  if (G.siegeActive || inCombat() || G.enemies.some((e) => !e.dead && !e.gone)) { toast('You can\'t leave while you\'re under attack!', 'danger'); return; }
  const mins = mode === 'car' ? 20 : 60;
  if (mode === 'car') sfx('car');
  const text = target === workMapId() ? `Driving to ${chapter().place}…` : 'Heading home…';
  G.transition = {
    t: 0, fade: 0, text, phase: 'out',
    mid: () => {
      advanceMinutes(mins);
      const m = G.maps[target];
      let pos;
      if (mode === 'car') pos = m.points.car;
      else pos = target === 'town' ? { x: 1.6 * TILE, y: 21 * TILE } : { x: 57.5 * TILE, y: 39.5 * TILE };
      loadMap(target, pos);
      if (mode === 'walk') addJP('survivor', 2, 'walk', 2);
      saveGame('travel');
    },
    done: () => { if (target === homeMapId()) maybeAmbushOnArrival(); },
  };
}
setTravel(travel);

function updateTransition(dt) {
  const tr = G.transition;
  tr.t += dt;
  if (tr.phase === 'hold') return; // e.g. defeat screen: wait for the player
  if (tr.phase === 'out') {
    tr.fade = Math.min(1, tr.t / 0.5);
    if (tr.t >= 0.9) { tr.phase = 'in'; tr.t = 0; tr.mid && tr.mid(); }
  } else if (tr.phase === 'in') {
    tr.fade = Math.max(0, 1 - tr.t / 0.5);
    if (tr.t >= 0.5) { const done = tr.done; G.transition = null; done && done(); }
  }
}

/* ---------------- mood (music & ambience) ---------------- */
let moodT = 0;
function updateMood(force) {
  moodT -= 1 / 60;
  if (!force && moodT > 0) return;
  moodT = 1;
  if (G.siegeActive || G.enemies.some((e) => !e.dead && e.alerted)) setMusic('tense');
  else setMusic(isNight() ? 'night' : 'day');
  if (isNight()) setAmbient('night');
  else setAmbient(G.map && G.map.id === workMapId() ? 'town' : 'day');
}

/* ---------------- game update ---------------- */
function update(dt) {
  if (G.endless) updateEndless(dt);
  else updateTime(dt);
  updateThreatClock();
  if (G.sleeping) { G.clockText = `Day ${G.s.time.day} · ${fmtClock(G.s.time.minute)}`; return; }
  updatePlayer(dt);

  G.interactTarget = findTarget();
  if (consume('interact') && !G.repairHold) doInteract(G.interactTarget);
  updateRepair(dt);

  updateEnemies(dt);
  updateSiege(dt);
  updateBullets(dt);
  updateFire(dt);
  updateEffects(dt);
  updateNpcs(dt);
  updateDog(dt);
  updateJobs(dt);
  if (!G.endless) { updateStory(dt); checkDiscovery(); }

  G.hitFlash = Math.max(0, G.hitFlash - dt);
  if (G.hurtDir) G.hurtDir.t -= dt;
  // trees / doors hit timers
  for (const b of G.map.blockers.values()) if (b.hitT > 0) b.hitT -= dt;

  autosaveT += dt;
  if (autosaveT > 90 && !canSaveNow()) { autosaveT = 0; saveGame('periodic'); }
}

function checkDiscovery() {
  const p = G.player;
  const disc = G.s.world.discovered;
  for (const d of G.map.discover || []) {
    if (disc.includes(d.id)) continue;
    if (dist(p.x, p.y, d.x, d.y) < d.r) {
      disc.push(d.id);
      toast(`Discovered: ${d.name}`, 'level', 3);
      addXP(10, null);
      addJP('survivor', 5);
    }
  }
}

function updateCamera(dt) {
  const p = G.player;
  const c = G.camera;
  const lead = 30;
  const cs = G.cutscene;
  let tx = p.x + Math.cos(p.angle) * lead * (input.aim.active || input.mouse.inside ? 1 : 0.3);
  let ty = p.y + Math.sin(p.angle) * lead * (input.aim.active || input.mouse.inside ? 1 : 0.3);
  if (cs) { tx = cs.x; ty = cs.y; }
  // Cutscenes drift slowly and push in; afterwards the zoom eases back.
  const base = c.baseZoom || c.zoom;
  const wantZoom = cs ? base * cs.zoom : base;
  c.zoom += (wantZoom - c.zoom) * (1 - Math.pow(0.05, dt));
  const k = 1 - Math.pow(cs ? 0.12 : 0.0015, dt);
  c.x += (tx - c.x) * k;
  c.y += (ty - c.y) * k;
  // clamp to map
  const m = G.map;
  const hw = G.view.w / 2 / c.zoom, hh = G.view.h / 2 / c.zoom;
  const mw = m.w * TILE, mh = m.h * TILE;
  c.x = mw > hw * 2 ? clamp(c.x, hw, mw - hw) : mw / 2;
  c.y = mh > hh * 2 ? clamp(c.y, hh - 60 / c.zoom, mh - hh) : mh / 2;
  if (c.shake > 0) {
    c.shakeX = (Math.random() - 0.5) * c.shake * 2;
    c.shakeY = (Math.random() - 0.5) * c.shake * 2;
    c.shake = Math.max(0, c.shake - dt * 30);
  } else { c.shakeX = 0; c.shakeY = 0; }
}

function computeHudInfo(dt) {
  hudInfoT -= dt;
  if (hudInfoT > 0) return;
  hudInfoT = 0.2;
  const d = derived();
  const s = G.s;
  let jobLine = '';
  if (s.job) {
    jobLine = `${JOB_TYPES[s.job.type].icon} ${jobHint()}`;
    if (s.job.type === 'delivery' && s.job.stage === 'deliver') jobLine += s.job.timeLeft > 0 ? ` ⏱ ${Math.ceil(s.job.timeLeft)}s` : ' (late)';
  }
  let danger = null;
  const alive = G.enemies.filter((e) => !e.dead && !e.gone).length;
  if (G.siegeActive) {
    const pending = G.siege ? G.siege.plan.waves.slice(G.siege.waveIdx).reduce((a, w) => a + w.types.length, 0) : 0;
    danger = `UNDER ATTACK — ${alive} attacker${alive === 1 ? '' : 's'}${pending ? ` (+${pending} coming)` : ''}`;
  } else if (alive) danger = `${alive} attacker${alive === 1 ? '' : 's'} nearby`;
  else if (s.world.siege && s.world.siege.warned) danger = `Attack expected ~${fmtClock(s.world.siege.minute)}. Get ready!`;
  const q = quickItem();
  // Waypoint
  let wp = storyWaypoint() || questWaypoint();
  if (wp && wp.map !== G.map.id) {
    const car = G.map.props.find((p) => p.kind === 'car');
    wp = car ? { x: car.x, y: car.y, label: wp.map === homeMapId() ? 'Car → Home' : 'Car → Town' } : null;
  }
  G.waypoint = wp && !G.siegeActive ? wp : null;
  hudInfo = {
    maxHp: d.maxHp, maxStamina: d.maxStamina, reloadTime: reloadTime(G.player.weapon), weapon: WEAPONS[G.player.weapon], weaponCount: WEAPON_ORDER.filter(ownsWeapon).length, objective: objectiveText(), jobLine, danger,
    quickLabel: q ? `${ITEMS[q].icon}×${count(q)}` : 'USE', night: isNight(), combat: inCombat(), target: null,
  };
}

/* ---------------- frame ---------------- */
// Automatic quality: if the game runs well under 45 fps for a while, drop to low detail.
const perf = { t: 0, frames: 0, slow: 0 };
function watchPerf(raw) {
  if (!G.running || G.paused || G.modal || G.autoLow || (G.settings.quality && G.settings.quality !== 'auto') || document.hidden) return;
  perf.t += raw; perf.frames++;
  if (perf.t < 2) return;
  const fps = perf.frames / perf.t;
  perf.t = 0; perf.frames = 0;
  perf.slow = fps < 45 ? perf.slow + 1 : 0;
  if (perf.slow >= 3) {
    G.autoLow = true;
    resize();
    toast('Switched to low graphics for smoother play (Settings → Graphics).', 'info', 4);
  }
}

function frame(ts) {
  const raw = Math.max(0, (ts - last) / 1000);
  const dt = Math.min(0.05, raw);
  last = ts;
  G.frameDt = G.paused || (G.modal && G.modal !== 'dialogue') ? 0 : dt;
  if (raw < 0.5) watchPerf(raw);
  G.time += dt;
  try {
    if (G.running) {
      handleGlobalKeys();
      if (G.cutscene) updateCutscene(dt);
      if (G.transition) updateTransition(dt);
      else if (!G.paused && !G.modal) update(dt);
      if (G.modal === 'dialogue') updateDialogue(dt);
      if (G.player) {
        updateAtmosphere(dt);
        updateCamera(dt);
        computeHudInfo(dt);
        hudInfo.target = G.modal ? null : G.interactTarget;
        updateHud(dt, hudInfo);
        updateMood(false);
        const p = G.player;
        setListener(p.x, p.y, !!G.map.buildingAt(p.x, p.y));
        let fl = 0, fp = 0;
        for (const f of G.fires) { const d = dist(f.x, f.y, p.x, p.y); const l = Math.max(0, 1 - d / 420) * Math.min(1, f.life / 1.5); if (l > fl) { fl = l; fp = Math.max(-1, Math.min(1, (f.x - p.x) / 300)); } }
        setFireLevel(G.paused || G.modal ? 0 : fl, fp);
      }
      render(ctx);
    }
    updateAudio(G.paused || (G.modal && G.modal !== 'dialogue') ? 0 : dt);
  } catch (e) {
    console.error(e);
  }
  endFrame();
  requestAnimationFrame(frame);
}

function handleGlobalKeys() {
  if (G.cutscene && G.cutscene.phase !== 'talk') {
    if (consume('pause') || consume('interact') || consume('advance')) skipCutscene();
    return;
  }
  const top = topModal();
  if (top && (top.name === 'repair' || top.name === 'fishing') && G.repairGameHit) {
    if (consume('interact') || consume('dodge') || consume('advance')) G.repairGameHit();
  }
  if (consume('pause')) {
    if (top) { if (top.el.querySelector('[data-close]')) closeModal(); }
    else if (!G.transition) openMenu();
    return;
  }
  const map = { inv: 'inv', char: 'char', skills: 'skills', map: 'map', journal: 'journal', home: 'home' };
  if (top && top.name === 'menu') { for (const k of Object.keys(map)) if (consume(k)) { openMenu(map[k]); return; } }
  if (top || G.transition) return;
  for (const k of Object.keys(map)) if (consume(k)) { openMenu(map[k]); return; }
  if (consume('help')) openHelp();
}

/* ---------------- pause / interruptions ---------------- */
function pauseForInterruption() {
  if (!G.running) return;
  resetInput();
  suspendAudio();
  if (!modalOpen() && !G.transition && !G.player?.dead) openMenu();
  // Save if it's safe, in case the OS discards the tab while hidden.
  if (!canSaveNow()) saveGame('background');
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseForInterruption();
  else resumeAudio();
});
window.addEventListener('pagehide', pauseForInterruption);
window.addEventListener('blur', () => { if (G.running && input.touchMode) pauseForInterruption(); else resetInput(); });
window.addEventListener('focus', () => resumeAudio());

/* ---------------- events ---------------- */
function initEvents() {
  initEnemyEvents();
  initSiegeEvents();
  initActivityEvents();
  initAtmosphere();
  G.events.on('qualityChanged', () => { G.autoLow = false; perf.slow = 0; resize(); });
  initTimeEvents();
  initHomeEvents();
  initStoryEvents();
  G.events.on('playerDown', () => handleDefeat());
  G.events.on('recovered', ({ onCabin, gifts, story }) => {
    G.transition = null;
    const m = onCabin ? G.maps[homeMapId()] : G.maps[workMapId()];
    loadMap(m.id, m.points.recovery);
    const who = NPCS[onCabin ? chapter().neighbor : chapter().shopkeeper].name;
    const lines = [{ who, text: onCabin ? 'Easy, easy. You\'ve got stitches in places you don\'t want to know about. You\'ll live.' : 'Morning, sunshine. You owe me a mop.' }];
    if (gifts.length) lines.push({ who, text: `I left you some things: ${gifts.join(' and ')}. Don't argue.` });
    if (story) lines.push({ who: 'Frank', text: 'They\'ll come back tonight. This time I\'ll be ready.' });
    playDialogue(lines);
    saveGame('recover', { force: true });
  });
  G.events.on('requestMove', () => {
    const next = G.s.chapter + 1;
    if (next > LAST_CHAPTER) return;
    if (G.siegeActive || G.enemies.some((e) => !e.dead && !e.gone)) { toast('Not with attackers around!', 'danger'); return; }
    confirmBox('Leave for good and start the next chapter? You can\'t come back here. Your level, skills, money, weapons and gear come with you.', 'Leave', () => ruthFarewell(next), 'Not yet');
  });
  G.events.on('newDay', (day) => {
    dogMorning();
    applyChopped(G.map);
    if (atHome()) refreshSignProps();
    if (!G.sleeping) banner(`Day ${day} begins.`, 'info', 3);
  });
  G.events.on('mapLoaded', (id) => {
    // Never lose the story note when leaving the cabin.
    if (id === 'cabin' && G.s.story.step === 'search_body' && count('note') === 0 && !G.pickups.some((p) => p.kind === 'note')) {
      const p = G.maps.cabin.points.porch;
      addPickup('note', p.x + 30, p.y + 20, 1, { map: 'cabin' });
    }
  });
}

/** Before leaving Pine Hollow, Ruth decides whether to come — if she trusts you. */
function ruthFarewell(next) {
  const c = G.s.companion || (G.s.companion = { ruth: { joined: false, declined: false } });
  if (G.s.chapter !== 1) {
    if (c.ruth.joined) playDialogue([{ who: 'Ruth Calloway', text: 'Camper\'s hitched, shotgun\'s cleaned, thermos is full. Lead the way.' }], () => moveToChapter(next));
    else moveToChapter(next);
    return;
  }
  if (relOf('ruth') >= TRUST_LEVEL) {
    playDialogue([
      { who: 'Ruth Calloway', text: 'So that\'s it. You\'re running again.' },
      { who: 'Ruth Calloway', text: 'Frank, I\'m seventy-one. My husband\'s in the churchyard, my garden can grow without me, and I haven\'t felt this useful in ten years.' },
      { who: 'Ruth Calloway', text: 'I\'ve got Harold\'s old camper and Harold\'s old shotgun. I\'m not asking.',
        choices: [
          { text: '"Pack the camper. I\'d be glad to have you."', effect: () => { c.ruth.joined = true; return [{ who: 'Ruth Calloway', text: 'Good. I already did.' }, { who: 'You', text: '(Ruth will follow you to every new home, fight beside you and patch you up once per attack.)' }]; } },
          { text: '"Stay, Ruth. It\'s too dangerous."', effect: () => { c.ruth.declined = true; addItem('medkit', 2, true); addItem('shells', 8, true); return [{ who: 'Ruth Calloway', text: '...Stubborn man. Then take these, and you write me. Under a fake name.' }, { who: 'You', text: '(Ruth stays in Pine Hollow. She gave you 2 first-aid kits and shotgun shells.)' }]; } },
        ] },
    ], () => moveToChapter(next));
  } else {
    playDialogue([
      { who: 'Ruth Calloway', text: 'Leaving already? Well. Keep your head down, Frank. And eat a vegetable once in a while.' },
      { who: 'You', text: '(Had Ruth trusted you more — ♥3 — she might have come along.)' },
    ], () => { addItem('bandage', 2, true); moveToChapter(next); });
  }
}

/** Pack up and move to the next chapter's home. */
function moveToChapter(n) {
  const s = G.s;
  const old = s.home;
  // Pack portable upgrades and placed gear back into the inventory.
  const pack = { floodlight: 'floodlight_kit', alarm: 'alarm_kit', camera: 'camera_kit' };
  for (const [k, item] of Object.entries(pack)) if (old.upgrades[k]) addItem(item, 1, true);
  for (const c of old.covers) addItem(c.type, 1, true);
  for (let i = 0; i < (old.traps || []).length; i++) addItem('bear_trap', 1, true);
  s.pastHomes[old.id || 'cabin'] = { leftOnDay: s.time.day };
  s.chapter = n;
  unlockEndlessFor(n);
  s.home = newHome(n === 4 ? 'estate' : n === 3 ? 'farm' : n === 2 ? 'house' : 'cabin');
  s.job = null;
  s.story.step = chapter().firstStep;
  s.story.flags = {};
  s.world.siege = null;
  s.world.signs = {};
  s.world.threat = 15;
  s.world.board = null;
  s.world.quietUntilDay = s.time.day + 4;
  s.world.chopped[chapter().homeMap] = s.world.chopped[chapter().homeMap] || {};
  // Two days on the road.
  s.time.day += 2;
  s.time.minute = 10 * 60;
  s.world.lastDayProcessed = s.time.day;
  s.player.map = chapter().homeMap;
  closeAllModals();
  buildMaps();
  const m = G.maps[chapter().homeMap];
  G.player.hp = derived().maxHp;
  loadMap(m.id, m.points.start);
  saveGame('move', { force: true });
  showChapterStart(n, () => {
    const hi = m.homeInfo && m.homeInfo.interior;
    const place = { 2: ['MILLBROOK, OHIO', 'A quiet street. A house with a past.'], 3: ['KETTLE CROSSING', 'Two hundred acres, one broken gate.'], 4: ['WHITCOMBE ESTATE', 'Old money. High walls. Open water.'] }[n] || ['', ''];
    if (hi) playCutscene({ focus: { x: hi.cx * TILE + 16, y: hi.cy * TILE + 16 }, zoom: 0.8, title: place[0], sub: place[1], hold: 2, sting: null, onEnd: () => banner(`New objective: ${objectiveText()}`, 'objective', 5) });
    else banner(`New objective: ${objectiveText()}`, 'objective', 5);
  });
}

/* ---------------- start / title ---------------- */
function startGame(isNew) {
  closeAllModals();
  G.enemies = []; G.bullets = []; G.pickups = []; G.particles = []; G.floaters = []; G.fires = []; G.lobs = [];
  G.siegeActive = false; G.siege = null; G.sleeping = null; G.transition = null; G.repairHold = null;
  buildMaps();
  G.player = createPlayer();
  const d = derived();
  G.player.hp = Math.min(G.player.hp, d.maxHp);
  loadMap(G.s.player.map, G.endless ? G.maps[G.s.player.map].points.start : { x: G.s.player.x, y: G.s.player.y });
  document.getElementById('title').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  G.running = true;
  G.paused = false;
  setTouchMode(G.settings.touchControls === 'on' || (G.settings.touchControls === 'auto' && (input.touchMode || matchMedia('(pointer: coarse)').matches)));
  if (isNew) {
    saveGame('new', { force: true });
    newGameIntro();
  } else if (!G.endless) {
    banner(`Welcome back. Day ${G.s.time.day}, ${fmtClock(G.s.time.minute)}.`, 'info', 3);
  }
  // If a siege time already passed while saved, give a moment before it triggers.
  const s = G.s.world.siege;
  if (s && absOf(s) <= absNow()) { s.minute = (G.s.time.minute + 3) % 1440; s.day = G.s.time.day + (G.s.time.minute + 3 >= 1440 ? 1 : 0); }
}

function newGame(difficulty) {
  if (!difficulty) { openDifficultyPicker((d) => newGame(d)); return; }
  G.endless = null;
  G.s = newSave();
  G.s.difficulty = difficulty;
  startGame(true);
}

function continueGame() {
  const raw = readSaveRaw();
  const err = validateSave(raw);
  if (err) { toast(`Save could not be loaded: ${err}`, 'warn', 4); return; }
  G.endless = null;
  G.s = migrate(raw);
  unlockEndlessFor(G.s.chapter);
  startGame(false);
}

function quitToTitle() {
  if (G.cutscene) { G.cutscene.onEnd = null; endCutscene(); }
  G.running = false;
  G.endless = null;
  G.siegeActive = false; G.siege = null; G.enemies = [];
  G.player = null;
  closeAllModals();
  setTouchMode(input.touchMode);
  document.getElementById('touch').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  showTitle();
}

function showTitle() {
  const t = document.getElementById('title');
  t.classList.remove('hidden');
  const raw = hasSave() ? readSaveRaw() : null;
  const ok = raw && !validateSave(raw);
  const cont = document.getElementById('t-continue');
  cont.classList.toggle('hidden', !ok);
  if (ok) cont.innerHTML = `Continue <span class="sub">Day ${raw.time.day} · Level ${raw.stats.level} · Chapter ${raw.chapter || 1}</span>`;
}

function initTitle() {
  const go = (fn) => () => { initAudio(); setVolumes(G.settings.sfxVolume, G.settings.musicVolume); fn(); };
  document.getElementById('t-continue').addEventListener('click', go(continueGame));
  document.getElementById('t-new').addEventListener('click', go(() => {
    if (hasSave()) {
      const raw = readSaveRaw();
      const desc = raw && raw.time ? ` (Day ${raw.time.day}, Level ${raw.stats?.level ?? '?'})` : '';
      confirmBox(`Starting a new game will overwrite your existing save${desc}. This can't be undone. (Tip: export your save from Settings first.)`, 'Start over', () => { deleteSave(); newGame(); }, 'Keep my save');
    } else newGame();
  }));
  document.getElementById('t-endless').addEventListener('click', go(() => openEndlessPicker((site) => startEndless(site, startGame))));
  document.getElementById('t-import').addEventListener('click', go(() => pickImport(() => showTitle())));
  document.getElementById('t-help').addEventListener('click', go(() => openHelp()));
  // Open on pointerdown: an iOS "click" can be dropped if the finger drifts or another finger is down.
  document.getElementById('menu-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); suppressGhostClick(); if (!modalOpen()) { sfx('ui'); openMenu(); } });
  document.getElementById('objective').addEventListener('click', () => { if (!modalOpen()) openMenu('journal'); });
  const rh = document.getElementById('rotate-hint');
  rh.addEventListener('click', () => rh.classList.add('dismissed'));
}

/* ---------------- boot ---------------- */
function boot() {
  loadSettings();
  setVolumes(G.settings.sfxVolume, G.settings.musicVolume);
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  initInput(canvas);
  initHud();
  initDialogue();
  initReliableTaps();
  initEvents();
  setMenuHooks({ quitToTitle, reloadFromSave: () => continueGame(), restartEndless: (site) => startEndless(site, startGame) });
  initTitle();
  showTitle();
  if (G.settings.touchControls === 'on' || (G.settings.touchControls === 'auto' && matchMedia('(pointer: coarse)').matches)) setTouchMode(true);
  document.getElementById('touch').classList.add('hidden');
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // Test/debug handle (harmless in production; used by the automated smoke test).
  window.__cus = {
    G, newGame, continueGame, travel, loadMap, saveGame, quitToTitle,
    dbg: { closeAll: () => closeAllModals(), birdCall, renderOffline, musicBar, sfx, audioDebug, input, openingStrength, homeMapId, openMenu, startFire, damageEnemy, spawnEnemy, startSiege, makeRaidPlan, scheduleSiege, addSign, addItem, addXP, addJP, buySkill, derived, damagePlayer, count, moveToChapter, storyPlan, skipCutscene, endCutscene, setWeather },
  };
}

boot();
