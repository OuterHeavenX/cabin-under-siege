// Everyday life content: the "make it home" step of each chapter, quiet-day
// events, friends who come to stay, farewells before a move, and Ruth's
// conversations. Lines are short on purpose — they have to read on a phone.
const F = 'Frank';
const R = 'Ruth Calloway';
const done = (s, id) => (s.errands[id] || {}).state === 'done';
const rel = (s, id) => Math.min(5, Math.floor((s.rel[id] || 0) / 20));
const ruthIn = (s) => !!(s.companion && s.companion.ruth && s.companion.ruth.joined);
const carDone = (s) => !!(s.life && s.life.car && s.life.car.done) || !!(s.perks && s.perks.mechanic);

/** The menu of ordinary things that make a place home. Any few will do. */
export const MOMENTS = {
  cards: { label: 'Sit in at the card table (Wed & Sat, 7–11 PM)', done: 'A night at the card table' },
  supper: { label: 'Go to Sunday supper (5–8 PM)', done: 'Sunday supper with the town' },
  market: { label: 'Buy something on market day (Friday)', done: 'Market day in town' },
  fair: { label: 'Try the shooting gallery on fair day', done: 'A day at the fair' },
  outdoors: { label: 'Go fishing or hunting', done: 'Time outdoors' },
  meal: { label: 'Cook a meal at your stove', done: 'A home-cooked meal' },
  garden: { label: 'Pick vegetables from a garden', done: 'Fresh from the garden' },
  gift: { label: 'Bring someone food as a gift', done: 'A gift for a friend' },
  project: { label: 'Put a day\'s work into a home project', done: 'A day\'s work on the place' },
  help: { label: 'Help someone — a favor or part of their story', done: 'Helping a neighbor' },
  event: { label: 'Say yes when someone invites you or drops by', done: 'Time with friends' },
};

