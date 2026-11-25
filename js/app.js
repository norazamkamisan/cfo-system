'use strict';
/* =========================================================================
   App shell: router, top menu, user menu, lock screen, search,
   notifications, home (Workflows / Dashboard)
   ========================================================================= */

const Routes = [];
function route(pattern, fn) { Routes.push([new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), fn]); }

function render() {
  if (Auth.locked()) return showLock();
  const hash = location.hash.slice(1) || '/';
  const [path, qs] = hash.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const view = $('#view');
  closeMenus();
  for (const [re, fn] of Routes) {
    const m = path.match(re);
    if (m) {
      try { fn(view, q, ...m.slice(1).map(decodeURIComponent)); }
      catch (e) { console.error(e); view.innerHTML = `<div class="alert err">Something went wrong: ${E(e.message)}</div>`; }
      UI.bindRowLinks(view);
      UI.bindSearch(view);
      refreshTopbar();
      if (!q.keepScroll) window.scrollTo(0, 0);
      return;
    }
  }
  view.innerHTML = `<div class="card">Page not found. <a href="#/">Go to dashboard</a></div>`;
}

/* ---------------- Menu ---------------- */
const MENU = [
  { label: 'Dashboard', href: '#/' },
  { label: 'Sales', items: [
    { label: 'Sales List', href: '#/sales' }, '-',
    { label: 'Create New', items: [['Quote', '#/docs/quotation/new'], ['Sale Order', '#/docs/salesOrder/new'], ['Invoice', '#/docs/invoice/new'], ['Credit Note', '#/docs/creditNote/new'], ['Debit Note', '#/docs/salesDebitNote/new'], ['Payment', '#/sales?new=receive'], ['Refund', '#/sales?new=refund-out']] },
  ] },
  { label: 'Purchases', items: [
    { label: 'Purchases List', href: '#/purchases' }, '-',
    { label: 'Create New', items: [['Purchase Order', '#/docs/purchaseOrder/new'], ['Receive Item', '#/docs/receiveItem/new'], ['Bill / Self-billed Invoice', '#/docs/bill/new'], ['Credit Note / Self-billed Credit Note', '#/docs/purchaseCreditNote/new'], ['Debit Note / Self-billed Debit Note', '#/docs/purchaseDebitNote/new'], ['Payment', '#/purchases?new=pay'], ['Refund', '#/purchases?new=refund-in']] },
  ] },
  { label: 'Transactions', items: [
    { label: 'Transactions List', href: '#/transactions' }, { label: 'Bank Accounts', href: '#/banking/accounts' }, '-',
    { label: 'Create New', items: [['Deposit', '#/transactions?new=in'], ['Withdrawal', '#/transactions?new=out'], ['Transfer', '#/transactions?new=transfer'], ['Journal', '#/transactions/journal/new']] },
  ] },
  { label: 'Products & Services', items: [
    { label: 'Products & Services List', href: '#/products' }, { label: 'Adjustment List', href: '#/inventory/adjustments' }, '-',
    { label: 'Create New', items: [['New Product / Service', '#/products?new=1'], ['New Inventory Adjustment', '#/inventory/adjustments?new=1']] },
    { label: 'Build Items', items: [['Auto Build Items', '#/inventory/builds?new=build'], ['Unbuild Items', '#/inventory/builds?new=unbuild']] },
    { label: 'Count Inventory', href: '#/inventory/count' }, { label: 'Move Items', href: '#/inventory/moves' }, { label: 'Stock Alert', href: '#/reports/inventory/alert' },
  ] },
  { label: 'Contacts', items: [
    { label: 'Contacts List', href: '#/contacts' }, { label: 'Employees List', href: '#/employees' }, '-',
    { label: 'Create New', items: [['Business', '#/contacts?new=business'], ['Individual', '#/contacts?new=individual']] },
    { label: 'Request Contact Details', href: '#/contacts/request' }, { label: 'Sync Contact Details', href: '#/contacts/sync' },
  ] },
  { label: 'Reports', items: [
    { label: 'Ageing Report', items: [['Aged Receivables Summary', '#/reports/ageing/ar-summary'], ['Aged Receivables Details', '#/reports/ageing/ar-details'], '-', ['Aged Payables Summary', '#/reports/ageing/ap-summary'], ['Aged Payables Details', '#/reports/ageing/ap-details']] },
    { label: 'Banking Report', items: [['Reconciliation', '#/reports/banking/reconciliation'], ['Banking Summary', '#/banking/report']] },
    { label: 'Business Report', items: [
      ['Account Transactions', '#/reports/account-transactions'],
      { label: 'Balance Sheet', items: [['Standard Balance Sheet', '#/reports/balance-sheet'], ['Multi-Period Balance Sheet', '#/reports/balance-sheet-multi']] },
      { label: 'Profit & Loss', items: [['Standard Profit & Loss', '#/reports/pl'], ['Multi-Period Profit & Loss', '#/reports/pl-multi']] },
      ['Trial Balance', '#/reports/trial-balance'], ['Cash Flow Statement', '#/reports/cash-flow'], ['General Ledger Summary', '#/reports/gl-summary'], ['General Ledger Details', '#/reports/gl-details'], ['Journal Entry', '#/reports/journal'],
    ] },
    { label: 'Contact Ledger Report', items: [['Customer Ledger', '#/reports/ledger/customer'], ['Supplier Ledger', '#/reports/ledger/supplier']] },
    { label: 'Inventory Report', items: [['Inventory Valuation Summary', '#/reports/inventory/valuation-summary'], ['Inventory Valuation Details', '#/reports/inventory/valuation-details'], ['Product UOM', '#/reports/inventory/uom'], ['Sale & Purchase Items', '#/reports/inventory/items'], '-', ['Auto Build', '#/reports/inventory/builds'], ['Inventory Location Summary', '#/reports/inventory/locations'], ['Inventory Movement', '#/reports/inventory/movement'], ['Planning & Forecast', '#/reports/inventory/forecast'], ['Product Serial Number & Expiry Date', '#/reports/inventory/serial'], ['Stock Alert', '#/reports/inventory/alert']] },
    { label: 'Job Report', items: [['Job Activity', '#/reports/job/activity'], ['Job Income Statement', '#/reports/job/income'], ['Job List', '#/reports/job/list'], ['Job Transactions', '#/reports/job/transactions']] },
    { label: 'Tax Report', items: [['SST Details', '#/reports/sst/details'], ['SST Summary', '#/reports/sst/summary']] }, '-',
    { label: 'Budgets', items: [['Budget vs Actual', '#/reports/budget'], ['Budgets', '#/control/budgets']] },
    { label: 'Audit Trail Report', href: '#/reports/audit' },
  ] },
  { label: 'SST Filing', href: '#/sst-filing' },
  { label: 'Control Panel', items: [
    { label: 'Master Data', items: [['Taxes', '#/control/taxes'], ['Tariff Code', '#/control/tariff'], ['Currencies', '#/control/currencies'], ['Job Tagging', '#/control/jobs'], ['Payment Methods', '#/control/payment-methods'], ['Payment Terms', '#/control/payment-terms'], ['Price Levels', '#/control/price-levels']] },
    { label: 'Company', items: [['Business Profile', '#/control/profile'], ['Business Setting', '#/control/business'], ['Form Design', '#/control/form-design'], ['Form Settings', '#/control/form-settings']] },
    { label: 'Accounting', items: [['Balance Sheet Accounts', '#/control/accounts/bs'], ['Profit & Loss Accounts', '#/control/accounts/pl'], ['Opening Balance', '#/control/opening'], ['Budgets', '#/control/budgets'], ['Bank Reconciliation', '#/banking/reconcile']] },
    { label: 'Inventory', items: [['Unit of Measurement (UOM)', '#/control/uom'], ['Locations', '#/control/locations'], ['Inventory Settings', '#/control/inventory']] }, '-',
    { label: 'Integrated Apps', href: '#/control/apps' }, { label: 'Sync (PC & phone)', href: '#/control/sync' }, { label: 'Backup & Data', href: '#/control/data' },
  ] },
  { label: 'A.I Scan', href: '#/ai-scan' },
];

