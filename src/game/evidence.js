// Evidence: the cross-chapter Paper Trail (see data/evidence.js) and the
// "connect the dots" deduction once Frank has enough pieces.
import { G } from './state.js';
import { addJP, addRel, addXP } from './progression.js';
import { playDialogue } from '../ui/dialogue.js';
import { banner, toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { TRAIL, TRAIL_NEED, THEORIES, WRONG_LINES, SOLVED_LINES } from '../data/evidence.js';

const L = () => G.s.life;

export function hasEvidence(id) { return !!(G.s && G.s.life && G.s.life.evidence[id]); }

/** Add a piece of the Paper Trail (quietly if it came with its own dialogue). */
export function addEvidence(id, quiet = false) {
  if (!TRAIL[id] || !G.s || G.endless || G.prequel || hasEvidence(id)) return false;
  L().evidence[id] = G.s.time.day;
  L().guessLock = false; // a new piece means Frank can think it over again
  sfx('chime');
  banner(`📎 Paper Trail: ${TRAIL[id].title}`, 'objective', 5);
  if (!quiet) toast(TRAIL[id].text, 'info', 6);
  addXP(10, 'Evidence');
  addJP('shadow', 4);
  const n = trailCount();
  if (n === TRAIL_NEED && !L().deduced) setTimeout(() => toast('You have enough pieces to work out how they keep finding you. (Journal → Cases → Connect the dots)', 'info', 6), 1200);
  G.events.emit('evidence', id);
  saveGame('evidence');
  return true;
}

export const trailCount = () => Object.keys((G.s.life || {}).evidence || {}).filter((k) => TRAIL[k]).length;

/** Can Frank try to put it together right now? */
export function canDeduce() {
  const l = L();
  if (l.deduced === 'title') return 'solved';
  if (trailCount() < TRAIL_NEED) return `Find ${TRAIL_NEED - trailCount()} more piece${TRAIL_NEED - trailCount() === 1 ? '' : 's'} of the Paper Trail first.`;
  if (l.guessLock) return 'You need a new piece of evidence before you can rethink it.';
  return null;
}

/** The deduction itself, offered from the Journal. */
export function connectTheDots() {
  if (canDeduce()) return false;
  const ruthHere = G.s.companion && G.s.companion.ruth && G.s.companion.ruth.joined;
  const opts = THEORIES.filter((t) => t.id !== 'ruth' || ruthHere);
  let pick = null;
  playDialogue([
    { who: 'Frank', text: '(You spread every scrap on the kitchen table: envelopes, printouts, a matchbook, a fax.)' },
    { who: 'Frank', text: 'Five homes in five states. Different names on the mailbox, different plates. How do they keep finding me?', choices: opts.map((t) => ({ text: t.text, effect: () => { pick = t; return []; } })) },
  ], () => { if (pick) settle(pick); });
  return true;
}

function settle(t) {
  const l = L();
  if (!t.right) {
    l.wrongGuesses.push(t.id);
    l.guessLock = true;
    playDialogue(WRONG_LINES[t.id] || [], () => {
      if (t.who && G.s.rel[t.who] != null) G.s.rel[t.who] = Math.max(0, G.s.rel[t.who] - 15);
      sfx('miss');
      banner(t.who ? 'That cost you a friend\'s trust. Find another piece before you try again.' : 'A dead end. Find another piece before you try again.', 'warn', 5);
      saveGame('deduce');
    });
    return;
  }
  l.deduced = 'title';
  l.deducedCh = G.s.chapter;
  playDialogue(SOLVED_LINES(G.s), () => {
    addXP(120, 'The Paper Trail');
    addJP('shadow', 20);
    sfx('victory');
    const fed = (G.s.choices || {}).reyes === 'give' || (G.s.choices || {}).reyes === 'copy';
    banner(fed ? 'Solved. Agent Reyes can do something with a title company — the family loses its eyes on you.' : 'Solved. Leo\'s people lose their easiest way to find you. Their next attack is less sure of itself.', 'good', 7);
    G.events.emit('trailSolved');
    saveGame('deduce');
  });
}

/** For the Journal. */
export function trailBoard() {
  const l = (G.s && G.s.life) || {};
  const found = Object.entries(TRAIL).filter(([id]) => l.evidence && l.evidence[id]).map(([id, t]) => ({ id, ...t, day: l.evidence[id] }));
  return { found, need: TRAIL_NEED, total: Object.keys(TRAIL).length, solved: l.deduced === 'title', wrong: l.wrongGuesses || [], status: canDeduce() };
}

export const trailSolved = () => !!(G.s && G.s.life && G.s.life.deduced === 'title');
