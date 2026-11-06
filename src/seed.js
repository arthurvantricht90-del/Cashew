// Starting data: categories, accounts and the rules agreed with Arthur (Nov 2026).
export const CATEGORIES = [
  ['rent', 'Rent', 'Huur'],
  ['utilities', 'Utilities', 'Nutsvoorzieningen'],
  ['mobile', 'Mobile subscription', 'Gsm-abonnement'],
  ['internet', 'Internet', 'Internet'],
  ['subs', 'Other subscriptions', 'Andere abonnementen'],
  ['insurance', 'Insurance', 'Verzekeringen'],
  ['food', 'Food', 'Eten'],
  ['sports', 'Sports', 'Sport'],
  ['guitar', 'Hobbies – guitar', 'Hobby’s – gitaar'],
  ['hobby', 'Hobbies – other', 'Hobby’s – andere'],
  ['transport', 'Transport', 'Vervoer'],
  ['leisure', 'Going out & leisure', 'Uitgaan & vrije tijd'],
  ['home', 'Home & household', 'Huis & huishouden'],
  ['gifts', 'Gifts & donations', 'Giften & donaties'],
  ['fees', 'Bank fees', 'Bankkosten'],
  ['cash', 'Cash withdrawals', 'Geldopnames'],
  ['flukes', 'Flukes', 'Onvoorzien'],
].map(([id, en, nl]) => ({ id, en, nl, kind: 'expense' })).concat([
  { id: 'income', en: 'Income', nl: 'Inkomsten', kind: 'income' },
  { id: 'savings', en: 'Savings', nl: 'Sparen', kind: 'savings' },
  { id: 'invest', en: 'Investments', nl: 'Beleggingen', kind: 'investment' },
  { id: 'internal', en: 'Internal transfer', nl: 'Interne overboeking', kind: 'internal' },
]);

export const ACCOUNTS = [
  { iban: 'BE09731048168757', name: 'Main account', role: 'own' },
  { iban: 'BE17735076769121', name: 'Second account', role: 'own' },
  { iban: 'BE72409658733916', name: 'Savings account', role: 'savings' },
  { iban: 'BE77409654740142', name: 'Bolero', role: 'investment' },
];

const R = [];
const add = (cat, ...patterns) => patterns.forEach(p => R.push({ pattern: p, cat }));
// Amount-specific and split rules first (first match wins)
R.push({ pattern: 'BE42739025021654', amount: -550, cat: 'rent' });
R.push({ pattern: 'BE42739025021654', amount: -95.25, cat: 'utilities' });
R.push({ pattern: 'BE42739025021654', cat: 'utilities' });
R.push({ pattern: 'WATER + INTERNET', split: [{ cat: 'internet', amount: -30 }], cat: 'utilities' });
add('flukes', 'ELISE KLÜNDER');
add('rent', 'HEYLEN VASTGOED');
add('utilities', 'ENGIE', 'IGEAN');
add('mobile', 'ORANGE NV', 'PREPAID LADING');
add('subs', 'GOOGLE*');
add('insurance', 'DAS RECHTSBIJSTAND');
add('sports', 'KLIM EN BOULDERZAAL', 'BUCKAROO');
add('hobby', 'TRX BE2140', 'TRX VZW', 'GO! CVO');
add('gifts', 'OXFAM');
add('fees', 'KBC-PLUSREKENING');
add('cash', 'GELDOPNEMING', 'STORTING AUTOMAAT');
add('transport', 'NMBS', 'DELIJN', 'DE LIJN', 'POPPY MOBILITY', 'ESSO ', 'FIETSEN DE GEUS', 'MPA BE2000');
add('home', 'IKEA', 'DILLE EN KAMILLE', 'BRICO', 'KOOKHUIS', 'DRAAIBOOM', 'MEDIA MARKT', 'IBOOD', 'AMAZON', 'KRUIDVAT', 'NET BVBA BE2930');
add('leisure', 'PEACE VILLAGE', 'DRANOUTER', 'WE CAN DANCE', 'CAMPING', 'KAMPEERDER', 'KINEPOLIS', 'HUYSMANS NICOLAS',
  'BERNARD CORLUY', 'BAR NEST', 'CLUB COPAINS', 'KIOSK RADIO', 'WALVIS', 'LE PALACE', 'AU SOLEIL', 'KO ZOUTE', 'VALINSOPAY');
add('food', 'T GROEN STAMKE', 'HAKAN BV', 'MIM VOEDING', 'DELHAIZE', 'LIDL', 'SPAR ', 'CRF EXP', 'CARREFOUR', 'COLRUYT', 'ALDI',
  'ALBERT HEIJN', 'DAILY CORNER', 'TAKEAWAY.COM', 'NEW SHANGAI', 'KORNEL', 'M-PRESS', 'SPECIALE BELGE', 'DE KOERANT',
  'VDV 112', 'SIDIQULLAH', 'DBH SARIM', 'LA FERME DU HAMEAU', 'OST IVY');
add('flukes', 'PAYPAL', 'ILOSTNL', 'MARKTPLAATS', 'BE85735011777606', 'FEREMANS', 'VAN GOOL SEP', 'DANI OOSTDIJK',
  'KONINGSVELD HELENE', 'BAS PHILIPSEN', 'HUYBERECHTS', 'JANSSENS-VAN BAELEN', 'CAIN EDWARD', 'SAAR MEEUSEN', 'LENAERTS JOSQUIN');
add('income', 'INSKY', 'BE84001648976859');

export const RULES = R.map((r, i) => ({ id: 'seed' + i, ...r }));
