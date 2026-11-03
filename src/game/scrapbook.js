// The Scrapbook: small photos of the moments that mattered — a night you
// held the house, an old friend on a return visit, Thanksgiving, the day you
// worked out the Paper Trail — plus any photo you take yourself (Journal →
// Scrapbook → Take a photo). Photos are small JPEGs kept on this device (not
// in the save file, and not synced), at most 30; the oldest automatic ones
// make room first.
import { G } from './state.js';
import { chapter, here } from './chapters.js';
import { season } from './season-core.js';
import { NPCS } from '../data/npcs.js';
import { dialogueActive } from '../ui/dialogue.js';
import { toast } from '../ui/hud.js';

const KEY = 'cabin-under-siege-scrapbook';
export const MAX_PHOTOS = 30;
const W = 320;

export function photos() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(d) ? d : []; } catch { return []; }
}
function write(list) {
  for (let tries = 0; tries < 6; tries++) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { // full: drop the oldest automatic photo and try again
      const i = list.findIndex((p) => p.auto); if (i < 0) list.shift(); else list.splice(i, 1);
    }
  }
  return false;
}
export function deletePhoto(id) { write(photos().filter((p) => p.id !== id)); }

/** Snapshot the game view (the world, not the HUD). */
export function grab() {
  const cv = document.getElementById('game');
  if (!cv || !cv.width) return null;
  const h = Math.round(W * cv.height / cv.width);
  const o = document.createElement('canvas'); o.width = W; o.height = h;
  o.getContext('2d').drawImage(cv, 0, 0, W, h);
  try { return o.toDataURL('image/jpeg', 0.72); } catch { return null; }
}

export function addPhoto(caption, { auto = false } = {}) {
  if (!G.s || G.prequel) return null;
  const img = grab();
  if (!img) return null;
  const list = photos();
  const p = { id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, img, caption, day: G.s.time.day, season: season().name, place: here().place, auto, t: Date.now() };
  list.push(p);
  while (list.length > MAX_PHOTOS) { const i = list.findIndex((x) => x.auto); list.splice(i < 0 ? 0 : i, 1); }
  write(list);
  G.events.emit('photo', p);
  return p;
}

/** Take one yourself. */
export function takePhoto() {
  const p = addPhoto(`Day ${G.s.time.day} · ${here().place}`);
  if (p) toast('📷 Added to your scrapbook (Journal → Scrapbook).', 'good', 2.5);
  return p;
}

/** A moment worth keeping: wait until the conversation and menus are out of the way, then snap. */
let pending = null;
function moment(caption) {
  if (G.endless || G.prequel || pending) return;
  pending = { caption, t: 0 };
}
export function updateScrapbook(dt) {
  if (!pending) return;
  pending.t += dt;
  if (pending.t < 0.8 || dialogueActive() || G.modal || G.transition || G.cutscene) { if (pending.t > 20) pending = null; return; }
  const c = pending.caption; pending = null;
  if (addPhoto(c, { auto: true })) toast('📷 A moment for the scrapbook.', 'info', 2);
}

export function initScrapbookEvents() {
  const ev = G.events;
  ev.on('siegeWon', (sg) => { if (sg.plan.kind === 'story') moment(sg.plan.keystone ? `The night Sonny Ventura came to the watch house` : `Day ${G.s.time.day}: we held ${chapter().name}`); });
  ev.on('reunion', (id) => moment(`Back in ${here().place} — ${NPCS[id] ? NPCS[id].name.split(' ')[0].replace(/"/g, '') : 'an old friend'}`));
  ev.on('seasonalEvent', (id) => moment({ thanksgiving: 'Thanksgiving', christmas: 'Christmas Eve', snow_day: 'Snowed in', ice_fishing: 'Ice fishing', fourth: 'The Fourth of July', planting: 'Planting day', opening_day: 'Opening Day', heat_wave: 'The heat wave', deer_opener: 'Opening day of deer season' }[id] || 'A day to remember'));
  ev.on('trailSolved', () => moment('The day it all made sense: Keystone'));
  ev.on('keystoneDone', (v) => moment({ reyes: 'Twenty-two boxes for Agent Reyes', press: 'Front page', burn: 'Two hours by a dumpster on Broad Street', keep: 'Twenty-two boxes in the trunk' }[v] || 'Keystone'));
  ev.on('visitStart', (n) => moment(`The road back`));
}
