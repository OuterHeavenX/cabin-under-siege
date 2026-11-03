// Atlantic City, 1994: the second prequel episode. Frankie is twenty-four.
// Leo sends him and Big Carmine down the shore after Eddie Russo, a count-room
// man at the Golden Gull who skimmed sixty thousand dollars. Eddie isn't a
// gangster — he did it for his daughter's surgery — and that's the night
// Frankie first does something the family wouldn't. The next morning another
// Carmine, Carmine Ventura, buys the motel for cash through his title company.
// Runs on a throwaway save, like Newark.
import { G, newSave, newHome } from './state.js';
import { spawnEnemy } from './enemies.js';
import { derived } from './progression.js';
import { playDialogue } from '../ui/dialogue.js';
import { playCutscene } from '../ui/cutscene.js';
import { banner, toast, centerMessage } from '../ui/hud.js';
import { sfx, setMusic } from '../audio.js';
import { unlock } from './achievements.js';
import { dist } from '../util.js';

const ME = 'You';
const BC = 'Big Carmine', LOU = 'Lou Pagano', RITA = 'Rita Russo', ED = 'Eddie Russo';

const OBJ = {
  ac_meet: 'Big Carmine is waiting on the boardwalk by the taffy stand.',
  ac_lou: 'Eddie Russo works the count room at the Golden Gull. Ask Lou, the pit boss, inside.',
  ac_rita: 'Eddie\'s wife is at the Seaview Motel, room 4.',
  ac_pier: 'Eddie is on the Steel Pier, waiting for a boat. Walk out along the pier.',
  ac_fight: 'Eddie hired help. Deal with them.',
  ac_eddie: 'Eddie is at the end of the pier.',
  ac_car: 'Back to Carmine\'s Lincoln on Pacific Avenue.',
  ac_end: '',
};
export const acObjective = () => OBJ[G.prequel.step] || '';

export function startAC(begin) {
  const s = newSave();
  s.chapter = 7;
  s.difficulty = (G.s && G.s.difficulty) || 'normal';
  s.home = newHome('cabin');
  s.player.map = 'atlantic';
  s.story.step = 'prequel';
  s.story.flags = { firstSiegeDone: true };
  s.time.day = 1; s.time.minute = 22 * 60;
  s.stats.level = 2;
  s.stats.attrs = { vit: 2, end: 2, pre: 2, awa: 1, res: 1 };
  s.money = 0;
  s.player.mags = { pistol: 8, shotgun: 0, rifle: 0 };
  s.inv = { ammo: 48, bandage: 3 };
  s.quick = 'bandage';
  G.s = s;
  G.endless = null;
  G.prequel = { ep: 'ac', step: 'ac_meet', cast: ['carmine94', 'lou94', 'rita94'], wave: 0, waveT: 0, waves: null, checkpoint: null, choice: {} };
  begin(false);
  setMusic('night');
  const p = G.player;
  playCutscene({ focus: { x: p.x + 80, y: p.y }, zoom: 0.9, title: 'ATLANTIC CITY', sub: 'August 1994. Five years before Newark.', hold: 2.4, sting: null, lines: [
    { who: '', text: 'Frankie Corsetti is twenty-four. Leo has started sending him on errands that matter.' },
    { who: ME, text: 'The boardwalk at ten at night. Salt, frying oil, the slot machines going in every doorway. Carmine said by the taffy stand.' },
  ], onEnd: () => banner(acObjective(), 'objective', 4) });
}

function setStep(step) {
  G.prequel.step = step;
  if (OBJ[step]) banner(`New objective: ${OBJ[step]}`, 'objective', 4);
}

