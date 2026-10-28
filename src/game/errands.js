// Errands: small multi-step tasks that the main story is built around —
// chores that make a house a home, and favors for the townsfolk who decide
// whether the newcomer is one of them. Each errand is a list of stages:
//   bring   — have N of an item, then talk to the giver (items are handed over)
//   buy     — buy N things of a kind at a shop
//   chop    — swing an axe N times at a spot
//   repair  — the hammer minigame at a spot (optionally costs wood)
//   visit   — walk up to a spot and press ACT (optional lines play)
//   find    — search one of several spots (picked at random)
//   return  — talk to the giver
//   talk    — talk to someone (npc), lines may hold a choice
//   wait    — come back later: { days } after this stage began, or { weekday, hour }
//   tail    — follow someone without being seen (see tail.js)
//   poker   — win a hand at poker night
//   hunt    — bring down N deer
//   fight   — confront people at a spot; done when they're down or gone
// Storylines ("arcs") chain errands: `requires` (earlier parts), `waitDays`
// after the last one, and `hours` when the giver will bring it up. Stages can
// have `hours` too. A choice in the lines sets the errand's `choice`, which
// picks the reward from `rewardBy`.
import { G } from './state.js';
import { TILE } from '../config.js';
import { NPCS, TOWNSFOLK } from '../data/npcs.js';
import { ITEMS } from '../data/items.js';
import { addItem, count, removeItem } from './inventory.js';
import { addJP, addMoney, addRel, addXP, derived } from './progression.js';
import { playDialogue } from '../ui/dialogue.js';
import { openRepairGame } from '../ui/menus.js';
import { banner, toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { choose } from '../util.js';
import { chapter } from './chapters.js';
import { hasSkill } from './state.js';
import { inHours, fmtWindow, weekday, WEEKDAYS } from './calendar.js';
import { grantPerk } from './perks.js';
import { startTail } from './tail.js';
import { spawnEnemy } from './enemies.js';
import { LATER_ARCS } from '../data/storylines.js';

const T = (x, y) => ({ x: x * TILE, y: y * TILE });
const FOOD = new Set(['sandwich', 'stew']);

export const ERRANDS = {
  /* ---------------- Chapter 1, act 1: settling in ---------------- */
  chore_logs: {
    chapter: 1, chore: true, giver: 'ruth', title: 'A Cold Night',
    desc: 'Ruth\'s wood stove is out and her hands are too stiff to swing an axe. Bring her 10 wood.',
    stages: [{ type: 'bring', item: 'wood', n: 10, label: 'Bring Ruth 10 wood (chop any tree)' }],
    done: [
      { who: 'Ruth Calloway', text: 'Ten good splits, stacked neat. Harold never stacked neat.' },
      { who: 'Ruth Calloway', text: 'Sit. There\'s stew. ...You eat like a man who\'s been running a long time, Frank.' },
    ],
    reward: { xp: 40, rel: ['ruth', 16], jp: ['neighbor', 8], items: { stew: 2, bandage: 2 } },
  },
  chore_door: {
    chapter: 1, chore: true, title: 'The Back Door Sticks',
    desc: 'The cabin\'s back door swells shut. Plane it down so it closes — and locks.',
    stages: [{ type: 'repair', map: 'cabin', at: [24.5, 18.1], hits: 3, label: 'Plane down the sticking back door (Toolkit)' }],
    done: [{ who: 'Frank', text: 'Closes clean, locks tight. Harold, you owe me one.' }],
    reward: { xp: 25, jp: ['handyman', 6] },
  },
  chore_roof: {
    chapter: 1, chore: true, title: 'Leaky Roof',
    desc: 'Rain gets in over the west wall. Patch it before the weather turns (4 wood).',
    stages: [{ type: 'repair', map: 'cabin', at: [21.5, 24.6], hits: 4, wood: 4, label: 'Patch the roof leak (Toolkit + 4 wood)' }],
    done: [{ who: 'Frank', text: 'No more bucket under the drip. Small victories.' }],
    reward: { xp: 30, jp: ['handyman', 8], items: { wood: 1 } },
  },
  chore_pantry: {
    chapter: 1, chore: true, title: 'Stock the Pantry',
    desc: 'The cupboards hold two cans of beans and a mouse. Buy groceries at Marsh General in Pine Hollow.',
    stages: [{ type: 'buy', what: 'food', n: 3, label: 'Buy 3 groceries at Marsh General' }],
    done: [{ who: 'Dee Marsh', text: 'Three bags of real food. Good. A man who stocks a pantry is planning to stay.' }],
    reward: { xp: 20, rel: ['dee', 8], jp: ['neighbor', 4] },
  },
  chore_drive: {
    chapter: 1, chore: true, title: 'Clear the Driveway',
    desc: 'Last night\'s wind dropped a pine across your driveway. Until it\'s gone, the car stays put — you\'ll have to walk to town.',
    stages: [{ type: 'chop', map: 'cabin', at: [24.5, 36.2], n: 6, label: 'Saw through the pine across the driveway' }],
    done: [{ who: 'Frank', text: 'Driveway\'s clear. And I\'ve got firewood for a week.' }],
    reward: { xp: 25, jp: ['survivor', 6], items: { wood: 3 } },
  },

  /* ---------------- Chapter 1, act 2: the townsfolk ---------------- */
  abe_pies: {
    chapter: 1, giver: 'folk2', title: 'The Bake Sale',
    desc: 'Pastor Abe\'s bake sale needs Dee\'s pies carried over to the chapel.',
    offer: [{ who: 'Pastor Abe', text: 'You\'re Frank! Welcome, welcome. Could I trouble you? Dee baked six pies for Sunday\'s sale and my back is a sinner.' }],
    stages: [
      { type: 'visit', map: 'town', at: [12.5, 16.4], label: 'Pick up the pie boxes at Marsh General', lines: [{ who: 'Dee Marsh', text: 'Pies for Abe? Don\'t you dare tip them. And the cherry one is spoken for. By me.' }] },
      { type: 'visit', map: 'town', at: [39.5, 18.6], label: 'Leave the pies at the chapel door' },
    ],
    done: [{ who: 'Pastor Abe', text: 'Bless you. I\'ll tell the congregation the newcomer has a good heart and strong arms. Both are rarer than you\'d think.' }],
    reward: { money: 20, xp: 30, rel: ['dee', 4], jp: ['neighbor', 8], items: { sandwich: 2 } },
  },
  jenny_cat: {
    chapter: 1, giver: 'folk3', title: 'Up a Tree',
    desc: 'Jenny Miller\'s cat, Mittens, bolted out the door and is stuck somewhere high.',
    offer: [{ who: 'Jenny Miller', text: 'Mister! Have you seen a fat orange cat? Mittens got out and she can climb up but never down. She\'s somewhere around town.' }],
    stages: [
      { type: 'find', map: 'town', spots: [[30.5, 6.5], [4.5, 33.5], [58.5, 13.5], [45.5, 37.5]], animal: 'cat', label: 'Find Mittens the cat' },
      { type: 'return', label: 'Bring Mittens back to Jenny Miller' },
    ],
    found: 'Mittens glares at you from a branch, then drops onto your shoulder like she planned it.',
    done: [{ who: 'Jenny Miller', text: 'MITTENS! Oh, thank you! Mom says you can come to dinner. She makes the best pot roast in the county. That\'s a fact.' }],
    reward: { money: 15, xp: 30, jp: ['neighbor', 6], items: { stew: 1 } },
  },
  henderson_fence: {
    chapter: 1, giver: 'folk1', title: 'Fence Mending',
    desc: 'Mr. Henderson\'s back fence is down and the neighbor\'s goats are eating his tomatoes.',
    offer: [{ who: 'Mr. Henderson', text: 'You the fella fixing up the Calloway cabin? Then you can swing a hammer. My back fence is down and those goats are a plague.' }],
    stages: [
      { type: 'repair', map: 'town', at: [56.5, 16.2], hits: 3, wood: 2, label: 'Mend Mr. Henderson\'s fence (Toolkit + 2 wood)' },
      { type: 'return', label: 'Tell Mr. Henderson his fence is fixed' },
    ],
    done: [{ who: 'Mr. Henderson', text: 'Goats foiled. Tomatoes saved. Here — my late wife\'s first-aid kit. Never needed it. You look like you might.' }],
    reward: { money: 20, xp: 30, jp: ['handyman', 6], items: { medkit: 1 } },
  },
  tibbs_wood: {
    chapter: 1, giver: 'folk11', title: 'Old Man Tibbs\'s Firewood',
    desc: 'Old Man Tibbs can\'t split his winter wood anymore. Ten good swings at his woodpile.',
    offer: [{ who: 'Old Man Tibbs', text: 'Eighty-eight years old and the woodpile still wants splitting. Ten swings, young man, and I\'ll tell you about Korea.' }],
    stages: [
      { type: 'chop', map: 'town', at: [31.5, 31.5], n: 10, label: 'Split Old Man Tibbs\'s firewood' },
      { type: 'return', label: 'Tell Old Man Tibbs the wood\'s split' },
    ],
    done: [
      { who: 'Old Man Tibbs', text: 'Clean splits. You\'ve done this before. ...Funny, you hold an axe like you were taught to hold something else.' },
      { who: 'Old Man Tibbs', text: 'Here. My old army shells — they still fire. Don\'t tell the sheriff.' },
    ],
    reward: { money: 10, xp: 35, jp: ['survivor', 8], items: { ammo: 16 } },
  },

  /* ---------------- Chapter 1, act 2: the watcher ---------------- */
  trail: {
    chapter: 1, story: true, title: 'Boot Prints',
    desc: 'Someone has been standing outside your window at night.',
    stages: [
      { type: 'visit', map: 'cabin', at: [19.5, 28.6], label: 'Examine the boot prints by the window', lines: [
        { who: 'Frank', text: 'Size twelve. City shoes, not boots — the heel\'s too narrow. He stood here a long time; the grass is flat.' },
        { who: 'Frank', text: 'The prints go north, into the woods. Toward the hill.' },
      ] },
      { type: 'visit', map: 'cabin', at: [9.5, 7.5], label: 'Follow the trail to the hill in the north woods', lines: [
        { who: 'Frank', text: 'A hunting blind. Somebody\'s been living rough up here. A thermos, a folding chair, binoculars pointed straight at my cabin.' },
        { who: 'Frank', text: 'Cigarette butts. Parliament. Somebody brought these all the way from Jersey.' },
        { who: 'Frank', text: '...Leo always liked Parliaments.' },
      ] },
    ],
    done: [],
    reward: { xp: 40, jp: ['shadow', 12] },
  },

  /* ---------------- Chapter 5, act 1: coming home ---------------- */
  ch5_lane: {
    chapter: 5, chore: true, title: 'The Overgrown Lane',
    desc: 'Nobody has driven up to the watch house in twenty years. A dead oak lies across the lane.',
    stages: [{ type: 'chop', map: 'shorthills', at: [56.5, 19.6], n: 6, label: 'Cut up the dead oak across the lane' }],
    done: [{ who: 'Frank', text: 'Lane\'s clear. From the porch you can see the lights of Leo\'s house across the ravine.' }],
    reward: { xp: 25, jp: ['survivor', 6], items: { wood: 4 } },
  },
  ch5_gen: {
    chapter: 5, chore: true, title: 'Dead Generator',
    desc: 'Edward Whitcombe kept a generator behind the watch house. It hasn\'t run since the nineties.',
    stages: [{ type: 'repair', map: 'shorthills', at: [49.5, 4.8], hits: 4, wood: 2, label: 'Get the old generator running (Toolkit + 2 wood)' }],
    done: [{ who: 'Frank', text: 'It coughs, it shudders, and the lights come on. If Leo cuts the power, he\'ll have to try harder.' }],
    reward: { xp: 30, jp: ['handyman', 8] },
  },
  ch5_pantry: {
    chapter: 5, chore: true, title: 'Groceries from Marchetti\'s',
    desc: 'The watch house has a fridge full of nothing. Angie Marchetti\'s deli is on Millburn Avenue.',
    stages: [{ type: 'buy', what: 'food', n: 3, shop: 'angie', label: 'Buy 3 groceries at Marchetti\'s' }],
    done: [{ who: 'Angie Marchetti', text: 'Three sandwiches. You always did eat like a man about to be arrested.' }],
    reward: { xp: 20, rel: ['angie', 8], jp: ['neighbor', 4] },
  },
  ch5_candle: {
    chapter: 5, chore: true, title: 'A Candle for Mom',
    desc: 'Rosa Corsetti is buried behind St. Rose. You never came to the funeral.',
    stages: [{ type: 'visit', map: 'shorthills', at: [19.5, 15.4], label: 'Light a candle at St. Rose for your mother', lines: [
      { who: 'Frank', text: 'Thirty-one candles in the rack. One of them has a little card under it: R.C. — every Friday.' },
      { who: 'Frank', text: '...Sorry, Ma. I\'m home. For a little while.' },
    ] }],
    done: [],
    reward: { xp: 30, rel: ['dom', 10], jp: ['neighbor', 6] },
  },
  /* ---------------- Chapter 5, act 2: the avenue ---------------- */
  ferraro_rosary: {
    chapter: 5, giver: 'folk12', title: 'Mrs. Ferraro\'s Rosary',
    desc: 'Mrs. Ferraro dropped her mother\'s rosary somewhere on the way to Mass.',
    offer: [{ who: 'Mrs. Ferraro', text: 'Rosa Corsetti\'s boy! Help an old woman. My mother\'s rosary — I had it at the bakery, I had it at the church, and now I don\'t have it.' }],
    stages: [
      { type: 'find', map: 'shorthills', spots: [[12.5, 18.6], [24.5, 19.4], [38.5, 26.5], [21.5, 27.5]], label: 'Find Mrs. Ferraro\'s rosary' },
      { type: 'return', label: 'Bring the rosary back to Mrs. Ferraro' },
    ],
    found: 'Pearl beads and a silver cross, caught in a storm grate. Still warm from the sun.',
    done: [{ who: 'Mrs. Ferraro', text: 'God bless you. Your mother would be so proud. Here — I made too many pizzelle. I always make too many pizzelle.' }],
    reward: { money: 20, xp: 30, jp: ['neighbor', 8], items: { sandwich: 2 } },
  },
  paulie_papers: {
    chapter: 5, giver: 'folk13', title: 'The Paper Route',
    desc: 'Paulie\'s bike has a flat and the Star-Ledger waits for no one.',
    offer: [{ who: 'Paulie the paperboy', text: 'Mister, my bike\'s busted and Mr. Doyle and Father Dom both get the paper. Mr. Doyle yells. Father Dom prays at you. Which is worse?' }],
    stages: [
      { type: 'visit', map: 'shorthills', at: [29.5, 20.4], label: 'Drop a paper at the Doyle house' },
      { type: 'visit', map: 'shorthills', at: [18.5, 19.4], label: 'Drop a paper at the rectory', lines: [{ who: 'Frank', text: 'Front page: "ESSEX COUNTY GRAND JURY CONVENES." Somebody in Short Hills isn\'t sleeping well.' }] },
      { type: 'return', label: 'Tell Paulie the papers are delivered' },
    ],
    done: [{ who: 'Paulie the paperboy', text: 'You\'re a lifesaver! Here\'s three bucks. That\'s the whole tip economy of Short Hills, mister.' }],
    reward: { money: 3, xp: 25, jp: ['neighbor', 6] },
  },
  vito_bocce: {
    chapter: 5, giver: 'folk14', title: 'The Bocce Court',
    desc: 'Old Vito\'s bocce court has a broken backboard. The Sunday tournament is sacred.',
    offer: [{ who: 'Old Vito', text: 'Corsetti! I played bocce with your grandfather. He cheated. Fix my backboard and I won\'t tell anyone.' }],
    stages: [
      { type: 'repair', map: 'shorthills', at: [39, 25.6], hits: 3, wood: 2, label: 'Fix the bocce backboard (Toolkit + 2 wood)' },
      { type: 'return', label: 'Tell Old Vito the court is ready' },
    ],
    done: [{ who: 'Old Vito', text: 'Beautiful. Straight as a judge. ...Not one of Leo\'s judges. Here, my old service pistol rounds. Korea. Still good.' }],
    reward: { money: 10, xp: 30, jp: ['handyman', 6], items: { ammo: 16 } },
  },
  /* ---------------- Chapter 5, act 2: recon ---------------- */
  recon: {
    chapter: 5, story: true, title: 'Eyes on the House',
    desc: 'Watch Leo\'s compound from the ravine railing.',
    stages: [
      { type: 'visit', map: 'shorthills', at: [60.4, 9.5], label: 'Watch the front gate from the north overlook', lines: [
        { who: 'Frank', text: 'Front gate: iron, electric, two men in a hut. They change shifts at midnight. Nobody\'s getting through that without a truck.' },
      ] },
      { type: 'visit', map: 'shorthills', at: [60.4, 26.5], label: 'Watch the house from the middle overlook', lines: [
        { who: 'Frank', text: 'The study light is on. Second floor of nothing — Leo never liked stairs. North side, center. Dante Ruggiero sits outside it like a dog.' },
      ] },
      { type: 'visit', map: 'shorthills', at: [60.4, 41.5], label: 'Watch the grounds from the south overlook', lines: [
        { who: 'Frank', text: 'A service road on the west side, by the pool house. One gap in the wall. Dogs. More men than he needs.' },
        { who: 'Frank', text: 'I can\'t do this alone. Time to call in every favor I have.' },
      ] },
    ],
    done: [],
    reward: { xp: 50, jp: ['shadow', 15] },
  },

  /* ================= Chapter 1 storylines ================= */
  // ---- Ruth: Harold's letters ----
  ruth_1: {
    chapter: 1, arc: 'ruth', part: 1, giver: 'ruth', title: 'Harold\'s Shed', requires: ['chore_logs'], waitDays: 1, hours: [8, 19],
    desc: 'Ruth hasn\'t opened Harold\'s workshop shed in eleven years. She wants it cleared out — but not by her.',
    offer: [
      { who: 'Ruth Calloway', text: 'Frank. That shed behind the house was Harold\'s. I haven\'t opened it since the funeral.' },
      { who: 'Ruth Calloway', text: 'It\'s time somebody did. I just can\'t be the one. Will you?' },
    ],
    stages: [
      { type: 'visit', map: 'cabin', at: [53.6, 23], label: 'Clear out Harold\'s shed behind Ruth\'s farmhouse', lines: [
        { who: 'Frank', text: 'Tools, rusted. Fishing lures. A coffee can of nails. And under the bench, a tin cash box with a little key taped to the lid.' },
        { who: 'Frank', text: 'Letters. Dozens of them, tied with string. All from Duluth. All signed "M."' },
      ] },
      { type: 'return', label: 'Bring Harold\'s tin box to Ruth', lines: [
        { who: 'Ruth Calloway', text: '(She turns the bundle over and over.) My eyes aren\'t good for handwriting anymore, Frank. Read me one.' },
        { who: 'Frank', text: '"Harold — May turned six. She asks about you. Thank you for the money, it keeps the lights on. — M."' },
        { who: 'Ruth Calloway', text: '...Put them back in the box. I need to think.' },
      ] },
    ],
    done: [{ who: 'Ruth Calloway', text: 'Thank you for doing that. I mean it. Go on home now.' }],
    reward: { xp: 40, rel: ['ruth', 8], jp: ['neighbor', 6] },
  },
  ruth_2: {
    chapter: 1, arc: 'ruth', part: 2, giver: 'ruth', title: 'Who Was M.?', requires: ['ruth_1'], waitDays: 1, hours: [8, 19],
    desc: 'Pastor Abe has buried half of Pine Hollow. He would have known Harold\'s secrets.',
    offer: [
      { who: 'Ruth Calloway', text: 'I didn\'t sleep. Fifty-one years of marriage, and there was a "May."' },
      { who: 'Ruth Calloway', text: 'Abe heard Harold\'s confessions for thirty years. He won\'t tell me. Maybe he\'ll tell you.' },
    ],
    stages: [
      { type: 'talk', npc: 'folk2', hours: [8, 19], label: 'Ask Pastor Abe about Harold (in Pine Hollow, daytime)', lines: [
        { who: 'Pastor Abe', text: 'Harold Calloway. ...I wondered when somebody would find those letters.' },
        { who: 'Pastor Abe', text: 'Before he met Ruth, Harold spent a summer on the boats in Duluth. Marjorie Lind. A daughter, May. He found out a year after he married Ruth.' },
        { who: 'Pastor Abe', text: 'He sent money every month until the day he died. He wanted to tell Ruth every one of those days. He was afraid.' },
        { who: 'Pastor Abe', text: 'He kept one more letter. He said if anything happened, it would be "where he watched the sun come up." I never knew what he meant.' },
      ] },
      { type: 'return', label: 'Tell Ruth what Pastor Abe said', lines: [
        { who: 'Ruth Calloway', text: 'A daughter. Harold had a daughter.' },
        { who: 'Ruth Calloway', text: '"Where he watched the sun come up." That\'s his deer blind in the north woods. He sat there every morning of hunting season for forty years.' },
      ] },
    ],
    reward: { xp: 40, rel: ['ruth', 8], jp: ['neighbor', 6] },
  },
  ruth_3: {
    chapter: 1, arc: 'ruth', part: 3, giver: 'ruth', title: 'Where He Watched the Sun Come Up', requires: ['ruth_2'], waitDays: 1, hours: [6, 20],
    desc: 'Harold\'s last letter is somewhere in his old deer blind in the north woods. He went at first light.',
    offer: [{ who: 'Ruth Calloway', text: 'Go to the blind at first light, Frank, the way he did. Whatever he left there, bring it to me. Even if it hurts.' }],
    stages: [
      { type: 'visit', map: 'cabin', at: [9, 4.5], hours: [5, 10], early: 'Harold went at first light. Come back between 5 and 10 AM.', label: 'Search Harold\'s deer blind in the north woods at first light', lines: [
        { who: 'Frank', text: 'The blind is half-collapsed. Wedged in the roof beam, a coffee can, sealed with wax.' },
        { who: 'Frank', text: 'Inside: a letter in Harold\'s hand. "Ruthie." And an address in Duluth, and a photograph of a girl with Harold\'s ears.' },
        { who: 'Frank', text: '(The sun comes up over the pond. He was right. It\'s a good place to say what you couldn\'t.)' },
      ] },
      { type: 'return', label: 'Bring Harold\'s last letter to Ruth', lines: [
        { who: 'Ruth Calloway', text: '(She reads it twice. Then she folds it, very small.)' },
        { who: 'Ruth Calloway', text: 'He says he was a coward. He says May is the best thing he ever did and I\'m the best thing that ever happened to him.' },
        { who: 'Ruth Calloway', text: 'Frank — there\'s an address. She\'d be fifty-four now. What do I do?', choices: [
          { text: '"Write to her. She\'s family. So are you."', value: 'write', lines: [{ who: 'Ruth Calloway', text: 'Family. ...I think I\'ll bake something to send with it. Harold would laugh at me.' }] },
          { text: '"Let it rest. Harold made his peace."', value: 'rest', lines: [{ who: 'Ruth Calloway', text: 'Maybe. Some doors are better left shut. ...I\'ll keep the photograph, though.' }] },
        ] },
      ] },
    ],
    doneBy: {
      write: [{ who: 'Ruth Calloway', text: 'Now sit. I\'m going to teach you to dress a wound properly, the way they taught us in Korea. A man who lives like you do should know.' }],
      rest: [{ who: 'Ruth Calloway', text: 'Now sit. I\'m going to teach you to dress a wound properly. A man who lives like you do should know.' }],
    },
    reward: { xp: 70, rel: ['ruth', 12], jp: ['neighbor', 10], perk: 'field_medic', flag: 'ruthLetter' },
    rewardBy: { write: { rel: ['ruth', 20] } },
  },

  // ---- Dee: Thursday visits ----
  dee_1: {
    chapter: 1, arc: 'dee', part: 1, giver: 'dee', title: 'Thursday Visits', hours: [8, 19],
    desc: 'Dee closes early on Thursdays and won\'t say why. She keeps glancing at the door.',
    offer: [
      { who: 'Dee Marsh', text: '(Dee short-changes you by five dollars. Then she notices, and her hands shake fixing it.)' },
      { who: 'Dee Marsh', text: 'Sorry. Long week. ...If you\'re around Thursday afternoon, Frank, I wouldn\'t mind a big fella in the store. Around three.' },
    ],
    ask: 'Will you be here Thursday?',
    stages: [
      { type: 'wait', weekday: 'Thursday', hour: 14, label: 'Be at Marsh General on Thursday around 3 PM' },
      { type: 'visit', map: 'town', at: [13, 16.2], hours: [14, 17], label: 'Be in Marsh General Thursday afternoon', lines: [
        { who: '', text: 'At ten past three, a man in a feed cap walks in like he owns the place. A younger one waits by the door.' },
        { who: 'Earl Pruitt', text: 'Afternoon, Dolores. Insurance day. Fifty, same as always.' },
        { who: 'Dee Marsh', text: '(She opens the register without a word.)' },
        { who: 'Earl Pruitt', text: '(He sees you, sizes you up, and grins.) New stock boy? Pine Hollow\'s a safe town, friend. Earl Pruitt keeps it that way.' },
        { who: 'Frank', text: '(You\'ve seen men like Earl Pruitt your whole life. Small, hungry, and somebody else\'s errand boy.)' },
      ] },
      { type: 'return', label: 'Talk to Dee', lines: [
        { who: 'Dee Marsh', text: 'Two years. Started after Walt died. "Insurance." Gus pays it too. And the diner.' },
        { who: 'Dee Marsh', text: 'The sheriff\'s office is forty miles away and Earl\'s cousin works dispatch. Please don\'t do anything stupid, Frank.' },
      ] },
    ],
    reward: { xp: 35, rel: ['dee', 8], jp: ['neighbor', 4] },
  },
  dee_2: {
    chapter: 1, arc: 'dee', part: 2, giver: 'dee', title: 'Follow the Money', requires: ['dee_1'], waitDays: 0, hours: [8, 20],
    desc: 'Where does Earl Pruitt take Pine Hollow\'s money? Follow him — and don\'t let him see you.',
    offer: [{ who: 'Dee Marsh', text: 'Earl does his rounds every afternoon. He leaves his truck out by the old woodlot. ...I didn\'t tell you that.' }],
    stages: [
      { type: 'tail', map: 'town', at: [24.5, 19.6], hours: [13, 19], label: 'Wait for Earl outside the diner, then follow him', who: 'Earl Pruitt', look: { body: '#5a4a2a', hair: '#3a2a1a', skin: '#d8a27e' },
        route: [[24.5, 20.6, 0], [31, 21, 2], [38.5, 21], [45, 22.4, 3], [55, 22.6], [59.5, 23.2], [59.5, 27, 2], [60.5, 31]],
        lines: [
          { who: '', text: 'Earl stops at a muddy pickup at the edge of the woodlot and makes a call from a bag phone.' },
          { who: 'Earl Pruitt', text: '...Yeah, it\'s all here. Four hundred. ...No, Ray, I ain\'t skimming. Tell your brother the Duluth money comes Friday like always.' },
          { who: 'Frank', text: '(Earl\'s not the boss. He collects for a man named Ray, who answers to somebody in Duluth. Small fish, in a small pond, feeding a bigger one.)' },
          { who: 'Frank', text: '(And one more thing: Earl was in Duluth all last week. Whoever pointed the grey coat at your cabin, it wasn\'t Earl.)' },
        ] },
      { type: 'return', label: 'Tell Dee what you heard' },
    ],
    done: [{ who: 'Dee Marsh', text: 'Duluth. Lord. ...So what now?' }],
    reward: { xp: 45, rel: ['dee', 6], jp: ['shadow', 10], flag: 'earlAlibi' },
  },
  dee_3: {
    chapter: 1, arc: 'dee', part: 3, giver: 'dee', title: 'Insurance', requires: ['dee_2'], waitDays: 0, hours: [8, 20],
    desc: 'Earl Pruitt keeps his truck at the woodlot. Something has to change — but how is up to you.',
    offer: [{ who: 'Dee Marsh', text: 'I can\'t keep paying, Frank. But I can\'t have blood in my store either.' }],
    stages: [
      { type: 'talk', npc: 'dee', label: 'Decide with Dee what to do about Earl', lines: [
        { who: 'Dee Marsh', text: 'So. What do we do?', choices: [
          { text: '"I\'ll have a word with Earl at the woodlot. A firm word."', value: 'scare', lines: [{ who: 'Dee Marsh', text: '...Be careful. He brings his nephew. They both carry bats.' }] },
          { text: '"I\'ll pay off what he claims you owe. Then he has no reason."', value: 'pay', cost: 150, lines: [{ who: 'Dee Marsh', text: 'Frank, that\'s too much. ...Thank you. I\'ll pay you back in sandwiches until one of us dies.' }] },
          { text: '"Anonymous tip to the State Police. Not the county."', value: 'tip', lines: [{ who: 'Dee Marsh', text: 'The state boys? ...They\'d come for Ray. And Earl would go down with him. Do it from your cabin phone.' }] },
        ] },
      ] },
    ],
    reward: { xp: 20 },
  },
  dee_4: {
    chapter: 1, arc: 'dee', part: 4, giver: 'dee', title: 'Earl\'s Last Collection', requires: ['dee_3'], needsChoice: 'scare', hours: [8, 21],
    desc: 'Finish what you started with Earl Pruitt.',
    offer: [{ who: 'Dee Marsh', text: 'Today, then. Before I lose my nerve.' }],
    stages: [
      { type: 'fight', map: 'town', at: [60.5, 31], hours: [12, 20], label: 'Have a word with Earl Pruitt at the woodlot (afternoon)', enemies: ['enforcer', 'enforcer'], names: ['Earl Pruitt', 'Cody Pruitt'],
        before: [{ who: 'Earl Pruitt', text: 'Stock boy. You lost? ...Cody, get the bats.' }],
        after: [{ who: 'Earl Pruitt', text: '(From the mud.) Okay! Okay. Pine Hollow\'s off the route. I\'ll tell Ray it ain\'t worth it.' }] },
      { type: 'return', label: 'Tell Dee it\'s over' },
    ],
    done: [{ who: 'Dee Marsh', text: 'Earl drove out of town at sixty miles an hour. Gus is buying everybody pie. ...You\'re not a stock boy, are you, Frank.' }],
    reward: { xp: 80, rel: ['dee', 16], jp: ['gunhand', 12], perk: 'store_tab', rel2: ['gus', 6] },
  },
  dee_4p: {
    chapter: 1, arc: 'dee', part: 4, giver: 'dee', title: 'Paid in Full', requires: ['dee_3'], needsChoice: 'pay', hours: [8, 21],
    desc: 'You paid Dee\'s "debt". Make sure Earl knows the account is closed.',
    offer: [{ who: 'Dee Marsh', text: 'Earl\'ll be by Thursday like always. You\'ll want to be the one to tell him.' }],
    stages: [
      { type: 'wait', weekday: 'Thursday', hour: 14, label: 'Be at Marsh General Thursday afternoon' },
      { type: 'visit', map: 'town', at: [13, 16.2], hours: [14, 17], label: 'Close Dee\'s account with Earl (Thursday afternoon)', lines: [
        { who: 'Earl Pruitt', text: '...Paid off? All of it? By you? (He counts it twice.) Huh. Nice doing business with Pine Hollow, then.' },
        { who: 'Frank', text: '(He\'ll be back in a year, with a new story. But not this year.)' },
      ] },
    ],
    done: [{ who: 'Dee Marsh', text: 'He tipped his cap at me. Tipped his cap! I could kiss you, Frank. I won\'t. But I could.' }],
    reward: { xp: 60, rel: ['dee', 20], jp: ['neighbor', 12], perk: 'store_tab' },
  },
  dee_4t: {
    chapter: 1, arc: 'dee', part: 4, giver: 'dee', title: 'A Call to the State Police', requires: ['dee_3'], needsChoice: 'tip', hours: [8, 21],
    desc: 'Call the State Police from your cabin phone — and keep your own name out of it.',
    offer: [{ who: 'Dee Marsh', text: 'Use the phone at your place. Not mine. Earl\'s cousin listens on the party line.' }],
    stages: [
      { type: 'visit', map: 'cabin', at: [24.5, 20.6], label: 'Call the State Police from the cabin phone', lines: [
        { who: 'Frank', text: '(A trooper with a tired voice takes it all down: Earl Pruitt, a man called Ray, the Duluth money, Fridays.)' },
        { who: 'Frank', text: '(You give a fake name. It\'s been a long time since that felt this good.)' },
      ] },
      { type: 'wait', days: 2, label: 'Wait two days for the State Police to act', lines: [{ who: '', text: 'Word reaches you through Dee: the State Police picked up Earl Pruitt and a man named Ray Lindahl at a truck stop on Route 2.' }] },
      { type: 'return', label: 'See Dee' },
    ],
    done: [{ who: 'Dee Marsh', text: 'Nobody in town knows who called. Except me. And I can keep a secret, Frank — better than you\'d think.' }],
    reward: { xp: 70, rel: ['dee', 18], jp: ['shadow', 10], perk: 'store_tab' },
  },

  // ---- Gus: the saw ----
  gus_1: {
    chapter: 1, arc: 'gus', part: 1, giver: 'gus', title: 'The Big Saw', hours: [8, 18], needsFlag: 'townOpen',
    desc: 'The mill\'s big saw has been grinding and smoking. Gus is too proud to ask.',
    offer: [
      { who: 'Gus Okafor', text: '(Gus is glaring at the saw like it owes him money.)' },
      { who: 'Gus Okafor', text: 'The carriage is warped and the blade guard\'s cracked. I could use a second pair of hands. And six good planks to rebuild the carriage.' },
    ],
    stages: [
      { type: 'bring', item: 'wood', n: 6, label: 'Bring Gus 6 wood for the saw carriage' },
      { type: 'repair', map: 'town', at: [52.5, 33.5], hits: 4, label: 'Rebuild the saw carriage at the mill (Toolkit)' },
      { type: 'return', label: 'Tell Gus the saw is running' },
    ],
    done: [{ who: 'Gus Okafor', text: 'Listen to her. Smooth as a cat. ...Thank you, Frank. That\'s not a word I use often.' }],
    reward: { money: 40, xp: 45, rel: ['gus', 10], jp: ['handyman', 10] },
  },
  gus_2: {
    chapter: 1, arc: 'gus', part: 2, giver: 'gus', title: 'Night Shift', requires: ['gus_1'], waitDays: 1, hours: [8, 18],
    desc: 'Someone has been knocking over Gus\'s log piles at night. Stake out the mill.',
    offer: [{ who: 'Gus Okafor', text: 'Three nights now somebody\'s pushed over my log stacks. Could\'ve killed somebody. If you\'re up late, Frank — watch the mill.' }],
    stages: [
      { type: 'visit', map: 'town', at: [52.5, 33.5], hours: [22, 2], early: 'Whoever it is comes at night. Come back between 10 PM and 2 AM.', label: 'Stake out the mill at night (10 PM–2 AM)', lines: [
        { who: '', text: 'Just after eleven: a flashlight, giggling, and the rumble of a log stack going over.' },
        { who: 'Frank', text: '(You catch the slowest one by the collar. Fifteen, scared, with Jenny Miller\'s nose.)' },
        { who: 'Tommy Miller', text: 'Don\'t tell my mom! It\'s just — there\'s nothing to DO here! Please!', choices: [
          { text: '"You\'ll work it off. Stacking logs for Gus, every Saturday."', value: 'work', lines: [{ who: 'Tommy Miller', text: '...Every Saturday? Aw, man. ...Okay. Okay.' }] },
          { text: '"Your mother\'s going to hear about this."', value: 'mom', lines: [{ who: 'Tommy Miller', text: '(He goes very pale.) She\'s gonna kill me.' }] },
        ] },
      ] },
      { type: 'return', label: 'Tell Gus who it was' },
    ],
    doneBy: {
      work: [{ who: 'Gus Okafor', text: 'The Miller boy? Ha! Free labor. I\'ll make a lumberman out of him yet.' }],
      mom: [{ who: 'Gus Okafor', text: 'Jenny\'ll take care of it. That boy won\'t sit down for a week.' }],
    },
    reward: { xp: 45, rel: ['gus', 8], jp: ['shadow', 6] },
    rewardBy: { work: { rel: ['gus', 12] } },
  },
  gus_3: {
    chapter: 1, arc: 'gus', part: 3, giver: 'gus', title: 'A Lumberman\'s Trade', requires: ['gus_2'], waitDays: 1, hours: [8, 18],
    desc: 'Gus wants to teach you how a real lumberman works wood.',
    offer: [{ who: 'Gus Okafor', text: 'You\'ve got good hands and no technique, Frank. Come to the yard. Bring 4 wood — I\'ll show you how my father did it.' }],
    stages: [
      { type: 'bring', item: 'wood', n: 4, label: 'Bring Gus 4 wood for the lesson' },
      { type: 'repair', map: 'town', at: [52.5, 33.5], hits: 3, label: 'Learn to plane and join at the mill (Toolkit)' },
      { type: 'return', label: 'Talk to Gus' },
    ],
    done: [{ who: 'Gus Okafor', text: 'Measure twice, cut once, waste nothing. Now you work like a lumberman. And Okafor Lumber pays lumbermen better.' }],
    reward: { xp: 50, rel: ['gus', 10], jp: ['handyman', 12], perk: 'mill_hand' },
  },

  // ---- Old Man Tibbs: one more game ----
  tibbs_1: {
    chapter: 1, arc: 'tibbs', part: 1, giver: 'folk11', title: 'One More Game', hours: [8, 19],
    desc: 'Old Man Tibbs wants to see if the new fella can play cards.',
    offer: [
      { who: 'Old Man Tibbs', text: 'You play cards, Calloway-cabin man? Wednesday and Saturday nights, back of the diner. Ten-dollar ante.' },
      { who: 'Old Man Tibbs', text: 'Win me one hand and I\'ll tell you something nobody else in this town knows.' },
    ],
    ask: 'Up for it?',
    stages: [
      { type: 'poker', n: 1, label: 'Win a hand at poker night (Wed & Sat, 7–11 PM at the diner)' },
      { type: 'talk', npc: 'folk11', hours: [8, 19], label: 'Find Old Man Tibbs in town the next day' },
    ],
    done: [
      { who: 'Old Man Tibbs', text: 'You hold your cards like a man who\'s played for real money. With real men. ...I don\'t ask.' },
      { who: 'Old Man Tibbs', text: 'Here\'s my secret: my Edna made the best venison stew in three counties, and I\'ve still got her recipe card. Bring me two pieces of venison and I\'ll show you.' },
    ],
    reward: { xp: 30, rel2: ['dee', 2] },
  },
  tibbs_2: {
    chapter: 1, arc: 'tibbs', part: 2, giver: 'folk11', title: 'Edna\'s Stew', requires: ['tibbs_1'], waitDays: 0, hours: [8, 19],
    desc: 'Tibbs wants to cook his late wife\'s venison stew one more time.',
    offer: [{ who: 'Old Man Tibbs', text: 'Deer come out at dawn and dusk on the north ridge past your cabin. Walk soft. Don\'t sprint. They hear everything.' }],
    stages: [
      { type: 'hunt', n: 1, label: 'Bring down a deer in the north woods (dawn or dusk)' },
      { type: 'bring', item: 'venison', n: 2, label: 'Bring Tibbs 2 venison' },
    ],
    done: [
      { who: 'Old Man Tibbs', text: '(The diner\'s back kitchen fills with smoke and bay leaf.) Edna used to sing while she stirred. I can\'t sing.' },
      { who: 'Old Man Tibbs', text: 'Thirty years I played cards to stay out of the house. Thirty years I could\'ve been in this kitchen. Don\'t you waste yours, son.' },
      { who: 'Old Man Tibbs', text: 'And a gift: I\'ve sat at that table since \'61. I\'ll teach you to read a man\'s cards off his face.' },
    ],
    reward: { xp: 50, jp: ['shadow', 6], items: { venison_stew: 2 }, perk: 'card_sharp' },
  },

  // ---- Mr. Henderson: hides ----
  henderson_1: {
    chapter: 1, arc: 'henderson', part: 1, giver: 'folk1', title: 'Good Money for Hides', hours: [8, 19],
    desc: 'Mr. Henderson is buying deer pelts. He seems to need the money more than the pelts.',
    offer: [
      { who: 'Mr. Henderson', text: 'You hunt, Frank? I\'ve got a buyer for deer hides. Two pelts, I\'ll give you eighty for the pair. Cash.' },
      { who: 'Mr. Henderson', text: '(His hands won\'t stay still. A man that nervous about deer hides is nervous about something else.)' },
    ],
    stages: [
      { type: 'bring', item: 'pelt', n: 2, label: 'Bring Mr. Henderson 2 deer pelts' },
    ],
    done: [
      { who: 'Mr. Henderson', text: 'Beautiful. Eighty, as promised. (He peels it off a roll much too fat for a retired mailman.)' },
      { who: 'Mr. Henderson', text: 'You want the trick to deer? Read the ground. Scrapes, rubs, droppings. They tell you where he\'s been and where he\'s going. Like people.' },
      { who: 'Frank', text: '(That roll of bills. Fifties. Crisp. Not Pine Hollow money.)' },
    ],
    reward: { money: 80, xp: 40, jp: ['survivor', 6], perk: 'tracker', flag: 'hendersonRoll' },
  },

};Object.assign(ERRANDS, LATER_ARCS);


const est = () => G.s.errands || (G.s.errands = {});
export const errandState = (id) => est()[id] || null;
export const errandDone = (id) => (est()[id] || {}).state === 'done';

export function startErrand(id, quiet = false) {
  const e = ERRANDS[id];
  if (!e || est()[id]) return;
  const rec = { state: 'active', stage: 0, progress: 0, startDay: G.s.time.day };
  est()[id] = rec;
  prepStage(id);
  if (!quiet) { sfx('blip'); banner(`${e.chore ? 'Chore' : 'Errand'}: ${e.title} — ${stageLabel(id)}`, 'objective', 4.5); }
}

function prepStage(id) {
  const rec = est()[id], st = ERRANDS[id].stages[rec.stage];
  rec.progress = 0;
  rec.stageDay = G.s.time.day;
  rec.stageMin = G.s.time.minute;
  rec.spot = st && st.spots ? choose(st.spots) : null;
  if (st && st.type === 'buy') rec.progress = 0;
}

export function stageLabel(id) {
  const rec = est()[id], e = ERRANDS[id];
  if (!rec || rec.state === 'done') return 'Done';
  const st = e.stages[rec.stage];
  if (!st) return '';
  if (st.type === 'bring') return `${st.label} (${Math.min(count(st.item), st.n)}/${st.n})`;
  if (st.type === 'buy') return `${st.label} (${rec.progress}/${st.n})`;
  if (st.type === 'chop') return `${st.label} (${rec.progress}/${st.n})`;
  if (st.type === 'hunt') return `${st.label} (${rec.progress}/${st.n})`;
  if (st.type === 'wait') return st.label;
  return st.hours ? `${st.label} (${fmtWindow(st.hours)})` : st.label;
}

export function activeErrands() {
  return Object.entries(est()).filter(([id, r]) => ERRANDS[id] && r.state === 'active' && ERRANDS[id].chapter === G.s.chapter).map(([id, r]) => ({ id, ...ERRANDS[id], rec: r }));
}

export function choresStatus() {
  const ids = Object.keys(ERRANDS).filter((id) => ERRANDS[id].chore && ERRANDS[id].chapter === G.s.chapter);
  return { ids, done: ids.filter(errandDone).length, need: chapter().choresNeeded || 4 };
}

export function townErrandsDone() {
  return Object.keys(ERRANDS).filter((id) => ERRANDS[id].chapter === G.s.chapter && !ERRANDS[id].chore && !ERRANDS[id].story && errandDone(id)).length;
}

function advance(id) {
  const rec = est()[id], e = ERRANDS[id];
  rec.stage++;
  if (rec.stage >= e.stages.length) return complete(id);
  prepStage(id);
  sfx('chime');
  banner(`${e.title}: ${stageLabel(id)}`, 'objective', 4);
  saveGame('errand');
}

function complete(id) {
  const rec = est()[id], e = ERRANDS[id];
  rec.state = 'done';
  rec.doneDay = G.s.time.day;
  const r = { ...(e.reward || {}), ...((e.rewardBy && e.rewardBy[rec.choice]) || {}) };
  const finish = () => {
    sfx('jobDone');
    banner(`${e.chore ? 'Chore' : e.story ? 'Done' : 'Errand'} complete: ${e.title}`, 'good', 3.5);
    if (r.money) addMoney(r.money, 'errand');
    if (r.xp) addXP(r.xp, e.chore ? 'Chore' : 'Errand');
    if (r.rel) addRel(r.rel[0], r.rel[1]);
    if (r.jp) addJP(r.jp[0], r.jp[1]);
    if (r.perk) grantPerk(r.perk);
    if (r.flag) G.s.story.flags[r.flag] = rec.choice || true;
    if (r.rel2) addRel(r.rel2[0], r.rel2[1]);
    for (const [item, n] of Object.entries(r.items || {})) {
      const got = addItem(item, n, true);
      if (got) toast(`Received: ${ITEMS[item].name}${n > 1 ? ' ×' + got : ''}`, 'item', 3);
    }
    G.events.emit('errandDone', id);
    saveGame('errand');
  };
  const done = (e.doneBy && e.doneBy[rec.choice]) || e.done;
  if (done && done.length) playDialogue(done, finish); else finish();
}

/** Turn data lines (which may hold `choices: [{ text, value, cost, lines }]`) into dialogue. */
function choiceLines(id, lines) {
  const rec = est()[id];
  return lines.map((l) => {
    if (!l.choices) return l;
    return {
      ...l,
      choices: l.choices.map((c) => ({
        text: c.cost ? `${c.text} ($${c.cost})` : c.text,
        effect: () => {
          if (c.cost && G.s.money < c.cost) return [{ who: 'Frank', text: `(You don't have $${c.cost}.)` }];
          if (c.cost) addMoney(-c.cost, 'errand');
          rec.choice = c.value;
          return c.lines || [];
        },
      })),
    };
  });
}

function playStageLines(id, st, then) {
  const rec = est()[id];
  if (!st.lines) { then(); return; }
  const needsChoice = st.lines.some((l) => l.choices);
  playDialogue(choiceLines(id, st.lines), () => { if (!needsChoice || rec.choice) then(); });
}

const outOfHours = (st) => st.hours && !inHours(st.hours);

/** Props this map should show for active errands. */
export function errandProps(mapId) {
  const out = [];
  for (const e of activeErrands()) {
    const st = e.stages[e.rec.stage];
    if (!st || st.map !== mapId) continue;
    const base = { errand: e.id, id: 'er_' + e.id, label: stageLabel(e.id) };
    if (st.type === 'chop') out.push({ ...base, kind: 'quest_chop', ...T(...st.at), r: 52 });
    else if (st.type === 'repair') out.push({ ...base, kind: 'quest_repair', ...T(...st.at), r: 48 });
    else if (st.type === 'visit') out.push({ ...base, kind: 'quest_done', ...T(...st.at), r: 46, visit: true });
    else if (st.type === 'tail') out.push({ ...base, kind: 'quest_done', ...T(...st.at), r: 54, label: `${st.label}${st.hours ? ` (${fmtWindow(st.hours)})` : ''}` });
    else if (st.type === 'fight' && !e.rec.fighting) out.push({ ...base, kind: 'quest_done', ...T(...st.at), r: 60, label: st.label });
    else if (st.type === 'find') out.push({ ...base, kind: 'quest_find', ...T(...e.rec.spot), r: 46, animal: st.animal, label: st.animal === 'cat' ? 'Coax Mittens down' : 'Search here' });
  }
  return out;
}

/** Interacting with an errand prop. */
export function errandPropAction(pr) {
  const id = pr.errand, rec = est()[id];
  if (!rec || rec.state !== 'active') return;
  const st = ERRANDS[id].stages[rec.stage];
  if (st.type === 'chop') {
    const p = G.player;
    const cost = 8 * derived().staminaMult;
    if (p.stamina < cost) { toast('Too tired. Catch your breath.', 'warn'); return; }
    p.stamina -= cost; p.chopAnim = 0.25; sfx('chop');
    rec.progress++;
    if (rec.progress >= st.n) { sfx('treefall'); advance(id); }
  } else if (st.type === 'repair') {
    if (count('toolkit') < 1) { toast('You need a Toolkit for this (Okafor Lumber sells them).', 'warn', 3); return; }
    if (st.wood && count('wood') < st.wood) { toast(`You need ${st.wood} wood for this. Chop a tree.`, 'warn', 3); return; }
    openRepairGame({ title: ERRANDS[id].title, hits: st.hits || 3, wide: hasSkill('quick_fix'), onDone: () => { if (st.wood) removeItem('wood', st.wood); advance(id); } });
  } else if (st.type === 'visit') {
    if (outOfHours(st)) { toast(st.early || `Not now — come back ${fmtWindow(st.hours)}.`, 'warn', 3); return; }
    sfx('pickup');
    playStageLines(id, st, () => advance(id));
  } else if (st.type === 'tail') {
    if (outOfHours(st)) { toast(`Not now — they'll be out ${fmtWindow(st.hours)}.`, 'warn', 3); return; }
    if (G.tail) return;
    startTail({ name: st.who, look: st.look || {}, route: st.route, onDone: (ok) => { if (!ok) return; playStageLines(id, st, () => advance(id)); } });
  } else if (st.type === 'fight') {
    if (outOfHours(st)) { toast(`Not now — come back ${fmtWindow(st.hours)}.`, 'warn', 3); return; }
    const go = () => {
      rec.fighting = true;
      const [x, y] = st.at;
      st.enemies.forEach((t, i) => {
        const e = spawnEnemy(t, (x + (i - st.enemies.length / 2) * 1.2) * TILE, (y - 2.5) * TILE, { name: (st.names || [])[i] });
        e.alerted = true; e.errandFight = id;
      });
      sfx('warning');
    };
    if (st.before) playDialogue(choiceLines(id, st.before), go); else go();
  } else if (st.type === 'find') {
    sfx('chime');
    const e = ERRANDS[id];
    if (e.found) playDialogue([{ who: 'Frank', text: e.found }], () => advance(id)); else advance(id);
  }
}

/** Talking to someone: hand in 'bring' / 'return' stages. Returns true if handled. */
export function errandTalk(npcId) {
  for (const e of activeErrands()) {
    const st = e.stages[e.rec.stage];
    if (st.type === 'talk' && st.npc === npcId) {
      if (outOfHours(st)) continue;
      playStageLines(e.id, st, () => advance(e.id));
      return true;
    }
    if (e.giver !== npcId) continue;
    if (st.type === 'bring') {
      if (count(st.item) < st.n) continue;
      removeItem(st.item, st.n);
      advance(e.id);
      return true;
    }
    if (st.type === 'return') { if (st.lines) playStageLines(e.id, st, () => advance(e.id)); else advance(e.id); return true; }
  }
  return false;
}

/** Can this storyline part be brought up right now? */
export function arcReady(e) {
  if (e.chapter !== G.s.chapter) return false;
  if (G.s.story.flags.ratGone && G.s.story.flags.ratGone === e.giver) return false; // left town
  if (!e.early && !G.s.story.flags.townOpen) return false;
  for (const req of e.requires || []) {
    const r = est()[req];
    if (!r || r.state !== 'done') return false;
    if (e.waitDays && G.s.time.day - (r.doneDay || 0) < e.waitDays) return false;
  }
  if (e.needsStep && !e.needsStep.includes(G.s.story.step) && !(G.s.story.done || {})[G.s.chapter]) return false;
  if (e.needsFlag && !G.s.story.flags[e.needsFlag]) return false;
  if (e.needsChoice) { const prev = est()[(e.requires || [])[0]]; if (!prev || prev.choice !== e.needsChoice) return false; }
  if (e.hours && !inHours(e.hours)) return false;
  return true;
}

/** A person with an errand to offer right now, or null. */
export function errandOffer(npcId) {
  for (const [id, e] of Object.entries(ERRANDS)) {
    if (e.giver === npcId && e.offer && !est()[id] && arcReady(e)) return id;
  }
  return null;
}

/** Storylines a person brings up on their own — unless you put them off today. */
export function autoOfferErrand(npcId) {
  const id = errandOffer(npcId);
  if (!id || !ERRANDS[id].arc || ((G.s.world.putOff || {})[id] === G.s.time.day)) return false;
  return offerErrand(npcId);
}

export function offerErrand(npcId) {
  const id = errandOffer(npcId);
  if (!id) return false;
  const e = ERRANDS[id];
  const who = e.offer[0].who;
  // Storyline parts after the first just carry on — no "could you help?".
  if (e.arc && e.requires && e.requires.length) { playDialogue(e.offer, () => startErrand(id)); return true; }
  playDialogue([...e.offer, {
    who, text: e.ask || 'Could you help?',
    choices: [
      { text: '"Sure. Happy to."', effect: () => { startErrand(id); return []; } },
      { text: '"Not right now."', effect: () => { (G.s.world.putOff || (G.s.world.putOff = {}))[id] = G.s.time.day; return [{ who, text: 'Oh — another time, then.' }]; } },
    ],
  }]);
  return true;
}

/** Per-second checks: waits that run out, fights that are over. */
let tickT = 0;
export function updateErrands(dt) {
  tickT -= dt;
  if (tickT > 0) return;
  tickT = 0.5;
  for (const e of activeErrands()) {
    const st = e.stages[e.rec.stage], rec = e.rec;
    if (!st) continue;
    if (st.type === 'wait') {
      const t = G.s.time;
      let ok = false;
      if (st.days != null) ok = t.day - rec.stageDay >= st.days && (st.hour == null || t.minute >= st.hour * 60);
      if (st.weekday) ok = weekday() === st.weekday && t.minute >= (st.hour || 0) * 60 && (t.day > rec.stageDay || t.minute >= rec.stageMin);
      if (ok && !rec.waking) {
        rec.waking = true;
        const go = () => { rec.waking = false; advance(e.id); };
        if (st.lines) playDialogue(st.lines, go); else go();
      }
    } else if (st.type === 'fight' && rec.fighting) {
      const left = G.enemies.filter((x) => x.errandFight === e.id && !x.dead && !x.gone);
      const spawned = G.enemies.some((x) => x.errandFight === e.id);
      if (!spawned) rec.fighting = false; // left the map: start over
      else if (!left.length) { rec.fighting = false; playStageLines(e.id, { lines: st.after }, () => advance(e.id)); }
    }
  }
}

/** Weekday-based waits read naturally in the journal. */
export const nextWeekdayLabel = (wd) => (weekday() === wd ? 'today' : `on ${wd}`);
export { WEEKDAYS };

export function initErrandEvents() {
  const bump = (type, ok = () => true) => {
    for (const e of activeErrands()) {
      const st = e.stages[e.rec.stage];
      if (!st || st.type !== type || !ok(st)) continue;
      e.rec.progress++;
      if (e.rec.progress >= (st.n || 1)) advance(e.id);
      else toast(`${e.title}: ${stageLabel(e.id)}`, 'info', 2);
    }
  };
  G.events.on('pokerWon', () => bump('poker'));
  G.events.on('deerKilled', () => bump('hunt'));
  G.events.on('itemBought', (item, n) => {
    for (const e of activeErrands()) {
      const st = e.stages[e.rec.stage];
      if (st.type !== 'buy') continue;
      if (st.what === 'food' && !FOOD.has(item)) continue;
      e.rec.progress = Math.min(st.n, e.rec.progress + 1);
      if (e.rec.progress >= st.n) advance(e.id);
      else toast(`${e.title}: ${stageLabel(e.id)}`, 'info', 2);
    }
  });
}

/** Where the first unfinished errand wants you (optionally only chores / only story). */
export function errandWaypoint(filter = () => true) {
  for (const e of activeErrands()) {
    if (!filter(e)) continue;
    const st = e.stages[e.rec.stage];
    if (st.type === 'bring' || st.type === 'return' || st.type === 'talk') {
      if (st.type === 'bring' && count(st.item) < st.n) continue;
      const who = st.type === 'talk' ? st.npc : e.giver;
      const n = G.npcs.find((x) => x.id === who && x.present);
      if (n && G.map.id === mapOfGiver(who)) return { map: G.map.id, x: n.x, y: n.y, label: shortName(who) };
      const pt = giverPoint(who);
      if (pt) return { ...pt, label: shortName(who) };
      continue;
    }
    if (st.type === 'wait') continue;
    if (st.type === 'poker') { const wm = chapter().workMap; const pt = G.maps[wm] && G.maps[wm].points.poker_table; if (pt) return { map: wm, ...pt, label: 'Poker table' }; continue; }
    if (st.type === 'hunt') { const hm = chapter().homeMap; const pt = G.maps[hm] && G.maps[hm].points.hunt_area; if (pt) return { map: hm, ...pt, label: 'Deer in the woods' }; continue; }
    if (st.type === 'buy') { const wm = chapter().workMap; const pt = G.maps[wm] && G.maps[wm].points.store_door; if (pt) return { map: wm, ...pt, label: chapter().storeName }; continue; }
    const at = st.type === 'find' ? e.rec.spot : st.at;
    if (at) return { map: st.map, ...T(...at), label: e.title };
  }
  return null;
}

/** The nearest townsperson who still has an errand to offer. */
export function errandGiverWaypoint() {
  for (const [id, e] of Object.entries(ERRANDS)) {
    if (!e.offer || e.chapter !== G.s.chapter || est()[id]) continue;
    const n = G.npcs.find((x) => x.id === e.giver && x.present);
    if (n) return { map: G.map.id, x: n.x, y: n.y, label: shortName(e.giver) };
    const wm = chapter().workMap;
    const folk = (TOWNSFOLK[wm] || []).find((f) => f.id === e.giver);
    if (folk && G.maps[wm]) return { map: wm, ...G.maps[wm].points[folk.route[0]], label: folk.name };
  }
  return null;
}

function mapOfGiver(id) {
  if (NPCS[id]) return NPCS[id].map;
  for (const [m, list] of Object.entries(TOWNSFOLK)) if (list.some((f) => f.id === id)) return m;
  return null;
}
function giverPoint(id) {
  if (NPCS[id]) { const pt = G.maps[NPCS[id].map] && G.maps[NPCS[id].map].points[`${id}_porch`]; return pt ? { map: NPCS[id].map, ...pt } : null; }
  const m = mapOfGiver(id); const folk = m && TOWNSFOLK[m].find((f) => f.id === id);
  return folk && G.maps[m] ? { map: m, ...G.maps[m].points[folk.route[0]] } : null;
}
function shortName(id) {
  if (NPCS[id]) return NPCS[id].name.split(' ')[0].replace(/"/g, '');
  for (const list of Object.values(TOWNSFOLK)) { const f = list.find((x) => x.id === id); if (f) return f.name; }
  return id;
}

/** Journal: each storyline in this chapter, how far along it is and what's next. */
export function arcSummary() {
  const arcs = {};
  for (const [id, e] of Object.entries(ERRANDS)) {
    if (!e.arc || e.chapter !== G.s.chapter) continue;
    (arcs[e.arc] || (arcs[e.arc] = [])).push({ id, ...e });
  }
  return Object.entries(arcs).map(([arc, parts]) => {
    parts.sort((a, b) => a.part - b.part);
    const rec = (id) => est()[id];
    const done = parts.filter((p) => rec(p.id) && rec(p.id).state === 'done');
    const active = parts.find((p) => rec(p.id) && rec(p.id).state === 'active');
    const maxPart = Math.max(...parts.map((p) => p.part));
    const finished = done.some((p) => p.part === maxPart);
    // Branches: only one of the parts sharing a number is ever played.
    const total = new Set(parts.map((p) => p.part)).size;
    let next = null;
    if (!active && !finished) {
      const cand = parts.find((p) => !rec(p.id) && arcReady(p));
      const waiting = parts.find((p) => !rec(p.id) && (p.requires || []).every((r) => rec(r) && rec(r).state === 'done') && (!p.needsChoice || (rec(p.requires[0]) || {}).choice === p.needsChoice));
      if (!G.s.story.flags.townOpen && !done.length) next = 'Later — once you\'ve found work in town.';
      else if (cand) next = 'Ready — go and talk to them.';
      else if (waiting) next = waiting.hours && !inHours(waiting.hours) ? `Find them ${fmtWindow(waiting.hours)}.` : waiting.waitDays ? 'Give it a day or two.' : 'Not yet.';
      else if (!done.length) next = 'Get to know them first — help them out around town.';
    }
    return { arc, giver: parts[0].giver, done: done.map((p) => p.title), active: active ? { title: active.title, stage: stageLabel(active.id) } : null, next, finished, count: done.length, total };
  });
}
