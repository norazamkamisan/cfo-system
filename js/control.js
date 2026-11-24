'use strict';
/* =========================================================================
   Control Panel: master data, company, accounting setup, inventory setup,
   integrated apps, backup & data
   ========================================================================= */

const CP = { crumbs: (s) => [['Control Panel', '#/control'], [s]] };

/** Generic master-data list with add / edit / delete in a modal. */
function masterPage(el, { title, section, col, columns, fields, defaults = {}, canDelete, onSave, intro = '', label }) {
  const list = DB.data[col];
  el.innerHTML = `${UI.pageHead(title, CP.crumbs(section), `<button class="btn primary" id="new">+ New</button>`)}
    ${intro ? `<div class="alert info">${intro}</div>` : ''}
    <div class="card">${UI.table([...columns, { label: '', cls: 'num no-print', render: r => `<button class="btn sm" data-edit="${r.id}">${E(t('Edit'))}</button> <button class="btn sm danger" data-del="${r.id}">${E(t('Delete'))}</button>` }], list)}</div>`;
  const open = (r) => {
    const isNew = !r;
    r = r ? { ...r } : { ...defaults };
    UI.modal(isNew ? 'New ' + (label || title) : 'Edit ' + (label || title), `<div class="form-grid">${fields(r)}</div>`, {
      onSubmit(v) {
        const rec = Object.assign(r, v);
        if (onSave) onSave(rec, isNew);
        DB.upsert(col, rec, label || title);
        UI.toast('Saved', 'ok'); render();
      },
    });
  };
  $('#new', el).onclick = () => open();
  $$('[data-edit]', el).forEach(b => b.onclick = () => open(DB.get(col, b.dataset.edit)));
  $$('[data-del]', el).forEach(b => b.onclick = () => {
    const r = DB.get(col, b.dataset.del);
    const why = canDelete ? canDelete(r) : '';
    if (why) return UI.toast(why, 'err');
    if (confirm('Delete this record?')) { DB.remove(col, r.id, label || title); render(); }
  });
}

route('/control', (el) => {
  const cp = MENU.find(m => m.label === 'Control Panel').items.filter(x => x !== '-');
  el.innerHTML = `${UI.pageHead('Control Panel')}<div class="grid g3">${cp.map(s => `<div class="card"><h2>${E(t(s.label))}</h2>${s.items ? `<ul style="padding-left:18px;line-height:1.9">${s.items.map(([l, h]) => `<li><a href="${h}">${E(t(l))}</a></li>`).join('')}</ul>` : `<p><a href="${s.href}">Open →</a></p>`}</div>`).join('')}</div>`;
});

/* ---------------- Master data ---------------- */
route('/control/taxes', (el) => {
  const s = DB.data.taxSettings;
  el.innerHTML = `${UI.pageHead('Taxes', CP.crumbs('Master Data'), `<button class="btn primary" id="new">+ New Tax Code</button>`)}
    <form class="card" id="f">
      <div class="form-grid">
        <div class="field full">${UI.check('enabled', 'Charge / track tax on documents', s.enabled)}</div>
        <div class="field full">${UI.check('inputClaimable', 'Input tax is deductible (subtract SST paid on purchases from SST payable)', s.inputClaimable)}
          <span class="hint">Leave this off for normal Malaysian SST: tax paid on purchases is then added to the cost of the stock or expense and is not deducted on the return. Turn it on only if you qualify for a deduction or use a GST/VAT-style tax. Changing it recalculates all past transactions; returns you already saved keep their figures.</span></div>
        ${UI.field('Tax name', UI.input('taxName', s.taxName, 'placeholder="e.g. SST"'))}
        ${UI.field('Filing period', UI.select('filingFrequency', [['1', 'Monthly'], ['2', 'Every 2 months (SST taxable period)'], ['3', 'Quarterly'], ['6', 'Half-yearly'], ['12', 'Yearly']], s.filingFrequency))}
        ${UI.field('Default tax on sales', UI.select('defaultSales', UI.taxOptions('sales'), s.defaultSales))}
        ${UI.field('Default tax on purchases', UI.select('defaultPurchase', UI.taxOptions('purchase'), s.defaultPurchase))}
      </div>
      <div class="btn-row mt"><button class="btn primary">${E(t('Save'))}</button></div>
    </form>
    <div class="card"><h2>Tax codes</h2><div class="mt">${UI.table([
      { label: 'Code', render: x => `<b>${E(x.code)}</b>` },
      { label: 'Name', render: x => E(x.name) },
      { label: 'Rate', cls: 'num', render: x => U.qty(x.rate) + '%' },
      { label: 'Applies to', render: x => ({ sales: 'Sales (output)', purchase: 'Purchases (input)', both: 'Both' })[x.type] },
      { label: 'Category', render: x => ({ goods: 'Sales tax (goods)', service: 'Service tax', none: 'Not taxable / exempt' })[x.category] || '' },
      { label: '', cls: 'num', render: x => `<button class="btn sm" data-edit="${x.id}">${E(t('Edit'))}</button> <button class="btn sm danger" data-del="${x.id}">${E(t('Delete'))}</button>` },
    ], s.codes)}</div></div>`;
  $('#f', el).onsubmit = e => {
    e.preventDefault();
    const v = UI.formValues(e.target);
    const changed = !!v.inputClaimable !== C.inputClaimable();
    if (changed && !confirm(`${v.inputClaimable ? 'Turn ON' : 'Turn OFF'} input tax deduction? All past purchases, stock costs and SST reports will be recalculated. Saved SST returns are not changed.`)) return;
    Object.assign(s, v, { filingFrequency: +v.filingFrequency });
    DB.log('Updated', 'Tax Settings', 'Taxes', changed ? `Input tax deductible: ${v.inputClaimable ? 'on' : 'off'}` : '');
    DB.save(); UI.toast('Saved', 'ok'); render();
  };
  const codeModal = x => {
    x = x || { type: 'sales', rate: 0, category: 'goods' };
    UI.modal(x.id ? 'Edit Tax Code' : 'New Tax Code', `<div class="form-grid">
      ${UI.field('Code *', UI.input('code', x.code))}${UI.field('Rate % *', UI.input('rate', x.rate, 'type="number" step="any" min="0"'))}
      ${UI.field('Name *', UI.input('name', x.name), 'full')}
      ${UI.field('Applies to', UI.select('type', [['sales', 'Sales (output tax)'], ['purchase', 'Purchases (input tax)'], ['both', 'Both']], x.type))}
      ${UI.field('Category (for SST return)', UI.select('category', [['goods', 'Sales tax (goods)'], ['service', 'Service tax'], ['none', 'Not taxable / exempt']], x.category))}
    </div>`, {
      onSubmit(v) {
        if (!v.code || !v.name) throw new Error('Code and name are required');
        if (s.codes.some(c => c.code === v.code && c.id !== x.id)) throw new Error('Code already exists');
        Object.assign(x, v, { rate: U.num(v.rate) });
        if (!x.id) { x.id = U.uid(); s.codes.push(x); }
        DB.log('Saved', 'Tax Code', x); DB.save(); UI.toast('Saved', 'ok'); render();
      },
    });
  };
  $('#new', el).onclick = () => codeModal();
  $$('[data-edit]', el).forEach(b => b.onclick = () => codeModal(s.codes.find(x => x.id === b.dataset.edit)));
  $$('[data-del]', el).forEach(b => b.onclick = () => {
    const id = b.dataset.del;
    if (DB.data.docs.some(d => d.lines.some(l => l.taxCodeId === id)) || DB.data.transactions.some(x => x.taxCodeId === id) || DB.data.products.some(p => p.taxSale === id || p.taxPurchase === id)) return UI.toast('Tax code is in use — cannot delete', 'err');
    if (confirm('Delete this tax code?')) { s.codes = s.codes.filter(x => x.id !== id); DB.save(); render(); }
  });
});

