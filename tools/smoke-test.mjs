// Automated acceptance / smoke test. Drives the real game in headless Chromium
// (desktop + iPhone-sized touch layouts) through the whole first chapter and
// checks the acceptance criteria from the design brief.
//
// Usage: npm test   (needs Playwright: `npm i` then `npx playwright install chromium`)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 8000 + Math.floor(Math.random() * 900);
const URL = `http://localhost:${PORT}/`;
const OUT = new globalThis.URL('../test-output/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
// ONLY=v2,v3 npm test runs just those sections.
const want = (name) => !process.env.ONLY || process.env.ONLY.split(',').includes(name);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['tools/serve.mjs', String(PORT)], { stdio: 'ignore' });
await sleep(600);

// The offline cache must list every source file.
{
  const sw = readFileSync(new globalThis.URL('../sw.js', import.meta.url), 'utf8');
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(`${d}/${f}`).isDirectory() ? walk(`${d}/${f}`) : [`${d}/${f}`]));
  const root = new globalThis.URL('..', import.meta.url).pathname;
  const missing = [...walk(root + 'src'), ...walk(root + 'art')].map((f) => f.slice(root.length)).filter((f) => !sw.includes(`"./${f}"`));
  check('Service worker caches every source file (offline play)', missing.length === 0, missing.join(', '));
}

const browser = await chromium.launch();
const errors = [];

function watch(page, label) {
  // The older sections test the classic systems: switch off optional drop-ins and extra conversations there.
  if (!label.startsWith('life') && !label.startsWith('seasons') && !label.startsWith('keystone')) page.addInitScript(() => { window.__cusNoEvents = true; });
  // Everything written before seasons runs in autumn (the season the game starts in), whatever day it reaches.
  if (!label.startsWith('seasons')) page.addInitScript(() => { window.__cusSeason = 'autumn'; });
  // Everything written before the 3D view runs in the classic 2D view (fast, and what it was written for).
  if (!label.startsWith('3d')) page.addInitScript(() => { window.__cus2D = true; });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
}

async function skipDialogues(page, pick = 0) {
  for (let i = 0; i < 40; i++) {
    const state = await page.evaluate(() => {
      const d = document.getElementById('dialogue');
      if (d.classList.contains('hidden') && document.body.classList.contains('cine')) return 'cine';
      if (d.classList.contains('hidden')) return 'none';
      const ch = document.querySelectorAll('#dlg-choices .choice');
      if (ch.length && !document.getElementById('dlg-choices').classList.contains('hidden')) return 'choice';
      return 'text';
    });
    if (state === 'none') return;
    if (state === 'cine') { await page.evaluate(() => window.__cus.dbg.skipCutscene()); await sleep(120); continue; }
    if (state === 'choice') await page.locator('#dlg-choices .choice').nth(pick).click();
    else await page.click('#dlg-skip').catch(() => page.keyboard.press('Space'));
    await sleep(80);
  }
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);

/** Solve the current chapter's rat case: every clue, then accuse the culprit and run them out of town. */
async function solveRat(page) {
  await page.evaluate(() => import('./src/game/rat.js').then((rat) => {
    const { G } = window.__cus; const c = rat.CASES[G.s.chapter]; const t = G.s.time.minute;
    for (const [id, cl] of Object.entries(c.clues)) {
      if (cl.talk) rat.ratTalk({ id: cl.talk });
      else if (cl.point) { G.s.time.minute = cl.hours ? cl.hours[0] * 60 + 30 : 12 * 60; rat.ratPropAction({ rat: id }); }
    }
    G.s.time.minute = t;
  }));
  await skipDialogues(page);
  await page.evaluate(() => import('./src/game/rat.js').then((rat) => rat.ratTalk({ id: rat.CASES[window.__cus.G.s.chapter].culprit })));
  for (let i = 0, picks = 0; i < 40; i++) {
    const st = await page.evaluate(() => { const d = document.getElementById('dialogue'); if (d.classList.contains('hidden')) return 'none'; return document.querySelectorAll('#dlg-choices .choice').length && !document.getElementById('dlg-choices').classList.contains('hidden') ? 'choice' : 'text'; });
    if (st === 'none') break;
    if (st === 'choice') await page.locator('#dlg-choices .choice').nth(picks++ === 0 ? 0 : 1).click(); else await page.click('#dlg-skip').catch(() => {});
    await sleep(90);
  }
  await sleep(300); await skipDialogues(page);
}
/** Phase B ("make it home"): three different everyday moments. */
async function passLife(page) {
  await page.evaluate(() => { const e = window.__cus.G.events; e.emit('cooked', 'stew'); e.emit('gift', 'x'); e.emit('supper'); });
  await sleep(1200); await skipDialogues(page); await sleep(400); await skipDialogues(page);
}
/** Phase C/D: look into the watcher signs, survive the probe, inspect what they left. */
async function passWatch(page) {
  const sign = () => page.evaluate(() => Promise.all([import('./src/game/watch.js'), import('./src/game/npcs.js'), import('./src/data/watch.js')]).then(([w, n, d]) => {
    const c = window.__cus, G = c.G; const W = d.WATCH[G.s.chapter]; if (!w.inWatch()) return 'done';
    const found = G.s.life.ch[G.s.chapter].watch.found;
    const [id, sg] = Object.entries(W.signs).find(([k]) => !found[k]);
    if (G.map.id !== c.dbg.homeMapId()) c.loadMap(c.dbg.homeMapId());
    if (sg.visitor) { G.s.time.minute = sg.visitor.hours[0] * 60 + 30; c.loadMap(G.map.id); const v = G.npcs.find((x) => x.watchSign === id); n.interactNpc(v); }
    else if (sg.talk) { G.s.time.minute = 12 * 60; c.loadMap(G.map.id); w.visitorTalk({ watchSign: id }); }
    else w.watchPropAction(w.watchProps(G.map.id).find((p) => p.watch === id));
    return id;
  }));
  for (let i = 0; i < 4; i++) { const r = await sign(); await sleep(150); await skipDialogues(page); await sleep(500); await skipDialogues(page); if (r === 'done') break; }
  await page.evaluate(() => { const c = window.__cus; const sg = c.G.s.world.siege; if (!sg) return; c.G.s.time.day = sg.day; c.G.s.time.minute = sg.minute - 2; c.loadMap(c.dbg.homeMapId()); const p = c.G.map.points.cabin_in; c.G.player.x = p.x; c.G.player.y = p.y; c.G.player.invuln = 99999; });
  for (let i = 0; i < 100 && !(await page.evaluate(() => window.__cus.G.siegeActive)); i++) await sleep(100);
  for (let i = 0; i < 200; i++) { await sleep(150); await page.evaluate(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); if (c.G.siege) c.G.siege.t += 30; for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); if (!(await page.evaluate(() => window.__cus.G.siegeActive))) break; }
  await sleep(2400); await page.locator('#modal-root button', { hasText: 'Continue' }).click().catch(() => {}); await sleep(3200); await skipDialogues(page);
  await page.evaluate(() => import('./src/game/watch.js').then((w) => { const p = w.watchProps(window.__cus.G.map.id).find((x) => x.watch === '_after'); if (p) w.watchPropAction(p); }));
  await sleep(200); await skipDialogues(page); await sleep(500); await skipDialogues(page);
  await page.evaluate(() => { window.__cus.G.player.invuln = 0; });
}

const tp = (page, x, y, map) => ev(page, ([x, y, map]) => {
  const c = window.__cus; if (map && c.G.map.id !== map) c.loadMap(map);
  c.G.player.x = x * 32; c.G.player.y = y * 32;
}, [x, y, map]);
const setTime = (page, minute, day) => ev(page, ([m, d]) => { const t = window.__cus.G.s.time; t.minute = m; if (d) t.day = d; }, [minute, day]);
const step = (page) => ev(page, () => window.__cus.G.s.story.step);
async function pressE(page, times = 1) { for (let i = 0; i < times; i++) { await page.keyboard.press('KeyE'); await sleep(140); } }
async function faceTo(page, x, y) { await ev(page, ([x, y]) => { if (window.__cus.dbg && window.__cus.dbg.input) window.__cus.dbg.input.mouse.inside = false; const p = window.__cus.G.player; p.angle = Math.atan2(y * 32 - p.y, x * 32 - p.x); }, [x, y]); }

/* ================================================================== */
/* Desktop run: the whole chapter                                      */
/* ================================================================== */
if (want('desktop')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(URL);
  await page.waitForSelector('#t-new');
  await page.click('#t-new');
  await sleep(250);
  check('New game asks for a difficulty (Story / Normal / Hard)', await page.isVisible('[data-diff-pick="story"]') && await page.isVisible('[data-diff-pick="hard"]'));
  await page.click('[data-diff-pick="normal"]');
  await sleep(500);
  check('1. New game starts with intro + controls tip', await page.isVisible('#dialogue') && await page.isVisible('#hud'));
  await skipDialogues(page);
  await page.keyboard.press('KeyH'); await sleep(60);
  await sleep(150);
  check('1b. Help menu lists controls', (await page.textContent('#modal-root')).includes('WASD'));
  await page.keyboard.press('Escape'); await sleep(60);
  await sleep(100);

  // Movement with the keyboard
  const before = await ev(page, () => ({ x: window.__cus.G.player.x, y: window.__cus.G.player.y }));
  await page.keyboard.down('KeyW'); await sleep(500); await page.keyboard.up('KeyW');
  const after = await ev(page, () => ({ x: window.__cus.G.player.x, y: window.__cus.G.player.y }));
  check('Desktop WASD movement', after.y < before.y - 20, `moved ${Math.round(before.y - after.y)}px`);

  // Enter the cabin through the front door
  await tp(page, 24.5, 27.6);
  await faceTo(page, 24.5, 26.5);
  await sleep(100);
  await pressE(page); // open door
  check('Doors open with interact', await ev(page, () => window.__cus.G.s.home.openings.front_door.open));
  await page.keyboard.down('KeyW'); await sleep(700); await page.keyboard.up('KeyW');
  await sleep(200);
  await skipDialogues(page);
  check('Story: entering cabin -> meet Ruth', (await step(page)) === 'meet_ruth', await step(page));
  await page.screenshot({ path: OUT + 'desktop-interior.png' });

  // Meet Ruth (garden at day)
  await tp(page, 42, 31.4);
  await sleep(500);
  const ruthPos = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.id === 'ruth'); return { x: r.x / 32, y: r.y / 32 }; });
  await tp(page, ruthPos.x - 1, ruthPos.y);
  await faceTo(page, ruthPos.x, ruthPos.y);
  await sleep(150);
  await pressE(page);
  await skipDialogues(page);
  check('Story: talk to Ruth -> settle in: five chores (+bandages)', (await step(page)) === 'settle_in' && (await ev(page, () => window.__cus.G.s.inv.bandage)) >= 4 && await ev(page, () => Object.keys(window.__cus.G.s.errands).length === 5));
  const hammerGame = async () => {
    for (let i = 0; i < 400 && await page.isVisible('.rg-hit').catch(() => false); i++) {
      const inZone = await ev(page, () => { const z = document.querySelector('.rg-zone'), n = document.querySelector('.rg-needle'); if (!z || !n) return false; const l = parseFloat(z.style.left), w = parseFloat(z.style.width), p = parseFloat(n.style.left); return p > l + 1 && p < l + w - 1; });
      if (inZone) await page.locator('.rg-hit').dispatchEvent('pointerdown');
      await sleep(15);
    }
    await sleep(250);
  };
  // The fallen pine blocks the car until it's cut up.
  await tp(page, 24, 32.5, 'cabin'); await faceTo(page, 26, 32.5); await sleep(200);
  check('Ch1: a fallen pine blocks the driveway (no driving yet)', /fallen pine/i.test(await ev(page, () => (window.__cus.G.interactTarget || {}).label || '')));
  await tp(page, 24.5, 35.4); await faceTo(page, 24.5, 36.5); await sleep(150);
  for (let i = 0; i < 7; i++) { await ev(page, () => { window.__cus.G.player.stamina = 100; }); await pressE(page); }
  await skipDialogues(page);
  check('Chore: clear the driveway (6 axe swings)', await ev(page, () => window.__cus.G.s.errands.chore_drive.state === 'done'));
  // Ruth's ten logs
  await ev(page, () => window.__cus.dbg.addItem('wood', 10, true));
  const ruthL = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.id === 'ruth'); return { x: r.x / 32, y: r.y / 32 }; });
  await tp(page, ruthL.x - 1, ruthL.y); await faceTo(page, ruthL.x, ruthL.y); await sleep(150);
  await pressE(page); await sleep(200); await skipDialogues(page);
  check('Chore: "A Cold Night" — bring Ruth 10 logs', await ev(page, () => window.__cus.G.s.errands.chore_logs.state === 'done'));
  // The sticking back door (repair minigame)
  await tp(page, 24.5, 19.2, 'cabin'); await faceTo(page, 24.5, 17.5); await sleep(200);
  await pressE(page); await sleep(200); await hammerGame(); await skipDialogues(page);
  check('Chore: fix the sticking back door (minigame)', await ev(page, () => window.__cus.G.s.errands.chore_door.state === 'done'));
  check('Story: still settling in (3 of 4 chores)', (await step(page)) === 'settle_in');

  // Drive to town
  await tp(page, 24, 32.5, 'cabin');
  await faceTo(page, 26, 32.5);
  await sleep(150);
  await pressE(page);
  await sleep(2000);
  await skipDialogues(page);
  check('2. Travel cabin -> town by car', (await ev(page, () => window.__cus.G.map.id)) === 'town');
  await page.screenshot({ path: OUT + 'desktop-town.png' });
  // Stock the pantry at Dee's
  await setTime(page, 9 * 60); await sleep(300);
  await tp(page, 13, 15); await faceTo(page, 13, 14); await sleep(150);
  await pressE(page); await sleep(200);
  for (let i = 0; i < 3; i++) { await page.click('[data-buy="sandwich"]'); await sleep(80); }
  await page.keyboard.press('Escape'); await sleep(200); await skipDialogues(page); await sleep(200); await skipDialogues(page);
  check('Chore: stock the pantry (buy 3 groceries)', await ev(page, () => window.__cus.G.s.errands.chore_pantry.state === 'done'));
  check('Story: four chores -> find work', (await step(page)) === 'find_work');

  // Talk to Gus
  await sleep(300);
  const gus = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.id === 'gus'); return { x: r.x / 32, y: r.y / 32 }; });
  await tp(page, gus.x - 1, gus.y);
  await faceTo(page, gus.x, gus.y);
  await sleep(150);
  await pressE(page);
  await skipDialogues(page);
  check('Story: meet Gus -> earn the town\'s trust', (await step(page)) === 'town_trust');

  // ---- Job 1: woodcutting (real chopping at the woodlot) ----
  const money0 = await ev(page, () => window.__cus.G.s.money);
  const xp0 = await ev(page, () => window.__cus.G.s.stats.xp + window.__cus.G.s.stats.level * 1000);
  await tp(page, 48.5, 22.4);
  await faceTo(page, 48.5, 23);
  await sleep(150);
  await pressE(page);
  await sleep(200);
  check('Job board opens', await page.isVisible('[data-accept="woodcut"]'));
  await page.click('[data-accept="woodcut"]');
  await sleep(150);
  const need = await ev(page, () => window.__cus.G.s.job && window.__cus.G.s.job.need);
  check('Woodcutting job accepted', !!need, `need ${need}`);
  // find a standing tree in the woodlot and chop it for real
  const tree = await ev(page, () => { const m = window.__cus.G.map; for (const t of m.trees.values()) if (!t.chopped && t.cx >= 59 && t.cy > 24 && t.cy < 40) { const free = !m.blocksMove(t.cx - 1, t.cy, 'player'); if (free) return { cx: t.cx, cy: t.cy }; } return null; });
  const wood0 = await ev(page, () => window.__cus.G.s.inv.wood || 0);
  await tp(page, tree.cx - 0.5, tree.cy + 0.5);
  await faceTo(page, tree.cx + 0.5, tree.cy + 0.5);
  await sleep(150);
  await pressE(page, 3);
  const wood1 = await ev(page, () => window.__cus.G.s.inv.wood || 0);
  check('Chopping a tree yields wood', wood1 >= wood0 + 2, `${wood0} -> ${wood1}`);
  await ev(page, (n) => { window.__cus.dbg.addItem('wood', n, true); }, need);
  const pr = await ev(page, () => { const p = window.__cus.G.map.props.find((x) => x.id === 'logdrop'); return { x: p.x / 32, y: p.y / 32 }; });
  await tp(page, pr.x, pr.y - 0.2);
  await sleep(150);
  await pressE(page);
  await sleep(300);
  const money1 = await ev(page, () => window.__cus.G.s.money);
  check('3a. Woodcutting job pays money', money1 > money0, `$${money0} -> $${money1}`);
  await skipDialogues(page);
  check('Story: jobs count toward the town\'s trust', /1\/3/.test(await ev(page, () => document.getElementById('objective').textContent)) || (await step(page)) === 'town_trust');

  // ---- Job 2: delivery ----
  await setTime(page, 10 * 60);
  await tp(page, 48.5, 22.4);
  await pressE(page);
  await sleep(150);
  await page.click('[data-accept="delivery"]');
  await sleep(150);
  await tp(page, 13, 15);
  await faceTo(page, 13, 14);
  await sleep(150);
  await pressE(page);
  await sleep(150);
  await skipDialogues(page);
  check('Delivery: picked up parcel at counter', (await ev(page, () => window.__cus.G.s.job.stage)) === 'deliver');
  const target = await ev(page, () => { const t = window.__cus.G.maps.town.deliveryTargets[window.__cus.G.s.job.target]; return { x: t.x / 32, y: t.y / 32 }; });
  await tp(page, target.x, target.y + 0.3);
  await sleep(200);
  const m2 = await ev(page, () => window.__cus.G.s.money);
  await pressE(page);
  await sleep(300);
  check('3b. Delivery job completes and pays', (await ev(page, () => window.__cus.G.s.money)) > m2 && !(await ev(page, () => window.__cus.G.s.job)));

  // ---- Job 3: repair (with the timing minigame) ----
  await tp(page, 48.5, 22.4);
  await pressE(page);
  await sleep(150);
  await page.click('[data-accept="repair"]');
  await sleep(150);
  await tp(page, 55.5, 33);
  await faceTo(page, 55.5, 34);
  await sleep(150);
  await pressE(page);
  await sleep(150);
  check('Repair: collected materials at shed', (await ev(page, () => window.__cus.G.s.job.stage)) === 'fix');
  const rt = await ev(page, () => { const t = window.__cus.G.maps.town.repairTargets[window.__cus.G.s.job.target]; return { x: t.x / 32, y: t.y / 32 }; });
  await tp(page, rt.x, rt.y + 0.6);
  await sleep(200);
  const m3 = await ev(page, () => window.__cus.G.s.money);
  await pressE(page);
  await sleep(200);
  check('Repair minigame opens', await page.isVisible('.rg-hit'));
  for (let i = 0; i < 400 && await page.isVisible('.rg-hit').catch(() => false); i++) {
    const inZone = await ev(page, () => {
      const z = document.querySelector('.rg-zone'), n = document.querySelector('.rg-needle');
      if (!z || !n) return false;
      const l = parseFloat(z.style.left), w = parseFloat(z.style.width), p = parseFloat(n.style.left);
      return p > l + 1 && p < l + w - 1;
    });
    if (inZone) await page.locator('.rg-hit').dispatchEvent('pointerdown');
    await sleep(15);
  }
  await sleep(300);
  check('3c. Repair job completes and pays', (await ev(page, () => window.__cus.G.s.money)) > m3 && !(await ev(page, () => window.__cus.G.s.job)));
  const xp1 = await ev(page, () => window.__cus.G.s.stats.xp + window.__cus.G.s.stats.level * 1000);
  check('4a. Character XP increases from jobs', xp1 > xp0);
  check('4b. Level up happened and granted attribute points', (await ev(page, () => window.__cus.G.s.stats.level)) >= 2 && (await ev(page, () => window.__cus.G.s.stats.attrPoints)) >= 2,
    `level ${await ev(page, () => window.__cus.G.s.stats.level)}`);

  // ---- Townsfolk errands: Pastor Abe's pies and Old Man Tibbs's firewood ----
  check('Story: three jobs alone aren\'t enough — help the townsfolk too', (await step(page)) === 'town_trust');
  const folk = async (id) => { await ev(page, (id) => { const c = window.__cus; const d = c.G.npcs.find((n) => n.id === id); c.G.player.x = d.x; c.G.player.y = d.y + 22; c.G.player.angle = -Math.PI / 2; d.idleT = 30; c.dbg.input.mouse.inside = false; }, id); await sleep(200); await pressE(page); await sleep(200); await skipDialogues(page, 0); };
  await setTime(page, 10 * 60); await sleep(200);
  await folk('folk2');
  check('Townsfolk offer errands (Pastor Abe\'s bake sale)', await ev(page, () => (window.__cus.G.s.errands.abe_pies || {}).state === 'active'));
  await tp(page, 12.5, 17.2); await faceTo(page, 12.5, 16.4); await sleep(200); await pressE(page); await sleep(200); await skipDialogues(page);
  await tp(page, 39.5, 19.4); await faceTo(page, 39.5, 18.6); await sleep(200); await pressE(page); await sleep(200); await skipDialogues(page);
  check('Errand: carry the pies to the chapel', await ev(page, () => window.__cus.G.s.errands.abe_pies.state === 'done'));
  await folk('folk11');
  await tp(page, 31.5, 32.4); await faceTo(page, 31.5, 31.5); await sleep(200);
  for (let i = 0; i < 11; i++) { await ev(page, () => { window.__cus.G.player.stamina = 100; }); await pressE(page); }
  await skipDialogues(page);
  await folk('folk11'); await sleep(300); await skipDialogues(page);
  check('Errand: split Old Man Tibbs\'s firewood -> make Pine Hollow home', await ev(page, () => window.__cus.G.s.errands.tibbs_wood.state === 'done') && (await step(page)) === 'ch1_life', await step(page));
  // Phase B: a few everyday moments (here: a meal, a gift, Sunday supper) and the story moves on.
  await ev(page, () => { const e = window.__cus.G.events; e.emit('cooked', 'stew'); e.emit('gift', 'dee'); e.emit('supper'); });
  await sleep(1200); await skipDialogues(page); await sleep(400); await skipDialogues(page);
  check('Story: three everyday moments -> go home and sleep', (await step(page)) === 'rest', await step(page));
  // Next morning at the cabin: boot prints, the hunting blind.
  await ev(page, () => { const c = window.__cus; c.G.s.time.day += 1; c.G.s.time.minute = 7 * 60; });
  await tp(page, 24.5, 30, 'cabin'); await sleep(700); await skipDialogues(page);
  check('Story: the next morning, Ruth finds boot prints', (await step(page)) === 'trail');
  await tp(page, 19.5, 29.4); await faceTo(page, 19.5, 28.6); await sleep(200); await pressE(page); await sleep(200); await skipDialogues(page);
  await tp(page, 9.5, 8.4); await faceTo(page, 9.5, 7.5); await sleep(200); await pressE(page); await sleep(200); await skipDialogues(page); await sleep(300); await skipDialogues(page);
  check('Story: follow the trail to a hunting blind -> see Dee', (await step(page)) === 'see_dee');
  await page.screenshot({ path: OUT + 'desktop-blind.png' });
  await tp(page, 12, 20, 'town');

  // ---- Story: Dee & the stranger ----
  await setTime(page, 11 * 60);
  await sleep(200);
  const dee = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.id === 'dee'); const pt = window.__cus.G.map.points.dee_store; r.x = pt.x; r.y = pt.y; r.path = null; r.spot = 'dee_store'; return { x: r.x / 32, y: r.y / 32 }; });
  await tp(page, dee.x, dee.y + 1.9);
  await faceTo(page, dee.x, dee.y);
  await sleep(150);
  await pressE(page);
  await skipDialogues(page);
  if (process.env.DEBUG) console.log('dee', await step(page), await ev(page, () => JSON.stringify({ m: window.__cus.G.map.id, t: window.__cus.G.s.time, modal: window.__cus.G.modal, tgt: (window.__cus.G.interactTarget || {}).label })));
  check('Story: Dee -> stranger', (await step(page)) === 'stranger');
  await sleep(200);
  const st = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.stranger); return r && r.present ? { x: r.x / 32, y: r.y / 32 } : null; });
  check('Stranger appears in town', !!st);
  await tp(page, st.x - 1, st.y);
  await faceTo(page, st.x, st.y);
  await sleep(150);
  await pressE(page);
  await skipDialogues(page, 0); // "Never heard of him" — Shadow JP
  await sleep(200);
  await skipDialogues(page);
  check('Story: stranger -> a probe attack tonight (+2 board kits)', (await step(page)) === 'probe' && (await ev(page, () => window.__cus.G.s.inv.board_kit)) >= 2 && await ev(page, () => window.__cus.G.s.world.siege && window.__cus.G.s.world.siege.plan.kind === 'probe'));

  // ---- Shopping ----
  await tp(page, 13, 15);
  await faceTo(page, 13, 14);
  await sleep(150);
  await pressE(page);
  await sleep(200);
  const ammo0 = await ev(page, () => window.__cus.G.s.inv.ammo || 0);
  const mBuy = await ev(page, () => window.__cus.G.s.money);
  await page.click('[data-buy="ammo"]');
  await page.click('[data-buy="bandage"]');
  await sleep(100);
  check('7a. Buy supplies at the store', (await ev(page, () => window.__cus.G.s.inv.ammo)) === ammo0 + 12 && (await ev(page, () => window.__cus.G.s.money)) < mBuy);
  await page.click('[data-mode="sell"]');
  await sleep(100);
  check('Shop has a sell tab', (await page.locator('[data-sell]').count()) > 0);
  await page.keyboard.press('Escape'); await sleep(60);
  await ev(page, () => { window.__cus.G.s.money += 300; });
  await tp(page, 49, 30);
  await sleep(150);
  const gus2 = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.id === 'gus'); return { x: r.x / 32, y: r.y / 32 }; });
  await tp(page, gus2.x - 1, gus2.y);
  await faceTo(page, gus2.x, gus2.y);
  await sleep(150);
  await pressE(page);
  await sleep(200);
  await page.click('[data-npc="shop"]');
  await sleep(150);
  for (const id of ['door_brace', 'sandbags', 'alarm_kit']) await page.click(`[data-buy="${id}"]`);
  check('7b. Buy defensive upgrades at the hardware store', await ev(page, () => ['door_brace', 'sandbags', 'alarm_kit'].every((k) => window.__cus.G.s.inv[k] >= 1)));
  await page.keyboard.press('Escape'); await sleep(60);

  // Drive home
  await tp(page, 5.8, 16.5, 'town');
  await faceTo(page, 4, 16.5);
  await sleep(150);
  await pressE(page);
  await sleep(2000);
  await skipDialogues(page);
  check('2b. Travel town -> cabin by car', (await ev(page, () => window.__cus.G.map.id)) === 'cabin');

  // ---- The probe: two scouts test the cabin ----
  await ev(page, () => { const c = window.__cus; c.G.player.x = 24.5 * 32; c.G.player.y = 24 * 32; c.G.player.invuln = 99999; c.G.s.time.minute = 22 * 60 + 58; });
  for (let i = 0; i < 80 && !(await ev(page, () => window.__cus.G.siegeActive)); i++) await sleep(150);
  check('Ch1: two scouts test the cabin at night', await ev(page, () => window.__cus.G.siegeActive && window.__cus.G.siege.plan.kind === 'probe'));
  for (let i = 0; i < 100; i++) { await sleep(200); await ev(page, () => { const c = window.__cus; for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); if (!(await ev(page, () => window.__cus.G.siegeActive))) break; }
  await sleep(2400); await ev(page, () => window.__cus.dbg.closeAll()); await sleep(700); await skipDialogues(page);
  check('Story: probe survived -> prepare', (await step(page)) === 'prepare');
  await ev(page, () => { const c = window.__cus; c.G.player.invuln = 0; c.G.s.time.day += 1; c.G.s.time.minute = 10 * 60; });
  // Lessons: first aid from Ruth, carpentry from Gus; Harold's watch for the rifle.
  const heal0 = await ev(page, () => window.__cus.dbg.derived().healMult);
  const r3 = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.id === 'ruth'); return { x: r.x / 32, y: r.y / 32 }; });
  await tp(page, r3.x - 1, r3.y); await faceTo(page, r3.x, r3.y); await sleep(150); await pressE(page); await sleep(200); await skipDialogues(page);
  check('Ch1: Ruth teaches first aid (+15% healing)', (await ev(page, () => window.__cus.dbg.derived().healMult)) > heal0 && await ev(page, () => (window.__cus.G.s.quests.ruth_watch || {}).state === 'active'));
  await ev(page, () => { window.__cus.G.s.quests.ruth_watch.state = 'return'; });
  await pressE(page); await sleep(200); await skipDialogues(page);
  check('Ch1: Harold\'s watch -> Harold\'s rifle', await ev(page, () => window.__cus.G.s.inv.rifle === 1));
  await tp(page, 48, 29, 'town'); await sleep(300);
  const g3 = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.id === 'gus'); return { x: r.x / 32, y: r.y / 32 }; });
  await tp(page, g3.x - 1, g3.y); await faceTo(page, g3.x, g3.y); await sleep(150); await pressE(page); await sleep(200); await skipDialogues(page); await sleep(300); await skipDialogues(page);
  check('Ch1: Gus teaches carpentry -> find the rat', (await step(page)) === 'ch1_rat' && await ev(page, () => window.__cus.G.s.unlocks.carpentry));
  // The rat: Dee's tip, Henderson's trash, Tibbs's story — then run Henderson out of town.
  const ratTalk = (id) => ev(page, (id) => import('./src/game/rat.js').then((m) => m.ratTalk({ id })), id);
  await ratTalk('dee'); await skipDialogues(page);
  await ev(page, () => import('./src/game/rat.js').then((m) => m.ratPropAction({ rat: 'trash' }))); await skipDialogues(page);
  await ratTalk('folk11'); await skipDialogues(page);
  await ratTalk('folk1');
  for (let i = 0, picks = 0; i < 40; i++) {
    const st = await ev(page, () => { const d = document.getElementById('dialogue'); if (d.classList.contains('hidden')) return 'none'; return document.querySelectorAll('#dlg-choices .choice').length && !document.getElementById('dlg-choices').classList.contains('hidden') ? 'choice' : 'text'; });
    if (st === 'none') break;
    if (st === 'choice') await page.locator('#dlg-choices .choice').nth(picks++ === 0 ? 0 : 1).click(); else await page.click('#dlg-skip').catch(() => {});
    await sleep(90);
  }
  await sleep(300); await skipDialogues(page);
  check('Ch1: the rat is run out of town -> fortify (3 defenses)', (await step(page)) === 'reinforce' && await ev(page, () => window.__cus.G.s.choices.rat === 'expose' && !window.__cus.G.npcs.some((n) => n.id === 'folk1')));
  await tp(page, 24.5, 30, 'cabin'); await sleep(200);

  // ---- Reinforce the cabin ----
  await setTime(page, 14 * 60);
  await tp(page, 20.5, 27.6);
  await faceTo(page, 20.5, 26.5);
  await sleep(150);
  await pressE(page);
  await sleep(200);
  await skipDialogues(page);
  check('7c. Board up a window', await ev(page, () => window.__cus.G.s.home.openings.win_fl.boards));
  await tp(page, 24.5, 16.2);
  await faceTo(page, 24.5, 17.5);
  await sleep(150);
  await pressE(page);
  await sleep(200);
  const hasOpts = await page.isVisible('[data-opt]');
  if (hasOpts) { const n = await page.locator('[data-opt]').count(); for (let i = 0; i < n; i++) { const t = await page.locator('[data-opt]').nth(i).textContent(); if (t.includes('Brace')) { await page.locator('[data-opt]').nth(i).click(); break; } } }
  await sleep(150);
  check('7d. Reinforce a door with a brace', await ev(page, () => window.__cus.G.s.home.openings.back_door.reinforced));
  // place sandbags from the inventory
  await tp(page, 24.5, 31);
  await ev(page, () => { window.__cus.G.player.angle = Math.PI; });
  await page.keyboard.press('KeyI'); await sleep(60);
  await sleep(150);
  await page.click('[data-act="place"][data-id="sandbags"]');
  await sleep(150);
  check('7e. Place sandbag cover', await ev(page, () => window.__cus.G.s.home.covers.length === 1));
  await skipDialogues(page);
  check('Story: three defenses -> the first siege is scheduled', (await step(page)) === 'first_siege' && await ev(page, () => !!window.__cus.G.s.world.siege && window.__cus.G.s.world.siege.plan.kind === 'story'));
  await page.keyboard.press('KeyI'); await sleep(60);
  await sleep(150);
  await page.click('[data-act="install"][data-id="alarm_kit"]');
  await sleep(100);
  check('7f. Install tripwire alarm', await ev(page, () => window.__cus.G.s.home.upgrades.alarm));
  await page.keyboard.press('KeyV'); await sleep(60);
  await sleep(150);
  check('Home tab shows defenses and repair costs', (await page.textContent('#modal-root')).includes('Front Door'));
  await page.screenshot({ path: OUT + 'desktop-home-tab.png' });
  await page.keyboard.press('Escape'); await sleep(60);

  // ---- First story siege ----
  await tp(page, 24.5, 22);
  await setTime(page, 21 * 60 + 40);
  await sleep(600);
  check('Siege warning appears before the attack', await ev(page, () => window.__cus.G.s.world.siege && window.__cus.G.s.world.siege.warned));
  for (let i = 0; i < 80 && !(await ev(page, () => window.__cus.G.siegeActive)); i++) await sleep(150);
  check('9a. Story siege starts at night', await ev(page, () => window.__cus.G.siegeActive));
  await ev(page, () => { window.__cus.G.player.invuln = 999; });
  // let attackers approach and work on the doors/windows
  await sleep(2500);
  await ev(page, () => { const G = window.__cus.G; for (const e of G.enemies) if (!e.dead) { e.x = 24.5 * 32 + (Math.random() - 0.5) * 60; e.y = 28.5 * 32; e.alerted = false; } G.player.x = 24.5 * 32; G.player.y = 21 * 32; });
  await ev(page, () => { window.__cus.G.s.home.openings.front_door.open = false; });
  await sleep(3500);
  await page.screenshot({ path: OUT + 'desktop-siege.png' });
  const dmg = await ev(page, () => { const o = window.__cus.G.s.home.openings; return Object.values(o).some((x) => (x.kind === 'door' && x.hp < 100) || (x.kind === 'window' && (x.glass < 20 || (x.boards && x.boardHp < 90)))); });
  check('8a. Attackers damage doors/windows', dmg);
  // fight: shoot at enemies with real mouse clicks until a few are down, then finish the rest
  const shotsBefore = await ev(page, () => window.__cus.G.player.mag + (window.__cus.G.s.inv.ammo || 0));
  for (let i = 0; i < 25; i++) {
    const t = await ev(page, () => { const G = window.__cus.G; const e = G.enemies.find((x) => !x.dead && !x.gone); if (!e) return null; const c = G.camera; return { x: (e.x - c.x) * c.zoom + G.view.w / 2, y: (e.y - c.y) * c.zoom + G.view.h / 2 }; });
    if (!t) break;
    await page.mouse.move(t.x, t.y);
    await page.mouse.down(); await sleep(60); await page.mouse.up();
    await sleep(220);
  }
  const shotsAfter = await ev(page, () => window.__cus.G.player.mag + (window.__cus.G.s.inv.ammo || 0));
  check('Mouse aim + click fires the handgun', shotsAfter < shotsBefore);
  for (let i = 0; i < 120; i++) {
    const done = await ev(page, () => {
      const G = window.__cus.G; const c = window.__cus;
      for (const e of G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 999, 0, 'bullet');
      if (G.siege) G.siege.t += 3; // fast-forward the wave timer
      return !G.siegeActive;
    });
    if (done) break;
    await sleep(250);
  }
  check('9b. Story siege can be completed', !(await ev(page, () => window.__cus.G.siegeActive)) && await ev(page, () => window.__cus.G.s.story.flags.firstSiegeDone));
  await sleep(2500);
  if (await page.isVisible('.modal [data-close]')) await page.keyboard.press('Escape'); await sleep(60);
  await sleep(1800);
  await skipDialogues(page);
  // pick up the note
  const note = await ev(page, () => { const p = window.__cus.G.pickups.find((x) => x.kind === 'note'); return p ? { x: p.x / 32, y: p.y / 32 } : null; });
  check('Clue (note) dropped after siege', !!note || (await ev(page, () => window.__cus.G.s.story.flags.notePending || window.__cus.G.s.story.flags.noteRead)));
  if (note) { await tp(page, note.x, note.y); await sleep(800); }
  await sleep(2800);
  await skipDialogues(page);
  check('Story: note -> show Ruth', (await step(page)) === 'show_ruth', await step(page));

  // repair a damaged opening
  await ev(page, () => { window.__cus.dbg.addItem('wood', 10, true); window.__cus.G.s.home.openings.front_door.hp = 40; window.__cus.G.s.home.openings.front_door.open = false; window.__cus.G.player.invuln = 0; });
  await setTime(page, 9 * 60, (await ev(page, () => window.__cus.G.s.time.day)) + 1);
  await tp(page, 24.5, 27.6);
  await faceTo(page, 24.5, 26.5);
  await sleep(150);
  await pressE(page);
  await sleep(200);
  if (await page.isVisible('[data-opt]')) {
    const n = await page.locator('[data-opt]').count();
    for (let i = 0; i < n; i++) { const t = await page.locator('[data-opt]').nth(i).textContent(); if (t.includes('Repair')) { await page.locator('[data-opt]').nth(i).click(); break; } }
  }
  await sleep(2800);
  check('8b. Damaged door can be repaired (costs wood)', (await ev(page, () => window.__cus.G.s.home.openings.front_door.hp)) >= 100);

  // Ruth & the phone call -> chapter end
  await sleep(300);
  const ruth2 = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.id === 'ruth'); return { x: r.x / 32, y: r.y / 32 }; });
  await tp(page, ruth2.x - 1, ruth2.y);
  await faceTo(page, ruth2.x, ruth2.y);
  await sleep(150);
  await pressE(page);
  await skipDialogues(page);
  check('Story: Ruth -> phone call', (await step(page)) === 'phone_call');
  await ev(page, () => { window.__cus.G.s.home.openings.front_door.open = true; });
  await tp(page, 26.5, 19.3);
  await faceTo(page, 26.5, 18.4);
  await sleep(150);
  await pressE(page);
  await skipDialogues(page);
  await sleep(200);
  check('11. Chapter 1 ends with a proper ending screen', (await page.textContent('#modal-root')).includes('COMPLETE') && await ev(page, () => window.__cus.G.s.story.chapterComplete));
  await page.screenshot({ path: OUT + 'desktop-chapter-end.png' });
  await page.keyboard.press('Escape'); await sleep(60);
  await sleep(150);

  // ---- Attributes ----
  await page.keyboard.press('KeyC'); await sleep(60);
  await sleep(150);
  const hp0 = await ev(page, () => window.__cus.dbg.derived().maxHp);
  await page.click('[data-act="attr"][data-id="vit"]');
  await sleep(100);
  check('Attribute points raise stats (Vitality -> max HP)', (await ev(page, () => window.__cus.dbg.derived().maxHp)) === hp0 + 12);
  await page.keyboard.press('Escape'); await sleep(60);

  // ---- JP in all 5 paths ----
  const jp = await ev(page, () => window.__cus.G.s.jpEarned);
  check('5. All five JP paths have earned points', Object.values(jp).every((v) => v > 0), JSON.stringify(jp));

  // ---- Buy 2 skills per path through the UI and verify effects ----
  await ev(page, () => { for (const k of Object.keys(window.__cus.G.s.jp)) window.__cus.G.s.jp[k] += 120; });
  const d0 = await ev(page, () => window.__cus.dbg.derived());
  const want = ['resourceful', 'field_recovery', 'steady_hands', 'quick_reload', 'efficient_repairs', 'quick_fix', 'familiar_face', 'local_discount', 'keen_eye', 'escape_artist'];
  await page.keyboard.press('KeyK'); await sleep(60);
  await sleep(150);
  for (const id of want) {
    await page.click(`[data-act="skill"][data-id="${id}"]`);
    await sleep(60);
    await page.click('[data-yes]');
    await sleep(60);
  }
  await page.keyboard.press('Escape'); await sleep(60);
  const d1 = await ev(page, () => window.__cus.dbg.derived());
  const learned = await ev(page, () => window.__cus.G.s.skills);
  check('6a. Two skills learned in each path via the UI', want.every((w) => learned.includes(w)), learned.join(','));
  check('6b. Skills change gameplay values', d1.reloadTime < d0.reloadTime && d1.spreadMult < d0.spreadMult && d1.healMult > d0.healMult && d1.woodBonus > d0.woodBonus && d1.repairSpeed > d0.repairSpeed && d1.seeRadius > d0.seeRadius && d1.dodgeCost < d0.dodgeCost,
    `reload ${d0.reloadTime.toFixed(2)}->${d1.reloadTime.toFixed(2)}`);
  check('6c. Local Discount affects shop prices', await ev(page, () => { window.__cus.loadMap('town'); return true; }) && (await (async () => {
    await tp(page, 13, 15); await faceTo(page, 13, 14); await setTime(page, 10 * 60); await sleep(200); await pressE(page); await sleep(200);
    const txt = await page.textContent('[data-buy="medkit"]'); await page.keyboard.press('Escape'); return txt.includes('$27') || txt.includes('$26') || txt.includes('$25') || txt.includes('$24');
  })()));

  // ---- Repeatable play after the chapter ----
  check('12. Repeatable jobs still offered after chapter', await ev(page, () => { window.__cus.G.s.world.board = null; return true; }) && await (async () => { await tp(page, 48.5, 22.4); await pressE(page); await sleep(150); const n = await page.locator('[data-accept]').count(); await page.keyboard.press('Escape'); return n >= 3; })());
  await ev(page, () => { const w = window.__cus.G.s.world; w.siege = null; w.threat = 100; w.quietUntilDay = 0; });
  const dayBefore = await ev(page, () => window.__cus.G.s.time.day);
  await setTime(page, 23 * 60 + 58);
  await sleep(1500); // clock crosses midnight...
  await setTime(page, 5 * 60 + 58);
  await sleep(1500); // ...and dawn, which runs the daily threat/raid roll
  const sched = await ev(page, (d) => window.__cus.G.s.time.day === d + 1 && window.__cus.G.s.world.lastDayProcessed === d + 1, dayBefore);
  check('12b. Dawn processing runs (random raids can be scheduled)', sched);

  // ---- Defeat & recovery ----
  await tp(page, 24.5, 30, 'cabin');
  await setTime(page, 23 * 60);
  const pre = await ev(page, () => ({ money: window.__cus.G.s.money, level: window.__cus.G.s.stats.level, skills: window.__cus.G.s.skills.length, step: window.__cus.G.s.story.step }));
  await ev(page, () => { const c = window.__cus; c.G.s.world.siege = null; c.dbg.startSiege({ plan: c.dbg.makeRaidPlan(2, 'ambush') }); });
  await sleep(300);
  // Ruth (now ♥3) pulls you up once per attack — spend that first.
  await ev(page, () => { const G = window.__cus.G; G.allyState = { revived: true }; G.player.invuln = 0; G.player.hp = 5; window.__cus.dbg.damagePlayer(50, G.player.x + 10, G.player.y); });
  await sleep(500);
  check('10a. Defeat screen shown', (await page.textContent('#modal-root')).includes('blacked out'));
  await page.screenshot({ path: OUT + 'desktop-defeat.png' });
  await page.click('[data-go]');
  await sleep(500);
  await skipDialogues(page);
  const post = await ev(page, () => ({ money: window.__cus.G.s.money, level: window.__cus.G.s.stats.level, skills: window.__cus.G.s.skills.length, step: window.__cus.G.s.story.step, hp: window.__cus.G.player.hp, dead: window.__cus.G.player.dead, enemies: window.__cus.G.enemies.length, ammo: window.__cus.G.s.inv.ammo }));
  check('10b. Recovery keeps level/skills/story, applies money penalty', post.level === pre.level && post.skills === pre.skills && post.step === pre.step && post.money <= pre.money && post.hp > 0 && !post.dead && post.enemies === 0,
    `$${pre.money} -> $${post.money}`);
  check('10c. Not left without ammo after defeat', post.ammo >= 16);

  // ---- Save & reload ----
  await ev(page, () => window.__cus.saveGame('test', { quiet: true }));
  const snap = await ev(page, () => JSON.stringify({ lv: window.__cus.G.s.stats.level, xp: window.__cus.G.s.stats.xp, attrs: window.__cus.G.s.stats.attrs, skills: window.__cus.G.s.skills, money: window.__cus.G.s.money, inv: window.__cus.G.s.inv, home: window.__cus.G.s.home, story: window.__cus.G.s.story.step, rel: window.__cus.G.s.rel, day: window.__cus.G.s.time.day, jp: window.__cus.G.s.jp }));
  await page.reload();
  await page.waitForSelector('#t-continue:not(.hidden)');
  await page.click('#t-continue');
  await sleep(600);
  const snap2 = await ev(page, () => JSON.stringify({ lv: window.__cus.G.s.stats.level, xp: window.__cus.G.s.stats.xp, attrs: window.__cus.G.s.stats.attrs, skills: window.__cus.G.s.skills, money: window.__cus.G.s.money, inv: window.__cus.G.s.inv, home: window.__cus.G.s.home, story: window.__cus.G.s.story.step, rel: window.__cus.G.s.rel, day: window.__cus.G.s.time.day, jp: window.__cus.G.s.jp }));
  check('13. Save + reload preserves level, skills, money, inventory, home, story, relationships', snap === snap2);

  // ---- New game confirmation protects the save ----
  await ev(page, () => window.__cus.quitToTitle());
  await sleep(200);
  await page.click('#t-new');
  await sleep(150);
  check('New game asks before overwriting a save', await page.isVisible('[data-yes]'));
  await page.click('text=Keep my save');
  await sleep(100);
  check('Declining keeps the save', await page.isVisible('#t-continue'));

  // ---- Save validation ----
  const val = await page.evaluate(async () => {
    const m = await import('./src/game/save.js');
    return [m.validateSave({ hello: 1 }), m.validateSave({ version: 99, player: {}, stats: {}, jp: {}, inv: {}, home: {}, story: {}, time: {}, world: {} }), m.validateSave(JSON.parse(localStorage.getItem('cabinUnderSiege.save')))];
  });
  check('Import validation rejects bad/newer saves and accepts the real one', val[0] && val[1] && val[2] === null, JSON.stringify(val));
  const mig = await page.evaluate(async () => {
    const m = await import('./src/game/save.js');
    const old = JSON.parse(localStorage.getItem('cabinUnderSiege.save'));
    delete old.home.upgrades; delete old.world.discovered; delete old.jpEarned; old.version = 0; old.inv.bogus = 5;
    const d = m.migrate(old);
    return d.home.upgrades && Array.isArray(d.world.discovered) && d.jpEarned && d.version === 3 && d.chapter === 1 && d.player.mags && !d.inv.bogus && d.life && d.visit === null;
  });
  check('Older/partial saves migrate safely', mig);
  await ctx.close();
}

