'use strict';
/* =========================================================================
   SST: filing (returns), SST Details, SST Summary
   ========================================================================= */

function sstSummaryHtml(s) {
  const cat = id => C.taxCode(id)?.category || 'goods';
  const block = (title, by) => UI.table([
    { label: title, render: ([id]) => { const x = C.taxCode(id); return x ? `${E(x.code)} — ${E(x.name)}` : '?'; } },
    { label: 'Rate', cls: 'num', render: ([id]) => U.qty(C.taxCode(id)?.rate || 0) + '%' },
    { label: 'Taxable amount', cls: 'num', render: ([, v]) => U.amt(v.base) },
    { label: 'Tax', cls: 'num', render: ([, v]) => U.amt(v.tax) },
  ], Object.entries(by), { empty: 'None', foot: `<tr><td colspan="2">${E(t('Total'))}</td><td class="num">${U.amt(U.sum(Object.values(by), v => v.base))}</td><td class="num">${U.amt(U.sum(Object.values(by), v => v.tax))}</td></tr>` });
  const pick = (by, c) => Object.fromEntries(Object.entries(by).filter(([id]) => cat(id) === c));
  const goods = pick(s.by.output, 'goods'), serv = pick(s.by.output, 'service');
  return `<div class="grid g2">
      <div><h3>Part A — Sales tax (goods)</h3>${block('Tax code', goods)}</div>
      <div><h3>Part B — Service tax</h3>${block('Tax code', serv)}</div>
    </div>
    <div class="grid g2 mt">
      <div><h3>Input tax (purchases)${s.claimable ? '' : ' — for information only'}</h3>${block('Tax code', s.by.input)}
        ${s.claimable ? '' : '<p class="small muted">Not deducted: SST paid on purchases is included in the cost of stock and expenses.</p>'}</div>
      <div><div class="totals">
        <div class="row"><span>Sales tax (goods)</span><span>${U.amt(U.sum(Object.values(goods), v => v.tax))}</span></div>
        <div class="row"><span>Service tax</span><span>${U.amt(U.sum(Object.values(serv), v => v.tax))}</span></div>
        <div class="row"><span>Total output tax</span><span>${U.amt(s.output)}</span></div>
        ${s.claimable ? `<div class="row"><span>Less: input tax / deductions</span><span>−${U.amt(s.input)}</span></div>` : ''}
        <div class="row grand"><span>${s.net >= 0 ? 'Net tax payable' : 'Net tax refundable'}</span><span>${U.money(Math.abs(s.net))}</span></div>
      </div><p class="small muted">Input tax deduction is <b>${s.claimable ? 'on' : 'off'}</b> — change it in <a href="#/control/taxes">Control Panel → Taxes</a>.</p></div>
    </div>`;
}

function nextFilingPeriod() {
  const f = DB.data.taxSettings.filingFrequency || 1;
  const last = [...DB.data.taxFilings].sort((a, b) => b.periodTo.localeCompare(a.periodTo))[0];
  if (last) { const from = U.addDays(last.periodTo, 1); return [from, U.monthEnd(U.addMonths(from, f - 1))]; }
  const td = U.today();
  return [U.monthStart(U.addMonths(td, -(f - 1))), U.monthEnd(td)];
}

