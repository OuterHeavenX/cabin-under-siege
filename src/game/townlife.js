// Town life between the fights: market day, Sunday supper, the county fair's
// shooting gallery and pie stand. (Poker lives in poker.js, deer in hunting.js,
// home projects in projects.js.)
import { G } from './state.js';
import { NPCS } from '../data/npcs.js';
import { chapter } from './chapters.js';
import { addItem } from './inventory.js';
import { addMoney, addRel, addXP, addJP, derived } from './progression.js';
import { eventOn, fairDay, weekday, fmtWindow, WEEKLY, nextWeekday } from './calendar.js';
import { advanceMinutes } from './time.js';
import { playDialogue } from '../ui/dialogue.js';
import { banner, toast, centerMessage } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { grantPerk } from './perks.js';
import { saveGame } from './save.js';
import { choose, dist } from '../util.js';
import { LATER_SUPPER } from '../data/storylines.js';

const ev = (id) => WEEKLY.find((e) => e.id === id);
const when = (id) => `${ev(id).days.join(' & ')}, ${fmtWindow(ev(id).hours)}`;

/** Lines the story can add to supper talk (clues, storyline hints). */
export const supperHooks = [];

/* ---------------- reminders ---------------- */
let noteT = 0;
/** A heads-up when something's on: poker tonight, market this morning, supper soon. */
export function updateTownLife(dt) {
  noteT -= dt;
  if (noteT > 0 || G.endless || G.prequel || !G.s) return;
  noteT = 3;
  const w = G.s.world, t = G.s.time;
  const h = t.minute / 60;
  for (const e of WEEKLY) {
    if (!e.days.includes(weekday()) || (e.firstOnly && t.day !== fairDay())) continue;
    const key = `${e.id}:${t.day}`;
    if ((w.eventNotes || (w.eventNotes = {}))[key]) continue;
    if (h >= e.hours[0] - 1 && h < e.hours[1]) {
      w.eventNotes[key] = true;
      for (const k of Object.keys(w.eventNotes)) if (!k.endsWith(':' + t.day)) delete w.eventNotes[k];
      banner(`${e.icon} ${e.name} ${h < e.hours[0] ? 'soon' : 'today'} — ${e.desc} (${fmtWindow(e.hours)})`, 'info', 6);
    }
  }
}

/* ---------------- props ---------------- */
export function townLifeProp(pr, { openShop }) {
  switch (pr.kind) {
    case 'market':
      if (!eventOn('market')) return { label: `Market stalls (empty — market is ${when('market')})`, short: 'LOOK', prio: -3, action: () => toast(`The stalls are bare. Market day is ${when('market')}.`, 'info', 3) };
      return { label: 'Browse the market stalls (Friday specials)', short: 'SHOP', prio: 1, action: () => openShop('market') };
    case 'supper':
      if (!eventOn('supper')) return { label: `Sunday supper (${when('supper')})`, short: 'LOOK', prio: -3, action: () => toast(`Supper's after Sunday service, ${fmtWindow(ev('supper').hours)}. Everybody comes.`, 'info', 3) };
      if (G.s.world.supperDay === G.s.time.day) return { label: 'Sunday supper (you ate already)', short: 'LOOK', prio: -3, action: () => toast('You\'re stuffed. See you next Sunday.', 'info') };
      return { label: 'Join Sunday supper', short: 'EAT', prio: 2, action: () => joinSupper() };
    case 'gallery':
      if (G.s.time.day !== fairDay()) return { label: `Shooting gallery (fair on ${weekday(fairDay())}, day ${fairDay()})`, short: 'LOOK', prio: -3, action: () => toast(`The fair opens ${weekday(fairDay())} (day ${fairDay()}), 10 AM–5 PM.`, 'info', 3) };
      if (!eventOn('fair')) return { label: 'Shooting gallery (fair hours 10 AM–5 PM)', short: 'LOOK', prio: -3, action: () => toast('Fair hours are 10 AM to 5 PM.', 'info') };
      return { label: 'Shooting gallery — $5 a round', short: 'PLAY', prio: 2, action: () => startGallery() };
    case 'pie_stand':
      if (!(G.s.time.day === fairDay() && eventOn('fair'))) return { label: 'Pie stand (fair day only)', short: 'LOOK', prio: -3, action: () => toast('Come back on fair day.', 'info') };
      return { label: 'Buy pie — $4', short: 'BUY', action: () => { if (G.s.money < 4) { toast('Four dollars. You don\'t have it.', 'warn'); return; } addMoney(-4); addItem('pie', 1, true); sfx('coin'); toast('A slice of cherry. Still warm.', 'item'); } };
    default: return null;
  }
}

/* ---------------- Sunday supper ---------------- */
function joinSupper() {
  const ch = chapter();
  G.s.world.supperDay = G.s.time.day;
  const people = [ch.neighbor, ch.shopkeeper, ch.jobContact].filter((id) => NPCS[id]);
  for (const id of people) addRel(id, 4);
  addXP(15, 'Sunday supper'); addJP('neighbor', 6, 'supper', 12);
  G.player.hp = derived().maxHp; G.player.stamina = derived().maxStamina;
  const lines = [{ who: '', text: 'Long tables in the chapel hall. Casseroles, three kinds of pie, and the whole town talking at once.' }];
  for (const f of supperHooks) { const l = f(); if (l) { lines.push(...[].concat(l)); break; } }
  if (lines.length === 1) lines.push(choose(SUPPER_TALK[G.s.chapter] || SUPPER_TALK[1]));
  lines.push({ who: '', text: '(You leave full, rested, and a little more a part of the place.)' });
  sfx('chime');
  playDialogue(lines, () => { advanceMinutes(90); banner('Sunday supper: everyone you know likes you a little more. Health restored.', 'good', 4); saveGame('supper'); });
}