export function acTalk(id) {
  const P = G.prequel, st = P.step;
  if (id === 'carmine94') {
    if (st === 'ac_meet') {
      playDialogue([
        { who: BC, text: 'Frankie. You want taffy? Peppermint. Don\'t say no, I already bought it.' },
        { who: BC, text: 'Eddie Russo. Count room at the Golden Gull. Two years, sixty grand, a little at a time. Leo wants it back.' },
        { who: ME, text: 'And Eddie?' },
        { who: BC, text: 'Leo says if he pays, he walks. Leo says a lot of things. (He shrugs, enormous.) Lou the pit boss will know where he is. I\'ll be at the car.' },
        { who: BC, text: 'Oh — and if anybody asks, we\'re down here for the other Carmine. Ventura. Leo\'s brother-in-law. He\'s buying up half this town through that title company of his.' },
      ], () => { P.cast = ['lou94', 'rita94']; setStep('ac_lou'); });
      return true;
    }
    if (st === 'ac_car') { finale(); return true; }
    playDialogue([{ who: BC, text: 'I\'m at the car, Frankie. Go find him.' }]);
    return true;
  }
  if (id === 'lou94') {
    if (st !== 'ac_lou') { playDialogue([{ who: LOU, text: 'I don\'t know you. I never knew you.' }]); return true; }
    playDialogue([
      { who: LOU, text: '(He doesn\'t look up from the pit.) You\'re one of Leo\'s. Yeah. You got the look.' },
      { who: LOU, text: 'Eddie left at eight with a gym bag he didn\'t bring in. He\'s got a wife at the Seaview. Room four. Kid\'s sick.' },
      { who: LOU, text: 'For what it\'s worth, kid — Eddie\'s the only honest man who ever worked that room. That\'s why he\'s bad at this.' },
    ], () => setStep('ac_rita'));
    return true;
  }
  if (id === 'rita94') {
    if (st !== 'ac_rita') { playDialogue([{ who: RITA, text: '(She doesn\'t open the door again.)' }]); return true; }
    playDialogue([
      { who: RITA, text: '(The door opens on the chain. A woman in hospital scrubs. A little girl asleep on the bed behind her, an IV port taped to her arm.) He\'s not here.' },
      { who: ME, text: '(The kid is maybe six. The suitcase by the door was packed in a hurry.)', choices: [
        { text: '"Tell him to come talk to me. Nobody gets hurt tonight."', effect: () => { P.choice.rita = 'kind'; return [{ who: RITA, text: '(She studies you a long time.) The Steel Pier. A boat to Cape May at eleven. Please. He did it for her.' }]; } },
        { text: '"Where is he, Rita?"', effect: () => { P.choice.rita = 'hard'; return [{ who: RITA, text: '(Her voice shakes.) The pier. The end of the pier. He hired two guys from the arcade to watch his back. God help you.' }]; } },
      ] },
    ], () => { P.cast = ['eddie94']; setStep('ac_pier'); });
    return true;
  }
  if (id === 'eddie94') {
    if (st !== 'ac_eddie') { playDialogue([{ who: ED, text: '(He clutches the gym bag and watches the water.)' }]); return true; }
    playDialogue([
      { who: ED, text: '(Eddie Russo has the gym bag in both arms. He\'s soaked to the knees.) There\'s twenty in there. That\'s all that\'s left. The rest went to Children\'s in Philadelphia.' },
      { who: ED, text: 'I know what happens now. Just — not in front of the boat, okay? The captain\'s a friend.' },
      { who: ME, text: '(The boat\'s running lights on the black water. A sixty-thousand-dollar hole. A six-year-old in a motel bed.)', choices: [
        { text: '"Get on the boat, Eddie. Keep the bag. You were never here." (You\'ll cover the forty yourself.)', effect: () => { P.choice.eddie = 'mercy'; return [{ who: ED, text: '(He just stares.) Why? ...No. Don\'t tell me. (He runs for the boat.)' }, { who: ME, text: '(Forty thousand dollars of your own money, and a story to tell Leo. It\'s the first thing you\'ve ever done for nobody.)' }]; } },
        { text: '"Walk with me, Eddie. You\'ll keep breathing. That\'s the deal."', effect: () => { P.choice.eddie = 'deal'; return [{ who: ED, text: '(He nods and hands you the bag. He walks back down the pier beside you like a man going to his own funeral, and he isn\'t.)' }]; } },
      ] },
    ], () => { P.cast = P.choice.eddie === 'deal' ? ['carmine94', 'eddie94'] : ['carmine94']; setStep('ac_car'); });
    return true;
  }
  return false;
}

export function acProp(pr) {
  if (pr.kind !== 'car') return null;
  const st = G.prequel.step;
  if (st === 'ac_car') return { label: 'Back to Carmine', short: 'GO', prio: 3, action: () => finale() };
  return { label: 'Carmine\'s Lincoln', short: 'CAR', action: () => toast('Not yet. Find Eddie first.', 'info') };
}

/* ---------------- the pier ---------------- */
const WAVES = [
  [['pier', ['scout', 'gunman']], ['beach', ['scout']]],
  [['walk_e', ['enforcer', 'gunman']], ['beach', ['gunman', 'scout']]],
];
function spawnGroup(groups, hpMult = 1) {
  const m = G.map;
  for (const [dir, types] of groups) {
    const sp = m.spawns[dir];
    types.forEach((t, i) => { const e = spawnEnemy(t, sp.x + (i - types.length / 2) * 22, sp.y, { hpMult }); e.alerted = true; });
  }
}
const alive = () => G.enemies.filter((e) => !e.dead && !e.gone).length;