/* ================================================================== */
/* v0.2: weapons, new enemies, defenses, favors and Chapter 2          */
/* ================================================================== */
if (want('v2')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, 'v0.2');
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#t-new');
  await sleep(200); if (await page.isVisible('[data-diff-pick]')) await page.click('[data-diff-pick="normal"]');
  await sleep(300);
  await skipDialogues(page);
  // Skip the early story so nothing interrupts the checks.
  await ev(page, () => { const G = window.__cus.G; G.s.story.step = 'leave_town'; G.s.story.chapterComplete = true; G.s.story.flags.firstSiegeDone = true; G.s.money = 2000; });
  const npcPos = (id) => ev(page, (id) => { const n = window.__cus.G.npcs.find((x) => x.id === id); return n ? { x: n.x / 32, y: n.y / 32 } : null; }, id);
  async function talk(id) {
    const n = await npcPos(id);
    await tp(page, n.x - 1, n.y); await faceTo(page, n.x, n.y); await sleep(150); await pressE(page); await sleep(150);
  }

  // ---- Weapons ----
  await tp(page, 5.8, 16.5, 'town');
  await setTime(page, 10 * 60);
  await sleep(300);
  await tp(page, 13, 15); await faceTo(page, 13, 14); await sleep(150); await pressE(page); await sleep(200);
  for (const id of ['shotgun', 'shells', 'rifle', 'rifle_ammo']) await page.click(`[data-buy="${id}"]`);
  await page.keyboard.press('Escape'); await sleep(100);
  check('v2 Buy shotgun, rifle and their ammo', await ev(page, () => { const i = window.__cus.G.s.inv; return i.shotgun === 1 && i.rifle === 1 && i.shells >= 8 && i.rifle_ammo >= 10; }));
  await page.keyboard.press('Digit2'); await sleep(500);
  check('v2 Switch to shotgun with key 2', (await ev(page, () => window.__cus.G.player.weapon)) === 'shotgun');
  await page.keyboard.press('KeyR'); await sleep(2000);
  const shellMag = await ev(page, () => window.__cus.G.player.mag);
  check('v2 Shotgun reloads shell by shell', shellMag >= 3, `mag ${shellMag}`);
  const nb0 = await ev(page, () => window.__cus.G.bullets.length);
  await ev(page, () => { window.__cus.G.player.fireCd = 0; });
  await page.mouse.move(900, 360); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(30);
  const pellets = await ev(page, () => window.__cus.G.bullets.filter((b) => b.owner === 'player').length);
  check('v2 Shotgun fires a spread of pellets', pellets >= 5, `${pellets} pellets`);
  await sleep(500);
  await page.keyboard.press('Tab'); await sleep(500);
  check('v2 Tab cycles to the rifle', (await ev(page, () => window.__cus.G.player.weapon)) === 'rifle');
  // Rifle pierces the first attacker
  await page.keyboard.press('KeyR'); await sleep(2800);
  const pierce = await ev(page, () => {
    const c = window.__cus; const G = c.G; const p = G.player;
    p.x = 20 * 32; p.y = 21 * 32; p.angle = 0; p.fireCd = 0;
    const a = c.dbg.spawnEnemy('enforcer', 24 * 32, 21 * 32); const b = c.dbg.spawnEnemy('enforcer', 26 * 32, 21 * 32);
    a.stun = b.stun = 99; a.alerted = b.alerted = true;
    return [a.id, b.id];
  });
  await sleep(600);
  const aimAt = await ev(page, () => { const G = window.__cus.G; const c = G.camera; return { x: (25 * 32 - c.x) * c.zoom + G.view.w / 2, y: (21 * 32 - c.y) * c.zoom + G.view.h / 2 }; });
  await page.mouse.move(aimAt.x, aimAt.y);
  await sleep(50);
  await ev(page, () => { window.__cus.G.player.fireCd = 0; });
  await page.mouse.down(); await sleep(30); await page.mouse.up(); await sleep(400);
  const hurt = await ev(page, (ids) => ids.map((id) => { const e = window.__cus.G.enemies.find((x) => x.id === id); return e ? e.maxHp - e.hp : -1; }), pierce);
  check('v2 Rifle round punches through the first attacker', hurt[0] > 0 && hurt[1] > 0, JSON.stringify(hurt));
  await ev(page, () => { window.__cus.G.enemies = []; });
  await page.keyboard.press('Digit1'); await sleep(400);

  // ---- Favors (side requests) ----
  await ev(page, () => { window.__cus.G.s.rel.gus = 25; });
  await setTime(page, 10 * 60);
  await sleep(200);
  await talk('gus');
  const favorBtn = await page.isVisible('[data-npc="favor"]');
  check('v2 Friends offer favors in their menu', favorBtn);
  if (favorBtn) { await page.click('[data-npc="favor"]'); await sleep(150); await skipDialogues(page, 0); }
  check('v2 Favor accepted', (await ev(page, () => (window.__cus.G.s.quests.gus_log || {}).state)) === 'active');
  await tp(page, 32.5, 3.6); await faceTo(page, 32.5, 2.6); await sleep(150);
  for (let i = 0; i < 5; i++) { await ev(page, () => { window.__cus.G.player.stamina = 100; }); await pressE(page); }
  await skipDialogues(page);
  check('v2 Favor objective completed (fallen tree cleared)', (await ev(page, () => window.__cus.G.s.quests.gus_log.state)) === 'return');
  const brace0 = await ev(page, () => window.__cus.G.s.inv.door_brace || 0);
  await talk('gus'); await skipDialogues(page);
  check('v2 Favor turned in for rewards', (await ev(page, () => window.__cus.G.s.quests.gus_log.state)) === 'done' && (await ev(page, () => window.__cus.G.s.inv.door_brace || 0)) === brace0 + 1);

  // ---- Defenses at the cabin: shutters, traps, cameras ----
  await ev(page, () => { const c = window.__cus; for (const [k, n] of [['shutter_kit', 2], ['bear_trap', 2], ['camera_kit', 1]]) c.dbg.addItem(k, n, true); });
  await tp(page, 24, 32.5, 'cabin');
  await setTime(page, 14 * 60);
  await sleep(300);
  await tp(page, 28.5, 27.6); await faceTo(page, 28.5, 26.5); await sleep(150); await pressE(page); await sleep(200);
  if (await page.isVisible('[data-opt]')) { const n = await page.locator('[data-opt]').count(); for (let i = 0; i < n; i++) { const t = await page.locator('[data-opt]').nth(i).textContent(); if (t.includes('Shutters')) { await page.locator('[data-opt]').nth(i).click(); break; } } }
  await sleep(150);
  check('v2 Install steel shutters on a window', await ev(page, () => window.__cus.G.s.home.openings.win_fr.shutters));
  const blocked = await ev(page, () => { const G = window.__cus.G; const w = [...G.map.blockers.values()].find((b) => b.id === 'win_fr'); let n = 0; for (let i = 0; i < 200; i++) if (w.onBullet({ owner: 'enemy', dmg: 0 })) n++; return n; });
  check('v2 Shutters stop most bullets', blocked > 160, `${blocked}/200`);
  await tp(page, 22, 30.5); await ev(page, () => { window.__cus.dbg.input.mouse.inside = false; window.__cus.G.player.angle = Math.PI; });
  await page.keyboard.press('KeyI'); await sleep(100);
  await page.click('[data-act="place"][data-id="bear_trap"]'); await sleep(150);
  const trap = await ev(page, () => (window.__cus.G.s.home.traps || [])[0]);
  check('v2 Place a bear trap', !!trap && trap.armed);
  const sprung = await ev(page, (t) => { const c = window.__cus; const e = c.dbg.spawnEnemy('scout', t.cx * 32 + 16, t.cy * 32 + 16); e.alerted = true; return e.id; }, trap);
  await sleep(300);
  const trapRes = await ev(page, (id) => { const G = window.__cus.G; const e = G.enemies.find((x) => x.id === id); return { hp: e.hp, max: e.maxHp, stun: e.stun, armed: G.s.home.traps[0].armed }; }, sprung);
  check('v2 Bear trap springs: damage + pinned', trapRes.hp < trapRes.max && trapRes.stun > 1 && !trapRes.armed, JSON.stringify(trapRes));
  await ev(page, () => { window.__cus.G.enemies = []; });
  await page.keyboard.press('KeyI'); await sleep(100);
  await page.click('[data-act="install"][data-id="camera_kit"]'); await sleep(150);
  await page.keyboard.press('Escape'); await sleep(100);
  check('v2 Install security cameras', await ev(page, () => window.__cus.G.s.home.upgrades.camera));

  // ---- New enemies ----
  await setTime(page, 22 * 60);
  await tp(page, 40, 33);
  await ev(page, () => { const c = window.__cus; c.G.player.invuln = 999; c.dbg.startSiege({ plan: { kind: 'raid', hpMult: 1, waves: [{ dir: 'north', types: ['arsonist', 'lieutenant', 'scout'], delay: 0 }] } }); });
  await sleep(1500);
  const camSpot = await ev(page, () => window.__cus.G.enemies.every((e) => e.spotted > 0));
  check('v2 Cameras mark every attacker during a siege', camSpot);
  const insp = await ev(page, () => { const G = window.__cus.G; const s = G.enemies.find((e) => e.type === 'scout'); const l = G.enemies.find((e) => e.type === 'lieutenant'); s.x = l.x + 30; s.y = l.y; return true; });
  await sleep(200);
  check('v2 Lieutenant inspires nearby attackers', insp && await ev(page, () => window.__cus.G.enemies.find((e) => e.type === 'scout').inspired));
  // Arsonist sets fire to the cabin
  await ev(page, () => { const G = window.__cus.G; const a = G.enemies.find((e) => e.type === 'arsonist'); a.x = 24.5 * 32; a.y = 12 * 32; a.alerted = false; a.fireCd = 0; G.player.x = 45 * 32; G.player.y = 38 * 32; for (const e of G.enemies) if (e !== a) e.stun = 999; });
  let fired = false;
  for (let i = 0; i < 60 && !fired; i++) { await sleep(250); fired = await ev(page, () => window.__cus.G.fires.length > 0 || window.__cus.G.lobs.length > 0); }
  check('v2 Arsonist throws molotovs', fired);
  await sleep(2500);
  await page.screenshot({ path: OUT + 'v2-fire.png' });
  const burnt = await ev(page, () => { const o = window.__cus.G.s.home.openings; return o.back_door.hp < 100 || o.win_w.glass < 20 || o.win_e.glass < 20 || window.__cus.G.fires.length > 0; });
  check('v2 Fire burns doors/windows', burnt);
  const weak = await ev(page, () => { const G = window.__cus.G; const bs = [...G.map.blockers.values()].filter((b) => !b.rec.npc && b.kind !== 'cover'); const d = bs.find((b) => b.id === 'back_door'); const w = bs.find((b) => b.id === 'win_w'); return [window.__cus.dbg.openingStrength(d), window.__cus.dbg.openingStrength(w)]; });
  check('v2 Raiders rate braced doors stronger than plain windows', weak[0] > weak[1], JSON.stringify(weak));
  for (let i = 0; i < 60 && await ev(page, () => window.__cus.G.siegeActive); i++) { await ev(page, () => { const G = window.__cus.G; for (const e of G.enemies) if (!e.dead) window.__cus.dbg.damageEnemy(e, 999, 0, 'bullet'); if (G.siege) G.siege.t += 5; }); await sleep(200); }
  await sleep(2500);
  if (await page.isVisible('.modal [data-close]')) await page.keyboard.press('Escape');
  await sleep(300);
  await ev(page, () => { window.__cus.G.player.invuln = 0; window.__cus.G.fires = []; });

  // ---- Chapter 2 ----
  await setTime(page, 10 * 60, (await ev(page, () => window.__cus.G.s.time.day)) + 1);
  await tp(page, 24, 32.5, 'cabin'); await faceTo(page, 26, 32.5); await sleep(200);
  if (process.env.DEBUG) console.log('car target', await ev(page, () => JSON.stringify({ t: window.__cus.G.interactTarget && window.__cus.G.interactTarget.label, en: window.__cus.G.enemies.filter((e) => !e.dead && !e.gone).map((e) => e.type), modal: window.__cus.G.modal })));
  await pressE(page); await sleep(200);
  if (process.env.DEBUG) console.log('after E', await ev(page, () => document.querySelector('#modal-root').innerText.slice(0, 200)));
  if (await page.isVisible('[data-opt]')) { const n = await page.locator('[data-opt]').count(); for (let i = 0; i < n; i++) { const t = await page.locator('[data-opt]').nth(i).textContent(); if (t.includes('Leave')) { await page.locator('[data-opt]').nth(i).click(); break; } } }
  await sleep(150);
  await page.click('[data-yes]'); await sleep(400);
  await skipDialogues(page, 1); await sleep(300); // Ruth's goodbye (or her offer to come — decline here; v3 tests the yes)
  await page.screenshot({ path: OUT + 'v2-chapter2-card.png' });
  await page.click('[data-go]'); await sleep(300);
  const moved = await ev(page, () => ({ ch: window.__cus.G.s.chapter, map: window.__cus.G.map.id, step: window.__cus.G.s.story.step, cam: window.__cus.G.s.inv.camera_kit, rifle: window.__cus.G.s.inv.rifle, lvl: window.__cus.G.s.stats.level }));
  check('v2 Move to Chapter 2 (Millbrook) keeps gear and packs upgrades', moved.ch === 2 && moved.map === 'millbrook' && moved.step === 'ch2_arrive' && moved.cam === 1 && moved.rifle === 1, JSON.stringify(moved));
  await page.screenshot({ path: OUT + 'v2-millbrook.png' });
  await tp(page, 24.5, 36); await sleep(400); await skipDialogues(page);
  check('Ch2: enter house -> meet Marcus', (await step(page)) === 'ch2_meet_marcus');
  await sleep(300);
  await talk('marcus'); await skipDialogues(page);
  check('Ch2: Marcus -> find work', (await step(page)) === 'ch2_find_work');
  await talk('pete'); await skipDialogues(page);
  check('Ch2: Pete -> first job', (await step(page)) === 'ch2_job');
  await tp(page, 43.4, 12.2); await faceTo(page, 43.4, 11.5); await sleep(150); await pressE(page); await sleep(200);
  await page.click('[data-accept="woodcut"]'); await sleep(150);
  const need2 = await ev(page, () => window.__cus.G.s.job.need);
  await ev(page, (n) => window.__cus.dbg.addItem('wood', n, true), need2);
  await tp(page, 34.5, 15.6); await sleep(150); await pressE(page); await sleep(300); await skipDialogues(page);
  check('Ch2: job at Kowalski Moving pays and advances story (make Larch Street home)', (await step(page)) === 'ch2_life');
  await passLife(page);
  check('Ch2: a few everyday moments -> Rosa wants a word', (await step(page)) === 'ch2_rosa');
  await talk('rosa'); await skipDialogues(page);
  check('Ch2: Rosa -> check the mailbox (+2 shutters)', (await step(page)) === 'ch2_letter');
  await tp(page, 21.5, 32.4); await faceTo(page, 20.5, 32.5); await sleep(150); await pressE(page); await sleep(200); await skipDialogues(page);
  check('Ch2: letter -> who\'s been looking at the house?', (await step(page)) === 'ch2_watch');
  await passWatch(page);
  check('Ch2: signs, a probe, the aftermath -> find who\'s watching the house', (await step(page)) === 'ch2_rat', await step(page));
  await solveRat(page);
  check('Ch2: the rat is caught -> fortify', (await step(page)) === 'ch2_fortify' && await ev(page, () => window.__cus.G.s.choices.rat2 === 'expose'));
  // two defenses: shutters on the front-left window, then a trap
  await tp(page, 21.5, 32.2); await faceTo(page, 21.5, 33.5); await sleep(150); await pressE(page); await sleep(200);
  if (await page.isVisible('[data-opt]')) { const n = await page.locator('[data-opt]').count(); for (let i = 0; i < n; i++) { const t = await page.locator('[data-opt]').nth(i).textContent(); if (t.includes('Shutters')) { await page.locator('[data-opt]').nth(i).click(); break; } } }
  await sleep(200);
  await tp(page, 13.5, 30.5); await ev(page, () => { window.__cus.dbg.input.mouse.inside = false; window.__cus.G.player.angle = Math.PI; });
  await page.keyboard.press('KeyI'); await sleep(100);
  await page.click('[data-act="place"][data-id="bear_trap"]'); await sleep(200); await skipDialogues(page);
  check('Ch2: two defenses -> Sal\'s siege scheduled', (await step(page)) === 'ch2_siege' && await ev(page, () => !!window.__cus.G.s.world.siege));
  await tp(page, 24.5, 36.5);
  await ev(page, () => { const t = window.__cus.G.s.time, sg = window.__cus.G.s.world.siege; t.day = sg.day; t.minute = 21 * 60 + 50; });
  for (let i = 0; i < 80 && !(await ev(page, () => window.__cus.G.siegeActive)); i++) await sleep(150);
  check('Ch2: story siege starts', await ev(page, () => window.__cus.G.siegeActive));
  await ev(page, () => { window.__cus.G.player.invuln = 999; });
  await sleep(1500);
  for (let i = 0; i < 120 && await ev(page, () => window.__cus.G.siegeActive); i++) { await ev(page, () => { const G = window.__cus.G; for (const e of G.enemies) if (!e.dead) window.__cus.dbg.damageEnemy(e, 999, 0, 'bullet'); if (G.siege) G.siege.t += 4; }); await sleep(200); }
  check('Ch2: Sal\'s siege survived', !(await ev(page, () => window.__cus.G.siegeActive)));
  await sleep(2500);
  if (await page.isVisible('.modal [data-close]')) await page.keyboard.press('Escape');
  await sleep(1800); await skipDialogues(page);
  const burner = await ev(page, () => { const p = window.__cus.G.pickups.find((x) => x.kind === 'burner'); return p ? { x: p.x / 32, y: p.y / 32 } : null; });
  if (burner) { await tp(page, burner.x, burner.y); await sleep(800); }
  await sleep(3000); await skipDialogues(page);
  check('Ch2: burner phone -> Marcus', (await step(page)) === 'ch2_marcus_truth', await step(page));
  await ev(page, () => { window.__cus.G.player.invuln = 0; });
  await setTime(page, 13 * 60); await sleep(300);
  await talk('marcus'); await skipDialogues(page); await sleep(300);
  check('Ch2: chapter 2 ending screen', (await page.textContent('#modal-root')).includes('LARCH STREET') && (await step(page)) === 'ch2_free');
  await page.screenshot({ path: OUT + 'v2-chapter2-end.png' });
  await page.keyboard.press('Escape'); await sleep(100);
  // Save/reload in chapter 2
  await ev(page, () => window.__cus.saveGame('test'));
  await page.reload(); await page.waitForSelector('#t-continue:not(.hidden)'); await page.click('#t-continue'); await sleep(500);
  check('Ch2: save/reload restores chapter 2', await ev(page, () => window.__cus.G.s.chapter === 2 && window.__cus.G.map.id === 'millbrook' && window.__cus.G.s.story.step === 'ch2_free'));
  // A real v1 save (from before this update) still loads.
  const v1ok = await page.evaluate(async () => {
    const v1 = { version: 1, chapter: 'cabin', player: { map: 'cabin', x: 784, y: 1072, hp: 80, stamina: 100, mag: 6 }, stats: { level: 3, xp: 10, attrPoints: 0, attrs: { vit: 2, end: 1, pre: 1, awa: 1, res: 1 } },
      jp: { survivor: 5 }, inv: { ammo: 20 }, home: { openings: { front_door: { kind: 'door', hp: 50, reinforced: true, open: false } }, upgrades: { floodlight: false, alarm: true, extMag: true }, covers: [] },
      story: { step: 'free', flags: {}, chapterComplete: true }, time: { day: 9, minute: 600 }, world: { threat: 30 } };
    localStorage.setItem('cabinUnderSiege.save', JSON.stringify(v1));
    window.__cus.continueGame();
    await new Promise((r) => setTimeout(r, 300));
    const s = window.__cus.G.s;
    return s.chapter === 1 && s.weaponMods.extMag && s.home.upgrades.alarm && s.story.step === 'leave_town' && s.player.mags.pistol === 6 && s.home.openings.win_e && window.__cus.G.map.id === 'cabin';
  });
  check('v2 Version-1 saves migrate and load', v1ok);

  /* ---------------- v0.3: Ruth companion, Chapter 3, farm life ---------------- */
  {
    const C = (fn, a) => ev(page, fn, a);
    await C(() => { const s = window.__cus.G.s; s.rel.ruth = 70; s.story.done = { 1: true }; s.time.minute = 11 * 60; });
    await C(() => window.__cus.G.events.emit('requestMove')); await sleep(200);
    await page.click('[data-yes]'); await sleep(300);
    await skipDialogues(page, 0); await sleep(300);
    await page.click('[data-go]').catch(() => {}); await sleep(300); await skipDialogues(page);
    const r2 = await C(() => ({ joined: window.__cus.G.s.companion.ruth.joined, ch: window.__cus.G.s.chapter, ruthHere: window.__cus.G.npcs.some((n) => n.id === 'ruth') }));
    check('v3 Ruth (trust ♥3) offers to come along and follows you to Millbrook', r2.joined && r2.ch === 2 && r2.ruthHere, JSON.stringify(r2));
    await C(() => { const s = window.__cus.G.s; s.story.done[2] = true; });
    await C(() => window.__cus.G.events.emit('requestMove')); await sleep(200);
    await page.click('[data-yes]'); await sleep(300); await skipDialogues(page); await sleep(300);
    await page.click('[data-go]').catch(() => {}); await sleep(300); await skipDialogues(page);
    const r3 = await C(() => ({ ch: window.__cus.G.s.chapter, map: window.__cus.G.map.id, step: window.__cus.G.s.story.step, ruth: window.__cus.G.npcs.some((n) => n.id === 'ruth') }));
    check('v3 Move to Chapter 3 (the Wisconsin farm) with Ruth', r3.ch === 3 && r3.map === 'farm' && r3.step === 'ch3_arrive' && r3.ruth, JSON.stringify(r3));
    await page.screenshot({ path: OUT + 'v3-farm.png' });
    await tp(page, 20.5, 25); await sleep(500); await skipDialogues(page);
    check('Ch3: enter farmhouse -> meet Ingrid', (await step(page)) === 'ch3_meet_ingrid');
    await C(() => { window.__cus.G.s.story.step = 'ch3_deputy'; window.__cus.G.s.time.minute = 12 * 60; }); await sleep(250);
    await C(() => { const c = window.__cus; const d = c.G.npcs.find((n) => n.id === 'deputy'); c.G.player.x = d.x; c.G.player.y = d.y + 26; c.dbg.input.mouse.inside = false; c.G.player.angle = -Math.PI / 2; }); await sleep(200);
    await pressE(page); await sleep(200); await skipDialogues(page, 1);
    const dep = await C(() => ({ choice: window.__cus.G.s.choices.deputy, step: window.__cus.G.s.story.step }));
    check('Ch3: deputy visit is a choice with consequences', dep.choice === 'refuse' && dep.step === 'ch3_watch', JSON.stringify(dep));
    await passWatch(page);
    check('Ch3: cut wire, a probe on the windbreak -> who\'s talking to Chicago?', (await step(page)) === 'ch3_rat', await step(page));
    await solveRat(page);
    check('Ch3: Hank the trucker is caught -> fortify', (await step(page)) === 'ch3_fortify');
    await C(() => { const c = window.__cus; const o = c.G.s.home.openings; for (const k of ['gate_l', 'gate_r']) o[k].hp = o[k].baseHp; c.G.s.story.flags.fortified = 1; c.G.events.emit('defenseInstalled'); }); await sleep(300); await skipDialogues(page);
    const plan = await C(() => window.__cus.G.s.world.siege && window.__cus.G.s.world.siege.plan.waves.map((w) => w.types));
    check('Ch3: gate + defenses -> Vinnie\'s siege (truck, snipers; refusing the deputy adds a sniper)', plan && plan[0].includes('truck') && plan[1].filter((t) => t === 'sniper').length === 2, JSON.stringify(plan));
    await C(() => { const c = window.__cus; c.G.player.x = 20.5 * 32; c.G.player.y = 25 * 32; c.G.player.invuln = 99999; c.G.s.time.minute = 21 * 60 + 58; if (c.G.s.world.siege) c.G.s.time.day = c.G.s.world.siege.day; });
    for (let i = 0; i < 80 && !(await C(() => window.__cus.G.siegeActive)); i++) await sleep(150);
    let rammed = false, ruthFought = false;
    for (let i = 0; i < 70 && !rammed; i++) {
      await sleep(300);
      const st = await C(() => { const c = window.__cus; const o = c.G.s.home.openings; const r = c.G.npcs.find((n) => n.id === 'ruth'); return { gate: o.gate_l.hp + o.gate_r.hp, ruth: !!(r && r.ally) }; });
      rammed = st.gate < 440; ruthFought = ruthFought || st.ruth;
    }
    check('Ch3: the ram truck smashes the farm gate and unloads attackers', rammed);
    check('v3 Ruth fights beside you during the attack', ruthFought);
    await C(() => { window.__cus.G.siege.t = 60; });
    for (let i = 0; i < 120; i++) { await sleep(200); await C(() => { const c = window.__cus; for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); if (!(await C(() => window.__cus.G.siegeActive))) break; }
    await sleep(2200); await page.locator('#modal-root button', { hasText: 'Continue' }).click().catch(() => {}); await sleep(4300); await skipDialogues(page);
    await C(() => { const pk = window.__cus.G.pickups.find((p) => p.kind === 'ledger'); if (pk) { window.__cus.G.player.x = pk.x; window.__cus.G.player.y = pk.y; } }); await sleep(900); await skipDialogues(page);
    check('Ch3: Vinnie\'s ledger found and read', (await step(page)) === 'ch3_ingrid_truth');
    await C(() => { const c = window.__cus; c.G.s.time.minute = 12 * 60; }); await sleep(300);
    await C(() => { const c = window.__cus; const d = c.G.npcs.find((n) => n.id === 'ingrid'); c.G.player.x = d.x; c.G.player.y = d.y + 26; c.G.player.angle = -Math.PI / 2; }); await sleep(300);
    await pressE(page); await sleep(300); await skipDialogues(page); await sleep(600);
    check('Ch3: chapter 3 ending screen', await C(() => window.__cus.G.s.story.done[3] === true) && (await page.textContent('#modal-root')).includes('WISCONSIN'));
    await page.screenshot({ path: OUT + 'v3-chapter3-end.png' });
    await C(() => window.__cus.dbg.closeAll());
    // Farm life
    await C(() => { window.__cus.G.s.time.minute = 9 * 60; });
    await tp(page, 10, 35); await sleep(200);
    for (let i = 0; i < 4; i++) { await pressE(page); await C(() => { window.__cus.G.player.x += 32; }); await sleep(80); }
    check('v3 Pick vegetables from the farm garden', await C(() => (window.__cus.G.s.inv.vegetables || 0) >= 4));
    const pond = await C(() => { const m = window.__cus.G.map; for (let cy = 1; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) if (m.getSolid(cx, cy) === 3 && m.getSolid(cx, cy - 1) === 0) return [cx + 0.5, cy - 0.5]; });
    await C(() => { const c = window.__cus; c.dbg.addItem('fishing_rod', 1, true); c.G.s.world.siege = null; c.G.enemies = []; c.G.siegeActive = false; });
    await tp(page, pond[0], pond[1]); await C(() => { window.__cus.G.player.angle = Math.PI / 2; }); await sleep(200);
    const fish0 = await C(() => window.__cus.G.s.inv.fish || 0);
    await pressE(page); await sleep(200);
    for (let i = 0; i < 100; i++) { await sleep(60); if ((await page.textContent('.fg-msg')).startsWith('BITE')) break; }
    await page.keyboard.press('KeyE'); await sleep(80);
    for (let i = 0; i < 1500 && await page.isVisible('.fg-water'); i++) {
      // The fish can get away (three misses) and the line is recast: strike again on the next bite.
      const st = await C(() => { const m = document.querySelector('.fg-msg'); if (m && m.textContent.startsWith('BITE')) return 'bite'; const bar = document.querySelector('.fg-bar'); if (!bar || bar.classList.contains('hidden')) return 'wait'; const z = bar.querySelector('.rg-zone'), n = bar.querySelector('.rg-needle'); const l = parseFloat(z.style.left), w = parseFloat(z.style.width), p = parseFloat(n.style.left); return p > l + 1 && p < l + w - 1 ? 'zone' : 'reel'; });
      if (st === 'bite' || st === 'zone') { await page.keyboard.press('KeyE'); await sleep(60); } else await sleep(20);
    }
    check('v3 Fishing minigame lands a fish', (await C(() => window.__cus.G.s.inv.fish || 0)) > fish0);
    await C(() => { const d = window.__cus.dbg; d.addItem('fish', 2, true); d.addItem('vegetables', 2, true); d.addItem('sandwich', 1, true); });
    await tp(page, 24, 23.3); await C(() => { window.__cus.G.player.angle = -Math.PI / 2; }); await sleep(200);
    await pressE(page); await sleep(250);
    await page.click('[data-cook="hearty_meal"]'); await sleep(150);
    await C(() => window.__cus.dbg.closeAll());
    const hp0 = await C(() => window.__cus.dbg.derived().maxHp);
    await C(() => { window.__cus.G.player.hp = 40; });
    await page.keyboard.press('KeyI'); await sleep(200);
    await page.click('[data-act="use"][data-id="hearty_meal"]'); await sleep(150);
    check('v3 Cook at the stove; Hearty Supper makes you Well Fed (+max HP)', (await C(() => window.__cus.dbg.derived().maxHp)) > hp0);
    await C(() => window.__cus.dbg.closeAll());
    await C(() => window.__cus.dbg.addItem('suppressor', 1, true));
    await page.keyboard.press('KeyI'); await sleep(200);
    await page.click('[data-act="install"][data-id="suppressor"]'); await sleep(150);
    await C(() => window.__cus.dbg.closeAll());
    await C(() => { window.__cus.G.s.world.threat = 30; window.__cus.G.s.daily.c = {}; });
    await tp(page, 60, 20); await sleep(150);
    await page.mouse.move(900, 300); await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(250);
    const quiet = await C(() => window.__cus.G.s.world.threat);
    await C(() => { window.__cus.G.s.weaponMods.suppressor = false; window.__cus.G.player.fireCd = 0; });
    await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(250);
    const loud = await C(() => window.__cus.G.s.world.threat);
    check('v3 Suppressor installs; loud gunfire near neighbors raises Heat, suppressed shots don\'t', quiet === 30 && loud > 30, `${quiet} -> ${loud}`);
    await C(() => { window.__cus.G.s.weaponMods.suppressor = true; });
    const jb = await C(() => { const p = window.__cus.G.map.props.find((p) => p.id === 'jobboard'); return [p.x / 32, p.y / 32]; });
    await tp(page, jb[0], jb[1] + 0.9); await C(() => { window.__cus.G.player.angle = -Math.PI / 2; }); await sleep(200);
    await pressE(page); await sleep(250);
    const offers = await C(() => [...document.querySelectorAll('[data-accept]')].map((b) => b.dataset.accept));
    check('v3 Farm job board offers harvest and fish orders', offers.includes('harvest') && offers.includes('fishing'), offers.join(','));
    await C(() => window.__cus.dbg.closeAll());
    await C(() => { window.__cus.G.s.rel.ingrid = 20; window.__cus.G.s.time.minute = 12 * 60; }); await sleep(200);
    await talk('ingrid');
    const fb = await page.isVisible('[data-npc="favor"]');
    if (fb) { await page.click('[data-npc="favor"]'); await sleep(150); await skipDialogues(page, 0); }
    check('v3 Chapter 3 neighbors offer favors (Ingrid\'s runaway calf)', fb && (await C(() => (window.__cus.G.s.quests.ingrid_calf || {}).state)) === 'active');
    await C(() => window.__cus.dbg.closeAll());
    await C(() => window.__cus.saveGame('t3', { force: true }));
  }
  await ctx.close();
}

