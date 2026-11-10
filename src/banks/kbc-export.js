// KBC "Export KBC Touch" reader: the transaction export from the KBC app / KBC Touch
// (different layout from the official statement). Newest first; each transaction is
//   dd-mm-yyyy   DESCRIPTION   -12,34 EUR
// followed by label/value lines (Rekeningnummer, Mededeling, Datum, …) and a last line with the kind
// of transaction (Instantoverschrijving, Betaling met Google Pay, Domiciliëring, …).
import { pagesToLines, toNumber } from './kbc.js';

const START = /^(\d{2})-(\d{2})-(\d{4})\s{2,}(.*?)\s{2,}(-?[\d.]+,\d{2})(?:\s*EUR)?$/;
const SALDO = /Saldo op (\d{2})-(\d{2})-(\d{4}) om [\d:]+\s+(-?[\d.]+,\d{2})/;
const FOOTER = /^(KBC Bank NV|BTW BE|Een onderneming van de KBC|\d{4}-\d{2}-\d{2}-\d{2}\.\d{2}\.\d{2}-)/;

export function detect(firstPageText) {
  return /Export KBC Touch/.test(firstPageText) || (/KBC-Rekening/.test(firstPageText) && /Datum van \d{2}-\d{2}-\d{4} tot en met/.test(firstPageText));
}

function typeFrom(last, amount) {
  const l = (last || '').toLowerCase();
  if (l.includes('overschrijving')) return last.toUpperCase() + (amount < 0 ? ' NAAR' : ' VAN');
  if (l.includes('domicili')) return 'EUROPESE DOMICILIERING';
  if (l.includes('betalingsopdracht')) return 'DOORLOPENDE BETALINGSOPDRACHT';
  if (l.startsWith('betaling')) return last.toUpperCase();
  return last ? last.toUpperCase() : 'VERRICHTING';
}

export function parse(pages) {
  const lines = pagesToLines(pages).filter(l => l !== '\u0000PAGE');
  const res = { iban: null, from: null, to: null, opening: null, closing: null, transactions: [] };
  const saldos = []; let cur = null;
  const finish = () => {
    if (!cur) return;
    // The kind of transaction is normally the last line; fall back to any line that names one
    const kinds = /overschrijving|betaling met|domicili|betalingsopdracht|geldopneming|storting/i;
    const last = [...cur.details].reverse().find((x, k) => k === 0 ? kinds.test(x) : kinds.test(x) && x.length < 40) || '';
    cur.type = typeFrom(last, cur.amount);
    cur = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s{2,}/g, '  ').trim();
    if (!res.iban) { const m = line.match(/^(BE\d{2}(?: \d{4}){3})(?:\s+EUR)?$/); if (m) { res.iban = m[1]; continue; } }
    if (!res.from) {
      const m = line.match(/Datum van (\d{2})-(\d{2})-(\d{4}) tot en met (\d{2})-(\d{2})-(\d{4})/);
      if (m) { res.from = `${m[3]}-${m[2]}-${m[1]}`; res.to = `${m[6]}-${m[5]}-${m[4]}`; continue; }
    }
    const sm = line.match(SALDO);
    if (sm) { finish(); saldos.push(toNumber(sm[4].replace('-', ''), sm[4].startsWith('-') ? '-' : '+')); continue; }
    if (FOOTER.test(line) || line === 'EUR') continue;
    const m = line.match(START);
    if (m) {
      finish();
      const [, d, mo, y, desc, amt] = m;
      cur = { date: `${y}-${mo}-${d}`, valuta: `${d}-${mo}`, type: '', amount: toNumber(amt.replace('-', ''), amt.startsWith('-') ? '-' : '+'), details: [desc.replace(/\s{2,}/g, ' ').trim()] };
      res.transactions.push(cur);
      continue;
    }
    if (cur) cur.details.push(line.replace(/\s{2,}/g, ' '));
  }
  finish();
  // Saldo lines: the first one (top) is the closing balance, the last one (bottom) the opening balance
  if (saldos.length >= 2) { res.closing = saldos[0]; res.opening = saldos[saldos.length - 1]; }
  // Oldest first, like a statement
  res.transactions.reverse();
  // The export can contain transactions dated just before its period (card payments booked a day later)
  for (const t of res.transactions) { if (!res.from || t.date < res.from) res.from = t.date; if (!res.to || t.date > res.to) res.to = t.date; }
  return res;
}

const LABELS = /^(Rekeningnummer|BIC:|Mededeling|Tijdstip|Met|Datum|Debetkaart|Kaarthouder|Virtueel kaartnummer|Referte schuldeiser|Mandaatreferte|via |KBC Mobile|\d{4} \d{2}XX|\d{2}\.\d{2} uur|\d{2}-\d{2}-\d{4} om )/i;

export function enrich(t) {
  const desc = t.details[0] || '';
  const i = t.details.findIndex(x => x === 'Rekeningnummer');
  const iban = i >= 0 ? (t.details[i + 1] || '').replace(/\s/g, '') : null;
  const isTransfer = /OVERSCHRIJVING|BETALINGSOPDRACHT/.test(t.type);
  const useful = t.details.slice(1, -1).filter((x, k, arr) => !LABELS.test(x) && x !== 'VAN TRICHT ARTHUR' && !(arr[k - 1] && /^(Referte schuldeiser|Mandaatreferte)$/.test(arr[k - 1])));
  return {
    counterIban: iban && /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban) ? iban : null,
    counterName: isTransfer ? desc : null,
    merchant: desc || t.type,
    description: [desc, ...useful].join(' · '),
  };
}

export default { id: 'kbc-export', name: 'KBC (app export)', detect, parse, enrich };
