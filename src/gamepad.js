// Controllers: Steam Deck, Xbox, PlayStation and anything else the browser
// reports with the "standard" layout. In play the sticks move and aim and the
// buttons map onto the same actions as the keyboard; whenever a menu, the
// title screen or a conversation is up, the D-pad / left stick moves a
// highlight between buttons, A presses, B backs out, LB/RB flip tabs.
import { G } from './game/state.js';
import { input, press, setPadMode } from './input.js';
import { topModal } from './ui/menus.js';
import { sfx } from './audio.js';

export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEAD = 0.22;

let prev = [];
let lastPad = null;
let own = { fire: false, sprint: false, aim: false, move: false };
let sprintLatch = false;
let nav = { dir: null, t: 0 };
let focused = null, focusKey = null, focusRect = null;

/** First connected controller (tests can inject one as window.__fakePad). */
function readPad() {
  if (window.__fakePad) return window.__fakePad;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let best = null;
  for (const p of pads) if (p && p.connected) { if (p.mapping === 'standard') return p; best = best || p; }
  return best;
}

const stick = (x, y) => {
  const m = Math.hypot(x, y);
  if (m < DEAD) return { x: 0, y: 0, m: 0 };
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return { x: x * k, y: y * k, m: Math.min(1, (m - DEAD) / (1 - DEAD)) };
};

/** Which layer the controller talks to right now. */
function uiLayer() {
  const dlg = document.getElementById('dialogue');
  if (dlg && !dlg.classList.contains('hidden')) return { kind: 'dialogue', el: dlg };
  const top = topModal();
  if (top) return { kind: 'modal', el: top.el, name: top.name };
  const title = document.getElementById('title');
  if (title && !title.classList.contains('hidden')) return { kind: 'title', el: title };
  if (G.cutscene) return { kind: 'cutscene' };
  return null;
}

export function updateGamepad(dt) {
  const gp = readPad();
  if (!gp) { releaseGame(); prev = []; lastPad = null; return; }
  lastPad = gp;
  const now = gp.buttons.map((b) => !!b && (b.pressed || b.value > 0.5));
  const down = (i) => now[i] && !prev[i];
  const val = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
  const ax = (i) => gp.axes[i] || 0;
  const L = stick(ax(0), ax(1)), R = stick(ax(2), ax(3));
  const any = now.some(Boolean) || L.m > 0 || R.m > 0;
  if (any && !input.padMode) setPadMode(true);

  const ui = uiLayer();
  if (ui && ui.kind !== 'cutscene') {
    releaseGame();
    navigateUi(ui, { now, down, L, R, dt });
  } else {
    clearFocus();
    if (ui && ui.kind === 'cutscene') {
      if (down(BTN.A) || down(BTN.MENU) || down(BTN.B)) press('advance');
    } else if (G.running) play({ now, down, val, L, R });
  }
  prev = now;
}

/* ---------------- gameplay ---------------- */
function play({ now, down, val, L, R }) {
  // Move
  input.padMove = L.m > 0 ? { x: L.x, y: L.y } : null;
  own.move = L.m > 0;
  // Aim with the right stick; without it, aim assist and movement direction take over.
  if (R.m > 0.08) {
    input.aim.active = true; input.aim.source = 'stick'; input.aim.mag = R.m;
    input.aim.angle = Math.atan2(R.y, R.x);
    own.aim = true;
  } else if (own.aim) {
    input.aim.active = false; input.aim.source = null; input.aim.mag = 0; own.aim = false;
  }
  // Fire (RT, analog)
  const rt = val(BTN.RT) > 0.35;
  if (rt && !own.fire) press('fireClick');
  if (rt) { input.held.fire = true; own.fire = true; } else if (own.fire) { input.held.fire = false; own.fire = false; }
  // Sprint: hold LT, or click the left stick (stays on until you stop)
  if (down(BTN.LS)) sprintLatch = !sprintLatch;
  if (L.m === 0) sprintLatch = false;
  const sp = val(BTN.LT) > 0.35 || sprintLatch;
  if (sp) { input.held.sprint = true; own.sprint = true; } else if (own.sprint) { input.held.sprint = false; own.sprint = false; }
  // Buttons
  if (down(BTN.A)) { press('interact'); press('advance'); }
  if (down(BTN.B)) press('dodge');
  if (down(BTN.X)) press('reload');
  if (down(BTN.Y)) press('swap');
  if (down(BTN.LB)) press('use');
  if (down(BTN.RB)) press('melee');
  if (down(BTN.MENU)) press('pause');
  if (down(BTN.VIEW)) press('journal');
  if (down(BTN.UP)) press('map');
  if (down(BTN.DOWN)) press('inv');
  if (down(BTN.LEFT)) press('home');
  if (down(BTN.RIGHT)) press('char');
}

