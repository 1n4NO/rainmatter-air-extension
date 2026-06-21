import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRequestUrls,
  classifyAqi,
  deriveAqiFromMeasurements,
  normalizeSnapshot,
  pollutantSubIndex,
  requestHeaders,
} from '../lib/air-quality.js';

const settings = {
  apiBaseUrl: 'https://api.openaq.org/v3/',
  apiKey: 'secret-key',
  country: 'IN',
  location: 'Delhi',
  locationId: '8118',
};

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
