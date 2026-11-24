'use strict';
/* =========================================================================
   Products & Services: products, adjustments, build/unbuild,
   count inventory, move items between locations
   ========================================================================= */

/* ---------------- Product modal ---------------- */
function productModal(p, onSaved) {
  const inv = DB.data.inventorySettings, tx = DB.data.taxSettings;
  p = p || { type: 'product', unit: inv.units[0], trackStock: inv.trackStock, taxSale: tx.defaultSales, taxPurchase: tx.defaultPurchase, openingQty: 0, uoms: [], components: [], active: true };
  const uoms = (p.uoms || []).map(u => ({ ...u }));
  const comps = (p.components || []).map(c => ({ ...c }));
  const prodOpts = [['', 'Select…'], ...DB.data.products.filter(x => x.id !== p.id && x.type === 'product').map(x => [x.id, (x.code ? x.code + ' · ' : '') + x.name])];
  UI.modal(p.id ? 'Edit Product / Service' : 'New Product / Service', `<div class="form-grid">
    ${UI.field('Name *', UI.input('name', p.name), 'full')}
    ${UI.field('Code / SKU', UI.input('code', p.code))}
    ${UI.field('Type', UI.select('type', [['product', 'Product (inventory)'], ['service', 'Service']], p.type))}
    ${UI.field('Base unit', `<input name="unit" list="units" value="${E(p.unit)}"><datalist id="units">${inv.units.map(u => `<option value="${E(u)}">`).join('')}</datalist>`)}
    ${UI.field('Category', UI.input('category', p.category))}
    ${UI.field('Selling price', UI.input('salePrice', p.salePrice ?? '', 'type="number" step="0.01" min="0"'))}
    ${UI.field('Cost price', UI.input('costPrice', p.costPrice ?? '', 'type="number" step="0.01" min="0"'))}
    ${UI.field('Sales tax', UI.select('taxSale', UI.taxOptions('sales'), p.taxSale))}
    ${UI.field('Purchase tax', UI.select('taxPurchase', UI.taxOptions('purchase'), p.taxPurchase))}
    ${UI.field('Sales account', UI.select('salesAccountId', UI.glOptions(['income'], '(default)'), p.salesAccountId))}
    ${UI.field('Purchase / expense account', UI.select('purchaseAccountId', UI.glOptions(['cogs', 'expense', 'asset'], '(default)'), p.purchaseAccountId))}
    ${UI.field('Tariff code', UI.select('tariffCodeId', [['', '—'], ...DB.data.tariffCodes.map(c => [c.id, `${c.code} · ${c.description}`])], p.tariffCodeId))}
    <div class="field inv-only">${UI.check('trackStock', 'Track stock quantity', p.trackStock !== false)}${UI.check('trackSerial', 'Track serial / batch no. & expiry date', p.trackSerial)}</div>
    ${UI.field('Opening quantity', UI.input('openingQty', p.openingQty ?? 0, 'type="number" step="any"'), 'inv-only')}
    ${DB.data.locations.length > 1 ? UI.field('Opening stock location', UI.select('openingLocationId', UI.locationOptions(), p.openingLocationId), 'inv-only') : ''}
    ${UI.field('Reorder level', UI.input('reorderLevel', p.reorderLevel ?? '', `type="number" step="any" placeholder="Default ${inv.lowStockLevel}"`), 'inv-only')}
    ${UI.field('Reorder quantity', UI.input('reorderQty', p.reorderQty ?? '', 'type="number" step="any"'), 'inv-only')}
    <div class="field" style="justify-content:flex-end">${UI.check('active', 'Active', p.active !== false)}</div>
    ${UI.field('Description', UI.textarea('description', p.description), 'full')}
    <div class="field full inv-only"><label>Other units of measure (e.g. box = 12 ${E(p.unit || 'pcs')})</label><div id="uoms"></div><button type="button" class="btn sm" id="addUom" style="align-self:flex-start">+ Add unit</button></div>
    <div class="field full inv-only"><label>Components — makes this an assembly you can build from other items</label><div id="comps"></div><button type="button" class="btn sm" id="addComp" style="align-self:flex-start">+ Add component</button></div>
  </div>`, {
    wide: true,
    onMount(m) {
      const drawU = () => {
        $('#uoms', m).innerHTML = uoms.length ? `<table class="lines-table"><thead><tr><th>Unit name</th><th class="num">= base units</th><th class="num">Selling price (optional)</th><th></th></tr></thead><tbody>${uoms.map((u, i) => `<tr data-i="${i}"><td><input data-u="name" value="${E(u.name)}"></td><td><input data-u="factor" type="number" step="any" class="right" value="${E(u.factor)}"></td><td><input data-u="price" type="number" step="0.01" class="right" value="${E(u.price || '')}"></td><td><button type="button" class="btn link" data-urm>✕</button></td></tr>`).join('')}</tbody></table>` : '';
      };
      const drawC = () => {
        $('#comps', m).innerHTML = comps.length ? `<table class="lines-table"><thead><tr><th>Component</th><th class="num">Qty per unit</th><th></th></tr></thead><tbody>${comps.map((c, i) => `<tr data-i="${i}"><td>${UI.select('', prodOpts, c.productId, 'data-c="productId"')}</td><td><input data-c="qty" type="number" step="any" class="right" value="${E(c.qty)}"></td><td><button type="button" class="btn link" data-crm>✕</button></td></tr>`).join('')}</tbody></table>` : '';
      };
      $('#uoms', m).addEventListener('input', e => { const f = e.target.dataset.u; if (f) uoms[+e.target.closest('tr').dataset.i][f] = e.target.value; });
      $('#uoms', m).addEventListener('click', e => { if (e.target.closest('[data-urm]')) { uoms.splice(+e.target.closest('tr').dataset.i, 1); drawU(); } });
      $('#comps', m).addEventListener('input', e => { const f = e.target.dataset.c; if (f) comps[+e.target.closest('tr').dataset.i][f] = e.target.value; });
      $('#comps', m).addEventListener('click', e => { if (e.target.closest('[data-crm]')) { comps.splice(+e.target.closest('tr').dataset.i, 1); drawC(); } });
      $('#addUom', m).onclick = () => { uoms.push({ name: '', factor: '', price: '' }); drawU(); };
      $('#addComp', m).onclick = () => { comps.push({ productId: '', qty: 1 }); drawC(); };
      const sync = () => $$('.inv-only', m).forEach(x => x.style.display = $('select[name=type]', m).value === 'product' ? '' : 'none');
      $('select[name=type]', m).addEventListener('change', sync);
      drawU(); drawC(); sync();
    },
    onSubmit(v) {
      if (!v.name) throw new Error('Name is required');
      if (v.code && DB.data.products.some(x => x.code === v.code && x.id !== p.id)) throw new Error('Code already used');
      const isProd = v.type === 'product';
      const cleanU = isProd ? uoms.filter(u => u.name && U.num(u.factor) > 0).map(u => ({ name: u.name.trim(), factor: U.num(u.factor), price: U.num(u.price) || '' })) : [];
      const cleanC = isProd ? comps.filter(c => c.productId && U.num(c.qty) > 0).map(c => ({ productId: c.productId, qty: U.num(c.qty) })) : [];
      const saved = DB.upsert('products', Object.assign(p, v, {
        salePrice: U.num(v.salePrice), costPrice: U.num(v.costPrice), openingQty: isProd ? U.num(v.openingQty) : 0,
        trackStock: isProd && v.trackStock, trackSerial: isProd && v.trackSerial,
        reorderLevel: v.reorderLevel === '' ? '' : U.num(v.reorderLevel), reorderQty: v.reorderQty === '' ? '' : U.num(v.reorderQty),
        uoms: cleanU, components: cleanC,
      }), 'Product');
      UI.toast('Saved', 'ok');
      onSaved ? onSaved(saved) : render();
    },
  });
}