route('/control/tariff', (el) => masterPage(el, {
  title: 'Tariff Code', section: 'Master Data', col: 'tariffCodes', label: 'Tariff Code',
  intro: 'Customs tariff (HS) codes for taxable goods. Assign them to products; they print on invoices.',
  columns: [{ label: 'Code', render: r => `<b>${E(r.code)}</b>` }, { label: 'Description', render: r => E(r.description) }, { label: 'Tax', render: r => E(C.taxCode(r.taxCodeId)?.code || '') }],
  fields: r => UI.field('Code *', UI.input('code', r.code)) + UI.field('Default tax', UI.select('taxCodeId', UI.taxOptions('sales'), r.taxCodeId)) + UI.field('Description', UI.input('description', r.description), 'full'),
  onSave: r => { if (!r.code) throw new Error('Code is required'); },
  canDelete: r => DB.data.products.some(p => p.tariffCodeId === r.id) ? 'Used by products' : '',
}));

route('/control/currencies', (el) => masterPage(el, {
  title: 'Currencies', section: 'Master Data', col: 'currencies', label: 'Currency',
  intro: `Base currency: <b>${E(DB.data.settings.baseCurrency)}</b>. Rates are units of base currency per 1 foreign unit (e.g. USD = 4.45). Documents in foreign currency are converted at the rate on the document.`,
  columns: [{ label: 'Code', render: r => `<b>${E(r.code)}</b>${r.code === DB.data.settings.baseCurrency ? ' <span class="badge green">Base</span>' : ''}` }, { label: 'Name', render: r => E(r.name) }, { label: 'Symbol', render: r => E(r.symbol) }, { label: 'Rate', cls: 'num', render: r => U.qty(r.rate) }],
  fields: r => UI.field('Code * (e.g. USD)', UI.input('code', r.code, 'maxlength="3"')) + UI.field('Name', UI.input('name', r.name)) + UI.field('Symbol', UI.input('symbol', r.symbol)) + UI.field('Exchange rate', UI.input('rate', r.rate ?? 1, 'type="number" step="any" min="0"')),
  onSave: r => { r.code = (r.code || '').toUpperCase(); if (!/^[A-Z]{3}$/.test(r.code)) throw new Error('Use a 3-letter currency code'); if (DB.data.currencies.some(c => c.code === r.code && c.id !== r.id)) throw new Error('Currency already exists'); r.rate = r.code === DB.data.settings.baseCurrency ? 1 : U.num(r.rate) || 1; },
  canDelete: r => r.code === DB.data.settings.baseCurrency ? 'Cannot delete the base currency' : DB.data.docs.some(d => d.currency === r.code) ? 'Used by documents' : '',
}));

route('/control/jobs', (el) => masterPage(el, {
  title: 'Job Tagging', section: 'Master Data', col: 'jobs', label: 'Job', defaults: { status: 'active' },
  intro: 'Jobs (projects / cost centres) can be tagged on sales, purchases, bank transactions and journals to see profit per job in Reports → Job Report.',
  columns: [{ label: 'Code', render: r => `<b>${E(r.code)}</b>` }, { label: 'Name', render: r => E(r.name) }, { label: 'Customer', render: r => E(r.contactId ? C.contactName(r.contactId) : '') }, { label: 'Status', render: r => UI.badge(r.status === 'closed' ? 'closed' : 'active') }],
  fields: r => UI.field('Code *', UI.input('code', r.code)) + UI.field('Name *', UI.input('name', r.name)) + UI.field('Customer', UI.select('contactId', UI.contactOptions('customer', '—'), r.contactId)) + UI.field('Status', UI.select('status', [['active', 'Active'], ['closed', 'Closed']], r.status)) + UI.field('Start date', UI.input('startDate', r.startDate, 'type="date"')) + UI.field('End date', UI.input('endDate', r.endDate, 'type="date"')) + UI.field('Description', UI.input('description', r.description), 'full'),
  onSave: r => { if (!r.code || !r.name) throw new Error('Code and name are required'); },
  canDelete: r => DB.data.docs.some(d => d.jobId === r.id) || DB.data.transactions.some(x => x.jobId === r.id) || DB.data.journals.some(j => j.lines.some(l => l.jobId === r.id)) ? 'Job is used — mark it closed instead' : '',
}));

