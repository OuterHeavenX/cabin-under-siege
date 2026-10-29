// Global tuning constants.

export const GAME_VERSION = '0.11.1';
export const TILE = 32;
export const SAVE_VERSION = 3;
export const SAVE_KEY = 'cabinUnderSiege.save';
export const SETTINGS_KEY = 'cabinUnderSiege.settings';
/** Where the desktop app finds cloud saves and the leaderboard (the deployed website). */
export const CLOUD_SERVER = 'https://cabin-under-siege.jimmyflete.workers.dev';

/** In-game minutes that pass per real second during normal play. */
export const GAME_MIN_PER_SEC = 2;
/** Slower clock while a siege is active so the fight isn't rushed by the sun. */
export const SIEGE_MIN_PER_SEC = 0.25;

export const DAWN = 6 * 60;
export const DUSK = 20 * 60;

export const PLAYER_RADIUS = 10;
export const PLAYER_SPEED = 125;
export const SPRINT_SPEED = 185;

export const DEFAULT_SETTINGS = {
  sfxVolume: 0.8,
  musicVolume: 0.45,
  aimAssist: true,
  screenShake: 'full', // 'full' | 'reduced' | 'off'
  touchControls: 'auto', // 'auto' | 'on' | 'off'
  fireWhileAiming: true,
  autoSprint: true,
  showDamageNumbers: true,
  quality: 'auto', // 'auto' | 'high' | 'low'
  rumble: true, // controller vibration
  fpsCap: 'auto', // 'auto' | '30' (battery saver)
  textSize: 'normal', // 'normal' | 'large'
  touchOpacity: 0.85, // on-screen controls, 0.3..1
  touchSize: 'normal', // 'small' | 'normal' | 'large'
  cloudServer: '', // desktop app: override CLOUD_SERVER
};

/** Being away from home (return visits). All the "no free hiding" numbers live here. */
export const AWAY = {
  safeDays: 3, // days in an old town before the family works out where Frank went
  debtDecay: 1, // days of "recently away" forgiven per day back home
  pursuitBase: 2, // attackers in the first crew that follows him
  pursuitPerDay: 1, // one more for every day he stays past that
  pursuitMax: 6,
  hostRelLoss: 5, // friendship (of 100) lost each day he keeps bringing danger to a host
  missedGrowth: 2, // extra attackers per night a story attack finds the house empty
  missedGrowthMax: 4,
  breakInCash: 0.25, // share of cash kept at the house taken in a break-in
  breakInCashCap: 120,
  breakInDoor: 40, // door damage per break-in (before Duke)
};
