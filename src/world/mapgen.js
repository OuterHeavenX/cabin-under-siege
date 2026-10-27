// Builds the playable maps. Maps are generated in code (with a fixed seed) so
// layouts are deterministic and easy to extend with new locations later.
import { TILE } from '../config.js';
import { seeded } from '../util.js';
import { GameMap, GR, SO } from './map.js';
import { Door, Window } from './blockers.js';

const P = (cx, cy) => ({ x: cx * TILE, y: cy * TILE }); // corner of cell -> use +0.5 for centres

function building(map, b) {
  const { x, y, w, h } = b;
  map.fillGround(x, y, w, h, b.floor ?? GR.FLOOR);
  for (let i = x; i < x + w; i++) { map.setSolid(i, y, SO.WALL); map.setSolid(i, y + h - 1, SO.WALL); }
  for (let j = y; j < y + h; j++) { map.setSolid(x, j, SO.WALL); map.setSolid(x + w - 1, j, SO.WALL); }
  map.buildings.push({ roof: '#6b3b2a', ...b });
  return b;
}

function addDoor(map, id, cx, cy, rec, label, vertical = false) {
  map.setSolid(cx, cy, SO.NONE);
  map.setGround(cx, cy, GR.FLOOR);
  const d = new Door(id, cx, cy, rec, label, vertical);
  map.blockers.set(map.idx(cx, cy), d);
  return d;
}

function addWindow(map, id, cx, cy, rec, label, vertical = false) {
  map.setSolid(cx, cy, SO.NONE);
  const wdw = new Window(id, cx, cy, rec, label, vertical);
  map.blockers.set(map.idx(cx, cy), wdw);
  return wdw;
}

// NPC buildings get transient records (not part of the player's home defenses).
const npcDoorRec = () => ({ kind: 'door', hp: 100, reinforced: false, open: false, npc: true });
const npcWinRec = () => ({ kind: 'window', glass: 20, boards: false, boardHp: 0, npc: true });

function addTree(map, cx, cy, kind) {
  if (!map.inBounds(cx, cy)) return;
  const i = map.idx(cx, cy);
  if (map.getSolid(cx, cy) !== SO.NONE || map.blockers.has(i)) return;
  const g = map.ground[i];
  if (g !== GR.GRASS && g !== GR.DIRT) return;
  map.setSolid(cx, cy, SO.TREE);
  map.trees.set(i, { cx, cy, kind, chopped: false, chops: 0 });
}

function scatterTrees(map, rnd, x0, y0, x1, y1, density, avoid) {
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      if (avoid && avoid(cx, cy)) continue;
      if (rnd() < density) addTree(map, cx, cy, rnd() < 0.62 ? 'pine' : 'oak');
    }
  }
}

function rectHas(r, cx, cy) { return cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]; }

function addProp(map, p) { map.props.push({ r: 46, ...p }); return p; }

/* ------------------------------------------------------------------ */
/*  CABIN PROPERTY                                                     */
/* ------------------------------------------------------------------ */
export function buildCabinMap(home) {
  const W = 60, H = 44;
  const m = new GameMap('cabin', W, H, 'The Cabin');
  const rnd = seeded(1977);

  // Road along the south and the driveway up to the cabin.
  m.fillGround(0, 39, W, 2, GR.ROAD);
  m.fillGround(24, 29, 2, 10, GR.DIRT);
  m.fillGround(23, 30, 4, 4, GR.GRAVEL); // parking pad
  // Trails: back door to the north woods, and east to Ruth's farm.
  m.fillGround(24, 4, 1, 13, GR.DIRT);
  m.fillGround(31, 28, 15, 1, GR.DIRT);
  m.fillGround(47, 28, 2, 11, GR.DIRT); // Ruth's driveway

  // Cabin
  building(m, { id: 'cabin', name: 'Your Cabin', x: 18, y: 17, w: 13, h: 10, roof: '#5b3a29', isHome: true });
  const o = home.openings;
  addDoor(m, 'front_door', 24, 26, o.front_door, 'Front Door');
  addDoor(m, 'back_door', 24, 17, o.back_door, 'Back Door');
  addWindow(m, 'win_fl', 20, 26, o.win_fl, 'Front-Left Window');
  addWindow(m, 'win_fr', 28, 26, o.win_fr, 'Front-Right Window');
  addWindow(m, 'win_w', 18, 21, o.win_w, 'West Window', true);
  addWindow(m, 'win_e', 30, 21, o.win_e, 'East Window', true);
  // Porch
  m.fillGround(21, 27, 7, 2, GR.PORCH);
  // Interior furniture
  m.fillSolid(19, 18, 2, 2, SO.FURN); // bed
  m.fillSolid(28, 18, 2, 1, SO.FURN); // stove & counter
  m.fillSolid(23, 21, 3, 2, SO.FURN); // table
  m.fillSolid(29, 23, 1, 2, SO.FURN); // workbench
  m.decor.push({ kind: 'bed', x: 19, y: 18, w: 2, h: 2 });
  m.decor.push({ kind: 'stove', x: 28, y: 18, w: 2, h: 1 });
  m.decor.push({ kind: 'table', x: 23, y: 21, w: 3, h: 2 });
  m.decor.push({ kind: 'workbench', x: 29, y: 23, w: 1, h: 2 });
  m.decor.push({ kind: 'rug', x: 21, y: 23, w: 3, h: 2 });
  addProp(m, { id: 'bed', kind: 'bed', x: 20 * TILE, y: 20.3 * TILE, label: 'Bed', r: 40 });
  addProp(m, { id: 'workbench', kind: 'workbench', x: 28.6 * TILE, y: 24 * TILE, label: 'Workbench', r: 40 });
  addProp(m, { id: 'phone', kind: 'phone', x: 26.5 * TILE, y: 18.4 * TILE, label: 'Telephone', r: 40 });
  addProp(m, { id: 'stove', kind: 'stove', x: 28.5 * TILE, y: 19.4 * TILE, label: 'Stove', r: 38 });
  m.decor.push({ kind: 'phone', x: 26, y: 18, w: 1, h: 1 });

  // Woodpile beside the cabin (cover)
  m.fillSolid(31, 23, 1, 3, SO.LOGS);
  m.decor.push({ kind: 'logs', x: 31, y: 23, w: 1, h: 3 });

  // Car on the parking pad
  m.fillSolid(25, 31, 2, 3, SO.CAR);
  addProp(m, { id: 'car', kind: 'car', x: 26 * TILE, y: 32.5 * TILE, label: 'Your Car', r: 64 });

  // Phone pole & mailbox by the road
  m.setSolid(21, 37, SO.WALL);
  m.decor.push({ kind: 'pole', x: 21, y: 37, w: 1, h: 1 });
  addProp(m, { id: 'phonepole', kind: 'phonepole', x: 21.5 * TILE, y: 37.5 * TILE, label: 'Phone Line', r: 48 });
  m.setSolid(23, 38, SO.FURN);
  m.decor.push({ kind: 'mailbox', x: 23, y: 38, w: 1, h: 1 });
  addProp(m, { id: 'mailbox', kind: 'mailbox', x: 23.5 * TILE, y: 38.5 * TILE, label: 'Mailbox', r: 40 });

  // Pond in the north-east
  for (let cy = 4; cy <= 11; cy++) for (let cx = 44; cx <= 56; cx++) {
    const dx = (cx - 50) / 6, dy = (cy - 7.5) / 3.6;
    if (dx * dx + dy * dy < 1) { m.setGround(cx, cy, GR.WATER); m.setSolid(cx, cy, SO.WATER); }
  }

  // Ruth's farmhouse
  building(m, { id: 'ruth_house', name: "Ruth's Farmhouse", x: 44, y: 18, w: 9, h: 8, roof: '#7a2f2f' });
  addDoor(m, 'ruth_door', 48, 25, npcDoorRec(), "Ruth's Door");
  addWindow(m, 'ruth_w1', 46, 25, npcWinRec(), 'Window');
  addWindow(m, 'ruth_w2', 50, 25, npcWinRec(), 'Window');
  m.fillGround(46, 26, 5, 2, GR.PORCH);
  m.fillSolid(45, 19, 2, 1, SO.FURN); m.decor.push({ kind: 'bed', x: 45, y: 19, w: 2, h: 1 });
  m.fillSolid(49, 20, 2, 2, SO.FURN); m.decor.push({ kind: 'table', x: 49, y: 20, w: 2, h: 2 });
  // Garden with a fence
  m.fillGround(38, 30, 8, 5, GR.GARDEN);
  for (let cx = 37; cx <= 46; cx++) { if (cx !== 41 && cx !== 42) m.setSolid(cx, 29, SO.FENCE); m.setSolid(cx, 35, SO.FENCE); }
  for (let cy = 29; cy <= 35; cy++) { m.setSolid(37, cy, SO.FENCE); m.setSolid(46, cy, SO.FENCE); }
  m.decor.push({ kind: 'crops', x: 38, y: 30, w: 8, h: 5 });

  // Rocks (natural cover)
  const rocks = [[14, 30], [15, 30], [34, 33], [9, 26], [33, 12], [36, 21], [13, 14], [40, 14], [16, 35], [55, 30], [30, 34]];
  for (const [cx, cy] of rocks) { m.setSolid(cx, cy, SO.ROCK); }

  // Trees: dense woods north and west, scattered elsewhere.
  const clear = [
    [15, 14, 34, 30], // cabin yard
    [21, 29, 29, 38], // driveway
    [0, 37, 59, 43], // road band
    [36, 15, 57, 37], // Ruth's farm
    [23, 2, 25, 16], // north trail
    [30, 27, 46, 29], // east trail
    [22, 0, 26, 2], // north spawn
    [0, 20, 2, 24], // west spawn
    [56, 0, 59, 3], [0, 0, 4, 3],
  ];
  const avoid = (cx, cy) => clear.some((r) => rectHas(r, cx, cy));
  scatterTrees(m, rnd, 0, 0, W - 1, 15, 0.28, avoid);
  scatterTrees(m, rnd, 0, 15, 14, 38, 0.24, avoid);
  scatterTrees(m, rnd, 15, 0, W - 1, 38, 0.05, avoid);
  scatterTrees(m, rnd, 0, 41, W - 1, H - 1, 0.35, (cx, cy) => cy < 42);
  // A few deliberate trees near the yard: cover for both sides.
  [[16, 22], [33, 18], [17, 28], [34, 27], [20, 31], [29, 36]].forEach(([cx, cy]) => addTree(m, cx, cy, 'oak'));

  // Attacker spawn points (map edges).
  m.spawns = {
    north: { ...P(24.5, 0.5), label: 'the north woods' },
    northwest: { ...P(1.5, 1.5), label: 'the north-west treeline' },
    west: { ...P(0.5, 22), label: 'the west woods' },
    east: { ...P(59.5, 39.5), label: 'the road to the east' },
    southwest: { ...P(0.5, 40), label: 'the road to the west' },
    northeast: { ...P(57.5, 1.5), label: 'past the pond' },
  };

  m.points = {
    start: P(24.5, 34.5),
    cabin_in: P(24.5, 24),
    bed: P(21.4, 19),
    porch: P(24.5, 28),
    car: P(24, 32.5),
    ruth_garden: P(42, 32.5),
    ruth_porch: P(48.5, 26.8),
    ruth_in: P(47.5, 22.5),
    ruth_gate: P(41.5, 28.5),
    cabin_front: P(24.5, 28.2),
    footprints: P(19.5, 28.5),
    strange_car: P(36, 39.6),
    recovery: P(48.5, 23.5),
  };
  m.discover = [
    { id: 'cabin', name: 'Your Cabin', ...P(24.5, 22), r: 140 },
    { id: 'ruth_farm', name: "Calloway Farm", ...P(46, 26), r: 170 },
    { id: 'north_woods', name: 'North Woods', ...P(24, 6), r: 150 },
    { id: 'pond', name: 'Still Pond', ...P(50, 12), r: 140 },
  ];
  m.lights = [
    { x: 24.5 * TILE, y: 21.5 * TILE, r: 150, building: 'cabin' },
    { x: 48.5 * TILE, y: 21.5 * TILE, r: 110, building: 'ruth_house' },
    { x: 48.5 * TILE, y: 27 * TILE, r: 70 },
  ];
  m.homeInfo = {
    building: 'cabin', interior: { cx: 24, cy: 22 }, allyPost: P(20.5, 24.9),
    flood: { x: 24.5 * TILE, y: 28.6 * TILE, r: 270 }, porch: { x: 24.5 * TILE, y: 27.6 * TILE, r: 95 },
  };
  m.exits = [{ id: 'to_town', x: 59 * TILE, y: 38 * TILE, w: TILE, h: 4 * TILE, target: 'town', label: 'Walk to Pine Hollow (1 hr)' }];
  addProp(m, { id: 'exit_town', kind: 'exit', x: 58.6 * TILE, y: 40 * TILE, label: 'Road to Pine Hollow', r: 56, target: 'town' });
  return m;
}

