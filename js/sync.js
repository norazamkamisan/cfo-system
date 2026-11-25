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

/* ---------------- Google Drive storage ----------------
   Uses the "drive.file" permission: the app can only see files it created
   itself (folder "CFO System"), never anything else in your Drive.
   Sign-in uses Google Identity Services; access lasts about an hour, after
   which one tap on the sync icon renews it. */
const GDrive = {
  scope: 'https://www.googleapis.com/auth/drive.file',
  ROOT: 'CFO System', BACKUPS: 'Backups',
  interactive: false, folders: {},
  token() {
    try { const t = JSON.parse(localStorage.getItem('cfo-gtoken')); if (t && Date.now() < t.exp - 60000) return t.t; } catch (e) { /* ignore */ }
    return null;
  },
  loadLib() {
    return new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      let s = document.getElementById('gsi-lib');
      if (!s) { s = document.createElement('script'); s.id = 'gsi-lib'; s.src = 'https://accounts.google.com/gsi/client'; s.async = true; document.head.appendChild(s); }
      s.addEventListener('load', () => res());
      s.addEventListener('error', () => rej(new Error('Could not load Google sign-in — check the internet connection.')));
      setTimeout(() => { if (window.google && google.accounts) res(); }, 50);
    });
  },
  /** Returns an access token; opens Google's sign-in window only when interactive. */
  async signIn(cfg, interactive) {
    const t = GDrive.token();
    if (t) return t;
    if (!interactive) { const e = new Error('Tap the sync icon to sign in to Google Drive.'); e.auth = true; throw e; }
    if (!cfg.clientId) throw new Error('Enter the Google Client ID on the Sync page first.');
    await GDrive.loadLib();
    return new Promise((res, rej) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId, scope: GDrive.scope, prompt: cfg.gconnected ? '' : 'consent',
        callback: r => {
          if (r.error) return rej(new Error('Google sign-in failed: ' + (r.error_description || r.error)));
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, GDrive.scope)) return rej(new Error('Please tick "See, edit, create and delete only the specific Google Drive files you use with this app" when signing in.'));
          localStorage.setItem('cfo-gtoken', JSON.stringify({ t: r.access_token, exp: Date.now() + (+r.expires_in || 3600) * 1000 }));
          res(r.access_token);
        },
        error_callback: e => rej(new Error(e && e.type === 'popup_failed_to_open' ? 'The Google sign-in window was blocked — allow pop-ups for this site and try again.' : e && e.type === 'popup_closed' ? 'Google sign-in was closed before it finished.' : 'Google sign-in failed.')),
      });
      tc.requestAccessToken();
    });
  },
  signOut() {
    const t = GDrive.token();
    localStorage.removeItem('cfo-gtoken');
    GDrive.folders = {};
    if (t && window.google && google.accounts) google.accounts.oauth2.revoke(t, () => {});
  },
  async api(cfg, url, opts = {}) {
    const t = await GDrive.signIn(cfg, GDrive.interactive);
    let res;
    try { res = await fetch(url, Object.assign({ cache: 'no-store' }, opts, { headers: Object.assign({ Authorization: 'Bearer ' + t }, opts.headers || {}) })); }
    catch (e) { throw new Error('Could not reach Google Drive — check the internet connection.'); }
    if (res.status === 401) { localStorage.removeItem('cfo-gtoken'); const e = new Error('Google Drive sign-in expired — tap the sync icon.'); e.auth = true; throw e; }
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = (j.error && j.error.message) || ''; } catch (e) { /* ignore */ }
      if (res.status === 403 && /has not been used|disabled/i.test(msg)) throw new Error('The Google Drive API is not enabled in your Google Cloud project. Enable it (APIs & Services → Library → Google Drive API) and try again.');
      if (res.status === 403) throw new Error('Google Drive refused access: ' + msg);
      throw new Error(`Google Drive error ${res.status}: ${msg}`);
    }
    return res;
  },
  q(s) { return encodeURIComponent(s); },
  async findOne(cfg, query, fields = 'id,name,version') {
    const res = await GDrive.api(cfg, `https://www.googleapis.com/drive/v3/files?spaces=drive&pageSize=1000&orderBy=createdTime&fields=files(${fields})&q=${GDrive.q(query + ' and trashed=false')}`);
    return (await res.json()).files || [];
  },
  async folder(cfg, sub) {
    const key = sub || '/';
    if (GDrive.folders[key]) return GDrive.folders[key];
    const parent = sub ? await GDrive.folder(cfg) : null;
    const name = sub || GDrive.ROOT;
    const found = await GDrive.findOne(cfg, `name='${name}' and mimeType='application/vnd.google-apps.folder'${parent ? ` and '${parent}' in parents` : ''}`, 'id');
    let id = found[0] && found[0].id;
    if (!id) {
      const res = await GDrive.api(cfg, 'https://www.googleapis.com/drive/v3/files?fields=id', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ name, mimeType: 'application/vnd.google-apps.folder' }, parent ? { parents: [parent] } : {})),
      });
      id = (await res.json()).id;
    }
    GDrive.folders[key] = id;
    return id;
  },
  /** 'companies/x.json' → CFO System/x.json ; 'backups/y.json' → CFO System/Backups/y.json */
  where(path) { const [dir, name] = path.split('/'); return { sub: dir === 'backups' ? GDrive.BACKUPS : null, name }; },
  async find(cfg, path) {
    const w = GDrive.where(path);
    const fid = await GDrive.folder(cfg, w.sub);
    return (await GDrive.findOne(cfg, `name='${w.name}' and '${fid}' in parents`))[0] || null;
  },
  async check(cfg) { await GDrive.folder(cfg); return { private: true, fullName: 'Google Drive › ' + GDrive.ROOT }; },
  async get(cfg, path) {
    const f = await GDrive.find(cfg, path);
    if (!f) return null;
    const res = await GDrive.api(cfg, `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`);
    return { sha: f.id + ':' + f.version, text: await res.text() };
  },
  async put(cfg, path, text, sha, message, overwrite) {
    const f = await GDrive.find(cfg, path);
    if (!overwrite && ((sha && (!f || f.id + ':' + f.version !== sha)) || (!sha && f))) { const e = new Error('conflict'); e.conflict = true; throw e; }
    if (f) {
      const res = await GDrive.api(cfg, `https://www.googleapis.com/upload/drive/v3/files/${f.id}?uploadType=media&fields=id,version`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
      const j = await res.json(); return j.id + ':' + j.version;
    }
    const w = GDrive.where(path);
    const parent = await GDrive.folder(cfg, w.sub);
    const b = 'cfo' + Math.random().toString(36).slice(2);
    const meta = { name: w.name, parents: [parent], mimeType: 'application/json', description: message || 'CFO System data' };
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${b}--`;
    const res = await GDrive.api(cfg, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
    const j = await res.json(); return j.id + ':' + j.version;
  },
  async list(cfg, dir) {
    const fid = await GDrive.folder(cfg, dir === 'backups' ? GDrive.BACKUPS : null);
    return (await GDrive.findOne(cfg, `'${fid}' in parents and mimeType='application/json'`, 'id,name,modifiedTime'))
      .filter(f => f.name.endsWith('.json')).map(f => ({ type: 'file', name: f.name, path: dir + '/' + f.name, id: f.id, modified: f.modifiedTime }));
  },
  async remove(cfg, id) { await GDrive.api(cfg, `https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' }); },
};

/** The storage this device uses. */
/* ---------------- Google Drive via your own helper (automatic) ----------------
   A small Google Apps Script web app in your account does the Drive work, so
   the app never needs to sign in: fully automatic background sync. */
const GScript = {
  async call(cfg, body) {
    let res;
    try {
      res = await fetch(cfg.scriptUrl, { method: 'POST', body: JSON.stringify(Object.assign({ key: cfg.scriptKey }, body)), redirect: 'follow', cache: 'no-store' });
    } catch (e) { throw new Error('Could not reach your Google Drive helper — check the internet connection.'); }
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch (e) {
      if (/accounts\.google\.com|ServiceLogin|Sign in/i.test(text)) throw new Error('The helper asks for sign-in — redeploy it with "Who has access: Anyone".');
      throw new Error(`The Google Drive helper did not answer properly (HTTP ${res.status}). Check the web app URL.`);
    }
    if (j.error) throw new Error(/Not authorised/.test(j.error) ? 'The helper rejected the connection key — copy the helper code again from this page and redeploy, or paste the right connection code.' : 'Google Drive helper: ' + j.error);
    return j;
  },
  async check(cfg) { const j = await GScript.call(cfg, { action: 'ping' }); return { private: true, fullName: 'Google Drive › ' + j.folder, account: j.account }; },
  async get(cfg, path) { const j = await GScript.call(cfg, { action: 'get', path }); return j.file || null; },
  async put(cfg, path, text, sha, message, overwrite) {
    const j = await GScript.call(cfg, { action: 'put', path, text, sha: sha || null, message: message || '', overwrite: !!overwrite });
    if (j.conflict) { const e = new Error('conflict'); e.conflict = true; throw e; }
    return j.sha;
  },
  async list(cfg, dir) { return (await GScript.call(cfg, { action: 'list', dir })).files || []; },
  async remove(cfg, id) { await GScript.call(cfg, { action: 'remove', id }); },
  newKey() { return Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join(''); },
  validUrl: u => /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u),
  /** One string for the phone: web app URL + key. */
  code(cfg) { return 'CFO1-' + btoa(JSON.stringify({ u: cfg.scriptUrl, k: cfg.scriptKey })).replace(/=+$/, ''); },
  parseCode(s) {
    s = String(s || '').trim();
    if (!s.startsWith('CFO1-')) return null;
    try { const o = JSON.parse(atob(s.slice(5))); return o.u && o.k ? { scriptUrl: o.u, scriptKey: o.k } : null; } catch (e) { return null; }
  },
  async scriptText(key) {
    const res = await fetch('helper/Code.gs', { cache: 'no-store' }).catch(() => null) || await caches.match('helper/Code.gs');
    if (!res || !res.ok) throw new Error('Could not load the helper code — open this page while online.');
    return (await res.text()).replace('__SYNC_KEY__', key);
  },
};

