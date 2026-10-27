// Weather: clear, rain or fog, rolled for each day (6 AM) and night (6 PM).
// Rain hides sound and sight a little; fog cuts visibility for everyone,
// which blunts snipers and lets you slip closer.
import { G } from './state.js';

export const WEATHER = {
  clear: { name: 'Clear', see: 1, notice: 1, range: 1 },
  rain: { name: 'Rain', see: 0.9, notice: 0.8, range: 0.9 },
  fog: { name: 'Fog', see: 0.72, notice: 0.75, range: 0.6 },
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
    if (G.s.time.day <= 1 && !G.endless && !G.prequel) kind = 'clear'; // the first day is always fair
    w.weather = { kind, key };
  }
  return w.weather;
}

export function weatherMods() { return WEATHER[weather().kind] || WEATHER.clear; }

/** For tests and the story: force a weather for the current period. */
export function setWeather(kind) { if (G.s) G.s.world.weather = { kind, key: periodKey() }; }
