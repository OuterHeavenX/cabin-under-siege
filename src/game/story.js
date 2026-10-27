// Chapter 1: "The Cabin". Steps, objectives, scripted conversations and the
// authored first siege. Later chapters can add their own step tables.
import { G } from './state.js';
import { addItem, count } from './inventory.js';
import { addJP, addRel, addXP } from './progression.js';
import { addSign, addThreat, scheduleSiege, storyPlan } from './siege.js';
import { playDialogue } from '../ui/dialogue.js';
import { banner, toast } from '../ui/hud.js';
import { showChapterEnd } from '../ui/menus.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { addPickup } from './combat.js';
import { jobWaypoint } from './jobs.js';
import { scheduleSpot } from './npcs.js';
import { NPCS } from '../data/npcs.js';

const ME = 'Frank';

export const STEPS = {
  arrive: { obj: 'Look around your new cabin — step inside.' },
  meet_ruth: { obj: 'Meet your neighbor at the farm to the east.' },
  go_town: { obj: 'Drive to Pine Hollow: use your car on the driveway.' },
  find_work: { obj: 'Find Gus Okafor at the lumber yard and ask about work.' },
  first_job: { obj: 'Take and complete a job from the board at Okafor Lumber.' },
  see_dee: { obj: 'Dee at Marsh General wants a word.' },
  stranger: { obj: 'Find the man in the grey coat near the diner (daytime).' },
  reinforce: { obj: 'Reinforce the cabin: board a window, brace a door, or place cover.' },
  first_siege: { obj: 'They\'re coming tonight. Be at the cabin by 10 PM — and survive.' },
  search_body: { obj: 'Search the big man for anything useful.' },
  show_ruth: { obj: 'Show the note to Ruth.' },
  phone_call: { obj: 'The cabin phone is ringing. Answer it.' },
  free: { obj: 'Chapter 1 complete. Work, fortify, and stay alive.' },
  leave_town: { obj: 'Chapter 1 complete. Keep playing — or, when you\'re ready, use your car at the cabin to leave Pine Hollow for good (Chapter 2).' },
  // ---- Chapter 2: Larch Street ----
  ch2_arrive: { obj: 'Look around the new house on Larch Street — step inside.' },
  ch2_meet_marcus: { obj: 'Say hello to your neighbor across the street.' },
  ch2_find_work: { obj: 'Find Pete Kowalski at Kowalski Moving (Main Street) and ask about work.' },
  ch2_job: { obj: 'Take and complete a job from Pete\'s job board.' },
  ch2_rosa: { obj: 'Rosa at Delgado Hardware wants to talk to you.' },
  ch2_letter: { obj: 'Check your mailbox.' },
  ch2_fortify: { obj: 'Fortify the house: install two defenses (shutters, boards, braces, traps or cover).' },
  ch2_siege: { obj: 'Sal Benedetto is coming. Be home by 10 PM — and survive.' },
  ch2_phone: { obj: 'Search Sal for anything useful.' },
  ch2_marcus_truth: { obj: 'Show Marcus what you found.' },
  ch2_free: { obj: 'Chapter 2 complete. Work, fortify, and stay alive. (Chapter 3 is planned for a future update.)' },
};

export function objectiveText() {
  const st = G.s.story;
  return (STEPS[st.step] || STEPS.free).obj;
}

function setStep(step) {
  G.s.story.step = step;
  G.events.emit('storyStep', step);
  banner(`New objective: ${STEPS[step].obj}`, 'objective', 5);
  sfx('chime');
  saveGame('story', { force: false });
}

const mb = () => G.maps.millbrook;

const npcPoint = (id) => {
  const def = NPCS[id];
  const spot = scheduleSpot(def, G.s.time.minute);
  const m = G.maps[spot.map];
  return { map: spot.map, ...m.points[spot.pt] };
};

