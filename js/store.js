'use strict';
/* =========================================================================
   CFO System — data store, double-entry ledger & inventory costing engine
   Data for each company lives in localStorage. Every document posts to the
   General Ledger automatically (derived on the fly, never stored twice).
   ========================================================================= */

const STORE_KEY = 'cfo-system-data-v1';   // first company (kept for backward compatibility)
const REG_KEY = 'cfo-companies';
const AUTH_KEY = 'cfo-auth';
const LANG_KEY = 'cfo-lang';
const DATA_VERSION = 2;

/* ---------------- Utilities ---------------- */
const U = {
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  iso(d) { return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); },
  today() { return U.iso(new Date()); },
  addDays(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + Number(n || 0)); return U.iso(d); },
  addMonths(s, n) { const d = new Date(s.slice(0, 7) + '-01T00:00:00'); d.setMonth(d.getMonth() + n); return U.iso(d); },
  monthStart(s) { return s.slice(0, 7) + '-01'; },
  monthEnd(s) { const d = new Date(s.slice(0, 7) + '-01T00:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); return U.iso(d); },
  yearStart(s) { return s.slice(0, 4) + '-01-01'; },
  /** First day of the financial year containing date s. */
  fyStart(s) {
    const m = String(DB.data.settings.fyStartMonth || 1).padStart(2, '0');
    const cand = s.slice(0, 4) + '-' + m + '-01';
    return cand <= s ? cand : (Number(s.slice(0, 4)) - 1) + '-' + m + '-01';
  },
  r2: n => Math.round((Number(n) + Number.EPSILON) * 100) / 100,
  num: v => { const n = parseFloat(v); return isFinite(n) ? n : 0; },
  esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  amt: n => { const v = U.r2(n); return (Object.is(v, -0) ? 0 : v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
  money: (n, cur) => (cur ? C.curSymbol(cur) : DB.data.settings.currency || '') + ' ' + U.amt(n),
  qty: n => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 3 }),
  fdate(s) { if (!s || s.length < 10 || s.startsWith('0000')) return ''; const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; },
  /** Timestamp as DD/MM/YYYY HH:MM (24-hour), matching the app's date format. */
  fdatetime(iso) { const d = new Date(iso); if (isNaN(d)) return ''; const p = n => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; },
  monthLabel(key) { const [y, m] = key.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1] + ' ' + y.slice(2); },
  days(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); },
  inRange(d, from, to) { return (!from || d >= from) && (!to || d <= to); },
  sum: (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0),
  csv(rows) { return rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n'); },
  parseCsv(text) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim()));
  },
  download(name, content, type = 'text/plain') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};

/* ---------------- Document & payment types ---------------- */
const DOC_TYPES = {
  quotation:          { label: 'Quotation', plural: 'Quotations', prefix: 'QT', side: 'sales', party: 'customer', dueLabel: 'Valid Until', dueDays: 30, convertTo: ['salesOrder', 'invoice'] },
  salesOrder:         { label: 'Sales Order', plural: 'Sales Orders', prefix: 'SO', side: 'sales', party: 'customer', dueLabel: 'Delivery Date', dueDays: 7, convertTo: ['invoice'] },
  invoice:            { label: 'Sales Invoice', plural: 'Sales Invoices', prefix: 'INV', side: 'sales', party: 'customer', dueLabel: 'Due Date', payable: true, stock: -1, creditType: 'creditNote', debitType: 'salesDebitNote', payKind: 'receive' },
  creditNote:         { label: 'Credit Note', plural: 'Credit Notes', prefix: 'CN', side: 'sales', party: 'customer', stock: +1, isCredit: true, sourceType: 'invoice', refundKind: 'refund-out' },
  salesDebitNote:     { label: 'Debit Note', plural: 'Debit Notes', prefix: 'DN', side: 'sales', party: 'customer', dueLabel: 'Due Date', payable: true, sourceType: 'invoice', payKind: 'receive' },
  purchaseOrder:      { label: 'Purchase Order', plural: 'Purchase Orders', prefix: 'PO', side: 'purchases', party: 'supplier', dueLabel: 'Expected Date', dueDays: 14, convertTo: ['receiveItem', 'bill'] },
  receiveItem:        { label: 'Receive Item', plural: 'Received Items', prefix: 'GRN', side: 'purchases', party: 'supplier', stock: +1, convertTo: ['bill'], sourceType: 'purchaseOrder' },
  bill:               { label: 'Bill', plural: 'Bills', prefix: 'BILL', side: 'purchases', party: 'supplier', dueLabel: 'Due Date', payable: true, stock: +1, creditType: 'purchaseCreditNote', debitType: 'purchaseDebitNote', payKind: 'pay', selfBill: 'Self-billed Invoice' },
  purchaseCreditNote: { label: 'Supplier Credit Note', plural: 'Supplier Credit Notes', prefix: 'PCN', side: 'purchases', party: 'supplier', stock: -1, isCredit: true, sourceType: 'bill', refundKind: 'refund-in', selfBill: 'Self-billed Credit Note' },
  purchaseDebitNote:  { label: 'Supplier Debit Note', plural: 'Supplier Debit Notes', prefix: 'PDN', side: 'purchases', party: 'supplier', dueLabel: 'Due Date', payable: true, sourceType: 'bill', payKind: 'pay', selfBill: 'Self-billed Debit Note' },
};
const SALES_TYPES = ['quotation', 'salesOrder', 'invoice', 'creditNote', 'salesDebitNote'];
const PURCHASE_TYPES = ['purchaseOrder', 'receiveItem', 'bill', 'purchaseCreditNote', 'purchaseDebitNote'];

const PAY_KINDS = {
  'receive':    { label: 'Customer Payment', prefix: 'RCPT', dir: 'in', side: 'sales' },
  'refund-out': { label: 'Customer Refund', prefix: 'RFD', dir: 'out', side: 'sales' },
  'pay':        { label: 'Supplier Payment', prefix: 'PV', dir: 'out', side: 'purchases' },
  'refund-in':  { label: 'Supplier Refund', prefix: 'SRF', dir: 'in', side: 'purchases' },
};

