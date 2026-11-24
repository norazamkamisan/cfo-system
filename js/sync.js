'use strict';
/* =========================================================================
   Sync between devices (PC & phone) through a PRIVATE GitHub repository.

   - Each device keeps working offline on its own copy.
   - "Sync" = download the shared copy, merge it with this device's changes
     (record by record, using the last synced copy as the common base),
     upload the result.  Edits on different records never clash; if the SAME
     field of the same record was changed on both devices, this device wins
     and the clash is listed on the Sync page.
   - Data can be encrypted with a passphrase (AES-GCM) before upload.
   - Connection settings (token, passphrase) stay on this device only and
     are never included in backups or synced.
   ========================================================================= */

const SYNC_KEY = 'cfo-sync';

/* ---------------- helpers: base64 & encryption ---------------- */
const B64 = {
  fromBytes(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); },
  toBytes(b64) { return Uint8Array.from(atob(String(b64).replace(/\s/g, '')), c => c.charCodeAt(0)); },
  enc(text) { return B64.fromBytes(new TextEncoder().encode(text)); },
  dec(b64) { return new TextDecoder().decode(B64.toBytes(b64)); },
};
const Crypt = {
  async key(pass, salt) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  async pack(data, pass, device) {
    const head = { format: 'cfo-sync', v: 1, savedAt: new Date().toISOString(), device: device || '' };
    if (!pass) return JSON.stringify(Object.assign(head, { encrypted: false, data }));
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await Crypt.key(pass, salt), new TextEncoder().encode(JSON.stringify(data)));
    return JSON.stringify(Object.assign(head, { encrypted: true, salt: B64.fromBytes(salt), iv: B64.fromBytes(iv), data: B64.fromBytes(new Uint8Array(ct)) }));
  },
  async unpack(text, pass) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('The synced file is damaged (not valid JSON).'); }
    if (!o || o.format !== 'cfo-sync') throw new Error('This file is not CFO sync data.');
    if (!o.encrypted) return o.data;
    if (!pass) throw new Error('The synced data is encrypted — enter the sync passphrase on this device.');
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: B64.toBytes(o.iv) }, await Crypt.key(pass, B64.toBytes(o.salt)), B64.toBytes(o.data));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (e) { throw new Error('Wrong sync passphrase — it must be the same on every device.'); }
  },
  async isEncrypted(text) { try { return !!JSON.parse(text).encrypted; } catch (e) { return false; } },
};