/* ------------------------------------------------------------------ */
/*  PINE HOLLOW (TOWN)                                                 */
/* ------------------------------------------------------------------ */
export function buildTownMap() {
  const W = 64, H = 44;
  const m = new GameMap('town', W, H, 'Pine Hollow');
  const rnd = seeded(4242);

  // Streets
  m.fillGround(0, 20, W, 2, GR.ROAD);
  m.fillGround(31, 4, 2, 16, GR.ROAD);
  m.fillGround(31, 22, 2, 14, GR.ROAD);
  m.fillGround(4, 19, 56, 1, GR.SIDEWALK);
  m.fillGround(4, 22, 56, 1, GR.SIDEWALK);
  m.fillGround(1, 14, 6, 5, GR.GRAVEL); // parking lot

  // Marsh General Store
  building(m, { id: 'store', name: 'Marsh General Store', x: 8, y: 10, w: 10, h: 9, roof: '#2f5d7a', floor: GR.TILEFLOOR, shop: 'dee' });
  addDoor(m, 'store_door', 12, 18, npcDoorRec(), 'Store Door');
  addWindow(m, 'store_w1', 10, 18, npcWinRec(), 'Window');
  addWindow(m, 'store_w2', 15, 18, npcWinRec(), 'Window');
  m.fillSolid(10, 13, 6, 1, SO.COUNTER);
  m.decor.push({ kind: 'counter', x: 10, y: 13, w: 6, h: 1 });
  m.fillSolid(9, 15, 1, 2, SO.FURN); m.decor.push({ kind: 'shelf', x: 9, y: 15, w: 1, h: 2 });
  m.fillSolid(16, 15, 1, 2, SO.FURN); m.decor.push({ kind: 'shelf', x: 16, y: 15, w: 1, h: 2 });
  m.fillSolid(9, 11, 8, 1, SO.FURN); m.decor.push({ kind: 'shelf', x: 9, y: 11, w: 8, h: 1 });
  addProp(m, { id: 'store_counter', kind: 'counter', x: 13 * TILE, y: 14.5 * TILE, label: 'Store Counter', r: 44 });

  // Diner
  building(m, { id: 'diner', name: 'Pine Hollow Diner', x: 20, y: 11, w: 9, h: 8, roof: '#8a3b3b', floor: GR.TILEFLOOR });
  addDoor(m, 'diner_door', 24, 18, npcDoorRec(), 'Diner Door');
  addWindow(m, 'diner_w1', 21, 18, npcWinRec(), 'Window');
  addWindow(m, 'diner_w2', 27, 18, npcWinRec(), 'Window');
  m.fillSolid(21, 12, 7, 1, SO.COUNTER); m.decor.push({ kind: 'counter', x: 21, y: 12, w: 7, h: 1 });
  [[22, 15], [26, 15]].forEach(([cx, cy]) => { m.fillSolid(cx, cy, 1, 1, SO.FURN); m.decor.push({ kind: 'table', x: cx, y: cy, w: 1, h: 1 }); });

  // Chapel
  building(m, { id: 'chapel', name: 'Hollow Chapel', x: 36, y: 9, w: 8, h: 9, roof: '#585858' });
  addDoor(m, 'chapel_door', 39, 17, npcDoorRec(), 'Chapel Door');
  addWindow(m, 'chapel_w1', 36, 13, npcWinRec(), 'Window', true);
  addWindow(m, 'chapel_w2', 43, 13, npcWinRec(), 'Window', true);
  for (let j = 11; j <= 14; j += 1) { m.fillSolid(38, j, 1, 1, SO.FURN); m.fillSolid(41, j, 1, 1, SO.FURN); }
  m.decor.push({ kind: 'pews', x: 38, y: 11, w: 4, h: 4 });

  // Henderson house
  building(m, { id: 'henderson', name: 'Henderson House', x: 47, y: 11, w: 7, h: 7, roof: '#4c6b3a' });
  addDoor(m, 'hend_door', 50, 17, npcDoorRec(), 'Henderson Door');
  addWindow(m, 'hend_w1', 48, 17, npcWinRec(), 'Window');
  for (let cx = 54; cx <= 58; cx++) m.setSolid(cx, 17, SO.FENCE);
  for (let cy = 11; cy <= 17; cy++) m.setSolid(58, cy, SO.FENCE);

  // Miller house
  building(m, { id: 'miller', name: 'Miller House', x: 8, y: 24, w: 7, h: 7, roof: '#6a5a8a' });
  addDoor(m, 'miller_door', 11, 24, npcDoorRec(), 'Miller Door');
  addWindow(m, 'miller_w1', 13, 24, npcWinRec(), 'Window');

  // Dee's house
  building(m, { id: 'dee_house', name: "Dee's House", x: 18, y: 24, w: 7, h: 7, roof: '#a0663c' });
  addDoor(m, 'dee_door', 21, 24, npcDoorRec(), "Dee's Door");
  addWindow(m, 'dee_w1', 23, 24, npcWinRec(), 'Window');

  // Gus's house
  building(m, { id: 'gus_house', name: "Gus's House", x: 34, y: 24, w: 5, h: 6, roof: '#3d4f5c' });
  addDoor(m, 'gus_door', 36, 24, npcDoorRec(), "Gus's Door");

  // Okafor Lumber yard
  m.fillGround(41, 24, 17, 12, GR.GRAVEL);
  building(m, { id: 'lumber_office', name: 'Okafor Lumber Office', x: 41, y: 24, w: 6, h: 5, roof: '#8b6b2f', shop: 'gus' });
  addDoor(m, 'office_door', 43, 24, npcDoorRec(), 'Office Door');
  addWindow(m, 'office_w', 45, 24, npcWinRec(), 'Window');
  for (let cx = 47; cx <= 58; cx++) { if (cx < 50 || cx > 52) m.setSolid(cx, 24, SO.FENCE); m.setSolid(cx, 36, SO.FENCE); }
  for (let cy = 24; cy <= 36; cy++) { if (cy !== 30 && cy !== 31) m.setSolid(58, cy, SO.FENCE); m.setSolid(40, cy, SO.FENCE); }
  m.fillSolid(52, 27, 4, 2, SO.LOGS); m.decor.push({ kind: 'logs', x: 52, y: 27, w: 4, h: 2 });
  m.fillSolid(44, 31, 3, 2, SO.LOGS); m.decor.push({ kind: 'logs', x: 44, y: 31, w: 3, h: 2 });
  m.setSolid(48, 23, SO.FURN); m.decor.push({ kind: 'board', x: 48, y: 23, w: 1, h: 1 });
  addProp(m, { id: 'jobboard', kind: 'jobboard', x: 48.5 * TILE, y: 22.6 * TILE, label: 'Job Board', r: 44 });
  addProp(m, { id: 'logdrop', kind: 'logdrop', x: 54 * TILE, y: 26.2 * TILE, label: 'Log Drop-off', r: 54 });
  addProp(m, { id: 'shed', kind: 'shed', x: 55.5 * TILE, y: 33.5 * TILE, label: 'Supply Shed', r: 46 });
  m.fillSolid(55, 34, 2, 1, SO.FURN); m.decor.push({ kind: 'crate', x: 55, y: 34, w: 2, h: 1 });

  // Parked car in the lot
  m.fillSolid(3, 15, 2, 3, SO.CAR);
  addProp(m, { id: 'car', kind: 'car', x: 4 * TILE, y: 16.5 * TILE, label: 'Your Car', r: 64 });

  // Benches, a fountain in the square
  m.fillSolid(27, 6, 3, 3, SO.ROCK); m.decor.push({ kind: 'fountain', x: 27, y: 6, w: 3, h: 3 });
  m.fillGround(24, 4, 6, 6, GR.SIDEWALK);

  // Trees: the woodlot east and south of the yard, plus the town edges.
  const clear = [
    [0, 9, 59, 23], [7, 23, 39, 31], [40, 23, 58, 37], [30, 0, 33, 43], [0, 13, 7, 19], [23, 3, 30, 10], [35, 8, 44, 18], [46, 10, 58, 18],
  ];
  const avoid = (cx, cy) => clear.some((r) => rectHas(r, cx, cy));
  scatterTrees(m, rnd, 0, 0, W - 1, 8, 0.22, avoid);
  scatterTrees(m, rnd, 59, 9, W - 1, H - 1, 0.33, avoid);
  scatterTrees(m, rnd, 0, 32, W - 1, H - 1, 0.24, avoid);
  scatterTrees(m, rnd, 0, 23, 6, 32, 0.2, avoid);

  m.points = {
    arrive: P(6, 20.5),
    car: P(5.8, 16.5),
    dee_store: P(13, 12.6),
    dee_diner: P(23, 14),
    dee_home: P(21.5, 27.5),
    gus_yard: P(48.5, 29),
    gus_diner: P(26, 14),
    gus_home: P(36.5, 27),
    stranger: P(29.6, 19.5), woodlot: P(61, 30),
    store_door: P(12.5, 19.5),
    recovery: P(13, 15.5),
    walk_a: P(18, 19.5), walk_b: P(46, 22.5), walk_c: P(27, 9.5), walk_d: P(10, 22.5), walk_e: P(38, 19.5), walk_f: P(55, 19.5),
  };
  m.deliveryTargets = {
    henderson: { name: 'the Henderson house', ...P(50.5, 18.6) },
    chapel: { name: 'Hollow Chapel', ...P(39.5, 18.6) },
    miller: { name: 'the Miller house', ...P(11.5, 23.4) },
    diner: { name: 'Pine Hollow Diner', ...P(24.5, 19.4) },
  };
  m.repairTargets = {
    hend_fence: { name: "the Hendersons' fence", ...P(56.5, 16.2), cell: [56, 17] },
    chapel_pump: { name: 'the chapel water pump', ...P(45, 15.5) },
    miller_steps: { name: "the Millers' porch steps", ...P(12.5, 23.2) },
    diner_sign: { name: 'the diner sign', ...P(29.2, 18.6) },
  };
  m.discover = [
    { id: 'town', name: 'Pine Hollow', ...P(12, 20), r: 200 },
    { id: 'store', name: 'Marsh General Store', ...P(12.5, 14), r: 110 },
    { id: 'diner', name: 'Pine Hollow Diner', ...P(24.5, 15), r: 110 },
    { id: 'lumber', name: 'Okafor Lumber', ...P(49, 29), r: 150 },
    { id: 'chapel', name: 'Hollow Chapel', ...P(40, 13), r: 110 },
    { id: 'woodlot', name: 'The Woodlot', ...P(61, 30), r: 140 },
  ];
  m.lights = [];
  for (let cx = 6; cx < 60; cx += 8) { m.lights.push({ x: cx * TILE, y: 19 * TILE, r: 120, street: true }); m.lights.push({ x: (cx + 4) * TILE, y: 22.9 * TILE, r: 120, street: true }); }
  for (const b of m.buildings) m.lights.push({ x: (b.x + b.w / 2) * TILE, y: (b.y + b.h / 2) * TILE, r: Math.max(b.w, b.h) * 16, building: b.id });
  m.spawns = {
    west: { ...P(0.5, 21), label: 'the west road' },
    north: { ...P(32, 0.5), label: 'the north road' },
    south: { ...P(32, 43.5), label: 'the south road' },
  };
  addProp(m, { id: 'exit_cabin', kind: 'exit', x: 0.6 * TILE, y: 21 * TILE, label: 'Road Home', r: 56, target: 'cabin' });
  return m;
}

