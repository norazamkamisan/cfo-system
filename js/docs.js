'use strict';
/* =========================================================================
   Sales & Purchases: lists, document form, view/print, conversion,
   payments & refunds, sales/purchases summary reports
   ========================================================================= */

const STATUS_TABS = {
  quotation: ['open', 'accepted', 'declined', 'converted'],
  salesOrder: ['open', 'converted'],
  purchaseOrder: ['open', 'converted'],
  receiveItem: ['open', 'converted'],
  invoice: ['unpaid', 'partial', 'overdue', 'paid', 'void'],
  salesDebitNote: ['unpaid', 'partial', 'overdue', 'paid', 'void'],
  bill: ['unpaid', 'partial', 'overdue', 'paid', 'void'],
  purchaseDebitNote: ['unpaid', 'partial', 'overdue', 'paid', 'void'],
  creditNote: ['open', 'closed', 'void'],
  purchaseCreditNote: ['open', 'closed', 'void'],
};
const sideOf = type => DOC_TYPES[type].side;
const moduleCrumb = type => sideOf(type) === 'sales' ? ['Sales', '#/sales'] : ['Purchases', '#/purchases'];
const docMoney = (d, n) => C.isBase(d.currency) ? U.amt(n) : `${E(d.currency)} ${U.amt(n)}`;

function docTable(list, opts = {}) {
  const cols = [
    { label: 'Date', render: d => U.fdate(d.date) },
    ...(opts.showType ? [{ label: 'Type', render: d => E(t(C.docTitle(d))) }] : []),
    { label: 'Number', render: d => `<a href="#/doc/${d.id}"><b>${E(d.number)}</b></a>` },
    { label: opts.party || 'Contact', render: d => E(C.contactName(d.contactId)) },
    { label: 'Reference', render: d => E(d.ref || '') },
    { label: 'Due Date', render: d => U.fdate(d.dueDate) },
    { label: 'Status', render: d => UI.badge(C.status(d)) },
    { label: 'Total', cls: 'num', render: d => docMoney(d, C.total(d)) },
    { label: 'Balance', cls: 'num', render: d => DOC_TYPES[d.type].payable ? docMoney(d, C.balance(d)) : DOC_TYPES[d.type].isCredit ? docMoney(d, C.creditRemaining(d)) : '' },
  ];
  return UI.table(cols, list, { href: d => '#/doc/' + d.id, empty: opts.empty || 'No documents yet.' });
}

/* ---------------- Sales List / Purchases List ---------------- */
function sideList(el, q, side) {
  const isSales = side === 'sales';
  const types = isSales ? SALES_TYPES : PURCHASE_TYPES;
  const kinds = isSales ? ['receive', 'refund-out'] : ['pay', 'refund-in'];
  const tab = q.tab || 'all';
  const tabs = [['all', 'All'], ...types.map(ty => [ty, DOC_TYPES[ty].plural]), [kinds[0], 'Payments'], [kinds[1], 'Refunds']];
  let body;
  if (PAY_KINDS[tab]) {
    const list = DB.data.payments.filter(p => p.kind === tab).sort((a, b) => b.date.localeCompare(a.date));
    body = paymentsTable(list);
  } else {
    const list = DB.data.docs.filter(d => (tab === 'all' ? types.includes(d.type) : d.type === tab)).sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
    body = docTable(list, { showType: tab === 'all', party: isSales ? 'Customer' : 'Supplier' });
  }
  const create = isSales
    ? [['Quote', 'quotation'], ['Sale Order', 'salesOrder'], ['Invoice', 'invoice'], ['Credit Note', 'creditNote'], ['Debit Note', 'salesDebitNote']]
    : [['Purchase Order', 'purchaseOrder'], ['Receive Item', 'receiveItem'], ['Bill', 'bill'], ['Credit Note', 'purchaseCreditNote'], ['Debit Note', 'purchaseDebitNote']];
  el.innerHTML = `${UI.pageHead(isSales ? 'Sales List' : 'Purchases List', null,
    `<button class="btn" data-pay="${kinds[0]}">+ ${E(t('Payment'))}</button><button class="btn" data-pay="${kinds[1]}">+ ${E(t('Refund'))}</button><a class="btn" href="#/reports/${side}">${E(t('Reports'))}</a><a class="btn primary" href="#/docs/${isSales ? 'invoice' : 'bill'}/new">+ ${E(t(isSales ? 'Invoice' : 'Bill'))}</a>`)}
    <div class="btn-row" style="margin-bottom:12px">${create.map(([l, ty]) => `<a class="btn sm" href="#/docs/${ty}/new">+ ${E(t(l))}</a>`).join('')}</div>
    <div class="tabs">${tabs.map(([k, l]) => `<a href="#/${isSales ? 'sales' : 'purchases'}?tab=${k}" class="${tab === k ? 'active' : ''}">${E(t(l))}</a>`).join('')}</div>
    <div class="card"><div class="filters">${UI.searchBox()}</div>${body}</div>`;
  $$('[data-pay]', el).forEach(b => b.onclick = () => newPaymentFor(b.dataset.pay));
  wirePaymentActions(el);
  if (q.new) { history.replaceState(null, '', `#/${isSales ? 'sales' : 'purchases'}?tab=${q.new}`); newPaymentFor(q.new); }
}
route('/sales', (el, q) => sideList(el, q, 'sales'));
route('/purchases', (el, q) => sideList(el, q, 'purchases'));

function newPaymentFor(kind) {
  const k = PAY_KINDS[kind];
  const refund = kind.startsWith('refund');
  let docs;
  if (refund) docs = C.liveDocs(k.side === 'sales' ? 'creditNote' : 'purchaseCreditNote').filter(d => C.creditRemaining(d) > 0.005);
  else docs = C.openPayables(k.side).filter(d => C.balance(d) > 0.005);
  if (!docs.length) return UI.toast(refund ? 'No credit notes with unused credit' : `No unpaid ${k.side === 'sales' ? 'invoices / debit notes' : 'bills / debit notes'}`, 'err');
  paymentModal({ kind, pickFrom: docs });
}

