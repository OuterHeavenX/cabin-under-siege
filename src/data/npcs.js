// Named NPCs: personality, appearance, daily schedules and dialogue pools.
// Schedules list [fromMinute, toMinute, map, pointName]. The first matching
// entry wins; anything not covered falls back to `home`.

export const NPCS = {
  ruth: {
    name: 'Ruth Calloway',
    title: 'Your neighbor',
    bio: 'Retired county nurse and widow who runs the farm east of your cabin. Sharp-eyed, dry humor, misses nothing on her road.',
    body: '#6d8fb3', hair: '#d9d9d9', skin: '#e2b89a',
    map: 'cabin',
    home: ['cabin', 'ruth_in'],
    schedule: [
      [7 * 60, 17 * 60, 'cabin', 'ruth_garden'],
      [17 * 60, 21 * 60, 'cabin', 'ruth_porch'],
    ],
    homeLine: 'Ruth is inside. A lamp glows behind the curtains.',
    idle: [
      'These tomatoes don\'t care who you used to be. Neither do I, mostly.',
      'Forty years of night shifts. I can tell when a man isn\'t sleeping.',
      'If you hear my truck horn twice, that means come running.',
      'Wind\'s coming down off the ridge. Cold night ahead.',
      'My Harold built that cabin you\'re in. Treat her kindly.',
    ],
    friendly: [
      'You know, I put an extra plate out on Sundays. Habit. You\'re welcome to it.',
      'You\'ve got good hands for a city boy. Harold would\'ve liked you.',
      'Whatever you ran from, you\'re not running from it alone out here.',
    ],
  },
  dee: {
    name: 'Dolores "Dee" Marsh',
    title: 'General store owner',
    bio: 'Runs Marsh General Store and knows every rumor in Pine Hollow before it happens. Generous, nosy, impossible to lie to for long.',
    body: '#b3546d', hair: '#7a3b1f', skin: '#c58c69',
    map: 'town',
    home: ['town', 'dee_home'],
    schedule: [
      [8 * 60, 20 * 60, 'town', 'dee_store'],
      [20 * 60, 22 * 60, 'town', 'dee_diner'],
    ],
    homeLine: "Dee's house is dark. She's probably asleep.",
    idle: [
      'Ammo\'s on the left, bandages on the right, gossip is free.',
      'Pine Hollow\'s got two hundred people and three hundred opinions.',
      'You pay cash. I like that. Don\'t see much of it anymore.',
      'Gus says you work hard. Gus doesn\'t say that about anybody.',
      'Coffee\'s burnt but it\'s hot. That\'s the deal.',
    ],
    friendly: [
      'Saved you the last box of the good shells. Don\'t tell the Hendersons.',
      'Honey, you look like you need a sandwich and a nap. In that order.',
      'Whatever folks say about you, I tell \'em you\'re a regular. That\'s the highest honor here.',
    ],
  },
  gus: {
    name: 'Gus Okafor',
    title: 'Lumber yard owner & job contact',
    bio: 'Former Army engineer who runs Okafor Lumber and hands out honest work. Gruff, fair, pays on time, and respects anyone who finishes what they start.',
    body: '#4f7a4a', hair: '#1d1d1d', skin: '#6b4a35',
    map: 'town',
    home: ['town', 'gus_home'],
    schedule: [
      [7 * 60, 17 * 60, 'town', 'gus_yard'],
      [17 * 60, 20 * 60, 'town', 'gus_diner'],
    ],
    homeLine: "Gus's place is quiet. He keeps early hours.",
    idle: [
      'Work\'s on the board. Pay\'s fair. Don\'t make me chase you.',
      'Measure twice, cut once. Applies to most things.',
      'You swing an axe like you\'re mad at the tree. Good.',
      'Sawmill\'s down a man since spring. You\'re filling a hole.',
      'Twenty years in the Corps of Engineers. Built bridges in places you never heard of.',
    ],
    friendly: [
      'You\'re all right, Lowe. I don\'t ask where a man\'s been. Only where he\'s going.',
      'If you need a hand with that cabin, I can lend tools. Don\'t lose them.',
      'Saw a guy watching my yard last week. Didn\'t like him. You\'d tell me if there\'s trouble, right?',
    ],
  },
  // ---------------- Chapter 2: Millbrook ----------------
  marcus: {
    name: 'Marcus Bell',
    title: 'Your neighbor across the street',
    bio: 'Retired "mail carrier" with a ham radio antenna and a habit of writing down license plates. Calm, precise, and far too good at noticing things.',
    body: '#5a6b7a', hair: '#cfcfcf', skin: '#5e3f2c',
    map: 'millbrook',
    home: ['millbrook', 'marcus_in'],
    schedule: [
      [7 * 60, 12 * 60, 'millbrook', 'marcus_yard'],
      [12 * 60, 21 * 60, 'millbrook', 'marcus_porch'],
    ],
    homeLine: 'The Bell house is dark except for the glow of a radio dial.',
    idle: [
      'Blue sedan, Illinois plates, went by twice this morning. Probably nothing. I wrote it down anyway.',
      'Thirty-one years with the postal service. You learn who belongs on a street.',
      'Radio says frost tonight. Bring in anything you care about.',
      'You sleep with the lights off, I notice. Smart.',
      'Millbrook\'s the kind of town where nothing happens. I like to keep it that way.',
    ],
    friendly: [
      'If you ever need a second pair of eyes on Larch Street, you\'ve got mine.',
      'You remind me of some people I used to work with. That\'s a compliment. Mostly.',
      'Come by for coffee. I make it strong enough to strip paint.',
    ],
  },
  rosa: {
    name: 'Rosa Delgado',
    title: 'Hardware & sporting goods owner',
    bio: 'Third-generation owner of Delgado Hardware & Sporting. Sharp tongue, sharper memory, and a soft spot for anyone who fixes their own fences.',
    body: '#7a2f4f', hair: '#2b1a12', skin: '#c08a62',
    map: 'millbrook',
    home: ['millbrook', 'rosa_home'],
    schedule: [
      [8 * 60, 20 * 60, 'millbrook', 'rosa_store'],
      [20 * 60, 22 * 60, 'millbrook', 'rosa_porch'],
    ],
    homeLine: "Rosa's house is quiet. The store opens at 8.",
    idle: [
      'Nails by the pound, shells by the box, advice for free.',
      'My grandfather opened this store in 1952. Same floorboards. Same bell on the door.',
      'You buy a lot of plywood for a man with a perfectly good house.',
      'Pete says you lift like two men. Pete exaggerates.',
      'Cash again? You and the Amish.',
    ],
    friendly: [
      'Set aside a box of the good buckshot for you. Don\'t tell anyone I play favorites.',
      'Whatever you\'re getting ready for, I hope it never comes. But if it does — aim low.',
      'You\'re good for this street, Frank. People sleep easier with you on it.',
    ],
  },
  pete: {
    name: 'Pete Kowalski',
    title: 'Moving company owner & job contact',
    bio: 'Big, cheerful ex-linebacker who runs Kowalski Moving & Odd Jobs. Pays cash, talks constantly, never asks where you\'re from.',
    body: '#3d6a8a', hair: '#c9a46a', skin: '#e2b494',
    map: 'millbrook',
    home: ['millbrook', 'pete_home'],
    schedule: [
      [7 * 60, 17 * 60, 'millbrook', 'pete_yard'],
      [17 * 60, 21 * 60, 'millbrook', 'pete_porch'],
    ],
    homeLine: "Pete's TV is blaring a ball game through the window.",
    idle: [
      'Work\'s on the board, buddy! Firewood, deliveries, fix-it jobs, you name it.',
      'Played two seasons at State before my knee went. Now I move couches. Living the dream.',
      'You lift with your legs, right? Tell me you lift with your legs.',
      'Everybody in Millbrook owes me a favor. I never collect. That\'s the trick.',
      'Coffee\'s in the office. It\'s terrible. Help yourself.',
    ],
    friendly: [
      'Best hire I\'ve made in years, and I hired my brother-in-law. Twice.',
      'You ever need a truck and three big guys, you call me. No questions.',
      'Whoever you were before Millbrook — doesn\'t matter. You\'re one of us now.',
    ],
  },
  // ---------------- Chapter 3: Kettle Crossing, Wisconsin ----------------
  ingrid: {
    name: 'Ingrid Haugen',
    title: 'Dairy farmer next door',
    bio: 'Runs the dairy across the pasture with her late father\'s stubbornness. Quietly helped Marcus hide people for twenty years. Trusts cows more than people.',
    body: '#6a4e7a', hair: '#e6d3a0', skin: '#f0c7a5',
    map: 'farm',
    home: ['farm', 'ingrid_in'],
    schedule: [
      [6 * 60, 12 * 60, 'farm', 'ingrid_yard'],
      [12 * 60, 21 * 60, 'farm', 'ingrid_porch'],
    ],
    homeLine: 'The Haugen farmhouse is dark. Milking starts at five.',
    idle: [
      'Cows don\'t lie and they don\'t gossip. That\'s more than I can say for Kettle Crossing.',
      'Snow comes early up here. Get your woodpile in.',
      'Marcus said you were trouble. He also said you were worth it. Prove one of those.',
      'If a car comes down our road after dark, it\'s not lost.',
      'There\'s a root cellar under your house. Pa dug it in \'62. Good place to keep things.',
    ],
    friendly: [
      'You milk like a city boy, but you show up. That counts.',
      'I left a jar of cream on your step. Don\'t make a thing of it.',
      'Pa hid two families in that farmhouse. You\'re in good company.',
    ],
  },
  bo: {
    name: 'Bo Lindqvist',
    title: 'Feed & supply store owner',
    bio: 'Third-generation owner of Lindqvist Feed & Supply. Talks slowly, notices everything, and keeps a shotgun under the counter "for raccoons".',
    body: '#7a6a3a', hair: '#c9a46a', skin: '#e8b898',
    map: 'farm',
    home: ['farm', 'bo_home'],
    schedule: [
      [8 * 60, 20 * 60, 'farm', 'bo_store'],
      [20 * 60, 22 * 60, 'farm', 'bo_porch'],
    ],
    homeLine: "Bo's lights are out. He'll open at eight sharp.",
    idle: [
      'Feed, seed, shells and coffee. In that order of importance.',
      'Ya, the winters are long. The people are longer.',
      'Fella came through last week asking about a farmhand from out east. I said we grow our own.',
      'You pay cash, you don\'t haggle, you don\'t talk my ear off. You\'re my favorite customer.',
      'Ice fishing starts in December. Pond behind your place has bass.',
    ],
    friendly: [
      'Put the good shells aside for you. Raccoons have been bold this year.',
      'My grandpa ran booze for the Chicago boys in the twenties. I know the type that\'s looking for you.',
      'Anything you need, you come to me first. Not the deputy.',
    ],
  },
  tess: {
    name: 'Tess Albright',
    title: 'Grain co-op manager & job contact',
    bio: 'Runs the Kettle Crossing grain co-op with a clipboard and zero patience. Former long-haul trucker; knows every back road in three counties.',
    body: '#3a6a5a', hair: '#2b1a12', skin: '#8a5a3e',
    map: 'farm',
    home: ['farm', 'tess_home'],
    schedule: [
      [7 * 60, 17 * 60, 'farm', 'tess_yard'],
      [17 * 60, 21 * 60, 'farm', 'tess_porch'],
    ],
    homeLine: "Tess's truck is parked. She's off the clock.",
    idle: [
      'Board\'s by the office. Harvest, deliveries, fix-it jobs. Pick one and go.',
      'Eleven years driving rigs. Nothing on a farm scares me.',
      'You\'re the new hand at the old Haugen place? Pa Haugen would\'ve hated you. That\'s a compliment.',
      'Fish fry Friday at the cafe. Bring a pan or bring an appetite.',
      'Deputy Mott\'s been asking about you. Mott asks about everybody he wants something from.',
    ],
    friendly: [
      'You work like you\'ve got something to prove. Keep proving it.',
      'If you ever need to leave town fast, I know a road that isn\'t on any map.',
      'Co-op looks out for its own. You\'re one of ours now.',
    ],
  },
};

