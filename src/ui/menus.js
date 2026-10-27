// Modal UI: pause menu tabs, NPC menus, shops, job board, bed, workbench,
// repair minigame, siege summary, defeat and chapter-end screens.
import { G, hasSkill } from '../game/state.js';
import { ITEMS, SHOPS, RECIPES } from '../data/items.js';
import { ATTRIBUTES, MAX_ATTR, PATHS, SKILLS, xpForLevel } from '../data/skills.js';
import { NPCS, relLevel } from '../data/npcs.js';
import { HOMES } from '../data/homes.js';
import { escapeHtml, fmtClock } from '../util.js';
import { derived, spendAttr, buySkill, canBuySkill, shopDiscount, addMoney, addRel } from '../game/progression.js';
import { addItem, count, removeItem, useConsumable } from '../game/inventory.js';
import { installUpgrade, placeCover, homeStatus, craft, recipeCost, MAX_COVERS, MAX_TRAPS } from '../game/home.js';
import { boardOffers, acceptJob, abandonJob, jobHint, JOB_TYPES, jobOpenHours } from '../game/jobs.js';
import { heatLabel } from '../game/siege.js';
import { chatWith, giveGift, npcAvailableServices } from '../game/npcs.js';
import { objectiveText } from '../game/story.js';
import { offerQuest, activeQuests, questHint, QUESTS } from '../game/quests.js';
import { chapter } from '../game/chapters.js';
import { restBlocker, startSleep } from '../game/time.js';
import { saveGame, canSaveNow, exportSave, readImportFile, writeSaveData, saveSettings } from '../game/save.js';
import { sfx, setVolumes } from '../audio.js';
import { toast } from './hud.js';
import { resetInput, setTouchMode, input } from '../input.js';
import { drawMinimap } from '../world/render.js';
import { equipWeapon, magSize } from '../game/player.js';
import { WEAPONS } from '../data/weapons.js';
import { GAME_VERSION } from '../config.js';

const root = () => document.getElementById('modal-root');

/*
 * Reliable taps for every button in menus. Mobile Safari sometimes drops the
 * synthetic "click" (finger drifted a few pixels, another finger on the screen,
 * double-tap heuristics). So a button is pressed when a pointer goes down and
 * comes back up on it; the browser's own click that may follow is swallowed so
 * nothing fires twice. Taps that began before a menu opened (the finger that
 * opened it) never count, because their pointerdown wasn't on a menu button.
 */
let tapsReady = false;
export function initReliableTaps() {
  if (tapsReady) return;
  tapsReady = true;
  const r = document;
  const eligible = (b) => b && !b.disabled && !b.closest('#touch') && b.id !== 'menu-btn';
  let down = null;
  let synthBtn = null, synthUntil = 0;
  r.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button');
    down = eligible(b) ? { b, x: e.clientX, y: e.clientY, id: e.pointerId } : null;
  }, true);
  r.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || e.pointerId !== d.id || !d.b.isConnected || d.b.disabled) return;
    const b = document.elementFromPoint(e.clientX, e.clientY)?.closest('button');
    if (b !== d.b || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 18) return;
    synthBtn = b; synthUntil = performance.now() + 600;
    b.click();
  }, true);
  r.addEventListener('pointercancel', () => { down = null; }, true);
  r.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    // Swallow the native click that follows a press we already handled.
    if (performance.now() < synthUntil && e.target.closest && e.target.closest('button') === synthBtn) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
const stack = [];
let menuTab = 'inv';
const hooks = {}; // set by main: quitToTitle, reloadFromSave

export function setMenuHooks(h) { Object.assign(hooks, h); }