route('/products', (el, q) => {
  const tab = q.tab || 'all';
  const list = DB.data.products.filter(p => tab === 'all' || (tab === 'inactive' ? p.active === false : p.type === tab && p.active !== false)).sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));
  el.innerHTML = `${UI.pageHead('Products & Services List', null, `<a class="btn" href="#/inventory/adjustments">${E(t('Adjustment List'))}</a><button class="btn" id="exp">${E(t('Export CSV'))}</button><button class="btn primary" id="new">+ ${E(t('New Product / Service'))}</button>`)}
    <div class="tabs">${[['all', 'All'], ['product', 'Products'], ['service', 'Services'], ['inactive', 'Inactive']].map(([k, l]) => `<a href="#/products?tab=${k}" class="${tab === k ? 'active' : ''}">${E(t(l))}</a>`).join('')}</div>
    <div class="card"><div class="filters">${UI.searchBox()}</div>${UI.table([
      { label: 'Code', render: p => E(p.code) },
      { label: 'Name', render: p => `<a href="#/products/${p.id}"><b>${E(p.name)}</b></a>${p.components?.length ? ' <span class="badge blue">Assembly</span>' : ''}<div class="small muted">${E(p.description || '')}</div>` },
      { label: 'Type', render: p => p.type === 'product' ? 'Product' : 'Service' },
      { label: 'Price', cls: 'num', render: p => U.amt(p.salePrice) },
      { label: 'Cost', cls: 'num', render: p => U.amt(C.isStock(p) ? C.avgCost(p.id) : p.costPrice) },
      { label: 'On hand', cls: 'num', render: p => C.isStock(p) ? `<span class="${C.stockQty(p.id) <= C.lowStockLevel(p) ? 'text-red' : ''}">${U.qty(C.stockQty(p.id))}</span> ${E(p.unit || '')}` : '—' },
      { label: '', cls: 'num no-print', render: p => `<button class="btn sm" data-edit="${p.id}">${E(t('Edit'))}</button> <button class="btn sm danger" data-del="${p.id}">${E(t('Delete'))}</button>` },
    ], list, { href: p => '#/products/' + p.id, empty: 'No products or services yet.' })}</div>`;
  $('#new', el).onclick = () => productModal();
  $('#exp', el).onclick = () => U.download('products.csv', '﻿' + U.csv([['Code', 'Name', 'Type', 'Unit', 'Sale price', 'Cost price', 'On hand', 'Avg cost'], ...DB.data.products.map(p => [p.code, p.name, p.type, p.unit, p.salePrice, p.costPrice, C.isStock(p) ? C.stockQty(p.id) : '', C.isStock(p) ? U.r2(C.avgCost(p.id)) : ''])]), 'text/csv');
  $$('[data-edit]', el).forEach(b => b.onclick = () => productModal(JSON.parse(JSON.stringify(DB.get('products', b.dataset.edit)))));
  $$('[data-del]', el).forEach(b => b.onclick = () => {
    const id = b.dataset.del;
    const used = DB.data.docs.some(d => d.lines.some(l => l.productId === id)) || DB.data.adjustments.some(a => a.productId === id) || DB.data.builds.some(x => x.productId === id || x.components.some(c => c.productId === id)) || DB.data.products.some(x => (x.components || []).some(c => c.productId === id));
    if (used) return UI.toast('Item is used in documents — mark it inactive instead', 'err');
    if (confirm('Delete this item?')) { DB.remove('products', id, 'Product'); render(); }
  });
  if (q.new) { history.replaceState(null, '', '#/products'); productModal(); }
});

