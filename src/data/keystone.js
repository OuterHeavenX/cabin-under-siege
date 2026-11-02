// Chapter 6: Keystone. After the story, the Paper Trail pays off: Carmine
// Ventura's title company kept a list of every cash closing on the East Coast
// — every witness who ever ran and bought a house — and he's selling it.
// The way it reaches Frank depends on how Chapter 5 ended.
const F = 'Frank';
const M = 'Marcus Bell';
const RY = 'Agent Dana Reyes';
const CV = 'Carmine Ventura';
const MK = 'Mickey Doyle';

/** Marcus's call. `solved`: whether Frank already worked out the Paper Trail. */
export const CALL = (s, solved) => {
  const end = (s.life.post && s.life.post.ending) || s.ending || 'walk';
  const lines = [
    { who: '', text: '(The phone rings at the watch house. Nobody calls the watch house.)' },
    { who: M, text: 'Frank. Marcus. Three families in the program moved this month — Tucson, Raleigh, a farm outside Boise. All three got visitors. All three paid cash for their houses.' },
  ];
  if (solved) lines.push({ who: F, text: 'Keystone. Carmine reads every cash closing.' }, { who: M, text: 'You worked it out before the Bureau did. That makes one of us who isn\'t embarrassed.' });
  else lines.push(
    { who: M, text: 'Every cash sale gets a title search. On the East Coast, half of them cross one desk: Keystone Title & Escrow, Broad Street, Newark. Carmine Ventura\'s desk. Leo\'s brother-in-law.' },
    { who: F, text: '(Pine Hollow. Millbrook. The farm. Every place you paid cash for. That\'s how they always knew.)' },
  );
  const BY_END = {
    justice: [{ who: RY, text: '(Reyes, on the extension.) His lawyers buried my subpoena. By the time a judge signs, the list is gone. If it walked out of his office on its own, I wouldn\'t ask how.' }],
    walk: [{ who: M, text: 'Leo\'s in Sarasota feeding pigeons. Carmine doesn\'t need Leo anymore. He\'s selling the list to whoever\'s buying. Philadelphia. Boston. Every witness since 1988.' }],
    blood: [{ who: M, text: 'Carmine blames you for Leo. He\'s putting the list up for sale with one condition: your name is on the first page.' }],
    crown: [{ who: M, text: 'You run the family now, Frank. Which means Carmine works for you. He\'s still selling it. Either you stop him or you\'re the man who sold them.' }],
  };
  lines.push(...(BY_END[end] || BY_END.walk));
  lines.push({ who: F, text: 'Broad Street. Twenty minutes from my porch.' }, { who: M, text: 'Be careful. And Frank — the list has your address on it too.' });
  return lines;
};

/** The casing: a look at the building, a title clerk, a tail, a car in a garage. */
export const KEYSTONE_ERRAND = {
  chapter: 5, story: true, keystone: true, title: 'Keystone',
  desc: 'Carmine Ventura\'s title company has a list of every witness who ever bought a house with cash. Find out how to get to it.',
  stages: [
    { type: 'visit', map: 'broad', at: [20, 22], label: 'Look over Keystone Title & Escrow from across Broad Street', lines: [
      { who: F, text: 'Three storefronts wide. Bars on the back windows, a camera over the front door that isn\'t plugged in. A records room in the back corner with a steel door.' },
      { who: F, text: 'The girl at the front desk takes her lunch at the luncheonette across the street. Every day, the same booth.' },
    ] },
    { type: 'visit', map: 'broad', at: [15.5, 29.5], hours: [11, 15], label: 'Talk to the Keystone clerk at the Broad Street Luncheonette (11 AM–3 PM)', early: 'The clerk takes her lunch between 11 and 3.', lines: [
      { who: 'Gloria Pinto', text: '(A woman in a cardigan with a tuna sandwich, reading a paperback. She sees you sit down across from her and closes the book very slowly.) ...You\'re not from the bank.' },
      { who: F, text: 'I\'m one of the names in your back room, Gloria.', choices: [
        { text: '"Do you know what that list is for? Who\'s on it?"', value: 'kind', lines: [
          { who: 'Gloria Pinto', text: '(She doesn\'t answer for a long time.) I typed most of it. I thought they were... I don\'t know what I thought.' },
          { who: 'Gloria Pinto', text: 'Two guards at night, since the alarm company quit. They walk the lobby and the alley. I lock the back door at five. ...Tomorrow I\'ll forget to.' },
        ] },
        { text: 'Slide an envelope across the table ($200)', value: 'pay', cost: 200, lines: [
          { who: 'Gloria Pinto', text: '(She counts it under the table.) Seven men at night now. Their rounds are on a clipboard by the coffee pot. (She writes it on a napkin: times, rooms, names.) Don\'t come back here.' },
        ] },
        { text: '"You\'ll tell me about the guards. Then you\'ll go home sick for a week."', value: 'scare', lines: [
          { who: 'Gloria Pinto', text: '(Her hands shake.) Seven. Lobby, offices, the alley. The records room takes Mr. Ventura\'s keycard. Please— (She leaves her sandwich and walks out fast. Too fast. Toward the payphone.)' },
        ] },
      ] },
    ] },
    { type: 'tail', map: 'broad', at: [19.5, 17], hours: [17, 21], label: 'Follow Carmine Ventura when he leaves the office (5–9 PM)', who: 'Carmine Ventura', look: { body: '#2a2a34', hair: '#bdbdbd', skin: '#d8b08a' },
      route: [[19.5, 16.8, 0], [26, 17, 2], [33, 16.8], [38, 17, 3], [43.5, 16.6, 2], [52, 17.2], [58.5, 17], [61, 22, 2], [61, 29.5], [56.5, 31.5]],
      lines: [
        { who: '', text: '(Carmine stops at the club door and talks to a heavy man in a Phillies jacket. You catch half of it.)' },
        { who: CV, text: '...the whole list, every name since \'88. Friday. Cash. And the first page is mine to sell twice. Corsetti\'s on it.' },
        { who: F, text: '(He walks on to the garage on Halsey. A grey Cadillac on the second level. He doesn\'t take his briefcase home. He leaves it in the car.)' },
      ] },
    { type: 'find', map: 'broad', spots: [[52.5, 29.5]], label: 'Search Carmine\'s Cadillac in the Halsey Street garage' },
  ],
  found: 'The Cadillac\'s back door isn\'t locked. Nobody steals from Carmine Ventura. In the briefcase: a white keycard, KEYSTONE — RECORDS, and one typed page. LOWE, F. — PINE HOLLOW, MN. LOWE, F. — MILLBROOK, OH. LOWE, F. — KETTLE CROSSING, WI.',
  done: [
    { who: F, text: 'Friday he sells it. Tonight he\'ll notice the card is gone. And Carmine doesn\'t call the police.' },
    { who: F, text: 'He\'ll send somebody to the watch house first. Then I go to Broad Street.' },
  ],
  reward: { xp: 80, jp: ['shadow', 15], items: { keycard: 1 } },
};

