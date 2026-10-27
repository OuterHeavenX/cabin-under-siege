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

export function newSave() {
  return {
    version: SAVE_VERSION,
    savedAt: 0,
    chapter: 'cabin',
    player: { map: 'cabin', x: 24.5 * 32, y: 33.5 * 32, hp: 100, stamina: 100, mag: 8, facing: -Math.PI / 2 },
    stats: { level: 1, xp: 0, attrPoints: 0, attrs: { vit: 1, end: 1, pre: 1, awa: 1, res: 1 } },
    jp: { survivor: 0, gunhand: 0, handyman: 0, neighbor: 0, shadow: 0 },
    jpEarned: { survivor: 0, gunhand: 0, handyman: 0, neighbor: 0, shadow: 0 },
    skills: [],
    money: 100,
    inv: { ammo: 32, bandage: 2, sandwich: 2, toolkit: 1, wood: 2 },
    quick: 'bandage',
    home: {
      openings: {
        front_door: { kind: 'door', hp: 100, reinforced: false, open: false },
        back_door: { kind: 'door', hp: 100, reinforced: false, open: false },
        win_fl: { kind: 'window', glass: 20, boards: false, boardHp: 0 },
        win_fr: { kind: 'window', glass: 20, boards: false, boardHp: 0 },
        win_w: { kind: 'window', glass: 20, boards: false, boardHp: 0 },
        win_e: { kind: 'window', glass: 20, boards: false, boardHp: 0 },
      },
      upgrades: { floodlight: false, alarm: false, extMag: false },
      covers: [],
      phoneLine: true,
      porchLight: true,
    },
    story: { step: 'arrive', flags: {}, chapterComplete: false },
    rel: { ruth: 0, dee: 0, gus: 0 },
    time: { day: 1, minute: 9 * 60 },
    world: {
      threat: 10,
      siege: null,
      lastSiegeDay: -10,
      quietUntilDay: 0,
      signs: {},
      chopped: { cabin: {}, town: {} },
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
