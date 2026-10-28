// Personal storylines for Chapters 2–5: each neighbor, shopkeeper and job
// contact has a short arc that ends in a perk. Same format as the Chapter 1
// arcs in errands.js (stages: talk, visit, tail, bring, repair, poker, hunt,
// fight, wait, return). Coordinates are tiles.
const F = 'Frank';

export const LATER_ARCS = {
  /* ================= Chapter 2: Millbrook ================= */
  marcus_1: {
    chapter: 2, arc: 'marcus', part: 1, giver: 'marcus', title: 'The Plate Log', hours: [8, 20],
    desc: 'Marcus has logged the same grey Buick on Larch Street four nights running. He\'d like a second pair of eyes.',
    offer: [
      { who: 'Marcus Bell', text: '(Marcus taps a spiral notebook full of license plates.) Grey Buick. Michigan plates. Four nights, always after ten, always slow past my house. Not yours, Frank. Mine.' },
      { who: 'Marcus Bell', text: 'My eyes aren\'t what they were. Sit on the corner tonight and get me a good look at the driver.' },
    ],
    ask: 'Will you watch the corner tonight?',
    stages: [
      { type: 'visit', map: 'millbrook', at: [44.5, 31.5], hours: [22, 2], early: 'The Buick comes after ten. Come back tonight.', label: 'Watch the corner of Larch & Main tonight (10 PM–2 AM)', lines: [
        { who: '', text: 'At 10:40 the Buick crawls past with its lights off. The driver photographs Marcus\'s front door, twice, with a long lens.' },
        { who: F, text: '(Big man, fifties, Tigers cap. Michigan plate 4KL-221. He looks at the house the way Leo used to look at a debt.)' },
      ] },
      { type: 'return', label: 'Tell Marcus what you saw', lines: [
        { who: 'Marcus Bell', text: '4KL-221. (He goes very still.) Dale Purcell. I drove his wife out of Flint in the trunk of a Plymouth in 1981.' },
        { who: 'Marcus Bell', text: 'Twenty years I\'ve kept her hidden. Ingrid knows. Now you do too.' },
      ] },
    ],
    reward: { xp: 40, rel: ['marcus', 8], jp: ['shadow', 6] },
  },
  marcus_2: {
    chapter: 2, arc: 'marcus', part: 2, giver: 'marcus', title: 'Where Dale Sleeps', requires: ['marcus_1'], waitDays: 1, hours: [8, 20],
    desc: 'Follow Dale Purcell back to wherever he\'s staying. Don\'t let him make you.',
    offer: [{ who: 'Marcus Bell', text: 'He eats at the counter by the library every afternoon. Follow him home, Frank. I need to know where he sleeps.' }],
    stages: [
      { type: 'tail', map: 'millbrook', at: [58.5, 27.4], hours: [13, 19], label: 'Wait for Dale Purcell by the library, then follow him', who: 'Dale Purcell', look: { body: '#3a4a5a', hair: '#6a5a4a', skin: '#e0b090' },
        route: [[58.5, 28.4, 0], [50, 28.4, 2], [40, 28.4], [30, 28.4, 3], [16, 28.4], [4, 28.4, 2], [0.8, 29.5]],
        lines: [
          { who: '', text: 'Dale climbs into the Buick at the west end of Larch Street and pulls into the Starlite Motor Inn on Route 9. Room 6.' },
          { who: F, text: '(On the dashboard: a photo of a woman in her twenties, and a Millbrook phone book open to the B\'s.)' },
        ] },
      { type: 'return', label: 'Tell Marcus where Dale is staying' },
    ],
    done: [{ who: 'Marcus Bell', text: 'The Starlite. Room 6. (He writes it down in very small letters.) Thank you. Now I have to decide what kind of man I am.' }],
    reward: { xp: 45, rel: ['marcus', 8], jp: ['shadow', 10] },
  },
  marcus_3: {
    chapter: 2, arc: 'marcus', part: 3, giver: 'marcus', title: 'Old Debts', requires: ['marcus_2'], waitDays: 1, hours: [8, 21],
    desc: 'Marcus has to decide what to do about Dale Purcell. He wants your advice.',
    offer: [{ who: 'Marcus Bell', text: 'Sit down, Frank. I\'ve been up all night.' }],
    stages: [
      { type: 'talk', npc: 'marcus', label: 'Help Marcus decide', lines: [
        { who: 'Marcus Bell', text: 'Linda lives forty miles from here under a name I gave her. Grandkids. A garden. If Dale finds her, he kills her. So what do we do?', choices: [
          { text: '"I\'ll pay Dale a visit at the Starlite. He goes home to Michigan."', value: 'visit', lines: [{ who: 'Marcus Bell', text: 'Don\'t kill him. ...I mean it, Frank. Scare him. That\'s all.' }, { who: F, text: '(Room 6. Ten minutes. Dale Purcell checks out at midnight and drives north without stopping for gas.)' }] },
          { text: '"Call your old network. Move her before he gets close."', value: 'network', lines: [{ who: 'Marcus Bell', text: 'One more trunk ride. At her age. (He picks up the phone.) You\'re right. Nobody gets hurt.' }] },
        ] },
      ] },
    ],
    doneBy: {
      visit: [{ who: 'Marcus Bell', text: 'The Buick\'s gone. (He hands you a scanner earpiece.) From now on when a strange car turns onto Larch Street, you\'ll hear about it from me.' }],
      network: [{ who: 'Marcus Bell', text: 'She\'s safe. New town, new name. (He hands you a scanner earpiece.) From now on when a strange car turns onto Larch Street, you\'ll hear about it from me.' }],
    },
    reward: { xp: 70, rel: ['marcus', 14], jp: ['neighbor', 10], perk: 'ham_radio' },
    rewardBy: { visit: { jp: ['gunhand', 10] } },
  },

  rosa_1: {
    chapter: 2, arc: 'rosa', part: 1, giver: 'rosa', title: 'The Delivery Van', hours: [8, 19],
    desc: 'Delgado Hardware\'s delivery van has a cracked rear axle mount. Rosa\'s father built it in 1968.',
    offer: [
      { who: 'Rosa Delgado', text: 'Papi\'s van. The rear mount\'s split and the only man who knew how to fix it is in Holy Cross cemetery.' },
      { who: 'Rosa Delgado', text: 'Bring me three good pieces of hardwood and your toolkit, and I\'ll owe you.' },
    ],
    stages: [
      { type: 'bring', item: 'wood', n: 3, label: 'Bring Rosa 3 wood for blocking' },
      { type: 'repair', map: 'millbrook', at: [59.5, 12.5], hits: 4, label: 'Fix the van behind Delgado Hardware (Toolkit)' },
      { type: 'return', label: 'Tell Rosa the van runs' },
    ],
    done: [{ who: 'Rosa Delgado', text: '(She starts it, listens, and cries a little.) It sounds like him. Don\'t look at me. Go stock shelves or something.' }],
    reward: { money: 40, xp: 40, rel: ['rosa', 10], jp: ['handyman', 8] },
  },
  rosa_2: {
    chapter: 2, arc: 'rosa', part: 2, giver: 'rosa', title: 'Missing Rifles', requires: ['rosa_1'], waitDays: 1, hours: [8, 19],
    desc: 'Three deer rifles have walked out of Rosa\'s back room this month. Nobody broke the lock.',
    offer: [{ who: 'Rosa Delgado', text: 'Three rifles gone. No broken lock. Somebody has a key — or somebody\'s coming through the loading door at night. Will you sit on it?' }],
    stages: [
      { type: 'fight', map: 'millbrook', at: [59.5, 10.5], hours: [22, 3], label: 'Stake out Rosa\'s loading door at night (10 PM–3 AM)', enemies: ['scout', 'scout'], names: ['Kyle Kessler', 'Brad Kessler'],
        before: [{ who: 'Kyle Kessler', text: '(Two men with a key and a duffel bag freeze in your flashlight.) Aw, hell. Brad — run! No — get him!' }],
        after: [{ who: F, text: '(In the duffel: Rosa\'s rifles and a key cut from the one her late husband kept on his truck ring.)' }] },
      { type: 'return', label: 'Bring the rifles back to Rosa' },
    ],
    done: [{ who: 'Rosa Delgado', text: 'The Kessler boys. Their mother buys birdseed from me every Tuesday. (She sighs.) You have an account here now, Frank. Family rate.' }],
    reward: { xp: 70, rel: ['rosa', 14], jp: ['gunhand', 10], perk: 'rosas_account' },
  },

  pete_1: {
    chapter: 2, arc: 'pete', part: 1, giver: 'pete', title: 'The Ortiz Piano', hours: [8, 17],
    desc: 'Mrs. Ortiz bought a baby grand. Her porch steps won\'t survive it without help.',
    offer: [
      { who: 'Pete Kowalski', text: 'Frankie! Mrs. Ortiz bought a piano. A BABY GRAND. Her porch steps are older than me and they creak if you look at them.' },
      { who: 'Pete Kowalski', text: 'Brace the steps, then help me walk six hundred pounds of Steinway up them. I\'ll buy lunch. Big lunch.' },
    ],
    stages: [
      { type: 'repair', map: 'millbrook', at: [39.5, 32.4], hits: 4, label: 'Brace Mrs. Ortiz\'s porch steps (Toolkit)' },
      { type: 'visit', map: 'millbrook', at: [37.5, 31.6], label: 'Help Pete walk the piano inside', lines: [
        { who: 'Pete Kowalski', text: 'On three. One... two... — THREE, Frankie, THREE!' },
        { who: '', text: '(Six hundred pounds, four steps, one doorframe, zero scratches. Mrs. Ortiz plays Chopin for you both, badly and joyfully.)' },
      ] },
      { type: 'return', label: 'Collect lunch from Pete' },
    ],
    done: [{ who: 'Pete Kowalski', text: 'You lift like a guy who\'s carried things he didn\'t want to talk about. I\'m not asking! Eat your sandwich.' }],
    reward: { money: 50, xp: 40, rel: ['pete', 10], jp: ['handyman', 6] },
  },
  pete_2: {
    chapter: 2, arc: 'pete', part: 2, giver: 'pete', title: 'Pete\'s Big Night', requires: ['pete_1'], waitDays: 0, hours: [8, 19],
    desc: 'Pete has lost at cards to the same mailman for eleven years. He wants to see somebody beat him.',
    offer: [{ who: 'Pete Kowalski', text: 'Card night upstairs at the post office. Walt the mailman has taken my money since 1988. Win a couple hands off him, Frankie. For me. For America.' }],
    stages: [
      { type: 'poker', n: 2, label: 'Win 2 hands at card night (Wed & Sat, 7–11 PM, above the post office)' },
      { type: 'return', label: 'Tell Pete the news' },
    ],
    done: [{ who: 'Pete Kowalski', text: 'TWO HANDS. Off Walt! (He lifts you off the ground.) You\'re on the crew permanently. Best pay, best jobs, and I\'ll teach you to lift with your legs.' }],
    reward: { xp: 60, rel: ['pete', 14], jp: ['survivor', 8], perk: 'strong_back' },
  },

  /* ================= Chapter 3: Kettle Crossing ================= */
  ingrid_1: {
    chapter: 3, arc: 'ingrid', part: 1, giver: 'ingrid', title: 'Breech Calf', hours: [7, 20],
    desc: 'One of Ingrid\'s heifers is calving backwards. She needs another strong pair of arms at dawn.',
    offer: [{ who: 'Ingrid Haugen', text: 'Bluebell\'s calf is turned wrong. She\'ll go at dawn. The vet\'s in Eau Claire. I need arms, Frank, and a stomach.' }],
    ask: 'Will you come at first light?',
    stages: [
      { type: 'visit', map: 'farm', at: [49.5, 27.5], hours: [5, 9], early: 'Bluebell will go at dawn. Come back between 5 and 9 AM.', label: 'Help Ingrid deliver the calf at dawn (5–9 AM)', lines: [
        { who: 'Ingrid Haugen', text: 'Chains on the legs. Pull when she pushes. Not before. ...NOW, Frank.' },
        { who: '', text: '(Forty minutes later a wet, furious bull calf is standing up in the straw. You are covered in things you won\'t describe.)' },
      ] },
      { type: 'return', label: 'Wash up and talk to Ingrid' },
    ],
    done: [{ who: 'Ingrid Haugen', text: 'You didn\'t faint. My husband fainted. (She almost smiles.) He\'s yours to name.' }],
    reward: { xp: 40, rel: ['ingrid', 10], jp: ['survivor', 6] },
  },
  ingrid_2: {
    chapter: 3, arc: 'ingrid', part: 2, giver: 'ingrid', title: 'A Package for Mrs. Pell', requires: ['ingrid_1'], waitDays: 1, hours: [8, 18],
    desc: 'Ingrid needs a package picked up from the co-op — addressed to a woman who doesn\'t exist.',
    offer: [{ who: 'Ingrid Haugen', text: 'There\'s a package at the co-op for "Mrs. Pell." Pick it up for me. Don\'t open it, and don\'t tell Tess who it\'s for.' }],
    stages: [
      { type: 'visit', map: 'farm', at: [51.5, 11.4], hours: [8, 17], label: 'Pick up the package for "Mrs. Pell" at the co-op', lines: [
        { who: 'Tess Albright', text: 'Mrs. Pell. Again. (She doesn\'t look up.) Tell Ingrid whoever she is, she gets a lot of hair dye.' },
      ] },
      { type: 'return', label: 'Bring the package to Ingrid', lines: [
        { who: 'Ingrid Haugen', text: '(She takes it up the hayloft ladder. A woman\'s voice says thank you in Spanish.)' },
        { who: 'Ingrid Haugen', text: 'Her name is Clara. Marcus sent her to me in April. Her husband is a policeman in Milwaukee, and not a good one. She needs to get to her sister in Laredo.' },
      ] },
    ],
    reward: { xp: 40, rel: ['ingrid', 8], jp: ['shadow', 6] },
  },
  ingrid_3: {
    chapter: 3, arc: 'ingrid', part: 3, giver: 'ingrid', title: 'The Night Bus', requires: ['ingrid_2'], waitDays: 1, hours: [8, 20],
    desc: 'Clara has to get to the night bus on the county road without anyone seeing her go.',
    offer: [{ who: 'Ingrid Haugen', text: 'The Greyhound stops at the county road at one in the morning. Walk her out to it. If anyone is watching, you\'ll know what to do. That\'s why I\'m asking you.' }],
    stages: [
      { type: 'visit', map: 'farm', at: [30.5, 3.5], hours: [0, 2], early: 'The bus comes at one in the morning. Come back between midnight and 2 AM.', label: 'Walk Clara to the night bus on the county road (midnight–2 AM)', lines: [
        { who: '', text: 'Clara holds your arm the whole way. At the road she gives you a rosary with a cracked bead.' },
        { who: 'Clara', text: 'For your mother. Every bead is somebody who helped me. Now one is you.' },
        { who: F, text: 'Ingrid asked me something before we left. Whether I\'d do this again, for the next one.', choices: [
          { text: '"Tell Ingrid: whenever she needs me."', value: 'again', lines: [{ who: F, text: '(The bus lights shrink to nothing. You are, it turns out, a man who does this now.)' }] },
          { text: '"Once was enough. I can\'t bring the family to her door."', value: 'once', lines: [{ who: F, text: '(The bus lights shrink to nothing. It\'s the right call. It doesn\'t feel like it.)' }] },
        ] },
      ] },
      { type: 'return', label: 'Tell Ingrid Clara is on her way' },
    ],
    doneBy: {
      again: [{ who: 'Ingrid Haugen', text: 'Then you\'re one of us. Marcus will be glad. Now come work my fields until you can\'t stand — my father\'s way. You\'ll thank me.' }],
      once: [{ who: 'Ingrid Haugen', text: 'Fair. You have your own hunters. Come work my fields anyway. My father\'s way. You\'ll thank me.' }],
    },
    reward: { xp: 70, rel: ['ingrid', 14], jp: ['neighbor', 10], perk: 'farm_hands' },
    rewardBy: { again: { rel: ['ingrid', 20] } },
  },

  bo_1: {
    chapter: 3, arc: 'bo', part: 1, giver: 'bo', title: 'Bo\'s Freezer', hours: [8, 19],
    desc: 'Bo\'s chest freezer is empty for the first time since 1974, and deer season\'s open.',
    offer: [{ who: 'Bo Lindqvist', text: 'Freezer\'s empty. Knees are shot. Deer are thick in the south woods at sunup and sundown. Two packs of venison and I\'ll make it worth your while.' }],
    stages: [
      { type: 'hunt', n: 1, label: 'Bring down a deer in the south woods (dawn or dusk)' },
      { type: 'bring', item: 'venison', n: 2, label: 'Bring Bo 2 venison' },
    ],
    done: [{ who: 'Bo Lindqvist', text: 'Clean shot. Good butchering. (He pays you, then keeps looking at you.) Where\'d a city fella learn to field-dress a deer?' }],
    reward: { money: 50, xp: 40, rel: ['bo', 10], jp: ['survivor', 8] },
  },
  bo_2: {
    chapter: 3, arc: 'bo', part: 2, giver: 'bo', title: 'Under the Counter', requires: ['bo_1'], waitDays: 1, hours: [8, 19],
    desc: 'Bo plays penny-ante at the café twice a week. He wants to see how you play.',
    offer: [{ who: 'Bo Lindqvist', text: 'Wednesday and Saturday, back booth at the café. You beat me one hand, I\'ll tell you why I keep a shotgun under the counter. It ain\'t raccoons.' }],
    stages: [
      { type: 'poker', n: 1, label: 'Win a hand at the café\'s back booth (Wed & Sat, 7–11 PM)' },
      { type: 'return', label: 'Collect Bo\'s story', lines: [
        { who: 'Bo Lindqvist', text: '1979. Two men from Chicago came to buy my father\'s land. He said no. They came back at night.' },
        { who: 'Bo Lindqvist', text: 'He said no again, with that shotgun. They never came back. (He looks at you.) Whoever you are, Frank, the Lindqvists don\'t sell.' },
      ] },
    ],
    done: [{ who: 'Bo Lindqvist', text: 'You\'ve got credit here. Don\'t make me regret it.' }],
    reward: { xp: 60, rel: ['bo', 14], jp: ['neighbor', 8], perk: 'feed_store_credit' },
  },

  tess_1: {
    chapter: 3, arc: 'tess', part: 1, giver: 'tess', title: 'Short Weight', hours: [7, 17],
    desc: 'The co-op\'s grain tallies come up short every Tuesday. Tess wants to know who\'s loading at night.',
    offer: [{ who: 'Tess Albright', text: 'Two hundred bushels short. Every week. Somebody\'s got a key to the bins and a truck. Sit on the co-op tonight. Don\'t do anything stupid. Just look.' }],
    stages: [
      { type: 'visit', map: 'farm', at: [51.5, 13.5], hours: [23, 3], early: 'Whoever it is comes late. Come back between 11 PM and 3 AM.', label: 'Watch the co-op grain bins (11 PM–3 AM)', lines: [
        { who: '', text: 'At 1:15 a Peterbilt backs up to bin 3 with its lights off. The driver has a key.' },
        { who: F, text: '(Hank the trucker. He loads, logs nothing, and heads south toward Chicago.)' },
      ] },
      { type: 'return', label: 'Tell Tess who it was' },
    ],
    done: [{ who: 'Tess Albright', text: 'Hank. Twenty years I\'ve known Hank. (She writes it down anyway.) Thanks, Frank. I\'ll handle it the co-op way. Slowly and with paperwork.' }],
    reward: { xp: 45, rel: ['tess', 10], jp: ['shadow', 8], flag: 'hankGrain' },
  },
  tess_2: {
    chapter: 3, arc: 'tess', part: 2, giver: 'tess', title: 'Back Roads', requires: ['tess_1'], waitDays: 1, hours: [7, 17],
    desc: 'Tess\'s old rig needs a new bed, and she pays in the only currency she values: knowledge of roads.',
    offer: [{ who: 'Tess Albright', text: 'My \'78 Kenworth\'s bed rotted through. Four planks and a morning. I\'ll pay you in something better than cash: every back road from here to Duluth.' }],
    stages: [
      { type: 'bring', item: 'wood', n: 4, label: 'Bring Tess 4 wood for the truck bed' },
      { type: 'repair', map: 'farm', at: [56.5, 11.5], hits: 4, label: 'Rebuild the bed of Tess\'s truck (Toolkit)' },
      { type: 'return', label: 'Tell Tess she\'s back on the road' },
    ],
    done: [{ who: 'Tess Albright', text: '(She unfolds a map covered in pencil.) County 12 to the gravel cut, the old rail bed, the creamery road. You\'ll be faster than anybody on my board now.' }],
    reward: { xp: 60, rel: ['tess', 14], jp: ['survivor', 8], perk: 'back_roads' },
  },

  /* ================= Chapter 4: Port Whitcombe ================= */
  eleanor_1: {
    chapter: 4, arc: 'eleanor', part: 1, giver: 'eleanor', title: 'Edward\'s Safe', hours: [9, 19],
    desc: 'Eleanor\'s late husband kept a safe in the boathouse. She\'s never had the nerve to open it.',
    offer: [
      { who: 'Eleanor Whitcombe', text: 'Edward kept a safe in the boathouse, behind the oar rack. The combination is my birthday. I\'ve known that for six years.' },
      { who: 'Eleanor Whitcombe', text: 'Open it after dark, when the club people can\'t see. Bring me whatever is inside. Don\'t read it. You\'ll read it.' },
    ],
    stages: [
      { type: 'visit', map: 'estate', at: [57.5, 36.5], hours: [20, 2], early: 'After dark, she said. Come back between 8 PM and 2 AM.', label: 'Open Edward\'s safe in the boathouse after dark', lines: [
        { who: F, text: '(Inside: forty thousand dollars in bundles, a pistol, and a ledger. Edward Whitcombe laundered money for six families. The last entry is three days before he died.)' },
        { who: F, text: '(A note in the ledger: "Ames knows. Ames always knew.")' },
      ] },
      { type: 'return', label: 'Bring Edward\'s ledger to Eleanor' },
    ],
    done: [{ who: 'Eleanor Whitcombe', text: '(She reads the last page twice.) "Ames always knew." Of course he did. They sailed together for thirty years.' }],
    reward: { xp: 45, rel: ['eleanor', 10], jp: ['shadow', 8] },
  },
  eleanor_2: {
    chapter: 4, arc: 'eleanor', part: 2, giver: 'eleanor', title: 'The Commodore', requires: ['eleanor_1'], waitDays: 1, hours: [9, 19],
    desc: 'Commodore Ames knew what Edward was. Eleanor wants to know what else he knows.',
    offer: [{ who: 'Eleanor Whitcombe', text: 'Ask the Commodore about Edward\'s last week. He won\'t lie to you. He lies to everybody, but not to men like you.' }],
    stages: [
      { type: 'talk', npc: 'folk9', hours: [8, 19], label: 'Ask Commodore Ames about Edward Whitcombe', lines: [
        { who: 'Commodore Ames', text: 'Edward wanted out. Told the families so. The week before his "heart attack," a man named Nico came to the club for lunch.' },
        { who: 'Commodore Ames', text: 'I said nothing. Six years I\'ve said nothing. Tell Eleanor I\'m sorry. Tell her I was a coward.' },
      ] },
      { type: 'return', label: 'Tell Eleanor what Ames said', lines: [
        { who: 'Eleanor Whitcombe', text: 'Nico Vescari had my husband killed. And now he\'s coming for you. (She looks at the ledger.) What do I do with this, Frank?', choices: [
          { text: '"Give it to Agent Reyes. Let it finish them."', value: 'reyes', lines: [{ who: 'Eleanor Whitcombe', text: 'And my name in every newspaper on the East Coast. ...Good. Let them print it.' }] },
          { text: '"Burn it. Edward paid. You don\'t have to."', value: 'burn', lines: [{ who: 'Eleanor Whitcombe', text: '(She feeds it to the fireplace page by page.) He was a good husband and a bad man. I\'ll keep the first part.' }] },
        ] },
      ] },
    ],
    doneBy: {
      reyes: [{ who: 'Eleanor Whitcombe', text: 'Edward\'s friends still owe him. I\'ll make some calls — you\'ll find the club\'s work pays better from now on.' }],
      burn: [{ who: 'Eleanor Whitcombe', text: 'Edward\'s friends still owe him. I\'ll make some calls — you\'ll find the club\'s work pays better from now on.' }],
    },
    reward: { xp: 70, rel: ['eleanor', 14], jp: ['neighbor', 10], perk: 'old_money' },
    rewardBy: { reyes: { jp: ['neighbor', 14] } },
  },

  theo_1: {
    chapter: 4, arc: 'theo', part: 1, giver: 'theo', title: 'Artisanal Jerky', hours: [8, 19],
    desc: 'Theo wants to sell small-batch venison jerky. He has never seen a deer up close.',
    offer: [{ who: 'Theo Park', text: 'Small-batch venison jerky, Frank. Local, wild, ethically sourced. There are deer in the west woods at dawn. I have never touched a deer. Will you?' }],
    stages: [
      { type: 'hunt', n: 1, label: 'Bring down a deer in the west woods (dawn or dusk)' },
      { type: 'bring', item: 'venison', n: 2, label: 'Bring Theo 2 venison' },
    ],
    done: [{ who: 'Theo Park', text: '(He holds the venison like a newborn.) "Caretaker\'s Cut." That\'s the label. You\'re on the label, Frank. Not your face. Your vibe.' }],
    reward: { money: 60, xp: 40, rel: ['theo', 10], jp: ['survivor', 6] },
  },
  theo_2: {
    chapter: 4, arc: 'theo', part: 2, giver: 'theo', title: 'Club Night', requires: ['theo_1'], waitDays: 0, hours: [8, 19],
    desc: 'Theo has been trying to get into the yacht club card game for three years.',
    offer: [{ who: 'Theo Park', text: 'The yacht club card game. Wednesdays and Saturdays. They let the caretaker in and not the marina guy. Win a hand. Then say my name. Loudly.' }],
    stages: [
      { type: 'poker', n: 1, label: 'Win a hand at the yacht club card game (Wed & Sat, 7–11 PM)' },
      { type: 'return', label: 'Tell Theo you dropped his name' },
    ],
    done: [{ who: 'Theo Park', text: 'They said "the jam guy?" That\'s RECOGNITION, Frank. You have a tab at Park\'s now. Forever. Or until my accountant finds out.' }],
    reward: { xp: 55, rel: ['theo', 14], jp: ['neighbor', 6], perk: 'marina_tab' },
  },

  walt_1: {
    chapter: 4, arc: 'walt', part: 1, giver: 'walt', title: 'Mooring Lines', hours: [7, 17],
    desc: 'A storm tore up the club\'s south dock. Walt has a work crew of one: himself.',
    offer: [{ who: 'Walt Bishop', text: 'South dock. Storm took four boards and a cleat. Wood and a toolkit. Morning work.' }],
    stages: [
      { type: 'bring', item: 'wood', n: 4, label: 'Bring Walt 4 wood' },
      { type: 'repair', map: 'estate', at: [58.5, 51.5], hits: 4, label: 'Repair the club\'s south dock (Toolkit)' },
      { type: 'return', label: 'Report to Walt' },
    ],
    done: [{ who: 'Walt Bishop', text: 'Square. Tight. You\'ve done this before. ...Navy?' }, { who: F, text: 'Something like it.' }, { who: 'Walt Bishop', text: 'Mm.' }],
    reward: { money: 45, xp: 40, rel: ['walt', 10], jp: ['handyman', 8] },
  },
  walt_2: {
    chapter: 4, arc: 'walt', part: 2, giver: 'walt', title: 'Range Day', requires: ['walt_1'], waitDays: 1, hours: [7, 17],
    desc: 'Walt shoots at dawn on the estate\'s south lawn. He\'s offered to watch you shoot.',
    offer: [{ who: 'Walt Bishop', text: 'Dawn. South lawn. Bring your pistol. I\'ll fix what\'s wrong with you.' }],
    stages: [
      { type: 'visit', map: 'estate', at: [44.5, 40.5], hours: [5, 9], early: 'Walt said dawn. Come back between 5 and 9 AM.', label: 'Shoot with Walt on the south lawn at dawn', lines: [
        { who: 'Walt Bishop', text: 'You flinch. Left eye. Every shot. Somebody shot at you once and you never forgot it.' },
        { who: 'Walt Bishop', text: 'Breathe out. Squeeze. Let it surprise you. ...Again. ...Again.' },
        { who: '', text: '(Two hundred rounds later your groups are half the size.)' },
      ] },
      { type: 'return', label: 'Thank Walt' },
    ],
    done: [{ who: 'Walt Bishop', text: 'Better. Not good. Better. Whoever\'s coming for you, Caretaker — be better than them.' }],
    reward: { xp: 60, rel: ['walt', 14], jp: ['gunhand', 12], perk: 'navy_drill' },
  },

  /* ================= Chapter 5: Short Hills ================= */
  dom_1: {
    chapter: 5, arc: 'dom', part: 1, giver: 'dom', title: 'The Ring at St. Rose', hours: [8, 19],
    desc: 'Father Dom runs a boxing night for neighborhood kids. The ring in the church basement is falling apart.',
    offer: [{ who: 'Father Dominic Russo', text: 'Thursday nights I teach the neighborhood boys to box, so they learn to take a punch somewhere other than Leo\'s. The ring is rotten. Four planks, Frankie.' }],
    stages: [
      { type: 'bring', item: 'wood', n: 4, label: 'Bring Father Dom 4 wood for the ring' },
      { type: 'repair', map: 'shorthills', at: [19.5, 12.5], hits: 4, label: 'Rebuild the boxing ring in St. Rose\'s basement (Toolkit)' },
      { type: 'return', label: 'Tell Father Dom the ring is fixed' },
    ],
    done: [{ who: 'Father Dominic Russo', text: 'Your mother scrubbed these floors when you were six. You used to sleep under the pews. (He clears his throat.) Good work.' }],
    reward: { xp: 45, rel: ['dom', 10], jp: ['handyman', 8] },
  },
  dom_2: {
    chapter: 5, arc: 'dom', part: 2, giver: 'dom', title: 'Ma\'s Stone', requires: ['dom_1'], waitDays: 1, hours: [8, 19],
    desc: 'Your mother\'s headstone in the churchyard has never had a visitor from her family.',
    offer: [{ who: 'Father Dominic Russo', text: 'Rosa Corsetti\'s stone is behind the church. Nobody from her family has stood there since we buried her. Go at sunrise, Frankie. Then come and talk to me.' }],
    stages: [
      { type: 'visit', map: 'shorthills', at: [12.5, 18.5], hours: [5, 9], early: 'Dom said sunrise. Come back between 5 and 9 AM.', label: 'Visit your mother\'s grave behind St. Rose at sunrise', lines: [
        { who: '', text: 'ROSA CORSETTI, 1931–1994. BELOVED. Someone has been leaving fresh carnations.' },
        { who: F, text: 'Ma. I got out. I did one thing right. I\'m going to try to do one more.' },
      ] },
      { type: 'return', label: 'Talk to Father Dom', lines: [
        { who: 'Father Dominic Russo', text: 'The carnations? Leo. Every Sunday, for nine years. (He lets that sit.) Nobody is only one thing, Frankie. Not even him.' },
      ] },
    ],
    done: [{ who: 'Father Dominic Russo', text: 'Now put your hands up. Thursday nights you\'re in the ring with me. I\'ll teach you to get hit and keep standing.' }],
    reward: { xp: 70, rel: ['dom', 14], jp: ['neighbor', 10], perk: 'corner_man' },
  },

  angie_1: {
    chapter: 5, arc: 'angie', part: 1, giver: 'angie', title: 'Joey\'s Car', hours: [8, 19],
    desc: 'Angie\'s brother Joey drove for Leo until the night he didn\'t come home. His car is still in an impound lot.',
    offer: [{ who: 'Angie Marchetti', text: 'Joey\'s Buick has been in Mickey Doyle\'s impound lot for two years. Mickey won\'t release it to me. "Paperwork." Ask him for me, Frank.' }],
    stages: [
      { type: 'talk', npc: 'mickey', label: 'Ask Mickey Doyle about Joey Marchetti\'s car', lines: [
        { who: 'Mickey Doyle', text: 'Joey\'s car. (He looks at the floor.) Leo\'s people told me nobody touches it. I was a cop. I did what I was told for twenty years.' },
        { who: 'Mickey Doyle', text: 'Row C, the blue Buick. I don\'t lock that gate at night. I never told you that.' },
      ] },
      { type: 'return', label: 'Tell Angie' },
    ],
    done: [{ who: 'Angie Marchetti', text: 'He doesn\'t lock the gate. (She pours you a coffee with shaking hands.) Then you go look, Frank. I can\'t.' }],
    reward: { xp: 35, rel: ['angie', 8], jp: ['neighbor', 4] },
  },
  angie_2: {
    chapter: 5, arc: 'angie', part: 2, giver: 'angie', title: 'What Joey Saw', requires: ['angie_1'], waitDays: 0, hours: [8, 21],
    desc: 'Search Joey Marchetti\'s Buick in the tow yard at night.',
    offer: [{ who: 'Angie Marchetti', text: 'Tonight. Row C. Whatever\'s in there, bring it to me.' }],
    stages: [
      { type: 'visit', map: 'shorthills', at: [31.5, 5.5], hours: [21, 2], early: 'The gate\'s unlocked at night. Come back between 9 PM and 2 AM.', label: 'Search Joey\'s Buick in the tow yard at night', lines: [
        { who: F, text: '(Taped under the driver\'s seat: Joey\'s notebook. Two years of Leo\'s comings and goings. The last line: "Dante knows I wrote it down.")' },
      ] },
      { type: 'return', label: 'Bring Joey\'s notebook to Angie', lines: [
        { who: 'Angie Marchetti', text: '"Dante knows I wrote it down." (She closes it.) Dante. Leo\'s nephew. He\'s the one who came to tell us Joey was "gone."', choices: [
          { text: '"When this is over, Dante answers for it. I promise."', value: 'promise', lines: [{ who: 'Angie Marchetti', text: 'Don\'t promise me. Just do it.' }] },
          { text: '"Let it go, Angie. Revenge eats people. I know."', value: 'letgo', lines: [{ who: 'Angie Marchetti', text: '...You\'d know. (She puts the notebook in her apron.) I\'ll keep it anyway.' }] },
        ] },
      ] },
    ],
    done: [{ who: 'Angie Marchetti', text: 'You\'re family here now. Family pays family prices.' }],
    reward: { xp: 70, rel: ['angie', 14], jp: ['shadow', 10], perk: 'family_discount' },
  },

  mickey_1: {
    chapter: 5, arc: 'mickey', part: 1, giver: 'mickey', title: 'The Bagman', hours: [8, 18],
    desc: 'Every Friday one of Leo\'s men collects from the avenue. Mickey wants to know where the money goes.',
    offer: [{ who: 'Mickey Doyle', text: 'Every week a kid in a leather jacket collects from the avenue — Angie, the bakery, me. Follow him, Frank. I paid that envelope for eleven years. I want to know who I was paying.' }],
    stages: [
      { type: 'tail', map: 'shorthills', at: [7.5, 16.4], hours: [12, 18], label: 'Wait for Leo\'s bagman outside Marchetti\'s, then follow him', who: 'Bagman', look: { body: '#1a1a1a', hair: '#1a1a1a', skin: '#d8a888' },
        route: [[7.5, 16.4, 0], [14, 16.4, 2], [24, 17], [33, 16.4, 3], [42, 17], [50, 18.4, 2], [60, 18.4]],
        lines: [
          { who: '', text: 'The bagman walks the whole avenue and climbs into a black Lincoln at the end of it. In the back seat: Dante Vescari.' },
          { who: F, text: '(Dante counts it, peels off two bills for the kid, and the Lincoln heads up the ridge — to Leo\'s.)' },
        ] },
      { type: 'return', label: 'Tell Mickey' },
    ],
    done: [{ who: 'Mickey Doyle', text: 'Dante. Leo\'s own nephew. (He laughs without anything funny in it.) Eleven years of envelopes, straight up the hill.' }],
    reward: { xp: 45, rel: ['mickey', 10], jp: ['shadow', 10] },
  },
  mickey_2: {
    chapter: 5, arc: 'mickey', part: 2, giver: 'mickey', title: 'Retirement Party', requires: ['mickey_1'], waitDays: 0, hours: [8, 18],
    desc: 'Mickey runs a card game in the tow-yard office. Some of the players are still on the force.',
    offer: [{ who: 'Mickey Doyle', text: 'Card night in my office. Three of the players are still Essex County cops. Win a couple hands, buy them a drink, listen. I\'ll teach you what their radios say.' }],
    stages: [
      { type: 'poker', n: 2, label: 'Win 2 hands at Mickey\'s card night (Wed & Sat, 7–11 PM, tow-yard office)' },
      { type: 'return', label: 'Talk to Mickey' },
    ],
    done: [{ who: 'Mickey Doyle', text: '(He hands you a laminated card of scanner codes.) 10-31 means a crime in progress. 10-31 on your street means Leo\'s coming. You\'ll hear it before they do.' }],
    reward: { xp: 60, rel: ['mickey', 14], jp: ['shadow', 8], perk: 'cop_eyes' },
  },
};