/* ---------------- GitHub storage (contents API) ---------------- */
const GH = {
  async call(cfg, url, opts = {}) {
    let res;
    try {
      res = await fetch(url, Object.assign({ cache: 'no-store' }, opts, {
        headers: Object.assign({ Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, opts.headers || {}),
      }));
    } catch (e) { throw new Error('Could not reach GitHub — check the internet connection.'); }
    return res;
  },
  async fail(res) {
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch (e) { /* ignore */ }
    if (res.status === 401) return new Error('GitHub rejected the token (wrong or expired). Create a new token and enter it on the Sync page.');
    if (res.status === 403) return new Error(`GitHub refused access (${msg || 'permission'}). Check the token has "Contents: Read and write" for the data repository.`);
    if (res.status === 404) return new Error('Repository not found, or the token cannot see it. Check the repository name and the token\'s repository access.');
    return new Error(`GitHub error ${res.status}: ${msg}`);
  },
  url(cfg, path) { return `https://api.github.com/repos/${cfg.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`; },
  async check(cfg) {
    const res = await GH.call(cfg, `https://api.github.com/repos/${cfg.repo}`);
    if (!res.ok) throw await GH.fail(res);
    const j = await res.json();
    if (!j.permissions || !j.permissions.push) throw new Error('The token can read but not write this repository. Give it "Contents: Read and write".');
    return { private: j.private, fullName: j.full_name };
  },
  /** Returns {sha, text} or null if the file does not exist. */
  async get(cfg, path) {
    const res = await GH.call(cfg, GH.url(cfg, path));
    if (res.status === 404) return null;
    if (!res.ok) throw await GH.fail(res);
    const j = await res.json();
    if (j.content && j.encoding === 'base64') return { sha: j.sha, text: B64.dec(j.content) };
    const raw = await GH.call(cfg, GH.url(cfg, path), { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!raw.ok) throw await GH.fail(raw);
    return { sha: j.sha, text: await raw.text() };
  },
  async put(cfg, path, text, sha, message) {
    const body = { message, content: B64.enc(text) };
    if (sha) body.sha = sha;
    const res = await GH.call(cfg, GH.url(cfg, path), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 409 || (res.status === 422 && sha)) { const e = new Error('conflict'); e.conflict = true; throw e; }
    if (!res.ok) throw await GH.fail(res);
    return (await res.json()).content.sha;
  },
  async list(cfg, dir) {
    const res = await GH.call(cfg, GH.url(cfg, dir));
    if (res.status === 404) return [];
    if (!res.ok) throw await GH.fail(res);
    const j = await res.json();
    return Array.isArray(j) ? j.filter(f => f.type === 'file' && f.name.endsWith('.json')) : [];
  },
};

/* ---------------- three-way merge ---------------- */
const Merge = {
  eq: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  isObj: x => !!x && typeof x === 'object' && !Array.isArray(x),
  isRecArr: (...as) => as.some(a => Array.isArray(a) && a.length > 0 && a.every(x => Merge.isObj(x) && x.id != null)),
  /** base = last synced copy, l = this device, r = shared copy. Returns merged; clashes go into cf. */
  run(base, l, r, cf) { return Merge.m(base, l, r, '', cf); },
  m(b, l, r, path, cf) {
    if (Merge.eq(l, r)) return l;
    if (Merge.eq(b, l)) return r;          // only the other device changed it
    if (Merge.eq(b, r)) return l;          // only this device changed it
    // changed on both devices
    if (path === 'counters') {             // numbering: never go backwards
      const o = Object.assign({}, r, l);
      Object.keys(o).forEach(k => { o[k] = Math.max(+((l || {})[k]) || 0, +((r || {})[k]) || 0); });
      return o;
    }
    if (path === 'audit') {                // activity log: keep both
      const seen = new Set(), out = [];
      [...(r || []), ...(l || [])].forEach(a => { const k = [a.t, a.user, a.action, a.entity, a.ref].join('|'); if (!seen.has(k)) { seen.add(k); out.push(a); } });
      return out.sort((a, c) => String(a.t).localeCompare(String(c.t))).slice(-5000);
    }
    if (l === undefined) return r;         // deleted here but edited there: keep the edit
    if (r === undefined) return l;
    if (Merge.isRecArr(b, l, r)) return Merge.recs(b || [], l || [], r || [], path, cf);
    if (Merge.isObj(l) && Merge.isObj(r)) {
      const o = {};
      new Set([...Object.keys(l), ...Object.keys(r)]).forEach(k => {
        const v = Merge.m(Merge.isObj(b) ? b[k] : undefined, l[k], r[k], path ? path + '.' + k : k, cf);
        if (v !== undefined) o[k] = v;
      });
      return o;
    }
    cf.push(path);                         // same value changed differently on both: this device wins
    return l;
  },
  recs(b, l, r, path, cf) {
    const map = a => new Map(a.filter(x => Merge.isObj(x) && x.id != null).map(x => [String(x.id), x]));
    const B = map(b), L = map(l), R = map(r);
    const ids = [...L.keys(), ...[...R.keys()].filter(k => !L.has(k))];
    const out = [];
    ids.forEach(id => {
      const x = L.get(id) || R.get(id);
      const label = x.number || x.code || x.name || id;
      const v = Merge.m(B.get(id), L.get(id), R.get(id), `${path}[${label}]`, cf);
      if (v !== undefined) out.push(v);
    });
    return out;
  },
  /** Same document number used on two devices while offline. */
  duplicates(data) {
    const seen = {}, dups = [];
    (data.docs || []).forEach(d => { const k = d.type + '|' + d.number; if (seen[k] && seen[k] !== d.id) dups.push(d.number); seen[k] = d.id; });
    return dups;
  },
};

/* ---------------- sync controller ---------------- */
const Sync = {
  applying: false, busy: false, pending: false, timer: null, status: 'off', lastError: '', lastPull: 0,
  cfg() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } },
  setCfg(c) { localStorage.setItem(SYNC_KEY, JSON.stringify(c)); },
  link() { const c = Sync.cfg(); return c.links && c.links[DB.key()]; },
  setLink(l) { const c = Sync.cfg(); c.links = c.links || {}; if (l) c.links[DB.key()] = l; else delete c.links[DB.key()]; Sync.setCfg(c); },
  connected() { const c = Sync.cfg(); return !!(c.token && c.repo); },
  enabled() { return Sync.connected() && !!Sync.link(); },
  baseKey() { return DB.key() + ':syncbase'; },
  getBase() { try { return JSON.parse(localStorage.getItem(Sync.baseKey())); } catch (e) { return null; } },
  setBase(d) { try { localStorage.setItem(Sync.baseKey(), JSON.stringify(d)); } catch (e) { throw new Error('This device is out of storage space for sync.'); } },
  device() { return Sync.cfg().device || (/android|iphone|ipad|mobile/i.test(navigator.userAgent) ? 'Phone' : 'PC'); },

  setStatus(s, err) {
    Sync.status = s;
    if (err !== undefined) Sync.lastError = err;
    const el = document.getElementById('sync-ind');
    if (!el) return;
    el.style.display = Sync.enabled() ? '' : 'none';
    el.className = 'icon-btn sync-ind ' + s;
    const l = Sync.link();
    el.title = { ok: `Synced${l && l.lastSync ? ' ' + U.fdatetime(l.lastSync) : ''}`, syncing: 'Syncing…', pending: 'Changes waiting to sync', offline: 'Offline — will sync when back online', error: 'Sync problem: ' + Sync.lastError }[s] || 'Sync';
  },
  /** Called after every local save. */
  changed() {
    if (Sync.applying || !Sync.enabled()) return;
    Sync.setStatus(navigator.onLine ? 'pending' : 'offline');
    clearTimeout(Sync.timer);
    Sync.timer = setTimeout(() => Sync.run(), 6000);
  },
  /** Replace this device's data with merged data without triggering another sync. */
  applyLocal(data) {
    Sync.applying = true;
    try { DB.data = migrate(data); DB.save(); } finally { Sync.applying = false; }
    const busyForm = document.querySelector('.modal-back, #docform, #jf, #sf') || /\/(new|edit)\b/.test(location.hash);
    if (busyForm) UI.toast('Synced — new changes from your other device will show when you leave this screen');
    else render();
  },

  async run(opts = {}) {
    if (!Sync.enabled()) return;
    if (Sync.busy) { Sync.pending = true; return; }
    if (!navigator.onLine) { Sync.setStatus('offline'); return; }
    clearTimeout(Sync.timer);
    Sync.busy = true; Sync.setStatus('syncing');
    const cfg = Sync.cfg(), link = Sync.link();
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await GH.get(cfg, link.path);
        if (!remote) throw new Error('The shared data file is missing on GitHub. Re-link this company on the Sync page.');
        const rdata = migrate(await Crypt.unpack(remote.text, cfg.pass));
        const base = Sync.getBase();
        const local = JSON.parse(JSON.stringify(DB.data));
        const startRev = DB.rev;
        const cf = [];
        const merged = base ? Merge.run(base, local, rdata, cf) : rdata;
        const mStr = JSON.stringify(merged);
        if (mStr !== JSON.stringify(rdata)) {
          try { await GH.put(cfg, link.path, await Crypt.pack(merged, cfg.pass, Sync.device()), remote.sha, `Sync from ${Sync.device()} — ${merged.settings.company}`); }
          catch (e) { if (e.conflict) continue; throw e; }
        }
        let final = merged;
        if (DB.rev !== startRev) {          // edits made on this device while we were syncing
          final = Merge.run(local, JSON.parse(JSON.stringify(DB.data)), merged, cf);
          Sync.pending = true;
        }
        if (JSON.stringify(final) !== JSON.stringify(DB.data)) Sync.applyLocal(final);
        Sync.setBase(merged);
        const dups = Merge.duplicates(final);
        Object.assign(link, { lastSync: new Date().toISOString(), conflicts: cf.slice(0, 30), duplicates: dups });
        Sync.setLink(link);
        Sync.lastPull = Date.now();
        Sync.setStatus('ok', '');
        if (cf.length) UI.toast(`Synced. ${cf.length} item(s) were changed on both devices — this device's version was kept. See Control Panel → Sync.`, 'err');
        if (dups.length) UI.toast(`Same number used on two devices: ${dups.join(', ')}. Please renumber one of them.`, 'err');
        else if (opts.manual && !cf.length) UI.toast('Synced ✔', 'ok');
        return true;
      }
      throw new Error('Another device kept saving at the same moment — try again.');
    } catch (e) {
      Sync.setStatus('error', e.message);
      if (opts.manual) UI.toast('Sync failed: ' + e.message, 'err');
      return false;
    } finally {
      Sync.busy = false;
      if (Sync.pending) { Sync.pending = false; Sync.changed(); }
    }
  },

  /** First device: upload this company as a new shared file. */
  async upload() {
    const cfg = Sync.cfg();
    const slug = (DB.data.settings.company || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'company';
    const path = `companies/${slug}-${Math.random().toString(36).slice(2, 7)}.json`;
    const data = JSON.parse(JSON.stringify(DB.data));
    await GH.put(cfg, path, await Crypt.pack(data, cfg.pass, Sync.device()), null, `Start syncing ${data.settings.company}`);
    Sync.setBase(data);
    Sync.setLink({ path, linkedAt: new Date().toISOString(), lastSync: new Date().toISOString() });
    DB.log('Sync', 'Sync', 'Uploaded ' + data.settings.company, path);
    DB.save();
  },
  /** Other devices: replace this company's data with the shared copy and link it. */
  async linkExisting(path) {
    const cfg = Sync.cfg();
    const remote = await GH.get(cfg, path);
    if (!remote) throw new Error('That file no longer exists.');
    const data = migrate(await Crypt.unpack(remote.text, cfg.pass));
    Sync.setLink({ path, linkedAt: new Date().toISOString(), lastSync: new Date().toISOString() });
    Sync.setBase(data);
    Sync.applying = true;
    try { DB.data = data; DB.save(); } finally { Sync.applying = false; }
  },
  unlink() { Sync.setLink(null); try { localStorage.removeItem(Sync.baseKey()); } catch (e) { /* ignore */ } },

  init() {
    Sync.setStatus(Sync.enabled() ? 'ok' : 'off');
    if (!Sync.enabled()) return;
    setTimeout(() => Sync.run(), 1200);
    if (Sync.wired) return;
    Sync.wired = true;
    window.addEventListener('online', () => Sync.run());
    window.addEventListener('offline', () => Sync.setStatus('offline'));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - Sync.lastPull > 30000) Sync.run(); });
    setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - Sync.lastPull > 110000) Sync.run(); }, 120000);
  },
};

