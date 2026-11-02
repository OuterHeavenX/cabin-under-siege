// The calendar's seasons, kept tiny so the clock and lights can use it
// without pulling in the rest of the game (see seasons.js for the rules).
import { G } from './state.js';

export const SEASON_DAYS = 12;
export const YEAR_DAYS = SEASON_DAYS * 4;
export const ORDER = ['autumn', 'winter', 'spring', 'summer'];

/** dawn/dusk: the hours night ends and begins (default 6 and 20). */
export const SEASONS = {
  autumn: { id: 'autumn', name: 'Autumn', icon: '🍂', dawn: 6, dusk: 20, weather: { rain: 0.18, fog: 0.16 },
    change: 'Autumn. Leaves turning, deer moving at dawn and dusk, and the garden gives a little extra.' },
  winter: { id: 'winter', name: 'Winter', icon: '❄', dawn: 7, dusk: 18.5, weather: { snow: 0.34, fog: 0.1 },
    change: 'Winter. Long nights and snow. Ponds and lakes freeze hard enough to walk on — for everyone — and snow shows every set of tracks, yours included.' },
  spring: { id: 'spring', name: 'Spring', icon: '🌱', dawn: 5.5, dusk: 20.5, weather: { rain: 0.32, fog: 0.12 },
    change: 'Spring. The thaw: rain, and after rain the ground turns to mud that slows everyone down.' },
  summer: { id: 'summer', name: 'Summer', icon: '☀', dawn: 5, dusk: 21.5, weather: { rain: 0.12, fog: 0.05 },
    change: 'Summer. Short nights — the dark comes late and leaves early. Dry grass: fires burn longer and hotter.' },
};

/** The automated test pins the season for the older checks (they were written before seasons). */
const pinned = () => (typeof window !== 'undefined' && window.__cusSeason) || null;

export function seasonIdOf(day) {
  return ORDER[Math.floor((((day - 1) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS / SEASON_DAYS)];
}
export function seasonId() {
  if (pinned()) return pinned();
  if (!G.s) return 'autumn';
  if (G.prequel) return 'autumn'; // Newark, October 1999
  if (G.endless) return G.endless.season || 'autumn';
  return seasonIdOf(G.s.time.day);
}
export const season = () => SEASONS[seasonId()];
export const dayOfSeason = (day = G.s.time.day) => ((((day - 1) % SEASON_DAYS) + SEASON_DAYS) % SEASON_DAYS) + 1;
export const yearOf = (day = G.s.time.day) => Math.floor((day - 1) / YEAR_DAYS) + 1;
/** First day of the next season. */
export const nextSeasonDay = (day = G.s.time.day) => day + (SEASON_DAYS - dayOfSeason(day)) + 1;

/** 0 = full day, 1 = deepest night, following the season's dawn and dusk. */
export function seasonDarkness(minute) {
  const s = season(), h = minute / 60;
  const d0 = s.dusk - 1.5, d1 = s.dusk + 1, a0 = s.dawn - 1, a1 = s.dawn + 1;
  if (h >= a1 && h < d0) return 0;
  if (h >= d0 && h < d1) return (h - d0) / (d1 - d0);
  if (h >= a0 && h < a1) return 1 - (h - a0) / (a1 - a0);
  return 1;
}
export function seasonNight(minute) {
  const s = season(), h = minute / 60;
  return h >= s.dusk || h < s.dawn;
}


/** Winter ice: ponds and lakes can be walked on (by everyone). */
export const frozenNow = () => seasonId() === 'winter' && !(G && G.prequel);
