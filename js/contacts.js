'use strict';
/* =========================================================================
   Contacts (business / individual), employees, request & sync details
   ========================================================================= */

function contactModal(c, onSaved) {
  c = c || { type: 'customer', entity: 'business', terms: DB.data.settings.paymentTerms };
  const multiCur = DB.data.currencies.length > 1;
  UI.modal(c.id ? 'Edit Contact' : `New ${c.entity === 'individual' ? 'Individual' : 'Business'} Contact`, `<div class="form-grid">
    ${UI.field('Name *', UI.input('name', c.name), 'full')}
    ${UI.field('Contact type', UI.select('type', [['customer', 'Customer'], ['supplier', 'Supplier'], ['both', 'Customer & Supplier'], ['employee', 'Employee / Staff']], c.type))}
    ${UI.field('Entity', UI.select('entity', [['business', 'Business'], ['individual', 'Individual']], c.entity || 'business'))}
    <div class="field"><label class="lbl-reg">${c.entity === 'individual' ? 'IC / Passport No.' : 'Business Reg. No. (BRN)'}</label>${UI.input('regNo', c.regNo)}</div>
    ${UI.field('TIN (Tax Identification No.)', UI.input('tin', c.tin))}
    ${UI.field('SST Registration No.', UI.input('taxNo', c.taxNo))}
    ${UI.field('Contact person', UI.input('person', c.person))}
    ${UI.field('Email', UI.input('email', c.email, 'type="email"'))}
    ${UI.field('Phone', UI.input('phone', c.phone))}
    ${UI.field('Payment terms (days)', `<input name="terms" type="number" min="0" value="${E(c.terms ?? '')}" list="termlist"><datalist id="termlist">${DB.data.paymentTerms.map(p => `<option value="${p.days}">${E(p.name)}</option>`).join('')}</datalist>`)}
    ${DB.data.priceLevels.length ? UI.field('Price level', UI.select('priceLevelId', [['', 'Standard'], ...DB.data.priceLevels.map(p => [p.id, `${p.name} (${p.percent > 0 ? '+' : ''}${p.percent}%)`])], c.priceLevelId)) : ''}
    ${multiCur ? UI.field('Default currency', UI.select('currency', [['', '—'], ...UI.currencyOptions()], c.currency)) : ''}
    ${UI.field('Address', UI.textarea('address', c.address), 'full')}
    ${UI.field('Notes', UI.textarea('notes', c.notes), 'full')}
  </div>`, {
    onMount(m) { $('[name=entity]', m).onchange = e => { $('.lbl-reg', m).textContent = e.target.value === 'individual' ? 'IC / Passport No.' : 'Business Reg. No. (BRN)'; }; },
    onSubmit(v) {
      if (!v.name) throw new Error('Name is required');
      const saved = DB.upsert('contacts', Object.assign(c, v, { terms: v.terms === '' ? '' : U.num(v.terms) }), 'Contact');
      UI.toast('Contact saved', 'ok');
      onSaved ? onSaved(saved) : render();
    },
  });
}

route('/contacts', (el, q) => {
  const tab = q.tab || 'all';
  const list = DB.data.contacts.filter(c => tab === 'all' || c.type === tab || (c.type === 'both' && tab !== 'employee') || (tab === 'individual' && c.entity === 'individual')).filter(c => tab !== 'individual' || c.entity === 'individual').sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `${UI.pageHead('Contacts List', null, `<a class="btn" href="#/contacts/sync">${E(t('Sync Contact Details'))}</a><a class="btn" href="#/contacts/request">${E(t('Request Contact Details'))}</a><button class="btn" data-new="individual">+ ${E(t('Individual'))}</button><button class="btn primary" data-new="business">+ ${E(t('Business'))}</button>`)}
    <div class="tabs">${[['all', 'All'], ['customer', 'Customers'], ['supplier', 'Suppliers'], ['employee', 'Staff'], ['individual', 'Individual']].map(([k, l]) => `<a href="#/contacts?tab=${k}" class="${tab === k ? 'active' : ''}">${E(t(l))}</a>`).join('')}</div>
    <div class="card"><div class="filters">${UI.searchBox()}</div>${UI.table([
      { label: 'Name', render: c => `<a href="#/contacts/${c.id}"><b>${E(c.name)}</b></a>${c.person ? `<div class="small muted">${E(c.person)}</div>` : ''}` },
      { label: 'Type', render: c => E({ customer: 'Customer', supplier: 'Supplier', both: 'Customer & Supplier' }[c.type]) + `<div class="small muted">${c.entity === 'individual' ? 'Individual' : 'Business'}</div>` },
      { label: 'Email', render: c => E(c.email) },
      { label: 'Phone', render: c => E(c.phone) },
      { label: 'Receivables', cls: 'num', render: c => c.type !== 'supplier' && c.type !== 'employee' ? U.amt(C.contactBalance(c.id, 'sales')) : '' },
      { label: 'Payables', cls: 'num', render: c => c.type !== 'customer' ? U.amt(C.contactBalance(c.id, 'purchases')) : '' },
      { label: '', cls: 'num no-print', render: c => `<button class="btn sm" data-edit="${c.id}">${E(t('Edit'))}</button> <button class="btn sm danger" data-del="${c.id}">${E(t('Delete'))}</button>` },
    ], list, { href: c => '#/contacts/' + c.id, empty: 'No contacts yet.' })}</div>`;
  $$('[data-new]', el).forEach(b => b.onclick = () => contactModal({ type: 'customer', entity: b.dataset.new, terms: DB.data.settings.paymentTerms }));
  $$('[data-edit]', el).forEach(b => b.onclick = () => contactModal({ ...DB.get('contacts', b.dataset.edit) }));
  $$('[data-del]', el).forEach(b => b.onclick = () => {
    const id = b.dataset.del;
    if (DB.data.docs.some(d => d.contactId === id) || DB.data.payments.some(p => p.contactId === id) || DB.data.transactions.some(x => x.contactId === id)) return UI.toast('Contact has transactions — cannot delete', 'err');
    if (confirm('Delete this contact?')) { DB.remove('contacts', id, 'Contact'); render(); }
  });
  if (q.new) { history.replaceState(null, '', '#/contacts'); contactModal({ type: 'customer', entity: q.new === 'individual' ? 'individual' : 'business', terms: DB.data.settings.paymentTerms }); }
});

