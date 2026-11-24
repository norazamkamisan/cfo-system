'use strict';
/* =========================================================================
   UI helpers: modal, toast, tables, form controls, flow diagrams, charts
   ========================================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const E = U.esc;

const UI = {
  toast(msg, kind = '') {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  },

  /** Open a modal. opts: { wide, submitLabel, onSubmit(values, form) -> false keeps it open, onMount(el), noCancel } */
  modal(title, body, opts = {}) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <form class="modal ${opts.wide ? 'wide' : ''}" novalidate>
        <div class="modal-head"><h2>${E(t(title))}</h2><button type="button" class="x" data-close>&times;</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">
          <button type="button" class="btn" data-close>${E(t(opts.onSubmit ? 'Cancel' : 'Close'))}</button>
          ${opts.onSubmit ? `<button type="submit" class="btn primary">${E(t(opts.submitLabel || 'Save'))}</button>` : ''}
        </div>
      </form>`;
    document.body.appendChild(back);
    const form = $('form', back);
    const close = () => { back.remove(); document.removeEventListener('keydown', esc); };
    const esc = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    $$('[data-close]', back).forEach(b => b.onclick = close);
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    form.onsubmit = async e => {
      e.preventDefault();
      if (!opts.onSubmit) return close();
      try {
        const r = await opts.onSubmit(UI.formValues(form), form);
        if (r !== false) close();
      } catch (err) { UI.toast(err.message, 'err'); }
    };
    if (opts.onMount) opts.onMount(back);
    const first = $('input:not([type=hidden]):not([readonly]):not([type=checkbox]), select, textarea', form);
    if (first) setTimeout(() => first.focus(), 30);
    return { el: back, close };
  },

  formValues(form) {
    const v = {};
    $$('input[name], select[name], textarea[name]', form).forEach(i => {
      if (!i.name) return;
      if (i.type === 'checkbox') v[i.name] = i.checked;
      else if (i.type === 'radio') { if (i.checked) v[i.name] = i.value; }
      else v[i.name] = i.value.trim();
    });
    return v;
  },

  field(label, input, cls = '') { return `<div class="field ${cls}"><label>${E(t(label))}</label>${input}</div>`; },
  input(name, value = '', attrs = '') { return `<input name="${name}" value="${E(value)}" ${attrs}>`; },
  textarea(name, value = '', attrs = '') { return `<textarea name="${name}" ${attrs}>${E(value)}</textarea>`; },
  check(name, label, checked) { return `<label class="check"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}> ${E(t(label))}</label>`; },
  opts(options, value) {
    return options.map(o => {
      if (o && o.group) return `<optgroup label="${E(o.group)}">${UI.opts(o.options, value)}</optgroup>`;
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${E(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${E(l)}</option>`;
    }).join('');
  },
  select(name, options, value = '', attrs = '') { return `<select ${name ? `name="${name}"` : ''} ${attrs}>${UI.opts(options, value)}</select>`; },
  contactOptions(type, blank = 'Select…') {
    return [['', blank], ...DB.data.contacts.filter(c => !type || c.type === type || c.type === 'both')
      .sort((a, b) => a.name.localeCompare(b.name)).map(c => [c.id, c.name])];
  },
  accountOptions(blank) {
    const o = DB.data.bankAccounts.map(a => [a.id, a.name]);
    return blank ? [['', blank], ...o] : o;
  },
  /** Chart-of-account options grouped by type. */
  glOptions(types, blank = '—') {
    const groups = Object.keys(ACCOUNT_TYPES).filter(k => !types || types.includes(k)).map(k => ({
      group: ACCOUNT_TYPES[k],
      options: DB.data.accounts.filter(a => a.type === k && a.active !== false).sort((a, b) => a.code.localeCompare(b.code)).map(a => [a.id, `${a.code} · ${a.name}`]),
    })).filter(g => g.options.length);
    return blank === null ? groups : [['', blank], ...groups];
  },
  taxOptions(side) {
    const ok = x => !side || x.type === 'both' || x.type === side;
    return [['', '—'], ...DB.data.taxSettings.codes.filter(ok).map(x => [x.id, `${x.code} (${x.rate}%)`])];
  },
  jobOptions(blank = '—') { return [['', blank], ...DB.data.jobs.filter(j => j.status !== 'closed').map(j => [j.id, `${j.code} · ${j.name}`])]; },
  locationOptions() { return DB.data.locations.map(l => [l.id, l.name]); },
  currencyOptions() { return DB.data.currencies.map(c => [c.code, `${c.code} — ${c.name}`]); },
  termsOptions() { return [['', '—'], ...DB.data.paymentTerms.map(p => [p.days, `${p.name} (${p.days} days)`])]; },

  badge(status) {
    const map = {
      paid: 'green', closed: 'green', converted: 'blue', accepted: 'green', reconciled: 'green', filed: 'green', active: 'green', ok: 'green',
      unpaid: 'amber', open: 'amber', partial: 'blue', overdue: 'red', void: '', declined: 'red', low: 'amber', out: 'red', expired: 'red',
    };
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return `<span class="badge ${map[status] || ''}">${E(t(label))}</span>`;
  },

  /** cols: [{ label, cls, render(row), csv(row) }]. opts: { empty, href(row), foot, id } */
  table(cols, rows, opts = {}) {
    const head = cols.map(c => `<th class="${c.cls || ''}">${E(t(c.label))}</th>`).join('');
    const body = rows.length ? rows.map(r => {
      const href = opts.href ? opts.href(r) : '';
      const cls = [href ? 'clickable' : '', opts.rowClass ? opts.rowClass(r) : ''].join(' ');
      return `<tr class="${cls}" ${href ? `data-href="${E(href)}"` : ''}>${cols.map(c => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}</tr>`;
    }).join('') : `<tr><td colspan="${cols.length}" class="empty">${E(opts.empty || 'No records yet.')}</td></tr>`;
    return `<div class="table-wrap"><table ${opts.id ? `id="${opts.id}"` : ''}><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${opts.foot ? `<tfoot>${opts.foot}</tfoot>` : ''}</table></div>`;
  },
  bindRowLinks(root) {
    $$('tr[data-href]', root).forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('a,button,input,select')) return;
      location.hash = tr.dataset.href;
    }));
  },
  /** Download every visible table on the page (or a given one) as CSV. */
  exportTables(root, name) {
    const rows = [];
    $$('table', root).forEach(tb => {
      $$('tr', tb).forEach(tr => {
        if (tr.style.display === 'none') return;
        rows.push($$('th,td', tr).filter(c => !c.classList.contains('no-print')).map(c => c.innerText.replace(/\s+/g, ' ').trim()));
      });
      rows.push([]);
    });
    U.download(`${name}-${U.today()}.csv`, '﻿' + U.csv(rows), 'text/csv');
  },

  pageHead(title, crumbs, actions = '') {
    const cr = crumbs ? `<div class="crumbs">${crumbs.map(([l, h]) => h ? `<a href="${h}">${E(t(l))}</a>` : E(t(l))).join(' / ')}</div>` : '';
    return `<div class="page-head"><div>${cr}<h1>${E(t(title))}</h1></div><div class="spacer"></div><div class="btn-row no-print">${actions}</div></div>`;
  },
  reportActions() { return `<button class="btn" data-export>${E(t('Export CSV'))}</button><button class="btn" onclick="window.print()">${E(t('Print'))}</button>`; },
  bindExport(root, name) { const b = $('[data-export]', root); if (b) b.onclick = () => UI.exportTables(root, name); },

  dateFilter(from, to, extra = '') {
    return `<div class="filters no-print">
      ${UI.field('From', `<input type="date" id="f-from" value="${E(from)}">`)}
      ${UI.field('To', `<input type="date" id="f-to" value="${E(to)}">`)}
      ${UI.field('Quick', UI.select('', [['', 'Custom'], ['tm', 'This month'], ['lm', 'Last month'], ['tq', 'Last 3 months'], ['fy', 'This financial year'], ['lfy', 'Last financial year'], ['all', 'All time']], '', 'id="f-quick"'))}
      ${extra}
    </div>`;
  },
  quickRange(k) {
    const d = U.today(), fy = U.fyStart(d);
    return {
      tm: [U.monthStart(d), U.monthEnd(d)],
      lm: [U.addMonths(d, -1), U.monthEnd(U.addMonths(d, -1))],
      tq: [U.addMonths(d, -2), U.monthEnd(d)],
      fy: [fy, U.addDays(U.addMonths(fy, 12), -1)],
      lfy: [U.addMonths(fy, -12), U.addDays(fy, -1)],
      all: ['', ''],
    }[k];
  },
  bindDateFilter(root, onChange) {
    const from = $('#f-from', root), to = $('#f-to', root), q = $('#f-quick', root);
    const fire = () => onChange(from.value, to.value);
    from.onchange = fire; to.onchange = fire;
    q.onchange = () => { const m = UI.quickRange(q.value); if (m) { from.value = m[0]; to.value = m[1]; fire(); } };
  },
  /** Build a hash with the current path and updated query values. */
  withQuery(q, changes) {
    const path = location.hash.slice(1).split('?')[0];
    const p = new URLSearchParams(Object.assign({}, q, changes));
    [...p.keys()].forEach(k => { if (p.get(k) === '' || p.get(k) === 'undefined') p.delete(k); });
    return '#' + path + (p.toString() ? '?' + p.toString() : '');
  },
  searchBox(placeholder = 'Search…') { return `<div class="field" style="flex:1;max-width:320px"><input class="row-search" placeholder="${E(t(placeholder))}"></div>`; },
  bindSearch(root) {
    $$('.row-search', root).forEach(s => s.oninput = e => {
      const v = e.target.value.toLowerCase();
      $$('tbody tr', root).forEach(tr => { tr.style.display = !v || tr.textContent.toLowerCase().includes(v) ? '' : 'none'; });
    });
  },

  /* ---------- Flow diagram ---------- */
  arrow(dir) {
    const paths = { right: 'M3 1 L13 8 L3 15 Z', left: 'M13 1 L3 8 L13 15 Z', down: 'M1 3 L15 3 L8 13 Z', up: 'M1 13 L15 13 L8 3 Z', downleft: 'M2 14 L2 3 L13 14 Z' };
    return `<svg viewBox="0 0 16 16"><path d="${paths[dir]}"/></svg>`;
  },
  flow(boxes, arrows, group) {
    let html = '';
    if (group) html += `<div class="group" style="grid-row:${group};grid-column:1/6"></div>`;
    boxes.forEach(([r, c, label, href, cnt]) => { html += `<a class="box" href="${href}" style="grid-row:${r};grid-column:${c}">${E(t(label))}${cnt ? `<span class="cnt">${cnt}</span>` : ''}</a>`; });
    arrows.forEach(([r, c, dir]) => { html += `<div class="arrow" style="grid-row:${r};grid-column:${c}">${UI.arrow(dir)}</div>`; });
    return `<div class="flow">${html}</div>`;
  },

  /* ---------- Grouped bar chart ---------- */
  barChart(labels, series, height = 220) {
    const W = 640, H = height, pl = 56, pb = 26, pt = 10, pr = 10;
    const max = Math.max(1, ...series.flatMap(s => s.values.map(Math.abs))) * 1.1;
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const tick = max / step > 5 ? step * 2 : step;
    const gw = (W - pl - pr) / labels.length;
    const bw = Math.min(22, (gw - 12) / series.length);
    const y = v => H - pb - (Math.max(0, v) / max) * (H - pb - pt);
    let g = '';
    for (let v = 0; v <= max; v += tick) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${pl - 6}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : v}</text>`;
    labels.forEach((l, i) => {
      const x0 = pl + i * gw + (gw - bw * series.length) / 2;
      series.forEach((s, j) => {
        const v = s.values[i];
        g += `<rect x="${x0 + j * bw}" y="${y(v)}" width="${Math.max(1, bw - 3)}" height="${Math.max(0, H - pb - y(v))}" fill="${s.color}" rx="2"><title>${E(s.name)} ${E(l)}: ${U.amt(v)}</title></rect>`;
      });
      g += `<text x="${pl + i * gw + gw / 2}" y="${H - 8}" text-anchor="middle">${E(l)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>
      <div class="legend">${series.map(s => `<span style="--c:${s.color}">${E(t(s.name))}</span>`).join('')}</div>`;
  },
};
