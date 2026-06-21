import {
  DEFAULT_SETTINGS,
  DEFAULT_SNAPSHOT,
  buildRequestUrls,
  classifyAqi,
  normalizeSnapshot,
  requestHeaders,
} from './lib/air-quality.js';

const ALARM_NAME = 'refresh-air-quality';

chrome.runtime.onInstalled.addListener(() => initialize({ resetSnapshot: true }));
chrome.runtime.onStartup.addListener(() => initialize());

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) refreshSnapshot();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'air-quality:get-snapshot') {
    chrome.storage.local.get({ snapshot: DEFAULT_SNAPSHOT }).then(result => sendResponse(result.snapshot));
    return true;
  }

  if (message.type === 'air-quality:refresh') {
    refreshSnapshot().then(sendResponse);
    return true;
  }

  if (message.type === 'air-quality:get-settings') {
    chrome.storage.sync.get(DEFAULT_SETTINGS).then(sendResponse);
    return true;
  }

  if (message.type === 'air-quality:save-settings') {
    saveSettings(message.settings)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});

async function initialize({ resetSnapshot = false } = {}) {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  await chrome.storage.sync.set(settings);
  if (resetSnapshot) await chrome.storage.local.set({ snapshot: DEFAULT_SNAPSHOT });
  await scheduleRefresh(settings.refreshMinutes);
  await refreshSnapshot();
}

async function saveSettings(input = {}) {
  const settings = validateSettings({ ...DEFAULT_SETTINGS, ...input });
  await chrome.storage.sync.set(settings);
  await scheduleRefresh(settings.refreshMinutes);
  const snapshot = await refreshSnapshot();
  return { ok: true, connectionOk: snapshot.status === 'ok', settings, snapshot };
}

function validateSettings(settings) {
  const refreshMinutes = Number(settings.refreshMinutes);
  if (!Number.isFinite(refreshMinutes) || refreshMinutes < 15) {
    throw new Error('Refresh interval must be at least 15 minutes.');
  }
  return {
    apiBaseUrl: String(settings.apiBaseUrl || '').trim(),
    apiKey: String(settings.apiKey || '').trim(),
    country: String(settings.country || 'IN').trim().toUpperCase(),
    location: String(settings.location || '').trim(),
    locationId: String(settings.locationId || '').trim(),
    overlayEnabled: Boolean(settings.overlayEnabled),
    refreshMinutes,
  };
}

async function scheduleRefresh(refreshMinutes) {
  const minutes = Math.max(15, Number(refreshMinutes) || DEFAULT_SETTINGS.refreshMinutes);
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: minutes });
}

async function refreshSnapshot() {
  const [settings, stored] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SETTINGS),
    chrome.storage.local.get({ snapshot: DEFAULT_SNAPSHOT }),
  ]);

  let snapshot;
  try {
    snapshot = await fetchAirQualitySnapshot(settings);
  } catch (error) {
    snapshot = failureSnapshot(stored.snapshot, settings, error);
  }

  await chrome.storage.local.set({ snapshot });
  await updateBadge(snapshot);
  return snapshot;
}

async function fetchAirQualitySnapshot(settings) {
  const urls = buildRequestUrls(settings);
  const headers = requestHeaders(settings);

  if (urls.version === 3 && !settings.apiKey) {
    throw new Error('OpenAQ v3 requires an API key. Add one in Settings.');
  }

  if (urls.locationUrl) {
    const [locationPayload, latestPayload] = await Promise.all([
      fetchJson(urls.locationUrl, headers),
      fetchJson(urls.latestUrl, headers),
    ]);
    return normalizeSnapshot(latestPayload, settings, locationPayload);
  }

  return normalizeSnapshot(await fetchJson(urls.latestUrl, headers), settings);
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    if (response.status === 401) throw new Error('API key missing or invalid (HTTP 401).');
    if (response.status === 403) throw new Error('API key is not permitted to access this resource (HTTP 403).');
    throw new Error(`Air-quality API returned HTTP ${response.status}.`);
  }
  return response.json();
}

function failureSnapshot(previous, settings, error) {
  const hasCachedData = previous?.aqi != null || previous?.measurements?.length;
  const message = `Unable to refresh air-quality data: ${String(error?.message || error)}`;
  return {
    ...(hasCachedData ? previous : DEFAULT_SNAPSHOT),
    city: previous?.city || settings.location,
    country: previous?.country || settings.country,
    status: hasCachedData ? 'stale' : 'error',
    lastAttemptAt: new Date().toISOString(),
    message: hasCachedData ? `${message} Showing the last successful reading.` : message,
  };
}

async function updateBadge(snapshot) {
  await chrome.action.setBadgeText({ text: snapshot?.aqi == null ? '—' : String(Math.round(snapshot.aqi)) });
  await chrome.action.setBadgeBackgroundColor({ color: badgeColor(classifyAqi(snapshot?.aqi)) });
}

function badgeColor(category) {
  switch (category) {
    case 'Good': return '#16a34a';
    case 'Satisfactory': return '#84cc16';
    case 'Moderately Polluted': return '#eab308';
    case 'Poor': return '#f97316';
    case 'Very Poor': return '#ef4444';
    case 'Severe': return '#7f1d1d';
    default: return '#64748b';
  }
}
