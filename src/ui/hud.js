// Heads-up display (DOM): health, stamina, ammo, money, clock, objective,
// danger warnings, toasts and banners.
import { G } from '../game/state.js';
import { shortWeekday, eventsToday } from '../game/calendar.js';
import { fmtClock, escapeHtml } from '../util.js';

const $ = (id) => document.getElementById(id);
let els = {};
let hudT = 0;
const bannerQueue = [];
let bannerT = 0;

export function initHud() {
  els = {
    hud: $('hud'), hp: $('hp-fill'), hpTxt: $('hp-txt'), st: $('st-fill'), money: $('money'),
    clock: $('clock'), day: $('day'), obj: $('objective'), job: $('jobline'), ammo: $('ammo'), ammoSub: $('ammo-sub'),
    danger: $('danger'), toasts: $('toasts'), banner: $('banner'), prompt: $('prompt'), center: $('center-msg'),
    actLabel: $('btn-interact-label'), actBtn: $('btn-interact'), useLabel: $('btn-use-label'), cover: $('cover-tag'),
    reloadBar: $('reload-bar'), quick: $('quick-item'), swapLabel: $('btn-swap-label'), swapBtn: $('btn-swap'),
  };
}

export function toast(text, kind = 'info', dur = 2.2) {
  const box = els.toasts || $('toasts');
  if (!box) return;
  const div = document.createElement('div');
  div.className = `toast t-${kind.split(':')[0]}`;
  if (kind.startsWith('jp:')) div.dataset.path = kind.slice(3);
  div.textContent = text;
  box.appendChild(div);
  while (box.children.length > 5) box.firstChild.remove();
  setTimeout(() => { div.classList.add('out'); setTimeout(() => div.remove(), 400); }, dur * 1000);
}

/** Prominent message at the top of the screen. Queued so they don't overlap. */
export function banner(text, kind = 'info', dur = 3) {
  // A newer objective supersedes any queued older one.
  if (kind === 'objective') for (let i = bannerQueue.length - 1; i >= 0; i--) if (bannerQueue[i].kind === 'objective') bannerQueue.splice(i, 1);
  bannerQueue.push({ text, kind, dur });
  if (bannerQueue.length > 4) bannerQueue.shift();
}

/** Drop queued banners of a kind (e.g. stale attack warnings once the attack begins). */
export function clearBanners(kind) {
  for (let i = bannerQueue.length - 1; i >= 0; i--) if (bannerQueue[i].kind === kind) bannerQueue.splice(i, 1);
}

export function centerMessage(title, sub = '', dur = 2.5) {
  const el = els.center || $('center-msg');
  if (!el) return;
  el.innerHTML = `<div class="cm-title">${escapeHtml(title)}</div>${sub ? `<div class="cm-sub">${escapeHtml(sub)}</div>` : ''}`;
  el.classList.remove('hidden');
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), dur * 1000);
}

function updateBanner(dt) {
  const el = els.banner;
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) el.classList.add('hidden');
    return;
  }
  const b = bannerQueue.shift();
  if (!b) return;
  el.className = `banner b-${b.kind}`;
  el.textContent = b.text;
  bannerT = b.dur;
}

/**
 * Refresh the HUD. `info` carries derived values gathered by the main loop
 * (max stats, interact target, objective text, danger summary).
 */
export function updateHud(dt, info) {
  updateBanner(dt);
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.1;
  const p = G.player;
  if (!p) return;
  const s = G.s;
  const hpFrac = Math.max(0, p.hp / info.maxHp);
  els.hp.style.width = `${hpFrac * 100}%`;
  els.hp.classList.toggle('low', hpFrac < 0.3);
  els.hpTxt.textContent = `${Math.ceil(p.hp)} / ${info.maxHp}`;
  els.st.style.width = `${Math.max(0, p.stamina / info.maxStamina) * 100}%`;
  els.money.textContent = `$${s.money}`;
  els.clock.textContent = fmtClock(s.time.minute);
  els.day.textContent = `${G.endless || G.prequel ? '' : shortWeekday() + ' · '}Day ${s.time.day} ${info.night ? '☾' : '☀'}${G.endless || G.prequel ? '' : eventsToday().map((e) => ' ' + e.icon).join('')}`;
  els.obj.textContent = info.objective;
  els.job.textContent = info.jobLine || '';
  els.job.classList.toggle('hidden', !info.jobLine);
  const w = info.weapon;
  const reserve = s.inv[w.ammo] || 0;
  els.ammo.textContent = p.reloadT > 0 && !w.perRound ? 'RELOADING' : `${p.mag} / ${reserve}`;
  els.ammo.classList.toggle('warn', p.mag === 0 && p.reloadT <= 0);
  els.ammoSub.textContent = p.mag === 0 && reserve === 0 ? 'EMPTY — switch or MELEE' : p.mag === 0 ? 'Press R to reload' : `${w.icon} ${w.name}`;
  els.swapLabel.textContent = info.weaponCount > 1 ? `${w.short}` : 'SWAP';
  els.swapBtn.classList.toggle('dim', info.weaponCount < 2);
  els.reloadBar.style.width = p.reloadT > 0 ? `${(1 - p.reloadT / info.reloadTime) * 100}%` : '0%';
  els.cover.classList.toggle('hidden', !(p.inCover && info.combat));

  if (info.danger) {
    els.danger.classList.remove('hidden');
    els.danger.innerHTML = `<span class="dz-icon">⚠</span> ${escapeHtml(info.danger)}`;
  } else els.danger.classList.add('hidden');

  const tgt = info.target;
  if (tgt) {
    els.prompt.classList.remove('hidden');
    els.prompt.innerHTML = `<kbd class="kb-only">E</kbd><kbd class="pad-only pad-a">A</kbd> ${escapeHtml(tgt.label)}`;
    els.actLabel.textContent = tgt.short || 'ACT';
    els.actBtn.classList.add('ready');
  } else {
    els.prompt.classList.add('hidden');
    els.actLabel.textContent = 'ACT';
    els.actBtn.classList.remove('ready');
  }
  els.useLabel.textContent = info.quickLabel;
}
