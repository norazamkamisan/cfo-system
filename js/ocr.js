'use strict';
/* =========================================================================
   Free text recognition (no API key): reads the receipt in the browser with
   Tesseract.js (photos / scanned PDFs) or pdf.js (PDFs that contain text),
   then picks out merchant, date, receipt no., tax and total with simple
   rules. Less accurate than A.I Scan: it doesn't split line items, and every
   field should be checked before approval.
   The engines download once from a CDN (internet needed the first time).
   ========================================================================= */

const OCR = {
  libs: {},
  TESSERACT: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  PDFJS: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  PDFJS_WORKER: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',

  load(src, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (!OCR.libs[src]) {
      OCR.libs[src] = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = () => res(window[globalName]);
        s.onerror = () => { delete OCR.libs[src]; s.remove(); rej(new Error('Could not load the free text-recognition engine — check the internet connection.')); };
        document.head.appendChild(s);
      });
    }
    return OCR.libs[src];
  },

  async recognize(image) {
    const T = await OCR.load(OCR.TESSERACT, 'Tesseract');
    const w = await T.createWorker('eng');
    try { return (await w.recognize(image)).data.text || ''; } finally { await w.terminate(); }
  },

  /** PDF text items → lines (group by baseline, left to right). */
  pdfLines(items) {
    const rows = [];
    items.filter(i => i.str && i.str.trim()).forEach(i => {
      const y = i.transform[5], x = i.transform[4];
      let r = rows.find(r => Math.abs(r.y - y) < 3);
      if (!r) { r = { y, parts: [] }; rows.push(r); }
      r.parts.push({ x, s: i.str });
    });
    return rows.sort((a, b) => b.y - a.y).map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.s).join(' ')).join('\n');
  },

  /** file = { mediaType, data (base64) } as made by scanPrepareImage / scanPreparePdf. */
  async text(file) {
    if (file.mediaType !== 'application/pdf') return OCR.recognize(`data:${file.mediaType};base64,${file.data}`);
    const pdfjs = await OCR.load(OCR.PDFJS, 'pdfjsLib');
    pdfjs.GlobalWorkerOptions.workerSrc = OCR.PDFJS_WORKER;
    const bin = atob(file.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    let text = '';
    for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) text += OCR.pdfLines((await (await pdf.getPage(p)).getTextContent()).items) + '\n';
    if (text.replace(/\s/g, '').length >= 30) return text;
    // scanned PDF (picture only): render the first page and read it
    const page = await pdf.getPage(1), vp = page.getViewport({ scale: 2 });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return OCR.recognize(cv);
  },

  /** Same shape as the A.I Scan result, so the rest of the app treats it alike. */
  async read(file) {
    const text = await OCR.text(file);
    if (text.replace(/\s/g, '').length < 10) throw new Error('No readable text found — try a sharper, well-lit photo.');
    return OCR.parse(text);
  },

  /* ---------------- rules ---------------- */
  amounts(line) {
    const re = /(?:^|[^\d.,])(-?\d{1,3}(?:,\d{3})+\.\d{2}|-?\d+[.,]\d{2})(?![\d,]*\d)/g;
    return [...line.matchAll(re)].map(m => parseFloat(m[1].replace(/,(?=\d{3}\b)/g, '').replace(',', '.'))).filter(n => isFinite(n));
  },
  date(line) {
    const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, ogo: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dis: 12 };
    const ok = (y, m, d) => {
      y = +y; m = +m; d = +d;
      if (y < 100) y += 2000;
      if (y < 2000 || y > 2099 || m < 1 || m > 12 || d < 1 || d > 31) return null;
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    let m = line.match(/\b(20\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/);
    if (m && ok(m[1], m[2], m[3])) return ok(m[1], m[2], m[3]);
    m = line.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
    if (m) {                                   // Malaysia writes day first
      const r = ok(m[3], m[2], m[1]) || ok(m[3], m[1], m[2]);
      if (r) return r;
    }
    m = line.match(/\b(\d{1,2})[\s\-]*(jan|feb|mar|apr|may|mei|jun|jul|aug|ogo|sep|oct|okt|nov|dec|dis)[a-z]*[\s\-,]*(\d{2,4})\b/i);
    if (m) return ok(m[3], MON[m[2].toLowerCase()], m[1]);
    m = line.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i);
    if (m) return ok(m[3], MON[m[1].toLowerCase()], m[2]);
    return null;
  },

  parse(raw) {
    const lines = String(raw).split(/\r?\n/).map(l => l.replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const payLine = /\b(cash|tunai|change|baki|tender|tendered|bayaran|rounding|pembundaran|visa|master\s*card|debit|credit\s*card|e-?wallet|tng|grabpay|boost|duitnow|you\s*save|discount|diskaun)\b/i;
    const subLine = /sub\s*-?\s*total|jumlah\s*kecil/i;
    const taxLine = /\b(sst|service\s*tax|sales\s*tax|gst|tax|cukai)\b/i;
    const notTax = /tax\s*invoice|invois|reg|no\b|id\b|incl|inclusive|termasuk|exempt|tin\b|before\s*tax|excl/i;
    const totalStrong = /grand\s*total|jumlah\s*besar|net\s*total|amount\s*due|total\s*amount|total\s*payable|jumlah\s*bersih|jumlah\s*perlu\s*dibayar|total\s*\(?(?:rm|myr)\)?/i;
    const totalWeak = /\btotal\b|\bjumlah\b|\bamount\b/i;
    const totalNot = /sub\s*-?\s*total|total\s*(qty|quantity|items?|disc\w*|savings?|tax|sst|gst|excl\w*)|items?\s*total|no\.?\s*of/i;

    let best = null, subtotal = null, tax = null, rate = null;
    lines.forEach((l, i) => {
      const am = OCR.amounts(l);
      const nextAm = () => (lines[i + 1] ? OCR.amounts(lines[i + 1]) : []);
      if (subLine.test(l)) { const a = am.length ? am : nextAm(); if (a.length) subtotal = a[a.length - 1]; return; }
      if (taxLine.test(l) && !notTax.test(l) && !totalStrong.test(l)) {
        const a = am.length ? am : nextAm();
        const r = l.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
        if (r) rate = parseFloat(r[1]);
        const v = a.filter(x => !r || x !== parseFloat(r[1]));
        if (v.length) tax = v[v.length - 1];
        return;
      }
      if (payLine.test(l) && !totalStrong.test(l)) return;
      const score = totalStrong.test(l) ? 3 : totalWeak.test(l) && !totalNot.test(l) ? 2 : 0;
      if (!score) return;
      const a = am.length ? am : nextAm();
      if (!a.length) return;
      const v = Math.max(...a);
      if (!best || score > best.score || (score === best.score && v >= best.v)) best = { score, v };
    });
    let total = best ? best.v : null;
    if (total == null) {                                  // fall back to the largest amount not on a payment line
      const all = lines.filter(l => !payLine.test(l)).flatMap(l => OCR.amounts(l));
      if (all.length) total = Math.max(...all);
    }
    if (tax != null && total != null && tax >= total) tax = null;
    if (rate == null && tax && total) {
      const net = subtotal || total - tax;
      const guess = Math.round(tax / net * 100);
      if ([5, 6, 8, 10].includes(guess)) rate = guess;
    }

    let date = null;
    for (const l of lines) { date = OCR.date(l); if (date) break; }

    let number = null;
    const noise = /\b(reg|sst|gst|tel|phone|fax|tin|co\.?\s*no|company|roc|ssm|table|meja|pax|cashier|juruwang|terminal|pos\s*id)\b/i;
    for (const l of lines) {
      if (noise.test(l)) continue;
      const m = l.match(/\b(?:invoice|inv|receipt|rcpt|resit|bill|doc(?:ument)?|ref(?:erence)?|trans(?:action)?|order|cheque|slip)\s*(?:no\.?|number|num|#)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-/]{2,})/i);
      if (m && /\d/.test(m[1])) { number = m[1]; break; }
      const s = l.match(/\b((?:INV|RCP|RCPT|RC|OR|CS|BL|SI|TI)[-/]?\d{3,}[A-Z0-9\-/]*)\b/i);
      if (s) { number = s[1]; break; }
    }

    let reg = null;
    for (const l of lines) {
      const m = l.match(/\b(20\d{10})\b/) || l.match(/\b(\d{4,8}-[A-Z])\b/) || l.match(/\b([A-Z]\d{2}-\d{4}-\d{8})\b/);
      if (m) { reg = m[1]; break; }
    }

    const head = /^(receipt|resit|official receipt|tax invoice|invoice|invois|cash bill|bill|welcome|selamat datang|thank|terima kasih|copy|duplicate|customer copy)\b/i;
    const top = lines.slice(0, 8).filter(l => !head.test(l) && !/@|www\.|https?:|tel|fax|^\W*$/i.test(l) && !OCR.amounts(l).length && !OCR.date(l));
    const letters = l => (l.match(/[A-Za-z]/g) || []).length;
    const named = top.find(l => /\b(sdn\.?\s*bhd|bhd|berhad|plt|enterprise|trading|restoran|restaurant|cafe|kedai|mart|store|station|hardware|pharmacy|farmasi|hotel|services?)\b/i.test(l));
    const merchant = named || top.find(l => letters(l) >= 3 && letters(l) / l.replace(/\s/g, '').length > 0.6) || null;

    const type = lines.some(l => /credit\s*note|nota\s*kredit/i.test(l)) ? 'credit_note' : lines.some(l => /\binvoice\b|\binvois\b/i.test(l)) ? 'invoice' : 'receipt';
    const net = total != null ? (subtotal != null && tax != null && Math.abs(subtotal + tax - total) < 0.06 ? subtotal : tax != null ? Math.round((total - tax) * 100) / 100 : total) : null;
    return {
      vendor_name: merchant, vendor_registration_no: reg, document_type: type, document_number: number,
      date, due_date: null, currency: /\b(RM|MYR)\b/i.test(raw) || total != null ? 'MYR' : null,
      subtotal, tax_total: tax, total,
      line_items: net != null ? [{ description: merchant ? 'Purchase — ' + merchant : 'Purchase', quantity: 1, unit_price: net, tax_rate: tax ? rate : 0, amount: net }] : [],
      _ocr: true,
    };
  },
};
