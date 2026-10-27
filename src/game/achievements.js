// Achievements ("trophies"). They belong to the player, not to one save: kept
// in their own localStorage record, carried by cloud save between devices, and
// never lost by starting a new game. Most are checked every couple of seconds
// against the save; a few count lifetime events (kills, fish, trees...).
import { G } from './state.js';
import { relOf } from './progression.js';
import { sfx } from '../audio.js';

const KEY = 'cabinUnderSiege.achievements';

export const ACHIEVEMENTS = [
  // Story
  { id: 'first_night', icon: '🌲', name: 'Welcome to Pine Hollow', desc: 'Survive the first night the family comes.' },
  { id: 'ch1', icon: '🏚', name: 'The Cabin', desc: 'Finish Chapter 1.' },
  { id: 'ch2', icon: '🏘', name: 'Larch Street', desc: 'Finish Chapter 2.' },
  { id: 'ch3', icon: '🌾', name: 'The Wisconsin Farm', desc: 'Finish Chapter 3.' },
  { id: 'ch4', icon: '⛵', name: 'The Estate', desc: 'Finish Chapter 4.' },
  { id: 'ch5', icon: '🏛', name: 'The End of the Road', desc: 'Finish the story.' },
  { id: 'end_justice', icon: '⚖', name: 'The Long Arm', desc: 'Let the law have Leo Vescari.', hidden: true },
  { id: 'end_walk', icon: '🚪', name: 'The Empty House', desc: 'Walk away from Leo Vescari.', hidden: true },
  { id: 'end_blood', icon: '🩸', name: 'Father and Son', desc: 'End it the family way.', hidden: true },
  { id: 'end_crown', icon: '👑', name: 'The Head of the Table', desc: 'Take Leo\'s chair.', hidden: true },
  { id: 'all_endings', icon: '🎬', name: 'Every Way It Ends', desc: 'See all four endings.' },
  { id: 'ghost', icon: '👤', name: 'Ghost of Short Hills', desc: 'Reach Leo\'s study without ever raising the alarm.' },
  { id: 'untouchable', icon: '🛡', name: 'Untouchable', desc: 'Finish the story without ever blacking out.' },
  { id: 'hard_story', icon: '💀', name: 'Made of Iron', desc: 'Finish the story on Hard.' },
  { id: 'newark', icon: '🌃', name: 'Newark, 1999', desc: 'Play Frankie\'s last night in the family.' },
  { id: 'ngplus', icon: '🔁', name: 'Once More, With Feeling', desc: 'Start a New Game+.' },
  { id: 'ngplus_done', icon: '♾', name: 'Old Habits', desc: 'Finish the story in New Game+.' },
  // People
  { id: 'ruth5', icon: '🥧', name: 'Like Family', desc: 'Earn Ruth\'s full trust (♥5).' },
  { id: 'allies', icon: '📞', name: 'Every Favor Called', desc: 'Have six friends answer the phone in Short Hills.' },
  { id: 'duke', icon: '🐕', name: 'Good Boy', desc: 'Adopt Duke.' },
  { id: 'neighbor', icon: '🤝', name: 'Good Neighbor', desc: 'Finish 15 favors and errands.' },
  // Fighting
  { id: 'kills50', icon: '🎯', name: 'Not Today', desc: 'Defeat 50 attackers.' },
  { id: 'kills300', icon: '🔥', name: 'Army of One', desc: 'Defeat 300 attackers.' },
  { id: 'trap', icon: '🪤', name: 'Watch Your Step', desc: 'Catch an attacker in a bear trap.' },
  { id: 'fortress', icon: '🏰', name: 'Fortress', desc: 'Have every window boarded or shuttered and every door braced.' },
  // Life
  { id: 'jobs25', icon: '🧰', name: 'Honest Work', desc: 'Finish 25 jobs.' },
  { id: 'fish10', icon: '🐟', name: 'Gone Fishing', desc: 'Catch 10 fish.' },
  { id: 'trees50', icon: '🪓', name: 'Lumberjack', desc: 'Chop 50 trees.' },
  { id: 'crops20', icon: '🍅', name: 'Green Thumb', desc: 'Pick 20 crops.' },
  { id: 'level10', icon: '⭐', name: 'Seasoned', desc: 'Reach level 10.' },
  { id: 'skills10', icon: '📚', name: 'Jack of All Trades', desc: 'Learn 10 skills.' },
  { id: 'rich', icon: '💵', name: 'Rainy Day Fund', desc: 'Have $1,500 at once.' },
  // Endless
  { id: 'wave5', icon: '5️⃣', name: 'Holding On', desc: 'Survive 5 waves of Endless Siege.' },
  { id: 'wave10', icon: '🔟', name: 'Holding Out', desc: 'Survive 10 waves of Endless Siege.' },
  { id: 'wave20', icon: '🏆', name: 'Last Man Standing', desc: 'Survive 20 waves of Endless Siege.' },
  { id: 'daily', icon: '📅', name: 'Daily Grind', desc: 'Post a score in the daily challenge.' },
];
const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

