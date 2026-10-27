# Cabin Under Siege

> *“You left the family. The family didn’t leave you.”*

A top-down 2D survival / action / RPG for phones, tablets and desktop browsers.
You are Frank Lowe — formerly Frankie Corsetti of the Vescari crime family — trying
to build an honest life in a cabin outside the small town of Pine Hollow. By day you
work, meet people and fix up the place. Some nights, the family comes for you.

This build (v0.6) contains **the complete story — five playable chapters with four endings** — plus an arcade mode:

1. **The Cabin** — Pine Hollow, a remote cabin and a small town.
2. **Larch Street** — Millbrook, Ohio: a house on a quiet street, a neighbor with secrets, and Sal Benedetto.
3. **The Wisconsin Farm** — Kettle Crossing: a whole farmstead, a crooked deputy, and Vinnie Vescari's ledger.
4. **The Estate** — Port Whitcombe, Lake Champlain: a walled manor, an FBI agent who wants the ledger, and Nico Vescari coming over the water.
5. **The Mansion** — Short Hills, New Jersey: home again, a mile from Leo Vescari's walled house. The finale.

Plus **Endless Siege** — wave after wave at any home you've reached in the story.

### Audio

Sound is generated in the browser, but modelled on how real sounds are made rather
than using simple beeps:

- **Gunfire** is layered: supersonic crack, powder blast, low thump, rolling tail, plus
  the mechanism (pistol slide, shotgun pump, rifle bolt).
- **Impacts** use modal resonators (metal clicks, wood knocks, glass shatter with
  dozens of ringing fragments, a creaking door hinge, an old phone's double bell).
- **Footsteps** change with the ground: grass, dirt, gravel, wood floors, pavement.
- **Space**: every world sound is placed in stereo and muffled with distance, and goes
  through generated reverbs: an open outdoor space, or a small room when you're inside.
- **Ambience**: gusting wind, rustling leaves, several bird calls by day, layered
  crickets and owls at night, distant traffic in town, crackling fire near flames.
- **Music** is played on generated instruments: a plucked-string (Karplus-Strong)
  fingerpicked guitar and upright bass by day, an additive piano with soft strings at
  night, and acoustic-style drums, bass and low strings during attacks.

**Real recordings:** put licensed audio files in `audio/` and list them in
`audio/manifest.json` — each listed sound replaces the generated one (music files
loop per mood). See [`audio/README.md`](audio/README.md) for the sound names and
recommended free sources.

### What's new in v0.7 — Steam Deck & desktop (itch.io)

- **An installable desktop game** (Electron) for the Steam Deck, Linux and Windows: fullscreen at
  the Deck's 1280×800, no browser bar, no on-screen touch buttons, audio that starts without a
  click, a *Quit to Desktop* button, and F11 for fullscreen. Saves live in the app's own folder.
- **Full controller support** (Steam Deck, Xbox, PlayStation, anything "standard"):
  left stick move, right stick aim, RT fire, A interact, B dodge, X reload, Y switch weapon,
  RB melee, LB quick item, Menu pause, View journal, D-pad shortcuts. Without the right stick,
  aim assist picks targets like it does on touch. Full stick tilt (or LT / L3) sprints.
- **Menus, the title screen and conversations work with the pad**: a gold highlight moves with
  the D-pad or stick, A selects, B backs out, LB/RB flip tabs, the right stick scrolls, and
  left/right change sliders and drop-downs. Button prompts switch between keyboard keys and
  controller buttons depending on what you touched last.
- The browser version gets controller support too.

### What's new in v0.6 — Chapter 5, the finale

- **Short Hills, New Jersey**: Frank comes home to an old watch house on the ridge. Millburn Avenue
  has Marchetti's deli (Angie, whose brother Joey the family killed), St. Rose church (Father Dom,
  who baptised Frankie), Doyle's Towing (Mickey, the job board), a bocce court and three new
  neighbors with errands of their own. Across the ravine: the lights of Leo's study.
