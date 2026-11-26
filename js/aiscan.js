'use strict';
/* =========================================================================
   A.I Scan: read a receipt / supplier invoice (image or PDF) with Claude
   and turn it into a Bill, Supplier Credit Note or a bank Withdrawal.
   Without an API key it still works as a manual "receipt beside the form"
   data-entry screen.
   ========================================================================= */

const SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['vendor_name', 'vendor_registration_no', 'document_type', 'document_number', 'date', 'due_date', 'currency', 'subtotal', 'tax_total', 'total', 'line_items'],
  properties: {
    vendor_name: { type: ['string', 'null'] },
    vendor_registration_no: { type: ['string', 'null'], description: 'Company registration (SSM/BRN), TIN or SST number if printed' },
    document_type: { type: 'string', enum: ['invoice', 'receipt', 'credit_note', 'other'] },
    document_number: { type: ['string', 'null'] },
    date: { type: ['string', 'null'], description: 'Document date as YYYY-MM-DD' },
    due_date: { type: ['string', 'null'], description: 'Payment due date as YYYY-MM-DD, if printed' },
    currency: { type: ['string', 'null'], description: 'ISO 4217 code, e.g. MYR, USD' },
    subtotal: { type: ['number', 'null'] },
    tax_total: { type: ['number', 'null'] },
    total: { type: ['number', 'null'] },
    line_items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['description', 'quantity', 'unit_price', 'tax_rate', 'amount'],
        properties: {
          description: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          unit_price: { type: ['number', 'null'], description: 'Price per unit before tax' },
          tax_rate: { type: ['number', 'null'], description: 'Tax rate in percent applied to this line, e.g. 10, 8, 6, 0' },
          amount: { type: ['number', 'null'], description: 'Line amount before tax' },
        },
      },
    },
  },
};

/** Downscale an image file to a JPEG (keeps requests small). Returns {mediaType, data(base64), url}. */
function scanPrepareImage(file, maxSide = 1600) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, maxSide / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      const g = cv.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 0, 0, cv.width, cv.height);
      const dataUrl = cv.toDataURL('image/jpeg', 0.85);
      res({ mediaType: 'image/jpeg', data: dataUrl.split(',')[1], url });
    };
    img.onerror = () => rej(new Error('Could not read this image'));
    img.src = url;
  });
}
function scanPreparePdf(file) {
  return new Promise((res, rej) => {
    if (file.size > 25 * 1024 * 1024) return rej(new Error('PDF is too large (max 25 MB)'));
    const fr = new FileReader();
    fr.onload = () => res({ mediaType: 'application/pdf', data: String(fr.result).split(',')[1], url: URL.createObjectURL(file) });
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}

/** Ask Claude to extract the document. Raw HTTP: this app is plain browser JS with no build step. */
async function scanWithClaude(file) {
  const ig = DB.data.integrations;
  const model = ig.aiModel || 'claude-opus-5-5';
  const source = { type: 'base64', media_type: file.mediaType, data: file.data };
  const block = file.mediaType === 'application/pdf' ? { type: 'document', source } : { type: 'image', source };
  const body = {
    model,
    max_tokens: 16000,
    system: 'You extract data from supplier invoices, receipts and credit notes for a Malaysian small-business accounting system. Read only what is printed. Use null for anything not shown; never invent values. Amounts are plain numbers without currency symbols or thousands separators. Dates are YYYY-MM-DD.',
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'Extract this document into the required JSON.' }] }],
    output_config: { format: { type: 'json_schema', schema: SCAN_SCHEMA } },
  };
  const headers = {
    'content-type': 'application/json',
    'x-api-key': ig.aiKey,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  // Server-side refusal fallback (not available on Haiku).
  if (model !== 'claude-haiku-5-5') { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body.fallbacks = 'default'; }
  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (e) { throw new Error('Could not reach the Anthropic API — check your internet connection.'); }
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = json && json.error && json.error.message ? json.error.message : resp.statusText;
    if (resp.status === 401) throw new Error('The API key was rejected. Check it in Control Panel → Integrated Apps.');
    if (resp.status === 429) throw new Error('Rate limited by the API — wait a moment and try again.');
    if (resp.status === 413) throw new Error('The file is too large to send.');
    throw new Error(`A.I Scan failed (${resp.status}): ${msg}`);
  }
  if (json.stop_reason === 'refusal') throw new Error('The model declined to read this document.');
  if (json.stop_reason === 'max_tokens') throw new Error('The document was too long to read completely.');
  const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try { return JSON.parse(text); } catch (e) { throw new Error('Could not understand the A.I response.'); }
}

