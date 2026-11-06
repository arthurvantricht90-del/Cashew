// Categorization engine + period maths. Pure functions, usable in node tests.

export const r2 = v => Math.round(v * 100) / 100;

export function matchText(t) {
  return (t.type + ' | ' + t.details.join(' | ') + ' | ' + (t.counterIban || '')).toUpperCase();
}

// Returns { cat, split, ruleId } or null
export function categorize(t, rules, accounts) {
  if (t.counterIban) {
    const acc = accounts.find(a => a.iban === t.counterIban);
    if (acc) {
      const cat = { own: 'internal', savings: 'savings', investment: 'invest' }[acc.role];
      if (cat) return { cat, split: null, ruleId: 'acct:' + acc.iban };
    }
  }
  const text = matchText(t);
  for (const r of rules) {
    if (!r.pattern || !text.includes(r.pattern.toUpperCase())) continue;
    if (r.amount != null && r2(r.amount) !== r2(t.amount)) continue;
    return { cat: r.cat, split: r.split && r.split.length ? r.split : null, ruleId: r.id };
  }
  return null;
}

// Apply rules to a tx unless it was set manually. Returns true if changed.
export function applyRules(t, rules, accounts) {
  if (t.source === 'manual') return false;
  const res = categorize(t, rules, accounts);
  const before = JSON.stringify([t.cat, t.split, t.ruleId]);
  if (res) { t.cat = res.cat; t.split = res.split; t.ruleId = res.ruleId; t.source = 'rule'; }
  else { t.cat = null; t.split = null; t.ruleId = null; t.source = null; }
  return before !== JSON.stringify([t.cat, t.split, t.ruleId]);
}

// Allocation of a tx's amount over categories
export function parts(t) {
  if (!t.cat) return [{ cat: null, amount: t.amount }];
  if (!t.split) return [{ cat: t.cat, amount: t.amount }];
  const fixed = t.split.reduce((a, p) => a + p.amount, 0);
  return t.split.map(p => ({ cat: p.cat, amount: p.amount })).concat([{ cat: t.cat, amount: r2(t.amount - fixed) }]);
}

// ---------- Periods ----------
const DAY = 86400000;
export const iso = d => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayNum = d => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);

// Returns {start, end} ISO strings (inclusive) for the period containing `date`
export function periodOf(type, dateStr, anchorStr) {
  const d = parseISO(dateStr);
  if (type === 'month') {
    const s = new Date(d.getFullYear(), d.getMonth(), 1), e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: iso(s), end: iso(e) };
  }
  if (type === 'week') {
    const s = addDays(d, -((d.getDay() + 6) % 7));
    return { start: iso(s), end: iso(addDays(s, 6)) };
  }
  const a = parseISO(anchorStr);
  const k = Math.floor((dayNum(d) - dayNum(a)) / 14);
  const s = addDays(a, k * 14);
  return { start: iso(s), end: iso(addDays(s, 13)) };
}

export function shiftPeriod(type, p, dir, anchorStr) {
  if (type === 'month') {
    const s = parseISO(p.start);
    return periodOf('month', iso(new Date(s.getFullYear(), s.getMonth() + dir, 1)), anchorStr);
  }
  const s = parseISO(p.start);
  return periodOf(type, iso(addDays(s, dir * (type === 'week' ? 7 : 14))), anchorStr);
}

// Sum per category for transactions within [start,end]
export function totals(txs, start, end) {
  const by = {};
  for (const t of txs) {
    if (t.date < start || t.date > end) continue;
    for (const p of parts(t)) by[p.cat ?? '_none'] = r2((by[p.cat ?? '_none'] || 0) + p.amount);
  }
  return by;
}

// Headline numbers. Categories map id -> category
export function headline(by, cats) {
  let spent = 0, income = 0, saved = 0;
  for (const [id, v] of Object.entries(by)) {
    const k = id === '_none' ? (v < 0 ? 'expense' : 'income') : (cats[id]?.kind || 'expense');
    if (k === 'expense') spent -= v;
    else if (k === 'income') income += v;
    else if (k === 'savings' || k === 'investment') saved -= v;
  }
  return { spent: r2(spent), income: r2(income), saved: r2(saved) };
}
