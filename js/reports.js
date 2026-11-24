'use strict';
/* =========================================================================
   Reports: ageing, banking reconciliation, business (financial statements,
   ledgers), contact ledgers, inventory, job, budgets, audit trail
   ========================================================================= */

const R = {
  head(title, crumbs, sub) {
    return `${UI.pageHead(title, crumbs || [['Reports', '#/reports']], UI.reportActions())}`;
  },
  title(title, sub) {
    return `<div class="report-title"><div class="muted">${E(DB.data.settings.company)}</div><h2>${E(t(title))}</h2><div class="muted">${sub}</div></div>`;
  },
  asOfFilter(asOf, extra = '') {
    return `<div class="filters no-print">${UI.field('As of', `<input type="date" id="f-asof" value="${E(asOf)}">`)}${extra}</div>`;
  },
  bindAsOf(el, q) { const i = $('#f-asof', el); if (i) i.onchange = () => { location.hash = UI.withQuery(q, { asof: i.value }); }; },
  finish(el, name) { UI.bindExport(el, name); },
  range(q, defFrom) {
    const d = U.today();
    return [q.from ?? (defFrom || U.fyStart(d)), q.to ?? d];
  },
  periodLabel(from, to) { return `${from ? U.fdate(from) : 'Beginning'} – ${U.fdate(to)}`; },
  /** Period columns ending at `to`. */
  periods(to, kind, n) {
    const out = [];
    const step = kind === 'quarter' ? 3 : kind === 'year' ? 12 : 1;
    let end = U.monthEnd(to);
    for (let i = 0; i < n; i++) {
      const start = U.monthStart(U.addMonths(end, -(step - 1)));
      out.unshift({ from: start, to: end, label: step === 1 ? U.monthLabel(start.slice(0, 7)) : step === 3 ? `${U.monthLabel(start.slice(0, 7))}–${U.monthLabel(end.slice(0, 7))}` : `FY ${start.slice(0, 4)}` });
      end = U.addDays(start, -1);
    }
    return out;
  },
  periodFilter(q) {
    return `<div class="filters no-print">
      ${UI.field('Ending', `<input type="date" id="p-to" value="${E(q.to || U.today())}">`)}
      ${UI.field('Period', UI.select('', [['month', 'Monthly'], ['quarter', 'Quarterly'], ['year', 'Yearly']], q.kind || 'month', 'id="p-kind"'))}
      ${UI.field('Columns', UI.select('', [3, 4, 6, 12].map(n => [n, n]), q.n || 6, 'id="p-n"'))}
    </div>`;
  },
  bindPeriod(el, q) {
    const go = () => { location.hash = UI.withQuery(q, { to: $('#p-to', el).value, kind: $('#p-kind', el).value, n: $('#p-n', el).value }); };
    ['#p-to', '#p-kind', '#p-n'].forEach(s => $(s, el).onchange = go);
  },
  acctLink(a, from, to) { return `<a href="#/reports/gl-details?acc=${a.id}&from=${from || ''}&to=${to || ''}">${E(a.code)} · ${E(a.name)}</a>`; },
};

route('/reports', (el) => {
  const sections = MENU.find(m => m.label === 'Reports').items.filter(x => x !== '-');
  const flat = (items) => items.flatMap(i => i === '-' ? [] : Array.isArray(i) ? [i] : i.items ? flat(i.items) : [[i.label, i.href]]);
  el.innerHTML = `${UI.pageHead('Reports')}<div class="grid g3">${sections.map(s => `<div class="card"><h2>${E(t(s.label))}</h2><ul style="padding-left:18px;line-height:1.9">${(s.items ? flat(s.items) : [[s.label, s.href]]).map(([l, h]) => `<li><a href="${h}">${E(t(l))}</a></li>`).join('')}</ul></div>`).join('')}
    <div class="card"><h2>${E(t('Sales'))} / ${E(t('Purchases'))}</h2><ul style="padding-left:18px;line-height:1.9"><li><a href="#/reports/sales">Sales Report</a></li><li><a href="#/reports/purchases">Purchases Report</a></li></ul></div></div>`;
});

/* ---------------- Ageing ---------------- */
route('/reports/ageing/:which', (el, q, which) => {
  const side = which.startsWith('ar') ? 'sales' : 'purchases';
  const detail = which.endsWith('details');
  const asOf = q.asof || U.today();
  const ag = C.aging(side, asOf);
  const party = side === 'sales' ? 'Customer' : 'Supplier';
  const title = `Aged ${side === 'sales' ? 'Receivables' : 'Payables'} ${detail ? 'Details' : 'Summary'}`;
  const bk = ['current', 'd30', 'd60', 'd90', 'd90p'], bl = ['Current', '1–30', '31–60', '61–90', '> 90'];
  let body;
  if (!detail) {
    const rows = {};
    ag.rows.forEach(r => { const a = rows[r.doc.contactId] = rows[r.doc.contactId] || { id: r.doc.contactId, total: 0, current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 }; a[r.bucket] += r.bal; a.total += r.bal; });
    body = UI.table([
      { label: party, render: r => `<a href="#/reports/ledger/${side === 'sales' ? 'customer' : 'supplier'}?contact=${r.id}">${E(C.contactName(r.id))}</a>` },
      ...bk.map((b, i) => ({ label: bl[i], cls: 'num', render: r => U.amt(r[b]) })),
      { label: 'Total', cls: 'num', render: r => `<b>${U.amt(r.total)}</b>` },
    ], Object.values(rows).sort((a, b) => b.total - a.total), { empty: 'Nothing outstanding.', foot: `<tr><td>${E(t('Total'))}</td>${bk.map(b => `<td class="num">${U.amt(ag.buckets[b])}</td>`).join('')}<td class="num">${U.amt(U.sum(Object.values(ag.buckets)))}</td></tr>` });
  } else {
    const rows = ag.rows.sort((a, b) => C.contactName(a.doc.contactId).localeCompare(C.contactName(b.doc.contactId)) || a.doc.date.localeCompare(b.doc.date));
    body = UI.table([
      { label: party, render: r => E(C.contactName(r.doc.contactId)) },
      { label: 'Document', render: r => `<a href="#/doc/${r.doc.id}">${E(r.doc.number)}</a> <span class="small muted">${E(t(C.docTitle(r.doc)))}</span>` },
      { label: 'Date', render: r => U.fdate(r.doc.date) },
      { label: 'Due Date', render: r => U.fdate(r.doc.dueDate) },
      { label: 'Days overdue', cls: 'num', render: r => r.late > 0 ? `<span class="text-red">${r.late}</span>` : '—' },
      ...bk.map((b, i) => ({ label: bl[i], cls: 'num', render: r => r.bucket === b ? U.amt(r.bal) : '' })),
    ], rows, { href: r => '#/doc/' + r.doc.id, empty: 'Nothing outstanding.', foot: `<tr><td colspan="5">${E(t('Total'))}</td>${bk.map(b => `<td class="num">${U.amt(ag.buckets[b])}</td>`).join('')}</tr>` });
  }
  const tabs = [['ar-summary', 'Aged Receivables Summary'], ['ar-details', 'Aged Receivables Details'], ['ap-summary', 'Aged Payables Summary'], ['ap-details', 'Aged Payables Details']];
  el.innerHTML = `${R.head(title)}<div class="tabs no-print">${tabs.map(([k, l]) => `<a href="#/reports/ageing/${k}?asof=${asOf}" class="${k === which ? 'active' : ''}">${E(t(l))}</a>`).join('')}</div>
    ${R.asOfFilter(asOf)}<div class="card">${R.title(title, 'As of ' + U.fdate(asOf) + ` · amounts in ${E(DB.data.settings.baseCurrency)}`)}${body}</div>`;
  R.bindAsOf(el, q); R.finish(el, which);
});