route('/control/payment-methods', (el) => {
  const list = DB.data.paymentMethods;
  el.innerHTML = `${UI.pageHead('Payment Methods', CP.crumbs('Master Data'))}
    <div class="card"><div class="filters"><div class="field" style="flex:1;max-width:320px"><input id="pm" placeholder="New payment method"></div><button class="btn primary" id="add">+ Add</button></div>
    ${UI.table([{ label: 'Method', render: m => E(m) }, { label: '', cls: 'num', render: m => `<button class="btn sm danger" data-del="${E(m)}">${E(t('Delete'))}</button>` }], list)}</div>`;
  $('#add', el).onclick = () => { const v = $('#pm', el).value.trim(); if (!v || list.includes(v)) return; list.push(v); DB.log('Created', 'Payment Method', v); DB.save(); render(); };
  $$('[data-del]', el).forEach(b => b.onclick = () => { if (list.length < 2) return; DB.data.paymentMethods = list.filter(m => m !== b.dataset.del); DB.log('Deleted', 'Payment Method', b.dataset.del); DB.save(); render(); });
});

route('/control/payment-terms', (el) => masterPage(el, {
  title: 'Payment Terms', section: 'Master Data', col: 'paymentTerms', label: 'Payment Term',
  columns: [{ label: 'Name', render: r => `<b>${E(r.name)}</b>` }, { label: 'Days', cls: 'num', render: r => r.days }],
  fields: r => UI.field('Name *', UI.input('name', r.name, 'placeholder="e.g. Net 30"')) + UI.field('Days *', UI.input('days', r.days ?? 30, 'type="number" min="0"')),
  onSave: r => { if (!r.name) throw new Error('Name is required'); r.days = U.num(r.days); },
}));

route('/control/price-levels', (el) => masterPage(el, {
  title: 'Price Levels', section: 'Master Data', col: 'priceLevels', label: 'Price Level',
  intro: 'A price level adjusts selling prices for the customers assigned to it (e.g. Wholesale −10%, VIP −5%). Assign it on the contact.',
  columns: [{ label: 'Name', render: r => `<b>${E(r.name)}</b>` }, { label: 'Adjustment', cls: 'num', render: r => (r.percent > 0 ? '+' : '') + U.qty(r.percent) + '%' }, { label: 'Customers', cls: 'num', render: r => DB.data.contacts.filter(c => c.priceLevelId === r.id).length }],
  fields: r => UI.field('Name *', UI.input('name', r.name)) + UI.field('Adjustment % (negative = discount)', UI.input('percent', r.percent ?? -10, 'type="number" step="any"')),
  onSave: r => { if (!r.name) throw new Error('Name is required'); r.percent = U.num(r.percent); },
  canDelete: r => DB.data.contacts.some(c => c.priceLevelId === r.id) ? 'Assigned to customers' : '',
}));

/* ---------------- Company ---------------- */
function readImage(file, maxW = 400) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, maxW / img.width);
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        res(cv.toDataURL('image/png'));
      };
      img.onerror = () => rej(new Error('Not an image'));
      img.src = fr.result;
    };
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}
route('/control/profile', (el) => {
  const s = DB.data.settings;
  el.innerHTML = `${UI.pageHead('Business Profile', CP.crumbs('Company'))}
    <form class="card" id="f">
      <div class="form-grid">
        ${UI.field('Company name *', UI.input('company', s.company), 'full')}
        ${UI.field('Registration No. (SSM / BRN)', UI.input('regNo', s.regNo))}
        ${UI.field('TIN (Tax Identification No.)', UI.input('tin', s.tin))}
        ${UI.field('SST Registration No.', UI.input('taxNo', s.taxNo))}
        ${UI.field('MSIC code', UI.input('msic', s.msic))}
        ${UI.field('Phone', UI.input('phone', s.phone))}
        ${UI.field('Email', UI.input('email', s.email))}
        ${UI.field('Website', UI.input('website', s.website))}
        ${UI.field('Address', UI.textarea('address', s.address), 'full')}
        <div class="field full"><label>Logo</label>${s.logo ? `<img class="logo-preview" src="${E(s.logo)}" alt="logo">` : ''}
          <div class="btn-row"><label class="btn">Upload logo<input type="file" id="logo" accept="image/*" hidden></label>${s.logo ? '<button type="button" class="btn danger" id="rmlogo">Remove</button>' : ''}</div></div>
      </div>
      <div class="btn-row mt"><button class="btn primary">${E(t('Save'))}</button></div>
    </form>`;
  $('#f', el).onsubmit = e => { e.preventDefault(); const v = UI.formValues(e.target); if (!v.company) return UI.toast('Company name is required', 'err'); Object.assign(s, v); DB.log('Updated', 'Business Profile', s.company); DB.save(); UI.toast('Saved', 'ok'); render(); };
  $('#logo', el).onchange = e => { const f = e.target.files[0]; if (f) readImage(f).then(d => { s.logo = d; DB.save(); render(); }).catch(err => UI.toast(err.message, 'err')); };
  const rm = $('#rmlogo', el); if (rm) rm.onclick = () => { s.logo = ''; DB.save(); render(); };
});

