'use strict';
/* =========================================================================
   Transactions: bank accounts, deposits, withdrawals, transfers, journals,
   bank reconciliation, banking summary
   ========================================================================= */

function accountModal(a) {
  a = a || { openingDate: DB.data.openingBalances.date || U.today(), openingBalance: 0 };
  UI.modal(a.id ? 'Edit Bank Account' : 'New Bank / Cash Account', `<div class="form-grid">
    ${UI.field('Account name *', UI.input('name', a.name, 'placeholder="e.g. Maybank Current"'), 'full')}
    ${UI.field('Bank', UI.input('bank', a.bank, 'placeholder="Bank name or Cash"'))}
    ${UI.field('Account number', UI.input('accountNo', a.accountNo))}
    ${UI.field('Opening balance', UI.input('openingBalance', a.openingBalance, 'type="number" step="0.01"'))}
    ${UI.field('Opening date', UI.input('openingDate', a.openingDate, 'type="date"'))}
  </div>`, {
    onSubmit(v) {
      if (!v.name) throw new Error('Account name is required');
      Object.assign(a, v, { openingBalance: U.num(v.openingBalance) });
      if (!a.id) a.id = U.uid();
      let gl = a.glAccountId && C.gl(a.glAccountId);
      if (!gl) { gl = { id: 'a-bank-' + a.id, code: nextBankCode(DB.data), name: a.name, type: 'asset', sys: 'bank', cf: 'cash', active: true }; DB.data.accounts.push(gl); a.glAccountId = gl.id; }
      gl.name = a.name;
      DB.upsert('bankAccounts', a, 'Bank Account');
      UI.toast('Account saved', 'ok'); render();
    },
  });
}

route('/banking/accounts', (el, q) => {
  el.innerHTML = `${UI.pageHead('Bank Accounts', [['Transactions', '#/transactions']], `<button class="btn primary" id="new">+ New Account</button>`)}
    <div class="card">${UI.table([
      { label: 'Account', render: a => `<b>${E(a.name)}</b><div class="small muted">GL ${E(C.gl(a.glAccountId)?.code || '')}</div>` },
      { label: 'Bank', render: a => E(a.bank) },
      { label: 'Account no.', render: a => E(a.accountNo) },
      { label: 'Opening', cls: 'num', render: a => U.amt(a.openingBalance) },
      { label: 'Cleared', cls: 'num', render: a => U.amt(C.clearedBalance(a.id)) },
      { label: 'Balance', cls: 'num', render: a => `<b>${U.amt(C.bankBalance(a.id))}</b>` },
      { label: '', cls: 'num', render: a => `<a class="btn sm" href="#/transactions?acc=${a.id}">${E(t('Transactions'))}</a> <button class="btn sm" data-edit="${a.id}">${E(t('Edit'))}</button> <button class="btn sm danger" data-del="${a.id}">${E(t('Delete'))}</button>` },
    ], DB.data.bankAccounts, {
      empty: 'No accounts yet — add your bank and cash accounts.',
      foot: DB.data.bankAccounts.length ? `<tr><td colspan="5">${E(t('Total'))}</td><td class="num">${U.amt(C.totalCash())}</td><td></td></tr>` : '',
    })}</div>`;
  $('#new', el).onclick = () => accountModal();
  $$('[data-edit]', el).forEach(b => b.onclick = () => accountModal({ ...DB.get('bankAccounts', b.dataset.edit) }));
  $$('[data-del]', el).forEach(b => b.onclick = () => {
    const a = DB.get('bankAccounts', b.dataset.del);
    if (C.bankEntries(a.id).length || C.ledger().some(e => e.accountId === a.glAccountId && !e.txnId.startsWith('open:'))) return UI.toast('Account has transactions — cannot delete', 'err');
    if (confirm('Delete this account?')) { DB.data.accounts = DB.data.accounts.filter(x => x.id !== a.glAccountId); DB.remove('bankAccounts', a.id, 'Bank Account'); render(); }
  });
  if (q.new) { history.replaceState(null, '', '#/banking/accounts'); accountModal(); }
});

