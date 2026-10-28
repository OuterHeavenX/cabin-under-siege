// Versioned local save with migration, export and validated import.
import { G, newSave } from './state.js';
import { SAVE_KEY, SAVE_VERSION, SETTINGS_KEY, DEFAULT_SETTINGS } from '../config.js';
import { fillDefaults, deepClone } from '../util.js';
import { ITEMS } from '../data/items.js';
import { SKILLS } from '../data/skills.js';
import { toast } from '../ui/hud.js';

function storage() {
  try { return window.localStorage; } catch (e) { return null; }
}

export function hasSave() {
  const st = storage();
  if (!st) return false;
  try { return !!st.getItem(SAVE_KEY); } catch (e) { return false; }
}

export function readSaveRaw() {
  const st = storage();
  if (!st) return null;
  try {
    const raw = st.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/** Can the player save right now? (Only when safe.) */
export function canSaveNow() {
  if (!G.s || !G.player) return 'No game in progress.';
  if (G.endless) return 'Endless Siege runs aren\'t saved — your story save is untouched.';
  if (G.prequel) return 'Newark, 1999 isn\'t saved — your story save is untouched.';
  if (G.siegeActive) return 'You can\'t save during an attack.';
  if (G.assault) return 'You can\'t save inside the Vescari house.';
  if (G.enemies.some((e) => !e.dead && !e.gone)) return 'You can\'t save with attackers nearby.';
  if (G.player.dead || G.transition) return 'You can\'t save right now.';
  return null;
}

/**
 * Write the save. Player position is only updated when it's a safe moment, so a
 * reload never drops you into the middle of a fight.
 */
export function saveGame(reason = 'auto', { force = false, quiet = true } = {}) {
  if (!G.s || G.endless || G.prequel) return false;
  const unsafe = canSaveNow();
  if (unsafe && !force) {
    if (!quiet) toast(unsafe, 'warn');
    return false;
  }
  const p = G.player;
  if (p && !unsafe) {
    G.s.player.map = G.map.id;
    G.s.player.x = Math.round(p.x);
    G.s.player.y = Math.round(p.y);
    G.s.player.hp = Math.max(1, Math.round(p.hp));
    G.s.player.stamina = Math.round(p.stamina);
    G.s.player.mag = p.mag;
    G.s.player.weapon = p.weapon;
    G.s.player.mags = { ...p.mags, [p.weapon]: p.mag };
    G.s.player.facing = p.angle;
  }
  G.s.savedAt = Date.now();
  G.s.version = SAVE_VERSION;
  // Placed cover records are saved; destroyed ones are already removed.
  const st = storage();
  if (!st) { if (!quiet) toast('Saving is unavailable (private browsing?).', 'warn'); return false; }
  try {
    st.setItem(SAVE_KEY, JSON.stringify(G.s));
  } catch (e) {
    if (!quiet) toast('Could not save: storage is full or blocked.', 'warn');
    return false;
  }
  G.lastSaveAt = G.time;
  if (!quiet) toast('Game saved.', 'info', 1.5);
  G.events && G.events.emit('saved', reason);
  return true;
}

export function deleteSave() {
  const st = storage();
  try { st && st.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

/**
 * Bring any older or partial save up to the current format. Missing fields are
 * filled from a fresh save; unknown items/skills are dropped.
 */
export function migrate(data) {
  const d = deepClone(data);
  const v = typeof d.version === 'number' ? d.version : 0;
  // Version-specific upgrades go here as the format evolves, e.g.:
  // if (v < 2) { d.newField = ...; }
  if (v < 1) { d.version = 1; }
  if (v < 2) {
    // v2: numbered chapters, per-weapon magazines, weapon mods, favors, multi-home saves.
    d.chapter = 1;
    d.weaponMods = { extMag: !!(d.home && d.home.upgrades && d.home.upgrades.extMag) };
    if (d.home && d.home.upgrades) delete d.home.upgrades.extMag;
    if (d.player) { d.player.weapon = 'pistol'; d.player.mags = { pistol: d.player.mag || 0, shotgun: 0, rifle: 0 }; }
    if (d.home) d.home.id = d.home.id || 'cabin';
    if (d.story) { d.story.done = d.story.done || {}; if (d.story.chapterComplete) { d.story.done[1] = true; if (d.story.step === 'free') d.story.step = 'leave_town'; } }
  }
  fillDefaults(d, newSave());
  // Make sure every opening record has all current fields.
  for (const o of Object.values(d.home.openings || {})) {
    if (o.kind === 'window') { if (o.shutters === undefined) o.shutters = false; if (o.shutterHp === undefined) o.shutterHp = 0; }
  }
  d.version = SAVE_VERSION;
  // Sanitize
  for (const k of Object.keys(d.inv)) {
    if (!ITEMS[k] || typeof d.inv[k] !== 'number' || !isFinite(d.inv[k]) || d.inv[k] <= 0) delete d.inv[k];
    else d.inv[k] = Math.min(ITEMS[k].cap, Math.floor(d.inv[k]));
  }
  d.skills = Array.isArray(d.skills) ? [...new Set(d.skills.filter((s) => SKILLS[s]))] : [];
  const mapsByChapter = { 1: ['cabin', 'town'], 2: ['millbrook'], 3: ['farm'], 4: ['estate'], 5: ['shorthills', 'mansion'] };
  if (!mapsByChapter[d.chapter]) d.chapter = 1;
  if (!mapsByChapter[d.chapter].includes(d.player.map)) d.player.map = mapsByChapter[d.chapter][0];
  // Saves from before town life (v0.9): open the town once you're past meeting your job contact.
  if ([2, 3, 4].includes(d.chapter) && d.story && d.story.flags && !d.story.flags.townOpen && !/_(arrive|meet_\w+|find_work)$/.test(d.story.step || '')) d.story.flags.townOpen = true;
  if (!Array.isArray(d.home.traps)) d.home.traps = [];
  d.home.traps = d.home.traps.filter((t) => t && Number.isInteger(t.cx) && Number.isInteger(t.cy));
  d.money = Math.max(0, Math.floor(Number(d.money) || 0));
  if (!Array.isArray(d.home.covers)) d.home.covers = [];
  d.home.covers = d.home.covers.filter((c) => c && Number.isInteger(c.cx) && Number.isInteger(c.cy) && c.hp > 0 && (c.type === 'sandbags' || c.type === 'barricade'));
  return d;
}

/** Validate an imported save before it is allowed to replace the current one. */
export function validateSave(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Not a save file.';
  if (typeof data.version !== 'number') return 'Missing save version.';
  if (data.version > SAVE_VERSION) return `This save is from a newer version of the game (v${data.version}).`;
  const req = ['player', 'stats', 'jp', 'inv', 'home', 'story', 'time', 'world'];
  for (const k of req) if (!data[k] || typeof data[k] !== 'object') return `Save is missing "${k}".`;
  if (typeof data.stats.level !== 'number' || data.stats.level < 1 || data.stats.level > 200) return 'Invalid level.';
  if (typeof data.time.day !== 'number' || typeof data.time.minute !== 'number') return 'Invalid time.';
  if (typeof data.player.x !== 'number' || typeof data.player.y !== 'number') return 'Invalid position.';
  return null;
}

export function exportSave() {
  saveGame('export');
  const data = G.s ? JSON.stringify(G.s, null, 1) : JSON.stringify(readSaveRaw());
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  const day = G.s ? G.s.time.day : 0;
  a.href = URL.createObjectURL(blob);
  a.download = `cabin-under-siege-day${day}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Read and validate a save file. Resolves to migrated data or rejects with a message. */
export function readImportFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject('No file selected.'); return; }
    if (file.size > 2_000_000) { reject('File is too large to be a save.'); return; }
    const r = new FileReader();
    r.onload = () => {
      let data;
      try { data = JSON.parse(r.result); } catch (e) { reject('File is not valid JSON.'); return; }
      const err = validateSave(data);
      if (err) { reject(err); return; }
      resolve(migrate(data));
    };
    r.onerror = () => reject('Could not read the file.');
    r.readAsText(file);
  });
}

export function writeSaveData(data) {
  const st = storage();
  if (!st) return false;
  try { st.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
}

/* ---------------- settings ---------------- */
export function loadSettings() {
  const st = storage();
  let s = {};
  try { s = JSON.parse(st.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { s = {}; }
  G.settings = fillDefaults(s, DEFAULT_SETTINGS);
}

export function saveSettings() {
  const st = storage();
  try { st && st.setItem(SETTINGS_KEY, JSON.stringify(G.settings)); } catch (e) { /* ignore */ }
}
