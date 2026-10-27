// Newark, 1999: the night Frankie Corsetti left the family. A self-contained
// episode, unlocked by finishing the story. Like Endless Siege it runs on a
// throwaway save, so the story save is never touched.
//
// Leo sends Frankie and Joey Marchetti to "collect" from the Delgado
// warehouse. It's a setup: Joey has been talking to the FBI, and Dante's men,
// dressed as a Delgado crew, are waiting to make it look like a robbery.
import { G, newSave, newHome } from './state.js';
import { NPCS } from '../data/npcs.js';
import { spawnEnemy } from './enemies.js';
import { addItem } from './inventory.js';
import { derived } from './progression.js';
import { playDialogue } from '../ui/dialogue.js';
import { playCutscene } from '../ui/cutscene.js';
import { banner, toast, centerMessage } from '../ui/hud.js';
import { sfx, setMusic } from '../audio.js';
import { unlock } from './achievements.js';

const ME = 'You';
const L = 'Leo Vescari', J = 'Joey Marchetti', D = 'Dante Ruggiero';

const OBJ = {
  pq_club: 'Leo wants to see you. The back room of the Ninth Ward Social Club.',
  pq_sal: 'Sal has the address. He\'s behind the bar.',
  pq_joey: 'Joey is waiting by his Buick on Ferry Street.',
  pq_drive: 'Get in Joey\'s car. Delgado Import & Export, down by the river.',
  pq_crate: 'Find Delgado\'s crate in the back of the warehouse.',
  pq_fight: 'Hold the warehouse. Keep them away from Joey.',
  pq_dante: 'Dante is out front.',
  pq_last: 'Clear the street. Then get Joey to the car.',
  pq_car: 'Get to the car. Joey is right behind you.',
  pq_end: '',
};

export const prequelObjective = () => (G.prequel ? OBJ[G.prequel.step] || '' : '');

/** `begin` is main.js's startGame. */
export function startPrequel(begin) {
  const s = newSave();
  s.chapter = 6;
  s.difficulty = (G.s && G.s.difficulty) || 'normal';
  s.home = newHome('cabin');
  s.player.map = 'newark';
  s.story.step = 'prequel';
  s.story.flags = { firstSiegeDone: true };
  s.time.day = 1; s.time.minute = 23 * 60;
  s.stats.level = 3;
  s.stats.attrs = { vit: 2, end: 2, pre: 2, awa: 1, res: 1 };
  s.money = 0;
  s.player.mags = { pistol: 8, shotgun: 0, rifle: 0 };
  s.inv = { ammo: 56, bandage: 3, medkit: 1 };
  s.quick = 'bandage';
  G.s = s;
  G.endless = null;
  G.prequel = { step: 'pq_club', cast: ['leo99', 'sal99', 'carmine99', 'joey'], wave: 0, waveT: 0, waves: null, checkpoint: null };
  NPCS.joey.schedule[0][3] = 'joey_car';
  NPCS.dante99.schedule[0][3] = 'dante99';
  begin(false);
  setMusic('night');
  const p = G.player;
  playCutscene({ focus: { x: p.x, y: p.y - 120 }, zoom: 0.9, title: 'NEWARK, NEW JERSEY', sub: 'October 1999. Twenty years before Pine Hollow.', hold: 2.4, sting: null, lines: [
    { who: '', text: 'Frankie Corsetti is twenty-nine. He has worked for Leo Vescari since he was nineteen.' },
    { who: ME, text: 'Rain on Ferry Street. Leo called at eleven. Leo never calls at eleven.' },
  ], onEnd: () => banner(prequelObjective(), 'objective', 4) });
}

function setStep(step) {
  G.prequel.step = step;
  if (OBJ[step]) banner(`New objective: ${OBJ[step]}`, 'objective', 4);
}