/** Where the story wants you: {map, x, y, label}. */
export function storyWaypoint() {
  const st = G.s.story;
  const cab = G.maps.cabin, town = G.maps.town;
  switch (st.step) {
    case 'arrive': return { map: 'cabin', ...cab.points.cabin_front, label: 'Cabin' };
    case 'meet_ruth': return { ...npcPoint('ruth'), label: 'Ruth' };
    case 'go_town': return { map: 'cabin', ...cab.points.car, label: 'Car' };
    case 'find_work': return { ...npcPoint('gus'), label: 'Gus' };
    case 'first_job': {
      if (G.s.job) return jobWaypoint();
      const jb = town.props.find((p) => p.id === 'jobboard');
      return { map: 'town', x: jb.x, y: jb.y, label: 'Job board' };
    }
    case 'see_dee': return { ...npcPoint('dee'), label: 'Dee' };
    case 'stranger': return { map: 'town', ...town.points.stranger, label: 'Stranger' };
    case 'reinforce': return { map: 'cabin', ...cab.points.cabin_front, label: 'Cabin' };
    case 'first_siege': return { map: 'cabin', ...cab.points.cabin_in, label: 'Cabin' };
    case 'search_body': {
      const pk = G.pickups.find((p) => p.kind === 'note');
      return pk ? { map: G.map.id, x: pk.x, y: pk.y, label: 'Note' } : { map: 'cabin', ...cab.points.porch, label: 'Porch' };
    }
    case 'show_ruth': return { ...npcPoint('ruth'), label: 'Ruth' };
    case 'phone_call': return { map: 'cabin', x: 26.5 * 32, y: 18.6 * 32, label: 'Phone' };
    case 'leave_town': return G.s.job ? jobWaypoint() : null;
    case 'ch2_arrive': return { map: 'millbrook', ...mb().points.cabin_front, label: 'House' };
    case 'ch2_meet_marcus': return { ...npcPoint('marcus'), label: 'Marcus' };
    case 'ch2_find_work': return { ...npcPoint('pete'), label: 'Pete' };
    case 'ch2_job': {
      if (G.s.job) return jobWaypoint();
      const jb = mb().props.find((p) => p.id === 'jobboard');
      return { map: 'millbrook', x: jb.x, y: jb.y, label: 'Job board' };
    }
    case 'ch2_rosa': return { ...npcPoint('rosa'), label: 'Rosa' };
    case 'ch2_letter': { const mx = mb().props.find((p) => p.id === 'mailbox'); return { map: 'millbrook', x: mx.x, y: mx.y, label: 'Mailbox' }; }
    case 'ch2_fortify': return { map: 'millbrook', ...mb().points.cabin_front, label: 'House' };
    case 'ch2_siege': return { map: 'millbrook', ...mb().points.cabin_in, label: 'House' };
    case 'ch2_phone': {
      const pk = G.pickups.find((p) => p.kind === 'burner');
      return pk ? { map: G.map.id, x: pk.x, y: pk.y, label: 'Phone' } : null;
    }
    case 'ch2_marcus_truth': return { ...npcPoint('marcus'), label: 'Marcus' };
    default: return G.s.job ? jobWaypoint() : null;
  }
}