route('/contacts/request', (el) => {
  const s = DB.data.settings;
  const fields = ['Full / company name', 'Business Reg. No. (BRN) or IC / Passport No.', 'Tax Identification No. (TIN)', 'SST Registration No. (if any)', 'Billing address', 'Contact person', 'Email', 'Phone', 'Bank name & account no. (suppliers only)'];
  const body = `Dear Sir/Madam,\n\nTo keep our records accurate (including for e-Invoicing), could you please reply with the following details:\n\n${fields.map(f => '- ' + f + ': ').join('\n')}\n\nThank you.\n\nRegards,\n${Auth.userName()}\n${s.company}${s.phone ? '\n' + s.phone : ''}`;
  el.innerHTML = `${UI.pageHead('Request Contact Details', [['Contacts', '#/contacts']])}
    <div class="card">
      <p class="muted" style="margin-top:0">Send this request to a customer or supplier. Choosing a contact opens a draft in your own email app — nothing is sent automatically.</p>
      <div class="form-grid">
        ${UI.field('Contact', UI.select('', UI.contactOptions(null, '— Choose a contact —'), '', 'id="rq-c"'))}
        ${UI.field('Email to', '<input id="rq-to" type="email" placeholder="name@example.com">')}
        ${UI.field('Message', `<textarea id="rq-body" rows="16">${E(body)}</textarea>`, 'full')}
      </div>
      <div class="btn-row mt"><button class="btn" id="copy">Copy message</button><button class="btn" onclick="window.print()">Print as form</button><a class="btn primary" id="mail" href="#">Open in email app</a></div>
    </div>`;
  $('#rq-c', el).onchange = e => { const c = C.contact(e.target.value); if (c) $('#rq-to', el).value = c.email || ''; };
  $('#copy', el).onclick = () => { navigator.clipboard.writeText($('#rq-body', el).value).then(() => UI.toast('Copied', 'ok'), () => UI.toast('Copy failed — select and copy manually', 'err')); };
  $('#mail', el).onclick = e => {
    e.preventDefault();
    const to = $('#rq-to', el).value.trim();
    if (!to) return UI.toast('Enter an email address', 'err');
    location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent('Request for contact details — ' + s.company)}&body=${encodeURIComponent($('#rq-body', el).value)}`;
  };
});

route('/contacts/sync', (el) => {
  const cols = ['name', 'type', 'entity', 'regNo', 'tin', 'taxNo', 'person', 'email', 'phone', 'terms', 'address'];
  el.innerHTML = `${UI.pageHead('Sync Contact Details', [['Contacts', '#/contacts']])}
    <div class="grid g2">
      <div class="card"><h2>Export</h2><p class="muted">Download all contacts as a CSV file (opens in Excel / Google Sheets).</p><button class="btn primary" id="exp">${E(t('Export CSV'))}</button></div>
      <div class="card"><h2>Import / update</h2><p class="muted">Upload a CSV with columns: <code>${cols.join(', ')}</code>. Existing contacts with the same name are updated; new names are added.</p>
        <div class="btn-row"><label class="btn primary">Choose CSV file<input type="file" id="imp" accept=".csv,text/csv" hidden></label><button class="btn" id="tpl">Download template</button></div>
        <div id="imp-res" class="mt"></div></div>
    </div>`;
  $('#exp', el).onclick = () => U.download(`contacts-${U.today()}.csv`, '﻿' + U.csv([cols, ...DB.data.contacts.map(c => cols.map(k => c[k] ?? ''))]), 'text/csv');
  $('#tpl', el).onclick = () => U.download('contacts-template.csv', U.csv([cols, ['Example Sdn Bhd', 'customer', 'business', '202001234567', 'C1234567890', '', 'Ali', 'ali@example.com', '012-3456789', '30', 'Kuala Lumpur']]), 'text/csv');
  $('#imp', el).onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(txt => {
      const rows = U.parseCsv(txt.replace(/^﻿/, ''));
      const head = rows.shift().map(h => h.trim());
      if (!head.includes('name')) throw new Error('The file needs a "name" column');
      let added = 0, updated = 0;
      rows.forEach(r => {
        const o = {}; head.forEach((h, i) => { if (cols.includes(h)) o[h] = (r[i] || '').trim(); });
        if (!o.name) return;
        if (o.type && !['customer', 'supplier', 'both', 'employee'].includes(o.type)) o.type = 'customer';
        if (o.entity && !['business', 'individual'].includes(o.entity)) o.entity = 'business';
        if (o.terms !== undefined) o.terms = o.terms === '' ? '' : U.num(o.terms);
        const ex = DB.data.contacts.find(c => c.name.toLowerCase() === o.name.toLowerCase());
        if (ex) { Object.keys(o).forEach(k => { if (o[k] !== '') ex[k] = o[k]; }); updated++; }
        else { DB.data.contacts.push(Object.assign({ id: U.uid(), type: 'customer', entity: 'business' }, o)); added++; }
      });
      DB.log('Imported', 'Contacts', `${added} added, ${updated} updated`); DB.save();
      $('#imp-res', el).innerHTML = `<div class="alert ok">${added} added, ${updated} updated.</div>`;
    }).catch(err => UI.toast('Import failed: ' + err.message, 'err'));
  };
});

route('/contacts/:id', (el, q, id) => {
  const c = C.contact(id);
  if (!c) throw new Error('Contact not found');
  const docs = DB.data.docs.filter(d => d.contactId === id).sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
  const pays = DB.data.payments.filter(p => p.contactId === id).sort((a, b) => b.date.localeCompare(a.date));
  const isC = c.type !== 'supplier' && c.type !== 'employee', isS = c.type !== 'customer';
  el.innerHTML = `${UI.pageHead(c.name, [['Contacts', '#/contacts']], `<button class="btn" id="edit">${E(t('Edit'))}</button>${isC ? `<a class="btn" href="#/reports/ledger/customer?contact=${id}">${E(t('Customer Ledger'))}</a><a class="btn primary" href="#/docs/invoice/new?contact=${id}">+ ${E(t('Invoice'))}</a>` : ''}${isS ? `<a class="btn" href="#/reports/ledger/supplier?contact=${id}">${E(t('Supplier Ledger'))}</a><a class="btn" href="#/docs/bill/new?contact=${id}">+ ${E(t('Bill'))}</a>` : ''}`)}
    <div class="kpis">
      ${isC ? `<div class="kpi"><div class="lbl">${E(t('Receivables'))}</div><div class="val">${U.money(C.contactBalance(id, 'sales'))}</div></div>` : ''}
      ${isS ? `<div class="kpi"><div class="lbl">${E(t('Payables'))}</div><div class="val">${U.money(C.contactBalance(id, 'purchases'))}</div></div>` : ''}
      <div class="kpi"><div class="lbl">${c.entity === 'individual' ? 'IC / Passport' : 'BRN'}</div><div class="val" style="font-size:15px">${E(c.regNo || '—')}</div><div class="sub">TIN ${E(c.tin || '—')}</div></div>
      <div class="kpi"><div class="lbl">Contact</div><div class="val" style="font-size:15px">${E(c.email || '—')}</div><div class="sub">${E(c.phone || '')}</div></div>
    </div>
    <div class="card"><h2>Documents</h2><div class="mt">${docTable(docs, { showType: true })}</div></div>
    <div class="card"><h2>${E(t('Payments'))}</h2><div class="mt">${paymentsTable(pays)}</div></div>`;
  $('#edit', el).onclick = () => contactModal({ ...c });
  wirePaymentActions(el);
});

/* ---------------- Employees ---------------- */
/** The contact used for an employee's expense claims (created on first use, kept in step with the employee record). */
function staffContact(emp) {
  let c = emp.contactId && DB.get('contacts', emp.contactId);
  if (!c) c = DB.data.contacts.find(x => x.name.trim().toLowerCase() === emp.name.trim().toLowerCase());
  const fields = { name: emp.name, email: emp.email || '', phone: emp.phone || '', regNo: emp.idNo || '', address: emp.address || '' };
  if (c) {
    const next = Object.assign({}, c, { name: emp.name });
    ['email', 'phone', 'regNo', 'address'].forEach(k => { if (!next[k] && fields[k]) next[k] = fields[k]; });
    if (next.type === 'customer') next.type = 'both';
    if (JSON.stringify(next) !== JSON.stringify(c)) DB.upsert('contacts', next, 'Contact');
  } else {
    c = DB.upsert('contacts', Object.assign({ type: 'employee', entity: 'individual', terms: 0, notes: 'Staff — expense claims' }, fields), 'Contact');
  }
  if (emp.contactId !== c.id) { emp.contactId = c.id; DB.upsert('employees', emp, 'Employee'); }
  return c;
}
function employeeModal(emp) {
  emp = emp || { status: 'active', startDate: U.today() };
  UI.modal(emp.id ? 'Edit Employee' : 'New Employee', `<div class="form-grid">
    ${UI.field('Full name *', UI.input('name', emp.name), 'full')}
    ${UI.field('Employee no.', UI.input('code', emp.code))}
    ${UI.field('IC / Passport No.', UI.input('idNo', emp.idNo))}
    ${UI.field('Position', UI.input('position', emp.position))}
    ${UI.field('Department', UI.input('department', emp.department))}
    ${UI.field('Email', UI.input('email', emp.email, 'type="email"'))}
    ${UI.field('Phone', UI.input('phone', emp.phone))}
    ${UI.field('Start date', UI.input('startDate', emp.startDate, 'type="date"'))}
    ${UI.field('Monthly salary', UI.input('salary', emp.salary, 'type="number" step="0.01" min="0"'))}
    ${UI.field('EPF no.', UI.input('epf', emp.epf))}
    ${UI.field('SOCSO no.', UI.input('socso', emp.socso))}
    ${UI.field('Income tax no.', UI.input('taxNo', emp.taxNo))}
    ${UI.field('Bank & account no.', UI.input('bank', emp.bank))}
    ${UI.field('Status', UI.select('status', [['active', 'Active'], ['resigned', 'Resigned']], emp.status))}
    ${UI.field('Address', UI.textarea('address', emp.address), 'full')}
  </div>`, {
    onSubmit(v) {
      if (!v.name) throw new Error('Name is required');
      DB.upsert('employees', Object.assign(emp, v, { salary: U.num(v.salary) }), 'Employee');
      staffContact(emp);
      UI.toast('Employee saved', 'ok'); render();
    },
  });
}
route('/employees', (el) => {
  const list = [...DB.data.employees].sort((a, b) => a.name.localeCompare(b.name));
  const active = list.filter(x => x.status !== 'resigned');
  el.innerHTML = `${UI.pageHead('Employees List', [['Contacts', '#/contacts']], `<button class="btn primary" id="new">+ New Employee</button>`)}
    <div class="kpis"><div class="kpi"><div class="lbl">Active employees</div><div class="val">${active.length}</div></div>
      <div class="kpi"><div class="lbl">Monthly payroll</div><div class="val">${U.money(U.sum(active, x => U.num(x.salary)))}</div></div></div>
    <div class="card"><div class="filters">${UI.searchBox()}</div>${UI.table([
      { label: 'Name', render: x => `<b>${E(x.name)}</b><div class="small muted">${E(x.code || '')}</div>` },
      { label: 'Position', render: x => E(x.position || '') + (x.department ? `<div class="small muted">${E(x.department)}</div>` : '') },
      { label: 'Email', render: x => E(x.email || '') },
      { label: 'Phone', render: x => E(x.phone || '') },
      { label: 'Start', render: x => U.fdate(x.startDate) },
      { label: 'Salary', cls: 'num', render: x => U.amt(x.salary) },
      { label: 'Status', render: x => UI.badge(x.status === 'resigned' ? 'closed' : 'active') },
      { label: '', cls: 'num no-print', render: x => `<button class="btn sm" data-edit="${x.id}">${E(t('Edit'))}</button> <button class="btn sm danger" data-del="${x.id}">${E(t('Delete'))}</button>` },
    ], list, { empty: 'No employees yet.' })}</div>`;
  $('#new', el).onclick = () => employeeModal();
  $$('[data-edit]', el).forEach(b => b.onclick = () => employeeModal({ ...DB.get('employees', b.dataset.edit) }));
  $$('[data-del]', el).forEach(b => b.onclick = () => { if (confirm('Delete this employee record?')) { DB.remove('employees', b.dataset.del, 'Employee'); render(); } });
});
