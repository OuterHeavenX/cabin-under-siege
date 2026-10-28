// The Paper Trail: how does the family keep finding Frank? Pieces turn up in
// every chapter — on attackers, in old ledgers, from people who know how
// money moves. Any five are enough to try putting it together; there are
// more than twice that many, so no single clue can be missed for good.
export const TRAIL = {
  t1_ventura: { ch: 1, title: 'A matchbook from Club Ventura', text: 'Behind the Pine Hollow payphone: a Club Ventura matchbook. Leo\'s brother-in-law, Carmine Ventura, owns it.' },
  t1_closing: { ch: 1, title: 'A torn envelope by the road', text: 'Where the probe crew parked: a torn envelope, "KEYSTONE TITLE & ESCROW — NEWARK". Inside, a photocopy of the cabin\'s cash closing.' },
  t1_realtor: { ch: 1, title: 'The realtor\'s phone call', text: 'Dee heard it from the realtor: a "title clerk from New Jersey" phoned to confirm the name on the cabin\'s cash sale. Weeks before the grey coat.' },
  t2_parcel: { ch: 2, title: 'The meter man\'s clipboard', text: 'The fake meter reader dropped a county parcel printout: "14-221 LARCH ST — CASH SALE — LOWE, F." Someone pulled your deed.' },
  t2_marcus: { ch: 2, title: 'Marcus\'s rule', text: 'Marcus: "WITSEC rule one — never buy with cash. Cash closings get flagged. By banks, by the IRS, and by anybody who owns a title company."' },
  t3_recorder: { ch: 3, title: 'Surveyor\'s stakes', text: 'Stakes across your west field, tagged "PARCEL 7-118 CASH SALE — copy requested, Cook County." Chicago asked the recorder for your farm\'s paperwork.' },
  t3_ledger: { ch: 3, title: 'Vinnie\'s ledger, page 63', text: 'Vinnie\'s ledger: "Keystone T&E (C.V.) — 4% of every closing, plus the list." A title company, paying Leo. And a list of what?' },
  t4_edward: { ch: 4, title: 'Edward Whitcombe\'s ledger', text: 'Edward\'s ledger: Keystone Title has washed Vescari money since 1988 — and "C.V. reads every cash closing on the East Coast for Leo. Insurance, he calls it."' },
  t4_reyes: { ch: 4, title: 'Agent Reyes on title companies', text: 'Reyes: every cash closing in the country runs through a handful of title underwriters. "One of them, Keystone, has a Vescari in-law on the board."' },
  t4_benny: { ch: 4, title: 'Benny Lucchese sings', text: 'Through Reyes: Benny drove Sal Benedetto to a title office on Broad Street every month for ten years. Keystone Title & Escrow.' },
  t4_fax: { ch: 4, title: 'A fax in a waterproof pouch', text: 'From Nico\'s probe crew: a fax — "WHITCOMBE — CARETAKER, NO CLOSING ON FILE. USE THE SHORE." Header strip: KEYSTONE T&E, ALBANY. They lost the paper trail and needed Mott.' },
  t5_joey: { ch: 5, title: 'Joey Marchetti\'s notebook', text: 'Joey\'s notebook, 1999: "Leo\'s brother-in-law Carmine V. — Keystone office, Broad St. Every rat who runs, buys a house. Every house goes through Carmine."' },
  t5_list: { ch: 5, title: 'Carlo\'s list', text: 'Carlo\'s man dropped a typed list: "FRANKIE — Pine Hollow MN (cash) · Millbrook OH (cash) · Kettle X WI (cash) — via C.V." Every home you paid cash for.' },
};

export const TRAIL_NEED = 5;

/** What Frank could conclude. Only one is right; the others cost something. */
export const THEORIES = [
  { id: 'title', text: '"They follow the money. Every cash closing goes through Carmine Ventura\'s title company — and he reads them for Leo."', right: true },
  { id: 'letters', text: '"Somebody is reading the letters my friends send me."' },
  { id: 'marcus', text: '"Marcus. He knew every move I made. He builds new lives for a living."', who: 'marcus' },
  { id: 'ruth', text: '"Ruth. She talks to everybody. She must have let something slip."', who: 'ruth' },
];

export const WRONG_LINES = {
  letters: [
    { who: 'Frank', text: 'The letters... no. They found Pine Hollow before anyone wrote me a word. It isn\'t the mail.' },
    { who: 'Frank', text: '(You stopped trusting the mail for a week for nothing. Find another piece before you try again.)' },
  ],
  marcus: [
    { who: 'Frank', text: '(You call Marcus. You ask. The silence on the line goes on for a long time.)' },
    { who: 'Marcus Bell', text: 'I hid a hundred people from men like Leo and never lost one, Frank. Think harder. And don\'t call me again until you have.' },
  ],
  ruth: [
    { who: 'Ruth Calloway', text: '(She puts down her coffee cup very carefully.) I\'ve kept other people\'s secrets since 1968, Frank. I\'ll forgive you for that one. Not today.' },
  ],
};

export const SOLVED_LINES = (s) => [
  { who: 'Frank', text: 'Pine Hollow. Millbrook. The farm. Every place I bought with cash, because cash leaves no trail. Except it does.' },
  { who: 'Frank', text: 'Every cash closing gets a title search. Every title search on the East Coast crosses Carmine Ventura\'s desk at Keystone. He\'s been reading my mail the whole time — just not the letters.' },
  { who: 'Frank', text: s.chapter >= 5 ? 'Leo never had to hunt me. He just waited for me to buy a house.' : 'The estate wasn\'t a purchase. They lost me — until Mott sold my address. That\'s why it took them longer.' },
];
