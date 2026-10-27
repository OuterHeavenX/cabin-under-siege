// Day/night clock, resting and dawn processing.
import { G } from './state.js';
import { GAME_MIN_PER_SEC, SIEGE_MIN_PER_SEC } from '../config.js';
import { dailyProcess, absNow, absOf } from './siege.js';
import { derived, addJP } from './progression.js';
import { toast, banner } from '../ui/hud.js';
import { saveGame } from './save.js';
import { fmtClock } from '../util.js';
import { inCombat } from './player.js';

const SLEEP_RATE = 240; // game minutes per real second while sleeping

export function advanceMinutes(mins) {
  const t = G.s.time;
  t.minute += mins;
  while (t.minute >= 1440) { t.minute -= 1440; t.day += 1; }
  if (t.minute >= 6 * 60 && G.s.world.lastDayProcessed !== t.day) {
    dailyProcess();
    G.events.emit('newDay', t.day);
  }
}

export function updateTime(dt) {
  if (G.sleeping) {
    const remaining = G.sleeping.target - absNow();
    const step = Math.min(remaining, dt * SLEEP_RATE);
    if (step > 0) advanceMinutes(step);
    if (absNow() >= G.sleeping.target - 0.01) finishSleep(false);
    return;
  }
  // During an attack the clock slows down — except while they're searching for you and haven't found you.
  advanceMinutes(dt * (G.siegeActive && !(G.siege && G.siege.searching) ? SIEGE_MIN_PER_SEC : GAME_MIN_PER_SEC));
}

/** Why the player can't rest right now, or null if they can. */
export function restBlocker() {
  if (G.siegeActive || inCombat()) return 'You can\'t rest during an attack!';
  if (G.enemies.some((e) => !e.dead)) return 'Not while there are attackers nearby.';
  const s = G.s.world.siege;
  if (s && (s.warned || absOf(s) - absNow() < 45)) return 'You can\'t sleep — they\'re coming. Get ready.';
  return null;
}

export function startSleep(kind) {
  const why = restBlocker();
  if (why) { toast(why, 'danger', 3); return false; }
  const t = G.s.time;
  let target;
  if (kind === 'night') {
    const wake = 7 * 60;
    target = t.minute < wake ? t.day * 1440 + wake : (t.day + 1) * 1440 + wake;
  } else {
    target = absNow() + 180;
  }
  // Never sleep through an attack: stop at the warning time.
  const s = G.s.world.siege;
  if (s) {
    const lead = derived().warnLead + (s.extraLead || 0);
    target = Math.min(target, absOf(s) - lead);
  }
  if (target <= absNow() + 5) { toast('You toss and turn but can\'t sleep. Something feels wrong.', 'warn', 3); return false; }
  G.sleeping = { target, kind, startAbs: absNow() };
  return true;
}

export function finishSleep(interrupted, reason) {
  if (!G.sleeping) return;
  const slept = absNow() - G.sleeping.startAbs;
  G.sleeping = null;
  const p = G.player;
  const d = derived();
  const frac = Math.min(1, slept / 480);
  p.hp = Math.min(d.maxHp, p.hp + d.maxHp * 0.6 * frac + 10);
  p.stamina = d.maxStamina;
  if (interrupted) {
    banner(reason || 'You wake up.', 'danger', 5);
  } else {
    banner(`Day ${G.s.time.day} — ${fmtClock(G.s.time.minute)}. You feel rested.`, 'info', 4);
    if (slept >= 240) addJP('survivor', 6, 'sleep', 1);
    G.events.emit('slept', slept);
  }
  saveGame('rest');
}

export function initTimeEvents() {
  G.events.on('wake', (reason) => finishSleep(true, reason));
}
