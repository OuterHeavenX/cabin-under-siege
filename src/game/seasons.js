// The year turns: four 12-day seasons, starting in autumn on Day 1. Seasons
// change how long the nights are, what the weather does, how the land looks,
// and a few rules — snow shows tracks, ponds and lakes freeze hard enough to
// walk on (and so does the shore at the estate), spring mud slows everyone,
// and summer fires burn longer. Each season also brings its own days to mark.
import { G } from './state.js';
import { TILE } from '../config.js';
import { GR, SO } from '../world/map.js';
import { banner, toast } from '../ui/hud.js';
import { playDialogue } from '../ui/dialogue.js';
import { sfx } from '../audio.js';
import { chapter, atHome, visiting, here } from './chapters.js';
import { SEASONAL } from '../data/seasons.js';
import { quietMoment, withChoices, grant, lifeMoment } from './life.js';
import { saveGame } from './save.js';

export { SEASON_DAYS, YEAR_DAYS, ORDER, SEASONS, seasonIdOf, seasonId, season, dayOfSeason, yearOf, nextSeasonDay, seasonDarkness, seasonNight } from './season-core.js';
import { SEASON_DAYS, ORDER, SEASONS, seasonId, season, dayOfSeason, yearOf } from './season-core.js';

export const isWinter = () => seasonId() === 'winter';

/* ---------------- ground rules ---------------- */
/** Ice: water cells can be walked on in winter (pathing and collision). */
export { frozenNow as frozen } from './season-core.js';
import { frozenNow as frozen } from './season-core.js';
export const iceAt = (m, cx, cy) => frozen() && m.getSolid(cx, cy) === SO.WATER;

const NATURAL_GR = new Set([GR.GRASS, GR.DIRT, GR.GARDEN]);
/** Spring mud: after rain, open ground slows everyone a little. */
export function muddy() {
  if (seasonId() !== 'spring' || G.endless || G.prequel) return false;
  const w = G.s.world;
  return (w.lastRainDay != null && G.s.time.day - w.lastRainDay <= 1);
}
export function groundSpeed(x, y) {
  const m = G.map;
  if (!m || !muddy()) return 1;
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
  if (!m.inBounds(cx, cy) || m.buildingAt(x, y)) return 1;
  return NATURAL_GR.has(m.ground[m.idx(cx, cy)]) ? 0.86 : 1;
}

/** Summer fires burn longer and wider; snow damps them. */
export function fireMult() {
  const id = seasonId();
  return id === 'summer' ? { life: 1.3, r: 1.15 } : id === 'winter' ? { life: 0.75, r: 0.9 } : { life: 1, r: 1 };
}
/** Hiding in snow: they can follow your tracks, so it takes longer for them to give up. */
export const hideMult = () => (isWinter() ? 1.5 : 1);
/** Autumn: more deer about. */
export const deerBonus = () => (seasonId() === 'autumn' ? 1 : 0);
/** Autumn harvest: the garden gives one extra. */
export const harvestBonus = () => (seasonId() === 'autumn' ? 1 : seasonId() === 'winter' ? -1 : 0);

