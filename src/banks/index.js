// Bank readers. To support a new bank, add a module with the same shape as kbc.js:
//   { id, name, detect(firstPageText) -> bool, parse(pages) -> statement, enrich(tx) -> extra fields }
// A statement is { iban, from, to, opening, closing, transactions: [{ date, valuta, type, details[], amount }] }.
import kbc from './kbc.js';

export const BANKS = [kbc];

export const pageText = items => items.map(i => i.str).join(' ');

export function detectBank(pages) {
  const first = pages.length ? pageText(pages[0]) : '';
  return BANKS.find(b => b.detect(first)) || null;
}