/** Conversations in Newark. Returns true if handled. */
export function prequelTalk(id) {
  const P = G.prequel;
  if (!P) return false;
  const st = P.step;
  if (id === 'leo99') {
    if (st !== 'pq_club') { playDialogue([{ who: L, text: 'Why are you still here, Frankie? Go. And Frankie — take care of Joey.' }]); return true; }
    playDialogue([
      { who: L, text: 'Frankie. Sit. You want a drink? Scotch. Like your father.' },
      { who: ME, text: 'You called, Leo.' },
      { who: L, text: 'Tommy Delgado owes this family forty thousand dollars and he thinks because he\'s old I forgot. I don\'t forget.' },
      { who: L, text: 'Tonight you go to his warehouse on the river. There\'s a crate in the back with my name on it. You bring it to me.' },
      { who: L, text: 'Joey drives. He\'s a good kid, Joey. Talks too much. You keep an eye on him.' },
      { who: ME, text: '(Something in the way he says it. Like he\'s already sorry.)' },
      { who: L, text: 'Sal has the address. Go on.' },
    ], () => setStep('pq_sal'));
    return true;
  }
  if (id === 'sal99') {
    if (st !== 'pq_sal') { playDialogue([{ who: 'Sal Benedetto', text: 'I count money, Frankie. I don\'t count favors. Go away.' }]); return true; }
    playDialogue([
      { who: 'Sal Benedetto', text: '(He slides an envelope across the bar.) Delgado Import and Export. Ferry Street, by the pier. Back door\'s open.' },
      { who: ME, text: 'Since when does Delgado leave doors open?' },
      { who: 'Sal Benedetto', text: 'Since tonight. Don\'t ask me questions, Frankie. I just do the books.' },
      { who: 'Sal Benedetto', text: '(He doesn\'t look at you. Sal always looks at you.)' },
    ], () => setStep('pq_joey'));
    return true;
  }
  if (id === 'carmine99') {
    playDialogue([{ who: 'Big Carmine', text: st === 'pq_club' ? 'Old man\'s in the back. He\'s in a mood.' : 'Rain\'s supposed to let up by two. Drive careful, Frankie.' }]);
    return true;
  }
  if (id === 'joey') {
    if (st === 'pq_joey') {
      playDialogue([
        { who: J, text: 'Frankie! Get in, get in, I got the heat on. You believe this rain?' },
        { who: J, text: 'Delgado\'s, right? Easy job. In and out. I gotta be back by nine tomorrow — it\'s Angie\'s birthday. She\'s making the lasagna. You should come.' },
        { who: ME, text: 'You alright, Joey? You\'re talking fast. Even for you.' },
        { who: J, text: '...Yeah. Yeah, I\'m good. Hey, Frankie. You ever think about just — not? Not doing this? Like, going somewhere?' },
        { who: ME, text: 'Every day, kid.' },
        { who: J, text: '(He laughs, too loud.) Me neither. Come on. There\'s a shotgun in the trunk if you want it. Leo said to bring it. Weird, right?' },
      ], () => { addItem('shotgun', 1, true); addItem('shells', 12, true); G.player.mags.shotgun = 0; toast('You took the pump shotgun from Joey\'s trunk (switch weapons with Y / Tab).', 'item', 4); setStep('pq_drive'); });
      return true;
    }
    if (st === 'pq_fight' || st === 'pq_dante' || st === 'pq_last') { playDialogue([{ who: J, text: 'Frankie, I didn\'t — I swear I didn\'t tell them about you. Only about the money. Only about Leo.' }]); return true; }
    if (st === 'pq_car') { playDialogue([{ who: J, text: 'Go, go, I\'m right behind you!' }]); return true; }
    playDialogue([{ who: J, text: 'Let\'s get this over with, huh?' }]);
    return true;
  }
  return false;
}

/** Interactions with the episode's props and the car. */
export function prequelProp(pr) {
  const st = G.prequel && G.prequel.step;
  if (pr.kind === 'car') {
    if (st === 'pq_drive') return { label: 'Drive to the Delgado warehouse', short: 'DRIVE', prio: 3, action: () => driveToWarehouse() };
    if (st === 'pq_car') return { label: 'Get Joey in the car', short: 'GO', prio: 3, action: () => finale() };
    return { label: 'Joey\'s Buick', short: 'CAR', action: () => toast(st === 'pq_club' || st === 'pq_sal' || st === 'pq_joey' ? 'Joey\'s car. He keeps it cleaner than his apartment.' : 'Not yet.', 'info') };
  }
  if (pr.id === 'pq_crate') {
    if (st !== 'pq_crate') return { label: 'Delgado\'s crate (empty)', short: 'LOOK', action: () => toast('Nothing in it worth dying for.', 'info') };
    return { label: 'Open Delgado\'s crate', short: 'OPEN', prio: 3, action: () => openCrate() };
  }
  return null;
}

function driveToWarehouse() {
  sfx('car');
  G.transition = {
    t: 0, fade: 0, text: 'Ferry Street, down by the river…', phase: 'out',
    mid: () => {
      const m = G.map;
      G.player.x = m.points.wh_front.x; G.player.y = m.points.wh_front.y;
      const j = G.npcs.find((n) => n.id === 'joey');
      NPCS.joey.schedule[0][3] = 'joey_wh';
      if (j) { j.x = m.points.wh_in.x + 30; j.y = m.points.wh_in.y; j.path = null; }
      G.camera.x = G.player.x; G.camera.y = G.player.y;
    },
    done: () => {
      setStep('pq_crate');
      playDialogue([{ who: J, text: 'I\'ll wait inside, outta the rain. Back of the warehouse, Frankie. Quick, huh?' }]);
    },
  };
}

