/**
 * CFO System — Google Drive sync helper (Google Apps Script)
 *
 * Runs in YOUR Google account and saves the CFO System data into the
 * "CFO System" folder of your Google Drive, so the app on your PC and phone
 * can sync automatically without signing in every hour.
 *
 * Only requests that carry the secret key below are accepted.
 * Deploy:  Deploy → New deployment → type "Web app"
 *          Execute as: Me   ·   Who has access: Anyone
 */
var SYNC_KEY = '__SYNC_KEY__';
var ROOT = 'CFO System';
var BACKUPS = 'Backups';
var CLAIMS = 'Claims';      // receipts inbox: CFO System › Claims › <company>
var HELPER_VERSION = 2;

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    if (!req || req.key !== SYNC_KEY || SYNC_KEY.length < 32) throw new Error('Not authorised (wrong connection key).');
    out = handle_(req);
  } catch (err) {
    out = { error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: 'CFO System sync helper' })).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  switch (req.action) {
    case 'ping':
      folder_(null);
      return { ok: true, folder: ROOT, version: HELPER_VERSION, account: Session.getEffectiveUser().getEmail() };
    case 'get': {
      var f = find_(req.path);
      if (!f) return { file: null };
      return { file: { sha: ver_(f), text: f.getBlob().getDataAsString('UTF-8') } };
    }
    case 'put': {
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        var g = find_(req.path);
        if (!req.overwrite) {
          if (req.sha && (!g || ver_(g) !== req.sha)) return { conflict: true };
          if (!req.sha && g) return { conflict: true };
        }
        if (g) {
          g.setContent(req.text);
        } else {
          var w = where_(req.path);
          g = w.folder.createFile(w.name, req.text, 'application/json');
          if (req.message) g.setDescription(req.message);
        }
        return { sha: ver_(DriveApp.getFileById(g.getId())) };
      } finally {
        lock.releaseLock();
      }
    }
    case 'list': {
      var dirFolder = folder_(req.dir === 'backups' ? BACKUPS : null);
      var it = dirFolder.getFiles(), files = [];
      while (it.hasNext()) {
        var x = it.next();
        if (/\.json$/.test(x.getName())) files.push({ type: 'file', name: x.getName(), path: req.dir + '/' + x.getName(), id: x.getId(), modified: x.getLastUpdated().toISOString() });
      }
      return { files: files };
    }
    case 'remove':
      DriveApp.getFileById(req.id).setTrashed(true);
      return { ok: true };

    /* ---- Claims: receipts dropped in CFO System › Claims › <company> ---- */
    case 'claims.inbox': {
      var cf = claimFolder_(req), files = [], ci = cf.getFiles();
      while (ci.hasNext()) {
        var cfile = ci.next(), mt = cfile.getMimeType();
        if (/^image\//.test(mt) || mt === 'application/pdf') files.push({ id: cfile.getId(), name: cfile.getName(), mime: mt, size: cfile.getSize(), modified: cfile.getLastUpdated().toISOString() });
      }
      files.sort(function (a, b) { return a.modified < b.modified ? -1 : 1; });
      return { folderId: cf.getId(), folderUrl: cf.getUrl(), files: files };
    }
    case 'claims.take': {      // move a new receipt out of the inbox so only one device scans it
      var tl = LockService.getScriptLock();
      tl.waitLock(20000);
      try {
        var tf = DriveApp.getFileById(req.id), tcf = claimFolder_(req);
        if (!hasParent_(tf, tcf.getId())) return { taken: false };
        tf.moveTo(sub_(tcf, 'Scanned'));
        return { taken: true, url: tf.getUrl() };
      } finally { tl.releaseLock(); }
    }
    case 'claims.file': {
      var rf = claimFile_(req.id);
      if (rf.getSize() > 20 * 1024 * 1024) throw new Error('Receipt file is larger than 20 MB.');
      return { name: rf.getName(), mime: rf.getMimeType(), url: rf.getUrl(), data: Utilities.base64Encode(rf.getBlob().getBytes()) };
    }
    case 'claims.move': {      // to: Scanned | Approved | Rejected
      if (['Scanned', 'Approved', 'Rejected'].indexOf(req.to) < 0) throw new Error('Bad folder');
      var mf = claimFile_(req.id);
      mf.moveTo(sub_(claimFolder_(req), req.to));
      return { ok: true };
    }
    case 'claims.upload': {    // receipt photo taken in the app → goes into the inbox
      var uf = claimFolder_(req);
      var blob = Utilities.newBlob(Utilities.base64Decode(req.data), req.mime, String(req.name || 'receipt').replace(/[\\\/]/g, '-'));
      return { id: uf.createFile(blob).getId() };
    }
    default:
      throw new Error('Unknown action: ' + req.action);
  }
}

function folder_(sub) {
  var roots = DriveApp.getFoldersByName(ROOT);
  var root = roots.hasNext() ? roots.next() : DriveApp.createFolder(ROOT);
  if (!sub) return root;
  var subs = root.getFoldersByName(sub);
  return subs.hasNext() ? subs.next() : root.createFolder(sub);
}

/** Claims folder for one company (remembered by id, so renaming the company is fine). */
function claimFolder_(req) {
  if (req.folderId) {
    try { var byId = DriveApp.getFolderById(req.folderId); if (!byId.isTrashed()) return byId; } catch (e) { /* recreate below */ }
  }
  var name = String(req.company || 'Company').replace(/[\\\/:*?"<>|]/g, '-').trim() || 'Company';
  return sub_(folder_(CLAIMS), name);
}

function sub_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function hasParent_(file, folderId) {
  var p = file.getParents();
  while (p.hasNext()) if (p.next().getId() === folderId) return true;
  return false;
}

/** Only files inside CFO System › Claims can be read or moved. */
function claimFile_(id) {
  var f = DriveApp.getFileById(id), claimsId = folder_(CLAIMS).getId();
  var level = f.getParents();
  for (var depth = 0; depth < 3 && level.hasNext(); depth++) {
    var p = level.next();
    if (p.getId() === claimsId) return f;
    level = p.getParents();
  }
  throw new Error('That file is not in the Claims folder.');
}

function where_(path) {
  var parts = String(path).split('/');
  if (parts.length !== 2 || !/^[\w.-]+\.json$/.test(parts[1])) throw new Error('Bad file path');
  return { folder: folder_(parts[0] === 'backups' ? BACKUPS : null), name: parts[1] };
}

function find_(path) {
  var w = where_(path);
  var it = w.folder.getFilesByName(w.name);
  while (it.hasNext()) { var f = it.next(); if (!f.isTrashed()) return f; }
  return null;
}

function ver_(f) {
  return f.getId() + ':' + f.getLastUpdated().getTime() + ':' + f.getSize();
}

/** Optional: run once from the editor to check access (View → Logs). */
function test() {
  Logger.log(JSON.stringify(handle_({ action: 'ping' })));
}