function menuHtml(items, top) {
  return items.map(it => {
    if (it === '-') return '<li class="sep"></li>';
    const o = Array.isArray(it) ? { label: it[0], href: it[1] } : it;
    if (o.items) return `<li class="has-sub"><a href="#" class="sub-toggle">${E(t(o.label))}${top ? ' <span class="caret">▾</span>' : ' <span class="caret-r">▸</span>'}</a><ul>${menuHtml(o.items)}</ul></li>`;
    return `<li><a href="${o.href}">${E(t(o.label))}</a></li>`;
  }).join('');
}
function buildMenu() {
  const bar = $('#menubar');
  bar.innerHTML = menuHtml(MENU, true);
  bar.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a) return;
    if (a.classList.contains('sub-toggle')) {
      e.preventDefault();
      const li = a.parentElement;
      const open = !li.classList.contains('open');
      $$('li.open', li.parentElement).forEach(x => { if (x !== li) x.classList.remove('open'); });
      li.classList.toggle('open', open);
      return;
    }
    bar.classList.add('suppress');
    document.body.classList.remove('nav-open');
  });
  bar.addEventListener('mouseleave', () => bar.classList.remove('suppress'));
  // open nested submenus to the left when there is no room on the right
  const fit = e => {
    const li = e.target.closest('#menubar ul li.has-sub');
    if (li) li.classList.toggle('flip', li.getBoundingClientRect().right + 240 > window.innerWidth);
  };
  bar.addEventListener('mouseover', fit);
  bar.addEventListener('click', fit, true);
  document.addEventListener('click', e => { if (!e.target.closest('#menubar, #menu-btn, .user-menu, .notif')) closeMenus(); });
}
function closeMenus() {
  $$('#menubar li.open, .topbar .open').forEach(x => x.classList.remove('open'));
}
function markMenu() {
  const path = '#' + (location.hash.slice(1) || '/').split('?')[0];
  $$('#menubar > li').forEach(li => {
    const links = $$('a[href]', li).map(a => a.getAttribute('href').split('?')[0]);
    li.classList.toggle('active', links.includes(path) || (path.startsWith('#/doc') && /Sales|Purchases|Jualan|Pembelian|销售|采购|銷售|採購/.test(li.textContent) && isDocSide(path, li)));
  });
}
function isDocSide(path, li) {
  const m = path.match(/^#\/docs?\/([^/]+)/);
  if (!m) return false;
  let type = m[1];
  const d = DB.get('docs', type);
  if (d) type = d.type;
  const t2 = DOC_TYPES[type];
  if (!t2) return false;
  return li === $$('#menubar > li')[t2.side === 'sales' ? 1 : 2];
}

/* ---------------- Top bar: search, notifications, user menu ---------------- */
function buildTopbar() {
  $('#user-menu-list').innerHTML = `
    <li><a href="#" data-u="profile">${E(t('My Profile'))}</a></li>
    <li><a href="#" data-u="password">${E(t('Change Password'))}</a></li>
    <li><a href="#/reports/audit?user=me">${E(t('My Transactions'))}</a></li>
    <li class="sep"></li>
    <li><a href="#" data-u="company">${E(t('Switch Company'))}</a></li>
    <li><a href="#" data-u="install">📲 ${E(t('Install app'))}</a></li>
    <li class="has-sub left"><a href="#" class="sub-toggle">${E(t('Change Language'))} <span class="caret-r">▸</span></a>
      <ul>${LANGS.map(([k, l]) => `<li><a href="#" data-lang="${k}">${I18N.lang() === k ? '✓ ' : ''}${E(l)}</a></li>`).join('')}</ul></li>
    <li><a href="#" data-u="logout">${E(t('Logout'))}</a></li>`;
  $('#global-search').placeholder = t('Search') + '…';
}
function initTopbar() {
  buildTopbar();
  $('#avatar').onclick = e => { e.stopPropagation(); $('.notif').classList.remove('open'); $('.user-menu').classList.toggle('open'); };
  $('#bell').onclick = e => { e.stopPropagation(); $('.user-menu').classList.remove('open'); $('.notif').classList.toggle('open'); };
  $('.user-menu').addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a) return;
    if (a.classList.contains('sub-toggle')) { e.preventDefault(); a.parentElement.classList.toggle('open'); return; }
    if (a.dataset.lang) { e.preventDefault(); I18N.set(a.dataset.lang); buildMenu(); buildTopbar(); render(); return; }
    const u = a.dataset.u;
    closeMenus();
    if (!u) return;
    e.preventDefault();
    ({ profile: profileModal, password: passwordModal, company: companyModal, install: installAppModal, logout: () => { Auth.lock(); render(); } })[u]();
  });
  $('#global-search').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.value.trim()) location.hash = '#/search?q=' + encodeURIComponent(e.target.value.trim());
  });
  $('#company-name').onclick = companyModal;
}
function notifications() {
  const n = [];
  const today = U.today();
  const od = C.openPayables('sales').filter(d => C.status(d) === 'overdue');
  if (od.length) n.push([`${od.length} overdue sales invoice(s) — ${U.money(U.sum(od, d => C.balance(d) * C.rate(d)))}`, '#/reports/ageing/ar-details', 'red']);
  const bills = C.openPayables('purchases').filter(d => C.balance(d) > 0.005 && d.dueDate && d.dueDate <= U.addDays(today, 7));
  if (bills.length) n.push([`${bills.length} bill(s) overdue or due within 7 days`, '#/reports/ageing/ap-details', 'amber']);
  const low = C.stockItems().filter(p => C.stockQty(p.id) <= C.lowStockLevel(p));
  if (low.length) n.push([`${low.length} product(s) at or below reorder level`, '#/reports/inventory/alert', 'amber']);
  const due = DB.data.taxFilings.filter(f => f.status !== 'filed' && f.dueDate && f.dueDate <= U.addDays(today, 14));
  if (due.length) n.push([`${due.length} SST return(s) due soon`, '#/sst-filing', 'red']);
  const exp = C.inv().moves.filter(m => m.expiry && m.qty > 0 && m.expiry <= U.addDays(today, 30));
  if (exp.length) n.push([`${exp.length} stock batch(es) expiring within 30 days`, '#/reports/inventory/serial', 'amber']);
  const unrec = DB.data.bankAccounts.reduce((s, a) => s + C.bankEntries(a.id).filter(e => !e.reconciled && e.date < U.addDays(today, -30)).length, 0);
  if (unrec) n.push([`${unrec} bank transaction(s) older than 30 days not reconciled`, '#/banking/reconcile', '']);
  return n;
}
function refreshTopbar() {
  $('#company-name').textContent = DB.data.settings.company;
  const a = Auth.get();
  $('#avatar').textContent = (a.name || 'A').trim().slice(0, 1).toUpperCase();
  const n = notifications();
  const c = $('#bell-count');
  c.textContent = n.length > 99 ? '99' : n.length;
  c.style.display = n.length ? '' : 'none';
  $('#notif-list').innerHTML = n.length ? n.map(([txt, href, cls]) => `<li><a href="${href}"><span class="dot ${cls}"></span>${E(txt)}</a></li>`).join('') : `<li class="muted" style="padding:12px 16px">No notifications 🎉</li>`;
  markMenu();
}