route('/control/business', (el) => {
  const s = DB.data.settings;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const hasForeign = DB.data.docs.some(d => d.currency && d.currency !== s.baseCurrency);
  el.innerHTML = `${UI.pageHead('Business Setting', CP.crumbs('Company'))}
    <form class="card" id="f"><div class="form-grid">
      ${UI.field('Base currency code', UI.input('baseCurrency', s.baseCurrency, `maxlength="3" ${hasForeign ? 'readonly' : ''}`))}
      ${UI.field('Currency symbol', UI.input('currency', s.currency))}
      ${UI.field('Financial year starts in', UI.select('fyStartMonth', months.map((m, i) => [i + 1, m]), s.fyStartMonth))}
      ${UI.field('Default payment terms (days)', UI.input('paymentTerms', s.paymentTerms, 'type="number" min="0"'))}
      ${UI.field('Conversion / opening balance date', UI.input('obDate', DB.data.openingBalances.date, 'type="date"'))}
      ${UI.field('Default notes on sales documents', UI.textarea('invoiceNotes', s.invoiceNotes), 'full')}
    </div><div class="btn-row mt"><button class="btn primary">${E(t('Save'))}</button></div></form>`;
  $('#f', el).onsubmit = e => {
    e.preventDefault();
    const v = UI.formValues(e.target);
    const code = v.baseCurrency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return UI.toast('Base currency must be a 3-letter code', 'err');
    const baseCur = DB.data.currencies.find(c => c.code === s.baseCurrency);
    if (baseCur && code !== s.baseCurrency) { baseCur.code = code; baseCur.rate = 1; }
    Object.assign(s, { baseCurrency: code, currency: v.currency, fyStartMonth: +v.fyStartMonth, paymentTerms: U.num(v.paymentTerms), invoiceNotes: v.invoiceNotes });
    DB.data.openingBalances.date = v.obDate;
    DB.log('Updated', 'Business Setting', s.company); DB.save(); UI.toast('Saved', 'ok'); render();
  };
});

route('/control/form-design', (el) => {
  const fd = DB.data.formDesign;
  const sample = DB.data.docs.filter(d => d.type === 'invoice').pop() || { id: 'x', type: 'invoice', number: 'INV-00001', date: U.today(), dueDate: U.addDays(U.today(), 30), contactId: '', ref: 'PO-123', notes: DB.data.settings.invoiceNotes, status: 'open', lines: [{ description: 'Sample product', qty: 2, price: 100, discount: 0, taxCodeId: 'tx-st10' }, { description: 'Sample service', qty: 1, price: 250, discount: 0, taxCodeId: 'tx-sv8' }] };
  el.innerHTML = `${UI.pageHead('Form Design', CP.crumbs('Company'))}
    <div class="grid g2" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr)">
      <form class="card" id="f">
        ${UI.field('Template', UI.select('template', [['classic', 'Classic'], ['modern', 'Modern (coloured header)'], ['compact', 'Compact']], fd.template))}
        <div class="mt">${UI.field('Accent colour', `<input type="color" name="accent" value="${E(fd.accent)}" style="height:40px">`)}</div>
        <div class="mt">${UI.check('showLogo', 'Show logo', fd.showLogo)}${UI.check('showTaxColumn', 'Show tax code column', fd.showTaxColumn !== false)}${UI.check('showSignature', 'Show signature lines', fd.showSignature)}</div>
        <div class="mt">${UI.field('Footer text', UI.textarea('footer', fd.footer, 'placeholder="e.g. Bank: Maybank 5140-xxxx · This is a computer-generated document."'))}</div>
        <div class="btn-row mt"><button class="btn primary">${E(t('Save'))}</button></div>
      </form>
      <div id="pv"></div>
    </div>`;
  const preview = () => { const saved = { ...fd }; Object.assign(fd, UI.formValues($('#f', el))); $('#pv', el).innerHTML = paperHtml(sample); Object.assign(fd, saved); };
  $('#f', el).addEventListener('input', preview);
  $('#f', el).addEventListener('change', preview);
  $('#f', el).onsubmit = e => { e.preventDefault(); Object.assign(fd, UI.formValues(e.target)); DB.log('Updated', 'Form Design', fd.template); DB.save(); UI.toast('Saved', 'ok'); };
  preview();
});

route('/control/form-settings', (el) => {
  const fs = DB.data.formSettings;
  const types = Object.keys(DOC_TYPES);
  el.innerHTML = `${UI.pageHead('Form Settings', CP.crumbs('Company'))}
    <form class="card" id="f"><p class="muted" style="margin-top:0">Numbering and default text for each document type. Next number shows what the next new document will get.</p>
    <div class="table-wrap"><table class="lines-table"><thead><tr><th>Document</th><th>Prefix</th><th class="num">Next no.</th><th>Title on print</th><th>Default notes</th></tr></thead><tbody>
      ${types.map(ty => { const c = fs[ty] || {}; const pre = C.prefix(ty); return `<tr><td><b>${E(t(DOC_TYPES[ty].label))}</b></td>
        <td><input name="${ty}.prefix" value="${E(pre)}" style="width:90px"></td>
        <td><input name="${ty}.next" type="number" min="1" value="${(DB.data.counters[pre] || 0) + 1}" class="right" style="width:90px"></td>
        <td><input name="${ty}.title" value="${E(c.title || '')}" placeholder="${E(DOC_TYPES[ty].label)}"></td>
        <td><input name="${ty}.notes" value="${E(c.notes ?? '')}" placeholder="${DOC_TYPES[ty].side === 'sales' ? '(company default)' : ''}"></td></tr>`; }).join('')}
    </tbody></table></div><div class="btn-row mt"><button class="btn primary">${E(t('Save'))}</button></div></form>`;
  $('#f', el).onsubmit = e => {
    e.preventDefault();
    const v = UI.formValues(e.target);
    types.forEach(ty => {
      const prefix = (v[ty + '.prefix'] || DOC_TYPES[ty].prefix).replace(/[^A-Za-z0-9/_-]/g, '');
      fs[ty] = { prefix, title: v[ty + '.title'], notes: v[ty + '.notes'] === '' ? undefined : v[ty + '.notes'] };
      const n = Math.max(1, Math.floor(U.num(v[ty + '.next'])));
      DB.data.counters[prefix] = n - 1;
    });
    DB.log('Updated', 'Form Settings', 'Numbering'); DB.save(); UI.toast('Saved', 'ok'); render();
  };
});

