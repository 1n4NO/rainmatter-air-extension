const OVERLAY_ID = 'rainmatter-air-overlay';

init();

async function init() {
  const settings = await send({ type: 'air-quality:get-settings' });
  if (settings?.overlayEnabled === false) return;

  const snapshot = await send({ type: 'air-quality:get-snapshot' });
  injectOverlay(snapshot);
}

function injectOverlay(snapshot) {
  if (document.getElementById(OVERLAY_ID)) return;

  const overlay = document.createElement('aside');
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div class="title">Rainmatter Air</div>
    <div class="score">${snapshot?.aqi == null ? '—' : Math.round(snapshot.aqi)}</div>
    <div class="category">${escapeHtml(snapshot?.category || 'Unknown')}</div>
    <div class="meta">${escapeHtml([snapshot?.city, snapshot?.country].filter(Boolean).join(', ') || 'Location unavailable')}</div>
    <button type="button" class="close">×</button>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      width: 180px;
      padding: 12px 12px 10px;
      border-radius: 16px;
      border: 1px solid rgba(123,161,255,0.2);
      background: rgba(9, 16, 30, 0.96);
      color: #e7efff;
      box-shadow: 0 16px 40px rgba(0,0,0,0.35);
      font: 12px/1.4 system-ui, sans-serif;
    }
    #${OVERLAY_ID} .title { color: #7da9ff; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; }
    #${OVERLAY_ID} .score { font-size: 42px; font-weight: 800; line-height: 1; margin-top: 4px; }
    #${OVERLAY_ID} .category { font-size: 14px; font-weight: 700; margin-top: 4px; }
    #${OVERLAY_ID} .meta { color: #93a5cb; margin-top: 4px; }
    #${OVERLAY_ID} .close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 50%;
      background: rgba(255,255,255,0.08);
      color: #e7efff;
      cursor: pointer;
    }
  `;

  overlay.querySelector('.close').addEventListener('click', () => overlay.remove());
  document.documentElement.append(style, overlay);
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