/* ---------------- Deposit / Withdrawal / Transfer ---------------- */
function txnModal(tx) {
  if (!DB.data.bankAccounts.length) { UI.toast('Add a bank account first', 'err'); location.hash = '#/banking/accounts?new=1'; return; }
  tx = tx || { date: U.today(), type: 'out', bankAccountId: DB.data.bankAccounts[0].id };
  const accs = UI.accountOptions();
  const title = { in: 'Deposit', out: 'Withdrawal', transfer: 'Transfer' };
  UI.modal(tx.id ? 'Edit ' + title[tx.type] : title[tx.type], `
    <div class="alert info small">For income & expenses not linked to an invoice or bill (rent, utilities, salaries, capital, loans, bank charges…). Customer and supplier payments are recorded against the invoice/bill.</div>
    <div class="form-grid">
      ${UI.field('Type', UI.select('type', [['in', 'Deposit (money in)'], ['out', 'Withdrawal (money out)'], ['transfer', 'Transfer between accounts']], tx.type))}
      ${UI.field('Date *', UI.input('date', tx.date, 'type="date"'))}
      ${UI.field('Bank account *', UI.select('bankAccountId', accs, tx.bankAccountId), 'f-acc')}
      ${UI.field('To account', UI.select('toAccountId', accs, tx.toAccountId || (accs[1] || accs[0])[0]), 'f-to')}
      ${UI.field('Amount *', UI.input('amount', tx.amount, 'type="number" step="0.01" min="0"'))}
      ${UI.field('Account (category) *', UI.select('accountId', UI.glOptions(null, 'Select…'), tx.accountId), 'f-gl')}
      ${UI.field('Tax (amount is tax-inclusive)', UI.select('taxCodeId', UI.taxOptions(), tx.taxCodeId), 'f-tax')}
      ${UI.field('Contact', UI.select('contactId', UI.contactOptions(null, '—'), tx.contactId), 'f-contact')}
      ${DB.data.jobs.length ? UI.field('Job', UI.select('jobId', UI.jobOptions(), tx.jobId), 'f-job') : ''}
      ${UI.field('Reference', UI.input('ref', tx.ref))}
      ${UI.field('Description', UI.input('description', tx.description), 'full')}
    </div>`, {
    onMount(m) {
      const sync = () => {
        const tr = $('select[name=type]', m).value === 'transfer';
        $$('.f-to', m).forEach(x => x.style.display = tr ? '' : 'none');
        $$('.f-gl,.f-tax,.f-contact,.f-job', m).forEach(x => x.style.display = tr ? 'none' : '');
        $('.f-acc label', m).textContent = tr ? 'From account *' : 'Bank account *';
      };
      $('select[name=type]', m).onchange = sync; sync();
    },
    onSubmit(v) {
      const amt = U.r2(U.num(v.amount));
      if (amt <= 0) throw new Error('Amount must be greater than zero');
      if (!v.date) throw new Error('Date is required');
      if (v.type === 'transfer') {
        if (v.toAccountId === v.bankAccountId) throw new Error('Choose two different accounts');
        Object.assign(v, { accountId: '', taxCodeId: '', contactId: '', jobId: '' });
      } else {
        if (!v.accountId) throw new Error('Choose the account (category) for this transaction');
        if (DB.data.bankAccounts.some(b => b.glAccountId === v.accountId)) throw new Error('Use a Transfer to move money between bank accounts');
        v.toAccountId = '';
      }
      if (!tx.number) tx.number = DB.takeNumber('TXN', DB.peekNumber('TXN'));
      DB.upsert('transactions', Object.assign(tx, v, { amount: amt }), title[v.type]);
      UI.toast('Transaction saved', 'ok'); render();
    },
  });
}