const provOf = c => c.provider || (c.token && c.repo ? 'github' : c.scriptUrl ? 'gscript' : 'gdrive');
const Store = () => ({ github: GH, gscript: GScript }[provOf(Sync.cfg())] || GDrive);

/* ---------------- sync controller ---------------- */
const Sync = {
  applying: false, busy: false, pending: false, timer: null, status: 'off', lastError: '', lastPull: 0,
  cfg() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } },
  setCfg(c) { localStorage.setItem(SYNC_KEY, JSON.stringify(c)); },
  link() { const c = Sync.cfg(); return c.links && c.links[DB.key()]; },
  setLink(l) { const c = Sync.cfg(); c.links = c.links || {}; if (l) c.links[DB.key()] = l; else delete c.links[DB.key()]; Sync.setCfg(c); },
  connected() {
    const c = Sync.cfg();
    const p = provOf(c);
    return p === 'github' ? !!(c.token && c.repo) : p === 'gscript' ? !!(c.scriptUrl && c.scriptKey) : !!(c.clientId && c.gconnected);
  },
  enabled() { return Sync.connected() && !!Sync.link(); },
  baseKey() { return DB.key() + ':syncbase'; },
  getBase() { try { return JSON.parse(localStorage.getItem(Sync.baseKey())); } catch (e) { return null; } },
  setBase(d) { try { localStorage.setItem(Sync.baseKey(), JSON.stringify(d)); } catch (e) { throw new Error('This device is out of storage space for sync.'); } },
  device() { return Sync.cfg().device || (/android|iphone|ipad|mobile/i.test(navigator.userAgent) ? 'Phone' : 'PC'); },
  where() { return provOf(Sync.cfg()) === 'github' ? 'GitHub' : 'Google Drive'; },

  setStatus(s, err) {
    Sync.status = s;
    if (err !== undefined) Sync.lastError = err;
    const el = document.getElementById('sync-ind');
    if (!el) return;
    el.style.display = Sync.enabled() ? '' : 'none';
    el.className = 'icon-btn sync-ind ' + s;
    const l = Sync.link();
    el.title = { ok: `Synced with ${Sync.where()}${l && l.lastSync ? ' ' + U.fdatetime(l.lastSync) : ''}`, syncing: 'Syncing…', pending: 'Changes waiting to sync', offline: 'Offline — will sync when back online', auth: 'Tap to sign in to Google Drive and sync', error: 'Sync problem: ' + Sync.lastError }[s] || 'Sync';
  },
  /** Called after every local save. */
  changed() {
    if (Sync.applying || !Sync.enabled()) return;
    Sync.setStatus(navigator.onLine ? (Sync.status === 'auth' ? 'auth' : 'pending') : 'offline');
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
    GDrive.interactive = !!opts.manual;
    const S = Store(), cfg = Sync.cfg(), link = Sync.link();
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await S.get(cfg, link.path);
        if (!remote) throw new Error(`The shared data file is missing from ${Sync.where()}. Re-link this company on the Sync page.`);
        const rdata = migrate(await Crypt.unpack(remote.text, cfg.pass));
        const base = Sync.getBase();
        const local = JSON.parse(JSON.stringify(DB.data));
        const startRev = DB.rev;
        const cf = [];
        const merged = base ? Merge.run(base, local, rdata, cf) : rdata;
        const mStr = JSON.stringify(merged);
        let packed = null;
        if (mStr !== JSON.stringify(rdata)) {
          packed = await Crypt.pack(merged, cfg.pass, Sync.device());
          try { await S.put(cfg, link.path, packed, remote.sha, `Sync from ${Sync.device()} — ${merged.settings.company}`); }
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
        await Sync.dailyBackup(link, packed || remote.text).catch(e => console.warn('Backup skipped:', e.message));
        if (cf.length) UI.toast(`Synced. ${cf.length} item(s) were changed on both devices — this device's version was kept. See Control Panel → Sync.`, 'err');
        if (dups.length) UI.toast(`Same number used on two devices: ${dups.join(', ')}. Please renumber one of them.`, 'err');
        else if (opts.manual && !cf.length) UI.toast('Synced ✔', 'ok');
        return true;
      }
      throw new Error('Another device kept saving at the same moment — try again.');
    } catch (e) {
      if (e.auth) { Sync.setStatus('auth', e.message); if (opts.manual) UI.toast(e.message, 'err'); }
      else { Sync.setStatus('error', e.message); if (opts.manual) UI.toast('Sync failed: ' + e.message, 'err'); }
      return false;
    } finally {
      Sync.busy = false; GDrive.interactive = false;
      if (Sync.pending) { Sync.pending = false; Sync.changed(); }
    }
  },

  /** Google Drive: one dated copy per day in "CFO System/Backups", keeping the latest 30. */
  async dailyBackup(link, text) {
    const S = Store();
    if (S === GH) return;
    const today = U.today();
    if (link.lastBackup === today) return;
    const cfg = Sync.cfg();
    const stem = link.path.split('/').pop().replace(/\.json$/, '');
    await S.put(cfg, `backups/${stem}-${today}.json`, text, null, 'Daily backup', true);
    const mine = (await S.list(cfg, 'backups')).filter(f => f.name.startsWith(stem + '-')).sort((a, b) => a.name.localeCompare(b.name));
    for (const f of mine.slice(0, Math.max(0, mine.length - 30))) await S.remove(cfg, f.id);
    link.lastBackup = today;
    Sync.setLink(link);
  },

  /** First device: upload this company as a new shared file. */
  async upload() {
    const cfg = Sync.cfg();
    GDrive.interactive = true;
    try {
      const slug = (DB.data.settings.company || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'company';
      const path = `companies/${slug}-${Math.random().toString(36).slice(2, 7)}.json`;
      const data = JSON.parse(JSON.stringify(DB.data));
      await Store().put(cfg, path, await Crypt.pack(data, cfg.pass, Sync.device()), null, `Start syncing ${data.settings.company}`);
      Sync.setBase(data);
      Sync.setLink({ path, linkedAt: new Date().toISOString(), lastSync: new Date().toISOString() });
      DB.log('Sync', 'Sync', 'Uploaded ' + data.settings.company, path);
      DB.save();
    } finally { GDrive.interactive = false; }
  },
  /** Other devices: replace this company's data with the shared copy and link it. */
  async linkExisting(path) {
    const cfg = Sync.cfg();
    GDrive.interactive = true;
    try {
      const remote = await Store().get(cfg, path);
      if (!remote) throw new Error('That file no longer exists.');
      const data = migrate(await Crypt.unpack(remote.text, cfg.pass));
      Sync.setLink({ path, linkedAt: new Date().toISOString(), lastSync: new Date().toISOString() });
      Sync.setBase(data);
      Sync.applying = true;
      try { DB.data = data; DB.save(); } finally { Sync.applying = false; }
    } finally { GDrive.interactive = false; }
  },
  unlink() { Sync.setLink(null); try { localStorage.removeItem(Sync.baseKey()); } catch (e) { /* ignore */ } },

  init() {
    Sync.setStatus(Sync.enabled() ? (Store() === GDrive && !GDrive.token() ? 'auth' : 'ok') : 'off');
    if (!Sync.enabled()) return;
    if (Store() === GDrive) GDrive.loadLib().catch(() => {});   // ready for a quick sign-in tap
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
const SYNC_MODES = [['gscript', 'Google Drive · automatic'], ['gdrive', 'Google Drive · sign-in'], ['github', 'GitHub']];
route('/control/sync', (el, q) => {
  const c = Sync.cfg(), link = Sync.link();
  const provider = q.via || (Sync.connected() ? provOf(c) : 'gscript');
  const connectedHere = Sync.connected() && provOf(c) === provider;
  const clientId = c.clientId || (typeof CFO_CONFIG !== 'undefined' && CFO_CONFIG.googleClientId) || '';
  if (provider === 'gscript' && !c.scriptKey && !connectedHere) { c.scriptKey = GScript.newKey(); Sync.setCfg(c); }
  const pass = `${UI.field('Sync passphrase (same on every device)', `<input name="pass" type="password" autocomplete="new-password" value="${E(c.pass || '')}" placeholder="Recommended — encrypts your data">`, 'full')}
    ${UI.field('This device\'s name', UI.input('device', c.device || Sync.device()))}`;
  let form = '', help = '';
  if (provider === 'gscript') {
    form = `<p class="small muted">Fully automatic: a small helper in your own Google account saves your books to the <b>“CFO System”</b> folder in your Google Drive (daily backups in <b>CFO System › Backups</b>). No sign-in pop-ups, ever.</p>
      <div class="form-grid mt">
        ${UI.field('Helper web app URL — or the connection code from your other device', UI.input('script', connectedHere ? c.scriptUrl : '', 'placeholder="https://script.google.com/macros/s/…/exec   or   CFO1-…" autocapitalize="off" autocorrect="off"'), 'full')}
        ${pass}
      </div>`;
    help = `<div class="card"><h2>First device: set up the helper (once)</h2>
      <ol style="line-height:1.9">
        <li><button type="button" class="btn sm primary" id="copyCode">Copy helper code</button> <span class="small muted">(it contains this device's secret key — keep it private)</span></li>
        <li>Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com → New project</a> with the Google account whose Drive you want to use. Click <b>Untitled project</b> at the top and name it <b>CFO Sync Helper</b>.</li>
        <li>Select all the sample code in the editor, delete it, <b>paste</b> the copied code, and click the <b>💾 Save</b> icon.</li>
        <li>Click <b>Deploy → New deployment</b> → the ⚙ gear next to “Select type” → <b>Web app</b>. Set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then <b>Deploy</b>.</li>
        <li>Click <b>Authorize access</b> → choose your account → <b>Advanced</b> → <b>Go to CFO Sync Helper (unsafe)</b> → <b>Allow</b>. (Google shows this warning for any script you write yourself.)</li>
        <li>Copy the <b>Web app URL</b> (ends with <code>/exec</code>), paste it above, choose a passphrase, and click <b>Connect</b>.</li>
      </ol>
      <p class="small muted">“Anyone” only means the helper can be reached; it refuses every request that doesn't carry your secret key, and your data is also encrypted with your passphrase.</p>
      <h2 class="mt">Other devices (phone)</h2>
      <p>On the first device, after connecting, click <b>Copy connection code</b> (section 2) and send it to your phone (e.g. WhatsApp to yourself or email). On the phone, paste it in the box above, enter the <b>same passphrase</b> and click <b>Connect</b>.</p></div>`;
  } else if (provider === 'gdrive') {
    form = `<p class="small muted">Saves to the <b>“CFO System”</b> folder in your Google Drive. Google sign-in lasts about an hour; after that, tap the orange sync icon once.</p>
      <div class="form-grid mt">${UI.field('Google Client ID', UI.input('clientId', clientId, 'placeholder="xxxxxxxx.apps.googleusercontent.com" autocapitalize="off" autocorrect="off"'), 'full')}${pass}</div>`;
    help = `<div class="card"><h2>Google Client ID</h2><p class="muted">Created once in Google Cloud Console (APIs & Services → Google Auth Platform → Clients → Web application), with authorized JavaScript origin <code>${E(location.origin)}</code>.</p></div>`;
  } else {
    form = `<p class="small muted">Saves to a <b>private</b> GitHub repository.</p>
      <div class="form-grid mt">
        ${UI.field('Data repository (owner/name)', UI.input('repo', c.repo || '', 'placeholder="yourname/cfo-data" autocapitalize="off" autocorrect="off"'), 'full')}
        ${UI.field('GitHub access token', `<input name="token" type="password" autocomplete="off" value="${E(c.token || '')}" placeholder="github_pat_…">`, 'full')}
        ${pass}
      </div>`;
    help = `<div class="card"><h2>GitHub access token</h2><ol style="line-height:1.9">
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → new fine-grained token</a>; name <b>CFO sync</b>, expiry up to 1 year.</li>
        <li>Repository access: <b>Only select repositories</b> → your data repository.</li>
        <li>Permissions → <b>Contents: Read and write</b> → <b>Generate token</b>, copy and paste above.</li></ol></div>`;
  }
  el.innerHTML = `${UI.pageHead('Sync (PC & phone)', [['Control Panel', '#/control'], ['Sync']])}
    <div class="alert info">Sync keeps the same books on your PC and phone. Each device works offline; changes are merged automatically a few seconds after you save, when the app opens, and every 2 minutes while it's open.</div>
    <div class="tabs">${SYNC_MODES.map(([k, l]) => `<a href="#/control/sync?via=${k}" class="${provider === k ? 'active' : ''}">${E(l)}${k === 'gscript' ? ' ★' : ''}</a>`).join('')}</div>
    <div class="grid g2">
      <form class="card" id="conn"><h2>1 · Connect this device</h2>${form}
        <p class="small muted">These settings stay on this device only — never in backups or the synced data. If you forget the passphrase, the synced copy can't be opened (each device still has its own copy).</p>
        <div class="btn-row mt"><button class="btn primary">${connectedHere ? 'Save' : provider === 'gdrive' ? 'Sign in with Google & save' : 'Connect'}</button>${Sync.connected() ? '<button type="button" class="btn danger" id="disc">Disconnect this device</button>' : ''}</div>
      </form>
      <div class="card"><h2>2 · Sync this company</h2><div id="co" class="mt">${connectedHere ? '<p class="muted">Checking…</p>' : '<p class="muted">Connect this device first.</p>'}</div></div>
    </div>${help}`;

  const cc = $('#copyCode', el);
  if (cc) cc.onclick = async () => {
    try {
      const code = await GScript.scriptText(Sync.cfg().scriptKey);
      await navigator.clipboard.writeText(code);
      UI.toast('Helper code copied — paste it into the Apps Script editor', 'ok');
    } catch (err) {
      try { const code = await GScript.scriptText(Sync.cfg().scriptKey); UI.modal('Helper code', `<p class="small muted">Copy all of this text:</p><textarea readonly style="width:100%;height:300px;font-family:monospace;font-size:12px">${E(code)}</textarea>`); }
      catch (e2) { UI.toast(err.message, 'err'); }
    }
  };
  const conn = $('#conn', el);
  conn.onsubmit = async e => {
    e.preventDefault();
    const v = UI.formValues(conn);
    const btn = $('button.primary', conn); const label = btn.textContent; btn.disabled = true; btn.textContent = 'Connecting…';
    const old = Sync.cfg();
    const switching = Sync.connected() && provOf(old) !== provider && Object.keys(old.links || {}).length;
    const name = k => (SYNC_MODES.find(m => m[0] === k) || [k, k])[1];
    if (switching && !confirm(`Switch this device from ${name(provOf(old))} to ${name(provider)}? Companies will need to be uploaded or linked again.`)) { btn.disabled = false; btn.textContent = label; return; }
    try {
      let next, info;
      if (provider === 'gscript') {
        const fromCode = GScript.parseCode(v.script);
        const url = fromCode ? fromCode.scriptUrl : (v.script || '').trim();
        const key = fromCode ? fromCode.scriptKey : old.scriptKey;
        if (!GScript.validUrl(url)) throw new Error('Paste the Web app URL (https://script.google.com/macros/s/…/exec) or a connection code starting with CFO1-');
        next = { provider, scriptUrl: url, scriptKey: key, pass: v.pass, device: v.device };
        info = await GScript.check(next);
      } else if (provider === 'gdrive') {
        const id = (v.clientId || '').trim();
        if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error('The Client ID should end with .apps.googleusercontent.com');
        next = { provider, clientId: id, pass: v.pass, device: v.device };
        if (old.clientId !== id) { localStorage.removeItem('cfo-gtoken'); GDrive.folders = {}; }
        GDrive.interactive = true;
        info = await GDrive.check(next);
        next.gconnected = true;
      } else {
        const repo = (v.repo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
        if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repository should look like owner/name');
        if (!v.token) throw new Error('Enter the access token');
        info = await GH.check({ repo, token: v.token });
        if (!info.private && !confirm('This repository is PUBLIC — anyone could download your data file. Continue anyway?')) return;
        next = { provider, repo, token: v.token, pass: v.pass, device: v.device };
      }
      if (switching) { Object.keys(old.links).forEach(k => { try { localStorage.removeItem(k + ':syncbase'); } catch (er) { /* ignore */ } }); old.links = {}; }
      if (old.pass && old.pass !== v.pass && Sync.link()) UI.toast('Passphrase changed — the next sync re-encrypts the synced copy. Use the same new passphrase on your other devices.');
      Sync.setCfg(Object.assign(old, next));
      UI.toast(`Connected to ${info.fullName}${info.account ? ' (' + info.account + ')' : ''}`, 'ok');
      location.hash = '#/control/sync'; render();
    } catch (err) { UI.toast(err.message, 'err'); }
    finally { GDrive.interactive = false; btn.disabled = false; btn.textContent = label; }
  };
  const disc = $('#disc', el);
  if (disc) disc.onclick = () => {
    if (!confirm('Disconnect this device from sync? Its data stays here; it just stops syncing.')) return;
    const cfg = Sync.cfg(); Object.keys(cfg.links || {}).forEach(k => { try { localStorage.removeItem(k + ':syncbase'); } catch (er) { /* ignore */ } });
    GDrive.signOut(); localStorage.removeItem(SYNC_KEY); Sync.setStatus('off'); location.hash = '#/control/sync'; render();
  };
  if (!connectedHere) return;
  const co = $('#co', el);
  const phoneCode = provider === 'gscript' ? `<div class="mt"><button class="btn" id="pcode">Copy connection code for your phone</button></div>` : '';
  if (link) {
    co.innerHTML = `<table class="fin"><tbody>
        <tr><td>Company</td><td><b>${E(DB.data.settings.company)}</b></td></tr>
        <tr><td>Saved in</td><td class="small">${E(Sync.where())} › ${E(provider === 'github' ? link.path : 'CFO System/' + link.path.split('/').pop())}</td></tr>
        <tr><td>Last synced</td><td>${link.lastSync ? U.fdatetime(link.lastSync) : '—'}</td></tr>
        ${provider !== 'github' ? `<tr><td>Last daily backup</td><td>${link.lastBackup ? U.fdate(link.lastBackup) : '—'}</td></tr>` : ''}
        <tr><td>Status</td><td>${Sync.status === 'error' ? `<span class="text-red">${E(Sync.lastError)}</span>` : E({ ok: 'Up to date', pending: 'Changes waiting', syncing: 'Syncing…', offline: 'Offline', auth: 'Sign-in needed — press Sync now' }[Sync.status] || '—')}</td></tr>
      </tbody></table>
      ${link.conflicts && link.conflicts.length ? `<div class="alert warn mt">Changed on both devices at the last sync (this device's version was kept):<br><span class="small">${link.conflicts.map(E).join('<br>')}</span></div>` : ''}
      ${link.duplicates && link.duplicates.length ? `<div class="alert err mt">Same document number created on two devices: <b>${link.duplicates.map(E).join(', ')}</b>. Open one and give it a new number.</div>` : ''}
      <div class="btn-row mt"><button class="btn primary" id="now">Sync now</button><button class="btn danger" id="unl">Stop syncing this company</button></div>${phoneCode}`;
    $('#now', co).onclick = async () => { await Sync.run({ manual: true }); render(); };
    $('#unl', co).onclick = () => { if (confirm('Stop syncing this company on this device? The data stays here and in the synced copy.')) { Sync.unlink(); Sync.setStatus('off'); render(); } };
    bindPhoneCode(co);
    return;
  }
  (async () => {
    try {
      GDrive.interactive = false;
      const files = await Store().list(Sync.cfg(), 'companies');
      co.innerHTML = `<p>This company (<b>${E(DB.data.settings.company)}</b>) isn't synced yet. Choose one:</p>
        <div class="btn-row"><button class="btn primary" id="up">Upload this company (first device)</button></div>
        ${files.length ? `<p class="mt">…or link this device to a company already uploaded from another device. <b>This replaces the data on this device</b> with the synced copy.</p>
          ${UI.table([
            { label: 'Synced company', render: f => E(f.name.replace(/-[a-z0-9]{5}\.json$/, '').replace(/-/g, ' ')) + `<div class="small muted">${E(f.name)}</div>` },
            { label: '', cls: 'num', render: f => `<button class="btn sm" data-link="${E(f.path)}">Link & download</button>` },
          ], files)}` : '<p class="muted small mt">No companies uploaded yet — start with "Upload" on the device that has your data.</p>'}${phoneCode}`;
      $('#up', co).onclick = async () => {
        if (files.length && !confirm('Companies are already uploaded. Upload THIS company as a separate one? (To use an existing one, choose "Link & download" instead.)')) return;
        try { await Sync.upload(); UI.toast(`Uploaded to ${Sync.where()} — this company now syncs automatically`, 'ok'); Sync.init(); render(); } catch (err) { UI.toast(err.message, 'err'); }
      };
      $$('[data-link]', co).forEach(b => b.onclick = async () => {
        if (!confirm(`Replace ALL data of "${DB.data.settings.company}" on this device with the synced copy? Export a backup first if this device has data you need.`)) return;
        b.disabled = true;
        try { await Sync.linkExisting(b.dataset.link); UI.toast('Linked — this device now has the synced books', 'ok'); Sync.init(); location.hash = '#/'; render(); }
        catch (err) { UI.toast(err.message, 'err'); b.disabled = false; }
      });
      bindPhoneCode(co);
    } catch (err) {
      co.innerHTML = err.auth ? `<p class="muted">Sign in to Google Drive to see your synced companies.</p><button class="btn primary" id="si">Sign in with Google</button>` : `<div class="alert err">${E(err.message)}</div>`;
      const si = $('#si', co);
      if (si) si.onclick = async () => { try { await GDrive.signIn(Sync.cfg(), true); render(); } catch (e2) { UI.toast(e2.message, 'err'); } };
    }
  })();
  function bindPhoneCode(root) {
    const pc = $('#pcode', root);
    if (!pc) return;
    pc.onclick = async () => {
      const code = GScript.code(Sync.cfg());
      try { await navigator.clipboard.writeText(code); UI.toast('Connection code copied — send it to your phone and paste it on the Sync page there', 'ok'); }
      catch (e) { UI.modal('Connection code for your phone', `<p class="small muted">Copy this and send it to your phone. Keep it private — it lets a device use your sync helper.</p><textarea readonly style="width:100%;height:110px;font-family:monospace;font-size:12px">${E(code)}</textarea>`); }
    };
  }
});
