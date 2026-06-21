const OVERLAY_ID = 'rainmatter-air-overlay';

let host = null;
let overlayRoot = null;
let dismissed = false;

init();

async function init() {
  const [settings, snapshot] = await Promise.all([
    send({ type: 'air-quality:get-settings' }),
    send({ type: 'air-quality:get-snapshot' }),
  ]);

  applyOverlayState(settings, snapshot);
  chrome.storage.onChanged.addListener(handleStorageChange);
}

function handleStorageChange(changes, areaName) {
  if (areaName === 'local' && changes.snapshot) {
    if (host) render(changes.snapshot.newValue);
    return;
  }

  if (areaName === 'sync' && changes.overlayEnabled) {
    if (changes.overlayEnabled.newValue === false) removeOverlay();
    else if (!dismissed) send({ type: 'air-quality:get-snapshot' }).then(injectOverlay);
  }
}

function applyOverlayState(settings, snapshot) {
  if (settings?.overlayEnabled === false) {
    removeOverlay();
    return;
  }
  injectOverlay(snapshot);
}

function injectOverlay(snapshot) {
  if (dismissed || host || document.getElementById(OVERLAY_ID)) return;

  host = document.createElement('aside');
  host.id = OVERLAY_ID;
  host.setAttribute('aria-label', 'Rainmatter Air quality snapshot');
  setHostStyles(host);

  overlayRoot = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = overlayStyles;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="title">Rainmatter Air</div>
    <div class="score" data-field="score" aria-live="polite">—</div>
    <div class="category" data-field="category">Unknown</div>
    <div class="meta" data-field="meta">Location unavailable</div>
    <div class="state" data-field="state"></div>
    <button type="button" class="close" aria-label="Dismiss air-quality overlay">×</button>
  `;

  panel.querySelector('.close').addEventListener('click', () => {
    dismissed = true;
    removeOverlay();
  });
  overlayRoot.append(style, panel);
  document.documentElement.append(host);
  render(snapshot);
}

function render(snapshot = {}) {
  if (!host || !overlayRoot) return;
  overlayRoot.querySelector('[data-field="score"]').textContent = snapshot.aqi == null ? '—' : Math.round(snapshot.aqi);
  overlayRoot.querySelector('[data-field="category"]').textContent = snapshot.category || 'Unknown';
  overlayRoot.querySelector('[data-field="meta"]').textContent = [snapshot.city, snapshot.country].filter(Boolean).join(', ') || 'Location unavailable';
  overlayRoot.querySelector('[data-field="state"]').textContent = snapshot.status === 'stale' ? 'Last successful reading' : '';
}

function removeOverlay() {
  host?.remove();
  host = null;
  overlayRoot = null;
}

function setHostStyles(element) {
  Object.assign(element.style, {
    all: 'initial',
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
    display: 'block',
  });
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

const overlayStyles = `
  :host { color-scheme: dark; }
  * { box-sizing: border-box; }
  .panel {
    position: relative;
    width: 180px;
    padding: 12px 12px 10px;
    border: 1px solid rgba(123,161,255,0.2);
    border-radius: 16px;
    background: rgba(9,16,30,0.96);
    color: #e7efff;
    box-shadow: 0 16px 40px rgba(0,0,0,0.35);
    font: 12px/1.4 system-ui, sans-serif;
  }
  .title { color: #7da9ff; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; }
  .score { margin-top: 4px; font-size: 42px; font-weight: 800; line-height: 1; }
  .category { margin-top: 4px; font-size: 14px; font-weight: 700; }
  .meta, .state { margin-top: 4px; color: #93a5cb; }
  .state { color: #fbbf24; font-size: 11px; }
  .close {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(255,255,255,0.08);
    color: #e7efff;
    font: 16px/1 system-ui, sans-serif;
    cursor: pointer;
  }
  .close:focus-visible { outline: 2px solid #7da9ff; outline-offset: 2px; }
`;