/* ---------------- modal framework ---------------- */
export function openModal(name, html, { onClose = null, closable = true, cls = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `modal-wrap ${cls}`;
  wrap.innerHTML = `<div class="modal" role="dialog" aria-label="${escapeHtml(name)}">${closable ? '<button class="close-btn" data-close aria-label="Close">✕</button>' : ''}<div class="modal-body scrollable">${html}</div></div>`;
  root().appendChild(wrap);
  const entry = { name, el: wrap, onClose, openedAt: performance.now() };
  stack.push(entry);
  G.modal = name;
  resetInput();
  wrap.addEventListener('click', (e) => {
    // Ignore the trailing click of the tap that opened this modal (it can land on ✕).
    if (e.isTrusted && performance.now() - entry.openedAt < 350) { e.preventDefault(); return; }
    if (e.target.closest('[data-close]')) { e.preventDefault(); closeModal(); sfx('ui'); }
  });
  return wrap;
}

export function closeModal() {
  const e = stack.pop();
  if (!e) return;
  e.el.remove();
  G.modal = stack.length ? stack[stack.length - 1].name : null;
  if (e.onClose) e.onClose();
}

export function closeAllModals() { while (stack.length) closeModal(); }
export function modalOpen() { return stack.length > 0; }
export function topModal() { return stack[stack.length - 1] || null; }

function rerender(entry, html) {
  const body = entry.el.querySelector('.modal-body');
  const st = body.scrollTop;
  body.innerHTML = html;
  body.scrollTop = st;
}

export function confirmBox(text, yesLabel, onYes, noLabel = 'Cancel') {
  const el = openModal('confirm', `<h2>Are you sure?</h2><p>${escapeHtml(text)}</p><div class="row-btns"><button class="btn danger" data-yes>${escapeHtml(yesLabel)}</button><button class="btn" data-close>${escapeHtml(noLabel)}</button></div>`, { cls: 'small' });
  el.querySelector('[data-yes]').addEventListener('click', () => { closeModal(); onYes(); });
}

/* ---------------- main pause menu ---------------- */
const TABS = [
  ['inv', 'Items'], ['char', 'Character'], ['skills', 'Skills (JP)'], ['home', 'Home'], ['map', 'Map'], ['journal', 'Journal'], ['settings', 'Settings'],
];

export function openMenu(tab) {
  if (tab) menuTab = tab;
  const existing = stack.find((s) => s.name === 'menu');
  if (existing) { renderMenu(existing); return; }
  const el = openModal('menu', '', { cls: 'wide' });
  const entry = stack[stack.length - 1];
  el.addEventListener('click', (e) => handleMenuClick(e, entry));
  el.addEventListener('input', (e) => handleSettingsInput(e));
  el.addEventListener('change', (e) => handleSettingsInput(e, true));
  renderMenu(entry);
}

function renderMenu(entry) {
  const tabs = TABS.map(([k, label]) => `<button class="tab ${k === menuTab ? 'on' : ''}" data-tab="${k}">${label}${k === 'char' && G.s.stats.attrPoints ? ' <span class="pip">!</span>' : ''}</button>`).join('');
  let body = '';
  switch (menuTab) {
    case 'inv': body = invTab(); break;
    case 'char': body = charTab(); break;
    case 'skills': body = skillsTab(); break;
    case 'home': body = homeTab(); break;
    case 'map': body = mapTab(); break;
    case 'journal': body = journalTab(); break;
    case 'settings': body = settingsTab(); break;
    default: body = '';
  }
  rerender(entry, `<div class="menu-head"><div class="paused-tag">PAUSED</div><div class="tabs" role="tablist">${tabs}</div></div><div class="tab-body">${body}</div>`);
  const on = entry.el.querySelector('.tab.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (menuTab === 'map') {
    const c = entry.el.querySelector('#minimap');
    if (c) drawMinimap(c);
  }
}

function refreshMenu() {
  const e = stack.find((s) => s.name === 'menu');
  if (e) renderMenu(e);
}

function handleMenuClick(e, entry) {
  const t = e.target.closest('[data-tab],[data-act]');
  if (!t) return;
  sfx('ui');
  if (t.dataset.tab) { menuTab = t.dataset.tab; renderMenu(entry); return; }
  const a = t.dataset.act, id = t.dataset.id;
  switch (a) {
    case 'use': useConsumable(id); break;
    case 'quick': G.s.quick = id; toast(`${ITEMS[id].name} set as quick-use item.`, 'info'); break;
    case 'place': closeAllModals(); placeCover(id); return;
    case 'install': installUpgrade(id); break;
    case 'equip': equipWeapon(G.player, id); break;
    case 'equipPistol': equipWeapon(G.player, 'pistol'); break;
    case 'attr': spendAttr(id); break;
    case 'skill': if (canBuySkill(id)) confirmBox(`Spend ${SKILLS[id].cost} ${PATHS[SKILLS[id].path].name} JP to learn ${SKILLS[id].name}?`, 'Learn', () => { buySkill(id); refreshMenu(); }, 'Not yet'); return;
    case 'abandon': confirmBox('Abandon your current job? You won\'t be paid.', 'Abandon', () => { abandonJob(); refreshMenu(); }); return;
    case 'save': {
      const why = canSaveNow();
      if (why) toast(why, 'warn'); else saveGame('manual', { quiet: false });
      break;
    }
    case 'export': exportSave(); break;
    case 'import': pickImport(); return;
    case 'help': openHelp(); return;
    case 'quit': confirmBox('Return to the title screen? Unsaved progress since your last save will be lost.', 'Quit to title', () => { closeAllModals(); hooks.quitToTitle && hooks.quitToTitle(); }); return;
    case 'resume': closeAllModals(); return;
    default: return;
  }
  renderMenu(entry);
}

function handleSettingsInput(e, commit) {
  const t = e.target;
  if (!t.dataset.set) return;
  const k = t.dataset.set;
  if (t.type === 'range') G.settings[k] = Number(t.value) / 100;
  else if (t.type === 'checkbox') G.settings[k] = t.checked;
  else G.settings[k] = t.value;
  setVolumes(G.settings.sfxVolume, G.settings.musicVolume);
  if (k === 'touchControls') {
    if (t.value === 'on') setTouchMode(true);
    else if (t.value === 'off') setTouchMode(false);
    else setTouchMode(matchMedia('(pointer: coarse)').matches);
  }
  saveSettings();
  if (commit && t.type === 'range') sfx('blip');
}

/* ---- Items ---- */
function invTab() {
  const p = G.player;
  const d = derived();
  const ids = Object.keys(G.s.inv).filter((k) => G.s.inv[k] > 0);
  const order = ['Weapon', 'Ammunition', 'Healing', 'Food', 'Materials', 'Tools', 'Defense', 'Upgrade', 'Story'];
  ids.sort((a, b) => order.indexOf(ITEMS[a].cat) - order.indexOf(ITEMS[b].cat));
  const rows = ids.map((id) => {
    const it = ITEMS[id];
    const btns = [];
    if (it.quick) { btns.push(`<button class="btn sm" data-act="use" data-id="${id}">Use</button>`); btns.push(`<button class="btn sm ${G.s.quick === id ? 'on' : ''}" data-act="quick" data-id="${id}">${G.s.quick === id ? '★ Quick' : 'Set Quick'}</button>`); }
    if (it.place) btns.push(`<button class="btn sm" data-act="place" data-id="${id}">Place</button>`);
    if (it.install) btns.push(`<button class="btn sm" data-act="install" data-id="${id}">Install</button>`);
    if (it.weapon) btns.push(`<button class="btn sm ${p.weapon === id ? 'on' : ''}" data-act="equip" data-id="${id}">${p.weapon === id ? '★ Equipped' : 'Equip'}</button>`);
    return `<div class="item-row"><div class="item-icon">${it.icon}</div><div class="item-main"><div class="item-name">${escapeHtml(it.name)} <span class="muted">${G.s.inv[id]} / ${it.cap}</span></div><div class="item-desc">${escapeHtml(it.desc)}</div></div><div class="item-btns">${btns.join('')}</div></div>`;
  }).join('');
  const ups = Object.entries(G.s.home.upgrades).filter(([, v]) => v).map(([k]) => ({ floodlight: 'Floodlight', alarm: 'Tripwire Alarm', extMag: 'Extended Magazine' }[k]));
  const w = WEAPONS[p.weapon];
  return `<div class="stat-line">Equipped: <b>${w.icon} ${w.name}</b> ${p.mag}/${magSize(p.weapon)} · Money: <b>$${G.s.money}</b> · Axe (always carried)</div>
    <div class="item-row"><div class="item-icon">🔫</div><div class="item-main"><div class="item-name">9mm Handgun <span class="muted">always carried</span></div><div class="item-desc">${escapeHtml(WEAPONS.pistol.desc)}</div></div><div class="item-btns"><button class="btn sm ${p.weapon === 'pistol' ? 'on' : ''}" data-act="equipPistol">${p.weapon === 'pistol' ? '★ Equipped' : 'Equip'}</button></div></div>
    ${rows || '<p class="muted">Your pockets are empty.</p>'}
    ${ups.length ? `<p class="muted">Installed upgrades: ${ups.join(', ')}</p>` : ''}
    <p class="hint">Tip: the USE button (Q) uses your ★ quick item. Defense items are installed by walking up to a window or door and pressing ACT/E.</p>`;
}

/* ---- Character ---- */
function charTab() {
  const st = G.s.stats;
  const need = xpForLevel(st.level);
  const d = derived();
  const preview = {
    vit: (n) => `Max HP ${100 + 12 * (n - 1)} → ${100 + 12 * n}`,
    end: (n) => `Max stamina ${100 + 10 * (n - 1)} → ${100 + 10 * n}; costs −${4 * (n - 1)}% → −${4 * n}%`,
    pre: (n) => `Spread −${6 * (n - 1)}% → −${6 * n}%`,
    awa: (n) => `Night sight ${170 + 20 * (n - 1)}px → ${170 + 20 * n}px; warning +${4 * (n - 1)} → +${4 * n} min`,
    res: (n) => `Healing +${5 * (n - 1)}% → +${5 * n}%; recovery cap ${30 + 5 * (n - 1)}% → ${30 + 5 * n}%`,
  };
  const attrs = Object.entries(ATTRIBUTES).map(([k, a]) => {
    const v = st.attrs[k];
    const can = st.attrPoints > 0 && v < MAX_ATTR;
    return `<div class="attr-row"><div class="attr-name"><b>${a.name}</b> <span class="attr-val">${v}</span></div><div class="attr-desc">${escapeHtml(a.desc)}<br><span class="muted">${v < MAX_ATTR ? 'Next: ' + preview[k](v) : 'Maxed'}</span></div><button class="btn sm plus" data-act="attr" data-id="${k}" ${can ? '' : 'disabled'} aria-label="Raise ${a.name}">＋</button></div>`;
  }).join('');
  return `<div class="char-head"><div><div class="big">Frank Lowe</div><div class="muted">Former Vescari family man. Trying something new.</div></div>
      <div class="lvl">Level <b>${st.level}</b></div></div>
    <div class="xpbar"><div style="width:${(st.xp / need) * 100}%"></div><span>XP ${st.xp} / ${need}</span></div>
    <p class="hint"><b>XP</b> raises your character level. Each level gives <b>2 attribute points</b>. Earn XP from jobs, surviving attacks, story events, helping people and discovering places. (Separate from <b>JP</b>, which unlocks skills.)</p>
    <div class="stat-line">Attribute points available: <b class="${st.attrPoints ? 'hl' : ''}">${st.attrPoints}</b></div>
    ${attrs}
    <div class="derived"><span>Max HP <b>${d.maxHp}</b></span><span>Stamina <b>${d.maxStamina}</b></span><span>Reload <b>${d.reloadTime.toFixed(2)}s</b></span><span>Heal ×<b>${d.healMult.toFixed(2)}</b></span><span>Night sight <b>${d.seeRadius}px</b></span><span>Warning lead <b>${d.warnLead} min</b></span></div>`;
}

/* ---- Skills ---- */
function skillsTab() {
  const paths = Object.entries(PATHS).map(([pk, path]) => {
    const skills = Object.entries(SKILLS).filter(([, s]) => s.path === pk).map(([sid, s]) => {
      const owned = hasSkill(sid);
      const can = canBuySkill(sid);
      return `<div class="skill ${owned ? 'owned' : ''}"><div><b>${escapeHtml(s.name)}</b> <span class="muted">${owned ? '✓ Learned' : s.cost + ' JP'}</span><div class="skill-desc">${escapeHtml(s.desc)}</div></div>${owned ? '' : `<button class="btn sm" data-act="skill" data-id="${sid}" ${can ? '' : 'disabled'}>Learn</button>`}</div>`;
    }).join('');
    return `<div class="path" style="--pc:${path.color}"><div class="path-head"><span class="path-icon">${path.icon}</span><b>${path.name}</b><span class="jp">${G.s.jp[pk]} JP</span><span class="muted small">(${G.s.jpEarned[pk]} earned)</span></div><div class="path-earn">Earn by: ${escapeHtml(path.earn)}</div>${skills}</div>`;
  }).join('');
  return `<p class="hint"><b>JP (Job Points)</b> are earned in each path by doing that kind of activity, and spent on that path's skills. You can learn from every path — no permanent class. Repeating trivial actions has daily limits.</p>${paths}`;
}

/* ---- Home ---- */
function homeTab() {
  const rows = homeStatus().map((r) => `<div class="def-row"><div class="def-name">${r.kind === 'door' ? '🚪' : '🪟'} ${escapeHtml(r.label)} ${r.extras.map((x) => `<span class="tag">${x}</span>`).join('')}</div>
      <div class="cond" role="img" aria-label="${Math.round(r.cond * 100)} percent"><div class="cond-fill ${r.cond < 0.35 ? 'bad' : r.cond < 0.75 ? 'mid' : ''}" style="width:${Math.round(r.cond * 100)}%"></div></div>
      <div class="def-stat">${Math.round(r.cond * 100)}% · ${escapeHtml(r.status)}${r.repair ? ` · Repair: ${r.repair} wood` : ''}</div></div>`).join('');
  const up = G.s.home.upgrades;
  const w = G.s.world;
  const heat = hasSkill('keen_eye') ? `${heatLabel(w.threat)} (${Math.round(w.threat)}/100)` : heatLabel(w.threat);
  return `<div class="stat-line">Mob Heat: <b class="heat-${heatLabel(w.threat).toLowerCase()}">${heat}</b> <span class="muted">— how close the family is to striking. Learn <i>Keen Eye</i> to see the exact number.</span></div>
    ${rows}
    <div class="def-row wide"><div class="def-name">🛡 Placed cover</div><div class="def-stat">${G.s.home.covers.length} / ${MAX_COVERS} placed${G.s.home.covers.map((c) => ` · ${c.type} ${Math.round((c.hp))}hp`).join('')}</div></div>
    <div class="def-row wide"><div class="def-name">⚙ Bear traps</div><div class="def-stat">${(G.s.home.traps || []).length} / ${MAX_TRAPS} set${(G.s.home.traps || []).some((t) => !t.armed) ? ' · some need re-arming (walk up and press ACT)' : ''}</div></div>
    <div class="def-row wide"><div class="def-name">☎ Phone line</div><div class="def-stat">${G.s.home.phoneLine ? `Working — ${NPCS[chapter().neighbor].name.split(' ')[0]} can call with warnings` : 'DAMAGED — repair at the pole by the road (Toolkit + 1 wood)'}</div></div>
    <div class="def-row wide"><div class="def-name">💡 Lights</div><div class="def-stat">Porch light ${G.s.home.porchLight ? 'on' : 'off'} · Floodlight ${up.floodlight ? 'installed' : `not installed (${chapter().hardwareName})`}</div></div>
    <div class="def-row wide"><div class="def-name">🔔 Early warning</div><div class="def-stat">${up.alarm ? 'Tripwire alarm installed (+45 min warning, shows directions)' : `No alarm (${chapter().hardwareName} sells a tripwire kit)`}</div></div>
    <div class="def-row wide"><div class="def-name">📷 Cameras</div><div class="def-stat">${up.camera ? 'Installed — every attacker on the property is marked during an attack' : `None (${chapter().hardwareName} sells a camera kit)`}</div></div>
    <p class="hint">Repair doors and windows by walking up to them and pressing ACT/E when no attackers are around. Repairs cost wood. Board kits and door braces are installed the same way.</p>`;
}

/* ---- Map ---- */
function mapTab() {
  const m = G.map;
  const disc = G.s.world.discovered;
  const all = [...G.maps.cabin.discover, ...G.maps.town.discover];
  return `<div class="stat-line">You are at: <b>${escapeHtml(m.name)}</b>. Travel between the cabin and Pine Hollow with your car (or walk the road).</div>
    <canvas id="minimap" class="minimap"></canvas>
    <div class="legend"><span><i style="background:#fff"></i>You</span><span><i style="background:#5bc0de"></i>People</span><span><i style="background:#ffd166"></i>Objective</span><span><i style="background:#e74c3c"></i>Attackers</span><span><i style="background:#9b7b55"></i>Buildings</span></div>
    <div class="places">${all.map((d) => `<span class="${disc.includes(d.id) ? '' : 'muted'}">${disc.includes(d.id) ? '✓' : '?'} ${disc.includes(d.id) ? escapeHtml(d.name) : 'Undiscovered'}</span>`).join('')}</div>`;
}

/* ---- Journal ---- */
function journalTab() {
  const j = G.s.job;
  const ch = chapter();
  const roleBenefits = {
    neighbor: ['Lv1: takes you in if you fall', 'Lv2: warns you when an attack is coming', 'Lv3: shares medical supplies'],
    shopkeeper: ['Lv1: tips about strangers in town', 'Lv2: 5% discount', 'Lv4: 10% discount'],
    jobContact: ['Lv1: reads the town\'s mood', 'Lv2: +10% job pay', 'Lv3: friendly advice'],
  };
  const people = [ch.neighbor, ch.shopkeeper, ch.jobContact];
  const rel = people.map((id) => {
    const n = NPCS[id];
    const lv = relLevel(G.s.rel[id] || 0);
    const role = id === ch.neighbor ? 'neighbor' : id === ch.shopkeeper ? 'shopkeeper' : 'jobContact';
    return `<div class="rel-row"><div class="rel-main"><b>${escapeHtml(n.name)}</b> <span class="muted">${escapeHtml(n.title)}</span><div class="small muted">${escapeHtml(n.bio)}</div><div class="small">${roleBenefits[role].map((b) => `<span class="${lv >= Number(b[2]) ? 'hl' : 'muted'}">${b}</span>`).join(' · ')} · <span class="${lv >= 1 ? 'hl' : 'muted'}">Lv1: asks you for a favor</span></div></div><div class="hearts" aria-label="Friendship ${lv} of 5">${'♥'.repeat(lv)}${'♡'.repeat(5 - lv)}</div></div>`;
  }).join('');
  const favors = activeQuests().map((q) => `<div class="objective-box favor"><b>🙋 ${escapeHtml(q.title)}</b> <span class="muted">for ${escapeHtml(NPCS[q.npc].name)}</span><br>${escapeHtml(questHint(q))}</div>`).join('');
  const doneFavors = Object.entries(G.s.quests || {}).filter(([id, st]) => st.state === 'done' && QUESTS[id]).map(([id]) => QUESTS[id].title);
  const homes = HOMES.map((h) => {
    const done = (G.s.story.done || {})[h.chapter] || (h.chapter === 1 && G.s.story.chapterComplete);
    const status = !h.playable ? 'Planned for a future update (not playable yet)' : done ? 'Complete ✓' : G.s.chapter === h.chapter ? 'Now playing' : G.s.chapter > h.chapter ? 'Moved on' : 'Ahead';
    return `<div class="home-row ${h.playable ? '' : 'muted'}"><b>Ch.${h.chapter} ${escapeHtml(h.name)}</b> — ${status}</div>`;
  }).join('');
  return `<h3>Chapter ${ch.id} — ${escapeHtml(ch.name)}</h3>
    <div class="objective-box"><b>Objective:</b> ${escapeHtml(objectiveText())}</div>
    ${j ? `<div class="objective-box job"><b>${JOB_TYPES[j.type].icon} Job: ${JOB_TYPES[j.type].name}</b> ($${j.pay})<br>${escapeHtml(jobHint())}<div class="row-btns"><button class="btn sm" data-act="abandon">Abandon job</button></div></div>` : `<p class="muted">No active job. Visit the job board at ${escapeHtml(ch.jobPlace)} (7 AM – 5 PM).</p>`}
    ${favors || '<p class="muted small">No favors in progress. Friends (♥1+) sometimes ask for help — talk to them.</p>'}
    ${doneFavors.length ? `<p class="small muted">Favors done: ${doneFavors.map(escapeHtml).join(', ')}</p>` : ''}
    <h3>People</h3>${rel}
    <h3>The road ahead</h3>${homes}`;
}

/* ---- Settings ---- */
function settingsTab() {
  const s = G.settings;
  const sel = (k, opts) => `<select data-set="${k}">${opts.map(([v, l]) => `<option value="${v}" ${s[k] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const chk = (k) => `<input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}>`;
  const saved = G.s.savedAt ? new Date(G.s.savedAt).toLocaleString() : 'never';
  const why = canSaveNow();
  return `<div class="set-grid">
    <label>Sound volume <input type="range" min="0" max="100" value="${Math.round(s.sfxVolume * 100)}" data-set="sfxVolume"></label>
    <label>Music volume <input type="range" min="0" max="100" value="${Math.round(s.musicVolume * 100)}" data-set="musicVolume"></label>
    <label>${chk('aimAssist')} Aim assist (nudges aim toward nearby attackers)</label>
    <label>${chk('fireWhileAiming')} Fire while pushing the aim stick (touch)</label>
    <label>${chk('autoSprint')} Sprint at full joystick tilt (touch)</label>
    <label>${chk('showDamageNumbers')} Show damage numbers</label>
    <label>Screen shake ${sel('screenShake', [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']])}</label>
    <label>Touch controls ${sel('touchControls', [['auto', 'Automatic'], ['on', 'Always on'], ['off', 'Off']])}</label>
  </div>
  <h3>Save</h3>
  <p class="small">The game autosaves when you sleep, travel, finish jobs, install defenses and survive attacks. Last save: <b>${saved}</b>.</p>
  <div class="row-btns"><button class="btn" data-act="save" ${why ? 'disabled' : ''}>Save now</button><button class="btn" data-act="export">Export save file</button><button class="btn" data-act="import">Import save file</button></div>
  ${why ? `<p class="small muted">${escapeHtml(why)}</p>` : ''}
  <div class="row-btns"><button class="btn" data-act="help">Controls & Help</button><button class="btn danger" data-act="quit">Quit to title</button><button class="btn primary" data-act="resume">Resume</button></div>
  <p class="small muted">Cabin Under Siege v${GAME_VERSION}</p>`;
}

export function pickImport(onDone) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.addEventListener('change', () => {
    readImportFile(inp.files[0]).then((data) => {
      confirmBox(`Replace your current save with this file (Day ${data.time.day}, Level ${data.stats.level})?`, 'Replace save', () => {
        if (writeSaveData(data)) { toast('Save imported.', 'info'); closeAllModals(); hooks.reloadFromSave && hooks.reloadFromSave(); onDone && onDone(); }
        else toast('Could not write the save.', 'warn');
      });
    }).catch((err) => toast(`Import failed: ${err}`, 'warn', 4));
  });
  inp.click();
}

export function openHelp() {
  openModal('help', `<h2>Controls & Help</h2>
    <div class="help-cols">
      <div><h3>Desktop</h3><ul>
        <li><kbd>WASD</kbd>/<kbd>Arrows</kbd> Move · <kbd>Shift</kbd> Sprint</li>
        <li><kbd>Mouse</kbd> Aim · <kbd>Left click</kbd> Fire</li>
        <li><kbd>R</kbd> Reload · <kbd>E</kbd> Interact / talk / open doors</li>
        <li><kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>, <kbd>Tab</kbd> or <kbd>Mouse wheel</kbd> Switch weapon</li>
        <li><kbd>F</kbd> or <kbd>Right click</kbd> Melee shove</li>
        <li><kbd>Space</kbd> Dodge roll · <kbd>Q</kbd> Use quick item</li>
        <li><kbd>Esc</kbd>/<kbd>P</kbd> Pause menu · <kbd>I</kbd> Items · <kbd>C</kbd> Character · <kbd>K</kbd> Skills · <kbd>V</kbd> Home · <kbd>M</kbd> Map · <kbd>J</kbd> Journal · <kbd>H</kbd> Help</li>
      </ul></div>
      <div><h3>Touch</h3><ul>
        <li>Left side: drag anywhere to move (full tilt sprints)</li>
        <li>Right stick: aim — push it far to fire</li>
        <li><b>FIRE</b>: shoots where you aim (aim assist picks a target)</li>
        <li><b>ACT</b>: talk, open doors, chop, repair — label shows the action</li>
        <li><b>RELOAD</b>, <b>MELEE</b>, <b>DODGE</b>, <b>USE</b> (quick item), <b>SWAP</b> (next weapon)</li>
        <li>☰ top-right: pause menu</li>
      </ul></div>
    </div>
    <h3>How it works</h3><ul>
      <li><b>Days</b>: work jobs from the job board (7–5), shop (8–8), chop wood, talk to people. Friends ask for <b>favors</b> with good rewards.</li>
      <li><b>Weapons</b>: the handgun is always with you. Buy a pump shotgun (doorways) and a hunting rifle (long range, pierces) at the store.</li>
      <li><b>Nights</b>: the family may come. Warning signs — strange cars, footprints, a cut phone line, a stranger in town — mean trouble is near. Not every sign means an attack.</li>
      <li><b>Attackers</b>: Scouts, Enforcers (break doors), Gunmen (use cover), Arsonists (molotovs — fire burns doors, windows and you) and Lieutenants (tough, rally nearby attackers). Raiders probe your weakest door or window.</li>
      <li><b>Defend</b>: board windows, add steel shutters, brace doors, place sandbags and bear traps, install a floodlight, tripwire alarm and cameras. Solid things (trees, rocks, cars, walls, cover) stop bullets. Standing next to cover reduces damage you take.</li>
      <li><b>Repair</b>: walk up to damaged doors/windows and press ACT. Costs wood.</li>
      <li><b>Rest</b> in your bed to sleep until morning. You'll never sleep through an attack.</li>
      <li><b>XP</b> raises your level (attribute points). <b>JP</b> is earned per path and buys skills.</li>
      <li>If you fall, a neighbor finds you. You lose some cash and the cabin takes damage, but keep your progress.</li>
    </ul>`, { cls: 'wide' });
}

/* ---------------- NPC menu ---------------- */
export function openNpcMenu(n) {
  const def = NPCS[n.id];
  const lv = relLevel(G.s.rel[n.id]);
  const services = npcAvailableServices(n);
  const night = G.s.time.minute >= 21 * 60 || G.s.time.minute < 6 * 60;
  const btns = [`<button class="btn big" data-npc="talk">💬 Talk</button>`];
  if (services.includes('shop')) btns.push(`<button class="btn big" data-npc="shop">🛒 Shop</button>`);
  if (services.includes('jobs')) btns.push(`<button class="btn big" data-npc="jobs">📋 Job board</button>`);
  if (services.includes('favor')) btns.push(`<button class="btn big hl-btn" data-npc="favor">🙋 Ask about a favor</button>`);
  btns.push(`<button class="btn big" data-npc="gift" ${count('stew') + count('sandwich') ? '' : 'disabled'}>🎁 Give food</button>`);
  const el = openModal('npc', `<div class="npc-head"><div class="npc-dot" style="background:${def.body}"></div><div><h2>${escapeHtml(def.name)}</h2><div class="muted">${escapeHtml(def.title)}</div></div><div class="hearts">${'♥'.repeat(lv)}${'♡'.repeat(5 - lv)}</div></div>
    ${night ? '<p class="muted">It\'s late. They look tired.</p>' : ''}
    <div class="npc-btns">${btns.join('')}<button class="btn big" data-close>Leave</button></div>`, { cls: 'small' });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-npc]');
    if (!b) return;
    sfx('ui');
    const a = b.dataset.npc;
    closeModal();
    if (a === 'talk') chatWith(n.id);
    if (a === 'shop') openShop(n.id);
    if (a === 'jobs') openJobBoard();
    if (a === 'gift') giveGift(n.id);
    if (a === 'favor') offerQuest(n.id);
  });
}

