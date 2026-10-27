# Cabin Under Siege

> *“You left the family. The family didn’t leave you.”*

A top-down 2D survival / action / RPG for phones, tablets and desktop browsers.
You are Frank Lowe — formerly Frankie Corsetti of the Vescari crime family — trying
to build an honest life in a cabin outside the small town of Pine Hollow. By day you
work, meet people and fix up the place. Some nights, the family comes for you.

This build is a **complete, playable vertical slice: Chapter 1 — The Cabin**.

---

## Quick start

No build step and no runtime dependencies. It's plain HTML/CSS/JavaScript (ES modules).

```bash
# Node 18+ (any static file server also works)
npm start            # → http://localhost:8080/
```

`tools/serve.mjs` binds to `0.0.0.0`, so it also prints a LAN address you can open on
your iPhone/iPad (same Wi-Fi network) for real-device testing.

Alternatives: `python3 -m http.server 8080`, or any static host. Opening `index.html`
directly from disk (`file://`) won't work because browsers block ES modules there.

### Tech choices

- **Vanilla JavaScript + Canvas 2D**, no framework. A custom ~5k-line engine gives exact
  control over multi-touch, lighting and performance on iPhone, keeps the download tiny,
  and means there is nothing to build — the repo *is* the deployable site.
- **All art is procedural** (drawn in code); **all audio is synthesized** with Web Audio.
  No third-party or unlicensed assets.
- **Offline**: a service worker caches the game after the first visit (HTTPS only).
  The game also works as a home-screen web app (manifest included).

---

## Controls

| Action | Desktop | Touch |
|---|---|---|
| Move | WASD / Arrow keys (Shift = sprint) | Drag anywhere on the left side (full tilt sprints) |
| Aim | Mouse | Right stick (AIM) |
| Fire | Left click (hold for repeated fire) | **FIRE** button, or push the aim stick far |
| Reload | R | RELOAD |
| Interact / talk / open doors / chop / repair | E | **ACT** (its label shows the action: TALK, OPEN, CHOP, FIX, DRIVE…) |
| Melee shove | F or right click | MELEE |
| Dodge roll (brief invulnerability) | Space | DODGE |
| Use quick item (bandage/food) | Q | USE (shows the item & count) |
| Pause menu | Esc / P | ☰ (top right) |
| Menu tabs | I items · C character · K skills · V home · M map · J journal · H help | Tabs inside the menu |

Settings include sound/music volume, aim assist, fire-while-aiming, auto-sprint, screen
shake (full/reduced/off), damage numbers, and touch controls (auto/on/off).

---

## What's playable now

**Core loop**: wake at the cabin → check health/ammo/home → work jobs in town → buy
supplies and upgrades → prepare → survive sieges → repair, recover, improve.

- **Two connected maps**: the cabin property (cabin with interior, porch, driveway,
  car, woods, pond, rocks, neighbor's farm, phone pole, road) and the town of Pine Hollow
  (general store, diner, chapel, lumber yard with job board, houses, woodlot). Travel by
  car (20 min) or walk the road (1 hr). Roofs disappear when you walk inside buildings.
- **Day/night cycle** (~12 real minutes per day). Shops and jobs keep hours; NPCs follow
  routines; night is darker but readable (lights, a personal visibility radius, crisp
  attacker outlines). Rest in your bed to sleep until morning or nap — you are always
  woken before an attack and can never sleep through one.
- **Combat**: handgun with magazine + reloading, melee shove, dodge roll, hit feedback,
  damage numbers, directional damage indicator, grace period after hits, telegraphed enemy
  attacks (red aim lines / "!" markers), cover that blocks bullets (trees, rocks, walls,
  cars, log piles, placed sandbags), and a damage reduction while standing next to cover.
  Optional aim assist.
- **Enemies**: *Scout* (fragile, strafes), *Enforcer* (tough, melee, smashes doors),
  *Gunman* (keeps distance, finds cover with line of sight). They approach from map edges
  in different directions, search and breach the cabin's doors/windows, react to noise and
  sight, alert each other, and retreat when badly hurt or left alone.
- **Threat ("Heat") and warning signs**: a strange sedan on the road, footprints under the
  window, a cut phone line, a stranger asking questions in town, and Ruth's warning phone
  call. Signs usually precede attacks but can be false alarms. Quiet days are guaranteed
  after each attack.
- **Sieges**: one authored story siege (three waves from north, east and west, led by
  "Big Carmine") plus repeatable random raids that scale gently with Heat and level
  (varying count, directions and time between 9 PM and 1 AM), and small ambushes when you
  come home late at night.
- **Defeat & recovery**: a defeat screen, then you wake at Ruth's farm (or Dee's store in
  town). You lose 20% of your cash (max $150) and the cabin takes damage, but keep your
  level, skills, story and save. You're topped up with ammo and bandages so you can never
  get stuck. A failed story siege simply comes back the next night.