function startFight() {
  const P = G.prequel;
  setStep('ac_fight');
  setMusic('tense');
  centerMessage('THE ARCADE BOYS', P.choice.rita === 'hard' ? 'Rita was right. God help you.' : 'Eddie\'s hired help didn\'t get the message.', 3);
  P.waves = WAVES; P.wave = 0; P.waveT = 1.2; P.checkpoint = 'pier';
  P.saved = { inv: { ...G.s.inv }, mags: { ...G.player.mags }, mag: G.player.mag };
}

export function updateAC(dt) {
  const P = G.prequel;
  G.s.time.minute = 22 * 60 + 40;
  if (P.step === 'ac_pier' && !G.transition && !G.cutscene && G.player && dist(G.player.x, G.player.y, G.map.points.pier_mid.x, G.map.points.pier_mid.y) < 70) startFight();
  if (P.step === 'ac_fight' && !G.transition && !G.cutscene) {
    if (P.waveT > 0) { P.waveT -= dt; if (P.waveT <= 0) { spawnGroup(P.waves[P.wave], 1); banner(`From ${P.waves[P.wave].map(([d]) => G.map.spawns[d].label).join(' and ')}!`, 'danger', 3); } }
    else if (alive() === 0) {
      P.wave++;
      if (P.wave >= P.waves.length) { P.waves = null; setMusic('night'); setStep('ac_eddie'); }
      else { P.waveT = 5; toast('Reload. Somebody else is coming up the beach.', 'warn', 3); }
    }
  }
}

function finale() {
  const P = G.prequel;
  setStep('ac_end');
  P.cast = [];
  const p = G.player;
  const mercy = P.choice.eddie === 'mercy';
  playCutscene({ focus: { x: p.x, y: p.y }, zoom: 1.2, title: '', sub: '', hold: 0.6, sting: null, lines: mercy ? [
    { who: BC, text: 'Where\'s Eddie? Where\'s the money?' },
    { who: ME, text: 'Gone on a boat. I\'ve got forty at my mother\'s place. I\'ll bring it to Leo myself.' },
    { who: BC, text: '(A very long silence. Then he opens the car door for you.) I didn\'t see nothing, Frankie. But Leo will. Leo sees everything.' },
  ] : [
    { who: BC, text: '(Carmine looks at Eddie, at the bag, at you.) Twenty. And him breathing. Leo won\'t love it.' },
    { who: ME, text: 'Leo said if he pays, he walks. He paid what he had.' },
    { who: BC, text: '...Get in the back, Eddie. We\'ll drop you at the bus station. Don\'t come back to this town.' },
  ], onEnd: () => { G.transition = { t: 0, fade: 0, text: 'The next morning · Seaview Motel', phase: 'out', mid: () => {}, done: () => epilogue(mercy) }; } });
}

function epilogue(mercy) {
  const p = G.player;
  playCutscene({ focus: { x: p.x, y: p.y }, zoom: 1, title: 'THE NEXT MORNING', sub: 'Seaview Motel, Atlantic City', hold: 1.6, sting: null, lines: [
    { who: '', text: '(A man in a good suit is shaking hands with the motel owner in the parking lot. A briefcase. A notary.)' },
    { who: BC, text: 'That\'s the other Carmine. Ventura. Buys a building a week down here. Always cash, always through his title company.' },
    { who: BC, text: 'Leo says every house in this town goes through Ventura sooner or later. Every closing, every name. He reads them all.' },
    { who: ME, text: '(You don\'t think about it again for twenty-five years.)' },
    { who: '', text: mercy ? 'Eddie Russo\'s daughter grew up in Cape May. Frankie never told anyone where the forty thousand came from. Leo never asked. Leo didn\'t have to.' : 'Eddie Russo drove a bus in Scranton for twenty years. Every Christmas, a card came to the Ninth Ward Social Club addressed to "the young one." Frankie never opened them in front of anyone.' },
  ], onEnd: () => finish() });
}

function finish() {
  unlock('atlantic');
  sfx('victory');
  G.events.emit('prequelDone', 'ac');
}

/** Falling on the pier restarts the fight. */
export function acDefeat() {
  const P = G.prequel;
  for (const e of G.enemies) e.gone = true;
  G.enemies = []; G.bullets = [];
  const p = G.player;
  if (P.saved) { G.s.inv = { ...P.saved.inv }; p.mags = { ...P.saved.mags }; p.mag = P.saved.mag; }
  p.dead = false; p.hp = derived().maxHp; p.invuln = 2;
  const at = G.map.points.pier_mid; p.x = at.x; p.y = at.y + 60;
  centerMessage('TRY AGAIN', 'Eddie is still out there.', 2.4);
  P.step = 'ac_fight'; P.waves = WAVES; P.wave = 0; P.waveT = 2;
  G.transition = null;
}