/* ------------------------------------------------------------------ */
/*  CHAPTER 2: MILLBROOK — Larch Street + downtown on one map          */
/* ------------------------------------------------------------------ */
export function buildMillbrookMap(home) {
  const W = 64, H = 48;
  const m = new GameMap('millbrook', W, H, 'Millbrook');
  const rnd = seeded(2024);

  // Streets: Larch St (east-west) and Main St (north-south).
  m.fillGround(0, 29, W, 2, GR.ROAD);
  m.fillGround(44, 0, 2, 29, GR.ROAD);
  m.fillGround(0, 28, 44, 1, GR.SIDEWALK); m.fillGround(46, 28, 18, 1, GR.SIDEWALK);
  m.fillGround(0, 31, W, 1, GR.SIDEWALK);
  m.fillGround(43, 0, 1, 28, GR.SIDEWALK); m.fillGround(46, 0, 1, 28, GR.SIDEWALK);

  // Your house
  building(m, { id: 'house', name: 'Your House', x: 18, y: 33, w: 12, h: 9, roof: '#4d5a66', isHome: true });
  const o = home.openings;
  addDoor(m, 'front_door', 24, 33, o.front_door, 'Front Door');
  addDoor(m, 'back_door', 24, 41, o.back_door, 'Back Door');
  addWindow(m, 'win_f1', 21, 33, o.win_f1, 'Front-Left Window');
  addWindow(m, 'win_f2', 27, 33, o.win_f2, 'Front-Right Window');
  addWindow(m, 'win_w', 18, 37, o.win_w, 'West Window', true);
  addWindow(m, 'win_e', 29, 37, o.win_e, 'East Window', true);
  addWindow(m, 'win_b', 27, 41, o.win_b, 'Back Window');
  m.fillGround(22, 32, 5, 1, GR.PORCH);
  m.fillSolid(19, 34, 2, 2, SO.FURN); m.decor.push({ kind: 'bed', x: 19, y: 34, w: 2, h: 2 });
  m.fillSolid(27, 34, 2, 1, SO.FURN); m.decor.push({ kind: 'stove', x: 27, y: 34, w: 2, h: 1 });
  m.fillSolid(22, 37, 3, 2, SO.FURN); m.decor.push({ kind: 'table', x: 22, y: 37, w: 3, h: 2 });
  m.fillSolid(28, 39, 1, 2, SO.FURN); m.decor.push({ kind: 'workbench', x: 28, y: 39, w: 1, h: 2 });
  m.decor.push({ kind: 'rug', x: 19, y: 38, w: 3, h: 2 });
  m.decor.push({ kind: 'phone', x: 25, y: 34, w: 1, h: 1 });
  addProp(m, { id: 'bed', kind: 'bed', x: 20 * TILE, y: 36.3 * TILE, label: 'Bed', r: 40 });
  addProp(m, { id: 'workbench', kind: 'workbench', x: 27.6 * TILE, y: 40 * TILE, label: 'Workbench', r: 40 });
  addProp(m, { id: 'phone', kind: 'phone', x: 25.5 * TILE, y: 34.4 * TILE, label: 'Telephone', r: 40 });
  addProp(m, { id: 'stove', kind: 'stove', x: 27.5 * TILE, y: 35.4 * TILE, label: 'Stove', r: 38 });
  // Driveway & car
  m.fillGround(31, 32, 3, 7, GR.GRAVEL);
  m.fillSolid(31, 34, 2, 3, SO.CAR);
  addProp(m, { id: 'car', kind: 'car', x: 32 * TILE, y: 35.5 * TILE, label: 'Your Car', r: 64 });
  // Mailbox & phone pole
  m.setSolid(20, 32, SO.FURN); m.decor.push({ kind: 'mailbox', x: 20, y: 32, w: 1, h: 1 });
  addProp(m, { id: 'mailbox', kind: 'mailbox', x: 20.5 * TILE, y: 32.5 * TILE, label: 'Mailbox', r: 40 });
  m.setSolid(15, 32, SO.WALL); m.decor.push({ kind: 'pole', x: 15, y: 32, w: 1, h: 1 });
  addProp(m, { id: 'phonepole', kind: 'phonepole', x: 15.5 * TILE, y: 32.5 * TILE, label: 'Phone Line', r: 48 });
  // Backyard fence with a gate
  for (let cx = 17; cx <= 30; cx++) if (cx < 23 || cx > 25) m.setSolid(cx, 46, SO.FENCE);
  for (let cy = 42; cy <= 46; cy++) { m.setSolid(17, cy, SO.FENCE); m.setSolid(30, cy, SO.FENCE); }
  m.fillSolid(19, 43, 2, 1, SO.LOGS); m.decor.push({ kind: 'logs', x: 19, y: 43, w: 2, h: 1 });
  // Ruth's camper (if she came with you)
  m.fillSolid(26, 43, 3, 2, SO.CAR); m.decor.push({ kind: 'camper', x: 26, y: 43, w: 3, h: 2 });

  // Marcus Bell's house (across the street)
  building(m, { id: 'marcus_house', name: 'Bell House', x: 18, y: 19, w: 9, h: 9, roof: '#7a5230' });
  addDoor(m, 'marcus_door', 22, 27, npcDoorRec(), "Marcus's Door");
  addWindow(m, 'marcus_w1', 20, 27, npcWinRec(), 'Window');
  addWindow(m, 'marcus_w2', 25, 27, npcWinRec(), 'Window');
  m.fillSolid(19, 20, 2, 1, SO.FURN); m.decor.push({ kind: 'bed', x: 19, y: 20, w: 2, h: 1 });
  m.fillSolid(23, 21, 2, 2, SO.FURN); m.decor.push({ kind: 'table', x: 23, y: 21, w: 2, h: 2 });
  m.setSolid(16, 22, SO.WALL); m.decor.push({ kind: 'antenna', x: 16, y: 22, w: 1, h: 1 });

  // Other homes on Larch Street
  building(m, { id: 'rosa_house', name: 'Delgado House', x: 6, y: 20, w: 8, h: 8, roof: '#9a4f3a' });
  addDoor(m, 'rosa_door', 9, 27, npcDoorRec(), "Rosa's Door");
  addWindow(m, 'rosa_w', 11, 27, npcWinRec(), 'Window');
  building(m, { id: 'pete_house', name: 'Kowalski House', x: 30, y: 20, w: 8, h: 8, roof: '#5a6b3d' });
  addDoor(m, 'pete_door', 33, 27, npcDoorRec(), "Pete's Door");
  addWindow(m, 'pete_w', 35, 27, npcWinRec(), 'Window');
  building(m, { id: 'hendricks', name: 'Hendricks House', x: 4, y: 33, w: 8, h: 7, roof: '#6a5a8a' });
  addDoor(m, 'hend2_door', 7, 33, npcDoorRec(), 'Hendricks Door');
  addWindow(m, 'hend2_w', 9, 33, npcWinRec(), 'Window');
  building(m, { id: 'ortiz', name: 'Ortiz House', x: 36, y: 33, w: 7, h: 7, roof: '#3d5f7a' });
  addDoor(m, 'ortiz_door', 39, 33, npcDoorRec(), 'Ortiz Door');
  addWindow(m, 'ortiz_w', 41, 33, npcWinRec(), 'Window');
  for (let cx = 36; cx <= 42; cx++) m.setSolid(cx, 42, SO.FENCE);

  // Downtown: Delgado Hardware & Sporting
  building(m, { id: 'hardware', name: 'Delgado Hardware', x: 47, y: 8, w: 11, h: 8, roof: '#2f6a5a', floor: GR.TILEFLOOR, shop: 'rosa' });
  addDoor(m, 'hw_door', 47, 12, npcDoorRec(), 'Store Door', true);
  addWindow(m, 'hw_w1', 47, 10, npcWinRec(), 'Window', true);
  addWindow(m, 'hw_w2', 47, 14, npcWinRec(), 'Window', true);
  m.fillSolid(50, 10, 1, 4, SO.COUNTER); m.decor.push({ kind: 'counter', x: 50, y: 10, w: 1, h: 4 });
  m.fillSolid(56, 9, 1, 6, SO.FURN); m.decor.push({ kind: 'shelf', x: 56, y: 9, w: 1, h: 6 });
  m.fillSolid(52, 9, 4, 1, SO.FURN); m.decor.push({ kind: 'shelf', x: 52, y: 9, w: 4, h: 1 });
  addProp(m, { id: 'store_counter', kind: 'counter', x: 49.3 * TILE, y: 12 * TILE, label: 'Store Counter', r: 44 });

  // Post office & library
  building(m, { id: 'post', name: 'Post Office', x: 47, y: 18, w: 7, h: 7, roof: '#3b4f7a' });
  addDoor(m, 'post_door', 47, 21, npcDoorRec(), 'Post Office Door', true);
  addWindow(m, 'post_w', 47, 19, npcWinRec(), 'Window', true);
  building(m, { id: 'library', name: 'Library', x: 55, y: 18, w: 8, h: 8, roof: '#6b3b5a' });
  addDoor(m, 'lib_door', 58, 25, npcDoorRec(), 'Library Door');
  addWindow(m, 'lib_w', 60, 25, npcWinRec(), 'Window');

  // Kowalski Moving & Odd Jobs
  m.fillGround(30, 12, 12, 6, GR.GRAVEL);
  building(m, { id: 'kowalski', name: 'Kowalski Moving', x: 34, y: 6, w: 8, h: 6, roof: '#8b6b2f' });
  addDoor(m, 'kow_door', 41, 9, npcDoorRec(), 'Office Door', true);
  for (let cx = 29; cx <= 42; cx++) m.setSolid(cx, 18, SO.FENCE);
  for (let cy = 12; cy <= 18; cy++) { m.setSolid(29, cy, SO.FENCE); if (cy !== 14 && cy !== 15) m.setSolid(42, cy, SO.FENCE); }
  m.fillSolid(33, 13, 3, 2, SO.LOGS); m.decor.push({ kind: 'logs', x: 33, y: 13, w: 3, h: 2 });
  m.fillSolid(31, 16, 2, 1, SO.FURN); m.decor.push({ kind: 'crate', x: 31, y: 16, w: 2, h: 1 });
  m.fillSolid(38, 16, 2, 1, SO.FURN); m.decor.push({ kind: 'crate', x: 38, y: 16, w: 2, h: 1 });
  m.setSolid(42, 11, SO.FURN); m.decor.push({ kind: 'board', x: 42, y: 11, w: 1, h: 1 });
  addProp(m, { id: 'jobboard', kind: 'jobboard', x: 43.4 * TILE, y: 11.5 * TILE, label: 'Job Board', r: 44 });
  addProp(m, { id: 'logdrop', kind: 'logdrop', x: 34.5 * TILE, y: 15.6 * TILE, label: 'Firewood Drop-off', r: 54 });
  addProp(m, { id: 'shed', kind: 'shed', x: 32 * TILE, y: 15.4 * TILE, label: 'Supply Crates', r: 46 });

  // Duck pond in the park
  for (let cy = 3; cy <= 8; cy++) for (let cx = 2; cx <= 8; cx++) { const dx = (cx - 5) / 3.4, dy = (cy - 5.5) / 2.6; if (dx * dx + dy * dy < 1) { m.setGround(cx, cy, GR.WATER); m.setSolid(cx, cy, SO.WATER); } }

  // Park gazebo in the woods
  m.fillGround(10, 7, 8, 6, GR.DIRT);
  m.fillSolid(13, 9, 2, 2, SO.FURN); m.decor.push({ kind: 'gazebo', x: 13, y: 9, w: 2, h: 2 });

  // Rocks for cover
  [[14, 36], [34, 41], [3, 43], [12, 44], [46, 34], [52, 38], [58, 33], [27, 45]].forEach(([cx, cy]) => m.setSolid(cx, cy, SO.ROCK));

  const clear = [
    [0, 27, 63, 32], [16, 32, 31, 46], [30, 31, 34, 39], [3, 32, 13, 41], [35, 32, 43, 42], [17, 18, 27, 28], [5, 19, 14, 28], [29, 19, 38, 28],
    [42, 0, 63, 27], [28, 5, 42, 19], [10, 7, 17, 12], [22, 44, 26, 47], [0, 44, 3, 47], [59, 44, 63, 47], [15, 21, 16, 23],
  ];
  const avoid = (cx, cy) => clear.some((r) => rectHas(r, cx, cy));
  scatterTrees(m, rnd, 0, 0, 41, 18, 0.3, avoid);
  scatterTrees(m, rnd, 0, 32, W - 1, H - 1, 0.18, avoid);
  scatterTrees(m, rnd, 0, 19, 43, 27, 0.08, avoid);
  [[15, 25], [28, 24], [3, 37], [44, 37], [50, 41], [60, 38]].forEach(([cx, cy]) => addTree(m, cx, cy, 'oak'));

  m.spawns = {
    west: { ...P(0.5, 29.5), label: 'the west end of Larch Street' },
    east: { ...P(63.5, 29.5), label: 'the east end of Larch Street' },
    north: { ...P(44.5, 0.5), label: 'Main Street' },
    south: { ...P(24.5, 47.5), label: 'the woods behind the house' },
    southwest: { ...P(1.5, 46), label: 'the south-west treeline' },
    southeast: { ...P(61, 46), label: 'the south-east lots' },
  };
  m.points = {
    start: P(30.5, 37), arrive: P(30.5, 37), car: P(30.4, 35.5),
    cabin_in: P(24.5, 36.5), porch: P(24.5, 32.4), cabin_front: P(24.5, 32.2),
    marcus_yard: P(14, 25.5), marcus_porch: P(22.5, 28.5), marcus_in: P(22.5, 23.5),
    rosa_store: P(51.6, 11.8), rosa_home: P(9.5, 23.5), rosa_porch: P(9.5, 28.5),
    pete_yard: P(37.5, 14.6), pete_home: P(33.5, 23.5), pete_porch: P(33.5, 28.5),
    stranger: P(46.5, 17), store_door: P(46.4, 12.5), recovery: P(22.5, 23.5),
    footprints: P(17.3, 37.5), strange_car: P(10, 29.5), woodlot: P(8, 8), ruth_porch: P(22.5, 28.5),
    walk_a: P(10, 28.4), walk_b: P(40, 31.4), walk_c: P(46.5, 6), walk_d: P(46.5, 24), walk_e: P(56, 28.4), walk_f: P(30, 31.4),
    ruth_c_day: P(21.5, 44.5), ruth_c_eve: P(24.5, 42.5), ruth_c_home: P(25.4, 45.4),
  };
  m.deliveryTargets = {
    post: { name: 'the Post Office', ...P(46.4, 21.5) },
    library: { name: 'the Library', ...P(58.5, 26.4) },
    hendricks: { name: 'the Hendricks house', ...P(7.5, 32.3) },
    ortiz: { name: 'the Ortiz house', ...P(39.5, 32.3) },
  };
  m.repairTargets = {
    gazebo: { name: 'the park gazebo', ...P(13.9, 11.5) },
    ortiz_fence: { name: "the Ortiz family's fence", ...P(39.5, 41.4) },
    post_box: { name: 'the post office drop box', ...P(46.5, 24.6) },
    library_rail: { name: 'the library railing', ...P(60.5, 26.4) },
  };
  m.discover = [
    { id: 'larch', name: 'Larch Street', ...P(24, 30), r: 200 },
    { id: 'downtown', name: 'Downtown Millbrook', ...P(45, 14), r: 160 },
    { id: 'hardware', name: 'Delgado Hardware', ...P(51, 12), r: 110 },
    { id: 'kowalski', name: 'Kowalski Moving', ...P(36, 13), r: 140 },
    { id: 'park', name: 'Millbrook Park', ...P(14, 10), r: 140 },
  ];
  m.lights = [];
  for (let cx = 4; cx < 64; cx += 8) { m.lights.push({ x: cx * TILE, y: 28 * TILE, r: 120, street: true }); m.lights.push({ x: (cx + 4) * TILE, y: 31.9 * TILE, r: 120, street: true }); }
  for (let cy = 4; cy < 28; cy += 8) { m.lights.push({ x: 43 * TILE, y: cy * TILE, r: 120, street: true }); m.lights.push({ x: 46.9 * TILE, y: (cy + 4) * TILE, r: 120, street: true }); }
  for (const b of m.buildings) m.lights.push({ x: (b.x + b.w / 2) * TILE, y: (b.y + b.h / 2) * TILE, r: Math.max(b.w, b.h) * 16, building: b.id });
  m.homeInfo = {
    building: 'house', interior: { cx: 24, cy: 37 }, allyPost: P(21.5, 34.5),
    flood: { x: 24.5 * TILE, y: 32.6 * TILE, r: 270 }, porch: { x: 24.5 * TILE, y: 32 * TILE, r: 95 },
  };
  return m;
}

