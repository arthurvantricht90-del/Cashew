import { Chart, registerables } from 'chart.js';
import { STR } from './i18n.js';
import { db } from './db.js';
import { CATEGORIES, ACCOUNTS, RULES } from './seed.js';
import { BANKS, detectBank } from './banks/index.js';
import { applyRules, parts, periodOf, shiftPeriod, totals, headline, iso, parseISO, r2 } from './engine.js';
import { readPdfPages } from './pdf.js';
import { saveFile, openPdf, onBack } from './native.js';

Chart.register(...registerables);

// ---------------- State ----------------
const S = {
  settings: { lang: 'en', theme: 'system', anchor: '2026-01-05', ptype: 'month', view: 'numbers', showSavings: false, acct: '',
    evo: { step: 'month', range: 'r6m', cats: [] } },
  cats: [], accounts: [], rules: [], txs: [], pdfs: [],
};
const UI = { tab: 'overview', period: null, filter: { q: '', acct: '', cat: '', start: '', end: '' }, charts: [] };

const T = k => STR[S.settings.lang][k] ?? STR.en[k] ?? k;
const LOC = () => (S.settings.lang === 'nl' ? 'nl-BE' : 'en-GB');
const fmt = (v, sign = false) => {
  const s = new Intl.NumberFormat(LOC(), { style: 'currency', currency: 'EUR' }).format(Math.abs(v));
  return sign ? (v < 0 ? '−' : '+') + s : (v < 0 ? '−' + s : s);
};
const fmtDate = (s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => parseISO(s).toLocaleDateString(LOC(), opts);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catMap = () => Object.fromEntries(S.cats.map(c => [c.id, c]));
const catName = id => { if (!id || id === '_none') return T('uncategorized'); const c = S.cats.find(c => c.id === id); return c ? (c[S.settings.lang] || c.en) : id; };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const title = s => String(s || '').toLowerCase().replace(/(^|[\s\-/(.'’&*])([\p{L}])/gu, (m, a, b) => a + b.toUpperCase());
const fmtIban = s => (s || '').replace(/(.{4})/g, '$1 ').trim();
const shortMerchant = m => { const s = String(m || '').replace(/\s+[A-Z]{2}[- ]?\d{4}\b.*$/, '').trim(); return /^[\d\W]*$/.test(s) ? m : s; };
const accName = iban => S.accounts.find(a => a.iban === iban)?.name || fmtIban(iban);

function hash(str) { // cyrb53
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// ---------------- Persistence ----------------
async function load() {
  const [settings, cats, accounts, rules, txs, pdfs] = await Promise.all([
    db.get('settings'), db.get('cats'), db.get('accounts'), db.get('rules'), db.allTx(), db.allPdfMeta()]);
  if (settings) S.settings = { ...S.settings, ...settings, evo: { ...S.settings.evo, ...(settings.evo || {}) } };
  else S.settings.lang = (navigator.language || '').startsWith('nl') ? 'nl' : 'en';
  S.cats = cats || structuredClone(CATEGORIES);
  S.accounts = accounts || structuredClone(ACCOUNTS);
  S.rules = rules || structuredClone(RULES);
  S.txs = txs; S.pdfs = pdfs;
  if (!cats) await saveMeta();
}
const saveSettings = () => db.set('settings', S.settings);
const saveMeta = () => Promise.all([db.set('cats', S.cats), db.set('accounts', S.accounts), db.set('rules', S.rules), saveSettings()]);
async function reapplyAll() {
  const changed = S.txs.filter(t => applyRules(t, S.rules, S.accounts));
  if (changed.length) await db.putTx(changed);
  return changed.length;
}

// ---------------- Theme ----------------
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const th = S.settings.theme === 'system' ? (mq.matches ? 'dark' : 'light') : S.settings.theme;
  document.documentElement.dataset.theme = th;
  document.documentElement.lang = S.settings.lang;
}
mq.addEventListener?.('change', () => { applyTheme(); render(); });
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const SERIES = () => [1, 2, 3, 4, 5, 6, 7, 8].map(i => cssVar('--s' + i));

// ---------------- Icons ----------------
const I = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/></svg>',
  evolution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/></svg>',
  transactions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

// ---------------- Helpers ----------------
const ownAccts = () => [...new Set(S.txs.map(t => t.acct))];
const viewTxs = () => (S.settings.acct && ownAccts().includes(S.settings.acct)) ? S.txs.filter(t => t.acct === S.settings.acct) : S.txs;
function acctSwitch() {
  const accts = ownAccts(); if (accts.length < 2) return '';
  const cur = accts.includes(S.settings.acct) ? S.settings.acct : '';
  return `<div class="seg acct-seg" id="acct-seg" style="margin-bottom:10px">${[['', T('allAccts')], ...accts.map(a => [a, accName(a)])]
    .map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
function bindAcctSwitch() {
  const el = document.getElementById('acct-seg'); if (!el) return;
  el.onclick = e => { const b = e.target.closest('button'); if (!b) return; S.settings.acct = b.dataset.v; saveSettings(); render(); };
}
function confirmSheet(msg, okLabel) {
  return new Promise(res => sheet(`<p style="margin:4px 0 0">${esc(msg)}</p>
    <div class="actions"><button class="btn" id="c-no">${esc(T('cancel'))}</button><button class="btn primary" id="c-yes" style="background:var(--bad);border-color:var(--bad)">${esc(okLabel)}</button></div>`,
    (el, close) => { el.querySelector('#c-no').onclick = () => { close(); res(false); }; el.querySelector('#c-yes').onclick = () => { close(); res(true); }; }));
}
const reviewCount = () => S.txs.filter(t => !t.cat).length;
function latestDate() { let m = ''; for (const t of S.txs) if (t.date > m) m = t.date; return m || iso(new Date()); }
function earliestDate() { let m = '9999'; for (const t of S.txs) if (t.date < m) m = t.date; return m === '9999' ? iso(new Date()) : m; }
function periodLabel(p, type) {
  if (type === 'month') return parseISO(p.start).toLocaleDateString(LOC(), { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase());
  const s = parseISO(p.start), e = parseISO(p.end);
  const sameYear = s.getFullYear() === e.getFullYear();
  const a = s.toLocaleDateString(LOC(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  const b = e.toLocaleDateString(LOC(), { day: 'numeric', month: 'short', year: 'numeric' });
  return `${a} – ${b}`;
}
function toast(msg) {
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg;
  document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
}
const KIND_ORDER = ['expense', 'income', 'savings', 'investment', 'internal'];
// Category lists: grouped by type, A–Z by name in the current language
const sortCats = list => [...list].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
  || catName(a.id).localeCompare(catName(b.id), LOC(), { sensitivity: 'base' }));
function catOptions(sel, { includeInternal = true, placeholder = null, allowNew = !!placeholder } = {}) {
  const groups = [['expense', T('kindExpense')], ['income', T('kindIncome')], ['savings', T('kindSavings')], ['investment', T('kindInvest')], ['internal', '—']];
  let h = placeholder ? `<option value="">${esc(placeholder)}</option>` : '';
  for (const [k, label] of groups) {
    if (k === 'internal' && !includeInternal) continue;
    const cs = sortCats(S.cats.filter(c => c.kind === k));
    if (!cs.length) continue;
    h += `<optgroup label="${esc(label)}">` + cs.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(catName(c.id))}</option>`).join('') + '</optgroup>';
  }
  if (allowNew) h += `<option value="__new">${esc(T('newCatOption'))}</option>`;
  return h;
}

// "＋ New category…" in any category picker: capture the change before the picker's own handler sees it
document.addEventListener('focusin', e => { if (e.target.tagName === 'SELECT') e.target.dataset.prev = e.target.value; });
document.addEventListener('change', e => {
  const sel = e.target;
  if (sel.tagName !== 'SELECT' || sel.value !== '__new') { if (sel.tagName === 'SELECT') sel.dataset.prev = sel.value; return; }
  e.stopImmediatePropagation();
  const prev = sel.dataset.prev && sel.dataset.prev !== '__new' ? sel.dataset.prev : '';
  sel.value = prev;
  openNewCategory(id => {
    const ph = sel.querySelector('option[value=""]')?.textContent || null;
    for (const other of document.querySelectorAll('select')) {
      if (!other.querySelector('option[value="__new"]')) continue;
      const v = other === sel ? id : other.value;
      const p2 = other.querySelector('option[value=""]')?.textContent || null;
      other.innerHTML = catOptions(v, { placeholder: other === sel ? ph : p2, allowNew: true });
      other.value = v;
    }
    sel.dataset.prev = id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}, true);
function openNewCategory(onCreate) {
  let kind = 'expense';
  sheet(`<h2>${esc(T('newCategory'))}</h2>
    <label class="field"><span>${esc(T('name'))}</span><input type="text" id="n-name" autocomplete="off"></label>
    <div class="field"><span>${esc(T('kind'))}</span><div class="seg" id="n-kind">${[['expense', 'kindExpense'], ['income', 'kindIncome'], ['savings', 'kindSavings'], ['investment', 'kindInvest']]
      .map(([v, k]) => `<button data-v="${v}" class="${v === kind ? 'on' : ''}">${esc(T(k))}</button>`).join('')}</div></div>
    <div class="actions"><button class="btn" id="n-cancel">${esc(T('cancel'))}</button><button class="btn primary" id="n-ok">${esc(T('create'))}</button></div>`,
  (el, close) => {
    const q = x => el.querySelector(x);
    setTimeout(() => q('#n-name').focus(), 50);
    q('#n-kind').onclick = e => { const b = e.target.closest('button'); if (!b) return; kind = b.dataset.v;
      q('#n-kind').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    q('#n-cancel').onclick = close;
    const ok = async () => {
      const name = q('#n-name').value.trim(); if (!name) { q('#n-name').focus(); return; }
      const existing = S.cats.find(c => (c.en || '').toLowerCase() === name.toLowerCase() || (c.nl || '').toLowerCase() === name.toLowerCase());
      if (existing) { close(); onCreate(existing.id); return; }
      const c = { id: 'c' + uid(), en: name, nl: name, kind };
      const at = S.cats.findIndex(x => x.kind === 'internal');
      if (kind === 'expense') S.cats.splice(S.cats.findIndex(x => x.kind !== 'expense'), 0, c); else S.cats.splice(at < 0 ? S.cats.length : at, 0, c);
      await db.set('cats', S.cats);
      close(); onCreate(c.id); toast(T('catCreated')(name));
    };
    q('#n-ok').onclick = ok;
    q('#n-name').onkeydown = e => { if (e.key === 'Enter') ok(); };
  });
}
function suggestPattern(t) {
  if (t.counterIban && /OVERSCHRIJVING/.test(t.type)) return t.counterName && !/VAN TRICHT ARTHUR/.test(t.counterName) ? t.counterName : t.counterIban;
  const m = (t.merchant || '').replace(/\s+[A-Z]{2}\d{4}\b.*$/, '').replace(/\s+[A-Z]{2}\d{3,4}\s?[A-Z]{0,2}\s.*$/, '');
  return (m || t.merchant || '').trim();
}

// ---------------- Render root ----------------
function destroyCharts() { UI.charts.forEach(c => c.destroy()); UI.charts = []; }
function render() {
  destroyCharts();
  const app = document.getElementById('app');
  const screens = { overview: vOverview, evolution: vEvolution, transactions: vTransactions, review: vReview, settings: vSettings };
  const headerTitle = UI.tab === 'settings' ? T('settings') : T(UI.tab);
  const rc = reviewCount();
  app.innerHTML = `
    <div class="app">
      <header class="top">
        ${UI.tab === 'settings' ? `<button class="icon-btn" data-tab="overview" aria-label="Back">${I.back}</button>` : ''}
        <h1 style="flex:1">${esc(headerTitle)}</h1>
        ${UI.tab !== 'settings' ? `<button class="icon-btn" data-tab="settings" aria-label="${esc(T('settings'))}">${I.gear}</button>` : ''}
      </header>
      <main id="screen">${screens[UI.tab]()}</main>
    </div>
    ${UI.tab === 'overview' ? `<button class="fab" id="fab-import" aria-label="${esc(T('importTitle'))}">＋</button>` : ''}
    <nav class="bottom"><div class="in">
      ${['overview', 'evolution', 'transactions', 'review'].map(k => `
        <button data-tab="${k}" class="${UI.tab === k ? 'on' : ''}">${I[k]}<span>${esc(T(k))}</span>
        ${k === 'review' && rc ? `<span class="badge">${rc > 99 ? '99+' : rc}</span>` : ''}</button>`).join('')}
    </div></nav>`;
  const after = { overview: afterOverview, evolution: afterEvolution, transactions: afterTransactions, review: afterReview, settings: afterSettings };
  after[UI.tab]?.();
}

document.addEventListener('click', e => {
  const tb = e.target.closest('[data-tab]');
  if (tb) { UI.tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (e.target.closest('#fab-import')) openImport();
});

// ---------------- Overview ----------------
function overviewRows() {
  const p = UI.period, by = totals(viewTxs(), p.start, p.end), cm = catMap();
  const rows = [];
  for (const [id, v] of Object.entries(by)) {
    const kind = id === '_none' ? 'expense' : cm[id]?.kind;
    if (kind === 'expense' || (S.settings.showSavings && (kind === 'savings' || kind === 'investment'))) {
      if (r2(v) !== 0) rows.push({ id, value: r2(-v) });
    }
  }
  rows.sort((a, b) => b.value - a.value);
  return { rows, head: headline(by, cm) };
}
function vOverview() {
  if (!S.txs.length) return `<div class="card empty">${esc(T('noDataAtAll'))}</div>`;
  const { ptype, view } = S.settings;
  const { rows, head } = overviewRows();
  const pos = rows.filter(r => r.value > 0), totalPos = pos.reduce((a, r) => a + r.value, 0);
  let body;
  if (!rows.length) body = `<div class="empty">${esc(T('noData'))}</div>`;
  else if (view === 'numbers') {
    const max = Math.max(...pos.map(r => r.value), 1);
    body = `<ul class="cats">${rows.map(r => `
      <li data-cat="${r.id}">
        <span class="cn ellip">${esc(catName(r.id))}</span>
        <span class="cv">${fmt(r.value)} ${r.value > 0 ? `<span class="pct">${Math.round(r.value / totalPos * 100)}%</span>` : ''}</span>
        <span class="meter"><i style="width:${Math.max(0, r.value / max * 100)}%"></i></span>
      </li>`).join('')}</ul>`;
  } else if (view === 'pie') {
    body = `<div class="chart-wrap" style="height:260px"><canvas id="c-pie" aria-label="Pie chart"></canvas></div><div class="legend" id="pie-legend"></div>`;
  } else {
    body = `<div class="chart-wrap" style="height:${Math.max(120, pos.length * 30 + 30)}px"><canvas id="c-bar" aria-label="Bar chart"></canvas></div>`;
  }
  return `
    ${acctSwitch()}
    <div class="seg" id="ptype">${['week', 'twoWeeks', 'month'].map(k => {
      const v = { week: 'week', twoWeeks: '2w', month: 'month' }[k];
      return `<button data-v="${v}" class="${ptype === v ? 'on' : ''}">${esc(T(k))}</button>`; }).join('')}</div>
    <div class="period">
      <button class="icon-btn" id="p-prev" aria-label="Previous">${I.back}</button>
      <div class="label">${esc(periodLabel(UI.period, ptype))}</div>
      <button class="icon-btn" id="p-next" aria-label="Next">${I.fwd}</button>
    </div>
    <div class="kpis">
      <div class="kpi main"><div class="k">${esc(T('spent'))}</div><div class="v">${fmt(head.spent)}</div></div>
      <div class="kpi" data-goto="income"><div class="k">${esc(T('income'))}</div><div class="v">${fmt(head.income)}</div></div>
      <div class="kpi"><div class="k" title="${esc(T('savedInvested'))}">${esc(T('savedInvested'))}</div><div class="v">${fmt(head.saved)}</div></div>
    </div>
    <div class="card">
      <div class="row-between" style="margin-bottom:12px; flex-wrap:wrap">
        <div class="seg" id="view" style="flex:1; min-width:220px">${['numbers', 'pie', 'bar'].map(v => `<button data-v="${v}" class="${view === v ? 'on' : ''}">${esc(T(v))}</button>`).join('')}</div>
      </div>
      <label class="toggle" style="margin-bottom:12px"><span class="switch"><input type="checkbox" id="show-sav" ${S.settings.showSavings ? 'checked' : ''}><span></span></span>${esc(T('showSavings'))}</label>
      ${body}
    </div>`;
}
function afterOverview() {
  if (!S.txs.length) return;
  const $ = id => document.getElementById(id);
  bindAcctSwitch();
  $('ptype').onclick = e => { const b = e.target.closest('button'); if (!b) return;
    S.settings.ptype = b.dataset.v; UI.period = periodOf(b.dataset.v, UI.period.end < latestDate() ? UI.period.start : latestDate(), S.settings.anchor); saveSettings(); render(); };
  $('p-prev').onclick = () => { UI.period = shiftPeriod(S.settings.ptype, UI.period, -1, S.settings.anchor); render(); };
  $('p-next').onclick = () => { UI.period = shiftPeriod(S.settings.ptype, UI.period, 1, S.settings.anchor); render(); };
  $('view').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.settings.view = b.dataset.v; saveSettings(); render(); };
  $('show-sav').onchange = e => { S.settings.showSavings = e.target.checked; saveSettings(); render(); };
  document.querySelectorAll('.cats li[data-cat]').forEach(li => li.onclick = () => gotoTx(li.dataset.cat));
  document.querySelector('[data-goto=income]').onclick = () => gotoTx('income');
  const { rows } = overviewRows();
  const pos = rows.filter(r => r.value > 0);
  if (!pos.length) return;
  const text2 = cssVar('--text-2'), grid = cssVar('--grid'), surface = cssVar('--surface');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = text2;
  const tooltip = { callbacks: { label: c => ` ${fmt(c.raw)}` } };
  if (S.settings.view === 'pie') {
    const top = pos.slice(0, 7), rest = pos.slice(7);
    const data = top.map(r => ({ id: r.id, label: catName(r.id), value: r.value }));
    if (rest.length) data.push({ id: '_other', label: T('other'), value: r2(rest.reduce((a, r) => a + r.value, 0)) });
    const colors = data.map((d, i) => d.id === '_other' ? cssVar('--other') : SERIES()[i]);
    const total = data.reduce((a, d) => a + d.value, 0);
    UI.charts.push(new Chart($('c-pie'), {
      type: 'pie',
      data: { labels: data.map(d => d.label), datasets: [{ data: data.map(d => d.value), backgroundColor: colors, borderColor: surface, borderWidth: 2, hoverOffset: 6 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmt(c.raw)} · ${Math.round(c.raw / total * 100)}%` } } },
        onClick: (e, els) => { if (els[0]) openSlice(data[els[0].index]); } },
    }));
    const openSlice = d => d.id === '_other' ? openOther(rest, total) : gotoTx(d.id);
    $('pie-legend').innerHTML = data.map((d, i) => `<button class="leg" data-li="${i}"><i class="swatch" style="background:${colors[i]}"></i>${esc(d.label)}${d.id === '_other' ? ` <span class="faint">(${rest.length})</span>` : ''} <b class="num" style="color:var(--text)">${fmt(d.value)}</b> <span class="faint">${Math.round(d.value / total * 100)}%</span></button>`).join('');
    $('pie-legend').querySelectorAll('[data-li]').forEach(b => b.onclick = () => openSlice(data[+b.dataset.li]));
  } else if (S.settings.view === 'bar') {
    UI.charts.push(new Chart($('c-bar'), {
      type: 'bar',
      data: { labels: pos.map(r => catName(r.id)), datasets: [{ data: pos.map(r => r.value), backgroundColor: cssVar('--accent'), borderRadius: 4, borderSkipped: 'start', barThickness: 18 }] },
      plugins: [{ id: 'vals', afterDatasetsDraw(ch) {
        const { ctx } = ch, meta = ch.getDatasetMeta(0);
        ctx.save(); ctx.fillStyle = cssVar('--text'); ctx.font = '600 12px ' + Chart.defaults.font.family; ctx.textBaseline = 'middle';
        meta.data.forEach((bar, i) => { const txt = fmt(pos[i].value); const w = ctx.measureText(txt).width;
          const inside = bar.x + 6 + w > ch.chartArea.right; ctx.fillStyle = inside ? '#fff' : cssVar('--text');
          ctx.textAlign = inside ? 'right' : 'left'; ctx.fillText(txt, inside ? bar.x - 6 : bar.x + 6, bar.y); });
        ctx.restore(); } }],
      options: { indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 8 } }, plugins: { legend: { display: false }, tooltip },
        scales: { x: { display: false, grace: '22%' },
          y: { grid: { display: false }, border: { display: false } } },
        onClick: (e, els) => { if (els[0]) gotoTx(pos[els[0].index].id); } },
    }));
  }
}
// Shows the categories grouped under "Other" in the pie chart
function openOther(rest, total) {
  sheet(`<h2>${esc(T('other'))} · ${fmt(rest.reduce((a, r) => a + r.value, 0))}</h2>
    <p class="small muted" style="margin-top:-6px">${esc(T('otherExplain'))}</p>
    <ul class="cats">${rest.map(r => `<li data-cat="${r.id}"><span class="cn ellip">${esc(catName(r.id))}</span>
      <span class="cv">${fmt(r.value)} <span class="pct">${Math.round(r.value / total * 100)}%</span></span></li>`).join('')}</ul>
    <div class="actions"><button class="btn" id="o-close">${esc(T('close'))}</button></div>`,
  (el, close) => {
    el.querySelector('#o-close').onclick = close;
    el.querySelectorAll('[data-cat]').forEach(li => li.onclick = () => { close(); gotoTx(li.dataset.cat); });
  });
}
function gotoTx(cat) {
  UI.filter = { q: '', acct: viewTxs() === S.txs ? '' : S.settings.acct, cat, start: UI.period.start, end: UI.period.end };
  UI.tab = 'transactions'; render(); window.scrollTo(0, 0);
}

// ---------------- Evolution ----------------
function evoBuckets() {
  const { step, range } = S.settings.evo;
  const end = latestDate();
  let start;
  if (range === 'rall') start = earliestDate();
  else { const months = { r3m: 3, r6m: 6, r1y: 12 }[range]; const e = parseISO(end); start = iso(new Date(e.getFullYear(), e.getMonth() - months + 1, 1)); }
  const out = []; let p = periodOf(step, start, S.settings.anchor);
  while (p.start <= end && out.length < 400) { out.push(p); p = shiftPeriod(step, p, 1, S.settings.anchor); }
  return out;
}
function vEvolution() {
  if (!S.txs.length) return `<div class="card empty">${esc(T('noDataAtAll'))}</div>`;
  const evo = S.settings.evo;
  const pickable = sortCats(S.cats.filter(c => c.kind !== 'internal'));
  return `${acctSwitch()}
    <div class="card">
      <div class="field"><span>${esc(T('step'))}</span><div class="seg" id="evo-step">${[['week', 'week'], ['2w', 'twoWeeks'], ['month', 'month']].map(([v, k]) => `<button data-v="${v}" class="${evo.step === v ? 'on' : ''}">${esc(T(k))}</button>`).join('')}</div></div>
      <div class="field"><span>${esc(T('range'))}</span><div class="seg" id="evo-range">${['r3m', 'r6m', 'r1y', 'rall'].map(v => `<button data-v="${v}" class="${evo.range === v ? 'on' : ''}">${esc(T(v))}</button>`).join('')}</div></div>
      <div class="chart-wrap" style="height:280px; margin-top:8px"><canvas id="c-evo" aria-label="Line chart"></canvas></div>
      <div class="legend" id="evo-legend"></div>
      <details><summary>${esc(T('numbers'))}</summary><div id="evo-table" style="overflow-x:auto"></div></details>
    </div>
    <div class="card">
      <div class="small muted" style="margin-bottom:8px">${esc(T('pickCats'))}</div>
      <div class="pick" id="evo-pick">${pickable.map(c => `<label class="${evo.cats.includes(c.id) ? 'on' : ''}"><input type="checkbox" value="${c.id}" ${evo.cats.includes(c.id) ? 'checked' : ''}>${esc(catName(c.id))}</label>`).join('')}</div>
    </div>`;
}
function afterEvolution() {
  if (!S.txs.length) return;
  const evo = S.settings.evo, $ = id => document.getElementById(id);
  bindAcctSwitch();
  const seg = (id, key) => $(id).onclick = e => { const b = e.target.closest('button'); if (!b) return; evo[key] = b.dataset.v; saveSettings(); render(); };
  seg('evo-step', 'step'); seg('evo-range', 'range');
  $('evo-pick').onchange = e => {
    const v = e.target.value;
    if (e.target.checked) { if (evo.cats.length >= 4) { e.target.checked = false; toast(T('pickCats')); return; } evo.cats.push(v); }
    else evo.cats = evo.cats.filter(c => c !== v);
    saveSettings(); render();
  };
  const buckets = evoBuckets(), cm = catMap();
  const sums = buckets.map(p => totals(viewTxs(), p.start, p.end));
  const series = [{ label: T('total'), data: sums.map(by => headline(by, cm).spent) }];
  for (const id of evo.cats) {
    const k = cm[id]?.kind;
    series.push({ label: catName(id), data: sums.map(by => r2((k === 'income' ? 1 : -1) * (by[id] || 0))) });
  }
  const colors = SERIES();
  const labels = buckets.map(p => S.settings.evo.step === 'month'
    ? parseISO(p.start).toLocaleDateString(LOC(), { month: 'short', year: '2-digit' })
    : parseISO(p.start).toLocaleDateString(LOC(), { day: 'numeric', month: 'short' }));
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = cssVar('--text-2');
  UI.charts.push(new Chart($('c-evo'), {
    type: 'line',
    data: { labels, datasets: series.map((s, i) => ({ ...s, borderColor: colors[i], backgroundColor: colors[i], borderWidth: 2, pointRadius: buckets.length > 30 ? 0 : 3, pointHoverRadius: 5, tension: 0 })) },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.raw)}` } } },
      scales: { x: { grid: { display: false }, border: { color: cssVar('--line') }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
        y: { grid: { color: cssVar('--grid') }, border: { display: false }, ticks: { callback: v => fmt(v).replace(/[,.]00(?!\d)/, '') } } } },
  }));
  $('evo-legend').innerHTML = series.map((s, i) => `<span><i class="swatch" style="background:${colors[i]}"></i>${esc(s.label)}</span>`).join('');
  $('evo-table').innerHTML = `<table class="chart-table"><tr><th>${esc(T('periodOf'))}</th>${series.map(s => `<th>${esc(s.label)}</th>`).join('')}</tr>` +
    buckets.map((p, j) => `<tr><td>${esc(periodLabel(p, evo.step))}</td>${series.map(s => `<td>${fmt(s.data[j])}</td>`).join('')}</tr>`).join('') + '</table>';
}

// ---------------- Transactions ----------------
function filtered() {
  const f = UI.filter, q = f.q.trim().toUpperCase();
  return S.txs.filter(t => {
    if (f.acct && t.acct !== f.acct) return false;
    if (f.start && t.date < f.start) return false;
    if (f.end && t.date > f.end) return false;
    if (f.cat) {
      if (f.cat === '_none') { if (t.cat) return false; }
      else if (!parts(t).some(p => p.cat === f.cat)) return false;
    }
    if (q && !(t.type + ' ' + t.details.join(' ') + ' ' + catName(t.cat)).toUpperCase().includes(q)) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);
}
function txRow(t) {
  const ps = parts(t);
  const catLabel = !t.cat ? T('uncategorized') : t.split ? `${catName(ps[0].cat)} +${ps.length - 1}` : catName(t.cat);
  return `<div class="tx" data-id="${t.id}">
    <div class="m">${esc(title(shortMerchant(t.merchant)))}</div>
    <div class="a">${fmt(t.amount, t.amount > 0)}</div>
    <div class="s">${esc(fmtDate(t.date, { day: 'numeric', month: 'short' }))} · ${esc(title(t.type))}</div>
    <div class="c ${t.cat ? '' : 'none'}">${esc(catLabel)}</div></div>`;
}
function vTransactions() {
  const f = UI.filter, list = filtered();
  const ownAccts = [...new Set(S.txs.map(t => t.acct))];
  const groups = {};
  for (const t of list.slice(0, 600)) { const k = t.date.slice(0, 7); (groups[k] ||= []).push(t); }
  const sum = r2(list.reduce((a, t) => a + (f.cat ? parts(t).filter(p => p.cat === f.cat || (f.cat === '_none' && !p.cat)).reduce((x, p) => x + p.amount, 0) : t.amount), 0));
  return `
    <div class="filters">
      <input type="search" class="full" id="f-q" placeholder="${esc(T('search'))}" value="${esc(f.q)}">
      <select id="f-acct"><option value="">${esc(T('allAccounts'))}</option>${ownAccts.map(a => `<option value="${a}" ${f.acct === a ? 'selected' : ''}>${esc(accName(a))}</option>`).join('')}</select>
      <select id="f-cat"><option value="">${esc(T('allCategories'))}</option><option value="_none" ${f.cat === '_none' ? 'selected' : ''}>${esc(T('uncategorized'))}</option>${catOptions(f.cat)}</select>
    </div>
    ${f.start ? `<span class="chip">${esc(fmtDate(f.start))} – ${esc(fmtDate(f.end))}<button id="f-clear-p" aria-label="${esc(T('clear'))}">×</button></span>` : ''}
    <div class="row-between small muted" style="margin:4px 2px 0"><span>${esc(T('results')(list.length))}</span><span class="num">${fmt(sum, sum > 0)}</span></div>
    ${Object.entries(groups).map(([k, ts]) => `
      <div class="tx-group">${esc(parseISO(k + '-01').toLocaleDateString(LOC(), { month: 'long', year: 'numeric' }))}</div>
      <div class="txlist">${ts.map(txRow).join('')}</div>`).join('')}
    ${!list.length ? `<div class="empty">${esc(T('noData'))}</div>` : ''}`;
}
function afterTransactions() {
  const $ = id => document.getElementById(id);
  let tm;
  $('f-q').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { UI.filter.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('f-q'); q.focus(); q.setSelectionRange(pos, pos); }, 250); };
  $('f-acct').onchange = e => { UI.filter.acct = e.target.value; render(); };
  $('f-cat').onchange = e => { UI.filter.cat = e.target.value; render(); };
  $('f-clear-p') && ($('f-clear-p').onclick = () => { UI.filter.start = UI.filter.end = ''; render(); });
  document.querySelectorAll('.tx[data-id]').forEach(el => el.onclick = () => openEdit(S.txs.find(t => t.id === el.dataset.id)));
}

// ---------------- Edit sheet ----------------
function sheet(html, onMount) {
  const scrim = document.createElement('div'); scrim.className = 'scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
  const close = () => scrim.remove();
  document.body.appendChild(scrim);
  onMount?.(scrim.querySelector('.sheet'), close);
  return close;
}
async function commitCategory(t, { cat, split, remember, pattern }) {
  if (remember && pattern.trim()) {
    const rule = { id: uid(), pattern: pattern.trim().toUpperCase(), cat, ...(split ? { split } : {}) };
    // a split defined in euros only makes sense for this exact amount
    if (split) rule.amount = t.amount;
    S.rules.unshift(rule);
    t.source = null;
    await db.set('rules', S.rules);
    const n = await reapplyAll();
    if (t.cat !== cat) { t.cat = cat; t.split = split; t.source = 'manual'; await db.putTx([t]); }
    return n;
  }
  t.cat = cat; t.split = split; t.source = 'manual'; t.ruleId = null;
  await db.putTx([t]);
  return 1;
}
function openEdit(t) {
  const sign = t.amount < 0 ? -1 : 1;
  let splitParts = (t.split || []).map(p => ({ cat: p.cat, amount: Math.abs(p.amount) }));
  const rule = t.ruleId?.startsWith('acct:') ? null : S.rules.find(r => r.id === t.ruleId);
  sheet(`
    <h2>${esc(title(shortMerchant(t.merchant)))}</h2>
    <div class="row-between" style="margin-bottom:10px"><span class="muted">${esc(fmtDate(t.date))} · ${esc(accName(t.acct))}</span><b class="num" style="font-size:18px">${fmt(t.amount, t.amount > 0)}</b></div>
    <div class="detail-lines">${esc([t.type, ...t.details].join('\n'))}</div>
    <label class="field"><span>${esc(T('category'))}${t.source ? ` · <span class="faint">${esc(t.source === 'manual' ? T('manual') : T('byRule') + (rule ? ` “${rule.pattern}”` : ''))}</span>` : ''}</span>
      <select id="e-cat">${catOptions(t.cat, { placeholder: T('chooseCat') })}</select></label>
    <label class="toggle" style="margin-bottom:10px"><span class="switch"><input type="checkbox" id="e-split" ${splitParts.length ? 'checked' : ''}><span></span></span>${esc(T('splitIt'))}</label>
    <div id="e-split-box"></div>
    <label class="toggle" style="margin:6px 0 8px"><span class="switch"><input type="checkbox" id="e-rem"><span></span></span>${esc(T('remember'))}</label>
    <label class="field" id="e-pat-wrap" style="display:none"><span>${esc(T('matchText'))}</span><input type="text" id="e-pat" value="${esc(suggestPattern(t))}"></label>
    <div class="actions"><button class="btn" id="e-cancel">${esc(T('cancel'))}</button><button class="btn primary" id="e-save">${esc(T('save'))}</button></div>`,
  (el, close) => {
    const q = s => el.querySelector(s);
    const drawSplit = () => {
      const box = q('#e-split-box');
      if (!q('#e-split').checked) { box.innerHTML = ''; return; }
      if (!splitParts.length) splitParts = [{ cat: '', amount: 0 }];
      const fixed = splitParts.reduce((a, p) => a + (+p.amount || 0), 0);
      box.innerHTML = splitParts.map((p, i) => `<div class="split-row" data-i="${i}">
          <select data-k="cat">${catOptions(p.cat, { placeholder: T('chooseCat') })}</select>
          <input type="number" step="0.01" min="0" data-k="amount" value="${p.amount || ''}" inputmode="decimal">
          <button class="icon-btn" data-k="del" aria-label="${esc(T('del'))}">${I.x}</button></div>`).join('') +
        `<div class="row-between small" style="margin:4px 0 10px"><button class="btn" id="e-addp">${esc(T('addPart'))}</button>
         <span class="muted">${esc(T('remainder'))} → <b>${esc(catName(q('#e-cat').value) || '…')}</b>: ${fmt(Math.abs(t.amount) - fixed)}</span></div>`;
      box.querySelectorAll('.split-row').forEach(row => {
        const i = +row.dataset.i;
        row.querySelector('[data-k=cat]').onchange = e => { splitParts[i].cat = e.target.value; };
        row.querySelector('[data-k=amount]').onchange = e => { splitParts[i].amount = +e.target.value; drawSplit(); };
        row.querySelector('[data-k=del]').onclick = () => { splitParts.splice(i, 1); drawSplit(); };
      });
      q('#e-addp').onclick = () => { splitParts.push({ cat: '', amount: 0 }); drawSplit(); };
    };
    q('#e-split').onchange = drawSplit; q('#e-cat').onchange = drawSplit; drawSplit();
    q('#e-rem').onchange = e => { q('#e-pat-wrap').style.display = e.target.checked ? '' : 'none'; };
    q('#e-cancel').onclick = close;
    q('#e-save').onclick = async () => {
      const cat = q('#e-cat').value || null;
      if (!cat) { q('#e-cat').focus(); return; }
      const useSplit = q('#e-split').checked && splitParts.some(p => p.cat && p.amount);
      const split = useSplit ? splitParts.filter(p => p.cat && p.amount).map(p => ({ cat: p.cat, amount: r2(sign * p.amount) })) : null;
      await commitCategory(t, { cat, split, remember: q('#e-rem').checked, pattern: q('#e-pat').value });
      close(); render();
    };
  });
}

// ---------------- Review ----------------
function vReview() {
  const list = S.txs.filter(t => !t.cat).sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) return `<div class="card empty">${esc(T('reviewEmpty'))}</div>`;
  return `<p class="muted small" style="margin-top:0">${esc(T('reviewIntro')(list.length))}</p>` + list.slice(0, 100).map(t => `
    <div class="card review-item" data-id="${t.id}">
      <div class="top"><div style="min-width:0"><div class="ellip" style="font-weight:600">${esc(title(shortMerchant(t.merchant)))}</div>
        <div class="small faint">${esc(fmtDate(t.date))} · ${esc(title(t.type))}</div></div>
        <b class="num">${fmt(t.amount, t.amount > 0)}</b></div>
      ${t.description && t.description !== t.merchant ? `<div class="small muted ellip" style="margin-bottom:8px">${esc(t.description)}</div>` : ''}
      <select data-k="cat">${catOptions(null, { placeholder: T('chooseCat') })}</select>
      <label class="toggle small" style="margin:10px 0 6px"><span class="switch"><input type="checkbox" data-k="rem" checked><span></span></span>${esc(T('remember'))}</label>
      <div class="row-between" style="gap:8px"><input type="text" data-k="pat" value="${esc(suggestPattern(t))}" aria-label="${esc(T('matchText'))}">
        <button class="btn primary" data-k="save">${esc(T('save'))}</button></div>
      <button class="btn" data-k="more" style="margin-top:8px; font-size:13px; padding:6px 10px">${esc(T('splitIt'))} / …</button>
    </div>`).join('');
}
function afterReview() {
  document.querySelectorAll('.review-item').forEach(card => {
    const t = S.txs.find(x => x.id === card.dataset.id), q = s => card.querySelector(s);
    q('[data-k=rem]').onchange = e => { q('[data-k=pat]').disabled = !e.target.checked; };
    q('[data-k=more]').onclick = () => openEdit(t);
    q('[data-k=save]').onclick = async () => {
      const cat = q('[data-k=cat]').value;
      if (!cat) { q('[data-k=cat]').focus(); return; }
      const remember = q('[data-k=rem]').checked;
      const before = reviewCount();
      await commitCategory(t, { cat, split: null, remember, pattern: q('[data-k=pat]').value });
      const solved = before - reviewCount();
      if (solved > 1) toast(T('reapplied')(solved));
      render();
    };
  });
}

// ---------------- Import ----------------
function buildTx(parsed, pdfId, bank) {
  const acct = parsed.iban.replace(/ /g, '');
  const seen = {};
  return parsed.transactions.map((t, i) => {
    const base = `${acct}|${t.date}|${t.valuta}|${t.amount}|${t.type}|${t.details.join('|')}`;
    seen[base] = (seen[base] || 0) + 1;
    return { id: hash(base + '#' + seen[base]), acct, bank: bank.id, ...t, ...bank.enrich(t), seq: i, pdfId, cat: null, split: null, source: null, ruleId: null };
  });
}
function openImport() {
  let results = [];
  sheet(`<h2>${esc(T('importTitle'))}</h2>
    <label class="btn block primary" style="display:block; text-align:center">${esc(T('pickPdf'))}<input type="file" id="i-file" accept="application/pdf,.pdf" multiple hidden></label>
    <div id="i-res" style="margin-top:12px"></div>
    <div class="actions"><button class="btn" id="i-cancel">${esc(T('close'))}</button><button class="btn primary" id="i-go" disabled>…</button></div>`,
  (el, close) => {
    const q = s => el.querySelector(s);
    q('#i-cancel').onclick = close;
    const existing = new Set(S.txs.map(t => t.id));
    const count = () => results.reduce((a, r) => a + (r.txs ? r.txs.filter(t => !existing.has(t.id) && t.date >= r.from && t.date <= r.to).length : 0), 0);
    const draw = () => {
      q('#i-res').innerHTML = results.map((r, i) => r.error ? `<div class="card small"><b>${esc(r.name)}</b><div class="warn">${esc(r.error)}</div></div>` : `
        <div class="card small" data-i="${i}">
          <div style="font-weight:600" class="ellip">${esc(r.bank.name)} · ${esc(accName(r.parsed.iban.replace(/ /g, '')))} · ${esc(r.parsed.iban)}</div>
          <div class="muted">${esc(fmtDate(r.parsed.from))} – ${esc(fmtDate(r.parsed.to))}</div>
          <div style="margin:6px 0">${r.txs.length} ${esc(T('found'))} · <b>${r.txs.filter(t => !existing.has(t.id)).length} ${esc(T('isNew'))}</b> · ${r.txs.filter(t => existing.has(t.id)).length} ${esc(T('already'))}</div>
          <div class="${r.balanced ? 'ok' : 'warn'}">${r.balanced ? '✓ ' + esc(T('balanceOk')) : '⚠ ' + esc(T('balanceBad'))}</div>
          <div class="field" style="margin:10px 0 0"><span>${esc(T('importRange'))}</span>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px"><input type="date" data-k="from" value="${r.from}"><input type="date" data-k="to" value="${r.to}"></div></div>
        </div>`).join('');
      q('#i-res').querySelectorAll('[data-i]').forEach(c => {
        const r = results[+c.dataset.i];
        c.querySelector('[data-k=from]').onchange = e => { r.from = e.target.value || r.parsed.from; draw(); };
        c.querySelector('[data-k=to]').onchange = e => { r.to = e.target.value || r.parsed.to; draw(); };
      });
      const n = count(); q('#i-go').disabled = !n; q('#i-go').textContent = T('doImport')(n);
    };
    q('#i-file').onchange = async e => {
      const files = [...e.target.files]; if (!files.length) return;
      q('#i-res').innerHTML = `<div class="muted">${esc(T('reading'))}</div>`;
      results = [];
      for (const f of files) {
        try {
          const buf = await f.arrayBuffer();
          const blob = new Blob([buf.slice(0)], { type: 'application/pdf' });
          const pages = await readPdfPages(buf);
          const bank = detectBank(pages);
          if (!bank) { results.push({ name: f.name, error: T('unknownBank')(BANKS.map(b => b.name).join(', ')) }); continue; }
          const parsed = bank.parse(pages);
          if (!parsed.iban || !parsed.transactions.length) { results.push({ name: f.name, error: T('noTx')(bank.name) }); continue; }
          const pdfId = hash(f.name + f.size + parsed.iban);
          const txs = buildTx(parsed, pdfId, bank);
          const sum = txs.reduce((a, t) => a + t.amount, 0);
          const balanced = parsed.opening != null && r2(parsed.opening + sum) === r2(parsed.closing);
          results.push({ name: f.name, bank, parsed, txs, balanced, blob, pdfId, from: parsed.from, to: parsed.to });
        } catch (err) { console.error(err); results.push({ name: f.name, error: T('readError') + ' (' + err.message + ')' }); }
      }
      draw();
    };
    q('#i-go').onclick = async () => {
      q('#i-go').disabled = true;
      let added = [];
      for (const r of results) {
        if (!r.txs) continue;
        const acct = r.parsed.iban.replace(/ /g, '');
        if (!S.accounts.some(a => a.iban === acct)) S.accounts.push({ iban: acct, name: r.bank.name.split(' ')[0] + ' ' + acct.slice(-4), role: 'own' });
        const fresh = r.txs.filter(t => !existing.has(t.id) && t.date >= r.from && t.date <= r.to);
        fresh.forEach(t => { existing.add(t.id); });
        added = added.concat(fresh);
        await db.putPdf({ id: r.pdfId, name: r.name, bank: r.bank.id, iban: acct, from: r.parsed.from, to: r.parsed.to, size: r.blob.size, added: iso(new Date()), blob: r.blob });
      }
      await db.set('accounts', S.accounts);
      added.forEach(t => applyRules(t, S.rules, S.accounts));
      S.txs = S.txs.concat(added);
      await db.putTx(added);
      S.pdfs = await db.allPdfMeta();
      UI.period = periodOf(S.settings.ptype, latestDate(), S.settings.anchor);
      close(); render(); toast(T('imported')(added.length));
    };
  });
}

// ---------------- Settings ----------------
function vSettings() {
  const st = S.settings, L = S.settings.lang;
  const roleOpt = r => ['own', 'savings', 'investment'].map(v => `<option value="${v}" ${r === v ? 'selected' : ''}>${esc(T({ own: 'roleOwn', savings: 'roleSavings', investment: 'roleInvest' }[v]))}</option>`).join('');
  const kindOpt = k => ['expense', 'income', 'savings', 'investment'].map(v => `<option value="${v}" ${k === v ? 'selected' : ''}>${esc(T({ expense: 'kindExpense', income: 'kindIncome', savings: 'kindSavings', investment: 'kindInvest' }[v]))}</option>`).join('');
  return `
    <div class="card">
      <div class="field"><span>${esc(T('language'))}</span><div class="seg" id="s-lang">${[['en', 'English'], ['nl', 'Nederlands']].map(([v, l]) => `<button data-v="${v}" class="${st.lang === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="field"><span>${esc(T('theme'))}</span><div class="seg" id="s-theme">${['light', 'dark', 'system'].map(v => `<button data-v="${v}" class="${st.theme === v ? 'on' : ''}">${esc(T(v))}</button>`).join('')}</div></div>
      <label class="field" style="margin-bottom:0"><span>${esc(T('twoWeekStart'))}</span><input type="date" id="s-anchor" value="${st.anchor}"></label>
    </div>

    <div class="section-title">${esc(T('accounts'))}</div>
    <div class="card">${S.accounts.map((a, i) => `
      <div class="list-row" data-i="${i}" style="flex-wrap:wrap">
        <input type="text" data-k="name" value="${esc(a.name)}" style="flex:1 1 140px" aria-label="${esc(T('name'))}">
        <select data-k="role" style="flex:1 1 160px">${roleOpt(a.role)}</select>
        <div class="small faint num" style="flex-basis:100%">${esc(fmtIban(a.iban))}</div>
      </div>`).join('')}
      <details><summary>${esc(T('addAccount'))}</summary>
        <div style="display:grid; gap:6px; margin-top:8px"><input type="text" id="na-iban" placeholder="${esc(T('iban'))}"><input type="text" id="na-name" placeholder="${esc(T('name'))}">
        <select id="na-role">${roleOpt('own')}</select><button class="btn" id="na-add">${esc(T('addAccount'))}</button></div></details>
    </div>

    <div class="section-title">${esc(T('categories'))}</div>
    <div class="card">${sortCats(S.cats.filter(c => c.kind !== 'internal')).map(c => `
      <div class="list-row" data-cid="${c.id}">
        <input type="text" data-k="name" value="${esc(c[L] || c.en)}" class="grow" aria-label="${esc(T('name'))}">
        <select data-k="kind" style="width:130px">${kindOpt(c.kind)}</select>
        <button class="icon-btn" data-k="del" aria-label="${esc(T('del'))}">${I.x}</button>
      </div>`).join('')}
      <div style="display:flex; gap:6px; margin-top:10px"><input type="text" id="nc-name" placeholder="${esc(T('newCategory'))}"><button class="btn" id="nc-add">${esc(T('addCategory'))}</button></div>
    </div>

    <div class="section-title">${esc(T('rules'))} <span class="faint">(${S.rules.length})</span></div>
    <div class="card">
      <input type="search" id="r-q" placeholder="${esc(T('search'))}" style="margin-bottom:6px">
      <div id="r-list"></div>
      <details><summary>${esc(T('addRule'))}</summary>
        <div style="display:grid; gap:6px; margin-top:8px">
          <input type="text" id="nr-pat" placeholder="${esc(T('ruleIf'))}">
          <input type="number" step="0.01" id="nr-amt" placeholder="${esc(T('ruleAmount'))}">
          <select id="nr-cat">${catOptions(null, { placeholder: T('chooseCat') })}</select>
          <button class="btn" id="nr-add">${esc(T('addRule'))}</button></div></details>
      <button class="btn block" id="r-reapply" style="margin-top:12px">${esc(T('reapply'))}</button>
    </div>

    <div class="section-title">${esc(T('statements'))}</div>
    <div class="card">${S.pdfs.length ? S.pdfs.sort((a, b) => b.to.localeCompare(a.to)).map(p => `
      <div class="list-row"><div class="grow"><div class="ellip small" style="font-weight:500">${esc(p.name)}</div>
        <div class="small faint">${esc(accName(p.iban))} · ${esc(fmtDate(p.from))} – ${esc(fmtDate(p.to))}</div></div>
        <button class="btn" data-open="${p.id}">${esc(T('open'))}</button>
        <button class="icon-btn" data-delpdf="${p.id}" aria-label="${esc(T('del'))}">${I.x}</button></div>`).join('') : `<div class="muted small">${esc(T('noStatements'))}</div>`}
    </div>

    <div class="section-title">${esc(T('backup'))}</div>
    <div class="card">
      <label class="toggle small" style="margin-bottom:10px"><span class="switch"><input type="checkbox" id="b-pdfs" checked><span></span></span>${esc(T('withPdfs'))}</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px">
        <button class="btn" id="b-export">${esc(T('exportData'))}</button>
        <label class="btn" style="text-align:center">${esc(T('importData'))}<input type="file" id="b-import" accept="application/json,.json" hidden></label>
      </div>
      <button class="btn block danger" id="b-reset" style="margin-top:12px">${esc(T('resetAll'))}</button>
    </div>
    <p class="small faint" style="text-align:center">Cashew · v1.0</p>`;
}
function drawRules() {
  const q = (document.getElementById('r-q')?.value || '').toUpperCase();
  const list = S.rules.filter(r => !q || r.pattern.includes(q) || catName(r.cat).toUpperCase().includes(q));
  document.getElementById('r-list').innerHTML = list.slice(0, 60).map(r => `
    <div class="list-row small"><div class="grow ellip"><b>${esc(r.pattern)}</b>${r.amount != null ? ` <span class="faint">= ${fmt(r.amount)}</span>` : ''}
      → ${r.split ? r.split.map(p => `${esc(catName(p.cat))} ${fmt(p.amount)} + `).join('') : ''}${esc(catName(r.cat))}</div>
      <button class="icon-btn" data-delrule="${r.id}" aria-label="${esc(T('del'))}">${I.x}</button></div>`).join('') +
    (list.length > 60 ? `<div class="small faint" style="padding-top:8px">+${list.length - 60}…</div>` : '');
  document.querySelectorAll('[data-delrule]').forEach(b => b.onclick = async () => {
    S.rules = S.rules.filter(r => r.id !== b.dataset.delrule); await db.set('rules', S.rules); await reapplyAll(); drawRules();
  });
}
function afterSettings() {
  const $ = id => document.getElementById(id), st = S.settings;
  $('s-lang').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.lang = b.dataset.v; saveSettings(); applyTheme(); render(); };
  $('s-theme').onclick = e => { const b = e.target.closest('button'); if (!b) return; st.theme = b.dataset.v; saveSettings(); applyTheme(); render(); };
  $('s-anchor').onchange = e => { if (e.target.value) { st.anchor = e.target.value; saveSettings(); UI.period = periodOf(st.ptype, UI.period.start, st.anchor); } };
  document.querySelectorAll('[data-i]').forEach(row => {
    const a = S.accounts[+row.dataset.i];
    row.querySelector('[data-k=name]').onchange = e => { a.name = e.target.value; db.set('accounts', S.accounts); };
    row.querySelector('[data-k=role]').onchange = async e => { a.role = e.target.value; await db.set('accounts', S.accounts); const n = await reapplyAll(); toast(T('reapplied')(n)); };
  });
  $('na-add').onclick = async () => {
    const iban = $('na-iban').value.replace(/\s/g, '').toUpperCase(); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) { $('na-iban').focus(); return; }
    S.accounts.push({ iban, name: $('na-name').value || fmtIban(iban), role: $('na-role').value });
    await db.set('accounts', S.accounts); await reapplyAll(); render();
  };
  document.querySelectorAll('[data-cid]').forEach(row => {
    const c = S.cats.find(x => x.id === row.dataset.cid);
    row.querySelector('[data-k=name]').onchange = e => { c[st.lang] = e.target.value; if (!c.en) c.en = e.target.value; db.set('cats', S.cats); };
    row.querySelector('[data-k=kind]').onchange = e => { c.kind = e.target.value; db.set('cats', S.cats); };
    row.querySelector('[data-k=del]').onclick = () => {
      const used = S.txs.some(t => parts(t).some(p => p.cat === c.id)) || S.rules.some(r => r.cat === c.id);
      if (used) { toast(T('inUse')); return; }
      S.cats = S.cats.filter(x => x !== c); db.set('cats', S.cats); render();
    };
  });
  $('nc-add').onclick = () => {
    const name = $('nc-name').value.trim(); if (!name) return;
    S.cats.splice(S.cats.findIndex(c => c.kind !== 'expense'), 0, { id: 'c' + uid(), en: name, nl: name, kind: 'expense' });
    db.set('cats', S.cats); render();
  };
  $('r-q').oninput = drawRules; drawRules();
  $('nr-add').onclick = async () => {
    const pattern = $('nr-pat').value.trim().toUpperCase(), cat = $('nr-cat').value;
    if (!pattern || !cat) return;
    const amt = $('nr-amt').value;
    S.rules.unshift({ id: uid(), pattern, cat, ...(amt !== '' ? { amount: r2(+amt) } : {}) });
    await db.set('rules', S.rules); const n = await reapplyAll(); toast(T('reapplied')(n)); render();
  };
  $('r-reapply').onclick = async () => { const n = await reapplyAll(); toast(T('reapplied')(n)); };
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => {
    const p = await db.getPdf(b.dataset.open); if (!p) return;
    try { await openPdf(p.name, p.blob); } catch (err) { toast('⚠ ' + err.message); }
  });
  document.querySelectorAll('[data-delpdf]').forEach(b => b.onclick = async () => {
    await db.delPdf(b.dataset.delpdf); S.pdfs = await db.allPdfMeta(); render();
  });
  $('b-export').onclick = async () => {
    const data = { app: 'expense-tracker', version: 1, exported: new Date().toISOString(), settings: S.settings, cats: S.cats, accounts: S.accounts, rules: S.rules, txs: S.txs, pdfs: [] };
    if ($('b-pdfs').checked) for (const p of await db.allPdfs()) {
      const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.readAsDataURL(p.blob); });
      const { blob, ...meta } = p; data.pdfs.push({ ...meta, data: b64 });
    }
    try { await saveFile(`cashew-backup-${iso(new Date())}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' })); }
    catch (err) { if (!/cancel/i.test(err.message)) toast('⚠ ' + err.message); }
  };
  $('b-import').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'expense-tracker') throw new Error('not a backup');
      if (!(await confirmSheet(T('restoreConfirm'), T('importData')))) return;
      await db.clearAll();
      Object.assign(S, { settings: { ...S.settings, ...data.settings }, cats: data.cats, accounts: data.accounts, rules: data.rules, txs: data.txs });
      await saveMeta(); await db.putTx(S.txs);
      for (const p of data.pdfs || []) {
        const bin = Uint8Array.from(atob(p.data), c => c.charCodeAt(0)); const { data: _, ...meta } = p;
        await db.putPdf({ ...meta, blob: new Blob([bin], { type: 'application/pdf' }) });
      }
      S.pdfs = await db.allPdfMeta(); applyTheme();
      UI.period = periodOf(S.settings.ptype, latestDate(), S.settings.anchor); render();
    } catch (err) { toast('⚠ ' + err.message); }
  };
  $('b-reset').onclick = async () => {
    if (!(await confirmSheet(T('resetConfirm'), T('resetAll')))) return;
    await db.clearAll(); location.reload();
  };
}

// ---------------- Boot ----------------
(async function boot() {
  await load();
  applyTheme();
  UI.period = periodOf(S.settings.ptype, latestDate(), S.settings.anchor);
  render();
  onBack(() => {
    const sc = document.querySelectorAll('.scrim');
    if (sc.length) { sc[sc.length - 1].remove(); return true; }
    if (UI.tab !== 'overview') { UI.tab = 'overview'; render(); return true; }
    return false;
  });
})();