/* ================================================================== */
/* Audio: every sound renders at a sane level; recorded files override  */
/* ================================================================== */
if (want('audio')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, 'audio');
  // Serve a tiny test recording through a routed manifest (repo files untouched).
  const sr = 22050, n = Math.floor(sr / 4);
  const wav = Buffer.alloc(44 + n * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin(i / 8) * 9000 * (1 - i / n)), 44 + i * 2);
  await page.route('**/audio/manifest.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sfx: { shot: ['test-shot.wav'] }, music: {} }) }));
  await page.route('**/audio/test-shot.wav', (r) => r.fulfill({ contentType: 'audio/wav', body: wav }));
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#t-new');
  await sleep(200); if (await page.isVisible('[data-diff-pick]')) await page.click('[data-diff-pick="normal"]');
  await sleep(1200);
  const names = ['shot', 'shotgun', 'rifleShot', 'enemyShot', 'rifle', 'reload', 'shell', 'swap', 'hit', 'hurt', 'thud', 'ricochet', 'impact', 'glass', 'wood', 'chop', 'treefall', 'door', 'doorBreak', 'crash', 'explode', 'dig', 'splash', 'suppressed', 'drip', 'thunder', 'bark', 'growl', 'boat', 'hammer', 'trap', 'molotov', 'step', 'dodge', 'pickup', 'coin', 'heal', 'eat', 'car', 'phone', 'alarm', 'warning', 'ui', 'chime', 'jobDone', 'levelup', 'victory', 'defeat', 'heartbeat', 'whoosh'];
  const lv = await page.evaluate(async (names) => {
    const d = window.__cus.dbg; const out = {};
    for (const n of names) out[n] = await d.renderOffline(() => d.sfx(n), 2);
    for (const m of ['day', 'night', 'tense']) out['music:' + m] = await d.renderOffline(() => d.musicBar(m), 3);
    return out;
  }, names);
  const dB = (v) => 20 * Math.log10(v + 1e-9);
  const bad = Object.entries(lv).filter(([, v]) => !isFinite(v.peak) || dB(v.peak) < -40 || v.peak > 1.0);
  check('Audio: every sound and music theme renders (none silent, none clipping)', bad.length === 0, bad.map(([k, v]) => `${k} ${dB(v.peak).toFixed(1)}dB`).join(', '));
  check('Audio: gunfire is the loudest effect', ['shot', 'shotgun', 'rifleShot'].every((k) => dB(lv[k].peak) > dB(lv.step.peak) + 15 && dB(lv[k].peak) > dB(lv.ui.peak) + 8), ['shot', 'shotgun', 'rifleShot', 'step', 'ui'].map((k) => `${k} ${dB(lv[k].peak).toFixed(1)}`).join(', '));
  const dbgA = await ev(page, () => window.__cus.dbg.audioDebug());
  check('Audio: recorded file in audio/manifest.json replaces the generated sound', dbgA && dbgA.samples === 1, JSON.stringify(dbgA));
  await ctx.close();
}

/* ================================================================== */
/* v0.3: difficulty, Endless Siege, graphics quality                   */
/* ================================================================== */
if (want('v3')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, 'endless');
  await page.goto(URL);
  await page.waitForSelector('#t-new');
  await page.click('#t-new'); await sleep(250);
  await page.click('[data-diff-pick="hard"]'); await sleep(500); await skipDialogues(page);
  const hardHp = await ev(page, () => { const e = window.__cus.dbg.spawnEnemy('gunman', 100, 100); e.gone = true; return e.maxHp; });
  check('v3 Hard difficulty: tougher attackers', (await ev(page, () => window.__cus.G.s.difficulty)) === 'hard' && hardHp > 85, `hp ${hardHp}`);
  await ev(page, () => window.__cus.saveGame('t', { force: true }));
  const before = await ev(page, () => localStorage.getItem('cabinUnderSiege.save'));
  await ev(page, () => window.__cus.quitToTitle()); await sleep(300);
  await page.click('#t-endless'); await sleep(300);
  const sites = await ev(page, () => [...document.querySelectorAll('[data-site]')].map((b) => b.dataset.site + (b.disabled ? '-locked' : '')));
  check('v3 Endless Siege: cabin open, later homes locked until reached in the story', sites.join(',') === 'cabin,house-locked,farm-locked,estate-locked,watchhouse-locked', sites.join(','));
  await page.click('[data-site="cabin"]'); await sleep(500);
  await ev(page, () => { window.__cus.G.endless.breakT = 0.3; window.__cus.G.player.invuln = 99999; });
  for (let w = 0; w < 2; w++) {
    for (let i = 0; i < 60 && !(await ev(page, () => window.__cus.G.siegeActive)); i++) await sleep(150);
    await ev(page, () => { window.__cus.G.siege.t = 60; });
    for (let i = 0; i < 80; i++) { await sleep(200); await ev(page, () => { const c = window.__cus; for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); if (!(await ev(page, () => window.__cus.G.siegeActive))) break; }
    await ev(page, () => { window.__cus.G.endless.breakT = 0.3; });
  }
  const en = await ev(page, () => ({ wave: window.__cus.G.endless.wave, kills: window.__cus.G.endless.kills }));
  check('v3 Endless Siege: waves escalate and resupply between waves', en.wave >= 2 && en.kills >= 7, JSON.stringify(en));
  await page.screenshot({ path: OUT + 'v3-endless.png' });
  for (let i = 0; i < 60 && !(await ev(page, () => window.__cus.G.siegeActive)); i++) await sleep(150);
  await ev(page, () => { const p = window.__cus.G.player; p.invuln = 0; window.__cus.dbg.damagePlayer(9999, p.x + 10, p.y, 'melee'); });
  await sleep(2400);
  const res = await page.textContent('#modal-root');
  check('v3 Endless Siege: defeat shows waves survived and records a personal best', res.includes('waves survived') && res.includes('personal best'));
  await page.click('[data-title]'); await sleep(300);
  check('v3 Endless Siege never touches the story save', (await ev(page, () => localStorage.getItem('cabinUnderSiege.save'))) === before);
  // Graphics quality
  await page.click('#t-continue'); await sleep(500);
  await skipDialogues(page);
  await ev(page, () => { window.__cus.dbg.closeAll(); window.__cus.dbg.openMenu('settings'); }); await sleep(250);
  await page.selectOption('[data-set="quality"]', 'low'); await sleep(300);
  const low = await ev(page, () => ({ dpr: window.__cus.G.view.dpr, q: window.__cus.G.settings.quality }));
  await page.selectOption('[data-set="quality"]', 'auto'); await sleep(200);
  check('v3 Low graphics setting for older phones', low.q === 'low' && low.dpr === 1, JSON.stringify(low));
  await ctx.close();
}

/* ================================================================== */
/* v0.4: noir pass, guard dog, safe room, Chapter 4                    */
/* ================================================================== */
if (want('v4')) {
  const ctx = await browser.newContext({ viewport: { width: 932, height: 430 } });
  const page = await ctx.newPage();
  watch(page, 'v4');
  await page.goto(URL);
  await page.waitForSelector('#t-new');
  await page.click('#t-new'); await sleep(250);
  await page.click('[data-diff-pick="normal"]'); await sleep(600);
  const C = (fn, a) => ev(page, fn, a);
  const portrait = await C(() => !document.getElementById('dlg-portrait').classList.contains('hidden') || document.getElementById('dlg-who').textContent === '');
  await skipDialogues(page);
  await C(() => import('./src/ui/dialogue.js').then((m) => m.playDialogue([{ who: 'Ruth Calloway', text: 'Test.' }]))); await sleep(300);
  await page.waitForFunction(() => { const i = document.getElementById('dlg-portrait'); return i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
  const pic = await C(() => { const i = document.getElementById('dlg-portrait'); return !i.classList.contains('hidden') && i.naturalWidth > 0; });
  check('v4 Conversations show a portrait of the speaker', pic && portrait);
  await skipDialogues(page);
  // Weather + grading
  await C(() => { const c = window.__cus; c.G.s.time.day = 3; c.G.s.time.minute = 22 * 60; c.dbg.setWeather('rain'); c.G.s.story.step = 'free'; c.G.s.story.flags.firstSiegeDone = true; });
  await sleep(2500);
  check('v4 Rain nights: rain falls and gets louder on the roof', await C(() => window.__cus.G.rainLevel > 0.3));
  await page.screenshot({ path: OUT + 'v4-rain.png' });
  // Story siege opens with a cutscene; boss gets a title card; damage leaves marks.
  await C(() => { const c = window.__cus; c.G.player.invuln = 99999; c.dbg.startSiege({ plan: c.dbg.storyPlan() }, true); }); await sleep(600);
  check('v4 Story attacks open with a letterboxed cutscene', await C(() => document.body.classList.contains('cine') && !!window.__cus.G.cutscene));
  await page.screenshot({ path: OUT + 'v4-cutscene.png' });
  await C(() => window.__cus.dbg.skipCutscene()); await sleep(300);
  check('v4 Cutscenes can be skipped', await C(() => !window.__cus.G.cutscene));
  await C(() => { window.__cus.G.siege.t = 60; }); await sleep(900);
  const bossCard = await C(() => window.__cus.G.cutscene && window.__cus.G.cutscene.title);
  check('v4 The boss gets a title-card entrance', typeof bossCard === 'string' && bossCard.length > 3, String(bossCard));
  await C(() => window.__cus.dbg.skipCutscene());
  for (let i = 0; i < 150; i++) { await sleep(150); await C(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); if (!(await C(() => window.__cus.G.siegeActive))) break; }
  check('v4 Fights leave lasting marks (blood, bullet holes) that are saved', await C(() => ((window.__cus.G.s.world.decals || {}).cabin || []).length > 0));
  await sleep(2400); await C(() => window.__cus.dbg.closeAll()); await skipDialogues(page);
  // Guard dog + safe room
  await C(() => { const c = window.__cus; c.G.s.time.minute = 12 * 60; c.dbg.setWeather('clear'); c.dbg.addItem('guard_dog', 1, true); c.dbg.addItem('safe_room_kit', 1, true); });
  await page.keyboard.press('KeyI'); await sleep(200);
  await page.click('[data-act="install"][data-id="guard_dog"]'); await sleep(150);
  await page.click('[data-act="install"][data-id="safe_room_kit"]'); await sleep(150);
  await C(() => window.__cus.dbg.closeAll());
  check('v4 Adopt Duke the guard dog', await C(() => !!window.__cus.G.dog && window.__cus.G.s.companion.dog.owned));
  await C(() => { const c = window.__cus; const p = c.G.player; c.G.player.invuln = 9999; c.G.enemies = []; const e = c.dbg.spawnEnemy('handler', p.x + 140, p.y); e.alerted = true; });
  const pack = await C(() => window.__cus.G.enemies.filter((e) => e.type === 'attack_dog').length);
  check('v4 Dog handlers bring attack dogs', pack === 2);
  let bitten = false;
  for (let i = 0; i < 40 && !bitten; i++) { await sleep(200); bitten = await C(() => window.__cus.G.enemies.some((e) => e.hp < e.maxHp)); }
  check('v4 Duke goes after attackers', bitten);
  const safe = await C(() => { const c = window.__cus; c.G.enemies = []; const bed = c.G.map.props.find((p) => p.id === 'bed'); c.G.siegeActive = true; c.G.player.x = bed.x; c.G.player.y = bed.y + 30; c.G.player.invuln = 0; c.G.player.hp = 100; c.dbg.damagePlayer(20, bed.x + 100, bed.y, 'bullet'); const hp = c.G.player.hp; c.G.siegeActive = false; return hp; });
  check('v4 Safe room halves damage by the bed during attacks', safe === 90, `hp ${safe}`);
  const drop = await C(() => { const c = window.__cus; const e = c.dbg.spawnEnemy('lieutenant', 300, 300); c.dbg.damageEnemy(e, 99999, 0, 'bullet'); return c.G.pickups.some((p) => p.kind === 'item' && (p.item === 'shotgun' || p.item === 'shells')); });
  check('v4 Attackers drop their guns or ammo', drop);
  // Chapter 4 run
  await C(() => { const c = window.__cus; c.G.s.companion.ruth.joined = true; c.G.s.chapter = 3; c.G.s.story.done = { 1: true, 2: true, 3: true }; c.G.s.rel.ingrid = 60; c.G.s.choices.deputy = 'bribe'; c.dbg.addItem('ledger', 1, true); c.dbg.moveToChapter(4); });
  await sleep(400); await page.click('[data-go]').catch(() => {}); await sleep(400); await skipDialogues(page);
  const r4 = await C(() => ({ ch: window.__cus.G.s.chapter, map: window.__cus.G.map.id, step: window.__cus.G.s.story.step, dog: !!window.__cus.G.dog, ruth: window.__cus.G.npcs.some((n) => n.id === 'ruth') }));
  check('v4 Move to Chapter 4 (the estate) — Ruth and Duke come along', r4.ch === 4 && r4.map === 'estate' && r4.step === 'ch4_arrive' && r4.dog && r4.ruth, JSON.stringify(r4));
  await page.screenshot({ path: OUT + 'v4-estate.png' });
  await tp(page, 34, 25); await sleep(600); await skipDialogues(page);
  const talk4 = async (id, pick = 0) => { await C((id) => { const c = window.__cus; const d = c.G.npcs.find((n) => n.id === id); c.G.player.x = d.x; c.G.player.y = d.y + 24; c.dbg.input.mouse.inside = false; c.G.player.angle = -Math.PI / 2; }, id); await sleep(250); await pressE(page); await sleep(250); await skipDialogues(page, pick); };
  await C(() => { window.__cus.G.s.time.minute = 10 * 60; }); await sleep(200);
  await talk4('eleanor');
  check('Ch4: Eleanor (vouched for by Ingrid) gives a safe room kit', (await step(page)) === 'ch4_find_work' && await C(() => window.__cus.G.s.inv.safe_room_kit >= 1));
  await talk4('walt');
  await C(() => { window.__cus.G.events.emit('jobDone', 'woodcut'); }); await sleep(300); await skipDialogues(page);
  await passLife(page);
  await sleep(200);
  await talk4('reyes', 1);
  await skipDialogues(page);
  check('Ch4: Agent Reyes and the ledger choice', (await step(page)) === 'ch4_watch' && await C(() => window.__cus.G.s.choices.reyes === 'copy'));
  await passWatch(page);
  check('Ch4: the boathouse, the gate box, a boat in the night -> who told Nico?', (await step(page)) === 'ch4_rat', await step(page));
  await solveRat(page);
  check('Ch4: June Tremblay is caught -> fortify', (await step(page)) === 'ch4_fortify');
  await C(() => { const c = window.__cus; const o = c.G.s.home.openings; for (const k of ['gate_l', 'gate_r']) o[k].hp = o[k].baseHp; c.G.s.story.flags.fortified = 2; c.G.events.emit('defenseInstalled'); }); await sleep(300); await skipDialogues(page);
  const plan4 = await C(() => window.__cus.G.s.world.siege && window.__cus.G.s.world.siege.plan.waves.map((w) => w.dir));
  check('Ch4: iron gate + three defenses -> Nico\'s attack by road and by water', plan4 && plan4.includes('lake') && plan4.includes('shore'), JSON.stringify(plan4));
  await C(() => { const c = window.__cus; c.G.player.x = 34 * 32; c.G.player.y = 25 * 32; c.G.player.invuln = 99999; c.G.s.time.minute = 21 * 60 + 58; if (c.G.s.world.siege) c.G.s.time.day = c.G.s.world.siege.day; });
  for (let i = 0; i < 80 && !(await C(() => window.__cus.G.siegeActive)); i++) await sleep(150);
  await skipDialogues(page);
  await C(() => { window.__cus.G.siege.t = 49; }); await sleep(800);
  check('Ch4: boats land attackers at the dock', await C(() => (window.__cus.G.boats || []).length >= 1));
  for (let i = 0; i < 200; i++) { await sleep(200); await C(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); if (!(await C(() => window.__cus.G.siegeActive))) break; }
  await sleep(2200); await page.locator('#modal-root button', { hasText: 'Continue' }).click().catch(() => {}); await sleep(4300); await skipDialogues(page);
  await C(() => { const pk = window.__cus.G.pickups.find((p) => p.kind === 'signet'); if (pk) { window.__cus.G.player.x = pk.x; window.__cus.G.player.y = pk.y; } }); await sleep(900); await skipDialogues(page);
  check('Ch4: Nico\'s ring -> Leo\'s call', (await step(page)) === 'ch4_eleanor_truth');
  await C(() => { window.__cus.G.s.time.minute = 12 * 60; }); await sleep(300);
  await talk4('eleanor'); await sleep(600);
  check('Ch4: chapter 4 ending screen', await C(() => window.__cus.G.s.story.done[4] === true) && (await page.textContent('#modal-root')).includes('THE ESTATE'));
  await page.screenshot({ path: OUT + 'v4-chapter4-end.png' });
  await ctx.close();
}

/* ================================================================== */
/* Chapter 5: Short Hills and the Vescari mansion                       */
/* ================================================================== */
if (want('v5')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, 'v5');
  await page.goto(URL);
  await page.waitForSelector('#t-new');
  await page.click('#t-new'); await sleep(250);
  await page.click('[data-diff-pick="normal"]'); await sleep(600);
  await skipDialogues(page);
  const C = (fn, a) => ev(page, fn, a);
  await C(() => { const c = window.__cus; c.G.s.companion.ruth.joined = true; c.G.s.chapter = 4; c.G.s.story.done = { 1: true, 2: true, 3: true, 4: true }; c.G.s.rel.ingrid = 60; c.G.s.rel.walt = 60; c.G.s.choices.reyes = 'copy'; c.G.s.choices.marcusHelp = true; c.dbg.moveToChapter(5); });
  await sleep(400); await page.click('[data-go]').catch(() => {}); await sleep(400); await skipDialogues(page);
  const r5 = await C(() => ({ ch: window.__cus.G.s.chapter, map: window.__cus.G.map.id, step: window.__cus.G.s.story.step, home: window.__cus.G.s.home.id, ruth: window.__cus.G.npcs.some((n) => n.id === 'ruth') }));
  check('v5 Move to Chapter 5 (Short Hills) — Ruth comes along', r5.ch === 5 && r5.map === 'shorthills' && r5.step === 'ch5_arrive' && r5.home === 'watchhouse' && r5.ruth, JSON.stringify(r5));
  await page.screenshot({ path: OUT + 'v5-shorthills.png' });
  await tp(page, 49, 10); await sleep(700); await skipDialogues(page);
  check('Ch5: step into the watch house', (await step(page)) === 'ch5_meet_dom', await step(page));
  const talk = async (id, pick = 0) => { await C((id) => { const c = window.__cus; const d = c.G.npcs.find((n) => n.id === id); c.G.player.x = d.x; c.G.player.y = d.y + 24; c.dbg.input.mouse.inside = false; c.G.player.angle = -Math.PI / 2; }, id); await sleep(250); await pressE(page); await sleep(250); await skipDialogues(page, pick); };
  await C(() => { window.__cus.G.s.time.minute = 10 * 60; }); await sleep(300);
  await talk('dom');
  check('Ch5: Father Dom sets you up with chores', (await step(page)) === 'ch5_settle', await step(page));
  for (const id of ['ch5_lane', 'ch5_gen', 'ch5_pantry']) { await C((id) => { const c = window.__cus; c.G.s.errands[id] = { state: 'done' }; c.G.events.emit('errandDone', id); }, id); await sleep(150); await skipDialogues(page); }
  check('Ch5: three chores -> find work', (await step(page)) === 'ch5_find_work', await step(page));
  await talk('mickey');
  check('Ch5: Mickey Doyle hires you', (await step(page)) === 'ch5_trust', await step(page));
  for (let i = 0; i < 3; i++) { await C(() => { const c = window.__cus; c.G.s.jobsDone = (c.G.s.jobsDone || 0) + 1; c.G.events.emit('jobDone', 'tow'); }); await sleep(120); await skipDialogues(page); }
  for (const id of ['ferraro_rosary', 'vito_bocce']) { await C((id) => { const c = window.__cus; c.G.s.errands[id] = { state: 'done' }; c.G.events.emit('errandDone', id); }, id); await sleep(150); await skipDialogues(page); }
  check('Ch5: the avenue trusts you -> make Short Hills home', (await step(page)) === 'ch5_life', await step(page));
  await passLife(page);
  check('Ch5: at home on the avenue -> who\'s on the ridge?', (await step(page)) === 'ch5_watch', await step(page));
  await passWatch(page);
  check('Ch5: photos, Richie Bruno, the probe, Carlo\'s list -> recon', (await step(page)) === 'ch5_recon', await step(page));
  await C(() => { const c = window.__cus; c.G.s.errands.recon = { state: 'done' }; c.G.events.emit('errandDone', 'recon'); }); await sleep(200); await skipDialogues(page);
  check('Ch5: recon -> who\'s feeding Leo?', (await step(page)) === 'ch5_rat', await step(page));
  await solveRat(page);
  check('Ch5: Old Vito is caught -> call in your favors', (await step(page)) === 'ch5_allies', await step(page));
  await C(() => { const c = window.__cus; c.G.s.rel.mickey = 30; const ph = c.G.map.props.find((p) => p.id === 'phone'); c.G.player.x = ph.x; c.G.player.y = ph.y + 20; c.dbg.input.mouse.inside = false; c.G.player.angle = -Math.PI / 2; });
  await sleep(250); await pressE(page); await sleep(300); await skipDialogues(page);
  const al = await C(() => window.__cus.G.s.allies || []);
  check('Ch5: the phone calls bring allies (Ruth, Marcus, Ingrid, Walt, Mickey, Reyes)', (await step(page)) === 'ch5_siege' && ['ruth', 'marcus', 'ingrid', 'walt', 'mickey', 'reyes'].every((a) => al.includes(a)), JSON.stringify(al));
  // Leo strikes first: the siege at the watch house
  await C(() => { const c = window.__cus; c.G.player.x = 49 * 32; c.G.player.y = 10 * 32; c.G.player.invuln = 99999; c.G.s.time.minute = 21 * 60 + 58; if (c.G.s.world.siege) c.G.s.time.day = c.G.s.world.siege.day; });
  for (let i = 0; i < 80 && !(await C(() => window.__cus.G.siegeActive)); i++) await sleep(150);
  await skipDialogues(page);
  check('Ch5: Carlo Bruno attacks the watch house', await C(() => window.__cus.G.siegeActive && window.__cus.G.siege.plan.bossName === 'Carlo Bruno'));
  await C(() => { window.__cus.G.siege.t = 49; }); await sleep(800);
  for (let i = 0; i < 200; i++) { await sleep(200); await C(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); if (!(await C(() => window.__cus.G.siegeActive))) break; }
  await sleep(2200); await page.locator('#modal-root button', { hasText: 'Continue' }).click().catch(() => {}); await sleep(4300); await skipDialogues(page);
  await C(() => { const pk = window.__cus.G.pickups.find((p) => p.kind === 'blueprint'); if (pk) { window.__cus.G.player.x = pk.x; window.__cus.G.player.y = pk.y; } }); await sleep(900); await skipDialogues(page);
  check('Ch5: Carlo\'s floor plans -> the assault', (await step(page)) === 'ch5_assault', await step(page));
  // Daylight: the car refuses; after dark it drives up the ridge.
  await C(() => { const c = window.__cus; c.G.s.time.minute = 13 * 60; const car = c.G.map.props.find((p) => p.kind === 'car'); c.G.player.x = car.x; c.G.player.y = car.y + 30; c.G.player.angle = -Math.PI / 2; }); await sleep(300);
  const dayLabel = await C(() => window.__cus.G.interactTarget && window.__cus.G.interactTarget.label);
  check('Ch5: no assault in daylight', /Wait for dark/.test(dayLabel || ''), dayLabel);
  await C(() => { window.__cus.G.s.time.minute = 22 * 60; window.__cus.G.player.invuln = 0; }); await sleep(300);
  await pressE(page); await sleep(3500); await skipDialogues(page);
  const m5 = await C(() => { const c = window.__cus; return { map: c.G.map.id, assault: !!c.G.assault, guards: c.G.enemies.filter((e) => e.guard && !e.dead && e.type !== 'attack_dog').length, dogsOnPost: c.G.enemies.filter((e) => e.type === 'attack_dog').every((e) => e.guard), gate: !!c.G.map.gateRammed, dante: c.G.enemies.some((e) => e.name === 'Dante Ruggiero') }; });
  check('Ch5: the mansion — guards on post, Ingrid rams the gate (and its guards), Walt draws off two', m5.map === 'mansion' && m5.assault && m5.gate && m5.dante && m5.guards === 10 && m5.dogsOnPost, JSON.stringify(m5));
  await page.screenshot({ path: OUT + 'v5-mansion.png' });
  // Guards stay on post until they see you.
  await C(() => { const c = window.__cus; c.G.player.x = 3 * 32; c.G.player.y = 40 * 32; }); await sleep(1500);
  check('Ch5: guards hold their posts while you stay unseen', await C(() => !window.__cus.G.assault.alarm));
  // The study is locked without Dante's key.
  await C(() => { const c = window.__cus; c.G.player.invuln = 99999; c.G.player.x = 34.5 * 32; c.G.player.y = 27.6 * 32; c.dbg.input.mouse.inside = false; c.G.player.angle = -Math.PI / 2; for (const e of c.G.enemies) if (e.name !== 'Dante Ruggiero') { e.dead = true; } }); await sleep(250);
  await pressE(page); await sleep(300);
  check('Ch5: Leo\'s study is locked', await C(() => { const m = window.__cus.G.map; return m.blockers.get(m.idx(34, 26)).rec.locked; }));
  // Ruth's second chance
  const rev = await C(() => { const c = window.__cus; c.G.player.invuln = 0; c.G.player.hp = 5; c.dbg.damagePlayer(50, c.G.player.x + 50, c.G.player.y, 'bullet'); return { dead: c.G.player.dead, hp: c.G.player.hp }; });
  check('Ch5: Ruth runs in from the car once', !rev.dead && rev.hp > 0, JSON.stringify(rev));
  await C(() => { const c = window.__cus; c.G.player.invuln = 99999; const d = c.G.enemies.find((e) => e.name === 'Dante Ruggiero'); c.dbg.damageEnemy(d, 99999, 0, 'bullet'); }); await sleep(400);
  await C(() => { const pk = window.__cus.G.pickups.find((p) => p.kind === 'study_key'); if (pk) { window.__cus.G.player.x = pk.x; window.__cus.G.player.y = pk.y; } }); await sleep(700);
  await C(() => { const c = window.__cus; c.G.player.x = 34.5 * 32; c.G.player.y = 27.6 * 32; c.G.player.angle = -Math.PI / 2; }); await sleep(250);
  await pressE(page); await sleep(300);
  check('Ch5: Dante\'s key opens the study', await C(() => { const m = window.__cus.G.map; const r = m.blockers.get(m.idx(34, 26)).rec; return !r.locked && r.open && window.__cus.G.s.inv.study_key >= 1; }));
  await talk('leo', 0);
  await sleep(800);
  const end = await C(() => ({ done: window.__cus.G.s.story.done[5], ending: window.__cus.G.s.ending, step: window.__cus.G.s.story.step }));
  check('Ch5: Leo\'s study — the justice ending (Reyes)', end.done === true && end.ending === 'justice' && end.step === 'ch5_free' && (await page.textContent('#modal-root')).includes('THE LONG ARM'), JSON.stringify(end));
  await page.screenshot({ path: OUT + 'v5-ending.png' });
  await ctx.close();
}

/* ================================================================== */
/* Controller + desktop build (Steam Deck): no touch UI, pad everywhere */
/* ================================================================== */
if (want('town')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'town');
  await page.goto(URL); await page.waitForSelector('#t-new');
  await ev(page, () => window.__cus.newGame('normal')); await sleep(500);
  await skipDialogues(page);
  const talk = async (id) => {
    const ok = await ev(page, (id) => import('./src/game/npcs.js').then((m) => { const n = window.__cus.G.npcs.find((x) => x.id === id); if (!n) return false; m.interactNpc(n); return true; }), id);
    await sleep(100);
    if (await page.locator('[data-npc="story"]').count()) await page.click('[data-npc="story"]');
    else if (await page.locator('[data-npc]').count()) await ev(page, () => window.__cus.dbg.closeAll());
    return ok;
  };
  const erState = (id) => ev(page, (id) => (window.__cus.G.s.errands[id] || {}).state || null, id);
  const propAct = (id) => ev(page, (id) => import('./src/game/errands.js').then((m) => { const p = m.errandProps(window.__cus.G.map.id).find((x) => x.errand === id); if (!p) return false; window.__cus.G.player.x = p.x; window.__cus.G.player.y = p.y; m.errandPropAction(p); return true; }), id);
  const setT = (day, h) => ev(page, ([d, h]) => { const t = window.__cus.G.s.time; t.day = d; t.minute = h * 60; }, [day, h]);

  // The rat: clues, a wrong accusation, then the right one.
  await ev(page, () => { const { G } = window.__cus; window.__cus.dbg.closeAll(); G.s.story.flags.townOpen = true; G.s.time.minute = 12 * 60; G.s.time.day = 2; window.__cus.loadMap('town', G.maps.town.points.start); });
  await ev(page, () => import('./src/game/rat.js').then((m) => { m.startRatCase(); window.__cus.G.s.story.step = 'ch1_rat'; }));
  await sleep(800);
  check('Town: the rat case is an objective', /Find the rat/.test(await ev(page, () => document.getElementById('objective').textContent)));
  await talk('dee'); await skipDialogues(page);
  const payphoneDay = await ev(page, () => import('./src/game/rat.js').then((m) => { const p = m.ratProps('town').find((x) => x.rat === 'payphone'); m.ratPropAction(p); return Object.keys(window.__cus.G.s.story.flags.rat.clues).includes('payphone'); }));
  check('Town: the payphone clue only turns up after dark', !payphoneDay);
  await ev(page, () => import('./src/game/rat.js').then((m) => m.ratPropAction(m.ratProps('town').find((x) => x.rat === 'trash')))); await skipDialogues(page);
  await talk('folk11'); await skipDialogues(page);
  check('Town: clues from talking and searching', (await ev(page, () => Object.keys(window.__cus.G.s.story.flags.rat.clues).length)) === 3);
  await talk('folk3'); await skipDialogues(page); // Jenny's alibi clue
  await talk('folk3'); await skipDialogues(page, 0); // accuse Jenny — wrong
  check('Town: a wrong accusation is remembered', (await ev(page, () => window.__cus.G.s.story.flags.rat.wrong)).includes('folk3'));
  await talk('folk1'); await skipDialogues(page, 0); await sleep(300); await skipDialogues(page);
  const rat = await ev(page, () => ({ step: window.__cus.G.s.story.step, choice: window.__cus.G.s.choices.rat }));
  check('Town: unmasking Henderson and turning him moves the story on', rat.step === 'reinforce' && rat.choice === 'feed', JSON.stringify(rat));
  check('Town: a turned rat means a lighter first siege', (await ev(page, () => window.__cus.dbg.storyPlan().waves[1].types.length)) === 1);

  // Dee's storyline: wait for Thursday, watch, tail Earl, choose, fight.
  await ev(page, () => { const { G } = window.__cus; G.s.story.step = 'free'; G.s.story.chapterComplete = true; G.s.money = 500; });
  await talk('dee'); await skipDialogues(page, 0);
  check('Town: Dee brings up her storyline', (await erState('dee_1')) === 'active');
  await setT(4, 14.5); await sleep(1200); await skipDialogues(page);
  await propAct('dee_1'); await skipDialogues(page); await talk('dee'); await skipDialogues(page);
  check('Town: "Thursday Visits" finishes on a Thursday', (await erState('dee_1')) === 'done');
  await setT(5, 13.5); await talk('dee'); await skipDialogues(page);
  await propAct('dee_2'); await sleep(300);
  let tailOk = false;
  for (let i = 0; i < 160; i++) {
    const s = await ev(page, () => { const { G } = window.__cus; const T = G.tail; if (!T) return 'done'; const n = T.n; G.player.x = n.x - Math.cos(n.angle) * 150; G.player.y = n.y - Math.sin(n.angle) * 150; G.player.vx = G.player.vy = 0; return 'tail'; });
    if (s === 'done') { tailOk = true; break; }
    if (i === 10) await page.screenshot({ path: OUT + 'town-tail.png' });
    await sleep(400);
  }
  await skipDialogues(page);
  check('Town: tailing Earl Pruitt to the woodlot', tailOk && (await ev(page, () => window.__cus.G.s.errands.dee_2.stage)) === 1);
  await talk('dee'); await skipDialogues(page);
  await talk('dee'); await skipDialogues(page); await talk('dee'); await skipDialogues(page, 0);
  await setT(5, 14); await talk('dee'); await skipDialogues(page);
  await propAct('dee_4'); await skipDialogues(page); await sleep(500);
  check('Town: the woodlot fight spawns Earl and his nephew', (await ev(page, () => window.__cus.G.enemies.filter((e) => e.errandFight && !e.dead).length)) === 2);
  await ev(page, () => { for (const e of window.__cus.G.enemies.filter((e) => e.errandFight)) window.__cus.dbg.damageEnemy(e, 999, {}); }); await sleep(1500); await skipDialogues(page);
  await talk('dee'); await skipDialogues(page);
  check('Town: finishing Dee\'s storyline earns a perk', await ev(page, () => !!(window.__cus.G.s.perks || {}).store_tab));

  // Poker night (Wednesday), deer at dawn, the fair.
  await setT(3, 20); await ev(page, () => import('./src/ui/poker.js').then((m) => m.openPoker())); await sleep(300);
  await page.locator('[data-pk="draw"]').click(); await sleep(150);
  await page.locator('[data-pk="check"], [data-pk="call"]').first().click(); await sleep(200);
  check('Town: a hand of poker plays to a showdown', !!(await ev(page, () => document.querySelector('.pk-result') && document.querySelector('.pk-result').textContent)));
  await page.screenshot({ path: OUT + 'town-poker.png' });
  await page.locator('[data-pk="leave"]').click(); await sleep(150);
  await ev(page, () => { const { G } = window.__cus; G.s.time.minute = 6 * 60; window.__cus.loadMap('cabin', G.maps.cabin.points.start); }); await sleep(400);
  const hunt = await ev(page, () => import('./src/game/hunting.js').then((m) => { const a = (window.__cus.G.animals || [])[0]; if (!a) return null; a.hp = 1; m.animalBulletCheck({ x: a.x, y: a.y, dmg: 5 }); m.fieldDress(a); return window.__cus.dbg.count('pelt'); }));
  check('Town: deer at dawn, field-dressed for venison and a pelt', hunt >= 1);
  const fd = await ev(page, () => import('./src/game/calendar.js').then((m) => m.fairDay()));
  await ev(page, (fd) => { const { G } = window.__cus; G.s.time.day = fd; G.s.time.minute = 11 * 60; window.__cus.loadMap('town', G.maps.town.points.start); }, fd);
  await ev(page, () => import('./src/game/townlife.js').then((m) => m.startGallery())); await sleep(1500);
  check('Town: the shooting gallery runs on fair day', await ev(page, () => !!(window.__cus.G.gallery && window.__cus.G.gallery.ducks.length)));
  await page.screenshot({ path: OUT + 'town-gallery.png' });
  await ev(page, () => { window.__cus.G.gallery.t = 0; }); await sleep(300);

  // Journal: case board, storylines, the week, perks.
  await ev(page, () => window.__cus.dbg.openMenu('journal')); await sleep(300);
  // The journal is split into sections now: read them all.
  let jt = '';
  for (const sub of ['story', 'cases', 'side', 'people', 'cal']) { await page.click(`.subtab[data-id="${sub}"]`); await sleep(120); jt += await ev(page, () => document.querySelector('.modal-body').innerText); }
  await page.click('.subtab[data-id="cases"]'); await sleep(120);
  check('Town: Journal shows the case board, storylines, the week and perks', ['Case board', 'Storylines', 'This week in town', 'Perks'].every((k) => jt.includes(k)));
  await page.screenshot({ path: OUT + 'town-journal.png' });
  await ev(page, () => window.__cus.dbg.closeAll());

  // Chapters 2–5: town life on every map, a rat case each, and a storyline.
  for (const n of [2, 3, 4, 5]) {
    await ev(page, (n) => { const c = window.__cus; c.G.s.story.done = { 1: true, 2: true, 3: true, 4: true }; c.dbg.moveToChapter(n); }, n); await sleep(600);
    await page.click('[data-go]').catch(() => {}); await sleep(300); await skipDialogues(page);
    await ev(page, () => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); c.dbg.closeAll(); }); await skipDialogues(page);
    const kinds = await ev(page, () => window.__cus.G.map.props.filter((p) => ['poker', 'market', 'supper', 'gallery', 'pie_stand'].includes(p.kind)).length);
    await ev(page, () => import('./src/game/rat.js').then((rat) => {
      const { G } = window.__cus; const c = rat.CASES[G.s.chapter];
      G.s.time.minute = 12 * 60; rat.startRatCase(); G.s.story.step = c.step;
      for (const [id, cl] of Object.entries(c.clues)) {
        if (cl.talk) rat.ratTalk({ id: cl.talk });
        else if (cl.point) { G.s.time.minute = cl.hours ? cl.hours[0] * 60 + 30 : 12 * 60; rat.ratPropAction({ rat: id }); }
      }
    }));
    await skipDialogues(page);
    const before = await ev(page, () => window.__cus.dbg.storyPlan().waves[1].types.length);
    await ev(page, () => import('./src/game/rat.js').then((rat) => rat.ratTalk({ id: rat.CASES[window.__cus.G.s.chapter].culprit })));
    await skipDialogues(page, 0); await sleep(300); await skipDialogues(page);
    const res = await ev(page, () => ({ step: window.__cus.G.s.story.step, rat: window.__cus.G.s.choices['rat' + window.__cus.G.s.chapter], wave: window.__cus.dbg.storyPlan().waves[1].types.length }));
    const next = { 2: 'ch2_fortify', 3: 'ch3_fortify', 4: 'ch4_fortify', 5: 'ch5_allies' }[n];
    check(`Town: Chapter ${n} has town life and a rat case that changes the siege`, kinds === 5 && res.step === next && res.rat === 'feed' && res.wave === before - 1, JSON.stringify({ kinds, ...res, before }));
  }
  // A Chapter 5 storyline: Father Dom's ring.
  await ev(page, () => { const { G } = window.__cus; G.s.story.flags.townOpen = true; G.s.time.minute = 10 * 60; G.s.inv.wood = 10; G.s.inv.toolkit = 1; });
  const dom = await ev(page, () => import('./src/game/errands.js').then((m) => { const ok = m.offerErrand('dom'); return ok; }));
  await skipDialogues(page, 0);
  check('Town: Father Dom offers his storyline in Chapter 5', dom && (await erState('dom_1')) === 'active');
  await ctx.close();
}