- **Three acts**: settle in (3 of 4 chores) → win back the avenue (tow-yard jobs + neighbors'
  errands) → watch the compound from three overlooks → **call in every favor** on the watch-house
  phone. Who answers depends on the whole game: Ruth (if she came along), Marcus, Ingrid, Walt and
  Eleanor, Mickey, Angie, and Agent Reyes if you gave her the ledger.
- **Leo strikes first**: Carlo Bruno's attack on the watch house from four sides — the road, the
  north lane, snipers on the ravine path and the boss from the south woods. Carlo carries the
  mansion's floor plans.
- **The assault**: drive up the ridge after 9 PM. The Vescari house is a walled estate with
  guards standing posts and walking patrols. Stay unseen and they stay put; get spotted and the
  **alarm** wakes the whole house and (unless Mickey's tow trucks block the road) sends
  reinforcements. Each ally changes the night: Ingrid's truck rams the front gate, Walt's flares
  pull two guards to the water, Marcus marks every guard for 90 seconds, Ruth waits in the car and
  pulls you out once. Dante Ruggiero carries the key to Leo's study.
- **Four endings**, chosen in Leo's study: *The Long Arm* (only if Agent Reyes is on your side),
  *The Empty House*, *Father and Son*, and *The Head of the Table*. An epilogue tells where
  everyone you met ended up, based on how you treated them. You can keep playing afterwards.
- Endless Siege adds the **Watch House** site.

### What's new in v0.5 — the world gets depth

- **Characters** are drawn in a slightly angled 3/4 view: legs that stride, arms that swing,
  clothes per person (Frank's coat, Ruth's cardigan and bun, the deputy's uniform and trooper hat,
  fedoras on gunmen, the lieutenant's suit and red tie), guns held toward where they aim with a
  kick when fired, a stagger when hit, and bodies that fall instead of fading circles.
- **Buildings have height**: every front wall is a facade — log cabins, painted clapboard, brick
  storefronts, stone manors, a glass greenhouse — under raised hip roofs with shingles, ridge
  lines and chimneys that smoke, casting shadows on the ground. Front doors and windows are seen
  face-on: boards, shutters, cracks and broken glass included, and windows glow warm at night.
- **Real night lighting**: lamps, porch lights and floodlights are stopped by walls, closed doors
  and shutters, while lit windows throw light out onto the yard. Frank carries a **flashlight**
  whose beam stops at walls (with dust drifting in it), gunfire lights up the room for an instant,
  and fire flickers. The Low graphics setting keeps the old, cheaper lighting.

### What's new in v0.4.1 — a longer, richer Chapter 1

Chapter 1 now takes 30–40 minutes over about six in-game days, in three acts. The story
unlocks through side quests, trust and time instead of a straight line of single steps:

- **Act 1, Settling In:** five chores, finish any four — *A Cold Night* (bring Ruth 10 logs),
  fix the sticking back door, patch the leaky roof, stock the pantry at Dee's, and cut up the
  pine that fell across your driveway (until then the car can't leave; walk to town instead).
- **Act 2, Small Town:** Gus wants three jobs before he'll vouch for you, and the townsfolk
  have errands (Pastor Abe's bake sale, Jenny Miller's cat, Mr. Henderson's fence, Old Man
  Tibbs's firewood — help two). Then a night's sleep, boot prints by your window, a trail to a
  hunting blind full of Parliament butts, Dee, the man in the grey coat, and two scouts who
  come to test the cabin.
- **Act 3, Digging In:** Ruth teaches first aid (+15% healing), Gus teaches carpentry
  (unlocks barricades), Harold's watch earns Harold's rifle; three defenses, then Big Carmine.
- The Journal shows the chore checklist and active errands. The errand system (bring, buy,
  chop, repair, visit, find, return) is reusable for later chapters.

### What's new in v0.4

- **Noir look in the game itself**: painted portraits for every speaking character, cold
  blue nights, a red tint and heavier vignette during attacks, faint film grain.
- **Weather**: rain (streaks, splashes, rain on the roof, thunder) and fog. Rain hides you a
  little; fog cuts everyone's sight, which blunts snipers.
- **Cutscenes**: letterboxed camera moves with title cards when an attack begins, when a
  boss arrives, for Leo's phone call, the ledger, the ring, and arriving at each new home.
  Tap (or Esc) to skip.
- **Damage that stays**: bullet holes, blood, broken glass and scorch marks remain where the
  fight happened until you repair or they fade.
- **Duke the guard dog** (sold at every store): follows you around home, barks at and marks
  strangers, bites and pins attackers, moves with you to new homes.
- **Safe room**: steel-plate the bedroom — during attacks you take half damage by the bed and
  slowly recover.
- **Loot**: attackers sometimes drop their gun, its ammo, or a weapon part.
- **Dog handlers**: a new attacker who brings two fast attack dogs.
- **Chapter 4: The Estate** — Eleanor Whitcombe, Theo Park, Walt Bishop and Agent Dana Reyes.
  Give the FBI the ledger, give them copies, or keep it — and your Chapter 3 deputy choice comes
  back too. Nico Vescari attacks by truck and by boat. Ends with Leo's invitation to Short Hills.

### What's new in v0.3

- **Ruth comes with you.** Once Ruth trusts you (♥3), she runs over with Harold's
  shotgun to fight beside you in attacks at the cabin, and **once per attack pulls you
  back up** instead of a defeat. When you leave Pine Hollow she asks to come along —
  say yes and she follows you to every new home, with her own lines, a favor and a spot by the window.
- **Chapter 3: The Wisconsin Farm** — Ingrid the dairy farmer, Bo at the feed store, Tess
  at the grain co-op. A deputy visit you can **cooperate with, refuse, or bribe** (each
  changes the final attack), a farm gate to repair, and a siege with a **ram truck** that
  smashes the gate and drops off attackers, plus long-range **snipers**.
- **Choices carry forward**: threatening the man in the grey coat, how you answer Marcus,
  and the deputy all change later attacks or conversations.
- **Farm life**: fishing minigame at any pond (Fishing Rod), pickable garden rows that
  regrow, cooking at the stove (Fish Fry, Garden Stew, Hearty Supper → *Well Fed*),
  new **Harvest** and **Fish Order** jobs.
- **Weapon mods**: rifle scope, shotgun choke, pistol suppressor (suppressed shots don't
  alert distant attackers or raise Heat).
- **Reactive Heat**: gunfire where people live raises the family's Heat; quiet nights and
  honest work lower it. The Home tab shows why it moved.
- **NPCs remember** favors you did, your choices and last night's shooting.
- **Difficulty**: Story / Normal / Hard, chosen at New Game, changeable in Settings.
- **Endless Siege** from the title screen: escalating waves, resupply between waves,
  personal bests per home. Homes unlock as you reach them in the story; it never touches your save.
- **Graphics setting**: Automatic / High / Low. Automatic switches to low detail
  (1× resolution, no glow/fireflies/smoke/sway/vignette) if a phone can't hold 45 fps.

### What's new in v0.2

- **Weapons**: pump shotgun (7-pellet spread, shell-by-shell reload you can interrupt) and hunting rifle (long range, punches through the first attacker), with their own ammo. Switch with 1/2/3, Tab, the mouse wheel or the touch **SWAP** button.
- **New attackers**: the **Arsonist** (lobs molotovs — burning ground hurts you and eats through doors, windows and cover) and the **Lieutenant** boss (tough, enemy shotgun, rallies nearby attackers so they fire faster and don't run).
- **Smarter raids**: attackers rate every door and window by how much punishment it can take and probe the weakest, with a little individual bias so squads split.
- **New defenses**: steel window **shutters** (stop 90% of bullets), placeable **bear traps** (heavy damage + pin; re-arm after), and **security cameras** (every attacker on the property is marked during an attack).
- **Favors**: each named character asks for one favor once you're friends (find, deliver, clear, repair, bring materials) — with rewards like Harold's old rifle or Marcus's cameras.
- **Chapter 2**: when Chapter 1 is done, use your car to leave Pine Hollow for good. Level, skills, money, weapons and gear come with you; portable upgrades are packed up. New map, three new characters, a new story, an authored siege and a new ending.
- **Music**: three looping synthesized themes (day folk, night keys, siege drums) instead of a drone.
- **Graphics**: blended terrain, shaded tree sprites with wind sway, shaded characters, warm window and lamp glow at night, fireflies, chimney smoke, burning fires, water shimmer, morning color grading and a soft vignette.
- **Menus**: compact sticky tab bar on phones, aligned button columns, and fixes for misplaced buttons. Fixed touch "ghost clicks" that could close a menu right after opening it.
- **Saves**: format v2; v1 saves migrate automatically.

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
- **All art is procedural** (drawn in code). **Audio is physically modelled** with Web
  Audio (see *Audio* below), and any sound can be replaced by a real recording by
  dropping a file into `audio/`. No third-party or unlicensed assets ship with the game.
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
| Switch weapon | 1 / 2 / 3, Tab, mouse wheel | SWAP |
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

Current result: **all checks pass** (see the count printed at the end of `npm test`). Run one part with `ONLY=desktop|v2|audio|v3|v4|v5|pad|electron|mobile npm test` (comma-separate several). The pad block drives the desktop build with a simulated controller (title, difficulty, dialogue, move, aim, fire, pause menu, tabs, settings, back); the electron block launches the packaged app (after `node tools/build-desktop.mjs`, under a display such as `xvfb-run`). The v5 block plays Chapter 5 end to end: the move to Short Hills, chores, Mickey's jobs, recon, the ally phone calls, Carlo's siege, the floor plans, the night-only drive, guards holding posts, the locked study, Ruth's rescue, Dante's key and the justice ending. The v0.4 block covers portraits, rain, cutscenes and skipping, lasting damage, Duke, the safe room, dog handlers, loot drops and the full Chapter 4 story; the v0.3 block covers Ruth's move, Chapter 3, farm life, difficulty and Endless Siege. The v0.2 block covers buying/switching/firing the shotgun and rifle, rifle pierce, favors, shutters, traps, cameras, arsonist fire, the lieutenant's rally, weakest-point targeting, the move to Chapter 2, the full Chapter 2 story and siege, saving in Chapter 2 and migrating a version-1 save.

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

### Steam Deck / desktop (itch.io)

The desktop game lives in `desktop/` (an Electron shell that serves the same files from
`app://game/`). Build it locally:

```bash
cd desktop && npm install && cd ..
node tools/build-desktop.mjs          # Linux x64 (Steam Deck) → desktop/dist/*.zip
node tools/build-desktop.mjs --win    # + Windows x64
cd desktop && npm start               # run it windowed from source: add --windowed
```

Or let GitHub build it: the **Desktop build (itch.io)** workflow runs on every push that touches
the game and leaves both zips under *Artifacts*. To upload to itch.io automatically, add the
secret `BUTLER_API_KEY` (itch.io → Settings → API keys) and the variable `ITCH_GAME`
(`yourname/cabin-under-siege`). Butler pushes the `linux` and `windows` channels.

On itch.io: create the project as a *Downloadable* game, then mark the `linux` upload as
**Linux** and the `windows` one as **Windows**. Each build includes a `.itch.toml` so the itch
app knows what to launch (`cabin-under-siege.sh` on Linux, which starts the game without
Chromium's setuid sandbox helper, since unzipped files can't keep its permissions).

**Playing on the Deck:** in Desktop Mode install it with the itch app (or unzip the download
somewhere like `~/Games/CabinUnderSiege`), then in Steam choose *Add a Non-Steam Game*, browse
to `cabin-under-siege.sh` (file type: *All Files*), and launch it from Game Mode. The default
*Gamepad* controller template is all it needs.

### Web

It's a static site with no bundler. `npm run build` just copies the playable files
(`index.html`, `css/`, `src/`, `icons/`, `audio/`, `sw.js`, manifest, `_headers`) into `dist/`.

### GitHub

```bash
git add -A && git commit -m "Cabin Under Siege"
git push -u origin main
```

GitHub Pages also works: *Settings → Pages → Deploy from a branch → `main` / root*.

### Cloudflare (Workers static assets — recommended)

`wrangler.jsonc` is included (static assets only, no Worker script). Pick one:

**A. Connect the repo in the dashboard (no secrets needed)**
1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository**, pick this repo.
2. **Build command:** `node tools/build.mjs` · **Deploy command:** `npx wrangler deploy`.
3. Add the build variable `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (the test browser isn't needed to deploy).
4. Deploy. Every push to the production branch redeploys; you get a `*.workers.dev` URL.

**B. GitHub Actions** — `.github/workflows/deploy.yml` deploys on every push to `main`
once you add repository secrets `CLOUDFLARE_API_TOKEN` (template *Edit Cloudflare Workers*)
and `CLOUDFLARE_ACCOUNT_ID`. Without them the workflow just skips the deploy.

**C. From your computer:** `npx wrangler login` then `npm run deploy`.

Cloudflare Pages still works too: build command `node tools/build.mjs`, output directory `dist`.

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
src/data/                     Content: items & shops, weapons, skills & attributes, NPCs, enemies, homes
src/world/                    Map class (collision, LOS, A*), map generation, doors/windows/cover,
                              lighting, renderer
src/game/                     Systems: player & weapons, combat, fire, enemy AI, siege & threat, time,
                              jobs, favors (quests), NPCs, story, chapters, home defense, inventory,
                              progression, saves
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
- **New chapter / home**: write a `buildXMap()` in `src/world/mapgen.js` (buildings,
  doors/windows bound to save records, `points`, `spawns`, `lights`, `homeInfo`), add its
  opening records to `newHome()` in `src/game/state.js`, register the builder in
  `MAP_BUILDERS` in `main.js`, add an entry to `CHAPTERS` in `src/game/chapters.js`
  (maps and which NPCs are the neighbor / shopkeeper / job contact), and mark it playable
  in `src/data/homes.js`.
- **New favor**: add an entry to `QUESTS` in `src/game/quests.js`.
- **New weapon**: add it to `src/data/weapons.js` and an item + shop entry in `src/data/items.js`.
- **New story chapter**: add a step table and conversations alongside `src/game/story.js`.
- **Save format change**: bump `SAVE_VERSION`, add the field to `newSave()`, and add a
  version step in `migrate()` — missing fields are filled automatically.

---

## Known limitations

- Not yet tested on a physical iPhone/iPad (see checklist above).
- Three firearms plus melee; no weapon pickups from enemies.
- Ruth's combat AI is simple: she holds a post by a window and fires at what she can see.
- Endless Siege uses fixed starting gear and level.
- Enemy AI uses grid A* and simple cover search — good for small sieges, not tuned for
  large crowds. Attackers occasionally bunch at doorways.
- NPC schedules are simple (a few locations per day); townsfolk don't react to danger.
- Audio is generated in the browser; for studio-quality sound, add recordings to `audio/` (see above).
- The phone call, warnings and story are text only (no voice).
- Save data lives in this browser's `localStorage`; clearing site data deletes it — use
  Export to back it up.
- Service-worker offline caching only activates over HTTPS (deployed site), not on
  `http://` LAN testing.

## Future ideas (not playable yet)

- A New Game+ that carries your ending into a harder second run.
- More enemy types (dog handler, demolition crew), a mechanic job, deeper NPC routines.
- More upgrades: cameras, a safe room, traps, reinforced shutters, a guard dog.
- Weather, seasons, hunger/fatigue as optional survival settings.
- Controller support, rebinding, and a colorblind palette option.
