// What old friends say when Frank comes back to a town he left. Each entry
// gets the save and how many times he's visited, and returns dialogue lines.
const F = 'Frank';
const PLACE = { 2: 'Millbrook', 3: 'Wisconsin', 4: 'Lake Champlain', 5: 'Short Hills' };
const done = (s, id) => (s.errands[id] || {}).state === 'done';
const post = (s) => s.life && s.life.post;
const ending = (s) => (s.life && s.life.post && s.life.post.ending) || s.ending;
const crown = (s) => post(s) && ending(s) === 'crown';

/** First steps back into an old town (first visit only). */
export const ARRIVALS = {
  1: (s) => [
    { who: '', text: 'Route 9. The diner sign still has a dead "N." Pine Hollow, population 212, give or take one.' },
    { who: F, text: `I left here thinking I'd never see it again. ${s.chapter >= 4 ? 'Three homes later, it still feels like the first one.' : 'Turns out you can come back. You just can\'t stay.'}` },
  ],
  2: (s) => [
    { who: '', text: 'Larch Street. Somebody painted your old mailbox blue and put a tricycle on the porch.' },
    { who: F, text: s.choices && s.choices.rat2 === 'expose' ? 'The Hendricks place has a new family in it too. Good. The kid deserved a fresh start somewhere else.' : 'Marcus\'s curtain moves. Of course it does.' },
  ],
  3: (s) => [
    { who: '', text: 'Kettle Crossing. The co-op silo, the café, two hundred acres of corn stubble and the barn you held for a night.' },
    { who: F, text: s.choices && s.choices.deputy === 'refuse' ? 'No sheriff\'s truck at the crossroads today. Funny how that feels like a welcome.' : 'The gate you fixed is still hanging straight. Somebody\'s been oiling it.' },
  ],
  4: (s) => [
    { who: '', text: 'Port Whitcombe. Masts clicking in the marina, the stone wall, the iron gate. The lake looks innocent in daylight.' },
    { who: F, text: 'Every window I boarded up has been reglazed. Eleanor doesn\'t leave things broken for long.' },
  ],
};