/* ---------------- Accounting ---------------- */
route('/control/accounts/:kind', (el, q, kind) => {
  const types = kind === 'pl' ? PL_TYPES : BS_TYPES;
  const bal = C.balances('', U.today());
  const fy = C.balances(U.fyStart(U.today()), U.today());
  const used = new Set(C.ledger().map(e => e.accountId));
  const list = DB.data.accounts.filter(a => types.includes(a.type)).sort((a, b) => a.code.localeCompare(b.code));
  el.innerHTML = `${UI.pageHead(kind === 'pl' ? 'Profit & Loss Accounts' : 'Balance Sheet Accounts', CP.crumbs('Accounting'), `<a class="btn" href="#/control/accounts/${kind === 'pl' ? 'bs' : 'pl'}">${E(t(kind === 'pl' ? 'Balance Sheet Accounts' : 'Profit & Loss Accounts'))}</a><button class="btn primary" id="new">+ New Account</button>`)}
    <div class="card"><div class="filters">${UI.searchBox()}</div>${UI.table([
      { label: 'Code', render: a => `<b>${E(a.code)}</b>` },
      { label: 'Name', render: a => `<a href="#/reports/gl-details?acc=${a.id}">${E(a.name)}</a>${a.sys ? ' <span class="badge">system</span>' : ''}${a.active === false ? ' <span class="badge red">inactive</span>' : ''}` },
      { label: 'Type', render: a => E(ACCOUNT_TYPES[a.type]) },
      ...(kind === 'bs' ? [{ label: 'Cash flow', render: a => E({ investing: 'Investing', financing: 'Financing', cash: 'Cash' }[a.cf] || 'Operating') }] : []),
      { label: kind === 'pl' ? 'This FY' : 'Balance', cls: 'num', render: a => { const v = (kind === 'pl' ? fy : bal)[a.id] || 0; return U.amt(['asset', 'expense', 'cogs'].includes(a.type) ? v : -v); } },
      { label: '', cls: 'num no-print', render: a => `<button class="btn sm" data-edit="${a.id}">${E(t('Edit'))}</button>${!a.sys && !used.has(a.id) ? ` <button class="btn sm danger" data-del="${a.id}">${E(t('Delete'))}</button>` : ''}` },
    ], list)}</div>`;
  const modal = a => {
    const isNew = !a;
    a = a ? { ...a } : { type: types[0], active: true, cf: '' };
    UI.modal(isNew ? 'New Account' : 'Edit Account', `<div class="form-grid">
      ${UI.field('Code *', UI.input('code', a.code))}
      ${UI.field('Name *', UI.input('name', a.name))}
      ${UI.field('Type', UI.select('type', types.map(k => [k, ACCOUNT_TYPES[k]]), a.type, a.sys ? 'disabled' : ''))}
      ${kind === 'bs' ? UI.field('Cash flow class', UI.select('cf', [['', 'Operating'], ['investing', 'Investing'], ['financing', 'Financing']], a.cf, a.sys === 'bank' ? 'disabled' : '')) : ''}
      <div class="field">${UI.check('active', 'Active', a.active !== false)}</div>
      ${UI.field('Description', UI.input('description', a.description), 'full')}
    </div>`, {
      onSubmit(v) {
        if (!v.code || !v.name) throw new Error('Code and name are required');
        if (DB.data.accounts.some(x => x.code === v.code && x.id !== a.id)) throw new Error('Account code already used');
        if (a.sys) { delete v.type; delete v.cf; }
        const rec = Object.assign(DB.get('accounts', a.id) || a, v);
        if (isNew) rec.id = 'a-' + U.uid();
        DB.upsert('accounts', rec, 'Account');
        const bank = DB.data.bankAccounts.find(b => b.glAccountId === rec.id);
        if (bank) { bank.name = rec.name; DB.save(); }
        UI.toast('Saved', 'ok'); render();
      },
    });
  };
  $('#new', el).onclick = () => modal();
  $$('[data-edit]', el).forEach(b => b.onclick = () => modal(DB.get('accounts', b.dataset.edit)));
  $$('[data-del]', el).forEach(b => b.onclick = () => {
    const id = b.dataset.del;
    if (DB.data.products.some(p => p.salesAccountId === id || p.purchaseAccountId === id) || DB.data.docs.some(d => d.lines.some(l => l.accountId === id)) || DB.data.transactions.some(x => x.accountId === id)) return UI.toast('Account is in use', 'err');
    if (confirm('Delete this account?')) { DB.remove('accounts', id, 'Account'); render(); }
  });
});

