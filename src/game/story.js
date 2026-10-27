// Chapter 1: "The Cabin". Steps, objectives, scripted conversations and the
// authored first siege. Later chapters can add their own step tables.
import { G } from './state.js';
import { addItem, count, removeItem } from './inventory.js';
import { addJP, addRel, addXP, relOf } from './progression.js';
import { addSign, addThreat, scheduleSiege, storyPlan } from './siege.js';
import { playCutscene } from '../ui/cutscene.js';
import { playDialogue } from '../ui/dialogue.js';
import { banner, toast } from '../ui/hud.js';
import { showChapterEnd } from '../ui/menus.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { addPickup } from './combat.js';
import { jobWaypoint } from './jobs.js';
import { scheduleSpot } from './npcs.js';
import { NPCS } from '../data/npcs.js';
import { choresStatus, errandWaypoint, errandGiverWaypoint, startErrand, townErrandsDone } from './errands.js';
import { startQuest } from './quests.js';

const ME = 'Frank';

export const STEPS = {
  arrive: { obj: 'Look around your new cabin — step inside.' },
  meet_ruth: { obj: 'Meet your neighbor at the farm to the east.' },
  go_town: { obj: 'Drive to Pine Hollow: use your car on the driveway.' },
  settle_in: { obj: () => `Settle in: finish 4 of the 5 chores (${choresStatus().done}/4 done) — the Journal lists them.` },
  find_work: { obj: 'Find Gus Okafor at the lumber yard in Pine Hollow and ask about work.' },
  town_trust: { obj: () => `Earn Pine Hollow's trust: jobs for Gus (${Math.min(3, jobsSinceTrust())}/3) · help townsfolk (${Math.min(2, townErrandsDone())}/2)` },
  rest: { obj: 'Pine Hollow is warming up to you. Head home and get some sleep.' },
  trail: { obj: 'Someone\'s been watching the cabin. Follow the boot prints.' },
  probe: { obj: 'Someone will test the cabin tonight. Be home after dark — and stay alive.' },
  prepare: { obj: () => { const f = G.s.story.flags; return `Prepare: first aid from Ruth ${f.firstAid ? '✓' : '·'} · carpentry from Gus ${f.carpentry ? '✓' : '·'} · find Harold's pocket watch ${questDoneFn('ruth_watch') ? '✓' : '·'}`; } },
  first_job: { obj: 'Take and complete a job from the board at Okafor Lumber.' },
  see_dee: { obj: 'Dee at Marsh General wants a word.' },
  stranger: { obj: 'Find the man in the grey coat near the diner (daytime).' },
  reinforce: { obj: () => `Fortify the cabin: install three defenses (${Math.min(3, G.s.story.flags.fortified || 0)}/3) — boards, braces, cover, traps.` },
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
  ch2_free: { obj: 'Chapter 2 complete. Keep playing — or, when you\'re ready, use your car at the house to leave for the Wisconsin farm (Chapter 3).' },
  // ---- Chapter 3: The Wisconsin Farm ----
  ch3_arrive: { obj: 'Look around the farm — step into the farmhouse.' },
  ch3_meet_ingrid: { obj: 'Meet your neighbor at the dairy across the pasture.' },
  ch3_find_work: { obj: 'Find Tess Albright at the Grain Co-op in Kettle Crossing.' },
  ch3_job: { obj: 'Take and complete a job from the co-op board.' },
  endless: { obj: 'Endless Siege: survive as many waves as you can.' },
  ch3_deputy: { obj: 'A sheriff\'s deputy is waiting at your farmhouse (daytime).' },
  ch3_fortify: { obj: 'Repair the farm gate (both halves) and install two defenses.' },
  ch3_siege: { obj: 'Vinnie Vescari is coming. Be home by 10 PM — and hold the farm.' },
  ch3_ledger: { obj: 'Search Vinnie for whatever he was carrying.' },
  ch3_ingrid_truth: { obj: 'Show Ingrid what you found.' },
  ch3_free: { obj: 'Chapter 3 complete. Keep playing — or, when you\'re ready, use your car at the farmhouse to leave for the lake estate (Chapter 4).' },
  // ---- Chapter 4: The Estate ----
  ch4_arrive: { obj: 'Look around the estate — step into the manor.' },
  ch4_meet_eleanor: { obj: 'Introduce yourself to Mrs. Whitcombe at the gatehouse.' },
  ch4_find_work: { obj: 'Find Walt Bishop at the Point Yacht Club in Port Whitcombe.' },
  ch4_job: { obj: 'Take and complete a job from the yacht club board.' },
  ch4_reyes: { obj: 'A woman in a grey suit is waiting on the estate dock (daytime).' },
  ch4_fortify: { obj: 'Repair the iron gate (both halves) and install three defenses. The lake side is wide open.' },
  ch4_siege: { obj: 'Nico Vescari is coming — by road and by water. Be home by 10 PM and hold the manor.' },
  ch4_ring: { obj: 'Search the lakeshore for whatever Nico dropped.' },
  ch4_eleanor_truth: { obj: 'Tell Mrs. Whitcombe what happened.' },
  ch4_free: { obj: 'Chapter 4 complete. Work, fortify, and stay alive. (Chapter 5 — the mansion in Short Hills — is planned for a future update.)' },
};

