// Cinematic beats: letterbox bars slide in, the camera drifts to a point of
// interest, an optional title card, then the conversation. Tap (or Esc) skips
// the drift; the game world is frozen throughout.
import { G } from '../game/state.js';
import { playDialogue } from './dialogue.js';
import { escapeHtml } from '../util.js';
import { sfx } from '../audio.js';

let el = null, card = null;

function ensureDom() {
  if (el) return;
  el = document.createElement('div');
  el.id = 'letterbox';
  el.className = 'letterbox';
  el.innerHTML = '<div class="lb-bar lb-top"></div><div class="lb-bar lb-bot"></div><div class="lb-card hidden"></div>';
  document.getElementById('app').appendChild(el);
  card = el.querySelector('.lb-card');
  el.addEventListener('pointerdown', (e) => { if (G.cutscene && G.cutscene.phase !== 'talk') { e.preventDefault(); skipCutscene(); } });
}

/**
 * focus: {x, y} world point; zoom: multiplier on the normal zoom;
 * title/sub: a title card; lines: dialogue played while the camera holds; onEnd.
 */
export function playCutscene({ focus, zoom = 1.25, title = '', sub = '', lines = null, hold = 1.6, onEnd = null, sting = 'warning' }) {
  ensureDom();
  if (G.cutscene) endCutscene(); // never stack two
  G.cutscene = { x: focus.x, y: focus.y, zoom, t: 0, phase: 'pan', title, sub, lines, hold, onEnd, prevModal: G.modal };
  G.modal = G.modal || 'cutscene';
  document.body.classList.add('cine');
  el.classList.add('on');
  if (sting) sfx(sting);
}

export function updateCutscene(dt) {
  const c = G.cutscene;
  if (!c) return;
  c.t += dt;
  if (c.phase === 'pan' && c.t > 1.1) {
    c.phase = 'card'; c.t = 0;
    if (c.title) {
      card.innerHTML = `<div class="lb-title">${escapeHtml(c.title)}</div>${c.sub ? `<div class="lb-sub">${escapeHtml(c.sub)}</div>` : ''}`;
      card.classList.remove('hidden', 'show'); void card.offsetWidth; card.classList.add('show');
    } else c.t = c.hold;
  }
  if (c.phase === 'card' && c.t >= c.hold) toTalk();
}

function toTalk() {
  const c = G.cutscene;
  if (!c || c.phase === 'talk' || c.phase === 'done') return;
  card.classList.add('hidden');
  c.phase = 'talk';
  if (G.modal === 'cutscene') G.modal = null;
  if (c.lines && c.lines.length) playDialogue(c.lines, endCutscene);
  else endCutscene();
}

export function skipCutscene() {
  const c = G.cutscene;
  if (!c) return;
  if (c.phase === 'pan' || c.phase === 'card') toTalk();
}

export function endCutscene() {
  const c = G.cutscene;
  if (!c) return;
  c.phase = 'done';
  G.cutscene = null;
  if (G.modal === 'cutscene') G.modal = null;
  document.body.classList.remove('cine');
  if (el) { el.classList.remove('on'); card.classList.add('hidden'); }
  if (c.onEnd) c.onEnd();
}

export function cutsceneActive() { return !!G.cutscene; }
