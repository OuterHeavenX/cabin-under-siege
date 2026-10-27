// Automated acceptance / smoke test. Drives the real game in headless Chromium
// (desktop + iPhone-sized touch layouts) through the whole first chapter and
// checks the acceptance criteria from the design brief.
//
// Usage: npm test   (needs Playwright: `npm i` then `npx playwright install chromium`)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const PORT = 8000 + Math.floor(Math.random() * 900);
const URL = `http://localhost:${PORT}/`;
const OUT = new globalThis.URL('../test-output/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, ['tools/serve.mjs', String(PORT)], { stdio: 'ignore' });
await sleep(600);

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
      if (d.classList.contains('hidden')) return 'none';
      const ch = document.querySelectorAll('#dlg-choices .choice');
      if (ch.length && !document.getElementById('dlg-choices').classList.contains('hidden')) return 'choice';
      return 'text';
    });
    if (state === 'none') return;
    if (state === 'choice') await page.locator('#dlg-choices .choice').nth(pick).click();
    else await page.click('#dlg-skip').catch(() => page.keyboard.press('Space'));
    await sleep(80);
  }
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);
const tp = (page, x, y, map) => ev(page, ([x, y, map]) => {
  const c = window.__cus; if (map && c.G.map.id !== map) c.loadMap(map);
  c.G.player.x = x * 32; c.G.player.y = y * 32;
}, [x, y, map]);
const setTime = (page, minute, day) => ev(page, ([m, d]) => { const t = window.__cus.G.s.time; t.minute = m; if (d) t.day = d; }, [minute, day]);
const step = (page) => ev(page, () => window.__cus.G.s.story.step);
async function pressE(page, times = 1) { for (let i = 0; i < times; i++) { await page.keyboard.press('KeyE'); await sleep(140); } }
async function faceTo(page, x, y) { await ev(page, ([x, y]) => { const p = window.__cus.G.player; p.angle = Math.atan2(y * 32 - p.y, x * 32 - p.x); }, [x, y]); }

/* ================================================================== */
/* Desktop run: the whole chapter                                      */
/* ================================================================== */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await page.goto(URL);
  await page.waitForSelector('#t-new');
  await page.click('#t-new');
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
  check('Story: talk to Ruth -> go to town (+bandages)', (await step(page)) === 'go_town' && (await ev(page, () => window.__cus.G.s.inv.bandage)) >= 4);

  // Drive to town
  await tp(page, 24, 32.5, 'cabin');
  await faceTo(page, 26, 32.5);
  await sleep(150);
  await pressE(page);
  await sleep(2000);
  await skipDialogues(page);
  check('2. Travel cabin -> town by car', (await ev(page, () => window.__cus.G.map.id)) === 'town');
  check('Story: arrive in town -> find work', (await step(page)) === 'find_work');
  await page.screenshot({ path: OUT + 'desktop-town.png' });

  // Talk to Gus
  await setTime(page, 9 * 60);
  await sleep(300);
  const gus = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.id === 'gus'); return { x: r.x / 32, y: r.y / 32 }; });
  await tp(page, gus.x - 1, gus.y);
  await faceTo(page, gus.x, gus.y);
  await sleep(150);
  await pressE(page);
  await skipDialogues(page);
  check('Story: meet Gus -> first job', (await step(page)) === 'first_job');

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
  check('Story: first job -> see Dee', (await step(page)) === 'see_dee');

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

  // ---- Story: Dee & the stranger ----
  await setTime(page, 11 * 60);
  await sleep(200);
  const dee = await ev(page, () => { const r = window.__cus.G.npcs.find((n) => n.id === 'dee'); return { x: r.x / 32, y: r.y / 32 }; });
  await tp(page, dee.x, dee.y + 1.9);
  await faceTo(page, dee.x, dee.y);
  await sleep(150);
  await pressE(page);
  await skipDialogues(page);
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
  check('Story: stranger -> reinforce (+2 board kits)', (await step(page)) === 'reinforce' && (await ev(page, () => window.__cus.G.s.inv.board_kit)) >= 2);

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

  // ---- Reinforce the cabin ----
  await setTime(page, 14 * 60);
  await tp(page, 20.5, 27.6);
  await faceTo(page, 20.5, 26.5);
  await sleep(150);
  await pressE(page);
  await sleep(200);
  await skipDialogues(page);
  check('7c. Board up a window', await ev(page, () => window.__cus.G.s.home.openings.win_fl.boards));
  check('Story: reinforce -> first siege scheduled', (await step(page)) === 'first_siege' && await ev(page, () => !!window.__cus.G.s.world.siege));
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
  await ev(page, () => { const G = window.__cus.G; G.player.invuln = 0; G.player.hp = 5; window.__cus.dbg.damagePlayer(50, G.player.x + 10, G.player.y); });
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
    return d.home.upgrades && Array.isArray(d.world.discovered) && d.jpEarned && d.version === 1 && !d.inv.bogus;
  });
  check('Older/partial saves migrate safely', mig);
  await ctx.close();
}

/* ================================================================== */
/* Mobile: iPhone landscape, multi-touch, rotation, backgrounding      */
/* ================================================================== */
{
  const iphone = devices['iPhone 13'] || { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const ctx = await browser.newContext({ ...iphone, viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  watch(page, 'mobile');
  await page.goto(URL);
  await page.waitForSelector('#t-new');
  await page.tap('#t-new');
  await sleep(300);
  if (await page.isVisible('[data-yes]')) await page.tap('[data-yes]');
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
  const menuWhileMoving = await page.isVisible('.paused-tag');
  await page.tap('[data-close]');
  await sleep(150);
  await page.touchscreen.tap(mb.x - 6, mb.y + mb.height + 8); // just outside the visible button
  await sleep(150);
  const menuEdge = await page.isVisible('.paused-tag');
  if (menuEdge) await page.tap('[data-close]');
  await sleep(150);
  check('Pause button opens reliably (multi-touch + edge taps)', menuWhileMoving && menuEdge);
  await page.tap('#btn-reload');
  await page.tap('#btn-dodge');
  await sleep(200);

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
  const pausedMenu = await page.isVisible('.paused-tag');
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
