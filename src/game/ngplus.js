// New Game+: after the finale, start over in Pine Hollow as the man you became.
// Level, attributes, skills, money, weapons and gear (and Duke) carry over;
// friendships and the story start fresh. Every cycle the family hits harder,
// and how the last story ended changes this one.
import { newSave } from './state.js';
import { deepClone } from '../util.js';

const STORY_ITEMS = ['note', 'burner', 'ledger', 'signet', 'blueprint', 'study_key'];

export const NG_TWISTS = {
  justice: {
    title: 'Witness Protection',
    perk: 'Agent Reyes set you up: a tripwire alarm, two first-aid kits, and fewer raids.',
    mods: { raid: 0.85 },
    gifts: { alarm_kit: 1, medkit: 2 },
    intro: [
      { who: '', text: 'Six months after the trial. The U.S. Marshals called it witness protection.' },
      { who: 'Agent Dana Reyes', text: 'New name, new county, nobody knows you. Pine Hollow. Population 212. You\'ll be bored out of your mind.' },
      { who: 'You', text: 'Bored sounds good.' },
      { who: '', text: 'Leo is in a federal prison in Colorado. But Leo had cousins, and cousins have long memories.' },
    ],
  },
  walk: {
    title: 'Unfinished Business',
    perk: 'You walked out with what you could carry: an extra $500.',
    mods: {},
    money: 500,
    intro: [
      { who: '', text: 'You walked away from Leo Vescari and never looked back. A year later, you\'re still looking over your shoulder.' },
      { who: 'You', text: 'An old man in an empty house. That\'s what I left him. Turns out empty houses fill back up.' },
      { who: '', text: 'Pine Hollow again. Same cabin, same dirt road. Whoever runs the family now wants the job finished.' },
    ],
  },
  blood: {
    title: 'Blood for Blood',
    perk: 'The Vescari cousins want revenge — they hit harder. You kept Harold-style insurance: a hunting rifle and rounds.',
    mods: { dmg: 1.15 },
    gifts: { rifle: 1, rifle_ammo: 20 },
    intro: [
      { who: '', text: 'Everybody in North Jersey knows what happened in that study. Nobody says it out loud.' },
      { who: 'You', text: 'Leo had a lot of family. And every one of them remembers that shot.' },
      { who: '', text: 'You go back to the only place you ever felt like Frank Lowe. Pine Hollow. They\'ll find you there too.' },
    ],
  },
  crown: {
    title: 'Heavy Is the Head',
    perk: 'You ran the family for a year: $1,500, a shotgun — and every rival crew in three states wants your chair (more raids).',
    mods: { raid: 1.3 },
    money: 1500,
    gifts: { shotgun: 1, shells: 16 },
    intro: [
      { who: '', text: 'One year at the head of the table. One year of handshakes, envelopes and funerals.' },
      { who: 'You', text: 'I walked away from this life once. I can do it again. A cabin. A dirt road. Nobody.' },
      { who: '', text: 'But a man who wore the crown doesn\'t get to take it off quietly. The rival crews are coming for what\'s left of it.' },
    ],
  },
};

/** NG+ scaling layered on top of the difficulty setting. */
export function ngMods(s) {
  const n = Math.min(3, (s && s.ngPlus) || 0);
  if (!n) return null;
  const t = (NG_TWISTS[s.ngEnding] || {}).mods || {};
  return { dmg: (1 + 0.15 * n) * (t.dmg || 1), hp: 1 + 0.25 * n, raid: (1 + 0.1 * n) * (t.raid || 1) };
}

export const canNewGamePlus = (raw) => !!(raw && raw.story && raw.story.done && raw.story.done[5]);

/** Build the next cycle's save from a finished one. */
export function makeNewGamePlus(old) {
  const s = newSave();
  s.ngPlus = (old.ngPlus || 0) + 1;
  s.ngEnding = old.ending || 'walk';
  s.difficulty = old.difficulty || 'normal';
  s.stats = deepClone(old.stats);
  s.jp = deepClone(old.jp); s.jpEarned = deepClone(old.jpEarned);
  s.skills = [...(old.skills || [])];
  s.money = old.money || 0;
  s.weaponMods = deepClone(old.weaponMods || s.weaponMods);
  s.inv = {};
  for (const [k, v] of Object.entries(old.inv || {})) if (!STORY_ITEMS.includes(k) && v > 0) s.inv[k] = v;
  s.player.mags = deepClone(old.player.mags || s.player.mags);
  s.player.weapon = old.player.weapon || 'pistol';
  s.player.mag = s.player.mags[s.player.weapon] || 8;
  s.quick = old.quick || s.quick;
  if (old.companion && old.companion.dog && old.companion.dog.owned) s.companion.dog = { owned: true, name: old.companion.dog.name || 'Duke', hurtDay: -1 };
  s.endingsSeen = [...new Set([...(old.endingsSeen || []), old.ending].filter(Boolean))];
  // The car you restored is still your car.
  if (old.life && old.life.car && old.life.car.done) s.life.car = deepClone(old.life.car);
  const tw = NG_TWISTS[s.ngEnding];
  if (tw) {
    if (tw.money) s.money += tw.money;
    for (const [k, v] of Object.entries(tw.gifts || {})) s.inv[k] = (k === 'rifle' || k === 'shotgun') ? 1 : (s.inv[k] || 0) + v;
  }
  return s;
}