/** Old friends reacting to Frank turning up again. */
export const REUNIONS = {
  ruth: (s, n) => {
    if (n > 1) return [{ who: 'Ruth Calloway', text: 'Twice in one year. People will talk. Sit down, I\'ll put the kettle on.' }];
    return [
      { who: 'Ruth Calloway', text: 'Frank Lowe. You look thinner. You look older. Come here.' },
      { who: 'Ruth Calloway', text: post(s) ? 'I read about Short Hills in the Duluth paper. They didn\'t print your name. I knew anyway.' : `${PLACE[s.chapter] || 'Wherever you are'} treating you all right? Don't answer that, I can see it on you.` },
      { who: F, text: 'I missed your coffee, Ruth.' },
      { who: 'Ruth Calloway', text: 'You missed my cooking. The coffee is terrible. Stay for supper.' },
    ];
  },
  dee: (s, n) => {
    const r = s.life && s.life.romance;
    if (crown(s)) return [{ who: 'Dee Marsh', text: '(Dee looks at your coat, your car, and the man waiting in it.) So it\'s "Mr. Corsetti" now. ...What can I get you, Frank? Shells are on the left.' }];
    if (n > 1) return [{ who: 'Dee Marsh', text: r && r.path === 'romance' ? 'You again. (She\'s already smiling.) I saved you the good pie.' : 'Back again? Pine Hollow\'s going to start charging you rent.' }];
    return [
      { who: 'Dee Marsh', text: 'Well, look what the Interstate dragged in.' },
      { who: 'Dee Marsh', text: r && r.path === 'romance' ? '(She comes around the counter, then stops, like she\'s not sure what she\'s allowed.) ...Hi.' : 'Gus owes me ten dollars. He said you\'d never come back.' },
      ...(done(s, 'dee_4') || done(s, 'dee_4p') || done(s, 'dee_4t') ? [{ who: 'Dee Marsh', text: 'Nobody\'s collected "insurance" since you left. I still keep the fifty in the register on Thursdays out of habit. Then I spend it on pie.' }] : []),
    ];
  },
  gus: (s, n) => {
    if (n > 1) return [{ who: 'Gus Okafor', text: 'Board\'s by the office. Still seven to five. Still don\'t make me chase you.' }];
    return [
      { who: 'Gus Okafor', text: 'Lowe. (A handshake that goes on a little long.) Saw went fifteen thousand hours since you rebuilt the carriage. Not a wobble.' },
      { who: 'Gus Okafor', text: s.choices && s.choices.rat === 'expose' ? 'Henderson\'s house sold. Nobody talks about it. Everybody thinks about it.' : 'Town\'s the same. That\'s the point of a town like this.' },
      { who: 'Gus Okafor', text: 'Work\'s on the board if you want it. Pays the same as it did. Which is to say, fair.' },
    ];
  },
  marcus: (s, n) => {
    if (crown(s)) return [{ who: 'Marcus Bell', text: 'I spent twenty-six years hiding people from men in nice coats, Frank. (He doesn\'t open the screen door.) Take care of yourself.' }];
    if (n > 1) return [{ who: 'Marcus Bell', text: 'Grey sedan, Indiana plates, parked by the library twice this week. Teacher\'s husband. I checked. Hello, Frank.' }];
    return [
      { who: 'Marcus Bell', text: 'You came in on Route 9 at 2:40 with an empty passenger seat. I clocked you at the light.' },
      { who: F, text: 'Hello to you too, Marcus.' },
      { who: 'Marcus Bell', text: s.choices && s.choices.marcusHelp ? 'Ingrid says you held her farm with an old woman and a shotgun. I told her that\'s my boy. Don\'t tell her I said "my boy."' : 'You never called after Millbrook. I understood. I still worried.' },
      ...(post(s) && ending(s) === 'justice' ? [{ who: 'Marcus Bell', text: 'And you testified. I read the transcripts. Your voice didn\'t shake once on paper. I bet it shook in the room.' }] : []),
    ];
  },
  rosa: (s, n) => {
    if (n > 1) return [{ who: 'Rosa Delgado', text: 'Frank! The van still runs. Tell your engine I said thank you.' }];
    return [
      { who: 'Rosa Delgado', text: 'Frank Lowe in my store. (She shouts toward the back.) Papi\'s van, Frank fixed it, I told you he\'d come back!' },
      { who: 'Rosa Delgado', text: done(s, 'rosa_2') ? 'The Kessler boys work for me now. Their mother insisted. They\'re terrible. I love them.' : 'Same prices. Higher for you, because I missed you.' },
    ];
  },
  pete: (s, n) => {
    if (n > 1) return [{ who: 'Pete Kowalski', text: 'FRANKIE. You want work? I got a sleeper sofa going to the third floor with no elevator. Come on.' }];
    return [
      { who: 'Pete Kowalski', text: 'FRANKIE! (You get hugged. You get lifted slightly.) Look at you! You look like a guy who\'s been through some things!' },
      { who: 'Pete Kowalski', text: done(s, 'pete_2') ? 'I beat Walt the mailman last month. ON MY OWN. I thought of you the whole hand.' : 'Mrs. Ortiz plays that piano every night now. Badly. Beautifully. You should hear it.' },
    ];
  },
  ingrid: (s, n) => {
    if (crown(s)) return [{ who: 'Ingrid Haugen', text: 'Pa hid people from families like the one you run now. (She keeps her hand on the gate.) Visit the calf. Then go.' }];
    if (n > 1) return [{ who: 'Ingrid Haugen', text: 'You\'re back. Boots by the door. The calf remembers you, which is more than I can say for the deputy.' }];
    return [
      { who: 'Ingrid Haugen', text: 'Frank. (A nod. For Ingrid that\'s a parade.)' },
      { who: 'Ingrid Haugen', text: done(s, 'ingrid_1') ? 'Your bull calf\'s nine hundred pounds of trouble now. I named him after you. He breaks fences.' : 'The gate held all winter. Pa would\'ve said you hang a gate like a Lutheran.' },
      ...((s.errands.ingrid_3 && s.errands.ingrid_3.choice === 'again') ? [{ who: 'Ingrid Haugen', text: 'Two more came through the hayloft since you left. Both made the bus.' }] : []),
    ];
  },
  bo: (s, n) => n > 1 ? [{ who: 'Bo Lindqvist', text: 'Shells or gossip? Both on credit.' }] : [
    { who: 'Bo Lindqvist', text: 'Well, I\'ll be. The city fella who field-dresses deer. Coffee\'s on. It\'s bad.' },
    { who: 'Bo Lindqvist', text: s.choices && s.choices.rat3 === 'expose' ? 'Hank\'s Darlene runs the café now. Doing better than Hank ever did.' : 'Hank still drives to Chicago. Different loads, he says. I don\'t ask.' },
  ],
  tess: (s, n) => n > 1 ? [{ who: 'Tess Albright', text: 'Board\'s out front. Co-op pays Fridays. And every other day.' }] : [
    { who: 'Tess Albright', text: 'You. The dispatch log\'s been missing your handwriting.' },
    { who: 'Tess Albright', text: done(s, 'tess_2') ? 'Still running that \'78 Kenworth on the bed you built. The back roads are yours if you want a shift.' : 'You want work, you know where the board is.' },
  ],
  eleanor: (s, n) => {
    if (n > 1) return [{ who: 'Eleanor Whitcombe', text: 'Mr. Lowe. The gatehouse kettle has been boiling since your car turned off the highway. Walt telephoned.' }];
    return [
      { who: 'Eleanor Whitcombe', text: 'Mr. Lowe. Back to be boring, as promised? I did warn the club.' },
      { who: 'Eleanor Whitcombe', text: post(s) ? (ending(s) === 'crown' ? 'I hear you inherited a family. Edward inherited one too. Do try to end better than he did.' : 'Leo Vescari\'s name has stopped appearing in the society pages. I assume that was you. Don\'t confirm it.') : 'The lake has been very quiet since spring. I find I almost miss the boats.' },
    ];
  },
  theo: (s, n) => n > 1 ? [{ who: 'Theo Park', text: 'My favorite caretaker! The jam\'s in two stores now. TWO, Frank.' }] : [
    { who: 'Theo Park', text: 'FRANK. Caretaker\'s Cut sold out in nine days. You\'re a regional icon. Your vibe is, anyway.' },
  ],
  walt: (s, n) => n > 1 ? [{ who: 'Walt Bishop', text: 'Caretaker.' }, { who: 'Walt Bishop', text: '(He hands you a coffee. That\'s the conversation.)' }] : [
    { who: 'Walt Bishop', text: post(s) ? 'Caretaker. Heard about the end of it. (A long pause.) Good.' : 'Caretaker. Mrs. Whitcombe said you\'d turn up. She\'s usually right. Don\'t tell her.' },
    { who: 'Walt Bishop', text: 'Range is still open at dawn. Your left eye still flinches, I\'d bet.' },
  ],
};
