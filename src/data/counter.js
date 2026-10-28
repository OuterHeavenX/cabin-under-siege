// Counter-moves: optional missions that use what Frank has learned to blunt
// the coming attack, and friends he can ask for help in the last days before
// it. Each has a visible, limited effect (one fewer attacker, a later wave,
// more warning, a wave marked) — never enough to make the night trivial.
// They lapse once the attack has happened; nothing is lost if you skip them.
const F = 'Frank';

/** Is the chapter's big attack over (or under way)? Counter-moves lapse then. */
const pastSiege = (n) => (s) => {
  if (s.chapter !== n) return s.chapter > n;
  const order = { 1: ['first_siege', 'search_body', 'show_ruth', 'phone_call', 'free', 'leave_town'], 2: ['ch2_siege', 'ch2_phone', 'ch2_marcus_truth', 'ch2_free'], 3: ['ch3_siege', 'ch3_ledger', 'ch3_ingrid_truth', 'ch3_free'], 4: ['ch4_siege', 'ch4_ring', 'ch4_eleanor_truth', 'ch4_free'], 5: ['ch5_siege', 'ch5_plans', 'ch5_assault', 'ch5_free'] }[n];
  return order.slice(1).includes(s.story.step) || !!((s.life.ch[n] || {}).siegeStarted);
};

export const COUNTER_ERRANDS = {
  k1_blind: {
    chapter: 1, counter: true, title: 'The Watcher\'s Blind', until: pastSiege(1),
    missed: 'You never went back to the blind. Their spotter watched the cabin right up to the attack.',
    desc: 'They watched the cabin from the hunting blind once. They\'ll do it again before they attack.',
    stages: [
      { type: 'fight', map: 'cabin', at: [9.5, 7.6], hours: [22, 3], label: 'Catch their spotter at the hunting blind (10 PM–3 AM) — quietly, if you can', enemies: ['scout', 'scout'], names: ['Spotter', 'Spotter'],
        before: [{ who: F, text: '(Two shapes in the blind. A thermos, a radio, binoculars on your bedroom window. Neither of them is watching behind.)' }],
        after: [{ who: F, text: '(Their radio crackles: "Blind, check in." Nobody answers. Whoever comes for the cabin comes blind now.)' }] },
    ],
    done: [],
    reward: { xp: 50, jp: ['shadow', 10] },
    effect: 'One fewer scout in the first wave of the attack — they lost their spotter.',
  },
  k1_help_gus: { chapter: 1, help: true, npc: 'gus', effect: 'Gus parks his truck across the west trail with the high beams on: the west wave comes later, and he drops off 4 wood.' },

  k2_lot: {
    chapter: 2, counter: true, title: 'The Blue Pontiac', until: pastSiege(2),
    missed: 'The blue Pontiac left the library lot before you got to it.',
    desc: 'Sal\'s scouts park a blue Pontiac in the library lot and walk over through the yards.',
    stages: [
      { type: 'visit', map: 'millbrook', at: [62.5, 27.6], hours: [20, 2], early: 'They park there in the evening. Come back after 8 PM.', label: 'Find the blue Pontiac behind the library (8 PM–2 AM)', lines: [
        { who: F, text: '(The Pontiac, empty, unlocked. A road atlas open to Ohio, a thermos, a Polaroid camera. Illinois plate KX-4471.)' },
        { who: F, text: 'What do I do with it?', choices: [
          { text: 'Let the air out of all four tires.', value: 'tires', lines: [{ who: F, text: '(Hiss, hiss, hiss, hiss. They\'ll be walking to Larch Street on the night it counts — late.)' }] },
          { text: 'Copy the plate and give it to Marcus.', value: 'plate', lines: [{ who: 'Marcus Bell', text: '(On the radio, later.) KX-4471. Got it. When that car moves, I\'ll know, and so will you.' }] },
        ] },
      ] },
    ],
    done: [],
    reward: { xp: 45, jp: ['shadow', 8] },
    effect: 'Tires: the first wave arrives late. The plate: Marcus warns you an hour sooner.',
  },
  k2_help_marcus: { chapter: 2, help: true, npc: 'marcus', effect: 'Marcus watches Larch Street with his radio: an hour more warning, and the first wave is marked when it arrives.' },

  k3_ford: {
    chapter: 3, counter: true, title: 'Close the Ford', until: pastSiege(3),
    missed: 'The creek ford stayed open. Vinnie\'s trucks will use it.',
    desc: 'The crew staged at the creek ford. Block it and they have to come the long way.',
    stages: [
      { type: 'repair', map: 'farm', at: [24, 43], hits: 4, wood: 4, label: 'Block the creek ford with logs and wire (Toolkit + 4 wood)' },
    ],
    done: [{ who: F, text: 'Logs across the ford, wired down. A truck could push through. Not quickly. Not quietly.' }],
    reward: { xp: 45, jp: ['handyman', 8] },
    effect: 'The south wave (Vinnie\'s) loses a man and arrives later.',
  },
  k3_help_ingrid: { chapter: 3, help: true, npc: 'ingrid', effect: 'Ingrid parks her tractor on the rise with every light on: the snipers in the east field are lit up and marked all night.' },

  k4_channel: {
    chapter: 4, counter: true, title: 'Chain the Channel', until: pastSiege(4),
    missed: 'The boathouse channel stayed open. Nico\'s boats will use it.',
    desc: '"Use the shore." Nico\'s boats mean to land at the boathouse channel.',
    stages: [
      { type: 'repair', map: 'estate', at: [57.5, 33.4], hits: 4, wood: 2, label: 'Chain off the boathouse channel (Toolkit + 2 wood)' },
      { type: 'return', label: 'Tell Walt the channel is chained' },
    ],
    giver: 'walt',
    done: [{ who: 'Walt Bishop', text: 'Chain across the channel. Low. They\'ll find it with their propeller. (Almost a smile.) Good.' }],
    reward: { xp: 45, jp: ['handyman', 8], rel: ['walt', 6] },
    effect: 'The boats off the lake have to land farther down the shore: they arrive later and one fewer.',
  },
  k4_help_walt: { chapter: 4, help: true, npc: 'walt', effect: 'Walt watches the lake from the club dock with a radio and a flare gun: an hour more warning, and the lake wave is marked.' },

  k5_richie: {
    chapter: 5, counter: true, title: 'Richie Bruno', until: pastSiege(5), needs: (s) => ((s.life.ch[5] || {}).watch || {}).richie === 'home',
    missed: 'Richie stayed with his brother.',
    desc: 'Carlo\'s little brother didn\'t want to be on the ridge. Give him a reason to leave.',
    stages: [
      { type: 'visit', map: 'shorthills', at: [50.5, 4.6], hours: [16, 22], early: 'Richie sits on the ridge road in the evening.', label: 'Talk to Richie Bruno on Old Short Hills Road (4–10 PM)', lines: [
        { who: 'Richie Bruno', text: 'You came back. (He offers you a cigarette. You both remember you quit together, in 1997.)' },
        { who: 'Richie Bruno', text: 'Carlo\'s got six guys and the plans to your place. Thursday. I drive. I always drive.', choices: [
          { text: '"Don\'t drive. Your kids are in Toms River. Go see them."', value: 'kids', lines: [{ who: 'Richie Bruno', text: '(A long time.) ...Carlo will kill me. (Longer.) Carlo will have to find me first.' }] },
          { text: '"Then drive slow."', value: 'slow', lines: [{ who: 'Richie Bruno', text: 'Ha. Slow. (He looks at his hands.) Yeah. Slow I can do.' }] },
        ] },
      ] },
    ],
    done: [],
    reward: { xp: 60, jp: ['neighbor', 10] },
    effect: 'Richie doesn\'t drive Carlo\'s crew up the north lane: one fewer attacker there.',
  },
};