/* ---------------- Banking reconciliation report ---------------- */
route('/reports/banking/reconciliation', (el, q) => {
  const acc = q.acc || (DB.data.bankAccounts[0] || {}).id;
  const a = C.account(acc);
  const recs = DB.data.reconciliations.filter(r => r.bankAccountId === acc).sort((x, y) => y.statementDate.localeCompare(x.statementDate));
  const sel = recs.find(r => r.id === q.rec) || recs[0];
  let detail = '<p class="muted">No reconciliation selected.</p>';
  if (sel && a) {
    const entries = C.bankEntries(acc);
    const items = entries.filter(e => sel.keys.includes(e.key));
    const outstanding = entries.filter(e => !e.reconciled && e.date <= sel.statementDate);
    const book = C.bankBalance(acc, sel.statementDate);
    detail = `${R.title('Bank Reconciliation', `${E(a.name)} · Statement ${U.fdate(sel.statementDate)}`)}
      <table class="fin" style="max-width:560px;margin:0 auto 18px"><tbody>
        <tr><td>Balance per bank statement</td><td class="num">${U.amt(sel.statementBalance)}</td></tr>
        <tr><td class="ind">Add: deposits not yet on statement</td><td class="num">${U.amt(U.sum(outstanding.filter(e => e.amount > 0), e => e.amount))}</td></tr>
        <tr><td class="ind">Less: withdrawals not yet on statement</td><td class="num">(${U.amt(-U.sum(outstanding.filter(e => e.amount < 0), e => e.amount))})</td></tr>
        <tr class="sub"><td>Adjusted bank balance</td><td class="num">${U.amt(sel.statementBalance + U.sum(outstanding, e => e.amount))}</td></tr>
        <tr class="grand"><td>Balance per books at ${U.fdate(sel.statementDate)}</td><td class="num">${U.amt(book)}</td></tr>
      </tbody></table>
      <h3>Cleared in this reconciliation (${items.length})</h3>
      ${UI.table([{ label: 'Date', render: e => U.fdate(e.date) }, { label: 'Reference', render: e => E(e.ref) }, { label: 'Description', render: e => E(e.desc) }, { label: 'Amount', cls: 'num', render: e => U.amt(e.amount) }], items)}
      <h3 class="mt">Outstanding items (${outstanding.length})</h3>
      ${UI.table([{ label: 'Date', render: e => U.fdate(e.date) }, { label: 'Reference', render: e => E(e.ref) }, { label: 'Description', render: e => E(e.desc) }, { label: 'Amount', cls: 'num', render: e => U.amt(e.amount) }], outstanding, { empty: 'None' })}`;
  }
  el.innerHTML = `${R.head('Reconciliation', [['Reports', '#/reports']])}
    <div class="filters no-print">${UI.field('Account', UI.select('', UI.accountOptions(), acc, 'id="r-acc"'))}${UI.field('Statement', UI.select('', recs.map(r => [r.id, `${U.fdate(r.statementDate)} · ${U.amt(r.statementBalance)}`]), sel?.id, 'id="r-rec"'))}</div>
    <div class="card">${detail}</div>`;
  $('#r-acc', el).onchange = e => { location.hash = '#/reports/banking/reconciliation?acc=' + e.target.value; };
  const rr = $('#r-rec', el); if (rr) rr.onchange = e => { location.hash = `#/reports/banking/reconciliation?acc=${acc}&rec=${e.target.value}`; };
  R.finish(el, 'reconciliation');
});

