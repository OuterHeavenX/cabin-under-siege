// Letters and phone calls from the people Frank left behind. Letters reach
// him through Marcus's three-hop mail drop (Akron, Dayton, wherever he is);
// calls come in on the home phone in the evening. Each arrives once.
// `ch`: chapters it can arrive in; `after`: story step in that chapter;
// `needs(s)`: anything else. Lines may hold reply choices (`value`), handled by `result`.
const F = 'Frank';
const R = 'Ruth Calloway';
const D = 'Dee Marsh';
const rel = (s, id) => Math.min(5, Math.floor((s.rel[id] || 0) / 20));
const ruthIn = (s) => !!(s.companion && s.companion.ruth && s.companion.ruth.joined);
const rom = (s) => s.life.romance;
const romance = (s) => rom(s).path === 'romance';
const done = (s, id) => (s.errands[id] || {}).state === 'done';
const ratLine = (s) => ({ feed: 'Mr. Henderson comes to supper again. He sits at the end of the table and doesn\'t say much. Nobody asks why.', expose: 'The Henderson house has a SOLD sign on it. People still don\'t talk about why. Everybody knows anyway.', missed: 'Mr. Henderson keeps to himself. Folks say he looks like a man waiting for a knock on the door.' }[s.choices.rat] || 'Pine Hollow is Pine Hollow. Nothing happens and everybody talks about it.');
const heard = (s) => s.chapter >= 3 ? 'The Duluth paper ran a little story about shooting at a farm in Wisconsin. No names. I read it nine times.' : 'Gus heard on the scanner about trouble on a street in Ohio. He wouldn\'t say if he thought it was you. He didn\'t have to.';