/** Poker tables in later chapters. */
export const LATER_TABLES = {
  2: {
    place: 'the card room above the Millbrook post office',
    players: [{ name: 'Walt the mailman', style: 'tight' }, { name: 'Pete Kowalski', style: 'loose' }, { name: 'Danny\'s dad', style: 'bluffer' }],
    gossip: [
      ['Pete Kowalski', 'Mrs. Ortiz bought a piano. A PIANO. She can\'t play! She says she\'ll learn. At eighty!'],
      ['Walt the mailman', 'That Bell fella across from you gets mail from six states and never a return address.'],
      ['Danny\'s dad', 'Library\'s closing Mondays now. Budget. My kid\'s gonna have to read at home. God help us.'],
      ['Walt the mailman', 'Rosa Delgado\'s missing three rifles. Don\'t tell her I told you.'],
      ['Pete Kowalski', 'Somebody\'s Buick with Michigan plates keeps parking on Larch. Big guy, Tigers cap.'],
    ],
  },
  3: {
    place: 'the back booth at the Kettle Crossing café',
    players: [{ name: 'Bo Lindqvist', style: 'tight' }, { name: 'Hank the trucker', style: 'loose' }, { name: 'Pastor Lund', style: 'bluffer' }],
    gossip: [
      ['Bo Lindqvist', 'Co-op\'s short on grain again. Tess is fit to be tied.'],
      ['Pastor Lund', 'The Lord forgives bluffing. I am less sure about Bo\'s face when he has a full house.'],
      ['Hank the trucker', 'Chicago run Thursday. Anybody need anything from the big city? Cigarettes? Sin?'],
      ['Bo Lindqvist', 'Ingrid\'s been buying groceries for two. Lives alone. I don\'t ask.'],
      ['Pastor Lund', 'Deputy Mott bought a new truck. On a deputy\'s salary. I prayed on it.'],
    ],
  },
  4: {
    place: 'the card room at the Point Yacht Club',
    players: [{ name: 'Commodore Ames', style: 'tight' }, { name: 'June Tremblay', style: 'bluffer' }, { name: 'Dr. Halvorsen', style: 'loose' }],
    gossip: [
      ['Commodore Ames', 'The caretaker plays like a man who\'s been robbed at cards. Or done the robbing.'],
      ['Dr. Halvorsen', 'Theo Park wants to join. The jam boy! Next they\'ll let in the bait.'],
      ['June Tremblay', 'Club books are a mess this quarter. Don\'t look at me — I just add things up.'],
      ['Commodore Ames', 'Edward Whitcombe sat in that chair for thirty years. Nobody sits in it now.'],
      ['Dr. Halvorsen', 'Somebody had a launch out at two in the morning last week. No running lights. Smugglers. Or Canadians.'],
    ],
  },
  5: {
    place: 'the back office at Doyle\'s Towing',
    players: [{ name: 'Sgt. Rizzo (off duty)', style: 'tight' }, { name: 'Mickey Doyle', style: 'loose' }, { name: 'Old Vito', style: 'bluffer' }],
    gossip: [
      ['Sgt. Rizzo (off duty)', 'Word downtown is the feds have a grand jury. Leo\'s lawyer bought a new boat anyway.'],
      ['Old Vito', 'I drove for Leo\'s father in \'58. Good man. Terrible tipper.'],
      ['Mickey Doyle', 'Joey Marchetti\'s Buick is still in Row C. Two years. Nobody touches it.'],
      ['Sgt. Rizzo (off duty)', 'Corsetti\'s kid, back on the avenue. Brass is taking bets on how long.'],
      ['Old Vito', 'Father Dom still boxes Thursdays. Seventy-six! I can\'t open a jar.'],
    ],
  },
};

