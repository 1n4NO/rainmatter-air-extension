import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  buildRequestUrls,
  buildOaqRequestUrl,
  classifyAqi,
  deriveAqiFromMeasurements,
  isOaqSource,
  normalizeOaqSnapshot,
  normalizeSnapshot,
  pollutantSubIndex,
  requestHeaders,
  validateSettings,
} from '../lib/air-quality.js';

const settings = {
  apiBaseUrl: 'https://api.openaq.org/v3/',
  apiKey: 'secret-key',
  country: 'IN',
  location: 'Delhi',
  locationId: '8118',
  provider: 'cpcb',
  overlayEnabled: true,
  refreshMinutes: 30,
};

test('does not include credentials in synchronized default settings', () => {
  assert.equal(Object.hasOwn(DEFAULT_SETTINGS, 'apiKey'), false);
});

test('sanitizes valid settings', () => {
  assert.deepEqual(validateSettings({
    ...settings,
    apiBaseUrl: 'https://api.openaq.org/v3/',
    country: ' in ',
    location: ' Delhi ',
    locationId: ' 8118 ',
    refreshMinutes: '30',
    overlayEnabled: 1,
  }), {
    ...settings,
    apiBaseUrl: 'https://api.openaq.org/v3',
    country: 'IN',
    location: 'Delhi',
    locationId: '8118',
    refreshMinutes: 30,
    overlayEnabled: true,
  });
});

test('rejects invalid settings before persistence', () => {
  assert.throws(() => validateSettings({ ...settings, apiKey: '' }), /API key is required/);
  assert.throws(() => validateSettings({ ...settings, country: 'IND' }), /exactly two letters/);
  assert.throws(() => validateSettings({ ...settings, locationId: 'Delhi' }), /must be numeric/);
  assert.throws(() => validateSettings({ ...settings, refreshMinutes: 5 }), /15 to 1440/);
  assert.throws(() => validateSettings({ ...settings, refreshMinutes: 30.5 }), /whole number/);
});

test('builds OpenAQ v3 location requests', () => {
  assert.deepEqual(buildRequestUrls(settings), {
    locationUrl: 'https://api.openaq.org/v3/locations/8118',
    latestUrl: 'https://api.openaq.org/v3/locations/8118/latest?limit=100',
    version: 3,
  });
});

test('rejects insecure remote API URLs', () => {
  assert.throws(
    () => buildRequestUrls({ ...settings, apiBaseUrl: 'http://example.com' }),
    /must use HTTPS/,
  );
});

test('adds an API key only when configured', () => {
  assert.equal(requestHeaders(settings)['X-API-Key'], 'secret-key');
  assert.equal(requestHeaders({ ...settings, apiKey: '' })['X-API-Key'], undefined);
});

test('calculates CPCB pollutant sub-indices using interpolation', () => {
  assert.equal(pollutantSubIndex({ parameter: 'pm2.5', value: 30, unit: 'µg/m³' }), 50);
  assert.equal(pollutantSubIndex({ parameter: 'pm25', value: 45, unit: 'ug/m3' }), 75);
  assert.equal(pollutantSubIndex({ parameter: 'co', value: 2000, unit: 'µg/m³' }), 100);
  assert.equal(pollutantSubIndex({ parameter: 'pm25', value: 30, unit: 'ppm' }), null);
});

test('uses the worst available pollutant sub-index', () => {
  assert.equal(deriveAqiFromMeasurements([
    { parameter: 'pm25', value: 45, unit: 'µg/m³' },
    { parameter: 'pm10', value: 251, unit: 'µg/m³' },
  ]), 201);
});

test('uses CPCB category names', () => {
  assert.equal(classifyAqi(50), 'Good');
  assert.equal(classifyAqi(100), 'Satisfactory');
  assert.equal(classifyAqi(200), 'Moderately Polluted');
  assert.equal(classifyAqi(300), 'Poor');
  assert.equal(classifyAqi(400), 'Very Poor');
  assert.equal(classifyAqi(401), 'Severe');
});

test('normalizes OpenAQ v3 location and latest payloads', () => {
  const locationPayload = { results: [{
    name: 'New Delhi US Embassy',
    locality: 'New Delhi',
    country: { code: 'IN' },
    provider: { name: 'US EPA AirNow' },
    sensors: [{ id: 42, parameter: { name: 'pm25', units: 'µg/m³' } }],
  }] };
  const latestPayload = { results: [{
    sensorsId: 42,
    value: 45,
    datetime: { utc: '2026-06-21T06:00:00Z' },
  }] };

  const snapshot = normalizeSnapshot(latestPayload, settings, locationPayload);
  assert.equal(snapshot.city, 'New Delhi');
  assert.equal(snapshot.country, 'IN');
  assert.equal(snapshot.source, 'US EPA AirNow');
  assert.equal(snapshot.aqi, 75);
  assert.equal(snapshot.aqiKind, 'indicative');
  assert.equal(snapshot.updatedAt, '2026-06-21T06:00:00Z');
  assert.deepEqual(snapshot.measurements, [{ parameter: 'pm25', value: 45, unit: 'µg/m³' }]);
});

