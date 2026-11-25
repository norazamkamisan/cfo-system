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
      return { ok: true, folder: ROOT, account: Session.getEffectiveUser().getEmail() };
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