export const LATER_SUPPER = {
  2: [
    { who: 'Rosa Delgado', text: 'Block supper at the library lawn, Frank. Mrs. Ortiz made tamales. Sit. Eat. Don\'t argue with old women.' },
    { who: 'Pete Kowalski', text: 'Third plate! Nobody\'s counting! Mrs. Ortiz is counting.' },
    { who: 'Marcus Bell', text: '(Marcus eats with his back to the wall, the way you do. You notice each other noticing.)' },
  ],
  3: [
    { who: 'Pastor Lund', text: 'Hotdish, three kinds of bars, and Jell-O with things suspended in it. Welcome to Wisconsin, Mr. Lowe.' },
    { who: 'Ingrid Haugen', text: 'Eat the bars. Not the Jell-O. Trust me.' },
    { who: 'Tess Albright', text: 'If you\'re going to stay in Kettle Crossing, learn to say "ope." That\'s the whole language.' },
  ],
  4: [
    { who: 'Eleanor Whitcombe', text: 'The chapel supper. Lobster rolls and gossip. You\'ll sit by me so they all have something to talk about.' },
    { who: 'Theo Park', text: 'I brought the jam. Nobody asked. Everybody\'s eating it. That\'s called market validation.' },
    { who: 'Walt Bishop', text: '(Walt nods at you, which for Walt is a speech.)' },
  ],
  5: [
    { who: 'Father Dominic Russo', text: 'Sunday gravy in the St. Rose hall. Your mother\'s recipe, Frankie. Angie stole it in 1987.' },
    { who: 'Angie Marchetti', text: 'Borrowed. I borrowed it. Eat.' },
    { who: 'Mickey Doyle', text: 'Twenty years I couldn\'t come to these. Ashamed. Pass the bread, Frank.' },
  ],
};