test('rejects payloads without usable measurements', () => {
  assert.throws(
    () => normalizeSnapshot({ results: [] }, settings, { results: [{ sensors: [] }] }),
    /no usable measurements/,
  );
});

// ── OAQ tests ────────────────────────────────────────────────────────────────

const oaqSettings = {
  apiBaseUrl: 'https://oaq.notf.in/v1',
  apiKey: 'oaq_live_zqoyxx94q_mqp1pya2',
  country: 'IN',
  location: 'Bhubaneswar',
  locationId: '14151',
  provider: 'aurassure',
  overlayEnabled: true,
  refreshMinutes: 30,
};

test('detects OAQ source from base URL', () => {
  assert.equal(isOaqSource(oaqSettings), true);
  assert.equal(isOaqSource(settings), false);
});

test('builds OAQ last24h URL with signature string', () => {
  const sig = 'URLPrefix=aHR0cHM6Ly9leGFtcGxl&Expires=9999999999&KeyName=key1&Signature=sig123';
  const url = buildOaqRequestUrl(oaqSettings, sig);
  assert.ok(url.startsWith('https://oaq.notf.in/v1/provider=aurassure/live/sensors/14151/last24h.json'));
  assert.ok(url.includes('Signature=sig123'));
  assert.ok(url.includes('Expires=9999999999'));
  assert.ok(url.includes('KeyName=key1'));
});

test('builds OAQ city map_latest URL when no stationId', () => {
  const citySettings = { ...oaqSettings, locationId: '' };
  const sig = 'URLPrefix=aHR0cHM6Ly9leGFtcGxl&Expires=1&KeyName=k&Signature=s';
  const url = buildOaqRequestUrl(citySettings, sig);
  assert.ok(url.includes('provider=aurassure/live/by_city/bhubaneswar/map_latest.json'));
});

test('normalizes OAQ last24h columnar response', () => {
  const payload = {
    meta: {
      id: '14151', name: 'UCAN - ITER Bbsr', city: 'Bhubaneswar',
      columns: ['timestamp_ist', 'pm25', 'pm10', 'no2', 'so2', 'temp', 'humid'],
      parameters: { pm25: { label: 'PM2.5', unit: 'µg/m³' }, pm10: { label: 'PM10', unit: 'µg/m³' } },
    },
    data: [
      ['2026-04-13T18:45:00+05:30', 7.809, 16.395, null, null, 29.344, 100],
      ['2026-04-13T19:00:00+05:30', 7.676, 16.120, null, null, 29.230, 100],
      ['2026-04-13T19:15:00+05:30', 7.493, 15.732, null, null, 29.094, 100],
    ],
  };
  const snap = normalizeOaqSnapshot(payload, oaqSettings);
  assert.equal(snap.status, 'ok');
  assert.equal(snap.city, 'UCAN - ITER Bbsr');
  assert.equal(snap.updatedAt, new Date('2026-04-13T19:15:00+05:30').toISOString());
  // pm25=7.493 → sub-index 13; pm10=15.732 → sub-index 16 → max = 16
  assert.equal(snap.aqi, 16);
  assert.equal(snap.aqiKind, 'indicative');
  assert.equal(snap.source, 'OAQ / AURASSURE');
  assert.deepEqual(
    snap.measurements.map(m => m.parameter),
    ['pm25', 'pm10'],
  );
});

test('normalizes OAQ city map_latest response', () => {
  const payload = {
    sensors: [
      {
        id: '14151', name: 'UCAN - ITER Bbsr', city: 'Bhubaneswar',
        last_seen: '2026-04-13T19:15:00+05:30',
        pm25: 7.493, pm10: 15.732, no2: null, so2: null,
      },
    ],
    generated_at: '2026-04-13T19:48:33+05:30',
  };
  const snap = normalizeOaqSnapshot(payload, { ...oaqSettings, locationId: '' });
  assert.equal(snap.status, 'ok');
  assert.equal(snap.city, 'UCAN - ITER Bbsr');
  assert.equal(snap.aqi, 16);
});

test('OAQ normalizer rejects empty sensors array', () => {
  assert.throws(
    () => normalizeOaqSnapshot({ sensors: [] }, { ...oaqSettings, locationId: '' }),
    /no sensors/,
  );
});

test('OAQ normalizer rejects last24h with no data rows', () => {
  assert.throws(
    () => normalizeOaqSnapshot({ meta: { columns: ['timestamp_ist', 'pm25'] }, data: [] }, oaqSettings),
    /no data rows/,
  );
});