route('/products/:id', (el, q, id) => {
  const p = C.product(id);
  if (!p) throw new Error('Product not found');
  const stock = C.isStock(p);
  const moves = stock ? C.productMoves(id) : [];
  const sold = DB.data.docs.filter(d => ['invoice', 'creditNote'].includes(d.type) && d.status !== 'void' && d.lines.some(l => l.productId === id));
  el.innerHTML = `${UI.pageHead(p.name, [['Products & Services', '#/products']], `<button class="btn" id="edit">${E(t('Edit'))}</button>${stock ? `<a class="btn" href="#/inventory/adjustments?new=1&product=${p.id}">+ Adjustment</a>${p.components?.length ? `<a class="btn" href="#/inventory/builds?new=build&product=${p.id}">Build</a>` : ''}<a class="btn primary" href="#/docs/purchaseOrder/new?product=${p.id}">Reorder</a>` : ''}`)}
    <div class="kpis">
      <div class="kpi"><div class="lbl">Code</div><div class="val">${E(p.code || '—')}</div><div class="sub">${p.type === 'product' ? 'Product' : 'Service'}${p.category ? ' · ' + E(p.category) : ''}</div></div>
      <div class="kpi"><div class="lbl">Selling price</div><div class="val">${U.money(p.salePrice)}</div><div class="sub">per ${E(p.unit || 'unit')}</div></div>
      ${stock ? `<div class="kpi"><div class="lbl">${E(t('On hand'))}</div><div class="val">${U.qty(C.stockQty(id))} ${E(p.unit || '')}</div><div class="sub">Reorder at ${U.qty(C.lowStockLevel(p))}</div></div>
      <div class="kpi"><div class="lbl">Avg cost</div><div class="val">${U.money(C.avgCost(id))}</div><div class="sub">Value ${U.amt(C.stockValue(id))}</div></div>` : ''}
    </div>
    ${stock && DB.data.locations.length > 1 ? `<div class="card"><h2>Stock by location</h2><div class="mt">${UI.table([{ label: 'Location', render: l => E(l.name) }, { label: 'On hand', cls: 'num', render: l => U.qty(C.stockQty(id, '', l.id)) }], DB.data.locations)}</div></div>` : ''}
    ${p.components?.length ? `<div class="card"><h2>Components (per 1 ${E(p.unit || 'unit')})</h2><div class="mt">${UI.table([{ label: 'Component', render: c => E(C.product(c.productId)?.name || '?') }, { label: 'Qty', cls: 'num', render: c => U.qty(c.qty) }, { label: 'On hand', cls: 'num', render: c => U.qty(C.stockQty(c.productId)) }], p.components)}</div></div>` : ''}
    ${p.uoms?.length ? `<div class="card"><h2>Units of measure</h2><div class="mt">${UI.table([{ label: 'Unit', render: u => E(u.name) }, { label: 'Base units', cls: 'num', render: u => U.qty(u.factor) + ' ' + E(p.unit || '') }, { label: 'Price', cls: 'num', render: u => U.amt(u.price || p.salePrice * u.factor) }], p.uoms)}</div></div>` : ''}
    ${stock ? `<div class="card"><h2>Stock movements</h2><div class="mt">${UI.table([
      { label: 'Date', render: m => U.fdate(m.date) }, { label: 'Type', render: m => E(m.kind) }, { label: 'Reference', render: m => `<a href="${m.link}">${E(m.ref)}</a>` },
      { label: 'Location', render: m => E(C.location(m.loc)?.name || '') },
      { label: 'In', cls: 'num', render: m => m.qty > 0 ? U.qty(m.qty) : '' }, { label: 'Out', cls: 'num', render: m => m.qty < 0 ? U.qty(-m.qty) : '' },
      { label: 'Cost', cls: 'num', render: m => U.amt(m.cost) }, { label: 'Balance', cls: 'num', render: m => U.qty(m.balQty) },
    ], [...moves].reverse(), { empty: 'No movements yet.' })}</div></div>` : ''}
    <div class="card"><h2>Sales documents</h2><div class="mt">${docTable(sold, { showType: true, party: 'Customer' })}</div></div>`;
  $('#edit', el).onclick = () => productModal(JSON.parse(JSON.stringify(p)));
});