/* ---------------- shop ---------------- */
export function openShop(shopId, tab = 'buy') {
  const shop = SHOPS[shopId];
  const el = openModal('shop', '', { cls: 'wide' });
  const entry = stack[stack.length - 1];
  let mode = tab;
  const render = () => {
    const disc = shopDiscount(shop.owner);
    const price = (p) => Math.max(1, Math.round(p * (1 - disc)));
    let rows;
    if (mode === 'buy') {
      rows = shop.stock.map((s) => {
        const it = ITEMS[s.id];
        const have = count(s.id);
        const installed = it.install && (it.install === 'extMag' ? (G.s.weaponMods && G.s.weaponMods.extMag) || G.s.home.upgrades.extMag : G.s.home.upgrades[it.install]);
        const full = have + s.qty > it.cap || installed;
        const pr = price(s.price);
        const afford = G.s.money >= pr;
        return `<div class="item-row"><div class="item-icon">${it.icon}</div><div class="item-main"><div class="item-name">${escapeHtml(it.name)}${s.qty > 1 ? ` ×${s.qty}` : ''} <span class="muted">(have ${have})</span></div><div class="item-desc">${escapeHtml(it.desc)}</div></div><button class="btn buy" data-buy="${s.id}" ${!afford || full ? 'disabled' : ''}>${full ? (installed ? 'Installed' : it.weapon ? 'Owned' : 'Full') : `$${pr}`}</button></div>`;
      }).join('');
    } else {
      const ids = Object.keys(G.s.inv).filter((k) => G.s.inv[k] > 0 && !ITEMS[k].story && ITEMS[k].sell > 0);
      rows = ids.map((id) => {
        const it = ITEMS[id];
        const unit = id === 'ammo' ? it.sell : it.sell;
        const n = id === 'ammo' ? Math.min(12, count(id)) : 1;
        return `<div class="item-row"><div class="item-icon">${it.icon}</div><div class="item-main"><div class="item-name">${escapeHtml(it.name)} <span class="muted">(have ${count(id)})</span></div></div><button class="btn" data-sell="${id}" data-n="${n}">Sell ${n > 1 ? n + ' ' : ''}for $${Math.max(1, Math.round(unit * n))}</button></div>`;
      }).join('') || '<p class="muted">Nothing to sell.</p>';
    }
    rerender(entry, `<h2>${escapeHtml(shop.name)}</h2><div class="stat-line">Your money: <b>$${G.s.money}</b>${disc > 0 ? ` · <span class="hl">${Math.round(disc * 100)}% discount</span>` : ''}</div>
      <div class="tabs"><button class="tab ${mode === 'buy' ? 'on' : ''}" data-mode="buy">Buy</button><button class="tab ${mode === 'sell' ? 'on' : ''}" data-mode="sell">Sell</button></div>${rows}`);
  };
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]');
    if (m) { mode = m.dataset.mode; sfx('ui'); render(); return; }
    const b = e.target.closest('[data-buy]');
    if (b) {
      const s = shop.stock.find((x) => x.id === b.dataset.buy);
      const pr = Math.max(1, Math.round(s.price * (1 - shopDiscount(shop.owner))));
      if (G.s.money < pr) return;
      const got = addItem(s.id, s.qty, true);
      if (got > 0) {
        G.s.money -= pr;
        sfx('coin');
        toast(`Bought ${ITEMS[s.id].name}${s.qty > 1 ? ' ×' + got : ''}`, 'item', 1.5);
        if (ITEMS[s.id].install === 'extMag') installUpgrade('ext_mag');
        if (ITEMS[s.id].weapon) toast(`${ITEMS[s.id].name} bought! Switch with ${s.id === 'shotgun' ? '2' : '3'}, Tab, the mouse wheel or the SWAP button.`, 'level', 4);
        if (G.s.rel[shop.owner] !== undefined && pr >= 25) addRel(shop.owner, 1);
      }
      render();
      return;
    }
    const sb = e.target.closest('[data-sell]');
    if (sb) {
      const id = sb.dataset.sell, n = Number(sb.dataset.n);
      if (removeItem(id, n)) { G.s.money += Math.max(1, Math.round(ITEMS[id].sell * n)); sfx('coin'); }
      render();
    }
  });
  render();
}