if (want('pad')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'pad');
  await page.goto(URL + '?desktop');
  await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  await C(() => { window.__fakePad = { connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; });
  const btn = async (i, ms = 100) => { await C((i) => { window.__fakePad.buttons[i] = { pressed: true, value: 1 }; }, i); await sleep(ms); await C((i) => { window.__fakePad.buttons[i] = { pressed: false, value: 0 }; }, i); await sleep(100); };
  const stick = (a) => C((a) => { window.__fakePad.axes = a; }, a);
  const foc = () => C(() => { const f = document.querySelector('.pad-focus'); return f ? (f.id || f.textContent.trim().slice(0, 30)) : null; });
  await sleep(250);
  check('pad Desktop build: Quit to Desktop on the title, no touch controls', await C(() => !!document.getElementById('t-quit') && document.body.classList.contains('desktop-app')) && await page.isHidden('#touch'));
  check('pad Title: a controller highlights a button', (await foc()) === 't-new', await foc());
  await btn(13);
  check('pad D-pad down moves the highlight', (await foc()) === 't-endless', await foc());
  await btn(12); await btn(0); await sleep(300);
  check('pad A presses (New Game -> difficulty)', await C(() => window.__cus.G.modal === 'difficulty'));
  check('pad Difficulty picker highlights Normal', ((await foc()) || '').startsWith('Normal'), await foc());
  await btn(0); await sleep(900);
  check('pad Pick a difficulty and start', await C(() => window.__cus.G.running && window.__cus.G.s.difficulty === 'normal'));
  for (let i = 0; i < 30 && (await C(() => !!window.__cus.G.modal || !!window.__cus.G.cutscene)); i++) await btn(0, 60);
  check('pad A continues conversations', await C(() => !window.__cus.G.modal));
  check('pad Controller prompts show A, not E; no menu button; cursor hidden', await C(() => document.body.classList.contains('pad')) && await page.isHidden('#menu-btn'));
  const p0 = await C(() => [window.__cus.G.player.x, window.__cus.G.player.y]);
  await stick([0, 1, 0, 0]); await sleep(600); await stick([0, 0, 0, 0]);
  const p1 = await C(() => [window.__cus.G.player.x, window.__cus.G.player.y]);
  check('pad Left stick moves Frank', p1[1] - p0[1] > 40, `${Math.round(p1[1] - p0[1])}px`);
  // D-pad up (button 12) walks Frank instead of opening the map.
  await C(() => { window.__fakePad.buttons[12] = { pressed: true, value: 1 }; }); await sleep(600); await C(() => { window.__fakePad.buttons[12] = { pressed: false, value: 0 }; }); await sleep(100);
  const p2 = await C(() => [window.__cus.G.player.x, window.__cus.G.player.y]);
  check('pad D-pad moves Frank (no menu)', p1[1] - p2[1] > 40 && await C(() => !window.__cus.G.modal), `${Math.round(p1[1] - p2[1])}px, modal ${await C(() => window.__cus.G.modal)}`);
  await stick([0, 0, -1, 0]); await sleep(200);
  const ang = await C(() => window.__cus.G.player.angle);
  const mag0 = await C(() => window.__cus.G.player.mag);
  await C(() => { window.__fakePad.buttons[7] = { pressed: true, value: 1 }; }); await sleep(200); await C(() => { window.__fakePad.buttons[7] = { pressed: false, value: 0 }; });
  await stick([0, 0, 0, 0]); await sleep(100);
  check('pad Right stick aims, RT fires', Math.abs(Math.abs(ang) - Math.PI) < 0.3 && (await C(() => window.__cus.G.player.mag)) < mag0, `angle ${ang.toFixed(2)}`);
  await btn(9); await sleep(200);
  check('pad Menu button opens the pause menu', await C(() => window.__cus.G.modal === 'menu'));
  const t0 = await C(() => document.querySelector('.tab.on').textContent);
  await btn(5); await sleep(200);
  check('pad RB flips menu tabs', (await C(() => document.querySelector('.tab.on').textContent)) !== t0);
  for (let i = 0; i < 8 && (await C(() => document.querySelector('.tab.on').textContent)) !== 'Settings'; i++) await btn(5);
  check('pad Settings: fullscreen + quit to desktop, no touch options', await C(() => !!document.querySelector('[data-act="quitapp"]') && !!document.querySelector('[data-act="fullscreen"]') && !document.querySelector('[data-set="touchControls"]')));
  await btn(1); await sleep(200);
  check('pad B closes menus', await C(() => !window.__cus.G.modal));
  await page.screenshot({ path: OUT + 'pad-play.png' });
  await ctx.close();
}

/* ================================================================== */
/* v0.8: cloud save, trophies, New Game+, Newark 1999, daily challenge  */
/* ================================================================== */
if (want('v7')) {
  const mk = async (label) => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); watch(p, label); await p.goto(URL); await p.waitForSelector('#t-new'); return p; };
  const skipAll = async (p, pick = 0) => { for (let i = 0; i < 50; i++) { const st = await p.evaluate(() => { const d = document.getElementById('dialogue'); if (window.__cus.G.cutscene && d.classList.contains('hidden')) return 'cine'; if (d.classList.contains('hidden')) return 'none'; return document.querySelectorAll('#dlg-choices .choice').length && !document.getElementById('dlg-choices').classList.contains('hidden') ? 'choice' : 'text'; }); if (st === 'none') return; if (st === 'cine') await p.evaluate(() => window.__cus.dbg.skipCutscene()); else if (st === 'choice') await p.locator('#dlg-choices .choice').nth(pick).click(); else await p.click('#dlg-skip').catch(() => {}); await sleep(90); } };
  // --- Cloud save across two devices ---
  const A = await mk('v7-A');
  await A.click('#t-new'); await sleep(500); await A.click('.modal [data-diff-pick="normal"]'); await sleep(700);
  await A.evaluate(() => { const c = window.__cus; c.dbg.closeAll(); for (let i = 0; i < 30; i++) document.getElementById('dlg-skip').click(); c.G.s.time.day = 7; c.G.s.money = 1600; c.saveGame('test', { force: true }); });
  await sleep(2600);
  check('v7 Trophy unlocks with a pop-up (Rainy Day Fund)', await A.evaluate(() => !!JSON.parse(localStorage.getItem('cabinUnderSiege.achievements')).unlocked.rich && !!document.querySelector('.trophy-card')));
  await A.evaluate(() => window.__cus.dbg.openMenu('settings')); await sleep(200);
  await A.click('[data-act="cloud"]'); await sleep(300); await A.click('[data-c="enable"]'); await sleep(900);
  const code = (await A.textContent('.cloud-code')).trim();
  check('v7 Cloud save gives a code', /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), code);
  const B = await mk('v7-B');
  await B.click('#t-cloud'); await sleep(300); await B.click('[data-c="enter"]'); await sleep(200);
  for (const ch of code.replace(/-/g, '')) { await B.click(`[data-k="${ch}"]`); await sleep(25); }
  await B.click('[data-c="link"]'); await sleep(900); await B.click('[data-c="useRemote"]'); await sleep(700);
  check('v7 Another device loads the cloud save with the on-screen code pad (and its trophies)', (await B.textContent('#t-continue')).includes('Day 7') && (await B.textContent('#t-trophies')).includes('(1/'), await B.textContent('#t-continue'));
  await B.click('#t-continue'); await sleep(900);
  await B.evaluate(() => { const c = window.__cus; c.dbg.closeAll(); c.G.s.time.day = 9; c.saveGame('test', { force: true }); });
  await B.evaluate(() => import('./src/game/cloud.js').then((m) => m.cloudPush({ quiet: false })));
  await A.evaluate(() => { window.__cus.dbg.closeAll(); window.__cus.quitToTitle(); }); await sleep(1300);
  check('v7 The first device is offered the newer save on its title screen', (await A.textContent('#t-cloudnote')).includes('Day 9'));
  check('v7 An older device never overwrites newer cloud progress', (await A.evaluate(() => import('./src/game/cloud.js').then((m) => m.cloudPush({ quiet: true })))) === false);
  await A.click('#t-cloudnote button'); await sleep(400);
  check('v7 Load the newer save from the title', (await A.textContent('#t-continue')).includes('Day 9'));
  await A.click('#t-trophies'); await sleep(300);
  check('v7 Trophies screen lists every achievement', await A.evaluate(() => document.querySelectorAll('.trophy').length >= 30 && document.querySelectorAll('.trophy.on').length >= 1));
  await A.screenshot({ path: OUT + 'v7-trophies.png' });
  await A.evaluate(() => window.__cus.dbg.closeAll());
  // --- New Game+ ---
  await A.evaluate(() => { const raw = JSON.parse(localStorage.getItem('cabinUnderSiege.save')); raw.story.done = { 1: true, 2: true, 3: true, 4: true, 5: true }; raw.ending = 'crown'; raw.stats.level = 9; raw.skills = ['tough']; raw.inv.ledger = 1; localStorage.setItem('cabinUnderSiege.save', JSON.stringify(raw)); });
  await A.reload(); await A.waitForSelector('#t-new'); await sleep(400);
  check('v7 New Game+ appears once the story is finished', await A.isVisible('#t-ngplus'));
  await A.click('#t-ngplus'); await sleep(250); await A.click('[data-yes]'); await sleep(900);
  const ng = await A.evaluate(() => { const c = window.__cus; return { ng: c.G.s.ngPlus, ending: c.G.s.ngEnding, level: c.G.s.stats.level, step: c.G.s.story.step, money: c.G.s.money, shotgun: c.G.s.inv.shotgun, ledger: c.G.s.inv.ledger || 0, intro: document.getElementById('dlg-text').textContent + document.getElementById('dlg-who').textContent }; });
  check('v7 New Game+: level and gear carry over, story items don\'t, crown twist gives cash and a shotgun', ng.ng === 1 && ng.ending === 'crown' && ng.level === 9 && ng.step === 'arrive' && ng.money >= 1500 && ng.shotgun === 1 && ng.ledger === 0, JSON.stringify(ng));
  await skipAll(A);
  const ngFight = await A.evaluate(() => { const c = window.__cus; const n = c.dbg.storyPlan().waves.reduce((a, w) => a + w.types.length, 0); c.G.player.invuln = 9999; c.dbg.startSiege({ plan: c.dbg.storyPlan() }, true); const m = c.G.siege.total; c.G.siegeActive = false; c.G.siege = null; return { n, m, hp: c.dbg.derived && true }; });
  check('v7 New Game+: tougher family (extra attackers every wave)', ngFight.m > ngFight.n, JSON.stringify(ngFight));
  check('v7 Trophy: Once More, With Feeling', await A.evaluate(() => new Promise((r) => setTimeout(() => r(!!JSON.parse(localStorage.getItem('cabinUnderSiege.achievements')).unlocked.ngplus), 2400))));
  await A.evaluate(() => { window.__cus.dbg.closeAll(); window.__cus.quitToTitle(); }); await sleep(300);
  // --- Newark, 1999 ---
  await A.evaluate(() => { const d = JSON.parse(localStorage.getItem('cabinUnderSiege.achievements')); d.unlocked.ch5 = 1; localStorage.setItem('cabinUnderSiege.achievements', JSON.stringify(d)); });
  await A.reload(); await A.waitForSelector('#t-new'); await sleep(300);
  check('v7 Newark, 1999 unlocks after the story', await A.isVisible('#t-prequel'));
  const saveBefore = await A.evaluate(() => localStorage.getItem('cabinUnderSiege.save'));
  await A.click('#t-prequel'); await sleep(200); await A.click('[data-yes]'); await sleep(900); await skipAll(A);
  const pstep = () => A.evaluate(() => window.__cus.G.prequel && window.__cus.G.prequel.step);
  const talk = async (id) => { await A.evaluate((id) => { const c = window.__cus; const n = c.G.npcs.find((x) => x.id === id); c.G.player.x = n.x; c.G.player.y = n.y + 22; c.dbg.input.mouse.inside = false; c.G.player.angle = -Math.PI / 2; }, id); await sleep(300); await A.keyboard.press('KeyE'); await sleep(300); await skipAll(A); };
  check('v7 Newark: the Ninth Ward Social Club, 1999', (await A.evaluate(() => window.__cus.G.map.id)) === 'newark' && (await pstep()) === 'pq_club');
  await talk('leo99'); await talk('sal99'); await talk('joey');
  check('v7 Newark: Leo, Sal and Joey — the shotgun from the trunk', (await pstep()) === 'pq_drive' && await A.evaluate(() => window.__cus.G.s.inv.shotgun === 1));
  await A.evaluate(() => { const c = window.__cus; const car = c.G.map.props.find((p) => p.id === 'car'); c.G.player.x = car.x; c.G.player.y = car.y + 34; c.G.player.angle = -Math.PI / 2; }); await sleep(300);
  await A.keyboard.press('KeyE'); await sleep(2600); await skipAll(A);
  await A.evaluate(() => { const c = window.__cus; const pr = c.G.map.props.find((p) => p.id === 'pq_crate'); c.G.player.x = pr.x - 30; c.G.player.y = pr.y; c.G.player.angle = 0; }); await sleep(300);
  await A.keyboard.press('KeyE'); await sleep(400); await skipAll(A);
  check('v7 Newark: the crate is a setup — the fight starts', (await pstep()) === 'pq_fight');
  // Falling restarts the fight instead of ending the episode
  await sleep(2200);
  await A.evaluate(() => { const c = window.__cus; c.G.player.invuln = 0; c.G.player.hp = 1; c.dbg.damagePlayer(50, c.G.player.x + 40, c.G.player.y, 'bullet'); });
  await sleep(2200);
  check('v7 Newark: falling restarts the fight', (await pstep()) === 'pq_fight' && await A.evaluate(() => !window.__cus.G.player.dead && window.__cus.G.player.hp > 50));
  await A.evaluate(() => { window.__cus.G.player.invuln = 99999; });
  for (let i = 0; i < 120 && (await pstep()) === 'pq_fight'; i++) { await sleep(250); await A.evaluate(() => { const c = window.__cus; if (c.G.cutscene && c.G.cutscene.phase !== 'talk') c.dbg.skipCutscene(); for (const e of c.G.enemies) if (!e.dead) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); }
  await skipAll(A, 1);
  for (let i = 0; i < 60 && (await pstep()) === 'pq_last'; i++) { await sleep(250); await A.evaluate(() => { const c = window.__cus; for (const e of c.G.enemies) if (!e.dead) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); }
  check('v7 Newark: Dante, the last stand, then the car', (await pstep()) === 'pq_car');
  await A.evaluate(() => { const c = window.__cus; const car = c.G.map.props.find((p) => p.id === 'car'); c.G.player.x = car.x; c.G.player.y = car.y + 34; c.G.player.angle = -Math.PI / 2; }); await sleep(300);
  await A.keyboard.press('KeyE'); await sleep(400); await skipAll(A); await sleep(2500); await skipAll(A); await sleep(800);
  check('v7 Newark: St. Rose, the ending card and the trophy', (await A.evaluate(() => window.__cus.G.modal)) === 'prequelEnd' && await A.evaluate(() => !!JSON.parse(localStorage.getItem('cabinUnderSiege.achievements')).unlocked.newark));
  check('v7 Newark never touches the story save', (await A.evaluate(() => localStorage.getItem('cabinUnderSiege.save'))) === saveBefore);
  await A.click('[data-go]'); await sleep(400);
  // --- Daily challenge + leaderboard ---
  await A.click('#t-endless'); await sleep(900);
  check('v7 Endless: daily challenge card with today\'s leaderboard and twists for free play', await A.isVisible('[data-daily]') && await A.evaluate(() => document.querySelectorAll('[data-mod] option').length === 5 && !!document.querySelector('[data-board] .muted')));
  await A.screenshot({ path: OUT + 'v7-daily.png' });
  await A.fill('[data-name]', 'Frankie'); await sleep(100);
  await A.click('[data-daily]'); await sleep(900);
  const run = await A.evaluate(() => { const E = window.__cus.G.endless; return { daily: !!E.daily, mod: E.mod, site: E.site.id }; });
  check('v7 Daily challenge runs with the day\'s site and twist', run.daily && run.mod !== 'none', JSON.stringify(run));
  await A.evaluate(() => { const c = window.__cus; c.G.endless.wave = 4; c.G.endless.kills = 21; c.G.player.invuln = 0; c.G.player.hp = 1; c.dbg.damagePlayer(80, c.G.player.x + 40, c.G.player.y, 'bullet'); });
  await sleep(3500);
  const res = await A.evaluate(() => document.querySelector('[data-board]') && document.querySelector('[data-board]').textContent);
  check('v7 Daily score posts to the online leaderboard', /#1 today/.test(res || '') && /Frankie/.test(res || ''), res);
  check('v7 Trophy: Daily Grind', await A.evaluate(() => !!JSON.parse(localStorage.getItem('cabinUnderSiege.achievements')).unlocked.daily));
  // --- Deck polish settings ---
  await A.evaluate(() => { window.__cus.dbg.closeAll(); window.__cus.quitToTitle(); window.__cus.continueGame(); }); await sleep(800);
  await A.evaluate(() => { window.__cus.dbg.closeAll(); window.__cus.dbg.openMenu('settings'); }); await sleep(200);
  await A.selectOption('[data-set="textSize"]', 'large'); await A.selectOption('[data-set="fpsCap"]', '30'); await sleep(200);
  check('v7 Settings: large text and a 30 fps battery saver', await A.evaluate(() => document.body.classList.contains('large-text') && window.__cus.G.settings.fpsCap === '30'));
  await A.evaluate(() => window.__cus.dbg.closeAll());
  const f0 = await A.evaluate(() => window.__cus.G.time); await sleep(1000); const f1 = await A.evaluate(() => window.__cus.G.time);
  check('v7 Battery saver keeps the game running', f1 - f0 > 0.5, `${(f1 - f0).toFixed(2)}s`);
  await A.evaluate(() => { window.__cus.G.settings.fpsCap = 'auto'; window.__cus.G.settings.textSize = 'normal'; });
  await A.context().close(); await B.context().close();
}

/* Regressions: the Map tab after Chapter 1, molotovs and fire through walls. */
if (want('v7')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'fixes');
  await page.goto(URL); await page.waitForSelector('#t-new');
  await ev(page, () => window.__cus.newGame('normal')); await sleep(600);
  await skipDialogues(page); await ev(page, () => window.__cus.dbg.closeAll()); await skipDialogues(page);
  await ev(page, () => { const c = window.__cus; c.G.s.story.flags.firstSiegeDone = true; c.G.s.story.step = 'free'; c.G.s.story.done = { 1: true }; c.G.s.time.minute = 13 * 60; });
  // Molotov from outside a solid wall lands outside, and its fire doesn't burn you through the wall.
  const mol = await ev(page, async () => {
    const c = window.__cus, G = c.G;
    G.enemies = []; G.fires = []; G.lobs = [];
    const p = G.player; p.x = 19.5 * 32; p.y = 24.5 * 32; p.hp = 100; p.invuln = 0;
    const { throwMolotov } = await import('./src/game/fire.js');
    throwMolotov({ x: 15 * 32, y: 24.5 * 32 }, p.x, p.y);
    const lob = G.lobs[0];
    let burned = false, sawFire = false;
    for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 100)); p.x = 19.5 * 32; p.y = 24.5 * 32; if (G.fires.length) sawFire = true; if (p.hp < 100) burned = true; }
    // Control: the same fire right next to you does burn.
    p.hp = 100; p.invuln = 0; G.fires = [{ x: p.x + 20, y: p.y, r: 38, life: 3, max: 3, tick: 0 }];
    await new Promise((r) => setTimeout(r, 700));
    return { landX: lob.tx / 32, sawFire, burned, controlHp: p.hp, modal: G.modal };
  });
  check('Fix: a molotov thrown from outside shatters on the wall, not inside the house', mol.landX < 18, JSON.stringify(mol));
  check('Fix: fire outside a wall doesn\'t burn you through it (but does when you stand in it)', mol.sawFire && !mol.burned && mol.controlHp < 100, JSON.stringify(mol));
  // Awareness: suspicion builds before they're sure; the HUD warns when it's through a window.
  const aw = await ev(page, async () => {
    const c = window.__cus, G = c.G;
    c.G.s.time.minute = 21 * 60 + 30;
    G.player.x = 19.5 * 32; G.player.y = 21.5 * 32; G.player.angle = Math.PI; G.player.invuln = 999; G.enemies = []; G.fires = [];
    const e = c.dbg.spawnEnemy('gunman', 14 * 32, 21.5 * 32, {}); e.angle = 0; e.path = null;
    await new Promise((r) => setTimeout(r, 120));
    const early = { alerted: e.alerted, sus: e.sus };
    for (let i = 0; i < 30 && !e.alerted; i++) await new Promise((r) => setTimeout(r, 100));
    return { early, late: { alerted: e.alerted }, eye: document.getElementById('eye').textContent };
  });
  check('Awareness: they grow suspicious before they spot you, and the eye says "through a window"', !aw.early.alerted && aw.early.sus > 0 && aw.late.alerted && /SEEN/.test(aw.eye) && /window/.test(aw.eye), JSON.stringify(aw));
  // The Map tab works in later chapters.
  await ev(page, () => { const c = window.__cus; c.G.s.chapter = 4; c.G.s.story.done = { 1: true, 2: true, 3: true, 4: true }; c.dbg.moveToChapter(5); }); await sleep(500);
  await ev(page, () => { window.__cus.dbg.closeAll(); window.__cus.dbg.openMenu('inv'); }); await sleep(200);
  await page.click('[data-tab="map"]'); await sleep(300);
  check('Fix: the Map tab opens in Chapter 5 (it was hard-wired to Chapter 1\'s maps)', await ev(page, () => document.querySelector('.tab.on').textContent === 'Map' && !!document.querySelector('#minimap') && document.querySelectorAll('.places span').length > 0));
  await ctx.close();
}

/* ================================================================== */
/* Stealth: hide, they search, give up after 4 hours; silent takedowns  */
/* ================================================================== */
if (want('stealth')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'stealth');
  await page.goto(URL); await page.waitForSelector('#t-new');
  await ev(page, () => window.__cus.newGame('normal')); await sleep(500);
  await skipDialogues(page);
  await ev(page, () => { const c = window.__cus; c.G.s.chapter = 1; c.G.s.story.done = { 1: true }; c.dbg.moveToChapter(2); });
  await sleep(500); await page.click('[data-go]').catch(() => {}); await sleep(300); await skipDialogues(page);
  const hidePos = [23.5, 26.3]; // inside the Bell house across Larch Street, against the front wall between its windows: no line of sight from outside
  await ev(page, ([x, y]) => { const c = window.__cus; c.dbg.closeAll(); c.G.s.story.step = 'ch2_free'; c.G.s.story.flags.firstSiegeDone = true; c.G.s.time.minute = 22 * 60; c.G.s.time.day = 5; c.G.player.x = x * 32; c.G.player.y = y * 32; c.dbg.startSiege({ plan: c.dbg.makeRaidPlan(4) }, true); }, hidePos);
  await sleep(300); await ev(page, () => { if (window.__cus.G.cutscene) window.__cus.dbg.skipCutscene(); });
  let st = null, sawSearch = false, everAlerted = false;
  for (let i = 0; i < 440; i++) {
    await sleep(500);
    st = await ev(page, ([x, y]) => { const G = window.__cus.G; G.player.x = x * 32; G.player.y = y * 32; G.player.hp = 999; const sg = G.siege; return sg ? { searching: !!sg.searching, gaveUp: !!sg.gaveUp, alerted: G.enemies.some((e) => !e.dead && e.alerted), danger: document.getElementById('danger').textContent } : { done: true, next: G.s.world.siege && [G.s.world.siege.day, G.s.world.siege.minute], day: G.s.time.day, min: G.s.time.minute }; }, hidePos);
    if (st.searching) sawSearch = true;
    if (st.alerted) everAlerted = true;
    if (i === 40) await page.screenshot({ path: OUT + 'stealth-search.png' });
    if (st.done) break;
  }
  check('Stealth: hidden in a neighbor\'s house, they search without knowing where you are', sawSearch && !everAlerted);
  check('Stealth: after 4 hours they give up and come back tomorrow night', !!(st && st.done && st.next && st.next[1] === 22 * 60 && st.next[0] === st.day), JSON.stringify(st));
  check('Stealth: trophy Hide and Seek', await ev(page, () => !!(JSON.parse(localStorage.getItem('cabinUnderSiege.achievements') || '{}').unlocked || {}).evaded));
  // Silent takedown from behind doesn't alert the rest of the crew.
  await ev(page, () => { const c = window.__cus; c.G.s.world.siege = null; c.dbg.startSiege({ plan: { kind: 'raid', hpMult: 1, waves: [{ dir: Object.keys(c.G.map.spawns)[0], types: ['gunman', 'gunman', 'scout'], delay: 0 }] } }, true); });
  await sleep(300); await ev(page, () => { if (window.__cus.G.cutscene) window.__cus.dbg.skipCutscene(); }); await sleep(1200);
  const prompt = await ev(page, async () => {
    const G = window.__cus.G; const [a, b2, s2] = G.enemies.filter((e) => !e.dead);
    a.x = 40 * 32; a.y = 33 * 32; a.angle = 0; a.path = null; a.stun = 2; a.alerted = false;
    b2.x = 10 * 32; b2.y = 40 * 32; s2.x = 12 * 32; s2.y = 40 * 32;
    G.player.x = a.x - 30; G.player.y = a.y; G.player.angle = 0; G.player.invuln = 99;
    await new Promise((r) => setTimeout(r, 150));
    return G.interactTarget && G.interactTarget.label;
  });
  check('Stealth: sneaking up behind an unaware attacker offers a silent takedown', /Silent takedown/.test(prompt || ''), prompt);
  await page.keyboard.press('KeyE'); await sleep(300);
  const after = await ev(page, () => window.__cus.G.enemies.map((e) => ({ dead: e.dead, alerted: e.alerted })));
  check('Stealth: the takedown is silent — the rest of the crew doesn\'t notice', after[0].dead && after.slice(1).every((e) => !e.dead && !e.alerted), JSON.stringify(after));
  // Spotted, then out of sight: they lose track instead of homing in through walls.
  const lost = await ev(page, async ([x, y]) => {
    const G = window.__cus.G; const e = G.enemies.find((q) => !q.dead);
    G.player.x = e.x + 60; G.player.y = e.y; G.player.invuln = 999;
    await new Promise((r) => setTimeout(r, 600));
    const spotted = e.alerted;
    const t0 = performance.now(); let gone = false;
    while (performance.now() - t0 < 30000) { await new Promise((r) => setTimeout(r, 300)); G.player.x = x * 32; G.player.y = y * 32; G.player.hp = 999; if (!G.enemies.some((q) => !q.dead && q.alerted)) { gone = true; break; } }
    return { spotted, gone };
  }, hidePos);
  check('Stealth: once you break line of sight they lose track and search again', lost.spotted && lost.gone, JSON.stringify(lost));
  await ctx.close();
}

/* Packaged Electron app (only when `node tools/build-desktop.mjs` has been run). */
if (want('electron')) {
  const exe = decodeURIComponent(new globalThis.URL('../desktop/out/Cabin Under Siege-linux-x64/cabin-under-siege', import.meta.url).pathname);
  const { existsSync: ex, mkdtempSync } = await import('node:fs');
  if (!ex(exe) || !process.env.DISPLAY) console.log('SKIP  electron: build the desktop app and run under a display (xvfb-run) to test it');
  else {
    const { _electron } = require('playwright');
    const app = await _electron.launch({ executablePath: exe, args: ['--no-sandbox', '--windowed'], env: { ...process.env, XDG_CONFIG_HOME: mkdtempSync('/tmp/cus-') } });
    const page = await app.firstWindow();
    watch(page, 'electron');
    await page.waitForSelector('#t-new', { timeout: 20000 });
    const info = await ev(page, () => ({ url: location.href, desktop: !!window.cusDesktop, quit: !!document.getElementById('t-quit') }));
    check('electron Packaged app loads the game from app://', info.url.startsWith('app://') && info.desktop && info.quit, JSON.stringify(info));
    await page.click('#t-new'); await sleep(250); await page.click('[data-diff-pick="normal"]'); await sleep(900);
    check('electron Audio starts without a click; saving works', await ev(page, () => window.__cus.dbg.audioDebug().state === 'running' && !!localStorage.getItem('cabinUnderSiege.save')));
    await app.close();
  }
}