/** Mickey's warning before the strike on the watch house. */
export const STRIKE_WARNING = [
  { who: '', text: '(The phone. Mickey Doyle, out of breath.)' },
  { who: MK, text: 'Frankie. Carmine\'s nephew Sonny bought three boxes of shells at the Ironbound gun shop this morning and asked the clerk which way Short Hills was. Tonight. Ten, maybe eleven.' },
  { who: F, text: 'Then I\'ll be home.' },
];

export const BREAK_READY = [
  { who: F, text: '(Sonny Ventura won\'t be bringing anybody back to Broad Street. Carmine will know by midnight. Carmine will be in his office counting what\'s left.)' },
  { who: F, text: 'Broad Street. After dark. Keycard, records room, the list.' },
];

/** In the records room: Carmine, the list, and what Frank does with it. */
export const FINALE = (s) => [
  { who: '', text: '(Carmine Ventura is sitting on a box of files in the records room with his tie undone. He doesn\'t reach for anything. He was never that kind of man.)' },
  { who: CV, text: 'Frankie Corsetti. Do you know how many houses I\'ve read about? Nineteen years. Every one of you thought cash was invisible.' },
  { who: CV, text: 'It\'s just paper. Twenty-two boxes of it. Take it, burn it, sell it. Somebody always writes it down again.' },
  { who: F, text: 'Not this time.', choices: [
    { text: 'Hand the boxes to Agent Reyes — and Carmine with them', value: 'reyes' },
    { text: 'Give it to the Star-Ledger: put Keystone on the front page', value: 'press' },
    { text: 'Burn it. All of it. Right here.', value: 'burn' },
    { text: 'Keep it. A list like this is worth more than money.', value: 'keep' },
  ] },
];

export const OUTCOME = {
  reyes: [
    { who: RY, text: '(Reyes is at the curb before you\'ve carried the second box out. She doesn\'t ask how she knew to be there.) Every name. Every closing. And a title company that just became a crime scene.' },
    { who: RY, text: 'Four hundred and twelve families get new paperwork this month, Mr. Lowe. None of them will ever know your name. I think that\'s how you\'d want it.' },
  ],
  press: [
    { who: '', text: '(A reporter named Ruth Marino from the Star-Ledger meets you at the all-night diner. She reads three pages and stops eating.)' },
    { who: F, text: '(KEYSTONE: THE TITLE COMPANY THAT SOLD WITNESSES. Front page, Sunday. Every name blacked out but one: Keystone\'s. Carmine is indicted by Wednesday. Your own face is on page four. Somebody in Pine Hollow is going to see it.)' },
  ],
  burn: [
    { who: '', text: '(You carry the boxes to the alley and set them on fire in a dumpster, one at a time. It takes two hours. Carmine watches from the back door and doesn\'t say a word.)' },
    { who: F, text: 'Nineteen years of houses. Gone. Carmine walks, and he knows it — but nobody will ever buy that list again, because there isn\'t one.' },
  ],
  keep: [
    { who: '', text: '(You load twenty-two boxes into the trunk. Carmine helps. He looks relieved, the way men do when they find out who they work for.)' },
    { who: F, text: '(Every rat who ever ran. Every family that ever hid. All of them, in your garage in Short Hills. You tell yourself it\'s so no one else can have it.)' },
  ],
};

/** A letter a week later, depending on what happened to the list. */
export const AFTER_LETTER = {
  reyes: { who: 'Marcus Bell', text: '"Frank — the Boise family sent a card to the office. It just says THANK YOU in a kid\'s handwriting. I\'m keeping it. You\'d only lose it. — M."' },
  press: { who: 'Dee Marsh', text: '"Frank. Saw your picture in a Newark paper at the library in Duluth. I always knew there was a story. I just didn\'t think it was a good one. I was wrong. Come see us. — Dee"' },
  burn: { who: 'Marcus Bell', text: '"Nobody\'s moving this month. First time in a year. Carmine closed the office and went to Florida. Whatever you did, it worked. Don\'t tell me what it was. — M."' },
  keep: { who: 'Carmine Ventura', text: '"Mr. Corsetti — the boxes are well? Philadelphia has asked again. I told them the list belongs to someone now. They were very respectful. — C.V."' },
};