/* ---------------- Adjustments ---------------- */
function adjustmentModal(a, presetProduct) {
  const items = C.stockItems();
  if (!items.length) return UI.toast('Add a stock product first', 'err');
  a = a || { date: U.today(), productId: presetProduct || items[0].id, mode: 'remove', locationId: C.defaultLocation() };
  const cur = a.qty !== undefined ? a : null;
  UI.modal(a.id ? 'Edit Inventory Adjustment' : 'New Inventory Adjustment', `<div class="form-grid">
    ${UI.field('Product *', UI.select('productId', items.map(p => [p.id, `${p.code ? p.code + ' · ' : ''}${p.name} (on hand ${U.qty(C.stockQty(p.id))})`]), a.productId), 'full')}
    ${UI.field('Date *', UI.input('date', a.date, 'type="date"'))}
    ${DB.data.locations.length > 1 ? UI.field('Location', UI.select('locationId', UI.locationOptions(), a.locationId)) : ''}
    ${UI.field('Adjustment', UI.select('mode', [['remove', 'Decrease stock (−)'], ['add', 'Increase stock (+)'], ['set', 'Set counted quantity']], cur ? (cur.qty < 0 ? 'remove' : 'add') : a.mode))}
    ${UI.field('Quantity *', UI.input('qty', cur ? Math.abs(cur.qty) : '', 'type="number" step="any" min="0"'))}
    ${UI.field('Unit cost (for increases, optional)', UI.input('unitCost', a.unitCost || '', 'type="number" step="0.01" min="0" placeholder="Average cost"'))}
    ${UI.field('Reason', `<input name="reason" list="reasons" value="${E(a.reason)}"><datalist id="reasons">${['Stock count', 'Damaged', 'Expired', 'Lost / Stolen', 'Sample / Promotion', 'Own use', 'Found', 'Opening correction'].map(r => `<option value="${r}">`).join('')}</datalist>`)}
    ${UI.field('Serial / batch no.', UI.input('batch', a.batch))}
    ${UI.field('Expiry date', UI.input('expiry', a.expiry, 'type="date"'))}
    ${UI.field('Notes', UI.input('notes', a.notes), 'full')}
  </div>`, {
    onSubmit(v) {
      const q = U.num(v.qty);
      if (!v.date) throw new Error('Date is required');
      let delta;
      if (v.mode === 'set') {
        const loc = v.locationId || '';
        const now = C.stockQty(v.productId, v.date, loc || undefined) - (a.id ? U.num(a.qty) : 0);
        delta = q - now;
      } else delta = v.mode === 'add' ? q : -q;
      if (!delta) throw new Error('No change in quantity');
      const rec = Object.assign(a, { productId: v.productId, date: v.date, qty: U.r2(delta * 1000) / 1000, reason: v.reason, notes: v.notes, unitCost: U.num(v.unitCost) || '', batch: v.batch, expiry: v.expiry, locationId: v.locationId || C.defaultLocation() });
      delete rec.mode;
      if (!rec.number) rec.number = DB.takeNumber('ADJ', DB.peekNumber('ADJ'));
      DB.upsert('adjustments', rec, 'Inventory Adjustment');
      UI.toast('Adjustment saved', 'ok'); render();
    },
  });
}