/** Story conversation for an NPC, or null for normal chat. */
export function storyDialogue(id) {
  const st = G.s.story;
  const f = st.flags;
  if (id === 'ruth' && st.step === 'meet_ruth') {
    return {
      lines: [
        { who: 'Ruth Calloway', text: 'So you\'re the one who bought Harold\'s cabin. Cash, the realtor said. Nobody pays cash anymore.' },
        { who: ME, text: 'Frank. Frank Lowe. I like things simple.' },
        { who: 'Ruth Calloway', text: 'Ruth. Simple I can respect. That cabin\'s drafty and the back door sticks. Harold always meant to fix it.' },
        { who: 'Ruth Calloway', text: 'You\'ll want groceries and work. Dee Marsh runs the general store in Pine Hollow, and Gus Okafor at the lumber yard always needs hands.' },
        { who: 'Ruth Calloway', text: 'Here — bandages. Thirty years a nurse, I can spot a man who\'s going to need them.' },
        { who: ME, text: '...Thanks, Ruth.' },
      ],
      onEnd: () => { addItem('bandage', 2); addRel('ruth', 6); addXP(20, 'Met Ruth'); setStep('go_town'); },
    };
  }
  if (id === 'gus' && st.step === 'find_work') {
    return {
      lines: [
        { who: 'Gus Okafor', text: 'You\'re the new guy in the Calloway cabin. Ruth already called. She says you\'ve got shoulders.' },
        { who: ME, text: 'I need honest work. Whatever you\'ve got.' },
        { who: 'Gus Okafor', text: 'Honest work I\'ve got. Honest pay too. Jobs go up on the board by the office, seven to five.' },
        { who: 'Gus Okafor', text: 'Woodcutting, deliveries, repairs. You bring me wood, you fix what\'s broken, you don\'t make me chase you. Deal?' },
        { who: ME, text: 'Deal.' },
        { who: 'Gus Okafor', text: 'Good. The woodlot\'s east of the yard. Use that axe of yours. I also sell lumber, tools and hardware if you\'re fixing up the cabin.' },
      ],
      onEnd: () => { addRel('gus', 6); addXP(20, 'Met Gus'); setStep('first_job'); },
    };
  }
  if (id === 'dee' && st.step === 'see_dee') {
    return {
      lines: [
        { who: 'Dee Marsh', text: 'There he is. Frank, right? Gus says you actually finished a job. That\'s a town record.' },
        { who: 'Dee Marsh', text: 'Listen, honey. A man came in yesterday. Grey coat, Jersey plates, bought nothing. Asked if any city fellas moved in lately.' },
        { who: ME, text: '...What did you tell him?' },
        { who: 'Dee Marsh', text: 'That the only city fella in Pine Hollow is my ex-husband, and he\'s in the cemetery. But he\'s still around. Hangs by the diner.' },
        { who: 'Dee Marsh', text: 'Whatever this is, it\'s none of my business. But you might want to look him in the eye.' },
      ],
      onEnd: () => { f.strangerInTown = true; addRel('dee', 5); setStep('stranger'); },
    };
  }
  if (id === 'marcus' && st.step === 'ch2_meet_marcus') {
    return {
      lines: [
        { who: 'Marcus Bell', text: 'You\'re the cash buyer. Pulled in at 4:12 yesterday, Ohio dealer plates, no moving truck. Packs light.' },
        { who: ME, text: '...Frank Lowe. You always clock your neighbors like that?' },
        { who: 'Marcus Bell', text: 'Marcus Bell. Thirty-one years with the postal service. Habits stick.' },
        { who: 'Marcus Bell', text: 'Pete Kowalski\'s always hiring down on Main Street. Rosa Delgado runs the hardware store — tell her I sent you, she\'ll only overcharge you a little.' },
        { who: 'Marcus Bell', text: 'And Frank? Whatever you\'re not telling me — I don\'t need to know. Just don\'t bring it to Larch Street.' },
      ],
      onEnd: () => { addRel('marcus', 6); addXP(25, 'Met Marcus'); setStep('ch2_find_work'); },
    };
  }
  if (id === 'pete' && st.step === 'ch2_find_work') {
    return {
      lines: [
        { who: 'Pete Kowalski', text: 'New guy! Marcus radioed ahead. That man radios everything ahead.' },
        { who: ME, text: 'I need work. Honest work.' },
        { who: 'Pete Kowalski', text: 'Honest is the only kind I got, buddy. Firewood, deliveries, fix-it jobs. Board\'s by the office, seven to five.' },
        { who: 'Pete Kowalski', text: 'The park\'s got deadfall you can split for firewood. Bring it to the drop-off in my yard. Easy money.' },
      ],
      onEnd: () => { addRel('pete', 6); addXP(25, 'Met Pete'); setStep('ch2_job'); },
    };
  }
  if (id === 'rosa' && st.step === 'ch2_rosa') {
    return {
      lines: [
        { who: 'Rosa Delgado', text: 'Frank. Come here. Lower your voice.' },
        { who: 'Rosa Delgado', text: 'Man came in this morning. Expensive coat, Chicago accent, bought four boxes of buckshot and asked if anybody new moved onto Larch Street.' },
        { who: ME, text: 'What did you tell him?' },
        { who: 'Rosa Delgado', text: 'That Larch Street is all retirees and dogs. He didn\'t believe me.' },
        { who: 'Rosa Delgado', text: 'Take these shutters. Steel. My grandfather put them on this store in \'68 after the riots. Go check your mail — he asked about a mailbox number.' },
      ],
      onEnd: () => { addItem('shutter_kit', 2); addRel('rosa', 8); addXP(30, 'Warned'); setStep('ch2_letter'); },
    };
  }
  if (id === 'marcus' && st.step === 'ch2_marcus_truth') {
    return {
      lines: [
        { who: 'Marcus Bell', text: 'I watched the whole thing from my window with a rifle across my knees. You fight like a man who\'s done it before.' },
        { who: ME, text: 'This was on the one in the good coat. Sal Benedetto. The phone has one number saved — "L." And a text: "Wisconsin next if Ohio fails."' },
        { who: 'Marcus Bell', text: '...Sit down, Frank.' },
        { who: 'Marcus Bell', text: 'I wasn\'t a mail carrier. Deputy U.S. Marshal, Witness Security, twenty-six years. I know what a man on the run looks like. I\'ve built a hundred of you.' },
        { who: 'Marcus Bell', text: 'The Vescaris don\'t send a Benedetto for a nobody. You know something Leo is afraid of.' },
        { who: ME, text: 'I know where the money goes. All of it.' },
        { who: 'Marcus Bell', text: 'Then you can\'t outrun them. Not forever. But you can outlast them — with the right friends and the right place.' },
        { who: 'Marcus Bell', text: 'There\'s a farm in Wisconsin. Off every book I ever kept. When you\'re ready, I\'ll make a call.' },
      ],
      onEnd: () => {
        st.done[2] = true;
        st.step = 'ch2_free';
        G.s.world.threat = Math.max(G.s.world.threat, 50);
        G.s.world.quietUntilDay = G.s.time.day + 2;
        addRel('marcus', 12);
        addXP(120, 'Chapter 2 complete');
        saveGame('chapter');
        showChapterEnd(2);
      },
    };
  }
  if (id === 'ruth' && st.step === 'show_ruth') {
    return {
      lines: [
        { who: 'Ruth Calloway', text: 'I heard it all from my porch. I had Harold\'s shotgun across my lap the whole night.' },
        { who: ME, text: 'One of them had this. "Pine Hollow. Cabin off Route 9. Confirm it\'s him. — V."' },
        { who: 'Ruth Calloway', text: 'Frank. I\'m not stupid and neither are you. Who\'s V?' },
        { who: ME, text: 'Vinnie Vescari. His uncle Leo runs a family in Newark. I used to work for them. I walked away. Nobody walks away.' },
        { who: 'Ruth Calloway', text: '...Well. I nursed through two wars and a flood. I\'m not running from a man named Vinnie.' },
        { who: 'Ruth Calloway', text: 'You fix up that cabin, you keep working, and you keep that phone line working. If I see headlights, you\'ll hear from me.' },
      ],
      onEnd: () => { addRel('ruth', 10); addXP(40, 'Told the truth'); addJP('neighbor', 10); setStep('phone_call'); },
    };
  }
  return null;
}