/* ---------------- job board ---------------- */
export function openJobBoard() {
  const el = openModal('jobs', '', { cls: 'wide' });
  const entry = stack[stack.length - 1];
  const render = () => {
    const j = G.s.job;
    const open = jobOpenHours();
    const offers = boardOffers().map((o) => {
      const t = JOB_TYPES[o.type];
      return `<div class="job-card ${o.locked ? 'locked' : ''}"><div class="job-title">${t.icon} ${t.name} <span class="pay">$${o.pay}</span></div><div class="small">${escapeHtml(o.desc)}</div><div class="small muted">Rewards: money, XP, ${PATHS[t.path].name} JP${o.type !== 'woodcut' ? ', friendship' : ', friendship with Gus'}</div>
        ${o.locked ? '<div class="small hl">Requires the Neighbor skill "Good Reputation".</div>' : `<button class="btn" data-accept="${o.type}" ${j || !open ? 'disabled' : ''}>Accept</button>`}</div>`;
    }).join('');
    rerender(entry, `<h2>📋 Okafor Lumber — Job Board</h2>
      ${!open ? '<p class="hl">The board is closed. New jobs are handed out 7 AM – 5 PM.</p>' : ''}
      ${j ? `<div class="objective-box job"><b>Current job: ${JOB_TYPES[j.type].name}</b> ($${j.pay})<br>${escapeHtml(jobHint())}</div>` : ''}
      <div class="jobs">${offers}</div>`);
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-accept]');
    if (!b) return;
    if (acceptJob(b.dataset.accept)) { closeModal(); }
    else render();
  });
  render();
}