route('/transactions', (el, q) => {
  const tab = q.acc || (DB.data.bankAccounts[0] || {}).id || 'journals';
  const a = C.account(tab);
  let body = '';
  if (tab === 'journals') {
    const list = [...DB.data.journals].sort((x, y) => y.date.localeCompare(x.date));
    body = `<div class="card">${UI.table([
      { label: 'Date', render: j => U.fdate(j.date) },
      { label: 'Number', render: j => `<a href="#/transactions/journal/${j.id}"><b>${E(j.number)}</b></a>` },
      { label: 'Reference', render: j => E(j.ref || '') },
      { label: 'Description', render: j => E(j.memo || '') },
      { label: 'Accounts', render: j => E(j.lines.map(l => C.gl(l.accountId)?.code).join(', ')) },
      { label: 'Amount', cls: 'num', render: j => U.amt(U.sum(j.lines, l => U.num(l.debit))) },
    ], list, { href: j => '#/transactions/journal/' + j.id, empty: 'No journal entries yet.' })}</div>`;
  } else if (a) {
    let bal = U.num(a.openingBalance);
    const rows = C.bankEntries(a.id).map(e => { bal += e.amount; return { ...e, balance: bal }; }).reverse();
    body = `<div class="kpis">
      <div class="kpi"><div class="lbl">${E(t('Opening'))} ${U.fdate(a.openingDate)}</div><div class="val">${U.money(a.openingBalance)}</div></div>
      <div class="kpi"><div class="lbl">Money in</div><div class="val text-green">${U.money(U.sum(rows.filter(r => r.amount > 0), r => r.amount))}</div></div>
      <div class="kpi"><div class="lbl">Money out</div><div class="val text-red">${U.money(-U.sum(rows.filter(r => r.amount < 0), r => r.amount))}</div></div>
      <div class="kpi"><div class="lbl">${E(t('Balance'))}</div><div class="val">${U.money(C.bankBalance(a.id))}</div></div>
    </div>
    <div class="card"><div class="filters">${UI.searchBox()}</div>
      ${UI.table([
        { label: 'Date', render: r => U.fdate(r.date) },
        { label: 'Reference', render: r => E(r.ref) },
        { label: 'Description', render: r => E(r.desc) },
        { label: '', render: r => r.reconciled ? '<span title="Reconciled" class="text-green">✔</span>' : '' },
        { label: 'In', cls: 'num', render: r => r.amount > 0 ? `<span class="text-green">${U.amt(r.amount)}</span>` : '' },
        { label: 'Out', cls: 'num', render: r => r.amount < 0 ? `<span class="text-red">${U.amt(-r.amount)}</span>` : '' },
        { label: 'Balance', cls: 'num', render: r => U.amt(r.balance) },
        { label: '', cls: 'num no-print', render: r => r.source === 'txn' && !r.reconciled ? `<button class="btn sm" data-edit="${r.id}">${E(t('Edit'))}</button> <button class="btn sm danger" data-del="${r.id}">${E(t('Delete'))}</button>` : `<a class="btn sm" href="${r.link}">Open</a>` },
      ], rows, { empty: 'No transactions in this account yet.' })}
    </div>`;
  }
  el.innerHTML = `${UI.pageHead('Transactions List', null, `<a class="btn" href="#/banking/accounts">${E(t('Bank Accounts'))}</a><a class="btn" href="#/banking/reconcile${a ? '?acc=' + a.id : ''}">${E(t('Reconciliation'))}</a>
      <button class="btn" data-new="in">+ ${E(t('Deposit'))}</button><button class="btn" data-new="out">+ ${E(t('Withdrawal'))}</button><button class="btn" data-new="transfer">+ ${E(t('Transfer'))}</button><a class="btn primary" href="#/transactions/journal/new">+ ${E(t('Journal'))}</a>`)}
    ${DB.data.bankAccounts.length ? '' : `<div class="alert warn">No bank accounts yet. <a href="#/banking/accounts?new=1">Add one</a>.</div>`}
    <div class="tabs">${DB.data.bankAccounts.map(b => `<a href="#/transactions?acc=${b.id}" class="${b.id === tab ? 'active' : ''}">${E(b.name)}</a>`).join('')}<a href="#/transactions?acc=journals" class="${tab === 'journals' ? 'active' : ''}">${E(t('Journal'))}</a></div>
    ${body}`;
  $$('[data-new]', el).forEach(b => b.onclick = () => txnModal({ date: U.today(), type: b.dataset.new, bankAccountId: a ? a.id : (DB.data.bankAccounts[0] || {}).id }));
  $$('[data-edit]', el).forEach(b => b.onclick = () => txnModal({ ...DB.get('transactions', b.dataset.edit) }));
  $$('[data-del]', el).forEach(b => b.onclick = () => { if (confirm('Delete this transaction?')) { DB.remove('transactions', b.dataset.del, 'Transaction'); render(); } });
  if (q.new) { history.replaceState(null, '', '#/transactions' + (a ? '?acc=' + a.id : '')); txnModal({ date: U.today(), type: q.new, bankAccountId: a ? a.id : (DB.data.bankAccounts[0] || {}).id }); }
});
route('/banking/transactions', (el, q) => { location.replace('#/transactions' + (q.acc ? '?acc=' + q.acc : '')); });

