// The poker table screen. Cards are buttons, so touch, mouse and controller
// all work: pick up to three to throw away, draw, then bet, check or fold.
import { G } from '../game/state.js';
import { openModal, closeModal } from './menus.js';
import { escapeHtml } from '../util.js';
import { sfx } from '../audio.js';
import { toast } from './hud.js';
import { ANTE, BET, TABLES, newHand, drawCards, act, canSit, cardLabel, isRed, handName } from '../game/poker.js';
import { eventOn } from '../game/calendar.js';
import { advanceMinutes } from '../game/time.js';

const card = (c, i, sel, hidden) => hidden
  ? '<span class="pk-card back"></span>'
  : `<button class="pk-card ${isRed(c) ? 'red' : ''} ${sel ? 'sel' : ''}" ${i != null ? `data-card="${i}"` : 'disabled'}>${cardLabel(c)}</button>`;

export function openPoker() {
  if (!eventOn('poker')) { toast('No game tonight. Poker is Wednesday and Saturday, 7–11 PM.', 'warn', 3); return; }
  if (!canSit()) { toast(`You need at least $${ANTE + BET} to sit down.`, 'warn', 3); return; }
  const t = TABLES[G.s.chapter] || TABLES[1];
  const el = openModal('poker', '', { cls: 'wide poker' });
  const body = () => el.querySelector('.modal-body');
  let picked = new Set();
  let hands = 0;

  const render = () => {
    const h = G.poker;
    const opp = h.opp.map((o, oi) => {
      const show = h.phase === 'done' && !o.folded;
      const peek = oi === h.peek && h.phase !== 'done';
      return `<div class="pk-seat ${o.folded ? 'folded' : ''}"><div class="pk-name">${escapeHtml(o.name)}${o.folded ? ' · folds' : o.bet ? ` · bets $${o.bet}` : ''}${peek ? ' <span class="muted small">(you can read him)</span>' : ''}</div>
        <div class="pk-hand">${o.cards.map((c) => card(c, null, false, !(show || peek))).join('')}</div>${show ? `<div class="small muted">${escapeHtml(handName(o.cards))}</div>` : ''}</div>`;
    }).join('');
    let actions = '';
    if (h.phase === 'draw') actions = `<p class="small">Pick up to 3 cards to throw away, then draw.</p><div class="row-btns"><button class="btn primary" data-pk="draw">Draw ${picked.size || 'none'}</button><button class="btn" data-pk="leave">Leave the table</button></div>`;
    else if (h.phase === 'bet') {
      actions = h.facing
        ? `<p class="small">${escapeHtml(h.facing)} bets $${BET}.</p><div class="row-btns"><button class="btn primary" data-pk="call" ${G.s.money < BET ? 'disabled' : ''}>Call $${BET}</button><button class="btn" data-pk="fold">Fold</button></div>`
        : `<div class="row-btns"><button class="btn primary" data-pk="bet" ${G.s.money < BET ? 'disabled' : ''}>Bet $${BET}</button><button class="btn" data-pk="check">Check</button><button class="btn" data-pk="fold">Fold</button></div>`;
    } else {
      const r = h.result;
      actions = `<p class="pk-result ${r.youWon ? 'win' : ''}">${r.youWon ? `You take the pot: +$${r.share}` : `${escapeHtml(r.winners.join(' & '))} ${r.winners.length > 1 ? 'split' : 'takes'} the pot with ${escapeHtml(r.hand.toLowerCase())}.`}</p>
        ${r.gossip ? `<p class="pk-gossip"><b>${escapeHtml(r.gossip.who)}:</b> “${escapeHtml(r.gossip.text)}”</p>` : ''}
        <div class="row-btns"><button class="btn primary" data-pk="next" ${canSit() ? '' : 'disabled'}>Deal again ($${ANTE})</button><button class="btn" data-pk="leave">Cash out</button></div>`;
    }
    body().innerHTML = `<h2>🃏 Poker night</h2><p class="small muted">${escapeHtml(t.place)} · pot <b>$${h.pot}</b> · you have <b>$${G.s.money}</b></p>
      <div class="pk-table">${opp}</div>
      <div class="pk-you"><div class="pk-name">You${h.youFolded ? ' · fold' : ''} — <span class="muted">${escapeHtml(handName(h.you))}</span></div>
        <div class="pk-hand">${h.you.map((c, i) => card(c, h.phase === 'draw' ? i : null, picked.has(i))).join('')}</div></div>
      ${actions}`;
  };

  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-card]');
    if (c && G.poker.phase === 'draw') {
      const i = Number(c.dataset.card);
      if (picked.has(i)) picked.delete(i); else if (picked.size < 3) picked.add(i);
      sfx('ui'); render(); return;
    }
    const b = e.target.closest('[data-pk]');
    if (!b) return;
    sfx('blip');
    switch (b.dataset.pk) {
      case 'draw': drawCards([...picked]); picked = new Set(); break;
      case 'bet': case 'check': case 'call': case 'fold':
        act(b.dataset.pk); hands++; advanceMinutes(15);
        sfx(G.poker.result.youWon ? 'coin' : 'ui');
        break;
      case 'next': newHand(); break;
      case 'leave': G.poker = null; closeModal(); if (hands) toast(`You played ${hands} hand${hands === 1 ? '' : 's'}.`, 'info', 2.5); return;
      default: break;
    }
    if (!eventOn('poker') && G.poker && G.poker.phase === 'done') { G.poker = null; closeModal(); toast('Lou kills the lights. "Game\'s over, gents."', 'info', 3); return; }
    render();
  });
  newHand();
  render();
}