function openCrate() {
  const pr = G.map.props.find((p) => p.id === 'pq_crate');
  playCutscene({ focus: { x: pr.x, y: pr.y }, zoom: 1.5, title: 'THE CRATE', sub: 'No money. Just an envelope.', hold: 1.4, sting: 'phone', lines: [
    { who: ME, text: 'Photographs. Joey in a diner booth with a young woman in a grey suit. A notebook on the table between them.' },
    { who: ME, text: 'On the back, in Leo\'s handwriting: "Delgado\'s people did it. Make sure Frankie sees."' },
    { who: ME, text: 'There\'s no debt. There\'s no Delgado crew. There\'s a kid who talked to the FBI, and an old man who wanted me to watch.' },
    { who: J, text: 'Frankie? ...Frankie, there\'s cars outside. Lots of cars.' },
  ], onEnd: () => startFight() });
}

/* ---------------- the fight ---------------- */
const WAVES = [
  [['street_e', ['gunman', 'scout', 'gunman']], ['pier', ['scout', 'scout']]],
  [['alley', ['enforcer', 'gunman', 'scout']], ['street_w', ['gunman', 'gunman']]],
  [['pier', ['enforcer', 'gunman']], ['street_e', ['arsonist', 'gunman', 'scout']]],
];
const LAST = [['street_e', ['enforcer', 'gunman', 'gunman']], ['alley', ['gunman', 'scout']], ['north', ['lieutenant']]];

function startFight() {
  const P = G.prequel;
  setStep('pq_fight');
  setMusic('tense');
  centerMessage('THE SETUP', 'They\'re dressed as Delgado\'s crew. They\'re Dante\'s.', 3);
  P.checkpoint = 'fight';
  P.waves = WAVES; P.wave = 0; P.waveT = 1.5;
  P.cast = ['joey'];
  snapshot();
}

function spawnGroup(groups, hpMult = 1) {
  const m = G.map;
  for (const [dir, types] of groups) {
    const sp = m.spawns[dir];
    types.forEach((t, i) => {
      const e = spawnEnemy(t, sp.x + (i - types.length / 2) * 22, sp.y + (dir === 'pier' ? -10 : 0), { hpMult, name: t === 'lieutenant' ? 'Dante\'s Shooter' : undefined });
      e.alerted = true;
    });
  }
}

const alive = () => G.enemies.filter((e) => !e.dead && !e.gone).length;

export function updatePrequel(dt) {
  const P = G.prequel;
  if (!P) return;
  G.s.time.minute = 23 * 60 + 40; // the night never ends
  if (P.step === 'pq_fight' && !G.transition && !G.cutscene) {
    if (P.waveT > 0) { P.waveT -= dt; if (P.waveT <= 0) { spawnGroup(P.waves[P.wave], 1.05); banner(`They\'re coming from ${P.waves[P.wave].map(([d]) => G.map.spawns[d].label).join(' and ')}!`, 'danger', 3); } }
    else if (alive() === 0) {
      P.wave++;
      if (P.wave >= P.waves.length) { P.waves = null; danteArrives(); } else { P.waveT = 6; toast('Reload. More headlights on the street.', 'warn', 3); }
    }
  }
  if (P.step === 'pq_last' && !G.cutscene && alive() === 0 && !G.transition) {
    setStep('pq_car');
    setMusic('night');
    const j = G.npcs.find((n) => n.id === 'joey');
    NPCS.joey.schedule[0][3] = 'joey_car';
    if (j) j.path = null;
  }
}

