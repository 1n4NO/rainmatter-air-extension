const snapshot = await send({ type: 'air-quality:get-snapshot' });

const refreshButton = document.getElementById('refresh');
refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  const fresh = await send({ type: 'air-quality:refresh' });
  render(fresh);
  refreshButton.disabled = false;
});

document.getElementById('open-source-link').addEventListener('click', event => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

render(snapshot);

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

function render(data) {
  const snapshot = data || {};
  document.getElementById('aqi').textContent = snapshot.aqi == null ? '—' : Math.round(snapshot.aqi);
  document.getElementById('category').textContent = snapshot.category || 'Unknown';
  document.getElementById('message').textContent = snapshot.message || 'No data available yet.';
  document.getElementById('location').textContent = [snapshot.city, snapshot.country].filter(Boolean).join(', ') || '—';
  document.getElementById('updated').textContent = snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString() : '—';
  document.getElementById('source').textContent = snapshot.source || '—';

  const container = document.getElementById('measurements');
  const items = Array.isArray(snapshot.measurements) ? snapshot.measurements : [];
  container.innerHTML = items.length
    ? items.map(item => `
      <div class="measurement">
        <div>
          <span class="label">${escapeHtml(item.parameter || 'unknown')}</span>
          <span class="value">${escapeHtml(formatValue(item.value, item.unit))}</span>
        </div>
        <div class="value">${escapeHtml(item.unit || '')}</div>
      </div>`).join('')
    : '<div class="measurement"><div><span class="label">No measurements</span><span class="value">Check settings</span></div></div>';
}

function formatValue(value, unit) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const rounded = Number(value) >= 100 ? Math.round(Number(value)) : Number(value).toFixed(1);
  return unit ? `${rounded} ${unit}` : rounded;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