/** Phase B of every chapter: settle into a routine before the trouble starts. */
export const LIFE_STEPS = {
  1: {
    step: 'ch1_life', obj: 'Make Pine Hollow home',
    start: [
      { who: F, text: 'Gus vouched for me. People wave now. Dee knows how I take my coffee.' },
      { who: F, text: 'Twenty years I never stayed anywhere long enough to have a routine. Let\'s see what one feels like.' },
    ],
    done: () => [
      { who: F, text: 'Cards on Wednesday. Pie on Sunday. Wood stacked by the door. I caught myself whistling this morning.' },
      { who: F, text: 'Frankie Corsetti never whistled. Maybe that\'s the whole trick.' },
    ],
  },
  2: {
    step: 'ch2_life', obj: 'Make Larch Street home',
    start: [
      { who: F, text: 'Steady work, a mailbox, a neighbor who logs my license plate. Millbrook could be a life, if I let it.' },
    ],
    done: (s) => [
      { who: F, text: 'Pete calls me "Frankie" like it\'s a joke we share. Rosa yells at me in Spanish. Marcus nods from his porch every night at nine.' },
      { who: F, text: ruthIn(s) ? 'Ruth has the back garden dug and planted. She says tomatoes don\'t care what state they\'re in.' : 'I almost wrote to Ruth last night. Almost.' },
    ],
  },
  3: {
    step: 'ch3_life', obj: 'Make the farm home',
    start: [
      { who: F, text: 'Two hundred acres, a co-op job and a neighbor who measures people by how they handle a shovel. Time to dig in.' },
    ],
    done: (s) => [
      { who: F, text: 'Up before the sun, sore by noon, asleep by nine. Kettle Crossing has a way of wearing the city off a man.' },
      { who: F, text: s.choices && s.choices.marcusHelp ? 'Ingrid called me "neighbor" at the co-op today. In front of Tess. Tess nearly dropped her clipboard.' : 'Ingrid lent me her post-hole digger today without being asked. Out here, that\'s a handshake.' },
    ],
  },
  4: {
    step: 'ch4_life', obj: 'Make the estate home',
    start: [
      { who: F, text: 'A caretaker\'s job, a manor that isn\'t mine and a lake that goes to Canada. I could get used to the quiet. That worries me.' },
    ],
    done: (s) => [
      { who: F, text: 'Walt nods at me on the dock. Theo puts my name on jam labels. Mrs. Whitcombe corrects my grammar. It feels like belonging.' },
      { who: F, text: ruthIn(s) ? 'Ruth and Eleanor have tea every afternoon now. I\'m not invited. I\'m told this is a compliment.' : 'The lake goes pink at sunset. I watched the whole thing from the dock tonight, which I have never done in my life.' },
    ],
  },
  5: {
    step: 'ch5_life', obj: 'Make Short Hills home again',
    start: [
      { who: F, text: 'The avenue\'s warming up. Angie saves me a seat. Dom saves me a pew. Leo\'s house glows on the ridge every night.' },
      { who: F, text: 'If this is the last place, I want it to be a home first. Not a fort.' },
    ],
    done: () => [
      { who: F, text: 'Mrs. Ferraro pinches my cheek. Paulie asks me about girls. Mickey tells everyone I stole a hearse. It\'s the avenue I grew up on — minus the fear.' },
      { who: F, text: 'Almost minus the fear. The light in Leo\'s study is still on at two in the morning.' },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* Quiet-day events. One a day at most, never in a fight, conversation  */
/* or with an attack due. `after`/`before` are story steps; `where` is  */
/* home or town; `errand` starts an invitation that lapses if ignored.  */
/* ------------------------------------------------------------------ */
export const LIFE_EVENTS = [
  /* ---------------- Chapter 1: Pine Hollow ---------------- */
  { id: 'c1_gus_coffee', chapter: 1, title: 'Gus drops by', after: 'town_trust', where: 'home', hours: [7, 11], moment: true,
    lines: [
      { who: '', text: '(A pickup crunches up the driveway. Gus Okafor gets out with two coffees and squints at your roof.)' },
      { who: 'Gus Okafor', text: 'Was driving by. That\'s a lie, nobody drives by out here. Wanted to see what you did with Harold\'s place.',
        choices: [
          { text: '"Come in. I\'ll give you the tour."', value: 'tour', lines: [{ who: 'Gus Okafor', text: '(He checks every joint you\'ve touched.) Square. Plumb. ...Back door hinge is weak. Here, I brought a spare. Don\'t ask why.' }] },
          { text: '"Porch is fine. Sit."', value: 'porch', lines: [{ who: 'Gus Okafor', text: '(You drink coffee and say nothing for twenty minutes. It\'s the best conversation you\'ve had in years.)' }] },
        ] },
    ],
    reward: { rel: ['gus', 6], jp: ['neighbor', 4] } },
  { id: 'c1_ruth_pie', chapter: 1, title: 'Rhubarb pie', after: 'town_trust', where: 'home', hours: [16, 19], moment: true, needs: (s) => rel(s, 'ruth') >= 1 && !ruthIn(s),
    lines: [
      { who: R, text: '(Ruth is at your door with a pie dish wrapped in a towel.) Rhubarb. It\'s the only thing that grows faster than my worries.' },
      { who: R, text: 'Sit. Eat. Tell me one true thing about yourself. Just one. I\'ve been neighborly for weeks and I know nothing.',
        choices: [
          { text: '"My mother made pie like this. Sunday mornings, before Mass."', value: 'ma', lines: [{ who: R, text: '(She pats your hand once.) Then she raised you better than you let on.' }] },
          { text: '"I\'m a better man here than I was anywhere else."', value: 'here', lines: [{ who: R, text: 'That\'s two true things. Don\'t get carried away.' }] },
          { text: '"Not today, Ruth."', value: 'no', lines: [{ who: R, text: 'Fair enough. The pie doesn\'t need to know either.' }] },
        ] },
    ],
    reward: { rel: ['ruth', 8], items: { pie: 1 } } },
  { id: 'c1_car_trouble', chapter: 1, title: 'Car trouble', after: 'find_work', where: 'town', arrival: true, hours: [7, 11], needs: (s) => !carDone(s),
    lines: [
      { who: '', text: '(Your car coughs, shudders, and dies right in front of the diner. Old Man Tibbs applauds from a bench.)' },
      { who: F, text: 'Fuel pump, by the sound of it. The car\'s older than it looks, and it looks old.',
        choices: [
          { text: 'Fix it yourself on the curb (Toolkit — an hour of your morning)', value: 'fix', lines: [{ who: F, text: '(Greasy, slow, satisfying. Tibbs offers advice the whole time. Half of it is good.)' }] },
          { text: 'Let Gus tow it to the yard ($15)', value: 'tow', cost: 15, fallback: 'fix', lines: [{ who: 'Gus Okafor', text: 'Twenty years in the Corps and they still call me for tow jobs. Get in.' }] },
        ] },
    ],
    result: (s, v) => { if (v === 'fix') { s.time.minute = Math.min(s.time.minute + 60, 1439); } },
    note: 'That car won\'t last forever. (A car restoration project is on your Home tab.)' },
  { id: 'c1_storm', chapter: 1, title: 'A summer storm', after: 'ch1_life', where: 'home', hours: [12, 18], weather: 'rain', sound: 'warning',
    lines: (s) => [
      { who: '', text: '(The sky goes green, then black. Rain comes sideways off the ridge and the pines groan.)' },
      done(s, 'chore_roof') ? { who: F, text: 'The roof holds. Not a drip. Harold, you owe me two now.' } : { who: F, text: 'Drip. Drip. The bedroom ceiling again. A pot under it and a promise to myself.' },
      { who: R, text: '(Ruth, on the phone, shouting over the line noise.) Frank! The wind took my garden fence clean down. Don\'t you come out in this — tomorrow will do.' },
    ],
    errand: 'c1_fence', moment: false, needs: (s) => !ruthIn(s) },
  { id: 'c1_tibbs_fishing', chapter: 1, title: 'An invitation from Tibbs', after: 'ch1_life', where: 'town', hours: [9, 18], errand: 'c1_fish', moment: false,
    lines: [
      { who: 'Old Man Tibbs', text: 'Calloway-cabin man. You fish? Course you don\'t. Still Pond, sunrise tomorrow. I\'ll bring the worms and the lies.' },
      { who: F, text: '(It isn\'t really a question.)' },
    ] },
  { id: 'c1_memorial', chapter: 1, title: 'Walt Marsh\'s memorial', after: 'rest', where: 'town', hours: [8, 18], errand: 'c1_walt', needs: (s) => rel(s, 'dee') >= 1,
    lines: [
      { who: 'Pastor Abe', text: 'Frank. Tomorrow evening is five years since Walt Marsh passed. Dee won\'t ask anyone. She\'d like to see a few faces at the chapel. Six o\'clock.' },
    ] },

  /* ---------------- Chapter 2: Millbrook ---------------- */
  { id: 'c2_cookout', chapter: 2, title: 'Pete\'s cookout', after: 'ch2_life', where: 'home', hours: [9, 17], errand: 'c2_cookout',
    lines: [
      { who: 'Pete Kowalski', text: '(Pete leans on your fence.) FRANKIE. Saturday. My yard. Bratwurst, horseshoes, the whole street. You\'re bringing nothing and you\'re coming anyway.' },
    ] },
  { id: 'c2_chess', chapter: 2, title: 'Chess on Marcus\'s porch', after: 'ch2_life', where: 'home', hours: [19, 22], moment: true,
    lines: [
      { who: 'Marcus Bell', text: '(Marcus calls across the street.) You play chess, Frank? Sit. I need somebody who doesn\'t telegraph every move.' },
      { who: 'Marcus Bell', text: '(Forty minutes in, he takes your queen.) You protect your king like he owes you money. Who taught you?',
        choices: [
          { text: '"A man named Leo. A long time ago."', value: 'leo', lines: [{ who: 'Marcus Bell', text: '(He doesn\'t look up from the board.) Then you learned from a man who sacrifices pieces. Don\'t be him.' }] },
          { text: '"Nobody. I watched people."', value: 'watch', lines: [{ who: 'Marcus Bell', text: 'Best way. Same way I learned everything worth knowing.' }] },
        ] },
    ],
    reward: { rel: ['marcus', 8], jp: ['shadow', 4] } },
  { id: 'c2_rosa_advice', chapter: 2, title: 'Rosa asks for advice', after: 'ch2_life', where: 'town', hours: [9, 18], moment: true,
    lines: [
      { who: 'Rosa Delgado', text: 'Frank. A man from Home Depot wants to buy the store. Good money. I\'d never stand behind a counter again.' },
      { who: 'Rosa Delgado', text: 'Papi built this place in 1962. You\'re a man who started over. What would you do?',
        choices: [
          { text: '"Keep it. Some things are worth more than money."', value: 'keep', lines: [{ who: 'Rosa Delgado', text: '(She looks at the van photo behind the register.) ...Yeah. Yeah. I knew that. I needed somebody to say it.' }] },
          { text: '"Sell. Starting over isn\'t losing. Trust me."', value: 'sell', lines: [{ who: 'Rosa Delgado', text: 'You would know. (A long breath.) I\'ll think about it. Don\'t tell my sister.' }] },
        ] },
    ],
    result: (s, v) => { s.choices.rosaStore = v; },
    reward: { rel: ['rosa', 6] } },
  { id: 'c2_blackout', chapter: 2, title: 'Blackout on Larch Street', after: 'ch2_rosa', where: 'home', hours: [18, 22], weather: 'rain', errand: 'c2_pruitt',
    lines: [
      { who: '', text: '(Thunder, a flicker, and the whole street goes dark. Somewhere a dog starts howling.)' },
      { who: 'Marcus Bell', text: '(Flashlight across the street.) Transformer on Main. Hours, maybe. Old Mr. Pruitt\'s on oxygen, Frank. His machine runs on the wall.' },
    ] },
  { id: 'c2_car', chapter: 2, title: 'Flat on Route 9', after: 'ch2_job', where: 'town', arrival: true, hours: [7, 10], needs: (s) => !carDone(s),
    lines: [
      { who: '', text: '(A flat on the way to Pete\'s. The spare is also flat. Of course it is.)' },
      { who: F, text: 'Pete\'s yard is a mile. My pride is longer.',
        choices: [
          { text: 'Walk it and roll the tire (be late)', value: 'walk', lines: [{ who: 'Pete Kowalski', text: 'You ROLLED it? A mile? Frankie, you have a phone! ...I respect it.' }] },
          { text: 'Pay the Shell station to come out ($12)', value: 'pay', cost: 12, fallback: 'walk', lines: [{ who: F, text: '(Fourteen minutes and a lecture about tire pressure.)' }] },
        ] },
    ],
    result: (s, v) => { if (v === 'walk') s.time.minute = Math.min(s.time.minute + 50, 1439); } },
  { id: 'c2_trivia', chapter: 2, title: 'Library trivia night', after: 'ch2_life', where: 'town', weekday: 'Tuesday', hours: [10, 18], moment: true,
    lines: [
      { who: 'Mrs. Ortiz', text: 'Mr. Lowe! Library trivia, tonight, we need a fifth. Our captain has gout. Do you know things?',
        choices: [
          { text: '"I know things."', value: 'yes', lines: [{ who: '', text: '(You get every question about New Jersey, boxing and 1980s cars right. Mrs. Ortiz\'s team wins a sheet cake. You are a hero to six retirees.)' }] },
          { text: '"I know some things. Mostly about cars."', value: 'cars', lines: [{ who: '', text: '(Third place. A coffee mug that says MILLBROOK READS. You keep it on the windowsill.)' }] },
        ] },
    ],
    reward: { xp: 15, rel: ['marcus', 2], jp: ['neighbor', 4] } },

  /* ---------------- Chapter 3: Kettle Crossing ---------------- */
  { id: 'c3_hay', chapter: 3, title: 'Beat the rain', after: 'ch3_life', where: 'home', hours: [7, 12], errand: 'c3_hay',
    lines: [
      { who: 'Ingrid Haugen', text: '(Ingrid on her tractor, not stopping.) Rain by four. Forty bales on the ground. You have arms. Come.' },
    ] },
  { id: 'c3_bo_fish', chapter: 3, title: 'Bo goes fishing', after: 'ch3_life', where: 'town', hours: [9, 18], errand: 'c3_creek',
    lines: [
      { who: 'Bo Lindqvist', text: 'Walleye are running in the creek past your north field. Dawn tomorrow. I\'ll bring the thermos. You bring your silence, if you\'ve got any.' },
    ] },
  { id: 'c3_tractor', chapter: 3, title: 'Ingrid\'s tractor', after: 'ch3_job', where: 'home', hours: [8, 17], moment: true,
    lines: [
      { who: 'Ingrid Haugen', text: '(Ingrid\'s tractor sits dead in her lane. She glares at it like it insulted her father.) Starter. Again. Don\'t say anything.',
        choices: [
          { text: 'Say nothing. Hand her the right wrench.', value: 'wrench', lines: [{ who: 'Ingrid Haugen', text: '(She takes it without looking. Ten minutes later it roars.) ...You can stay for coffee.' }] },
          { text: '"Want me to take a look?"', value: 'look', lines: [{ who: 'Ingrid Haugen', text: 'I want you to not take a look. ...Fine. Look. (You fix it. She will never mention it again.)' }] },
        ] },
    ],
    reward: { rel: ['ingrid', 8], jp: ['handyman', 4] } },
  { id: 'c3_storm', chapter: 3, title: 'Storm on the prairie', after: 'ch3_deputy', where: 'home', hours: [13, 19], weather: 'rain', sound: 'warning', errand: 'c3_cows',
    lines: [
      { who: '', text: '(Hail like gravel. The sky over the pasture goes the color of a bruise.)' },
      { who: 'Ingrid Haugen', text: '(On the phone.) Lightning took my east fence. Three heifers are out on your side. If the deputy finds them on the road he\'ll fine me. Find them, Frank.' },
    ] },
  { id: 'c3_tess_bday', chapter: 3, title: 'Tess turns fifty', after: 'ch3_life', where: 'town', hours: [9, 17], errand: 'c3_bday',
    lines: [
      { who: 'Bo Lindqvist', text: 'Tess turns fifty tomorrow and thinks nobody knows. Café, seven o\'clock. Bring a card. Don\'t sing. She hates singing.' },
    ] },
  { id: 'c3_car', chapter: 3, title: 'Mud season', after: 'ch3_job', where: 'home', hours: [7, 11], needs: (s) => !carDone(s),
    lines: [
      { who: '', text: '(Your car is axle-deep in the lane. Overnight rain turned the drive into chocolate pudding.)' },
      { who: 'Ingrid Haugen', text: '(Ingrid arrives on the tractor with a chain, unasked.) City cars. (She pulls you out in thirty seconds.) Get a truck, Frank.',
        choices: [
          { text: '"Thank you, Ingrid."', value: 'thanks', lines: [{ who: 'Ingrid Haugen', text: 'Mm.' }] },
          { text: '"I had it handled."', value: 'pride', lines: [{ who: 'Ingrid Haugen', text: '(She almost laughs. Almost.) Sure you did.' }] },
        ] },
    ],
    reward: { rel: ['ingrid', 4] } },

  /* ---------------- Chapter 4: Port Whitcombe ---------------- */
  { id: 'c4_tea', chapter: 4, title: 'Tea at the gatehouse', after: 'ch4_life', where: 'home', hours: [15, 18], moment: true,
    lines: [
      { who: 'Eleanor Whitcombe', text: 'Mr. Lowe. Tea. Now. I have decided you are interesting and I want to know why.' },
      { who: 'Eleanor Whitcombe', text: 'Edward used to sit in that chair and lie to me beautifully for an hour. You may lie badly, if you prefer.',
        choices: [
          { text: 'Tell her about Newark. Some of it.', value: 'truth', lines: [{ who: 'Eleanor Whitcombe', text: '(She listens without blinking.) Thank you. Edward never once gave me the courtesy of the ugly parts.' }] },
          { text: '"I\'m a caretaker who likes quiet lakes."', value: 'lie', lines: [{ who: 'Eleanor Whitcombe', text: 'Badly, as promised. More tea?' }] },
        ] },
    ],
    reward: { rel: ['eleanor', 8] } },
  { id: 'c4_regatta', chapter: 4, title: 'The regatta', after: 'ch4_life', where: 'home', hours: [9, 17], errand: 'c4_regatta',
    lines: [
      { who: 'Theo Park', text: '(Theo at the gate, breathless.) Frank! Saturday! The club regatta! I have a booth! Jam! Come stand next to it and look rugged!' },
    ] },
  { id: 'c4_walt_dawn', chapter: 4, title: 'Walt\'s dawn', after: 'ch4_life', where: 'home', hours: [5, 8], moment: true,
    lines: [
      { who: '', text: '(Walt Bishop is on your dock with two rods and a thermos, as if you\'d arranged it. You hadn\'t.)' },
      { who: 'Walt Bishop', text: 'Perch.' },
      { who: '', text: '(An hour passes. He catches six. You catch one. He nods at yours like it\'s the important one.)' },
      { who: 'Walt Bishop', text: 'Navy took twenty years from me. Lake gave some back. Might do the same for you.' },
    ],
    reward: { rel: ['walt', 8], items: { fish: 2 } } },
  { id: 'c4_noreaster', chapter: 4, title: 'Nor\'easter', after: 'ch4_reyes', where: 'home', hours: [12, 18], weather: 'rain', sound: 'warning', errand: 'c4_boats',
    lines: [
      { who: '', text: '(The lake turns grey and angry. Whitecaps. The flagpole by the club is singing.)' },
      { who: 'Walt Bishop', text: '(Radio, crackling.) Caretaker. Club launches are slamming the south dock. I\'m one man. Lines need doubling.' },
    ] },
  { id: 'c4_lost_dog', chapter: 4, title: 'The Commodore\'s dog', after: 'ch4_job', where: 'town', hours: [9, 17], errand: 'c4_pepper',
    lines: [
      { who: 'Commodore Ames', text: 'Young man. My dog has deserted. Pepper. A spaniel of poor character. She was last seen pursuing a sandwich toward the west woods.' },
    ] },

  /* ---------------- Chapter 5: Short Hills ---------------- */
  { id: 'c5_gravy', chapter: 5, title: 'Sunday gravy', after: 'ch5_life', where: 'town', hours: [9, 17], errand: 'c5_gravy',
    lines: [
      { who: 'Angie Marchetti', text: 'Sunday. My place. Two o\'clock. Gravy, braciole, my aunt Connie who will ask why you\'re not married. Come hungry.' },
    ] },
  { id: 'c5_boxing', chapter: 5, title: 'Thursday boxing', after: 'ch5_life', where: 'town', hours: [9, 18], errand: 'c5_boxing',
    lines: [
      { who: 'Father Dominic Russo', text: 'Thursday night, the basement. Eleven boys and one ring. They need to see a man who walked away from Leo still standing. Come.' },
    ] },
  { id: 'c5_paulie', chapter: 5, title: 'Paulie\'s question', after: 'ch5_life', where: 'town', hours: [9, 18], moment: true,
    lines: [
      { who: 'Paulie the paperboy', text: 'Mr. Corsetti. A guy at the Ravenna club says I could run slips for him. Forty bucks a week. My mom works two jobs. Is it bad?',
        choices: [
          { text: '"It starts with slips. It ends with you in a trunk. No."', value: 'no', lines: [{ who: 'Paulie the paperboy', text: '...My uncle said the same thing. He\'s in Rahway. (He swallows.) Okay. No.' }] },
          { text: '"Come work Mickey\'s yard Saturdays. I\'ll talk to him."', value: 'job', lines: [{ who: 'Mickey Doyle', text: '(Later.) A twelve-year-old in my yard. Fine. He sweeps. He learns. He doesn\'t run slips. Deal.' }] },
        ] },
    ],
    result: (s, v) => { s.choices.paulie = v; },
    reward: { rel: ['mickey', 4], jp: ['neighbor', 8], xp: 20 } },
  { id: 'c5_mickey_tow', chapter: 5, title: 'A ride from Mickey', after: 'ch5_find_work', where: 'town', arrival: true, hours: [7, 11], needs: (s) => !carDone(s),
    lines: [
      { who: '', text: '(Your car dies at the light on Millburn Avenue. Horns. A tow truck appears before you can open the hood.)' },
      { who: 'Mickey Doyle', text: 'Frankie Corsetti, stranded on the avenue. Want me to hook it, or is there a body in the trunk I should know about?' },
      { who: F, text: 'It was a LIMOUSINE, Mickey.' },
      { who: 'Mickey Doyle', text: '(He tows you for free and tells the story to three customers before lunch.)' },
    ],
    reward: { rel: ['mickey', 6] } },
  { id: 'c5_feast', chapter: 5, title: 'The Feast of St. Rose', after: 'ch5_life', where: 'town', weekday: 'Saturday', hours: [11, 19], moment: true,
    lines: [
      { who: '', text: '(The avenue is strung with lights. Zeppole, a brass band, old men arguing about 1962. Someone carries the saint past the deli.)' },
      { who: 'Mrs. Ferraro', text: 'Rosa\'s boy! Pin a dollar on the saint. For your mother. (She pins it for you when your hands don\'t move.)' },
      { who: F, text: 'Thirty years since I stood on this avenue for the feast. Ma held my hand right there by the bakery.' },
    ],
    reward: { xp: 25, rel: ['dom', 6], rel2: ['angie', 4] } },
];

/* Invitations and small favors started by those events. They lapse if you don't go. */
export const LIFE_ERRANDS = {
  c1_fence: {
    chapter: 1, event: true, lasts: 2, giver: 'ruth', title: 'Ruth\'s Fence', missed: 'Gus mended Ruth\'s fence before you got to it.',
    desc: 'The storm flattened Ruth\'s garden fence.',
    stages: [
      { type: 'repair', map: 'cabin', at: [41.5, 29.6], hits: 3, wood: 2, label: 'Mend Ruth\'s garden fence (Toolkit + 2 wood)' },
      { type: 'return', label: 'Tell Ruth her fence is standing' },
    ],
    done: [{ who: R, text: 'Straighter than Harold ever built it. Don\'t tell him I said so — I\'ll tell him myself on Sunday.' }],
    reward: { xp: 25, rel: ['ruth', 8], jp: ['handyman', 6] },
  },
  c1_fish: {
    chapter: 1, event: true, lasts: 2, giver: 'folk11', title: 'Sunrise at Still Pond', missed: 'Tibbs fished alone. He\'ll mention it.',
    desc: 'Old Man Tibbs invited you fishing at dawn.',
    stages: [
      { type: 'visit', map: 'cabin', at: [50.5, 12.4], hours: [5, 9], early: 'Tibbs said sunrise. Come back between 5 and 9 AM.', label: 'Meet Old Man Tibbs at Still Pond at sunrise (5–9 AM)', lines: [
        { who: 'Old Man Tibbs', text: 'Sit. Don\'t talk. Fish can hear talking. (He talks for an hour straight.)' },
        { who: 'Old Man Tibbs', text: 'Edna and me came here every Saturday for forty-one years. Never caught a thing worth eating. Best Saturdays of my life.' },
        { who: '', text: '(You catch two perch. Tibbs catches a boot and is delighted.)' },
      ] },
    ],
    done: [],
    reward: { xp: 25, items: { fish: 2 }, jp: ['survivor', 5], rel2: ['dee', 2] },
  },
  c1_walt: {
    chapter: 1, event: true, lasts: 2, giver: 'dee', title: 'Five Years', missed: 'You missed the memorial. Dee says it\'s fine. It isn\'t, quite.',
    desc: 'A memorial for Walt Marsh, Dee\'s late husband, at Hollow Chapel.',
    stages: [
      { type: 'visit', map: 'town', at: [39.5, 18.8], hours: [17, 21], early: 'The memorial is at six in the evening.', label: 'Stand with Dee at Hollow Chapel (5–9 PM)', lines: [
        { who: 'Pastor Abe', text: 'Walter Marsh ran the store for thirty years and never once balanced the books. Dee did it for him. Every night.' },
        { who: 'Dee Marsh', text: '(Afterwards, on the steps.) You came. ...Walt would\'ve liked you. He liked anybody who showed up.' },
        { who: 'Dee Marsh', text: 'Five years. You\'d think it gets quieter. It just gets... different.' },
      ] },
    ],
    done: [],
    reward: { xp: 30, rel: ['dee', 12], jp: ['neighbor', 6] },
    after: (s) => { s.life.romance.memorial = true; },
  },
  c2_cookout: {
    chapter: 2, event: true, lasts: 3, giver: 'pete', title: 'Pete\'s Cookout', missed: 'The cookout came and went without you. Pete saved you a bratwurst. It did not keep.',
    desc: 'The whole street at Pete\'s on Saturday.',
    stages: [
      { type: 'wait', weekday: 'Saturday', hour: 15, label: 'Pete\'s cookout is on Saturday afternoon' },
      { type: 'visit', map: 'millbrook', at: [33.5, 29.4], hours: [15, 20], label: 'Go to Pete\'s cookout (Saturday, 3–8 PM)', lines: [
        { who: '', text: '(Smoke, a radio playing the Indians game, Mrs. Ortiz cheating at horseshoes.)' },
        { who: 'Pete Kowalski', text: 'Frankie, take the tongs. A man who works the grill is a man the street trusts. That\'s science.' },
        { who: 'Marcus Bell', text: '(Marcus, quietly, by the cooler.) You stand where you can see the street. Every time. I noticed. They didn\'t.' },
      ] },
    ],
    done: [],
    reward: { xp: 30, rel: ['pete', 10], rel2: ['marcus', 4], items: { sandwich: 2 }, jp: ['neighbor', 6] },
  },
  c2_pruitt: {
    chapter: 2, event: true, lasts: 1, giver: 'marcus', title: 'Lights Out', missed: 'The power came back. Mr. Pruitt was fine. You should have checked anyway.',
    desc: 'Old Mr. Pruitt\'s oxygen machine needs power.',
    stages: [
      { type: 'visit', map: 'millbrook', at: [6.5, 32.4], label: 'Check on Old Mr. Pruitt in the blackout', lines: [
        { who: 'Old Mr. Pruitt', text: '(Wheezing, in the dark.) The tank. The spare tank, in the closet. My hands won\'t do the valve.' },
        { who: '', text: '(You switch him over to the backup tank by flashlight and sit with him until the lights come on at two.)' },
        { who: 'Old Mr. Pruitt', text: 'You didn\'t have to stay. ...I was a Marine, you know. Inchon. Nobody stays anymore.' },
      ] },
    ],
    done: [],
    reward: { xp: 35, rel2: ['marcus', 6], jp: ['neighbor', 10] },
  },
  c3_hay: {
    chapter: 3, event: true, lasts: 1, giver: 'ingrid', title: 'Beat the Rain', missed: 'The rain got the hay. Ingrid doesn\'t say anything. That\'s worse.',
    desc: 'Forty bales on the ground and rain by four.',
    stages: [
      { type: 'chop', map: 'farm', at: [44.5, 31.5], n: 6, label: 'Buck hay bales onto Ingrid\'s wagon before the rain' },
      { type: 'return', label: 'Tell Ingrid the hay is in' },
    ],
    done: [{ who: 'Ingrid Haugen', text: '(First drops on the barn roof as the doors close.) In. All of it. (She hands you a beer without looking.) Pa\'s brand.' }],
    reward: { xp: 30, rel: ['ingrid', 10], jp: ['survivor', 6] },
  },
  c3_creek: {
    chapter: 3, event: true, lasts: 2, giver: 'bo', title: 'Walleye at Dawn', missed: 'Bo went fishing alone. He says the fish were biting. He always says that.',
    desc: 'Bo invited you fishing on the creek at dawn.',
    stages: [
      { type: 'visit', map: 'farm', at: [30.5, 40.5], hours: [5, 9], early: 'Dawn, Bo said. Come back between 5 and 9 AM.', label: 'Fish the creek with Bo at dawn (5–9 AM)', lines: [
        { who: 'Bo Lindqvist', text: '(Steam off the thermos.) My father fished this hole. Said a man shows who he is in the first ten minutes of quiet.' },
        { who: 'Bo Lindqvist', text: '(Ten minutes later.) You\'ll do.' },
      ] },
    ],
    done: [],
    reward: { xp: 25, rel2: ['bo', 10], items: { fish: 3 }, jp: ['survivor', 5] },
  },
  c3_cows: {
    chapter: 3, event: true, lasts: 1, giver: 'ingrid', title: 'Loose Heifers', missed: 'The deputy found Ingrid\'s heifers on the county road first.',
    desc: 'Three of Ingrid\'s heifers got out in the storm.',
    stages: [
      { type: 'find', map: 'farm', spots: [[36.5, 36.5], [12.5, 40.5], [28.5, 33.5]], label: 'Find the loose heifers in the storm' },
      { type: 'return', label: 'Tell Ingrid her heifers are back' },
    ],
    found: 'Three soaked, offended heifers in the windbreak. They follow your flashlight home like it owes them money.',
    done: [{ who: 'Ingrid Haugen', text: 'All three. In that. (She looks at you a long moment.) Pa would have hired you. He never hired anybody.' }],
    reward: { xp: 30, rel: ['ingrid', 10], jp: ['survivor', 6] },
  },
  c3_bday: {
    chapter: 3, event: true, lasts: 2, giver: 'bo', title: 'Fifty', missed: 'You missed Tess\'s birthday. She pretends not to know you were invited.',
    desc: 'A surprise for Tess at the café.',
    stages: [
      { type: 'visit', map: 'farm', at: [62.3, 26.7], hours: [18, 22], early: 'The party is at seven tonight.', label: 'Go to Tess\'s birthday at the café (6–10 PM)', lines: [
        { who: 'Tess Albright', text: '(Twelve people in a booth for six. A cake shaped like a grain silo.) I said NO fuss. Who did this. Bo. It was Bo.' },
        { who: 'Tess Albright', text: '(Later, quieter.) Thirty years at that co-op. Nobody throws a party for the person who runs the scale. ...Thanks for coming, Frank.' },
      ] },
    ],
    done: [],
    reward: { xp: 25, rel2: ['tess', 12], jp: ['neighbor', 6] },
  },
  c4_regatta: {
    chapter: 4, event: true, lasts: 3, giver: 'theo', title: 'Regatta Day', missed: 'The regatta sailed without you. Theo sold out anyway and is insufferable about it.',
    desc: 'Stand by Theo\'s jam booth at the club regatta.',
    stages: [
      { type: 'wait', weekday: 'Saturday', hour: 10, label: 'The regatta is on Saturday' },
      { type: 'visit', map: 'estate', at: [36.5, 50.2], hours: [10, 17], label: 'Go to the yacht club regatta (Saturday, 10 AM–5 PM)', lines: [
        { who: '', text: '(White sails on blue water. Blazers. A brass cannon that makes you flinch every race.)' },
        { who: 'Theo Park', text: 'Stand there. Arms crossed. Perfect. "Caretaker\'s Cut — as rugged as the man who guards it." Sold forty jars, Frank!' },
        { who: 'Eleanor Whitcombe', text: '(Passing.) Mr. Lowe. You make an excellent mannequin. Do try the cannon less dramatically.' },
      ] },
    ],
    done: [],
    reward: { xp: 30, money: 25, rel2: ['theo', 10], jp: ['neighbor', 6] },
  },
  c4_boats: {
    chapter: 4, event: true, lasts: 1, giver: 'walt', title: 'Double the Lines', missed: 'Two club launches broke loose in the storm. Walt doesn\'t blame you out loud.',
    desc: 'The storm is beating the club\'s boats against the south dock.',
    stages: [
      { type: 'repair', map: 'estate', at: [58.5, 51.5], hits: 3, label: 'Double the mooring lines on the south dock (Toolkit)' },
      { type: 'return', label: 'Report to Walt' },
    ],
    done: [{ who: 'Walt Bishop', text: '(Soaked, both of you.) Good knots. Who taught you a bowline?' }, { who: F, text: 'A guy who used to tie things up in Newark.' }, { who: 'Walt Bishop', text: '...Don\'t tell me the rest.' }],
    reward: { xp: 30, rel: ['walt', 10], jp: ['handyman', 6] },
  },
  c4_pepper: {
    chapter: 4, event: true, lasts: 2, giver: 'folk9', title: 'Pepper', missed: 'Pepper came home on her own, smelling of somebody else\'s picnic.',
    desc: 'The Commodore\'s spaniel ran off toward the west woods.',
    stages: [
      { type: 'find', map: 'estate', spots: [[8.5, 30.5], [6.5, 38.5], [12.5, 24.5]], label: 'Find Pepper in the west woods' },
      { type: 'return', label: 'Bring Pepper back to Commodore Ames' },
    ],
    found: 'A muddy spaniel with half a ham sandwich, deeply unrepentant.',
    done: [{ who: 'Commodore Ames', text: 'Pepper. You traitor. (He kneels in his white trousers and lets her lick his face.) Thank you, young man. Edward would have let her run.' }],
    reward: { xp: 25, money: 20, jp: ['neighbor', 6] },
  },
  c5_gravy: {
    chapter: 5, event: true, lasts: 3, giver: 'angie', title: 'Sunday Gravy', missed: 'You missed Sunday gravy. Aunt Connie has drawn conclusions.',
    desc: 'Dinner at Angie\'s on Sunday.',
    stages: [
      { type: 'wait', weekday: 'Sunday', hour: 13, label: 'Sunday dinner at Angie\'s, two o\'clock' },
      { type: 'visit', map: 'shorthills', at: [6.5, 20.6], hours: [13, 18], label: 'Go to Sunday dinner at the Marchetti house (1–6 PM)', lines: [
        { who: 'Aunt Connie', text: 'So you\'re Rosa Corsetti\'s boy. Forty and not married. Is it your teeth? Show me your teeth.' },
        { who: 'Angie Marchetti', text: 'CONNIE. ...(To you.) Joey sat in that chair. Nobody sits in it. Sit in it, Frank. He\'d want somebody to.' },
        { who: '', text: '(You sit in Joey\'s chair. The braciole is your mother\'s recipe. Nobody says so. Everybody knows.)' },
      ] },
    ],
    done: [],
    reward: { xp: 30, rel2: ['angie', 12], items: { stew: 2 }, jp: ['neighbor', 6] },
  },
  c5_boxing: {
    chapter: 5, event: true, lasts: 4, giver: 'dom', title: 'Thursday Night', missed: 'The boys asked where you were on Thursday. Dom told them you were busy. He didn\'t say with what.',
    desc: 'Help Father Dom with the neighborhood boys\' boxing night.',
    stages: [
      { type: 'wait', weekday: 'Thursday', hour: 18, label: 'Boxing night is Thursday evening' },
      { type: 'visit', map: 'shorthills', at: [19.5, 15.6], hours: [18, 22], label: 'Help with Thursday boxing at St. Rose (6–10 PM)', lines: [
        { who: '', text: '(Eleven boys, one ring, a priest in sweatpants. The smell of the basement is exactly the same as 1990.)' },
        { who: 'Father Dominic Russo', text: 'Boys, this is Mr. Corsetti. He grew up on this avenue and he walked away from the house on the hill. Ask him anything.' },
        { who: 'A boy', text: 'Did you ever kill anybody?' },
        { who: F, text: '(A long breath.) I did a lot of things I\'d undo. Walking away was the only brave one. Hands up — show me your stance.' },
      ] },
    ],
    done: [],
    reward: { xp: 30, rel2: ['dom', 12], jp: ['neighbor', 8] },
  },
};

/* ------------------------------------------------------------------ */
/* Friends who come to stay for a couple of days.                      */
/* ------------------------------------------------------------------ */
export const GUESTS = {
  marcus3: {
    npc: 'marcus', days: 2,
    arrive: [
      { who: '', text: '(A tan Buick with Ohio plates pulls into the farm lane. Marcus Bell gets out, stretches, and logs your mailbox number.)' },
      { who: 'Marcus Bell', text: 'Ingrid said you\'d stopped writing your plates down. Somebody has to. Two days, Frank. Then I\'m out of your hair.' },
    ],
    talks: (s) => [
      { who: 'Marcus Bell', text: 'Walked your fence line at dawn. Two blind spots by the creek ford. I drew you a map. Don\'t thank me.' },
      { who: 'Marcus Bell', text: 'Linda sent a card. Grandkid number three. She doesn\'t know your name. She says thank you anyway.' },
      [{ who: 'Marcus Bell', text: 'Can I ask you something, Frank? When this is done — if it\'s ever done — where do you go?' }, { who: F, text: 'Somewhere with a porch.' }, { who: 'Marcus Bell', text: 'Good answer. Everybody I ever relocated said "anywhere." Anywhere is nowhere.' }],
      { who: 'Marcus Bell', text: ruthIn(s) ? 'Your Ruth beat me at gin rummy. Four games. I was a federal marshal.' : 'Ingrid feeds me like I\'m a farmhand. I\'m sixty-eight. It\'s wonderful.' },
    ],
    leave: () => [{ who: 'Marcus Bell', text: '(Car packed, engine running.) Keep a light on, Frank. And keep your plates in a notebook. Old habits keep old men alive.' }],
    gift: { items: { medkit: 1 }, jp: ['shadow', 6] },
  },
  ruth4: {
    npc: 'ruth', days: 2,
    arrive: [
      { who: '', text: '(A Greyhound stops at the estate gate. Ruth Calloway climbs down with one suitcase and Harold\'s shotgun in a guitar case.)' },
      { who: R, text: 'You didn\'t write. Gus did. He said you were in a castle by a lake. I had to see that with my own eyes.' },
    ],
    talks: () => [
      { who: R, text: 'Eleven bathrooms, Frank. ELEVEN. Harold and I raised two boys with one bathroom and a bucket.' },
      { who: R, text: 'Mrs. Whitcombe and I had tea. She corrected my posture. I corrected her roses. We\'re going to be great friends.' },
      [{ who: R, text: 'You look tired. Not sleepy. Tired. Are they still coming?' }, { who: F, text: 'They\'re still coming.' }, { who: R, text: 'Then you eat more. That\'s my whole medical opinion.' }],
    ],
    leave: () => [{ who: R, text: '(At the bus, a hand on your face.) You write me now. Under a fake name if you have to. I\'ll write back under a worse one.' }],
    gift: { items: { medkit: 2, pie: 1 }, rel: ['ruth', 10] },
  },
  dee5: {
    npc: 'dee', days: 3,
    talks: (s) => [
      { who: 'Dee Marsh', text: 'Your Father Dom tried to sell me a raffle ticket and a rosary in the same breath. I bought both. I\'m not even Catholic.' },
      { who: 'Dee Marsh', text: 'This ravine. That house up there, empty. You lived your whole life in the shadow of that, Frank. I understand you better now. I wish I didn\'t.' },
      [{ who: 'Dee Marsh', text: '(On the porch, the last night.) I have to go back Sunday. The store. Gus. Tibbs. So... where does that leave us?', choices: [
        { text: '"I\'ll come to Pine Hollow. Summers on your porch, if you\'ll have me."', effect: () => { s.life.romance.final = 'pinehollow'; return [{ who: 'Dee Marsh', text: 'Summers. And Thanksgiving. And Christmas. I\'ll negotiate the rest.' }]; } },
        { text: '"Stay. Sell the store to Jenny. Make a life here, with me."', effect: () => { s.life.romance.final = 'east'; return [{ who: 'Dee Marsh', text: '(A long breath.) Thirty years behind that counter. (Another.) ...Jenny\'s wanted it for ten. Ask me again in the morning. I\'ll say yes again.' }]; } },
        { text: '"Two homes, a long road, and a phone bill. We\'ll make it work."', effect: () => { s.life.romance.final = 'both'; return [{ who: 'Dee Marsh', text: 'A long road. (She leans on your shoulder.) I\'ve driven longer for worse men.' }]; } },
      ] }],
      { who: 'Dee Marsh', text: 'Duke likes me better than you. I\'ve been feeding him bacon. Don\'t tell me how bad that is.' },
    ],
    leave: (s) => [{ who: 'Dee Marsh', text: s.life.romance.final === 'east' ? '(She drives off to sell a store. She\'ll be back in a month with a U-Haul and Tibbs\'s blessing.)' : '(At the car.) Call me Sundays. And eat something green, Frank Lowe.' }],
    gift: { items: { pie: 2 }, rel: ['dee', 10] },
  },
};

/** Friends who come to stay: when they turn up (fired as quiet-day events). */
LIFE_EVENTS.push(
  { id: 'c3_guest_marcus', chapter: 3, title: 'Marcus visits', after: 'ch3_life', before: 'ch3_siege', where: 'home', hours: [10, 17], needs: (s) => !!s.choices.marcusHelp || rel(s, 'marcus') >= 3,
    lines: () => GUESTS.marcus3.arrive, result: () => import('../game/life.js').then((m) => m.startGuest('marcus3')), moment: true },
  { id: 'c4_guest_ruth', chapter: 4, title: 'Ruth comes to stay', after: 'ch4_life', before: 'ch4_siege', where: 'home', hours: [10, 17], needs: (s) => !ruthIn(s) && rel(s, 'ruth') >= 3,
    lines: () => GUESTS.ruth4.arrive, result: () => import('../game/life.js').then((m) => m.startGuest('ruth4')), moment: true },
);

/* ------------------------------------------------------------------ */
/* After the story: optional loose ends, shaped by the ending.          */
/* ------------------------------------------------------------------ */
const ending = (s) => (s.life.post && s.life.post.ending) || s.ending;
LIFE_EVENTS.push(
  { id: 'p_loose_end', chapter: 5, postOnly: true, title: 'A loose end', where: 'town', hours: [9, 18], needs: (s) => s.time.day >= s.life.post.day + 3 && ending(s) !== 'crown',
    lines: (s) => [
      { who: 'Mickey Doyle', text: '(Mickey, leaning on his tow truck.) Frankie. Tommy Ruggiero — Dante\'s cousin — is drinking at the Ravenna club and telling anybody who\'ll listen he\'s going to "settle up" for the family.' },
      { who: 'Mickey Doyle', text: ending(s) === 'justice' ? 'Reyes says he\'s small fry. Your call.' : 'He\'s small fry. A loud one. Your call.', choices: [
        { text: '"I\'ll go have a word with Tommy. Tonight."', value: 'word', lines: [{ who: 'Mickey Doyle', text: 'He parks out by the ravine path after the bars close. Bring friends. Or don\'t, you never do.' }] },
        { text: ending(s) === 'justice' ? '"Let Agent Reyes deal with him."' : '"Call your old friends on the force. Let them pick him up."', value: 'law', lines: [{ who: 'Mickey Doyle', text: '(Two days later Tommy Ruggiero is arraigned on an old gun charge. He looks very surprised about it.)' }] },
        { text: '"Let him talk. Talk is all he\'s got."', value: 'ignore', lines: [{ who: 'Mickey Doyle', text: '(Tommy talks for a week, runs out of people who\'ll listen, and moves to Philadelphia.)' }] },
      ] },
    ], errand: 'pg_tommy', errandIf: 'word', reward: { xp: 30, rel: ['mickey', 6] }, rewardIf: ['law', 'ignore'] },
  { id: 'p_leo_letter', chapter: 5, postOnly: true, title: 'A letter from the empty house', where: 'home', hours: [9, 20], needs: (s) => ending(s) === 'walk' && s.time.day >= s.life.post.day + 5,
    lines: [
      { who: '', text: '(A cream envelope in the mailbox. No stamp. Leo\'s careful handwriting.)' },
      { who: 'Leo Vescari', text: '"Frankie. The house is sold. I am going to my sister\'s in Sarasota. She is the only one who still speaks to me. I find I have nothing to say back."' },
      { who: 'Leo Vescari', text: '"I left carnations on your mother\'s stone on Sunday. I will not do it again. It is your turn now. — L.V."' },
      { who: F, text: '(You read it twice, and then you put it in the stove.)' },
    ], reward: { xp: 20 } },
  { id: 'p_trial', chapter: 5, postOnly: true, title: 'The trial', where: 'home', hours: [9, 20], needs: (s) => ending(s) === 'justice' && s.time.day >= s.life.post.day + 4,
    lines: [
      { who: 'Agent Dana Reyes', text: '(On the phone.) Mr. Corsetti. The trial starts in Newark on Monday. The defense will try to make you the villain. Some of what they say will be true.' },
      { who: 'Agent Dana Reyes', text: 'You can still change your mind about testifying in person. The ledger might be enough without you.', choices: [
        { text: '"I\'ll be there. Under my real name."', value: 'testify', lines: [{ who: F, text: '(Three days on the stand. Your voice shakes once. Leo doesn\'t look at you at all, until the very end, and then he nods.)' }] },
        { text: '"Let the ledger talk. I\'m done with that life."', value: 'ledger', lines: [{ who: 'Agent Dana Reyes', text: 'The ledger is very talkative. Go fix your porch, Mr. Lowe.' }] },
      ] },
    ], reward: { xp: 40, jp: ['neighbor', 10] } },
  { id: 'p_crown', chapter: 5, postOnly: true, title: 'The men at the door', where: 'home', hours: [9, 20], needs: (s) => ending(s) === 'crown' && s.time.day >= s.life.post.day + 2,
    lines: [
      { who: '', text: '(Two of Dante\'s old crew stand at the bottom of your porch steps with their hats in their hands. They want orders. Envelopes. A name for the Ravenna club.)' },
      { who: F, text: 'What do I tell them?', choices: [
        { text: '"Take the envelopes back to whoever paid them. All of them. We\'re done collecting on this avenue."', value: 'dismantle', lines: [{ who: '', text: '(They look at each other. They\'ve never heard a boss say that. The word reaches the avenue by lunch — and Angie leaves a coffee on your porch, without a note.)' }] },
        { text: '"Business as usual. I\'ll let you know."', value: 'business', lines: [{ who: F, text: '(They nod and go. The chair fits. That\'s what scares you.)' }] },
      ] },
    ], result: (s, v) => { s.choices.crownCourse = v; if (v === 'dismantle') s.rel.angie = Math.min(100, (s.rel.angie || 0) + 15); } },
);
LIFE_ERRANDS.pg_tommy = {
  chapter: 5, event: true, lasts: 3, giver: 'mickey', title: 'Tommy Ruggiero', missed: 'Tommy ran out of nerve and out of Short Hills before you got to him.',
  desc: 'Dante\'s cousin is promising to "settle up" for the family.',
  stages: [
    { type: 'fight', map: 'shorthills', at: [57.5, 44.5], hours: [0, 4], label: 'Find Tommy Ruggiero by the ravine path after the bars close (midnight–4 AM)', enemies: ['enforcer', 'gunman'], names: ['Tommy Ruggiero', 'Tommy\'s friend'],
      before: [{ who: 'Tommy Ruggiero', text: '(Tommy, drunk, by his car, with a friend who wishes he were somewhere else.) Corsetti. You killed my cousin\'s whole— (He reaches for his belt.)', choices: [
        { text: '"Dante made his choices. Go home, Tommy. Last chance."', value: 'talk' },
        { text: 'Say nothing. Step closer.', value: 'fight' },
      ] }],
      avoidIf: 'talk', avoidLines: [{ who: 'Tommy Ruggiero', text: '(His friend puts a hand on his arm. Tommy looks at it, at you, at the dark ravine.) ...Yeah. Yeah, okay. (They drive off slowly, like men who\'ve been let go and know it.)' }],
      after: [{ who: F, text: '(Tommy sits in the gravel holding his wrist. His friend is already halfway to Newark on foot.)' }] },
    { type: 'return', label: 'Tell Mickey it\'s settled' },
  ],
  done: [{ who: 'Mickey Doyle', text: 'Settled. (He doesn\'t ask how.) You know what, Frankie? I think that\'s the last one. I think it\'s actually the last one.' }],
  reward: { xp: 60, rel: ['mickey', 10], jp: ['gunhand', 8] },
};

/* ------------------------------------------------------------------ */
/* Saying goodbye before a move (the first talk after a chapter ends).  */
/* ------------------------------------------------------------------ */
export const FAREWELLS = {
  ruth: { lines: (s) => rel(s, 'ruth') >= 3 ? [
    { who: R, text: 'So you\'re going. I knew the day you paid cash for Harold\'s cabin you wouldn\'t stay. Men who pay cash are always leaving.' },
    { who: R, text: 'Don\'t say goodbye to me yet, Frank. I\'ll have something to say about it when you\'re packing the car.' },
  ] : [
    { who: R, text: 'So you\'re going. I knew the day you paid cash for Harold\'s cabin you wouldn\'t stay. Men who pay cash are always leaving.' },
    { who: R, text: 'Here. Harold\'s thermos. It leaks. Bring it back someday, so I know you\'re alive.' },
  ], gift: { items: { stew: 2 } } },
  dee: { lines: (s) => [
    { who: 'Dee Marsh', text: 'Gus says you\'re leaving. Gus says a lot. ...Is it true?' },
    { who: F, text: 'It\'s true, Dee. It\'s not safe for you if I stay.' },
    { who: 'Dee Marsh', text: 'Well. Pine Hollow\'s going to be boring again. (She presses a box of shells into your hands.) On the house. Don\'t argue.' },
    ...(s.life.romance.stage >= 1 ? [{ who: 'Dee Marsh', text: '(She doesn\'t let go of the box.) So. What are we, Frank? Before you go.', choices: [
      { text: '"Can I write to you? Not just about the weather."', value: 'romance', lines: [{ who: 'Dee Marsh', text: '(Her eyes go bright, and she swats your arm.) You\'d better. Every week. Under any name you want.' }] },
      { text: '"You\'re the best friend I made here, Dee. I don\'t want to lose that."', value: 'friend', lines: [{ who: 'Dee Marsh', text: '(A beat. Then a real smile.) Best friend. I\'ll take it. I\'ll hold you to it, too.' }] },
    ] }] : []),
  ], gift: { items: { shells: 8, sandwich: 2 } },
  result: (s, v) => { const r = s.life.romance; r.path = v === 'romance' ? 'romance' : 'friend'; r.stage = Math.max(r.stage, 2); } },
  gus: { lines: () => [
    { who: 'Gus Okafor', text: 'Heard. (He looks at the saw a while.) You were the best hand I had in ten years, Lowe.' },
    { who: 'Gus Okafor', text: 'Take the good chisel. The one with the tape on the handle. A man should leave a place with a tool he didn\'t have when he got there.' },
  ], gift: { items: { wood: 6 }, jp: ['handyman', 6] } },
  marcus: { lines: () => [
    { who: 'Marcus Bell', text: 'Plates are packed. Car\'s gassed. You leave at night, like I taught a hundred people.' },
    { who: 'Marcus Bell', text: 'One thing. Letters to you go through a P.O. box in Akron, then Dayton, then wherever you are. Three hops. Nobody follows three hops.' },
    { who: F, text: 'I said I\'d never write anyone.' },
    { who: 'Marcus Bell', text: 'You said a lot of things before you had friends.' },
  ], result: (s) => { s.life.mailDrop = true; } },
  rosa: { lines: () => [
    { who: 'Rosa Delgado', text: 'You\'re leaving. (She doesn\'t look up from the register.) Everybody good leaves Millbrook.' },
    { who: 'Rosa Delgado', text: 'Take the hinges. Brass. Papi\'s last box of them. They\'ll outlast whatever house you hang them on.' },
  ], gift: { items: { door_brace: 1 } } },
  pete: { lines: () => [
    { who: 'Pete Kowalski', text: 'FRANKIE. No. No! (A crushing hug.) Who\'s gonna carry the heavy end? ME? I\'m fifty-four!' },
    { who: 'Pete Kowalski', text: 'You call me. Collect. I\'ll accept the charges. My wife won\'t, but I will.' },
  ], gift: { items: { sandwich: 3 } } },
  ingrid: { lines: (s) => [
    { who: 'Ingrid Haugen', text: 'Pa used to say the ones you hide always leave. That\'s the point of hiding them.' },
    { who: 'Ingrid Haugen', text: s.choices && s.choices.marcusHelp ? 'Eleanor Whitcombe is expecting you. She\'s difficult. You\'ll like her.' : 'Whatever comes for you next, Frank, you held this farm. That counts for something here.' },
  ], gift: { items: { vegetables: 4, medkit: 1 } } },
  bo: { lines: () => [
    { who: 'Bo Lindqvist', text: 'Leaving, huh. (He slides a box across the counter.) Shells. My father\'s brand. Don\'t pay me, I\'ll be insulted.' },
  ], gift: { items: { shells: 10 } } },
  tess: { lines: () => [
    { who: 'Tess Albright', text: 'You\'re off the board. (She writes your name in the dispatch log anyway.) In case you ever come back. The log doesn\'t forget.' },
  ], gift: { money: 30 } },
  eleanor: { lines: () => [
    { who: 'Eleanor Whitcombe', text: 'So. Short Hills. The lion\'s den, with the lion in it.' },
    { who: 'Eleanor Whitcombe', text: 'Edward\'s watch house on the ridge is yours. I telephoned Father Dom. And Mr. Lowe — come back. That is not a request.' },
  ], gift: { money: 50 } },
  theo: { lines: () => [
    { who: 'Theo Park', text: 'Take a case of Caretaker\'s Cut. For the road. For morale. For the brand.' },
  ], gift: { items: { jerky: 3 } } },
  walt: { lines: () => [
    { who: 'Walt Bishop', text: '(A handshake.) Breathe out. Squeeze. Let it surprise you.' },
    { who: F, text: 'I remember.' },
    { who: 'Walt Bishop', text: 'Good.' },
  ], gift: { items: { rifle_ammo: 10 } } },
};

/* ------------------------------------------------------------------ */
/* Ruth's conversations — a new one at most once a day, in order.       */
/* `joined`: true = only if she came with you, false = only in Ch1.     */
/* ------------------------------------------------------------------ */
export const RUTH_TALKS = [
  { id: 'r1_harold', chapter: 1, after: 'settle_in', needs: (s) => rel(s, 'ruth') >= 2, lines: () => [
    { who: R, text: 'Harold built that cabin in 1971 with two friends and a case of beer. One of the friends fell off the roof. Twice.' },
    { who: R, text: 'He\'d have liked you, Frank. He liked anybody who fixed things instead of complaining about them.' },
  ] },
  { id: 'r1_war', chapter: 1, after: 'prepare', needs: (s) => rel(s, 'ruth') >= 3, lines: () => [
    { who: R, text: 'You hold a bandage like somebody who\'s had to. I held a lot of them. Pleiku, 1968. I was twenty.' },
    { who: R, text: 'You learn there that people are mostly good and occasionally terrible, and you patch up both. That\'s nursing.',
      choices: [
        { text: '"Do you ever regret it?"', value: 'regret', lines: [{ who: R, text: 'Every day. And I\'d go again tomorrow. Those aren\'t opposites, Frank.' }] },
        { text: '"I was the terrible part, Ruth. For a long time."', value: 'terrible', lines: [{ who: R, text: '(She doesn\'t flinch.) And now you chop an old woman\'s wood. Occasionally terrible. Mostly good. I\'ll take it.' }] },
      ] },
  ] },
  { id: 'r2_leaving', chapter: 2, joined: true, after: 'ch2_meet_marcus', lines: () => [
    { who: R, text: 'I locked my farmhouse and gave Gus the key. Forty-four years. I didn\'t even cry until Duluth.' },
    { who: R, text: 'Don\'t look at me like that. I chose this. I\'ve never once regretted a choice I made with my eyes open.',
      choices: [
        { text: '"Thank you for coming, Ruth."', value: 'thanks', lines: [{ who: R, text: 'Thank me by eating. You\'ve lost weight since Pine Hollow.' }] },
        { text: '"You can go back anytime. I\'ll drive you."', value: 'back', lines: [{ who: R, text: 'I know. That\'s exactly why I won\'t.' }] },
      ] },
  ] },
  { id: 'r2_garden', chapter: 2, joined: true, after: 'ch2_life', lines: () => [
    { who: R, text: 'Larch Street soil is clay and broken glass. I\'ve put in tomatoes anyway. Spite is a kind of fertilizer.' },
    { who: R, text: 'Your Marcus brings me the newspaper every morning and reads me the obituaries. He\'s very cheerful about it.' },
  ], reward: { items: { vegetables: 2 } } },
  { id: 'r3_homesick', chapter: 3, joined: true, after: 'ch3_life', lines: () => [
    { who: R, text: '(Ruth is sitting on the camper step, very still.) Today\'s the pond day. Harold and I took the boat out every year on this day.' },
    { who: R, text: 'I\'m just missing a pond, Frank. That\'s all. Old women are allowed.',
      choices: [
        { text: 'Sit with her a while. Say nothing.', value: 'sit', lines: [{ who: '', text: '(You sit. After a long time she leans her shoulder against yours.)' }, { who: R, text: 'Harold would sit like that. You learned it somewhere.' }] },
        { text: '"There\'s a creek past the north field. Let\'s go look at it."', value: 'creek', lines: [{ who: R, text: '(At the creek she takes her shoes off and puts her feet in the cold water and laughs like a girl.) Oh. Oh, that\'s good.' }] },
      ] },
  ] },
  { id: 'r3_ingrid', chapter: 3, joined: true, after: 'ch3_deputy', lines: () => [
    { who: R, text: 'That deputy looked at me like I was furniture. I spent forty years being looked at like furniture by doctors. I know what it means.' },
    { who: R, text: 'It means he\'s not counting me. Good. Let him not count me right up until I\'m shooting at him.' },
  ] },
  { id: 'r4_eleanor', chapter: 4, joined: true, after: 'ch4_life', lines: () => [
    { who: R, text: 'Mrs. Whitcombe and I had tea. She told me her husband was a crook. I told her mine was a saint. We both lied a little.' },
    { who: R, text: 'She\'s lonely, Frank. Rich people are lonely in bigger rooms, that\'s all.' },
  ], reward: { rel: ['eleanor', 6] } },
  { id: 'r4_scared', chapter: 4, joined: true, after: 'ch4_probe', lines: () => [
    { who: R, text: 'Can I tell you something? I was scared last night. Really scared. My hands shook loading the shells.' },
    { who: R, text: 'I\'m seventy-one. I could go back to Pine Hollow and grow rhubarb and nobody would think less of me.',
      choices: [
        { text: '"Then go. I mean it — you\'ve done more than enough."', value: 'go', lines: [{ who: R, text: '(She looks at you for a long time.) That\'s why I\'m staying. Because you\'d let me go.' }] },
        { text: '"I was scared too. I\'m always scared. We go on anyway."', value: 'scared', lines: [{ who: R, text: 'Good. I don\'t trust people who aren\'t. (She squeezes your arm.) Load my shells for me next time, my fingers are old.' }] },
      ] },
  ] },
  { id: 'r5_dom', chapter: 5, joined: true, after: 'ch5_meet_dom', lines: () => [
    { who: R, text: 'Your Father Dom cheats at cards. Very holy about it. He says God sees all hands and so does he.' },
    { who: R, text: 'He told me about your mother. Rosa. He said you have her stubbornness and none of her patience.' },
  ] },
  { id: 'r5_after', chapter: 5, joined: true, after: 'ch5_free', lines: (s) => [
    { who: R, text: 'It\'s over, then. (She looks at the ridge, at the house with no lights.) I keep waiting for headlights.' },
    { who: R, text: (s.life && s.life.post && s.life.post.ending === 'crown') ? 'You\'re the man in the big house now, aren\'t you. I hope you remember how to chop wood, Frank.' : 'I\'m going to park the camper behind the watch house and never move it again. You can\'t stop me. Nobody\'s stopped me since 1968.' },
  ] },
];
