'use strict';
/* =========================================================================
   Claims: drop receipts into Google Drive › CFO System › Claims › <company>.
   The app picks them up, reads them with A.I Scan and lists them for
   approval. Nothing is posted to the books until you approve a claim.
   Approved claims become:
     - Expense claim  → a Bill owed to you (the claimant), paid back later
     - Company paid   → a Withdrawal from the chosen bank / cash account
     - Supplier bill  → a Bill owed to the merchant
   Needs the "Google Drive · automatic" sync helper (version 2 or newer).
   ========================================================================= */

const CLAIM_AS = [['claim', 'Expense claim — I paid, the company owes me'], ['out', 'Paid by the company (withdrawal)'], ['bill', 'Supplier bill — not paid yet']];
const CLAIM_STATUS = { scanning: ['Scanning…', 'blue'], pending: ['Waiting for approval', 'amber'], approved: ['Approved', 'green'], rejected: ['Rejected', 'red'] };

const Claims = {
  busy: false, last: 0,
  /** Claims need the automatic Google Drive helper. */
  ready() { return typeof Sync !== 'undefined' && Sync.connected() && provOf(Sync.cfg()) === 'gscript'; },
  call(body) {
    const s = DB.data.claimSettings;
    return GScript.call(Sync.cfg(), Object.assign({ company: DB.data.settings.company, folderId: s.folderId || '' }, body))
      .catch(e => { throw /Unknown action/.test(e.message) ? new Error('Your Google Drive helper is an older version. Update it once: Control Panel → Sync → Copy helper code → paste it over the old code in Apps Script → Save → Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy.') : e; });
  },
  pending() { return DB.data.claims.filter(c => c.status === 'pending' || c.status === 'scanning'); },

  /** Called after each successful sync: check the inbox about every 90 seconds. */
  auto() {
    if (!Claims.ready() || !DB.data.claimSettings.autoScan || Date.now() - Claims.last < 90000) return;
    Claims.check().catch(e => console.warn('Claims check skipped:', e.message));
  },

  /** Pick up new receipts from the Drive inbox and scan them. */
  async check(opts = {}) {
    if (!Claims.ready()) throw new Error('Connect "Google Drive · automatic" on the Sync page first (Control Panel → Sync).');
    if (Claims.busy) { if (opts.manual) UI.toast('Already checking the Claims folder…'); return 0; }
    Claims.busy = true; Claims.last = Date.now();
    const key = DB.key();
    let added = 0;
    try {
      const r = await Claims.call({ action: 'claims.inbox' });
      if (DB.key() !== key) return 0;
      const s = DB.data.claimSettings;
      if (s.folderId !== r.folderId || s.folderUrl !== r.folderUrl) { s.folderId = r.folderId; s.folderUrl = r.folderUrl; DB.save(); }
      for (const f of r.files) {
        if (DB.key() !== key) break;
        if (DB.data.claims.some(c => c.fileId === f.id)) continue;
        const tk = await Claims.call({ action: 'claims.take', id: f.id });
        if (!tk.taken || DB.key() !== key) continue;           // another device took it
        const c = { id: 'cl-' + f.id, number: DB.takeNumber('CLM', DB.peekNumber('CLM')), fileId: f.id, fileName: f.name, mime: f.mime, fileUrl: tk.url, receivedAt: new Date().toISOString(), status: 'scanning', device: Sync.device() };
        DB.upsert('claims', c, 'Claim');
        added++;
        rerenderClaims();
        await Claims.scan(c.id);
      }
      // receipts whose scan was interrupted (app closed) — try again after 10 minutes
      for (const c of DB.data.claims.filter(x => x.status === 'scanning' && Date.now() - new Date(x.receivedAt).getTime() > 600000)) {
        if (DB.key() !== key) break;
        await Claims.scan(c.id);
      }
      if (added) UI.toast(`${added} new receipt(s) scanned — waiting for your approval in Claims`, 'ok');
      else if (opts.manual) UI.toast('No new receipts in the Claims folder');
      return added;
    } finally { Claims.busy = false; rerenderClaims(); }
  },

  /** Read the receipt with A.I. Failures still leave the claim for approval (fill it in by hand). */
  async scan(id) {
    const key = DB.key();
    let c = DB.get('claims', id);
    if (!c) return;
    let data = null, error = '', note = '';
    try {
      const file = await Claims.prepared(c.fileId);
      if (DB.data.integrations.aiKey) {
        try { data = await scanWithClaude(file); } catch (e) { error = e.message; }
      }
      if (!data) {                         // no key, or A.I failed: free text recognition in the browser
        try {
          data = await OCR.read(file);
          note = (error ? `A.I Scan failed (${error}), so this` : 'This') + ' was read with free text recognition (no A.I key). Check every field — line items are not split.';
          error = '';
        } catch (e) { error = (error ? error + ' · ' : '') + e.message + ' — type the details in by hand.'; }
      }
      URL.revokeObjectURL(file.url);
    } catch (e) { error = e.message; }
    if (DB.key() !== key) return;
    c = DB.get('claims', id);
    if (!c || (c.status !== 'scanning' && c.status !== 'pending')) return;
    DB.upsert('claims', Object.assign({}, c, { status: 'pending', data: data || c.data || null, error, note, scannedAt: new Date().toISOString() }), 'Claim');
  },

  /** Download a receipt from Drive as a Blob. */
  async blob(fileId) {
    const f = await Claims.call({ action: 'claims.file', id: fileId });
    const bin = atob(f.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: f.mime });
  },
  async prepared(fileId) {
    const b = await Claims.blob(fileId);
    if (b.type === 'application/pdf') return scanPreparePdf(b);
    if (/heic|heif/i.test(b.type)) throw new Error('HEIC photos can\'t be read in the browser. On iPhone set Camera → Formats → Most Compatible, or save the photo as JPG.');
    return scanPrepareImage(b);
  },
  move(c, to) { return Claims.call({ action: 'claims.move', id: c.fileId, to }).catch(e => console.warn('Could not move receipt in Drive:', e.message)); },

  /** Photo taken in the app → into the Drive inbox, then scanned like any other receipt. */
  async upload(file) {
    const p = file.type === 'application/pdf' ? await scanPreparePdf(file) : await scanPrepareImage(file);
    URL.revokeObjectURL(p.url);
    const ext = p.mediaType === 'application/pdf' ? 'pdf' : 'jpg';
    const name = (file.name && !/^image\.\w+$/.test(file.name) ? file.name.replace(/\.\w+$/, '') : 'Receipt ' + U.today()) + '.' + ext;
    await Claims.call({ action: 'claims.upload', name, mime: p.mediaType, data: p.data });
  },
};

