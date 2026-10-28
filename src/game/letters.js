// Letters, phone calls and Dee. Old friends keep writing after Frank moves
// on; some write back to what he did, some ask for help, one asks a bigger
// question. The romance with Dee is optional and can settle into friendship
// at any point without anyone being punished for it.
import { G } from './state.js';
import { atHome, visiting, hereN } from './chapters.js';
import { addRel, addXP, relOf } from './progression.js';
import { playDialogue } from '../ui/dialogue.js';
import { banner, toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { stepAtLeast, stepBefore, talkHooks, quietMoment, startGuest, lifeCh, grant } from './life.js';
import { LETTERS } from '../data/letters.js';
import { NPCS } from '../data/npcs.js';

const L = () => G.s.life;
const rom = () => L().romance;
const byId = (id) => LETTERS.find((l) => l.id === id);

function eligible(l) {
  const s = G.s, life = L();
  if (life.read[l.id] || life.mail.some((m) => m.id === l.id) || life.calls.some((m) => m.id === l.id)) return false;
  if (l.kind === 'talk') return false;
  if (l.post) { if (!life.post) return false; }
  else {
    if (!l.ch.includes(s.chapter) || life.post) return false;
    if (l.after && !stepAtLeast(l.after)) return false;
    if (l.before && stepAtLeast(l.before)) return false;
  }
  if (l.needs && !l.needs(s)) return false;
  return true;
}

/** Each morning: at most one new letter and one call. */
export function deliverMail() {
  if (!G.s || G.endless || G.prequel) return;
  const life = L();
  if (life.lastMailDay === G.s.time.day) return;
  life.lastMailDay = G.s.time.day;
  const letter = LETTERS.find((l) => l.kind === 'letter' && eligible(l));
  if (letter) { life.mail.push({ id: letter.id, day: G.s.time.day }); life.mailNoted = false; }
  const call = LETTERS.find((l) => l.kind === 'call' && eligible(l));
  if (call) life.calls.push({ id: call.id, day: G.s.time.day });
}

export const unreadMail = () => (G.s && G.s.life ? G.s.life.mail.length : 0);
export const pendingCall = () => (G.s && G.s.life && G.s.life.calls.length ? byId(G.s.life.calls[0].id) : null);

/** Read the oldest letter waiting in the mailbox. Returns true if there was one. */
export function readMail() {
  const life = L();
  if (!life.mail.length) return false;
  const m = life.mail.shift();
  const l = byId(m.id);
  if (!l) return readMail();
  play(l);
  return true;
}

/** Answer the phone if somebody's calling. Returns true if it handled the phone. */
export function answerCall() {
  const life = L();
  if (!life.calls.length || !atHome()) return false;
  const m = life.calls.shift();
  const l = byId(m.id);
  if (!l) return false;
  G.phoneRingT = 0;
  play(l);
  return true;
}

function play(l) {
  const life = L();
  life.read[l.id] = G.s.time.day;
  let v = null;
  const lines = l.lines(G.s).map((x) => (!x.choices ? x : { ...x, choices: x.choices.map((c) => ({ text: c.text, effect: () => { v = c.value; return c.lines || []; } })) }));
  sfx(l.kind === 'call' ? 'phone' : 'pickup');
  playDialogue(lines, () => {
    if (v != null) life.replies[l.id] = v;
    if (l.result) { try { l.result(G.s, v); } catch (e) { console.error(e); } }
    if (l.from && G.s.rel[l.from] != null) addRel(l.from, 3);
    G.events.emit('letterRead', l.id);
    if (l.kind !== 'talk') import('./life.js').then((m) => m.lifeMoment('event'));
    saveGame('letter');
  });
}

/** The phone rings in the evening while a call is waiting and Frank is home. */
let ringT = 0;
export function updateLetters(dt) {
  if (!G.s || G.endless || G.prequel || !G.player) return;
  ringT -= dt;
  if (ringT > 0) return;
  ringT = 3;
  const life = L();
  romanceDay();
  if (life.mail.length && atHome() && !life.mailNoted && quietMoment()) { life.mailNoted = true; banner(`📬 There's a letter in your mailbox${life.mail.length > 1 ? ` (${life.mail.length})` : ''}.`, 'info', 4); }
  const h = G.s.time.minute / 60;
  if (life.calls.length && atHome() && G.s.home.phoneLine && h >= 17 && h < 23 && quietMoment() && G.s.story.step !== 'phone_call') {
    sfx('phone');
    if (!life.ringNoted) { life.ringNoted = true; toast('📞 The phone is ringing.', 'info', 3); }
  } else life.ringNoted = false;
}

/** Journal: letters read and waiting. */
export function letterLog() {
  const life = (G.s && G.s.life) || { read: {}, mail: [], calls: [] };
  const read = Object.entries(life.read).map(([id, day]) => ({ id, day, ...(byId(id) || {}) })).filter((x) => x.title && x.kind !== 'talk').sort((a, b) => b.day - a.day);
  return { read, waiting: life.mail.length, calling: life.calls.length };
}
export function rereadLetter(id) { const l = byId(id); if (l) playDialogue(l.lines(G.s).map((x) => ({ who: x.who, text: x.text }))); }

/* ---------------- conversations that set things up ---------------- */
talkHooks.push((n) => {
  if (visiting()) return false;
  const t = LETTERS.find((l) => l.kind === 'talk' && l.from === n.id && !L().read[l.id] && l.ch.includes(G.s.chapter) && (!l.after || stepAtLeast(l.after)) && (!l.needs || l.needs(G.s)));
  if (!t) return false;
  play(t);
  return true;
});

/* ---------------- Dee ---------------- */
const D = 'Dee Marsh';
const deeArc = () => ['dee_2', 'dee_4', 'dee_4p', 'dee_4t'].some((id) => (G.s.errands[id] || {}).state === 'done');

/** "Closing Time": the evening Dee asks who Frank really is. Chapter 1, once they're close. */
talkHooks.push((n) => {
  if (n.id !== 'dee' || visiting() || G.s.chapter !== 1 || rom().stage > 0) return false;
  const h = G.s.time.minute / 60;
  if (relOf('dee') < 3 || !(deeArc() || rom().memorial) || !stepAtLeast('rest') || h < 17 || h >= 21) return false;
  rom().stage = 1;
  let v = null;
  playDialogue([
    { who: D, text: 'Frank. Help me pull the shutters? My shoulder\'s bad. (It isn\'t.)' },
    { who: '', text: '(Afterwards you sit on the store steps with two forks and the last of a cherry pie. The street is empty. The bugs are loud.)' },
    { who: D, text: 'Can I ask you something, and you don\'t lie? You can not answer. Just don\'t lie.' },
    { who: D, text: 'Who are you, Frank? Not your name. I don\'t care about your name.', choices: [
      { text: '"Somebody who did bad things for a long time and is trying to stop."', effect: () => { v = 'open'; return [{ who: D, text: '(She doesn\'t move away. If anything, she moves a little closer.) Okay. ...Okay. That\'s a good answer. That\'s a really good answer.' }]; } },
      { text: '"A guy who likes your pie, Dee. That\'s the whole story."', effect: () => { v = 'light'; return [{ who: D, text: '(A small smile.) Liar. But a nice one. Have the last bite.' }]; } },
    ] },
  ], () => {
    rom().closing = v;
    addRel('dee', v === 'open' ? 12 : 6);
    addXP(20, 'Closing time');
    saveGame('romance');
  });
  return true;
});

/** The porch, on a visit home: the big question, answered either way. */
talkHooks.push((n) => {
  if (n.id !== 'dee' || !visiting() || hereN() !== 1) return false;
  const r = rom();
  if (r.path !== 'romance' || r.stage >= 4 || !r.invited || (G.s.life.post && G.s.life.post.ending === 'crown')) return false;
  const h = G.s.time.minute / 60;
  if (h < 16) return false;
  let v = null;
  playDialogue([
    { who: D, text: 'You came. (She flips the sign to CLOSED at four in the afternoon. Tibbs, outside, gasps.)' },
    { who: '', text: '(The porch behind the store. Two chairs. The sun going down behind the water tower. Neither of you says anything for a long time.)' },
    { who: D, text: 'I\'m forty-nine years old, Frank. I don\'t have time to be coy. I think about you every day. I think you think about me. Am I wrong?', choices: [
      { text: '"You\'re not wrong." (Take her hand.)', effect: () => { v = 'together'; return [{ who: D, text: '(She laughs, and it cracks in the middle.) Oh thank God. I had a whole speech for if I was wrong. It was terrible.' }, { who: F_, text: 'When this is over — when they stop coming — I want to sit on this porch with you. As long as you\'ll have me.' }, { who: D, text: 'Then make them stop. And then come home.' }]; } },
      { text: '"I care about you too much to pull you into my life, Dee."', effect: () => { v = 'friends'; return [{ who: D, text: '(She\'s quiet a while.) That\'s the most Frank Lowe thing anyone\'s ever said. ...Okay. Friends. The real kind.' }, { who: D, text: 'But you still eat my pie when you\'re in town. That part\'s not negotiable.' }]; } },
    ] },
  ], () => {
    if (v === 'together') { r.stage = 4; addRel('dee', 15); addXP(40, 'The porch'); }
    else { r.path = 'friend'; r.stage = 3; addRel('dee', 8); }
    G.events.emit('romance', v);
    saveGame('romance');
  });
  return true;
});
const F_ = 'Frank';

/** After the story: Dee comes east, or writes why she can't. */
export function romancePostgame() {
  const r = rom(), life = L();
  if (!life.post || r.stage < 4 || r.post) return;
  r.post = 'pending';
}
export function romanceDay() {
  const r = rom(), life = L();
  if (!life.post || r.post !== 'pending' || !quietMoment() || !atHome()) return;
  r.post = 'started';
  if (life.post.ending === 'crown') {
    r.post = 'ended';
    playDialogue([
      { who: 'Letter from Dee', text: '"Frank. Ruth told me what you are now. The house on the hill, the men at the door. I believe you had reasons. I always will."' },
      { who: 'Letter from Dee', text: '"But I buried one man who kept secrets in the books. I can\'t love another one. I\'m sorry. The pie is still yours. — D."' },
    ]);
    r.path = 'friend';
    return;
  }
  playDialogue([
    { who: '', text: '(A dusty Ford with Minnesota plates pulls up the lane. Dee Marsh gets out, looks at the ravine, the ridge, the watch house, and you.)' },
    { who: D, text: 'I closed the store for a week. First time in thirty years. Gus is "minding it," God help us. Show me where you live, Frank.' },
  ], () => startGuest('dee5'));
}

export const romanceEpilogue = () => {
  const r = rom();
  if (!r || r.stage < 4) return r && r.path === 'friend' && r.stage >= 2 ? 'Dee Marsh still writes every month. The letters are full of Pine Hollow gossip and end the same way: "your seat is saved."' : null;
  return r.final === 'pinehollow' ? 'Frank Lowe spends his summers on the porch behind Marsh General, his winters arguing with Dee about the thermostat. Tibbs approves.'
    : r.final === 'east' ? 'Dee Marsh sold Marsh General to Jenny Miller and moved east. The watch house has a pie on the counter every Sunday now.'
      : 'Dee Marsh closes the store one week a year and drives east. The rest of the year, the phone bill is enormous.';
};

export function initLetterEvents() {
  G.events.on('newDay', () => { deliverMail(); romancePostgame(); });
  G.events.on('visitEnd', () => deliverMail());
}

export { grant, lifeCh, stepBefore, NPCS, toast };