/* ---------------- User / company modals ---------------- */
function profileModal() {
  const a = Auth.get();
  UI.modal('My Profile', `<div class="form-grid">
    ${UI.field('Name', UI.input('name', a.name))}
    ${UI.field('Email', UI.input('email', a.email, 'type="email"'))}
  </div><p class="muted small">Your name is recorded in the Audit Trail for every change you make.</p>`, {
    onSubmit(v) { Auth.set(Object.assign(a, v)); UI.toast('Profile saved', 'ok'); refreshTopbar(); },
  });
}
function passwordModal() {
  const a = Auth.get();
  UI.modal('Change Password', `
    <div class="alert info small">The password locks this app on this computer when you log out or reopen the browser. Leave the new password blank to remove the lock. <b>Note:</b> this is a privacy lock, not encryption — keep regular backups.</div>
    <div class="form-grid">
      ${a.hash ? UI.field('Current password', UI.input('current', '', 'type="password" autocomplete="current-password"'), 'full') : ''}
      ${UI.field('New password', UI.input('pw', '', 'type="password" autocomplete="new-password"'))}
      ${UI.field('Confirm new password', UI.input('pw2', '', 'type="password" autocomplete="new-password"'))}
    </div>`, {
    async onSubmit(v) {
      if (a.hash && await Auth.hash(v.current || '') !== a.hash) throw new Error('Current password is incorrect');
      if (v.pw !== v.pw2) throw new Error('New passwords do not match');
      if (v.pw && v.pw.length < 4) throw new Error('Use at least 4 characters');
      a.hash = v.pw ? await Auth.hash(v.pw) : '';
      Auth.set(a); Auth.unlock();
      UI.toast(v.pw ? 'Password set' : 'Password removed', 'ok');
    },
  });
}
function companyModal() {
  const r = Registry.get();
  UI.modal('Switch Company', `
    ${UI.table([
      { label: 'Company', render: c => `<b>${E(c.name)}</b>${c.id === r.current ? ' <span class="badge green">Current</span>' : ''}` },
      { label: '', cls: 'num', render: c => c.id === r.current ? '' : `<button type="button" class="btn sm primary" data-sw="${c.id}">Open</button> <button type="button" class="btn sm danger" data-rm="${c.id}">Delete</button>` },
    ], r.list)}
    <div class="form-grid mt">${UI.field('Add a new company', UI.input('name', '', 'placeholder="Company name"'))}</div>`, {
    submitLabel: 'Add company',
    onMount(m) {
      $$('[data-sw]', m).forEach(b => b.onclick = () => { Registry.switchTo(b.dataset.sw); location.hash = '#/'; location.reload(); });
      $$('[data-rm]', m).forEach(b => b.onclick = () => {
        const c = r.list.find(x => x.id === b.dataset.rm);
        m.remove();
        UI.modal('Delete company', `
          <div class="alert err">This permanently deletes <b>all data of “${E(c.name)}”</b> on this device — invoices, contacts, products, settings. It cannot be undone. (Copies already synced to Google Drive are not touched.)</div>
          ${UI.field('Type DELETE to confirm', UI.input('confirm', '', 'autocomplete="off" autocapitalize="characters" placeholder="DELETE"'))}`, {
          submitLabel: 'Delete company',
          onSubmit(v) {
            if (v.confirm !== 'DELETE') throw new Error('Type DELETE in capital letters to confirm');
            Registry.remove(c.id);
            UI.toast(`“${c.name}” deleted`, 'ok');
            setTimeout(companyModal, 0);
          },
        });
      });
    },
    onSubmit(v) {
      if (!v.name) throw new Error('Enter a company name');
      Registry.add(v.name);
      DB.load(); DB.data.settings.company = v.name; DB.save();
      location.hash = '#/control/profile'; location.reload();
    },
  });
}