/* ================================================================== */
/* Mobile: iPhone landscape, multi-touch, rotation, backgrounding      */
/* ================================================================== */
if (want('mobile')) {
  const iphone = devices['iPhone 13'] || { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const ctx = await browser.newContext({ ...iphone, viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  watch(page, 'mobile');
  await page.goto(URL);
  await page.waitForSelector('#t-new');
  await page.tap('#t-new');
  await sleep(300);
  if (await page.isVisible('[data-yes]')) await page.tap('[data-yes]');
  await sleep(300);
  if (await page.isVisible('[data-diff-pick]')) { await page.tap('[data-diff-pick="normal"]'); await sleep(400); }
  await sleep(400);
  await skipDialogues(page);
  check('14a. Touch controls visible on phone', await page.isVisible('#btn-fire') && await page.isVisible('#aim-zone'));
  await page.screenshot({ path: OUT + 'mobile-landscape.png' });

  const cdp = await ctx.newCDPSession(page);
  const aimBox = await page.locator('#aim-zone').boundingBox();
  const p0 = await ev(page, () => ({ x: window.__cus.G.player.x, y: window.__cus.G.player.y, a: window.__cus.G.player.angle }));
  const jx = 120, jy = 300;
  const ax = aimBox.x + aimBox.width / 2, ay = aimBox.y + aimBox.height / 2;
  const tps = (pts) => pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1, radiusX: 5, radiusY: 5, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tps([[jx, jy]]) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tps([[jx, jy], [ax, ay]]) });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tps([[jx + 5 * i, jy - 2 * i], [ax - 3 * i, ay + 1]]) });
    await sleep(40);
  }
  await sleep(400);
  const p1 = await ev(page, () => ({ x: window.__cus.G.player.x, y: window.__cus.G.player.y, a: window.__cus.G.player.angle }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  check('14b. Simultaneous touch move + aim', moved > 20 && Math.abs(Math.cos(p1.a) + 1) < 0.3, `moved ${Math.round(moved)}px, angle ${p1.a.toFixed(2)}`);
  // Pause button: works while another finger holds the joystick, and has a forgiving hit area.
  const mb = await page.locator('#menu-btn').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tps([[jx, jy]]) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tps([[jx, jy], [mb.x + mb.width / 2, mb.y + mb.height / 2]]) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(150);
  const menuWhileMoving = await page.isVisible('.menu-head');
  await sleep(400);
  await page.tap('[data-close]');
  await sleep(150);
  await page.touchscreen.tap(mb.x - 6, mb.y + mb.height + 8); // just outside the visible button
  await sleep(150);
  const menuEdge = await page.isVisible('.menu-head');
  await sleep(400);
  if (menuEdge) await page.tap('[data-close]');
  await sleep(150);
  check('Pause button opens reliably (multi-touch + edge taps)', menuWhileMoving && menuEdge);
  await page.tap('#btn-reload');
  await page.tap('#btn-dodge');
  await sleep(200);

  // Close buttons must work even when the browser drops the click (iOS Safari does).
  await page.evaluate(() => { window.__dropClicks = true; window.addEventListener('click', (e) => { if (window.__dropClicks && e.isTrusted) { e.stopImmediatePropagation(); e.preventDefault(); } }, true); });
  const mb2 = await page.locator('#menu-btn').boundingBox();
  await page.touchscreen.tap(mb2.x + mb2.width / 2, mb2.y + mb2.height / 2);
  await sleep(500);
  const cb = await page.locator('.modal-wrap .close-btn').boundingBox();
  await page.touchscreen.tap(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await sleep(200);
  const closedWithoutClick = !(await page.isVisible('.menu-head'));
  // A quick tap on ✕ right after opening also works.
  await page.touchscreen.tap(mb2.x + mb2.width / 2, mb2.y + mb2.height / 2);
  await sleep(120);
  const cb2 = await page.locator('.modal-wrap .close-btn').boundingBox();
  await page.touchscreen.tap(cb2.x + cb2.width / 2, cb2.y + cb2.height / 2);
  await sleep(200);
  const quickClose = !(await page.isVisible('.menu-head'));
  await page.evaluate(() => { window.__dropClicks = false; });
  // One tap on a stacked confirm's Cancel closes only the confirm.
  await page.touchscreen.tap(mb2.x + mb2.width / 2, mb2.y + mb2.height / 2);
  await sleep(450);
  await page.evaluate(() => window.__cus.dbg.openMenu('settings'));
  await sleep(200);
  await page.locator('[data-act="quit"]').tap();
  await sleep(450);
  const cancel = await page.locator('.modal-wrap.small [data-close]').last().boundingBox();
  await page.touchscreen.tap(cancel.x + cancel.width / 2, cancel.y + cancel.height / 2);
  await sleep(250);
  const onlyConfirmClosed = (await page.isVisible('.menu-head')) && (await page.locator('[data-yes]').count()) === 0;
  await page.evaluate(() => window.__cus.dbg.closeAll());
  await sleep(150);
  check('Touch: ✕ closes menus even if the browser drops the click; quick taps work; one tap closes one layer', closedWithoutClick && quickClose && onlyConfirmClosed, JSON.stringify({ closedWithoutClick, quickClose, onlyConfirmClosed }));

  // rotate to portrait and back
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(400);
  await page.screenshot({ path: OUT + 'mobile-portrait.png' });
  const port = await ev(page, () => ({ w: window.__cus.G.view.w, h: window.__cus.G.view.h, running: window.__cus.G.running, portrait: document.body.classList.contains('portrait') }));
  await page.setViewportSize({ width: 844, height: 390 });
  await sleep(300);
  check('15a. Rotation resizes without losing state', port.w === 390 && port.h === 844 && port.running && port.portrait && (await ev(page, () => window.__cus.G.view.w)) === 844);

  // backgrounding -> pause menu
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await sleep(200);
  const pausedMenu = await page.isVisible('.menu-head');
  const t0 = await ev(page, () => window.__cus.G.s.time.minute);
  await sleep(800);
  const t1 = await ev(page, () => window.__cus.G.s.time.minute);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  check('15b. Going to background pauses the game', pausedMenu && t0 === t1);
  await page.tap('[data-close]');
  await sleep(300);
  const t2 = await ev(page, () => window.__cus.G.s.time.minute);
  await sleep(600);
  check('15c. Game resumes after returning', (await ev(page, () => window.__cus.G.s.time.minute)) > t2);

  // night readability screenshot
  await setTime(page, 23 * 60);
  await tp(page, 24.5, 30);
  await sleep(500);
  await page.screenshot({ path: OUT + 'mobile-night.png' });
  await ctx.close();
}

/* ================================================================== */
/* The Longer Life (v0.11): phases, watchers, evidence, counter-moves, */
/* visits, letters, projects, tier-2 skills, post-game, old saves      */
/* ================================================================== */
if (want('life')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'life');
  await page.goto(URL); await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  const mod = (path, fn, a) => page.evaluate(([p, f, a]) => import(p).then((m) => (new Function('m', 'a', 'return (' + f + ')(m, a)'))(m, a)), [path, fn.toString(), a]);
  const waitTransition = async () => { for (let i = 0; i < 40 && await C(() => !!window.__cus.G.transition); i++) await sleep(100); await sleep(200); };
  const toChapter = async (n) => { await C((n) => { const c = window.__cus; const d = {}; for (let i = 1; i < n; i++) d[i] = true; c.G.s.story.done = d; c.G.s.story.chapterComplete = true; c.G.s.world.siege = null; c.dbg.moveToChapter(n); }, n); await sleep(500); await page.click('[data-go]').catch(() => {}); await sleep(300); await skipDialogues(page); await C(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); c.dbg.closeAll(); }); await skipDialogues(page); };
  const siegeNow = async () => {
    await C(() => { const c = window.__cus; const sg = c.G.s.world.siege; c.G.s.time.day = sg.day; c.G.s.time.minute = sg.minute - 2; const p = c.G.map.points.cabin_in; c.G.player.x = p.x; c.G.player.y = p.y; c.G.player.invuln = 99999; });
    for (let i = 0; i < 100 && !(await C(() => window.__cus.G.siegeActive)); i++) await sleep(100);
  };
  const winSiege = async () => {
    for (let i = 0; i < 200; i++) { await sleep(150); await C(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); if (c.G.siege) c.G.siege.t += 30; for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); if (!(await C(() => window.__cus.G.siegeActive))) break; }
    await sleep(2400); await page.locator('#modal-root button', { hasText: 'Continue' }).click().catch(() => {}); await sleep(3200); await skipDialogues(page);
  };

  // --- 1–3: old saves migrate without losing anything or replaying anything ---
  await C(() => window.__cus.newGame('normal')); await sleep(500); await skipDialogues(page);
  const m1 = await mod('./src/game/save.js', (m) => {
    const G = window.__cus.G;
    const v2 = JSON.parse(JSON.stringify(G.s)); v2.version = 2; delete v2.life; delete v2.visit;
    v2.chapter = 3; v2.player.map = 'farm'; v2.story = { step: 'ch3_rat', flags: { townOpen: true, rat: { clues: { tess: 4 }, wrong: [], deadline: 9 } }, done: { 1: true, 2: true }, chapterComplete: true };
    v2.stats.level = 7; v2.stats.xp = 33; v2.jp.shadow = 41; v2.skills = ['keen_eye', 'quiet_steps']; v2.money = 777; v2.rel.ingrid = 64; v2.rel.dee = 55;
    v2.choices = { marcusHelp: true, deputy: 'bribe', rat: 'feed', rat2: 'expose' }; v2.home = { ...v2.home, id: 'farm' };
    v2.home.projects = { workshop: { progress: 2, lastDay: 3, done: true } };
    const d = m.migrate(v2);
    const done = JSON.parse(JSON.stringify(G.s)); done.version = 2; delete done.life; done.chapter = 5; done.player.map = 'shorthills'; done.story = { step: 'ch5_free', flags: {}, done: { 1: true, 2: true, 3: true, 4: true, 5: true } }; done.ending = 'blood';
    const p = m.migrate(done);
    const v1 = { version: 1, chapter: 'cabin', player: { map: 'cabin', x: 784, y: 1072, hp: 80, stamina: 100, mag: 6 }, stats: { level: 3, xp: 10, attrPoints: 0, attrs: { vit: 2, end: 1, pre: 1, awa: 1, res: 1 } }, jp: { survivor: 5 }, inv: { ammo: 20 }, home: { openings: {} }, story: { step: 'town_trust', flags: {} }, time: { day: 4, minute: 600 }, world: {} };
    const o = m.migrate(v1);
    return {
      v: d.version, ch: d.chapter, step: d.story.step, lvl: d.stats.level, jp: d.jp.shadow, skills: d.skills.join(','), money: d.money, rel: d.rel.ingrid, choices: d.choices.deputy + d.choices.rat2, proj: d.home.projects.workshop.done,
      legacy: d.life.legacy, visit: d.visit, siege: d.world.siege, postEnding: p.life.post && p.life.post.ending, postStep: p.story.step, v1ok: o.version === 3 && o.story.step === 'town_trust' && o.life && Array.isArray(o.life.mail),
    };
  });
  check('Life: a v2 Chapter 3 save migrates to v3 with level, JP, skills, money, friends, choices and projects intact', m1.v === 3 && m1.ch === 3 && m1.step === 'ch3_rat' && m1.lvl === 7 && m1.jp === 41 && m1.skills === 'keen_eye,quiet_steps' && m1.money === 777 && m1.rel === 64 && m1.choices === 'bribeexpose' && m1.proj === true, JSON.stringify(m1));
  check('Life: a save already in Chapter 3 stays there — earlier chapters are marked as played, no attack is scheduled', m1.legacy[1] && m1.legacy[2] && !m1.legacy[3] && m1.visit === null && m1.siege == null, JSON.stringify(m1.legacy));
  check('Life: a finished-story save enters life after the story with its ending', m1.postEnding === 'blood' && m1.postStep === 'ch5_free');
  check('Life: a version-1 save still migrates (to v3)', m1.v1ok);
  // A migrated Chapter 3 save actually loads and plays.
  const loaded = await mod('./src/game/save.js', (m) => {
    const G = window.__cus.G;
    const v2 = JSON.parse(JSON.stringify(G.s)); v2.version = 2; delete v2.life; v2.chapter = 3; v2.player.map = 'farm'; v2.player.x = 21 * 32; v2.player.y = 17 * 32; v2.home = { ...v2.home, id: 'farm', openings: {} }; v2.story = { step: 'ch3_fortify', flags: { townOpen: true }, done: { 1: true, 2: true } };
    m.writeSaveData(v2);
    return true;
  });
  await C(() => window.__cus.continueGame()); await sleep(800); await skipDialogues(page);
  check('Life: the migrated Chapter 3 save loads on the farm, mid-chapter', await C(() => window.__cus.G.map.id === 'farm' && window.__cus.G.s.story.step === 'ch3_fortify' && window.__cus.G.s.version === 3));

  // --- Phase B: make it home ---
  await C(() => window.__cus.newGame('normal')); await sleep(500); await skipDialogues(page);
  await C(() => { const c = window.__cus; c.G.s.story.step = 'town_trust'; c.G.s.story.flags.jobsBase = 0; c.G.s.story.flags.townOpen = true; c.G.s.jobsDone = 3; c.G.s.errands.abe_pies = { state: 'done' }; c.G.s.errands.jenny_cat = { state: 'done' }; c.G.events.emit('jobDone'); });
  await sleep(300); await skipDialogues(page); await sleep(300); await skipDialogues(page);
  check('Life: earning the town\'s trust opens "Make Pine Hollow home" (phase B)', (await step(page)) === 'ch1_life' && /Make Pine Hollow home \(0\/3\)/.test(await C(() => document.getElementById('objective').textContent)));
  await C(() => { window.__cus.G.events.emit('cooked', 'stew'); window.__cus.G.events.emit('cooked', 'stew'); });
  check('Life: the same kind of moment only counts once', await mod('./src/game/life.js', (m) => m.lifeMomentsDone().length) === 1);
  await C(() => { window.__cus.G.events.emit('gift', 'dee'); window.__cus.G.events.emit('supper'); });
  await sleep(1200); await skipDialogues(page); await sleep(400); await skipDialogues(page);
  check('Life: three different everyday moments complete the step and the story moves on', (await step(page)) === 'rest');

  // --- Quiet-day events never interrupt an attack ---
  const ev1 = await C(() => import('./src/game/life.js').then((m) => { const c = window.__cus; c.G.s.life.eventDay = -1; c.G.siegeActive = true; const q = m.quietMoment(); c.G.siegeActive = false; return q; }));
  check('Life: quiet-day events wait while an attack is on', ev1 === false);
  await C(() => { const c = window.__cus; c.G.s.story.step = 'town_trust'; c.G.s.time.minute = 8 * 60; c.G.s.life.eventDay = -1; c.loadMap('cabin', c.G.maps.cabin.points.porch); });
  await sleep(2500);
  const gusCame = await C(() => !!(window.__cus.G.s.life.ch[1].events || {}).c1_gus_coffee);
  await skipDialogues(page);
  check('Life: a quiet morning brings a drop-in (Gus with coffee), once', gusCame);

  // --- Chapter 2: watcher phase, the probe, its aftermath, a counter-move ---
  await toChapter(2);
  await C(() => { const c = window.__cus; c.G.s.story.step = 'ch2_letter'; c.G.s.time.minute = 11 * 60; c.G.player.invuln = 99999; c.G.s.rel.marcus = 50; });
  await mod('./src/game/story.js', (m) => m.storyMail()); await sleep(200); await skipDialogues(page); await sleep(300); await skipDialogues(page);
  check('Life: Sal\'s photo starts "Who\'s been looking at the house?" (phase C)', (await step(page)) === 'ch2_watch');
  await C(() => window.__cus.loadMap('millbrook'));
  const vis = await C(() => window.__cus.G.npcs.some((n) => n.visitor));
  await mod('./src/game/npcs.js', (m) => { const n = window.__cus.G.npcs.find((x) => x.visitor); m.interactNpc(n); }); await sleep(200); await skipDialogues(page, 1); await sleep(500); await skipDialogues(page);
  check('Life: a watcher sign can be a person (the fake meter reader) — and asking for ID turns up evidence', vis && await C(() => !!window.__cus.G.s.life.evidence.t2_parcel));
  check('Life: one sign is not enough on its own', (await step(page)) === 'ch2_watch');
  await mod('./src/game/npcs.js', (m) => { const n = window.__cus.G.npcs.find((x) => x.id === 'folk6'); window.__cus.G.s.time.minute = 11 * 60; m.interactNpc(n); }); await sleep(200); await skipDialogues(page); await sleep(600); await skipDialogues(page);
  check('Life: two of three signs (the box on the porch never looked at) schedule a probe — a missed clue doesn\'t block anything', (await step(page)) === 'ch2_probe' && await C(() => window.__cus.G.s.world.siege && window.__cus.G.s.world.siege.plan.kind === 'probe'));
  await page.screenshot({ path: OUT + 'life-watch.png' });
  await siegeNow();
  check('Life: the probe is a small attack', await C(() => window.__cus.G.siegeActive && window.__cus.G.siege.total === 3));
  await winSiege(); await sleep(800); await skipDialogues(page);
  const after = await mod('./src/game/watch.js', (m) => m.watchProps('millbrook').find((p) => p.watch === '_after'));
  check('Life: after the probe, they left something behind to inspect', !!after);
  await mod('./src/game/watch.js', (m) => { m.watchPropAction(m.watchProps('millbrook').find((p) => p.watch === '_after')); }); await sleep(200); await skipDialogues(page); await sleep(500); await skipDialogues(page);
  check('Life: the aftermath leads to the rat case and opens a counter-move', (await step(page)) === 'ch2_rat' && await C(() => (window.__cus.G.s.errands.k2_lot || {}).state === 'active'));
  // Counter-move: the blue Pontiac, at night.
  await mod('./src/game/errands.js', (m) => { window.__cus.G.s.time.minute = 12 * 60; m.errandPropAction(m.errandProps('millbrook').find((p) => p.errand === 'k2_lot')); });
  check('Life: the counter-move waits for its hour', await C(() => window.__cus.G.s.errands.k2_lot.stage === 0 && !window.__cus.G.modal));
  await mod('./src/game/errands.js', (m) => { window.__cus.G.s.time.minute = 21 * 60; m.errandPropAction(m.errandProps('millbrook').find((p) => p.errand === 'k2_lot')); }); await sleep(200); await skipDialogues(page, 0); await sleep(300); await skipDialogues(page);
  check('Life: the counter-move completes (flat tires)', await C(() => window.__cus.G.s.errands.k2_lot.state === 'done' && window.__cus.G.s.errands.k2_lot.choice === 'tires'));
  // Ask Marcus for help in the last days.
  await C(() => { window.__cus.G.s.time.minute = 12 * 60; });
  // Marcus may have something to say about the evidence first; keep talking until you can ask him.
  for (let k = 0; k < 3 && !(await C(() => (window.__cus.G.s.life.ch[2].help || {}).marcus)); k++) {
    await mod('./src/game/npcs.js', (m) => { const n = window.__cus.G.npcs.find((x) => x.id === 'marcus'); m.interactNpc(n); }); await sleep(200);
    await skipDialogues(page, 0); await C(() => window.__cus.dbg.closeAll());
  }
  const helped = await C(() => (window.__cus.G.s.life.ch[2].help || {}).marcus);
  const plan = await mod('./src/game/watch.js', (m) => { const p = m.adaptPlan(JSON.parse(JSON.stringify(window.__cus.dbg.storyPlan()))); window.__cus.G.s.life.ch[2].siegeStarted = null; return { d0: p.waves[0].delay, spot: !!p.waves[0].spot, lead: m.leadBonus({ kind: 'story' }) }; });
  check('Life: investigation choices change the real attack (late first wave, Marcus marks it, an hour more warning)', helped === 'yes' && plan.d0 >= 15 && plan.spot && plan.lead >= 60, JSON.stringify({ helped, ...plan }));
  // Counter-moves lapse once the attack has happened.
  await C(() => { const c = window.__cus; c.G.s.story.step = 'ch2_phone'; c.G.s.errands.k2_lot.state = 'active'; });
  await sleep(1200);
  check('Life: an unfinished counter-move lapses after the attack (no dead ends)', await C(() => window.__cus.G.s.errands.k2_lot.state === 'expired'));
  await C(() => { window.__cus.G.s.errands.k2_lot.state = 'done'; });

  // --- Journal sections ---
  await C(() => window.__cus.dbg.openMenu('journal')); await sleep(300);
  const subs = await C(() => [...document.querySelectorAll('.subtab')].map((b) => b.textContent.replace(/[!✉]/g, '').trim()));
  await page.click('.subtab[data-id="cases"]'); await sleep(200);
  const casesTxt = await C(() => document.querySelector('.modal-body').innerText);
  check('Life: Journal has Story, Cases, Side stories, People, Home, Calendar, Scrapbook and Log sections', ['Story', 'Cases', 'Side stories', 'People', 'Home', 'Calendar', 'Scrapbook', 'Log'].every((k) => subs.includes(k)), subs.join(','));
  check('Life: found clues and the Paper Trail can be reviewed in the Journal', /meter reader/i.test(casesTxt) && /Paper Trail/.test(casesTxt));
  await page.screenshot({ path: OUT + 'life-journal-cases.png' });
  await page.click('.subtab[data-id="log"]'); await sleep(300);
  const logTxt = await C(() => document.querySelector('.tab-body').innerText);
  check('Life: the Log lists important choices', /Important choices/.test(logTxt) && /Larch Street\'s rat|Deputy|Dee|choices/.test(logTxt), logTxt.slice(0, 120));
  await C(() => window.__cus.dbg.closeAll());

  // --- Relationships survive moves; travel to an old town and back ---
  const relBefore = await C(() => JSON.stringify(window.__cus.G.s.rel));
  await C(() => { const c = window.__cus; c.G.s.home.openings.front_door.reinforced = true; c.G.s.home.projects.radio = { progress: 1, lastDay: 2, done: true }; });
  await toChapter(3);
  check('Life: relationships come through a chapter move untouched', (await C(() => JSON.stringify(window.__cus.G.s.rel))) === relBefore);
  check('Life: a finished project stays with the old house', await C(() => !!(window.__cus.G.s.pastHomes.house.projects || {}).radio));
  const homeSnap = await C(() => { const c = window.__cus; c.G.s.home.openings.front_door.hp = 61; c.G.s.money += 100; c.G.s.time.minute = 10 * 60; return JSON.stringify(c.G.s.home); });
  await C(() => { const c = window.__cus; const car = c.G.map.props.find((p) => p.kind === 'car'); c.G.player.x = car.x; c.G.player.y = car.y + 30; c.G.player.angle = -Math.PI / 2; });
  await sleep(300);
  const carLbl = await C(() => window.__cus.G.interactTarget && window.__cus.G.interactTarget.label);
  check('Life: the car offers drives back to old towns', /options/.test(carLbl || ''), carLbl);
  await mod('./src/game/visits.js', (m) => m.startVisit(2)); await waitTransition(); await skipDialogues(page);
  const v = await C(() => ({ map: window.__cus.G.map.id, visit: window.__cus.G.s.visit && window.__cus.G.s.visit.ch, home: window.__cus.G.s.home.id, marcus: window.__cus.G.npcs.some((n) => n.id === 'marcus'), obj: document.getElementById('objective').textContent }));
  check('Life: driving back to Millbrook — old friends are there, the farm is still home', v.map === 'millbrook' && v.visit === 2 && v.home === 'farm' && v.marcus && /Visiting Millbrook/.test(v.obj), JSON.stringify(v));
  const locked = await C(() => { const m = window.__cus.G.map; const b = m.blockers.get(m.idx(24, 33)) || [...m.blockers.values()].find((x) => x.id === 'front_door'); return b && b.rec.locked; });
  check('Life: the old house belongs to someone else now (locked)', locked === true);
  await mod('./src/game/npcs.js', (m) => { const n = window.__cus.G.npcs.find((x) => x.id === 'marcus'); m.interactNpc(n); }); await sleep(200);
  const reunion = await C(() => document.getElementById('dlg-text').textContent.length > 0 && !document.getElementById('dialogue').classList.contains('hidden'));
  await skipDialogues(page);
  check('Life: an old friend reacts to Frank coming back', reunion && await C(() => window.__cus.G.s.visit.met.marcus === true));
  await C(() => window.__cus.saveGame('test', { force: true })); await C(() => window.__cus.continueGame()); await sleep(800); await skipDialogues(page);
  check('Life: save and reload during a visit puts you back in the old town', await C(() => window.__cus.G.map.id === 'millbrook' && window.__cus.G.s.visit && window.__cus.G.s.visit.ch === 2 && !!window.__cus.G.maps.farm));
  await mod('./src/game/visits.js', (m) => m.endVisit()); await waitTransition(); await skipDialogues(page);
  const back = await C(() => { const s = window.__cus.G.s; return { map: window.__cus.G.map.id, visit: s.visit, door: s.home.openings.front_door.hp, id: s.home.id }; });
  check('Life: driving home returns to the farm with the house exactly as it was', back.map === 'farm' && back.visit === null && back.door === 61 && back.id === 'farm', JSON.stringify(back));
  await C(() => { const c = window.__cus; const at = c.G.s.time.day * 1440 + c.G.s.time.minute + 600; c.G.s.world.siege = { day: Math.floor(at / 1440), minute: at % 1440, plan: { kind: 'raid', waves: [{ dir: 'west', types: ['scout'], delay: 0 }] }, warned: false }; });
  const blocked = await mod('./src/game/visits.js', (m) => m.travelBlocker());
  check('Life: you can\'t leave town with an attack coming', !!blocked, String(blocked));
  await C(() => { window.__cus.G.s.world.siege = null; });

  // --- Away from home is no hiding place ---
  await C(() => { window.__cus.G.s.time.minute = 10 * 60; window.__cus.G.s.life.awayDebt = 0; });
  await mod('./src/game/visits.js', (m) => m.startVisit(2)); await waitTransition(); await skipDialogues(page);
  await C(() => { const c = window.__cus; c.G.s.visit.since -= 1.5 * 1440; }); await sleep(1300);
  const short = await mod('./src/game/away.js', (m) => ({ left: m.safeDaysLeft(), status: m.awayStatus(), pursuit: !!window.__cus.G.s.visit.pursuit }));
  check('Away: a short visit is free — no crew follows, the Journal says how long is safe', short.left > 1 && !short.pursuit && /Safe here/.test(short.status), JSON.stringify(short));
  const relM = await C(() => { const c = window.__cus; c.G.s.rel.marcus = 50; c.G.s.visit.since -= 1.8 * 1440; c.G.s.time.minute = 21 * 60 + 30; return c.G.s.rel.marcus; });
  await sleep(1500);
  const long = await C(() => { const c = window.__cus; const v = c.G.s.visit; const t = c.G.s.time; return { p: v.pursuit, now: t.day * 1440 + t.minute, rel: c.G.s.rel.marcus }; });
  check('Away: stay past three days and a crew is coming tonight', !!long.p && long.p.at - long.now <= 60 && long.p.size >= 2, JSON.stringify(long));
  check('Away: an old friend pays for the danger you bring (friendship drops)', long.rel < relM, `${relM} -> ${long.rel}`);
  await C(() => { const c = window.__cus; const t = c.G.s.time; c.G.s.visit.pursuit.at = t.day * 1440 + t.minute; c.G.enemies = []; });
  await sleep(600); await skipDialogues(page, 0);
  const crew = await C(() => window.__cus.G.enemies.filter((e) => e.pursuit && !e.dead).map((e) => ({ a: e.alerted, map: window.__cus.G.map.id })));
  check('Away: they followed you to the old town — and they know you\'re here', crew.length >= 2 && crew.every((e) => e.a && e.map === 'millbrook'), JSON.stringify(crew));
  const shake = await C(() => new Promise((res) => { const c = window.__cus; c.G.enemies = c.G.enemies.filter((e) => !e.pursuit); setTimeout(() => { const t = c.G.s.time; const p = c.G.s.visit.pursuit; res(p && { wait: p.at - (t.day * 1440 + t.minute), live: p.live }); }, 300); }));
  check('Away: you can\'t shake them by driving across town — they pick the trail up within the hour', !!shake && !shake.live && shake.wait > 30 && shake.wait <= 75, JSON.stringify(shake));
  await C(() => { const c = window.__cus; const t = c.G.s.time; c.G.s.visit.pursuit.at = t.day * 1440 + t.minute; }); await sleep(600); await skipDialogues(page, 0);
  await C(() => { for (const e of window.__cus.G.enemies) if (e.pursuit) e.dead = true; }); await sleep(600);
  check('Away: beating the crew only buys a night — the next one will be bigger', await C(() => { const v = window.__cus.G.s.visit; return !v.pursuit && v.beaten === 1 && v.nextAfter > 0; }));
  await C(() => { const c = window.__cus; c.G.enemies = []; c.G.s.visit.nextAfter = 1e12; });
  // An empty house gets broken into.
  const before = await C(() => { const c = window.__cus; const s = c.G.s; s.money = 400; s.home.upgrades.alarm = false; s.home.upgrades.camera = false; s.home.openings.front_door.hp = 100; s.home.projects.cache = null; delete s.home.projects.cache; s.life.awayReport = []; s.life.breakIns = 0; s.companion.dog = { owned: false }; const t = s.time; const at = t.day * 1440 + t.minute - 40; s.world.siege = { day: Math.floor(at / 1440), minute: at % 1440, plan: { kind: 'raid', waves: [{ dir: 'west', types: ['scout', 'gunman', 'enforcer', 'scout'], delay: 0 }] }, warned: true }; return { money: s.money }; });
  await sleep(600);
  const bi = await C(() => { const s = window.__cus.G.s; return { siege: s.world.siege, money: s.money, rep: s.life.awayReport.length, n: s.life.breakIns }; });
  check('Away: a raid on an empty house is a break-in — cash gone, doors forced, a report waiting at home', !bi.siege && bi.money < before.money && bi.rep === 1 && bi.n === 1, JSON.stringify(bi));
  // A story attack that finds nobody home comes back bigger.
  await C(() => { const s = window.__cus.G.s; const t = s.time; const at = t.day * 1440 + t.minute - 40; s.world.siege = { day: Math.floor(at / 1440), minute: at % 1440, plan: { kind: 'story', waves: [{ dir: 'west', types: ['scout', 'scout'], delay: 0 }] }, warned: true }; });
  await sleep(600);
  const miss = await mod('./src/game/away.js', (m) => { const s = window.__cus.G.s.world.siege; return { missed: s && s.plan.missed, grown: s && m.missedReinforcements(s.plan).waves[0].types.length, minute: s && s.minute }; });
  check('Away: a story attack doesn\'t go away — it\'s rescheduled and grows every night you miss', miss.missed === 1 && miss.grown === 4 && miss.minute === 22 * 60, JSON.stringify(miss));
  await C(() => { window.__cus.G.s.time.minute = 21 * 60; });
  await mod('./src/game/visits.js', (m) => m.endVisit()); await waitTransition(); await skipDialogues(page);
  const home = await C(() => { const c = window.__cus; const s = c.G.s; const w = s.world.siege; const t = s.time; const now = t.day * 1440 + t.minute; const r = { map: c.G.map.id, wait: w ? w.day * 1440 + w.minute - now : null, warned: w && w.warned, debt: s.life.awayDebt, rep: s.life.awayReport.length }; s.world.siege = null; return r; });
  check('Away: they\'re waiting when you get home at night', home.map === 'farm' && home.wait !== null && home.wait <= 25 && home.warned, JSON.stringify(home));
  check('Away: the break-in report is shown when you get home', home.rep === 0);
  check('Away: hopping home and straight back doesn\'t reset the clock', home.debt >= 3 && /away recently/.test(await mod('./src/game/away.js', (m) => m.awayStatus())), String(home.debt));
  const decay = await C(() => { const c = window.__cus; const d0 = c.G.s.life.awayDebt; c.G.events.emit('newDay', c.G.s.time.day); return [d0, c.G.s.life.awayDebt]; });
  check('Away: each day back home forgives a day of being away', decay[1] === decay[0] - 1, decay.join(' -> '));
  await C(() => { const s = window.__cus.G.s; s.life.awayDebt = 0; s.time.minute = 10 * 60; s.world.siege = null; window.__cus.G.enemies = []; });

  // --- Letters ---
  await C(() => { const s = window.__cus.G.s; s.life.mailDrop = true; s.rel.dee = 40; s.life.lastMailDay = -1; s.life.read.l_dee_1 = 1; });
  await mod('./src/game/letters.js', (m) => m.deliverMail());
  const mail = await C(() => window.__cus.G.s.life.mail.map((x) => x.id));
  await mod('./src/game/letters.js', (m) => m.readMail()); await sleep(200); await skipDialogues(page);
  check('Life: an old friend\'s letter arrives in the mailbox and can be read', mail.includes('l_dee_2') && await C(() => !!window.__cus.G.s.life.read.l_dee_2), mail.join(','));

  // --- Projects: progress over days, survive save/load, cancel refunds ---
  await C(() => { const s = window.__cus.G.s; s.inv.toolkit = 1; s.inv.wood = 30; s.money = 1000; window.__cus.loadMap('farm'); });
  const spot = await C(() => !!(window.__cus.G.map.homeInfo.projectSpots.generator && window.__cus.G.map.homeInfo.projectSpots.garden));
  check('Life: new projects get build sites at the farm', spot);
  const pr = await mod('./src/game/projects.js', (m) => m.projectProps('farm').find((p) => p.project === 'generator'));
  await mod('./src/game/projects.js', (m) => { const p = m.projectProps('farm').find((x) => x.project === 'generator'); m.projectAction(p).action(); });
  for (let i = 0; i < 4; i++) { await C(() => window.__cus.G.repairGameHit && window.__cus.G.repairGameHit()); await sleep(40); }
  await C(() => { const z = document.querySelector('.rg-zone'); if (z) { for (let i = 0; i < 6 && window.__cus.G.repairGameHit; i++) window.__cus.G.repairGameHit(); } });
  // The minigame needs timing; drive it directly.
  await C(() => window.__cus.dbg.closeAll());
  const p1 = await C(() => { const r = window.__cus.G.s.home.projects.generator; return r && { p: r.progress, paid: r.paid }; });
  await mod('./src/game/projects.js', (m) => { m.work('generator', { free: true }); m.work('generator', { free: true }); });
  await C(() => window.__cus.saveGame('t', { force: true })); await C(() => window.__cus.continueGame()); await sleep(700); await skipDialogues(page);
  check('Life: a project is paid for up front, worked over days, finished — and survives a reload', !!pr && !!p1 && p1.paid.money === 120 && await C(() => window.__cus.G.s.home.projects.generator.done === true), JSON.stringify(p1));
  const cancel = await mod('./src/game/projects.js', (m) => { const s = window.__cus.G.s; s.home.projects.comfort = { progress: 1, lastDay: -1, done: false, paid: { wood: 8, money: 60 } }; const w = s.inv.wood, $ = s.money; const p = m.projectProps('farm').find((x) => x.project === 'comfort'); const a = m.projectAction(p); return { w, $, a: !!a }; });
  await C(() => window.__cus.dbg.closeAll());
  check('Life: an unfinished project shows work and cancel options', cancel.a);
  // Generator answers a power cut.
  const gen = await C(() => import('./src/game/watch.js').then((w) => { const c = window.__cus; c.G.s.home.upgrades.floodlight = true; return w.predictAdapt().map((a) => a.id + ':' + /generator will/.test(a.counter)); }));
  check('Life: with a floodlight they plan to cut the power — and the journal says the generator answers it', gen.includes('power:true'), gen.join(','));

  // --- Tier-2 skills ---
  const sk = await C(() => import('./src/game/progression.js').then((p) => { const s = window.__cus.G.s; s.jp.gunhand = 500; s.jp.shadow = 500; s.skills = s.skills.filter((x) => !['steady_hands', 'quick_reload', 'controlled_fire', 'misdirection'].includes(x)); const locked = !p.canBuySkill('controlled_fire'); p.buySkill('steady_hands'); p.buySkill('quick_reload'); const ok = p.buySkill('controlled_fire'); const twice = p.buySkill('controlled_fire'); return { locked, ok, twice, n: s.skills.filter((x) => x === 'controlled_fire').length }; }));
  check('Life: a tier-2 skill needs two from its path, works once and can\'t be bought twice', sk.locked && sk.ok && !sk.twice && sk.n === 1, JSON.stringify(sk));
  const steady = await C(() => import('./src/game/progression.js').then((p) => { const before = p.derived().spreadMult; window.__cus.G.player.steadyT = 0; return before; }));
  await page.keyboard.press('KeyG'); await sleep(150);
  const steady2 = await C(() => import('./src/game/progression.js').then((p) => ({ s: p.derived().spreadMult, t: window.__cus.G.player.steadyT, cd: (window.__cus.G.abilityCd || {}).controlled_fire })));
  check('Life: Controlled Fire (G) tightens aim for a few seconds, then cools down', steady2.t > 4 && steady2.s < steady * 0.5 && steady2.cd > 50, JSON.stringify({ steady, ...steady2 }));
  await sleep(500);
  check('Life: the ability shows on the HUD', /STEADY/.test(await C(() => document.getElementById('ability-tag').textContent)));
  const toss = await C(() => import('./src/game/enemies.js').then((en) => { const c = window.__cus; const p = c.G.player; c.G.enemies = []; const e = c.dbg.spawnEnemy('scout', p.x + 230, p.y); e.angle = 0; const n = en.distract(p.x + 200, p.y + 40); return { n, inv: !!e.investigate }; }));
  check('Life: Misdirection sends an unaware attacker to look at the noise', toss.n === 1 && toss.inv, JSON.stringify(toss));
  await C(() => { window.__cus.G.enemies = []; });

  // --- Side stories and farewells ---
  await C(() => { const s = window.__cus.G.s; s.story.flags.townOpen = true; s.rel.bo = 30; s.time.minute = 10 * 60; s.errands.bo_1 = { state: 'done', doneDay: 1 }; s.errands.bo_2 = { state: 'done', doneDay: 1 }; window.__cus.loadMap('farm'); });
  const side = await mod('./src/game/errands.js', (m) => m.offerErrand('bo')); await sleep(150); await skipDialogues(page, 0);
  check('Life: a side story is offered by its person (Bo: The Johansson Place)', side && await C(() => (window.__cus.G.s.errands.sd_land || {}).state === 'active'));
  await C(() => { const s = window.__cus.G.s; s.story.done[3] = true; s.story.step = 'ch3_free'; });
  await mod('./src/game/npcs.js', (m) => { const n = window.__cus.G.npcs.find((x) => x.id === 'bo'); m.interactNpc(n); }); await sleep(200); await skipDialogues(page);
  check('Life: after the chapter, friends say goodbye (once)', await C(() => !!window.__cus.G.s.life.ch[3].farewell.bo));

  // --- Ruth and Duke still behave ---
  await C(() => { const s = window.__cus.G.s; s.companion.ruth.joined = true; s.rel.ruth = 70; s.companion.dog = { owned: true, name: 'Duke', hurtDay: -1 }; window.__cus.loadMap('farm', window.__cus.G.maps.farm.points.porch); });
  check('Life: Ruth still lives with you and Duke still follows you at home', await C(() => window.__cus.G.npcs.some((n) => n.id === 'ruth') && !!window.__cus.G.dog));
  const trained = await C(() => import('./src/game/projects.js').then((p) => { window.__cus.G.s.home.projects.kennel = { progress: 3, done: true }; return p.dogTrained(); }));
  check('Life: a finished kennel trains Duke', trained === true);

  // --- Post-game respects the ending ---
  await toChapter(5);
  await C(() => { const s = window.__cus.G.s; s.story.done[5] = true; s.story.step = 'ch5_free'; s.ending = 'crown'; s.life.post = { ending: 'crown', day: s.time.day }; s.life.romance = { stage: 4, path: 'romance', invited: true }; s.world.quietUntilDay = s.time.day + 9999; });
  await mod('./src/game/letters.js', (m) => { m.romancePostgame(); });
  await C(() => { window.__cus.G.s.time.minute = 11 * 60; window.__cus.G.s.life.eventDay = window.__cus.G.s.time.day; window.__cus.loadMap('shorthills', window.__cus.G.maps.shorthills.points.porch); });
  await sleep(3500);
  // The letter types itself out; wait for the line rather than reading it mid-reveal.
  let crownTxt = '';
  for (let i = 0; i < 30 && !/what you are now/.test(crownTxt); i++) { crownTxt = await C(() => document.getElementById('dlg-text').textContent); if (!/what you are now/.test(crownTxt)) await sleep(100); }
  await skipDialogues(page);
  check('Life: after the story, the ending matters (as head of the family, Dee writes that she can\'t)', /what you are now/.test(crownTxt) && await C(() => window.__cus.G.s.life.romance.path === 'friend'), crownTxt.slice(0, 60));
  check('Life: life after the story has an objective and no attacks scheduled', /Life after the story/.test(await C(() => document.getElementById('objective').textContent)) && await C(() => !window.__cus.G.s.world.siege));
  const vis5 = await mod('./src/game/visits.js', (m) => m.visitableChapters());
  check('Life: every old town can be visited after the story', vis5.join(',') === '1,2,3,4');
  const postAway = await mod('./src/game/away.js', (m) => { const s = window.__cus.G.s; s.visit = { ch: 1, since: s.time.day * 1440 - 10 * 1440, met: {} }; const r = { n: m.noticed(), st: m.awayStatus() }; s.visit = null; return r; });
  check('Away: after the story nobody follows you — stay in an old town as long as you like', !postAway.n && /as long as you like/.test(postAway.st), JSON.stringify(postAway));

  // --- Every investigation and errand spot is reachable on its map ---
  const bad = await C(() => import('./src/world/mapgen.js').then(async (mg) => {
    const { newHome } = await import('./src/game/state.js');
    const { ERRANDS } = await import('./src/game/errands.js');
    const { WATCH } = await import('./src/data/watch.js');
    const maps = { cabin: mg.buildCabinMap(newHome('cabin')), town: mg.buildTownMap(), millbrook: mg.buildMillbrookMap(newHome('house')), farm: mg.buildFarmMap(newHome('farm')), estate: mg.buildEstateMap(newHome('estate')), shorthills: mg.buildShortHillsMap(newHome('watchhouse')) };
    const out = [];
    const chk = (map, [x, y], what) => { const m = maps[map]; if (!m) return; const cx = Math.floor(x), cy = Math.floor(y); let ok = false; for (let oy = -1; oy <= 1 && !ok; oy++) for (let ox = -1; ox <= 1; ox++) { const s = m.getSolid(cx + ox, cy + oy); if (s === 0 || s === 6) { ok = true; break; } } if (!ok) out.push(`${what}@${map}:${x},${y}`); };
    for (const [id, e] of Object.entries(ERRANDS)) for (const st of e.stages) { if (st.at) chk(st.map, st.at, id); for (const sp of st.spots || []) chk(st.map, sp, id); }
    const hm = { 1: 'cabin', 2: 'millbrook', 3: 'farm', 4: 'estate', 5: 'shorthills' };
    for (const [n, w] of Object.entries(WATCH)) { for (const [id, sg] of Object.entries(w.signs || {})) if (sg.at) chk(hm[n], sg.at, id); if (w.aftermath) chk(hm[n], w.aftermath.at, 'after' + n); }
    return out;
  }));
  check('Life: every errand, side story, watcher and aftermath spot is on open ground', bad.length === 0, bad.join(' '));
  await ctx.close();

  // --- Touch: the ability button on a phone ---
  const tctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const tp2 = await tctx.newPage(); watch(tp2, 'life-touch');
  await tp2.goto(URL); await tp2.waitForSelector('#t-new');
  await tp2.evaluate(() => window.__cus.newGame('normal')); await sleep(600);
  await tp2.evaluate(() => { const c = window.__cus; c.dbg.closeAll(); for (let i = 0; i < 20; i++) document.getElementById('dlg-skip').click(); c.G.s.skills.push('misdirection'); });
  await sleep(500);
  const shown = await tp2.isVisible('#btn-skill');
  await tp2.tap('#btn-skill'); await sleep(200);
  check('Life (touch): the ability button appears once you have one, and tapping it fires it', shown && await tp2.evaluate(() => (window.__cus.G.abilityCd || {}).misdirection > 0));
  await tp2.screenshot({ path: OUT + 'life-touch.png' });
  await tctx.close();
}

/* ================================================================== */
/* Seasons (v0.12): the year, day length, weather, ice, tracks, mud,   */
/* fire, seasonal days, visuals                                        */
/* ================================================================== */
if (want('seasons')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'seasons');
  await page.goto(URL); await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  const mod = (path, fn, a) => page.evaluate(([p, f, a]) => import(p).then((m) => (new Function('m', 'a', 'return (' + f + ')(m, a)'))(m, a)), [path, fn.toString(), a]);
  await C(() => window.__cus.newGame('normal')); await sleep(500); await skipDialogues(page);
  await C(() => { const s = window.__cus.G.s; s.story.flags.firstSiegeDone = true; s.world.quietUntilDay = 9999; s.world.siege = null; window.__cus.dbg.closeAll(); });
  const setDay = (d, min = 12 * 60) => C(([d, min]) => { const s = window.__cus.G.s; s.time.day = d; s.time.minute = min; s.world.lastDayProcessed = d; s.life.eventDay = d; }, [d, min]);

  const yr = await mod('./src/game/seasons.js', (m) => [1, 12, 13, 25, 37, 48, 49].map((d) => m.seasonIdOf(d)).join(','));
  check('Seasons: the year runs autumn, winter, spring, summer — twelve days each, then round again', yr === 'autumn,autumn,winter,spring,summer,summer,autumn', yr);

  // Day length.
  const nights = await C(() => import('./src/game/state.js').then((st) => { const s = window.__cus.G.s; const at = (d, h) => { s.time.day = d; s.time.minute = h * 60; return st.isNight(); }; return { w19: at(14, 19), a19: at(2, 19), a20: at(2, 20), s21: at(40, 21), s22: at(40, 22), w630: at(14, 6.5), s530: at(40, 5.5) }; }));
  check('Seasons: winter nights come early and leave late, summer nights are short, autumn keeps 8 PM–6 AM', nights.w19 && !nights.a19 && nights.a20 && !nights.s21 && nights.s22 && nights.w630 && !nights.s530, JSON.stringify(nights));

  // Weather by season.
  const wx = await C(() => import('./src/game/weather.js').then((W) => { const s = window.__cus.G.s; const roll = (d) => { const out = {}; s.time.day = d; s.time.minute = 12 * 60; for (let i = 0; i < 300; i++) { s.world.weather = null; s.world.siege = null; const k = W.weather().kind; out[k] = (out[k] || 0) + 1; } return out; }; return { winter: roll(15), summer: roll(40), spring: roll(26) }; }));
  check('Seasons: winter brings snow instead of rain; summer is dry', !wx.winter.rain && wx.winter.snow > 30 && !wx.summer.snow && (wx.summer.rain || 0) < 40, JSON.stringify(wx));

  // Winter at home: ice, tracks, hiding, banner, seasonal day.
  await setDay(12, 9 * 60);
  await C(() => { window.__cus.loadMap('cabin', window.__cus.G.maps.cabin.points.porch); });
  await sleep(1800);
  await setDay(13, 9 * 60); await sleep(1900);
  const ban = await C(() => [...document.querySelectorAll('.banner, #banner')].map((b) => b.textContent).join(' '));
  check('Seasons: a new season is announced with what it changes', /Winter/.test(ban) && /freeze/.test(ban), ban.slice(0, 140));
  const ice = await C(() => import('./src/world/map.js').then(({ SO }) => { const m = window.__cus.G.map; let cell = null; for (let i = 0; i < m.w * m.h && !cell; i++) if (m.solid[i] === SO.WATER) cell = [i % m.w, Math.floor(i / m.w)]; if (!cell) return null; const w = m.blocksMove(cell[0], cell[1], 'player'); window.__cusSeason = 'autumn'; const a = m.blocksMove(cell[0], cell[1], 'player'); window.__cusSeason = null; return { w, a }; }));
  check('Seasons: in winter the pond freezes hard enough to walk on (in autumn it\'s water)', ice && ice.w === false && ice.a === true, JSON.stringify(ice));
  await C(() => { const c = window.__cus, mm = c.G.map, p = c.G.player; c.G.tracks = []; for (let y = 4; y < mm.h - 4; y++) for (let x = 4; x < mm.w - 8; x++) { let ok = true; for (let k = 0; k < 6 && ok; k++) ok = mm.ground[mm.idx(x + k, y)] === 0 && !mm.blocksMove(x + k, y, 'player') && !mm.buildingAt((x + k) * 32 + 16, y * 32 + 16); if (ok) { p.x = x * 32 + 16; p.y = y * 32 + 16; return; } } });
  await page.keyboard.down('KeyD'); await sleep(700); await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyS'); await sleep(500); await page.keyboard.up('KeyS');
  const trk = await C(() => (window.__cus.G.tracks || []).filter((t) => t.who === 'player').length);
  check('Seasons: walking in snow leaves tracks', trk >= 2, String(trk));
  const hm = await mod('./src/game/seasons.js', (m) => m.hideMult());
  check('Seasons: in snow they follow your tracks — hiding takes longer to work', hm === 1.5, String(hm));
  await C(() => { const s = window.__cus.G.s; s.time.minute = 9 * 60; s.life.eventDay = -1; s.time.day = 14; s.world.lastDayProcessed = 14; });
  await sleep(2500);
  const snowDay = await C(() => ({ text: document.getElementById('dlg-text').textContent, open: !document.getElementById('dialogue').classList.contains('hidden') }));
  await skipDialogues(page);
  check('Seasons: a winter morning at home can bring a snow day (once a year)', snowDay.open && /white/.test(snowDay.text) && await C(() => !!window.__cus.G.s.life.seasonal['snow_day:1']), snowDay.text.slice(0, 80));
  await page.screenshot({ path: OUT + 'seasons-winter.png' });
  const layer = await C(() => window.__cus.G.map.groundCanvas.season === 'winter');
  check('Seasons: the land is drawn for the season (snow cover and ice)', layer);
  await C(() => window.__cus.dbg.openMenu('journal')); await sleep(300);
  await page.click('.subtab[data-id="cal"]').catch(() => {}); await sleep(200);
  const cal = await C(() => document.querySelector('.modal-body').innerText);
  check('Seasons: the Journal calendar shows the season, its day and what\'s coming', /Winter/.test(cal) && /day 2 of 12/.test(cal) && /Spring in 11 days/.test(cal), cal.slice(0, 200));
  await C(() => window.__cus.dbg.closeAll());

  // Spring mud, summer fire.
  const mud = await mod('./src/game/seasons.js', (m) => { const c = window.__cus; const s = c.G.s; s.time.day = 26; s.world.lastRainDay = 26; const p = c.G.map.points.porch; let spot = null; const mm = c.G.map; for (let y = 0; y < mm.h && !spot; y++) for (let x = 0; x < mm.w; x++) if (mm.ground[mm.idx(x, y)] === 0 && !mm.buildingAt(x * 32 + 16, y * 32 + 16)) { spot = [x * 32 + 16, y * 32 + 16]; break; } const wet = m.groundSpeed(spot[0], spot[1]); s.world.lastRainDay = 20; const dry = m.groundSpeed(spot[0], spot[1]); return { wet, dry, p: !!p }; });
  check('Seasons: spring rain turns open ground to mud that slows everyone; it dries out', mud.wet < 1 && mud.dry === 1, JSON.stringify(mud));
  const fire = await C(() => import('./src/game/fire.js').then((F) => { const c = window.__cus; const s = c.G.s; c.G.fires = []; s.time.day = 40; F.startFire(0, 0); const summer = c.G.fires[0].life; s.time.day = 2; F.startFire(0, 0); const autumn = c.G.fires[1].life; s.time.day = 15; F.startFire(0, 0); const winter = c.G.fires[2].life; c.G.fires = []; return { summer, autumn, winter }; }));
  check('Seasons: summer fires burn longer, snow damps them', fire.summer > fire.autumn && fire.winter < fire.autumn, JSON.stringify(fire));
  await C(() => { const s = window.__cus.G.s; s.time.day = 40; s.time.minute = 12 * 60; });
  await sleep(300); await page.screenshot({ path: OUT + 'seasons-summer.png' });

  // Estate ice: in winter the lake crew walks over.
  const est = await C(() => import('./src/game/seasons.js').then((S) => { const c = window.__cus; c.dbg.moveToChapter && null; return S.frozen(); }));
  check('Seasons: the lake is frozen in winter only (the estate\'s lake crew walks across it)', est === false);

  // Endless runs get a season; the daily challenge's is the same for everyone.
  const en = await C(() => import('./src/game/endless.js').then((E) => { const a = E.dailyChallenge(20000), b = E.dailyChallenge(20000); return ['autumn', 'winter', 'spring', 'summer'][a.seed % 4] === ['autumn', 'winter', 'spring', 'summer'][b.seed % 4]; }));
  check('Seasons: the daily challenge picks the same season for everyone', en);
  await ctx.close();
}