/* ---------------- bed ---------------- */
export function openBedMenu() {
  const why = restBlocker();
  const night = G.s.time.minute >= 19 * 60 || G.s.time.minute < 6 * 60;
  const el = openModal('bed', `<h2>🛏 Bed</h2><p>It's ${fmtClock(G.s.time.minute)} on day ${G.s.time.day}.</p>
    ${why ? `<p class="hl">${escapeHtml(why)}</p>` : '<p class="small muted">Sleeping saves the game, restores stamina and heals you. You will be woken if trouble comes.</p>'}
    <div class="npc-btns">
      <button class="btn big" data-bed="night" ${why ? 'disabled' : ''}>${night ? 'Sleep until morning' : 'Sleep until tomorrow'}</button>
      <button class="btn big" data-bed="nap" ${why ? 'disabled' : ''}>Nap (3 hours)</button>
      <button class="btn big" data-bed="save" ${canSaveNow() ? 'disabled' : ''}>Save game</button>
      <button class="btn big" data-close>Cancel</button></div>`, { cls: 'small' });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bed]');
    if (!b) return;
    const a = b.dataset.bed;
    closeModal();
    if (a === 'save') saveGame('manual', { quiet: false });
    else startSleep(a === 'nap' ? 'nap' : 'night');
  });
}

