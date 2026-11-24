'use strict';
/* =========================================================================
   Installable app (PWA): offline support + "Install app" in the user menu
   ========================================================================= */

const PWA = {
  prompt: null,
  installed() { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; },
  ios() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); },
  canWork() { return 'serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:'; },
};

if (PWA.canWork()) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(err => console.warn('Offline support unavailable:', err)); });
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); PWA.prompt = e; });
window.addEventListener('appinstalled', () => { PWA.prompt = null; UI.toast('CFO System installed', 'ok'); });

function installAppModal() {
  if (PWA.installed()) return UI.toast('You are already using the installed app ✔', 'ok');
  if (PWA.prompt) {
    PWA.prompt.prompt();
    PWA.prompt.userChoice.finally(() => { PWA.prompt = null; });
    return;
  }
  let how;
  if (!PWA.canWork()) {
    how = `<div class="alert warn">This copy was opened ${location.protocol === 'file:' ? 'by double-clicking the file' : 'from an insecure (http) address'}, so it can't be installed. Open it from <b>http://localhost:5173</b> on this PC (run <code>node server.js</code>), or from your secure https web address.</div>`;
  } else if (PWA.ios()) {
    how = `<ol><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with arrow).</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>`;
  } else if (/android/i.test(navigator.userAgent)) {
    how = `<ol><li>Open this page in <b>Chrome</b>.</li><li>Tap the <b>⋮</b> menu.</li><li>Choose <b>Add to Home screen</b> → <b>Install</b>.</li></ol>`;
  } else {
    how = `<ol><li>Use <b>Microsoft Edge</b> or <b>Google Chrome</b>.</li><li>Click the <b>install icon</b> at the right end of the address bar (a monitor with a down-arrow), or open the browser menu → <b>Apps</b> → <b>Install CFO System</b>.</li><li>The app gets its own window, a desktop / Start-menu icon, and works offline.</li></ol>`;
  }
  UI.modal('Install app', `${how}
    <div class="alert info small mt">Each installed copy (PC, phone) keeps <b>its own data</b>. To move data between devices use <b>Control Panel → Backup & Data</b>: Export on one device, Import on the other.</div>`);
}