/* ---------------- Single-type list ---------------- */
route('/docs/:type', (el, q, type) => {
  const ty = DOC_TYPES[type];
  if (!ty) throw new Error('Unknown document type');
  const tab = q.status || 'all';
  let list = C.docs(type).sort((a, b) => (b.date + b.number).localeCompare(a.date + a.number));
  if (tab !== 'all') list = list.filter(d => C.status(d) === tab);
  el.innerHTML = `${UI.pageHead(ty.plural, [moduleCrumb(type)], `<a class="btn primary" href="#/docs/${type}/new">+ ${E(t(ty.label))}</a>`)}
    <div class="tabs">${['all', ...STATUS_TABS[type]].map(s => `<a href="#/docs/${type}?status=${s}" class="${tab === s ? 'active' : ''}">${E(t(s[0].toUpperCase() + s.slice(1)))}</a>`).join('')}</div>
    <div class="card"><div class="filters">${UI.searchBox()}</div>${docTable(list, { party: ty.party === 'customer' ? 'Customer' : 'Supplier' })}</div>`;
});

/* ---------------- Document form ---------------- */
const sideKey = type => sideOf(type) === 'sales' ? 'sales' : 'purchase';
const emptyLine = type => ({ productId: '', description: '', qty: 1, price: 0, discount: 0, taxCodeId: sideKey(type) === 'sales' ? DB.data.taxSettings.defaultSales : DB.data.taxSettings.defaultPurchase, accountId: '', uom: '', factor: 1 });
function lineFromProduct(p, doc, qty) {
  const sales = sideKey(doc.type) === 'sales';
  return {
    productId: p.id, description: p.name, qty: qty || 1, discount: 0, uom: p.unit || '', factor: 1, batch: '', expiry: '',
    price: U.r2((sales ? C.priceFor(p, doc.contactId) : U.num(p.costPrice)) / C.rate(doc)),
    taxCodeId: sales ? p.taxSale : p.taxPurchase,
    accountId: sales ? (p.salesAccountId || '') : (p.purchaseAccountId || ''),
  };
}
function defaultDue(doc) {
  const ty = DOC_TYPES[doc.type];
  if (!ty.dueLabel) return '';
  if (ty.payable) {
    const c = C.contact(doc.contactId);
    return U.addDays(doc.date, c && c.terms !== undefined && c.terms !== '' ? c.terms : DB.data.settings.paymentTerms);
  }
  return U.addDays(doc.date, ty.dueDays || 0);
}
function newDoc(type, q) {
  const ty = DOC_TYPES[type];
  const fs = DB.data.formSettings[type] || {};
  const doc = {
    type, number: DB.peekNumber(C.prefix(type)), date: U.today(), dueDate: '', contactId: q.contact || '', ref: '', lines: [],
    notes: fs.notes ?? (ty.side === 'sales' ? DB.data.settings.invoiceNotes : ''), status: 'open',
    currency: DB.data.settings.baseCurrency, rate: 1, locationId: C.defaultLocation(), jobId: '', selfBilled: false,
  };
  const src = q.from && DB.get('docs', q.from);
  if (src) {
    Object.assign(doc, { sourceId: src.id, contactId: src.contactId, ref: src.ref || src.number, currency: src.currency || doc.currency, rate: src.rate || 1, locationId: src.locationId || doc.locationId, jobId: src.jobId || '' });
    if (!ty.isCredit && !(ty.payable && DOC_TYPES[src.type].payable)) { doc.lines = src.lines.map(l => ({ ...l })); doc.notes = src.notes ?? doc.notes; }
    else if (ty.isCredit) doc.lines = src.lines.map(l => ({ ...l }));
  }
  if (q.product) { const p = C.product(q.product); if (p) doc.lines.push(lineFromProduct(p, doc, 1)); }
  if (!doc.lines.length) doc.lines.push(emptyLine(type));
  doc.dueDate = defaultDue(doc);
  return doc;
}

route('/docs/:type/new', (el, q, type) => { if (!DOC_TYPES[type]) throw new Error('Unknown document type'); docForm(el, newDoc(type, q), true); });
route('/doc/:id/edit', (el, q, id) => {
  const d = DB.get('docs', id);
  if (!d) throw new Error('Document not found');
  docForm(el, JSON.parse(JSON.stringify(d)), false);
});

