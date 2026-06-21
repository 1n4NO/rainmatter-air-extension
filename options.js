const defaults = {
  apiBaseUrl: 'https://api.openaq.org/v3',
  apiKey: '',
  country: 'IN',
  location: 'Delhi',
  locationId: '8118',
  overlayEnabled: true,
  refreshMinutes: 30,
};

await load();

document.getElementById('save').addEventListener('click', save);
document.getElementById('refresh').addEventListener('click', async () => {
  await runWithStatus('Refreshing…', async () => {
    const snapshot = await chrome.runtime.sendMessage({ type: 'air-quality:refresh' });
    if (snapshot.status !== 'ok') throw new Error(snapshot.message);
    return 'Snapshot refreshed.';
  });
});
document.getElementById('toggleApiKey').addEventListener('click', toggleApiKey);

async function load() {
  const settings = await chrome.runtime.sendMessage({ type: 'air-quality:get-settings' });
  apply({ ...defaults, ...settings });
}

async function save() {
  await runWithStatus('Saving and testing settings…', async () => {
    const response = await chrome.runtime.sendMessage({ type: 'air-quality:save-settings', settings: read() });
    if (!response?.ok) throw new Error(response?.error || response?.snapshot?.message || 'Unable to save settings.');
    return 'Settings saved and connection verified.';
  });
}

function read() {
  return {
    apiBaseUrl: document.getElementById('apiBaseUrl').value.trim(),
    apiKey: document.getElementById('apiKey').value.trim(),
    country: document.getElementById('country').value.trim().toUpperCase() || 'IN',
    location: document.getElementById('location').value.trim(),
    locationId: document.getElementById('locationId').value.trim(),
    overlayEnabled: document.getElementById('overlayEnabled').checked,
    refreshMinutes: Number(document.getElementById('refreshMinutes').value) || defaults.refreshMinutes,
  };
}

function apply(settings) {
  document.getElementById('apiBaseUrl').value = settings.apiBaseUrl;
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('country').value = settings.country;
  document.getElementById('location').value = settings.location;
  document.getElementById('locationId').value = settings.locationId;
  document.getElementById('overlayEnabled').checked = Boolean(settings.overlayEnabled);
  document.getElementById('refreshMinutes').value = settings.refreshMinutes;
}

function toggleApiKey() {
  const input = document.getElementById('apiKey');
  const button = document.getElementById('toggleApiKey');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  button.textContent = showing ? 'Show' : 'Hide';
  button.setAttribute('aria-label', `${showing ? 'Show' : 'Hide'} API key`);
}

async function runWithStatus(pendingMessage, action) {
  const status = document.getElementById('status');
  status.textContent = pendingMessage;
  status.dataset.state = 'pending';
  try {
    status.textContent = await action();
    status.dataset.state = 'success';
  } catch (error) {
    status.textContent = String(error?.message || error);
    status.dataset.state = 'error';
  }
}