route('/inventory/adjustments', (el, q) => {
  const list = [...DB.data.adjustments].sort((a, b) => b.date.localeCompare(a.date));
  el.innerHTML = `${UI.pageHead('Adjustment List', [['Products & Services', '#/products']], `<a class="btn" href="#/inventory/count">${E(t('Count Inventory'))}</a><button class="btn primary" id="new">+ ${E(t('New Inventory Adjustment'))}</button>`)}
    <div class="card"><div class="filters">${UI.searchBox()}</div>${UI.table([
      { label: 'Date', render: a => U.fdate(a.date) },
      { label: 'Number', render: a => E(a.number) },
      { label: 'Product', render: a => `<a href="#/products/${a.productId}">${E(C.product(a.productId)?.name || '?')}</a>` },
      { label: 'Location', render: a => E(C.location(a.locationId)?.name || '') },
      { label: 'Reason', render: a => E(a.reason || '') + (a.notes ? `<div class="small muted">${E(a.notes)}</div>` : '') },
      { label: 'Qty', cls: 'num', render: a => `<span class="${a.qty < 0 ? 'text-red' : 'text-green'}">${a.qty > 0 ? '+' : ''}${U.qty(a.qty)}</span>` },
      { label: 'Value', cls: 'num', render: a => U.amt(C.inv().costs['adj:' + a.id] || 0) },
      { label: '', cls: 'num no-print', render: a => `<button class="btn sm" data-edit="${a.id}">${E(t('Edit'))}</button> <button class="btn sm danger" data-del="${a.id}">${E(t('Delete'))}</button>` },
    ], list, { empty: 'No adjustments yet. Use adjustments for stock counts, damaged or lost goods.' })}</div>`;
  $('#new', el).onclick = () => adjustmentModal();
  $$('[data-edit]', el).forEach(b => b.onclick = () => adjustmentModal({ ...DB.get('adjustments', b.dataset.edit) }));
  $$('[data-del]', el).forEach(b => b.onclick = () => { if (confirm('Delete this adjustment?')) { DB.remove('adjustments', b.dataset.del, 'Inventory Adjustment'); render(); } });
  if (q.new) { history.replaceState(null, '', '#/inventory/adjustments'); adjustmentModal(null, q.product); }
});
route('/inventory/item/:id', (el, q, id) => { location.replace('#/products/' + id); });

