// Weather: clear, rain or fog, rolled for each day (6 AM) and night (6 PM).
// Rain hides sound and sight a little; fog cuts visibility for everyone,
// which blunts snipers and lets you slip closer.
import { G } from './state.js';
import { seasonId } from './season-core.js';

export const WEATHER = {
  clear: { name: 'Clear', see: 1, notice: 1, range: 1 },
  rain: { name: 'Rain', see: 0.9, notice: 0.8, range: 0.9 },
  fog: { name: 'Fog', see: 0.72, notice: 0.75, range: 0.6 },
  snow: { name: 'Snow', see: 0.85, notice: 0.85, range: 0.85 },
};

function periodKey() {
  const t = G.s.time;
  const night = t.minute >= 18 * 60 || t.minute < 6 * 60;
  const day = t.minute < 6 * 60 ? t.day - 1 : t.day;
  return day * 2 + (night ? 1 : 0);
}

/** Current weather record (rolled lazily when the period changes). */
export function weather() {
  if (!G.s) return { kind: 'clear' };
  const w = G.s.world;
  const key = periodKey();
  if (!w.weather || w.weather.key !== key) {
    const night = key % 2 === 1;
    const siegeTonight = !!(w.siege && night);
    const r = Math.random();
    let kind = 'clear';
    if (G.prequel) kind = 'rain';
    else if (G.endless && G.endless.mod === 'fog') kind = 'fog';
    else if (G.endless) kind = r < 0.35 ? 'rain' : r < 0.5 ? 'fog' : 'clear';
    else if (siegeTonight) kind = r < 0.45 ? 'rain' : r < 0.6 ? 'fog' : 'clear';
    else kind = r < (night ? 0.2 : 0.15) ? 'rain' : r < (night ? 0.33 : 0.24) ? 'fog' : 'clear';
    // The season shapes it: snow instead of rain in winter, a wet spring, a dry summer.
    const sid = G.prequel ? 'autumn' : seasonId(), r2 = Math.random();
    if (sid === 'winter') { if (kind === 'rain' || (kind === 'clear' && r2 < 0.2)) kind = 'snow'; }
    else if (sid === 'spring') { if (kind === 'clear' && r2 < 0.15) kind = 'rain'; }
    else if (sid === 'summer') { if ((kind === 'rain' && r2 < 0.4) || (kind === 'fog' && r2 < 0.6)) kind = 'clear'; }
    if (G.s.time.day <= 1 && !G.endless && !G.prequel) kind = 'clear'; // the first day is always fair
    if (kind === 'rain') w.lastRainDay = G.s.time.day;
    w.weather = { kind, key };
  }
  return w.weather;
}

export function weatherMods() { return WEATHER[weather().kind] || WEATHER.clear; }

/** For tests and the story: force a weather for the current period. */
export function setWeather(kind) { if (G.s) { G.s.world.weather = { kind, key: periodKey() }; if (kind === 'rain') G.s.world.lastRainDay = G.s.time.day; } }
