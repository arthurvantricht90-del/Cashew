// KBC / CBC statement reader. Input: array of pages, each an array of pdf.js text items.
// Output: { iban, from, to, opening, closing, transactions: [...] }

const START = /^(\d{3}) (\d{2})-(\d{2})-(\d{4})\s{2,}(.*?)\s{2,}(\d{2}-\d{2})\s{2,}([\d ]+,\d{2}) ([+-])$/;
const SKIP = /^(KBC-Rekening|van \d{2}-\d{2}-\d{4} tot|nr\.\s+datum|KBC Bank NV|Een onderneming|\d{4}-\d{2}-\d{2}-\d{2}\.\d{2}|IBAN |BIC )/;
const SALDO = /Saldo op (\d{2})-(\d{2})-(\d{4}) om [\d:]+\s+([\d .]+,\d{2}) ([+-])/;

export function toNumber(s, sign) {
  const v = parseFloat(s.replace(/[ .]/g, '').replace(',', '.'));
  return Math.round((sign === '-' ? -v : v) * 100) / 100;
}

// Group text items into lines (same y), sorted by x, joined with double spaces.
export function pagesToLines(pages) {
  const out = [];
  for (const items of pages) {
    out.push('\u0000PAGE');
    const rows = [];
    for (const it of items) {
      const s = (it.str || '').trim();
      if (!s) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 2);
      if (!row) { row = { y, parts: [] }; rows.push(row); }
      row.parts.push({ x, s });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      out.push(r.parts.map(p => p.s).join('  '));
    }
  }
  return out;
}

export function parseKBC(pages) {
  const lines = pagesToLines(pages);
  const res = { iban: null, from: null, to: null, opening: null, closing: null, holder: null, transactions: [] };
  let cur = null;
  const saldos = [];
  let inHeader = false;
  for (const line of lines) {
    if (line === '\u0000PAGE') { inHeader = true; continue; }
    if (inHeader) {
      if (/^nr\.\s+datum/.test(line)) inHeader = false;
      else if (!/IBAN |van \d{2}-/.test(line)) continue;
    }
    if (!res.iban) {
      const m = line.match(/IBAN (BE\d{2}(?: \d{4}){3})/);
      if (m) res.iban = m[1];
    }
    if (!res.from) {
      const m = line.match(/van (\d{2})-(\d{2})-(\d{4}) tot (\d{2})-(\d{2})-(\d{4})/);
      if (m) { res.from = `${m[3]}-${m[2]}-${m[1]}`; res.to = `${m[6]}-${m[5]}-${m[4]}`; }
    }
    const sm = line.match(SALDO);
    if (sm) { saldos.push(toNumber(sm[4], sm[5])); cur = null; continue; }
    const m = line.match(START);
    if (m) {
      const [, nr, d, mo, y, type, valuta, amt, sign] = m;
      cur = { nr, date: `${y}-${mo}-${d}`, valuta, type: type.trim(), amount: toNumber(amt, sign), details: [] };
      res.transactions.push(cur);
      continue;
    }
    if (SKIP.test(line) || !cur) continue;
    cur.details.push(line.replace(/\s{2,}/g, ' '));
  }
  if (saldos.length) { res.opening = saldos[0]; res.closing = saldos[saldos.length - 1]; }
  return res;
}

// --- Helpers to derive useful fields from a transaction ---
const NOISE = /^(\d{2}-\d{2}-\d{4} OM|MET KBC|MET GOOGLE|MET WERO|VIRTUEEL|CONTACTLOZE|\d{4} \d{2}XX|KAARTHOUDER|BANKIER|OM \d{2}\.\d{2} UUR|REF\. SCHULD|MANDAATREF|REFERENTIE|INFO VAN DE HANDELAAR)/;
const IBAN_RE = /^([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?)(?: IN EUR)?$/;

export function enrich(t) {
  const useful = t.details.filter(x => !NOISE.test(x));
  let iban = null, name = null, merchant = null;
  const first = t.details[0] || '';
  if (/OVERSCHRIJVING|VEREFFENING/.test(t.type)) {
    const im = first.match(IBAN_RE);
    if (im) iban = im[1].replace(/ IN EUR$/, '');
    const nameLine = t.details.find((x, i) => i > 0 && !NOISE.test(x) && !/^\*{3}|^\d+$/.test(x));
    name = nameLine || null;
    merchant = name || iban;
  } else if (/DOMICILIERING/.test(t.type)) {
    const s = t.details.find(x => x.startsWith('SCHULDEISER :'));
    merchant = s ? s.replace('SCHULDEISER : ', '').split(' - ')[0].trim() : useful[0];
  } else if (/BETALING VIA|GELDOPNEMING/.test(t.type)) {
    merchant = useful[0] || null;
  } else {
    merchant = useful[0] || t.type;
  }
  return {
    counterIban: iban ? iban.replace(/ /g, '') : null,
    counterName: name,
    merchant: merchant || t.type,
    description: useful.join(' · '),
  };
}

// Is this a KBC statement? Checked on the text of the first page.
export function detect(firstPageText) {
  return /KBC Bank NV|KBC-Rekening|KBC-Plusrekening|CBC Banque/i.test(firstPageText) && /BIC KREDBEBB|BIC CREGBEBB/.test(firstPageText);
}

export default { id: 'kbc', name: 'KBC / CBC', detect, parse: parseKBC, enrich };