/* ---------------- Build / Unbuild ---------------- */
function buildModal(mode, presetProduct) {
  const kits = DB.data.products.filter(p => C.isStock(p) && p.components && p.components.length);
  if (!kits.length) return UI.toast('First add components to a product (edit the product → Components)', 'err');
  const build = mode !== 'unbuild';
  UI.modal(build ? 'Auto Build Items' : 'Unbuild Items', `
    <div class="alert info small">${build ? 'Building consumes the components from stock and adds the finished item at their combined cost.' : 'Unbuilding takes the finished item out of stock and returns its components.'}</div>
    <div class="form-grid">
      ${UI.field('Item *', UI.select('productId', kits.map(p => [p.id, `${p.name} (on hand ${U.qty(C.stockQty(p.id))})`]), presetProduct || kits[0].id), 'full')}
      ${UI.field('Quantity *', UI.input('qty', 1, 'type="number" step="any" min="0"'))}
      ${UI.field('Date *', UI.input('date', U.today(), 'type="date"'))}
      ${DB.data.locations.length > 1 ? UI.field('Location', UI.select('locationId', UI.locationOptions(), C.defaultLocation())) : ''}
      ${UI.field('Notes', UI.input('notes', ''))}
      <div class="field full" id="need"></div>
    </div>`, {
    onMount(m) {
      const draw = () => {
        const p = C.product($('[name=productId]', m).value), n = U.num($('[name=qty]', m).value);
        const maxB = Math.min(...p.components.map(c => Math.floor(C.stockQty(c.productId) / c.qty)));
        $('#need', m).innerHTML = UI.table([
          { label: 'Component', render: c => E(C.product(c.productId)?.name || '?') },
          { label: build ? 'Needed' : 'Returned', cls: 'num', render: c => U.qty(c.qty * n) },
          { label: 'On hand', cls: 'num', render: c => `<span class="${build && C.stockQty(c.productId) < c.qty * n ? 'text-red' : ''}">${U.qty(C.stockQty(c.productId))}</span>` },
        ], p.components) + (build ? `<p class="small muted">You can build up to <b>${isFinite(maxB) ? maxB : 0}</b> with current stock.</p>` : '');
      };
      $('[name=productId]', m).onchange = draw; $('[name=qty]', m).oninput = draw; draw();
    },
    onSubmit(v) {
      const p = C.product(v.productId), n = U.num(v.qty);
      if (n <= 0) throw new Error('Quantity must be greater than zero');
      const inv = DB.data.inventorySettings;
      if (!inv.allowNegative) {
        if (build) p.components.forEach(c => { if (C.stockQty(c.productId) < c.qty * n - 1e-9) throw new Error(`Not enough ${C.product(c.productId).name}`); });
        else if (C.stockQty(p.id) < n - 1e-9) throw new Error(`Not enough ${p.name} to unbuild`);
      }
      const rec = { number: DB.takeNumber(build ? 'BLD' : 'UBL', DB.peekNumber(build ? 'BLD' : 'UBL')), mode: build ? 'build' : 'unbuild', productId: p.id, qty: n, date: v.date, locationId: v.locationId || C.defaultLocation(), components: p.components.map(c => ({ ...c })), notes: v.notes };
      DB.upsert('builds', rec, build ? 'Build' : 'Unbuild');
      UI.toast(`${build ? 'Built' : 'Unbuilt'} ${U.qty(n)} × ${p.name}`, 'ok');
      location.hash = '#/inventory/builds'; render();
    },
  });
}
route('/inventory/builds', (el, q) => {
  const list = [...DB.data.builds].sort((a, b) => b.date.localeCompare(a.date));
  el.innerHTML = `${UI.pageHead('Build Items', [['Products & Services', '#/products']], `<button class="btn" data-m="unbuild">${E(t('Unbuild Items'))}</button><button class="btn primary" data-m="build">${E(t('Auto Build Items'))}</button>`)}
    <div class="card">${UI.table([
      { label: 'Date', render: b => U.fdate(b.date) },
      { label: 'Number', render: b => E(b.number) },
      { label: 'Type', render: b => b.mode === 'unbuild' ? '<span class="badge amber">Unbuild</span>' : '<span class="badge blue">Build</span>' },
      { label: 'Item', render: b => `<a href="#/products/${b.productId}">${E(C.product(b.productId)?.name || '?')}</a>` },
      { label: 'Qty', cls: 'num', render: b => U.qty(b.qty) },
      { label: 'Cost', cls: 'num', render: b => U.amt(Math.abs(C.inv().costs['bld:' + b.id] || 0)) },
      { label: 'Components', render: b => E(b.components.map(c => `${U.qty(c.qty * b.qty)} × ${C.product(c.productId)?.name || '?'}`).join(', ')) },
      { label: '', cls: 'num no-print', render: b => `<button class="btn sm danger" data-del="${b.id}">${E(t('Delete'))}</button>` },
    ], list, { empty: 'No builds yet.' })}</div>`;
  $$('[data-m]', el).forEach(b => b.onclick = () => buildModal(b.dataset.m));
  $$('[data-del]', el).forEach(b => b.onclick = () => { if (confirm('Delete this build? Stock will be restored.')) { DB.remove('builds', b.dataset.del, 'Build'); render(); } });
  if (q.new) { history.replaceState(null, '', '#/inventory/builds'); buildModal(q.new, q.product); }
});