/* ================================================================== */
/* Chapter 6 (v0.13): Keystone — the call, casing Broad Street, the    */
/* strike on the watch house, the night inside, the list               */
/* ================================================================== */
if (want('keystone')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'keystone');
  await page.goto(URL); await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  const mod = (path, fn, a) => page.evaluate(([p, f, a]) => import(p).then((m) => (new Function('m', 'a', 'return (' + f + ')(m, a)'))(m, a)), [path, fn.toString(), a]);
  const waitTransition = async () => { for (let i = 0; i < 40 && await C(() => !!window.__cus.G.transition); i++) await sleep(100); await sleep(200); };
  await C(() => window.__cus.newGame('normal')); await sleep(500); await skipDialogues(page);
  await C(() => { const c = window.__cus; const d = {}; for (let i = 1; i < 5; i++) d[i] = true; c.G.s.story.done = d; c.G.s.story.chapterComplete = true; c.G.s.world.siege = null; c.dbg.moveToChapter(5); });
  await sleep(500); await page.click('[data-go]').catch(() => {}); await sleep(300); await skipDialogues(page);
  await C(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); c.dbg.closeAll(); });
  await skipDialogues(page);
  await C(() => { const c = window.__cus, s = c.G.s; s.story.done[5] = true; s.story.step = 'ch5_free'; s.ending = 'justice'; s.life.post = { ending: 'justice', day: s.time.day }; s.world.quietUntilDay = s.time.day + 9999; s.world.siege = null; s.story.flags.firstSiegeDone = true; s.story.flags.blueprintRead = true; s.time.day += 3; s.time.minute = 10 * 60; s.life.eventDay = -1; s.world.lastDayProcessed = s.time.day; c.loadMap('shorthills', c.G.maps.shorthills.points.porch); });
  let call = '';
  for (let i = 0; i < 12 && !call; i++) { await sleep(800); const t = await C(() => document.getElementById('dialogue').classList.contains('hidden') ? '' : document.getElementById('dlg-text').textContent); if (/phone rings/.test(t)) call = t; else if (t) await skipDialogues(page); }
  await skipDialogues(page); await sleep(600);
  const st1 = await C(() => ({ stage: window.__cus.G.s.keystone && window.__cus.G.s.keystone.stage, errand: (window.__cus.G.s.errands.k6_case || {}).state, obj: document.getElementById('objective').textContent }));
  check('Keystone: a few days after the ending, Marcus calls — and Chapter 6 opens', st1.stage === 'case' && st1.errand === 'active' && /Keystone/.test(st1.obj), JSON.stringify(st1));
  const car = await mod('./src/game/keystone.js', (m) => (m.keystoneCar(() => {}) || {}).label);
  check('Keystone: the car offers the drive to Broad Street', /Broad Street/.test(car || ''), car);
  await C(() => { const c = window.__cus; c.loadMap('broad', c.G.maps.broad.points.car); }); await sleep(800);
  await page.screenshot({ path: OUT + 'keystone-broad.png' });
  check('Keystone: Broad Street, Newark loads — Keystone Title, Club Ventura, the luncheonette, the garage', await C(() => { const m = window.__cus.G.map; return m.id === 'broad' && ['keystone', 'ventura', 'luncheonette', 'garage6'].every((id) => m.buildings.some((b) => b.id === id)); }));
  const stepVisit = () => mod('./src/game/errands.js', (m) => { const pr = m.errandProps('broad')[0]; if (pr) m.errandPropAction(pr); return !!pr; });
  await stepVisit(); await sleep(200); await skipDialogues(page);
  await C(() => { window.__cus.G.s.time.minute = 12 * 60; }); await sleep(1800);
  check('Keystone: the clerk is at her lunch booth while that part is open', await C(() => window.__cus.G.npcs.some((n) => n.id === 'gloria')));
  await stepVisit(); await sleep(200); await skipDialogues(page, 0);
  const st2 = await C(() => window.__cus.G.s.errands.k6_case);
  check('Keystone: Gloria talks — your choice is remembered for the night', st2.stage === 2 && st2.choice === 'kind', JSON.stringify(st2));
  await C(() => { window.__cus.G.s.time.minute = 18 * 60; });
  await stepVisit(); await sleep(300);
  const tailing = await C(() => !!window.__cus.G.tail && /Carmine/.test(window.__cus.G.tail.name));
  await C(() => { const c = window.__cus; const T = c.G.tail; c.G.npcs = c.G.npcs.filter((n) => n !== T.n); c.G.tail = null; T.onDone(true); });
  await sleep(300); await skipDialogues(page);
  check('Keystone: tailing Carmine Ventura from the office', tailing && await C(() => window.__cus.G.s.errands.k6_case.stage === 3));
  await stepVisit(); await sleep(300); await skipDialogues(page); await sleep(600); await skipDialogues(page);
  const st3 = await C(() => { const s = window.__cus.G.s; return { stage: s.keystone.stage, card: s.inv.keycard || 0, siege: !!(s.world.siege && s.world.siege.plan.keystone), errand: s.errands.k6_case.state }; });
  check('Keystone: the keycard is in Carmine\'s car — and now they\'ll come for the watch house', st3.stage === 'strike' && st3.card === 1 && st3.siege && st3.errand === 'done', JSON.stringify(st3));
  // The strike on the watch house.
  await C(() => { const c = window.__cus; c.loadMap('shorthills', c.G.maps.shorthills.points.cabin_in); const sg = c.G.s.world.siege; c.G.s.time.day = sg.day; c.G.s.time.minute = sg.minute - 2; c.G.player.invuln = 99999; });
  for (let i = 0; i < 100 && !(await C(() => window.__cus.G.siegeActive)); i++) await sleep(100);
  await sleep(400);
  for (let i = 0; i < 40; i++) { await C(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); if (c.G.siege) c.G.siege.t += 30; }); await sleep(120); }
  const sonny = await C(() => window.__cus.G.enemies.some((e) => e.name === 'Sonny Ventura'));
  for (let i = 0; i < 200; i++) { await sleep(150); await C(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); if (c.G.siege) c.G.siege.t += 30; for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); if (!(await C(() => window.__cus.G.siegeActive))) break; }
  await sleep(2400); await page.locator('#modal-root button', { hasText: 'Continue' }).click().catch(() => {}); await sleep(3800); await skipDialogues(page);
  check('Keystone: Sonny Ventura leads the strike on the watch house; holding it opens the way to Broad Street', sonny && await C(() => window.__cus.G.s.keystone.stage === 'break'));
  // The night inside.
  await C(() => { const c = window.__cus; c.G.s.time.minute = 22 * 60; c.G.player.invuln = 99999; c.loadMap('broad', c.G.maps.broad.points.car); });
  await sleep(500); await C(() => { if (window.__cus.G.cutscene) window.__cus.dbg.skipCutscene(); }); await sleep(300);
  const night = await C(() => { const c = window.__cus, m = c.G.map; const dr = (id) => [...m.blockers.values()].find((b) => b.id === id); return { guards: c.G.enemies.filter((e) => e.keystone && !e.dead).length, back: dr('ks_back').rec.locked, front: dr('ks_front_l').rec.locked, rec: dr('records_door').rec.locked, carmine: c.G.npcs.some((n) => n.id === 'carmine') }; });
  check('Keystone: at night guards walk their posts; Gloria left the back door open; the records room is locked', night.guards === 5 && night.back === false && night.front === true && night.rec === true && night.carmine, JSON.stringify(night));
  await page.screenshot({ path: OUT + 'keystone-night.png' });
  const opened = await mod('./src/game/keystone.js', (m) => { const b = [...window.__cus.G.map.blockers.values()].find((x) => x.id === 'records_door'); m.tryKeystoneDoor(b); return b.rec.locked === false && b.rec.open === true; });
  check('Keystone: Carmine\'s keycard opens the records room', opened);
  const alarm = await C(() => new Promise((res) => { const c = window.__cus; const g = c.G.enemies.find((e) => e.keystone && !e.dead); g.alerted = true; setTimeout(() => { const N = c.G.ksNight; const a = N.alarm; N.reinfT = 0.01; setTimeout(() => res({ a, n: c.G.enemies.filter((e) => e.keystone && !e.dead).length }), 400); }, 400); }));
  check('Keystone: if a guard raises the alarm, Club Ventura sends three more', alarm.a && alarm.n === 8, JSON.stringify(alarm));
  await mod('./src/game/keystone.js', (m) => { const pr = m.keystoneProps('broad')[0]; m.keystonePropAction(pr).action(); });
  await sleep(300); await skipDialogues(page, 0); await sleep(600);
  const fin = await C(() => { const s = window.__cus.G.s; return { stage: s.keystone.stage, choice: s.choices.keystone, card: s.inv.keycard || 0, fleeing: window.__cus.G.enemies.filter((e) => e.keystone && !e.dead && !e.retreating).length }; });
  check('Keystone: in the records room, Carmine and the list — and the choice (handed to Reyes) ends the chapter', fin.stage === 'done' && fin.choice === 'reyes' && fin.card === 0 && fin.fleeing === 0, JSON.stringify(fin));
  await C(() => { const c = window.__cus, s = c.G.s; c.G.enemies = []; c.G.ksNight = null; s.time.day += 5; s.time.minute = 10 * 60; s.life.eventDay = -1; s.world.lastDayProcessed = s.time.day; c.loadMap('shorthills', c.G.maps.shorthills.points.porch); });
  let letter = '';
  for (let i = 0; i < 14 && !(await C(() => window.__cus.G.s.keystone.letter)); i++) { await sleep(800); await skipDialogues(page); await C(() => { window.__cus.G.s.life.eventDay = -1; }); }
  letter = await C(() => document.getElementById('dlg-text').textContent);
  await skipDialogues(page);
  check('Keystone: a week later, a letter about what the list became', await C(() => window.__cus.G.s.keystone.letter === true), letter.slice(0, 80));
  await C(() => window.__cus.saveGame('t', { force: true })); await C(() => window.__cus.continueGame()); await sleep(800); await skipDialogues(page);
  check('Keystone: the finished chapter survives a reload', await C(() => window.__cus.G.s.keystone.stage === 'done' && window.__cus.G.s.choices.keystone === 'reyes'));
  await ctx.close();
}

/* ================================================================== */
/* The Long Night (v0.14): a roguelite run of Endless Siege             */
/* ================================================================== */
if (want('longnight')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'longnight');
  await page.goto(URL); await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  const mod = (path, fn, a) => page.evaluate(([p, f, a]) => import(p).then((m) => (new Function('m', 'a', 'return (' + f + ')(m, a)'))(m, a)), [path, fn.toString(), a]);
  await C(() => { localStorage.removeItem('cabin-under-siege-longnight'); });
  check('Night: The Long Night is on the title screen', await page.isVisible('#t-longnight'));
  await page.click('#t-longnight'); await sleep(400);
  const pick = await C(() => document.querySelector('.modal-body').innerText);
  check('Night: its screen explains the run, shows embers and the perks they buy', /Ten waves from dusk to dawn/.test(pick) && /embers/.test(pick) && /Harold's Shotgun/.test(pick), pick.slice(0, 120));
  await page.screenshot({ path: OUT + 'night-picker.png' });
  await page.click('[data-run]'); await sleep(1200);
  const st = await C(() => { const c = window.__cus, E = c.G.endless; return { run: !!(E && E.run), site: E && E.site.id, season: E && E.season, minute: c.G.s.time.minute, open: Object.values(c.G.s.home.openings).filter((o) => !o.gate).map((o) => o.kind === 'door' ? o.hp : (o.glass === 0 ? 'x' : o.boards ? 'b' : 'w')).join(',') }; });
  check('Night: a run starts at a home you\'ve unlocked, in a season, at dusk, with the house already knocked about', st.run && st.site === 'cabin' && ['autumn', 'winter', 'spring', 'summer'].includes(st.season) && st.minute === 20 * 60, JSON.stringify(st));
  // Clear wave 1 and choose a boon.
  const clearWave = async () => {
    await C(() => { const E = window.__cus.G.endless; if (E.state === 'break') E.breakT = 0; });
    for (let i = 0; i < 40 && !(await C(() => window.__cus.G.siegeActive)); i++) await sleep(100);
    for (let i = 0; i < 200; i++) { await sleep(120); await C(() => { const c = window.__cus; c.G.player.invuln = 99999; if (c.G.siege) c.G.siege.t += 30; for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); if (!(await C(() => window.__cus.G.siegeActive))) break; }
  };
  await clearWave(); await sleep(3900);
  const offer = await C(() => [...document.querySelectorAll('[data-boon]')].map((b) => b.dataset.boon));
  check('Night: after a wave, the night waits while you pick one of three boons', offer.length === 3 && await C(() => window.__cus.G.endless.state === 'boon'), offer.join(','));
  await page.screenshot({ path: OUT + 'night-boons.png' });
  await page.click('[data-boon]'); await sleep(300);
  check('Night: picking a boon starts the next countdown', await C(() => window.__cus.G.endless.state === 'break' && window.__cus.G.endless.run.boons.length === 1 && !window.__cus.G.modal));
  check('Night: the clock moves an hour a wave toward dawn', await C(() => window.__cus.G.s.time.minute === 21 * 60));
  // Boons change the numbers.
  const fx = await mod('./src/game/longnight.js', (m) => Promise.all([import('./src/game/progression.js'), import('./src/game/player.js')]).then(([P, PL]) => {
    const c = window.__cus, R = m.run();
    const hp0 = P.derived().maxHp, rl0 = P.derived().reloadTime;
    R.offer = ['tough', 'quick_hands', 'iron']; m.takeBoon('tough'); R.offer = ['quick_hands']; m.takeBoon('quick_hands'); R.offer = ['iron']; m.takeBoon('iron');
    const hp1 = P.derived().maxHp, rl1 = P.derived().reloadTime;
    const p = c.G.player; p.invuln = 0; p.hp = 100; PL.damagePlayer(20, p.x + 10, p.y); const took = 100 - p.hp; p.invuln = 99999;
    R.offer = ['fortify']; m.takeBoon('fortify'); const fort = Object.values(c.G.s.home.openings).filter((o) => !o.gate).every((o) => o.kind === 'door' ? o.reinforced : o.boards);
    return { hp: hp1 - hp0, rl: Math.round((rl1 / rl0) * 100), took, fort };
  }));
  check('Night: boons work — Thick Skin, Quick Hands, Iron Will, Fortify', fx.hp === 25 && fx.rl === 70 && fx.took === 17 && fx.fort, JSON.stringify(fx));
  const om = await mod('./src/game/longnight.js', (m) => { const o = m.maybeOmen(3); const t = m.omenTypes(6); return { o, t: t.length, none: m.maybeOmen(4) }; });
  check('Night: every third wave brings an omen that changes the waves', !!om.o && om.none === null, JSON.stringify(om));
  // Dawn: wave 10.
  await C(() => { const E = window.__cus.G.endless; E.wave = 9; E.state = 'break'; });
  await clearWave(); await sleep(4200);
  const dawn = await C(() => ({ t: (document.querySelector('.modal-body') || {}).innerText || '', d: JSON.parse(localStorage.getItem('cabin-under-siege-longnight')) }));
  check('Night: survive wave ten and the sun comes up — embers earned, a dawn counted', /DAWN/.test(dawn.t) && dawn.d.dawns === 1 && dawn.d.embers >= 20, JSON.stringify(dawn.d));
  await page.screenshot({ path: OUT + 'night-dawn.png' });
  await page.click('[data-again]'); await sleep(600);
  check('Night: "Another night" goes back to the Long Night screen', /The Long Night/.test(await C(() => (document.querySelector('.modal-body') || {}).innerText || '')));
  await page.click('[data-perk="start_shotgun"]'); await sleep(300);
  const owned = await C(() => JSON.parse(localStorage.getItem('cabin-under-siege-longnight')).perks.start_shotgun === true);
  check('Night: embers buy a permanent perk', owned);
  await page.click('[data-run]'); await sleep(1200);
  check('Night: the perk applies to the next run (start with the shotgun)', await C(() => (window.__cus.G.s.inv.shotgun || 0) > 0));
  // Losing.
  await C(() => { const E = window.__cus.G.endless; E.breakT = 0; });
  for (let i = 0; i < 40 && !(await C(() => window.__cus.G.siegeActive)); i++) await sleep(100);
  await C(() => import('./src/game/player.js').then((PL) => { const p = window.__cus.G.player; p.invuln = 0; p.hp = 1; PL.damagePlayer(999, p.x + 5, p.y); }));
  await sleep(3200);
  check('Night: if the night wins, the run ends with what it earned', /The night won/.test(await C(() => (document.querySelector('.modal-body') || {}).innerText || '')) && await C(() => JSON.parse(localStorage.getItem('cabin-under-siege-longnight')).runs === 2));
  await page.click('[data-title]').catch(() => {}); await sleep(500);
  // The daily Long Night: the same for everyone.
  const daily = await mod('./src/game/endless.js', (m) => { const a = m.dailyNight('2026-11-02'), b = m.dailyNight('2026-11-02'), c = m.dailyNight('2026-11-03'); return a.site === b.site && a.seed === b.seed && a.seed !== c.seed; });
  check('Night: the daily Long Night is seeded by the date', daily);
  const offers = [];
  for (let k = 0; k < 2; k++) {
    await C(() => window.__cus.dbg.closeAll());
    await mod('./src/game/endless.js', (m) => { m.startEndless(m.dailyNight('2026-11-02').site, window.__cus.startGameForTest, { run: { daily: m.dailyNight('2026-11-02') } }); });
    await sleep(800);
    offers.push(await mod('./src/game/longnight.js', (m) => m.drawOffer().join(',') + '|' + window.__cus.G.endless.season));
  }
  check('Night: two players on the same daily get the same season and the same boons', offers[0] === offers[1] && offers[0].length > 5, offers.join(' / '));
  const board = await C(async () => {
    const day = new Date().toISOString().slice(0, 10);
    const post = await fetch('/api/scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day, waves: 7, kills: 60, name: 'Night Owl', player: 'p-night', platform: 'Web', board: 'night' }) }).then((r) => r.json());
    const night = await fetch(`/api/scores?day=${day}&board=night`).then((r) => r.json());
    const endless = await fetch(`/api/scores?day=${day}`).then((r) => r.json());
    return { rank: post.rank, nb: night.board, n: night.top.some((x) => x.name === 'Night Owl'), e: endless.top.some((x) => x.name === 'Night Owl') };
  });
  check('Night: the daily Long Night has its own leaderboard, separate from the Endless one', board.rank === 1 && board.nb === 'night' && board.n && !board.e, JSON.stringify(board));
  await ctx.close();
}

/* ================================================================== */
/* v0.15: orders for Ruth and Duke; accessibility options              */
/* ================================================================== */
if (want('access')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'access');
  await page.goto(URL); await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  const mod = (path, fn, a) => page.evaluate(([p, f, a]) => import(p).then((m) => (new Function('m', 'a', 'return (' + f + ')(m, a)'))(m, a)), [path, fn.toString(), a]);
  await C(() => window.__cus.newGame('normal')); await sleep(500); await skipDialogues(page);
  await C(() => { const c = window.__cus, s = c.G.s; c.dbg.closeAll(); s.rel.ruth = 60; s.story.flags.firstSiegeDone = true; s.companion.dog = { owned: true, name: 'Duke', hurtDay: -1 }; s.time.minute = 21 * 60; c.loadMap('cabin', c.G.maps.cabin.points.porch); });
  await sleep(400);
  await C(() => { const c = window.__cus; c.G.player.invuln = 99999; c.dbg.startSiege({ plan: { kind: 'raid', hpMult: 1, waves: [{ dir: Object.keys(c.G.map.spawns)[0], types: ['scout'], delay: 999 }] } }); });
  await sleep(600);
  const can = await C(() => import('./src/game/orders.js').then((o) => ({ can: o.canOrder(), opts: o.orderOptions().map((x) => x.label) })));
  check('Orders: in an attack, Ruth and Duke both take orders', can.can && can.opts.some((l) => /Ruth: Cover the back door/.test(l)) && can.opts.some((l) => /Duke: Hold the porch/.test(l)), JSON.stringify(can));
  await page.keyboard.press('KeyO'); await sleep(300);
  const om = await C(() => ({ m: window.__cus.G.modal, t: (document.querySelector('.modal-body') || {}).innerText || '' }));
  check('Orders: O opens the orders menu (and pauses)', om.m && /Ruth: Stay with me/.test(om.t), JSON.stringify(om).slice(0, 120));
  await C(() => window.__cus.dbg.closeAll());
  const follow = await C(() => import('./src/game/orders.js').then((o) => new Promise((res) => { const c = window.__cus, p = c.G.player, r = c.G.npcs.find((n) => n.id === 'ruth'); const d0 = Math.hypot(r.x - p.x, r.y - p.y); o.giveOrder('ruth', 'follow'); setTimeout(() => res({ d0: Math.round(d0), d1: Math.round(Math.hypot(r.x - p.x, r.y - p.y)), ord: o.ruthOrder() }), 9000); })));
  check('Orders: "Stay with me" brings Ruth to your side', follow.ord === 'follow' && follow.d1 < 90, JSON.stringify(follow));
  const yard = await C(() => import('./src/game/orders.js').then((o) => new Promise((res) => { const c = window.__cus, dg = c.G.dog, pc = c.G.map.homeInfo.porch; c.G.player.x += 400; o.giveOrder('duke', 'yard'); setTimeout(() => res({ d: Math.round(Math.hypot(dg.x - pc.x, dg.y - pc.y)) }), 3500); })));
  check('Orders: "Hold the porch" keeps Duke at the porch, even when you walk off', yard.d < 60, JSON.stringify(yard));
  const lbl = await C(() => { const c = window.__cus, r = c.G.npcs.find((n) => n.id === 'ruth'); c.G.player.x = r.x + 20; c.G.player.y = r.y; return new Promise((res) => setTimeout(() => res(c.G.interactTarget && c.G.interactTarget.label), 300)); });
  check('Orders: walking up to Ruth in an attack offers orders, not small talk', /Give Ruth an order/.test(lbl || ''), lbl);
  await C(() => { const c = window.__cus; c.G.siegeActive = false; c.G.siege = null; c.G.enemies = []; import('./src/game/ally.js').then((a) => a.allyEndSiege()); });
  await sleep(200);
  check('Orders: orders reset when the attack ends', await C(() => import('./src/game/orders.js').then((o) => o.ruthOrder() === 'post' && o.dukeOrder() === 'hunt')));
  // Accessibility.
  await C(() => window.__cus.dbg.openMenu('settings')); await sleep(300);
  const setTxt = await C(() => document.querySelector('.modal-body').innerText);
  check('Access: Settings has an Accessibility section (captions, flashes, contrast, game speed)', /Accessibility/.test(setTxt) && /Sound captions/.test(setTxt) && /Reduce flashes/.test(setTxt) && /High-contrast/.test(setTxt) && /Game speed/.test(setTxt));
  await page.click('[data-set="captions"]'); await sleep(150);
  await C(() => window.__cus.dbg.closeAll());
  await C(() => { const c = window.__cus, p = c.G.player; c.dbg.sfx('enemyShot', { x: p.x + 300, y: p.y }); });
  await sleep(200);
  const cap = await C(() => document.getElementById('captions').innerText);
  check('Access: sound captions say what you heard and from which way', /Gunshot \(east\)/.test(cap) && await C(() => window.__cus.G.settings.captions === true), cap);
  await page.screenshot({ path: OUT + 'access-captions.png' });
  const speed = await C(() => new Promise((res) => { const c = window.__cus; const t0 = c.G.s.time.minute; setTimeout(() => { const n = c.G.s.time.minute - t0; c.G.settings.gameSpeed = 'slower'; const t1 = c.G.s.time.minute; setTimeout(() => { const sl = c.G.s.time.minute - t1; c.G.settings.gameSpeed = 'normal'; res({ n, sl, r: sl / n }); }, 2000); }, 2000); }));
  check('Access: a slower game speed slows the whole game', speed.r > 0.5 && speed.r < 0.8, JSON.stringify(speed));
  await C(() => { window.__cus.G.settings.reduceFlashes = true; window.__cus.G.settings.highContrast = true; window.__cus.dbg.spawnEnemy('gunman', window.__cus.G.player.x + 120, window.__cus.G.player.y); });
  await sleep(400); await page.screenshot({ path: OUT + 'access-contrast.png' });
  check('Access: reduced flashes and high contrast render without errors', await C(() => window.__cus.G.running));
  await ctx.close();
}

/* ================================================================== */
/* v0.16: the Defense Plan and the Scrapbook                           */
/* ================================================================== */
if (want('plan')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'plan');
  await page.goto(URL); await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  const mod = (path, fn, a) => page.evaluate(([p, f, a]) => import(p).then((m) => (new Function('m', 'a', 'return (' + f + ')(m, a)'))(m, a)), [path, fn.toString(), a]);
  await C(() => { localStorage.removeItem('cabin-under-siege-scrapbook'); window.__cus.newGame('normal'); }); await sleep(500); await skipDialogues(page);
  await C(() => { const c = window.__cus, s = c.G.s; c.dbg.closeAll(); s.inv.sandbags = 2; s.inv.bear_trap = 2; s.rel.ruth = 60; s.story.flags.firstSiegeDone = true; s.time.minute = 12 * 60; c.loadMap('cabin', c.G.maps.cabin.points.porch); });
  await sleep(300);
  await page.keyboard.press('KeyB'); await sleep(400);
  const pl = await C(() => ({ m: window.__cus.G.modal, w: (document.querySelector('[data-plan]') || {}).width || 0, t: document.querySelector('.modal-body').innerText }));
  check('Plan: B opens the Defense Plan — your property from above, with a legend', pl.m === 'plan' && pl.w > 200 && /Defense Plan/.test(pl.t) && /where they come from/.test(pl.t), JSON.stringify({ m: pl.m, w: pl.w }));
  await page.screenshot({ path: OUT + 'plan.png' });
  // Find open cells near the porch for cover and a trap.
  const cells = await mod('./src/game/home.js', (m) => { const c = window.__cus, mm = c.G.maps.cabin, p = mm.points.porch; const out = []; for (let r = 2; r < 10 && out.length < 3; r++) for (let dx = -r; dx <= r && out.length < 3; dx++) { const cx = Math.floor(p.x / 32) + dx, cy = Math.floor(p.y / 32) + r; if (!m.coverBlocked('sandbags', cx, cy) && !m.trapBlocked(cx, cy) && !out.some((o) => Math.abs(o[0] - cx) + Math.abs(o[1] - cy) < 2)) out.push([cx, cy]); } return { out, w: mm.w, h: mm.h }; });
  const clickCell = async ([cx, cy]) => { const box = await page.locator('[data-plan]').boundingBox(); await page.mouse.click(box.x + (cx + 0.5) / cells.w * box.width, box.y + (cy + 0.5) / cells.h * box.height); await sleep(350); };
  await clickCell(cells.out[0]);
  check('Plan: tap a cell to set cover there (from your pack)', await C(() => window.__cus.G.s.home.covers.length === 1 && window.__cus.G.s.inv.sandbags === 1));
  await page.click('[data-tool="bear_trap"]'); await sleep(150);
  await clickCell(cells.out[1]);
  check('Plan: or a bear trap', await C(() => (window.__cus.G.s.home.traps || []).length === 1 && window.__cus.G.s.inv.bear_trap === 1));
  await page.click('[data-tool="fallback"]'); await sleep(150);
  await clickCell(cells.out[2]);
  const fb = await C(() => window.__cus.G.s.home.fallback);
  check('Plan: mark a fallback point', !!fb && fb[0] === cells.out[2][0] && fb[1] === cells.out[2][1], JSON.stringify(fb));
  await page.click('[data-tool="remove"]'); await sleep(150);
  await clickCell(cells.out[0]);
  check('Plan: and pick things back up', await C(() => window.__cus.G.s.home.covers.length === 0 && window.__cus.G.s.inv.sandbags === 2));
  // Keyboard cursor.
  const k0 = await mod('./src/ui/menus.js', (m) => m.planState().cursor);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await sleep(150);
  const k1 = await mod('./src/ui/menus.js', (m) => m.planState().cursor);
  check('Plan: the arrow keys move the cursor (and so does the D-pad)', k1[0] === k0[0] + 2 && k1[1] === k0[1] + 1, JSON.stringify([k0, k1]));
  await C(() => window.__cus.dbg.closeAll());
  // With a controller: D-pad down onto the map, move the cursor, A places.
  await C(() => { window.__fakePad = { connected: true, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; });
  const pbtn = async (i) => { await C((i) => { window.__fakePad.buttons[i] = { pressed: true, value: 1 }; }, i); await sleep(120); await C((i) => { window.__fakePad.buttons[i] = { pressed: false, value: 0 }; }, i); await sleep(150); };
  await sleep(300);
  await C(() => import('./src/ui/menus.js').then((m) => m.openPlanner())); await sleep(400);
  for (let i = 0; i < 3 && !(await C(() => !!(document.querySelector('.pad-focus') || {}).dataset?.grid !== undefined && document.querySelector('.pad-focus[data-grid]'))); i++) await pbtn(13);
  const onGrid = await C(() => !!document.querySelector('.pad-focus[data-grid]'));
  const pc0 = await mod('./src/ui/menus.js', (m) => m.planState().cursor);
  await pbtn(15); await pbtn(15);
  const pc1 = await mod('./src/ui/menus.js', (m) => m.planState().cursor);
  check('Plan (controller): D-pad onto the map, then it moves the cursor', onGrid && pc1[0] === pc0[0] + 2, JSON.stringify({ onGrid, pc0, pc1 }));
  await C(() => { delete window.__fakePad; window.__cus.dbg.closeAll(); }); await sleep(300);
  // In an attack: look, don't build — and Ruth can fall back.
  await C(() => { const c = window.__cus; c.G.s.time.minute = 21 * 60; c.G.player.invuln = 99999; c.dbg.startSiege({ plan: { kind: 'raid', hpMult: 1, waves: [{ dir: Object.keys(c.G.map.spawns)[0], types: ['scout'], delay: 999 }] } }); });
  await sleep(500);
  const blocked = await mod('./src/game/planner.js', (m) => ({ edit: m.canEditPlan(), r: m.applyTool('sandbags', 1, 1) }));
  check('Plan: during an attack you can look but not build', !blocked.edit && blocked.r === false, JSON.stringify(blocked));
  const fall = await C(() => import('./src/game/orders.js').then((o) => new Promise((res) => { const c = window.__cus; const has = o.orderOptions().some((x) => /Fall back/.test(x.label)); o.giveOrder('ruth', 'fallback'); const r = c.G.npcs.find((n) => n.id === 'ruth'); const f = o.fallbackPoint(); setTimeout(() => res({ has, d: Math.round(Math.hypot(r.x - f.x, r.y - f.y)) }), 9000); })));
  check('Plan: with a fallback point marked, Ruth can be ordered back to it', fall.has && fall.d < 60, JSON.stringify(fall));
  await C(() => { const c = window.__cus; c.G.siegeActive = false; c.G.siege = null; c.G.enemies = []; import('./src/game/ally.js').then((a) => a.allyEndSiege()); c.G.s.time.minute = 12 * 60; });
  // Scrapbook.
  await C(() => window.__cus.dbg.openMenu('journal')); await sleep(300);
  await page.click('.subtab[data-id="scrap"]'); await sleep(200);
  await page.click('[data-act="photo"]'); await sleep(900);
  const ph = await mod('./src/game/scrapbook.js', (m) => m.photos().map((p) => ({ c: p.caption, img: p.img.slice(0, 15), auto: p.auto })));
  check('Scrapbook: take a photo from the Journal', ph.length === 1 && ph[0].img === 'data:image/jpeg' && !ph[0].auto, JSON.stringify(ph));
  await C(() => window.__cus.G.events.emit('seasonalEvent', 'thanksgiving')); await sleep(1600);
  const ph2 = await mod('./src/game/scrapbook.js', (m) => m.photos().map((p) => p.caption));
  check('Scrapbook: the moments that matter get a photo on their own', ph2.includes('Thanksgiving'), ph2.join(','));
  await C(() => window.__cus.dbg.openMenu('journal')); await sleep(300);
  await page.click('.subtab[data-id="scrap"]'); await sleep(200);
  const figs = await C(() => document.querySelectorAll('.photo').length);
  await page.screenshot({ path: OUT + 'scrapbook.png' });
  await page.locator('[data-act="delphoto"]').first().click(); await sleep(300);
  check('Scrapbook: the Journal shows the photos, and you can remove one', figs === 2 && await mod('./src/game/scrapbook.js', (m) => m.photos().length === 1), String(figs));
  await ctx.close();
}

/* ================================================================== */
/* v0.17: the Spanish interface                                        */
/* ================================================================== */
if (want('lang')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'lang');
  await page.addInitScript(() => { try { const k = 'cabinUnderSiege.settings'; const s = JSON.parse(localStorage.getItem(k) || '{}'); if (!s.language) { s.language = 'es'; localStorage.setItem(k, JSON.stringify(s)); } } catch { /* */ } });
  await page.goto(URL); await page.waitForSelector('#t-new'); await sleep(300);
  const C = (fn, a) => ev(page, fn, a);
  const title = await C(() => ({ n: document.getElementById('t-new').textContent.trim(), e: document.getElementById('t-endless').textContent.trim(), lang: document.documentElement.lang, tag: document.querySelector('.tagline').textContent }));
  check('Lang: in Spanish the title screen speaks Spanish', title.n === 'Nueva partida' && title.e === 'Asedio sin fin' && title.lang === 'es' && /Dejaste a la familia/.test(title.tag), JSON.stringify(title));
  await page.screenshot({ path: OUT + 'lang-title.png' });
  await page.click('#t-new'); await sleep(400);
  const diff = await C(() => document.querySelector('.modal-body').innerText);
  check('Lang: menus come up in Spanish (difficulty picker)', /Elige la dificultad/.test(diff) && /Difícil/.test(diff), diff.slice(0, 80));
  await page.click('[data-diff-pick="normal"]'); await sleep(1200);
  const dlg = await C(() => document.getElementById('dialogue').classList.contains('hidden') ? '' : document.getElementById('dlg-text').textContent);
  const foot = await C(() => document.querySelector('.dlg-foot').innerText);
  check('Lang: the story itself stays in English (as written), the dialogue buttons are Spanish', !!dlg && /Population|Newark|Pine Hollow/.test(dlg) && /Toca|Saltar/.test(foot), (dlg || '(no dialogue)').slice(0, 60) + ' | ' + foot);
  await skipDialogues(page);
  await C(() => { window.__cus.dbg.closeAll(); window.__cus.dbg.openMenu('settings'); }); await sleep(300);
  const set = await C(() => document.querySelector('.modal-body').innerText + ' ' + [...document.querySelectorAll('.tab')].map((t) => t.textContent).join(','));
  check('Lang: pause menu tabs and Settings are Spanish, with a note about the story', /Ajustes/.test(set) && /Volumen de efectos/.test(set) && /Accesibilidad/.test(set) && /siguen en inglés/.test(set), set.slice(0, 160));
  await page.screenshot({ path: OUT + 'lang-settings.png' });
  await page.selectOption('[data-set="language"]', 'en'); await sleep(400);
  const back = await C(() => [...document.querySelectorAll('.tab')].map((t) => t.textContent).join(',') + ' ' + document.querySelector('.modal-body').innerText.slice(0, 200));
  check('Lang: switching back to English takes effect right away', /Settings/.test(back) && /Sound volume/.test(back), back.slice(0, 120));
  await ctx.close();
}