/** "Will you help?" — asked in the last days before an attack, once per friend. */
export const ALLY_HELP = {
  gus: { ch: 1, minRel: 2, lines: [
    { who: F, text: 'Gus. They\'re coming for the cabin. Soon. I\'m not asking you to stand in front of anything.' },
    { who: 'Gus Okafor', text: '(He wipes his hands on a rag for a long time.) West trail\'s the only flat way in from the woods. My truck\'s got a light bar.', choices: [
      { text: '"Park it across the trail when it starts. Then go home. Please."', value: 'yes', lines: [{ who: 'Gus Okafor', text: 'Army engineers block roads. It\'s the only thing we\'re good at. (He throws four planks in your trunk.) For the windows.' }] },
      { text: '"No. Stay out of it, Gus."', value: 'no', lines: [{ who: 'Gus Okafor', text: 'Your call. (He doesn\'t like it.)' }] },
    ] },
  ] },
  marcus: { ch: 2, minRel: 2, lines: [
    { who: F, text: 'Marcus. Sal\'s coming. I need eyes on the street.' },
    { who: 'Marcus Bell', text: 'You\'ve had eyes on the street since the day you moved in, Frank. You\'re asking if I\'ll use the radio.', choices: [
      { text: '"I\'m asking."', value: 'yes', lines: [{ who: 'Marcus Bell', text: 'Then I\'ll be at my window with the scanner and a thermos. When they turn onto Larch, you\'ll know before they do.' }] },
      { text: '"Forget it. Keep your head down."', value: 'no', lines: [{ who: 'Marcus Bell', text: 'Twenty-six years, I never kept my head down once. But fine.' }] },
    ] },
  ] },
  ingrid: { ch: 3, minRel: 2, lines: [
    { who: F, text: 'Ingrid. Vinnie\'s coming with trucks and rifles. The east field is open ground.' },
    { who: 'Ingrid Haugen', text: 'The rise by my silo looks down on the whole east field. My tractor has eight floodlights for night calving.', choices: [
      { text: '"Light it up when it starts. Then get down behind the silo."', value: 'yes', lines: [{ who: 'Ingrid Haugen', text: 'Pa did the same in \'79. The men in the field didn\'t like it. Good.' }] },
      { text: '"Stay inside, Ingrid. Lock your door."', value: 'no', lines: [{ who: 'Ingrid Haugen', text: 'I\'ll lock my door. I won\'t like it.' }] },
    ] },
  ] },
  walt: { ch: 4, minRel: 2, lines: [
    { who: F, text: 'Walt. Nico\'s coming off the lake. I need someone watching the water.' },
    { who: 'Walt Bishop', text: 'Club dock sees the whole bay. Flare gun. Radio. Thermos.', choices: [
      { text: '"Call it in when you see them. Then stay down."', value: 'yes', lines: [{ who: 'Walt Bishop', text: 'Aye.' }] },
      { text: '"Not your fight, Walt."', value: 'no', lines: [{ who: 'Walt Bishop', text: '...Mm.' }] },
    ] },
  ] },
};
