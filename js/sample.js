'use strict';
/* =========================================================================
   Sample data — a small trading company with a few months of activity
   ========================================================================= */

function loadSampleData() {
  const d = defaultData();
  const td = U.today();
  const ago = n => U.addDays(td, -n);
  Object.assign(d.settings, {
    company: 'Contoh Trading Sdn Bhd', address: 'No. 12, Jalan Teknologi 3\n47810 Petaling Jaya, Selangor',
    regNo: '202301012345 (1234567-X)', tin: 'C2584736100', taxNo: 'W10-1808-32000123', phone: '03-1234 5678', email: 'accounts@contoh.example',
  });
  d.openingBalances.date = ago(120);
  d.formDesign.footer = 'Payment to: Maybank 5140-1234-5678 (Contoh Trading Sdn Bhd)';
  d.currencies.push({ id: 'cur-usd', code: 'USD', name: 'US Dollar', symbol: 'US$', rate: 4.45 });
  d.locations.push({ id: 'loc-shop', name: 'PJ Showroom', address: 'Petaling Jaya' });
  d.priceLevels.push({ id: 'pl-ws', name: 'Wholesale', percent: -10 });
  d.tariffCodes.push({ id: 'tc-1', code: '8471.60.6000', description: 'Keyboards & mice', taxCodeId: 'tx-st10' });
  d.jobs.push({ id: 'job-1', code: 'J-ALPHA', name: 'Alpha office fit-out', contactId: '', status: 'active', startDate: ago(60) });
  d.employees.push(
    { id: U.uid(), name: 'Siti Aminah binti Rahman', code: 'E001', position: 'Account Executive', department: 'Finance', email: 'siti@contoh.example', phone: '012-555 1234', startDate: ago(400), salary: 3800, status: 'active' },
    { id: U.uid(), name: 'Tan Wei Ming', code: 'E002', position: 'Sales Executive', department: 'Sales', email: 'weiming@contoh.example', phone: '016-777 8899', startDate: ago(200), salary: 3200, status: 'active' },
  );

  const c1 = { id: U.uid(), type: 'customer', entity: 'business', name: 'Alpha Retail Sdn Bhd', regNo: '201901023456', tin: 'C1234567890', email: 'ap@alpha.example', phone: '012-3456789', address: 'Jalan Ampang, Kuala Lumpur', terms: 30 };
  const c2 = { id: U.uid(), type: 'customer', entity: 'business', name: 'Beta Solutions Enterprise', regNo: 'SA0456789-T', email: 'finance@beta.example', phone: '013-2223333', address: 'Shah Alam, Selangor', terms: 14, priceLevelId: 'pl-ws' };
  const c3 = { id: U.uid(), type: 'customer', entity: 'business', name: 'Pacific Imports Pte Ltd', email: 'ap@pacific.example', phone: '+65 6123 4567', address: 'Singapore', terms: 30, currency: 'USD' };
  const c4 = { id: U.uid(), type: 'customer', entity: 'individual', name: 'Ahmad Faizal bin Ismail', regNo: '880101-14-5678', email: 'faizal@mail.example', phone: '017-2345678', address: 'Cheras, Kuala Lumpur', terms: 0 };
  const s1 = { id: U.uid(), type: 'supplier', entity: 'business', name: 'Global Supplies Sdn Bhd', regNo: '200801012345', email: 'sales@global.example', phone: '03-88889999', address: 'Klang, Selangor', terms: 30 };
  const s2 = { id: U.uid(), type: 'supplier', entity: 'business', name: 'Prima Office Mart', email: 'order@prima.example', phone: '03-77776666', address: 'Subang Jaya', terms: 30 };
  d.contacts.push(c1, c2, c3, c4, s1, s2);
  d.jobs[0].contactId = c1.id;

  const p1 = { id: U.uid(), code: 'P-001', name: 'Wireless Mouse', type: 'product', unit: 'pcs', salePrice: 45, costPrice: 25, taxSale: 'tx-st10', taxPurchase: 'tx-pt10', trackStock: true, openingQty: 20, reorderLevel: 10, reorderQty: 50, description: 'Ergonomic wireless mouse', uoms: [{ name: 'box', factor: 10, price: 420 }], tariffCodeId: 'tc-1', active: true, components: [] };
  const p2 = { id: U.uid(), code: 'P-002', name: 'Mechanical Keyboard', type: 'product', unit: 'pcs', salePrice: 220, costPrice: 140, taxSale: 'tx-st10', taxPurchase: 'tx-pt10', trackStock: true, trackSerial: true, openingQty: 8, reorderLevel: 5, reorderQty: 20, description: 'RGB mechanical keyboard', uoms: [], tariffCodeId: 'tc-1', active: true, components: [] };
  const p3 = { id: U.uid(), code: 'S-001', name: 'IT Support (hourly)', type: 'service', unit: 'hour', salePrice: 120, costPrice: 0, taxSale: 'tx-sv8', taxPurchase: 'tx-none', trackStock: false, openingQty: 0, reorderLevel: '', description: 'On-site IT support', active: true };
  const p4 = { id: U.uid(), code: 'K-001', name: 'Desk Setup Bundle', type: 'product', unit: 'set', salePrice: 249, costPrice: 0, taxSale: 'tx-st10', taxPurchase: 'tx-pt10', trackStock: true, openingQty: 0, reorderLevel: 2, description: '1 keyboard + 1 mouse', uoms: [], active: true, components: [{ productId: p2.id, qty: 1 }, { productId: p1.id, qty: 1 }] };
  d.products.push(p1, p2, p3, p4);

  const b1 = { id: U.uid(), name: 'Maybank Current', bank: 'Maybank', accountNo: '5140-1234-5678', openingBalance: 50000, openingDate: ago(120) };
  const b2 = { id: U.uid(), name: 'Petty Cash', bank: 'Cash', accountNo: '', openingBalance: 2000, openingDate: ago(120) };
  d.bankAccounts.push(b1, b2);
  d.openingBalances.lines.push({ accountId: 'a-1500', debit: 18000, credit: 0 }, { accountId: 'a-3000', debit: 0, credit: 50000 });

  const L = (p, qty, side, extra) => Object.assign({ productId: p.id, description: p.name, qty, price: side === 's' ? p.salePrice : p.costPrice, discount: 0, taxCodeId: side === 's' ? p.taxSale : p.taxPurchase, accountId: '', uom: p.unit, factor: 1 }, extra || {});
  const num = pre => { d.counters[pre] = (d.counters[pre] || 0) + 1; return `${pre}-${String(d.counters[pre]).padStart(5, '0')}`; };
  const doc = (type, contact, date, lines, extra = {}) => {
    const x = Object.assign({ id: U.uid(), type, number: num(DOC_TYPES[type].prefix), date, dueDate: DOC_TYPES[type].dueLabel ? U.addDays(date, contact.terms || 30) : '', contactId: contact.id, ref: '', lines, notes: '', status: 'open', currency: 'MYR', rate: 1, locationId: 'loc-main', jobId: '' }, extra);
    d.docs.push(x); return x;
  };
  const pay = (kind, x, date, amount, acc, extra) => d.payments.push(Object.assign({ id: U.uid(), number: num(PAY_KINDS[kind].prefix), kind, docId: x.id, contactId: x.contactId, date, amount, bankAccountId: acc.id, method: 'Bank Transfer', ref: '', notes: '' }, extra || {}));

  // Purchases: PO → Receive Item → Bill → Payment; supplier credit note → refund
  const po1 = doc('purchaseOrder', s1, ago(70), [L(p1, 50, 'p'), L(p2, 20, 'p', { batch: 'KB-2026-A', expiry: '' })], { status: 'converted' });
  const grn = doc('receiveItem', s1, ago(65), [L(p1, 50, 'p'), L(p2, 20, 'p', { batch: 'KB-2026-A' })], { sourceId: po1.id, status: 'converted', ref: 'DO-5521' });
  const bill1 = doc('bill', s1, ago(63), [L(p1, 50, 'p'), L(p2, 20, 'p')], { sourceId: grn.id, ref: 'GS-8891' });
  pay('pay', bill1, ago(35), 4455, b1);
  const bill2 = doc('bill', s2, ago(22), [{ productId: '', description: 'Office stationery', qty: 1, price: 380, discount: 0, taxCodeId: 'tx-none', accountId: 'a-6200', uom: '', factor: 1 }], { ref: 'PR-778' });
  const pcn = doc('purchaseCreditNote', s1, ago(50), [L(p1, 2, 'p')], { sourceId: bill1.id, notes: 'Returned 2 faulty units' });
  pay('refund-in', pcn, ago(40), 55, b1);
  doc('purchaseOrder', s1, ago(3), [L(p2, 15, 'p')], {});
  void bill2;

  // Sales: Quote → SO → Invoice → Payment; credit note; debit note; job; foreign currency
  const q1 = doc('quotation', c1, ago(48), [L(p1, 20, 's'), L(p2, 5, 's')], { status: 'converted', jobId: 'job-1' });
  const so1 = doc('salesOrder', c1, ago(46), [L(p1, 20, 's'), L(p2, 5, 's')], { sourceId: q1.id, status: 'converted', jobId: 'job-1' });
  const inv1 = doc('invoice', c1, ago(44), [L(p1, 20, 's'), L(p2, 5, 's', { batch: 'KB-2026-A' })], { sourceId: so1.id, jobId: 'job-1' });
  pay('receive', inv1, ago(18), 2200, b1);
  const inv2 = doc('invoice', c2, ago(28), [L(p3, 6, 's'), L(p1, 4, 's', { price: 40.5 })], {});
  pay('receive', inv2, ago(6), 500, b1);
  doc('invoice', c1, ago(8), [L(p2, 3, 's', { batch: 'KB-2026-A' }), L(p3, 4, 's')], { jobId: 'job-1' });
  doc('invoice', c3, ago(15), [L(p2, 4, 's', { price: 52, batch: 'KB-2026-A', taxCodeId: 'tx-none' })], { currency: 'USD', rate: 4.45, ref: 'PI-PO-77', notes: 'Export — not subject to sales tax.' });
  doc('invoice', c4, ago(40), [L(p4, 1, 's')], { dueDate: ago(40) });
  const cn1 = doc('creditNote', c1, ago(12), [L(p1, 1, 's')], { sourceId: inv1.id, jobId: 'job-1', notes: 'Damaged item returned' });
  pay('refund-out', cn1, ago(10), 49.5, b1);
  doc('salesDebitNote', c2, ago(5), [{ productId: '', description: 'Delivery charges', qty: 1, price: 80, discount: 0, taxCodeId: 'tx-none', accountId: 'a-4500', uom: '', factor: 1 }], { sourceId: inv2.id });
  doc('quotation', c2, ago(2), [L(p3, 10, 's')], {});

  // Inventory
  d.builds.push({ id: U.uid(), number: 'BLD-00001', mode: 'build', productId: p4.id, qty: 3, date: ago(42), locationId: 'loc-main', components: p4.components.map(c => ({ ...c })), notes: '' });
  d.counters.BLD = 1;
  d.stockTransfers.push({ id: U.uid(), number: 'MOV-00001', date: ago(30), fromLocationId: 'loc-main', toLocationId: 'loc-shop', lines: [{ productId: p1.id, qty: 10 }, { productId: p4.id, qty: 1 }], notes: 'Stock for showroom' });
  d.counters.MOV = 1;
  d.adjustments.push({ id: U.uid(), number: 'ADJ-00001', date: ago(14), productId: p2.id, qty: -1, reason: 'Damaged', notes: '', locationId: 'loc-main' });
  d.counters.ADJ = 1;

  // Bank transactions & journal
  const tx = (date, acc, type, amount, accountId, description, extra) => d.transactions.push(Object.assign({ id: U.uid(), number: num('TXN'), date, bankAccountId: acc.id, type, amount, accountId, description, ref: '', taxCodeId: '', contactId: '', jobId: '' }, extra || {}));
  [90, 60, 30].forEach(n => { tx(ago(n), b1, 'out', 3500, 'a-6100', 'Office rent'); tx(ago(n - 2), b1, 'out', 7000, 'a-6000', 'Salaries'); tx(ago(n - 2), b1, 'out', 1280, 'a-6010', 'EPF / SOCSO / EIS'); });
  tx(ago(20), b1, 'out', 432, 'a-6110', 'TNB electricity', { taxCodeId: 'tx-pt8' });
  tx(ago(9), b1, 'transfer', 500, '', 'Top up petty cash', { toAccountId: b2.id, accountId: '' });
  tx(ago(7), b2, 'out', 85, 'a-6210', 'Grab & parking', { jobId: 'job-1' });
  tx(ago(4), b1, 'out', 25, 'a-6400', 'Bank charges');
  d.journals.push({ id: U.uid(), number: num('JV'), date: U.monthEnd(U.addMonths(td, -1)), ref: '', memo: 'Monthly depreciation', lines: [{ accountId: 'a-6500', debit: 300, credit: 0, description: 'Depreciation' }, { accountId: 'a-1550', debit: 0, credit: 300, description: 'Depreciation' }] });

  // Budget for the current financial year
  const fy = (() => { const s = td.slice(0, 4) + '-01-01'; return s; })();
  d.budgets.push(
    { id: U.uid(), fy, accountId: 'a-4000', months: Array(12).fill(6000) },
    { id: U.uid(), fy, accountId: 'a-6000', months: Array(12).fill(7000) },
    { id: U.uid(), fy, accountId: 'a-6100', months: Array(12).fill(3500) },
  );
  DB.data = migrate(d);
  DB.log('Loaded', 'Sample data', 'Contoh Trading Sdn Bhd');
  DB.save();
}