route('/control/opening', (el) => {
  const ob = DB.data.openingBalances;
  const accs = DB.data.accounts.filter(a => a.type !== 'income' && a.type !== 'cogs' && a.type !== 'expense' && a.sys !== 'bank' && a.sys !== 'obe' && a.sys !== 'inventory').sort((a, b) => a.code.localeCompare(b.code));
  const val = (id, k) => { const l = ob.lines.find(x => x.accountId === id); return l ? l[k] || '' : ''; };
  const bankTotal = U.sum(DB.data.bankAccounts, b => U.num(b.openingBalance));
  const stockTotal = U.sum(DB.data.products.filter(C.isStock), p => U.num(p.openingQty) * U.num(p.costPrice));
  el.innerHTML = `${UI.pageHead('Opening Balance', CP.crumbs('Accounting'))}
    <div class="alert info">Enter balances from your previous system as at the conversion date. Bank balances are set on each <a href="#/banking/accounts">bank account</a> and opening stock on each <a href="#/products">product</a>. For receivables/payables, it's best to enter the unpaid invoices and bills themselves so you can record payments against them. Any difference goes to <b>Opening Balance Equity</b>.</div>
    <form class="card" id="f">
      <div class="filters">${UI.field('Conversion date', UI.input('date', ob.date || U.yearStart(U.today()), 'type="date"'))}</div>
      <div class="table-wrap"><table class="lines-table"><thead><tr><th>${E(t('Account'))}</th><th class="num" style="width:180px">${E(t('Debit'))}</th><th class="num" style="width:180px">${E(t('Credit'))}</th></tr></thead><tbody>
        <tr><td class="muted">Bank & cash accounts (from bank accounts)</td><td class="num muted">${U.amt(bankTotal)}</td><td></td></tr>
        <tr><td class="muted">Inventory (from products' opening qty × cost)</td><td class="num muted">${U.amt(stockTotal)}</td><td></td></tr>
        ${accs.map(a => `<tr><td>${E(a.code)} · ${E(a.name)}</td><td><input name="d.${a.id}" type="number" step="0.01" class="right ob" value="${E(val(a.id, 'debit'))}"></td><td><input name="c.${a.id}" type="number" step="0.01" class="right ob" value="${E(val(a.id, 'credit'))}"></td></tr>`).join('')}
      </tbody><tfoot><tr><td>Total · difference to Opening Balance Equity: <span id="obd"></span></td><td class="num" id="obdr"></td><td class="num" id="obcr"></td></tr></tfoot></table></div>
      <div class="btn-row mt"><button class="btn primary">${E(t('Save'))}</button></div>
    </form>`;
  const tot = () => {
    const v = UI.formValues($('#f', el));
    const dr = bankTotal + stockTotal + U.sum(accs, a => U.num(v['d.' + a.id])), cr = U.sum(accs, a => U.num(v['c.' + a.id]));
    $('#obdr', el).textContent = U.amt(dr); $('#obcr', el).textContent = U.amt(cr); $('#obd', el).textContent = U.amt(dr - cr);
  };
  $('#f', el).addEventListener('input', tot);
  $('#f', el).onsubmit = e => {
    e.preventDefault();
    const v = UI.formValues(e.target);
    ob.date = v.date;
    ob.lines = accs.map(a => ({ accountId: a.id, debit: U.r2(U.num(v['d.' + a.id])), credit: U.r2(U.num(v['c.' + a.id])) })).filter(l => l.debit || l.credit);
    DB.log('Updated', 'Opening Balance', U.fdate(ob.date)); DB.save(); UI.toast('Opening balances saved', 'ok'); render();
  };
  tot();
});

route('/control/budgets', (el, q) => {
  const fy = q.fy || U.fyStart(U.today());
  const accs = DB.data.accounts.filter(a => PL_TYPES.includes(a.type) && a.active !== false).sort((a, b) => a.code.localeCompare(b.code));
  const months = [...Array(12)].map((_, i) => U.addMonths(fy, i).slice(0, 7));
  const get = id => (DB.data.budgets.find(b => b.fy === fy && b.accountId === id) || { months: Array(12).fill('') }).months;
  const fyOpts = [-1, 0, 1, 2].map(n => U.addMonths(U.fyStart(U.today()), n * 12)).map(d => [d, `FY starting ${U.fdate(d)}`]);
  el.innerHTML = `${UI.pageHead('Budgets', CP.crumbs('Accounting'), `<a class="btn" href="#/reports/budget?fy=${fy}">${E(t('Budget vs Actual'))}</a>`)}
    <div class="filters">${UI.field('Financial year', UI.select('', fyOpts, fy, 'id="fy"'))}<button class="btn" id="copyAct">Fill from last year's actuals</button></div>
    <form class="card" id="f"><p class="muted small" style="margin-top:0">Tip: type an amount in the <b>Each month</b> column to fill all 12 months.</p>
      <div class="table-wrap budget-grid"><table class="lines-table"><thead><tr><th>${E(t('Account'))}</th><th class="num">Each month</th>${months.map(m => `<th class="num">${U.monthLabel(m)}</th>`).join('')}<th class="num">${E(t('Total'))}</th></tr></thead><tbody>
      ${accs.map(a => `<tr data-a="${a.id}"><td class="nowrap">${E(a.code)} · ${E(a.name)}</td><td><input class="fill" type="number" step="0.01"></td>${get(a.id).map((v, i) => `<td><input name="${a.id}.${i}" type="number" step="0.01" value="${E(v)}"></td>`).join('')}<td class="num rt"></td></tr>`).join('')}
      </tbody></table></div><div class="btn-row mt"><button class="btn primary">Save budget</button></div></form>`;
  const tot = () => $$('tr[data-a]', el).forEach(tr => { $('.rt', tr).textContent = U.amt(U.sum($$('input[name]', tr), i => U.num(i.value))); });
  $('#fy', el).onchange = e => { location.hash = '#/control/budgets?fy=' + e.target.value; };
  $$('.fill', el).forEach(f => f.oninput = () => { $$('input[name]', f.closest('tr')).forEach(i => { i.value = f.value; }); tot(); });
  $('#f', el).addEventListener('input', tot);
  $('#copyAct', el).onclick = () => {
    const pfy = U.addMonths(fy, -12);
    accs.forEach(a => months.forEach((m, i) => {
      const pm = U.addMonths(pfy, i);
      const v = (C.balances(pm, U.monthEnd(pm))[a.id] || 0) * (a.type === 'income' ? -1 : 1);
      const inp = $(`input[name="${a.id}.${i}"]`, el); if (inp) inp.value = v ? U.r2(v) : '';
    }));
    tot();
  };
  $('#f', el).onsubmit = e => {
    e.preventDefault();
    const v = UI.formValues(e.target);
    DB.data.budgets = DB.data.budgets.filter(b => b.fy !== fy);
    accs.forEach(a => { const ms = months.map((_, i) => U.num(v[`${a.id}.${i}`])); if (ms.some(Boolean)) DB.data.budgets.push({ id: U.uid(), fy, accountId: a.id, months: ms }); });
    DB.log('Updated', 'Budget', 'FY ' + fy); DB.save(); UI.toast('Budget saved', 'ok');
  };
  tot();
});