/* ---------------- Count Inventory ---------------- */
route('/inventory/count', (el, q) => {
  const loc = q.loc || C.defaultLocation();
  const date = q.date || U.today();
  const items = C.stockItems().sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));
  const multi = DB.data.locations.length > 1;
  el.innerHTML = `${UI.pageHead('Count Inventory', [['Products & Services', '#/products']], `<button class="btn" onclick="window.print()">Print count sheet</button>`)}
    <div class="card">
      <p class="muted" style="margin-top:0">Enter the quantities you physically counted. Only items with a counted value are adjusted; differences post as inventory adjustments.</p>
      <div class="filters">
        ${UI.field('Count date', `<input type="date" id="c-date" value="${date}">`)}
        ${multi ? UI.field('Location', UI.select('', UI.locationOptions(), loc, 'id="c-loc"')) : ''}
      </div>
      ${UI.table([
        { label: 'Code', render: p => E(p.code) },
        { label: 'Product', render: p => E(p.name) },
        { label: 'System qty', cls: 'num', render: p => U.qty(C.stockQty(p.id, date, multi ? loc : undefined)) },
        { label: 'Counted', cls: 'num', render: p => `<input type="number" step="any" class="right cnt" data-p="${p.id}" data-sys="${C.stockQty(p.id, date, multi ? loc : undefined)}" style="width:110px">` },
        { label: 'Difference', cls: 'num', render: p => `<span data-diff="${p.id}"></span>` },
      ], items, { empty: 'No stock items.' })}
      <div class="btn-row mt" style="justify-content:flex-end"><button class="btn primary" id="post">Post adjustments</button></div>
    </div>
    <div class="card"><h2>Count history</h2><div class="mt">${UI.table([
      { label: 'Date', render: c => U.fdate(c.date) }, { label: 'Number', render: c => E(c.number) },
      { label: 'Location', render: c => E(C.location(c.locationId)?.name || '') },
      { label: 'Items counted', cls: 'num', render: c => c.lines.length },
      { label: 'Adjusted', cls: 'num', render: c => c.lines.filter(l => Math.abs(l.counted - l.system) > 1e-9).length },
      { label: 'User', render: c => E(c.user || '') },
    ], [...DB.data.stockCounts].reverse(), { empty: 'No counts yet.' })}</div></div>`;
  $$('.cnt', el).forEach(i => i.oninput = () => {
    const d = i.value === '' ? '' : U.num(i.value) - U.num(i.dataset.sys);
    const s = $(`[data-diff="${i.dataset.p}"]`, el);
    s.textContent = d === '' ? '' : (d > 0 ? '+' : '') + U.qty(d);
    s.className = d < 0 ? 'text-red' : d > 0 ? 'text-green' : '';
  });
  const go = () => { location.hash = `#/inventory/count?date=${$('#c-date', el).value}${multi ? '&loc=' + $('#c-loc', el).value : ''}`; };
  $('#c-date', el).onchange = go;
  if (multi) $('#c-loc', el).onchange = go;
  $('#post', el).onclick = () => {
    const lines = $$('.cnt', el).filter(i => i.value !== '').map(i => ({ productId: i.dataset.p, system: U.num(i.dataset.sys), counted: U.num(i.value) }));
    if (!lines.length) return UI.toast('Enter at least one counted quantity', 'err');
    const diffs = lines.filter(l => Math.abs(l.counted - l.system) > 1e-9);
    if (!confirm(`Post ${diffs.length} adjustment(s)?`)) return;
    const number = DB.takeNumber('CNT', DB.peekNumber('CNT'));
    diffs.forEach(l => DB.data.adjustments.push({ id: U.uid(), number: DB.takeNumber('ADJ', DB.peekNumber('ADJ')), date, productId: l.productId, qty: U.r2((l.counted - l.system) * 1000) / 1000, reason: 'Stock count', notes: number, locationId: loc }));
    DB.upsert('stockCounts', { number, date, locationId: loc, lines, user: Auth.userName() }, 'Stock Count');
    UI.toast(`Stock count ${number} posted`, 'ok'); render();
  };
});

