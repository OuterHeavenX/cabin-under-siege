// Side stories: longer than a favor, shorter than a chapter. Most are ordinary
// people with ordinary problems — not everything is the mob. Some only happen
// when Frank drives back to a town he's left (`visitOnly`). Same errand format
// as the storylines (see errands.js for stage types).
const F = 'Frank';
const rel = (s, id) => Math.min(5, Math.floor((s.rel[id] || 0) / 20));
const ruthIn = (s) => !!(s.companion && s.companion.ruth && s.companion.ruth.joined);

export const SIDE_STORIES = {
  /* ================= Chapter 1: The Missing Delivery ================= */
  sd_delivery: {
    chapter: 1, side: true, giver: 'gus', title: 'The Missing Delivery', hours: [8, 17], needs: (s) => rel(s, 'gus') >= 1,
    desc: 'A flatbed of Duluth oak never reached Okafor Lumber. The driver isn\'t answering.',
    offer: [
      { who: 'Gus Okafor', text: 'Flatbed out of Duluth. Forty sheets of oak, a kid named Billy Kowal driving. Due Tuesday. It\'s Thursday.' },
      { who: 'Gus Okafor', text: 'Billy\'s never late. Billy\'s barely nineteen. His mother calls me every hour. Take a look up the north road for me?' },
    ],
    ask: 'Will you look for the truck?',
    stages: [
      { type: 'visit', map: 'town', at: [32.5, 3.4], label: 'Look along the north road for signs of the flatbed', lines: [
        { who: F, text: 'Skid marks where the road bends. Long ones. Then tire tracks off onto the old quarry track, and a hubcap in the ditch.' },
      ] },
      { type: 'talk', npc: 'folk11', hours: [8, 19], label: 'Ask Old Man Tibbs what he saw on the north road', lines: [
        { who: 'Old Man Tibbs', text: 'Flatbed? Tuesday, near dark. Went up the quarry track like the devil was after it. Boy driving looked like he\'d been crying.' },
        { who: 'Old Man Tibbs', text: 'Quarry road ends at the woodlot east of town. Nothing up there but deer and bad decisions.' },
      ] },
      { type: 'find', map: 'town', spots: [[60.5, 33.5], [58.5, 36.5], [61.5, 27.5]], label: 'Search the woodlot east of town for the flatbed' },
      { type: 'talk', npc: 'gus', hours: [7, 19], label: 'Tell Gus what you found', lines: [
        { who: F, text: '(You tell Gus about the flatbed in the trees — one wheel in a ditch, the oak dry under a tarp — and about Billy, asleep in the cab, ashamed.)' },
        { who: F, text: '(Billy fell asleep at the wheel, put it in the ditch, and was too scared of losing the job to call. He\'s been living in the cab for two days.)' },
        { who: 'Gus Okafor', text: 'Two days. In the cab. (He puts his face in his hands.) What do I do with him, Frank?', choices: [
          { text: '"Keep him. He\'s nineteen and he stayed with your load. That\'s loyalty."', value: 'keep', lines: [{ who: 'Gus Okafor', text: '...Yeah. I fell asleep at the wheel once in Korea. Nobody fired me. (He\'s already reaching for his keys.)' }] },
          { text: '"Make him drive with a partner for a while. Then trust him again."', value: 'partner', lines: [{ who: 'Gus Okafor', text: 'Partner. Teach him the long hauls. Good. That\'s what my old sergeant would have done.' }] },
        ] },
      ] },
    ],
    found: 'The flatbed, nose-down in a ditch under the pines. Billy Kowal asleep across the seat with a box of crackers. The oak is dry under a tarp.',
    doneBy: {
      keep: [{ who: 'Gus Okafor', text: 'Kid cried on my shoulder. Then he unloaded forty sheets of oak by himself. (He hands you an envelope.) And Billy wants to show you a thing or two about engines. Says it\'s the least he can do.' }],
      partner: [{ who: 'Gus Okafor', text: 'Kid starts on the Duluth run with Earl\'s cousin. The honest one. (An envelope.) Billy wants to show you a thing or two about engines. Let him.' }],
    },
    reward: { money: 60, xp: 60, rel: ['gus', 12], jp: ['survivor', 8], perk: 'mechanic' },
  },

  /* ================= Chapter 2: The Wrong Man ================= */
  sd_wrongman: {
    chapter: 2, side: true, giver: 'marcus', title: 'The Wrong Man', hours: [8, 20], needs: (s) => rel(s, 'marcus') >= 1,
    desc: 'A man at the post office looks exactly like Tony Sabella — a Vescari enforcer Frank last saw in 1999.',
    offer: [
      { who: 'Marcus Bell', text: 'You went white at the post office this morning, Frank. The man with the scar through his eyebrow. Who is he?' },
      { who: F, text: '(Same jaw. Same scar. Tony Sabella. Leo\'s hammer. Last seen in 1999 putting a man through a windshield.)' },
      { who: F, text: 'Somebody who shouldn\'t be in Ohio.' },
      { who: 'Marcus Bell', text: 'Then don\'t guess. Follow him. Find out. Guessing gets people killed — usually the wrong people.' },
    ],
    ask: 'Follow him?',
    stages: [
      { type: 'tail', map: 'millbrook', at: [46.5, 24.5], hours: [12, 18], label: 'Wait outside the post office, then follow the man with the scar', who: 'The man with the scar', look: { body: '#4a4a5a', hair: '#2a2a2a', skin: '#d8a888' },
        route: [[46.5, 24.5, 0], [46.5, 28.4, 2], [52, 28.4], [56, 28.4, 3], [60, 28.4], [62.5, 27.4, 2]],
        lines: [
          { who: '', text: 'He walks to the library, waves at the librarian, and unlocks a side door with his own key. A sign: "Chemistry Club — Tuesdays & Thursdays."' },
          { who: F, text: '(Through the window: twelve teenagers, a Bunsen burner and a man with Tony Sabella\'s face explaining titration with real joy.)' },
        ] },
      { type: 'return', label: 'Tell Marcus what you saw', lines: [
        { who: 'Marcus Bell', text: 'Gary Pulaski. Teaches chemistry at Millbrook High. Twenty-two years. Got that scar from a beaker in 1987. I checked while you were walking.' },
        { who: 'Marcus Bell', text: 'You\'ll see Tony Sabella in every crowd for the rest of your life, Frank. The trick is checking before you act.', choices: [
          { text: '"I\'d like to meet him. Properly."', value: 'meet', lines: [{ who: F, text: '(You introduce yourself on the library steps. Gary bowls on Fridays and needs a fifth. You find yourself saying yes.)' }] },
          { text: '"Teach me how you checked."', value: 'learn', lines: [{ who: 'Marcus Bell', text: 'Plates, habits, keys. Who has a key to what. Professionals never own keys to libraries. Sit down, I\'ll show you.' }] },
        ] },
      ] },
    ],
    done: [{ who: 'Marcus Bell', text: 'There. Now you look at people the way I do. It\'s tiring. It keeps you alive.' }],
    reward: { xp: 60, rel: ['marcus', 10], jp: ['shadow', 12], perk: 'surveillance' },
    rewardBy: { meet: { rel: ['pete', 6] } },
  },

  /* ================= Chapter 3: The Johansson Place ================= */
  sd_land: {
    chapter: 3, side: true, giver: 'bo', title: 'The Johansson Place', hours: [8, 19], needs: (s) => rel(s, 'bo') >= 1,
    desc: 'Bo\'s cousin Elsa is being pushed to sell the land next to your south woods.',
    offer: [
      { who: 'Bo Lindqvist', text: 'My cousin Elsa owns the forty acres south of your woods. A company called Prairie Wind wants it for a gravel pit. She said no.' },
      { who: 'Bo Lindqvist', text: 'Since she said no, her well pump quit, her mailbox got run over twice and somebody poured sugar in her tractor. She\'s seventy-four.' },
    ],
    ask: 'Will you look into it?',
    stages: [
      { type: 'talk', npc: 'folk7', hours: [8, 19], label: 'Ask Pastor Lund about Elsa Johansson and Prairie Wind', lines: [
        { who: 'Pastor Lund', text: 'Prairie Wind is two men from Eau Claire with a lawyer and a backhoe. They bought the Nygaard place last year after the barn burned. Nobody proved anything.' },
        { who: 'Pastor Lund', text: 'They send the same two fellows round at night. Brothers. Big. Not clever.' },
      ] },
      { type: 'fight', map: 'farm', at: [22.5, 45], hours: [21, 3], label: 'Watch the Johansson fence line at night (9 PM–3 AM)', enemies: ['enforcer', 'scout'], names: ['Dwayne Kask', 'Darrell Kask'],
        before: [{ who: 'Dwayne Kask', text: '(Two men with bolt cutters at Elsa\'s fence, flashlight in your face.) The hell are you? Darrell — get him!' }],
        after: [{ who: 'Darrell Kask', text: '(From the dirt.) It\'s just a job, man! Mr. Pratt pays us two hundred a night to "encourage" her! We never hurt nobody!' }, { who: F, text: '(A work order in Dwayne\'s pocket, on Prairie Wind letterhead: "Johansson — encourage." Signed R. Pratt.)' }] },
      { type: 'return', label: 'Bring the work order to Bo', lines: [
        { who: 'Bo Lindqvist', text: '(He reads it twice.) "Encourage." Signed. On their own paper. That\'s the dumbest crime I ever saw.' },
        { who: 'Bo Lindqvist', text: 'So what do we do with it?', choices: [
          { text: '"Give it to Pastor Lund. He\'ll read it out at Sunday supper."', value: 'supper', lines: [{ who: F, text: '(Sunday: Pastor Lund reads it aloud between the hotdish and the bars. By Monday, Prairie Wind can\'t buy a cup of coffee in Kettle Crossing.)' }] },
          { text: '"Give it to the state attorney. Not Mott."', value: 'state', lines: [{ who: F, text: '(Two weeks later Prairie Wind\'s permits are frozen pending investigation. Elsa sends you a rhubarb pie the size of a tire.)' }] },
        ] },
      ] },
    ],
    done: [{ who: 'Bo Lindqvist', text: 'Elsa wants you for supper. Every Sunday. Forever. That\'s not optional, that\'s Lutheran.' }],
    reward: { xp: 70, money: 40, rel: ['bo', 14], jp: ['gunhand', 8], items: { pie: 1 } },
    rewardBy: { supper: { jp: ['neighbor', 10] }, state: { jp: ['shadow', 10] } },
  },

  /* ================= Chapter 4: The Night Fisherman ================= */
  sd_fisherman: {
    chapter: 4, side: true, giver: 'walt', title: 'The Night Fisherman', hours: [7, 19], needs: (s) => rel(s, 'walt') >= 1,
    desc: 'A lantern moves on the water off the marina after midnight. Everybody has a theory.',
    offer: [
      { who: 'Walt Bishop', text: 'Lantern on the water. Off the marina. After midnight, four nights now. No engine. Rowing.' },
      { who: 'Walt Bishop', text: 'Club wants it stopped. I want it understood. Different things.' },
    ],
    ask: 'Find out who it is?',
    stages: [
      { type: 'talk', npc: 'theo', hours: [8, 19], label: 'Ask Theo about the lantern on the lake', lines: [
        { who: 'Theo Park', text: 'It\'s Champ. The lake monster. I\'m kidding. Mostly. Okay, I\'m printing "Champ Jam" labels just in case.' },
      ] },
      { type: 'talk', npc: 'folk9', hours: [8, 19], label: 'Ask Commodore Ames about the lantern', lines: [
        { who: 'Commodore Ames', text: 'Smugglers. Canadian cigarettes. Or Edward Whitcombe\'s ghost, looking for his ledger. I\'d bet on the cigarettes.' },
      ] },
      { type: 'visit', map: 'estate', at: [57.5, 52.6], hours: [0, 4], early: 'The lantern comes out after midnight.', label: 'Wait at the marina after midnight for the lantern (midnight–4 AM)', lines: [
        { who: '', text: 'At 1:10 the lantern comes in to the marina dock. An old man in a cardigan, a rowboat, one rod, no fish.' },
        { who: 'Dr. Halvorsen', text: 'Oh — Mr. Lowe. You caught me. (Dr. Halvorsen, from the club card game.) Margaret and I fished here every night of our honeymoon. 1961.' },
        { who: 'Dr. Halvorsen', text: 'She died in March. I can\'t sleep in the house. Out here I can almost hear her telling me I\'m holding the rod wrong.', choices: [
          { text: 'Sit in the boat with him a while.', value: 'sit', lines: [{ who: '', text: '(You row out together. He talks about Margaret for an hour. You learn to see the far shore in the dark the way an old surgeon does: not looking at things, but around them.)' }] },
          { text: '"Walt will want to know. I\'ll tell him it\'s nothing to worry about."', value: 'tell', lines: [{ who: 'Dr. Halvorsen', text: 'Thank you. And Mr. Lowe — look a little to the side of things at night. The eye sees better at the edges. A trick from the army hospital.' }] },
        ] },
      ] },
      { type: 'return', label: 'Tell Walt about the night fisherman' },
    ],
    done: [{ who: 'Walt Bishop', text: 'Halvorsen. (A long silence.) I\'ll leave the marina gate unlocked. Tell the club it\'s Champ.' }],
    reward: { xp: 60, rel: ['walt', 10], jp: ['survivor', 10], perk: 'night_eyes' },
  },

  /* ================= Chapter 4: The Old Friend ================= */
  sd_oldfriend: {
    chapter: 4, side: true, giver: 'theo', title: 'The Old Friend', hours: [8, 19], needs: (s) => !!s.story.flags.metReyes,
    desc: 'A man from Frank\'s old life is asking for him at the marina.',
    offer: [
      { who: 'Theo Park', text: 'Frank. A guy came into the marina asking for "Frankie from Newark." Thin, shaky, bought nothing. I told him I don\'t know any Frankies.' },
      { who: 'Theo Park', text: 'He said he\'d be in St. Brendan\'s every evening "till Frankie comes." That\'s not normal marina behavior, Frank.' },
    ],
    ask: 'Go and see him?',
    stages: [
      { type: 'visit', map: 'estate', at: [21.5, 52.4], hours: [17, 21], early: 'He waits at the chapel in the evening.', label: 'Meet the stranger at St. Brendan\'s chapel (5–9 PM)', lines: [
        { who: 'Benny Lucchese', text: 'Frankie. (Benny Lucchese. He drove for Sal for fifteen years. He\'s lost forty pounds and all his color.) I didn\'t know where else to go.' },
        { who: 'Benny Lucchese', text: 'I talked to the feds. Small stuff. Leo found out. I got two hundred dollars and a car that won\'t start. Help me, Frankie. For old times.' },
        { who: F, text: '(Is he running from Leo — or was he sent to find out where you sleep?)', choices: [
          { text: 'Give him $200 and Tess\'s back roads to Canada.', value: 'money', cost: 200, lines: [{ who: 'Benny Lucchese', text: '(He holds the money like it might bite.) You were always the decent one, Frankie. I\'m sorry for... everything.' }] },
          { text: 'Call Agent Reyes. Witness protection, tonight.', value: 'reyes', lines: [{ who: 'Agent Dana Reyes', text: '(On the phone.) Lucchese? Sal Benedetto\'s driver? Keep him there. I\'ll have a car at the chapel in an hour.' }] },
          { text: '"Go home, Benny. I can\'t trust you. I\'m sorry."', value: 'away', lines: [{ who: 'Benny Lucchese', text: '(He nods like a man who expected it.) Yeah. Yeah. I wouldn\'t trust me either.' }] },
        ] },
      ] },
      { type: 'wait', days: 1, label: 'Wait to hear what became of Benny', lines: [{ who: '', text: 'A day later: news about Benny Lucchese.' }] },
      { type: 'return', label: 'Hear what happened from Theo' },
    ],
    doneBy: {
      money: [{ who: 'Theo Park', text: 'Postcard came for you. Quebec City. Just says: "Car started. — B." Who\'s B? Never mind. I don\'t want to know. I want to know a little.' }],
      reyes: [{ who: 'Theo Park', text: 'A woman in a grey suit left you this. Says "From R." (A note:) "Lucchese is singing. He drove Sal to a title office on Broad Street every month for ten years. Keystone. Interesting?"' }],
      away: [{ who: 'Theo Park', text: 'That guy from the chapel? Commodore saw him get on the Burlington bus. Alone. He looked... fine? I think? I\'m bad at reading people. I\'m great at reading jam.' }],
    },
    reward: { xp: 60, jp: ['neighbor', 8] },
    rewardBy: { reyes: { jp: ['shadow', 10] }, money: { rel: ['theo', 6] } },
    after: (s, v) => { s.choices.benny = v; if (v === 'reyes') import('../game/evidence.js').then((m) => m.addEvidence('t4_benny', true)); },
  },

  /* ================= Chapter 5: Mrs. Ferraro's Son ================= */
  sd_ferraro: {
    chapter: 5, side: true, giver: 'folk12', title: 'Mrs. Ferraro\'s Son', hours: [9, 18],
    desc: 'Mrs. Ferraro\'s son has a parole hearing at Rahway. She needs someone to speak for him.',
    offer: [
      { who: 'Mrs. Ferraro', text: 'My Sal. Eight years in Rahway for a stupid thing with a stupid car. His hearing is Thursday. The board wants "a character witness from the community."' },
      { who: 'Mrs. Ferraro', text: 'The community is afraid of the parole board. You, Rosa\'s boy, you\'re not afraid of anything. Will you go?' },
    ],
    ask: 'Speak for her son?',
    stages: [
      { type: 'talk', npc: 'dom', hours: [8, 19], label: 'Ask Father Dom to help write a statement for the parole board', lines: [
        { who: 'Father Dominic Russo', text: 'Sal Ferraro served Mass for me until he was sixteen. Then he fell in with Leo\'s crowd, like half this avenue. Like you.' },
        { who: 'Father Dominic Russo', text: 'Write the truth, Francis. Boards can smell anything else.' },
      ] },
      { type: 'talk', npc: 'mickey', hours: [7, 18], label: 'Borrow a car from Mickey for the drive to Rahway', lines: [
        { who: 'Mickey Doyle', text: 'Rahway? On a Thursday? (He tosses you keys.) The Buick in Row A. Not Joey\'s. Bring it back with gas in it.' },
      ] },
      { type: 'wait', weekday: 'Thursday', hour: 9, label: 'The hearing is Thursday morning in Rahway', lines: [
        { who: '', text: 'East Jersey State Prison, a green room with a flag in it. Three tired people at a table. Sal Ferraro, forty-one, grey at the temples.' },
        { who: 'Parole Board', text: 'Mr. Lowe. You\'re here to speak for the inmate. How do you know him?', choices: [
          { text: 'Tell the truth: you grew up on the same avenue, ran with the same people, and walked away.', value: 'truth', lines: [{ who: F, text: '(You don\'t say "Vescari." You don\'t have to. The woman in the middle puts down her pen and listens to every word.)' }] },
          { text: 'Keep it simple: a neighbor, a church, a mother who needs him home.', value: 'simple', lines: [{ who: F, text: '(Short. Kind. True enough. The board nods, writes, thanks you.)' }] },
        ] },
      ] },
      { type: 'return', label: 'Tell Mrs. Ferraro how it went' },
    ],
    doneBy: {
      truth: [{ who: 'Mrs. Ferraro', text: '(She already knows. The board called.) Granted. Granted! He comes home in October. (She grabs your face with both hands.) Rosa\'s boy. Rosa\'s boy.' }],
      simple: [{ who: 'Mrs. Ferraro', text: 'They said "next year, probably." Probably! (She squeezes your hands.) Probably is more than I had. God bless you.' }],
    },
    reward: { xp: 70, jp: ['neighbor', 12], rel2: ['dom', 8], items: { sandwich: 3 } },
    rewardBy: { truth: { jp: ['neighbor', 6], rel: ['dom', 8] } },
  },

  /* ================= Return visits ================= */
  sv_supper: {
    chapter: 1, side: true, visitOnly: true, giver: 'dee', title: 'The Harvest Supper', hours: [8, 21], needs: (s) => rel(s, 'dee') >= 2,
    desc: 'Pine Hollow\'s Harvest Supper, and a seat Dee has been saving.',
    offer: [
      { who: 'Dee Marsh', text: 'You picked a good week. Harvest Supper\'s tonight at the chapel — every night this week, Abe can\'t count. Your seat\'s saved. It has a pie on it.' },
    ],
    ask: 'Coming?',
    stages: [
      { type: 'visit', map: 'town', at: [39.5, 18.8], hours: [17, 22], early: 'Supper starts at five.', label: 'Go to the Harvest Supper at Hollow Chapel (5–10 PM)', lines: [
        { who: '', text: '(Long tables, paper lanterns, the whole of Pine Hollow in its good shirts. A pie is waiting on a folding chair with your name on an index card.)' },
        { who: 'Gus Okafor', text: 'Lowe. Sit. You\'re between me and Tibbs. That\'s a punishment for leaving.' },
        { who: 'Old Man Tibbs', text: 'You still owe me a fish, Calloway-cabin man.' },
        { who: 'Pastor Abe', text: '(Grace.) And for those who left us, and came back for supper. Amen.' },
      ] },
    ],
    done: [{ who: 'Dee Marsh', text: '(At the end of the night, stacking chairs.) Pine Hollow doesn\'t forget people, Frank. Even the ones who leave. Especially those.' }],
    reward: { xp: 50, rel: ['dee', 10], rel2: ['gus', 8], jp: ['neighbor', 10] },
  },
  sv_pond: {
    chapter: 1, side: true, visitOnly: true, giver: 'ruth', title: 'The Pond Day', hours: [8, 18], needs: (s) => !ruthIn(s) && rel(s, 'ruth') >= 3,
    desc: 'Ruth wants to take Harold\'s old boat out on Still Pond, one more time.',
    offer: [
      { who: 'Ruth Calloway', text: 'Harold and I took the boat out every year on the fifth. I haven\'t since he died. My arms won\'t row anymore. Yours will.' },
    ],
    ask: 'Take her out on the pond?',
    stages: [
      { type: 'visit', map: 'cabin', at: [50.5, 12.4], hours: [8, 19], label: 'Meet Ruth at Still Pond and row her out', lines: [
        { who: '', text: '(Harold\'s boat leaks just a little. Ruth bails with a coffee can and laughs every time you splash her.)' },
        { who: 'Ruth Calloway', text: 'He proposed right here. Dropped the ring in the pond. We spent an hour fishing for it with a magnet from the barn.' },
        { who: 'Ruth Calloway', text: '(Quiet.) Thank you, Frank. For rowing. For coming back. Old women need their people to come back.' },
      ] },
    ],
    done: [],
    reward: { xp: 50, rel: ['ruth', 14], jp: ['neighbor', 8], items: { pie: 1 } },
  },
  sv_dale: {
    chapter: 2, side: true, visitOnly: true, giver: 'marcus', title: 'Dale Purcell, Again', hours: [8, 21], needs: (s) => !!s.life.marcusAsk,
    desc: 'Dale Purcell is out on parole and back at the Starlite. Marcus asked for help.',
    offer: [
      { who: 'Marcus Bell', text: 'You came. (He looks older than he did a season ago.) Dale\'s been circling the corner every night after ten. Same Buick. Same long lens.' },
    ],
    ask: 'Stand with Marcus?',
    stages: [
      { type: 'fight', map: 'millbrook', at: [44.5, 31.5], hours: [22, 2], label: 'Meet Dale Purcell at the corner of Larch & Main (10 PM–2 AM)', enemies: ['enforcer', 'scout'], names: ['Dale Purcell', 'Purcell\'s nephew'],
        before: [{ who: 'Dale Purcell', text: '(The Buick stops. Dale gets out with a tire iron and his sister\'s kid.) You\'re the neighbor. Marcus\'s little helper. Move.', choices: [
          { text: '"Her grandkids are in a photo on Marcus\'s fridge. You\'ll never see them. Go home, Dale."', value: 'talk' },
          { text: '"Make me."', value: 'fight' },
        ] }],
        avoidIf: 'talk', avoidLines: [{ who: 'Dale Purcell', text: '(He looks at you. At Marcus on his porch with a revolver across his knees. At the tire iron in his own hand.) ...She was the only one who ever... (He gets back in the car.) Tell her I said— no. Don\'t tell her anything.' }],
        after: [{ who: F, text: '(Dale Purcell sits on the curb holding his jaw. Marcus comes down the steps and reads him the conditions of his parole, from memory.)' }] },
      { type: 'return', label: 'Talk to Marcus' },
    ],
    done: [{ who: 'Marcus Bell', text: 'He\'s back in Michigan by morning, one way or another. (He shakes your hand, and holds on.) Twenty years I did this alone. Thank you, Frank.' }],
    reward: { xp: 70, rel: ['marcus', 14], jp: ['gunhand', 6] },
    rewardBy: { talk: { jp: ['neighbor', 10] } },
  },
  sv_barn: {
    chapter: 3, side: true, visitOnly: true, giver: 'ingrid', title: 'Barn Raising', hours: [7, 19], needs: (s) => !!s.life.barnInvite || (s.chapter >= 4 && rel(s, 'ingrid') >= 3),
    desc: 'Ingrid is raising a new barn, and the whole county is coming.',
    offer: [
      { who: 'Ingrid Haugen', text: 'You came. Good. Grab a hammer. The whole county\'s here and they\'re all doing it wrong.' },
    ],
    ask: 'Help raise the barn?',
    stages: [
      { type: 'bring', item: 'wood', n: 6, label: 'Bring Ingrid 6 wood for the barn' },
      { type: 'repair', map: 'farm', at: [48.5, 29], hits: 4, label: 'Raise the barn frame with the neighbors (Toolkit)' },
      { type: 'return', label: 'Eat with everyone afterwards' },
    ],
    done: [
      { who: '', text: '(Forty people, one barn, a red door. Bo brings coffee. Tess keeps the tally. Pastor Lund blesses it and then helps carry the ridge beam.)' },
      { who: 'Ingrid Haugen', text: 'Pa raised the first one in \'52. He\'d have liked this one. He\'d have liked you here.' },
    ],
    reward: { xp: 60, rel: ['ingrid', 14], rel2: ['bo', 6], jp: ['handyman', 10] },
  },
  sv_boathouse: {
    chapter: 4, side: true, visitOnly: true, giver: 'eleanor', title: 'The Boathouse', hours: [9, 19], needs: (s) => rel(s, 'eleanor') >= 2,
    desc: 'Eleanor wants to live in the boathouse. It needs a floor first.',
    offer: [
      { who: 'Eleanor Whitcombe', text: 'Forty rooms, Mr. Lowe, and I only like the one with the lake in it. I intend to live in the boathouse. It needs a floor and a door that locks.' },
    ],
    ask: 'Fix up the boathouse?',
    stages: [
      { type: 'bring', item: 'wood', n: 4, label: 'Bring Eleanor 4 wood for the boathouse floor' },
      { type: 'repair', map: 'estate', at: [57.5, 39.6], hits: 4, label: 'Lay a new floor in the boathouse (Toolkit)' },
      { type: 'return', label: 'Show Eleanor her new home' },
    ],
    done: [{ who: 'Eleanor Whitcombe', text: '(She stands in the doorway with the lake behind her.) Edward never once built me anything with his own hands. Thank you, Frank. — There. I said Frank.' }],
    reward: { xp: 60, rel: ['eleanor', 14], jp: ['handyman', 8], money: 40 },
  },
};

/** Quiet-day events that start a couple of these stories. */
export const SIDE_EVENTS = [];