/* ---------------- Financial statements ---------------- */
function plRows(pl, from, to) {
  const sec = (title, items, total, label) => `<tr class="sec"><td colspan="2">${E(t(title))}</td></tr>${items.map(x => `<tr><td class="ind">${R.acctLink(x.a, from, to)}</td><td class="num">${U.amt(x.v)}</td></tr>`).join('')}<tr class="sub"><td>${E(label)}</td><td class="num">${U.amt(total)}</td></tr>`;
  return `<table class="fin"><tbody>
    ${sec('Income', pl.income, pl.totalIncome, 'Total Income')}
    ${sec('Cost of Sales', pl.cogs, pl.totalCogs, 'Total Cost of Sales')}
    <tr class="sub"><td>${E(t('Gross Profit'))}</td><td class="num">${U.amt(pl.gross)}</td></tr>
    ${sec('Expenses', pl.expense, pl.totalExpense, 'Total Expenses')}
    <tr class="grand"><td>${E(t('Net Profit'))}</td><td class="num ${pl.net < 0 ? 'text-red' : ''}">${U.amt(pl.net)}</td></tr>
  </tbody></table>`;
}
route('/reports/pl', (el, q) => {
  const [from, to] = R.range(q);
  const pl = C.pl(from, to);
  el.innerHTML = `${R.head('Standard Profit & Loss')}${UI.dateFilter(from, to)}<div class="card">${R.title('Profit & Loss', R.periodLabel(from, to))}${plRows(pl, from, to)}</div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  R.finish(el, 'profit-loss');
});
route('/reports/pl-multi', (el, q) => {
  const ps = R.periods(q.to || U.today(), q.kind || 'month', +(q.n || 6));
  const pls = ps.map(p => C.pl(p.from, p.to));
  const accs = DB.data.accounts.filter(a => PL_TYPES.includes(a.type) && pls.some(pl => [...pl.income, ...pl.cogs, ...pl.expense].some(x => x.a.id === a.id)));
  const val = (pl, a) => { const x = [...pl.income, ...pl.cogs, ...pl.expense].find(y => y.a.id === a.id); return x ? x.v : 0; };
  const sec = (type, title, totalKey) => {
    const list = accs.filter(a => a.type === type);
    return `<tr class="sec"><td colspan="${ps.length + 2}">${E(t(title))}</td></tr>${list.map(a => `<tr><td class="ind">${E(a.code)} · ${E(a.name)}</td>${pls.map(pl => `<td class="num">${U.amt(val(pl, a))}</td>`).join('')}<td class="num"><b>${U.amt(U.sum(pls, pl => val(pl, a)))}</b></td></tr>`).join('')}
      <tr class="sub"><td>Total ${E(t(title))}</td>${pls.map(pl => `<td class="num">${U.amt(pl[totalKey])}</td>`).join('')}<td class="num">${U.amt(U.sum(pls, pl => pl[totalKey]))}</td></tr>`;
  };
  el.innerHTML = `${R.head('Multi-Period Profit & Loss')}${R.periodFilter(q)}
    <div class="card">${R.title('Profit & Loss', `${E(ps[0].label)} to ${E(ps[ps.length - 1].label)}`)}<div class="table-wrap"><table class="fin">
      <thead><tr><th>${E(t('Account'))}</th>${ps.map(p => `<th class="num">${E(p.label)}</th>`).join('')}<th class="num">${E(t('Total'))}</th></tr></thead><tbody>
      ${sec('income', 'Income', 'totalIncome')}${sec('cogs', 'Cost of Sales', 'totalCogs')}
      <tr class="sub"><td>${E(t('Gross Profit'))}</td>${pls.map(pl => `<td class="num">${U.amt(pl.gross)}</td>`).join('')}<td class="num">${U.amt(U.sum(pls, pl => pl.gross))}</td></tr>
      ${sec('expense', 'Expenses', 'totalExpense')}
      <tr class="grand"><td>${E(t('Net Profit'))}</td>${pls.map(pl => `<td class="num">${U.amt(pl.net)}</td>`).join('')}<td class="num">${U.amt(U.sum(pls, pl => pl.net))}</td></tr>
    </tbody></table></div></div>`;
  R.bindPeriod(el, q); R.finish(el, 'profit-loss-multi');
});

function bsRows(bs, asOf) {
  const sec = (title, items, extra, total, label) => `<tr class="sec"><td colspan="2">${E(t(title))}</td></tr>${items.map(x => `<tr><td class="ind">${R.acctLink(x.a, '', asOf)}</td><td class="num">${U.amt(x.v)}</td></tr>`).join('')}${extra}<tr class="sub"><td>${E(label)}</td><td class="num">${U.amt(total)}</td></tr>`;
  const diff = U.r2(bs.totalAssets - bs.totalLiabilities - bs.totalEquity);
  return `<table class="fin"><tbody>
    ${sec('Assets', bs.assets, '', bs.totalAssets, 'Total Assets')}
    ${sec('Liabilities', bs.liabilities, '', bs.totalLiabilities, 'Total Liabilities')}
    ${sec('Equity', bs.equity, `${Math.abs(bs.prior) >= 0.005 ? `<tr><td class="ind">Retained earnings (prior years)</td><td class="num">${U.amt(bs.prior)}</td></tr>` : ''}<tr><td class="ind">Current year earnings</td><td class="num">${U.amt(bs.current)}</td></tr>`, bs.totalEquity, 'Total Equity')}
    <tr class="grand"><td>Total Liabilities & Equity</td><td class="num">${U.amt(bs.totalLiabilities + bs.totalEquity)}</td></tr>
  </tbody></table>${Math.abs(diff) >= 0.01 ? `<div class="alert err mt">Out of balance by ${U.amt(diff)}</div>` : '<p class="small text-green right mt">✔ Assets = Liabilities + Equity</p>'}`;
}
route('/reports/balance-sheet', (el, q) => {
  const asOf = q.asof || U.today();
  el.innerHTML = `${R.head('Standard Balance Sheet')}${R.asOfFilter(asOf)}<div class="card">${R.title('Balance Sheet', 'As of ' + U.fdate(asOf))}${bsRows(C.bs(asOf), asOf)}</div>`;
  R.bindAsOf(el, q); R.finish(el, 'balance-sheet');
});
route('/reports/balance-sheet-multi', (el, q) => {
  const ps = R.periods(q.to || U.today(), q.kind || 'month', +(q.n || 6));
  const bss = ps.map(p => C.bs(p.to));
  const accs = type => DB.data.accounts.filter(a => a.type === type && bss.some(b => [...b.assets, ...b.liabilities, ...b.equity].some(x => x.a.id === a.id)));
  const val = (b, a) => { const x = [...b.assets, ...b.liabilities, ...b.equity].find(y => y.a.id === a.id); return x ? x.v : 0; };
  const sec = (type, title, totalKey, extra = '') => `<tr class="sec"><td colspan="${ps.length + 1}">${E(t(title))}</td></tr>${accs(type).map(a => `<tr><td class="ind">${E(a.code)} · ${E(a.name)}</td>${bss.map(b => `<td class="num">${U.amt(val(b, a))}</td>`).join('')}</tr>`).join('')}${extra}<tr class="sub"><td>Total ${E(t(title))}</td>${bss.map(b => `<td class="num">${U.amt(b[totalKey])}</td>`).join('')}</tr>`;
  el.innerHTML = `${R.head('Multi-Period Balance Sheet')}${R.periodFilter(q)}
    <div class="card">${R.title('Balance Sheet', 'Period ends')}<div class="table-wrap"><table class="fin">
      <thead><tr><th>${E(t('Account'))}</th>${ps.map(p => `<th class="num">${U.fdate(p.to)}</th>`).join('')}</tr></thead><tbody>
      ${sec('asset', 'Assets', 'totalAssets')}${sec('liability', 'Liabilities', 'totalLiabilities')}
      ${sec('equity', 'Equity', 'totalEquity', `<tr><td class="ind">Retained earnings + current year</td>${bss.map(b => `<td class="num">${U.amt(b.prior + b.current)}</td>`).join('')}</tr>`)}
      <tr class="grand"><td>Total Liabilities & Equity</td>${bss.map(b => `<td class="num">${U.amt(b.totalLiabilities + b.totalEquity)}</td>`).join('')}</tr>
    </tbody></table></div></div>`;
  R.bindPeriod(el, q); R.finish(el, 'balance-sheet-multi');
});

route('/reports/trial-balance', (el, q) => {
  const asOf = q.asof || U.today();
  const b = C.balances('', asOf);
  const fy = U.fyStart(asOf);
  // Close prior-year P&L into retained earnings for presentation
  const priorPL = C.balances('', U.addDays(fy, -1));
  const rows = DB.data.accounts.map(a => {
    let v = b[a.id] || 0;
    if (PL_TYPES.includes(a.type)) v -= priorPL[a.id] || 0;
    return { a, v };
  });
  const re = rows.find(r => r.a.sys === 'retained');
  if (re) re.v += U.sum(DB.data.accounts.filter(a => PL_TYPES.includes(a.type)), a => priorPL[a.id] || 0);
  const list = rows.filter(r => Math.abs(r.v) >= 0.005).sort((x, y) => x.a.code.localeCompare(y.a.code));
  const dr = U.sum(list.filter(r => r.v > 0), r => r.v), cr = -U.sum(list.filter(r => r.v < 0), r => r.v);
  el.innerHTML = `${R.head('Trial Balance')}${R.asOfFilter(asOf)}<div class="card">${R.title('Trial Balance', 'As of ' + U.fdate(asOf))}
    ${UI.table([
      { label: 'Code', render: r => E(r.a.code) },
      { label: 'Account', render: r => `<a href="#/reports/gl-details?acc=${r.a.id}&to=${asOf}">${E(r.a.name)}</a>` },
      { label: 'Type', render: r => E(ACCOUNT_TYPES[r.a.type]) },
      { label: 'Debit', cls: 'num', render: r => r.v > 0 ? U.amt(r.v) : '' },
      { label: 'Credit', cls: 'num', render: r => r.v < 0 ? U.amt(-r.v) : '' },
    ], list, { empty: 'No transactions yet.', foot: `<tr><td colspan="3">${E(t('Total'))} ${Math.abs(dr - cr) < 0.01 ? '<span class="text-green small">✔ balanced</span>' : '<span class="text-red small">✘ not balanced</span>'}</td><td class="num">${U.amt(dr)}</td><td class="num">${U.amt(cr)}</td></tr>` })}</div>`;
  R.bindAsOf(el, q); R.finish(el, 'trial-balance');
});

route('/reports/cash-flow', (el, q) => {
  const [from, to] = R.range(q);
  const banks = new Set(DB.data.bankAccounts.map(b => b.glAccountId));
  const L = C.ledger();
  const opening = U.r2(U.sum(L.filter(e => banks.has(e.accountId) && (e.date < (from || '0000') || (e.txnId.startsWith('open:') && U.inRange(e.date, from, to)))), e => e.debit - e.credit));
  const move = {};
  L.forEach(e => { if (!U.inRange(e.date, from, to) || e.txnId.startsWith('open:') || banks.has(e.accountId)) return; move[e.accountId] = (move[e.accountId] || 0) + e.debit - e.credit; });
  const pl = C.pl(from, to);
  // P&L movement excluding opening entries
  const groups = { operating: [], investing: [], financing: [] };
  DB.data.accounts.forEach(a => {
    if (!BS_TYPES.includes(a.type) || banks.has(a.id) || !move[a.id]) return;
    const cash = -move[a.id];
    if (Math.abs(cash) < 0.005) return;
    groups[a.cf === 'investing' ? 'investing' : a.cf === 'financing' || a.type === 'equity' ? 'financing' : 'operating'].push({ a, v: cash });
  });
  const netPL = -U.sum(DB.data.accounts.filter(a => PL_TYPES.includes(a.type)), a => move[a.id] || 0);
  const op = netPL + U.sum(groups.operating, x => x.v), inv = U.sum(groups.investing, x => x.v), fin = U.sum(groups.financing, x => x.v);
  // An asset rising uses cash; a liability / equity rising provides cash.
  const label = x => {
    if (x.a.sys === 'accDep') return 'Add back: depreciation';
    const up = x.a.type === 'asset' ? x.v < 0 : x.v > 0;
    return `${up ? 'Increase' : 'Decrease'} in ${E(x.a.name)}`;
  };
  const rows = (list) => list.map(x => `<tr><td class="ind">${label(x)}</td><td class="num">${U.amt(x.v)}</td></tr>`).join('');
  const closing = U.r2(opening + op + inv + fin);
  void pl;
  el.innerHTML = `${R.head('Cash Flow Statement')}${UI.dateFilter(from, to)}<div class="card">${R.title('Cash Flow Statement', R.periodLabel(from, to) + ' · indirect method')}
    <table class="fin"><tbody>
      <tr class="sec"><td colspan="2">Operating activities</td></tr>
      <tr><td class="ind">${E(t('Net Profit'))}</td><td class="num">${U.amt(netPL)}</td></tr>
      ${rows(groups.operating.sort((a, b) => (b.a.sys === 'accDep') - (a.a.sys === 'accDep')))}
      <tr class="sub"><td>Net cash from operating activities</td><td class="num">${U.amt(op)}</td></tr>
      <tr class="sec"><td colspan="2">Investing activities</td></tr>${rows(groups.investing)}
      <tr class="sub"><td>Net cash from investing activities</td><td class="num">${U.amt(inv)}</td></tr>
      <tr class="sec"><td colspan="2">Financing activities</td></tr>${rows(groups.financing)}
      <tr class="sub"><td>Net cash from financing activities</td><td class="num">${U.amt(fin)}</td></tr>
      <tr class="sub"><td>Net change in cash</td><td class="num">${U.amt(op + inv + fin)}</td></tr>
      <tr><td>Cash at beginning of period</td><td class="num">${U.amt(opening)}</td></tr>
      <tr class="grand"><td>Cash at end of period</td><td class="num">${U.amt(closing)}</td></tr>
    </tbody></table>
    ${Math.abs(closing - U.sum(DB.data.bankAccounts, b => C.bankBalance(b.id, to))) < 0.01 ? '<p class="small text-green right mt">✔ Agrees to bank balances</p>' : ''}</div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  R.finish(el, 'cash-flow');
});

