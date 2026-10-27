// Cloud save: one save slot on the game's server, reached with a random code
// like K7F2-9QXD-M3PA. Turn it on anywhere, type the code on another device,
// and both keep the slot up to date. No accounts: the code is the key.
// What travels: the story save, achievements and Endless Siege records.
import { G } from './state.js';
import { SAVE_KEY, GAME_VERSION, CLOUD_SERVER } from '../config.js';
import { desktopApp } from '../input.js';
import { readSaveRaw, writeSaveData, validateSave } from './save.js';
import { achievementData, mergeAchievements } from './achievements.js';
import { endlessData, mergeEndless } from './endless.js';
import { toast } from '../ui/hud.js';

const KEY = 'cabinUnderSiege.cloud';

function state() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { s = null; }
  return s && typeof s === 'object' ? s : {};
}
function setState(patch) {
  const s = { ...state(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* blocked */ }
  return s;
}

export const cloudCode = () => state().code || null;
export const cloudState = () => state();

/** Where the API lives: same site on the web; the configured server in the desktop app. */
export function apiBase() {
  if (desktopApp) return ((G.settings && G.settings.cloudServer) || CLOUD_SERVER || '').replace(/\/+$/, '') || null;
  return /^https?:$/.test(location.protocol) ? '' : null;
}
export const cloudAvailable = () => apiBase() !== null;

export function deviceName() {
  if (desktopApp) return /Linux/.test(navigator.userAgent) ? 'Steam Deck / PC' : 'Desktop';
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return 'iPhone / iPad';
  if (/Android/.test(navigator.userAgent)) return 'Android';
  return 'Browser';
}

async function call(method, path, body) {
  const base = apiBase();
  if (base === null) throw new Error('Cloud save needs a server address (Settings → Cloud).');
  let r;
  try {
    r = await fetch(`${base}/api/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, keepalive: method !== 'GET' && JSON.stringify(body || '').length < 60000 });
  } catch {
    throw new Error('Can\'t reach the cloud right now. Check your connection.');
  }
  const j = await r.json().catch(() => ({}));
  if (j.conflict || r.status === 409) return { conflict: true, ...j };
  if (!r.ok) throw new Error(j.error || `Cloud error (${r.status}).`);
  return j;
}

function bundle() {
  const save = readSaveRaw();
  return { savedAt: (save && save.savedAt) || 0, data: { save, achievements: achievementData(), endless: endlessData(), v: GAME_VERSION } };
}

/** Upload this device's save into a brand-new slot. Returns the code. */
export async function cloudEnable() {
  const b = bundle();
  const r = await call('POST', 'cloud', { ...b, device: deviceName(), version: GAME_VERSION });
  setState({ code: r.code, pushedAt: b.savedAt, syncedAt: Date.now(), conflict: null });
  return r.code;
}

export const normalizeCode = (c) => {
  const s = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 12 ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}` : null;
};

/** Look up a slot (to show what's in it before linking). */
export async function cloudPeek(code) {
  const c = normalizeCode(code);
  if (!c) throw new Error('A code has 12 letters and numbers, like K7F2-9QXD-M3PA.');
  const r = await call('GET', `cloud/${c}`);
  return { code: c, ...r };
}

/** Link this device to a slot. With useRemote, the cloud save replaces this one. */
export function cloudLink(peek, useRemote) {
  const d = peek.data || {};
  mergeAchievements(d.achievements);
  if (d.endless) mergeEndless(d.endless);
  if (useRemote && d.save && !validateSave(d.save)) writeSaveData(d.save);
  setState({ code: peek.code, pushedAt: useRemote ? peek.savedAt : 0, syncedAt: Date.now(), conflict: null });
  if (!useRemote) cloudPush({ force: true });
}

export function cloudUnlink() { setState({ code: null, pushedAt: 0, conflict: null }); }

let pushing = false;
/** Send this device's latest save up. Refuses to overwrite newer progress from elsewhere unless forced. */
export async function cloudPush({ force = false, quiet = true } = {}) {
  const code = cloudCode();
  if (!code || pushing || apiBase() === null) return false;
  pushing = true;
  try {
    const b = bundle();
    const r = await call('PUT', `cloud/${code}`, { ...b, force, device: deviceName(), version: GAME_VERSION });
    if (r.conflict) {
      const first = !state().conflict;
      setState({ conflict: { savedAt: r.savedAt, device: r.device } });
      if (first || !quiet) toast(`☁ There's a newer save from ${r.device || 'another device'} in the cloud. Settings → Cloud save to load it.`, 'warn', 5);
      return false;
    }
    setState({ pushedAt: b.savedAt, syncedAt: Date.now(), conflict: null });
    if (!quiet) toast('☁ Saved to the cloud.', 'info', 2);
    return true;
  } catch (e) {
    if (!quiet) toast(e.message, 'warn', 3.5);
    return false;
  } finally {
    pushing = false;
  }
}

/** Is there something newer in the cloud than on this device? */
export async function cloudCheck() {
  const code = cloudCode();
  if (!code || apiBase() === null) return null;
  const r = await call('GET', `cloud/${code}`);
  const d = r.data || {};
  mergeAchievements(d.achievements);
  if (d.endless) mergeEndless(d.endless);
  const local = readSaveRaw();
  const newer = !!d.save && r.savedAt > ((local && local.savedAt) || 0) + 1000;
  setState({ syncedAt: Date.now(), conflict: newer ? { savedAt: r.savedAt, device: r.device } : null });
  return { newer, savedAt: r.savedAt, device: r.device, save: d.save };
}

/** Replace this device's save with the cloud's. */
export function cloudTake(check) {
  if (!check || !check.save || validateSave(check.save)) return false;
  writeSaveData(check.save);
  setState({ pushedAt: check.savedAt, conflict: null });
  return true;
}

/** Auto-sync: after saves (debounced) and achievements, and when the app is put away. */
let t = null;
export function initCloudSync() {
  const soon = (ms) => { if (!cloudCode()) return; clearTimeout(t); t = setTimeout(() => cloudPush(), ms); };
  G.events.on('saved', () => soon(12000));
  G.events.on('achievement', () => soon(4000));
  document.addEventListener('visibilitychange', () => { if (document.hidden && cloudCode()) { clearTimeout(t); cloudPush(); } });
}

export { SAVE_KEY };

/* ---------------- daily challenge leaderboard ---------------- */
export function playerId() {
  let id = null;
  try { id = localStorage.getItem('cabinUnderSiege.playerId'); } catch { id = null; }
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('cabinUnderSiege.playerId', id); } catch { /* blocked */ }
  }
  return id;
}

export function playerName() {
  if (!G.settings.playerName) G.settings.playerName = `Frank #${playerId().slice(0, 4).toUpperCase()}`;
  return G.settings.playerName;
}

export const platformName = () => (desktopApp ? 'Deck/PC' : /iPhone|iPad|Android/.test(navigator.userAgent) ? 'Phone' : 'Web');

export async function getDailyScores(day) {
  return call('GET', `scores?day=${encodeURIComponent(day)}`);
}

export async function postDailyScore(day, waves, kills) {
  return call('POST', 'scores', { day, waves, kills, name: playerName(), player: playerId(), platform: platformName() });
}
