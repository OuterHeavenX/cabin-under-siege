// Days to mark through the year. Each happens once a year, in whatever town
// Frank lives in; lines use that chapter's people (neighbor, shopkeeper, job
// contact), so the same day reads differently in Pine Hollow and Short Hills.
// `from` is the first day of the season it can happen on.
import { NPCS } from './npcs.js';

const F = 'Frank';
const nm = (id) => NPCS[id].name;
const first = (id) => NPCS[id].name.split(' ')[0].replace(/"/g, '');
const ruthIn = (s) => !!(s.companion && s.companion.ruth && s.companion.ruth.joined);
const rel = (s, id) => s.rel[id] || 0;

export const SEASONAL = [
  /* ---------------- Autumn ---------------- */
  { id: 'deer_opener', season: 'autumn', from: 2, title: 'Opening day of deer season', where: 'home', hours: [6, 10],
    lines: (s, ch) => [
      { who: '', text: `(Orange hats in the treeline at first light. ${first(ch.jobContact)} leans on your gate with a thermos.)` },
      { who: nm(ch.jobContact), text: 'Opening day. Half the county\'s in the woods and the deer know it. They\'re moving — dawn and dusk, all week. If you\'ve got a rifle, now\'s the time.',
        choices: [
          { text: '"Pour me a cup. Where are they crossing?"', value: 'talk', lines: [{ who: nm(ch.jobContact), text: 'Low ground by the water, every evening. Don\'t shoot anything that\'s wearing orange.' }] },
          { text: '"I\'ve had enough of people with rifles in my trees."', value: 'no', lines: [{ who: nm(ch.jobContact), text: '(A long look.) ...Fair. I\'ll tell them to stay off your land.' }] },
        ] },
    ],
    reward: (s, v, ch) => ({ rel: [ch.jobContact, v === 'talk' ? 5 : 2], jp: ['survivor', 6] }),
    note: 'Autumn: more deer about at dawn and dusk.' },
  { id: 'thanksgiving', season: 'autumn', from: 8, title: 'Thanksgiving', where: 'home', hours: [14, 20], sound: 'chime', moment: true,
    lines: (s, ch) => {
      const guests = [first(ch.neighbor), ruthIn(s) ? 'Ruth' : null, rel(s, ch.shopkeeper) >= 20 ? first(ch.shopkeeper) : null].filter(Boolean);
      return [
        { who: '', text: `(Thanksgiving. ${guests.join(' and ')} ${guests.length > 1 ? 'are' : 'is'} at your door with covered dishes and the look of people who won't take no.)` },
        { who: nm(ch.neighbor), text: 'Nobody eats alone on Thanksgiving. That\'s the rule. I don\'t make the rules. I just enforce them.',
          choices: [
            { text: 'Buy a turkey from the store and do it properly ($25)', value: 'turkey', cost: 25, fallback: 'potluck', lines: [{ who: F, text: '(It comes out dry on one side and raw on the other. Everybody says it\'s perfect. Nobody\'s lying, exactly.)' }] },
            { text: '"I\'ve got venison. Let me cook."', value: 'venison', lines: [{ who: F, text: '(Venison, onions, whatever the garden had. Your mother\'s recipe, more or less. The table goes quiet for the first bite.)' }] },
            { text: '"Potluck it is. I\'ll do the dishes."', value: 'potluck', lines: [{ who: F, text: '(Three kinds of potatoes, no turkey, a pie somebody\'s aunt swears by. You do the dishes. It\'s the best night you\'ve had in years.)' }] },
          ] },
        { who: F, text: '(Somebody makes you say what you\'re thankful for. You say "the company." It\'s the truest thing you\'ve said out loud in a long time.)' },
      ];
    },
    reward: (s, v, ch) => ({ rel: [ch.neighbor, v === 'potluck' ? 6 : 9], rel2: ruthIn(s) ? ['ruth', 6] : [ch.shopkeeper, 4], jp: ['neighbor', 8] }),
    result: (s, v) => { if (v === 'venison' && (s.inv.venison || 0) > 0) s.inv.venison -= 1; } },

  /* ---------------- Winter ---------------- */
  { id: 'snow_day', season: 'winter', from: 2, title: 'Snowed in', where: 'home', hours: [7, 11], sound: 'warning',
    lines: (s, ch) => [
      { who: '', text: '(You open the door onto a wall of white. Two feet overnight, drifted to the window sills. The world has gone silent.)' },
      { who: F, text: 'Nobody\'s coming up that road today. Not the mail. Not anybody else, either.',
        choices: [
          { text: 'Dig out the drive and the paths (hard work)', value: 'dig', lines: [{ who: F, text: '(Two hours of shoveling. Your back hates you. The paths to the woodpile and the road are clear, and you can see who comes up them.)' }] },
          { text: `Walk over and check on ${first(ch.neighbor)}`, value: 'check', lines: [{ who: nm(ch.neighbor), text: '(Pleased, pretending not to be.) I\'ve lived through forty of these. ...Come in anyway. The coffee\'s on.' }] },
          { text: 'Back to bed. Let it snow.', value: 'bed', lines: [{ who: F, text: '(You sleep until ten with the stove ticking. Nobody comes. Nobody could.)' }] },
        ] },
    ],
    reward: (s, v, ch) => (v === 'dig' ? { jp: ['survivor', 10], xp: 20 } : v === 'check' ? { rel: [ch.neighbor, 7] } : { jp: ['survivor', 4] }),
    note: 'Snow shows tracks — theirs and yours. Look for them.' },
  { id: 'ice_fishing', season: 'winter', from: 4, title: 'Ice fishing', where: 'home', hours: [8, 14], moment: true,
    lines: (s, ch) => [
      { who: '', text: `(${first(ch.neighbor)} is at your door with an auger, two buckets and a folding stool.)` },
      { who: nm(ch.neighbor), text: 'Ice is a foot thick. You\'re coming. Bring a thermos and don\'t talk — the fish can hear you think.',
        choices: [
          { text: '"Lead the way."', value: 'go', lines: [{ who: F, text: '(Three hours on a bucket over a hole in the ice. Six perch. Four words exchanged. You understand, finally, why people do this.)' }] },
          { text: '"Another day. I\'ve got work."', value: 'no', lines: [{ who: nm(ch.neighbor), text: 'Suit yourself. The perch will be there. So will I.' }] },
        ] },
    ],
    reward: (s, v, ch) => (v === 'go' ? { rel: [ch.neighbor, 6], items: { fish: 4 } } : null),
    note: 'The ice holds weight now — on the ponds and the lake. That cuts both ways.' },
  { id: 'christmas', season: 'winter', from: 8, title: 'Christmas Eve', where: 'home', hours: [16, 22], moment: true,
    lines: (s, ch) => [
      { who: '', text: '(Christmas Eve. A card in the mailbox with no return address — just a drawing of a cabin and "WE MISS YOU" in a hand you\'d know anywhere.)' },
      ruthIn(s)
        ? { who: 'Ruth Calloway', text: '(Ruth has strung popcorn across your window and is daring you to say something about it.) My husband did this every year. Somebody has to keep doing it.' }
        : { who: nm(ch.neighbor), text: `(${first(ch.neighbor)} drops off a plate of cookies and doesn't stay.) Merry Christmas, Frank. Whatever your name really is.` },
      { who: F, text: 'Christmas Eve in Newark meant the seven fishes at Leo\'s table. Thirty people. Nobody you could trust. This is better.',
        choices: [
          { text: 'Write back to everyone who\'s written you', value: 'write', lines: [{ who: F, text: '(It takes all evening. You don\'t sign your real name on any of them. They\'ll know.)' }] },
          { text: 'Go to the midnight service in town', value: 'church', lines: [{ who: F, text: '(You stand at the back. You don\'t sing. When the lights go down for the candles you feel, for a second, forgiven.)' }] },
        ] },
    ],
    reward: (s, v, ch) => (v === 'write' ? { rel: [ch.neighbor, 4], rel2: ['dee', 4], jp: ['neighbor', 6] } : { rel: [ch.neighbor, 6], xp: 25 }) },

  /* ---------------- Spring ---------------- */
  { id: 'planting', season: 'spring', from: 2, title: 'Planting day', where: 'home', hours: [8, 15], moment: true,
    lines: (s, ch) => [
      { who: '', text: `(${first(ch.neighbor)} arrives with a flat of seedlings in each arm: tomatoes, beans, a squash plant with ambitions.)` },
      { who: nm(ch.neighbor), text: 'Ground\'s soft. Mud season. Put these in before the weekend or they\'ll sulk.',
        choices: [
          { text: 'Plant them together', value: 'plant', lines: [{ who: F, text: '(On your knees in the dirt, getting directions on how deep, how far apart, and why you\'re doing it wrong. You\'re doing it wrong. It\'s fine.)' }] },
          { text: '"Leave them on the porch. I\'ll get to it."', value: 'later', lines: [{ who: nm(ch.neighbor), text: 'You won\'t. But I\'ll pretend to believe you.' }] },
        ] },
    ],
    reward: (s, v, ch) => (v === 'plant' ? { rel: [ch.neighbor, 6], items: { vegetables: 3 } } : { items: { vegetables: 1 } }),
    note: 'Spring mud: after rain, open ground slows everyone — you and them.' },
  { id: 'opening_day', season: 'spring', from: 6, title: 'Opening Day', where: 'town', hours: [12, 17],
    lines: (s, ch) => [
      { who: '', text: `(A radio on the counter at ${ch.storeName}. Opening Day. ${first(ch.shopkeeper)} has a scorecard and strong opinions.)` },
      { who: nm(ch.shopkeeper), text: 'You a baseball man, Frank? Everybody\'s a baseball man on Opening Day.',
        choices: [
          { text: '"Yankees. Don\'t start."', value: 'yankees', lines: [{ who: nm(ch.shopkeeper), text: 'Of course you are. (They pour you a coffee anyway.) Sit. Bottom of the third.' }] },
          { text: '"Never followed it."', value: 'none', lines: [{ who: nm(ch.shopkeeper), text: 'Then sit down. I\'ll explain it. It\'ll take nine innings.' }] },
        ] },
    ],
    reward: (s, v, ch) => ({ rel: [ch.shopkeeper, 5] }) },

  /* ---------------- Summer ---------------- */
  { id: 'heat_wave', season: 'summer', from: 2, title: 'Heat wave', where: 'home', hours: [11, 17],
    lines: (s, ch) => [
      { who: '', text: '(Ninety-eight in the shade. The grass has gone the color of straw and crackles underfoot.)' },
      { who: nm(ch.neighbor), text: `(${first(ch.neighbor)}, fanning themselves on your porch with a newspaper.) County's banned burning. One cigarette and this whole valley goes up. Remember that, if anybody comes calling with bottles.` },
    ],
    reward: (s, v, ch) => ({ rel: [ch.neighbor, 3] }),
    note: 'Summer: fires burn longer and spread wider. Keep water and wits about you.' },
  { id: 'fourth', season: 'summer', from: 6, title: 'The Fourth of July', where: 'home', hours: [18, 23], moment: true,
    lines: (s, ch) => [
      { who: '', text: '(Fireworks over town. Bangs that echo off the hills, long and flat, for an hour.)' },
      { who: F, text: 'Every bang sounds like a shotgun. Every whistle sounds like something worse. Twenty years of instinct, and it all says "get down."',
        choices: [
          { text: 'Sit on the porch and make yourself watch', value: 'watch', lines: [{ who: F, text: '(Red, white, gold. Your hands stop shaking somewhere in the second half. That\'s new.)' }] },
          { text: `Go down to town with ${first(ch.neighbor)}`, value: 'town', lines: [{ who: nm(ch.neighbor), text: '(On a blanket by the water, handing you a sparkler like a dare.) Go on. Nobody\'s watching you, Frank. Everybody\'s looking up.' }] },
          { text: 'Lights off. Watch the treeline instead.', value: 'watchtrees', lines: [{ who: F, text: '(Perfect cover for gunfire, a fireworks night. Nobody comes. You still don\'t sleep until two.)' }] },
        ] },
    ],
    reward: (s, v, ch) => (v === 'town' ? { rel: [ch.neighbor, 8] } : v === 'watch' ? { jp: ['survivor', 8] } : { jp: ['shadow', 8] }) },
];