route('/reports/gl-summary', (el, q) => {
  const [from, to] = R.range(q);
  const open = from ? C.balances('', U.addDays(from, -1)) : {};
  const L = C.ledger().filter(e => U.inRange(e.date, from, to));
  const rows = DB.data.accounts.map(a => {
    const es = L.filter(e => e.accountId === a.id);
    const o = PL_TYPES.includes(a.type) && from && U.fyStart(from) === from ? 0 : (open[a.id] || 0);
    const dr = U.sum(es, e => e.debit), cr = U.sum(es, e => e.credit);
    return { a, o, dr, cr, c: o + dr - cr };
  }).filter(r => Math.abs(r.o) >= 0.005 || r.dr || r.cr).sort((x, y) => x.a.code.localeCompare(y.a.code));
  el.innerHTML = `${R.head('General Ledger Summary')}${UI.dateFilter(from, to)}<div class="card">${R.title('General Ledger Summary', R.periodLabel(from, to))}
    ${UI.table([
      { label: 'Account', render: r => R.acctLink(r.a, from, to) },
      { label: 'Opening', cls: 'num', render: r => U.amt(r.o) },
      { label: 'Debit', cls: 'num', render: r => U.amt(r.dr) },
      { label: 'Credit', cls: 'num', render: r => U.amt(r.cr) },
      { label: 'Closing', cls: 'num', render: r => `<b>${U.amt(r.c)}</b>` },
    ], rows, { empty: 'No transactions.', foot: `<tr><td colspan="2">${E(t('Total'))}</td><td class="num">${U.amt(U.sum(rows, r => r.dr))}</td><td class="num">${U.amt(U.sum(rows, r => r.cr))}</td><td></td></tr>` })}
    <p class="small muted">Balances shown as debit positive / credit negative.</p></div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  R.finish(el, 'gl-summary');
});

function ledgerTable(entries, opening) {
  let bal = opening;
  const rows = entries.map(e => { bal += e.debit - e.credit; return { ...e, bal }; });
  return UI.table([
    { label: 'Date', render: e => U.fdate(e.date) },
    { label: 'Type', render: e => E(t(e.source)) },
    { label: 'Number', render: e => `<a href="${e.link}">${E(e.number)}</a>` },
    { label: 'Description', render: e => { const cn = e.contactId ? C.contactName(e.contactId) : ''; return E(e.memo || '') + (cn && !(e.memo || '').includes(cn) ? `<div class="small muted">${E(cn)}</div>` : ''); } },
    { label: 'Debit', cls: 'num', render: e => e.debit ? U.amt(e.debit) : '' },
    { label: 'Credit', cls: 'num', render: e => e.credit ? U.amt(e.credit) : '' },
    { label: 'Balance', cls: 'num', render: e => U.amt(e.bal) },
  ], rows, { empty: 'No transactions in this period.', foot: `<tr><td colspan="4">Opening ${U.amt(opening)} · Closing</td><td class="num">${U.amt(U.sum(entries, e => e.debit))}</td><td class="num">${U.amt(U.sum(entries, e => e.credit))}</td><td class="num">${U.amt(bal)}</td></tr>` });
}
route('/reports/gl-details', (el, q) => {
  const [from, to] = R.range(q);
  const accs = q.acc ? [C.gl(q.acc)].filter(Boolean) : DB.data.accounts.slice().sort((a, b) => a.code.localeCompare(b.code));
  const open = from ? C.balances('', U.addDays(from, -1)) : {};
  const L = C.ledger().filter(e => U.inRange(e.date, from, to));
  const blocks = accs.map(a => {
    const es = L.filter(e => e.accountId === a.id);
    const o = PL_TYPES.includes(a.type) && from && U.fyStart(from) === from ? 0 : (open[a.id] || 0);
    if (!es.length && Math.abs(o) < 0.005) return '';
    return `<h3 class="mt">${E(a.code)} · ${E(a.name)}</h3>${ledgerTable(es, o)}`;
  }).join('');
  el.innerHTML = `${R.head('General Ledger Details')}${UI.dateFilter(from, to, UI.field('Account', UI.select('', UI.glOptions(null, 'All accounts'), q.acc, 'id="f-acc"')))}
    <div class="card">${R.title('General Ledger Details', R.periodLabel(from, to))}${blocks || '<p class="muted">No transactions.</p>'}</div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  $('#f-acc', el).onchange = e => { location.hash = UI.withQuery(q, { acc: e.target.value, from, to }); };
  R.finish(el, 'gl-details');
});
route('/reports/account-transactions', (el, q) => {
  const [from, to] = R.range(q, U.monthStart(U.today()));
  const L = C.ledger().filter(e => U.inRange(e.date, from, to) && (!q.acc || e.accountId === q.acc));
  el.innerHTML = `${R.head('Account Transactions')}${UI.dateFilter(from, to, UI.field('Account', UI.select('', UI.glOptions(null, 'All accounts'), q.acc, 'id="f-acc"')))}
    <div class="card">${R.title('Account Transactions', R.periodLabel(from, to))}<div class="filters no-print">${UI.searchBox()}</div>${UI.table([
      { label: 'Date', render: e => U.fdate(e.date) },
      { label: 'Account', render: e => E(C.glName(e.accountId)) },
      { label: 'Type', render: e => E(t(e.source)) },
      { label: 'Number', render: e => `<a href="${e.link}">${E(e.number)}</a>` },
      { label: 'Description', render: e => E(e.memo || '') },
      { label: 'Contact', render: e => E(e.contactId ? C.contactName(e.contactId) : '') },
      { label: 'Debit', cls: 'num', render: e => e.debit ? U.amt(e.debit) : '' },
      { label: 'Credit', cls: 'num', render: e => e.credit ? U.amt(e.credit) : '' },
    ], L, { empty: 'No transactions.', foot: `<tr><td colspan="6">${E(t('Total'))}</td><td class="num">${U.amt(U.sum(L, e => e.debit))}</td><td class="num">${U.amt(U.sum(L, e => e.credit))}</td></tr>` })}</div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  $('#f-acc', el).onchange = e => { location.hash = UI.withQuery(q, { acc: e.target.value, from, to }); };
  R.finish(el, 'account-transactions');
});
route('/reports/journal', (el, q) => {
  const [from, to] = R.range(q, U.monthStart(U.today()));
  const by = {};
  C.ledger().filter(e => U.inRange(e.date, from, to) && (!q.src || e.source === q.src)).forEach(e => { (by[e.txnId] = by[e.txnId] || []).push(e); });
  const txns = Object.values(by).sort((a, b) => a[0].date.localeCompare(b[0].date));
  const sources = [...new Set(C.ledger().map(e => e.source))].sort();
  el.innerHTML = `${R.head('Journal Entry')}${UI.dateFilter(from, to, UI.field('Source', UI.select('', [['', 'All'], ...sources], q.src || '', 'id="f-src"')))}
    <div class="card">${R.title('Journal Entries', R.periodLabel(from, to))}
    ${txns.length ? txns.map(ls => `<div style="margin-bottom:16px"><div class="small"><b>${U.fdate(ls[0].date)}</b> · ${E(t(ls[0].source))} · <a href="${ls[0].link}">${E(ls[0].number)}</a> <span class="muted">${E(ls[0].memo || '')}</span></div>
      <table class="fin"><tbody>${ls.map(e => `<tr><td class="${e.credit ? 'ind' : ''}">${E(C.glName(e.accountId))}</td><td class="num" style="width:140px">${e.debit ? U.amt(e.debit) : ''}</td><td class="num" style="width:140px">${e.credit ? U.amt(e.credit) : ''}</td></tr>`).join('')}</tbody></table></div>`).join('') : '<p class="muted">No entries.</p>'}</div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  $('#f-src', el).onchange = e => { location.hash = UI.withQuery(q, { src: e.target.value, from, to }); };
  R.finish(el, 'journal');
});

