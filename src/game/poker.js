// Poker night: five-card draw at the back table, $10 ante, one round of
// betting after the draw. The table talks between hands — gossip, grudges,
// and sometimes the thing you came to hear.
import { G } from './state.js';
import { choose } from '../util.js';
import { addMoney } from './progression.js';
import { hasPerk } from './perks.js';

export const ANTE = 10;
export const BET = 20;

/** Who sits at the table, per chapter. style: tight | loose | bluffer */
export const TABLES = {
  1: {
    place: 'the back table at the Pine Hollow Diner',
    players: [{ name: 'Mr. Henderson', style: 'loose' }, { name: 'Old Man Tibbs', style: 'tight' }, { name: 'Big Lou', style: 'bluffer' }],
    gossip: [
      ['Big Lou', 'Deer are thick on the north ridge this year. Henderson\'s too blind to hit one.'],
      ['Mr. Henderson', 'I\'m blind? Lou, you put ketchup on pie.'],
      ['Old Man Tibbs', 'Dee\'s been closing early Thursdays. Never used to.'],
      ['Big Lou', 'County fair\'s coming. The shooting gallery\'s rigged. Barrels bent like a dog\'s leg.'],
      ['Old Man Tibbs', 'Calloway cabin sat empty eleven years. Now there\'s a fella from back East in it. Funny old world.'],
      ['Mr. Henderson', 'Gus\'s big saw\'s been acting up. Man\'s too proud to ask for help.'],
      ['Big Lou', 'Somebody\'s been knocking over the mill\'s log piles at night. Kids, I bet.'],
      ['Old Man Tibbs', 'Ruth Calloway won\'t go in Harold\'s shed. Eleven years. Wonder what\'s in there.'],
    ],
  },
};

/** Extra lines the story can slip into the table talk (clues, storyline hints). */
export const gossipHooks = [];

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const cardLabel = (c) => `${RANKS[c.r] || c.r}${c.s}`;
export const isRed = (c) => c.s === '♥' || c.s === '♦';

function deck() {
  const d = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

/** [category, ...tiebreakers]: 8 straight flush … 0 high card. */
export function evaluate(cards) {
  const rs = cards.map((c) => c.r).sort((a, b) => b - a);
  const counts = {};
  for (const r of rs) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts).map(([r, n]) => [n, Number(r)]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const flush = cards.every((c) => c.s === cards[0].s);
  const uniq = [...new Set(rs)];
  let straight = uniq.length === 5 && rs[0] - rs[4] === 4;
  let high = rs[0];
  if (!straight && uniq.join() === '14,5,4,3,2') { straight = true; high = 5; }
  if (straight && flush) return [8, high];
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...rs];
  if (straight) return [4, high];
  if (groups[0][0] === 3) return [3, groups[0][1], ...rs.filter((r) => r !== groups[0][1])];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2) return [1, groups[0][1], ...rs.filter((r) => r !== groups[0][1])];
  return [0, ...rs];
}
export const HAND_NAMES = ['High card', 'A pair', 'Two pair', 'Three of a kind', 'A straight', 'A flush', 'A full house', 'Four of a kind', 'A straight flush'];
export const handName = (cards) => {
  const v = evaluate(cards);
  return v[0] === 1 ? `A pair of ${(RANKS[v[1]] || v[1])}s` : HAND_NAMES[v[0]];
};
function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
}
/** Rough 0..1 strength for the AI. */
function strength(cards) {
  const v = evaluate(cards);
  return Math.min(1, v[0] / 4 + (v[0] === 1 ? (v[1] - 2) / 60 : 0) + (v[0] === 0 ? (v[1] - 9) / 40 : 0));
}

/** Which cards an opponent throws away. */
function aiDiscards(cards) {
  const v = evaluate(cards);
  if (v[0] >= 4) return [];
  const counts = {};
  for (const c of cards) counts[c.r] = (counts[c.r] || 0) + 1;
  if (v[0] >= 1) return cards.map((c, i) => (counts[c.r] === 1 ? i : -1)).filter((i) => i >= 0).slice(0, 3);
  // Four to a flush: chase it.
  for (const s of SUITS) {
    const idx = cards.map((c, i) => (c.s === s ? -1 : i)).filter((i) => i >= 0);
    if (idx.length === 1) return idx;
  }
  // Keep the two highest.
  const order = cards.map((c, i) => [c.r, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  return order.slice(0, 3);
}

export function canSit() { return G.s.money >= ANTE + BET; }

/** Start a new hand. */
export function newHand() {
  const t = TABLES[G.s.chapter] || TABLES[1];
  const d = deck();
  const hand = {
    deck: d,
    you: d.splice(0, 5),
    opp: t.players.map((pl) => ({ ...pl, cards: d.splice(0, 5), folded: false, bet: 0 })),
    pot: 0, phase: 'draw', youFolded: false, youBet: 0, result: null,
    peek: hasPerk('card_sharp') ? Math.floor(Math.random() * t.players.length) : -1,
  };
  addMoney(-ANTE, null);
  hand.pot = ANTE * (t.players.length + 1);
  G.poker = hand;
  return hand;
}

export function drawCards(discardIdx) {
  const h = G.poker;
  for (const i of discardIdx.slice(0, 3)) h.you[i] = h.deck.pop();
  for (const o of h.opp) for (const i of aiDiscards(o.cards)) o.cards[i] = h.deck.pop();
  h.phase = 'bet';
  // A strong opponent may open the betting.
  const opener = h.opp.find((o) => strength(o.cards) >= 0.5 || (o.style === 'bluffer' && Math.random() < 0.22));
  h.facing = opener ? opener.name : null;
  if (opener) { opener.bet = BET; h.pot += BET; }
  return h;
}

/** Your move: 'check' | 'bet' | 'call' | 'fold'. Opponents answer, then showdown. */
export function act(move) {
  const h = G.poker;
  if (move === 'fold') { h.youFolded = true; return showdown(); }
  if (move === 'bet' || move === 'call') { addMoney(-BET, null); h.youBet = BET; h.pot += BET; }
  for (const o of h.opp) {
    if (o.bet) continue;
    const s = strength(o.cards);
    const wants = h.youBet || h.facing;
    if (!wants) continue;
    const need = o.style === 'tight' ? 0.3 : o.style === 'loose' ? 0.08 : 0.18;
    if (s >= need || (o.style === 'bluffer' && Math.random() < 0.2)) { o.bet = BET; h.pot += BET; } else o.folded = true;
  }
  return showdown();
}

function showdown() {
  const h = G.poker;
  h.phase = 'done';
  const live = h.opp.filter((o) => !o.folded).map((o) => ({ name: o.name, v: evaluate(o.cards), cards: o.cards }));
  if (!h.youFolded) live.push({ name: 'You', v: evaluate(h.you), cards: h.you });
  live.sort((a, b) => compare(b.v, a.v));
  const winners = live.filter((x) => compare(x.v, live[0].v) === 0);
  const share = Math.floor(h.pot / winners.length);
  const youWon = winners.some((w) => w.name === 'You');
  if (youWon) addMoney(share, null);
  h.result = { winners: winners.map((w) => w.name), hand: HAND_NAMES[live[0].v[0]], youWon, share, gossip: tableTalk(h) };
  G.events.emit('pokerHand', h.result);
  if (youWon) G.events.emit('pokerWon', share);
  return h;
}

function tableTalk(h) {
  for (const f of gossipHooks) { const l = f(h); if (l) return l; }
  const t = TABLES[G.s.chapter] || TABLES[1];
  const [who, text] = choose(t.gossip);
  return { who, text };
}
