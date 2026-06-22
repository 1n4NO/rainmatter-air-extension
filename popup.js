const refreshButton = document.getElementById('refresh');

// 2π × 75 (gauge ring radius)
const GAUGE_CIRC = 471.24;

refreshButton.addEventListener('click', refresh);
document.getElementById('open-source-link').addEventListener('click', event => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

initialize();

async function initialize() {
  try {
    render(await send({ type: 'air-quality:get-snapshot' }));
  } catch (error) {
    renderFailure(error);
  }
}

async function refresh() {
  refreshButton.disabled = true;
  refreshButton.classList.add('spinning');
  setState('loading', 'Refreshing…');
  try {
    render(await send({ type: 'air-quality:refresh' }));
  } catch (error) {
    renderFailure(error);
  } finally {
    refreshButton.disabled = false;
    refreshButton.classList.remove('spinning');
  }
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function render(snapshot = {}) {
  const aqi = snapshot.aqi == null ? null : Math.round(snapshot.aqi);

  // Animate the AQI counter and gauge ring
  countTo(document.getElementById('aqi'), aqi);
  updateGauge(aqi);

  // Update the score color CSS variable so gauge, number, glow all change together
  document.documentElement.style.setProperty('--score-color', categoryColor(snapshot.category));

  document.getElementById('score-label').textContent =
    snapshot.aqiKind === 'indicative' ? 'Indicative AQI' : 'Current AQI';
  document.getElementById('category').textContent = snapshot.category || 'Unknown';
  document.getElementById('message').textContent = snapshot.message || '';
  document.getElementById('location').textContent =
    [snapshot.city, snapshot.country].filter(Boolean).join(', ') || '—';
  document.getElementById('source').textContent = snapshot.source || '—';
  document.querySelector('.scorecard').dataset.category = slug(snapshot.category);

  const updated = document.getElementById('updated');
  updated.textContent = formatFreshness(snapshot.updatedAt);
  updated.title = snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString() : '';

  if (snapshot.status === 'ok')
    setState('ok', snapshot.aqiKind === 'indicative' ? 'Indicative · latest reading' : 'Latest reading');
  else if (snapshot.status === 'stale') setState('stale', 'Stale · last successful reading');
  else if (snapshot.status === 'error') setState('error', 'Data unavailable');
  else setState('loading', 'Loading cached reading…');

  renderMeasurements(snapshot.measurements);
}

function renderMeasurements(measurements) {
  const container = document.getElementById('measurements');
  const items = Array.isArray(measurements) ? measurements : [];
  container.innerHTML = items.length
    ? items.map((item, i) => `
        <div class="measurement" style="animation-delay:${i * 0.06}s">
          <span class="m-label">${escapeHtml((item.parameter || 'unknown').toUpperCase())}</span>
          <span class="m-value">${escapeHtml(formatValue(item.value))}<em>${escapeHtml(item.unit || '')}</em></span>
        </div>`).join('')
    : `<div class="measurement">
         <span class="m-label">No measurements</span>
         <span class="m-value" style="font-size:12px;font-weight:400;color:var(--tx2)">Check Settings</span>
       </div>`;
}

function renderFailure(error) {
  document.getElementById('message').textContent =
    String(error?.message || error || 'Unable to load data.');
  setState('error', 'Extension error');
}

function setState(state, message) {
  const el = document.getElementById('snapshot-state');
  el.dataset.state = state;
  el.textContent = message;
}

// ─── Gauge animation ──────────────────────────────────────────────────────

function updateGauge(aqi) {
  const ring = document.getElementById('gauge-ring');
  if (!ring) return;
  if (aqi == null) {
    ring.style.strokeDashoffset = GAUGE_CIRC;
    return;
  }
  const progress = Math.min(Math.max(aqi / 500, 0), 1);
  ring.style.strokeDashoffset = GAUGE_CIRC * (1 - progress);
}

// ─── Counter animation ────────────────────────────────────────────────────

function countTo(el, target, duration = 750) {
  if (target == null) { el.textContent = '—'; return; }
  const from = parseInt(el.textContent.replace(/\D/g, '')) || 0;
  const to = Math.round(target);
  if (from === to) return;
  const t0 = performance.now();
  (function tick(now) {
    const p = Math.min((now - t0) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3); // ease-out-cubic
    el.textContent = Math.round(from + (to - from) * ease);
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}

// ─── Category helpers ──────────────────────────────────────────────────────

function categoryColor(category) {
  switch (category) {
    case 'Good':                return '#22c55e';
    case 'Satisfactory':        return '#84cc16';
    case 'Moderately Polluted': return '#eab308';
    case 'Poor':                return '#f97316';
    case 'Very Poor':           return '#ef4444';
    case 'Severe':              return '#dc2626';
    default:                    return '#6b9eff';
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────

function formatFreshness(value) {
  if (!value) return '—';
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return 'Invalid date';
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatValue(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value) >= 100
    ? String(Math.round(Number(value)))
    : Number(value).toFixed(1);
}

function slug(value) {
  return String(value || 'unknown').toLowerCase().replace(/\s+/g, '-');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
