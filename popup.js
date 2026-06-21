const refreshButton = document.getElementById('refresh');

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
  refreshButton.textContent = 'Refreshing…';
  setState('loading', 'Refreshing reading…');
  try {
    render(await send({ type: 'air-quality:refresh' }));
  } catch (error) {
    renderFailure(error);
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = 'Refresh';
  }
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function render(snapshot = {}) {
  document.getElementById('aqi').textContent = snapshot.aqi == null ? '—' : Math.round(snapshot.aqi);
  document.getElementById('score-label').textContent = snapshot.aqiKind === 'indicative' ? 'Indicative AQI' : 'Current AQI';
  document.getElementById('category').textContent = snapshot.category || 'Unknown';
  document.getElementById('message').textContent = snapshot.message || 'No data available yet.';
  document.getElementById('location').textContent = [snapshot.city, snapshot.country].filter(Boolean).join(', ') || '—';
  document.getElementById('source').textContent = snapshot.source || '—';
  document.querySelector('.scorecard').dataset.category = slug(snapshot.category);

  const updated = document.getElementById('updated');
  updated.textContent = formatFreshness(snapshot.updatedAt);
  updated.title = snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString() : '';

  if (snapshot.status === 'ok') setState('ok', snapshot.aqiKind === 'indicative' ? 'Latest reading · indicative' : 'Latest reading');
  else if (snapshot.status === 'stale') setState('stale', 'Stale · last successful reading');
  else if (snapshot.status === 'error') setState('error', 'Data unavailable');
  else setState('loading', 'Loading cached reading…');

  renderMeasurements(snapshot.measurements);
}

function renderMeasurements(measurements) {
  const container = document.getElementById('measurements');
  const items = Array.isArray(measurements) ? measurements : [];
  container.innerHTML = items.length
    ? items.map(item => `
      <div class="measurement">
        <div>
          <span class="label">${escapeHtml(item.parameter || 'unknown')}</span>
          <span class="value">${escapeHtml(formatValue(item.value))}</span>
        </div>
        <div class="value">${escapeHtml(item.unit || '')}</div>
      </div>`).join('')
    : '<div class="measurement"><div><span class="label">No measurements</span><span class="value">Check Settings</span></div></div>';
}

function renderFailure(error) {
  document.getElementById('message').textContent = String(error?.message || error || 'Unable to load data.');
  setState('error', 'Extension error');
}

function setState(state, message) {
  const element = document.getElementById('snapshot-state');
  element.dataset.state = state;
  element.textContent = message;
}

function formatFreshness(value) {
  if (!value) return '—';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Invalid date';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatValue(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value) >= 100 ? String(Math.round(Number(value))) : Number(value).toFixed(1);
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