route('/sst-filing', (el, q) => {
  const [dFrom, dTo] = nextFilingPeriod();
  const from = q.from || dFrom, to = q.to || dTo;
  const s = C.taxSummary(from, to);
  const overlap = DB.data.taxFilings.find(f => !(to < f.periodFrom || from > f.periodTo));
  const list = [...DB.data.taxFilings].sort((a, b) => b.periodTo.localeCompare(a.periodTo));
  el.innerHTML = `${UI.pageHead('SST Filing', null, `<a class="btn" href="#/reports/sst/summary?from=${from}&to=${to}">${E(t('SST Summary'))}</a><a class="btn" href="#/reports/sst/details?from=${from}&to=${to}">${E(t('SST Details'))}</a>`)}
    ${DB.data.taxSettings.enabled ? '' : `<div class="alert warn">Tax is disabled. Enable it in <a href="#/control/taxes">Control Panel → Taxes</a>.</div>`}
    <div class="card">
      <div class="card-head"><h2>Prepare ${E(DB.data.taxSettings.taxName)} return (SST-02)</h2></div>
      <div class="filters">
        ${UI.field('Taxable period from', `<input type="date" id="p-from" value="${from}">`)}
        ${UI.field('Taxable period to', `<input type="date" id="p-to" value="${to}">`)}
        ${UI.field('Due date', `<input type="date" id="p-due" value="${U.monthEnd(U.addMonths(to, 1))}">`)}
      </div>
      ${overlap ? `<div class="alert warn">This period overlaps the return for ${U.fdate(overlap.periodFrom)} – ${U.fdate(overlap.periodTo)}.</div>` : ''}
      ${sstSummaryHtml(s)}
      <div class="btn-row mt" style="justify-content:flex-end"><button class="btn primary" id="save">Save tax return</button></div>
    </div>
    <div class="card"><h2>Tax returns</h2><div class="mt">${UI.table([
      { label: 'Period', render: f => `${U.fdate(f.periodFrom)} – ${U.fdate(f.periodTo)}` },
      { label: 'Due Date', render: f => U.fdate(f.dueDate) },
      { label: 'Output', cls: 'num', render: f => U.amt(f.output) },
      { label: 'Input', cls: 'num', render: f => U.amt(f.input) },
      { label: 'Net', cls: 'num', render: f => `<b>${U.amt(f.net)}</b>` },
      { label: 'Status', render: f => f.status === 'filed' ? UI.badge('filed') + `<div class="small muted">${U.fdate(f.filedDate)} ${E(f.ref || '')}</div>` : (f.dueDate < U.today() ? UI.badge('overdue') : UI.badge('open')) },
      { label: '', cls: 'num no-print', render: f => `${f.status !== 'filed' ? `<button class="btn sm success" data-file="${f.id}">Mark filed</button> ` : ''}<a class="btn sm" href="#/reports/sst/summary?from=${f.periodFrom}&to=${f.periodTo}">Report</a> <button class="btn sm danger" data-del="${f.id}">${E(t('Delete'))}</button>` },
    ], list, { empty: 'No tax returns saved yet.' })}</div></div>`;
  const go = () => { location.hash = `#/sst-filing?from=${$('#p-from', el).value}&to=${$('#p-to', el).value}`; };
  $('#p-from', el).onchange = go; $('#p-to', el).onchange = go;
  $('#save', el).onclick = () => {
    if (overlap && !confirm('This period overlaps an existing return. Save anyway?')) return;
    DB.upsert('taxFilings', { number: `SST ${from}–${to}`, periodFrom: from, periodTo: to, dueDate: $('#p-due', el).value, output: s.output, input: s.deductible, net: s.net, status: 'open', createdAt: new Date().toISOString() }, 'SST Return');
    UI.toast('Tax return saved', 'ok');
    location.hash = '#/sst-filing';
    render();
  };
  $$('[data-file]', el).forEach(b => b.onclick = () => {
    const f = DB.get('taxFilings', b.dataset.file);
    UI.modal('Mark return as filed', `<div class="form-grid">
      ${UI.field('Filed date', UI.input('filedDate', U.today(), 'type="date"'))}
      ${UI.field('Submission reference', UI.input('ref', ''))}
      <div class="field full">${UI.check('clear', 'Post journal to offset input tax against SST payable', f.input > 0)}</div>
      <div class="field full">${UI.check('pay', `Record payment of ${U.money(Math.max(0, f.net))} to the tax authority`, f.net > 0 && DB.data.bankAccounts.length)}</div>
      ${UI.field('Pay from', UI.select('acc', UI.accountOptions('—'), DB.data.bankAccounts[0]?.id || ''))}
    </div>`, {
      onSubmit(v) {
        if (v.pay && f.net > 0 && !v.acc) throw new Error('Choose an account to pay from');
        Object.assign(f, { status: 'filed', filedDate: v.filedDate, ref: v.ref });
        if (v.clear && f.input > 0) DB.data.journals.push({ id: U.uid(), number: DB.takeNumber('JV', DB.peekNumber('JV')), date: v.filedDate, ref: v.ref, memo: `SST return ${U.fdate(f.periodFrom)}–${U.fdate(f.periodTo)}: offset input tax`, lines: [{ accountId: C.sys('taxOut'), debit: f.input, credit: 0, description: 'Input tax offset' }, { accountId: C.sys('taxIn'), debit: 0, credit: f.input, description: 'Input tax offset' }] });
        if (v.pay && f.net > 0) DB.data.transactions.push({ id: U.uid(), number: DB.takeNumber('TXN', DB.peekNumber('TXN')), date: v.filedDate, bankAccountId: v.acc, type: 'out', amount: f.net, accountId: C.sys('taxOut'), description: `${DB.data.taxSettings.taxName} ${U.fdate(f.periodFrom)}–${U.fdate(f.periodTo)}`, ref: v.ref, taxCodeId: '', contactId: '' });
        DB.log('Filed', 'SST Return', f, v.ref); DB.save(); UI.toast('Marked as filed', 'ok'); render();
      },
    });
  });
  $$('[data-del]', el).forEach(b => b.onclick = () => { if (confirm('Delete this tax return record?')) { DB.remove('taxFilings', b.dataset.del, 'SST Return'); render(); } });
});
route('/tax/filing', () => { location.replace('#/sst-filing'); });
route('/tax', () => { location.replace('#/sst-filing'); });

