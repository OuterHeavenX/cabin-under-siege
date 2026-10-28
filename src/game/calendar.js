// The week: Day 1 is a Monday. Towns keep a weekly rhythm — market Friday,
// poker Wednesday and Saturday night, supper after Sunday service, and a fair
// on the first Saturday after you've settled in.
import { G } from './state.js';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const weekdayIndex = (day = G.s.time.day) => (day - 1) % 7;
export const weekday = (day = G.s.time.day) => WEEKDAYS[weekdayIndex(day)];
export const shortWeekday = (day = G.s.time.day) => weekday(day).slice(0, 3);
export const hourNow = () => G.s.time.minute / 60;

/** Is the clock inside [from, to) hours? Windows may wrap past midnight (e.g. [22, 2]). */
export function inHours([from, to]) {
  const h = hourNow();
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

export const fmtHour = (h) => { const hh = ((Math.floor(h) + 11) % 12) + 1; return `${hh}${h % 1 ? ':30' : ''} ${h % 24 < 12 ? 'AM' : 'PM'}`; };
export const fmtWindow = ([a, b]) => `${fmtHour(a)}–${fmtHour(b % 24)}`;

/** The next day (today or later) that falls on a weekday. */
export function nextWeekday(name, from = G.s.time.day) {
  const want = WEEKDAYS.indexOf(name);
  for (let d = from; d < from + 7; d++) if (weekdayIndex(d) === want) return d;
  return from;
}

/** Town events by weekday. `where` is a point name on the chapter's work map. */
export const WEEKLY = [
  { id: 'poker', days: ['Wednesday', 'Saturday'], hours: [19, 23], name: 'Poker night', icon: '🃏', desc: 'Five-card draw in the back of the diner. $10 ante. Loose talk at the table.' },
  { id: 'market', days: ['Friday'], hours: [8, 17], name: 'Market day', icon: '🧺', desc: 'Stalls on Main Street, fresh stock, and 20% off at the store.' },
  { id: 'supper', days: ['Sunday'], hours: [17, 20], name: 'Sunday supper', icon: '🍲', desc: 'Supper after service at the chapel. Everybody comes. Everybody talks.' },
  { id: 'fair', days: ['Saturday'], hours: [10, 17], name: 'County fair', icon: '🎡', desc: 'Shooting gallery, pie stand and the whole county in one field.', firstOnly: true },
];

/** Events happening right now (or today, with `anyTime`). */
export function eventsToday(anyTime = false) {
  const wd = weekday();
  return WEEKLY.filter((e) => e.days.includes(wd) && (anyTime || inHours(e.hours)) && (!e.firstOnly || fairOpenToday()));
}
export const eventOn = (id) => eventsToday().some((e) => e.id === id);

/** The fair comes once per chapter: the first Saturday on or after day 4 of the chapter. */
export function fairDay() {
  const s = G.s;
  const start = (s.story.flags.chapterStartDay || 1);
  return nextWeekday('Saturday', Math.max(start + 3, 4));
}
export const fairOpenToday = () => G.s.time.day === fairDay();