/* ---------------- Sync page ---------------- */
route('/control/sync', (el) => {
  const c = Sync.cfg(), link = Sync.link();
  el.innerHTML = `${UI.pageHead('Sync (PC & phone)', [['Control Panel', '#/control'], ['Sync']])}
    <div class="alert info">Sync keeps the same books on your PC and phone. Each device works offline; changes are merged automatically a few seconds after you save, when the app opens, and every 2 minutes while it's open. The shared copy is kept in a <b>private</b> GitHub repository, encrypted with your passphrase.</div>
    <div class="grid g2">
      <form class="card" id="conn"><h2>1 · Connect this device</h2>
        <div class="form-grid mt">
          ${UI.field('Data repository (owner/name)', UI.input('repo', c.repo || '', 'placeholder="yourname/cfo-data" autocapitalize="off" autocorrect="off"'), 'full')}
          ${UI.field('GitHub access token', `<input name="token" type="password" autocomplete="off" value="${E(c.token || '')}" placeholder="github_pat_…">`, 'full')}
          ${UI.field('Sync passphrase (same on every device)', `<input name="pass" type="password" autocomplete="new-password" value="${E(c.pass || '')}" placeholder="Recommended — encrypts your data">`, 'full')}
          ${UI.field('This device\'s name', UI.input('device', c.device || Sync.device()))}
        </div>
        <p class="small muted">These settings are kept on this device only — never in backups or the synced data. If you forget the passphrase, the shared copy can't be opened (each device still has its own copy).</p>
        <div class="btn-row mt"><button class="btn primary">Test & save</button>${Sync.connected() ? '<button type="button" class="btn danger" id="disc">Disconnect this device</button>' : ''}</div>
      </form>
      <div class="card"><h2>2 · Sync this company</h2><div id="co" class="mt">${Sync.connected() ? '<p class="muted">Checking…</p>' : '<p class="muted">Connect this device first.</p>'}</div></div>
    </div>
    <div class="card"><h2>How to create the access token (once — use it on every device)</h2>
      <ol style="line-height:1.9">
        <li>On github.com open <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b> (<a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">open the page</a>).</li>
        <li>Name: <b>CFO sync</b>. Expiration: up to 1 year (you'll need a new one when it expires).</li>
        <li>Repository access: <b>Only select repositories</b> → choose your data repository (e.g. <b>cfo-data</b>).</li>
        <li>Permissions → Repository permissions → <b>Contents: Read and write</b>. Leave everything else as is.</li>
        <li>Click <b>Generate token</b>, copy it and paste it above. Keep it private, like a password.</li>
      </ol></div>`;
  const conn = $('#conn', el);
  conn.onsubmit = async e => {
    e.preventDefault();
    const v = UI.formValues(conn);
    const repo = v.repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return UI.toast('Repository should look like owner/name', 'err');
    if (!v.token) return UI.toast('Enter the access token', 'err');
    const btn = $('button.primary', conn); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const info = await GH.check({ repo, token: v.token });
      if (!info.private && !confirm('This repository is PUBLIC — anyone could download your data file. Continue anyway? (Use a private repository.)')) return;
      const old = Sync.cfg();
      if (old.pass && old.pass !== v.pass && Sync.link()) UI.toast('Passphrase changed — the next sync re-encrypts the shared copy with it. Use the same new passphrase on your other devices.');
      Sync.setCfg(Object.assign(old, { repo, token: v.token, pass: v.pass, device: v.device }));
      UI.toast('Connected to ' + info.fullName, 'ok');
      render();
    } catch (err) { UI.toast(err.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = 'Test & save'; }
  };
  const disc = $('#disc', el);
  if (disc) disc.onclick = () => {
    if (!confirm('Disconnect this device from sync? Its data stays here; it just stops syncing.')) return;
    const cfg = Sync.cfg(); Object.keys(cfg.links || {}).forEach(k => { try { localStorage.removeItem(k + ':syncbase'); } catch (e) { /* ignore */ } });
    localStorage.removeItem(SYNC_KEY); Sync.setStatus('off'); render();
  };
  if (!Sync.connected()) return;
  const co = $('#co', el);
  if (link) {
    co.innerHTML = `<table class="fin"><tbody>
        <tr><td>Company</td><td><b>${E(DB.data.settings.company)}</b></td></tr>
        <tr><td>Shared file</td><td class="small">${E(link.path)}</td></tr>
        <tr><td>Last synced</td><td>${link.lastSync ? U.fdatetime(link.lastSync) : '—'}</td></tr>
        <tr><td>Status</td><td>${Sync.status === 'error' ? `<span class="text-red">${E(Sync.lastError)}</span>` : E({ ok: 'Up to date', pending: 'Changes waiting', syncing: 'Syncing…', offline: 'Offline' }[Sync.status] || '—')}</td></tr>
      </tbody></table>
      ${link.conflicts && link.conflicts.length ? `<div class="alert warn mt">Changed on both devices at the last sync (this device's version was kept):<br><span class="small">${link.conflicts.map(E).join('<br>')}</span></div>` : ''}
      ${link.duplicates && link.duplicates.length ? `<div class="alert err mt">Same document number created on two devices: <b>${link.duplicates.map(E).join(', ')}</b>. Open one and give it a new number.</div>` : ''}
      <div class="btn-row mt"><button class="btn primary" id="now">Sync now</button><button class="btn danger" id="unl">Stop syncing this company</button></div>`;
    $('#now', co).onclick = async () => { await Sync.run({ manual: true }); render(); };
    $('#unl', co).onclick = () => { if (confirm('Stop syncing this company on this device? The data stays here and in the shared copy.')) { Sync.unlink(); Sync.setStatus('off'); render(); } };
    return;
  }
  (async () => {
    try {
      const files = await GH.list(Sync.cfg(), 'companies');
      co.innerHTML = `<p>This company (<b>${E(DB.data.settings.company)}</b>) isn't synced yet. Choose one:</p>
        <div class="btn-row"><button class="btn primary" id="up">Upload this company (first device)</button></div>
        ${files.length ? `<p class="mt">…or link this device to a company already uploaded from another device. <b>This replaces the data on this device</b> with the shared copy.</p>
          ${UI.table([
            { label: 'Shared company file', render: f => E(f.name.replace(/-[a-z0-9]{5}\.json$/, '').replace(/-/g, ' ')) + `<div class="small muted">${E(f.name)}</div>` },
            { label: '', cls: 'num', render: f => `<button class="btn sm" data-link="${E(f.path)}">Link & download</button>` },
          ], files)}` : '<p class="muted small mt">No companies uploaded yet — start with "Upload" on the device that has your data.</p>'}`;
      $('#up', co).onclick = async () => {
        if (files.length && !confirm('Companies are already uploaded. Upload THIS company as a separate one? (To use an existing one, choose "Link & download" instead.)')) return;
        try { await Sync.upload(); UI.toast('Uploaded — this company now syncs', 'ok'); Sync.init(); render(); } catch (err) { UI.toast(err.message, 'err'); }
      };
      $$('[data-link]', co).forEach(b => b.onclick = async () => {
        if (!confirm(`Replace ALL data of "${DB.data.settings.company}" on this device with the shared copy? Export a backup first if this device has data you need.`)) return;
        b.disabled = true;
        try { await Sync.linkExisting(b.dataset.link); UI.toast('Linked — this device now has the shared books', 'ok'); Sync.init(); location.hash = '#/'; render(); }
        catch (err) { UI.toast(err.message, 'err'); b.disabled = false; }
      });
    } catch (err) { co.innerHTML = `<div class="alert err">${E(err.message)}</div>`; }
  })();
});