const ACCOUNT_TYPES = { asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', cogs: 'Cost of Sales', expense: 'Expense' };
const BS_TYPES = ['asset', 'liability', 'equity'];
const PL_TYPES = ['income', 'cogs', 'expense'];

// [code, name, type, systemKey, cashFlowClass]
const DEFAULT_ACCOUNTS = [
  ['1100', 'Accounts Receivable', 'asset', 'ar'],
  ['1150', 'Other Receivables & Deposits', 'asset'],
  ['1200', 'Inventory', 'asset', 'inventory'],
  ['1300', 'SST / Input Tax Recoverable', 'asset', 'taxIn'],
  ['1400', 'Prepayments', 'asset'],
  ['1500', 'Property, Plant & Equipment', 'asset', null, 'investing'],
  ['1550', 'Accumulated Depreciation', 'asset', 'accDep'],
  ['2000', 'Accounts Payable', 'liability', 'ap'],
  ['2050', 'Goods Received Not Invoiced', 'liability', 'grni'],
  ['2100', 'SST Payable', 'liability', 'taxOut'],
  ['2200', 'Accruals & Other Payables', 'liability'],
  ['2300', 'Salary & Statutory Payables', 'liability'],
  ['2500', 'Loans & Borrowings', 'liability', null, 'financing'],
  ['2600', 'Amount Due to Directors', 'liability', null, 'financing'],
  ['3000', 'Share Capital', 'equity', 'capital', 'financing'],
  ['3100', 'Retained Earnings', 'equity', 'retained'],
  ['3200', 'Drawings / Dividends', 'equity', 'drawings', 'financing'],
  ['3900', 'Opening Balance Equity', 'equity', 'obe'],
  ['4000', 'Sales', 'income', 'sales'],
  ['4100', 'Service Income', 'income', 'service'],
  ['4500', 'Other Income', 'income', 'otherIncome'],
  ['4600', 'Interest Income', 'income'],
  ['5000', 'Cost of Goods Sold', 'cogs', 'cogs'],
  ['5100', 'Purchases', 'cogs', 'purchases'],
  ['5200', 'Inventory Adjustments', 'cogs', 'invAdj'],
  ['6000', 'Salaries & Wages', 'expense'],
  ['6010', 'EPF / SOCSO / EIS', 'expense'],
  ['6100', 'Rent', 'expense'],
  ['6110', 'Utilities', 'expense'],
  ['6120', 'Telephone & Internet', 'expense'],
  ['6200', 'Office Supplies', 'expense'],
  ['6210', 'Transport & Travelling', 'expense'],
  ['6220', 'Marketing & Advertising', 'expense'],
  ['6300', 'Professional Fees', 'expense'],
  ['6310', 'Insurance', 'expense'],
  ['6320', 'Repairs & Maintenance', 'expense'],
  ['6400', 'Bank Charges', 'expense'],
  ['6500', 'Depreciation', 'expense'],
  ['6900', 'General Expenses', 'expense', 'otherExpense'],
  ['7000', 'Income Tax Expense', 'expense'],
];
const V1_CATEGORY_MAP = {
  'Owner Capital': '3000', 'Owner Drawings': '3200', 'Loan Received': '2500', 'Loan Repayment': '2500', 'Interest Income': '4600',
  'Other Income': '4500', 'Rent': '6100', 'Utilities': '6110', 'Salary & Wages': '6000', 'EPF / SOCSO': '6010', 'Bank Charges': '6400',
  'Office Supplies': '6200', 'Transport': '6210', 'Marketing': '6220', 'Professional Fees': '6300', 'Insurance': '6310',
  'Repairs & Maintenance': '6320', 'Telephone & Internet': '6120', 'Tax Payment': '2100', 'Other Expense': '6900',
};

/* ---------------- Defaults ---------------- */
function defaultData() {
  return {
    version: DATA_VERSION,
    settings: {
      company: 'My Company Sdn Bhd', regNo: '', tin: '', taxNo: '', msic: '', address: '', phone: '', email: '', website: '',
      currency: 'RM', baseCurrency: 'MYR', paymentTerms: 30, invoiceNotes: 'Thank you for your business.', fyStartMonth: 1, logo: '',
    },
    formDesign: { template: 'classic', accent: '#1f7fd8', showLogo: true, footer: '', showSignature: false, showTaxColumn: true },
    formSettings: {},
    taxSettings: {
      enabled: true, taxName: 'SST', filingFrequency: 2, inputClaimable: false,
      codes: [
        { id: 'tx-none', code: 'NT', name: 'No Tax', rate: 0, type: 'both', category: 'none' },
        { id: 'tx-st10', code: 'ST10', name: 'Sales Tax 10%', rate: 10, type: 'sales', category: 'goods' },
        { id: 'tx-st5', code: 'ST5', name: 'Sales Tax 5%', rate: 5, type: 'sales', category: 'goods' },
        { id: 'tx-sv8', code: 'SV8', name: 'Service Tax 8%', rate: 8, type: 'sales', category: 'service' },
        { id: 'tx-sv6', code: 'SV6', name: 'Service Tax 6%', rate: 6, type: 'sales', category: 'service' },
        { id: 'tx-pt10', code: 'PT10', name: 'Purchase Tax 10%', rate: 10, type: 'purchase', category: 'goods' },
        { id: 'tx-pt8', code: 'PT8', name: 'Purchase Service Tax 8%', rate: 8, type: 'purchase', category: 'service' },
      ],
      defaultSales: 'tx-none', defaultPurchase: 'tx-none',
    },
    inventorySettings: { trackStock: true, allowNegative: false, lowStockLevel: 5, units: ['unit', 'pcs', 'box', 'carton', 'kg', 'hour', 'set'], forecastDays: 90, leadDays: 14 },
    accounts: DEFAULT_ACCOUNTS.map(([code, name, type, sys, cf]) => ({ id: 'a-' + code, code, name, type, sys: sys || '', cf: cf || '', active: true })),
    tariffCodes: [], currencies: [{ id: 'cur-myr', code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', rate: 1 }],
    jobs: [], paymentMethods: ['Bank Transfer', 'Cash', 'Cheque', 'Credit Card', 'Online Banking', 'E-Wallet', 'DuitNow QR', 'Other'],
    paymentTerms: [{ id: 'pt-cod', name: 'Cash on delivery', days: 0 }, { id: 'pt-7', name: 'Net 7', days: 7 }, { id: 'pt-14', name: 'Net 14', days: 14 }, { id: 'pt-30', name: 'Net 30', days: 30 }, { id: 'pt-60', name: 'Net 60', days: 60 }],
    priceLevels: [], locations: [{ id: 'loc-main', name: 'Main Warehouse', address: '' }],
    contacts: [], employees: [], products: [], docs: [], payments: [],
    bankAccounts: [], transactions: [], journals: [], adjustments: [], builds: [], stockTransfers: [], stockCounts: [],
    reconciliations: [], reconciled: {}, taxFilings: [], budgets: [],
    openingBalances: { date: '', lines: [] },
    integrations: { aiKey: '', aiModel: 'claude-opus-5-5' },
    claims: [], claimSettings: { autoScan: true, claimantId: '', postAs: 'claim', accountId: '', bankId: '', folderId: '', folderUrl: '' },
    audit: [], counters: {},
  };
}

/** Bring older data up to the current structure. */
function migrate(d) {
  const base = defaultData();
  for (const k of Object.keys(base)) if (d[k] === undefined) d[k] = base[k];
  ['settings', 'formDesign', 'taxSettings', 'inventorySettings', 'integrations', 'claimSettings'].forEach(k => { d[k] = Object.assign({}, base[k], d[k]); });
  if ((d.version || 1) < 2) {
    d.docs.forEach(x => { if (x.type === 'debitNote') x.type = 'purchaseCreditNote'; });
    if (d.counters.DN) { d.counters.PCN = d.counters.DN; delete d.counters.DN; }
    d.transactions.forEach(t => {
      if (t.type !== 'transfer' && !t.accountId) {
        const code = V1_CATEGORY_MAP[t.category] || (t.type === 'in' ? '4500' : '6900');
        t.accountId = 'a-' + code;
      }
    });
    d.taxSettings.codes.forEach(c => { if (!c.category) c.category = /serv/i.test(c.name) ? 'service' : c.rate ? 'goods' : 'none'; });
    if (!d.taxSettings.codes.some(c => c.id === 'tx-sv6')) d.taxSettings.codes.push(base.taxSettings.codes.find(c => c.id === 'tx-sv6'));
    if (Array.isArray(d.inventorySettings.units)) d.inventorySettings.units = [...new Set([...d.inventorySettings.units, 'carton'])];
    d.version = 2;
  }
  // accumulated depreciation is a non-cash (operating) add-back, not investing
  const accDep = d.accounts.find(a => a.id === 'a-1550');
  if (accDep && !accDep.sys) { accDep.sys = 'accDep'; if (accDep.cf === 'investing') accDep.cf = ''; }
  // every bank account needs its own GL account
  d.bankAccounts.forEach(b => {
    if (!b.glAccountId || !d.accounts.some(a => a.id === b.glAccountId)) {
      const acc = { id: 'a-bank-' + b.id, code: nextBankCode(d), name: b.name, type: 'asset', sys: 'bank', cf: 'cash', active: true };
      d.accounts.push(acc); b.glAccountId = acc.id;
    }
  });
  return d;
}
function nextBankCode(d) {
  let n = 1010;
  while (d.accounts.some(a => a.code === String(n))) n++;
  return String(n);
}

/* ---------------- Companies registry ---------------- */
const Registry = {
  get() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(REG_KEY)); } catch (e) { /* ignore */ }
    if (!r || !Array.isArray(r.list) || !r.list.length) {
      r = { current: 'c1', list: [{ id: 'c1', key: STORE_KEY, name: 'My Company' }] };
      this.set(r);
    }
    return r;
  },
  set(r) { try { localStorage.setItem(REG_KEY, JSON.stringify(r)); } catch (e) { /* ignore */ } },
  current() { const r = this.get(); return r.list.find(c => c.id === r.current) || r.list[0]; },
  rename(name) { const r = this.get(); const c = r.list.find(x => x.id === r.current); if (c && c.name !== name) { c.name = name; this.set(r); } },
  add(name) { const r = this.get(); const id = 'c' + U.uid(); r.list.push({ id, key: 'cfo-co-' + id, name }); r.current = id; this.set(r); },
  switchTo(id) { const r = this.get(); r.current = id; this.set(r); },
  remove(id) {
    const r = this.get(); const c = r.list.find(x => x.id === id);
    if (!c || r.list.length < 2) return;
    try {
      localStorage.removeItem(c.key);
      localStorage.removeItem(c.key + ':syncbase');            // this company's last-synced copy
      const s = JSON.parse(localStorage.getItem('cfo-sync') || 'null');
      if (s && s.links && s.links[c.key]) { delete s.links[c.key]; localStorage.setItem('cfo-sync', JSON.stringify(s)); }
    } catch (e) { /* ignore */ }
    r.list = r.list.filter(x => x.id !== id);
    if (r.current === id) r.current = r.list[0].id;
    this.set(r);
  },
};

