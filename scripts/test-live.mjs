import fs from 'node:fs/promises';

import {
  DEFAULT_SETTINGS,
  buildRequestUrls,
  normalizeSnapshot,
  requestHeaders,
} from '../lib/air-quality.js';

const env = await readEnv('.env');
const settings = { ...DEFAULT_SETTINGS, apiKey: env.OPENAQ_API_KEY || process.env.OPENAQ_API_KEY || '' };
if (!settings.apiKey) throw new Error('OPENAQ_API_KEY is required in .env or the process environment.');

const urls = buildRequestUrls(settings);
const headers = requestHeaders(settings);
const [locationPayload, latestPayload] = await Promise.all([
  fetchJson(urls.locationUrl, headers),
  fetchJson(urls.latestUrl, headers),
]);
const snapshot = normalizeSnapshot(latestPayload, settings, locationPayload);

console.log(`OpenAQ live check passed: ${snapshot.city}, ${snapshot.measurements.length} measurements, AQI ${snapshot.aqi ?? 'unavailable'}.`);

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = typeof payload?.detail === 'string' ? ` ${payload.detail}` : '';
    throw new Error(`OpenAQ returned HTTP ${response.status} for ${new URL(url).pathname}.${detail}`);
  }
  return response.json();
}

async function readEnv(file) {
  try {
    const source = await fs.readFile(file, 'utf8');
    return Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      return match ? [[match[1], match[2]]] : [];
    }));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