export function initStoryEvents() {
  const ev = G.events;
  ev.on('mapLoaded', (id) => {
    if (id === 'town' && G.s.story.step === 'go_town') {
      addXP(25, 'Reached Pine Hollow');
      setStep('find_work');
    }
  });
  ev.on('jobDone', () => {
    if (G.s.story.step === 'first_job') setStep('see_dee');
    if (G.s.story.step === 'ch2_job') setStep('ch2_rosa');
  });
  ev.on('defenseInstalled', () => {
    const st = G.s.story;
    if (st.step !== 'ch2_fortify') return;
    st.flags.fortified = (st.flags.fortified || 0) + 1;
    if (st.flags.fortified < 2) { toast('One defense done — install one more.', 'info', 2.5); return; }
    const t = G.s.time;
    const day = t.minute < 20 * 60 + 30 ? t.day : t.day + 1;
    scheduleSiege(storyPlan(), day, 22 * 60);
    addSign('strange_car');
    setStep('ch2_siege');
    playDialogue([
      { who: ME, text: 'Two down. If Sal Benedetto is in town, he won\'t wait long. Sal never waits.' },
      { who: ME, text: 'He\'ll bring firebugs — Sal always liked fire. Keep moving, and keep them off the walls.' },
    ]);
  });
  ev.on('bossDropped', (e) => {
    const kind = e.carriesNote;
    const f = G.s.story.flags;
    if (kind === 'note' && !f.noteRead && count('note') === 0) addPickup('note', e.x, e.y + 6, 1, { map: G.map.id });
    if (kind === 'burner' && !f.burnerRead && count('burner') === 0) addPickup('burner', e.x, e.y + 6, 1, { map: G.map.id });
  });
  ev.on('burnerFound', () => {
    const f = G.s.story.flags;
    if (f.burnerRead) return;
    if (G.siegeActive) { f.burnerPending = true; toast('You pocket Sal\'s phone. Check it when it\'s safe.', 'info', 3); return; }
    readBurner();
  });
  ev.on('talkStranger', (n) => strangerTalk(n));
  ev.on('defenseInstalled', () => {
    if (G.s.story.step === 'reinforce') {
      const t = G.s.time;
      const day = t.minute < 20 * 60 + 30 ? t.day : t.day + 1;
      scheduleSiege(storyPlan(), day, 22 * 60);
      addSign('strange_car');
      addSign('footprints');
      setStep('first_siege');
      playDialogue([
        { who: ME, text: 'That\'ll hold. For a while.' },
        { who: ME, text: 'If Vescari\'s people found Pine Hollow, they\'ll come at night. Tonight, if I know them.' },
        { who: ME, text: 'Stock up on rounds and bandages. Fix what\'s broken. Pick my spots. Be home by ten.' },
      ]);
    }
  });
  ev.on('siegeWon', (sg) => {
    if (sg.plan.kind !== 'story') return;
    const f = G.s.story.flags;
    if (G.s.chapter === 2) {
      f.firstSiegeDone = true;
      if (f.burnerPending) { f.burnerPending = false; setTimeout(readBurner, 2500); return; }
      if (f.burnerRead) return;
      if (!G.pickups.some((p) => p.kind === 'burner') && count('burner') === 0) {
        const p = G.map.points.porch;
        addPickup('burner', p.x + 30, p.y + 20, 1, { map: G.map.id });
        toast('Sal dropped something by the porch as he ran.', 'info', 4);
      }
      setTimeout(() => { if (G.s.story.step === 'ch2_siege') setStep('ch2_phone'); }, 3800);
      return;
    }
    f.firstSiegeDone = true;
    if (f.notePending) { f.notePending = false; setTimeout(readNote, 2500); return; }
    if (f.noteRead) return;
    if (!G.pickups.some((p) => p.kind === 'note') && count('note') === 0) {
      const p = G.maps.cabin.points.porch;
      addPickup('note', p.x + 30, p.y + 20, 1, { map: 'cabin' });
      toast('One of them dropped something by the porch as he ran.', 'info', 4);
    }
    setTimeout(() => { if (G.s.story.step === 'first_siege') setStep('search_body'); }, 3800);
  });
  ev.on('noteFound', () => {
    const f = G.s.story.flags;
    if (f.noteRead) return;
    if (G.siegeActive) { f.notePending = true; toast('You pocket a folded note. Read it when it\'s safe.', 'info', 3); return; }
    readNote();
  });
}