/* ------------------------------------------------------------------ */
/*  CHAPTER 3: THE WISCONSIN FARM + Kettle Crossing                    */
/* ------------------------------------------------------------------ */
export function buildFarmMap(home) {
  const W = 76, H = 54;
  const m = new GameMap('farm', W, H, 'Kettle Crossing');
  const rnd = seeded(5150);
  m.cropsPickable = true;

  // County road, town road and the long farm driveway
  m.fillGround(0, 2, W, 2, GR.ROAD);
  m.fillGround(59, 4, 2, 27, GR.ROAD);
  m.fillGround(20, 4, 2, 15, GR.DIRT);
  m.fillGround(22, 14, 3, 5, GR.GRAVEL);

  // Farmyard fence with a gate on the driveway and a cattle crossing to the south
  for (let cx = 6; cx <= 40; cx++) { if (cx !== 20 && cx !== 21) m.setSolid(cx, 12, SO.FENCE); if (cx < 30 || cx > 32) m.setSolid(cx, 41, SO.FENCE); }
  for (let cy = 12; cy <= 41; cy++) { m.setSolid(6, cy, SO.FENCE); m.setSolid(40, cy, SO.FENCE); }
  const o = home.openings;
  addDoor(m, 'gate_l', 20, 12, o.gate_l, 'Farm Gate (left)');
  addDoor(m, 'gate_r', 21, 12, o.gate_r, 'Farm Gate (right)');
  m.setGround(20, 12, GR.DIRT); m.setGround(21, 12, GR.DIRT);

  // Farmhouse
  building(m, { id: 'farmhouse', name: 'Farmhouse', x: 14, y: 20, w: 13, h: 10, roof: '#6a3a2a', isHome: true });
  addDoor(m, 'front_door', 20, 20, o.front_door, 'Front Door');
  addDoor(m, 'back_door', 20, 29, o.back_door, 'Back Door');
  addWindow(m, 'win_n1', 16, 20, o.win_n1, 'Front-Left Window');
  addWindow(m, 'win_n2', 24, 20, o.win_n2, 'Front-Right Window');
  addWindow(m, 'win_w', 14, 24, o.win_w, 'West Window', true);
  addWindow(m, 'win_e', 26, 24, o.win_e, 'East Window', true);
  addWindow(m, 'win_s', 24, 29, o.win_s, 'Back Window');
  m.fillGround(17, 19, 7, 1, GR.PORCH);
  m.fillSolid(15, 21, 2, 2, SO.FURN); m.decor.push({ kind: 'bed', x: 15, y: 21, w: 2, h: 2 });
  m.fillSolid(23, 21, 2, 1, SO.FURN); m.decor.push({ kind: 'stove', x: 23, y: 21, w: 2, h: 1 });
  m.fillSolid(18, 24, 3, 2, SO.FURN); m.decor.push({ kind: 'table', x: 18, y: 24, w: 3, h: 2 });
  m.fillSolid(25, 26, 1, 2, SO.FURN); m.decor.push({ kind: 'workbench', x: 25, y: 26, w: 1, h: 2 });
  m.decor.push({ kind: 'rug', x: 16, y: 26, w: 3, h: 2 });
  m.decor.push({ kind: 'phone', x: 21, y: 21, w: 1, h: 1 });
  addProp(m, { id: 'bed', kind: 'bed', x: 16 * TILE, y: 23.4 * TILE, label: 'Bed', r: 40 });
  addProp(m, { id: 'workbench', kind: 'workbench', x: 24.6 * TILE, y: 27 * TILE, label: 'Workbench', r: 40 });
  addProp(m, { id: 'phone', kind: 'phone', x: 21.5 * TILE, y: 21.5 * TILE, label: 'Telephone', r: 40 });
  addProp(m, { id: 'stove', kind: 'stove', x: 24 * TILE, y: 22.5 * TILE, label: 'Stove', r: 40 });

  // Car, mailbox, phone pole
  m.fillSolid(22, 15, 2, 3, SO.CAR);
  addProp(m, { id: 'car', kind: 'car', x: 23 * TILE, y: 16.5 * TILE, label: 'Your Car', r: 64 });
  m.setSolid(19, 4, SO.FURN); m.decor.push({ kind: 'mailbox', x: 19, y: 4, w: 1, h: 1 });
  addProp(m, { id: 'mailbox', kind: 'mailbox', x: 19.5 * TILE, y: 4.5 * TILE, label: 'Mailbox', r: 40 });
  m.setSolid(17, 4, SO.WALL); m.decor.push({ kind: 'pole', x: 17, y: 4, w: 1, h: 1 });
  addProp(m, { id: 'phonepole', kind: 'phonepole', x: 17.5 * TILE, y: 4.5 * TILE, label: 'Phone Line', r: 48 });

  // Barn, silo, tractor, windmill, camper
  building(m, { id: 'barn', name: 'Barn', x: 30, y: 15, w: 9, h: 10, roof: '#8f2f24' });
  addDoor(m, 'barn_door', 34, 24, npcDoorRec(), 'Barn Door');
  m.fillGround(31, 16, 7, 8, GR.DIRT);
  m.fillSolid(31, 16, 2, 2, SO.LOGS); m.decor.push({ kind: 'hay', x: 31, y: 16, w: 2, h: 2 });
  m.fillSolid(36, 20, 2, 2, SO.LOGS); m.decor.push({ kind: 'hay', x: 36, y: 20, w: 2, h: 2 });
  m.fillSolid(37, 13, 2, 2, SO.ROCK); m.decor.push({ kind: 'silo', x: 37, y: 13, w: 2, h: 2 });
  m.fillSolid(35, 26, 2, 2, SO.CAR); m.decor.push({ kind: 'tractor', x: 35, y: 26, w: 2, h: 2 });
  m.setSolid(12, 17, SO.WALL); m.decor.push({ kind: 'windmill', x: 12, y: 17, w: 1, h: 1 });
  m.fillSolid(8, 14, 3, 2, SO.CAR); m.decor.push({ kind: 'camper', x: 8, y: 14, w: 3, h: 2 });
  m.fillSolid(9, 21, 1, 3, SO.LOGS); m.decor.push({ kind: 'logs', x: 9, y: 21, w: 1, h: 3 });

  // Crop fields (pickable vegetables)
  m.fillGround(7, 30, 6, 10, GR.GARDEN);
  m.fillGround(28, 29, 11, 9, GR.GARDEN);

  // Pond east of the fence
  for (let cy = 29; cy <= 40; cy++) for (let cx = 42; cx <= 55; cx++) {
    const dx = (cx - 48.5) / 6, dy = (cy - 34.5) / 4.6;
    if (dx * dx + dy * dy < 1) { m.setGround(cx, cy, GR.WATER); m.setSolid(cx, cy, SO.WATER); }
  }

  // Ingrid Haugen's dairy
  building(m, { id: 'ingrid_house', name: 'Haugen Dairy', x: 44, y: 17, w: 8, h: 8, roof: '#5a6b3d' });
  addDoor(m, 'ingrid_door', 47, 24, npcDoorRec(), "Ingrid's Door");
  addWindow(m, 'ingrid_w1', 45, 24, npcWinRec(), 'Window');
  addWindow(m, 'ingrid_w2', 50, 24, npcWinRec(), 'Window');
  for (let cx = 53; cx <= 57; cx++) { m.setSolid(cx, 17, SO.FENCE); m.setSolid(cx, 27, SO.FENCE); }
  for (let cy = 17; cy <= 27; cy++) { m.setSolid(53, cy, SO.FENCE); m.setSolid(57, cy, SO.FENCE); }
  m.decor.push({ kind: 'cows', x: 54, y: 18, w: 3, h: 9 });
  for (const [cx, cy] of [[54, 19], [55, 22], [54, 25]]) m.setSolid(cx, cy, SO.FURN);

  // Kettle Crossing: grain co-op
  building(m, { id: 'coop', name: 'Grain Co-op', x: 47, y: 5, w: 8, h: 6, roof: '#8b6b2f' });
  addDoor(m, 'coop_door', 50, 10, npcDoorRec(), 'Co-op Door');
  m.fillGround(46, 11, 11, 5, GR.GRAVEL);
  m.fillSolid(54, 12, 2, 2, SO.FURN); m.decor.push({ kind: 'crate', x: 54, y: 12, w: 2, h: 2 });
  m.fillSolid(47, 14, 2, 1, SO.FURN); m.decor.push({ kind: 'crate', x: 47, y: 14, w: 2, h: 1 });
  m.setSolid(52, 4, SO.FURN); m.decor.push({ kind: 'board', x: 52, y: 4, w: 1, h: 1 });
  addProp(m, { id: 'jobboard', kind: 'jobboard', x: 52.5 * TILE, y: 3.7 * TILE, label: 'Job Board', r: 46 });
  addProp(m, { id: 'logdrop', kind: 'logdrop', x: 53 * TILE, y: 12.6 * TILE, label: 'Co-op Drop-off', r: 54 });
  addProp(m, { id: 'shed', kind: 'shed', x: 48 * TILE, y: 13.4 * TILE, label: 'Supply Crates', r: 46 });
  // Lindqvist Feed & Supply
  building(m, { id: 'feedstore', name: 'Lindqvist Feed', x: 62, y: 5, w: 10, h: 8, roof: '#2f5d7a', floor: GR.TILEFLOOR, shop: 'bo' });
  addDoor(m, 'feed_door', 62, 8, npcDoorRec(), 'Store Door', true);
  addWindow(m, 'feed_w1', 62, 6, npcWinRec(), 'Window', true);
  addWindow(m, 'feed_w2', 62, 11, npcWinRec(), 'Window', true);
  m.fillSolid(65, 6, 1, 5, SO.COUNTER); m.decor.push({ kind: 'counter', x: 65, y: 6, w: 1, h: 5 });
  m.fillSolid(70, 6, 1, 6, SO.FURN); m.decor.push({ kind: 'shelf', x: 70, y: 6, w: 1, h: 6 });
  addProp(m, { id: 'store_counter', kind: 'counter', x: 64.3 * TILE, y: 8.5 * TILE, label: 'Store Counter', r: 44 });
  // Sheriff substation, cafe, houses
  building(m, { id: 'sheriff', name: 'Sheriff Substation', x: 62, y: 15, w: 7, h: 6, roof: '#3b3b4a' });
  addDoor(m, 'sheriff_door', 62, 17, npcDoorRec(), 'Substation Door', true);
  building(m, { id: 'cafe', name: 'Crossroads Cafe', x: 63, y: 23, w: 9, h: 7, roof: '#8a3b3b', floor: GR.TILEFLOOR });
  addDoor(m, 'cafe_door', 63, 26, npcDoorRec(), 'Cafe Door', true);
  addWindow(m, 'cafe_w', 63, 24, npcWinRec(), 'Window', true);
  building(m, { id: 'bo_house', name: 'Lindqvist House', x: 64, y: 33, w: 6, h: 6, roof: '#6a5a8a' });
  addDoor(m, 'bo_door', 66, 33, npcDoorRec(), "Bo's Door");
  building(m, { id: 'tess_house', name: 'Albright House', x: 70, y: 33, w: 6, h: 6, roof: '#a0663c' });
  addDoor(m, 'tess_door', 72, 33, npcDoorRec(), "Tess's Door");

  // Rocks
  [[28, 8], [10, 8], [36, 45], [5, 44], [44, 12], [58, 40], [26, 35], [13, 42]].forEach(([cx, cy]) => m.setSolid(cx, cy, SO.ROCK));

  // Trees
  const clear = [
    [0, 1, 75, 4], [6, 12, 40, 41], [19, 4, 22, 12], [41, 16, 58, 40], [44, 4, 75, 39], [29, 41, 33, 44],
    [22, 50, 26, 53], [0, 49, 3, 53], [72, 49, 75, 53], [0, 28, 1, 32],
  ];
  const avoid = (cx, cy) => clear.some((r) => rectHas(r, cx, cy));
  scatterTrees(m, rnd, 0, 42, W - 1, H - 1, 0.32, avoid);
  scatterTrees(m, rnd, 0, 4, 5, 41, 0.3, avoid);
  scatterTrees(m, rnd, 0, 0, W - 1, 1, 0.25, avoid);
  scatterTrees(m, rnd, 22, 4, 43, 11, 0.12, avoid);
  scatterTrees(m, rnd, 41, 40, 75, 48, 0.2, avoid);
  [[8, 26], [27, 14], [38, 39], [13, 13]].forEach(([cx, cy]) => addTree(m, cx, cy, 'oak'));

  m.spawns = {
    west: { ...P(0.5, 2.5), label: 'the county road to the west' },
    east: { ...P(75.5, 2.5), label: 'the county road to the east' },
    south: { ...P(24.5, 53.5), label: 'the south woods' },
    southwest: { ...P(1.5, 51), label: 'the south-west treeline' },
    southeast: { ...P(74, 51), label: 'the east pasture' },
    westfield: { ...P(0.5, 30), label: 'the west windbreak' },
  };
  m.points = {
    start: P(21.4, 17.5), arrive: P(21.4, 17.5), car: P(21.4, 16.5),
    cabin_in: P(20.5, 25), porch: P(20.5, 18.5), cabin_front: P(20.5, 18.6), gate: P(21, 12.5),
    ingrid_yard: P(48.5, 27), ingrid_porch: P(47.5, 25.5), ingrid_in: P(47.5, 20.5),
    bo_store: P(66.6, 8.5), bo_home: P(66.5, 35.5), bo_porch: P(66.5, 32.4),
    tess_yard: P(51.5, 13.4), tess_home: P(72.5, 35.5), tess_porch: P(72.5, 32.4),
    store_door: P(61.4, 8.5), stranger: P(61.5, 13.6), deputy: P(20.5, 17.6), garden: P(10, 35), recovery: P(47.5, 20.5),
    footprints: P(13.3, 24.5), strange_car: P(30, 2.5), woodlot: P(24, 46),
    ruth_c_day: P(9.5, 29.2), ruth_c_eve: P(18.5, 18.6), ruth_c_home: P(11.6, 15),
    walk_a: P(58.4, 6), walk_b: P(58.4, 22), walk_c: P(61.6, 31), walk_d: P(44, 4.5),
  };
  m.deliveryTargets = {
    cafe: { name: 'the Crossroads Cafe', ...P(62.3, 26.5) },
    sheriff: { name: 'the sheriff substation', ...P(61.4, 17.5) },
    ingrid: { name: 'the Haugen dairy', ...P(47.5, 25.5) },
    bo_house: { name: 'the Lindqvist house', ...P(66.5, 32.3) },
  };
  m.repairTargets = {
    tractor: { name: 'your old tractor', ...P(37.5, 27) },
    windmill: { name: 'the windmill pump', ...P(12.5, 18.4) },
    scale: { name: 'the co-op truck scale', ...P(56.4, 14.5) },
    cafe_sign: { name: 'the cafe sign', ...P(62.3, 29.4) },
  };
  m.discover = [
    { id: 'farm', name: 'The Farm', ...P(20, 25), r: 200 },
    { id: 'barn', name: 'The Barn', ...P(34, 20), r: 120 },
    { id: 'farmpond', name: 'Cattail Pond', ...P(48, 34), r: 150 },
    { id: 'crossing', name: 'Kettle Crossing', ...P(60, 14), r: 180 },
    { id: 'dairy', name: 'Haugen Dairy', ...P(48, 21), r: 130 },
  ];
  m.lights = [
    { x: 19 * TILE, y: 13.5 * TILE, r: 140 }, { x: 33 * TILE, y: 26 * TILE, r: 120 }, { x: 11 * TILE, y: 28 * TILE, r: 110 },
  ];
  for (let cy = 5; cy < 31; cy += 7) { m.lights.push({ x: 58 * TILE, y: cy * TILE, r: 120, street: true }); m.lights.push({ x: 61.9 * TILE, y: (cy + 3) * TILE, r: 120, street: true }); }
  for (const b of m.buildings) m.lights.push({ x: (b.x + b.w / 2) * TILE, y: (b.y + b.h / 2) * TILE, r: Math.max(b.w, b.h) * 16, building: b.id });
  m.homeInfo = {
    building: 'farmhouse', interior: { cx: 20, cy: 25 }, allyPost: P(16.5, 21.5), gate: { cx: 21, cy: 12 },
    flood: { x: 20.5 * TILE, y: 18.4 * TILE, r: 300 }, porch: { x: 20.5 * TILE, y: 19.2 * TILE, r: 95 },
  };
  return m;
}