/* ---------------- Journal entry ---------------- */
route('/transactions/journal/:id', (el, q, id) => {
  const isNew = id === 'new';
  const j = isNew ? { number: DB.peekNumber('JV'), date: U.today(), ref: '', memo: '', lines: [{ accountId: '', description: '', debit: '', credit: '' }, { accountId: '', description: '', debit: '', credit: '' }] } : JSON.parse(JSON.stringify(DB.get('journals', id) || null));
  if (!j) throw new Error('Journal not found');
  const hasJobs = DB.data.jobs.length > 0;
  el.innerHTML = `${UI.pageHead(isNew ? 'New Journal' : 'Journal ' + j.number, [['Transactions', '#/transactions?acc=journals']], isNew ? '' : `<button class="btn danger" id="del">${E(t('Delete'))}</button>`)}
    <form class="card" id="jf" novalidate>
      <div class="form-grid">
        ${UI.field('Number *', UI.input('number', j.number))}
        ${UI.field('Date *', UI.input('date', j.date, 'type="date"'))}
        ${UI.field('Reference', UI.input('ref', j.ref))}
        ${UI.field('Description', UI.input('memo', j.memo), 'full')}
      </div>
      <div class="table-wrap mt"><table class="lines-table"><thead><tr><th style="width:28%">${E(t('Account'))}</th><th>${E(t('Description'))}</th>${hasJobs ? `<th style="width:14%">${E(t('Job'))}</th>` : ''}<th class="num" style="width:13%">${E(t('Debit'))}</th><th class="num" style="width:13%">${E(t('Credit'))}</th><th style="width:4%"></th></tr></thead>
        <tbody id="jl"></tbody><tfoot><tr><td colspan="${hasJobs ? 3 : 2}">${E(t('Total'))} <span id="jdiff" class="small"></span></td><td class="num" id="jdr"></td><td class="num" id="jcr"></td><td></td></tr></tfoot></table></div>
      <div class="btn-row mt"><button type="button" class="btn" id="add">+ Add line</button><div style="flex:1"></div><a class="btn" href="#/transactions?acc=journals">${E(t('Cancel'))}</a><button class="btn primary">${E(t('Save'))}</button></div>
    </form>`;
  const tb = $('#jl', el);
  const draw = () => {
    tb.innerHTML = j.lines.map((l, i) => `<tr data-i="${i}">
      <td>${UI.select('', UI.glOptions(null, 'Select…'), l.accountId, 'data-f="accountId"')}</td>
      <td><input data-f="description" value="${E(l.description)}"></td>
      ${hasJobs ? `<td>${UI.select('', UI.jobOptions(), l.jobId, 'data-f="jobId"')}</td>` : ''}
      <td><input data-f="debit" type="number" step="0.01" min="0" class="right" value="${E(l.debit)}"></td>
      <td><input data-f="credit" type="number" step="0.01" min="0" class="right" value="${E(l.credit)}"></td>
      <td><button type="button" class="btn link" data-rm>✕</button></td></tr>`).join('');
    tot();
  };
  const tot = () => {
    const dr = U.r2(U.sum(j.lines, l => U.num(l.debit))), cr = U.r2(U.sum(j.lines, l => U.num(l.credit)));
    $('#jdr', el).textContent = U.amt(dr); $('#jcr', el).textContent = U.amt(cr);
    const d = $('#jdiff', el);
    d.textContent = Math.abs(dr - cr) < 0.005 ? '✔ balanced' : `out of balance by ${U.amt(Math.abs(dr - cr))}`;
    d.className = 'small ' + (Math.abs(dr - cr) < 0.005 ? 'text-green' : 'text-red');
  };
  tb.addEventListener('input', e => {
    const f = e.target.dataset.f; if (!f) return;
    const l = j.lines[+e.target.closest('tr').dataset.i];
    l[f] = e.target.value;
    if (f === 'debit' && U.num(l.debit)) { l.credit = ''; e.target.closest('tr').querySelector('[data-f=credit]').value = ''; }
    if (f === 'credit' && U.num(l.credit)) { l.debit = ''; e.target.closest('tr').querySelector('[data-f=debit]').value = ''; }
    tot();
  });
  tb.addEventListener('click', e => { if (e.target.closest('[data-rm]') && j.lines.length > 2) { j.lines.splice(+e.target.closest('tr').dataset.i, 1); draw(); } });
  $('#add', el).onclick = () => { j.lines.push({ accountId: '', description: '', debit: '', credit: '' }); draw(); };
  $('#jf', el).onsubmit = e => {
    e.preventDefault();
    try {
      const v = UI.formValues(e.target);
      const lines = j.lines.filter(l => l.accountId && (U.num(l.debit) || U.num(l.credit))).map(l => ({ accountId: l.accountId, description: l.description || '', jobId: l.jobId || '', debit: U.r2(U.num(l.debit)), credit: U.r2(U.num(l.credit)) }));
      if (lines.length < 2) throw new Error('A journal needs at least two lines with an account and amount');
      const dr = U.r2(U.sum(lines, l => l.debit)), cr = U.r2(U.sum(lines, l => l.credit));
      if (Math.abs(dr - cr) >= 0.005) throw new Error('Debits must equal credits');
      if (!v.date || !v.number) throw new Error('Number and date are required');
      Object.assign(j, { number: v.number, date: v.date, ref: v.ref, memo: v.memo, lines });
      if (isNew) DB.takeNumber('JV', j.number);
      DB.upsert('journals', j, 'Journal');
      UI.toast('Journal saved', 'ok');
      location.hash = '#/transactions?acc=journals';
    } catch (err) { UI.toast(err.message, 'err'); }
  };
  const del = $('#del', el);
  if (del) del.onclick = () => { if (confirm('Delete this journal?')) { DB.remove('journals', j.id, 'Journal'); location.hash = '#/transactions?acc=journals'; } };
  draw();
});