/* ================================================================== */
/* v0.18: Atlantic City, 1994 — the second prequel episode             */
/* ================================================================== */
if (want('atlantic')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'atlantic');
  await page.goto(URL); await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  const mod = (path, fn, a) => page.evaluate(([p, f, a]) => import(p).then((m) => (new Function('m', 'a', 'return (' + f + ')(m, a)'))(m, a)), [path, fn.toString(), a]);
  const saveBefore = await C(() => localStorage.getItem('cabinUnderSiege.save'));
  await mod('./src/game/prequel.js', (m) => m.startAC(window.__cus.startGameForTest)); await sleep(800);
  await skipDialogues(page);
  const st0 = await C(() => ({ map: window.__cus.G.map.id, step: window.__cus.G.prequel.step, obj: document.getElementById('objective').textContent, npcs: window.__cus.G.npcs.filter((n) => n.present !== false).map((n) => n.id) }));
  check('AC: Atlantic City, 1994 opens on the boardwalk with Big Carmine', st0.map === 'atlantic' && st0.step === 'ac_meet' && /Big Carmine/.test(st0.obj), JSON.stringify(st0));
  await page.screenshot({ path: OUT + 'atlantic.png' });
  const talk = async (id, pick = 0) => { await mod('./src/game/prequel.js', (m, id) => m.prequelTalk(id), id); await sleep(200); await skipDialogues(page, pick); await sleep(200); };
  await talk('carmine94');
  await talk('lou94');
  await talk('rita94', 0);
  const st1 = await C(() => ({ step: window.__cus.G.prequel.step, rita: window.__cus.G.prequel.choice.rita }));
  check('AC: the casino, the pit boss, the motel — and how you talk to Eddie\'s wife is remembered', st1.step === 'ac_pier' && st1.rita === 'kind', JSON.stringify(st1));
  await C(() => { const c = window.__cus, p = c.G.player, q = c.G.map.points.pier_mid; p.x = q.x; p.y = q.y + 20; p.invuln = 99999; });
  await sleep(1200);
  check('AC: walking out on the Steel Pier starts the fight', await C(() => window.__cus.G.prequel.step === 'ac_fight'));
  for (let i = 0; i < 60 && (await C(() => window.__cus.G.prequel.step === 'ac_fight')); i++) { await sleep(300); await C(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); for (const e of c.G.enemies) if (!e.dead && !e.gone) c.dbg.damageEnemy(e, 9999, 0, 'bullet'); }); }
  check('AC: clear both waves and Eddie is waiting at the end of the pier', await C(() => window.__cus.G.prequel.step === 'ac_eddie'));
  await talk('eddie94', 0);
  check('AC: the choice about Eddie (let him go)', await C(() => window.__cus.G.prequel.choice.eddie === 'mercy' && window.__cus.G.prequel.step === 'ac_car'));
  await mod('./src/game/prequel.js', (m) => m.prequelTalk('carmine94')); await sleep(300);
  for (let i = 0; i < 30 && !(await C(() => window.__cus.G.modal === 'prequelEnd')); i++) { await skipDialogues(page); await C(() => { if (window.__cus.G.cutscene) window.__cus.dbg.skipCutscene(); }); await sleep(300); }
  const end = await C(() => ({ m: window.__cus.G.modal, t: (document.querySelector('.modal-body') || {}).innerText || '', trophy: JSON.parse(localStorage.getItem('cabin-under-siege-trophies') || localStorage.getItem('cabinUnderSiege.trophies') || '{}') }));
  check('AC: the next morning, Carmine Ventura buys the motel — and the episode ends with its own card', end.m === 'prequelEnd' && /ATLANTIC CITY, 1994/.test(end.t), end.t.slice(0, 100));
  check('AC: the Atlantic City trophy unlocks', await C(() => import('./src/game/achievements.js').then((a) => a.isUnlocked('atlantic'))));
  check('AC: the story save is never touched', (await C(() => localStorage.getItem('cabinUnderSiege.save'))) === saveBefore);
  await page.click('[data-go]'); await sleep(500);
  check('AC: the title screen has the Atlantic City button once you\'ve played a prequel', await page.isVisible('#t-prequel2'));
  await ctx.close();
}

/* ================================================================== */
/* Regression: the farm gate step says what's left and points at it    */
/* ================================================================== */
if (want('gate')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'gate');
  await page.goto(URL); await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  await C(() => window.__cus.newGame('normal')); await sleep(500); await skipDialogues(page);
  await C(() => { const c = window.__cus; c.G.s.story.done = { 1: true, 2: true }; c.G.s.story.chapterComplete = true; c.G.s.world.siege = null; c.dbg.moveToChapter(3); });
  await sleep(500); await page.click('[data-go]').catch(() => {}); await sleep(300); await skipDialogues(page);
  await C(() => { const c = window.__cus; if (c.G.cutscene) c.dbg.skipCutscene(); c.dbg.closeAll(); });
  await skipDialogues(page);
  await C(() => { const c = window.__cus, s = c.G.s, o = s.home.openings; s.story.step = 'ch3_fortify'; s.story.flags.fortified = 0; o.gate_l.hp = o.gate_l.baseHp; o.gate_r.hp = 70; s.time.minute = 12 * 60; c.loadMap('farm', c.G.maps.farm.points.gate); });
  await sleep(500);
  const obj = await C(() => document.getElementById('objective').textContent);
  check('Gate: the objective says which half is fixed and how many defenses are left', /left ✓/.test(obj) && /right \d+%/.test(obj) && /defenses 0\/2/.test(obj), obj);
  const wp = await C(() => import('./src/game/story.js').then((m) => m.storyWaypoint()));
  check('Gate: the arrow points at the half that still needs work', wp && wp.label === 'Gate (right)', JSON.stringify(wp));
  const lbl = await C(() => { const c = window.__cus, m = c.G.map, b = [...m.blockers.values()].find((x) => x.id === 'gate_l'); c.G.player.x = b.cx * 32 + 16; c.G.player.y = b.cy * 32 + 40; return new Promise((r) => setTimeout(() => r(c.G.interactTarget && c.G.interactTarget.label), 300)); });
  check('Gate: the fixed half says it\'s repaired', /repaired ✓/.test(lbl || ''), lbl);
  await C(() => { const c = window.__cus, o = c.G.s.home.openings; o.gate_r.hp = o.gate_r.baseHp; c.G.events.emit('repaired', {}); });
  const wp2 = await C(() => import('./src/game/story.js').then((m) => m.storyWaypoint()));
  check('Gate: with the gate done, the arrow moves to the house for the defenses', wp2 && wp2.label === 'Defenses', JSON.stringify(wp2));
  await C(() => { const c = window.__cus; c.G.events.emit('defenseInstalled', 'trap'); c.G.events.emit('defenseInstalled', 'cover'); });
  await sleep(400); await skipDialogues(page);
  check('Gate: both halves and two defenses start the attack night', await C(() => window.__cus.G.s.story.step === 'ch3_siege'));
  await ctx.close();
}

/* ================================================================== */
/* v0.19: a living world — wind, birds, critters, clouds, traffic      */
/* ================================================================== */
if (want('ambient')) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, 'ambient');
  await page.goto(URL); await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  const mod = (path, fn, a) => page.evaluate(([p, f, a]) => import(p).then((m) => (new Function('m', 'a', 'return (' + f + ')(m, a)'))(m, a)), [path, fn.toString(), a]);
  await C(() => window.__cus.newGame('normal')); await sleep(500); await skipDialogues(page);
  await C(() => { const c = window.__cus; c.dbg.closeAll(); c.G.s.time.minute = 11 * 60; c.dbg.setWeather('clear'); c.loadMap('cabin', c.G.maps.cabin.points.porch); });
  await sleep(9000);
  // Animals spawn at random (one try every few seconds, and a try can find no spot): keep looking for a while.
  let st = await mod('./src/world/ambient.js', (m) => m.ambientState());
  for (let i = 0; i < 16 && st.critters.length < 2; i++) { await sleep(1000); st = await mod('./src/world/ambient.js', (m) => m.ambientState()); }
  check('Ambient: by day, animals turn up around you', st.critters.length >= 2, JSON.stringify(st.critters));
  const flew = await C(() => import('./src/world/ambient.js').then((m) => new Promise((res) => { const c = window.__cus; const s0 = m.ambientState(); const calm = s0.critters.filter((c) => c.kind === 'bird' || c.kind === 'rabbit' || c.kind === 'squirrel').length; c.G.player.invuln = 99999; c.dbg.startSiege({ plan: { kind: 'raid', hpMult: 1, waves: [{ dir: Object.keys(c.G.map.spawns)[0], types: ['scout'], delay: 999 }] } }); setTimeout(() => { const s1 = m.ambientState(); c.G.siegeActive = false; c.G.siege = null; c.G.enemies = []; res({ before: calm, flying: s1.critters.filter((c) => c.kind === 'bird' && c.state === 'fly').length, fleeing: s1.critters.filter((c) => c.state === 'flee').length }); }, 300); })));
  check('Ambient: trouble scatters them — birds take off, rabbits bolt', flew.before === 0 || flew.flying + flew.fleeing > 0, JSON.stringify(flew));
  await page.screenshot({ path: OUT + 'ambient-cabin.png' });
  // Traffic in town, stopping for you.
  await C(() => { const c = window.__cus; c.loadMap('town', c.G.maps.town.points.store_door); });
  await sleep(500);
  const lanes = await mod('./src/world/ambient.js', (m) => m.ambientState().lanes);
  check('Ambient: the town has a road with traffic lanes', lanes >= 1, String(lanes));
  for (let i = 0; i < 40 && (await mod('./src/world/ambient.js', (m) => m.ambientState().cars)) === 0; i++) await sleep(500);
  check('Ambient: cars drive through town', (await mod('./src/world/ambient.js', (m) => m.ambientState().cars)) >= 1);
  await page.screenshot({ path: OUT + 'ambient-town.png' });
  await C(() => { const c = window.__cus; c.G.player.invuln = 99999; c.dbg.startSiege({ plan: { kind: 'raid', hpMult: 1, waves: [{ dir: Object.keys(c.G.maps.cabin.spawns)[0], types: ['scout'], delay: 999 }] } }); });
  await sleep(300);
  check('Ambient: during an attack the traffic and the animals clear out', await mod('./src/world/ambient.js', (m) => m.ambientState().cars === 0));
  await C(() => { const c = window.__cus; c.G.siegeActive = false; c.G.siege = null; c.G.enemies = []; });
  check('Ambient: the living world runs without errors', await C(() => window.__cus.G.running));
  await ctx.close();
}