/* ---------------- Store ---------------- */
const DB = {
  data: null,
  rev: 0,
  key() { return Registry.current().key; },
  load() {
    let raw = null;
    try { raw = localStorage.getItem(this.key()); } catch (e) { /* storage blocked */ }
    let d = null;
    if (raw) { try { d = JSON.parse(raw); } catch (e) { console.error(e); } }
    this.data = migrate(d || defaultData());
    this.rev++;
  },
  save() {
    this.rev++;
    try { localStorage.setItem(this.key(), JSON.stringify(this.data)); }
    catch (e) { alert('Could not save data (storage may be full): ' + e.message); }
    Registry.rename(this.data.settings.company);
    if (typeof Sync !== 'undefined') Sync.changed();
  },
  replace(d) { this.data = migrate(d); this.save(); },
  reset() { this.data = migrate(defaultData()); this.save(); },
  get(col, id) { return this.data[col].find(x => x.id === id); },
  upsert(col, obj, label) {
    const isNew = !obj.id || !this.data[col].some(x => x.id === obj.id);
    if (!obj.id) obj.id = U.uid();
    const i = this.data[col].findIndex(x => x.id === obj.id);
    if (i >= 0) this.data[col][i] = obj; else this.data[col].push(obj);
    this.log(isNew ? 'Created' : 'Updated', label || col, obj);
    this.save();
    return obj;
  },
  remove(col, id, label) {
    const obj = this.get(col, id);
    this.data[col] = this.data[col].filter(x => x.id !== id);
    if (obj) this.log('Deleted', label || col, obj);
    this.save();
  },
  log(action, entity, obj, detail = '') {
    const ref = typeof obj === 'string' ? obj : (obj && (obj.number || obj.name || obj.code || obj.description || obj.id)) || '';
    this.data.audit.push({ t: new Date().toISOString(), user: Auth.userName(), action, entity, ref, detail });
    if (this.data.audit.length > 5000) this.data.audit.splice(0, this.data.audit.length - 5000);
  },
  peekNumber(prefix) { return `${prefix}-${String((this.data.counters[prefix] || 0) + 1).padStart(5, '0')}`; },
  takeNumber(prefix, used) {
    if (used === this.peekNumber(prefix)) this.data.counters[prefix] = (this.data.counters[prefix] || 0) + 1;
    return used;
  },
};