// Unnamed townsfolk who walk around during the day, per map.
export const TOWNSFOLK = {
  town: [
    { id: 'folk1', name: 'Mr. Henderson', body: '#8a7a5a', hair: '#bbbbbb', skin: '#e0b08f', route: ['walk_a', 'walk_e', 'walk_f'] },
    { id: 'folk2', name: 'Pastor Abe', body: '#2e2e2e', hair: '#5a4632', skin: '#a8754f', route: ['walk_e', 'walk_c', 'walk_a'] },
    { id: 'folk3', name: 'Jenny Miller', body: '#c98c3a', hair: '#e6c26a', skin: '#f0c7a5', route: ['walk_d', 'walk_a', 'walk_b'] },
  ],
  farm: [
    { id: 'folk7', name: 'Pastor Lund', body: '#2e2e2e', hair: '#d0d0d0', skin: '#f0c7a5', route: ['walk_a', 'walk_b', 'walk_c'] },
    { id: 'folk8', name: 'Hank the trucker', body: '#8a3a2a', hair: '#5a4632', skin: '#c58c69', route: ['walk_b', 'walk_d', 'walk_a'] },
  ],
  millbrook: [
    { id: 'folk4', name: 'Mrs. Ortiz', body: '#b0567a', hair: '#3a2416', skin: '#c58c69', route: ['walk_b', 'walk_d', 'walk_e'] },
    { id: 'folk5', name: 'Danny Hendricks', body: '#4a7ab0', hair: '#e0c070', skin: '#f0c7a5', route: ['walk_a', 'walk_f', 'walk_c'] },
    { id: 'folk6', name: 'Old Mr. Pruitt', body: '#6a6a4a', hair: '#e0e0e0', skin: '#d8a888', route: ['walk_c', 'walk_e', 'walk_a'] },
  ],
};

export const FOLK_LINES = {
  town: [
  'Morning! You\'re the fella in the old Calloway cabin, right?',
  'Watch yourself on Route 9 after dark. Deer everywhere.',
  'Dee\'s pie is better than the diner\'s. Don\'t tell the diner.',
  'Gus is hiring again. He always is.',
  'Quiet town. That\'s how we like it.',
],
  farm: [
  'Ya, you\'re the new fella at the Haugen place? Welcome to Kettle Crossing.',
  'Bo\'s got the best coffee in the county. It\'s also the only coffee in the county.',
  'Storm\'s coming. Always is, up here.',
  'Deputy Mott drives a new truck. On a deputy\'s salary. Funny, that.',
  'Tess runs that co-op like a battleship.',
  ],
  millbrook: [
  'You\'re the new fella on Larch? Welcome to Millbrook!',
  'Rosa\'s got the best prices in the county. Don\'t tell her I said so.',
  'Pete Kowalski will hire anyone with two arms. He hired my cousin with one.',
  'Library has free coffee on Tuesdays. Terrible coffee, but free.',
  'Marcus across from you? He knows everything about everybody. Spooky man.',
  ],
};

export function relLevel(points) {
  return Math.min(5, Math.floor(points / 20));
}