- **Cabin defense**: front and back doors, four windows. Door Brace Kits (once per door),
  Window Board Kits (once per window, boarded windows stop most bullets), placeable
  sandbags / wood barricades (max 4, can be picked back up), porch light, a **Floodlight**
  (lights the yard; attackers in it are always visible and shoot worse because of the
  glare), a **Tripwire Alarm** (+45 min warning, wakes you, shows attack directions).
  Doors and windows show damage (bars + cracks), and you repair them on the spot with wood.
  The Home tab lists every defense's condition and repair cost.
- **Legal jobs** (job board at Okafor Lumber, 7 AM–5 PM), all real activities:
  - *Woodcutting* — chop trees (3 swings each) and deliver the requested wood.
  - *Delivery* — pick up a parcel at the store counter and deliver it to a house before
    the timer runs out (late = reduced pay, no other penalty).
  - *Repair work* — collect materials from the yard's shed, then fix a fence/pump/steps/
    sign with a timing minigame (needs a Toolkit).
  - *Supply Run* (unlocked by the *Good Reputation* skill) — haul a crate from town to
    Ruth's farm.
  Jobs pay money, XP, JP for the relevant path and relationship points.
- **Shops**: Marsh General (ammo, medical, food, board kits, extended magazine) and Okafor
  Lumber & Hardware (wood, toolkit, door braces, sandbags, floodlight, alarm). Buy & sell.
  Workbench crafting turns wood into board kits and barricades.
- **NPCs**: Ruth Calloway (neighbor, retired nurse), Dolores "Dee" Marsh (store owner),
  Gus Okafor (lumber yard, job contact), plus townsfolk and a mysterious stranger. Each
  named NPC has a bio, many lines, a daily schedule, story conversations, and talk/gift
  interactions. **Relationships (0–5 ♥)** grant benefits: Ruth warns you about attacks and
  shares supplies; Dee gives tips and discounts; Gus raises job pay. Progress never depends
  on one NPC.
- **Character XP & levels**: from jobs, sieges, story, helping people and discovering
  places. Each level grants 2 attribute points: Vitality (max HP), Endurance (stamina &
  stamina costs), Precision (spread), Awareness (night sight & earlier warnings), Resolve
  (healing, recovery cap, post-hit grace). Previews show exactly what the next point does.
- **JP & skills**: five paths — Survivor, Gunhand, Handyman, Neighbor, Shadow — each with
  three working skills (15 total). JP is earned by doing that kind of activity, with daily
  caps on trivial sources so it can't be farmed. Learn from any mix of paths.
- **Story**: arrival → meet Ruth → town → first job → the stranger → reinforce the cabin →
  the first siege → a clue → telling Ruth the truth → a phone call from Leo Vescari →
  chapter-end screen. Free play continues afterwards with jobs, upgrades, raids and ambushes.
- **Saves**: autosave at safe points (sleep, travel, jobs, installs, after sieges, every
  90 s when safe, and when the app goes to the background). Manual save from the bed or
  menu when no attackers are around. Versioned format with migration of missing/older
  fields. **Export / import** of save files with validation. New Game asks before
  overwriting a save.
- **Mobile**: landscape-first touch layout (with a portrait layout), safe-area insets,
  independent multi-touch controls (move + aim + fire simultaneously), no page
  scrolling/zooming, auto-pause and pause menu when the tab is hidden/device locks, audio
  suspended in the background and started only after a tap, handles rotation/resizing.
- **Accessibility**: reduced/off screen shake, damage and danger communicated with shapes,
  text, patterns and sound — not color alone, large touch targets, readable night scenes.

---

## Testing

### Automated (desktop + iPhone-sized touch)

```bash
npm install                  # installs Playwright (dev dependency)
npx playwright install chromium
npm test
```

`tools/smoke-test.mjs` drives the real game in headless Chromium through the whole
chapter: movement, doors, every story step, all three jobs (including chopping trees and
the repair minigame), shopping, installing every defense type, the story siege (doors get
damaged, mouse-aimed shooting), repairs, the chapter ending, level-ups and attributes,
learning two skills per path via the UI and verifying their effects, discounts, post-chapter
play, defeat & recovery, save/reload equality, new-game overwrite protection, save
validation/migration, simultaneous two-finger touch (joystick + aim) in an iPhone 13
landscape viewport, rotation to portrait and back, and pausing when backgrounded. It fails
on any console error. Screenshots go to `test-output/`.

Current result: **66/66 checks pass**.

### iPhone / iPad checklist (real device testing still needed)

The automated run emulates an iPhone-sized touch screen in Chromium, **not real iOS
Safari**. Please verify on a real device:

