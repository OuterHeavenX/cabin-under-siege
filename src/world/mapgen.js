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
    building: 'cabin', interior: { cx: 24, cy: 22 },
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
    building: 'house', interior: { cx: 24, cy: 37 },
    flood: { x: 24.5 * TILE, y: 32.6 * TILE, r: 270 }, porch: { x: 24.5 * TILE, y: 32 * TILE, r: 95 },
  };
  return m;
}