export const LATER_COURIER = {
  2: { senders: ['Mrs. Ortiz', 'Old Mr. Pruitt', 'Danny Hendricks', 'the library'], contents: ['Sheet music for Chopin, Nocturne in E-flat, heavily annotated in pencil.', 'A bowling league trophy, cracked and glued.', 'A library overdue notice for a book on lock-picking. Interesting.', 'A cassette tape labeled "MOM — DON\'T TAPE OVER."'] },
  3: { senders: ['Pastor Lund', 'Hank the trucker', 'the co-op', 'Bo Lindqvist'], contents: ['A dairy breeding catalog, dog-eared at Holsteins.', 'A church bulletin with a recipe for hotdish taped to the back.', 'A shipping manifest. Chicago, again.', 'A box of shotgun shells and a note: "for the raccoons."'] },
  4: { senders: ['Commodore Ames', 'June Tremblay', 'the yacht club', 'Theo Park'], contents: ['A sealed envelope from a Montreal bank.', 'Twelve jars of jam with hand-drawn labels.', 'A regatta schedule, 1971, with one name circled.', 'Nautical charts, rolled tight.'] },
  5: { senders: ['Mrs. Ferraro', 'Old Vito', 'Paulie the paperboy', 'St. Rose'], contents: ['A mass card for "Joseph Marchetti."', 'Cannoli in a box tied with string. Fragile. Delicious-looking.', 'A racing form with three horses circled.', 'A photograph: the avenue in 1965, everybody young.'] },
};