/* ---------------- workbench ---------------- */
export function openCraft() {
  const el = openModal('craft', '', { cls: 'small' });
  const entry = stack[stack.length - 1];
  const render = () => {
    const rows = RECIPES.map((r) => {
      const cost = recipeCost(r);
      return `<div class="item-row"><div class="item-icon">${ITEMS[r.id].icon}</div><div class="item-main"><div class="item-name">${escapeHtml(r.label)} <span class="muted">(have ${count(r.id)})</span></div><div class="item-desc">${escapeHtml(ITEMS[r.id].desc)}</div></div><button class="btn" data-craft="${r.id}" ${count('wood') >= cost ? '' : 'disabled'}>${cost} wood</button></div>`;
    }).join('');
    rerender(entry, `<h2>🔨 Workbench</h2><div class="stat-line">Wood: <b>${count('wood')}</b></div>${rows}<p class="hint">Chop trees with ACT/E for wood. Install board kits at windows; place barricades from the Items menu.</p>`);
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-craft]');
    if (b) { craft(b.dataset.craft); render(); }
  });
  render();
}

/* ---------------- action chooser ---------------- */
export function openActions(title, options) {
  const el = openModal('actions', `<h2>${escapeHtml(title)}</h2><div class="npc-btns">${options.map((o, i) => `<button class="btn big" data-opt="${i}" ${o.disabled ? 'disabled' : ''}>${escapeHtml(o.label)}</button>`).join('')}<button class="btn big" data-close>Cancel</button></div>`, { cls: 'small' });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-opt]');
    if (!b) return;
    closeModal();
    options[Number(b.dataset.opt)].action();
  });
}