function rerenderClaims() { if (/^#\/claims/.test(location.hash) && !document.querySelector('.modal-back')) render(); }

/* ---------------- Duplicates & undo ---------------- */
/** Other (not rejected) claims that look like the same payment: same receipt no., or same printed total and same date / same merchant within a week. */
function claimDuplicates(c) {
  const key = x => {
    const d = x.data || {}, e = x.edited || {};
    return {
      ref: String(e.ref ?? d.document_number ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
      total: U.num(d.total ?? x.total), date: e.date || d.date || '',
      m: String(e.merchant ?? d.vendor_name ?? '').toLowerCase().replace(/\b(sdn|bhd|berhad|pbc|inc|ltd)\b/g, '').replace(/[^a-z0-9]/g, '').slice(0, 12),
    };
  };
  const a = key(c);
  const days = (p, q) => (p && q ? Math.abs(new Date(p) - new Date(q)) / 864e5 : 99);
  return DB.data.claims.filter(o => o.id !== c.id && o.status !== 'rejected').filter(o => {
    const b = key(o);
    if (a.ref.length >= 4 && a.ref === b.ref) return true;
    if (!a.total || Math.abs(a.total - b.total) > 0.005) return false;
    return (a.date && a.date === b.date) || (a.m.length >= 3 && a.m === b.m && days(a.date, b.date) <= 7);
  });
}

/** Approved by mistake: void the Bill (or delete the Withdrawal) it posted and reject or re-open the claim. */
function claimUndoModal(c) {
  const doc = c.docId && DB.get('docs', c.docId), tx = c.txId && DB.get('transactions', c.txId);
  if (doc && C.paymentsFor(doc).length) return UI.toast(`${doc.number} already has payments — delete those payments first.`, 'err');
  const what = doc ? `void ${doc.type === 'bill' ? 'Bill' : 'document'} <b>${E(doc.number)}</b>` : tx ? `delete Withdrawal <b>${E(tx.number)}</b>` : 'clear the approval';
  const dup = claimDuplicates(c)[0];
  UI.modal(`Undo claim ${c.number}`, `<p>This will ${what} (${E(U.money(c.total || 0))}) so it no longer counts in your books.</p>
    <div class="form-grid">
      ${UI.field('Then mark the claim as', UI.select('to', [['rejected', 'Rejected'], ['pending', 'Waiting for approval again']], 'rejected'))}
      ${UI.field('Reason', UI.input('reason', dup ? `Duplicate of ${dup.number}` : ''))}
    </div>`, {
    submitLabel: 'Undo approval',
    onSubmit: v => {
      if (doc) { doc.status = 'void'; DB.log('Voided', 'Bill', doc, 'Claim ' + c.number + ' undone'); }
      if (tx) DB.remove('transactions', tx.id, 'Withdrawal');
      const back = v.to === 'pending';
      const next = Object.assign({}, c, { status: back ? 'pending' : 'rejected', reason: back ? '' : v.reason, undoneAt: new Date().toISOString(), undoneBy: Auth.userName(), voidedNumber: c.postedNumber });
      ['docId', 'txId', 'postedNumber', 'postedAs', 'approvedAt', 'approvedBy'].forEach(k => delete next[k]);
      DB.upsert('claims', next, 'Claim');
      Claims.move(c, back ? 'Scanned' : 'Rejected');
      UI.toast(`Claim ${c.number} undone — ${c.postedNumber || 'entry'} ${doc ? 'voided' : 'removed'}`, 'ok');
      render();
    },
  });
}

/* ---------------- Approve / post ---------------- */
function claimPost(c, v, lines) {
  const s = DB.data.claimSettings;
  // foreign-currency receipt: post in the base currency at the rate entered on approval
  const base = DB.data.settings.baseCurrency;
  const cur = (v.currency || base).trim().toUpperCase();
  const origLines = lines;
  let fx = 1, fxNote = '';
  if (cur !== base) {
    fx = U.num(v.fx);
    if (!(fx > 0)) throw new Error(`Enter the exchange rate: 1 ${cur} = how many ${base}?`);
    fxNote = ` (${cur} ${U.amt(C.total({ lines: lines.map(l => ({ ...l, discount: 0 })) }))} @ ${fx})`;
    lines = lines.map(l => ({ ...l, price: U.r2(l.price * fx) }));
  }
  const total = C.total({ lines: lines.map(l => ({ ...l, discount: 0 })) });
  const merchant = v.merchant.trim();
  const memo = `Claim ${c.number}${merchant ? ' — ' + merchant : ''}${v.ref ? ' #' + v.ref : ''}${fxNote}`;
  let posted;
  if (v.as === 'out') {
    if (!v.bank) throw new Error('Choose the bank / cash account it was paid from');
    const taxIds = [...new Set(lines.map(l => l.taxCodeId).filter(Boolean))];
    const tx = DB.upsert('transactions', {
      number: DB.takeNumber('TXN', DB.peekNumber('TXN')), date: v.date || U.today(), bankAccountId: v.bank, type: 'out', amount: total,
      accountId: v.accountId || C.sys('otherExpense'), taxCodeId: taxIds.length === 1 ? taxIds[0] : '', contactId: v.supplierId || '',
      ref: v.ref, description: (memo + ': ' + lines.map(l => l.description).join('; ')).slice(0, 200), jobId: v.jobId || '', claimId: c.id,
    }, 'Withdrawal');
    s.bankId = v.bank;
    posted = { postedAs: 'out', txId: tx.id, postedNumber: tx.number };
  } else {
    let contactId;
    if (v.as === 'claim') {
      contactId = v.claimantId;
      if (!contactId) {
        if (!v.claimantName) throw new Error('Choose or type the claimant (the person who paid)');
        const same = DB.data.contacts.find(x => x.name.trim().toLowerCase() === v.claimantName.trim().toLowerCase());
        contactId = same ? same.id : DB.upsert('contacts', { type: 'supplier', entity: 'individual', name: v.claimantName, terms: 0, notes: 'Expense claims' }, 'Contact').id;
      }
      s.claimantId = contactId;
    } else {
      contactId = v.supplierId;
      if (!contactId) {
        if (!merchant) throw new Error('Choose or name the supplier');
        contactId = DB.upsert('contacts', { type: 'supplier', entity: 'business', name: merchant, regNo: (c.data && c.data.vendor_registration_no) || '', terms: DB.data.settings.paymentTerms }, 'Contact').id;
      }
    }
    const doc = newDoc('bill', {});
    Object.assign(doc, {
      contactId, date: v.date || U.today(), ref: v.as === 'claim' ? memo.slice(0, 80) : v.ref, jobId: v.jobId || '',
      lines: lines.map(l => ({ productId: '', description: l.description, qty: l.qty, price: l.price, discount: 0, taxCodeId: l.taxCodeId, accountId: v.accountId || '', uom: '', factor: 1 })),
      notes: `${v.as === 'claim' ? 'Expense claim' : 'Supplier bill'} ${c.number} — approved by ${Auth.userName()}. Receipt: ${c.fileUrl || c.fileName}`, claimId: c.id,
    });
    doc.dueDate = v.as === 'claim' ? doc.date : defaultDue(doc);
    DB.takeNumber(C.prefix('bill'), doc.number);
    DB.upsert('docs', doc, 'Bill');
    posted = { postedAs: v.as, docId: doc.id, postedNumber: doc.number };
  }
  s.postAs = v.as; s.accountId = v.accountId || '';
  DB.upsert('claims', Object.assign({}, c, posted, {
    status: 'approved', approvedAt: new Date().toISOString(), approvedBy: Auth.userName(), total,
    edited: { as: v.as, merchant, ref: v.ref, date: v.date, accountId: v.accountId, lines: origLines, currency: cur, fx },
  }), 'Claim');
  Claims.move(c, 'Approved');
  return posted;
}

function claimReviewModal(c) {
  const s = DB.data.claimSettings;
  const d = c.data || {};
  const ed = c.edited || {};
  const merchant = ed.merchant ?? d.vendor_name ?? '';
  const supplier = DB.data.contacts.find(x => merchant && x.type !== 'customer' && x.name.toLowerCase() === merchant.toLowerCase());
  const taxFor = rate => (DB.data.taxSettings.codes.find(x => U.num(x.rate) === U.num(rate) && x.type !== 'sales') || {}).id || '';
  const lines = ed.lines || (d.line_items && d.line_items.length ? d.line_items.map(l => {
      const unit = l.unit_price ?? (l.amount != null && l.quantity ? U.r2(l.amount / l.quantity) : l.amount ?? '');
      const tx = taxFor(l.tax_rate);
      // no matching purchase tax code (e.g. 6% service tax): keep the tax inside the cost so the total still matches
      return { description: l.description, qty: l.quantity ?? 1, price: !tx && U.num(l.tax_rate) && unit !== '' ? U.r2(U.num(unit) * (1 + U.num(l.tax_rate) / 100)) : unit, taxCodeId: tx };
    })
    : [{ description: merchant ? 'Purchase from ' + merchant : '', qty: 1, price: d.total ?? '', taxCodeId: '' }]);
  const defAs = ed.as || (d.document_type === 'invoice' && d.due_date ? 'bill' : s.postAs || 'claim');
  const claimant = C.contact(s.claimantId);
  const lineRow = l => `<tr><td><input data-f="description" value="${E(l.description || '')}"></td><td><input data-f="qty" type="number" step="any" class="right" value="${E(l.qty ?? 1)}" style="width:70px"></td><td><input data-f="price" type="number" step="0.01" class="right" value="${E(l.price ?? '')}" style="width:100px"></td><td>${UI.select('', UI.taxOptions('purchase'), l.taxCodeId || '', 'data-f="taxCodeId"')}</td><td><button type="button" class="btn link" data-rm>✕</button></td></tr>`;
  const locked = c.status === 'approved';
  const baseCur = DB.data.settings.baseCurrency;
  const recCur = String(ed.currency || d.currency || baseCur).toUpperCase();
  const body = `<div class="scan-wrap">
      <div><div class="scan-preview" id="cl-prev"><p class="muted small">Loading receipt from Google Drive…</p></div>
        ${c.fileUrl ? `<p class="small mt"><a href="${E(c.fileUrl)}" target="_blank" rel="noopener">Open in Google Drive ↗</a></p>` : ''}</div>
      <div>
        ${c.error ? `<div class="alert info">${E(c.error)}</div>` : ''}
        ${!locked && claimDuplicates(c).length ? `<div class="alert" style="background:var(--red-bg);color:var(--red)">⚠ Looks like the same payment as ${claimDuplicates(c).map(o => `<b>${E(o.number)}</b> (${E(t((CLAIM_STATUS[o.status] || [o.status])[0]))})`).join(', ')} — an invoice and its receipt are one payment. Reject this one if it's a duplicate.</div>` : ''}
        ${c.note && !locked ? `<div class="alert info">🔍 ${E(c.note)}</div>` : ''}
        ${locked ? `<div class="alert info">Approved by ${E(c.approvedBy || '')} on ${E(U.fdatetime(c.approvedAt))} → ${E(c.postedNumber || '')}</div>` : ''}
        <div class="form-grid">
          ${UI.field('Post as', UI.select('as', CLAIM_AS, defAs, 'id="cl-as"'), 'full')}
          ${UI.field('Claimant (who paid)', UI.select('claimantId', [['', '+ New claimant (type the name) …'], ...UI.contactOptions(null).slice(1)], claimant ? claimant.id : '', 'id="cl-who"'), 'cl-claim')}
          ${UI.field('New claimant name', UI.input('claimantName', '', 'placeholder="Full name of the person who paid"'), 'cl-claim cl-newwho')}
          ${UI.field('Merchant / supplier', UI.input('merchant', merchant))}
          ${UI.field('Supplier contact', UI.select('supplierId', [['', '+ Create from merchant name'], ...UI.contactOptions('supplier').slice(1)], supplier ? supplier.id : ''), 'cl-sup')}
          ${UI.field('Receipt / invoice no.', UI.input('ref', ed.ref ?? d.document_number ?? ''))}
          ${UI.field('Receipt currency', UI.input('currency', recCur, 'id="cl-cur" maxlength="3" style="text-transform:uppercase"'))}
          ${UI.field(`Exchange rate (1 ${recCur} = ? ${baseCur})`, UI.input('fx', recCur === baseCur ? '' : (ed.fx || (DB.data.currencies.find(x => x.code === recCur) || {}).rate || ''), 'id="cl-fx" type="number" step="any"'), 'cl-fx')}
          ${UI.field('Date', UI.input('date', ed.date || d.date || U.today(), 'type="date"'))}
          ${UI.field('Expense account', UI.select('accountId', UI.glOptions(['expense', 'cogs', 'asset'], '(default)'), ed.accountId ?? (s.accountId || C.sys('otherExpense'))))}
          ${UI.field('Paid from', UI.select('bank', UI.accountOptions('—'), s.bankId || DB.data.bankAccounts[0]?.id || ''), 'cl-out')}
          ${DB.data.jobs.length ? UI.field('Job', UI.select('jobId', [['', '—'], ...DB.data.jobs.map(j => [j.id, `${j.code} · ${j.name}`])], '')) : ''}
        </div>
        <div class="table-wrap mt"><table class="lines-table"><thead><tr><th>${E(t('Description'))}</th><th class="num">${E(t('Qty'))}</th><th class="num">Unit price</th><th>${E(t('Tax'))}</th><th></th></tr></thead>
          <tbody id="cl-lines">${lines.map(lineRow).join('')}</tbody></table></div>
        <div class="btn-row mt"><button type="button" class="btn sm" id="cl-add">+ Line</button><div style="flex:1"></div><b id="cl-tot"></b></div>
        ${d.total != null ? `<p class="small muted">Total printed on the receipt: <b>${U.amt(d.total)}</b>${d.tax_total ? ` (tax ${U.amt(d.tax_total)})` : ''}${d.currency && d.currency !== DB.data.settings.baseCurrency ? ` · ${E(d.currency)}` : ''}</p>` : ''}
        <p class="small" id="cl-warn" style="color:var(--red)"></p>
        <div class="btn-row mt">${locked ? '' : `<button type="button" class="btn" id="cl-reject">✕ Reject</button>`}${!locked && DB.data.integrations.aiKey ? `<button type="button" class="btn" id="cl-rescan">↻ Scan again</button>` : ''}</div>
      </div></div>`;
  const getLines = root => $$('#cl-lines tr', root).map(tr => ({ description: $('[data-f=description]', tr).value.trim(), qty: U.num($('[data-f=qty]', tr).value) || 1, price: U.num($('[data-f=price]', tr).value), taxCodeId: $('[data-f=taxCodeId]', tr).value })).filter(l => l.description || l.price);
  let url = null;
  const m = UI.modal(`Claim ${c.number}`, body, {
    wide: true, submitLabel: locked ? 'Close' : '✔ Approve & post',
    onSubmit: locked ? () => true : (v, form) => {
      const ls = getLines(form);
      if (!ls.length) throw new Error('Add at least one line with an amount');
      const p = claimPost(c, v, ls);
      UI.toast(`Claim ${c.number} approved → ${p.postedNumber}`, 'ok');
      if (url) URL.revokeObjectURL(url);
      render();
    },
    onMount(back) {
      const f = $('form', back);
      $('.modal', back).style.maxWidth = '1100px';
      if (locked) $$('input,select', f).forEach(i => { i.disabled = true; });
      const show = () => {
        const as = $('#cl-as', back).value;
        $$('.cl-claim', back).forEach(x => { x.style.display = as === 'claim' ? '' : 'none'; });
        $$('.cl-sup', back).forEach(x => { x.style.display = as === 'claim' ? 'none' : ''; });
        $$('.cl-out', back).forEach(x => { x.style.display = as === 'out' ? '' : 'none'; });
        // the name box is only for a new claimant, so it can never be ignored
        $$('.cl-newwho', back).forEach(x => { x.style.display = as === 'claim' && !$('#cl-who', back).value ? '' : 'none'; });
      };
      const tot = () => {
        const total = C.total({ lines: getLines(f).map(l => ({ ...l, discount: 0 })) });
        const cur = ($('#cl-cur', back).value || baseCur).trim().toUpperCase(), fx = U.num($('#cl-fx', back).value);
        $$('.cl-fx', back).forEach(x => { x.style.display = cur === baseCur ? 'none' : ''; });
        $('#cl-tot', back).textContent = cur === baseCur ? 'Total ' + U.money(total) : `Total ${cur} ${U.amt(total)}${fx > 0 ? ' = ' + U.money(U.r2(total * fx)) : ' — enter the exchange rate'}`;
        $('#cl-warn', back).textContent = d.total != null && Math.abs(U.num(d.total) - total) > 0.05 ? `⚠ Differs from the printed total by ${U.amt(U.r2(total - U.num(d.total)))} — check the lines and tax.` : '';
      };
      show(); tot();
      $('#cl-as', back).onchange = show;
      $('#cl-who', back).addEventListener('change', show);
      f.addEventListener('input', tot); f.addEventListener('change', tot);
      $('#cl-lines', back).addEventListener('click', e => { if (e.target.closest('[data-rm]') && $$('#cl-lines tr', back).length > 1) { e.target.closest('tr').remove(); tot(); } });
      $('#cl-add', back).onclick = () => { $('#cl-lines', back).insertAdjacentHTML('beforeend', lineRow({ qty: 1 })); };
      const rej = $('#cl-reject', back);
      if (rej) rej.onclick = () => {
        UI.modal('Reject claim', UI.field('Reason (optional)', UI.input('reason', '')), {
          submitLabel: 'Reject', onSubmit: v => {
            DB.upsert('claims', Object.assign({}, c, { status: 'rejected', rejectedAt: new Date().toISOString(), rejectedBy: Auth.userName(), reason: v.reason }), 'Claim');
            Claims.move(c, 'Rejected');
            m.close(); UI.toast(`Claim ${c.number} rejected`); render();
          },
        });
      };
      const rs = $('#cl-rescan', back);
      if (rs) rs.onclick = async () => {
        rs.disabled = true; rs.textContent = 'Scanning…';
        DB.upsert('claims', Object.assign({}, c, { status: 'scanning', edited: null }), 'Claim');
        await Claims.scan(c.id);
        m.close(); claimReviewModal(DB.get('claims', c.id));
      };
      Claims.blob(c.fileId).then(b => {
        url = URL.createObjectURL(b);
        const p = $('#cl-prev', back);
        if (p) p.innerHTML = b.type === 'application/pdf' ? `<iframe src="${url}" style="width:100%;height:560px;border:1px solid var(--border);border-radius:6px"></iframe>` : `<img src="${url}" alt="receipt">`;
      }).catch(e => { const p = $('#cl-prev', back); if (p) p.innerHTML = `<p class="muted small">Could not load the receipt: ${E(e.message)}</p>`; });
    },
  });
}

function claimSettingsModal() {
  const s = DB.data.claimSettings;
  UI.modal('Claim settings', `<div class="form-grid">
      ${UI.field('Default "Post as"', UI.select('postAs', CLAIM_AS, s.postAs), 'full')}
      ${UI.field('Claimant (who is paid back)', UI.select('claimantId', UI.contactOptions(null, '—'), s.claimantId))}
      ${UI.field('Default expense account', UI.select('accountId', UI.glOptions(['expense', 'cogs', 'asset'], '(default)'), s.accountId))}
      ${UI.field('Default bank / cash account', UI.select('bankId', UI.accountOptions('—'), s.bankId))}
      <div class="field full">${UI.check('autoScan', 'Check the Claims folder automatically (about every 2 minutes while the app is open)', s.autoScan)}</div>
    </div>`, {
    onSubmit: v => { Object.assign(s, { postAs: v.postAs, claimantId: v.claimantId, accountId: v.accountId, bankId: v.bankId, autoScan: v.autoScan }); DB.log('Updated', 'Claim settings', 'Claims'); DB.save(); render(); },
  });
}

/* ---------------- Page ---------------- */
route('/claims', (el, q) => {
  const tab = q.tab || 'pending';
  const s = DB.data.claimSettings;
  const all = DB.data.claims.slice().sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
  const rows = tab === 'all' ? all : all.filter(c => tab === 'pending' ? (c.status === 'pending' || c.status === 'scanning') : c.status === tab);
  const ready = Claims.ready();
  const count = st => all.filter(c => st === 'pending' ? (c.status === 'pending' || c.status === 'scanning') : c.status === st).length;
  const total = c => c.total ?? (c.data && c.data.total);
  el.innerHTML = `${UI.pageHead('Claims', null, `
      ${ready ? `<label class="btn" title="Take a photo or choose a file">📷 Add receipt<input type="file" id="cl-file" accept="image/*,application/pdf" capture="environment" hidden></label>` : ''}
      ${s.folderUrl ? `<a class="btn" href="${E(s.folderUrl)}" target="_blank" rel="noopener">📁 Open Claims folder</a>` : ''}
      <button class="btn" id="cl-set">⚙ Settings</button>
      <button class="btn primary" id="cl-check" ${ready ? '' : 'disabled'}>↻ Check folder now</button>`)}
    ${ready ? `<div class="alert info">Put receipts (photo or PDF) in <b>Google Drive › CFO System › Claims › ${E(DB.data.settings.company)}</b>, or tap <b>📷 Add receipt</b>. The app reads each one with A.I and lists it here. <b>Nothing is posted to your books until you approve it.</b>${DB.data.integrations.aiKey ? '' : ' <br>No Anthropic API key yet, so receipts are read with <b>free text recognition</b> (merchant, date, tax and total only — check each one). Add a key in <a href="#/control/apps">Integrated Apps</a> for full A.I reading.'}</div>`
      : `<div class="alert info">Claims need the <b>Google Drive · automatic</b> connection. Set it up in <a href="#/control/sync">Control Panel → Sync (PC &amp; phone)</a>.</div>`}
    <div class="tabs">${[['pending', 'Waiting for approval'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']].map(([k, l]) => `<a href="#/claims?tab=${k}" class="${tab === k ? 'active' : ''}">${E(t(l))}${k !== 'all' ? ` (${count(k)})` : ''}</a>`).join('')}</div>
    ${UI.table([
      { label: 'No.', render: c => E(c.number) },
      { label: 'Received', render: c => E(U.fdatetime(c.receivedAt)) },
      { label: 'Merchant', render: c => E((c.edited && c.edited.merchant) || (c.data && c.data.vendor_name) || c.fileName || '') },
      { label: 'Receipt date', render: c => E(U.fdate ? U.fdate((c.edited && c.edited.date) || (c.data && c.data.date) || '') : ((c.data && c.data.date) || '')) },
      { label: 'Amount', cls: 'num', render: c => total(c) != null ? U.amt(total(c)) : '' },
      { label: 'Status', render: c => { const [l, k] = CLAIM_STATUS[c.status] || [c.status, '']; const dup = c.status !== 'rejected' && c.status !== 'scanning' ? claimDuplicates(c) : []; return `<span class="badge ${k}">${E(t(l))}</span>${c.error && c.status === 'pending' ? ' <span title="' + E(c.error) + '">⚠</span>' : ''}${dup.length ? ` <span class="badge red" title="Same payment as ${E(dup.map(o => o.number).join(', '))}">Possible duplicate of ${E(dup.map(o => o.number).join(', '))}</span>` : ''}`; } },
      { label: 'Posted to', render: c => c.docId ? `<a href="#/doc/${E(c.docId)}">${E(c.postedNumber)}</a>` : c.txId ? `<a href="#/transactions">${E(c.postedNumber)}</a>` : c.reason ? `<span class="small muted">${E(c.reason)}</span>` : '' },
      { label: '', render: c => c.status === 'scanning' ? '' : `<button class="btn sm ${c.status === 'pending' ? 'primary' : ''}" data-review="${E(c.id)}">${c.status === 'pending' ? 'Review' : 'View'}</button>${c.status === 'rejected' ? ` <button class="btn sm" data-reopen="${E(c.id)}">Reopen</button>` : ''}${c.status === 'approved' ? ` <button class="btn sm" data-undo="${E(c.id)}">Undo</button>` : ''}` },
    ], rows, { empty: tab === 'pending' ? 'No claims waiting for approval.' : 'No claims yet.' })}`;
  $$('[data-review]', el).forEach(b => b.onclick = () => claimReviewModal(DB.get('claims', b.dataset.review)));
  $$('[data-undo]', el).forEach(b => b.onclick = () => claimUndoModal(DB.get('claims', b.dataset.undo)));
  $$('[data-reopen]', el).forEach(b => b.onclick = () => {
    const c = DB.get('claims', b.dataset.reopen);
    DB.upsert('claims', Object.assign({}, c, { status: 'pending', reason: '' }), 'Claim');
    Claims.move(c, 'Scanned'); render();
  });
  $('#cl-set', el).onclick = claimSettingsModal;
  const chk = $('#cl-check', el);
  chk.onclick = async () => {
    chk.disabled = true; chk.textContent = 'Checking…';
    try { await Claims.check({ manual: true }); } catch (e) { UI.toast(e.message, 'err'); }
    finally { render(); }
  };
  const fi = $('#cl-file', el);
  if (fi) fi.onchange = async () => {
    const f = fi.files[0];
    if (!f) return;
    UI.toast('Uploading receipt to Google Drive…');
    try { await Claims.upload(f); await Claims.check({ manual: false }); }
    catch (e) { UI.toast(e.message, 'err'); }
    finally { render(); }
  };
});