function read() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch { d = null; }
  d = d && typeof d === 'object' ? d : {};
  d.unlocked = d.unlocked && typeof d.unlocked === 'object' ? d.unlocked : {};
  d.stats = d.stats && typeof d.stats === 'object' ? d.stats : {};
  d.endings = Array.isArray(d.endings) ? d.endings : [];
  return d;
}
let data = read();
function write() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage blocked */ } }

export const achievementData = () => data;
export const isUnlocked = (id) => !!data.unlocked[id];
export const unlockedCount = () => Object.keys(data.unlocked).filter((id) => BY_ID[id]).length;

export function unlock(id) {
  if (!BY_ID[id] || data.unlocked[id]) return false;
  data.unlocked[id] = Date.now();
  write();
  const a = BY_ID[id];
  showTrophy(a);
  sfx('blip');
  G.events && G.events.emit('achievement', id);
  return true;
}

function bump(stat, n = 1) { data.stats[stat] = (data.stats[stat] || 0) + n; write(); return data.stats[stat]; }

/** Merge another device's record in (cloud save): the union of everything. */
export function mergeAchievements(other) {
  if (!other || typeof other !== 'object') return;
  for (const [id, t] of Object.entries(other.unlocked || {})) if (!data.unlocked[id] || t < data.unlocked[id]) data.unlocked[id] = t;
  for (const [k, v] of Object.entries(other.stats || {})) data.stats[k] = Math.max(data.stats[k] || 0, Number(v) || 0);
  for (const e of other.endings || []) if (!data.endings.includes(e)) data.endings.push(e);
  write();
}

/** Re-read after an import or a test reset. */
export function reloadAchievements() { data = read(); }

function showTrophy(a) {
  const box = document.getElementById('trophy-pop') || (() => {
    const el = document.createElement('div'); el.id = 'trophy-pop'; document.getElementById('app').appendChild(el); return el;
  })();
  const div = document.createElement('div');
  div.className = 'trophy-card';
  div.innerHTML = `<span class="tr-icon"></span><span class="tr-txt"><b>Achievement unlocked</b><span class="tr-name"></span></span>`;
  div.querySelector('.tr-icon').textContent = a.icon;
  div.querySelector('.tr-name').textContent = a.name;
  box.appendChild(div);
  setTimeout(() => { div.classList.add('out'); setTimeout(() => div.remove(), 500); }, 4200);
}

/* ---------------- checks ---------------- */
function checkSave() {
  const s = G.s;
  if (!s || G.endless || G.prequel) return;
  const done = (s.story && s.story.done) || {};
  for (let n = 1; n <= 5; n++) if (done[n]) unlock(`ch${n}`);
  if (s.story && s.story.flags && s.story.flags.firstSiegeDone) unlock('first_night');
  if (done[5]) {
    if (s.ending) {
      unlock(`end_${s.ending}`);
      if (!data.endings.includes(s.ending)) { data.endings.push(s.ending); write(); }
      if (['justice', 'walk', 'blood', 'crown'].every((e) => data.endings.includes(e))) unlock('all_endings');
    }
    if (s.finaleQuiet) unlock('ghost');
    if (!s.world.defeats) unlock('untouchable');
    if (s.difficulty === 'hard') unlock('hard_story');
    if (s.ngPlus) unlock('ngplus_done');
  }
  if (s.ngPlus) unlock('ngplus');
  if ((s.allies || []).length >= 6) unlock('allies');
  if (s.rel && relOf('ruth') >= 5) unlock('ruth5');
  if (s.companion && s.companion.dog && s.companion.dog.owned) unlock('duke');
  if ((s.jobsDone || 0) >= 25) unlock('jobs25');
  if ((s.stats.level || 1) >= 10) unlock('level10');
  if ((s.skills || []).length >= 10) unlock('skills10');
  if ((s.money || 0) >= 1500) unlock('rich');
  const o = Object.values((s.home && s.home.openings) || {});
  if (o.length && o.every((x) => (x.kind === 'door' ? x.reinforced : x.boards || x.shutters))) unlock('fortress');
}

let checkT = 0;
export function updateAchievements(dt) {
  checkT -= dt;
  if (checkT > 0) return;
  checkT = 2;
  checkSave();
}

export function initAchievementEvents() {
  const ev = G.events;
  ev.on('enemyKilled', (e) => {
    if (G.endless || (e.def && (e.def.vehicle || e.def.dog))) return;
    const n = bump('kills');
    if (n >= 50) unlock('kills50');
    if (n >= 300) unlock('kills300');
  });
  ev.on('trapSprung', () => unlock('trap'));
  ev.on('fishCaught', () => { if (bump('fish') >= 10) unlock('fish10'); });
  ev.on('treeChopped', () => { if (bump('trees') >= 50) unlock('trees50'); });
  ev.on('cropPicked', (n) => { if (bump('crops', Number(n) || 1) >= 20) unlock('crops20'); });
  const favor = () => { if (bump('favors') >= 15) unlock('neighbor'); };
  ev.on('questDone', favor);
  ev.on('errandDone', favor);
  ev.on('dailyPosted', () => unlock('daily'));
  ev.on('endlessWave', (wave) => {
    if (wave >= 5) unlock('wave5');
    if (wave >= 10) unlock('wave10');
    if (wave >= 20) unlock('wave20');
  });
}
