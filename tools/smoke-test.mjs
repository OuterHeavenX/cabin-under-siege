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
  const missing = walk(root + 'src').map((f) => f.slice(root.length)).filter((f) => !sw.includes(`"./${f}"`));
  check('Service worker caches every source file (offline play)', missing.length === 0, missing.join(', '));
}

const browser = await chromium.launch();
const errors = [];

function watch(page, label) {
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
  check('Errand: split Old Man Tibbs\'s firewood -> go home and sleep', await ev(page, () => window.__cus.G.s.errands.tibbs_wood.state === 'done') && (await step(page)) === 'rest');
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
    return d.home.upgrades && Array.isArray(d.world.discovered) && d.jpEarned && d.version === 2 && d.chapter === 1 && d.player.mags && !d.inv.bogus;
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
  check('Ch2: job at Kowalski Moving pays and advances story', (await step(page)) === 'ch2_rosa');
  await talk('rosa'); await skipDialogues(page);
  check('Ch2: Rosa -> check the mailbox (+2 shutters)', (await step(page)) === 'ch2_letter');
  await tp(page, 21.5, 32.4); await faceTo(page, 20.5, 32.5); await sleep(150); await pressE(page); await sleep(200); await skipDialogues(page);
  check('Ch2: letter -> find who\'s watching the house', (await step(page)) === 'ch2_rat');
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
  await setTime(page, 21 * 60 + 50);
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
    check('Ch3: deputy visit is a choice with consequences', dep.choice === 'refuse' && dep.step === 'ch3_rat', JSON.stringify(dep));
    await solveRat(page);
    check('Ch3: Hank the trucker is caught -> fortify', (await step(page)) === 'ch3_fortify');
    await C(() => { const c = window.__cus; const o = c.G.s.home.openings; for (const k of ['gate_l', 'gate_r']) o[k].hp = o[k].baseHp; c.G.s.story.flags.fortified = 1; c.G.events.emit('defenseInstalled'); }); await sleep(300); await skipDialogues(page);
    const plan = await C(() => window.__cus.G.s.world.siege && window.__cus.G.s.world.siege.plan.waves.map((w) => w.types));
    check('Ch3: gate + defenses -> Vinnie\'s siege (truck, snipers; refusing the deputy adds a sniper)', plan && plan[0].includes('truck') && plan[1].filter((t) => t === 'sniper').length === 2, JSON.stringify(plan));
    await C(() => { const c = window.__cus; c.G.player.x = 20.5 * 32; c.G.player.y = 25 * 32; c.G.player.invuln = 99999; c.G.s.time.minute = 21 * 60 + 58; });
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
  const pic = await C(() => { const i = document.getElementById('dlg-portrait'); return !i.classList.contains('hidden') && i.naturalWidth > 0; });
  check('v4 Conversations show a painted portrait of the speaker', pic && portrait);
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
  await sleep(200);
  await talk4('reyes', 1);
  check('Ch4: Agent Reyes and the ledger choice', (await step(page)) === 'ch4_rat' && await C(() => window.__cus.G.s.choices.reyes === 'copy'));
  await solveRat(page);
  check('Ch4: June Tremblay is caught -> fortify', (await step(page)) === 'ch4_fortify');
  await C(() => { const c = window.__cus; const o = c.G.s.home.openings; for (const k of ['gate_l', 'gate_r']) o[k].hp = o[k].baseHp; c.G.s.story.flags.fortified = 2; c.G.events.emit('defenseInstalled'); }); await sleep(300); await skipDialogues(page);
  const plan4 = await C(() => window.__cus.G.s.world.siege && window.__cus.G.s.world.siege.plan.waves.map((w) => w.dir));
  check('Ch4: iron gate + three defenses -> Nico\'s attack by road and by water', plan4 && plan4.includes('lake') && plan4.includes('shore'), JSON.stringify(plan4));
  await C(() => { const c = window.__cus; c.G.player.x = 34 * 32; c.G.player.y = 25 * 32; c.G.player.invuln = 99999; c.G.s.time.minute = 21 * 60 + 58; });
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
  check('Ch5: the avenue trusts you -> recon', (await step(page)) === 'ch5_recon', await step(page));
  await C(() => { const c = window.__cus; c.G.s.errands.recon = { state: 'done' }; c.G.events.emit('errandDone', 'recon'); }); await sleep(200); await skipDialogues(page);
  check('Ch5: recon -> who\'s feeding Leo?', (await step(page)) === 'ch5_rat', await step(page));
  await solveRat(page);
  check('Ch5: Old Vito is caught -> call in your favors', (await step(page)) === 'ch5_allies', await step(page));
  await C(() => { const c = window.__cus; c.G.s.rel.mickey = 30; const ph = c.G.map.props.find((p) => p.id === 'phone'); c.G.player.x = ph.x; c.G.player.y = ph.y + 20; c.dbg.input.mouse.inside = false; c.G.player.angle = -Math.PI / 2; });
  await sleep(250); await pressE(page); await sleep(300); await skipDialogues(page);
  const al = await C(() => window.__cus.G.s.allies || []);
  check('Ch5: the phone calls bring allies (Ruth, Marcus, Ingrid, Walt, Mickey, Reyes)', (await step(page)) === 'ch5_siege' && ['ruth', 'marcus', 'ingrid', 'walt', 'mickey', 'reyes'].every((a) => al.includes(a)), JSON.stringify(al));
  // Leo strikes first: the siege at the watch house
  await C(() => { const c = window.__cus; c.G.player.x = 49 * 32; c.G.player.y = 10 * 32; c.G.player.invuln = 99999; c.G.s.time.minute = 21 * 60 + 58; });
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
  const jt = await ev(page, () => document.querySelector('.modal-body').innerText);
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
  const hidePos = [21.5, 20.6]; // back wall of the Bell house across Larch Street, out of sight of its windows
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

await browser.close();
server.kill();

check('16. No console errors during the run', errors.length === 0, errors.slice(0, 5).join(' | '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in test-output/.`);
process.exit(failed.length ? 1 : 0);
