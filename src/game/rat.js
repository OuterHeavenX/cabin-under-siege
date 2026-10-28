// The rat: somebody in town told the mob where you live. Between the probe and
// the first real siege you have a few days to work out who. Clues come from
// talking to people, poking around at the right hour, the poker table, Sunday
// supper and the scanner. Accuse the right person and you choose what happens
// to them; accuse the wrong one and the whole town hears about it.
import { G } from './state.js';
import { inHours, fmtWindow } from './calendar.js';
import { addXP, addJP, addRel } from './progression.js';
import { addThreat } from './siege.js';
import { playDialogue, dialogueActive } from '../ui/dialogue.js';
import { banner, toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { gossipHooks } from './poker.js';
import { supperHooks } from './townlife.js';
import { saveGame } from './save.js';
import { chapter } from './chapters.js';

const ME = 'Frank';
const F = ME;
export const NEED = 3;
const DAYS = 4;

export const CASES = {
  1: {
    step: 'ch1_rat', next: 'reinforce', map: 'town',
    title: 'Who told the grey coat?',
    culprit: 'folk1',
    suspects: { folk1: 'Mr. Henderson', folk3: 'Jenny Miller', folk11: 'Old Man Tibbs', folk2: 'Pastor Abe' },
    clues: {
      dee: {
        how: 'Ask Dee what the grey coat already knew.', talk: 'dee',
        note: 'The grey coat knew your name and had a map to the cabin drawn on a diner napkin. Someone local drew it.',
        lines: [
          { who: 'Dee Marsh', text: 'That man in the grey coat? He didn\'t ask where you lived, Frank. He already knew. Had it drawn on a napkin from the diner.' },
          { who: 'Dee Marsh', text: 'Nobody from out of town knows the Calloway turnoff. Somebody local drew him that map.' },
        ],
      },
      payphone: {
        how: 'Check the diner payphone after dark (8 PM–2 AM).', map: 'town', point: 'payphone', hours: [20, 2],
        note: 'A Newark number scratched into the payphone shelf, and a matchbook from Club Ventura — a Vescari joint. Someone here calls Newark.',
        early: 'Too many people around. Come back after dark.',
        lines: [
          { who: ME, text: '(Scratched into the shelf under the phone, in fresh pencil: a 973 number. Newark.)' },
          { who: ME, text: '(And tucked behind the coin box, a matchbook. Club Ventura. Leo\'s brother-in-law owns it.)' },
        ],
      },
      trash: {
        how: 'Go through the trash behind Henderson\'s place.', map: 'town', point: 'henderson_back', points: 'folk1',
        note: 'Henderson\'s trash: a torn envelope postmarked Newark, NJ and a paper cash band stamped $500.',
        lines: [
          { who: ME, text: '(Coffee grounds, a TV Guide, pipe ash... and a torn envelope. Postmarked Newark, New Jersey.)' },
          { who: ME, text: '(Under it, a bank\'s paper cash band. $500. Henderson pays for his coffee in nickels.)' },
        ],
      },
      tibbs: {
        how: 'Ask Old Man Tibbs what he saw.', talk: 'folk11', points: 'folk1', clears: 'folk11',
        note: 'Tibbs saw Henderson behind the chapel with the grey coat on Tuesday. An envelope changed hands.',
        lines: [
          { who: 'Old Man Tibbs', text: 'I don\'t carry tales. ...But I was cutting through the chapel lot Tuesday. Henderson was out back with that grey coat fella.' },
          { who: 'Old Man Tibbs', text: 'Grey coat handed him an envelope. Henderson looked like he\'d swallowed a fishhook.' },
        ],
      },
      jenny: {
        how: 'Talk to Jenny Miller.', talk: 'folk3', points: 'folk1', clears: 'folk3',
        note: 'Jenny\'s been at the Duluth hospital every night with her mother. She says Henderson paid his diner tab — four months of it — in fifties.',
        lines: [
          { who: 'Jenny Miller', text: 'Me? I\'ve been sleeping in a plastic chair at St. Mary\'s in Duluth all week. Mom\'s hip.' },
          { who: 'Jenny Miller', text: 'You want something odd? Mr. Henderson paid off his whole diner tab Monday. Four months. In fifties.' },
        ],
      },
      abe: {
        how: 'Talk to Pastor Abe.', talk: 'folk2', clears: 'folk2',
        note: 'Pastor Abe won\'t break a confidence — but a man came to him sick with guilt, smelling of pipe tobacco.',
        lines: [
          { who: 'Pastor Abe', text: 'What\'s said to me in the vestry stays there, Frank. You know that.' },
          { who: 'Pastor Abe', text: '...I will say a man sat with me this week, sick with something he\'d done. The whole room smelled of pipe tobacco afterwards.' },
        ],
      },
      poker: {
        how: 'Listen at the poker table (Wed & Sat, 7–11 PM).', hook: true, points: 'folk1',
        note: 'At the poker table Henderson was betting with crisp new fifties. Big Lou noticed too.',
      },
      supper: {
        how: 'Go to Sunday supper and listen.', hook: true,
        note: 'At supper, Henderson sat alone and left before grace. He hasn\'t missed a supper in thirty years.',
      },
      scanner: {
        how: 'Listen to the police scanner at home (build one).', hook: true,
        note: 'On the scanner, a car phone from out of state: "...the old man says one road in, one road out."',
      },
      roll: {
        how: 'Help Mr. Henderson with his pelts.', flag: 'hendersonRoll', points: 'folk1',
        note: 'Henderson paid for the pelts from a roll of bills as thick as your wrist.',
      },
    },
    hooks: {
      poker: { who: 'Big Lou', text: 'Henderson, where\'d you get new fifties? You ain\'t had a fifty since Nixon.' },
      supper: { who: 'Ruth Calloway', text: '(Ruth nods at the end of the table.) Look at Walt Henderson. Sitting alone, not eating. He hasn\'t missed grace in thirty years.' },
    },
    accuse: {
      culprit: [
        { who: 'Mr. Henderson', text: '(The color drains out of him. He sits down on the bench like his legs quit.)' },
        { who: 'Mr. Henderson', text: 'They have my grandson, Frank. Danny. He owes them eleven thousand dollars in Newark.' },
        { who: 'Mr. Henderson', text: 'They said if I told them where the new fella lived, they\'d forgive half. I didn\'t know you. I didn\'t know you.' },
      ],
      wrong: {
        folk3: [{ who: 'Jenny Miller', text: 'I\'ve been at my mother\'s bedside all week and you— get away from me, Frank.' }],
        folk11: [{ who: 'Old Man Tibbs', text: 'Eighty-one years in this town and some Jersey fella calls me a rat. Go to hell, son.' }],
        folk2: [{ who: 'Pastor Abe', text: '(He looks at you for a long moment.) I\'ll pray for you, Frank. I think you need it more than I do.' }],
      },
      outcomes: [
        { value: 'feed', text: '"Keep taking their money. From now on, you tell them what I tell you."', lines: [
          { who: 'Mr. Henderson', text: '...You want me to lie to them. (He nods slowly.) I can do that. God help me, I\'m good at it.' },
          { who: ME, text: '(They\'ll come expecting one man asleep in a cabin. Fewer of them, at the wrong door.)' },
        ] },
        { value: 'expose', text: '"Pack your car. Be gone by morning, and I won\'t tell Dee why."', lines: [
          { who: 'Mr. Henderson', text: 'Forty years I lived here. ...All right. All right.' },
          { who: ME, text: '(By noon the whole town knows Henderson left in the night. Nobody knows why. Everybody guesses. They look at you a little differently — like you\'re one of them.)' },
        ] },
      ],
    },
  },
  2: {
    step: 'ch2_rat', next: 'ch2_fortify', map: 'millbrook',
    title: 'Who\'s watching the house?',
    culprit: 'folk5',
    suspects: { folk5: 'Danny Hendricks', folk4: 'Mrs. Ortiz', folk6: 'Old Mr. Pruitt', marcus: 'Marcus Bell' },
    intro: 'Sal Benedetto knew which house, which door, and when I\'m home. Somebody on Larch Street has been watching for him.',
    clues: {
      marcus: { how: 'Ask Marcus what his plate log shows.', talk: 'marcus', points: 'folk5',
        note: 'Marcus\'s log: a kid on a red Mongoose bike rides past your house three times a day and writes in a notebook.',
        lines: [{ who: 'Marcus Bell', text: 'Cars I log. Bikes I don\'t, usually. But a red Mongoose has gone past your place three times a day for two weeks. Kid writes in a notebook every time.' }] },
      trash: { how: 'Go through the Hendricks family\'s garbage.', map: 'millbrook', point: 'hendricks_trash', points: 'folk5',
        note: 'Hendricks garbage: a receipt for a $300 Mongoose bike, paid cash — and a torn page: "Lowe leaves 7:40, back 5:15."',
        lines: [{ who: F, text: '(A bike shop receipt: Mongoose, red, $300, CASH. Under it, a page torn from a school notebook: "Lowe leaves 7:40. Back 5:15. Lights out 11.")' }] },
      ortiz: { how: 'Talk to Mrs. Ortiz.', talk: 'folk4', points: 'folk5', clears: 'folk4',
        note: 'Mrs. Ortiz was at her sister\'s in Toledo all month. She wants to know where a fourteen-year-old got three hundred dollars for a bike.',
        lines: [{ who: 'Mrs. Ortiz', text: 'Me? I was in Toledo with my sister until Sunday. But the Hendricks boy has a new bicycle. Three hundred dollars! His father can\'t pay the water bill.' }] },
      pruitt: { how: 'Talk to Old Mr. Pruitt.', talk: 'folk6', points: 'folk5', clears: 'folk6',
        note: 'Old Mr. Pruitt hasn\'t left his porch since 1991 — but he saw a man in a Cadillac hand the Hendricks boy an envelope behind the library.',
        lines: [{ who: 'Old Mr. Pruitt', text: 'Haven\'t been off this porch since the Gulf War. But I see things. Cadillac behind the library, Thursday. Man in a nice coat gave the Hendricks boy an envelope.' }] },
      library: { how: 'Look behind the library in the evening (5–10 PM).', map: 'millbrook', point: 'library_back', hours: [17, 22],
        note: 'Behind the library: Parliament butts, and a Polaroid of your front door.',
        early: 'Too many people around. Come back this evening.',
        lines: [{ who: F, text: '(Parliament butts — the grey coat\'s brand, Leo\'s crew\'s brand — and a dropped Polaroid of your front door, taken from across the street.)' }] },
      pete: { how: 'Ask Pete about Marcus.', talk: 'pete', clears: 'marcus',
        note: 'Pete: Marcus plays cribbage at Pete\'s every night Sal\'s car was seen on Larch Street.',
        lines: [{ who: 'Pete Kowalski', text: 'Marcus? Frankie, Marcus has been at my kitchen table every night this month losing at cribbage. He\'s a weird guy but he\'s not THAT guy.' }] },
      poker: { how: 'Listen at card night (Wed & Sat, 7–11 PM).', hook: true, points: 'folk5', note: 'At card night, Danny\'s own father wondered out loud where his boy got the money for a bike.' },
      supper: { how: 'Go to Sunday supper and listen.', hook: true, note: 'At supper, Danny Hendricks wouldn\'t look at you. He left before dessert.' },
      scanner: { how: 'Listen to the police scanner at home (build one).', hook: true, note: 'On the scanner, a car phone: "...kid says he\'s home by five-fifteen, every day."' },
    },
    hooks: {
      poker: { who: 'Danny\'s dad', text: 'My kid\'s got a three-hundred-dollar bike and won\'t say where from. Kids. Huh. Huh.' },
      supper: { who: 'Rosa Delgado', text: '(Rosa nudges you.) The Hendricks boy. He keeps looking at you and then looking at his shoes.' },
    },
    accuse: {
      culprit: [
        { who: 'Danny Hendricks', text: '(He bursts into tears.) He said he was your cousin! He said it was a surprise party! He gave me three hundred bucks and a camera!' },
        { who: 'Danny Hendricks', text: 'I just wrote down when you left and when you came home. That\'s all. Am I in trouble? Are you gonna tell my dad?' },
      ],
      wrong: {
        folk4: [{ who: 'Mrs. Ortiz', text: 'I was in TOLEDO. Ask my sister. Ask her priest! Shame on you, Frank.' }],
        folk6: [{ who: 'Old Mr. Pruitt', text: 'I can\'t walk to the mailbox, son. Sit down before you hurt yourself thinking.' }],
        marcus: [{ who: 'Marcus Bell', text: '(Marcus looks at you for a long, cold time.) I have kept people alive for twenty years, Frank. I\'ll pretend you didn\'t say that. Once.' }],
      },
      outcomes: [
        { value: 'feed', text: '"Keep the notebook. From now on, you write down what I tell you."', lines: [{ who: 'Danny Hendricks', text: '...Like a double agent? (He wipes his nose.) Okay. Okay! Like in the movies.' }, { who: F, text: '(Sal will come believing you work late on Thursdays. You don\'t.)' }] },
        { value: 'expose', text: '"We\'re going to go talk to your father. Right now."', lines: [{ who: F, text: '(Mr. Hendricks listens, goes white, and puts Danny on a bus to his aunt in Toledo that afternoon. Larch Street hears about it by supper.)' }] },
      ],
    },
  },
  3: {
    step: 'ch3_rat', next: 'ch3_fortify', map: 'farm',
    title: 'Who\'s talking to Chicago?',
    culprit: 'folk8',
    suspects: { folk8: 'Hank the trucker', folk7: 'Pastor Lund', bo: 'Bo Lindqvist', tess: 'Tess Albright' },
    intro: 'Mott sold my name — but Mott never saw the farm\'s layout, and Chicago knows it. Somebody in Kettle Crossing drew them the rest.',
    clues: {
      tess: { how: 'Ask Tess about the co-op\'s dispatch log.', talk: 'tess', points: 'folk8', clears: 'tess',
        note: 'Tess\'s dispatch log: Hank drives to Chicago twice a week — twice as often as he has loads.',
        lines: [{ who: 'Tess Albright', text: 'Dispatch log doesn\'t lie. Hank\'s been running to Chicago twice a week. He\'s got loads for once. So what\'s the other trip?' }] },
      truck: { how: 'Search Hank\'s rig on the county road at night (9 PM–3 AM).', map: 'farm', point: 'truck_cab', hours: [21, 3], points: 'folk8',
        note: 'Under the seat of Hank\'s Peterbilt: a freight bill from "Vescari Bros. Cartage, Cicero, IL" — and a hand-drawn map of your farm.',
        early: 'Hank\'s in his cab all day. Come back after dark.',
        lines: [{ who: F, text: '(Under the seat: a bill of lading from Vescari Bros. Cartage, Cicero. And on the back, in pencil: your farmhouse, the barn, the gate, the creek ford.)' }] },
      cb: { how: 'Listen to the café\'s CB radio in the evening (5–11 PM).', map: 'farm', point: 'cb_radio', hours: [17, 23],
        note: 'Café CB, channel 19: "Prairie Dog to Windy City — the Swede\'s farm has one road in." Hank\'s handle is Prairie Dog.',
        early: 'Nobody\'s on the CB this early. Try the evening.',
        lines: [{ who: '', text: '(Static, then:) "...Prairie Dog to Windy City. The Swede\'s place has one road in and a creek ford out back. Over."' }, { who: F, text: '(The waitress, without looking up: "That\'s Hank. Prairie Dog. He thinks it\'s funny.")' }] },
      lund: { how: 'Talk to Pastor Lund.', talk: 'folk7', points: 'folk8', clears: 'folk7',
        note: 'Pastor Lund has prayed with Hank\'s wife every week since Hank came back from Chicago with money and no smile.',
        lines: [{ who: 'Pastor Lund', text: 'I don\'t carry stories, Mr. Lowe. ...But Darlene, Hank\'s wife, has been at my office every week since he started coming home from Chicago with money and no smile.' }] },
      bo: { how: 'Talk to Bo.', talk: 'bo', points: 'folk8', clears: 'bo',
        note: 'Bo: Hank paid off his truck note in cash. Nine thousand dollars, in an envelope.',
        lines: [{ who: 'Bo Lindqvist', text: 'Bank teller\'s my niece. Hank paid off his truck. Nine thousand. Cash, in an envelope. That ain\'t hauling money.' }] },
      grain: { how: 'Help Tess with the co-op\'s missing grain.', flag: 'hankGrain', points: 'folk8',
        note: 'You saw Hank load stolen co-op grain at night and drive it south to Chicago.' },
      poker: { how: 'Listen at the café\'s back booth (Wed & Sat, 7–11 PM).', hook: true, points: 'folk8', note: 'At cards, Hank bet a gold money clip shaped like a V. Bo noticed.' },
      supper: { how: 'Go to Sunday supper and listen.', hook: true, note: 'At supper, Hank\'s wife said he\'s "doing work for some Italians in Cicero" — and Hank told her to hush.' },
      scanner: { how: 'Listen to the police scanner at home (build one).', hook: true, note: 'On the scanner: Deputy Mott\'s car, parked at the truck stop with Hank\'s rig. Twice.' },
    },
    hooks: {
      poker: { who: 'Bo Lindqvist', text: 'Hank, that money clip. Gold. Shaped like a V. You join a fraternity?' },
      supper: { who: 'Pastor Lund', text: '(Darlene, Hank\'s wife, says he\'s "doing work for some Italians in Cicero." Hank tells her to hush. Everyone hears.)' },
    },
    accuse: {
      culprit: [
        { who: 'Hank the trucker', text: '(He sets down his coffee very carefully.) They had my truck note. They had my kid\'s tuition. They said, just tell us about the farm. Just the roads.' },
        { who: 'Hank the trucker', text: 'I didn\'t know they\'d send guns, Frank. ...That\'s a lie. I knew.' },
      ],
      wrong: {
        folk7: [{ who: 'Pastor Lund', text: 'I will forgive that. It will take me a while.' }],
        bo: [{ who: 'Bo Lindqvist', text: '(The shotgun comes up from under the counter, then goes back down.) Get out of my store, Frank. Come back when you\'ve thought about who you\'re talking to.' }],
        tess: [{ who: 'Tess Albright', text: 'I\'m the one who handed you the log, genius. Get off my lot.' }],
      },
      outcomes: [
        { value: 'feed', text: '"Next time Chicago calls, you tell them the ford\'s flooded and I sleep in the barn."', lines: [{ who: 'Hank the trucker', text: 'The ford\'s flooded. You sleep in the barn. (He nods.) Prairie Dog to Windy City. Yeah. I can do that.' }] },
        { value: 'expose', text: '"Get in your truck, Hank. Don\'t come back to Kettle Crossing."', lines: [{ who: F, text: '(The Peterbilt pulls out before dawn and turns south. Darlene stays. The town brings her hotdish for a month.)' }] },
      ],
    },
  },
  4: {
    step: 'ch4_rat', next: 'ch4_fortify', map: 'estate',
    title: 'Who told Nico about the water?',
    culprit: 'folk10',
    suspects: { folk10: 'June Tremblay', folk9: 'Commodore Ames', theo: 'Theo Park', walt: 'Walt Bishop' },
    intro: 'Nico knows the estate wall is solid and the lake side isn\'t. Nobody knows that from the road. Somebody at the club told him.',
    clues: {
      walt: { how: 'Ask Walt about the dock log.', talk: 'walt', points: 'folk10', clears: 'walt',
        note: 'Walt\'s dock log: June Tremblay took the club launch out at 2 AM twice last week, no running lights.',
        lines: [{ who: 'Walt Bishop', text: 'Dock log. Launch out at 0200, twice. No lights. Signed out to J. Tremblay. Bookkeepers don\'t night-sail.' }] },
      office: { how: 'Check the yacht club office.', map: 'estate', point: 'club_office', points: 'folk10',
        note: 'Club ledger: $40,000 missing over two years. June keeps the books.',
        lines: [{ who: F, text: '(The club ledger, in June\'s tidy hand. Forty thousand dollars has walked out of it over two years, nine hundred at a time.)' }] },
      boat: { how: 'Search June\'s boat at the marina at night (9 PM–3 AM).', map: 'estate', point: 'june_boat', hours: [21, 3], points: 'folk10',
        early: 'Too many people at the marina. Come back after dark.',
        note: 'June\'s boat: a chart of the estate shoreline with the boathouse circled in red, and a matchbook from a Providence club Nico owns.',
        lines: [{ who: F, text: '(A chart of the Whitcombe shoreline. The boathouse is circled in red, the depth written next to it. A matchbook: The Velvet Room, Providence. Nico\'s place.)' }] },
      ames: { how: 'Talk to Commodore Ames.', talk: 'folk9', points: 'folk10', clears: 'folk9',
        note: 'Ames: June has been crying in the club bar every night. She owes "some people in Providence."',
        lines: [{ who: 'Commodore Ames', text: 'Me? I\'m too old to betray anybody, young man. Ask June. She\'s been crying into her gin every night. Owes some people in Providence, she says.' }] },
      theo: { how: 'Talk to Theo.', talk: 'theo', points: 'folk10', clears: 'theo',
        note: 'Theo sold June marine charts of the Whitcombe shoreline. "For a painting," she said.',
        lines: [{ who: 'Theo Park', text: 'Charts? I sold June the whole Whitcombe shoreline set last month. She said it was for a watercolor. She can\'t paint, Frank. I\'ve seen her Christmas cards.' }] },
      poker: { how: 'Listen at the club card game (Wed & Sat, 7–11 PM).', hook: true, points: 'folk10', note: 'At the club game, June bet with a chip from a Providence casino — Nico Vescari\'s.' },
      supper: { how: 'Go to Sunday supper and listen.', hook: true, note: 'At supper, June asked Eleanor, very casually, how deep the water is by the boathouse.' },
      scanner: { how: 'Listen to the police scanner at home (build one).', hook: true, note: 'On the scanner, the harbor patrol: "unlit launch off Whitcombe Point, 0200, signed to the yacht club."' },
    },
    hooks: {
      poker: { who: 'Dr. Halvorsen', text: 'June, that\'s a Velvet Room chip. Providence? Since when do you gamble in Providence?' },
      supper: { who: 'Eleanor Whitcombe', text: '(Eleanor, after June leaves:) That girl just asked me how deep the water is by my boathouse. In April. Why would anyone ask that in April?' },
    },
    accuse: {
      culprit: [
        { who: 'June Tremblay', text: '(Her face crumples.) It was nine hundred dollars at a time. Then it was forty thousand. Then a man named Nico said he\'d forget all of it.' },
        { who: 'June Tremblay', text: 'All he wanted was the shoreline. I told myself it was just a map.' },
      ],
      wrong: {
        folk9: [{ who: 'Commodore Ames', text: 'Young man, I have been accused of many things by better men. Good day.' }],
        theo: [{ who: 'Theo Park', text: 'Me?! I sell JAM, Frank. I can\'t even betray a diet.' }],
        walt: [{ who: 'Walt Bishop', text: '...No.' }, { who: '', text: '(Walt walks away. He doesn\'t speak to you for the rest of the day.)' }],
      },
      outcomes: [
        { value: 'feed', text: '"Tell Nico the boathouse channel silted up. Big boats run aground."', lines: [{ who: 'June Tremblay', text: '"Silted up." Okay. (She takes a breath.) I\'m good at numbers. I can be good at lies.' }] },
        { value: 'expose', text: '"Turn yourself in to Agent Reyes. Tonight."', lines: [{ who: F, text: '(June walks into the FBI\'s field office in Burlington the next morning with the club ledger in both arms. The club is scandalized. The jam guy is delighted.)' }] },
      ],
    },
  },
  5: {
    step: 'ch5_rat', next: 'ch5_allies', map: 'shorthills',
    title: 'Who\'s feeding Leo?',
    culprit: 'folk14',
    suspects: { folk14: 'Old Vito', folk12: 'Mrs. Ferraro', folk13: 'Paulie the paperboy', angie: 'Angie Marchetti' },
    intro: 'Leo knew about the recon before I was back on the porch. Someone on the avenue reports to the hill. Before I call in favors, I need to know who.',
    clues: {
      paulie: { how: 'Talk to Paulie the paperboy.', talk: 'folk13', points: 'folk14', clears: 'folk13',
        note: 'Paulie\'s route: every morning at six, Old Vito has coffee behind the Ravenna Social Club with Leo\'s driver.',
        lines: [{ who: 'Paulie the paperboy', text: 'I do the avenue at six. Every morning Old Vito\'s behind the Ravenna club having coffee with Dante\'s driver. Every morning, Mr. Corsetti.' }] },
      club: { how: 'Look behind the Ravenna Social Club at night (9 PM–2 AM).', map: 'shorthills', point: 'club_back', hours: [21, 2], points: 'folk14',
        early: 'Too many eyes on the avenue. Come back after dark.',
        note: 'Behind the Ravenna club: a list of your comings and goings in an old man\'s shaky handwriting, in Vito\'s Buick.',
        lines: [{ who: F, text: '(Vito\'s Buick, unlocked. On the seat, a steno pad: your name, the watch house, times. The handwriting shakes. It\'s an old man\'s.)' }] },
      ferraro: { how: 'Talk to Mrs. Ferraro.', talk: 'folk12', points: 'folk14', clears: 'folk12',
        note: 'Mrs. Ferraro: Vito\'s grandson got a fancy lawyer for his drug case. Leo paid.',
        lines: [{ who: 'Mrs. Ferraro', text: 'Me, I talk to God and my cat. But Vito\'s grandson — the drug case? Somebody paid for a lawyer from Manhattan. Vito drives a bus for a pension. You do the math.' }] },
      angie: { how: 'Talk to Angie.', talk: 'angie', points: 'folk14', clears: 'angie',
        note: 'Angie: Vito drove for Leo\'s father for twenty years. "Once a Vescari driver..."',
        lines: [{ who: 'Angie Marchetti', text: 'Joey and me, we hate Leo. You know that. ...Vito, though. Vito drove for Leo\'s father twenty years. Once a Vescari driver, Frank.' }] },
      dom: { how: 'Talk to Father Dom.', talk: 'dom',
        note: 'Father Dom won\'t break the seal of confession. But he says an old man came to him crying about "the boy Corsetti."',
        lines: [{ who: 'Father Dominic Russo', text: 'You know I can\'t, Francis. ...An old man came to me in tears this week. About "Rosa\'s boy." That is all I will ever say.' }] },
      poker: { how: 'Listen at Mickey\'s card night (Wed & Sat, 7–11 PM).', hook: true, points: 'folk14', note: 'At Mickey\'s table, Vito let slip that you sleep in the back room — and nobody had told him that.' },
      supper: { how: 'Go to Sunday supper at St. Rose and listen.', hook: true, note: 'At supper, Vito left early — and a black Lincoln picked him up at the corner.' },
      scanner: { how: 'Listen to the police scanner at home (build one).', hook: true, note: 'On the scanner: a car phone on the Vescari line — "the old man says Corsetti\'s got friends coming."' },
    },
    hooks: {
      poker: { who: 'Old Vito', text: 'Back room\'s warmer anyway, Frankie, that\'s why you sleep there— (He stops. Mickey stops. Nobody told Vito that.)' },
      supper: { who: 'Father Dominic Russo', text: '(Dom watches Vito leave before the cannoli. A black Lincoln is waiting at the corner. Dom crosses himself.)' },
    },
    accuse: {
      culprit: [
        { who: 'Old Vito', text: '(He takes off his cap.) My grandson. Five years, the prosecutor wanted. Leo made it go away. Leo always makes it go away.' },
        { who: 'Old Vito', text: 'I held you at your christening, Frankie. I\'m sorry. I\'m an old man and I\'m a coward.' },
      ],
      wrong: {
        folk12: [{ who: 'Mrs. Ferraro', text: 'Rosa Corsetti\'s son calls me a rat. On the avenue. God forgive you. My cat won\'t.' }],
        folk13: [{ who: 'Paulie the paperboy', text: 'I\'m TWELVE, Mr. Corsetti.' }],
        angie: [{ who: 'Angie Marchetti', text: 'They killed my brother. And you— (She turns her back on you.) Get out of my store.' }],
      },
      outcomes: [
        { value: 'feed', text: '"Keep having coffee with Dante\'s driver. Tell them I\'m alone up there."', lines: [{ who: 'Old Vito', text: '"Alone." (He puts his cap back on.) For Rosa. I\'ll do it for Rosa.' }] },
        { value: 'expose', text: '"Go to your daughter\'s in Florida, Vito. Today."', lines: [{ who: F, text: '(Vito\'s Buick is gone by noon. The avenue knows by one. By two, three people who never spoke to you nod at you on the sidewalk.)' }] },
      ],
    },
  },
};

const townPeople = () => { const ch = chapter(); return [ch.neighbor, ch.shopkeeper, ch.jobContact]; };
const C = () => (G.endless || G.prequel ? null : CASES[G.s.chapter]);
/** Where the outcome is stored: `rat` for Chapter 1, `rat2`…`rat5` after. */
export const ratKey = () => (G.s.chapter === 1 ? 'rat' : `rat${G.s.chapter}`);
export const ratState = () => {
  const f = G.s.story.flags;
  return f.rat || (f.rat = { clues: {}, wrong: [], deadline: G.s.time.day + DAYS });
};
const active = () => C() && G.s.story.step === C().step;

/** Clues found so far (flag clues count once their flag is set). */
export function cluesFound() {
  const c = C();
  if (!c) return [];
  const r = ratState();
  for (const [id, cl] of Object.entries(c.clues)) if (cl.flag && G.s.story.flags[cl.flag] && !r.clues[id]) r.clues[id] = G.s.time.day;
  return Object.keys(r.clues);
}

function findClue(id, then) {
  const r = ratState(), cl = C().clues[id];
  if (r.clues[id]) { then && then(); return; }
  r.clues[id] = G.s.time.day;
  const n = cluesFound().length;
  const go = () => {
    sfx('chime');
    banner(`🐀 Clue: ${cl.note}`, 'objective', 6);
    if (n === NEED) toast('That\'s enough to accuse someone. Talk to your suspect.', 'info', 4);
    addXP(10, 'Clue');
    addJP('shadow', 3);
    saveGame('clue');
    then && then();
  };
  if (cl.lines) playDialogue(cl.lines, go); else go();
}

export function startRatCase() {
  const r = ratState();
  r.deadline = G.s.time.day + DAYS;
  cluesFound();
}

export function ratObjective() {
  const r = ratState();
  const n = cluesFound().length;
  const left = Math.max(0, r.deadline - G.s.time.day);
  return `Find the rat: who told the grey coat where you live? Clues ${Math.min(n, NEED)}/${NEED}${n >= NEED ? ' — confront your suspect' : ''} · ${left} day${left === 1 ? '' : 's'} left (Journal → Case board)`;
}

/** Props: the payphone and the trash can (only while the case is open). */
export function ratProps(mapId) {
  if (!active()) return [];
  const c = C(), r = ratState(), m = G.maps[mapId];
  if (!m) return [];
  const out = [];
  for (const [id, cl] of Object.entries(c.clues)) {
    if (!cl.point || cl.map !== mapId || r.clues[id] || !m.points[cl.point]) continue;
    const pt = m.points[cl.point];
    out.push({ rat: id, id: 'rat_' + id, kind: 'quest_find', x: pt.x, y: pt.y, r: 46, label: cl.hours ? `Look around (${fmtWindow(cl.hours)})` : 'Look around' });
  }
  return out;
}

export function ratPropAction(pr) {
  const cl = C().clues[pr.rat];
  if (cl.hours && !inHours(cl.hours)) { toast(cl.early || `Come back ${fmtWindow(cl.hours)}.`, 'info', 3); return; }
  findClue(pr.rat);
}

/** Talking to people while the case is open. Returns true if it took over the conversation. */
export function ratTalk(n, fallthrough) {
  if (!active() || G.siegeActive) return false;
  const c = C(), r = ratState();
  const clue = Object.entries(c.clues).find(([id, cl]) => cl.talk === n.id && !r.clues[id]);
  if (clue) { findClue(clue[0]); return true; }
  if (!c.suspects[n.id] || r.wrong.includes(n.id) || cluesFound().length < NEED) return false;
  const name = c.suspects[n.id];
  let pick = null;
  playDialogue([{ who: name, text: 'Something on your mind, Frank?', choices: [
    { text: `Accuse ${name}: "Somebody sold me out to the man in the grey coat. It was you."`, effect: () => { pick = 'accuse'; return []; } },
    { text: '"Nothing. How are you keeping?"', effect: () => { pick = 'chat'; return []; } },
  ] }], () => { if (pick === 'accuse') accuse(n.id); else if (pick === 'chat' && fallthrough) fallthrough(); });
  return true;
}

function accuse(id) {
  const c = C(), r = ratState();
  if (id !== c.culprit) {
    r.wrong.push(id);
    playDialogue(c.accuse.wrong[id] || [{ who: c.suspects[id], text: 'You\'ve got the wrong person.' }], () => {
      addThreat(5, 'you accused the wrong person');
      for (const nid of [...townPeople(), id]) if (G.s.rel[nid] != null) G.s.rel[nid] = Math.max(0, G.s.rel[nid] - (nid === id ? 12 : 4));
      sfx('miss');
      banner(`Wrong person. Word gets around fast in a small town. (${c.suspects[id]} won't speak to you.)`, 'warn', 5);
    });
    return;
  }
  playDialogue([...c.accuse.culprit, { who: c.suspects[id], text: 'What happens now?', choices: c.accuse.outcomes.map((o) => ({ text: o.text, effect: () => { r.outcome = o.value; return o.lines; } })) }], () => closeCase(r.outcome || 'expose'));
}

function closeCase(outcome) {
  const c = C(), r = ratState();
  r.outcome = outcome;
  (G.s.choices || (G.s.choices = {}))[ratKey()] = outcome;
  if (outcome === 'feed') { addXP(60, 'Turned the rat'); addJP('shadow', 12); addThreat(-10); }
  if (outcome === 'expose') { addXP(60, 'Ran out the rat'); addJP('neighbor', 12); for (const nid of townPeople()) addRel(nid, 6); G.s.story.flags.ratGone = c.culprit; G.npcs = G.npcs.filter((x) => x.id !== c.culprit); }
  if (outcome === 'missed') addThreat(10, 'the rat kept talking');
  G.events.emit('ratClosed', { outcome, next: c.next });
  saveGame('rat');
}

let tick = 0;
export function updateRat(dt) {
  tick -= dt;
  if (tick > 0 || !G.s || !active() || dialogueActive()) return;
  tick = 2;
  const r = ratState();
  if (G.s.time.day > r.deadline) {
    playDialogue([
      { who: ME, text: '(Too late. Whoever it was has had days to tell them everything: the back door, the woodpile, when the lights go out.)' },
      { who: ME, text: 'Fine. Then the cabin has to be ready for anything.' },
    ], () => { banner('The rat is still out there. Expect a harder fight.', 'warn', 5); closeCase('missed'); });
  }
}

/** Journal: the case board. */
export function caseBoard() {
  const c = C();
  if (!c || !G.s.story.flags.rat) return null;
  const r = ratState(), found = cluesFound();
  const clues = Object.entries(c.clues).map(([id, cl]) => ({ id, found: found.includes(id), note: cl.note, how: cl.how }));
  const suspects = Object.entries(c.suspects).map(([id, name]) => {
    const pts = found.filter((k) => c.clues[k].points === id).length;
    const cleared = found.some((k) => c.clues[k].clears === id);
    return { id, name, pts, cleared, wrong: r.wrong.includes(id) };
  });
  return { title: c.title, clues, suspects, need: NEED, outcome: r.outcome, open: active(), left: Math.max(0, r.deadline - G.s.time.day), culpritName: c.suspects[c.culprit] };
}

/* ---- hooks: poker table, Sunday supper, the scanner ---- */
function hookClue(id, line) {
  if (!active() || ratState().clues[id]) return null;
  setTimeout(() => findClue(id), 50);
  return line;
}
gossipHooks.push(() => C() && hookClue('poker', C().hooks.poker));
supperHooks.push(() => C() && hookClue('supper', C().hooks.supper));

const CHATTER = [
  '"...County 12, a cow on Route 2 near the Halvorsen place. Again."',
  '"...unit 4, see the lady on Birch about the raccoon. She says it\'s rabid. It isn\'t."',
  '"...State 31, clear of the truck stop. Coffee\'s fresh if anybody\'s coming by."',
  '"...ten-four, Earl. I mean — county. Ten-four, county."',
  '"...the fair board says the Ferris wheel passed. Barely."',
];
export function initRat() {
  G.events.on('scanner', () => {
    if (active() && !ratState().clues.scanner) { sfx('blip'); findClue('scanner'); return; }
    sfx('blip');
    toast(`📻 ${CHATTER[Math.floor(Math.random() * CHATTER.length)]}`, 'info', 5);
  });
}

/** Where to go next while the case is open. */
export function ratWaypoint() {
  if (!active()) return null;
  const c = C(), r = ratState();
  for (const [id, cl] of Object.entries(c.clues)) {
    if (r.clues[id]) continue;
    if (cl.point && G.maps[cl.map] && (!cl.hours || inHours(cl.hours))) { const p = G.maps[cl.map].points[cl.point]; return { map: cl.map, x: p.x, y: p.y, label: 'Clue' }; }
  }
  for (const [id, cl] of Object.entries(c.clues)) {
    if (r.clues[id] || !cl.talk) continue;
    const n = G.npcs.find((x) => x.id === cl.talk && x.present);
    if (n) return { map: G.map.id, x: n.x, y: n.y, label: n.def.name.split(' ').pop() };
  }
  if (cluesFound().length >= NEED) {
    const n = G.npcs.find((x) => x.id === c.culprit && x.present);
    if (n) return { map: G.map.id, x: n.x, y: n.y, label: 'Suspect' };
  }
  return null;
}