1. Serve on your LAN (`npm start`) or deploy, open in Safari, rotate to landscape.
2. Tap **New Game** — sound should start; dialogue advances by tapping; Skip works.
3. Hold the left side to move while dragging the AIM stick — both work together;
   tapping FIRE/RELOAD/DODGE while moving doesn't break the joystick.
4. The page never scrolls, zooms or bounces; no text-selection popups on long press.
5. HUD and buttons clear the notch and home indicator in both landscape orientations.
6. Rotate to portrait and back mid-game — nothing resets.
7. Lock the phone / switch apps → game is paused with the menu open; audio stops; on
   return nothing has advanced.
8. Night at the cabin (~9 PM onward) is still readable at your usual brightness.
9. Add to Home Screen → launches fullscreen; works in airplane mode after one online visit.
10. Play through a siege: frame rate stays smooth.
11. Settings → Export save produces a file; Import accepts it back.

---

## Deployment

It's a static site: deploy the repository root as-is (no build command).

### GitHub

```bash
git add -A && git commit -m "Cabin Under Siege"
git push -u origin main
```

GitHub Pages also works: *Settings → Pages → Deploy from a branch → `main` / root*.

### Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
2. Build settings: **Framework preset: None**, **Build command: (leave empty)**,
   **Build output directory: `/`**.
3. Deploy. Every push to the production branch redeploys automatically.

Or from the CLI: `npx wrangler pages deploy . --project-name cabin-under-siege`.

The included `_headers` file sets `no-cache` on `index.html` and `sw.js` so updates are
picked up promptly. When you ship a new version, bump `CACHE` in `sw.js` (and
`GAME_VERSION` in `src/config.js`). If you add source files, add them to `ASSETS` in
`sw.js` so they're available offline.

---

## Project structure

```
index.html, css/style.css     Page, HUD, touch controls, menus
sw.js, manifest.webmanifest   Offline cache + installable web app
src/main.js                   Boot, main loop, travel, pause, title screen
src/input.js                  Keyboard/mouse + multi-touch controls
src/audio.js                  Synthesized SFX, ambience and music
src/config.js, util.js        Constants and helpers
src/data/                     Content: items & shops, skills & attributes, NPCs, enemies, homes
src/world/                    Map class (collision, LOS, A*), map generation, doors/windows/cover,
                              lighting, renderer
src/game/                     Systems: player, combat, enemy AI, siege & threat, time, jobs,
                              NPCs, story, home defense, inventory, progression, saves
src/ui/                       HUD, dialogue, menus/modals
tools/                        Dev server, smoke test, icon generator
```

### Extending

- **New enemy**: add an entry to `src/data/enemies.js` (stats, weapon `pistol|rifle|bat`,
  preferred distance, retreat threshold) and include it in `makeRaidPlan` weights.
- **New item / shop stock**: `src/data/items.js`.
- **New skill**: add to `SKILLS` in `src/data/skills.js` and read it via `hasSkill()` or
  `derived()` in `src/game/progression.js`.
- **New job**: add a type to `JOB_TYPES`/`boardOffers()` in `src/game/jobs.js` with stage
  handlers and props.
- **New location / home**: write a `buildXMap()` in `src/world/mapgen.js` (buildings,
  doors/windows bound to save records, points, spawns, lights), register it in
  `buildMaps()` in `main.js`, and add the chapter to `src/data/homes.js`.
- **New story chapter**: add a step table and conversations alongside `src/game/story.js`.
- **Save format change**: bump `SAVE_VERSION`, add the field to `newSave()`, and add a
  version step in `migrate()` — missing fields are filled automatically.

---

## Known limitations

- Not yet tested on a physical iPhone/iPad (see checklist above).
- One weapon (handgun) plus melee; no weapon pickups from enemies.
- Enemy AI uses grid A* and simple cover search — good for small sieges, not tuned for
  large crowds. Attackers occasionally bunch at doorways.
- NPC schedules are simple (a few locations per day); townsfolk don't react to danger.
- Music is a generative pad, not composed tracks.
- The phone call, warnings and story are text only (no voice).
- Save data lives in this browser's `localStorage`; clearing site data deletes it — use
  Export to back it up.
- Service-worker offline caching only activates over HTTPS (deployed site), not on
  `http://` LAN testing.

## Future ideas (not playable yet)

- **Chapter 2+ homes**: a small house in another state, a larger rural property, a
  wealthy estate, and the final mansion confrontation — each with new maps, defenses,
  characters and story (listed in the Journal as *planned*).
- More weapons (shotgun, rifle), weapon upgrades and ammo types.
- New enemy types (driver/vehicle assaults, arsonist, dog handler, a lieutenant boss).
- More jobs (fishing, farm work, mechanic), deeper NPC routines and side quests.
- More upgrades: cameras, a safe room, traps, reinforced shutters, a guard dog.
- Weather, seasons, hunger/fatigue as optional survival settings.
- Controller support, rebinding, and a colorblind palette option.