function readNote() {
  const f = G.s.story.flags;
  if (f.noteRead) return;
  f.noteRead = true;
  playDialogue([
    { who: ME, text: 'A folded note. Cheap hotel stationery from Newark.' },
    { who: 'Note', text: '"Pine Hollow. The cabin off Route 9. Confirm it\'s him before you do anything. Don\'t get cute. — V."' },
    { who: ME, text: 'V. Vinnie Vescari. Leo\'s nephew. So Leo knows.' },
    { who: ME, text: 'Ruth heard the shooting. She deserves the truth.' },
  ], () => {
    addXP(30, 'Clue');
    addJP('shadow', 12);
    const st = G.s.story.step;
    if (st === 'search_body' || st === 'first_siege') setStep('show_ruth');
  });
}

function readBurner() {
  const f = G.s.story.flags;
  if (f.burnerRead) return;
  f.burnerRead = true;
  playDialogue([
    { who: ME, text: 'Sal\'s burner. One contact, saved as "L."' },
    { who: 'Text from L', text: '"Confirm Frankie. If Ohio fails, Wisconsin next. He has a friend who builds new lives. Find the friend."' },
    { who: ME, text: 'A friend who builds new lives...' },
    { who: ME, text: 'Marcus. He was watching the whole time. Time I asked him some questions.' },
  ], () => {
    addXP(40, 'Clue'); addJP('shadow', 14);
    const st = G.s.story.step;
    if (st === 'ch2_phone' || st === 'ch2_siege') setStep('ch2_marcus_truth');
  });
}

