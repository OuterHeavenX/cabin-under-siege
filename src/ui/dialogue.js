// Phone-friendly dialogue: tap to advance, Skip to jump ahead, choices as big buttons.
import { G } from '../game/state.js';
import { escapeHtml } from '../util.js';
import { sfx } from '../audio.js';
import { consume } from '../input.js';
import { portraitFor } from './portraits.js';

const queue = [];
let cur = null; // {lines, idx, onEnd}
let el, whoEl, textEl, choicesEl, skipBtn, portraitEl;
let typeT = 0;
let fullText = '';
let shown = 0;

export function initDialogue() {
  el = document.getElementById('dialogue');
  whoEl = document.getElementById('dlg-who');
  textEl = document.getElementById('dlg-text');
  choicesEl = document.getElementById('dlg-choices');
  skipBtn = document.getElementById('dlg-skip');
  portraitEl = document.getElementById('dlg-portrait');
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    advance();
  });
  skipBtn.addEventListener('click', (e) => { e.stopPropagation(); skip(); });
}

export function dialogueActive() { return !!cur; }

export function playDialogue(lines, onEnd) {
  if (!lines || !lines.length) { if (onEnd) onEnd(); return; }
  queue.push({ lines: [...lines], idx: 0, onEnd });
  if (!cur) next();
}

function next() {
  cur = queue.shift() || null;
  if (!cur) {
    el.classList.add('hidden');
    if (G.modal === 'dialogue') G.modal = null;
    return;
  }
  G.modal = 'dialogue';
  el.classList.remove('hidden');
  show();
}

function show() {
  const line = cur.lines[cur.idx];
  whoEl.textContent = line.who || '';
  whoEl.classList.toggle('hidden', !line.who);
  const pic = portraitFor(line.who);
  portraitEl.classList.toggle('hidden', !pic);
  if (pic && portraitEl.getAttribute('src') !== pic) portraitEl.src = pic;
  fullText = line.text;
  shown = 0;
  typeT = 0;
  textEl.textContent = '';
  choicesEl.innerHTML = '';
  choicesEl.classList.add('hidden');
  skipBtn.classList.toggle('hidden', !!line.choices);
  sfx('ui');
}

function renderChoices(line) {
  choicesEl.innerHTML = '';
  choicesEl.classList.remove('hidden');
  line.choices.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'choice';
    b.innerHTML = escapeHtml(c.text);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx('blip');
      const extra = c.effect ? c.effect() : null;
      if (Array.isArray(extra) && extra.length) cur.lines.splice(cur.idx + 1, 0, ...extra);
      line.choices = null;
      step();
    });
    choicesEl.appendChild(b);
  });
}

function step() {
  cur.idx++;
  if (cur.idx >= cur.lines.length) finish();
  else show();
}

function finish() {
  const done = cur.onEnd;
  cur = null;
  el.classList.add('hidden');
  if (G.modal === 'dialogue') G.modal = null;
  if (done) done();
  if (!cur && queue.length) next();
}

export function advance() {
  if (!cur) return;
  const line = cur.lines[cur.idx];
  if (shown < fullText.length) { shown = fullText.length; textEl.textContent = fullText; if (line.choices) renderChoices(line); return; }
  if (line.choices) return; // must pick
  step();
}

/** Skip to the next choice or the end of this conversation. */
function skip() {
  if (!cur) return;
  while (cur && cur.idx < cur.lines.length) {
    const line = cur.lines[cur.idx];
    if (line.choices) {
      fullText = line.text; shown = fullText.length; textEl.textContent = line.text;
      whoEl.textContent = line.who || ''; whoEl.classList.toggle('hidden', !line.who);
      skipBtn.classList.add('hidden');
      renderChoices(line);
      return;
    }
    cur.idx++;
  }
  finish();
}

export function updateDialogue(dt) {
  if (!cur) return;
  if (consume('advance') || consume('interact')) advance();
  if (shown < fullText.length) {
    typeT += dt;
    const n = Math.min(fullText.length, Math.floor(typeT * 70));
    if (n !== shown) {
      shown = n;
      textEl.textContent = fullText.slice(0, shown);
      if (shown >= fullText.length) {
        const line = cur.lines[cur.idx];
        if (line.choices) renderChoices(line);
      }
    }
  }
}