function releaseGame() {
  input.padMove = null;
  if (own.fire) { input.held.fire = false; own.fire = false; }
  if (own.sprint) { input.held.sprint = false; own.sprint = false; }
  if (own.aim) { input.aim.active = false; input.aim.source = null; input.aim.mag = 0; own.aim = false; }
  sprintLatch = false;
}

/* ---------------- menus, title, dialogue ---------------- */
const FOCUSABLE = 'button, select, input, [data-tab], a[href]';

function visible(el) {
  if (el.disabled || el.closest('.hidden') || el.closest('#touch')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2;
}

function candidates(ui) {
  let list = [...ui.el.querySelectorAll(FOCUSABLE)].filter(visible);
  if (ui.kind === 'dialogue') list = list.filter((b) => b.classList.contains('choice'));
  return list;
}

const keyOf = (el) => `${el.tagName}|${[...el.attributes].filter((a) => a.name.startsWith('data-') || a.name === 'id').map((a) => a.name + '=' + a.value).join(',')}|${(el.textContent || '').trim().slice(0, 40)}`;

function setFocus(el) {
  if (focused === el) return;
  if (focused) focused.classList.remove('pad-focus');
  focused = el;
  if (!el) { focusKey = null; return; }
  el.classList.add('pad-focus');
  focusKey = keyOf(el);
  focusRect = el.getBoundingClientRect();
  try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function clearFocus() { if (focused) focused.classList.remove('pad-focus'); focused = null; focusKey = null; focusRect = null; }

/** Keep the highlight when a menu redraws itself (buying an item, switching tab). */
function ensureFocus(ui, list) {
  if (focused && focused.isConnected && list.includes(focused)) return;
  if (focused && focusKey) {
    const same = list.find((el) => keyOf(el) === focusKey);
    if (same) { focused = null; setFocus(same); return; }
    if (focusRect && list.length) {
      const cx = focusRect.left + focusRect.width / 2, cy = focusRect.top + focusRect.height / 2;
      let best = null, bd = Infinity;
      for (const el of list) { const r = el.getBoundingClientRect(); const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy); if (d < bd) { bd = d; best = el; } }
      if (best && bd < 220) { focused = null; setFocus(best); return; }
    }
  }
  focused = null;
  const pick = list.find((el) => el.classList.contains('primary') && !el.classList.contains('hidden'))
    || list.find((el) => !el.classList.contains('close-btn') && !el.classList.contains('tab'))
    || list.find((el) => el.classList.contains('tab') && el.classList.contains('on'))
    || list[0] || null;
  setFocus(pick);
}

function moveFocus(ui, list, dx, dy) {
  if (!focused) return;
  const a = focused.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bs = Infinity;
  for (const el of list) {
    if (el === focused) continue;
    const r = el.getBoundingClientRect();
    const bx = r.left + r.width / 2, by = r.top + r.height / 2;
    const vx = bx - ax, vy = by - ay;
    const along = vx * dx + vy * dy;
    if (along <= 4) continue;
    const across = Math.abs(vx * dy - vy * dx);
    // Rows of buttons overlapping in the other axis are "straight ahead".
    const overlap = dx ? (r.bottom > a.top && r.top < a.bottom) : (r.right > a.left && r.left < a.right);
    const s = along + across * (overlap ? 0.3 : 2.5);
    if (s < bs) { bs = s; best = el; }
  }
  if (best) { setFocus(best); sfx('ui'); return; }
  // Nothing further that way: scroll long pages instead.
  if (dy) { const sc = ui.el.querySelector('.scrollable'); if (sc) sc.scrollTop += dy * 140; }
}

function adjust(el, dir) {
  if (el.tagName === 'SELECT') {
    const n = el.options.length;
    el.selectedIndex = (el.selectedIndex + dir + n) % n;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    sfx('ui');
    return true;
  }
  if (el.tagName === 'INPUT' && el.type === 'range') {
    const step = (Number(el.max) - Number(el.min)) / 20 || 1;
    el.value = String(Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + dir * step)));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

function navigateUi(ui, { now, down, L, R, dt }) {
  const list = candidates(ui);
  // Conversations without choices: A continues, Y skips ahead.
  if (ui.kind === 'dialogue' && !list.length) {
    clearFocus();
    if (down(BTN.A) || down(BTN.B)) press('advance');
    if (down(BTN.Y)) document.getElementById('dlg-skip')?.click();
    return;
  }
  // Repair / fishing mini-games: A is the action button.
  if (ui.kind === 'modal' && (ui.name === 'repair' || ui.name === 'fishing') && G.repairGameHit) {
    if (down(BTN.A)) press('interact');
    if (down(BTN.B)) ui.el.querySelector('[data-close]')?.click();
    return;
  }
  ensureFocus(ui, list);
  // Direction with auto-repeat (D-pad or left stick)
  let dir = null;
  if (now[BTN.UP] || L.y < -0.6) dir = 'up';
  else if (now[BTN.DOWN] || L.y > 0.6) dir = 'down';
  else if (now[BTN.LEFT] || L.x < -0.6) dir = 'left';
  else if (now[BTN.RIGHT] || L.x > 0.6) dir = 'right';
  let fire = false;
  if (dir !== nav.dir) { nav.dir = dir; nav.t = 0.38; fire = !!dir; } else if (dir) { nav.t -= dt; if (nav.t <= 0) { nav.t = 0.11; fire = true; } }
  if (fire && focused) {
    const horiz = dir === 'left' || dir === 'right';
    const isRange = focused.tagName === 'INPUT' && focused.type === 'range';
    if (horiz && (focused.tagName === 'SELECT' || isRange)) adjust(focused, dir === 'left' ? -1 : 1);
    else moveFocus(ui, list, dir === 'left' ? -1 : dir === 'right' ? 1 : 0, dir === 'up' ? -1 : dir === 'down' ? 1 : 0);
  }
  // Right stick scrolls long pages
  if (Math.abs(R.y) > 0) {
    const sc = ui.el.querySelector('.scrollable') || ui.el;
    sc.scrollTop += R.y * 900 * dt;
  }
  // Tabs
  if (down(BTN.LB) || down(BTN.RB)) {
    const tabs = [...ui.el.querySelectorAll('.tab')].filter(visible);
    if (tabs.length) {
      const i = Math.max(0, tabs.findIndex((t) => t.classList.contains('on')));
      tabs[(i + (down(BTN.RB) ? 1 : -1) + tabs.length) % tabs.length].click();
      focused = null; focusKey = null;
      sfx('ui');
    }
  }
  if (down(BTN.A) && focused) {
    if (focused.tagName === 'SELECT') adjust(focused, 1);
    else if (focused.tagName === 'INPUT' && focused.type === 'range') { /* left/right adjusts */ }
    else focused.click();
  }
  if (down(BTN.B) || (down(BTN.MENU) && ui.kind === 'modal' && ui.name === 'menu')) {
    const close = ui.kind === 'modal' && ui.el.querySelector('[data-close]');
    if (close) { close.click(); clearFocus(); }
  }
}

/** Controller vibration (Steam Deck, Xbox, DualSense...). Strengths 0..1. */
export function rumble(strong, weak = strong, ms = 120) {
  if (!G.settings.rumble || !input.padMode) return;
  const a = lastPad && lastPad.vibrationActuator;
  if (window.__fakePad) window.__fakePad.lastRumble = { strong, weak, ms };
  if (!a || !a.playEffect) return;
  a.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
}

/** Unit-testable entry for the smoke test. */
export function padFocus() { return focused; }