/* ---------------- tracks in the snow ---------------- */
const MAX_TRACKS = 360, TRACK_LIFE = 150; // seconds
export function addTrack(ent, who) {
  if (!isWinter() || !G.map) return;
  const m = G.map;
  const last = ent._trk;
  if (last && (ent.x - last.x) ** 2 + (ent.y - last.y) ** 2 < 15 * 15) return;
  const cx = Math.floor(ent.x / TILE), cy = Math.floor(ent.y / TILE);
  if (!m.inBounds(cx, cy) || m.buildingAt(ent.x, ent.y)) { ent._trk = { x: ent.x, y: ent.y }; return; }
  const gt = m.ground[m.idx(cx, cy)];
  if (gt === GR.FLOOR || gt === GR.TILEFLOOR || gt === GR.PORCH) { ent._trk = { x: ent.x, y: ent.y }; return; }
  const a = last ? Math.atan2(ent.y - last.y, ent.x - last.x) : 0;
  const side = (ent._side = -(ent._side || 1));
  const list = G.tracks || (G.tracks = []);
  list.push({ x: ent.x + Math.cos(a + Math.PI / 2) * 3 * side, y: ent.y + Math.sin(a + Math.PI / 2) * 3 * side, a, t: 0, who, map: m.id });
  if (list.length > MAX_TRACKS) list.splice(0, list.length - MAX_TRACKS);
  ent._trk = { x: ent.x, y: ent.y };
}
export function updateTracks(dt) {
  const list = G.tracks;
  if (!list || !list.length) return;
  for (const t of list) t.t += dt;
  if (list[0].t > TRACK_LIFE || list[0].map !== (G.map && G.map.id)) G.tracks = list.filter((t) => t.t < TRACK_LIFE && t.map === G.map.id);
}
export function drawTracks(ctx, inView) {
  const list = G.tracks;
  if (!list || !list.length) return;
  for (const t of list) {
    if (!inView(t.x, t.y)) continue;
    const a = Math.max(0, 1 - t.t / TRACK_LIFE);
    ctx.fillStyle = t.who === 'enemy' ? `rgba(70,80,100,${0.5 * a})` : t.who === 'deer' ? `rgba(90,80,70,${0.45 * a})` : `rgba(95,110,130,${0.42 * a})`;
    ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.a);
    if (t.who === 'deer') { ctx.beginPath(); ctx.ellipse(0, -1.2, 1.6, 1, 0, 0, Math.PI * 2); ctx.ellipse(0, 1.2, 1.6, 1, 0, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.beginPath(); ctx.ellipse(0, 0, 4, 2.2, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
}

/* ---------------- the land, by season (drawn over the cached ground) ---------------- */
function noise(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }

/** Paint the season onto the ground layer (under walls, rocks and decor, which are drawn after):
 *  snow cover and ice, fallen leaves, spring flowers, dry summer grass. */
export function paintSeason(g, m) {
  const id = seasonId();
  for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
    const i = m.idx(cx, cy), gt = m.ground[i], x = cx * TILE, y = cy * TILE, n = noise(cx, cy);
    const inside = gt === GR.FLOOR || gt === GR.TILEFLOOR;
    const so = m.solid[i];
    if (inside) continue;
    if (id === 'winter') {
      if (m.solid[i] === SO.WATER) {
        g.fillStyle = 'rgba(214,232,242,0.86)'; g.fillRect(x, y, TILE, TILE);
        g.strokeStyle = 'rgba(150,185,210,0.55)'; g.lineWidth = 1;
        if (n > 0.6) { g.beginPath(); g.moveTo(x + 4, y + n * 20); g.lineTo(x + 16, y + 10 + n * 8); g.lineTo(x + 28, y + 6); g.stroke(); }
      } else if (gt === GR.ROAD || gt === GR.SIDEWALK) {
        g.fillStyle = 'rgba(220,226,232,0.28)'; g.fillRect(x, y, TILE, TILE); // plowed, grey slush
        g.fillStyle = 'rgba(240,244,248,0.5)'; if (n > 0.5) g.fillRect(x, y + (n > 0.75 ? 0 : TILE - 5), TILE, 5);
      } else if (gt === GR.PORCH) {
        g.fillStyle = 'rgba(236,240,245,0.35)'; g.fillRect(x, y, TILE, TILE);
      } else {
        const trod = gt === GR.DIRT || gt === GR.GRAVEL; // paths stay readable: thinner, trodden snow
        g.fillStyle = `rgba(238,242,247,${trod ? 0.52 + n * 0.05 : 0.86 + n * 0.04})`; g.fillRect(x, y, TILE, TILE);
        g.fillStyle = 'rgba(190,205,222,0.35)';
        for (let k = 0; k < 3; k++) { const hx = x + noise(cx * 3 + k, cy) * 30, hy = y + noise(cx, cy * 3 + k) * 30; g.beginPath(); g.ellipse(hx, hy, 5 + n * 4, 2.5, 0.3, 0, Math.PI * 2); g.fill(); }
      }
    } else if (id === 'autumn') {
      if (gt === GR.GRASS || gt === GR.DIRT) {
        g.fillStyle = 'rgba(150,110,40,0.16)'; g.fillRect(x, y, TILE, TILE);
        const cols = ['#c8642a', '#d89a2c', '#a8401f', '#e0b84a'];
        for (let k = 0; k < (n > 0.7 ? 6 : 2); k++) {
          g.fillStyle = cols[Math.floor(noise(cx + k, cy * 7) * 4)];
          const lx = x + noise(cx * 5 + k, cy) * 30, ly = y + noise(cx, cy * 5 + k) * 30;
          g.beginPath(); g.ellipse(lx, ly, 2.4, 1.4, noise(k, cx) * 3, 0, Math.PI * 2); g.fill();
        }
      }
    } else if (id === 'spring') {
      if (gt === GR.GRASS) {
        g.fillStyle = 'rgba(120,200,80,0.1)'; g.fillRect(x, y, TILE, TILE);
        if (n > 0.82) for (let k = 0; k < 4; k++) { g.fillStyle = ['#f2f0f8', '#f4d84a', '#c88ad8'][k % 3]; g.fillRect(x + noise(cx * 9 + k, cy) * 28 + 2, y + noise(cx, cy * 9 + k) * 28 + 2, 2, 2); }
      } else if (gt === GR.DIRT) { g.fillStyle = 'rgba(60,40,20,0.22)'; g.fillRect(x, y, TILE, TILE); }
    } else if (id === 'summer') {
      if (gt === GR.GRASS) { g.fillStyle = `rgba(190,170,80,${0.1 + n * 0.08})`; g.fillRect(x, y, TILE, TILE); }
    }
  }
  return id;
}

/** Tree canopies by season: tint the leafy sprite (or show bare branches with snow). */
export function canopyStyle(kind) {
  const id = seasonId();
  if (id === 'autumn' && kind !== 'pine') return { tint: 'rgba(205,110,30,0.55)', comp: 'source-atop' };
  if (id === 'winter') return kind === 'pine' ? { snow: true } : { bare: true };
  if (id === 'spring' && kind === 'fruit') return { blossom: true };
  if (id === 'summer') return { tint: 'rgba(40,70,10,0.18)', comp: 'source-atop' };
  return null;
}

/* ---------------- season changes and seasonal days ---------------- */
let tick = 0;
export function updateSeasons(dt) {
  updateTracks(dt);
  if (!G.s || G.endless || G.prequel) return;
  tick -= dt;
  if (tick > 0) return;
  tick = 1.5;
  const L = G.s.life || {};
  const sid = seasonId(), key = `${yearOf()}:${sid}`;
  if (L.seasonSeen !== key) {
    const first = !L.seasonSeen;
    L.seasonSeen = key;
    if (!first && !G.siegeActive) { banner(`${season().icon} ${season().change}`, 'objective', 8); G.events.emit('seasonChange', sid); }
  }
  if (typeof window !== 'undefined' && window.__cusNoEvents) return;
  if (!quietMoment()) return;
  if (L.eventDay === G.s.time.day) return;
  const e = SEASONAL.find(seasonalEligible);
  if (e) fireSeasonal(e);
}

const done = () => (G.s.life.seasonal || (G.s.life.seasonal = {}));
export const seasonalKey = (e, day = G.s.time.day) => `${e.id}:${yearOf(day)}`;
export function seasonalEligible(e) {
  const s = G.s;
  if (e.season !== seasonId() || done()[seasonalKey(e)]) return false;
  if (dayOfSeason() < (e.from || 1)) return false;
  if (!s.story.flags.firstSiegeDone && !s.life.post && s.chapter === 1) return false; // let Chapter 1 find its feet first
  if (e.where === 'home' && !atHome()) return false;
  if (e.where === 'town' && (!G.map || G.map.id !== here().workMap)) return false;
  if (visiting() && !e.anywhere) return false;
  if (e.hours) { const h = s.time.minute / 60; if (h < e.hours[0] || h >= e.hours[1]) return false; }
  if (e.needs && !e.needs(s)) return false;
  return true;
}
export function fireSeasonal(e) {
  const s = G.s;
  done()[seasonalKey(e)] = s.time.day;
  s.life.eventDay = s.time.day;
  const pick = { value: null };
  const lines = e.lines(s, chapter());
  sfx(e.sound || 'chime');
  playDialogue(withChoices(lines, pick), () => {
    const r = typeof e.reward === 'function' ? e.reward(s, pick.value, chapter()) : e.reward;
    if (r) grant(r);
    if (e.result) { try { e.result(s, pick.value); } catch (err) { console.error(err); } }
    if (e.moment) lifeMoment('event');
    if (e.note) toast(e.note, 'info', 5);
    G.events.emit('seasonalEvent', e.id, pick.value);
    saveGame('event');
  });
}

/** For the Journal calendar. */
export function seasonSummary() {
  const s = season();
  const left = SEASON_DAYS - dayOfSeason() + 1;
  const nxt = SEASONS[ORDER[(ORDER.indexOf(s.id) + 1) % 4]];
  const coming = SEASONAL.filter((e) => e.season === s.id && !done()[seasonalKey(e)]).map((e) => e.title);
  return { name: s.name, icon: s.icon, day: dayOfSeason(), year: yearOf(), left, next: nxt.name, nextIcon: nxt.icon, change: s.change, coming };
}