/* ---------------- Contact ledgers ---------------- */
route('/reports/ledger/:kind', (el, q, kind) => {
  const isC = kind === 'customer';
  const ctrl = C.sys(isC ? 'ar' : 'ap');
  const [from, to] = R.range(q, U.addMonths(U.today(), -3));
  const contacts = DB.data.contacts.filter(c => c.type === (isC ? 'customer' : 'supplier') || c.type === 'both').sort((a, b) => a.name.localeCompare(b.name));
  const ids = q.contact ? [q.contact] : contacts.map(c => c.id);
  const L = C.ledger().filter(e => e.accountId === ctrl);
  const sign = isC ? 1 : -1;
  const blocks = ids.map(id => {
    const opening = sign * U.sum(L.filter(e => e.contactId === id && from && e.date < from), e => e.debit - e.credit);
    const es = L.filter(e => e.contactId === id && U.inRange(e.date, from, to)).map(e => ({ ...e, debit: isC ? e.debit : e.credit, credit: isC ? e.credit : e.debit }));
    if (!es.length && Math.abs(opening) < 0.005) return '';
    return `<h3 class="mt"><a href="#/contacts/${id}">${E(C.contactName(id))}</a></h3>${ledgerTable(es, opening).replace(`>${t('Debit')}<`, `>${isC ? 'Invoiced' : 'Billed'}<`).replace(`>${t('Credit')}<`, '>Paid / credited<')}`;
  }).join('');
  el.innerHTML = `${R.head(isC ? 'Customer Ledger' : 'Supplier Ledger')}${UI.dateFilter(from, to, UI.field(isC ? 'Customer' : 'Supplier', UI.select('', [['', 'All'], ...contacts.map(c => [c.id, c.name])], q.contact || '', 'id="f-c"')))}
    <div class="card">${R.title(isC ? 'Customer Ledger' : 'Supplier Ledger', R.periodLabel(from, to) + ` · ${isC ? 'positive = customer owes you' : 'positive = you owe supplier'}`)}${blocks || '<p class="muted">No transactions.</p>'}</div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  $('#f-c', el).onchange = e => { location.hash = UI.withQuery(q, { contact: e.target.value, from, to }); };
  R.finish(el, kind + '-ledger');
});

/* ---------------- Inventory reports ---------------- */
route('/reports/inventory/:which', (el, q, which) => {
  const items = C.stockItems().sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));
  const inv = C.inv();
  const titles = { 'valuation-summary': 'Inventory Valuation Summary', 'valuation-details': 'Inventory Valuation Details', uom: 'Product UOM', items: 'Sale & Purchase Items', builds: 'Auto Build', locations: 'Inventory Location Summary', movement: 'Inventory Movement', forecast: 'Planning & Forecast', serial: 'Product Serial Number & Expiry Date', alert: 'Stock Alert' };
  const title = titles[which];
  if (!title) throw new Error('Unknown report');
  const [from, to] = R.range(q, U.monthStart(U.today()));
  const asOf = q.asof || U.today();
  let filt = '', body = '', sub = '';
  if (which === 'valuation-summary') {
    filt = R.asOfFilter(asOf); sub = 'As of ' + U.fdate(asOf);
    const rows = items.map(p => { const qy = C.stockQty(p.id, asOf), v = C.stockValue(p.id, asOf); return { p, qy, v, avg: qy > 0 ? v / qy : C.avgCost(p.id) }; });
    body = UI.table([
      { label: 'Code', render: r => E(r.p.code) }, { label: 'Product', render: r => `<a href="#/products/${r.p.id}">${E(r.p.name)}</a>` },
      { label: 'On hand', cls: 'num', render: r => `${U.qty(r.qy)} ${E(r.p.unit || '')}` }, { label: 'Avg cost', cls: 'num', render: r => U.amt(r.avg) },
      { label: 'Value', cls: 'num', render: r => U.amt(r.v) }, { label: '% of total', cls: 'num', render: r => (U.sum(rows, x => x.v) ? (r.v / U.sum(rows, x => x.v) * 100).toFixed(1) : '0') + '%' },
      { label: 'Retail value', cls: 'num', render: r => U.amt(Math.max(0, r.qy) * U.num(r.p.salePrice)) },
    ], rows, { foot: `<tr><td colspan="4">${E(t('Total'))}</td><td class="num">${U.amt(U.sum(rows, r => r.v))}</td><td></td><td class="num">${U.amt(U.sum(rows, r => Math.max(0, r.qy) * U.num(r.p.salePrice)))}</td></tr>` })
      + `<p class="small muted">GL Inventory account balance: ${U.amt(C.balances('', asOf)[C.sys('inventory')] || 0)}</p>`;
  } else if (which === 'valuation-details' || which === 'movement') {
    filt = UI.dateFilter(from, to, UI.field('Product', UI.select('', [['', 'All'], ...items.map(p => [p.id, p.name])], q.product || '', 'id="f-p"')));
    sub = R.periodLabel(from, to);
    const list = items.filter(p => !q.product || p.id === q.product);
    body = list.map(p => {
      const ms = C.productMoves(p.id);
      const before = ms.filter(m => from && m.date < from).pop();
      const inP = ms.filter(m => U.inRange(m.date, from, to));
      if (!inP.length && !before) return '';
      const oq = before ? before.balQty : 0, ov = before ? before.balValue : 0;
      return `<h3 class="mt">${E(p.code ? p.code + ' · ' : '')}${E(p.name)}</h3>` + UI.table([
        { label: 'Date', render: m => U.fdate(m.date) }, { label: 'Type', render: m => E(m.kind) }, { label: 'Reference', render: m => `<a href="${m.link}">${E(m.ref)}</a>` },
        ...(which === 'movement' ? [{ label: 'Location', render: m => E(C.location(m.loc)?.name || '') }] : []),
        { label: 'In', cls: 'num', render: m => m.qty > 0 ? U.qty(m.qty) : '' }, { label: 'Out', cls: 'num', render: m => m.qty < 0 ? U.qty(-m.qty) : '' },
        ...(which === 'valuation-details' ? [{ label: 'Cost', cls: 'num', render: m => U.amt(m.cost) }, { label: 'Value', cls: 'num', render: m => U.amt(m.balValue) }] : []),
        { label: 'Balance', cls: 'num', render: m => U.qty(m.balQty) },
      ], inP, { empty: 'No movement in period', foot: `<tr><td colspan="${which === 'movement' ? 4 : 3}">Opening ${U.qty(oq)}${which === 'valuation-details' ? ' @ ' + U.amt(ov) : ''}</td><td class="num">${U.qty(U.sum(inP.filter(m => m.qty > 0), m => m.qty))}</td><td class="num">${U.qty(-U.sum(inP.filter(m => m.qty < 0), m => m.qty))}</td>${which === 'valuation-details' ? `<td class="num">${U.amt(U.sum(inP, m => m.cost))}</td><td></td>` : ''}<td class="num">${U.qty(oq + U.sum(inP, m => m.qty))}</td></tr>` });
    }).join('') || '<p class="muted">No movements.</p>';
  } else if (which === 'uom') {
    const rows = DB.data.products.filter(p => p.type === 'product').flatMap(p => [{ p, u: { name: p.unit || 'unit', factor: 1, price: p.salePrice }, base: true }, ...(p.uoms || []).map(u => ({ p, u }))]);
    body = UI.table([
      { label: 'Product', render: r => r.base ? `<b>${E(r.p.name)}</b>` : '' }, { label: 'Unit', render: r => E(r.u.name) + (r.base ? ' <span class="badge">base</span>' : '') },
      { label: 'Base units', cls: 'num', render: r => U.qty(r.u.factor) }, { label: 'Price', cls: 'num', render: r => U.amt(r.u.price || U.num(r.p.salePrice) * r.u.factor) },
      { label: 'On hand (this unit)', cls: 'num', render: r => C.isStock(r.p) ? U.qty(C.stockQty(r.p.id) / r.u.factor) : '—' },
    ], rows, { empty: 'No products.' });
  } else if (which === 'items') {
    filt = UI.dateFilter(from, to); sub = R.periodLabel(from, to);
    const agg = {};
    DB.data.docs.forEach(d => {
      if (d.status === 'void' || !U.inRange(d.date, from, to)) return;
      const k = { invoice: ['sq', 'sa', 1], creditNote: ['sq', 'sa', -1], bill: ['pq', 'pa', 1], purchaseCreditNote: ['pq', 'pa', -1] }[d.type];
      if (!k) return;
      d.lines.forEach(l => {
        const key = l.productId || 'c:' + l.description;
        const a = agg[key] = agg[key] || { name: C.product(l.productId)?.name || l.description, code: C.product(l.productId)?.code || '', sq: 0, sa: 0, pq: 0, pa: 0, cogs: 0 };
        a[k[0]] += k[2] * U.num(l.qty) * (U.num(l.factor) || 1); a[k[1]] += k[2] * C.line(l).net * C.rate(d);
      });
      if (d.type === 'invoice' || d.type === 'creditNote') d.lines.forEach((l, i) => { const key = l.productId || 'c:' + l.description; agg[key].cogs += -(inv.costs[d.id + ':' + i] || 0); });
    });
    const rows = Object.values(agg).sort((a, b) => b.sa - a.sa);
    body = UI.table([
      { label: 'Code', render: r => E(r.code) }, { label: 'Item', render: r => E(r.name) },
      { label: 'Qty sold', cls: 'num', render: r => U.qty(r.sq) }, { label: 'Sales', cls: 'num', render: r => U.amt(r.sa) },
      { label: 'Cost of sales', cls: 'num', render: r => U.amt(r.cogs) }, { label: 'Margin', cls: 'num', render: r => r.sa ? `${U.amt(r.sa - r.cogs)} <span class="small muted">${((r.sa - r.cogs) / r.sa * 100).toFixed(0)}%</span>` : '' },
      { label: 'Qty purchased', cls: 'num', render: r => U.qty(r.pq) }, { label: 'Purchases', cls: 'num', render: r => U.amt(r.pa) },
    ], rows, { empty: 'No sales or purchases in this period.', foot: `<tr><td colspan="3">${E(t('Total'))}</td><td class="num">${U.amt(U.sum(rows, r => r.sa))}</td><td class="num">${U.amt(U.sum(rows, r => r.cogs))}</td><td class="num">${U.amt(U.sum(rows, r => r.sa - r.cogs))}</td><td></td><td class="num">${U.amt(U.sum(rows, r => r.pa))}</td></tr>` });
  } else if (which === 'builds') {
    filt = UI.dateFilter(from, to); sub = R.periodLabel(from, to);
    const list = DB.data.builds.filter(b => U.inRange(b.date, from, to));
    body = UI.table([
      { label: 'Date', render: b => U.fdate(b.date) }, { label: 'Number', render: b => E(b.number) }, { label: 'Type', render: b => b.mode === 'unbuild' ? 'Unbuild' : 'Build' },
      { label: 'Item', render: b => E(C.product(b.productId)?.name || '') }, { label: 'Qty', cls: 'num', render: b => U.qty(b.qty) },
      { label: 'Components', render: b => E(b.components.map(c => `${U.qty(c.qty * b.qty)} × ${C.product(c.productId)?.name || '?'}`).join(', ')) },
      { label: 'Cost', cls: 'num', render: b => U.amt(Math.abs(inv.costs['bld:' + b.id] || 0)) },
    ], list, { empty: 'No builds in this period.' });
  } else if (which === 'locations') {
    filt = R.asOfFilter(asOf); sub = 'As of ' + U.fdate(asOf);
    const locs = DB.data.locations;
    body = UI.table([
      { label: 'Product', render: p => `<a href="#/products/${p.id}">${E(p.name)}</a>` },
      ...locs.map(l => ({ label: l.name, cls: 'num', render: p => U.qty(C.stockQty(p.id, asOf, l.id)) })),
      { label: 'Total', cls: 'num', render: p => `<b>${U.qty(C.stockQty(p.id, asOf))}</b>` },
    ], items, { empty: 'No stock items.' });
  } else if (which === 'forecast') {
    const days = +(q.days || DB.data.inventorySettings.forecastDays || 90), lead = +(DB.data.inventorySettings.leadDays || 14);
    filt = `<div class="filters no-print">${UI.field('Sales history (days)', UI.select('', [30, 60, 90, 180, 365].map(n => [n, n]), days, 'id="f-days"'))}</div>`;
    sub = `Based on sales in the last ${days} days · supplier lead time ${lead} days`;
    const since = U.addDays(U.today(), -days);
    const rows = items.map(p => {
      const sold = -U.sum(C.productMoves(p.id).filter(m => m.date >= since && ['invoice', 'creditNote'].includes(m.docType)), m => m.qty);
      const daily = sold / days, qy = C.stockQty(p.id);
      const onOrder = U.sum(C.docs('purchaseOrder').filter(d => d.status === 'open'), d => U.sum(d.lines.filter(l => l.productId === p.id), l => U.num(l.qty) * (U.num(l.factor) || 1)));
      const cover = daily > 0 ? qy / daily : Infinity;
      const need = Math.max(0, Math.ceil(daily * (lead + 30) + C.lowStockLevel(p) - qy - onOrder));
      return { p, sold, daily, qy, onOrder, cover, need: Math.max(need, need > 0 ? U.num(p.reorderQty) : 0) };
    }).sort((a, b) => a.cover - b.cover);
    body = UI.table([
      { label: 'Product', render: r => `<a href="#/products/${r.p.id}">${E(r.p.name)}</a>` },
      { label: 'On hand', cls: 'num', render: r => U.qty(r.qy) }, { label: 'On order (open POs)', cls: 'num', render: r => U.qty(r.onOrder) },
      { label: `Sold (${days}d)`, cls: 'num', render: r => U.qty(r.sold) }, { label: 'Avg / day', cls: 'num', render: r => r.daily.toFixed(2) },
      { label: 'Days of cover', cls: 'num', render: r => isFinite(r.cover) ? `<span class="${r.cover < lead ? 'text-red' : ''}">${Math.floor(r.cover)}</span>` : '∞' },
      { label: 'Stock-out date', render: r => isFinite(r.cover) ? U.fdate(U.addDays(U.today(), Math.floor(r.cover))) : '—' },
      { label: 'Suggested order', cls: 'num', render: r => r.need ? `<b>${U.qty(r.need)}</b> ${r.p.components && r.p.components.length ? `<a class="no-print" href="#/inventory/builds?new=build&product=${r.p.id}">Build</a>` : `<a class="no-print" href="#/docs/purchaseOrder/new?product=${r.p.id}">PO</a>`}` : '—' },
    ], rows, { empty: 'No stock items.' });
  } else if (which === 'serial') {
    const groups = {};
    inv.moves.filter(m => m.batch || m.expiry).forEach(m => { const k = m.pid + '|' + (m.batch || '') + '|' + (m.expiry || ''); const g = groups[k] = groups[k] || { pid: m.pid, batch: m.batch, expiry: m.expiry, inQ: 0, outQ: 0, first: m.date }; if (m.qty > 0) g.inQ += m.qty; else g.outQ -= m.qty; });
    // outbound lines with a batch but no expiry: match to inbound batch
    Object.values(groups).forEach(g => { if (!g.expiry && g.inQ === 0) { const match = Object.values(groups).find(x => x !== g && x.pid === g.pid && x.batch === g.batch && x.expiry); if (match) { match.outQ += g.outQ; g.merged = true; } } });
    const rows = Object.values(groups).filter(g => !g.merged).sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
    const today = U.today();
    body = UI.table([
      { label: 'Product', render: g => E(C.product(g.pid)?.name || '') }, { label: 'Serial / batch', render: g => E(g.batch || '—') },
      { label: 'Received', render: g => U.fdate(g.first) }, { label: 'Expiry', render: g => g.expiry ? U.fdate(g.expiry) : '—' },
      { label: 'In', cls: 'num', render: g => U.qty(g.inQ) }, { label: 'Out', cls: 'num', render: g => U.qty(g.outQ) }, { label: 'Remaining', cls: 'num', render: g => `<b>${U.qty(g.inQ - g.outQ)}</b>` },
      { label: 'Status', render: g => !g.expiry ? '' : g.expiry < today ? UI.badge('expired') : g.expiry <= U.addDays(today, 30) ? '<span class="badge amber">Expiring soon</span>' : UI.badge('ok') },
    ], rows, { empty: 'No serial / batch numbers recorded. Enable "Track serial / batch" on a product, then enter them on bills, receive items or adjustments.' });
  } else if (which === 'alert') {
    const rows = items.map(p => ({ p, qy: C.stockQty(p.id), lvl: C.lowStockLevel(p) })).filter(r => r.qy <= r.lvl).sort((a, b) => a.qy - b.qy);
    body = UI.table([
      { label: 'Code', render: r => E(r.p.code) }, { label: 'Product', render: r => `<a href="#/products/${r.p.id}">${E(r.p.name)}</a>` },
      { label: 'On hand', cls: 'num', render: r => `<span class="${r.qy <= 0 ? 'text-red' : ''}">${U.qty(r.qy)}</span>` }, { label: 'Reorder level', cls: 'num', render: r => U.qty(r.lvl) },
      { label: 'Reorder qty', cls: 'num', render: r => U.qty(r.p.reorderQty || Math.max(r.lvl * 2 - r.qy, 1)) },
      { label: 'Status', render: r => r.qy <= 0 ? '<span class="badge red">Out of stock</span>' : '<span class="badge amber">Low</span>' },
      { label: '', cls: 'num no-print', render: r => r.p.components && r.p.components.length ? `<a class="btn sm" href="#/inventory/builds?new=build&product=${r.p.id}">Build</a>` : `<a class="btn sm" href="#/docs/purchaseOrder/new?product=${r.p.id}">Create PO</a>` },
    ], rows, { empty: 'All stock levels are above reorder level ✔' });
  }
  el.innerHTML = `${R.head(title)}${filt}<div class="card">${R.title(title, sub)}${body}</div>`;
  if ($('#f-from', el)) UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  R.bindAsOf(el, q);
  const fp = $('#f-p', el); if (fp) fp.onchange = e => { location.hash = UI.withQuery(q, { product: e.target.value, from, to }); };
  const fd = $('#f-days', el); if (fd) fd.onchange = e => { location.hash = UI.withQuery(q, { days: e.target.value }); };
  R.finish(el, which);
});

/* ---------------- Job reports ---------------- */
route('/reports/job/:which', (el, q, which) => {
  const titles = { activity: 'Job Activity', income: 'Job Income Statement', list: 'Job List', transactions: 'Job Transactions' };
  const title = titles[which];
  if (!title) throw new Error('Unknown report');
  const [from, to] = R.range(q, '');
  const jobs = DB.data.jobs;
  const L = C.ledger().filter(e => e.jobId && U.inRange(e.date, from, to) && (!q.job || e.jobId === q.job));
  const pnl = jobId => {
    const es = L.filter(e => e.jobId === jobId);
    const v = type => U.sum(es.filter(e => C.gl(e.accountId)?.type === type), e => e.debit - e.credit);
    const inc = -v('income'), cogs = v('cogs'), exp = v('expense');
    return { inc, cogs, exp, profit: inc - cogs - exp, es };
  };
  let body = '';
  const jobFilter = UI.field('Job', UI.select('', [['', 'All jobs'], ...jobs.map(j => [j.id, `${j.code} · ${j.name}`])], q.job || '', 'id="f-job"'));
  if (!jobs.length) body = `<div class="alert info">No jobs yet. Create jobs in <a href="#/control/jobs">Control Panel → Master Data → Job Tagging</a>, then tag documents, transactions and journals with them.</div>`;
  else if (which === 'list') {
    body = UI.table([
      { label: 'Code', render: j => `<b>${E(j.code)}</b>` }, { label: 'Name', render: j => E(j.name) },
      { label: 'Customer', render: j => E(j.contactId ? C.contactName(j.contactId) : '') },
      { label: 'Status', render: j => UI.badge(j.status === 'closed' ? 'closed' : 'active') },
      { label: 'Income', cls: 'num', render: j => U.amt(pnl(j.id).inc) }, { label: 'Costs', cls: 'num', render: j => U.amt(pnl(j.id).cogs + pnl(j.id).exp) },
      { label: 'Profit', cls: 'num', render: j => `<b>${U.amt(pnl(j.id).profit)}</b>` },
    ], jobs.filter(j => !q.job || j.id === q.job), { href: j => '#/reports/job/income?job=' + j.id });
  } else if (which === 'income') {
    body = jobs.filter(j => !q.job || j.id === q.job).map(j => {
      const r = pnl(j.id);
      const by = {}; r.es.forEach(e => { by[e.accountId] = (by[e.accountId] || 0) + e.debit - e.credit; });
      const rows = type => Object.entries(by).filter(([a]) => C.gl(a)?.type === type).map(([a, v]) => `<tr><td class="ind">${E(C.glName(a))}</td><td class="num">${U.amt(type === 'income' ? -v : v)}</td></tr>`).join('');
      return `<h3 class="mt">${E(j.code)} · ${E(j.name)}</h3><table class="fin"><tbody>
        <tr class="sec"><td colspan="2">${E(t('Income'))}</td></tr>${rows('income')}<tr class="sub"><td>Total income</td><td class="num">${U.amt(r.inc)}</td></tr>
        <tr class="sec"><td colspan="2">Costs</td></tr>${rows('cogs')}${rows('expense')}<tr class="sub"><td>Total costs</td><td class="num">${U.amt(r.cogs + r.exp)}</td></tr>
        <tr class="grand"><td>Job profit</td><td class="num">${U.amt(r.profit)}</td></tr></tbody></table>`;
    }).join('');
  } else if (which === 'activity') {
    const docs = DB.data.docs.filter(d => d.jobId && (!q.job || d.jobId === q.job) && U.inRange(d.date, from, to)).sort((a, b) => a.date.localeCompare(b.date));
    body = UI.table([
      { label: 'Job', render: d => E(C.job(d.jobId)?.code || '') }, { label: 'Date', render: d => U.fdate(d.date) },
      { label: 'Type', render: d => E(t(C.docTitle(d))) }, { label: 'Number', render: d => `<a href="#/doc/${d.id}">${E(d.number)}</a>` },
      { label: 'Contact', render: d => E(C.contactName(d.contactId)) }, { label: 'Status', render: d => UI.badge(C.status(d)) },
      { label: 'Amount', cls: 'num', render: d => U.amt(C.totals(d).net * C.rate(d) * (DOC_TYPES[d.type].isCredit ? -1 : 1)) },
    ], docs, { href: d => '#/doc/' + d.id, empty: 'No tagged documents.' });
  } else {
    body = UI.table([
      { label: 'Job', render: e => E(C.job(e.jobId)?.code || '') }, { label: 'Date', render: e => U.fdate(e.date) },
      { label: 'Type', render: e => E(t(e.source)) }, { label: 'Number', render: e => `<a href="${e.link}">${E(e.number)}</a>` },
      { label: 'Account', render: e => E(C.glName(e.accountId)) }, { label: 'Description', render: e => E(e.memo || '') },
      { label: 'Debit', cls: 'num', render: e => e.debit ? U.amt(e.debit) : '' }, { label: 'Credit', cls: 'num', render: e => e.credit ? U.amt(e.credit) : '' },
    ], L, { empty: 'No tagged transactions.' });
  }
  el.innerHTML = `${R.head(title)}<div class="tabs no-print">${Object.entries(titles).map(([k, l]) => `<a href="#/reports/job/${k}" class="${k === which ? 'active' : ''}">${E(t(l))}</a>`).join('')}</div>
    ${UI.dateFilter(from, to, jobFilter)}<div class="card">${R.title(title, R.periodLabel(from, to))}${body}</div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  $('#f-job', el).onchange = e => { location.hash = UI.withQuery(q, { job: e.target.value, from, to }); };
  R.finish(el, 'job-' + which);
});