/* ---------------- Reconcile ---------------- */
route('/banking/reconcile', (el, q) => {
  const acc = q.acc || (DB.data.bankAccounts[0] || {}).id;
  const a = C.account(acc);
  if (!a) { el.innerHTML = `${UI.pageHead('Bank Reconciliation')}<div class="alert warn">No bank accounts yet. <a href="#/banking/accounts?new=1">Add one</a>.</div>`; return; }
  const stDate = q.date || U.today();
  const entries = C.bankEntries(acc).filter(e => !e.reconciled && e.date <= stDate);
  const cleared = C.clearedBalance(acc);
  const history = DB.data.reconciliations.filter(r => r.bankAccountId === acc).sort((x, y) => y.statementDate.localeCompare(x.statementDate) || y.completedAt.localeCompare(x.completedAt));
  const last = history[0];
  el.innerHTML = `${UI.pageHead('Bank Reconciliation', [['Transactions', '#/transactions']])}
    <div class="tabs">${DB.data.bankAccounts.map(b => `<a href="#/banking/reconcile?acc=${b.id}" class="${b.id === acc ? 'active' : ''}">${E(b.name)}</a>`).join('')}</div>
    <div class="card">
      <p class="muted" style="margin-top:0">Enter the ending balance from your bank statement, then tick each transaction that appears on it. When the difference is zero, finish the reconciliation.${last ? ` Last reconciled to <b>${U.fdate(last.statementDate)}</b> at ${U.money(last.statementBalance)}.` : ''}</p>
      <div class="filters">
        ${UI.field('Statement date', `<input type="date" id="st-date" value="${stDate}">`)}
        ${UI.field('Statement ending balance', `<input type="number" step="0.01" id="st-bal" value="${E(q.bal ?? '')}" placeholder="0.00">`)}
      </div>
      <div class="recon-summary">
        <div class="kpi"><div class="lbl">Previously cleared</div><div class="val">${U.money(cleared)}</div></div>
        <div class="kpi"><div class="lbl">Ticked now</div><div class="val" id="r-ticked">0.00</div></div>
        <div class="kpi"><div class="lbl">Cleared balance</div><div class="val" id="r-cleared">0.00</div></div>
        <div class="kpi"><div class="lbl">Difference</div><div class="val" id="r-diff">0.00</div></div>
      </div>
      ${UI.table([
        { label: '', render: e => `<input type="checkbox" class="rc" data-key="${E(e.key)}" data-amt="${e.amount}">` },
        { label: 'Date', render: e => U.fdate(e.date) },
        { label: 'Reference', render: e => E(e.ref) },
        { label: 'Description', render: e => E(e.desc) },
        { label: 'Deposit', cls: 'num', render: e => e.amount > 0 ? U.amt(e.amount) : '' },
        { label: 'Withdrawal', cls: 'num', render: e => e.amount < 0 ? U.amt(-e.amount) : '' },
      ], entries, { empty: 'Everything up to this date is reconciled. ✔' })}
      <div class="btn-row mt"><button class="btn" id="all">Tick all</button><div style="flex:1"></div><button class="btn success" id="finish" disabled>Finish reconciliation</button></div>
    </div>
    <div class="card"><div class="card-head"><h2>Reconciliation history</h2><div class="spacer"></div><a href="#/reports/banking/reconciliation?acc=${acc}">Report →</a></div>${UI.table([
      { label: 'Statement date', render: r => U.fdate(r.statementDate) },
      { label: 'Statement balance', cls: 'num', render: r => U.amt(r.statementBalance) },
      { label: 'Items', cls: 'num', render: r => r.keys.length },
      { label: 'Completed', render: r => E(U.fdatetime(r.completedAt)) + (r.user ? ' · ' + E(r.user) : '') },
      { label: '', cls: 'num', render: r => r === last ? `<button class="btn sm danger" data-undo="${r.id}">Undo</button>` : '' },
    ], history, { empty: 'No reconciliations yet.' })}</div>`;
  const upd = () => {
    const ticked = U.r2(U.sum($$('.rc:checked', el), c => +c.dataset.amt));
    const clr = U.r2(cleared + ticked);
    const stBal = $('#st-bal', el).value;
    const diff = U.r2(U.num(stBal) - clr);
    $('#r-ticked', el).textContent = U.amt(ticked);
    $('#r-cleared', el).textContent = U.amt(clr);
    const d = $('#r-diff', el);
    d.textContent = U.amt(diff);
    d.className = 'val ' + (stBal !== '' && Math.abs(diff) < 0.005 ? 'text-green' : 'text-red');
    $('#finish', el).disabled = !(stBal !== '' && Math.abs(diff) < 0.005 && $$('.rc:checked', el).length);
  };
  $$('.rc', el).forEach(c => c.onchange = upd);
  $('#st-bal', el).oninput = upd;
  $('#st-date', el).onchange = e => { location.hash = `#/banking/reconcile?acc=${acc}&date=${e.target.value}&bal=${$('#st-bal', el).value}`; };
  $('#all', el).onclick = () => { const all = $$('.rc', el); const on = all.some(c => !c.checked); all.forEach(c => c.checked = on); upd(); };
  $('#finish', el).onclick = () => {
    const keys = $$('.rc:checked', el).map(c => c.dataset.key);
    keys.forEach(k => { DB.data.reconciled[k] = true; });
    const rec = { id: U.uid(), number: 'REC-' + $('#st-date', el).value, bankAccountId: acc, statementDate: $('#st-date', el).value, statementBalance: U.num($('#st-bal', el).value), openingCleared: cleared, keys, completedAt: new Date().toISOString(), user: Auth.userName() };
    DB.upsert('reconciliations', rec, 'Bank Reconciliation');
    UI.toast('Reconciliation completed', 'ok');
    location.hash = '#/banking/reconcile?acc=' + acc;
  };
  $$('[data-undo]', el).forEach(b => b.onclick = () => {
    if (!confirm('Undo the last reconciliation? Its items become unreconciled again.')) return;
    const r = DB.get('reconciliations', b.dataset.undo);
    r.keys.forEach(k => delete DB.data.reconciled[k]);
    DB.remove('reconciliations', r.id, 'Bank Reconciliation');
    render();
  });
  upd();
});