function docForm(el, doc, isNew) {
  const ty = DOC_TYPES[doc.type];
  const sk = sideKey(doc.type);
  const src = doc.sourceId && DB.get('docs', doc.sourceId);
  const multiCur = DB.data.currencies.length > 1;
  const multiLoc = DB.data.locations.length > 1 && ty.stock;
  const hasJobs = DB.data.jobs.length > 0;
  const sourceChoices = () => ty.sourceType ? C.liveDocs(ty.sourceType).filter(d => !doc.contactId || d.contactId === doc.contactId) : [];
  const srcOpts = () => [['', '— None —'], ...sourceChoices().map(d => [d.id, `${d.number} · ${U.amt(C.total(d))}`])];
  const accTypes = sk === 'sales' ? ['income'] : ['cogs', 'expense', 'asset'];

  el.innerHTML = `${UI.pageHead((isNew ? 'New ' : 'Edit ') + t(ty.label), [moduleCrumb(doc.type), [ty.plural, '#/docs/' + doc.type]])}
    ${src && isNew ? `<div class="alert info">Creating from ${E(t(DOC_TYPES[src.type].label))} <b>${E(src.number)}</b>.</div>` : ''}
    <form id="docform" class="card" novalidate>
      <div class="form-grid">
        <div class="field"><label>${E(t(ty.party === 'customer' ? 'Customer' : 'Supplier'))} *</label>
          <div class="input-inline">${UI.select('contactId', UI.contactOptions(ty.party), doc.contactId)}<button type="button" class="btn" id="newContact" title="New contact">+</button></div></div>
        ${UI.field('Number *', UI.input('number', doc.number))}
        ${UI.field('Date *', UI.input('date', doc.date, 'type="date"'))}
        ${ty.dueLabel ? UI.field(ty.dueLabel, UI.input('dueDate', doc.dueDate, 'type="date"')) : ''}
        ${UI.field('Reference', UI.input('ref', doc.ref, 'placeholder="e.g. customer PO / supplier invoice no."'))}
        ${ty.sourceType ? UI.field(`Against ${DOC_TYPES[ty.sourceType].label}`, UI.select('sourceId', srcOpts(), doc.sourceId || '')) : ''}
        ${multiCur ? UI.field('Currency', UI.select('currency', UI.currencyOptions(), doc.currency || DB.data.settings.baseCurrency)) + UI.field('Exchange rate (to ' + DB.data.settings.baseCurrency + ')', UI.input('rate', doc.rate || 1, 'type="number" step="any" min="0"')) : ''}
        ${multiLoc ? UI.field('Location', UI.select('locationId', UI.locationOptions(), doc.locationId)) : ''}
        ${hasJobs ? UI.field('Job', UI.select('jobId', UI.jobOptions(), doc.jobId)) : ''}
        ${ty.selfBill ? `<div class="field" style="justify-content:flex-end">${UI.check('selfBilled', 'Self-billed (issued by us on behalf of supplier)', doc.selfBilled)}</div>` : ''}
      </div>
      <h3 class="mt" style="margin-bottom:8px">${E(t('Items'))}</h3>
      <div class="table-wrap"><table class="lines-table">
        <thead><tr><th class="c-prod">${E(t('Item'))}</th><th class="c-desc">${E(t('Description'))}</th><th class="c-acc">${E(t('Account'))}</th><th class="c-qty num">${E(t('Qty'))}</th><th class="c-price num">${E(t('Price'))}</th><th class="c-disc num">Disc %</th><th class="c-tax">${E(t('Tax'))}</th><th class="c-amt num">${E(t('Amount'))}</th><th class="c-del"></th></tr></thead>
        <tbody id="lines"></tbody>
      </table></div>
      <div class="btn-row mt"><button type="button" class="btn" id="addLine">+ Add line</button><button type="button" class="btn" id="newProduct">+ ${E(t('New Product / Service'))}</button></div>
      <div class="grid g2 mt">
        <div>${UI.field('Notes', UI.textarea('notes', doc.notes, 'rows="4"'))}</div>
        <div class="totals" id="totals"></div>
      </div>
      <div class="btn-row mt" style="justify-content:flex-end">
        <a class="btn" href="${isNew ? '#/docs/' + doc.type : '#/doc/' + doc.id}">${E(t('Cancel'))}</a>
        <button class="btn primary" type="submit">${E(t('Save'))} ${E(t(ty.label))}</button>
      </div>
    </form>`;

  const form = $('#docform', el);
  const tbody = $('#lines', el);
  const prodOptions = () => [['', '— Custom item —'], ...DB.data.products.filter(p => p.active !== false || doc.lines.some(l => l.productId === p.id)).map(p => [p.id, (p.code ? p.code + ' · ' : '') + p.name])];

  const drawLines = () => {
    tbody.innerHTML = doc.lines.map((l, i) => {
      const p = C.product(l.productId);
      const stockForced = sk === 'purchase' && ty.stock && C.isStock(p);
      const uoms = p ? [[p.unit || 'unit', p.unit || 'unit'], ...(p.uoms || []).map(u => [u.name, `${u.name} (×${u.factor})`])] : null;
      const batch = p && p.trackSerial && ty.stock;
      return `<tr data-i="${i}">
        <td class="c-prod">${UI.select('', prodOptions(), l.productId, 'data-f="productId"')}</td>
        <td class="c-desc"><input data-f="description" value="${E(l.description)}">
          ${batch ? `<div class="sub-inputs"><input data-f="batch" placeholder="Serial / batch no." value="${E(l.batch || '')}"><input data-f="expiry" type="date" title="Expiry date" value="${E(l.expiry || '')}"></div>` : ''}</td>
        <td class="c-acc">${stockForced ? `<span class="small muted">${E(C.glName(C.lineAccount(doc, l)))}</span>` : UI.select('', UI.glOptions(accTypes, '(default)'), l.accountId || '', 'data-f="accountId"')}</td>
        <td class="c-qty"><input data-f="qty" type="number" step="any" value="${E(l.qty)}" class="right">
          ${uoms && uoms.length > 1 ? UI.select('', uoms, l.uom || p.unit, 'data-f="uom" style="margin-top:4px"') : ''}</td>
        <td class="c-price"><input data-f="price" type="number" step="0.01" value="${E(l.price)}" class="right"></td>
        <td class="c-disc"><input data-f="discount" type="number" step="any" min="0" max="100" value="${E(l.discount || 0)}" class="right"></td>
        <td class="c-tax">${UI.select('', UI.taxOptions(sk), l.taxCodeId, 'data-f="taxCodeId"')}</td>
        <td class="c-amt num" data-amt></td>
        <td class="c-del"><button type="button" class="btn link" data-rm title="Remove">✕</button></td></tr>`;
    }).join('');
    drawTotals();
  };
  const drawTotals = () => {
    $$('tr', tbody).forEach(tr => { $('[data-amt]', tr).textContent = U.amt(C.line(doc.lines[tr.dataset.i]).net); });
    const tt = C.totals(doc);
    const cur = form.currency ? form.currency.value : doc.currency;
    const rate = form.rate ? U.num(form.rate.value) || 1 : 1;
    $('#totals', el).innerHTML = `
      <div class="row"><span>Subtotal</span><span>${U.amt(tt.subtotal)}</span></div>
      ${tt.discount ? `<div class="row"><span>Discount</span><span>−${U.amt(tt.discount)}</span></div>` : ''}
      ${Object.entries(tt.byTax).map(([id, v]) => `<div class="row"><span>${E(C.taxCode(id)?.name || 'Tax')}</span><span>${U.amt(v.tax)}</span></div>`).join('')}
      <div class="row grand"><span>${E(t('Total'))}</span><span>${E(cur ? C.curSymbol(cur) : '')} ${U.amt(tt.total)}</span></div>
      ${!C.isBase(cur) ? `<div class="row muted small"><span>In ${E(DB.data.settings.baseCurrency)}</span><span>${U.amt(tt.total * rate)}</span></div>` : ''}`;
  };
  tbody.addEventListener('input', e => {
    const f = e.target.dataset.f;
    if (!f) return;
    const i = +e.target.closest('tr').dataset.i;
    const l = doc.lines[i];
    l[f] = e.target.value;
    if (f === 'productId') {
      const p = C.product(e.target.value);
      doc.contactId = form.contactId.value;
      if (p) doc.lines[i] = lineFromProduct(p, doc, l.qty || 1);
      drawLines(); return;
    }
    if (f === 'uom') {
      const p = C.product(l.productId);
      const u = (p.uoms || []).find(x => x.name === l.uom);
      l.factor = u ? U.num(u.factor) || 1 : 1;
      const basePrice = sk === 'sales' ? C.priceFor(p, form.contactId.value) : U.num(p.costPrice);
      l.price = U.r2((u && U.num(u.price) ? U.num(u.price) : basePrice * l.factor) / (form.rate ? U.num(form.rate.value) || 1 : 1));
      drawLines(); return;
    }
    drawTotals();
  });
  tbody.addEventListener('click', e => {
    if (!e.target.closest('[data-rm]')) return;
    doc.lines.splice(+e.target.closest('tr').dataset.i, 1);
    if (!doc.lines.length) doc.lines.push(emptyLine(doc.type));
    drawLines();
  });
  $('#addLine', el).onclick = () => { doc.lines.push(emptyLine(doc.type)); drawLines(); };
  $('#newProduct', el).onclick = () => productModal(null, p => {
    const last = doc.lines[doc.lines.length - 1];
    const nl = lineFromProduct(p, doc, 1);
    if (last && !last.productId && !last.description) doc.lines[doc.lines.length - 1] = nl; else doc.lines.push(nl);
    drawLines();
  });
  $('#newContact', el).onclick = () => contactModal({ type: ty.party, entity: 'business', terms: DB.data.settings.paymentTerms }, c => {
    form.contactId.innerHTML = UI.opts(UI.contactOptions(ty.party), c.id);
    form.contactId.dispatchEvent(new Event('change'));
  });
  const refreshDue = () => { doc.contactId = form.contactId.value; doc.date = form.date.value; if (form.dueDate) form.dueDate.value = defaultDue(doc); };
  form.contactId.addEventListener('change', () => {
    refreshDue();
    if (ty.sourceType) form.sourceId.innerHTML = UI.opts(srcOpts(), form.sourceId.value);
    const c = C.contact(doc.contactId);
    if (c && c.currency && form.currency && isNew) { form.currency.value = c.currency; form.currency.dispatchEvent(new Event('change')); }
  });
  form.date.addEventListener('change', refreshDue);
  if (form.currency) {
    form.currency.addEventListener('change', () => {
      const c = DB.data.currencies.find(x => x.code === form.currency.value);
      form.rate.value = c ? c.rate : 1;
      form.rate.disabled = C.isBase(form.currency.value);
      drawTotals();
    });
    form.rate.disabled = C.isBase(form.currency.value);
    form.rate.addEventListener('input', drawTotals);
  }

  form.onsubmit = e => {
    e.preventDefault();
    try {
      const v = UI.formValues(form);
      if (!v.contactId) throw new Error(`Please select a ${ty.party}`);
      if (!v.number) throw new Error('Number is required');
      if (!v.date) throw new Error('Date is required');
      if (DB.data.docs.some(d => d.type === doc.type && d.number === v.number && d.id !== doc.id)) throw new Error(`Number ${v.number} already exists`);
      doc.lines = doc.lines.filter(l => l.productId || l.description || U.num(l.price)).map(l => ({
        productId: l.productId || '', description: l.description || (C.product(l.productId)?.name ?? ''), qty: U.num(l.qty), price: U.num(l.price),
        discount: Math.min(100, Math.max(0, U.num(l.discount))), taxCodeId: l.taxCodeId || '', accountId: l.accountId || '',
        uom: l.uom || '', factor: U.num(l.factor) || 1, batch: l.batch || '', expiry: l.expiry || '',
      }));
      if (!doc.lines.length) throw new Error('Add at least one item');
      if (doc.lines.some(l => l.qty <= 0)) throw new Error('Quantities must be greater than zero');
      Object.assign(doc, { contactId: v.contactId, number: v.number, date: v.date, dueDate: v.dueDate || '', ref: v.ref, notes: v.notes });
      if (ty.sourceType) doc.sourceId = v.sourceId || '';
      if (form.currency) { doc.currency = v.currency; doc.rate = C.isBase(v.currency) ? 1 : (U.num(form.rate.value) || 1); }
      if (v.locationId) doc.locationId = v.locationId;
      if (v.jobId !== undefined) doc.jobId = v.jobId;
      if (ty.selfBill) doc.selfBilled = !!v.selfBilled;
      checkStock(doc);
      if (isNew) DB.takeNumber(C.prefix(doc.type), doc.number);
      DB.upsert('docs', doc, t(ty.label));
      if (isNew && src && ['quotation', 'salesOrder', 'purchaseOrder', 'receiveItem'].includes(src.type)) { src.status = 'converted'; DB.log('Converted', DOC_TYPES[src.type].label, src, 'to ' + doc.number); DB.save(); }
      if (ty.payable && !isNew && C.balance(doc) < 0) UI.toast('Note: payments now exceed the new total', 'err');
      UI.toast(`${t(ty.label)} ${doc.number} saved`, 'ok');
      location.hash = '#/doc/' + doc.id;
    } catch (err) { UI.toast(err.message, 'err'); }
  };
  drawLines();
}

