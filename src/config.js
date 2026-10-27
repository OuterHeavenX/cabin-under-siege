// Global tuning constants.

export const GAME_VERSION = '0.8.0';
export const TILE = 32;
export const SAVE_VERSION = 2;
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
  cloudServer: '', // desktop app: override CLOUD_SERVER
};