/* ---------------- Inventory setup ---------------- */
route('/control/uom', (el) => {
  const units = DB.data.inventorySettings.units;
  el.innerHTML = `${UI.pageHead('Unit of Measurement (UOM)', CP.crumbs('Inventory'))}
    <div class="card"><p class="muted" style="margin-top:0">Base units used on products. Alternative units with conversion factors (e.g. 1 carton = 24 pcs) are set on each product.</p>
    <div class="filters"><div class="field" style="max-width:260px"><input id="u" placeholder="New unit e.g. litre"></div><button class="btn primary" id="add">+ Add</button></div>
    ${UI.table([{ label: 'Unit', render: u => E(u) }, { label: 'Products', cls: 'num', render: u => DB.data.products.filter(p => p.unit === u).length }, { label: '', cls: 'num', render: u => `<button class="btn sm danger" data-del="${E(u)}">${E(t('Delete'))}</button>` }], units)}</div>`;
  $('#add', el).onclick = () => { const v = $('#u', el).value.trim(); if (!v || units.includes(v)) return; units.push(v); DB.log('Created', 'UOM', v); DB.save(); render(); };
  $$('[data-del]', el).forEach(b => b.onclick = () => { DB.data.inventorySettings.units = units.filter(u => u !== b.dataset.del); DB.save(); render(); });
});
route('/control/locations', (el) => masterPage(el, {
  title: 'Locations', section: 'Inventory', col: 'locations', label: 'Location',
  intro: 'Warehouses, shops or stores where you keep stock. The first location is the default.',
  columns: [{ label: 'Name', render: r => `<b>${E(r.name)}</b>${r.id === DB.data.locations[0].id ? ' <span class="badge green">Default</span>' : ''}` }, { label: 'Address', render: r => E(r.address || '') }, { label: 'Units on hand', cls: 'num', render: r => U.qty(U.sum(C.stockItems(), p => C.stockQty(p.id, '', r.id))) }],
  fields: r => UI.field('Name *', UI.input('name', r.name)) + UI.field('Address', UI.input('address', r.address), 'full'),
  onSave: r => { if (!r.name) throw new Error('Name is required'); },
  canDelete: r => DB.data.locations.length < 2 ? 'You need at least one location' : C.inv().moves.some(m => m.loc === r.id) || DB.data.docs.some(d => d.locationId === r.id) ? 'Location has stock history' : '',
}));
route('/control/inventory', (el) => {
  const s = DB.data.inventorySettings;
  el.innerHTML = `${UI.pageHead('Inventory Settings', CP.crumbs('Inventory'))}
    <form class="card" id="f"><div class="form-grid">
      <div class="field full">${UI.check('trackStock', 'Track stock quantities for products', s.trackStock)}${UI.check('allowNegative', 'Allow selling more than stock on hand (negative stock)', s.allowNegative)}</div>
      ${UI.field('Default low-stock level', UI.input('lowStockLevel', s.lowStockLevel, 'type="number" min="0" step="any"'))}
      ${UI.field('Forecast: sales history (days)', UI.input('forecastDays', s.forecastDays, 'type="number" min="7"'))}
      ${UI.field('Forecast: supplier lead time (days)', UI.input('leadDays', s.leadDays, 'type="number" min="0"'))}
    </div>
    <p class="muted small">Costing method: moving weighted average. Stock is valued from opening cost, bills / received items, builds and adjustments.</p>
    <div class="btn-row mt"><button class="btn primary">${E(t('Save'))}</button></div></form>`;
  $('#f', el).onsubmit = e => {
    e.preventDefault(); const v = UI.formValues(e.target);
    Object.assign(s, { trackStock: v.trackStock, allowNegative: v.allowNegative, lowStockLevel: U.num(v.lowStockLevel), forecastDays: U.num(v.forecastDays) || 90, leadDays: U.num(v.leadDays) });
    DB.log('Updated', 'Inventory Settings', ''); DB.save(); UI.toast('Saved', 'ok');
  };
});
route('/inventory/settings', () => { location.replace('#/control/inventory'); });