/** Prevent stock going negative on outgoing documents (unless allowed). */
function checkStock(doc) {
  const ty = DOC_TYPES[doc.type];
  const inv = DB.data.inventorySettings;
  if (ty.stock !== -1 || inv.allowNegative || !inv.trackStock) return;
  const need = {};
  doc.lines.forEach(l => { const p = C.product(l.productId); if (C.isStock(p)) need[p.id] = (need[p.id] || 0) + l.qty * (U.num(l.factor) || 1); });
  const orig = doc.id && DB.get('docs', doc.id);
  const already = {};
  if (orig && orig.status !== 'void') orig.lines.forEach(l => { if (l.productId) already[l.productId] = (already[l.productId] || 0) + U.num(l.qty) * (U.num(l.factor) || 1); });
  Object.entries(need).forEach(([pid, q]) => {
    const have = C.stockQty(pid) + (already[pid] || 0);
    if (q > have + 1e-9) throw new Error(`Not enough stock for ${C.product(pid).name}: ${U.qty(have)} on hand, ${U.qty(q)} needed. (Negative stock can be allowed in Inventory Settings.)`);
  });
}

/* ---------------- Document view / print ---------------- */
function paperHtml(d) {
  const ty = DOC_TYPES[d.type];
  const tt = C.totals(d);
  const c = C.contact(d.contactId) || {};
  const s = DB.data.settings, fd = DB.data.formDesign;
  const src = d.sourceId && DB.get('docs', d.sourceId);
  const isVoid = d.status === 'void';
  const bal = C.balance(d);
  const cur = C.isBase(d.currency) ? s.currency : C.curSymbol(d.currency);
  const showTax = fd.showTaxColumn !== false;
  const job = C.job(d.jobId);
  const party = ty.party === 'customer' ? (d.type === 'creditNote' ? 'Credit To' : 'Bill To') : (d.selfBilled ? 'Supplier (self-billed)' : 'Supplier');
  const loc = DB.data.locations.length > 1 && ty.stock ? C.location(d.locationId) : null;
  return `<div class="paper tpl-${E(fd.template || 'classic')}" style="--doc-accent:${E(fd.accent || '#1f7fd8')}">
      <div class="paper-head">
        <div>${fd.showLogo && s.logo ? `<img class="doc-logo" src="${E(s.logo)}" alt="">` : ''}<div class="co-name">${E(s.company)}</div>
          <div class="muted small" style="white-space:pre-line">${E([s.regNo && 'Reg. No: ' + s.regNo, s.tin && 'TIN: ' + s.tin, s.address, s.phone && 'Tel: ' + s.phone, s.email, s.taxNo && 'SST No: ' + s.taxNo].filter(Boolean).join('\n'))}</div></div>
        <div><div class="doc-title">${E(t(C.docTitle(d)))}</div>${isVoid ? '<div class="right text-red"><b>VOID</b></div>' : ''}</div>
      </div>
      <div class="paper-meta">
        <div><div class="muted small">${E(party)}</div><b>${E(c.name || '')}</b>
          <div class="small" style="white-space:pre-line">${E([c.address, c.regNo && (c.entity === 'individual' ? 'ID: ' : 'Reg. No: ') + c.regNo, c.tin && 'TIN: ' + c.tin, c.phone, c.email].filter(Boolean).join('\n'))}</div></div>
        <table><tbody>
          <tr><td class="lbl">${E(t('Number'))}</td><td><b>${E(d.number)}</b></td></tr>
          <tr><td class="lbl">${E(t('Date'))}</td><td>${U.fdate(d.date)}</td></tr>
          ${ty.dueLabel && d.dueDate ? `<tr><td class="lbl">${E(t(ty.dueLabel))}</td><td>${U.fdate(d.dueDate)}</td></tr>` : ''}
          ${d.ref ? `<tr><td class="lbl">${E(t('Reference'))}</td><td>${E(d.ref)}</td></tr>` : ''}
          ${src ? `<tr><td class="lbl">${E(t(DOC_TYPES[src.type].label))}</td><td><a href="#/doc/${src.id}">${E(src.number)}</a></td></tr>` : ''}
          ${!C.isBase(d.currency) ? `<tr><td class="lbl">${E(t('Currency'))}</td><td>${E(d.currency)} @ ${U.qty(d.rate)}</td></tr>` : ''}
          ${job ? `<tr><td class="lbl">${E(t('Job'))}</td><td>${E(job.code)}</td></tr>` : ''}
          ${loc ? `<tr><td class="lbl">${E(t('Location'))}</td><td>${E(loc.name)}</td></tr>` : ''}
        </tbody></table>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>${E(t('Description'))}</th><th class="num">${E(t('Qty'))}</th><th class="num">${E(t('Price'))}</th><th class="num">Disc</th>${showTax ? `<th>${E(t('Tax'))}</th>` : ''}<th class="num">${E(t('Amount'))}</th></tr></thead>
        <tbody>${d.lines.map((l, i) => {
          const lc = C.line(l), p = C.product(l.productId);
          const tc = C.product(l.productId)?.tariffCodeId && DB.get('tariffCodes', p.tariffCodeId);
          return `<tr><td>${i + 1}</td><td>${E(l.description)}${p && p.code ? `<div class="small muted">${E(p.code)}${tc ? ' · Tariff ' + E(tc.code) : ''}</div>` : ''}${l.batch || l.expiry ? `<div class="small muted">${l.batch ? 'S/N: ' + E(l.batch) : ''} ${l.expiry ? 'Exp: ' + U.fdate(l.expiry) : ''}</div>` : ''}</td><td class="num">${U.qty(l.qty)} ${E(l.uom || p?.unit || '')}</td><td class="num">${U.amt(l.price)}</td><td class="num">${l.discount ? U.qty(l.discount) + '%' : ''}</td>${showTax ? `<td>${E(C.taxCode(l.taxCodeId)?.code || '')}</td>` : ''}<td class="num">${U.amt(lc.net)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      <div class="totals mt">
        <div class="row"><span>Subtotal</span><span>${U.amt(tt.subtotal)}</span></div>
        ${tt.discount ? `<div class="row"><span>Discount</span><span>−${U.amt(tt.discount)}</span></div>` : ''}
        ${Object.entries(tt.byTax).map(([tid, v]) => `<div class="row"><span>${E(C.taxCode(tid)?.name || 'Tax')}</span><span>${U.amt(v.tax)}</span></div>`).join('')}
        <div class="row grand"><span>${E(t('Total'))}</span><span>${E(cur)} ${U.amt(tt.total)}</span></div>
        ${ty.payable && !isVoid ? `
          ${C.paid(d) ? `<div class="row"><span>${E(t('Paid'))}</span><span>−${U.amt(C.paid(d))}</span></div>` : ''}
          ${C.credited(d) ? `<div class="row"><span>Credited</span><span>−${U.amt(C.credited(d))}</span></div>` : ''}
          <div class="row" style="font-weight:700"><span>Balance Due</span><span>${E(cur)} ${U.amt(bal)}</span></div>` : ''}
        ${ty.isCredit && !isVoid ? `
          ${C.creditApplied(d) ? `<div class="row"><span>Applied to ${E(src?.number || '')}</span><span>−${U.amt(C.creditApplied(d))}</span></div>` : ''}
          ${C.refunded(d) ? `<div class="row"><span>Refunded</span><span>−${U.amt(C.refunded(d))}</span></div>` : ''}
          <div class="row" style="font-weight:700"><span>Remaining credit</span><span>${E(cur)} ${U.amt(C.creditRemaining(d))}</span></div>` : ''}
      </div>
      ${d.notes ? `<div class="notes">${E(d.notes)}</div>` : ''}
      ${fd.showSignature ? `<div class="signature"><div>Authorised Signature</div><div>Received By</div></div>` : ''}
      ${fd.footer ? `<div class="doc-footer">${E(fd.footer)}</div>` : ''}
    </div>`;
}

route('/doc/:id', (el, q, id) => {
  const d = DB.get('docs', id);
  if (!d) throw new Error('Document not found');
  const ty = DOC_TYPES[d.type];
  const st = C.status(d);
  const kids = C.children(d);
  const pays = C.paymentsFor(d).sort((a, b) => a.date.localeCompare(b.date));
  const isVoid = d.status === 'void';
  const bal = C.balance(d);
  const src = d.sourceId && DB.get('docs', d.sourceId);

  const A = [];
  if (!isVoid) A.push(`<a class="btn" href="#/doc/${d.id}/edit">${E(t('Edit'))}</a>`);
  if (ty.convertTo && st !== 'converted') ty.convertTo.forEach((ct, i) => A.push(`<a class="btn ${i ? '' : 'primary'}" href="#/docs/${ct}/new?from=${d.id}">→ ${E(t(DOC_TYPES[ct].label))}</a>`));
  if (d.type === 'quotation' && st !== 'converted') {
    if (st !== 'accepted') A.push(`<button class="btn" data-st="accepted">Mark accepted</button>`);
    if (st !== 'declined') A.push(`<button class="btn" data-st="declined">Mark declined</button>`);
  }
  if (ty.convertTo && st === 'converted') A.push(`<button class="btn" data-st="open">Re-open</button>`);
  if (ty.payable && !isVoid) {
    if (bal > 0.005) A.push(`<button class="btn primary" id="pay">${ty.side === 'sales' ? 'Receive Payment' : 'Make Payment'}</button>`);
    if (ty.creditType) A.push(`<a class="btn" href="#/docs/${ty.creditType}/new?from=${d.id}">+ ${E(t(DOC_TYPES[ty.creditType].label))}</a>`);
    if (ty.debitType) A.push(`<a class="btn" href="#/docs/${ty.debitType}/new?from=${d.id}">+ ${E(t(DOC_TYPES[ty.debitType].label))}</a>`);
  }
  if (ty.isCredit && !isVoid && C.creditRemaining(d) > 0.005) A.push(`<button class="btn primary" id="refund">${d.type === 'creditNote' ? 'Refund Customer' : 'Record Supplier Refund'}</button>`);
  A.push(`<button class="btn" id="copy">Duplicate</button>`);
  A.push(`<button class="btn" onclick="window.print()">${E(t('Print / PDF'))}</button>`);
  if ((ty.payable || ty.isCredit || ty.stock) && !isVoid) A.push(`<button class="btn danger" id="void">${E(t('Void'))}</button>`);
  A.push(`<button class="btn danger" id="del">${E(t('Delete'))}</button>`);

  const postings = C.ledger().filter(e => e.txnId === 'doc:' + d.id);
  el.innerHTML = `${UI.pageHead(`${t(C.docTitle(d))} ${d.number}`, [moduleCrumb(d.type), [ty.plural, '#/docs/' + d.type]], A.join(''))}
    <div class="no-print" style="margin:-8px 0 14px">${UI.badge(st)}
      ${ty.payable && !isVoid ? `<span class="muted" style="margin-left:10px">Balance due: <b>${docMoney(d, bal)}</b></span>` : ''}
      ${ty.isCredit && !isVoid ? `<span class="muted" style="margin-left:10px">Unused credit: <b>${docMoney(d, C.creditRemaining(d))}</b></span>` : ''}</div>
    ${paperHtml(d)}
    ${pays.length ? `<div class="card mt no-print"><h2>${ty.isCredit ? t('Refunds') : t('Payments')}</h2><div class="mt">${paymentsTable(pays, false)}</div></div>` : ''}
    ${kids.length || src ? `<div class="card no-print mt"><h2>Related documents</h2><div class="mt">${docTable([...(src ? [src] : []), ...kids], { showType: true })}</div></div>` : ''}
    ${postings.length ? `<div class="card no-print"><h2>Accounting entries</h2><div class="mt">${UI.table([
      { label: 'Account', render: e => E(C.glName(e.accountId)) },
      { label: 'Description', render: e => E(e.memo || '') },
      { label: 'Debit', cls: 'num', render: e => e.debit ? U.amt(e.debit) : '' },
      { label: 'Credit', cls: 'num', render: e => e.credit ? U.amt(e.credit) : '' },
    ], postings, { foot: `<tr><td colspan="2">${E(t('Total'))}</td><td class="num">${U.amt(U.sum(postings, e => e.debit))}</td><td class="num">${U.amt(U.sum(postings, e => e.credit))}</td></tr>` })}</div></div>` : ''}`;

  $$('[data-st]', el).forEach(b => b.onclick = () => { d.status = b.dataset.st; DB.log('Status → ' + b.dataset.st, ty.label, d); DB.save(); render(); });
  const on = (sel, fn) => { const b = $(sel, el); if (b) b.onclick = fn; };
  on('#pay', () => paymentModal({ kind: ty.payKind, doc: d }));
  on('#refund', () => paymentModal({ kind: ty.refundKind, doc: d }));
  on('#copy', () => {
    const c = JSON.parse(JSON.stringify(d));
    Object.assign(c, { id: undefined, number: DB.takeNumber(C.prefix(d.type), DB.peekNumber(C.prefix(d.type))), date: U.today(), status: 'open', sourceId: '' });
    c.dueDate = defaultDue(c);
    delete c.id;
    try { checkStock(c); } catch (err) { return UI.toast(err.message, 'err'); }
    DB.upsert('docs', c, ty.label);
    UI.toast(`Duplicated as ${c.number}`, 'ok');
    location.hash = '#/doc/' + c.id + '/edit';
  });
  on('#void', () => {
    if (pays.length) return UI.toast('Delete the payments/refunds first, then void.', 'err');
    if (C.children(d).some(k => k.status !== 'void')) return UI.toast('Void the related documents first.', 'err');
    if (confirm(`Void ${d.number}? It will no longer count in balances, stock, tax or the ledger.`)) { d.status = 'void'; DB.log('Voided', ty.label, d); DB.save(); render(); }
  });
  on('#del', () => {
    if (pays.length) return UI.toast('This document has payments — delete them first.', 'err');
    if (kids.length) return UI.toast('Other documents were created from this one — delete them first.', 'err');
    if (!confirm(`Delete ${d.number} permanently?`)) return;
    DB.remove('docs', d.id, ty.label);
    if (src && src.status === 'converted' && !C.children(src).length) { src.status = 'open'; DB.save(); }
    UI.toast('Deleted');
    location.hash = '#/docs/' + d.type;
  });
  wirePaymentActions(el);
});

/* ---------------- Payments & refunds ---------------- */
function paymentModal({ kind, doc, payment, pickFrom }) {
  const k = PAY_KINDS[kind];
  if (!DB.data.bankAccounts.length) {
    UI.toast('Add a bank / cash account first', 'err');
    location.hash = '#/banking/accounts?new=1';
    return;
  }
  const outstanding = d => kind.startsWith('refund') ? C.creditRemaining(d) : C.balance(d);
  const p = payment || { date: U.today(), bankAccountId: DB.data.bankAccounts[0].id, method: DB.data.paymentMethods[0] };
  const max = d => U.r2(outstanding(d) + (payment ? U.num(payment.amount) : 0));
  const docPick = pickFrom ? UI.field('Document *', UI.select('docId', [['', 'Select…'], ...pickFrom.map(d => [d.id, `${d.number} · ${C.contactName(d.contactId)} · ${d.currency && !C.isBase(d.currency) ? d.currency + ' ' : ''}${U.amt(outstanding(d))}`])], ''), 'full') : '';
  UI.modal(payment ? `Edit ${k.label}` : k.label, `
    ${doc ? `<div class="alert info">${E(t(C.docTitle(doc)))} <b>${E(doc.number)}</b> — ${E(C.contactName(doc.contactId))}. Outstanding: <b>${docMoney(doc, max(doc))}</b></div>` : ''}
    <div class="form-grid">
      ${docPick}
      ${UI.field('Date *', UI.input('date', p.date, 'type="date"'))}
      ${UI.field('Amount *', UI.input('amount', payment ? payment.amount : doc ? max(doc) : '', 'type="number" step="0.01" min="0"'))}
      ${UI.field(k.dir === 'in' ? 'Deposit to *' : 'Pay from *', UI.select('bankAccountId', UI.accountOptions(), p.bankAccountId))}
      ${UI.field('Method', UI.select('method', DB.data.paymentMethods, p.method))}
      ${UI.field('Reference', UI.input('ref', p.ref, 'placeholder="Cheque / transaction no."'))}
      ${UI.field('Notes', UI.input('notes', p.notes))}
    </div>`, {
    onMount(m) {
      const sel = $('select[name=docId]', m);
      if (sel) sel.onchange = () => { const d = DB.get('docs', sel.value); if (d) $('input[name=amount]', m).value = max(d); };
    },
    onSubmit(v) {
      const target = doc || DB.get('docs', v.docId);
      if (!target) throw new Error('Select a document');
      const amt = U.r2(U.num(v.amount));
      if (amt <= 0) throw new Error('Amount must be greater than zero');
      if (amt > max(target) + 0.005) throw new Error(`Amount exceeds outstanding ${U.amt(max(target))}`);
      if (!v.date) throw new Error('Date is required');
      const rec = Object.assign(payment || { id: U.uid(), number: DB.takeNumber(k.prefix, DB.peekNumber(k.prefix)), kind }, {
        docId: target.id, contactId: target.contactId, date: v.date, amount: amt, bankAccountId: v.bankAccountId, method: v.method, ref: v.ref, notes: v.notes,
      });
      DB.upsert('payments', rec, k.label);
      UI.toast(`${k.label} ${rec.number} saved`, 'ok');
      render();
    },
  });
}
function isReconciledPayment(p) { const a = C.account(p.bankAccountId); return !!(a && DB.data.reconciled[C.recKey(a.id, 'pay:' + p.id)]); }
function paymentsTable(list, showDoc = true) {
  return UI.table([
    { label: 'Date', render: p => U.fdate(p.date) },
    { label: 'Number', render: p => `<b>${E(p.number)}</b>` },
    { label: 'Type', render: p => E(PAY_KINDS[p.kind].label) },
    { label: 'Contact', render: p => E(C.contactName(p.contactId)) },
    ...(showDoc ? [{ label: 'Document', render: p => { const d = DB.get('docs', p.docId); return d ? `<a href="#/doc/${d.id}">${E(d.number)}</a>` : '—'; } }] : []),
    { label: 'Account', render: p => E(C.accountName(p.bankAccountId)) },
    { label: 'Method', render: p => E(p.method || '') + (p.ref ? `<div class="small muted">${E(p.ref)}</div>` : '') },
    { label: 'Status', render: p => isReconciledPayment(p) ? UI.badge('reconciled') : '' },
    { label: 'Amount', cls: 'num', render: p => `<span class="${PAY_KINDS[p.kind].dir === 'in' ? 'text-green' : 'text-red'}">${PAY_KINDS[p.kind].dir === 'in' ? '+' : '−'}${U.amt(p.amount)}</span>` },
    { label: '', cls: 'num no-print', render: p => `<button class="btn sm" data-pedit="${p.id}">${E(t('Edit'))}</button> <button class="btn sm danger" data-pdel="${p.id}">${E(t('Delete'))}</button>` },
  ], list, { empty: 'No payments yet.' });
}
function wirePaymentActions(el) {
  $$('[data-pedit]', el).forEach(b => b.onclick = () => {
    const p = DB.get('payments', b.dataset.pedit);
    if (isReconciledPayment(p)) return UI.toast('This payment is reconciled — cannot edit', 'err');
    paymentModal({ kind: p.kind, doc: DB.get('docs', p.docId), payment: { ...p } });
  });
  $$('[data-pdel]', el).forEach(b => b.onclick = () => {
    const p = DB.get('payments', b.dataset.pdel);
    if (isReconciledPayment(p)) return UI.toast('This payment is reconciled — cannot delete', 'err');
    if (confirm(`Delete ${p.number}?`)) { DB.remove('payments', p.id, PAY_KINDS[p.kind].label); UI.toast('Deleted'); render(); }
  });
}

/* ---------------- Sales / Purchases summary reports ---------------- */
route('/reports/sales', (el, q) => sideReport(el, q, 'sales'));
route('/reports/purchases', (el, q) => sideReport(el, q, 'purchases'));
function sideReport(el, q, side) {
  const isSales = side === 'sales';
  const mainT = isSales ? ['invoice', 'salesDebitNote'] : ['bill', 'purchaseDebitNote'];
  const crT = isSales ? 'creditNote' : 'purchaseCreditNote';
  const party = isSales ? 'Customer' : 'Supplier';
  const from = q.from ?? U.monthStart(U.addMonths(U.today(), -2)), to = q.to ?? U.today();
  const docs = DB.data.docs.filter(d => mainT.includes(d.type) && d.status !== 'void' && U.inRange(d.date, from, to));
  const credits = C.liveDocs(crT).filter(d => U.inRange(d.date, from, to));
  const pays = DB.data.payments.filter(p => p.kind === (isSales ? 'receive' : 'pay') && U.inRange(p.date, from, to));
  const net = d => C.totals(d).net * C.rate(d), tax = d => C.totals(d).tax * C.rate(d);
  const gross = U.sum(docs, net), cr = U.sum(credits, net);
  const byContact = {}, byProd = {};
  const add = (id, f, v) => { byContact[id] = byContact[id] || { id, docs: 0, net: 0, credit: 0 }; byContact[id][f] += v; };
  docs.forEach(d => { add(d.contactId, 'docs', 1); add(d.contactId, 'net', net(d)); });
  credits.forEach(d => add(d.contactId, 'credit', net(d)));
  const addP = (d, l, sign) => { const k = l.productId || 'custom:' + l.description; byProd[k] = byProd[k] || { name: C.product(l.productId)?.name || l.description || '(custom)', qty: 0, net: 0 }; byProd[k].qty += sign * U.num(l.qty) * (U.num(l.factor) || 1); byProd[k].net += sign * C.line(l).net * C.rate(d); };
  docs.forEach(d => d.lines.forEach(l => addP(d, l, 1)));
  credits.forEach(d => d.lines.forEach(l => addP(d, l, -1)));
  el.innerHTML = `${UI.pageHead(isSales ? 'Sales Report' : 'Purchases Report', [[isSales ? 'Sales' : 'Purchases', '#/' + side]], UI.reportActions())}
    ${UI.dateFilter(from, to)}
    <div class="kpis">
      <div class="kpi"><div class="lbl">${isSales ? 'Invoiced' : 'Billed'} (excl. tax)</div><div class="val">${U.money(gross)}</div><div class="sub">${docs.length} document(s)</div></div>
      <div class="kpi"><div class="lbl">${E(t('Credit Notes'))}</div><div class="val">${U.money(cr)}</div></div>
      <div class="kpi"><div class="lbl">Net ${isSales ? 'sales' : 'purchases'}</div><div class="val">${U.money(gross - cr)}</div></div>
      <div class="kpi"><div class="lbl">${E(t('Tax'))}</div><div class="val">${U.money(U.sum(docs, tax) - U.sum(credits, tax))}</div></div>
      <div class="kpi"><div class="lbl">${isSales ? 'Collected' : 'Paid'}</div><div class="val">${U.money(U.sum(pays, p => U.num(p.amount) * C.rate(DB.get('docs', p.docId) || {})))}</div></div>
      <div class="kpi"><div class="lbl">Outstanding (all time)</div><div class="val">${U.money(isSales ? C.receivables() : C.payables())}</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>By ${t(party).toLowerCase()}</h2><div class="mt">${UI.table([
        { label: party, render: r => E(C.contactName(r.id)) }, { label: 'Docs', cls: 'num', render: r => r.docs },
        { label: 'Gross', cls: 'num', render: r => U.amt(r.net) }, { label: 'Credits', cls: 'num', render: r => U.amt(r.credit) },
        { label: 'Net', cls: 'num', render: r => `<b>${U.amt(r.net - r.credit)}</b>` },
      ], Object.values(byContact).sort((a, b) => (b.net - b.credit) - (a.net - a.credit)), { empty: 'No data in this period.' })}</div></div>
      <div class="card"><h2>By product / service</h2><div class="mt">${UI.table([
        { label: 'Item', render: r => E(r.name) }, { label: 'Qty', cls: 'num', render: r => U.qty(r.qty) }, { label: 'Amount', cls: 'num', render: r => U.amt(r.net) },
      ], Object.values(byProd).sort((a, b) => b.net - a.net), { empty: 'No data in this period.' })}</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Documents in period</h2><div class="spacer"></div><a href="#/reports/ageing/${isSales ? 'ar' : 'ap'}-summary">${E(t('Ageing Report'))} →</a></div>
      ${docTable(docs.sort((a, b) => a.date.localeCompare(b.date)), { showType: true, party })}</div>`;
  UI.bindDateFilter(el, (f, t2) => { location.hash = `#/reports/${side}?from=${f}&to=${t2}`; });
  UI.bindExport(el, side + '-report');
}
