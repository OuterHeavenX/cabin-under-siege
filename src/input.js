// Unified input: keyboard + mouse on desktop, multi-touch virtual controls on
// phones/tablets. Each touch control tracks its own pointerId so fingers on
// different controls never interfere with each other.
import { G } from './game/state.js';

export const input = {
  move: { x: 0, y: 0 },
  aim: { active: false, angle: 0, mag: 0, source: null },
  mouse: { x: 0, y: 0, inside: false, moved: false },
  held: { fire: false, sprint: false },
  pressed: new Set(),
  touchMode: false,
  keys: new Set(),
};

const KEYMAP = {
  KeyE: 'interact', Enter: 'interact', KeyR: 'reload', KeyQ: 'use', KeyF: 'melee', Space: 'dodge',
  Digit1: 'weapon1', Digit2: 'weapon2', Digit3: 'weapon3', Tab: 'swap',
  Escape: 'pause', KeyP: 'pause', KeyI: 'inv', KeyC: 'char', KeyK: 'skills', KeyM: 'map', KeyJ: 'journal', KeyH: 'help', KeyV: 'home',
};

export function press(action) { input.pressed.add(action); }

// A touch button acts on finger-down; swallow the browser's trailing click so it
// can't hit whatever modal that action just opened underneath the finger.
let suppressClickUntil = 0;
export function suppressGhostClick() { suppressClickUntil = performance.now() + 400; }
window.addEventListener('click', (e) => {
  if (performance.now() < suppressClickUntil && e.target.closest && e.target.closest('#modal-root')) { e.stopPropagation(); e.preventDefault(); }
}, true);
export function consume(action) {
  if (input.pressed.has(action)) { input.pressed.delete(action); return true; }
  return false;
}
export function endFrame() { input.pressed.clear(); }

function keyMove() {
  const k = input.keys;
  let x = 0, y = 0;
  if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
  if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
  if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
  return { x, y };
}

let joy = { id: null, cx: 0, cy: 0, x: 0, y: 0 };
let aimTouch = { id: null };

export function readMove() {
  if (joy.id !== null) return { x: joy.x, y: joy.y };
  const m = keyMove();
  const l = Math.hypot(m.x, m.y);
  return l > 0 ? { x: m.x / l, y: m.y / l } : m;
}

export function setTouchMode(on) {
  input.touchMode = on;
  document.body.classList.toggle('touch', on);
  const el = document.getElementById('touch');
  if (el) el.classList.toggle('hidden', !on || !G.running);
}

export function initInput(canvas) {
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (!e.repeat) {
      const a = KEYMAP[e.code];
      if (a) press(a);
      if (e.code === 'Space' || e.code === 'Enter') press('advance');
    }
    input.keys.add(e.code);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.held.sprint = true;
    if (G.settings.touchControls === 'auto' && input.touchMode) setTouchMode(false);
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.held.sprint = false;
  });
  window.addEventListener('blur', () => { input.keys.clear(); input.held.fire = false; input.held.sprint = false; releaseTouches(); });

  // Mouse on the canvas
  canvas.addEventListener('mousemove', (e) => {
    input.mouse.x = e.clientX; input.mouse.y = e.clientY; input.mouse.inside = true; input.mouse.moved = true;
  });
  canvas.addEventListener('mouseleave', () => { input.mouse.inside = false; });
  canvas.addEventListener('mousedown', (e) => {
    if (input.touchMode) return;
    if (e.button === 0) { input.held.fire = true; press('fireClick'); }
    if (e.button === 2) press('melee');
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) input.held.fire = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let wheelT = 0;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = performance.now();
    if (now - wheelT > 180 && Math.abs(e.deltaY) > 4) { wheelT = now; press('swap'); }
  }, { passive: false });

  // Switch into touch mode automatically when a finger is used.
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && G.settings.touchControls === 'auto' && !input.touchMode) setTouchMode(true);
  }, { capture: true });

  // Block browser gestures that would scroll/zoom the page during play.
  const stop = (e) => { e.preventDefault(); };
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!e.target.closest || !e.target.closest('.scrollable')) e.preventDefault();
  }, { passive: false });

  initTouchControls();
}

function releaseTouches() {
  joy.id = null; joy.x = 0; joy.y = 0;
  aimTouch.id = null; input.aim.active = false; input.aim.source = null;
  input.held.fire = false;
  const base = document.getElementById('joy-base');
  if (base) base.classList.remove('active');
}

