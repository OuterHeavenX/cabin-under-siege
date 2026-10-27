// Endless Siege: an arcade mode on any home you've reached in the story.
// Waves escalate until you fall. Never touches your story save; best results
// are kept in their own small localStorage record.
import { G, newSave, newHome } from './state.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { pickSpawnTypes } from './enemies.js';
import { startSiege } from './siege.js';
import { addItem, count } from './inventory.js';
import { banner, toast, centerMessage } from '../ui/hud.js';
import { sfx, setMusic } from '../audio.js';
import { relOf } from './progression.js';

const KEY = 'cabin-under-siege-endless';

export const ENDLESS_SITES = [
  { id: 'cabin', map: 'cabin', home: 'cabin', chapter: 1, name: 'The Cabin', place: 'Pine Hollow' },
  { id: 'house', map: 'millbrook', home: 'house', chapter: 2, name: 'Larch Street', place: 'Millbrook' },
  { id: 'farm', map: 'farm', home: 'farm', chapter: 3, name: 'The Farm', place: 'Kettle Crossing' },
];

export function endlessData() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch { d = null; }
  d = d && typeof d === 'object' ? d : {};
  d.unlocked = Array.isArray(d.unlocked) ? d.unlocked : ['cabin'];
  if (!d.unlocked.includes('cabin')) d.unlocked.unshift('cabin');
  d.best = d.best && typeof d.best === 'object' ? d.best : {};
  return d;
}

function writeData(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode: best scores just won't stick */ } }

/** Reaching a chapter in the story unlocks its home for Endless Siege. */
export function unlockEndlessFor(chapterN) {
  const d = endlessData();
  let added = false;
  for (const s of ENDLESS_SITES) if (s.chapter <= chapterN && !d.unlocked.includes(s.id)) { d.unlocked.push(s.id); added = true; }
  if (added) writeData(d);
}

/** Build a throwaway save for an endless run. `begin` is main.js's startGame. */
export function startEndless(siteId, begin) {
  const site = ENDLESS_SITES.find((s) => s.id === siteId) || ENDLESS_SITES[0];
  const s = newSave();
  s.chapter = site.chapter;
  s.difficulty = (G.s && G.s.difficulty) || 'normal';
  s.home = newHome(site.home);
  s.player.map = site.map;
  s.story.step = 'endless';
  s.story.flags = { firstSiegeDone: true };
  s.time.day = 1; s.time.minute = 22 * 60;
  s.stats.level = 4;
  s.stats.attrs = { vit: 3, end: 2, pre: 3, awa: 2, res: 2 };
  s.rel.ruth = 40;
  s.companion = { ruth: { joined: site.chapter > 1, declined: false } };
  s.money = 0;
  s.player.mags = { pistol: 8, shotgun: 5, rifle: 5 };
  s.inv = { ammo: 64, shotgun: 1, shells: 20, rifle: 1, rifle_ammo: 12, bandage: 4, medkit: 2, wood: 20, board_kit: 2, door_brace: 1, toolkit: 1 };
  G.s = s;
  G.endless = { site, wave: 0, kills: 0, state: 'break', breakT: 12, nextBanner: 0 };
  begin(false);
  banner(`ENDLESS SIEGE — ${site.name}. Board up, find a spot. First wave in 12 seconds.`, 'objective', 6);
  if (relOf('ruth') >= 3) toast('Ruth is here with Harold\'s shotgun.', 'good', 3);
}

function wavePlan(n) {
  const size = Math.min(16, 3 + Math.floor(n * 1.4));
  const w = [['gunman', 0.36], ['scout', 0.22], ['enforcer', Math.min(0.25, 0.08 + n * 0.02)], ['arsonist', n >= 3 ? 0.08 : 0], ['handler', n >= 2 ? 0.07 : 0], ['sniper', n >= 4 && ENEMY_TYPES.sniper ? 0.08 : 0]];
  const tot = w.reduce((a, [, x]) => a + x, 0);
  const types = pickSpawnTypes(size, w.map(([t, x]) => [t, x / tot]));
  const dirs = Object.keys(G.map.spawns);
  const waves = [];
  const groups = Math.min(3, 1 + Math.floor(n / 3));
  for (let g = 0; g < groups; g++) waves.push({ dir: dirs[(n + g * 2) % dirs.length], types: [], delay: g * 10 });
  types.forEach((t, i) => waves[i % groups].types.push(t));
  if (n % 5 === 0) waves[waves.length - 1].types.push('lieutenant');
  if (G.endless.site.id === 'farm' && n >= 3 && n % 3 === 0) waves[0].types.unshift('truck');
  return { kind: 'endless', hpMult: 1 + (n - 1) * 0.07, bossName: 'Lieutenant', waves };
}

export function updateEndless(dt) {
  const E = G.endless;
  if (!E) return;
  G.s.time.minute = 22 * 60 + 30; // it's always the longest night
  if (E.state !== 'break' || G.player.dead) return;
  E.breakT -= dt;
  if (E.breakT <= E.nextBanner && E.breakT > 0.5 && E.wave > 0) {
    banner(`Wave ${E.wave + 1} in ${Math.ceil(E.breakT)}s — repair, reload, reposition.`, 'info', 2.5);
    E.nextBanner = Math.floor((E.breakT - 1) / 5) * 5;
  }
  if (E.breakT <= 0) {
    E.wave++;
    E.state = 'fight';
    startSiege({ plan: wavePlan(E.wave) }, true);
    centerMessage(`WAVE ${E.wave}`, E.wave % 5 === 0 ? 'A lieutenant leads this one' : 'Hold the line', 2.4);
  }
}

/** Called by the siege system when a wave is cleared. */
export function endlessWaveCleared(sg) {
  const E = G.endless;
  E.kills += sg.killed;
  E.state = 'break';
  E.breakT = 22;
  E.nextBanner = 20;
  sfx('victory');
  setMusic('night');
  // Resupply between waves, scaled a little with the wave number.
  const gifts = [];
  const top = (id, n, label) => { const got = addItem(id, n, true); if (got) gifts.push(`${got} ${label}`); };
  if (count('ammo') < 48) top('ammo', 24, 'rounds');
  top('shells', 6, 'shells');
  if (E.wave % 2 === 0) top('rifle_ammo', 4, 'rifle rounds');
  top('wood', 6, 'wood');
  if (E.wave % 3 === 0) top('medkit', 1, 'first-aid kit'); else top('bandage', 1, 'bandage');
  centerMessage(`WAVE ${E.wave} CLEARED`, gifts.length ? `Supplies: ${gifts.join(', ')}` : 'Catch your breath', 3);
}

/** Called instead of the story defeat flow. Returns the result for the summary screen. */
export function endlessDefeat() {
  const E = G.endless;
  const d = endlessData();
  const kills = E.kills + (G.siege ? G.siege.killed : 0);
  const survived = Math.max(0, E.wave - 1);
  const prev = d.best[E.site.id] || { waves: 0, kills: 0 };
  const record = survived > prev.waves || (survived === prev.waves && kills > prev.kills);
  if (record) { d.best[E.site.id] = { waves: survived, kills }; writeData(d); }
  return { site: E.site, survived, kills, record, best: record ? { waves: survived, kills } : prev };
}