const objOf = (s) => (typeof s.obj === 'function' ? s.obj() : s.obj);
export function objectiveText() {
  const st = G.s.story;
  return objOf(STEPS[st.step] || STEPS.free);
}
const jobsSinceTrust = () => (G.s.jobsDone || 0) - (G.s.story.flags.jobsBase || 0);
const questDoneFn = (id) => ((G.s.quests || {})[id] || {}).state === 'done';

function setStep(step) {
  G.s.story.step = step;
  G.events.emit('storyStep', step);
  banner(`New objective: ${objOf(STEPS[step])}`, 'objective', 5);
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
    case 'settle_in': return errandWaypoint((e) => e.chore);
    case 'town_trust': {
      if (G.s.job) return jobWaypoint();
      if (jobsSinceTrust() < 3) { const jb = town.props.find((p) => p.id === 'jobboard'); return { map: 'town', x: jb.x, y: jb.y, label: 'Job board' }; }
      return errandWaypoint((e) => !e.chore && !e.story) || errandGiverWaypoint();
    }
    case 'rest': return { map: 'cabin', ...cab.points.bed, label: 'Bed' };
    case 'trail': return errandWaypoint((e) => e.story);
    case 'probe': return { map: 'cabin', ...cab.points.cabin_in, label: 'Cabin' };
    case 'prepare': {
      const f = st.flags;
      if (!f.firstAid) return { ...npcPoint('ruth'), label: 'Ruth' };
      if (!f.carpentry) return { ...npcPoint('gus'), label: 'Gus' };
      return null; // the favor waypoint (Harold's watch) takes over
    }
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
    case 'ch2_free': return G.s.job ? jobWaypoint() : null;
    case 'ch3_arrive': return { map: 'farm', ...G.maps.farm.points.cabin_front, label: 'Farmhouse' };
    case 'ch3_meet_ingrid': return { ...npcPoint('ingrid'), label: 'Ingrid' };
    case 'ch3_find_work': return { ...npcPoint('tess'), label: 'Tess' };
    case 'ch3_job': {
      if (G.s.job) return jobWaypoint();
      const jb = G.maps.farm.props.find((p) => p.id === 'jobboard');
      return { map: 'farm', x: jb.x, y: jb.y, label: 'Job board' };
    }
    case 'ch3_deputy': return { map: 'farm', ...G.maps.farm.points.deputy, label: 'Deputy' };
    case 'ch3_fortify': return { map: 'farm', ...G.maps.farm.points.gate, label: 'Gate' };
    case 'ch3_siege': return { map: 'farm', ...G.maps.farm.points.cabin_in, label: 'Farmhouse' };
    case 'ch3_ledger': { const pk = G.pickups.find((p) => p.kind === 'ledger'); return pk ? { map: G.map.id, x: pk.x, y: pk.y, label: 'Ledger' } : null; }
    case 'ch3_ingrid_truth': return { ...npcPoint('ingrid'), label: 'Ingrid' };
    case 'ch4_arrive': return { map: 'estate', ...G.maps.estate.points.cabin_front, label: 'Manor' };
    case 'ch4_meet_eleanor': return { ...npcPoint('eleanor'), label: 'Eleanor' };
    case 'ch4_find_work': return { ...npcPoint('walt'), label: 'Walt' };
    case 'ch4_job': {
      if (G.s.job) return jobWaypoint();
      const jb = G.maps.estate.props.find((p) => p.id === 'jobboard');
      return { map: 'estate', x: jb.x, y: jb.y, label: 'Job board' };
    }
    case 'ch4_reyes': return { map: 'estate', ...G.maps.estate.points.reyes, label: 'Dock' };
    case 'ch4_fortify': return { map: 'estate', ...G.maps.estate.points.gate, label: 'Iron gate' };
    case 'ch4_siege': return { map: 'estate', ...G.maps.estate.points.cabin_in, label: 'Manor' };
    case 'ch4_ring': { const pk = G.pickups.find((p) => p.kind === 'signet'); return pk ? { map: G.map.id, x: pk.x, y: pk.y, label: 'Ring' } : null; }
    case 'ch4_eleanor_truth': return { ...npcPoint('eleanor'), label: 'Eleanor' };
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
        { who: 'Ruth Calloway', text: 'Ruth. Simple I can respect. That cabin\'s drafty, the roof leaks and the back door sticks. Harold always meant to fix it.' },
        { who: 'Ruth Calloway', text: 'And a pine came down across your driveway in last night\'s wind, so you\'ll be walking to town till you cut it up.' },
        { who: 'Ruth Calloway', text: 'While you\'ve got an axe out — my stove went cold two days ago and my hands won\'t hold a maul anymore. Ten logs would see me through the week.' },
        { who: ME, text: 'Ten logs. I can do that.' },
        { who: 'Ruth Calloway', text: 'Dee Marsh runs the general store in Pine Hollow — your cupboards are bare, I\'d bet. Here: bandages. Thirty years a nurse, I can spot a man who\'s going to need them.' },
      ],
      onEnd: () => {
        addItem('bandage', 2); addRel('ruth', 6); addXP(20, 'Met Ruth');
        for (const id of choresStatus().ids) startErrand(id, true);
        setStep('settle_in');
        toast('Five chores added — finish any four. Open the Journal to see them.', 'info', 4);
      },
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
        { who: 'Gus Okafor', text: 'Good. The woodlot\'s east of the yard. Do three jobs for me and I\'ll tell folks you\'re all right. In a town this size, that matters.' },
        { who: 'Gus Okafor', text: 'And help a few people while you\'re at it. Pastor Abe, the Miller girl, old Henderson, Tibbs — they all need something. Folks remember.' },
      ],
      onEnd: () => { addRel('gus', 6); addXP(20, 'Met Gus'); f.townOpen = true; f.jobsBase = G.s.jobsDone || 0; setStep('town_trust'); },
    };
  }
  if (id === 'dee' && st.step === 'see_dee') {
    return {
      lines: [
        { who: 'Dee Marsh', text: 'There he is. Frank, right? Gus says you actually finished a job. That\'s a town record.' },
        { who: 'Dee Marsh', text: 'Listen, honey. A man came in yesterday. Grey coat, Jersey plates. Bought two packs of Parliaments — nobody in Pine Hollow smokes Parliaments. Asked if any city fellas moved in lately.' },
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
        { who: 'Marcus Bell', text: 'There\'s a farm in Wisconsin. Off every book I ever kept. A woman named Ingrid Haugen keeps an eye on it. Want me to make the call?',
          choices: [
            { text: '"Make the call. I trust you."', effect: () => { G.s.choices.marcusHelp = true; return [{ who: 'Marcus Bell', text: 'Good. Ingrid will be expecting you. She\'ll have things ready.' }]; } },
            { text: '"I\'ll find my own way. Fewer people who know, the better."', effect: () => { G.s.choices.marcusHelp = false; return [{ who: 'Marcus Bell', text: 'Can\'t argue with the logic. The farm\'s still yours — but Ingrid won\'t know you from Adam.' }]; } },
          ] },
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
  if (id === 'ingrid' && st.step === 'ch3_meet_ingrid') {
    const helped = G.s.choices.marcusHelp;
    return {
      lines: helped ? [
        { who: 'Ingrid Haugen', text: 'You\'re Marcus\'s friend. He said you\'d be taller.' },
        { who: 'Ingrid Haugen', text: 'Pa hid people on that farm for thirty years. Root cellar\'s stocked, gate\'s busted, and the deputy in Kettle Crossing is a snake. That\'s the tour.' },
        { who: 'Ingrid Haugen', text: 'I put two med kits and a box of shells in your kitchen. Tess at the co-op needs hands. Go earn your keep.' },
      ] : [
        { who: 'Ingrid Haugen', text: 'The old Haugen place sold sight unseen to a cash buyer. That\'d be you.' },
        { who: 'Ingrid Haugen', text: 'I don\'t know you, mister, and out here that means something. The gate\'s broken. The deputy\'s nosy. Tess at the co-op is hiring.' },
        { who: ME, text: '(She doesn\'t trust you yet. Without Marcus\'s call, you\'re a stranger here.)' },
      ],
      onEnd: () => {
        if (helped) { addItem('medkit', 2, true); addItem('shells', 8, true); addRel('ingrid', 25); toast('Ingrid stocked your kitchen: 2 first-aid kits, 8 shells.', 'item', 3); }
        else addRel('ingrid', 4);
        addXP(25, 'Met Ingrid'); setStep('ch3_find_work');
      },
    };
  }
  if (id === 'tess' && st.step === 'ch3_find_work') {
    return {
      lines: [
        { who: 'Tess Albright', text: 'You\'re the cash buyer at the Haugen place. Can you lift, drive, and fix things without whining?' },
        { who: ME, text: 'Yes, yes, and mostly.' },
        { who: 'Tess Albright', text: 'Good enough. Board\'s out front. Harvest your own fields and bring the produce here, run deliveries, fix what\'s broke. Co-op pays Fridays. And every other day, because I\'m not a monster.' },
      ],
      onEnd: () => { addRel('tess', 6); addXP(25, 'Met Tess'); setStep('ch3_job'); },
    };
  }
  if (id === 'eleanor' && st.step === 'ch4_meet_eleanor') {
    const vouched = relOf('ingrid') >= 2 || G.s.choices.marcusHelp;
    return {
      lines: [
        { who: 'Eleanor Whitcombe', text: 'Mr. Lowe. Or is it Mr. Corsetti? Don\'t look so stricken. My husband laundered money for the Vescaris for twenty-two years. I know the type.' },
        ...(vouched ? [
          { who: 'Eleanor Whitcombe', text: 'Ingrid Haugen telephoned. Her father hid my sister from a very bad man in 1971. The Haugens do not ask favors lightly, so neither shall I refuse one.' },
          { who: 'Eleanor Whitcombe', text: 'The manor is yours to live in and to defend. I\'ve had the bedroom plated in steel — Edward\'s paranoia, finally useful. You\'ll find a kit in your things.' },
        ] : [
          { who: 'Eleanor Whitcombe', text: 'I hired you because a man with something to lose keeps a house in good order. Do not mistake that for affection.' },
        ]),
        { who: 'Eleanor Whitcombe', text: 'Walt Bishop at the yacht club has work. The iron gate is rusted half off its hinges. And the lake, Mr. Lowe, has no wall at all.' },
      ],
      onEnd: () => {
        if (vouched) { addItem('safe_room_kit', 1, true); addItem('medkit', 1, true); addRel('eleanor', 25); toast('Eleanor gave you a Safe Room Kit and a first-aid kit.', 'item', 3); }
        else addRel('eleanor', 4);
        addXP(30, 'Met Eleanor'); setStep('ch4_find_work');
      },
    };
  }
  if (id === 'walt' && st.step === 'ch4_find_work') {
    return {
      lines: [
        { who: 'Walt Bishop', text: 'You\'re the caretaker. Mrs. Whitcombe called. She never calls.' },
        { who: ME, text: 'I need work. Honest work.' },
        { who: 'Walt Bishop', text: 'Board\'s by the door. Docks, deliveries, repairs, fish for the club kitchen. Show up on time and I don\'t care what your name used to be.' },
      ],
      onEnd: () => { addRel('walt', 6); addXP(25, 'Met Walt'); setStep('ch4_job'); },
    };
  }
  if (id === 'eleanor' && st.step === 'ch4_eleanor_truth') {
    const ch = G.s.choices;
    return {
      lines: [
        { who: 'Eleanor Whitcombe', text: 'Boats on my lake, holes in my wainscoting, and a dead man\'s ring on my caretaker\'s finger. It has been an eventful week.' },
        { who: ME, text: 'Nico Vescari. Leo\'s son. He\'s alive. Leo called. He wants me at his house in Short Hills.' },
        ...(ch.reyes === 'give' ? [{ who: 'Eleanor Whitcombe', text: 'And your Agent Reyes has the book. So Leo is cornered. Cornered men are the most dangerous kind, Mr. Lowe. Edward taught me that.' }]
          : ch.reyes === 'copy' ? [{ who: 'Eleanor Whitcombe', text: 'Copies with the FBI, the original in your coat. Clever. Leo will want the original very badly.' }]
            : [{ who: 'Eleanor Whitcombe', text: 'You kept the book. Then you are the only thing standing between Leo Vescari and twenty years in a federal prison. He knows it.' }]),
        { who: 'Eleanor Whitcombe', text: 'Go, then. End it. And Mr. Lowe — the gatehouse has a spare room, should you ever want to come back and be boring.' },
      ],
      onEnd: () => {
        st.done[4] = true;
        st.step = 'ch4_free';
        G.s.world.threat = Math.max(G.s.world.threat, 60);
        G.s.world.quietUntilDay = G.s.time.day + 2;
        addRel('eleanor', 12);
        addXP(180, 'Chapter 4 complete');
        saveGame('chapter');
        showChapterEnd(4);
      },
    };
  }
  if (id === 'ingrid' && st.step === 'ch3_ingrid_truth') {
    return {
      lines: [
        { who: 'Ingrid Haugen', text: 'I counted eleven of them. You and that old woman held the whole farm. Pa would\'ve poured you a whiskey.' },
        { who: ME, text: 'Vinnie had this. Leo\'s books. Every payoff, every account, every judge and every cop on the take — including Deputy Mott.' },
        { who: 'Ingrid Haugen', text: '...That\'s not a ledger, Frank. That\'s a war.' },
        { who: ME, text: 'Leo won\'t stop. Not while I\'m breathing and not while this exists. So I stop running.' },
        { who: 'Ingrid Haugen', text: 'Then you need walls. Real ones. There\'s a woman on Lake Champlain — Eleanor Whitcombe. Her husband washed Vescari money for twenty years. She owes my family.' },
        { who: ME, text: 'A walled estate, and a woman who knows how Leo thinks. That\'s where I make my stand.' },
      ],
      onEnd: () => {
        st.done[3] = true;
        st.step = 'ch3_free';
        G.s.world.threat = Math.max(G.s.world.threat, 55);
        G.s.world.quietUntilDay = G.s.time.day + 2;
        addRel('ingrid', 12);
        addXP(150, 'Chapter 3 complete');
        saveGame('chapter');
        showChapterEnd(3);
      },
    };
  }
  if (id === 'ruth' && st.step === 'prepare' && !f.firstAid) {
    return {
      lines: [
        { who: 'Ruth Calloway', text: 'Two men in my orchard last night with pistols, and you walk over here like it\'s Sunday. Sit down. You\'re going to learn something.' },
        { who: 'Ruth Calloway', text: 'Pressure first, then pack it, then wrap it. Tight but not cruel. Again. Faster. Again.' },
        { who: ME, text: '...Where\'d you learn to do it this fast?' },
        { who: 'Ruth Calloway', text: 'Field hospital, 1968. Same as you, Frank, I don\'t talk about it. Take these. And find Harold\'s pocket watch for me, would you — I lost it by the pond. I\'ll make it worth your while.' },
      ],
      onEnd: () => {
        f.firstAid = true; (G.s.unlocks || (G.s.unlocks = {})).firstAid = true;
        addItem('bandage', 3, true); addRel('ruth', 6); addJP('survivor', 8);
        toast('First aid learned: all healing is 15% stronger.', 'level', 3.5);
        if (!(G.s.quests || {}).ruth_watch) startQuest('ruth_watch');
        checkPrepared();
      },
    };
  }
  if (id === 'gus' && st.step === 'prepare' && !f.carpentry) {
    return {
      lines: [
        { who: 'Gus Okafor', text: 'Heard about your visitors. Whole town has. You want my advice? Don\'t make the house a fortress. Make it a maze.' },
        { who: 'Gus Okafor', text: 'Barricades. Lumber cross-braced, screws not nails. Put \'em where you want people to go around. I\'ll show you once.' },
        { who: ME, text: '(Gus walks you through it twice, then makes you build one while he drinks coffee and criticizes.)' },
        { who: 'Gus Okafor', text: 'Good enough. Take a door brace too. No charge. Army engineers look after their own, even the ones who never enlisted.' },
      ],
      onEnd: () => {
        f.carpentry = true; (G.s.unlocks || (G.s.unlocks = {})).carpentry = true;
        addItem('door_brace', 1, true); addItem('wood', 4, true); addRel('gus', 8); addJP('handyman', 10);
        toast('Carpentry learned: build Wood Barricades at your workbench.', 'level', 3.5);
        checkPrepared();
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
  ev.on('errandDone', (id) => {
    const st = G.s.story;
    if (st.step === 'settle_in' && choresStatus().done >= 4) {
      playDialogue([
        { who: ME, text: 'Roof patched, pantry stocked, wood stacked. The place almost feels like a home.' },
        { who: ME, text: 'Money\'s running thin, though. Gus Okafor at the lumber yard always needs hands, Ruth said.' },
      ], () => setStep('find_work'));
    }
    if (st.step === 'town_trust') checkTrust();
    if (id === 'trail' && st.step === 'trail') {
      playDialogue([{ who: ME, text: 'Leo\'s people. Here. Already. Dee hears everything in this town — if somebody new has been around, she\'ll know.' }], () => setStep('see_dee'));
    }
  });
  ev.on('questDone', (id) => { if (id === 'ruth_watch') checkPrepared(); });
  ev.on('recovered', () => {
    if (G.s.story.step === 'probe' && !G.s.world.siege) scheduleProbe();
  });
  ev.on('siegeWon', (sg) => {
    if (sg.plan.kind !== 'probe' || G.s.story.step !== 'probe') return;
    setTimeout(() => {
      playDialogue([
        { who: ME, text: 'Two of them. Pistols, no plan, ran at the first shot. That wasn\'t an attack. That was a test.' },
        { who: ME, text: 'Next time they\'ll send real people. I need to be ready: Ruth knows medicine, Gus knows wood. And Harold had a rifle somewhere.' },
      ], () => setStep('prepare'));
    }, 2600);
  });
  ev.on('jobDone', () => {
    if (G.s.story.step === 'town_trust') checkTrust();
    if (G.s.story.step === 'first_job') setStep('see_dee');
    if (G.s.story.step === 'ch2_job') setStep('ch2_rosa');
    if (G.s.story.step === 'ch3_job') setStep('ch3_deputy');
    if (G.s.story.step === 'ch4_job') setStep('ch4_reyes');
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
  ev.on('defenseInstalled', () => { if (G.s.story.step === 'ch3_fortify') { G.s.story.flags.fortified = (G.s.story.flags.fortified || 0) + 1; checkFarmReady(); } });
  ev.on('repaired', () => { if (G.s.story.step === 'ch3_fortify') checkFarmReady(); });
  ev.on('talkDeputy', (n) => deputyTalk(n));
  ev.on('talkReyes', (n) => reyesTalk(n));
  ev.on('defenseInstalled', () => { if (G.s.story.step === 'ch4_fortify') { G.s.story.flags.fortified = (G.s.story.flags.fortified || 0) + 1; checkEstateReady(); } });
  ev.on('repaired', () => { if (G.s.story.step === 'ch4_fortify') checkEstateReady(); });
  ev.on('signetFound', () => {
    const f = G.s.story.flags;
    if (f.signetRead) return;
    if (G.siegeActive) { f.signetPending = true; toast('You pocket Nico\'s ring. Deal with it when it\'s quiet.', 'info', 3); return; }
    readSignet();
  });
  ev.on('ledgerFound', () => {
    const f = G.s.story.flags;
    if (f.ledgerRead) return;
    if (G.siegeActive) { f.ledgerPending = true; toast('You grab Vinnie\'s ledger. Read it when it\'s safe.', 'info', 3); return; }
    readLedger();
  });
  ev.on('bossDropped', (e) => {
    const kind = e.carriesNote;
    const f = G.s.story.flags;
    if (kind === 'note' && !f.noteRead && count('note') === 0) addPickup('note', e.x, e.y + 6, 1, { map: G.map.id });
    if (kind === 'burner' && !f.burnerRead && count('burner') === 0) addPickup('burner', e.x, e.y + 6, 1, { map: G.map.id });
    if (kind === 'ledger' && !f.ledgerRead && count('ledger') === 0) addPickup('ledger', e.x, e.y + 6, 1, { map: G.map.id });
    if (kind === 'signet' && !f.signetRead && count('signet') === 0) addPickup('signet', e.x, e.y + 6, 1, { map: G.map.id });
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
      const fl = G.s.story.flags;
      fl.fortified = (fl.fortified || 0) + 1;
      if (fl.fortified < 3) { toast(`Defense ${fl.fortified}/3 done.`, 'info', 2.5); return; }
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
    if (G.s.chapter === 4) {
      f.firstSiegeDone = true;
      if (f.signetPending) { f.signetPending = false; setTimeout(readSignet, 2500); return; }
      if (f.signetRead) return;
      if (!G.pickups.some((p) => p.kind === 'signet') && count('signet') === 0) {
        const p = G.map.points.reyes;
        addPickup('signet', p.x - 40, p.y, 1, { map: G.map.id });
        toast('Something glints on the dock where Nico\'s boat pulled away.', 'info', 4);
      }
      setTimeout(() => { if (G.s.story.step === 'ch4_siege') setStep('ch4_ring'); }, 3800);
      return;
    }
    if (G.s.chapter === 3) {
      f.firstSiegeDone = true;
      if (f.ledgerPending) { f.ledgerPending = false; setTimeout(readLedger, 2500); return; }
      if (f.ledgerRead) return;
      if (!G.pickups.some((p) => p.kind === 'ledger') && count('ledger') === 0) {
        const p = G.map.points.porch;
        addPickup('ledger', p.x + 30, p.y - 20, 1, { map: G.map.id });
        toast('Vinnie dropped something by the porch as he fled.', 'info', 4);
      }
      setTimeout(() => { if (G.s.story.step === 'ch3_siege') setStep('ch3_ledger'); }, 3800);
      return;
    }
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

function checkTrust() {
  if (G.s.story.step !== 'town_trust') return;
  if (jobsSinceTrust() < 3 || townErrandsDone() < 2) { banner(`New objective: ${objectiveText()}`, 'objective', 3); return; }
  const f = G.s.story.flags;
  f.trailDay = G.s.time.day + 1;
  playDialogue([
    { who: 'Gus Okafor', text: '(Gus catches you on Main Street.) Folks are talking about you, Frank. Good things, for once. Go home and get some sleep — you look like a man who hasn\'t slept in a year.' },
  ], () => setStep('rest'));
}

function scheduleProbe() {
  const t = G.s.time;
  const day = t.minute < 22 * 60 ? t.day : t.day + 1;
  scheduleSiege({ kind: 'probe', hpMult: 0.9, waves: [{ dir: 'north', types: ['scout', 'scout'], delay: 0 }] }, day, 23 * 60);
}

function checkPrepared() {
  const f = G.s.story.flags;
  if (G.s.story.step !== 'prepare' || !f.firstAid || !f.carpentry || !questDoneFn('ruth_watch')) return;
  playDialogue([
    { who: ME, text: 'Bandages, barricades, and Harold\'s rifle. Now the cabin.' },
  ], () => setStep('reinforce'));
}

function checkFarmReady() {
  const o = G.s.home.openings;
  const gateOk = ['gate_l', 'gate_r'].every((k) => o[k] && o[k].hp >= (o[k].baseHp || 100) + (o[k].reinforced ? 150 : 0) - 0.5);
  const n = G.s.story.flags.fortified || 0;
  if (!gateOk || n < 2) {
    toast(`Farm defenses: gate ${gateOk ? 'repaired ✓' : 'still broken'} · defenses ${Math.min(2, n)}/2`, 'info', 3);
    return;
  }
  const t = G.s.time;
  const day = t.minute < 20 * 60 + 30 ? t.day : t.day + 1;
  scheduleSiege(storyPlan(), day, 22 * 60);
  addSign('strange_car');
  setStep('ch3_siege');
  playDialogue([
    { who: ME, text: 'Gate\'s fixed. House is ready. If Leo sent Vinnie himself, he\'ll come hard and loud.' },
    { who: ME, text: 'Trucks. Rifles in the treeline. Keep moving, keep them off the house.' },
  ]);
}

function checkEstateReady() {
  const o = G.s.home.openings;
  const gateOk = ['gate_l', 'gate_r'].every((k) => o[k] && o[k].hp >= (o[k].baseHp || 100) + (o[k].reinforced ? 150 : 0) - 0.5);
  const n = G.s.story.flags.fortified || 0;
  if (!gateOk || n < 3) {
    toast(`Estate defenses: iron gate ${gateOk ? 'repaired ✓' : 'still broken'} · defenses ${Math.min(3, n)}/3`, 'info', 3);
    return;
  }
  const t = G.s.time;
  const day = t.minute < 20 * 60 + 30 ? t.day : t.day + 1;
  scheduleSiege(storyPlan(), day, 22 * 60);
  addSign('strange_car');
  setStep('ch4_siege');
  playDialogue([
    { who: ME, text: 'Gate\'s hung. The manor\'s as tight as a house with forty windows gets. But the lake side is wide open.' },
    { who: ME, text: 'Nico won\'t knock at the front. He\'ll come off the water. Watch the dock.' },
  ]);
}

/** Agent Reyes on the dock: what you do with the ledger. */
function reyesTalk(n) {
  const st = G.s.story;
  const mott = (G.s.choices || {}).deputy === 'bribe';
  const has = count('ledger') > 0;
  const R = 'Agent Dana Reyes';
  playDialogue([
    { who: R, text: 'Special Agent Dana Reyes, FBI organized crime. Relax, Mr. Corsetti. If I wanted you in cuffs you\'d be in cuffs.' },
    { who: R, text: 'Vinnie Vescari\'s ledger. You have it. I want it. With that book I can put Leo Vescari and half of Newark City Hall away for the rest of their lives.' },
    ...(mott ? [{ who: R, text: 'Page forty-one, by the way. Your friend Deputy Mott. He sold your new address to Nico Vescari for five thousand dollars. You should pick better friends.' }] : []),
    { who: R, text: has ? 'So. Do we have a deal?' : 'You don\'t have it on you? Then tell me where it is. Do we have a deal?',
      choices: [
        { text: '"Take it. Put them all away."', effect: () => { G.s.choices.reyes = 'give'; if (has) removeItem('ledger', 1); addThreat(-15); addJP('neighbor', 10); return [{ who: R, text: 'Smart. You\'re a witness now. I\'ll have agents watching the road — you\'ll hear from us before they hit you.' }, { who: ME, text: '(The feds will warn you early, and fewer of Nico\'s people will make it through. But Leo knows you talked.)' }]; } },
        { text: '"You get copies. I keep the book."', effect: () => { G.s.choices.reyes = 'copy'; addJP('shadow', 12); return [{ who: R, text: 'Copies won\'t hold up in court without the original. But they\'ll start the grand jury. Fine. For now.' }, { who: ME, text: '(Leverage kept. Nobody\'s coming to help.)' }]; } },
        { text: '"No deal. It\'s my insurance."', effect: () => { G.s.choices.reyes = 'keep'; addThreat(10, 'you turned down the FBI'); return [{ who: R, text: 'Insurance only works if you live long enough to collect. Here\'s my card. Call before the boats come.' }, { who: ME, text: '(You keep every card. Nico will bring everything he has.)' }]; } },
      ] },
  ], () => {
    G.npcs = G.npcs.filter((x) => x !== n);
    st.flags.metReyes = true;
    addXP(30, 'Met Agent Reyes');
    setStep('ch4_fortify');
    checkEstateReady();
  });
}

function readSignet() {
  const f = G.s.story.flags;
  if (f.signetRead) return;
  f.signetRead = true;
  const fed = (G.s.choices || {}).reyes === 'give';
  playCutscene({ focus: { x: G.player.x, y: G.player.y }, zoom: 1.6, title: 'THE RING', sub: 'A gold signet. A V, worn smooth by three generations of thumbs.', hold: 1.8, sting: 'phone', lines: [
    { who: ME, text: 'Leo\'s father\'s ring. Leo gave it to Nico at his confirmation. I was there. I carried the cake.' },
    { who: ME, text: '(The phone in the manor is ringing.)' },
    { who: 'Leo Vescari', text: 'Frankie. You have something of my son\'s.' },
    { who: ME, text: fed ? 'He\'s alive, Leo. The FBI pulled him out of the lake. He\'ll be talking by morning.' : 'He\'s alive, Leo. I put him back in his boat and pushed it toward Burlington.' },
    { who: 'Leo Vescari', text: 'Then you showed my family mercy. I won\'t forget it. And I won\'t forgive it.' },
    { who: 'Leo Vescari', text: 'Short Hills. My house. Come and finish this like family, Frankie — or I come to you, and I don\'t send anyone. I come myself.' },
  ], onEnd: () => {
    addXP(40, 'The ring'); addJP('shadow', 15);
    const s = G.s.story.step;
    if (s === 'ch4_ring' || s === 'ch4_siege') setStep('ch4_eleanor_truth');
  } });
}

/** The deputy's visit: a choice with consequences for the coming attack. */
function deputyTalk(n) {
  const st = G.s.story;
  const canBribe = G.s.money >= 100;
  playDialogue([
    { who: 'Deputy Carl Mott', text: 'Afternoon. Carl Mott, county sheriff\'s department. Just being neighborly.' },
    { who: 'Deputy Carl Mott', text: 'Funny thing. Fella from Chicago called the office asking about a cash buyer up here. Said there might be a reward. You wouldn\'t know anything about that?',
      choices: [
        { text: '"Frank Lowe. Here\'s my license. Anything else, Deputy?"', effect: () => { G.s.choices.deputy = 'cooperate'; addJP('shadow', 10); return [{ who: 'Deputy Carl Mott', text: 'Ohio license. Clean. Well. I suppose I\'ll tell the man there\'s nobody here by that description.' }, { who: ME, text: '(He bought it — mostly. Fewer people will come for you.)' }]; } },
        { text: '"Get off my land."', effect: () => { G.s.choices.deputy = 'refuse'; addThreat(10, 'you made an enemy of the deputy'); return [{ who: 'Deputy Carl Mott', text: 'Suit yourself. Chicago\'ll be happy to hear where you live.' }, { who: ME, text: '(He\'ll sell you out. Expect more guns.)' }]; } },
        ...(canBribe ? [{ text: '"$100 says you never met me."', effect: () => { G.s.choices.deputy = 'bribe'; G.s.money -= 100; addThreat(-10); return [{ who: 'Deputy Carl Mott', text: 'Never met you. And if somebody\'s planning a visit, maybe I\'ll call ahead. Friends do that.' }, { who: ME, text: '(Bought and paid for. He\'ll warn you early — but now you\'re in bed with him.)' }]; } }] : []),
      ] },
  ], () => {
    G.npcs = G.npcs.filter((x) => x !== n);
    st.flags.metDeputy = true;
    toast('Deputy Mott drives off in a truck far too new for a deputy\'s salary.', 'info', 3.5);
    addXP(30, 'Met the deputy');
    setStep('ch3_fortify');
    checkFarmReady();
  });
}

function readLedger() {
  const f = G.s.story.flags;
  if (f.ledgerRead) return;
  f.ledgerRead = true;
  playCutscene({ focus: { x: G.player.x, y: G.player.y }, zoom: 1.7, title: 'THE LEDGER', sub: 'Twenty years of Vescari money, in Vinnie\'s handwriting.', hold: 1.8, sting: null, lines: [
    { who: ME, text: 'A leather ledger. Twenty years of Vescari money: payoffs, shell companies, safe deposit boxes.' },
    { who: ME, text: 'Page forty-one: "C. Mott — $2,000/mo." Page fifty: a judge in Newark. A state senator.' },
    { who: ME, text: 'Leo didn\'t send Vinnie to kill me. He sent him to find out what I took. Now I have it for real.' },
  ], onEnd: () => {
    addXP(40, 'The ledger'); addJP('shadow', 15);
    const s = G.s.story.step;
    if (s === 'ch3_ledger' || s === 'ch3_siege') setStep('ch3_ingrid_truth');
  } });
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
        { text: '"Never heard of him."', effect: () => { G.s.choices.stranger = 'deny'; addJP('shadow', 15); return [{ who: 'Man in a Grey Coat', text: 'Huh. Well. If you do, tell him the family misses him.' }, { who: ME, text: '(You kept your voice flat. He didn\'t get anything he could use.)' }]; } },
        { text: '"Who\'s asking?"', effect: () => { G.s.choices.stranger = 'ask'; addThreat(8, 'the stranger heard your accent'); addJP('shadow', 5); return [{ who: 'Man in a Grey Coat', text: 'A friend. That accent of yours — Newark? Small world.' }]; } },
        { text: '"Get out of my town."', effect: () => { G.s.choices.stranger = 'threaten'; addThreat(14, 'you threatened the stranger'); addJP('gunhand', 6); return [{ who: 'Man in a Grey Coat', text: '"Your" town. Okay, friend. Okay.' }, { who: ME, text: '(That was a mistake. Now he knows exactly who you are.)' }]; } },
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
      ], () => { addItem('board_kit', 2); addRel('dee', 6); addXP(30, 'Faced the stranger'); scheduleProbe(); setStep('probe'); });
    }
  });
}

/** Called when the player first enters the cabin, and other location triggers. */
export function updateStory(dt) {
  const st = G.s.story;
  if (st.step === 'rest' && G.s.time.day >= (st.flags.trailDay || 0) && G.s.time.minute >= 6 * 60 && !G.sleeping && !G.modal) {
    startErrand('trail', true);
    setStep('trail');
    playDialogue([
      { who: 'Ruth Calloway', text: '(Ruth is on your porch at dawn, coffee in hand.) Frank. Somebody\'s been standing outside your west window at night. I saw a cigarette glowing at two in the morning.' },
      { who: 'Ruth Calloway', text: 'Boot prints in the grass. Go look before the dew burns off.' },
    ]);
  }
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
  if (st.step === 'ch3_arrive' && G.map.id === 'farm') {
    const b = G.map.buildingAt(G.player.x, G.player.y);
    if (b && b.id === 'farmhouse') {
      st.step = 'ch3_meet_ingrid';
      const ruth = G.s.companion && G.s.companion.ruth.joined;
      playDialogue([
        { who: ME, text: 'Kettle Crossing, Wisconsin. Two hundred acres, a red barn, a silo, and a gate somebody already kicked in.' },
        ...(ruth ? [{ who: 'Ruth Calloway', text: 'Well, it\'s no Pine Hollow. But the soil\'s good. I\'ll have a garden in by Sunday.' }] : []),
        { who: ME, text: 'There\'s a dairy across the pasture. Neighbors first. Always neighbors first.' },
      ], () => setStep('ch3_meet_ingrid'));
    }
  }
  if (st.step === 'ch4_arrive' && G.map.id === 'estate') {
    const b = G.map.buildingAt(G.player.x, G.player.y);
    if (b && b.id === 'manor') {
      st.step = 'ch4_meet_eleanor';
      const ruth = G.s.companion && G.s.companion.ruth.joined;
      const dog = G.s.companion && G.s.companion.dog && G.s.companion.dog.owned;
      playDialogue([
        { who: ME, text: 'Whitcombe Manor. Forty rooms, a stone wall, an iron gate, and a lake that goes all the way to Canada.' },
        ...(ruth ? [{ who: 'Ruth Calloway', text: 'Frank. There are eleven bathrooms. Eleven. Harold and I raised two boys with one.' }] : []),
        ...(dog ? [{ who: ME, text: '(Duke has already found the kitchen.)' }] : []),
        { who: ME, text: 'The owner lives in the gatehouse by the road. Neighbors first. Even when the neighbor owns the house.' },
      ], () => setStep('ch4_meet_eleanor'));
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
    const ph = G.map.props.find((p) => p.id === 'phone') || G.player;
    playCutscene({ focus: { x: ph.x, y: ph.y }, zoom: 1.6, title: 'PINE HOLLOW · 11:48 PM', sub: 'The phone has been ringing for a while.', hold: 1.4, sting: 'phone', lines: [
      { who: ME, text: 'Hello?' },
      { who: 'Voice', text: '...Frankie. You sound good. Country air agrees with you.' },
      { who: ME, text: 'Leo.' },
      { who: 'Leo Vescari', text: 'You know, my nephew wanted to burn the place with you in it. I said no. I said, Frankie was family. Frankie deserves a conversation.' },
      { who: 'Leo Vescari', text: 'You took something from me when you walked away. Not money. Respect. People saw you leave and nobody stopped you.' },
      { who: ME, text: 'I\'m out, Leo. I just want to be left alone.' },
      { who: 'Leo Vescari', text: 'That\'s the thing, Frankie. Nobody gets to be alone. Not from family.' },
      { who: 'Leo Vescari', text: 'Next time I won\'t send boys.' },
      { who: ME, text: '(Click. Dial tone.)' },
    ], onEnd: () => {
      st.chapterComplete = true;
      st.done[1] = true;
      st.step = 'leave_town';
      G.s.world.threat = Math.max(G.s.world.threat, 45);
      G.s.world.quietUntilDay = G.s.time.day + 2;
      addXP(80, 'Chapter 1 complete');
      saveGame('chapter');
      showChapterEnd(1);
    } });
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