/* ---------------- Move Items ---------------- */
function moveModal() {
  if (DB.data.locations.length < 2) { UI.toast('Add a second location first (Control Panel → Inventory → Locations)', 'err'); location.hash = '#/control/locations'; return; }
  const items = C.stockItems();
  const lines = [{ productId: items[0]?.id || '', qty: 1 }];
  UI.modal('Move Items', `<div class="form-grid">
      ${UI.field('Date *', UI.input('date', U.today(), 'type="date"'))}
      ${UI.field('From location', UI.select('fromLocationId', UI.locationOptions(), DB.data.locations[0].id))}
      ${UI.field('To location', UI.select('toLocationId', UI.locationOptions(), DB.data.locations[1].id))}
      ${UI.field('Notes', UI.input('notes', ''))}
    </div><div id="mv-lines" class="mt"></div><button type="button" class="btn sm" id="mv-add">+ Add item</button>`, {
    wide: true,
    onMount(m) {
      const draw = () => {
        const from = $('[name=fromLocationId]', m).value;
        $('#mv-lines', m).innerHTML = `<table class="lines-table"><thead><tr><th>Product</th><th class="num">Available</th><th class="num">Qty to move</th><th></th></tr></thead><tbody>${lines.map((l, i) => `<tr data-i="${i}"><td>${UI.select('', items.map(p => [p.id, p.name]), l.productId, 'data-f="productId"')}</td><td class="num">${U.qty(C.stockQty(l.productId, '', from))}</td><td><input data-f="qty" type="number" step="any" class="right" value="${E(l.qty)}"></td><td><button type="button" class="btn link" data-rm>✕</button></td></tr>`).join('')}</tbody></table>`;
      };
      $('#mv-lines', m).addEventListener('input', e => { const f = e.target.dataset.f; if (!f) return; lines[+e.target.closest('tr').dataset.i][f] = e.target.value; if (f === 'productId') draw(); });
      $('#mv-lines', m).addEventListener('click', e => { if (e.target.closest('[data-rm]') && lines.length > 1) { lines.splice(+e.target.closest('tr').dataset.i, 1); draw(); } });
      $('#mv-add', m).onclick = () => { lines.push({ productId: items[0]?.id || '', qty: 1 }); draw(); };
      $('[name=fromLocationId]', m).onchange = draw;
      draw();
    },
    onSubmit(v) {
      if (v.fromLocationId === v.toLocationId) throw new Error('Choose two different locations');
      const ls = lines.filter(l => l.productId && U.num(l.qty) > 0).map(l => ({ productId: l.productId, qty: U.num(l.qty) }));
      if (!ls.length) throw new Error('Add at least one item');
      if (!DB.data.inventorySettings.allowNegative) ls.forEach(l => { if (C.stockQty(l.productId, '', v.fromLocationId) < l.qty - 1e-9) throw new Error(`Not enough ${C.product(l.productId).name} at the source location`); });
      DB.upsert('stockTransfers', { number: DB.takeNumber('MOV', DB.peekNumber('MOV')), date: v.date, fromLocationId: v.fromLocationId, toLocationId: v.toLocationId, lines: ls, notes: v.notes }, 'Move Items');
      UI.toast('Items moved', 'ok'); render();
    },
  });
}
route('/inventory/moves', (el, q) => {
  const list = [...DB.data.stockTransfers].sort((a, b) => b.date.localeCompare(a.date));
  el.innerHTML = `${UI.pageHead('Move Items', [['Products & Services', '#/products']], `<a class="btn" href="#/reports/inventory/locations">${E(t('Inventory Location Summary'))}</a><button class="btn primary" id="new">+ ${E(t('Move Items'))}</button>`)}
    ${DB.data.locations.length < 2 ? `<div class="alert info">You have one location. Add more in <a href="#/control/locations">Control Panel → Locations</a> to move stock between them.</div>` : ''}
    <div class="card">${UI.table([
      { label: 'Date', render: x => U.fdate(x.date) }, { label: 'Number', render: x => E(x.number) },
      { label: 'From', render: x => E(C.location(x.fromLocationId)?.name || '') }, { label: 'To', render: x => E(C.location(x.toLocationId)?.name || '') },
      { label: 'Items', render: x => E(x.lines.map(l => `${U.qty(l.qty)} × ${C.product(l.productId)?.name || '?'}`).join(', ')) },
      { label: 'Notes', render: x => E(x.notes || '') },
      { label: '', cls: 'num no-print', render: x => `<button class="btn sm danger" data-del="${x.id}">${E(t('Delete'))}</button>` },
    ], list, { empty: 'No stock moves yet.' })}</div>`;
  $('#new', el).onclick = moveModal;
  $$('[data-del]', el).forEach(b => b.onclick = () => { if (confirm('Delete this move?')) { DB.remove('stockTransfers', b.dataset.del, 'Move Items'); render(); } });
  if (q.new) { history.replaceState(null, '', '#/inventory/moves'); moveModal(); }
});