/* ---------------- Page ---------------- */
route('/ai-scan', (el) => {
  const hasKey = !!DB.data.integrations.aiKey;
  let file = null;
  let data = { vendor_name: '', document_type: 'invoice', document_number: '', date: U.today(), due_date: '', currency: DB.data.settings.baseCurrency, line_items: [{ description: '', quantity: 1, unit_price: '', tax_rate: 0, amount: '' }] };
  el.innerHTML = `${UI.pageHead('A.I Scan', null, `<a class="btn" href="#/control/apps">${E(t('Integrated Apps'))}</a>`)}
    ${hasKey ? '' : `<div class="alert info">No Anthropic API key set, so <b>🔍 Read text (free)</b> uses free text recognition in your browser: it fills in the merchant, date, receipt no., tax and total — check them before saving. Add a key in <a href="#/control/apps">Control Panel → Integrated Apps</a> for full A.I reading with line items.</div>`}
    <div class="scan-wrap">
      <div class="card">
        <label class="scan-drop" id="drop"><input type="file" id="file" accept="image/*,application/pdf" capture="environment" hidden>
          <div style="font-size:34px">📄</div><b>Drop a receipt or supplier invoice here</b><div class="small">or click to choose / take a photo · JPG, PNG, PDF</div></label>
        <div class="scan-preview mt" id="preview"></div>
        <div class="btn-row mt"><button class="btn primary" id="scan" disabled>${hasKey ? '✨ Scan with A.I' : '🔍 Read text (free)'}</button><span class="small muted" id="status"></span></div>
      </div>
      <div class="card" id="result"></div>
    </div>`;
  const drawResult = () => {
    const supplier = DB.data.contacts.find(c => data.vendor_name && c.name.toLowerCase() === String(data.vendor_name).toLowerCase())
      || DB.data.contacts.find(c => data.vendor_name && (c.type !== 'customer') && (String(data.vendor_name).toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(String(data.vendor_name).toLowerCase())));
    const taxFor = rate => (DB.data.taxSettings.codes.find(x => U.num(x.rate) === U.num(rate) && x.type !== 'sales') || {}).id || '';
    $('#result', el).innerHTML = `<h2>Review & create</h2>
      <form id="sf" class="mt" novalidate><div class="form-grid">
        ${UI.field('Create as', UI.select('as', [['bill', 'Bill (supplier invoice)'], ['purchaseCreditNote', 'Supplier Credit Note'], ['out', 'Withdrawal (paid expense / receipt)']], data.document_type === 'receipt' ? 'out' : data.document_type === 'credit_note' ? 'purchaseCreditNote' : 'bill'))}
        ${UI.field('Supplier', UI.select('contactId', [['', data.vendor_name ? `+ Create "${data.vendor_name}"` : 'Select…'], ...UI.contactOptions('supplier').slice(1)], supplier ? supplier.id : ''))}
        ${UI.field('Supplier name (if new)', UI.input('vendor', data.vendor_name || ''))}
        ${UI.field('Document no.', UI.input('ref', data.document_number || ''))}
        ${UI.field('Date', UI.input('date', data.date || U.today(), 'type="date"'))}
        ${UI.field('Due date', UI.input('due', data.due_date || '', 'type="date"'))}
        ${DB.data.currencies.length > 1 ? UI.field('Currency', UI.select('currency', UI.currencyOptions(), (data.currency || DB.data.settings.baseCurrency).toUpperCase())) : ''}
        ${UI.field('Expense account', UI.select('accountId', UI.glOptions(['cogs', 'expense', 'asset'], '(default)'), ''))}
        ${UI.field('Paid from (for withdrawals)', UI.select('bank', UI.accountOptions('—'), DB.data.bankAccounts[0]?.id || ''))}
      </div>
      <div class="table-wrap mt"><table class="lines-table"><thead><tr><th>${E(t('Description'))}</th><th class="num">${E(t('Qty'))}</th><th class="num">Unit price</th><th>${E(t('Tax'))}</th><th></th></tr></thead><tbody id="sl">
        ${(data.line_items.length ? data.line_items : [{ description: '', quantity: 1 }]).map((l, i) => `<tr data-i="${i}"><td><input data-f="description" value="${E(l.description || '')}"></td><td><input data-f="quantity" type="number" step="any" class="right" value="${E(l.quantity ?? 1)}" style="width:80px"></td><td><input data-f="unit_price" type="number" step="0.01" class="right" value="${E(l.unit_price ?? (l.amount != null && l.quantity ? U.r2(l.amount / l.quantity) : l.amount ?? ''))}" style="width:110px"></td><td>${UI.select('', UI.taxOptions('purchase'), taxFor(l.tax_rate), 'data-f="taxCodeId"')}</td><td><button type="button" class="btn link" data-rm>✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="btn-row mt"><button type="button" class="btn sm" id="addl">+ Line</button><div style="flex:1"></div><span class="muted small" id="tot"></span></div>
      ${data.total != null && data.total !== '' ? `<p class="small muted">Total printed on document: <b>${U.amt(data.total)}</b>${data.tax_total ? ` (tax ${U.amt(data.tax_total)})` : ''} — compare with the calculated total above.</p>` : ''}
      <div class="btn-row mt" style="justify-content:flex-end"><button class="btn primary">Create</button></div></form>`;
    const f = $('#sf', el);
    const lines = () => $$('#sl tr', el).map(tr => ({ description: $('[data-f=description]', tr).value.trim(), qty: U.num($('[data-f=quantity]', tr).value) || 1, price: U.num($('[data-f=unit_price]', tr).value), taxCodeId: $('[data-f=taxCodeId]', tr).value }));
    const tot = () => { const ls = lines(); $('#tot', el).textContent = 'Calculated total: ' + U.amt(C.total({ lines: ls.map(l => ({ ...l, discount: 0 })) })); };
    f.addEventListener('input', tot); f.addEventListener('change', tot);
    $('#sl', el).addEventListener('click', e => { if (e.target.closest('[data-rm]') && $$('#sl tr', el).length > 1) { e.target.closest('tr').remove(); tot(); } });
    $('#addl', el).onclick = () => { data.line_items = lines().map(l => ({ description: l.description, quantity: l.qty, unit_price: l.price, tax_rate: C.taxRate(l.taxCodeId) })); data.line_items.push({ description: '', quantity: 1 }); syncHeader(); drawResult(); };
    const syncHeader = () => { const v = UI.formValues(f); Object.assign(data, { vendor_name: v.vendor, document_number: v.ref, date: v.date, due_date: v.due }); };
    tot();
    f.onsubmit = e => {
      e.preventDefault();
      try {
        const v = UI.formValues(f);
        const ls = lines().filter(l => l.description || l.price);
        if (!ls.length) throw new Error('Add at least one line');
        let contactId = v.contactId;
        if (!contactId && v.vendor) contactId = DB.upsert('contacts', { type: 'supplier', entity: 'business', name: v.vendor, regNo: data.vendor_registration_no || '', terms: DB.data.settings.paymentTerms }, 'Contact').id;
        if (v.as === 'out') {
          if (!v.bank) throw new Error('Choose the bank / cash account it was paid from');
          const total = C.total({ lines: ls.map(l => ({ ...l, discount: 0 })) });
          const taxIds = [...new Set(ls.map(l => l.taxCodeId).filter(Boolean))];
          const tx = DB.upsert('transactions', { number: DB.takeNumber('TXN', DB.peekNumber('TXN')), date: v.date || U.today(), bankAccountId: v.bank, type: 'out', amount: total, accountId: v.accountId || C.sys('otherExpense'), taxCodeId: taxIds.length === 1 ? taxIds[0] : '', contactId: contactId || '', ref: v.ref, description: ls.map(l => l.description).join('; ').slice(0, 200) }, 'Withdrawal');
          UI.toast(`Withdrawal of ${U.money(total)} recorded`, 'ok');
          location.hash = '#/transactions?acc=' + tx.bankAccountId;
          return;
        }
        if (!contactId) throw new Error('Choose or name the supplier');
        const type = v.as;
        const doc = newDoc(type, {});
        Object.assign(doc, {
          contactId, ref: v.ref, date: v.date || U.today(), currency: v.currency || DB.data.settings.baseCurrency,
          lines: ls.map(l => ({ productId: '', description: l.description, qty: l.qty, price: l.price, discount: 0, taxCodeId: l.taxCodeId, accountId: v.accountId || '', uom: '', factor: 1 })),
          notes: 'Created by A.I Scan',
        });
        const cur = DB.data.currencies.find(c => c.code === doc.currency);
        doc.rate = C.isBase(doc.currency) ? 1 : (cur ? cur.rate : 1);
        doc.dueDate = v.due || defaultDue(doc);
        DB.takeNumber(C.prefix(type), doc.number);
        DB.upsert('docs', doc, DOC_TYPES[type].label);
        UI.toast(`${DOC_TYPES[type].label} ${doc.number} created — please review`, 'ok');
        location.hash = '#/doc/' + doc.id + '/edit';
      } catch (err) { UI.toast(err.message, 'err'); }
    };
  };
  const load = async f => {
    try {
      $('#status', el).textContent = '';
      file = f.type === 'application/pdf' ? await scanPreparePdf(f) : await scanPrepareImage(f);
      $('#preview', el).innerHTML = file.mediaType === 'application/pdf' ? `<iframe src="${file.url}" style="width:100%;height:520px;border:1px solid var(--border);border-radius:6px"></iframe>` : `<img src="${file.url}" alt="receipt">`;
      $('#scan', el).disabled = false;
      $('#scan', el).click();
    } catch (err) { UI.toast(err.message, 'err'); }
  };
  $('#file', el).onchange = e => { if (e.target.files[0]) load(e.target.files[0]); };
  const drop = $('#drop', el);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  $('#scan', el).onclick = async () => {
    if (!file) return;
    const b = $('#scan', el), st = $('#status', el);
    b.disabled = true; st.textContent = hasKey ? 'Reading document… this can take up to a minute.' : 'Reading text… the first time takes longer while the free engine downloads.';
    try {
      const r = hasKey ? await scanWithClaude(file) : await OCR.read(file);
      // a tax rate with no matching purchase tax code (e.g. 6% service tax) stays inside the cost
      (r.line_items || []).forEach(l => { if (U.num(l.tax_rate) && !DB.data.taxSettings.codes.some(x => U.num(x.rate) === U.num(l.tax_rate) && x.type !== 'sales') && l.unit_price != null) { l.unit_price = U.r2(l.unit_price * (1 + U.num(l.tax_rate) / 100)); l.tax_rate = 0; } });
      data = Object.assign(data, r, { line_items: r.line_items && r.line_items.length ? r.line_items : data.line_items });
      DB.log('Scanned', 'A.I Scan', r.document_number || r.vendor_name || 'document');
      DB.save();
      st.textContent = hasKey ? '✔ Done — review the details on the right.' : '✔ Done — free text recognition fills in the main fields only; please check them.';
      drawResult();
    } catch (err) { st.textContent = ''; UI.toast(err.message, 'err'); }
    finally { b.disabled = false; }
  };
  drawResult();
});