/** Mailbox hook for story letters. Returns true if the story handled it. */
export function storyMail() {
  if (G.s.story.step !== 'ch2_letter') return false;
  playDialogue([
    { who: ME, text: 'No stamp. Hand-delivered. A Polaroid of the cabin in Pine Hollow — taken from the treeline.' },
    { who: 'Back of the photo', text: '"Nice place you had. Nicer place you got. — S.B."' },
    { who: ME, text: 'Sal Benedetto. Leo\'s cleanup man. He doesn\'t do warnings unless he wants you scared.' },
    { who: ME, text: 'Fine. Let him come to a house that\'s ready for him.' },
  ], () => { addJP('shadow', 8); addThreat(10); setStep('ch2_fortify'); });
  return true;
}

/** The scripted (and repeatable sign) conversation with the stranger. */
function strangerTalk(n) {
  const st = G.s.story;
  const isStory = st.step === 'stranger';
  const sign = G.s.world.signs.stranger;
  playDialogue([
    { who: 'Man in a Grey Coat', text: 'Afternoon. Nice little town. I\'m looking for an old friend of mine — Frankie. Jersey guy. Talks with his hands.' },
    {
      who: 'Man in a Grey Coat', text: 'You seen anybody like that around?',
      choices: [
        { text: '"Never heard of him."', effect: () => { addJP('shadow', 15); return [{ who: 'Man in a Grey Coat', text: 'Huh. Well. If you do, tell him the family misses him.' }, { who: ME, text: '(You kept your voice flat. He didn\'t get anything he could use.)' }]; } },
        { text: '"Who\'s asking?"', effect: () => { addThreat(8, 'the stranger heard your accent'); addJP('shadow', 5); return [{ who: 'Man in a Grey Coat', text: 'A friend. That accent of yours — Newark? Small world.' }]; } },
        { text: '"Get out of my town."', effect: () => { addThreat(14, 'you threatened the stranger'); addJP('gunhand', 6); return [{ who: 'Man in a Grey Coat', text: '"Your" town. Okay, friend. Okay.' }, { who: ME, text: '(That was a mistake. Now he knows exactly who you are.)' }]; } },
      ],
    },
  ], () => {
    if (sign) sign.done = true;
    G.npcs = G.npcs.filter((x) => x !== n);
    toast('The stranger walks off and drives away in a dark sedan.', 'info', 3);
    if (isStory) {
      st.flags.metStranger = true;
      playDialogue([
        { who: 'Dee Marsh', text: '(Dee hurries out of the store.) I saw that. Frank, whatever he wants, it isn\'t good.' },
        { who: 'Dee Marsh', text: 'Take these window boards from my back room. On the house. Go home and lock that cabin up tight.' },
      ], () => { addItem('board_kit', 2); addRel('dee', 6); addXP(30, 'Faced the stranger'); setStep('reinforce'); });
    }
  });
}