/* ---------------- Integrated apps ---------------- */
route('/control/apps', (el) => {
  const ig = DB.data.integrations;
  el.innerHTML = `${UI.pageHead('Integrated Apps', [['Control Panel', '#/control']])}
    <div class="grid g2">
      <form class="card" id="ai"><h2>A.I Scan — Claude</h2>
        <p class="muted">Lets A.I Scan read receipts and supplier invoices automatically. Uses your own Anthropic API key (from console.anthropic.com); each scan is billed to that key. The image is sent directly from this browser to Anthropic.</p>
        <div class="form-grid">
          ${UI.field('Anthropic API key', `<input name="aiKey" type="password" autocomplete="off" value="${E(ig.aiKey)}" placeholder="sk-ant-…">`, 'full')}
          ${UI.field('Model', UI.select('aiModel', [['claude-opus-5-5', 'Claude Opus 5.5 (default)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, cheaper)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (fastest, cheapest)']], ig.aiModel))}
        </div>
        <p class="small muted">The key is stored in this browser with your company data and is included in backups — keep backup files private.</p>
        <div class="btn-row mt"><button class="btn primary">${E(t('Save'))}</button>${ig.aiKey ? '<button type="button" class="btn danger" id="rmkey">Remove key</button>' : ''}</div>
      </form>
      <div class="card"><h2>Spreadsheet export</h2><p class="muted">Download your data as CSV files for Excel, Google Sheets or your accountant.</p>
        <div class="btn-row"><button class="btn" data-x="docs">Documents</button><button class="btn" data-x="lines">Document lines</button><button class="btn" data-x="payments">Payments</button><button class="btn" data-x="ledger">General ledger</button><button class="btn" data-x="contacts">Contacts</button></div></div>
    </div>`;
  $('#ai', el).onsubmit = e => { e.preventDefault(); const v = UI.formValues(e.target); Object.assign(ig, v); DB.log('Updated', 'Integrated Apps', 'A.I Scan'); DB.save(); UI.toast('Saved', 'ok'); render(); };
  const rm = $('#rmkey', el); if (rm) rm.onclick = () => { ig.aiKey = ''; DB.save(); render(); };
  $$('[data-x]', el).forEach(b => b.onclick = () => {
    const x = b.dataset.x;
    let rows;
    if (x === 'docs') rows = [['Type', 'Number', 'Date', 'Due', 'Contact', 'Reference', 'Currency', 'Rate', 'Net', 'Tax', 'Total', 'Balance', 'Status'], ...DB.data.docs.map(d => { const tt = C.totals(d); return [C.docTitle(d), d.number, d.date, d.dueDate, C.contactName(d.contactId), d.ref, d.currency || '', C.rate(d), tt.net, tt.tax, tt.total, DOC_TYPES[d.type].payable ? C.balance(d) : '', C.status(d)]; })];
    else if (x === 'lines') rows = [['Number', 'Date', 'Item code', 'Description', 'Qty', 'UOM', 'Price', 'Disc %', 'Tax code', 'Net', 'Tax'], ...DB.data.docs.flatMap(d => d.lines.map(l => { const lc = C.line(l); return [d.number, d.date, C.product(l.productId)?.code || '', l.description, l.qty, l.uom || '', l.price, l.discount, C.taxCode(l.taxCodeId)?.code || '', lc.net, lc.tax]; }))];
    else if (x === 'payments') rows = [['Number', 'Type', 'Date', 'Contact', 'Document', 'Account', 'Method', 'Reference', 'Amount'], ...DB.data.payments.map(p => [p.number, PAY_KINDS[p.kind].label, p.date, C.contactName(p.contactId), DB.get('docs', p.docId)?.number || '', C.accountName(p.bankAccountId), p.method, p.ref, p.amount])];
    else if (x === 'ledger') rows = [['Date', 'Source', 'Number', 'Account code', 'Account', 'Description', 'Contact', 'Debit', 'Credit'], ...C.ledger().map(e => [e.date, e.source, e.number, C.gl(e.accountId)?.code, C.gl(e.accountId)?.name, e.memo, e.contactId ? C.contactName(e.contactId) : '', e.debit, e.credit])];
    else rows = [['Name', 'Type', 'Entity', 'Reg no', 'TIN', 'Email', 'Phone', 'Address'], ...DB.data.contacts.map(c => [c.name, c.type, c.entity, c.regNo, c.tin, c.email, c.phone, c.address])];
    U.download(`${x}-${U.today()}.csv`, '﻿' + U.csv(rows), 'text/csv');
  });
});

/* ---------------- Backup & data ---------------- */
route('/control/data', (el) => {
  const size = (() => { try { return (localStorage.getItem(DB.key()) || '').length; } catch (e) { return 0; } })();
  el.innerHTML = `${UI.pageHead('Backup & Data', [['Control Panel', '#/control']])}
    <div class="card"><h2>Backup</h2>
      <p class="muted">Data for <b>${E(DB.data.settings.company)}</b> is stored in this browser on this computer (${(size / 1024).toFixed(0)} KB). Export a backup regularly and keep it safe.</p>
      <div class="btn-row">
        <button class="btn primary" id="export">Export backup (.json)</button>
        <label class="btn">Import backup<input type="file" id="import" accept=".json,application/json" hidden></label>
      </div></div>
    <div class="card"><h2>Sample data & reset</h2>
      <div class="btn-row"><button class="btn" id="sample">Load sample data</button><button class="btn danger" id="reset">Erase all data for this company</button></div></div>`;
  $('#export', el).onclick = () => U.download(`cfo-backup-${DB.data.settings.company.replace(/[^\w]+/g, '-')}-${U.today()}.json`, JSON.stringify(DB.data, null, 2), 'application/json');
  $('#import', el).onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then(txt => {
      const d = JSON.parse(txt);
      if (!d.settings || !Array.isArray(d.docs)) throw new Error('Not a CFO backup file');
      if (!confirm('Replace ALL data of the current company with this backup?')) return;
      DB.replace(d); DB.log('Imported', 'Backup', f.name); DB.save(); UI.toast('Backup restored', 'ok'); render();
    }).catch(err => UI.toast('Import failed: ' + err.message, 'err'));
  };
  $('#sample', el).onclick = () => { if (confirm('Replace all current data with sample data?')) { loadSampleData(); UI.toast('Sample data loaded', 'ok'); location.hash = '#/'; } };
  $('#reset', el).onclick = () => { if (confirm('Erase ALL data for this company permanently? Export a backup first if needed.')) { DB.reset(); UI.toast('All data erased'); location.hash = '#/'; render(); } };
});