/* ---------------- Banking summary ---------------- */
route('/banking/report', (el, q) => {
  const from = q.from ?? U.monthStart(U.addMonths(U.today(), -5)), to = q.to ?? U.today();
  const accs = DB.data.bankAccounts;
  const accRows = accs.map(a => {
    const opening = from ? C.bankBalance(a.id, U.addDays(from, -1)) : 0;
    const all = C.ledger().filter(e => e.accountId === a.glAccountId && U.inRange(e.date, from, to) && !(from && e.txnId.startsWith('open:')));
    const inn = U.sum(all, e => e.debit), out = U.sum(all, e => e.credit);
    return { a, opening, inn, out, closing: opening + inn - out, unrec: C.bankEntries(a.id).filter(e => !e.reconciled && e.date <= to).length };
  });
  const glBanks = new Set(accs.map(a => a.glAccountId));
  const cat = {};
  // classify cash movement by counter account
  const byTxn = {};
  C.ledger().filter(e => U.inRange(e.date, from, to)).forEach(e => { (byTxn[e.txnId] = byTxn[e.txnId] || []).push(e); });
  Object.values(byTxn).forEach(lines => {
    const cash = U.sum(lines.filter(e => glBanks.has(e.accountId)), e => e.debit - e.credit);
    if (Math.abs(cash) < 0.005 || lines[0].txnId.startsWith('open:')) return;
    const other = lines.filter(e => !glBanks.has(e.accountId));
    if (!other.length) return; // pure transfers
    const tot = U.sum(other, e => Math.abs(e.debit - e.credit)) || 1;
    other.forEach(e => { const k = C.gl(e.accountId)?.name || '?'; cat[k] = (cat[k] || 0) + cash * Math.abs(e.debit - e.credit) / tot; });
  });
  const months = [];
  let m = (from || (accs.length ? accs.map(a => a.openingDate || U.today()).sort()[0] : U.today())).slice(0, 7);
  while (m <= to.slice(0, 7) && months.length < 24) { months.push(m); m = U.addMonths(m + '-01', 1).slice(0, 7); }
  const ins = months.map(() => 0), outs = months.map(() => 0);
  Object.values(byTxn).forEach(lines => {
    if (lines[0].txnId.startsWith('open:') || !lines.some(e => !glBanks.has(e.accountId))) return;
    const cash = U.sum(lines.filter(e => glBanks.has(e.accountId)), e => e.debit - e.credit);
    const i = months.indexOf(lines[0].date.slice(0, 7));
    if (i < 0) return;
    if (cash > 0) ins[i] += cash; else outs[i] -= cash;
  });
  el.innerHTML = `${UI.pageHead('Banking Report', [['Transactions', '#/transactions']], UI.reportActions())}
    ${UI.dateFilter(from, to)}
    <div class="card"><h2>Account summary</h2><div class="mt">${UI.table([
      { label: 'Account', render: r => `<a href="#/transactions?acc=${r.a.id}">${E(r.a.name)}</a>` },
      { label: 'Opening', cls: 'num', render: r => U.amt(r.opening) },
      { label: 'Money in', cls: 'num', render: r => `<span class="text-green">${U.amt(r.inn)}</span>` },
      { label: 'Money out', cls: 'num', render: r => `<span class="text-red">${U.amt(r.out)}</span>` },
      { label: 'Closing', cls: 'num', render: r => `<b>${U.amt(r.closing)}</b>` },
      { label: 'Unreconciled', cls: 'num', render: r => r.unrec ? `<a href="#/banking/reconcile?acc=${r.a.id}">${r.unrec}</a>` : '✔' },
    ], accRows, { empty: 'No accounts.', foot: accRows.length ? `<tr><td>${E(t('Total'))}</td><td class="num">${U.amt(U.sum(accRows, r => r.opening))}</td><td class="num">${U.amt(U.sum(accRows, r => r.inn))}</td><td class="num">${U.amt(U.sum(accRows, r => r.out))}</td><td class="num">${U.amt(U.sum(accRows, r => r.closing))}</td><td></td></tr>` : '' })}</div></div>
    <div class="grid g2">
      <div class="card"><h2>Monthly cash flow</h2><div class="mt">${months.length ? UI.barChart(months.map(U.monthLabel), [{ name: 'Money in', color: '#16a34a', values: ins }, { name: 'Money out', color: '#dc2626', values: outs }]) : '<p class="muted">No data</p>'}</div></div>
      <div class="card"><h2>Cash flow by account</h2><div class="mt">${UI.table([
        { label: 'Account', render: ([k]) => E(k) },
        { label: 'Amount', cls: 'num', render: ([, v]) => `<span class="${v >= 0 ? 'text-green' : 'text-red'}">${U.amt(v)}</span>` },
      ], Object.entries(cat).filter(([, v]) => Math.abs(v) >= 0.005).sort((x, y) => y[1] - x[1]), { empty: 'No cash movement in this period.', foot: `<tr><td>Net cash flow</td><td class="num">${U.amt(U.sum(Object.values(cat)))}</td></tr>` })}</div></div>
    </div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = `#/banking/report?from=${f}&to=${t2}`; });
  UI.bindExport(el, 'banking-report');
});
