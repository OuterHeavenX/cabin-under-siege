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
};

// Unnamed townsfolk who walk around Pine Hollow during the day.
export const TOWNSFOLK = [
  { id: 'folk1', name: 'Mr. Henderson', body: '#8a7a5a', hair: '#bbbbbb', skin: '#e0b08f', route: ['walk_a', 'walk_e', 'walk_f'] },
  { id: 'folk2', name: 'Pastor Abe', body: '#2e2e2e', hair: '#5a4632', skin: '#a8754f', route: ['walk_e', 'walk_c', 'walk_a'] },
  { id: 'folk3', name: 'Jenny Miller', body: '#c98c3a', hair: '#e6c26a', skin: '#f0c7a5', route: ['walk_d', 'walk_a', 'walk_b'] },
];

export const FOLK_LINES = [
  'Morning! You\'re the fella in the old Calloway cabin, right?',
  'Watch yourself on Route 9 after dark. Deer everywhere.',
  'Dee\'s pie is better than the diner\'s. Don\'t tell the diner.',
  'Gus is hiring again. He always is.',
  'Quiet town. That\'s how we like it.',
];

export function relLevel(points) {
  return Math.min(5, Math.floor(points / 20));
}