export const LETTERS = [
  /* ---------------- Chapter 2: the first mail through Marcus's drop ---------------- */
  { id: 'l_dee_1', kind: 'letter', from: 'dee', ch: [2], needs: (s) => s.life.mailDrop && rel(s, 'dee') >= 1, title: 'A letter from Dee', lines: (s) => [
    { who: D, text: '"Frank — Ruth gave me the address and made me swear on Walt\'s grave not to show it to anybody. I swore. I lie about a lot of things. Not that."' },
    { who: D, text: `"${ratLine(s)} The diner raised the coffee to a dollar and Tibbs is boycotting. Day four."` },
    { who: D, text: romance(s) ? '"I keep looking at the door at three o\'clock on Thursdays. Not for Earl. For a big fella who used to stock my shelves without being asked. — D."' : '"Eat something green. Write back. — Dee."', choices: [
      { text: 'Write back: tell her about Larch Street, and that you miss the pie.', value: 'warm', lines: [{ who: F, text: '(Two pages. You cross out more than you keep. You don\'t sign your real name, but she\'ll know.)' }] },
      { text: 'Write back: short and friendly. Keep it safe.', value: 'friend', lines: [{ who: F, text: '(Four lines and a joke about Tibbs. Friendly. Careful. Probably right.)' }] },
    ] },
  ], result: (s, v) => { if (v === 'friend' && rom(s).path === 'romance') rom(s).cool = (rom(s).cool || 0) + 1; if (v === 'warm' && rom(s).path !== 'friend') rom(s).warm = (rom(s).warm || 0) + 1; } },
  { id: 'l_ruth_1', kind: 'letter', from: 'ruth', ch: [2], needs: (s) => s.life.mailDrop && !ruthIn(s), title: 'A letter from Ruth', lines: (s) => [
    { who: R, text: '"Frank. The cabin is fine. I air it out Sundays and tell it you\'re coming back. It doesn\'t believe me either."' },
    { who: R, text: `"${rel(s, 'ruth') >= 3 ? 'I miss you more than I thought I would. Don\'t let it go to your head.' : 'The garden came in. Too many zucchini. Nobody to give them to.'} Harold\'s watch still runs slow. — R.C."` },
  ] },
  { id: 'l_gus_1', kind: 'letter', from: 'gus', ch: [2, 3], needs: (s) => s.life.mailDrop && rel(s, 'gus') >= 2, title: 'A postcard from Gus', lines: (s) => [
    { who: 'Gus Okafor', text: `"Lowe. Saw runs good. Board is full. ${done(s, 'gus_2') && (s.errands.gus_2.choice === 'work') ? 'The Miller boy works Saturdays still. Stacks better than you.' : 'Hired a kid from Duluth. He\'s no you.'} — G.O."` },
    { who: F, text: '(A postcard of a sawmill. Gus wrote four lines and somehow they\'re the warmest thing in the mailbox.)' },
  ] },
  { id: 'c_marcus_intro', kind: 'talk', from: 'marcus', ch: [2], after: 'ch2_life', title: 'Marcus and the mail', lines: () => [
    { who: 'Marcus Bell', text: 'Frank. Somebody in Pine Hollow keeps mailing letters to "F. Lowe, care of nowhere." The post office has been sending them to the dead-letter office in St. Paul.' },
    { who: 'Marcus Bell', text: 'I set up a drop for you. Akron, Dayton, here. Three hops. Nobody follows three hops. You\'ll get your mail now — and so will they, if you write back.' },
    { who: F, text: 'I told myself I\'d never write anybody. Letters can be followed.' },
    { who: 'Marcus Bell', text: 'Letters can. People who love you can\'t be followed through three post offices in Ohio. Trust me. I did this for a living.' },
  ], result: (s) => { s.life.mailDrop = true; } },

  /* ---------------- Chapter 3 ---------------- */
  { id: 'l_dee_2', kind: 'letter', from: 'dee', ch: [3], needs: (s) => s.life.read.l_dee_1, title: 'A letter from Dee', lines: (s) => [
    { who: D, text: `"${heard(s)}"` },
    { who: D, text: romance(s) ? '"I closed early Thursday and sat on the steps where you used to eat lunch. Ruth caught me. She didn\'t say anything. She just sat down too."' : '"The store had its best month since Walt. Tourists. A man from Minneapolis asked if we had oat milk. I told him the cow was out."' },
    { who: D, text: '"The Harvest Supper is in the fall. Everybody asks if you\'re coming. I tell them you\'re busy being mysterious. — D."', choices: [
      { text: 'Write back: "Save me a seat at the Harvest Supper."', value: 'seat', lines: [{ who: F, text: '(You write it before you can think better of it. It\'s a promise. You don\'t make many.)' }] },
      { text: 'Write back: "I can\'t come back yet. Not while they\'re still looking."', value: 'later', lines: [{ who: F, text: '(It\'s true. It still feels like closing a door.)' }] },
    ] },
  ], result: (s, v) => { rom(s).supper = v === 'seat'; } },
  { id: 'c_marcus_3', kind: 'call', from: 'marcus', ch: [3], after: 'ch3_life', needs: (s) => !!s.choices.marcusHelp || rel(s, 'marcus') >= 2, title: 'Marcus calls', lines: (s) => [
    { who: 'Marcus Bell', text: 'It\'s me. Don\'t say my name on this line. Ingrid says you\'re working her like a mule and eating like one. Good.' },
    { who: 'Marcus Bell', text: s.choices.marcusHelp ? 'I called Ingrid before you got there. She doesn\'t trust anyone. She trusts you now. That\'s worth more than the farm.' : 'You found your own way to that farm. I respect it. I don\'t like it, but I respect it.' },
    { who: 'Marcus Bell', text: 'Larch Street\'s quiet. Too quiet. The Nguyen kids ride bikes past your old place. I wave. It\'s what I have now instead of a job.' },
  ] },
  { id: 'l_rosa_1', kind: 'letter', from: 'rosa', ch: [3, 4], needs: (s) => rel(s, 'rosa') >= 2, title: 'A letter from Rosa', lines: (s) => [
    { who: 'Rosa Delgado', text: s.choices.rosaStore === 'sell' ? '"I sold the store. I cried for a week. Now I sleep until eight and I grow tomatoes and I yell at Marcus\'s cat. You were right. Don\'t gloat."' : '"I kept the store. Home Depot built one in Mansfield anyway. People drive past it to come to me. Papi would spit on the floor of that place. I just smile."' },
    { who: 'Rosa Delgado', text: '"The Kessler boys say hello. Mrs. Ortiz says you owe her a piano lesson. — R.D."' },
  ] },
  { id: 'c_pete_3', kind: 'call', from: 'pete', ch: [3, 4], needs: (s) => rel(s, 'pete') >= 2, title: 'Pete calls, collect', lines: () => [
    { who: 'Operator', text: 'Will you accept a collect call from... "IT\'S PETE, FRANKIE"?' },
    { who: 'Pete Kowalski', text: 'FRANKIE. Can\'t talk long, my wife\'s watching the phone bill like a hawk. Just wanted to say — the crew misses you. I miss you. Okay that\'s it, bye, love you, bye.' },
  ] },
  { id: 'l_ruth_2', kind: 'letter', from: 'ruth', ch: [3], needs: (s) => !ruthIn(s) && s.life.read.l_ruth_1, title: 'A letter from Ruth', lines: (s) => [
    { who: R, text: `"${heard(s)} I put the kettle on and didn\'t drink it. Write me and tell me you\'re all right."` },
    { who: R, text: '"The pond froze early. I skated on it like a fool, at seventy-one. Harold would have died laughing, if he weren\'t already. — R."', choices: [
      { text: 'Write back: "I\'m all right. I have a farm and a neighbor who scares me."', value: 'ok', lines: [{ who: F, text: '(You draw her a map of the farm. She\'ll pin it to the fridge. You know she will.)' }] },
    ] },
  ] },

  /* ---------------- Chapter 4 ---------------- */
  { id: 'l_dee_3', kind: 'letter', from: 'dee', ch: [4], needs: (s) => s.life.read.l_dee_2, title: 'A letter from Dee', lines: (s) => [
    { who: D, text: rom(s).supper ? '"Harvest Supper is the second Saturday of the month. Your seat is saved. I put a pie on it so Tibbs can\'t take it."' : '"Harvest Supper came and went. I saved a pie anyway. It\'s in the freezer. It will be there."' },
    { who: D, text: romance(s) ? '"I don\'t know what we are, Frank. I\'m too old to pretend I don\'t want to find out. Come home for a weekend. Even a day."' : '"If you ever come back through, the coffee\'s still a dollar and the gossip\'s still free."' },
    { who: F, text: '(Pine Hollow is a long drive. It\'s a drive you could make — the car\'s in the lane.)' },
  ], result: (s) => { s.life.romance.invited = true; } },
  { id: 'c_ingrid_4', kind: 'call', from: 'ingrid', ch: [4], after: 'ch4_life', needs: (s) => rel(s, 'ingrid') >= 2, title: 'Ingrid calls', lines: (s) => [
    { who: 'Ingrid Haugen', text: 'Frank. It\'s Ingrid. (A long pause. Ingrid doesn\'t do phones.)' },
    { who: 'Ingrid Haugen', text: done(s, 'ingrid_3') ? 'Another one came through the hayloft. A boy, sixteen. He asked who used to sleep in the farmhouse. I said a good man. He\'s on the bus.' : 'The gate you fixed held through a blizzard. I thought you should know.' },
    { who: 'Ingrid Haugen', text: 'Eleanor treating you right? If she isn\'t, tell me. I know where she keeps her good china.' },
  ] },
  { id: 'l_marcus_4', kind: 'letter', from: 'marcus', ch: [4], needs: (s) => done(s, 'marcus_3'), title: 'A letter from Marcus', lines: (s) => [
    { who: 'Marcus Bell', text: '"Frank. Dale Purcell made parole. He was at the Starlite again last week. Room 6. Same Buick. He\'s looking for Linda, and he knows I\'m too old to stop him alone."' },
    { who: 'Marcus Bell', text: '"I don\'t ask for help. I\'m asking. — M.B."' },
    { who: F, text: '(Millbrook. You could drive back and stand next to him. Your car\'s in the drive.)' },
  ], result: (s) => { s.life.marcusAsk = true; } },
  { id: 'l_ruth_4', kind: 'letter', from: 'ruth', ch: [4], needs: (s) => !ruthIn(s) && !(s.life.ch[4] || {}).guested, title: 'A letter from Ruth', lines: () => [
    { who: R, text: '"Gus says you live in a castle now. I\'m picturing a drawbridge. Don\'t correct me."' },
    { who: R, text: '"Dee asks about you every Sunday. Don\'t tell her I told you. Actually, do. — R."' },
  ] },

  /* ---------------- Chapter 5 ---------------- */
  { id: 'l_eleanor_5', kind: 'letter', from: 'eleanor', ch: [5], after: 'ch5_life', needs: (s) => rel(s, 'eleanor') >= 2, title: 'A letter from Eleanor Whitcombe', lines: () => [
    { who: 'Eleanor Whitcombe', text: '"Mr. Lowe. The gatehouse is very quiet. Walt has started speaking in complete sentences, which alarms me."' },
    { who: 'Eleanor Whitcombe', text: '"Edward faced the Vescaris alone and lost. Do not do it alone. Use every friend you have. That is an order from a woman with nothing left to lose. — E.W."' },
  ] },
  { id: 'c_dee_5', kind: 'call', from: 'dee', ch: [5], after: 'ch5_life', before: 'ch5_siege', needs: (s) => rel(s, 'dee') >= 2, title: 'Dee calls', lines: (s) => [
    { who: D, text: 'Frank? It\'s Dee. Ruth gave me the number. Don\'t be mad at her. Be mad at me, it\'s more fun.' },
    { who: D, text: romance(s) ? 'I just wanted to hear your voice before... whatever it is you\'re about to do. I can hear it in how you said hello.' : 'Pine Hollow says hi. All two hundred and eleven of us. Tibbs says you still owe him a fish.' },
    { who: D, text: 'Come back to us, Frank. That\'s all. Come back.', choices: [
      { text: '"I will. Save me a seat."', value: 'promise', lines: [{ who: D, text: '(A small sound that might be a laugh.) It\'s already saved. It\'s been saved for months.' }] },
      { text: '"I don\'t know if I can promise that, Dee."', value: 'honest', lines: [{ who: D, text: 'Then don\'t promise. Just do it.' }] },
    ] },
  ] },
  { id: 'c_marcus_5', kind: 'call', from: 'marcus', ch: [5], after: 'ch5_rat', before: 'ch5_siege', needs: (s) => rel(s, 'marcus') >= 2 || !!s.choices.marcusHelp, title: 'Marcus calls', lines: () => [
    { who: 'Marcus Bell', text: 'I\'ve been listening to the Essex County scanner for a week. Leo\'s people are moving. Frank — when you pick up that phone to call in your favors, I\'m on the list. Understood?' },
  ] },

  /* ---------------- After the story ---------------- */
  { id: 'l_post_ruth', kind: 'letter', from: 'ruth', post: true, needs: (s) => !ruthIn(s), title: 'A letter from Ruth', lines: (s) => [
    { who: R, text: s.life.post.ending === 'crown' ? '"I read about the "new man" in Short Hills. I know who you are, Frank. I hope you do too. My door is still open. It always will be."' : '"It\'s over, isn\'t it. I can tell from your handwriting on the last letter. It\'s gotten rounder. Come and see the pond. — R."' },
  ] },
  { id: 'l_post_marcus', kind: 'letter', from: 'marcus', post: true, needs: (s) => rel(s, 'marcus') >= 2 && s.life.post.ending !== 'crown', title: 'A letter from Marcus', lines: (s) => [
    { who: 'Marcus Bell', text: s.life.post.ending === 'justice' ? '"You testified. I sat in the back row for three days. You didn\'t see me. That was the point. Proud of you. — M."' : '"I closed the mail drop. You don\'t need three hops anymore. Write me direct. Larch Street. You know the number. — M."' },
  ] },
  { id: 'l_post_ingrid', kind: 'letter', from: 'ingrid', post: true, needs: (s) => rel(s, 'ingrid') >= 2, title: 'A letter from Ingrid', lines: (s) => [
    { who: 'Ingrid Haugen', text: s.life.post.ending === 'crown' ? '"Pa said you can tell a man by what he does when he wins. I\'m waiting to see. — I.H."' : '"We\'re raising a new barn on the twelfth. Red door. Bring your own hammer. — I.H."' },
  ], result: (s) => { if (s.life.post.ending !== 'crown') s.life.barnInvite = true; } },
];