const SUPPER_TALK = {
  1: [
    { who: 'Dee Marsh', text: 'Frank, you\'re sitting with us. No arguments. Ruth\'s already told me you eat like a wolf.' },
    { who: 'Gus Okafor', text: 'The man fixes my saw, eats my wife\'s casserole. Pine Hollow\'s going to keep you, Frank.' },
    { who: 'Pastor Abe', text: 'Grace is short tonight. The food is getting cold and the Lord is patient.' },
    { who: 'Ruth Calloway', text: '(Ruth slides you the last piece of cobbler under the table.) Don\'t tell Dee.' },
  ],
};

Object.assign(SUPPER_TALK, LATER_SUPPER);

/* ---------------- county fair: shooting gallery ---------------- */
const ROUND = 25;
export function startGallery() {
  const m = G.map;
  if (!m.gallery || G.gallery) return;
  if (G.s.money < 5) { toast('Five dollars a round.', 'warn'); return; }
  addMoney(-5);
  G.player.x = m.gallery.shootFrom.x; G.player.y = m.gallery.shootFrom.y; G.player.angle = -Math.PI / 2;
  G.gallery = { t: ROUND, score: 0, ducks: [], spawnT: 0.2 };
  centerMessage('SHOOTING GALLERY', `${ROUND} seconds. Hit the ducks.`, 1.8);
  sfx('blip');
}

export function updateGallery(dt) {
  const gl = G.gallery;
  if (!gl) return;
  const m = G.map;
  gl.t -= dt;
  gl.spawnT -= dt;
  if (gl.spawnT <= 0 && gl.t > 1) {
    gl.spawnT = 0.55 + Math.random() * 0.5;
    const ltr = Math.random() < 0.5;
    gl.ducks.push({ x: ltr ? m.gallery.x0 : m.gallery.x1, y: m.gallery.y + (Math.random() < 0.3 ? -10 : 0), vx: (ltr ? 1 : -1) * (90 + Math.random() * 70 + (ROUND - gl.t) * 3), hit: 0, gold: Math.random() < 0.12 });
  }
  for (const d of gl.ducks) { if (!d.hit) d.x += d.vx * dt; else d.hit += dt; }
  gl.ducks = gl.ducks.filter((d) => (d.hit ? d.hit < 0.5 : d.x >= m.gallery.x0 - 4 && d.x <= m.gallery.x1 + 4));
  // Wander off and the round ends.
  if (dist(G.player.x, G.player.y, m.gallery.shootFrom.x, m.gallery.shootFrom.y) > 160) gl.t = Math.min(gl.t, 0);
  if (gl.t <= 0) endGallery();
}

/** Player bullets knock ducks over. Returns true if the bullet stopped. */
export function galleryBulletCheck(b) {
  const gl = G.gallery;
  if (!gl) return false;
  for (const d of gl.ducks) {
    if (d.hit || Math.abs(d.x - b.x) > 9 || Math.abs(d.y - b.y) > 10) continue;
    d.hit = 0.001;
    gl.score += d.gold ? 3 : 1;
    sfx('impact', { x: d.x, y: d.y });
    return true;
  }
  return false;
}

function endGallery() {
  const gl = G.gallery;
  G.gallery = null;
  const s = gl.score;
  let prize = 'A paper star. Better luck next time.';
  if (s >= 18) { prize = 'Grand prize: the county\'s best shot.'; addMoney(60, 'Gallery'); if (grantPerk('marksman')) prize += ' (Marksman perk!)'; }
  else if (s >= 12) { prize = 'A box of rifle rounds and $25.'; addItem('rifle_ammo', 10, true); addMoney(25, 'Gallery'); }
  else if (s >= 7) { prize = 'A box of shells.'; addItem('shells', 8, true); }
  sfx(s >= 12 ? 'victory' : 'ui');
  centerMessage(`SCORE ${s}`, prize, 3.5);
  G.events.emit('galleryScore', s);
}

export function drawGallery(ctx) {
  const gl = G.gallery;
  if (!gl) return;
  for (const d of gl.ducks) {
    ctx.save(); ctx.translate(d.x, d.y);
    if (d.hit) ctx.rotate(Math.min(1.5, d.hit * 6));
    ctx.fillStyle = d.gold ? '#f0c040' : '#e8e2d0';
    ctx.beginPath(); ctx.ellipse(0, 0, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(d.vx > 0 ? 6 : -6, -5, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d9822b'; ctx.fillRect(d.vx > 0 ? 9 : -12, -6, 3, 2);
    ctx.restore();
  }
}

export function galleryStatus() {
  const gl = G.gallery;
  return gl ? `SHOOTING GALLERY — ${Math.ceil(gl.t)}s · score ${gl.score} (gold ducks are worth 3)` : null;
}

/** For the journal: what's on this week. */
export function weekAhead() {
  const out = [];
  for (const e of WEEKLY) {
    if (e.id === 'fair') { out.push({ ...e, when: `${weekday(fairDay())} (day ${fairDay()}), ${fmtWindow(e.hours)}`, today: G.s.time.day === fairDay() }); continue; }
    const today = e.days.includes(weekday());
    const next = Math.min(...e.days.map((d) => nextWeekday(d)));
    out.push({ ...e, when: `${e.days.join(' & ')}, ${fmtWindow(e.hours)}`, today, next });
  }
  return out;
}