/* ---------------- Local user / app lock ---------------- */
const Auth = {
  get() { try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || { name: 'Admin', email: '', hash: '' }; } catch (e) { return { name: 'Admin', email: '', hash: '' }; } },
  set(a) { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); },
  userName() { return this.get().name || 'Admin'; },
  async hash(pw) {
    const bytes = new TextEncoder().encode('cfo-salt:' + pw);
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 2166136261; for (const b of bytes) { h ^= b; h = Math.imul(h, 16777619); } return 'f' + (h >>> 0).toString(16);
  },
  locked() { return !!this.get().hash && sessionStorage.getItem('cfo-unlocked') !== '1'; },
  unlock() { sessionStorage.setItem('cfo-unlocked', '1'); },
  lock() { sessionStorage.removeItem('cfo-unlocked'); },
};

/* ---------------- Calculations ---------------- */
const _memo = {};
const C = {
  memo(key, fn) {
    const m = _memo[key];
    if (m && m.rev === DB.rev) return m.val;
    const val = fn();
    _memo[key] = { rev: DB.rev, val };
    return val;
  },

  /* ----- lookups ----- */
  taxCode(id) { return DB.data.taxSettings.codes.find(t => t.id === id); },
  /** Whether SST paid on purchases can be deducted from SST payable (off by default). */
  inputClaimable() { return DB.data.taxSettings.inputClaimable === true; },
  taxRate(id) { const t = C.taxCode(id); return t && DB.data.taxSettings.enabled ? U.num(t.rate) : 0; },
  contact(id) { return DB.get('contacts', id); },
  contactName(id) { const c = C.contact(id); return c ? c.name : '—'; },
  product(id) { return id ? DB.get('products', id) : null; },
  account(id) { return DB.get('bankAccounts', id); },
  accountName(id) { const a = C.account(id); return a ? a.name : '—'; },
  gl(id) { return DB.get('accounts', id); },
  glName(id) { const a = C.gl(id); return a ? `${a.code} · ${a.name}` : '—'; },
  sys(key) { const a = DB.data.accounts.find(x => x.sys === key); return a ? a.id : null; },
  job(id) { return id ? DB.get('jobs', id) : null; },
  location(id) { return DB.get('locations', id) || DB.data.locations[0]; },
  defaultLocation() { return (DB.data.locations[0] || {}).id || 'loc-main'; },
  prefix(type) { return (DB.data.formSettings[type] && DB.data.formSettings[type].prefix) || DOC_TYPES[type].prefix; },
  docTitle(doc) {
    const t = DOC_TYPES[doc.type];
    if (doc.selfBilled && t.selfBill) return t.selfBill;
    return (DB.data.formSettings[doc.type] && DB.data.formSettings[doc.type].title) || t.label;
  },
  curSymbol(code) { const c = DB.data.currencies.find(x => x.code === code); return c ? (c.symbol || c.code) : code; },
  isBase(code) { return !code || code === DB.data.settings.baseCurrency; },
  rate(doc) { return C.isBase(doc.currency) ? 1 : (U.num(doc.rate) || 1); },
  isStock(p) { return !!p && p.type === 'product' && p.trackStock !== false && DB.data.inventorySettings.trackStock; },
  fromReceive(doc) { const s = doc.sourceId && DB.get('docs', doc.sourceId); return !!s && s.type === 'receiveItem'; },
  priceFor(p, contactId) {
    const c = C.contact(contactId);
    const lvl = c && c.priceLevelId && DB.get('priceLevels', c.priceLevelId);
    const base = U.num(p.salePrice);
    return lvl ? U.r2(base * (1 + U.num(lvl.percent) / 100)) : base;
  },

  /* ----- document maths ----- */
  line(l) {
    const gross = U.num(l.qty) * U.num(l.price);
    const disc = U.r2(gross * U.num(l.discount) / 100);
    const net = U.r2(gross - disc);
    const tax = U.r2(net * C.taxRate(l.taxCodeId) / 100);
    return { gross: U.r2(gross), disc, net, tax, total: U.r2(net + tax) };
  },
  totals(doc) {
    let subtotal = 0, discount = 0, tax = 0;
    const byTax = {};
    (doc.lines || []).forEach(l => {
      const c = C.line(l);
      subtotal += c.gross; discount += c.disc; tax += c.tax;
      if (l.taxCodeId && c.tax) {
        byTax[l.taxCodeId] = byTax[l.taxCodeId] || { base: 0, tax: 0 };
        byTax[l.taxCodeId].base += c.net; byTax[l.taxCodeId].tax += c.tax;
      }
    });
    subtotal = U.r2(subtotal); discount = U.r2(discount); tax = U.r2(tax);
    return { subtotal, discount, net: U.r2(subtotal - discount), tax, total: U.r2(subtotal - discount + tax), byTax };
  },
  total: doc => C.totals(doc).total,
  docs(type) { return DB.data.docs.filter(d => d.type === type); },
  liveDocs(type) { return DB.data.docs.filter(d => d.type === type && d.status !== 'void'); },
  children(doc) { return DB.data.docs.filter(d => d.sourceId === doc.id); },
  paymentsFor(doc) { return DB.data.payments.filter(p => p.docId === doc.id); },
  paid(doc) {
    const t = DOC_TYPES[doc.type];
    if (!t.payKind) return 0;
    return U.r2(U.sum(DB.data.payments.filter(p => p.docId === doc.id && p.kind === t.payKind), p => U.num(p.amount)));
  },
  /** How much of each credit note is applied against its source invoice/bill. */
  creditAllocation(src) {
    return C.memo('alloc:' + src.id, () => {
      const t = DOC_TYPES[src.type];
      const res = {};
      if (!t.creditType) return res;
      let outstanding = C.total(src) - C.paid(src);
      DB.data.docs.filter(d => d.sourceId === src.id && d.type === t.creditType && d.status !== 'void')
        .sort((a, b) => (a.date + a.number).localeCompare(b.date + b.number))
        .forEach(cn => { const applied = U.r2(Math.max(0, Math.min(C.total(cn), outstanding))); res[cn.id] = applied; outstanding -= applied; });
      return res;
    });
  },
  credited(doc) { return U.r2(U.sum(Object.values(C.creditAllocation(doc)))); },
  balance(doc) { return doc.status === 'void' ? 0 : U.r2(C.total(doc) - C.paid(doc) - C.credited(doc)); },
  creditApplied(cn) {
    if (!cn.sourceId) return 0;
    const src = DB.get('docs', cn.sourceId);
    return src && src.status !== 'void' ? (C.creditAllocation(src)[cn.id] || 0) : 0;
  },
  refunded(cn) {
    const t = DOC_TYPES[cn.type];
    return U.r2(U.sum(DB.data.payments.filter(p => p.docId === cn.id && p.kind === t.refundKind), p => U.num(p.amount)));
  },
  creditRemaining(cn) { return cn.status === 'void' ? 0 : U.r2(C.total(cn) - C.creditApplied(cn) - C.refunded(cn)); },
  status(doc) {
    const t = DOC_TYPES[doc.type];
    if (doc.status === 'void') return 'void';
    if (t.payable) {
      const bal = C.balance(doc), total = C.total(doc);
      if (bal <= 0.005) return 'paid';
      const late = doc.dueDate && doc.dueDate < U.today();
      if (bal < total - 0.005) return late ? 'overdue' : 'partial';
      return late ? 'overdue' : 'unpaid';
    }
    if (t.isCredit) return C.creditRemaining(doc) <= 0.005 ? 'closed' : 'open';
    return doc.status || 'open';
  },
  /** Outstanding owed by (customer) / to (supplier) a contact, in document currency units. */
  contactBalance(contactId, side) {
    const pay = side === 'sales' ? ['invoice', 'salesDebitNote'] : ['bill', 'purchaseDebitNote'];
    const cr = side === 'sales' ? 'creditNote' : 'purchaseCreditNote';
    const owed = U.sum(DB.data.docs.filter(d => pay.includes(d.type) && d.status !== 'void' && d.contactId === contactId), d => C.balance(d) * C.rate(d));
    const credit = U.sum(C.liveDocs(cr).filter(d => d.contactId === contactId), d => C.creditRemaining(d) * C.rate(d));
    return U.r2(owed - credit);
  },
  openPayables(side) { return DB.data.docs.filter(d => (side === 'sales' ? ['invoice', 'salesDebitNote'] : ['bill', 'purchaseDebitNote']).includes(d.type) && d.status !== 'void'); },
  receivables() { return U.r2(U.sum(C.openPayables('sales'), d => C.balance(d) * C.rate(d))); },
  payables() { return U.r2(U.sum(C.openPayables('purchases'), d => C.balance(d) * C.rate(d))); },
  aging(side, asOf) {
    asOf = asOf || U.today();
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
    const rows = [];
    C.openPayables(side).forEach(d => {
      if (d.date > asOf) return;
      const bal = U.r2(C.balance(d) * C.rate(d));
      if (bal <= 0.005) return;
      const late = d.dueDate ? U.days(d.dueDate, asOf) : 0;
      const b = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'd90p';
      buckets[b] += bal;
      rows.push({ doc: d, bal, late, bucket: b });
    });
    return { buckets, rows };
  },

  /* ================= Inventory costing engine (moving average) ================= */
  inv() {
    return C.memo('inv', () => {
      const S = DB.data, defLoc = C.defaultLocation();
      const mv = []; let seq = 0;
      const push = o => mv.push(Object.assign({ seq: seq++ }, o));
      S.products.forEach(p => {
        if (C.isStock(p) && U.num(p.openingQty)) push({ key: 'open:' + p.id, date: S.openingBalances.date || '0000-00-00', pid: p.id, qty: U.num(p.openingQty), value: U.num(p.openingQty) * U.num(p.costPrice), loc: p.openingLocationId || defLoc, kind: 'Opening stock', ref: 'Opening', link: '#/products', pri: 0 });
      });
      S.docs.forEach(d => {
        const t = DOC_TYPES[d.type];
        if (!t.stock || d.status === 'void') return;
        if (d.type === 'bill' && C.fromReceive(d)) return;
        const rate = C.rate(d);
        d.lines.forEach((l, i) => {
          const p = C.product(l.productId);
          if (!C.isStock(p)) return;
          const q = U.num(l.qty) * (U.num(l.factor) || 1);
          if (!q) return;
          const lcost = C.inputClaimable() ? C.line(l).net : C.line(l).total;
          const fixed = ['bill', 'receiveItem', 'purchaseCreditNote'].includes(d.type) ? lcost * rate : null;
          push({ key: d.id + ':' + i, date: d.date, pid: p.id, qty: t.stock * q, value: fixed, loc: d.locationId || defLoc, kind: t.label, ref: d.number, link: '#/doc/' + d.id, pri: t.stock > 0 ? 1 : 2, batch: l.batch || '', expiry: l.expiry || '', docType: d.type, contactId: d.contactId, unitPrice: C.line(l).net * rate / q });
        });
      });
      S.adjustments.forEach(a => {
        if (!C.isStock(C.product(a.productId))) return;
        push({ key: 'adj:' + a.id, date: a.date, pid: a.productId, qty: U.num(a.qty), value: U.num(a.qty) > 0 && U.num(a.unitCost) ? U.num(a.qty) * U.num(a.unitCost) : null, loc: a.locationId || defLoc, kind: 'Adjustment' + (a.reason ? ': ' + a.reason : ''), ref: a.number, link: '#/inventory/adjustments', pri: U.num(a.qty) > 0 ? 1 : 2, batch: a.batch || '', expiry: a.expiry || '' });
      });
      S.builds.forEach(b => {
        const loc = b.locationId || defLoc, n = U.num(b.qty);
        const ref = b.number, link = '#/inventory/builds';
        if (b.mode === 'unbuild') {
          push({ key: 'bld:' + b.id, date: b.date, pid: b.productId, qty: -n, value: null, loc, kind: 'Unbuild', ref, link, pri: 2, group: b.id, role: 'parentOut' });
          b.components.forEach((c, j) => push({ key: `bld:${b.id}:${j}`, date: b.date, pid: c.productId, qty: U.num(c.qty) * n, value: 'SPLIT', loc, kind: 'Unbuild', ref, link, pri: 3, group: b.id }));
        } else {
          b.components.forEach((c, j) => push({ key: `bld:${b.id}:${j}`, date: b.date, pid: c.productId, qty: -U.num(c.qty) * n, value: null, loc, kind: 'Build (component)', ref, link, pri: 2, group: b.id }));
          push({ key: 'bld:' + b.id, date: b.date, pid: b.productId, qty: n, value: 'GROUP', loc, kind: 'Build', ref, link, pri: 3, group: b.id });
        }
      });
      S.stockTransfers.forEach(x => x.lines.forEach((l, j) => {
        const q = U.num(l.qty);
        push({ key: `mov:${x.id}:${j}:out`, date: x.date, pid: l.productId, qty: -q, value: null, loc: x.fromLocationId, kind: 'Move out → ' + (C.location(x.toLocationId)?.name || ''), ref: x.number, link: '#/inventory/moves', pri: 2, transfer: `${x.id}:${j}` });
        push({ key: `mov:${x.id}:${j}:in`, date: x.date, pid: l.productId, qty: q, value: 'XFER', loc: x.toLocationId, kind: 'Move in ← ' + (C.location(x.fromLocationId)?.name || ''), ref: x.number, link: '#/inventory/moves', pri: 3, transfer: `${x.id}:${j}` });
      }));
      mv.sort((a, b) => a.date.localeCompare(b.date) || a.pri - b.pri || a.seq - b.seq);

      const st = {}, costs = {}, groupOut = {}, splits = {}, xfer = {};
      const state = pid => st[pid] = st[pid] || { qty: 0, value: 0, loc: {}, moves: [], lastAvg: U.num(C.product(pid)?.costPrice) };
      mv.forEach(m => {
        const s = state(m.pid);
        const avg = s.qty > 1e-9 ? s.value / s.qty : s.lastAvg;
        let cost;
        if (m.qty < 0) {
          cost = m.value != null ? m.value : avg * -m.qty;
          if (m.group) groupOut[m.group] = (groupOut[m.group] || 0) + cost;
          if (m.transfer) xfer[m.transfer] = cost;
          if (m.role === 'parentOut') {
            const b = DB.get('builds', m.group);
            const w = b.components.map(c => { const cs = state(c.productId); const a2 = cs.qty > 1e-9 ? cs.value / cs.qty : cs.lastAvg || U.num(C.product(c.productId)?.costPrice); return Math.max(0, a2) * U.num(c.qty); });
            const W = U.sum(w) || 1;
            splits[m.group] = w.map(x => cost * x / W);
          }
          s.value -= cost; cost = -cost;
        } else {
          if (m.value === 'GROUP') cost = groupOut[m.group] || 0;
          else if (m.value === 'SPLIT') cost = (splits[m.group] || [])[Number(m.key.split(':').pop())] || 0;
          else if (m.value === 'XFER') cost = xfer[m.transfer] || 0;
          else cost = m.value != null ? m.value : avg * m.qty;
          s.value += cost;
        }
        s.qty += m.qty;
        s.loc[m.loc] = (s.loc[m.loc] || 0) + m.qty;
        if (s.qty > 1e-9) s.lastAvg = s.value / s.qty;
        m.cost = U.r2(cost);
        m.balQty = s.qty; m.balValue = s.value;
        costs[m.key] = m.cost;
        s.moves.push(m);
      });
      return { moves: mv, st, costs };
    });
  },
  stockItems() { return DB.data.products.filter(C.isStock); },
  productMoves(pid) { return (C.inv().st[pid] || { moves: [] }).moves; },
  stockQty(pid, to, loc) {
    const s = C.inv().st[pid];
    if (!s) return 0;
    if (!to && !loc) return s.qty;
    return U.sum(s.moves.filter(m => (!to || m.date <= to) && (!loc || m.loc === loc)), m => m.qty);
  },
  stockValue(pid, to) {
    const s = C.inv().st[pid];
    if (!s) return 0;
    if (!to) return s.value;
    const last = s.moves.filter(m => m.date <= to).pop();
    return last ? last.balValue : 0;
  },
  avgCost(pid) {
    const s = C.inv().st[pid];
    if (s && s.qty > 1e-9) return s.value / s.qty;
    return s ? s.lastAvg : U.num(C.product(pid)?.costPrice);
  },
  lowStockLevel(p) { return p.reorderLevel !== '' && p.reorderLevel != null ? U.num(p.reorderLevel) : U.num(DB.data.inventorySettings.lowStockLevel); },

  /* ================= General Ledger ================= */
  lineAccount(doc, l) {
    const t = DOC_TYPES[doc.type];
    const p = C.product(l.productId);
    if (t.side === 'sales') return l.accountId || (p && p.salesAccountId) || (p && p.type === 'service' ? C.sys('service') : C.sys('sales'));
    if (t.stock && C.isStock(p)) {
      if (doc.type === 'bill' && C.fromReceive(doc)) return C.sys('grni');
      return C.sys('inventory');
    }
    return l.accountId || (p && p.purchaseAccountId) || C.sys('purchases');
  },
  ledger() {
    return C.memo('ledger', () => {
      const S = DB.data, inv = C.inv(), out = [];
      const tx = (o) => {
        const lines = [];
        return {
          add(accountId, amt, extra) { if (accountId && Math.abs(amt) >= 0.005) lines.push(Object.assign({ accountId, amt: U.r2(amt) }, extra || {})); },
          balance(accountId) { const diff = U.r2(-U.sum(lines, x => x.amt)); if (Math.abs(diff) >= 0.005) lines.push({ accountId, amt: diff }); },
          done() { lines.forEach(x => out.push(Object.assign({}, o, x, { debit: x.amt > 0 ? x.amt : 0, credit: x.amt < 0 ? -x.amt : 0 }))); },
        };
      };
      const obe = C.sys('obe'), invAcc = C.sys('inventory');
      const obDate = S.openingBalances.date || '0000-00-00';
      // Opening balances
      S.bankAccounts.forEach(b => {
        if (!U.num(b.openingBalance)) return;
        const t = tx({ txnId: 'open:' + b.id, date: b.openingDate || obDate, number: 'Opening', source: 'Opening Balance', link: '#/banking/accounts', memo: 'Opening balance — ' + b.name });
        t.add(b.glAccountId, U.num(b.openingBalance)); t.balance(obe); t.done();
      });
      S.products.forEach(p => {
        const c = inv.costs['open:' + p.id];
        if (!c) return;
        const t = tx({ txnId: 'open:' + p.id, date: obDate, number: 'Opening', source: 'Opening Balance', link: '#/products', memo: 'Opening stock — ' + p.name });
        t.add(invAcc, c); t.balance(obe); t.done();
      });
      if (S.openingBalances.lines.length) {
        const t = tx({ txnId: 'open:gl', date: obDate, number: 'Opening', source: 'Opening Balance', link: '#/control/opening', memo: 'Opening balances' });
        S.openingBalances.lines.forEach(l => t.add(l.accountId, U.num(l.debit) - U.num(l.credit)));
        t.balance(obe); t.done();
      }
      // Documents
      S.docs.forEach(d => {
        if (d.status === 'void') return;
        const t = DOC_TYPES[d.type];
        const rate = C.rate(d);
        const base = { txnId: 'doc:' + d.id, date: d.date, number: d.number, source: C.docTitle(d), link: '#/doc/' + d.id, contactId: d.contactId, jobId: d.jobId || '', memo: C.contactName(d.contactId) };
        if (['invoice', 'salesDebitNote', 'creditNote'].includes(d.type)) {
          const s = d.type === 'creditNote' ? -1 : 1;
          const x = tx(base);
          d.lines.forEach((l, i) => {
            const lc = C.line(l);
            x.add(C.lineAccount(d, l), -s * lc.net * rate, { memo: l.description });
            x.add(C.sys('taxOut'), -s * lc.tax * rate, { memo: 'Tax — ' + l.description });
            const cost = inv.costs[d.id + ':' + i];
            if (cost) { x.add(C.sys('cogs'), -cost, { memo: 'Cost — ' + l.description }); x.add(invAcc, cost, { memo: 'Stock — ' + l.description }); }
          });
          x.balance(C.sys('ar')); x.done();
        } else if (['bill', 'purchaseDebitNote', 'purchaseCreditNote'].includes(d.type)) {
          const s = d.type === 'purchaseCreditNote' ? -1 : 1;
          const x = tx(base);
          d.lines.forEach(l => {
            const lc = C.line(l);
            // Non-deductible purchase tax is part of the cost of the item / expense.
            const claim = C.inputClaimable();
            x.add(C.lineAccount(d, l), s * (claim ? lc.net : lc.total) * rate, { memo: l.description });
            if (claim) x.add(C.sys('taxIn'), s * lc.tax * rate, { memo: 'Tax — ' + l.description });
          });
          x.balance(C.sys('ap')); x.done();
        } else if (d.type === 'receiveItem') {
          const x = tx(base);
          d.lines.forEach((l, i) => { const c = inv.costs[d.id + ':' + i]; if (c) x.add(invAcc, c, { memo: l.description }); });
          x.balance(C.sys('grni')); x.done();
        }
      });
      // Payments & refunds
      S.payments.forEach(p => {
        const b = C.account(p.bankAccountId), doc = DB.get('docs', p.docId);
        if (!b) return;
        const k = PAY_KINDS[p.kind];
        const amt = U.num(p.amount) * (doc ? C.rate(doc) : 1);
        const x = tx({ txnId: 'pay:' + p.id, date: p.date, number: p.number, source: k.label, link: doc ? '#/doc/' + doc.id : '#/sales', contactId: p.contactId, jobId: doc?.jobId || '', memo: `${C.contactName(p.contactId)}${doc ? ' — ' + doc.number : ''}` });
        x.add(b.glAccountId, k.dir === 'in' ? amt : -amt);
        x.balance(k.side === 'sales' ? C.sys('ar') : C.sys('ap')); x.done();
      });
      // Bank transactions
      S.transactions.forEach(t => {
        const b = C.account(t.bankAccountId);
        if (!b) return;
        const labels = { in: 'Deposit', out: 'Withdrawal', transfer: 'Transfer' };
        const x = tx({ txnId: 'txn:' + t.id, date: t.date, number: t.ref || t.number || labels[t.type], source: labels[t.type], link: '#/transactions', contactId: t.contactId || '', jobId: t.jobId || '', memo: t.description || '' });
        const amt = U.num(t.amount);
        if (t.type === 'transfer') {
          const to = C.account(t.toAccountId);
          if (!to) return;
          x.add(b.glAccountId, -amt); x.add(to.glAccountId, amt);
        } else {
          const rate = C.taxRate(t.taxCodeId);
          const tax = U.r2(amt * rate / (100 + rate));
          const s = t.type === 'in' ? 1 : -1;
          x.add(b.glAccountId, s * amt);
          if (t.type === 'in') x.add(C.sys('taxOut'), -tax);
          else if (C.inputClaimable()) x.add(C.sys('taxIn'), tax);
          x.balance(t.accountId || (t.type === 'in' ? C.sys('otherIncome') : C.sys('otherExpense')));
        }
        x.done();
      });
      // Journals
      S.journals.forEach(j => {
        const x = tx({ txnId: 'jnl:' + j.id, date: j.date, number: j.number, source: 'Journal', link: '#/transactions/journal/' + j.id, memo: j.memo || '' });
        j.lines.forEach(l => x.add(l.accountId, U.num(l.debit) - U.num(l.credit), { memo: l.description || j.memo || '', jobId: l.jobId || '', contactId: l.contactId || '' }));
        x.done();
      });
      // Inventory adjustments
      S.adjustments.forEach(a => {
        const c = inv.costs['adj:' + a.id];
        if (!c) return;
        const x = tx({ txnId: 'adj:' + a.id, date: a.date, number: a.number, source: 'Inventory Adjustment', link: '#/inventory/adjustments', memo: (C.product(a.productId)?.name || '') + (a.reason ? ' — ' + a.reason : '') });
        x.add(invAcc, c); x.balance(C.sys('invAdj')); x.done();
      });
      out.sort((a, b) => a.date.localeCompare(b.date));
      return out;
    });
  },
  /** Account balances (debit positive) for entries in [from, to]. */
  balances(from, to) {
    return C.memo(`bal:${from}:${to}`, () => {
      const m = {};
      C.ledger().forEach(e => { if (U.inRange(e.date, from, to)) m[e.accountId] = (m[e.accountId] || 0) + e.debit - e.credit; });
      return m;
    });
  },
  /** Profit & loss figures for a period. */
  pl(from, to) {
    const b = C.balances(from, to);
    const acc = type => DB.data.accounts.filter(a => a.type === type).map(a => ({ a, v: type === 'income' ? -(b[a.id] || 0) : (b[a.id] || 0) })).filter(x => Math.abs(x.v) >= 0.005);
    const income = acc('income'), cogs = acc('cogs'), expense = acc('expense');
    const ti = U.sum(income, x => x.v), tc = U.sum(cogs, x => x.v), te = U.sum(expense, x => x.v);
    return { income, cogs, expense, totalIncome: ti, totalCogs: tc, gross: ti - tc, totalExpense: te, net: ti - tc - te };
  },
  /** Balance sheet as of a date. */
  bs(asOf) {
    const b = C.balances('', asOf);
    const fy = U.fyStart(asOf);
    const prior = C.pl('', U.addDays(fy, -1)).net;
    const current = C.pl(fy, asOf).net;
    const sec = (type, sign) => DB.data.accounts.filter(a => a.type === type).map(a => ({ a, v: sign * (b[a.id] || 0) })).filter(x => Math.abs(x.v) >= 0.005);
    const assets = sec('asset', 1), liabilities = sec('liability', -1), equity = sec('equity', -1);
    const ta = U.sum(assets, x => x.v), tl = U.sum(liabilities, x => x.v), te = U.sum(equity, x => x.v) + prior + current;
    return { assets, liabilities, equity, prior, current, totalAssets: ta, totalLiabilities: tl, totalEquity: te };
  },

  /* ----- Banking (from ledger) ----- */
  recKey(accId, txnId) { return `${accId}:${txnId}`; },
  bankEntries(accId) {
    const b = C.account(accId);
    if (!b) return [];
    const map = {};
    C.ledger().forEach(e => {
      if (e.accountId !== b.glAccountId || e.txnId.startsWith('open:')) return;
      const k = e.txnId;
      if (!map[k]) map[k] = { key: C.recKey(accId, k), txnId: k, date: e.date, ref: e.number, desc: [e.source, e.memo].filter(Boolean).join(' — '), amount: 0, link: e.link, contactId: e.contactId };
      map[k].amount += e.debit - e.credit;
    });
    const out = Object.values(map).filter(x => Math.abs(x.amount) >= 0.005);
    out.forEach(e => { e.amount = U.r2(e.amount); e.reconciled = !!DB.data.reconciled[e.key]; e.source = e.txnId.split(':')[0]; e.id = e.txnId.split(':')[1]; });
    out.sort((a, b2) => a.date.localeCompare(b2.date) || (b2.amount - a.amount));
    return out;
  },
  bankBalance(accId, to) {
    const a = C.account(accId);
    if (!a) return 0;
    return U.r2(U.sum(C.ledger().filter(e => e.accountId === a.glAccountId && (!to || e.date <= to)), e => e.debit - e.credit));
  },
  totalCash() { return U.r2(U.sum(DB.data.bankAccounts, a => C.bankBalance(a.id))); },
  clearedBalance(accId) {
    const a = C.account(accId);
    return U.r2(U.num(a.openingBalance) + U.sum(C.bankEntries(accId).filter(e => e.reconciled), e => e.amount));
  },

  /* ----- Tax ----- */
  taxLines(from, to) {
    const rows = [];
    const sideMap = { invoice: ['output', 1], salesDebitNote: ['output', 1], creditNote: ['output', -1], bill: ['input', 1], purchaseDebitNote: ['input', 1], purchaseCreditNote: ['input', -1] };
    DB.data.docs.forEach(d => {
      const m = sideMap[d.type];
      if (!m || d.status === 'void' || !U.inRange(d.date, from, to)) return;
      const rate = C.rate(d);
      Object.entries(C.totals(d).byTax).forEach(([code, v]) => {
        rows.push({ date: d.date, ref: d.number, link: '#/doc/' + d.id, source: C.docTitle(d), contact: C.contactName(d.contactId), side: m[0], code, base: v.base * m[1] * rate, tax: v.tax * m[1] * rate });
      });
    });
    DB.data.transactions.forEach(t => {
      if (t.type === 'transfer' || !t.taxCodeId || !U.inRange(t.date, from, to)) return;
      const rate = C.taxRate(t.taxCodeId);
      if (!rate) return;
      const amt = U.num(t.amount), tax = U.r2(amt * rate / (100 + rate));
      rows.push({ date: t.date, ref: t.ref || (t.type === 'in' ? 'Deposit' : 'Withdrawal'), link: '#/transactions', source: 'Bank Transaction', contact: t.contactId ? C.contactName(t.contactId) : (C.gl(t.accountId)?.name || ''), side: t.type === 'in' ? 'output' : 'input', code: t.taxCodeId, base: amt - tax, tax });
    });
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  },
  taxSummary(from, to) {
    const rows = C.taxLines(from, to);
    const by = { output: {}, input: {} };
    rows.forEach(r => { const b = by[r.side][r.code] = by[r.side][r.code] || { base: 0, tax: 0 }; b.base += r.base; b.tax += r.tax; });
    const output = U.r2(U.sum(rows.filter(r => r.side === 'output'), r => r.tax));
    const input = U.r2(U.sum(rows.filter(r => r.side === 'input'), r => r.tax));
    const claimable = C.inputClaimable();
    return { rows, by, output, input, claimable, deductible: claimable ? input : 0, net: U.r2(output - (claimable ? input : 0)) };
  },

  /* ----- Period totals for dashboard ----- */
  salesNet(from, to) { return U.r2(C.pl(from, to).totalIncome); },
  purchasesNet(from, to) { return U.r2(U.sum(DB.data.docs.filter(d => ['bill', 'purchaseDebitNote', 'purchaseCreditNote'].includes(d.type) && d.status !== 'void' && U.inRange(d.date, from, to)), d => C.totals(d).net * C.rate(d) * (d.type === 'purchaseCreditNote' ? -1 : 1))); },
  expensesNet(from, to) { return U.r2(C.pl(from, to).totalExpense); },
};