/* ---------------- Budget vs actual ---------------- */
route('/reports/budget', (el, q) => {
  const fy = q.fy || U.fyStart(U.today());
  const fyEnd = U.addDays(U.addMonths(fy, 12), -1);
  const upTo = q.to || (U.today() < fyEnd ? U.today() : fyEnd);
  const monthsDone = Math.min(12, Math.max(0, (Number(upTo.slice(0, 4)) - Number(fy.slice(0, 4))) * 12 + Number(upTo.slice(5, 7)) - Number(fy.slice(5, 7)) + 1));
  const budgets = DB.data.budgets.filter(b => b.fy === fy);
  const bal = C.balances(fy, upTo);
  const rows = DB.data.accounts.filter(a => PL_TYPES.includes(a.type)).map(a => {
    const b = budgets.find(x => x.accountId === a.id);
    const months = b ? b.months.map(U.num) : Array(12).fill(0);
    const sign = a.type === 'income' ? -1 : 1;
    return { a, full: U.sum(months), ytd: U.sum(months.slice(0, monthsDone)), act: sign * (bal[a.id] || 0) };
  }).filter(r => r.full || r.act);
  const fyOpts = [-2, -1, 0, 1].map(n => U.addMonths(U.fyStart(U.today()), n * 12)).map(d => [d, `FY ${U.fdate(d)} – ${U.fdate(U.addDays(U.addMonths(d, 12), -1))}`]);
  const sec = (types, title) => {
    const list = rows.filter(r => types.includes(r.a.type));
    if (!list.length) return '';
    return `<tr class="sec"><td colspan="6">${E(t(title))}</td></tr>${list.map(r => {
      const v = r.act - r.ytd, good = r.a.type === 'income' ? v >= 0 : v <= 0;
      return `<tr><td class="ind">${E(r.a.code)} · ${E(r.a.name)}</td><td class="num">${U.amt(r.full)}</td><td class="num">${U.amt(r.ytd)}</td><td class="num">${U.amt(r.act)}</td><td class="num ${good ? 'text-green' : 'text-red'}">${U.amt(v)}</td><td class="num">${r.ytd ? (r.act / r.ytd * 100).toFixed(0) + '%' : '—'}</td></tr>`;
    }).join('')}`;
  };
  const sums = types => { const l = rows.filter(r => types.includes(r.a.type)); return { full: U.sum(l, r => r.full), ytd: U.sum(l, r => r.ytd), act: U.sum(l, r => r.act) }; };
  const pct = (a, b) => b ? (a / b * 100).toFixed(0) + '%' : '—';
  const totRow = (types, label) => {
    const s = sums(types), v = s.act - s.ytd, good = types.includes('income') ? v >= 0 : v <= 0;
    return `<tr class="sub"><td>${E(label)}</td><td class="num">${U.amt(s.full)}</td><td class="num">${U.amt(s.ytd)}</td><td class="num">${U.amt(s.act)}</td><td class="num ${good ? 'text-green' : 'text-red'}">${U.amt(v)}</td><td class="num">${pct(s.act, s.ytd)}</td></tr>`;
  };
  const netRow = () => {
    const i = sums(['income']), c = sums(['cogs', 'expense']);
    const full = i.full - c.full, ytd = i.ytd - c.ytd, act = i.act - c.act, v = act - ytd;
    return `<tr class="grand"><td>${E(t('Net Profit'))}</td><td class="num">${U.amt(full)}</td><td class="num">${U.amt(ytd)}</td><td class="num">${U.amt(act)}</td><td class="num ${v >= 0 ? 'text-green' : 'text-red'}">${U.amt(v)}</td><td class="num"></td></tr>`;
  };
  el.innerHTML = `${R.head('Budget vs Actual', [['Reports', '#/reports']])}
    <div class="filters no-print">${UI.field('Financial year', UI.select('', fyOpts, fy, 'id="f-fy"'))}${UI.field('Actual up to', `<input type="date" id="f-upto" value="${upTo}">`)}<a class="btn" href="#/control/budgets?fy=${fy}">Edit budgets</a></div>
    <div class="card">${R.title('Budget vs Actual', `${U.fdate(fy)} – ${U.fdate(upTo)} (${monthsDone} month(s))`)}
      ${rows.length ? `<div class="table-wrap"><table class="fin"><thead><tr><th>${E(t('Account'))}</th><th class="num">Full-year budget</th><th class="num">Budget to date</th><th class="num">${E(t('Actual'))}</th><th class="num">${E(t('Variance'))}</th><th class="num">% of budget</th></tr></thead><tbody>
      ${sec(['income'], 'Income')}${totRow(['income'], 'Total income')}${sec(['cogs'], 'Cost of Sales')}${sec(['expense'], 'Expenses')}${totRow(['cogs', 'expense'], 'Total costs')}${netRow()}</tbody></table></div>` : `<p class="muted">No budget for this year yet. <a href="#/control/budgets?fy=${fy}">Set up a budget</a>.</p>`}</div>`;
  $('#f-fy', el).onchange = e => { location.hash = '#/reports/budget?fy=' + e.target.value; };
  $('#f-upto', el).onchange = e => { location.hash = `#/reports/budget?fy=${fy}&to=${e.target.value}`; };
  R.finish(el, 'budget-vs-actual');
});

