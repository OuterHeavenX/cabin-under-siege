// Difficulty modes. Chosen at New Game and changeable any time in Settings.
import { G } from './state.js';

export const DIFFICULTY = {
  story: { name: 'Story', dmg: 0.6, hp: 0.8, raid: 0.6, loss: 0.1, desc: 'Attackers hit softer and fall faster, raids are rarer, defeat costs little. For the story.' },
  normal: { name: 'Normal', dmg: 1, hp: 1, raid: 1, loss: 0.2, desc: 'The intended experience: every night matters.' },
  hard: { name: 'Hard', dmg: 1.3, hp: 1.2, raid: 1.25, loss: 0.35, desc: 'Tougher attackers who hit harder, more frequent raids, costly defeats.' },
};

export function diff() {
  return DIFFICULTY[(G.s && G.s.difficulty) || 'normal'] || DIFFICULTY.normal;
}

/** Low-detail rendering: chosen in Settings, or switched on automatically on slow devices. */
export function lowQuality() {
  const q = G.settings && G.settings.quality;
  return q === 'low' || (q !== 'high' && G.autoLow);
}