route('/reports/sst/details', (el, q) => {
  const from = q.from ?? U.monthStart(U.today()), to = q.to ?? U.monthEnd(U.today());
  const side = q.side || 'all', source = q.source || 'all';
  let rows = C.taxLines(from, to);
  if (side !== 'all') rows = rows.filter(r => r.side === side);
  if (source === 'bank') rows = rows.filter(r => r.source === 'Bank Transaction');
  const qs = o => UI.withQuery(q, Object.assign({ from, to, side, source }, o));
  el.innerHTML = `${R.head('SST Details')}
    <div class="tabs no-print">
      <a href="${qs({ side: 'all', source: 'all' })}" class="${side === 'all' && source === 'all' ? 'active' : ''}">${E(t('All'))}</a>
      <a href="${qs({ side: 'output', source: 'all' })}" class="${side === 'output' && source === 'all' ? 'active' : ''}">${E(t('Sales'))} (output)</a>
      <a href="${qs({ side: 'input', source: 'all' })}" class="${side === 'input' && source === 'all' ? 'active' : ''}">${E(t('Purchases'))} (input)</a>
      <a href="${qs({ side: 'all', source: 'bank' })}" class="${source === 'bank' ? 'active' : ''}">${E(t('Transactions'))}</a>
    </div>
    ${UI.dateFilter(from, to)}
    <div class="card">${R.title('SST Details', R.periodLabel(from, to))}${UI.table([
      { label: 'Date', render: r => U.fdate(r.date) },
      { label: 'Type', render: r => E(t(r.source)) },
      { label: 'Reference', render: r => `<a href="${r.link}">${E(r.ref)}</a>` },
      { label: 'Contact', render: r => E(r.contact) },
      { label: 'Tax', render: r => E(C.taxCode(r.code)?.code || '') },
      { label: '', render: r => r.side === 'output' ? '<span class="badge blue">Output</span>' : '<span class="badge amber">Input</span>' },
      { label: 'Taxable amount', cls: 'num', render: r => U.amt(r.base) },
      { label: 'Tax', cls: 'num', render: r => U.amt(r.tax) },
    ], rows, { empty: 'No taxable transactions in this period.', foot: ['output', 'input'].filter(sd => rows.some(r => r.side === sd)).map(sd => {
      const rs = rows.filter(r => r.side === sd);
      return `<tr><td colspan="6">Total ${sd === 'output' ? 'output tax (sales)' : 'input tax (purchases)'}${sd === 'input' && !C.inputClaimable() ? ' — not deductible' : ''}</td><td class="num">${U.amt(U.sum(rs, r => r.base))}</td><td class="num">${U.amt(U.sum(rs, r => r.tax))}</td></tr>`;
    }).join('') })}</div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = qs({ from: f, to: t2 }); });
  R.finish(el, 'sst-details');
});
route('/reports/sst/summary', (el, q) => {
  const from = q.from ?? U.monthStart(U.today()), to = q.to ?? U.monthEnd(U.today());
  const s = C.taxSummary(from, to);
  const months = [];
  if (from && to) { let m = from.slice(0, 7); while (m <= to.slice(0, 7) && months.length < 24) { months.push(m); m = U.addMonths(m + '-01', 1).slice(0, 7); } }
  el.innerHTML = `${R.head('SST Summary')}${UI.dateFilter(from, to)}
    <div class="card">${R.title('SST Summary', R.periodLabel(from, to))}${sstSummaryHtml(s)}</div>
    ${months.length > 1 ? `<div class="card"><h2>By month</h2><div class="mt">${UI.table([
      { label: 'Month', render: m => U.monthLabel(m) },
      { label: 'Output', cls: 'num', render: m => U.amt(C.taxSummary(m + '-01', U.monthEnd(m + '-01')).output) },
      { label: 'Input', cls: 'num', render: m => U.amt(C.taxSummary(m + '-01', U.monthEnd(m + '-01')).input) },
      { label: 'Net', cls: 'num', render: m => `<b>${U.amt(C.taxSummary(m + '-01', U.monthEnd(m + '-01')).net)}</b>` },
    ], months)}</div></div>` : ''}`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = UI.withQuery(q, { from: f, to: t2 }); });
  R.finish(el, 'sst-summary');
});
route('/tax/report', (el, q) => { location.replace('#/reports/sst/summary'); });
route('/tax/detail', (el, q) => { location.replace('#/reports/sst/details'); });
route('/tax/settings', () => { location.replace('#/control/taxes'); });
