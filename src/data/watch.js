// The threat closing in, per home: watcher signs to investigate (ambiguous on
// purpose), a small probing attack, and what they leave behind. Positions are
// tiles; the engine nudges them onto the nearest walkable cell.
const F = 'Frank';

export const WATCH = {
  1: {
    // Chapter 1 already has its watcher (boot prints, the blind, the grey coat). The
    // expansion only adds what the probe crew leaves behind.
    probeStep: 'probe',
    aftermath: { at: [36, 39], label: 'Where their car was parked', evidence: 't1_closing', optional: true, lines: [
      { who: F, text: 'Tire tracks where the road widens. Somebody waited here with the engine off. A crushed Parliament pack...' },
      { who: F, text: '...and a torn envelope. "KEYSTONE TITLE & ESCROW — NEWARK." Inside, a photocopy of the closing papers for this cabin. My cash sale.' },
      { who: F, text: 'Why would a gunman carry my deed?' },
    ] },
  },
  2: {
    step: 'ch2_watch', probeStep: 'ch2_probe', need: 2, title: 'Who\'s been looking at the house?',
    intro: [
      { who: F, text: 'Sal sent a photo. Sal never comes himself first. Somebody will come and look the house over — the doors, the windows, when I leave.' },
      { who: F, text: 'Keep my eyes open on Larch Street. Things that don\'t fit.' },
    ],
    signs: {
      package: { at: [24.5, 32.8], label: 'An unlabeled box on the porch', note: 'A box on the porch held a cheap baby monitor, switched on and listening.', lines: [
        { who: F, text: 'No label, no stamp. Inside, in tissue paper: a baby monitor. Switched on. The little green light blinks at me.' },
        { who: F, text: 'Could be a neighbor\'s mix-up. Could be somebody who wants to hear when I come home.', choices: [
          { text: 'Smash it.', value: 'smash', lines: [{ who: F, text: '(Plastic everywhere. Whoever was listening heard that.)' }] },
          { text: 'Leave it in the kitchen and give them a boring house to listen to.', value: 'feed', lines: [{ who: F, text: '(You talk to nobody about working late on Thursdays. Loudly. They\'ll come at the wrong hour.)' }] },
        ] },
      ] },
      meter: { at: [16.8, 36.5], visitor: { name: 'Meter Reader', body: '#c8a030', hair: '#3a2a1a', skin: '#d8a888', hours: [10, 16] }, label: 'A man at your electric meter', note: 'A "meter reader" with no truck and the wrong boots looked over every window on the house.', lines: [
        { who: 'Meter Reader', text: 'Ohio Edison. Meter check. Won\'t take a minute. (He\'s looking at your back door, not the meter.)' },
        { who: F, text: '(No truck on the street. Dress shoes under the orange vest. Maybe the company hires anybody now. Maybe.)', choices: [
          { text: '"Go ahead. Take your time."', value: 'let', lines: [{ who: 'Meter Reader', text: 'Thanks, pal. (He walks the whole house. Every window. He writes something down at the back door.)' }, { who: F, text: '(Now they know the back door sticks. So do I.)' }] },
          { text: '"Can I see some ID?"', value: 'id', evidence: 't2_parcel', lines: [{ who: 'Meter Reader', text: 'ID. Sure. It\'s... in the truck. (He walks off fast. His clipboard stays on the step.)' }, { who: F, text: '(Under the clip: a county parcel printout. "14-221 LARCH ST — CASH SALE — LOWE, F." Somebody pulled my deed.)' }] },
        ] },
      ] },
      car: { talk: 'folk6', label: 'Ask Old Mr. Pruitt about strange cars', note: 'Old Mr. Pruitt: a blue Pontiac with Illinois plates parks by the library every evening. Two men. They never get out.', lines: [
        { who: 'Old Mr. Pruitt', text: 'Strange cars? Son, I\'ve got nothing to do but count cars. Blue Pontiac, Illinois plates, by the library every evening. Two men. Never get out.' },
        { who: 'Old Mr. Pruitt', text: 'Could be cops. Could be divorce lawyers. Either way, they ain\'t from here.' },
      ] },
    },
    done: [
      { who: F, text: 'A listening box, a fake meter man, a car that never moves. They\'re measuring the house for something.' },
      { who: F, text: 'Sal tests before he commits. Somebody will try the doors tonight or tomorrow. Be home, and be awake.' },
    ],
    probe: { waves: [{ dir: 'south', types: ['scout', 'scout'], delay: 0 }, { dir: 'west', types: ['scout'], delay: 25 }], hpMult: 1 },
    probeWon: [
      { who: F, text: 'Three of them, quick and quiet, and gone the moment the lights came on. They weren\'t here to kill me. They were here to count my doors.' },
      { who: F, text: 'One of them went over the back fence in a hurry. Let\'s see what he left.' },
    ],
    aftermath: { at: [17.3, 38.6], label: 'Something by the back fence', lead: 'k2_lot', lines: [
      { who: F, text: 'A leather glove snagged on the fence wire, and in the grass a motel key on a plastic diamond: STARLITE MOTOR INN, ROOM 9.' },
      { who: F, text: 'And a parking stub from the library lot. The blue Pontiac. They park there and walk over through the yards.' },
    ] },
  },
  3: {
    step: 'ch3_watch', probeStep: 'ch3_probe', need: 2, title: 'Who\'s been on the land?',
    intro: [
      { who: F, text: 'Mott smiled too much. If he\'s selling my name, somebody will come and walk the land before they come for me.' },
      { who: F, text: 'Two hundred acres is a lot of ground to watch. Start with what\'s changed.' },
    ],
    signs: {
      fence: { at: [6.5, 30.5], label: 'A cut in the west fence', note: 'The west windbreak fence was cut with bolt cutters — a clean way in, not a way for cattle out.', lines: [
        { who: F, text: 'Three strands of wire, cut clean. Bolt cutters. The cattle aren\'t out, so nobody cut it to steal them.' },
        { who: F, text: 'Could be kids. Could be a hunter wanting a shortcut. Or somebody wants a quiet way onto the farm at night.', choices: [
          { text: 'Splice it back together.', value: 'mend', lines: [{ who: F, text: '(Tight as a drum. If they wanted this door, they\'ll need another.)' }] },
          { text: 'Leave it open — and remember where it is.', value: 'watch', lines: [{ who: F, text: '(Let them use the door you know about. You\'ll be watching it.)' }] },
        ] },
      ] },
      barn: { at: [34.5, 25.6], label: 'The barn door is ajar', note: 'Someone took tools and a gas can from the barn. Size-13 lug-sole boot prints in the dust — Bo sold that boot to a Chicago man.', lines: [
        { who: F, text: 'The post-hole digger, the bolt cutters and a five-gallon gas can, gone. Boot prints in the dust: big, a lug sole, brand new.' },
        { who: F, text: 'Gas can and bolt cutters. A farmer borrowing tools doesn\'t take those two.' },
        { who: 'Bo Lindqvist', text: '(Later, at the feed store.) Size thirteen Red Wings? Sold a pair to a Chicago fella last week. Paid with a fifty. Who pays for boots with a fifty?' },
      ] },
      stakes: { at: [9.5, 22.5], label: 'Orange-flagged stakes in the field', evidence: 't3_recorder', note: 'Surveyor\'s stakes run from the county road straight to your back door. Nobody ordered a survey.', lines: [
        { who: F, text: 'Survey stakes with orange flags. A straight line from the county road to my back door, three hundred yards, no turns.' },
        { who: F, text: 'A tag on the last stake: "PARCEL 7-118 — CASH SALE — copy requested, Cook County." Chicago asked the county for my paperwork. And then for my back door.' },
      ] },
    },
    done: [
      { who: F, text: 'Cut wire, a missing gas can, a line of stakes to my back door. That\'s not one man looking. That\'s a plan being drawn.' },
      { who: F, text: 'They\'ll test it before Vinnie commits. Tonight, maybe tomorrow. Be home after dark.' },
    ],
    probe: { waves: [{ dir: 'westfield', types: ['scout', 'gunman'], delay: 0 }, { dir: 'south', types: ['scout'], delay: 22 }], hpMult: 1.05 },
    probeWon: [
      { who: F, text: 'They came along the windbreak in the dark and ran when the shooting started. A test. They were timing how long it took me to get to the west windows.' },
    ],
    aftermath: { at: [24, 43], label: 'Tracks at the south woods', lead: 'k3_ford', lines: [
      { who: F, text: 'Dually tire tracks down by the creek ford, and a chewed toothpick. Mott chews those. The whole county knows it.' },
      { who: F, text: 'They staged the trucks at the ford. If I block the ford, they have to come the long way round.' },
    ] },
  },
  4: {
    step: 'ch4_watch', probeStep: 'ch4_probe', need: 2, title: 'Who\'s watching from the water?',
    intro: [
      { who: F, text: 'Reyes found me with a badge. Nico will find me with money. And the lake side of this place is wide open.' },
      { who: F, text: 'Watch the water. Watch the gate. Ask the people who\'ve lived here forever.' },
    ],
    signs: {
      boathouse: { at: [57.5, 33.4], label: 'Rope burn on the boathouse cleat', note: 'Someone tied up at the boathouse at night and picked the lock — then locked it again behind them.', lines: [
        { who: F, text: 'Fresh rope burn on the cleat. Ash on the boards. The padlock\'s been picked — and locked again, neat as you like.' },
        { who: F, text: 'Fishermen don\'t relock other people\'s boathouses. Polite burglars might. Professionals always do.' },
      ] },
      gate: { at: [34, 11.6], label: 'Something behind the gate post', note: 'A battery transmitter was zip-tied behind the iron gate post, reporting whenever the gate opens.', lines: [
        { who: F, text: 'Behind the gate post, zip-tied low: a black box, a battery and a stub antenna. It clicks when the gate moves.' },
        { who: F, text: 'Could be the alarm company Edward never cancelled. Could be somebody counting my comings and goings.', choices: [
          { text: 'Cut it loose and toss it in the lake.', value: 'cut', lines: [{ who: F, text: '(It sinks. Somewhere a receiver goes quiet.)' }] },
          { text: 'Leave it. Open the gate at odd hours and drive nowhere.', value: 'feed', lines: [{ who: F, text: '(For two nights you open the gate at 1 AM and 4 AM and drive to the end of the road and back. Let them make sense of that.)' }] },
        ] },
      ] },
      glasses: { talk: 'eleanor', label: 'Ask Mrs. Whitcombe if anything\'s odd', note: 'Eleanor\'s gardener found expensive Zeiss binoculars in the hedge by the lake wall, aimed at the manor.', lines: [
        { who: 'Eleanor Whitcombe', text: 'Odd? My gardener found a pair of binoculars in the hedge by the lake wall. Zeiss. Better than the club commodore\'s.' },
        { who: 'Eleanor Whitcombe', text: 'Either someone is very keen on birds, Mr. Lowe, or someone is very keen on you. I know which I\'d bet on.' },
      ] },
    },
    done: [
      { who: F, text: 'A boat at the boathouse, a box on the gate, a man in the hedge with German glass. Nico\'s people have been here for days.' },
      { who: F, text: 'He\'ll want to know how fast I get to the water. He\'ll send a boat first. Be home tonight.' },
    ],
    probe: { waves: [{ dir: 'shore', types: ['gunman', 'scout'], delay: 0 }, { dir: 'west', types: ['scout'], delay: 30 }], hpMult: 1.1 },
    probeWon: [
      { who: F, text: 'A boat, two men, a few shots at the terrace and gone into the dark. They were timing the walk from the bedroom to the dock.' },
    ],
    aftermath: { at: [58.5, 29.5], label: 'A pouch on the dock', evidence: 't4_fax', lead: 'k4_channel', lines: [
      { who: F, text: 'A waterproof pouch, dropped in a hurry. Inside, a fax: "WHITCOMBE — CARETAKER LOWE. NO CLOSING ON FILE. USE THE SHORE."' },
      { who: F, text: 'Header strip: KEYSTONE T&E, ALBANY. No closing on file... They couldn\'t find this place by its paperwork. They found it through Mott.' },
      { who: F, text: 'And "use the shore." They\'ll land at the boathouse channel. Unless the channel isn\'t there for them.' },
    ] },
  },
  5: {
    step: 'ch5_watch', probeStep: 'ch5_probe', need: 2, title: 'Who\'s on the ridge?',
    intro: [
      { who: F, text: 'Leo won\'t send strangers to look at me. Not here. He\'ll send people I grew up with. People who know how I think.' },
    ],
    signs: {
      photos: { at: [48.5, 15.6], label: 'An envelope on the porch', note: 'Photographs of you from this week — the deli, St. Rose, your porch — left on your step. "Welcome home."', lines: [
        { who: F, text: 'An envelope under the doormat. Photographs: me at Marchetti\'s counter. Me lighting a candle at St. Rose. Me on this porch, last night, with a coffee.' },
        { who: F, text: 'On the back, in Leo\'s careful hand: "Welcome home." He wants me to know he can see me. Leo always did like a warning.' },
      ] },
      richie: { at: [50.5, 4.6], visitor: { name: 'Richie Bruno', body: '#2a2a30', hair: '#3a2a20', skin: '#d8a888', hours: [16, 22] }, label: 'A man leaning on a Lincoln on Old Short Hills Road', note: 'Richie Bruno, Carlo\'s little brother — your old driver — was sitting on the ridge road watching the house. He didn\'t want to be.', lines: [
        { who: 'Richie Bruno', text: 'Frankie. (He doesn\'t take his hands out of his pockets.) You got old. I got fat. Carlo says hi.' },
        { who: 'Richie Bruno', text: 'Leo wants you to come up the hill on your own feet. Carlo wants you dead before you get the chance. I\'m just the guy who watches the house.', choices: [
          { text: '"Go home, Richie. You were never this."', value: 'home', lines: [{ who: 'Richie Bruno', text: '(He looks at the house on the ridge a long time.) ...Carlo\'s my brother, Frankie. That\'s the problem. That was always the problem.' }] },
          { text: '"Tell Carlo I said hi back."', value: 'hi', lines: [{ who: 'Richie Bruno', text: 'Ha. Same old Frankie. (He gets in the Lincoln.) He\'ll come Thursday or Friday. You didn\'t hear that from me.' }] },
        ] },
      ] },
      pole: { at: [51.5, 5.4], label: 'Tool marks on the power pole', note: 'Fresh climbing-spike marks on the pole that feeds the watch house. Somebody has looked at cutting your power.', lines: [
        { who: F, text: 'Fresh spike marks up the pole that feeds the watch house, and a new scuff on the junction box. Somebody\'s been up there.' },
        { who: F, text: 'They\'ve seen my lights. When they come, they\'ll try to put them out. (A backup generator would keep them on.)' },
      ] },
    },
    done: [
      { who: F, text: 'Photos on my step, Richie Bruno on the ridge, spike marks on my pole. Leo\'s announcing himself.' },
      { who: F, text: 'Carlo will send a few men first. He always tested the locks himself when we were kids. Be home tonight.' },
    ],
    probe: { waves: [{ dir: 'north', types: ['scout', 'gunman'], delay: 0 }, { dir: 'ravine', types: ['scout'], delay: 25 }], hpMult: 1.15 },
    probeWon: [
      { who: F, text: 'Three of them up the ravine path, quick in, quicker out. Carlo\'s testing how long the lights stay on.' },
    ],
    aftermath: { at: [58.5, 40.5], label: 'Something dropped on the ravine path', evidence: 't5_list', lines: [
      { who: F, text: 'A folded sheet on the ravine path, typed on an old IBM: "FRANKIE — Pine Hollow MN (cash). Millbrook OH (cash). Kettle X WI (cash). Via C.V."' },
      { who: F, text: 'C.V. Carmine Ventura. Every place I ever paid cash for, on one page.' },
    ] },
  },
};