/* ---------------- Lock screen ---------------- */
function showLock() {
  $('#view').innerHTML = '';
  if ($('#lock')) return;
  const el = document.createElement('div');
  el.id = 'lock';
  el.className = 'lock';
  el.innerHTML = `<form class="lock-box">
    <div class="logo">CFO</div><h2>${E(DB.data.settings.company)}</h2>
    <p class="muted">Welcome back, ${E(Auth.userName())}</p>
    <input type="password" name="pw" placeholder="Password" autocomplete="current-password" autofocus>
    <button class="btn primary" style="width:100%;justify-content:center;margin-top:12px">Unlock</button>
    <p class="muted small" style="margin-top:14px">Forgot it? Clear this site's data in your browser and restore from a backup.</p>
  </form>`;
  document.body.appendChild(el);
  $('form', el).onsubmit = async e => {
    e.preventDefault();
    if (await Auth.hash(e.target.pw.value) === Auth.get().hash) { Auth.unlock(); el.remove(); render(); }
    else { UI.toast('Wrong password', 'err'); e.target.pw.select(); }
  };
}

/* ---------------- Workflows ---------------- */
const FLOWS = {
  sale() {
    const n = ty => C.docs(ty).filter(d => !['void', 'closed', 'paid', 'converted'].includes(C.status(d))).length || '';
    return UI.flow([
      [1, 1, 'Quotation', '#/docs/quotation', n('quotation')], [1, 3, 'Sales Order', '#/docs/salesOrder', n('salesOrder')],
      [3, 1, 'Sales Report', '#/reports/sales'], [3, 3, 'Sales Invoice', '#/docs/invoice', n('invoice')], [3, 5, 'Credit Note', '#/docs/creditNote', n('creditNote')],
      [5, 3, 'Payment', '#/sales?tab=receive'], [5, 5, 'Refund', '#/sales?tab=refund-out'],
    ], [[1, 2, 'right'], [2, 3, 'down'], [2, 2, 'downleft'], [3, 2, 'left'], [3, 4, 'right'], [4, 3, 'down'], [4, 5, 'down'], [5, 4, 'right']]);
  },
  purchase() {
    const n = ty => C.docs(ty).filter(d => !['void', 'closed', 'paid', 'converted'].includes(C.status(d))).length || '';
    return UI.flow([
      [1, 1, 'Purchase Order', '#/docs/purchaseOrder', n('purchaseOrder')], [1, 3, 'Receive Item', '#/docs/receiveItem', n('receiveItem')],
      [3, 1, 'Credit Note', '#/docs/purchaseCreditNote', n('purchaseCreditNote')], [3, 3, 'Bill', '#/docs/bill', n('bill')], [3, 5, 'Purchases Report', '#/reports/purchases'],
      [5, 1, 'Refund', '#/purchases?tab=refund-in'], [5, 3, 'Payment', '#/purchases?tab=pay'],
    ], [[1, 2, 'right'], [2, 3, 'down'], [3, 2, 'left'], [3, 4, 'right'], [4, 1, 'down'], [4, 3, 'down'], [5, 2, 'left']]);
  },
  banking() {
    return UI.flow([
      [1, 3, 'Transactions', '#/transactions'],
      [3, 1, 'Sales Payment', '#/sales?tab=receive'], [3, 3, 'Reconcile Account', '#/banking/reconcile'], [3, 5, 'Purchases Payment', '#/purchases?tab=pay'],
      [5, 3, 'Report', '#/banking/report'],
    ], [[2, 3, 'down'], [3, 2, 'right'], [3, 4, 'left'], [4, 3, 'down']]);
  },
  inventory() {
    return UI.flow([
      [1, 1, 'Inventory Setting', '#/control/inventory'], [1, 3, 'Product & Service', '#/products'],
      [3, 1, 'Sale', '#/docs/invoice'], [3, 3, 'Purchase', '#/docs/bill'], [3, 5, 'Inventory Adjustment', '#/inventory/adjustments'],
      [5, 3, 'Inventory Report', '#/reports/inventory/valuation-summary'],
    ], [[1, 2, 'right'], [2, 3, 'down'], [4, 3, 'down']], 3);
  },
  tax() {
    return UI.flow([
      [1, 3, 'Tax Setting', '#/control/taxes'],
      [3, 1, 'Sale', '#/reports/sst/details?side=output'], [3, 3, 'Purchase', '#/reports/sst/details?side=input'], [3, 5, 'Transactions', '#/reports/sst/details?source=bank'],
      [5, 3, 'Tax Filing', '#/sst-filing'], [5, 5, 'Tax Report', '#/reports/sst/summary'],
    ], [[2, 3, 'down'], [4, 3, 'down'], [4, 5, 'down'], [5, 4, 'right']], 3);
  },
};