function danteArrives() {
  const P = G.prequel;
  setStep('pq_dante');
  P.cast = ['joey', 'dante99'];
  NPCS.dante99.schedule[0][3] = 'dante_wh';
  const m = G.map;
  const d = G.npcs.find((n) => n.id === 'dante99');
  if (d) { d.x = m.points.dante_wh.x; d.y = m.points.dante_wh.y - 60; d.path = null; }
  playCutscene({ focus: { x: m.points.dante_wh.x, y: m.points.dante_wh.y }, zoom: 1.3, title: 'DANTE RUGGIERO', sub: 'Leo\'s new right hand — "This comes from the old man, Frankie."', hold: 1.6, lines: [
    { who: D, text: 'That\'s enough, Frankie. You made your point. Step aside.' },
    { who: ME, text: 'He\'s a kid, Dante.' },
    { who: D, text: 'He\'s a rat. He sat in a diner with a federal agent and talked about the family. Our family. Yours.' },
    { who: D, text: 'The old man wanted you here so you\'d understand what happens. So you\'d never get ideas. Step aside, and tomorrow you\'re a captain.' },
    { who: ME, text: '(Twenty years from now you\'ll remember this moment every single night.)', choices: [
      { text: '"Get off this street, Dante."', effect: () => [{ who: D, text: 'Okay, Frankie. Okay. Remember you chose this.' }] },
      { text: '(Say nothing. Raise the shotgun.)', effect: () => [{ who: D, text: '...Twenty years I\'ll remember the look on your face. Kill them both.' }] },
    ] },
  ], onEnd: () => {
    P.cast = ['joey'];
    setStep('pq_last');
    setMusic('tense');
    P.checkpoint = 'last';
    snapshot();
    spawnGroup(LAST, 1.1);
  } });
}

function finale() {
  const P = G.prequel;
  setStep('pq_end');
  P.cast = [];
  const p = G.player;
  playCutscene({ focus: { x: p.x, y: p.y }, zoom: 1.5, title: '', sub: '', hold: 0.8, sting: null, lines: [
    { who: J, text: 'We made it, Frankie, we made it, I can\'t believe you — ' },
    { who: '', text: '(One shot from the dark across Ferry Street. Very quiet. Very professional.)' },
    { who: ME, text: 'Joey. Joey, look at me. Stay in the car. I\'m driving.' },
  ], onEnd: () => {
    G.transition = { t: 0, fade: 0, text: 'St. Rose of Lima, Short Hills · 1:20 AM', phase: 'out', mid: () => {}, done: () => epilogue() };
  } });
}

function epilogue() {
  const p = G.player;
  playCutscene({ focus: { x: p.x, y: p.y }, zoom: 1, title: 'ST. ROSE OF LIMA', sub: 'Short Hills, New Jersey. 1:20 AM.', hold: 1.8, sting: null, lines: [
    { who: 'Father Dom', text: '(He doesn\'t ask. He has blood on his cassock up to the elbows, and he doesn\'t ask.)' },
    { who: J, text: 'Tell Angie... tell her I\'m sorry about the lasagna.' },
    { who: 'Father Dom', text: 'He\'s gone, Frankie. I\'m sorry. He\'s gone.' },
    { who: ME, text: 'Leo did this. Leo did this and he wanted me to watch.' },
    { who: 'Father Dom', text: 'Then don\'t give him anything else to watch. You hear me? Not your hands, not your soul. Go. Go far, and don\'t come back for anybody.' },
    { who: ME, text: 'He\'ll come looking.' },
    { who: 'Father Dom', text: 'Let him look. God has a lot of places to hide a man. Pick one with trees.' },
    { who: '', text: 'Frankie Corsetti walked out of St. Rose at dawn and never went back to the club. It took him twenty years to get far enough away.' },
    { who: '', text: 'He never got far enough.' },
  ], onEnd: () => finishPrequel() });
}

function finishPrequel() {
  unlock('newark');
  sfx('victory');
  G.events.emit('prequelDone');
}

/* ---------------- checkpoints ---------------- */
function snapshot() {
  const P = G.prequel;
  P.saved = { inv: { ...G.s.inv }, mags: { ...G.player.mags }, mag: G.player.mag, wave: P.wave };
}

/** Falling in Newark restarts the current fight. */
export function prequelDefeat() {
  const P = G.prequel;
  for (const e of G.enemies) e.gone = true;
  G.enemies = [];
  G.bullets = [];
  const p = G.player;
  if (P.saved) { G.s.inv = { ...P.saved.inv }; p.mags = { ...P.saved.mags }; p.mag = P.saved.mag; }
  p.dead = false;
  p.hp = derived().maxHp;
  p.invuln = 2;
  const m = G.map;
  const at = P.checkpoint === 'last' ? m.points.wh_front : m.points.wh_in;
  p.x = at.x; p.y = at.y;
  centerMessage('TRY AGAIN', 'Joey is still counting on you.', 2.4);
  if (P.checkpoint === 'last') spawnGroup(LAST, 1.1);
  else { P.step = 'pq_fight'; P.waves = WAVES; P.wave = P.saved ? P.saved.wave : 0; P.waveT = 2; }
  G.transition = null;
}

