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

const ME = 'Frank';
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
    accuse: {
      folk1: [
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
};

const C = () => CASES[G.s.chapter];
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
      for (const nid of ['ruth', 'dee', 'gus']) if (G.s.rel[nid] != null) G.s.rel[nid] = Math.max(0, G.s.rel[nid] - 4);
      sfx('miss');
      banner(`Wrong person. Word gets around fast in a small town. (${c.suspects[id]} won't speak to you.)`, 'warn', 5);
    });
    return;
  }
  playDialogue([...c.accuse.folk1, { who: c.suspects[id], text: 'What happens now?', choices: c.accuse.outcomes.map((o) => ({ text: o.text, effect: () => { r.outcome = o.value; return o.lines; } })) }], () => closeCase(r.outcome || 'expose'));
}

function closeCase(outcome) {
  const c = C(), r = ratState();
  r.outcome = outcome;
  (G.s.choices || (G.s.choices = {})).rat = outcome;
  if (outcome === 'feed') { addXP(60, 'Turned the rat'); addJP('shadow', 12); addThreat(-10); }
  if (outcome === 'expose') { addXP(60, 'Ran out the rat'); addJP('neighbor', 12); for (const nid of ['ruth', 'dee', 'gus']) addRel(nid, 6); G.s.story.flags.ratGone = c.culprit; G.npcs = G.npcs.filter((x) => x.id !== c.culprit); }
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
gossipHooks.push(() => hookClue('poker', { who: 'Big Lou', text: 'Henderson, where\'d you get new fifties? You ain\'t had a fifty since Nixon.' }));
supperHooks.push(() => hookClue('supper', { who: 'Ruth Calloway', text: '(Ruth nods at the end of the table.) Look at Walt Henderson. Sitting alone, not eating. He hasn\'t missed grace in thirty years.' }));

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