/* ------------------------------------------------------------------ */
/* Chapter 4: Whitcombe Estate, Lake Champlain                         */
/* ------------------------------------------------------------------ */
export function buildEstateMap(home) {
  const W = 80, H = 60;
  const m = new GameMap('estate', W, H, 'Port Whitcombe');
  const rnd = seeded(4404);
  m.cropsPickable = true;
  m.stone = new Set();
  m.hedge = new Set();
  const stone = (cx, cy) => { m.setSolid(cx, cy, SO.WALL); m.stone.add(m.idx(cx, cy)); };
  const hedge = (cx, cy) => { m.setSolid(cx, cy, SO.FENCE); m.hedge.add(m.idx(cx, cy)); };

  // Lake Champlain along the east; a sandy shore.
  for (let cy = 0; cy < H; cy++) {
    const shore = 61 + Math.round(Math.sin(cy * 0.35) * 1.2);
    for (let cx = shore; cx < W; cx++) { m.setGround(cx, cy, GR.WATER); m.setSolid(cx, cy, SO.WATER); }
    for (let cx = shore - 3; cx < shore; cx++) m.setGround(cx, cy, GR.DIRT);
  }
  // Roads: county road north, lane west, village road south.
  m.fillGround(0, 2, 60, 2, GR.ROAD);
  m.fillGround(7, 4, 2, 47, GR.ROAD);
  m.fillGround(0, 50, 60, 2, GR.ROAD);
  // Estate drive with a turning circle.
  m.fillGround(33, 4, 2, 15, GR.GRAVEL);
  m.fillGround(29, 12, 10, 6, GR.GRAVEL);
  m.fillSolid(32, 13, 4, 4, SO.ROCK); m.decor.push({ kind: 'fountain', x: 32, y: 13, w: 4, h: 4 });

  // Stone wall with an iron gate on the drive, a garden gate south, open to the lake on the east lawn.
  for (let cx = 12; cx <= 56; cx++) { if (cx !== 33 && cx !== 34) stone(cx, 10); if (cx !== 30) stone(cx, 46); }
  for (let cy = 10; cy <= 46; cy++) { stone(12, cy); if (cy < 25 || cy > 31) stone(56, cy); }
  const o = home.openings;
  addDoor(m, 'gate_l', 33, 10, o.gate_l, 'Iron Gate (left)');
  addDoor(m, 'gate_r', 34, 10, o.gate_r, 'Iron Gate (right)');
  addDoor(m, 'garden_gate', 30, 46, o.garden_gate, 'Garden Gate');
  for (const c of [33, 34]) m.setGround(c, 10, GR.GRAVEL);

  // The manor.
  building(m, { id: 'manor', name: 'Whitcombe Manor', x: 24, y: 19, w: 20, h: 13, roof: '#2d2a33', isHome: true });
  for (let cy = 20; cy <= 30; cy++) if (cy < 24 || cy > 26) m.setSolid(33, cy, SO.WALL); // central hall wall
  for (let cx = 25; cx <= 32; cx++) if (cx !== 28 && cx !== 29) m.setSolid(cx, 25, SO.WALL); // west wing rooms
  addDoor(m, 'front_l', 33, 19, o.front_l, 'Front Doors (left)');
  addDoor(m, 'front_r', 34, 19, o.front_r, 'Front Doors (right)');
  addDoor(m, 'terrace_door', 34, 31, o.terrace_door, 'Terrace Door');
  addDoor(m, 'west_door', 24, 28, o.west_door, 'West Door', true);
  addDoor(m, 'east_door', 43, 25, o.east_door, 'East Door', true);
  addWindow(m, 'win_n1', 27, 19, o.win_n1, 'Library Window');
  addWindow(m, 'win_n2', 30, 19, o.win_n2, 'Study Window');
  addWindow(m, 'win_n3', 37, 19, o.win_n3, 'Parlor Window');
  addWindow(m, 'win_n4', 40, 19, o.win_n4, 'Dining Window');
  addWindow(m, 'win_s1', 28, 31, o.win_s1, 'Bedroom Window');
  addWindow(m, 'win_s2', 39, 31, o.win_s2, 'Kitchen Window');
  addWindow(m, 'win_w', 24, 22, o.win_w, 'West Window', true);
  addWindow(m, 'win_e', 43, 29, o.win_e, 'East Window', true);
  m.fillGround(29, 32, 11, 2, GR.PORCH); // terrace
  m.fillGround(31, 18, 6, 1, GR.PORCH); // front steps
  // Furniture
  m.fillSolid(25, 26, 2, 2, SO.FURN); m.decor.push({ kind: 'bed', x: 25, y: 26, w: 2, h: 2 });
  addProp(m, { id: 'bed', kind: 'bed', x: 27.6 * TILE, y: 28.2 * TILE, label: 'Bed', r: 44 });
  m.fillSolid(40, 26, 3, 1, SO.FURN); m.decor.push({ kind: 'stove', x: 40, y: 26, w: 3, h: 1 });
  addProp(m, { id: 'stove', kind: 'stove', x: 41.5 * TILE, y: 27.5 * TILE, label: 'Stove', r: 44 });
  m.fillSolid(42, 20, 1, 3, SO.FURN); m.decor.push({ kind: 'workbench', x: 42, y: 20, w: 1, h: 3 });
  addProp(m, { id: 'workbench', kind: 'workbench', x: 41.3 * TILE, y: 21.5 * TILE, label: 'Workbench', r: 42 });
  m.fillSolid(36, 21, 4, 2, SO.FURN); m.decor.push({ kind: 'table', x: 36, y: 21, w: 4, h: 2 });
  m.fillSolid(25, 20, 1, 4, SO.FURN); m.decor.push({ kind: 'shelf', x: 25, y: 20, w: 1, h: 4 });
  m.decor.push({ kind: 'rug', x: 29, y: 21, w: 3, h: 2 }, { kind: 'rug', x: 35, y: 27, w: 4, h: 2 });
  m.decor.push({ kind: 'phone', x: 32, y: 20, w: 1, h: 1 });
  addProp(m, { id: 'phone', kind: 'phone', x: 32.5 * TILE, y: 20.6 * TILE, label: 'Telephone', r: 40 });

  // Car, mailbox, phone pole
  m.fillSolid(36, 14, 2, 3, SO.CAR);
  addProp(m, { id: 'car', kind: 'car', x: 37 * TILE, y: 15.5 * TILE, label: 'Your Car', r: 64 });
  m.setSolid(31, 4, SO.FURN); m.decor.push({ kind: 'mailbox', x: 31, y: 4, w: 1, h: 1 });
  addProp(m, { id: 'mailbox', kind: 'mailbox', x: 31.5 * TILE, y: 4.6 * TILE, label: 'Mailbox', r: 40 });
  m.setSolid(29, 4, SO.WALL); m.decor.push({ kind: 'pole', x: 29, y: 4, w: 1, h: 1 });
  addProp(m, { id: 'phonepole', kind: 'phonepole', x: 29.5 * TILE, y: 4.6 * TILE, label: 'Phone Line', r: 48 });

  // Formal gardens: hedge rows, a gazebo, the kitchen garden.
  for (let cx = 16; cx <= 52; cx++) if (cx < 29 || cx > 31) { if (cx % 9 !== 0) hedge(cx, 37); if (cx % 9 !== 4) hedge(cx, 42); }
  m.fillSolid(19, 39, 3, 2, SO.FURN); m.decor.push({ kind: 'gazebo', x: 19, y: 39, w: 3, h: 2 });
  m.fillGround(46, 38, 8, 4, GR.GARDEN);
  m.fillGround(29, 34, 3, 12, GR.GRAVEL);
  // Greenhouse
  building(m, { id: 'greenhouse', name: 'Greenhouse', x: 46, y: 13, w: 8, h: 6, roof: 'rgba(170,220,210,0.55)', floor: GR.TILEFLOOR });
  addDoor(m, 'gh_door', 49, 18, npcDoorRec(), 'Greenhouse Door');
  m.fillGround(47, 14, 6, 4, GR.GARDEN);
  // Statues along the drive
  for (const [cx, cy] of [[31, 7], [36, 7]]) { m.setSolid(cx, cy, SO.ROCK); m.decor.push({ kind: 'statue', x: cx, y: cy, w: 1, h: 1 }); }

  // Lake lawn, dock and boathouse
  m.fillGround(57, 27, 9, 3, GR.PORCH);
  for (let cx = 61; cx <= 65; cx++) for (let cy = 27; cy <= 29; cy++) m.setSolid(cx, cy, SO.NONE);
  m.decor.push({ kind: 'boat', x: 63, y: 30, w: 3, h: 1 });
  building(m, { id: 'boathouse', name: 'Boathouse', x: 55, y: 34, w: 5, h: 5, roof: '#4a3a2a' });
  for (let cy = 34; cy <= 38; cy++) m.stone.delete(m.idx(56, cy));
  addDoor(m, 'bh_door', 57, 34, npcDoorRec(), 'Boathouse Door');

  // Eleanor's gatehouse
  building(m, { id: 'gatehouse', name: 'The Gatehouse', x: 20, y: 5, w: 7, h: 5, roof: '#3a3346' });
  addDoor(m, 'eleanor_door', 26, 7, npcDoorRec(), "Eleanor's Door", true);
  addWindow(m, 'gh_w1', 22, 9, npcWinRec(), 'Window');

  // Port Whitcombe village
  building(m, { id: 'marina', name: 'Park\'s Marina & Provisions', x: 46, y: 53, w: 10, h: 6, roof: '#1f4f6a', floor: GR.TILEFLOOR, shop: 'theo' });
  addDoor(m, 'marina_door', 50, 53, npcDoorRec(), 'Store Door');
  addWindow(m, 'marina_w', 53, 53, npcWinRec(), 'Window');
  m.fillSolid(47, 55, 6, 1, SO.COUNTER); m.decor.push({ kind: 'counter', x: 47, y: 55, w: 6, h: 1 });
  m.fillSolid(47, 57, 7, 1, SO.FURN); m.decor.push({ kind: 'shelf', x: 47, y: 57, w: 7, h: 1 });
  addProp(m, { id: 'store_counter', kind: 'counter', x: 50 * TILE, y: 54.3 * TILE, label: 'Store Counter', r: 44 });
  m.fillGround(56, 54, 6, 2, GR.PORCH);
  for (let cx = 57; cx <= 63; cx++) for (let cy = 54; cy <= 55; cy++) if (m.getSolid(cx, cy) === SO.WATER) { m.setSolid(cx, cy, SO.NONE); m.setGround(cx, cy, GR.PORCH); }
  m.decor.push({ kind: 'boat', x: 59, y: 56, w: 3, h: 1 });
  building(m, { id: 'yacht', name: 'Point Yacht Club', x: 30, y: 53, w: 10, h: 6, roof: '#e8e2d4', floor: GR.TILEFLOOR });
  addDoor(m, 'yacht_door', 34, 53, npcDoorRec(), 'Club Door');
  m.setSolid(37, 52, SO.FURN); m.decor.push({ kind: 'board', x: 37, y: 52, w: 1, h: 1 });
  addProp(m, { id: 'jobboard', kind: 'jobboard', x: 37.5 * TILE, y: 51.5 * TILE, label: 'Job Board', r: 46 });
  addProp(m, { id: 'logdrop', kind: 'logdrop', x: 42.5 * TILE, y: 52.6 * TILE, label: 'Club Drop-off', r: 54 });
  addProp(m, { id: 'shed', kind: 'shed', x: 27.5 * TILE, y: 52.6 * TILE, label: 'Supply Crates', r: 46 });
  m.fillSolid(41, 53, 2, 2, SO.FURN); m.decor.push({ kind: 'crate', x: 41, y: 53, w: 2, h: 2 });
  building(m, { id: 'chapel', name: 'St. Brendan\'s', x: 18, y: 53, w: 7, h: 6, roof: '#5a5a62' });
  addDoor(m, 'chapel_door', 21, 53, npcDoorRec(), 'Chapel Door');
  building(m, { id: 'theo_house', name: 'Park House', x: 2, y: 53, w: 6, h: 5, roof: '#6a4a3a' });
  addDoor(m, 'theo_door', 4, 53, npcDoorRec(), "Theo's Door");
  building(m, { id: 'walt_house', name: 'Bishop Cottage', x: 10, y: 53, w: 6, h: 5, roof: '#4a5a3a' });
  addDoor(m, 'walt_door', 12, 53, npcDoorRec(), "Walt's Door");

  // Trees: west woods, the strip between wall and village, north of the road.
  const clear = [[0, 1, 60, 4], [6, 4, 9, 51], [12, 10, 56, 46], [0, 49, 62, 52], [0, 52, 62, 59], [19, 4, 27, 10], [28, 4, 39, 10], [56, 24, 62, 32]];
  const avoid = (cx, cy) => clear.some((r) => rectHas(r, cx, cy));
  scatterTrees(m, rnd, 0, 4, 11, 49, 0.34, avoid);
  scatterTrees(m, rnd, 12, 47, 58, 49, 0.3, avoid);
  scatterTrees(m, rnd, 0, 0, 59, 1, 0.3, avoid);
  scatterTrees(m, rnd, 40, 4, 58, 9, 0.18, avoid);
  scatterTrees(m, rnd, 13, 11, 22, 18, 0.12, avoid);
  [[15, 33], [50, 30], [45, 44], [16, 22], [52, 22]].forEach(([cx, cy]) => addTree(m, cx, cy, 'oak'));
  [[44, 6], [14, 48], [53, 11]].forEach(([cx, cy]) => m.setSolid(cx, cy, SO.ROCK));

  m.spawns = {
    west: { ...P(0.5, 2.5), label: 'the county road' },
    north: { ...P(52.5, 2.5), label: 'the north road' },
    westwoods: { ...P(0.5, 28), label: 'the west woods' },
    south: { ...P(0.5, 50.5), label: 'the village road' },
    lake: { ...P(64.5, 28.5), label: 'the lake — by boat' },
    shore: { ...P(59.5, 44.5), label: 'the south shore — by boat' },
  };
  m.points = {
    start: P(34, 17.5), arrive: P(34, 17.5), car: P(37, 17.6),
    cabin_in: P(34, 25), porch: P(34, 18.2), cabin_front: P(34, 18.2), gate: P(34, 10.6),
    eleanor_garden: P(24, 13), eleanor_porch: P(27.6, 7.5), eleanor_in: P(23, 7),
    theo_store: P(50, 56.3), theo_home: P(5, 55.5), theo_porch: P(4.5, 52.2),
    walt_yard: P(36, 51.6), walt_home: P(13, 55.5), walt_porch: P(12.5, 52.2),
    store_door: P(50.5, 52.2), stranger: P(44.5, 51.6), deputy: P(34, 17.6), reyes: P(59.5, 28.5),
    garden: P(48, 40), recovery: P(23, 7), footprints: P(22, 28.5), strange_car: P(42, 2.5), woodlot: P(5, 30),
    ruth_c_day: P(49.5, 39.5), ruth_c_eve: P(31.5, 33), ruth_c_home: P(41, 23.5),
    walk_a: P(20, 51.6), walk_b: P(44, 51.6), walk_c: P(8.5, 30), walk_d: P(56, 52.2),
  };
  m.deliveryTargets = {
    yacht: { name: 'the Point Yacht Club', ...P(34.5, 52.2) },
    chapel: { name: 'St. Brendan\'s chapel', ...P(21.5, 52.2) },
    gatehouse: { name: 'the gatehouse', ...P(27.6, 7.5) },
    walt: { name: 'Bishop Cottage', ...P(12.5, 52.2) },
  };
  m.repairTargets = {
    dock: { name: 'the estate dock', ...P(60, 29.6) },
    greenhouse: { name: 'the greenhouse vents', ...P(49.5, 19.4) },
    fountain: { name: 'the fountain pump', ...P(34, 17.6) },
    chapel_bell: { name: 'the chapel bell rope', ...P(21.5, 52.2) },
  };
  m.discover = [
    { id: 'estate', name: 'Whitcombe Estate', ...P(34, 25), r: 220 },
    { id: 'lake', name: 'Lake Champlain', ...P(60, 28), r: 150 },
    { id: 'portw', name: 'Port Whitcombe', ...P(34, 54), r: 200 },
    { id: 'gardens', name: 'The Formal Gardens', ...P(25, 40), r: 140 },
  ];
  m.lights = [
    { x: 33.5 * TILE, y: 11.5 * TILE, r: 150 }, { x: 34 * TILE, y: 33.5 * TILE, r: 140 }, { x: 59 * TILE, y: 28.5 * TILE, r: 130 },
    { x: 24 * TILE, y: 11.5 * TILE, r: 110 },
  ];
  for (let cx = 6; cx < 60; cx += 9) m.lights.push({ x: cx * TILE, y: 49.6 * TILE, r: 120, street: true });
  for (const b of m.buildings) m.lights.push({ x: (b.x + b.w / 2) * TILE, y: (b.y + b.h / 2) * TILE, r: Math.max(b.w, b.h) * 16, building: b.id });
  m.homeInfo = {
    building: 'manor', interior: { cx: 34, cy: 25 }, allyPost: P(36.5, 20.6), gate: { cx: 34, cy: 10 },
    flood: { x: 34 * TILE, y: 18 * TILE, r: 340 }, porch: { x: 34 * TILE, y: 18 * TILE, r: 110 },
  };
  return m;
}
