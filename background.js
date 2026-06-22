import {
  DEFAULT_SETTINGS,
  DEFAULT_SNAPSHOT,
  buildRequestUrls,
  buildOaqRequestUrl,
  classifyAqi,
  isOaqSource,
  normalizeOaqSnapshot,
  normalizeSnapshot,
  requestHeaders,
  validateSettings,
} from './lib/air-quality.js';

const OAQ_BROKER_URL = 'https://us-central1-oaqdms.cloudfunctions.net/brokerData';

const ALARM_NAME = 'refresh-air-quality';

chrome.runtime.onInstalled.addListener(() => initialize({ resetSnapshot: true }));
chrome.runtime.onStartup.addListener(() => initialize());

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) refreshSnapshot();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

  if (message.type === 'air-quality:get-options-settings') {
    if (!isExtensionPage(sender)) {
      sendResponse({ error: 'Credential access is restricted to extension pages.' });
      return;
    }
    getSettingsWithCredentials().then(sendResponse);
    return true;
  }

  if (message.type === 'air-quality:save-settings') {
    if (!isExtensionPage(sender)) {
      sendResponse({ ok: false, error: 'Settings can only be changed from an extension page.' });
      return;
    }
    saveSettings(message.settings)
      .then(sendResponse)
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});

async function initialize({ resetSnapshot = false } = {}) {
  const stored = await chrome.storage.sync.get({ ...DEFAULT_SETTINGS, apiKey: '' });
  const { apiKey: synchronizedApiKey, ...settings } = stored;
  const local = await chrome.storage.local.get({ apiKey: '' });
  if (!local.apiKey && synchronizedApiKey) await chrome.storage.local.set({ apiKey: synchronizedApiKey });
  await chrome.storage.sync.remove('apiKey');
  await chrome.storage.sync.set(settings);
  if (resetSnapshot) await chrome.storage.local.set({ snapshot: DEFAULT_SNAPSHOT });
  await scheduleRefresh(settings.refreshMinutes);
  await refreshSnapshot();
}

async function saveSettings(input = {}) {
  const validated = validateSettings({ ...DEFAULT_SETTINGS, ...input });
  const { apiKey, ...settings } = validated;
  await Promise.all([
    chrome.storage.sync.set(settings),
    chrome.storage.local.set({ apiKey }),
  ]);
  // Invalidate cached OAQ session whenever settings change (API key may have changed)
  await chrome.storage.local.remove('oaqSession');
  await scheduleRefresh(settings.refreshMinutes);
  const snapshot = await refreshSnapshot();
  return { ok: true, connectionOk: snapshot.status === 'ok', settings: validated, snapshot };
}

async function getSettingsWithCredentials() {
  const [settings, credentials] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SETTINGS),
    chrome.storage.local.get({ apiKey: '' }),
  ]);
  return { ...settings, apiKey: credentials.apiKey };
}

async function scheduleRefresh(refreshMinutes) {
  const minutes = Math.max(15, Number(refreshMinutes) || DEFAULT_SETTINGS.refreshMinutes);
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: minutes });
}

async function refreshSnapshot() {
  const [settings, stored] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SETTINGS),
    chrome.storage.local.get({ snapshot: DEFAULT_SNAPSHOT, apiKey: '' }),
  ]);
  const requestSettings = { ...settings, apiKey: stored.apiKey };

  let snapshot;
  try {
    snapshot = await fetchAirQualitySnapshot(requestSettings);
  } catch (error) {
    snapshot = failureSnapshot(stored.snapshot, settings, error);
  }

  await chrome.storage.local.set({ snapshot });
  await updateBadge(snapshot);
  return snapshot;
}

function isExtensionPage(sender) {
  return sender?.id === chrome.runtime.id && sender?.url?.startsWith(chrome.runtime.getURL(''));
}

async function fetchAirQualitySnapshot(settings) {
  if (isOaqSource(settings)) {
    if (!settings.apiKey) throw new Error('An API key is required for OAQ. Add one in Settings.');
    const signatureParams = await getOaqSession(settings.apiKey);
    const url = buildOaqRequestUrl(settings, signatureParams);
    const payload = await fetchJson(url, { accept: 'application/json' });
    return normalizeOaqSnapshot(payload, settings);
  }

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

async function getOaqSession(apiKey) {
  const { oaqSession } = await chrome.storage.local.get({ oaqSession: null });

  // Reuse cached session if it has more than 5 minutes left
  if (oaqSession?.signatureParams && Number(oaqSession.expiresAt) > Date.now() + 5 * 60 * 1000) {
    return oaqSession.signatureParams;
  }

  const brokerUrl = `${OAQ_BROKER_URL}?action=api_session&token=${encodeURIComponent(apiKey)}`;
  const response = await fetch(brokerUrl);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('OAQ API key is invalid or unauthorized (HTTP ' + response.status + ').');
    }
    throw new Error(`OAQ broker returned HTTP ${response.status}.`);
  }

  const session = await response.json();

  // Broker returns { Signature, Expires, KeyName } (Google Cloud CDN signed URL params)
  const signatureParams = {
    Signature: session.Signature ?? session.signature,
    Expires:   session.Expires   ?? session.expires,
    KeyName:   session.KeyName   ?? session.keyName ?? session.key_name,
  };

  if (!signatureParams.Signature || !signatureParams.Expires || !signatureParams.KeyName) {
    throw new Error('OAQ broker returned an unexpected session format: ' + JSON.stringify(session));
  }

  // Expires is a Unix timestamp (seconds); convert to ms for Date.now() comparison
  const expiresAt = Number(signatureParams.Expires) * 1000;
  await chrome.storage.local.set({ oaqSession: { signatureParams, expiresAt } });
  return signatureParams;
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