/* ================================================================== */
/* v0.20: the 3D view and the tactical HUD                             */
/* ================================================================== */
if (want('3d')) {
  const b3 = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b3.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  watch(page, '3d');
  await page.goto(URL); await page.waitForSelector('#t-new');
  const C = (fn, a) => ev(page, fn, a);
  const mod = (path, fn, a) => page.evaluate(([p, f, a]) => import(p).then((m) => (new Function('m', 'a', 'return (' + f + ')(m, a)'))(m, a)), [path, fn.toString(), a]);
  await C(() => window.__cus.newGame('normal')); await sleep(1500); await skipDialogues(page);
  await C(() => { const c = window.__cus; c.dbg.closeAll(); c.G.s.time.minute = 12 * 60; c.dbg.setWeather('clear'); c.loadMap('cabin', c.G.maps.cabin.points.porch); });
  await sleep(2500);
  const st = await mod('./src/world/render3d.js', (m) => m.view3dState());
  check('3D: the 3D view is on by default, over the world (WebGL canvas, overlays on top)', st.canvas && st.map === 'cabin' && await C(() => !!window.__cus.G.view3d), JSON.stringify(st));
  const snap = await mod('./src/world/render3d.js', (m) => m.snapshot3d());
  check('3D: it really draws a scene (lots of colours, not a blank canvas)', snap && snap.colors > 60, JSON.stringify(snap));
  const rt = await mod('./src/world/render3d.js', (m) => { const p = window.__cus.G.player; const [sx, sy] = m.toScreen(p.x + 150, p.y - 40, 30); const w = m.toWorld(sx, sy, 30); return { d: Math.hypot(w[0] - p.x - 150, w[1] - p.y + 40), onScreen: sx > 0 && sx < 1280 && sy > 0 && sy < 800 }; });
  check('3D: screen and world positions line up both ways', rt.onScreen && rt.d < 1, JSON.stringify(rt));
  const target = await mod('./src/world/render3d.js', (m) => { const p = window.__cus.G.player; return m.toScreen(p.x + 220, p.y, 30); });
  await C(() => { if (window.__cus.dbg.input) window.__cus.dbg.input.mouse.inside = true; });
  await page.mouse.move(target[0], target[1]); await sleep(1500);
  const ang = await C(() => window.__cus.G.player.angle);
  check('3D: the mouse aims where it points in the 3D view', Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) < 0.15, String(ang));
  const people = await mod('./src/world/render3d.js', (m) => m.view3dState());
  check('3D: Frank and his car are in the scene', people.people >= 1 && people.cars >= 1, JSON.stringify(people));
  // v0.20.3: Frank is a real articulated character (frank3d.js); the quality may flip to Low mid-run, so every check branches on F.q.
  {
    const FR = async () => (await mod('./src/world/render3d.js', (m) => m.view3dState())).frank;
    await C(() => { window.__cus.dbg.input.mouse.inside = false; });
    await sleep(600);
    // (M2: the mouse check just turned him 90°, and he turns in place by stepping round: let the steps finish, on frames)
    let F = await FR();
    for (let i = 0; i < 80 && F && (F.locoAt !== 'idle' || !F.planted.every(Boolean)); i++) { await sleep(250); F = await FR(); }
    check('3D Frank: the player is the articulated rig (one skinned mesh, few draws)',
      F && F.kind === 'person' && F.skinned && F.bones === (F.q ? 39 : 50) && F.draws <= 4 && F.patched &&
      F.tris > (F.q ? 900 : 3000) && F.tris <= (F.q ? 1850 : 5900), JSON.stringify(F));
    check('3D Frank: stands on the ground at his height, feet planted',
      F && F.locoAt === 'idle' && F.headTop >= 70 && F.headTop <= 76 && F.feet.every((f) => f[1] < 1.2) && F.planted.every(Boolean), JSON.stringify(F));
    // his measured height (the hair top on the head bone), not a constant, projected at the default zoom
    const px = await mod('./src/world/render3d.js', (m, h) => { const p = window.__cus.G.player; const a = m.toScreen(p.x, p.y, h), b = m.toScreen(p.x, p.y, 0); return b[1] - a[1]; }, F.headTop);
    check('3D Frank: reads at the default zoom (55–95 px tall)', px >= 55 && px <= 95, JSON.stringify({ px, headTop: F.headTop }));
    // 'Automatic' quality before the frame-rate check has ever decided (lowQuality() is undefined then): one rig, kept
    // (not rebuilt every frame), and his state lives on: the aim comes up. The sim is frozen so autoLow can't flip meanwhile.
    const q0 = await C(() => { const c = window.__cus, G = c.G, o = { q: G.settings.quality, a: G.autoLow, lc: G.player.lastCombat };
      G.modal = 'pose'; G.settings.quality = 'auto'; delete G.autoLow; G.player.lastCombat = 0; return o; });
    // software GL can run at ~1 fps here: wait on frames (G.time), not on wall-clock time
    let Fa = await FR();
    for (let i = 0; i < 40 && Fa && Fa.q; i++) { await sleep(250); Fa = await FR(); } // a legit High rebuild if autoLow had been on
    const t0 = await C(() => window.__cus.G.time);
    let Fb = Fa;
    for (let i = 0; i < 60 && Fb && !(Fb.aimW >= 0.99); i++) { await sleep(250); Fb = await FR(); }
    await sleep(500); Fb = await FR(); const t1 = await C(() => window.__cus.G.time);
    await C((o) => { const G = window.__cus.G; G.settings.quality = o.q; if (o.a === undefined) delete G.autoLow; else G.autoLow = o.a; G.player.lastCombat = o.lc; G.modal = null; }, q0);
    check('3D Frank: Automatic quality keeps one rig (no rebuild every frame) and his aim comes up', Fa && Fb && Fa.serial === Fb.serial && !Fb.q && Fb.aimW >= 0.99 && t1 - t0 > 0.15,
      JSON.stringify({ a: Fa && [Fa.serial, Fa.q, Fa.aimW], b: Fb && [Fb.serial, Fb.q, Fb.aimW], frames: +(t1 - t0).toFixed(2) }));
    // walking (M2): on open ground, hold D for two full step cycles. The feet plant in world space (the measured drift of
    // the heel and ball of every planted foot, on the bones after IK, stays under 0.75) and the contacts land on the
    // footstep beat.
    const home = await C(() => {
      const c = window.__cus, G = c.G, m = G.map, T = 32, p = G.player, o = { x: p.x, y: p.y };
      const free = (x, y) => m.inBounds(x, y) && !m.blocksMove(x, y, 'player') && !m.blockerAt(x, y) && !m.buildingAt(x * T + 16, y * T + 16) && !m.trees.has(m.idx(x, y));
      let best = null;
      for (let y = 2; y < m.h - 2; y++) { let run = 0; for (let x = 0; x < m.w; x++) { if (free(x, y) && free(x, y - 1) && free(x, y + 1)) run++; else run = 0; if (run && (!best || run > best.run)) best = { run, x0: x - run + 1, y }; } }
      if (best && best.run >= 10) { p.x = (best.x0 + 2) * T + 16; p.y = best.y * T + 16; }
      G.player.lastCombat = 99; c.dbg.input.mouse.inside = false; return o;
    });
    await sleep(1500);
    let W = await FR();
    const c0 = W.contacts, ph0 = await C(() => window.__cus.G.player.walkPhase);
    await page.keyboard.down('KeyD');
    // (software GL can run at 1–2 fps here: wait on the step clock itself, for up to a minute)
    let dph = 0;
    for (let i = 0; i < 400 && (dph = (await C(() => window.__cus.G.player.walkPhase)) - ph0) < 4 * Math.PI; i++) await sleep(150);
    W = await FR(); await page.keyboard.up('KeyD');
    check('3D Frank: walks with planted feet', W && ['walk', 'jog'].includes(W.locoAt) && W.contacts - c0 >= 3 && W.maxStanceDrift < 0.75 && W.resets === 0,
      JSON.stringify({ locoAt: W && W.locoAt, contacts: W && W.contacts - c0, walkPhase: +dph.toFixed(2), maxStanceDrift: W && W.maxStanceDrift, ikFails: W && W.ikFails, resets: W && W.resets }));
    // stopped: give him 1.5 s of game time (software GL can be slow: wait on frames, not the wall clock)
    const tw0 = await C(() => window.__cus.G.time);
    for (let i = 0; i < 120 && (await C(() => window.__cus.G.time)) - tw0 < 1.5; i++) await sleep(250);
    W = await FR();
    check('3D Frank: stops on both feet (no frozen stride)', W && W.locoAt !== 'jog' && W.planted.every(Boolean) && W.feet.every((f) => f[1] < 1.2), JSON.stringify({ locoAt: W.locoAt, planted: W.planted, feet: W.feet }));
    // direction changes (M2 review): a reversal at a jog (A for a cycle, then D for a cycle), a 90° cut (S) and a reversal
    // back (W). A stance foot pivots on its ball or heel and never slides, no leg falls back to FK, no foot pops between
    // frames, and the hips never squat.
    const setDbg = (o) => mod('./src/world/frank3d.js', (m, a) => m.setFrankDebug(a), o);
    const holdKey = async (key, cycles) => {
      const p0 = await C(() => window.__cus.G.player.walkPhase);
      await page.keyboard.down(key);
      for (let i = 0; i < 400 && (await C(() => window.__cus.G.player.walkPhase)) - p0 < cycles * 2 * Math.PI; i++) await sleep(100);
      await page.keyboard.up(key);
    };
    await setDbg({ resetStats: true }); await sleep(300);
    const R0 = await FR();
    await holdKey('KeyA', 1); await holdKey('KeyD', 1); await holdKey('KeyS', 0.5); await holdKey('KeyW', 0.5);
    const tr0 = await C(() => window.__cus.G.time);
    for (let i = 0; i < 120 && (await C(() => window.__cus.G.time)) - tr0 < 1; i++) await sleep(250);
    const R1 = await FR();
    check('3D Frank: reverses and cuts with planted feet (no slide, no FK fallback, no foot pop, no squat)',
      R1 && R1.maxStanceDrift < 0.75 && R1.ikFails === R0.ikFails && R1.resets === 0 && R1.maxFootStep < 12 && R1.minPelvisY >= 30 && R1.contacts - R0.contacts >= 4,
      JSON.stringify({ maxStanceDrift: R1 && R1.maxStanceDrift, ikFails: [R0.ikFails, R1 && R1.ikFails], resets: R1 && R1.resets, maxFootStep: R1 && R1.maxFootStep, minPelvisY: R1 && R1.minPelvisY, contacts: R1 && R1.contacts - R0.contacts }));
    // a shove (a ram pushes the player 26 u in one frame): the feet skid with him and a corrective step catches the rest;
    // no squat, no FK fallback, no slide
    await setDbg({ resetStats: true }); await sleep(300);
    const S0 = await FR();
    await C(() => { window.__cus.G.player.x += 26; });
    const ts0 = await C(() => window.__cus.G.time);
    for (let i = 0; i < 120 && (await C(() => window.__cus.G.time)) - ts0 < 1.2; i++) await sleep(250);
    const S1 = await FR();
    check('3D Frank: a 26 u shove skids and steps (no squat, no FK fallback)',
      S1 && S1.minPelvisY >= 32 && S1.ikFails === S0.ikFails && S1.maxStanceDrift < 0.3 && S1.planted.every(Boolean) && S1.resets === 0,
      JSON.stringify({ minPelvisY: S1 && S1.minPelvisY, ikFails: [S0.ikFails, S1 && S1.ikFails], maxStanceDrift: S1 && S1.maxStanceDrift, planted: S1 && S1.planted, shoves: S1 && S1.shoves }));
    // M3, weapons: frozen pose probes (the sim stops, the renderer keeps going; wait on frames, not the wall clock)
    {
      const frames = async (t = 0.3) => { const t0 = await C(() => window.__cus.G.time); for (let i = 0; i < 160 && (await C(() => window.__cus.G.time)) - t0 < t; i++) await sleep(100); };
      const pose = (fn, a) => C(fn, a);
      await pose(() => { const c = window.__cus; c.dbg.addItem('shotgun', 1, true); c.dbg.addItem('rifle', 1, true); });
      await pose(() => { const c = window.__cus, p = c.G.player; c.G.modal = 'pose'; p.weapon = 'pistol'; p.mag = 8; p.reloadT = 0; p.swapT = 0; p.angle = 0; p.lastCombat = 0; p.muzzle = 0.06; });
      await frames(); let F2 = await FR();
      const dm = F2.muzzleRel, fd = F2.flashPos && F2.flashExpect ? Math.hypot(F2.flashPos[0] - F2.flashExpect[0], F2.flashPos[1] - F2.flashExpect[1], F2.flashPos[2] - F2.flashExpect[2]) : 99;
      check('3D Frank: the muzzle flash comes out of the barrel',
        dm[0] > 20 && dm[0] < 34 && dm[1] > 42 && dm[1] < 58 && Math.abs(dm[2]) < 6 && !!F2.flashPos && fd < 0.6 && Math.abs(F2.chestYawErr) < 4,
        JSON.stringify({ muzzleRel: dm, flashPos: F2.flashPos, flashExpect: F2.flashExpect, chestYawErr: F2.chestYawErr }));
      check('3D Frank: the gun drives the hands (both on the pistol), the bore converges on the sim line, recoil shows on the flash frame',
        F2.handErr && F2.handErr[0] < 0.5 && F2.handErr[1] < 1.0 && F2.boreMiss !== null && F2.boreMiss < 1.0 && Math.abs(F2.conv) <= 7 && F2.recoil.pitch >= 0.55 * 14 && F2.gunDriver === 'aim',
        JSON.stringify({ handErr: F2.handErr, boreMiss: F2.boreMiss, conv: F2.conv, recoil: F2.recoil, gunDriver: F2.gunDriver }));
      // the long guns: shouldered, cheek on the stock, the bore converged, both hands on the gun
      const longs = {};
      for (const w of ['shotgun', 'rifle']) {
        await pose((w) => { const p = window.__cus.G.player; p.weapon = w; p.mag = 5; p.muzzle = -1; }, w);
        await frames(0.5); longs[w] = await FR();
      }
      const LS = longs.shotgun, LR = longs.rifle;
      check('3D Frank: the long guns are shouldered with a cheek weld (eye over the bore), converged, both hands on the gun',
        [LS, LR].every((L) => L.inHand === L.weapon && L.muzzleRel[0] > 34 && L.muzzleRel[0] < 54 && L.muzzleRel[1] > 44 && L.muzzleRel[1] < 62 && Math.abs(L.muzzleRel[2]) < 10 &&
          L.boreMiss < 1.0 && L.handErr[0] < 0.5 && L.handErr[1] < 1.0 && L.eyeToBore && Math.abs(L.eyeToBore[0]) <= 3.5) &&
          LS.eyeToBore[1] >= 2 && LS.eyeToBore[1] <= 4 && LR.eyeToBore[1] >= 2 && LR.eyeToBore[1] <= 4 && LS.slung === 'rifle' && LR.slung === 'shotgun',
        JSON.stringify({ shotgun: [LS.muzzleRel, LS.boreMiss, LS.handErr, LS.eyeToBore, LS.slung], rifle: [LR.muzzleRel, LR.boreMiss, LR.handErr, LR.eyeToBore, LR.slung] }));
      // the reload (§7.3): a tactical pistol reload halfway, the upper body is in the reload
      await pose(() => { const p = window.__cus.G.player; p.weapon = 'pistol'; p.muzzle = -1; p.reloadT = 0.7; p.reloadMax = 1.45; p.mag = 2; });
      await frames(); F2 = await FR();
      check('3D Frank: reload drives the upper body', F2.upper === 'reload' && F2.handLMoved > 3 && F2.reload && !F2.reload.empty, JSON.stringify({ upper: F2.upper, handLMoved: F2.handLMoved, reload: F2.reload }));
      // the empty pistol reload, step by step: the slide locked back, the old magazine out (a debris magazine falls), the
      // spare one in the left hand from the pocket, seated on the knock, the rack closing the slide on 'reloadDone'
      await pose(() => { const p = window.__cus.G.player; p.reloadT = 0; p.mag = 0; p.muzzle = -1; });
      await frames(0.2);
      const at = async (tau, D = 1.45) => { await pose(([tau, D]) => { const p = window.__cus.G.player; p.reloadMax = D; p.reloadT = Math.max(1e-4, D - tau); }, [tau, D]); await frames(0.12); return FR(); };
      const R0 = await at(0.02), R1 = await at(0.35), R2 = await at(0.9), R3 = await at(1.4495);
      await pose(() => { const p = window.__cus.G.player; p.reloadT = 0; p.mag = 8; }); await frames(0.3); const R4 = await FR();
      check('3D Frank: the empty pistol reload: slide locked, mag out and dropped, the spare from the pocket, seated, the rack closes the slide',
        R0.reload && R0.reload.empty && R0.sub.slide <= -2.1 && R0.sub.mag && R1.lProp === 1 && !R1.sub.mag && R1.debris >= 1 && R2.sub.mag && R2.sub.slide <= -2.1 && R3.sub.slide > -0.5 && R4.upper !== 'reload' && !R4.slideLocked,
        JSON.stringify({ R0: [R0.reload, R0.sub], R1: [R1.lProp, R1.sub, R1.debris], R2: R2.sub, R3: R3.sub, R4: [R4.upper, R4.slideLocked] }));
      // the shotgun's shell by shell: a shell in the left hand on the way to the port, none just after the push; the rifle's bolt open mid-reload
      await pose(() => { const p = window.__cus.G.player; p.weapon = 'shotgun'; p.mag = 2; p.reloadT = 0; }); await frames(0.2);
      await pose(() => { const p = window.__cus.G.player; p.reloadMax = 0.5; p.reloadT = 0.5 * (1 - 0.75); }); await frames(0.12); const S1 = await FR();
      await pose(() => { const p = window.__cus.G.player; p.reloadT = 0.5 * (1 - 0.3); }); await frames(0.12); const S2 = await FR();
      await pose(() => { const p = window.__cus.G.player; p.weapon = 'rifle'; p.mag = 0; p.reloadT = 0; }); await frames(0.2);
      await pose(() => { const p = window.__cus.G.player; p.reloadMax = 2.3; p.reloadT = 2.3 - 0.3; }); await frames(0.12); const B1 = await FR();
      await pose(() => { const p = window.__cus.G.player; p.reloadT = 0; p.mag = 5; }); await frames(0.4);
      check('3D Frank: the shotgun loads shell by shell (a shell in hand, then pushed), the rifle reloads through an open bolt',
        S1.reload && S1.reload.weapon === 'shotgun' && S1.lProp === 2 && S2.lProp === 0 && B1.reload && B1.reload.weapon === 'rifle' && B1.sub.boltRot > 50 && B1.sub.boltX < -2.5,
        JSON.stringify({ S1: [S1.reload, S1.lProp], S2: [S2.reload, S2.lProp], B1: [B1.reload, B1.sub] }));
      // the swap: the pistol goes under the coat while the long gun comes off the back
      await pose(() => { const p = window.__cus.G.player; p.weapon = 'pistol'; p.mag = 8; p.swapT = 0; }); await frames(0.4);
      // (a cross swap puts the pistol away by f 0.30, so the hand can cross to the sling: f 0.2 is still on the way to the holster)
      await pose(() => { const p = window.__cus.G.player; p.weapon = 'shotgun'; p.swapT = 0.35 * (1 - 0.2); }); await frames(0.12); const W1 = await FR();
      await pose(() => { const p = window.__cus.G.player; p.swapT = 0.35 * (1 - 0.8); }); await frames(0.12); const W2 = await FR();
      await pose(() => { const p = window.__cus.G.player; p.swapT = 0; p.weapon = 'pistol'; }); await frames(0.4); const W3 = await FR();
      check('3D Frank: a swap holsters the pistol and draws the long gun from the back, then slings it again',
        W1.upper === 'swap' && W1.swap && W1.swap.from === 'pistol' && W1.swap.to === 'shotgun' && W1.inHand === 'pistol' && W2.inHand === 'shotgun' && W3.inHand === 'pistol' && W3.slung === 'shotgun' && W3.upper !== 'swap',
        JSON.stringify({ W1: [W1.upper, W1.swap, W1.inHand], W2: [W2.swap, W2.inHand], W3: [W3.inHand, W3.slung, W3.upper] }));
      // a casing: it flies from the ejection port and comes to rest exactly where the 2D sim put it
      const cpos = await pose(() => { const c = window.__cus, p = c.G.player; c.G.casings = c.G.casings || []; const k = { x: p.x + 9, y: p.y + 21, vx: 0, vy: 0, t: 0.36, rot: 1.2, color: '#d9b84a' }; c.G.casings.push(k); return [k.x, k.y]; });
      await frames(0.6); const K1 = await FR();
      const kp = K1.debrisPts && K1.debrisPts[0];
      check('3D Frank: a casing lands where the 2D sim puts it', !!kp && Math.hypot(kp[0] - cpos[0], kp[2] - cpos[1]) < 0.5 && kp[1] < 1, JSON.stringify({ kp, cpos, debris: K1.debris }));
      await pose(() => { const c = window.__cus, p = c.G.player; c.G.modal = null; p.muzzle = -1; p.reloadT = 0; p.swapT = 0; p.weapon = 'pistol'; p.mag = 8; p.lastCombat = 99; c.G.casings = [];
        return import('./src/game/inventory.js').then((m) => { m.removeItem('shotgun', 1); m.removeItem('rifle', 1); }); });
      await frames(0.3);
      check('3D Frank: the weapon probes never produced a non-finite transform or an IK failure', (await FR()).resets === 0, '');
    }
    await C((o) => { const p = window.__cus.G.player; p.x = o.x; p.y = o.y; }, home);
    await sleep(600);
  }
  await C(() => { const c = window.__cus; c.G.player.x = c.G.maps.cabin.points.cabin_in.x; c.G.player.y = c.G.maps.cabin.points.cabin_in.y; });
  await sleep(2000);
  check('3D: step inside and the cabin opens up (roof off, walls low)', (await mod('./src/world/render3d.js', (m) => m.view3dState())).roofsCut.includes('cabin'));
  await page.screenshot({ path: OUT + '3d-inside.png' });
  await skipDialogues(page); await C(() => window.__cus.dbg.closeAll());
  await C(() => { const c = window.__cus; c.G.player.x = c.G.maps.cabin.points.porch.x; c.G.player.y = c.G.maps.cabin.points.porch.y + 60; c.G.player.invuln = 99999; c.dbg.startSiege({ plan: { kind: 'raid', hpMult: 1, waves: [{ dir: Object.keys(c.G.map.spawns)[0], types: ['gunman', 'scout'], delay: 0 }] } }); });
  await sleep(4000);
  const fight = await mod('./src/world/render3d.js', (m) => m.view3dState());
  check('3D: attackers appear as figures in the scene', fight.people >= 3, JSON.stringify(fight));
  await page.screenshot({ path: OUT + '3d-fight.png' });
  await C(() => { const c = window.__cus; c.G.siegeActive = false; c.G.siege = null; c.G.enemies = []; });
  // The tactical HUD.
  const hud = await C(() => ({ card: document.querySelector('#party .pcard .pname') && document.querySelector('#party .pcard .pname').textContent, hp: document.querySelector('#party .php') && document.querySelector('#party .php').textContent, bar: getComputedStyle(document.getElementById('actbar')).display, place: document.getElementById('mission-place').textContent, objIn: !!document.querySelector('#mission #objective') }));
  check('HUD: mission card, Frank\'s portrait card with health, and the action bar', hud.card === 'FRANK' && /\d+ \/ \d+/.test(hud.hp) && hud.bar === 'flex' && hud.place === 'THE CABIN' && hud.objIn, JSON.stringify(hud));
  // v0.20.1: illustrated portraits, with the painted ones as the fallback.
  await page.waitForFunction(() => { const i = document.querySelector('#party .pcard img'); return i && i.complete; }, null, { timeout: 15000 }).catch(() => {});
  const pics = await C(() => import('./src/ui/portraits.js').then((m) => {
    const card = document.querySelector('#party .pcard img');
    const ruthBefore = m.portraitFor('Ruth Calloway');
    const every = [...m.ART].every((id) => m.portraitById(id) === `art/portraits/${id}.jpg`);
    const bad = document.createElement('img'); bad.setAttribute('src', 'art/portraits/nobody.jpg'); m.portraitFallback(bad);
    const ruthImg = document.createElement('img'); ruthImg.setAttribute('src', m.portraitFor('Ruth Calloway')); m.portraitFallback(ruthImg);
    return { card: card && card.getAttribute('src'), w: card && card.naturalWidth, ruth: ruthBefore, duke: m.portraitById('duke'), sign: m.portraitFor('Note'), every, tibbs: m.portraitFor('Old Man Tibbs'), lou: m.portraitFor('Lou Pagano'),
      young: (() => { const G = window.__cus.G, was = G.prequel; G.prequel = { ep: 'test' }; const r = ['Big Carmine', 'Sal Benedetto', 'Frank', 'Old Man Tibbs'].map((w) => m.portraitFor(w)).join(','); G.prequel = was; return r; })(), ruthFallback: (ruthImg.getAttribute('src') || '').slice(0, 22), ruthAfter: (m.portraitFor('Ruth Calloway') || '').slice(0, 22) };
  }));
  check('Portraits: Frank\'s card shows his illustrated portrait (loaded), Duke has one, notes have none', pics.card === 'art/portraits/frank.jpg' && pics.w === 320 && pics.duke === 'art/portraits/duke.jpg' && pics.sign === null && pics.every, JSON.stringify(pics));
  check('Portraits: townsfolk have portraits too, and the prequels show the younger faces', pics.tibbs === 'art/portraits/tibbs.jpg' && pics.lou === 'art/portraits/lou.jpg' && pics.young === 'art/portraits/carmine99.jpg,art/portraits/sal99.jpg,art/portraits/frank99.jpg,art/portraits/tibbs.jpg', JSON.stringify({ tibbs: pics.tibbs, lou: pics.lou, young: pics.young }));
  check('Portraits: a portrait that can\'t load falls back to the painted one', pics.ruth === 'art/portraits/ruth.jpg' && pics.ruthFallback === 'data:image/png;base64,' && pics.ruthAfter === 'data:image/png;base64,', JSON.stringify(pics));
  await C(() => { window.__cus.dbg.closeAll(); });
  await C(() => import('./src/ui/dialogue.js').then((d) => d.playDialogue([{ who: 'Dee Marsh', text: 'Morning, Frank.' }])));
  await sleep(300);
  const dlgPic = await C(() => { const i = document.getElementById('dlg-portrait'); return { src: i.getAttribute('src'), hidden: i.classList.contains('hidden') }; });
  await skipDialogues(page);
  check('Portraits: conversations show the speaker\'s illustrated portrait', dlgPic.src === 'art/portraits/dee.jpg' && !dlgPic.hidden, JSON.stringify(dlgPic));
  await skipDialogues(page); await C(() => window.__cus.dbg.closeAll()); await sleep(500);
  await C(() => { const p = window.__cus.G.player; p.mag = 3; });
  await page.click('#actbar [data-press="reload"]');
  // The press is read on the next game frame, which can take a while with software WebGL.
  let reloaded = false;
  for (let i = 0; i < 30 && !reloaded; i++) { await sleep(100); reloaded = await C(() => window.__cus.G.player.reloadT > 0 || window.__cus.G.player.mag === 8); }
  check('HUD: the action bar buttons work (Reload)', reloaded);
  // Classic view.
  await C(() => { window.__cus.G.settings.view = 'classic'; }); await sleep(800);
  check('3D: Settings → View → Classic 2D switches back to the top-down view', !(await mod('./src/world/render3d.js', (m) => m.view3dState())).canvas && await C(() => !window.__cus.G.view3d));
  await C(() => { window.__cus.G.settings.view = '3d'; }); await sleep(600);
  await ctx.close();
  // On a phone the touch sticks stay clear: no portrait cards or action bar.
  const tctx = await b3.newContext({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const tp = await tctx.newPage();
  watch(tp, '3d-touch');
  await tp.goto(URL); await tp.waitForSelector('#t-new');
  await tp.evaluate(() => window.__cus.newGame('normal')); await sleep(1500);
  await tp.evaluate(() => { const c = window.__cus; c.dbg.closeAll(); for (let i = 0; i < 30; i++) document.getElementById('dlg-skip').click(); });
  await sleep(1500);
  const tl = await tp.evaluate(() => ({ party: getComputedStyle(document.getElementById('party')).display, bar: getComputedStyle(document.getElementById('actbar')).display, fire: getComputedStyle(document.getElementById('btn-fire')).display, hp: getComputedStyle(document.querySelector('.bar.hp')).display }));
  check('HUD (phone): touch buttons and the health bar, no portrait cards or action bar over the sticks', tl.party === 'none' && tl.bar === 'none' && tl.fire !== 'none' && tl.hp !== 'none', JSON.stringify(tl));
  await tp.screenshot({ path: OUT + '3d-phone.png' });
  await tctx.close();
  await b3.close();
}

/* ================================================================== */
/* v0.20.3: 3D Frank's maths and geometry (node only, no browser)      */
/* ================================================================== */
if (want('frank')) {
  const anim = await import('../src/world/frank3d-anim.js');
  const geo = await import('../src/world/frank3d-geo.js');
  const { Vector3, Quaternion } = await import('../src/vendor/three.module.min.js');
  // 1. Two-bone IK: reachable targets are reached, full extension and beyond stay finite, the mid joint is a pure hinge.
  {
    const rnd = anim.mulberry32(20203), out = anim.makeIKOut(), A = new Vector3(), T = new Vector3(), P = new Vector3();
    const e = new Vector3(), zU = new Vector3(), zL = new Vector3();
    let worst = 0, hinge = 1, nan = 0;
    for (let i = 0; i < 2000; i++) {
      const L1 = 10 + rnd() * 10, L2 = 10 + rnd() * 10;
      A.set(rnd() * 40 - 20, rnd() * 40, rnd() * 40 - 20);
      const dir = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      const d = Math.abs(L1 - L2) + 0.5 + rnd() * (0.99 * (L1 + L2) - Math.abs(L1 - L2) - 0.5);
      T.copy(A).addScaledVector(dir, d);
      P.copy(A).add(new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(30));
      anim.solveTwoBone(A, T, P, L1, L2, i % 2 ? 1 : -1, out);
      e.copy(A).add(new Vector3(0, -L1, 0).applyQuaternion(out.q1)).add(new Vector3(0, -L2, 0).applyQuaternion(out.q2));
      worst = Math.max(worst, e.distanceTo(T));
      zU.set(0, 0, 1).applyQuaternion(out.q1); zL.set(0, 0, 1).applyQuaternion(out.q2);
      hinge = Math.min(hinge, Math.abs(zU.dot(zL)));
    }
    for (const k of [0.999, 1, 1.2, 5]) { anim.solveTwoBone(A.set(0, 37, 4), T.set(0, 37 - 33.9 * k, 4), P.set(30, 27, 4), 18, 15.9, 1, out); if (![out.E.x, out.E.y, out.E.z, out.q1.x, out.q1.w, out.q2.x, out.q2.w].every(Number.isFinite)) nan++; }
    anim.solveTwoBone(A.set(0, 0, 0), T.set(0, 0, 0), P.set(0, 0, 0), 10, 10, 1, out); if (![out.q1.x, out.q1.w, out.q2.w].every(Number.isFinite)) nan++;
    check('Frank IK: 2,000 random reachable targets reached within 0.01, no NaN at or past full extension, pure hinges', worst < 0.01 && nan === 0 && hinge > 0.9999, JSON.stringify({ worst, nan, hinge }));
    void Quaternion;
  }
  // 2. Springs: bounded and converging at dt 0.05 up to ω 60 (fixed sub-steps), and a no-op at dt 0.
  {
    let ok = true; const info = [];
    for (const w of [5, 12, 25, 40, 60]) {
      const s = anim.makeSpring(0); let max = 0;
      for (let i = 0; i < 200; i++) { anim.springTo(s, 10, w, 0.05); max = Math.max(max, Math.abs(s.x)); if (!Number.isFinite(s.x)) ok = false; }
      const a = anim.makeSpring(3); for (let i = 0; i < 200; i++) anim.springAngle(a, -3, w, 0.05);
      info.push([w, +s.x.toFixed(4), +max.toFixed(3), +a.x.toFixed(3)]);
      if (Math.abs(s.x - 10) > 1e-3 || max > 10.001 || Math.abs(anim.wrap(a.x + 3)) > 1e-3) ok = false;
    }
    const z = anim.makeSpring(1); z.v = 2; anim.springTo(z, 5, 30, 0); if (z.x !== 1 || z.v !== 2) ok = false;
    check('Frank springs: bounded and converge at dt 0.05 for ω ≤ 60, and dt 0 is a no-op', ok, JSON.stringify(info));
  }
  // 5. Step planner (world space): 3 s at 125 u/s (walkPhase += 10·dt), then 2 s at 185 (14·dt), at 30 and 144 fps; then an
  // analog 40 u/s walk, a wall push (no velocity, the step clock still running), a stop, a jog that reverses in one frame
  // (+125 → −125 u/s: a backpedal), and a jog that cuts 90° (the hips spring round after the velocity). Planted feet never
  // move (a pivot keeps its ball or heel fixed), contacts land on the step sound (walkPhase ≡ 0 or π), the pelvis reach fix
  // never needs more than its 4 u cap for a planted or landing foot (the feet step instead), every landing lies within the
  // leg's reach of the hip, everything stays finite and every foot keeps planting. Then turns in place of 90° and 180°.
  {
    const clips = await import('../src/world/frank3d-clips.js');
    const res = [];
    let ok = true;
    for (const fps of [30, 144]) {
      const P = new anim.StepPlanner(), I = clips.makePlannerInput(), dt = 1 / fps, L = 0.985 * (18 + 15.9);
      let x = 0, z = 0, ph = 0, hy = 0, badContact = 0, maxDrop = 0, steadyDrop = 0, farLanding = 0, nonFinite = 0, t = 0;
      const N = () => {
        const c = Math.cos(hy), s = Math.sin(hy);
        I.neutral[0][0] = x + 0.8 * c + 4.4 * s; I.neutral[0][1] = z + 0.8 * s - 4.4 * c; I.neutral[0][2] = hy - 7 * anim.DEG; I.neutral[0][3] = -7 * anim.DEG;
        I.neutral[1][0] = x - 0.4 * c - 4.4 * s; I.neutral[1][1] = z - 0.4 * s + 4.4 * c; I.neutral[1][2] = hy + 7 * anim.DEG; I.neutral[1][3] = 7 * anim.DEG;
      };
      N(); P.reset(I.neutral);
      // [seconds, vx, vz, step rate, gait on, backpedal, hip yaw target]
      const phases = [[3, 125, 0, 10, true, false, 0], [2, 185, 0, 14, true, false, 0], [2, 40, 0, 10, true, false, 0], [1.5, 0, 0, 10, true, false, 0], [1, 0, 0, 0, false, false, 0],
        [1, 125, 0, 10, true, false, 0], [1, -125, 0, 10, true, true, 0], [1, 125, 0, 10, true, false, 0], [1.2, 0, 125, 10, true, false, Math.PI / 2], [1, 0, 0, 0, false, false, Math.PI / 2]];
      const seg = [];
      for (const [dur, vx, vz, rate, gait, back, hyT] of phases) {
        const c0 = P.contacts, plantedSeen = [false, false];
        let tin = 0;
        for (; tin < dur; tin += dt) {
          t += dt; x += vx * dt; z += vz * dt; if (gait) ph += rate * dt;
          hy += anim.wrap(hyT - hy) * (1 - Math.exp(-14 * dt));
          const v = Math.hypot(vx, vz);
          I.dt = dt; I.gait = gait; I.phi = ((ph / (2 * Math.PI)) % 1 + 1) % 1; I.rate = rate; I.vx = vx; I.vz = vz; I.rx = x; I.rz = z; I.hipYaw = hy;
          clips.gaitInputs(I, v, back, gait && v < 15); I.still = gait ? 0 : I.still + dt; N();
          const sp = gait && v >= 15 ? v : 0, psi = (2 * I.phi) % 1;
          I.hipY = 37.5 + clips.gaitAt('height', sp) + clips.gaitAt('bob', sp) * Math.cos(2 * Math.PI * (psi - I.sigma));
          const before = P.contacts;
          P.update(I);
          if (gait && P.contacts > before && !((ph % Math.PI) < rate * dt + 1e-6)) badContact++;
          // the hip joints (±4.6 across the hips) and the drop the reach fix would need for a planted or landing foot
          const c = Math.cos(hy), s = Math.sin(hy);
          let drop = 0;
          for (let i = 0; i < 2; i++) {
            const f = P.feet[i], jx = x - s * (i ? 4.6 : -4.6), jz = z + c * (i ? 4.6 : -4.6);
            if (P.planted(i) || (f.mode === 1 && f.uu > 0.95)) drop = Math.max(drop, anim.reachDrop(jx, I.hipY, jz, f.ax, f.ay, f.az, L, 99));
            if (P.contacts > before && P.planted(i) && P.lastContact === i && Math.hypot(f.ax - jx, f.az - jz) > 16) farLanding++;
            if (![f.ax, f.ay, f.az, f.yaw, f.pitch].every(Number.isFinite)) nonFinite++;
            if (P.planted(i)) plantedSeen[i] = true;
          }
          maxDrop = Math.max(maxDrop, drop);
          if (tin > 1 && vx > 0 && vz === 0) steadyDrop = Math.max(steadyDrop, drop);
        }
        seg.push([vx, vz, rate, P.contacts - c0, plantedSeen.every(Boolean)]);
      }
      const r = { fps, drift: +P.maxStanceDrift.toFixed(4), badContact, maxDrop: +maxDrop.toFixed(2), steadyDrop: +steadyDrop.toFixed(2), farLanding, nonFinite, endPlanted: P.planted(0) && P.planted(1), seg };
      if (!(r.drift < 0.05 && badContact === 0 && maxDrop <= 4 && steadyDrop < 1.2 && farLanding === 0 && nonFinite === 0 && r.endPlanted && seg.every((g) => g[4]) && seg[0][3] >= 8 && seg[1][3] >= 7 && seg[6][3] >= 2 && seg[8][3] >= 3)) ok = false;
      res.push(r);
    }
    // turns in place of 90° and 180°: the feet step round, one at a time and alternating (never both off the ground), the
    // planted one pivoting on its ball, while the hips follow (as frank3d.js has them: a spring, held within 50° of a
    // planted foot). 90° within 0.6 s, 180° within 0.8 s, and no leg ever twisted more than 50° off the hips.
    for (const deg of [90, 180]) {
      const P = new anim.StepPlanner(), I = clips.makePlannerInput(), dt = 1 / 60, T = deg * anim.DEG;
      const put = (yaw) => { const c = Math.cos(yaw), s = Math.sin(yaw); I.neutral[0][0] = 0.8 * c + 4.4 * s; I.neutral[0][1] = 0.8 * s - 4.4 * c; I.neutral[0][2] = yaw - 7 * anim.DEG; I.neutral[0][3] = -7 * anim.DEG; I.neutral[1][0] = -0.4 * c - 4.4 * s; I.neutral[1][1] = -0.4 * s + 4.4 * c; I.neutral[1][2] = yaw + 7 * anim.DEG; I.neutral[1][3] = 7 * anim.DEG; };
      put(0); P.reset(I.neutral); put(T);
      let both = 0, t = 0, hip = 0, hv = 0, twist = 0, same = 0, last = -1;
      for (; t < 1 && (P.needTurn || t === 0 || !P.planted(0) || !P.planted(1)); t += dt) {
        // the hips: a critically damped spring (ω 20) toward the new stance, held within 50° of each planted foot
        const e = anim.wrap(T - hip), a = 400 * e - 40 * hv; hv += a * dt; hip += hv * dt;
        for (let i = 0; i < 2; i++) if (P.planted(i)) { const rel = anim.wrap(P.bodyYaw(i) - hip); if (Math.abs(rel) > 50 * anim.DEG) { hip += rel - Math.sign(rel) * 50 * anim.DEG; hv = 0; } }
        I.dt = dt; I.gait = false; I.turning = true; I.turnSide = 1; I.still = 1; I.rx = 0; I.rz = 0; I.hipYaw = hip; clips.gaitInputs(I, 0);
        const c0 = P.contacts;
        P.update(I);
        if (P.contacts > c0) { if (P.lastContact === last) same++; last = P.lastContact; }
        if (!P.planted(0) && !P.planted(1)) both++;
        for (let i = 0; i < 2; i++) if (P.planted(i)) twist = Math.max(twist, Math.abs(anim.wrap(P.bodyYaw(i) - hip)) / anim.DEG);
      }
      const yawOk = Math.abs(anim.wrap(P.feet[0].plantYaw - I.neutral[0][2])) < 0.05 && Math.abs(anim.wrap(P.feet[1].plantYaw - I.neutral[1][2])) < 0.05;
      res.push({ turn: deg, t: +t.toFixed(2), both, yawOk, contacts: P.contacts, sameFootTwice: same, twist: +twist.toFixed(1), drift: +P.maxStanceDrift.toFixed(4) });
      if (!(yawOk && both === 0 && same === 0 && t < (deg > 90 ? 0.8 : 0.6) && twist <= 50.5 && P.maxStanceDrift < 0.05)) ok = false;
    }
    check('Frank step planner: planted feet never slide, contacts on the step sound, reach kept through a reversal and a cut, analog/wall-push/stop sane, turns in place alternate the feet (30 and 144 fps)', ok, JSON.stringify(res));
  }
  // 3. Clip tracks: every keyed track (recoil, actions, swap, fidgets) is sorted in time, from t ≥ 0, finite, with valid
  // easing ids; the recoil's gun channels already show ≥ 55% of their peak on the flash frame (tShot 0).
  {
    const clips = await import('../src/world/frank3d-clips.js');
    const bad = [];
    for (const [path, tr] of clips.allTracks()) {
      for (let i = 0; i < tr.length; i++) {
        const k = tr[i];
        if (!(Number.isFinite(k[0]) && Number.isFinite(k[1]) && k[0] >= 0) || (i && k[0] < tr[i - 1][0]) || (k[2] !== undefined && !anim.EASE_IDS.includes(k[2]))) { bad.push(path + '#' + i); break; }
      }
    }
    const flash = [];
    for (const w of ['pistol', 'shotgun', 'rifle']) for (const c of ['gunPitch', 'gunBack', ...(w === 'pistol' ? [] : ['spine2Pitch'])]) {
      const tr = clips.RECOIL[w][c], pk = Math.max(...tr.map((k) => Math.abs(k[1]))), v0 = Math.abs(anim.sample(tr, 0));
      if (v0 < 0.55 * pk - 1e-9) flash.push([w, c, v0, pk]);
    }
    check('Frank clip tracks: sorted, finite, valid easing; recoil ≥ 55% of its peak on the flash frame', bad.length === 0 && flash.length === 0 && clips.allTracks().length > 20, JSON.stringify({ bad, flash, n: clips.allTracks().length }));
  }
  // 4. Reload timelines (M3): built per reload for every reloadMax the game can produce (and the extremes), tactical and
  // empty, per weapon: the keys are in time order and inside [0, reloadMax] (the shotgun's per-shell keys inside [0, 1]),
  // the pistol seats on min(0.5, 0.72·reloadMax) (the +0.50 s knock), the closure lands exactly on the end (ρ = 0, the
  // 'reloadDone' click), the empty pistol racks after the seat and releases within the last 0.03 s, the rifle's bolt
  // opens, goes back, forward and down in order.
  {
    const clips = await import('../src/world/frank3d-clips.js');
    const bad = [];
    for (const w of ['pistol', 'shotgun', 'rifle']) for (const D of [0.15, 0.3, 0.43, 0.5, 0.68, 1.0, 1.45, 2.3]) for (const empty of [false, true]) {
      const K = clips.reloadKeys(w, D, empty), L = clips.reloadKeyList(K), max = w === 'shotgun' ? 1 : D;
      const why = [];
      for (let i = 0; i < L.length; i++) {
        const v = L[i][1];
        if (!Number.isFinite(v) || v < -1e-9 || v > max + 1e-9) why.push('range ' + L[i][0]);
        if (i && v < L[i - 1][1] - 1e-9) why.push('order ' + L[i][0]);
      }
      if (Math.abs(L[L.length - 1][1] - max) > 1e-9 || L[L.length - 1][0] !== 'end') why.push('closure');
      if (w === 'pistol') {
        if (Math.abs(K.seat - Math.min(0.5, 0.72 * D)) > 1e-9) why.push('seat');
        if (!(K.pocket <= K.well && K.well <= K.seat && K.magDrop <= K.seat)) why.push('pre-seat');
        if (empty && !(K.seat <= K.rackOn && K.rackOn <= K.pull && K.pull <= K.release && K.release >= D - 0.03 - 1e-9)) why.push('rack');
        if (!empty && 'rackOn' in K) why.push('tactical rack');
      }
      if (w === 'rifle' && !(K.knob <= K.boltUp && K.boltUp <= K.boltBack && K.boltBack <= K.boltFwd && K.boltFwd <= K.boltDown && K.boltDown <= K.boltLock)) why.push('bolt');
      // (M3 review: the rifle presses one round per 0.34 s cycle that fits after the bolt opens, up to the rounds it needs,
      // instead of the spec's fixed 0, 1 or 2 and a 1.2–1.5 s static hold; every press inside the reload, after the bolt is
      // back and before the bolt goes forward, each cycle in order)
      if (w === 'rifle') {
        const n = Math.max(0, Math.min(6, Math.floor((D - 0.5) / 0.34)));
        if (K.rounds !== n || K.press.length !== 3 * n) why.push('rounds');
        for (let i = 0; i < n; i++) { const [a, b, c] = K.press.slice(3 * i, 3 * i + 3); if (!(a <= b && b <= c && a >= K.boltBack - 1e-9 && c <= K.boltFwd + 1e-9 && (i === 0 || a >= K.press[3 * i - 1] - 1e-9))) { why.push('press ' + i); break; } }
        if (clips.reloadKeys('rifle', D, empty, {}, 2).rounds !== Math.min(n, 2)) why.push('rounds needed');
      }
      if (w === 'shotgun' && !(K.push > 0 && K.push < K.fetch && K.fetch < 1)) why.push('shell');
      if (why.length) bad.push([w, D, empty, why.join(',')]);
    }
    check('Frank reload timelines: monotonic, inside [0, reloadMax], seat on the knock, closure on the end, rack and bolt in order (3 weapons × 8 times × tactical/empty)', bad.length === 0, JSON.stringify(bad.slice(0, 6)));
  }
  // 6. Edge logic (M3): undefined fields give no NaN; a lastHurt reset (a hit) keeps the previous dt; a reload ending is
  // a natural completion only when its last countdown fit in this frame and nothing else ended it (a swap or a
  // hold-fire shot interrupts it, even on its last frame); a shotgun's next shell is a cycle, not an end.
  {
    const E = (prev, p, dt) => anim.weaponEdges(prev, p, dt, {});
    const res = {
      undef: E({}, {}, 0.016), undefMax: E({ reloadT: 0 }, { reloadT: 0.4 }, 0.016),
      natural: E({ reloadT: 0.01, muzzle: -1 }, { reloadT: -0.006, muzzle: -1.016, reloadMax: 1.45 }, 0.016),
      swap: E({ reloadT: 0.6, swapT: 0 }, { reloadT: 0, swapT: 0.35 }, 0.016),
      holdFire: E({ reloadT: 0.3, muzzle: -2 }, { reloadT: 0, muzzle: 0.09, mag: 2 }, 0.016),
      holdFireLast: E({ reloadT: 0.01, muzzle: -2 }, { reloadT: 0, muzzle: 0.09, mag: 2 }, 0.016),
      cycle: E({ reloadT: 0.004 }, { reloadT: 0.5, reloadMax: 0.5 }, 0.016),
      dry: E({ fireCd: -0.1, muzzle: -1 }, { fireCd: 0.3, muzzle: -1.016, mag: 0 }, 0.016),
      jump: E({ weapon: 'pistol' }, { weapon: 'rifle', swapT: 0 }, 0.016),
    };
    const finite = Object.values(res).every((o) => Object.values(o).every((v) => typeof v === 'boolean' || Number.isFinite(v)));
    const dtHit = anim.simDtFrom(3.2, 1.0, 0.0167, 0, 0, 0.02), dtNorm = anim.simDtFrom(3.2, 1.0, 0.0167, 3.216, 1.016, 0.02), dtNaN = anim.simDtFrom(0, 0, 0.0167, undefined, undefined, 0.02), dtHitStop = anim.simDtFrom(3.2, 1.0, 0.0167, 3.2006, 1.0006, 0.02);
    const ok = finite && !res.undef.reloadStart && res.undef.f === 0 && res.undefMax.reloadStart && res.undefMax.f === 0 &&
      res.natural.reloadEndNat && !res.natural.reloadInterr && res.swap.reloadInterr && !res.swap.reloadEndNat && res.swap.swapStart &&
      res.holdFire.reloadInterr && res.holdFire.shot && !res.holdFire.reloadEndNat && res.holdFireLast.reloadInterr && !res.holdFireLast.reloadEndNat &&
      res.cycle.reloadCycle && !res.cycle.reloadEndNat && !res.cycle.reloadInterr && res.dry.dryFire && res.jump.weaponJump &&
      Math.abs(dtHit - 0.0167) < 1e-9 && Math.abs(dtNorm - 0.016) < 1e-6 && Math.abs(dtNaN - 0.02) < 1e-9 && Math.abs(dtHitStop - 0.0006) < 1e-6;
    check('Frank edges: undefined fields give no NaN, a hit keeps the previous dt (hit-stop scales it), natural reload end vs swap vs hold-fire interrupt vs next shell, dry fire, weapon jump', ok,
      JSON.stringify({ finite, dtHit, dtNorm, dtNaN, dtHitStop, natural: res.natural, swap: res.swap, holdFireLast: res.holdFireLast, cycle: res.cycle }));
  }
  // 7. Geometry: budgets, bones, skin indices and weights, normals, lining twins (DOM-free build: no face canvas).
  {
    const res = [];
    for (const [q, young] of [[false, false], [true, false], [false, true], [true, true]]) {
      const a = geo.frankAssets(q, young, { noCanvas: true }), g = a.geometry, nb = a.bones.length;
      const si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array, nr = g.attributes.normal.array;
      let badIdx = 0, badSum = 0, badN = 0, maxInf = 0, twinBad = 0;
      for (let v = 0; v < si.length / 4; v++) {
        let s = 0, n = 0;
        for (let k = 0; k < 4; k++) { if (si[v * 4 + k] >= nb) badIdx++; s += sw[v * 4 + k]; if (sw[v * 4 + k] > 0) n++; }
        if (Math.abs(s - 1) > 1e-4) badSum++;
        maxInf = Math.max(maxInf, n);
        if (!(Math.hypot(nr[v * 3], nr[v * 3 + 1], nr[v * 3 + 2]) > 0.5)) badN++;
      }
      const W = (v) => { const o = {}; for (let k = 0; k < 4; k++) if (sw[v * 4 + k] > 0) o[si[v * 4 + k]] = sw[v * 4 + k]; return o; };
      for (const [l, o] of a.twins) { const A = W(l), B = W(o); for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) if (Math.abs((A[k] || 0) - (B[k] || 0)) > 1e-6) { twinBad++; break; } }
      // every lining, hem and edge vertex has an outer twin (not just the ones that happened to pair up)
      const paired = new Set(a.twins.map((t) => t[0])); let unpaired = 0, shellVerts = 0;
      for (const [lo, hi] of a.twinRanges) for (let v = lo; v < hi; v++) { shellVerts++; if (!paired.has(v)) unpaired++; }
      // no bone appears twice in one vertex's influences (a wasted slot, or a lost influence after the top-4 cut)
      let dupInf = 0;
      for (let v = 0; v < si.length / 4; v++) { const seen = new Set(); for (let k = 0; k < 4; k++) if (sw[v * 4 + k] > 0) { if (seen.has(si[v * 4 + k])) dupInf++; seen.add(si[v * 4 + k]); } }
      const ok = nb === (q ? 39 : 50) && a.tris <= (q ? 1850 : 5900) && a.bodyTris <= (q ? 1400 : 4600) && badIdx === 0 && badSum === 0 && badN === 0 && maxInf <= 4 &&
        a.twins.length > (q ? 40 : 100) && twinBad === 0 && shellVerts > 0 && unpaired === 0 && dupInf === 0;
      res.push({ key: a.key, ok, bones: nb, tris: a.tris, body: a.bodyTris, badIdx, badSum, badN, maxInf, twins: a.twins.length, twinBad, shellVerts, unpaired, dupInf });
    }
    check('Frank geometry: budgets, bone counts, skin weights (sum 1, ≤ 4, valid, no duplicates), normals, every lining/hem/edge vertex = its outer twin', res.every((r) => r.ok), JSON.stringify(res));
  }
  // 8. The live rig in node (M3 review): frank3d.js runs here on a copy of its module graph with two stubs (input.js and
  // progression.js touch the DOM), driven by a minimal sim of the player's weapon timers, so the weapon motion is measured
  // on the bones, not on the clip channels.
  {
    const fs = await import('node:fs'), os = await import('node:os'), pth = await import('node:path'), { pathToFileURL, fileURLToPath } = await import('node:url');
    const SRC = fileURLToPath(new globalThis.URL('../src/', import.meta.url)), TMP = fs.mkdtempSync(pth.join(os.tmpdir(), 'frank3d-node-'));
    for (const f of ['world/frank3d.js', 'world/frank3d-anim.js', 'world/frank3d-clips.js', 'world/frank3d-geo.js', 'world/map.js', 'game/state.js', 'game/season-core.js', 'config.js', 'util.js', 'data/weapons.js', 'vendor/three.module.min.js']) {
      fs.mkdirSync(pth.dirname(pth.join(TMP, 'src', f)), { recursive: true }); fs.copyFileSync(pth.join(SRC, f), pth.join(TMP, 'src', f));
    }
    fs.writeFileSync(pth.join(TMP, 'src/input.js'), "export const input = { mouse: { x: 0, y: 0, inside: false }, held: { fire: false }, aim: { active: false }, pressed: new Set(), touchMode: false, padMode: false };\n");
    fs.writeFileSync(pth.join(TMP, 'src/game/progression.js'), 'export function derived() { return { maxHp: 100, maxStamina: 100 }; }\n');
    const U = (f) => pathToFileURL(pth.join(TMP, 'src', f)).href;
    const F = await import(U('world/frank3d.js')), { G } = await import(U('game/state.js')), T3 = await import(U('vendor/three.module.min.js')), CL = await import(U('world/frank3d-clips.js'));
    const dt = 1 / 60, V3 = () => new T3.Vector3();
    G.s = { inv: { pistol: 1, shotgun: 1, rifle: 1, ammo: 99, shells: 99, rifle_ammo: 99 }, job: null, home: { upgrades: {} } };
    G.frameDt = dt; G.paused = false; G.modal = null; G.map = { getSolid: () => 0 };
    const MAG = { pistol: 8, shotgun: 5, rifle: 5 };
    const rig = (w, mag = MAG[w]) => {
      G.casings = []; G.enemies = []; G.time = 0;
      const p = { x: 500, y: 500, radius: 10, hp: 100, stamina: 100, mag, weapon: w, swapT: 0, angle: 0, vx: 0, vy: 0, fireCd: 0, reloadT: 0, reloadMax: 0, meleeCd: 0, meleeAnim: 0,
        invuln: 0, dodgeT: 0, dodgeDx: 0, dodgeDy: 0, flinch: 0, muzzle: -1, lastHurt: 99, lastCombat: 0, walkPhase: 0, inCover: false, chopAnim: 0, dead: false };
      G.player = p; return { p, r: F.frankRig({ q: false, young: false, carry: null }) };
    };
    const tick = ({ p, r }) => {
      G.time += dt; G.frameDt = dt; p.lastHurt += dt; p.muzzle -= dt; p.fireCd -= dt; p.swapT -= dt;
      if (p.reloadT > 0) { p.reloadT -= dt; if (p.reloadT <= 0) p.reloadT = 0; }
      for (const c of G.casings) { if (c.t < 0.35) { c.x += c.vx * dt; c.y += c.vy * dt; } c.t += dt; }
      F.poseFrank(r, p, { dk: 0, camera: null });
    };
    const run = (s, sec, fn) => { for (let i = 0; i < Math.round(sec / dt); i++) { tick(s); if (fn) fn(i); } };
    const shoot = ({ p }) => { p.mag--; p.muzzle = p.weapon === 'shotgun' ? 0.09 : 0.06; p.fireCd = 0.4; p.lastCombat = 0; G.casings.push({ x: p.x + 4, y: p.y + 20, vx: 0, vy: 0, t: 0, rot: 1, color: p.weapon === 'shotgun' ? '#c0392b' : '#d9b84a' }); };
    const M = new T3.Matrix4(), mp = V3(), mq = new T3.Quaternion(), ms = V3();
    const debY = (r) => { if (!r.debris.count) return null; r.debris.getMatrixAt(0, M); M.decompose(mp, mq, ms); return mp.y; };
    const bore = (r, w) => V3().set(1, 0, 0).transformDirection(r.bones[w].matrixWorld);
    const pitchOf = (v) => Math.asin(v.y) * 180 / Math.PI, yawOf = (v) => Math.atan2(v.z, v.x) * 180 / Math.PI;
    const res = {};
    // (a) casings: the pistol's brass flies up out of the port; a pending hull nobody racks is forced out by 1.6 s, a swap edge forces it at once
    {
      const s = rig('pistol'); run(s, 0.7); const port = s.r.fx.port.y; shoot(s); let top = -1; run(s, 0.15, () => { const y = debY(s.r); if (y !== null) top = Math.max(top, y); });
      const h = rig('shotgun', 1); run(h, 0.7); shoot(h); let shown = null; run(h, 1.6, (i) => { if (shown === null && h.r.debris.count) shown = +(i * dt).toFixed(2); });
      const k = rig('shotgun', 1); run(k, 0.7); shoot(k); run(k, 0.3); const hidden = k.r.debris.count === 0; k.p.weapon = 'pistol'; k.p.swapT = 0.35; tick(k);
      res.casings = { top: +top.toFixed(1), port: +port.toFixed(1), hullShownAt: shown, hiddenBeforeSwap: hidden, swapForced: k.r.debris.count > 0 };
    }
    // (b) every reload and swap: the hands' grip points never pass inside the torso (≥ 9 u from the spine1 axis between
    // y 25 and 60) and the gun's origin stays ≥ 6 u from it; (c) the gun in hand never jumps (≤ 720 u/s = 12 u per 60 fps
    // frame; a double swap measures ~350, a long gun thrown onto the back ~570); the wrist bends ≤ 70°, the upper arm
    // twists ≤ 45.5°; never an IK failure or a reset
    {
      const GR = CL.SOCKETS.hand.grip, gR = V3().set(GR[0], GR[1], GR[2]), gL = V3().set(GR[0], GR[1], -GR[2]), ax = V3(), hp = V3(), gp = V3(), prev = V3(), hol = V3(), HO = CL.GUN_POSES.holster.at;
      let minHand = 99, minGun = 99, jump = 0, wrist = 0, twist = 0, ik = 0, resets = 0, worst = null;
      const watch = (s, tag) => {
        let pw = null;
        return () => {
          const B = s.r.bones, held = s.r.st.inHand; ax.setFromMatrixPosition(B.spine1.matrixWorld);
          // (the shoulder holster is under the coat by design: a hand or the pistol within 9 u of it is going in through the
          // coat's front, drawing or holstering)
          hol.set(HO[0], HO[1], HO[2]).applyMatrix4(B.spine2.matrixWorld);
          for (const [b, g] of [[B.handR, gR], [B.handL, gL]]) { hp.copy(g).applyMatrix4(b.matrixWorld); if (hp.y > 25 && hp.y < 60 && hp.distanceTo(hol) > 9) { const d = Math.hypot(hp.x - ax.x, hp.z - ax.z); if (d < minHand) { minHand = d; worst = tag; } } }
          if (held) {
            gp.setFromMatrixPosition(B[held].matrixWorld);
            if (gp.y > 25 && gp.y < 60 && !(held === 'pistol' && gp.distanceTo(hol) < 9)) minGun = Math.min(minGun, Math.hypot(gp.x - ax.x, gp.z - ax.z));
            if (pw === held) jump = Math.max(jump, gp.distanceTo(prev) / dt);
            prev.copy(gp); pw = held;
          } else pw = null;
          const d = F.frankDebug(s.r); for (const wv of d.wrist) { wrist = Math.max(wrist, wv[1]); twist = Math.max(twist, Math.abs(wv[2])); }
        };
      };
      for (const w of ['pistol', 'shotgun', 'rifle']) for (const D of [0.5, 1.45, 2.3]) for (const mag of [0, 2]) {
        const s = rig(w, mag); run(s, 0.6); s.p.reloadT = s.p.reloadMax = D; const f = watch(s, w + D + '/' + mag); run(s, D + 0.4, f); ik += s.r.st.ikFails; resets += s.r.st.resets;
      }
      for (const [a, b] of [['pistol', 'shotgun'], ['pistol', 'rifle'], ['shotgun', 'rifle'], ['rifle', 'shotgun'], ['shotgun', 'pistol'], ['rifle', 'pistol']]) {
        const s = rig(a); run(s, 0.6); const f = watch(s, a + '>' + b); s.p.weapon = b; s.p.swapT = 0.35; run(s, 0.5, f); ik += s.r.st.ikFails; resets += s.r.st.resets;
      }
      for (const at of [0.2, 0.4]) {
        const s = rig('pistol'); run(s, 0.6); const f = watch(s, 'double ' + at); s.p.weapon = 'shotgun'; s.p.swapT = 0.35; run(s, 0.35 * at, f); s.p.weapon = 'rifle'; s.p.swapT = 0.35; run(s, 0.5, f); ik += s.r.st.ikFails; resets += s.r.st.resets;
      }
      res.paths = { minHand: +minHand.toFixed(2), worst, minGun: +minGun.toFixed(2), jump: +jump.toFixed(0), wrist: +wrist.toFixed(1), twist: +twist.toFixed(1), ik, resets };
    }
    // (d) recoil on the gun bone: on the flash frame the bore is already up ≥ 55% of that shot's peak flip
    {
      res.recoil = {};
      for (const w of ['pistol', 'shotgun', 'rifle']) {
        const s = rig(w); run(s, 0.7); const rest = pitchOf(bore(s.r, w)); shoot(s); tick(s); const f0 = pitchOf(bore(s.r, w)) - rest; let pk = f0; run(s, 0.12, () => { pk = Math.max(pk, pitchOf(bore(s.r, w)) - rest); });
        res.recoil[w] = [+f0.toFixed(2), +pk.toFixed(2)];
      }
    }
    // (f) a shot that cuts a shell reload is drawn from the aim line: the flash frame's muzzle is a clean shot's, the bore's yaw too
    {
      const flash = (cut) => { const s = rig('shotgun', 3); run(s, 1.0); if (cut) { s.p.reloadT = s.p.reloadMax = 0.5; run(s, 0.3); s.p.reloadT = 0; } shoot(s); tick(s); return [s.r.fx.muzzle.clone(), yawOf(s.r.fx.bore)]; };
      const [m0, y0] = flash(false), [m1, y1] = flash(true);
      res.interrupt = { muzzle: +m0.distanceTo(m1).toFixed(2), yaw: +Math.abs(y0 - y1).toFixed(2) };
    }
    // (g) point blank: a gunman 30 u ahead puts every gun at high port within 0.3 s, the muzzle outside his body
    {
      res.port = {};
      for (const w of ['pistol', 'shotgun', 'rifle']) {
        const s = rig(w); run(s, 0.7); G.enemies = [{ x: s.p.x + 30, y: s.p.y + 2, radius: 10, dead: false }]; run(s, 0.3);
        const d = F.frankDebug(s.r), mz = s.r.fx.muzzle; res.port[w] = [d.port, +Math.hypot(mz.x - G.enemies[0].x, mz.z - G.enemies[0].y).toFixed(1), d.handErr];
      }
    }
    // (h) a draw-fire (a shot from the relaxed carry): the gun is on the aim line on the flash frame while the body only
    // starts to come in (no pelvis or chest pop), and it has settled into the aim by 0.25 s
    {
      res.draw = {};
      for (const w of ['pistol', 'shotgun']) {
        const s = rig(w); s.p.lastCombat = 99; run(s, 2.0, () => { s.p.lastCombat += dt; });
        const d0 = F.frankDebug(s.r); shoot(s); tick(s); const d1 = F.frankDebug(s.r); run(s, 0.25); const d2 = F.frankDebug(s.r);
        res.draw[w] = { driver: d1.gunDriver, boreMiss: d1.boreMiss, dPel: +(d0.pelvisY - d1.pelvisY).toFixed(2), dChest: +Math.abs(d1.chestYaw - d0.chestYaw).toFixed(1), settle: +Math.abs(d2.pelvisY - (s.r.st.aimWb > 0.99 ? d2.pelvisY : 99)).toFixed(2), wb: d2.aimWb, crouch: +(d0.pelvisY - d2.pelvisY).toFixed(2) };
      }
    }
    // (j) the cheek weld holds at a near and a far aim point (the eye 2–4 u over the bore, ≤ 3.5 u to the side)
    {
      res.cheek = {};
      for (const w of ['shotgun', 'rifle']) for (const D of [80, 220, 400]) {
        const s = rig(w); G.enemies = D === 220 ? [] : [{ x: 500 + D, y: 500, radius: 10, dead: false }]; run(s, 0.8); res.cheek[w + D] = F.frankDebug(s.r).eyeToBore;
      }
    }
    fs.rmSync(TMP, { recursive: true, force: true });
    // (jump: a pop is a gun that moves further in one frame than a hand can swing it; the fastest legitimate move, a long
    // gun thrown onto the back in a cross swap's 0.11 s out, peaks near 600 u/s, so the bound is 12 u per 60 fps frame)
    const R = res, ok = R.casings.top > R.casings.port + 4 && R.casings.hullShownAt !== null && R.casings.hullShownAt <= 1.6 && R.casings.hiddenBeforeSwap && R.casings.swapForced &&
      R.paths.minHand >= 9 && R.paths.minGun >= 6 && R.paths.jump <= 720 && R.paths.wrist <= 70.5 && R.paths.twist <= 46.5 && R.paths.ik === 0 && R.paths.resets === 0 &&
      Object.values(R.recoil).every(([f0, pk]) => pk > 3 && f0 >= 0.55 * pk) && R.interrupt.muzzle < 0.5 && R.interrupt.yaw < 1 &&
      Object.values(R.port).every(([pt, gap, he]) => pt >= 0.9 && gap >= 10 && he[0] < 0.5) &&
      Object.values(R.draw).every((d) => d.driver === 'aim' && d.boreMiss < 1 && d.dPel < 0.3 && d.dChest < 6 && d.wb > 0.99 && d.crouch > 1) &&
      Object.values(R.cheek).every((e) => e && e[1] >= 2 && e[1] <= 4 && Math.abs(e[0]) <= 3.5);
    check('Frank live rig (node): casings arc from the port and are never left hidden, hands and guns never pass through the torso (bar the holster under the coat), no gun pops (double swap too), wrist ≤ 70 / twist ≤ 45 (+1.5), recoil on the bone at the flash, an interrupting shot from the aim line, high port at point blank, a draw-fire without a body pop, the cheek weld at 80/220/400', ok, JSON.stringify(R));
  }
}

await browser.close();
server.kill();

check('16. No console errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in test-output/.`);
process.exit(failed.length ? 1 : 0);