/* ---------------- repair minigame ---------------- */
export function openRepairGame({ title, hits = 3, wide = false, onDone }) {
  const el = openModal('repair', `<h2>🔧 ${escapeHtml(title)}</h2><p class="small">Strike when the marker is inside the green zone. ${hits} good hits to finish.</p>
    <div class="rg-bar"><div class="rg-zone"></div><div class="rg-needle"></div></div>
    <div class="rg-count"></div>
    <button class="btn big primary rg-hit">HAMMER</button>`, { cls: 'small' });
  const zone = el.querySelector('.rg-zone'), needle = el.querySelector('.rg-needle'), cnt = el.querySelector('.rg-count');
  let pos = 0, dir = 1, speed = 0.9, good = 0, zw = wide ? 0.26 : 0.17, zx = 0;
  const place = () => { zx = 0.1 + Math.random() * (0.8 - zw); zone.style.left = `${zx * 100}%`; zone.style.width = `${zw * 100}%`; };
  place();
  const upd = () => { cnt.textContent = `${'🔨'.repeat(good)}${'·'.repeat(hits - good)}`; };
  upd();
  let raf;
  let last = performance.now();
  const tick = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    pos += dir * speed * dt;
    if (pos > 1) { pos = 1; dir = -1; } if (pos < 0) { pos = 0; dir = 1; }
    needle.style.left = `${pos * 100}%`;
    if (el.isConnected) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const hit = () => {
    if (pos >= zx && pos <= zx + zw) {
      good++; sfx('hammer'); upd();
      if (good >= hits) { cancelAnimationFrame(raf); closeModal(); onDone(); return; }
      speed += 0.25; place();
    } else { sfx('miss'); el.querySelector('.rg-bar').classList.add('miss'); setTimeout(() => el.querySelector('.rg-bar')?.classList.remove('miss'), 200); }
  };
  el.querySelector('.rg-hit').addEventListener('pointerdown', (e) => { e.preventDefault(); hit(); });
  G.repairGameHit = hit;
  const entry = stack[stack.length - 1];
  entry.onClose = () => { cancelAnimationFrame(raf); G.repairGameHit = null; };
}

