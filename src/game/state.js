// Central game state. `G.s` is the persistent save data; everything else is runtime.
import { DEFAULT_SETTINGS, SAVE_VERSION } from '../config.js';
import { deepClone } from '../util.js';

export const G = {
  s: null, // persistent save
  settings: deepClone(DEFAULT_SETTINGS),
  maps: {},
  map: null,
  player: null,
  enemies: [],
  bullets: [],
  particles: [],
  floaters: [],
  pickups: [],
  fires: [],
  lobs: [],
  casings: [],
  smoke: [],
  npcs: [],
  camera: { x: 0, y: 0, zoom: 1, shake: 0, shakeX: 0, shakeY: 0 },
  view: { w: 800, h: 450, dpr: 1 },
  running: false,
  paused: false, // explicit pause (menu / tab hidden)
  modal: null, // name of the open modal ('menu', 'dialogue', 'shop', ...)
  hitFlash: 0,
  hurtDir: null,
  time: 0, // real seconds since start of session
  siegeActive: false,
  transition: null,
  sleeping: null,
  repairHold: null,
  debug: false,
};

const door = () => ({ kind: 'door', hp: 100, reinforced: false, open: false });
const win = () => ({ kind: 'window', glass: 20, boards: false, boardHp: 0, shutters: false, shutterHp: 0 });

/** Fresh defense records for a home. Keys must match the door/window ids in its map. */
export function newHome(id) {
  const gate = () => ({ kind: 'door', hp: 70, baseHp: 220, reinforced: false, open: false, gate: true });
  const iron = () => ({ kind: 'door', hp: 90, baseHp: 280, reinforced: false, open: false, gate: true });
  const openings = id === 'estate'
    ? { gate_l: iron(), gate_r: iron(), garden_gate: { kind: 'door', hp: 160, baseHp: 160, reinforced: false, open: false, gate: true },
      front_l: door(), front_r: door(), terrace_door: door(), west_door: door(), east_door: door(),
      win_n1: win(), win_n2: win(), win_n3: win(), win_n4: win(), win_s1: win(), win_s2: win(), win_w: win(), win_e: win() }
    : id === 'farm'
    ? { gate_l: gate(), gate_r: gate(), front_door: door(), back_door: door(), win_n1: win(), win_n2: win(), win_w: win(), win_e: win(), win_s: win() }
    : id === 'house'
      ? { front_door: door(), back_door: door(), win_f1: win(), win_f2: win(), win_w: win(), win_e: win(), win_b: win() }
      : { front_door: door(), back_door: door(), win_fl: win(), win_fr: win(), win_w: win(), win_e: win() };
  return {
    id,
    openings,
    upgrades: { floodlight: false, alarm: false, camera: false },
    covers: [],
    traps: [],
    phoneLine: true,
    porchLight: true,
  };
}

export function newSave() {
  return {
    version: SAVE_VERSION,
    savedAt: 0,
    chapter: 1,
    player: { map: 'cabin', x: 24.5 * 32, y: 33.5 * 32, hp: 100, stamina: 100, mag: 8, facing: -Math.PI / 2, weapon: 'pistol', mags: { pistol: 8, shotgun: 0, rifle: 0 } },
    stats: { level: 1, xp: 0, attrPoints: 0, attrs: { vit: 1, end: 1, pre: 1, awa: 1, res: 1 } },
    jp: { survivor: 0, gunhand: 0, handyman: 0, neighbor: 0, shadow: 0 },
    jpEarned: { survivor: 0, gunhand: 0, handyman: 0, neighbor: 0, shadow: 0 },
    skills: [],
    money: 100,
    inv: { ammo: 32, bandage: 2, sandwich: 2, toolkit: 1, wood: 2 },
    quick: 'bandage',
    weaponMods: { extMag: false },
    home: newHome('cabin'),
    pastHomes: {},
    story: { step: 'arrive', flags: {}, chapterComplete: false, done: {} },
    rel: { ruth: 0, dee: 0, gus: 0, marcus: 0, rosa: 0, pete: 0, ingrid: 0, bo: 0, tess: 0, eleanor: 0, theo: 0, walt: 0 },
    quests: {},
    errands: {},
    unlocks: {},
    companion: { ruth: { joined: false, declined: false } },
    choices: {},
    difficulty: 'normal',
    time: { day: 1, minute: 9 * 60 },
    world: {
      threat: 10,
      siege: null,
      lastSiegeDay: -10,
      quietUntilDay: 0,
      signs: {},
      chopped: { cabin: {}, town: {}, millbrook: {}, farm: {}, estate: {} },
      picked: {},
      heatLog: [],
      discovered: [],
      lastDayProcessed: 1,
      sieges: 0,
      defeats: 0,
    },
    daily: { day: 1, c: {} },
    job: null,
    jobsDone: 0,
    log: [],
  };
}

export const hasSkill = (id) => !!(G.s && G.s.skills.includes(id));

export function isNight() {
  const m = G.s.time.minute;
  return m >= 20 * 60 || m < 6 * 60;
}