/* ---------------- Home ---------------- */
route('/', (el, q) => {
  let tab = q.tab;
  try { if (!tab) tab = localStorage.getItem('cfo-home-tab') || 'dashboard'; else localStorage.setItem('cfo-home-tab', tab); } catch (e) { tab = tab || 'dashboard'; }
  const empty = !DB.data.docs.length && !DB.data.contacts.length && !DB.data.products.length;
  const head = `<div class="tabs home-tabs"><a href="#/?tab=workflows" class="${tab === 'workflows' ? 'active' : ''}">${E(t('Workflows'))}</a><a href="#/?tab=dashboard" class="${tab === 'dashboard' ? 'active' : ''}">${E(t('Dashboard'))}</a></div>
    ${empty ? `<div class="alert info">Welcome! Set up your <a href="#/control/profile">business profile</a>, <a href="#/banking/accounts">bank accounts</a>, <a href="#/contacts">contacts</a> and <a href="#/products">products</a> — or <a href="#" id="load-sample"><b>load sample data</b></a> to explore.</div>` : ''}`;
  if (tab === 'workflows') {
    el.innerHTML = `${head}${UI.pageHead('Workflows')}
      <div class="flows">
        <div class="card flow-card"><h2>${E(t('Sales'))}</h2>${FLOWS.sale()}</div>
        <div class="card flow-card"><h2>${E(t('Purchases'))}</h2>${FLOWS.purchase()}</div>
        <div class="card flow-card"><h2>Banking</h2>${FLOWS.banking()}</div>
        <div class="card flow-card"><h2>${E(t('Inventory'))}</h2>${FLOWS.inventory()}</div>
        <div class="card flow-card"><h2>${E(t('Tax'))}</h2>${FLOWS.tax()}</div>
      </div>`;
  } else {
    const d = U.today(), ms = U.monthStart(d), fy = U.fyStart(d);
    const plM = C.pl(ms, d), plY = C.pl(fy, d);
    const tax = C.taxSummary(ms, U.monthEnd(d));
    const months = [...Array(6)].map((_, i) => U.addMonths(d, i - 5).slice(0, 7));
    const pls = months.map(m => C.pl(m + '-01', U.monthEnd(m + '-01')));
    const series = [
      { name: 'Income', color: '#3b9cf5', values: pls.map(p => p.totalIncome) },
      { name: 'Expenses', color: '#f59e0b', values: pls.map(p => p.totalCogs + p.totalExpense) },
      { name: 'Net Profit', color: '#16a34a', values: pls.map(p => Math.max(0, p.net)) },
    ];
    const overdue = C.openPayables('sales').filter(x => C.status(x) === 'overdue');
    const low = C.stockItems().map(p => ({ p, q: C.stockQty(p.id) })).filter(x => x.q <= C.lowStockLevel(x.p));
    el.innerHTML = `${head}
      ${UI.pageHead('Dashboard', null, `<a class="btn" href="#/docs/quotation/new">+ ${E(t('Quote'))}</a><a class="btn primary" href="#/docs/invoice/new">+ ${E(t('Invoice'))}</a><a class="btn" href="#/docs/bill/new">+ ${E(t('Bill'))}</a><a class="btn" href="#/ai-scan">${E(t('A.I Scan'))}</a>`)}
      <div class="kpis">
        <div class="kpi"><div class="lbl">${E(t('Cash & Bank'))}</div><div class="val">${U.money(C.totalCash())}</div><div class="sub">${DB.data.bankAccounts.length} account(s)</div></div>
        <div class="kpi"><div class="lbl">${E(t('Receivables'))}</div><div class="val">${U.money(C.receivables())}</div><div class="sub">${overdue.length} overdue</div></div>
        <div class="kpi"><div class="lbl">${E(t('Payables'))}</div><div class="val">${U.money(C.payables())}</div><div class="sub">Unpaid bills</div></div>
        <div class="kpi"><div class="lbl">Income (this month)</div><div class="val">${U.money(plM.totalIncome)}</div><div class="sub">Net profit ${U.amt(plM.net)}</div></div>
        <div class="kpi ${plY.net >= 0 ? 'pos' : 'neg'}"><div class="lbl">Net profit (this FY)</div><div class="val">${U.money(plY.net)}</div><div class="sub">Since ${U.fdate(fy)}</div></div>
        <div class="kpi ${tax.net > 0 ? 'neg' : ''}"><div class="lbl">Net SST (this month)</div><div class="val">${U.money(tax.net)}</div><div class="sub">${tax.claimable ? `Output ${U.amt(tax.output)} − Input ${U.amt(tax.input)}` : 'Output tax collected'}</div></div>
      </div>
      <div class="grid g2">
        <div class="card"><h2>Income & expenses — last 6 months</h2><div class="mt">${UI.barChart(months.map(U.monthLabel), series)}</div></div>
        <div class="card"><div class="card-head"><h2>Cash balance (as of today)</h2><div class="spacer"></div><a href="#/transactions">${E(t('Transactions'))} →</a></div>
          ${UI.table([
            { label: 'Account', render: a => `<a href="#/transactions?acc=${a.id}">${E(a.name)}</a>` },
            { label: 'Bank', render: a => E(a.bank || '') },
            { label: 'Balance', cls: 'num', render: a => `<b>${U.amt(C.bankBalance(a.id))}</b>` },
          ], DB.data.bankAccounts, { empty: 'No bank accounts yet.', foot: DB.data.bankAccounts.length ? `<tr><td colspan="2">${E(t('Total'))}</td><td class="num">${U.amt(C.totalCash())}</td></tr>` : '' })}</div>
      </div>
      <div class="grid g2">
        <div class="card"><div class="card-head"><h2>Overdue invoices</h2><div class="spacer"></div><a href="#/reports/ageing/ar-summary">${E(t('Ageing Report'))} →</a></div>
          ${UI.table([
            { label: 'Invoice', render: x => `<a href="#/doc/${x.id}">${E(x.number)}</a>` },
            { label: 'Customer', render: x => E(C.contactName(x.contactId)) },
            { label: 'Due Date', render: x => U.fdate(x.dueDate) },
            { label: 'Balance', cls: 'num', render: x => U.amt(C.balance(x)) },
          ], overdue, { empty: 'No overdue invoices 🎉', href: x => '#/doc/' + x.id })}</div>
        <div class="card"><div class="card-head"><h2>${E(t('Stock Alert'))}</h2><div class="spacer"></div><a href="#/reports/inventory/alert">→</a></div>
          ${UI.table([
            { label: 'Product', render: x => E(x.p.name) },
            { label: 'On hand', cls: 'num', render: x => `<span class="${x.q <= 0 ? 'text-red' : ''}">${U.qty(x.q)}</span>` },
            { label: 'Reorder at', cls: 'num', render: x => U.qty(C.lowStockLevel(x.p)) },
            { label: '', cls: 'num', render: x => x.p.components && x.p.components.length ? `<a href="#/inventory/builds?new=build&product=${x.p.id}">Build</a>` : `<a href="#/docs/purchaseOrder/new?product=${x.p.id}">Reorder</a>` },
          ], low, { empty: 'All stock levels OK.' })}</div>
      </div>`;
  }
  const ls = $('#load-sample', el);
  if (ls) ls.onclick = e => { e.preventDefault(); loadSampleData(); UI.toast('Sample data loaded', 'ok'); render(); };
});