/* ---------------- end screens ---------------- */
export function showSiegeSummary({ kind, killed, fled, xp, total }) {
  setTimeout(() => {
    openModal('summary', `<h2>${kind === 'story' ? 'You survived the night' : kind === 'ambush' ? 'Ambush repelled' : 'Attack repelled'}</h2>
      <div class="summary"><div><b>${killed}</b><span>defeated</span></div><div><b>${fled}</b><span>fled</span></div><div><b>+${xp}</b><span>XP</span></div></div>
      <p class="small">The family's Heat has dropped. Expect a few quiet nights. Check your doors and windows for damage — repairs cost wood.</p>
      <button class="btn big primary" data-close>Continue</button>`, { cls: 'small' });
  }, 1800);
}

export function showDefeat({ lost, rescuer, text, story, onContinue }) {
  openModal('defeat', `<h2 class="defeat-title">You blacked out</h2>
    <p>${escapeHtml(text)}</p>
    <ul class="small"><li>Lost $${lost} (it fell out of your pockets — or someone helped themselves)</li><li>The cabin took extra damage</li><li>Your level, skills, job progress and story are safe</li>${story ? '<li class="hl">They\'ll be back tomorrow night. Prepare better.</li>' : ''}</ul>
    <button class="btn big primary" data-go>Wake up</button>`, { closable: false, cls: 'small defeat' })
    .querySelector('[data-go]').addEventListener('click', () => { closeModal(); onContinue(); });
}

const CHAPTER_END = {
  1: {
    title: 'THE CABIN',
    body: 'You held the line. Pine Hollow has a few more friends of yours than it did a week ago, and the Vescari family has one less excuse to underestimate you.',
    hook: 'But Leo Vescari knows exactly where you are. The family is still searching — and next time, they won\'t send boys.',
    next: 'Chapter 2 is ready: keep playing here as long as you like, then use your car at the cabin to leave Pine Hollow for good.',
  },
  2: {
    title: 'LARCH STREET',
    body: 'Sal Benedetto is gone, Larch Street is still standing, and the man across the road turned out to be the best friend a hunted man could have.',
    hook: 'Leo knows about Marcus now. "Wisconsin next." The family is closing the distance — and they\'ll come with everything.',
    next: 'Chapter 3 (a farm in Wisconsin) is planned for a future update. You can keep playing: work jobs, help neighbors, upgrade the house and survive the raids that keep coming.',
  },
};

export function showChapterEnd(n = 1) {
  const c = CHAPTER_END[n] || CHAPTER_END[1];
  openModal('chapter', `<div class="chapter-card"><div class="ch-num">CHAPTER ${n}</div><h2>${c.title}</h2><div class="ch-done">— COMPLETE —</div>
    <p>${escapeHtml(c.body)}</p>
    <p class="hl">${escapeHtml(c.hook)}</p>
    <p class="small muted">${escapeHtml(c.next)}</p>
    <button class="btn big primary" data-close>Keep playing</button></div>`, { cls: 'small chapter' });
}

export function showChapterStart(n, onGo) {
  const titles = { 2: ['LARCH STREET', 'Millbrook, Ohio — six hundred miles from Pine Hollow.'] };
  const [t, sub] = titles[n] || ['', ''];
  const el = openModal('chapterStart', `<div class="chapter-card"><div class="ch-num">CHAPTER ${n}</div><h2>${t}</h2><p class="muted">${escapeHtml(sub)}</p>
    <p class="small">Your level, skills, money, weapons and gear come with you. Installed lights, alarms and cameras are packed back into your inventory; boards, braces and shutters stay behind.</p>
    <button class="btn big primary" data-go>Begin</button></div>`, { closable: false, cls: 'small chapter' });
  el.querySelector('[data-go]').addEventListener('click', () => { closeModal(); onGo(); });
}

export { input };