/** Called when the player first enters the cabin, and other location triggers. */
export function updateStory(dt) {
  const st = G.s.story;
  if (st.step === 'arrive' && G.map.id === 'cabin') {
    const b = G.map.buildingAt(G.player.x, G.player.y);
    if (b && b.id === 'cabin') {
      st.step = 'meet_ruth';
      playDialogue([
        { who: ME, text: 'Two rooms, a wood stove, and a bed that smells like cedar. It\'s perfect.' },
        { who: ME, text: 'Frankie Corsetti died in a Newark parking garage. Frank Lowe pays his bills on time and says good morning to his neighbors.' },
        { who: ME, text: 'There\'s a farmhouse to the east. Might as well start with "good morning."' },
      ], () => setStep('meet_ruth'));
    }
  }
  if (st.step === 'ch2_arrive' && G.map.id === 'millbrook') {
    const b = G.map.buildingAt(G.player.x, G.player.y);
    if (b && b.id === 'house') {
      st.step = 'ch2_meet_marcus';
      playDialogue([
        { who: ME, text: 'Millbrook, Ohio. Three bedrooms, a chain-link fence, a mailbox with a name on it that isn\'t mine.' },
        { who: ME, text: 'Ruth cried when I left. Told me to write. I won\'t. Letters can be followed.' },
        { who: ME, text: 'The man across the street has been watching me unload the car for twenty minutes. Might as well say hello.' },
      ], () => setStep('ch2_meet_marcus'));
    }
  }
  if (st.step === 'phone_call' && G.map.id === 'cabin') {
    G.phoneRingT = (G.phoneRingT || 0) - dt;
    if (G.phoneRingT <= 0) { sfx('phone'); G.phoneRingT = 3; }
  }
}

export function answerPhone() {
  const st = G.s.story;
  if (st.step === 'phone_call') {
    playDialogue([
      { who: ME, text: 'Hello?' },
      { who: 'Voice', text: '...Frankie. You sound good. Country air agrees with you.' },
      { who: ME, text: 'Leo.' },
      { who: 'Leo Vescari', text: 'You know, my nephew wanted to burn the place with you in it. I said no. I said, Frankie was family. Frankie deserves a conversation.' },
      { who: 'Leo Vescari', text: 'You took something from me when you walked away. Not money. Respect. People saw you leave and nobody stopped you.' },
      { who: ME, text: 'I\'m out, Leo. I just want to be left alone.' },
      { who: 'Leo Vescari', text: 'That\'s the thing, Frankie. Nobody gets to be alone. Not from family.' },
      { who: 'Leo Vescari', text: 'Next time I won\'t send boys.' },
      { who: ME, text: '(Click. Dial tone.)' },
    ], () => {
      st.chapterComplete = true;
      st.done[1] = true;
      st.step = 'leave_town';
      G.s.world.threat = Math.max(G.s.world.threat, 45);
      G.s.world.quietUntilDay = G.s.time.day + 2;
      addXP(80, 'Chapter 1 complete');
      saveGame('chapter');
      showChapterEnd(1);
    });
    return true;
  }
  if (!G.s.home.phoneLine) { toast('Dead line. The phone wire by the road must be damaged.', 'warn', 3); return true; }
  playDialogue([{ who: ME, text: 'Just a dial tone. Nobody to call who wouldn\'t ask questions.' }]);
  return true;
}

export function newGameIntro() {
  playDialogue([
    { who: '', text: 'Pine Hollow. Population 212. Six hundred miles from Newark.' },
    { who: ME, text: 'Twenty years I did what the Vescari family told me. Collections. Driving. Things I don\'t talk about.' },
    { who: ME, text: 'Then I walked away. New name, new plates, a cabin nobody wanted at the end of a dirt road.' },
    { who: ME, text: 'Here, I\'m just Frank Lowe. I chop wood. I pay my bills. I wave at neighbors.' },
    { who: ME, text: 'Let\'s go see the place.' },
    { who: 'Tip', text: 'Move with WASD / the left side of the screen. Aim with the mouse / right stick. Interact with E / the ACT button. Open the Menu (☰) for help.' },
  ]);
}