/* ---------------- Global search ---------------- */
route('/search', (el, q) => {
  const s = (q.q || '').toLowerCase();
  const has = (...v) => v.some(x => String(x || '').toLowerCase().includes(s));
  const docs = DB.data.docs.filter(d => has(d.number, d.ref, C.contactName(d.contactId), d.notes, ...d.lines.map(l => l.description)));
  const contacts = DB.data.contacts.filter(c => has(c.name, c.email, c.phone, c.regNo, c.tin, c.idNo));
  const products = DB.data.products.filter(p => has(p.name, p.code, p.description));
  const pays = DB.data.payments.filter(p => has(p.number, p.ref, C.contactName(p.contactId)));
  el.innerHTML = `${UI.pageHead(`Search: “${q.q || ''}”`)}
    <div class="card"><h2>Documents (${docs.length})</h2><div class="mt">${UI.table([
      { label: 'Date', render: d => U.fdate(d.date) }, { label: 'Type', render: d => E(t(C.docTitle(d))) },
      { label: 'Number', render: d => `<a href="#/doc/${d.id}">${E(d.number)}</a>` }, { label: 'Contact', render: d => E(C.contactName(d.contactId)) },
      { label: 'Status', render: d => UI.badge(C.status(d)) }, { label: 'Total', cls: 'num', render: d => U.amt(C.total(d)) },
    ], docs, { href: d => '#/doc/' + d.id, empty: 'No matches.' })}</div></div>
    <div class="grid g2">
      <div class="card"><h2>Contacts (${contacts.length})</h2><div class="mt">${UI.table([{ label: 'Name', render: c => `<a href="#/contacts/${c.id}">${E(c.name)}</a>` }, { label: 'Type', render: c => E(c.type) }], contacts, { href: c => '#/contacts/' + c.id, empty: 'No matches.' })}</div></div>
      <div class="card"><h2>Products (${products.length})</h2><div class="mt">${UI.table([{ label: 'Code', render: p => E(p.code) }, { label: 'Name', render: p => `<a href="#/products/${p.id}">${E(p.name)}</a>` }], products, { href: p => '#/products/' + p.id, empty: 'No matches.' })}</div></div>
    </div>
    <div class="card"><h2>Payments (${pays.length})</h2><div class="mt">${paymentsTable(pays)}</div></div>`;
  wirePaymentActions(el);
});

route('/settings', () => { location.replace('#/control/profile'); });

/* ---------------- Boot ---------------- */
window.addEventListener('DOMContentLoaded', () => {
  DB.load();
  document.documentElement.lang = I18N.lang();
  buildMenu();
  initTopbar();
  $('#menu-btn').onclick = e => { e.stopPropagation(); document.body.classList.toggle('nav-open'); };
  window.addEventListener('hashchange', render);
  render();
  const si = $('#sync-ind');
  si.onclick = () => { if (Sync.status === 'error') location.hash = '#/control/sync'; else Sync.run({ manual: true }); };
  Sync.init();
});