function initTouchControls() {
  const zone = document.getElementById('joy-zone');
  const base = document.getElementById('joy-base');
  const knob = document.getElementById('joy-knob');
  const R = 52;

  zone.addEventListener('pointerdown', (e) => {
    if (joy.id !== null) return;
    e.preventDefault();
    joy.id = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    const rect = zone.getBoundingClientRect();
    joy.cx = e.clientX; joy.cy = e.clientY;
    base.style.left = `${e.clientX - rect.left}px`;
    base.style.top = `${e.clientY - rect.top}px`;
    base.classList.add('active');
    knob.style.transform = 'translate(-50%, -50%)';
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== joy.id) return;
    e.preventDefault();
    let dx = e.clientX - joy.cx, dy = e.clientY - joy.cy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
    const m = Math.min(1, l / R);
    if (m < 0.15) { joy.x = 0; joy.y = 0; } else { joy.x = (dx / R); joy.y = (dy / R); }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  });
  const joyEnd = (e) => {
    if (e.pointerId !== joy.id) return;
    joy.id = null; joy.x = 0; joy.y = 0;
    base.classList.remove('active');
    knob.style.transform = 'translate(-50%, -50%)';
  };
  zone.addEventListener('pointerup', joyEnd);
  zone.addEventListener('pointercancel', joyEnd);
  zone.addEventListener('lostpointercapture', joyEnd);

  // Aim stick
  const aimZone = document.getElementById('aim-zone');
  const aimKnob = document.getElementById('aim-knob');
  const AR = 50;
  const aimUpdate = (e) => {
    const rect = aimZone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const l = Math.hypot(dx, dy);
    if (l > AR) { dx = (dx / l) * AR; dy = (dy / l) * AR; }
    const m = Math.min(1, l / AR);
    input.aim.mag = m;
    if (m > 0.22) {
      input.aim.active = true;
      input.aim.source = 'stick';
      input.aim.angle = Math.atan2(dy, dx);
    }
    input.held.fire = G.settings.fireWhileAiming && m > 0.65;
    aimKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  aimZone.addEventListener('pointerdown', (e) => {
    if (aimTouch.id !== null) return;
    e.preventDefault();
    aimTouch.id = e.pointerId;
    aimZone.setPointerCapture(e.pointerId);
    aimZone.classList.add('active');
    aimUpdate(e);
  });
  aimZone.addEventListener('pointermove', (e) => { if (e.pointerId === aimTouch.id) { e.preventDefault(); aimUpdate(e); } });
  const aimEnd = (e) => {
    if (e.pointerId !== aimTouch.id) return;
    aimTouch.id = null;
    input.aim.active = false; input.aim.mag = 0; input.aim.source = null;
    if (!fireBtnHeld) input.held.fire = false;
    aimZone.classList.remove('active');
    aimKnob.style.transform = 'translate(-50%, -50%)';
  };
  aimZone.addEventListener('pointerup', aimEnd);
  aimZone.addEventListener('pointercancel', aimEnd);
  aimZone.addEventListener('lostpointercapture', aimEnd);

  // Buttons
  let fireBtnHeld = false;
  const fireBtn = document.getElementById('btn-fire');
  let fireId = null;
  fireBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); fireId = e.pointerId; fireBtn.setPointerCapture(e.pointerId);
    fireBtnHeld = true; input.held.fire = true; press('fireClick'); fireBtn.classList.add('down');
  });
  const fireUp = (e) => {
    if (e.pointerId !== fireId) return;
    fireId = null; fireBtnHeld = false; fireBtn.classList.remove('down');
    if (aimTouch.id === null || !G.settings.fireWhileAiming || input.aim.mag <= 0.65) input.held.fire = false;
  };
  fireBtn.addEventListener('pointerup', fireUp);
  fireBtn.addEventListener('pointercancel', fireUp);
  fireBtn.addEventListener('lostpointercapture', fireUp);

  const bind = (id, action) => {
    const b = document.getElementById(id);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      suppressGhostClick();
      press(action); b.classList.add('down');
    });
    const up = () => b.classList.remove('down');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  };
  bind('btn-reload', 'reload');
  bind('btn-interact', 'interact');
  bind('btn-use', 'use');
  bind('btn-melee', 'melee');
  bind('btn-dodge', 'dodge');
  bind('btn-swap', 'swap');
}

/** Called when the game pauses (tab hidden, menu) so stuck inputs don't linger. */
export function resetInput() {
  input.keys.clear();
  input.held.fire = false;
  input.held.sprint = false;
  input.pressed.clear();
  releaseTouches();
}