/* ---------------- Audit trail ---------------- */
route('/reports/audit', (el, q) => {
  const [from, to] = [q.from ?? U.addDays(U.today(), -30), q.to ?? U.today()];
  const me = q.user === 'me' ? Auth.userName() : q.user;
  const users = [...new Set(DB.data.audit.map(a => a.user))];
  const list = DB.data.audit.filter(a => U.inRange(a.t.slice(0, 10), from, to) && (!me || a.user === me) && (!q.entity || a.entity === q.entity)).slice().reverse();
  const ents = [...new Set(DB.data.audit.map(a => a.entity))].sort();
  el.innerHTML = `${R.head(q.user === 'me' ? 'My Transactions' : 'Audit Trail Report')}
    ${UI.dateFilter(from, to, UI.field('User', UI.select('', [['', 'All users'], ...users], me || '', 'id="f-u"')) + UI.field('Record', UI.select('', [['', 'All'], ...ents], q.entity || '', 'id="f-e"')))}
    <div class="card"><div class="filters no-print">${UI.searchBox()}</div>${UI.table([
      { label: 'Time', render: a => E(U.fdatetime(a.t)) },
      { label: 'User', render: a => E(a.user) },
      { label: 'Action', render: a => `<span class="badge ${a.action === 'Deleted' || a.action === 'Voided' ? 'red' : a.action === 'Created' ? 'green' : 'blue'}">${E(a.action)}</span>` },
      { label: 'Record', render: a => E(a.entity) },
      { label: 'Reference', render: a => E(a.ref) + (a.detail ? `<div class="small muted">${E(a.detail)}</div>` : '') },
    ], list, { empty: 'No activity in this period.' })}
    <p class="small muted">${list.length} entries · the last 5,000 changes are kept.</p></div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  $('#f-u', el).onchange = e => { location.hash = UI.withQuery(q, { user: e.target.value, from, to }); };
  $('#f-e', el).onchange = e => { location.hash = UI.withQuery(q, { entity: e.target.value, from, to }); };
  R.finish(el, 'audit-trail');
});
