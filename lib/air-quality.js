export const DEFAULT_SETTINGS = {
  apiBaseUrl: 'https://api.openaq.org/v3',
  country: 'IN',
  location: 'Delhi',
  locationId: '8118',
  provider: 'cpcb',
  overlayEnabled: true,
  refreshMinutes: 30,
};

export const DEFAULT_SNAPSHOT = {
  status: 'loading',
  city: 'Delhi',
  country: 'IN',
  updatedAt: null,
  lastAttemptAt: null,
  aqi: null,
  aqiKind: null,
  category: 'Unknown',
  source: 'OpenAQ',
  measurements: [],
  message: 'Loading air-quality data…',
};

const AQI_RANGES = {
  pm10: [[0, 50, 0, 50], [51, 100, 51, 100], [101, 250, 101, 200], [251, 350, 201, 300], [351, 430, 301, 400], [431, Infinity, 401, 500]],
  pm25: [[0, 30, 0, 50], [31, 60, 51, 100], [61, 90, 101, 200], [91, 120, 201, 300], [121, 250, 301, 400], [251, Infinity, 401, 500]],
  no2: [[0, 40, 0, 50], [41, 80, 51, 100], [81, 180, 101, 200], [181, 280, 201, 300], [281, 400, 301, 400], [401, Infinity, 401, 500]],
  o3: [[0, 50, 0, 50], [51, 100, 51, 100], [101, 168, 101, 200], [169, 208, 201, 300], [209, 748, 301, 400], [749, Infinity, 401, 500]],
  co: [[0, 1, 0, 50], [1.1, 2, 51, 100], [2.1, 10, 101, 200], [10.1, 17, 201, 300], [17.1, 34, 301, 400], [34.1, Infinity, 401, 500]],
  so2: [[0, 40, 0, 50], [41, 80, 51, 100], [81, 380, 101, 200], [381, 800, 201, 300], [801, 1600, 301, 400], [1601, Infinity, 401, 500]],
  nh3: [[0, 200, 0, 50], [201, 400, 51, 100], [401, 800, 101, 200], [801, 1200, 201, 300], [1201, 1800, 301, 400], [1801, Infinity, 401, 500]],
  pb: [[0, 0.5, 0, 50], [0.6, 1, 51, 100], [1.1, 2, 101, 200], [2.1, 3, 201, 300], [3.1, 3.5, 301, 400], [3.6, Infinity, 401, 500]],
};

export function validateSettings(input = {}) {
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
  const apiUrl = new URL(apiBaseUrl);
  const isOaq = apiUrl.hostname === 'oaq.notf.in';
  const isOpenAq = apiUrl.hostname === 'api.openaq.org';

  const apiKey = String(input.apiKey || '').trim();
  const country = String(input.country || '').trim().toUpperCase();
  const location = String(input.location || '').trim();
  const locationId = String(input.locationId || '').trim();
  const provider = String(input.provider || DEFAULT_SETTINGS.provider).trim().toLowerCase();
  const refreshMinutes = Number(input.refreshMinutes);

  if (!/^[A-Z]{2}$/.test(country)) throw new Error('Country code must contain exactly two letters.');
  if (!location) throw new Error('Display location is required.');
  if (locationId && isOpenAq && !/^\d+$/.test(locationId)) throw new Error('Location ID must be numeric for OpenAQ.');
  if (!Number.isInteger(refreshMinutes) || refreshMinutes < 15 || refreshMinutes > 1440) {
    throw new Error('Refresh interval must be a whole number from 15 to 1440 minutes.');
  }

  if (isOpenAq) {
    if (!apiKey) throw new Error('An API key is required for OpenAQ.');
    if (!locationId) throw new Error('A numeric location ID is required for OpenAQ v3.');
  }

  if (isOaq) {
    if (!apiKey) throw new Error('An API key is required for OAQ.');
    const validProviders = ['cpcb', 'airnet', 'aurassure'];
    if (!validProviders.includes(provider)) {
      throw new Error(`Provider must be one of: ${validProviders.join(', ')}.`);
    }
  }

  return {
    apiBaseUrl,
    apiKey,
    country,
    location,
    locationId,
    provider,
    overlayEnabled: Boolean(input.overlayEnabled),
    refreshMinutes,
  };
}

export function buildRequestUrls(settings) {
  const base = normalizeBaseUrl(settings.apiBaseUrl);
  const locationId = String(settings.locationId || '').trim();

  if (locationId) {
    if (!/^\d+$/.test(locationId)) throw new Error('Location ID must be numeric.');
    const locationUrl = `${base}/locations/${locationId}`;
    return { locationUrl, latestUrl: `${locationUrl}/latest?limit=100`, version: 3 };
  }

  const params = new URLSearchParams({
    country: settings.country || DEFAULT_SETTINGS.country,
    limit: '1',
  });
  const location = String(settings.location || '').trim();
  if (location) params.set(/^\d{6}$/.test(location) ? 'location' : 'city', location);
  return { latestUrl: `${base}/latest?${params.toString()}`, version: 2 };
}

export function requestHeaders(settings) {
  const headers = { accept: 'application/json' };
  const apiKey = String(settings.apiKey || '').trim();
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

export function normalizeSnapshot(payload, settings, locationPayload = null) {
  const isV3 = Boolean(locationPayload);
  const location = isV3 ? firstResult(locationPayload) : null;
  const result = isV3 ? location : firstResult(payload);
  if (!result) throw new Error('The API returned no air-quality location.');

  const measurements = isV3
    ? normalizeV3Measurements(payload, location)
    : normalizeMeasurements(result);
  if (!measurements.length && !Number.isFinite(Number(result.aqi))) {
    throw new Error('The API response contained no usable measurements.');
  }

  const suppliedAqi = Number(result.aqi);
  const calculatedAqi = deriveAqiFromMeasurements(measurements);
  const aqi = Number.isFinite(suppliedAqi) ? suppliedAqi : calculatedAqi;
  const city = location?.locality || location?.name || result.city || settings.location || DEFAULT_SETTINGS.location;
  const country = location?.country?.code || result.country || settings.country || DEFAULT_SETTINGS.country;
  const updatedAt = newestMeasurementDate(payload, result) || new Date().toISOString();
  const category = classifyAqi(aqi);

  return {
    status: 'ok',
    city,
    country,
    updatedAt,
    lastAttemptAt: new Date().toISOString(),
    aqi,
    aqiKind: Number.isFinite(suppliedAqi) ? 'reported' : (aqi == null ? null : 'indicative'),
    category,
    source: location?.provider?.name || result.source || 'OpenAQ',
    measurements,
    message: aqi == null
      ? `Measurements are available for ${city}, but an AQI could not be estimated.`
      : `${Number.isFinite(suppliedAqi) ? 'Reported' : 'Indicative'} air quality in ${city} is ${category.toLowerCase()}.`,
  };
}

export function normalizeMeasurements(result) {
  const list = Array.isArray(result?.measurements)
    ? result.measurements
    : [['pm25', result?.pm25], ['pm10', result?.pm10], ['no2', result?.no2], ['co', result?.co], ['o3', result?.o3], ['so2', result?.so2]];

  return list.flatMap(item => {
    const raw = Array.isArray(item)
      ? { parameter: item[0], value: item[1] }
      : item;
    const value = Number(raw?.value);
    if (!raw || raw.value == null || !Number.isFinite(value)) return [];
    const parameter = normalizeParameter(raw.parameter || raw.name);
    return [{ parameter, value, unit: raw.unit || guessUnit(parameter) }];
  });
}

function normalizeV3Measurements(payload, location) {
  const sensors = new Map((location?.sensors || []).map(sensor => [
    Number(sensor.id),
    { parameter: normalizeParameter(sensor.parameter?.name || sensor.name), unit: sensor.parameter?.units },
  ]));

  return (Array.isArray(payload?.results) ? payload.results : []).flatMap(item => {
    const sensor = sensors.get(Number(item.sensorsId));
    const value = Number(item.value);
    if (!sensor || !Number.isFinite(value)) return [];
    return [{ ...sensor, value, unit: sensor.unit || guessUnit(sensor.parameter) }];
  });
}

export function deriveAqiFromMeasurements(measurements) {
  const subIndices = measurements.map(measurement => pollutantSubIndex(measurement)).filter(Number.isFinite);
  return subIndices.length ? Math.max(...subIndices) : null;
}

export function pollutantSubIndex(measurement) {
  const parameter = normalizeParameter(measurement?.parameter);
  const ranges = AQI_RANGES[parameter];
  let concentration = Number(measurement?.value);
  if (!ranges || !Number.isFinite(concentration) || concentration < 0) return null;

  const unit = normalizeUnit(measurement?.unit);
  if (parameter === 'co' && unit === 'ug/m3') concentration /= 1000;
  else if (parameter === 'co' && unit && unit !== 'mg/m3') return null;
  else if (parameter !== 'co' && unit && unit !== 'ug/m3') return null;

  const range = ranges.find(([, high]) => concentration <= high) || ranges.at(-1);
  const [low, high, indexLow, indexHigh] = range;
  if (high === Infinity) return Math.min(500, Math.round(indexLow + (concentration - low)));
  return Math.min(500, Math.round(((indexHigh - indexLow) / (high - low)) * (concentration - low) + indexLow));
}

export function classifyAqi(aqi) {
  if (!Number.isFinite(Number(aqi))) return 'Unknown';
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Satisfactory';
  if (aqi <= 200) return 'Moderately Polluted';
  if (aqi <= 300) return 'Poor';
  if (aqi <= 400) return 'Very Poor';
  return 'Severe';
}

// ── OAQ (oaq.notf.in) support ────────────────────────────────────────────────

export function isOaqSource(settings) {
  try {
    return new URL(settings.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl).hostname === 'oaq.notf.in';
  } catch { return false; }
}

export function buildOaqRequestUrl(settings, signatureParams) {
  const base = normalizeBaseUrl(settings.apiBaseUrl);
  const provider = String(settings.provider || DEFAULT_SETTINGS.provider).trim().toLowerCase();
  const stationId = String(settings.locationId || '').trim();
  const city = String(settings.location || DEFAULT_SETTINGS.location).trim().toLowerCase();

  const path = stationId
    ? `provider=${encodeURIComponent(provider)}/live/sensors/${encodeURIComponent(stationId)}/last24h.json`
    : `provider=${encodeURIComponent(provider)}/live/by_city/${encodeURIComponent(city)}/map_latest.json`;

  const params = new URLSearchParams(signatureParams);
  return `${base}/${path}?${params.toString()}`;
}

export function normalizeOaqSnapshot(payload, settings) {
  const stationId = String(settings.locationId || '').trim();
  const fallbackCity = String(settings.location || DEFAULT_SETTINGS.location);
  const providerLabel = String(settings.provider || DEFAULT_SETTINGS.provider).toUpperCase();

  let stationName, city, measurements, updatedAt;

  if (stationId) {
    // last24h format:
    // { meta: { id, name, city, columns: ["timestamp_ist","pm25","pm10",...], parameters: {...} },
    //   data: [["2026-04-13T19:15:00+05:30", 7.493, 15.732, null, null, 29.094, 100], ...] }
    const meta = payload?.meta ?? {};
    const columns = Array.isArray(meta.columns) ? meta.columns : [];
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const lastRow = rows.at(-1);
    if (!lastRow) throw new Error('OAQ last24h response contained no data rows.');

    // Map column names → values for the most recent row
    const row = Object.fromEntries(columns.map((col, i) => [col, lastRow[i]]));

    stationName = meta.name || fallbackCity;
    city        = meta.city || fallbackCity;
    updatedAt   = row.timestamp_ist ? new Date(row.timestamp_ist).toISOString() : new Date().toISOString();
    measurements = oaqColumnarRowToMeasurements(row, meta.parameters);
  } else {
    // city map_latest format:
    // { sensors: [{ id, name, last_seen, pm25, pm10, no2, so2, ... }, ...], generated_at }
    const sensors = Array.isArray(payload?.sensors) ? payload.sensors
      : Array.isArray(payload?.stations)            ? payload.stations
      : Array.isArray(payload)                       ? payload
      : [];
    if (!sensors.length) throw new Error('OAQ response contained no sensors for this city.');

    const sensor = sensors[0];
    stationName  = sensor.name  || fallbackCity;
    city         = sensor.city  || fallbackCity;
    updatedAt    = sensor.last_seen ? new Date(sensor.last_seen).toISOString() : new Date().toISOString();
    measurements = oaqSensorToMeasurements(sensor);
  }

  if (!measurements.length) throw new Error('OAQ response contained no usable air-quality measurements.');

  const aqi      = deriveAqiFromMeasurements(measurements);
  const category = classifyAqi(aqi);

  return {
    status: 'ok',
    city: stationName,
    country: settings.country || DEFAULT_SETTINGS.country,
    updatedAt,
    lastAttemptAt: new Date().toISOString(),
    aqi,
    aqiKind: aqi != null ? 'indicative' : null,
    category,
    source: `OAQ / ${providerLabel}`,
    measurements,
    message: aqi == null
      ? `Measurements available for ${stationName}, but AQI could not be estimated.`
      : `Indicative air quality in ${stationName} is ${category.toLowerCase()}.`,
  };
}

// last24h: row is { timestamp_ist, pm25, pm10, no2, so2, temp, humid, ... }
// parametersMeta optionally carries { pm25: { unit: "µg/m³" }, ... }
function oaqColumnarRowToMeasurements(row, parametersMeta) {
  return ['pm25', 'pm10', 'no2', 'so2'].flatMap(param => {
    const value = Number(row[param]);
    if (row[param] == null || !Number.isFinite(value)) return [];
    const unit = parametersMeta?.[param]?.unit ?? 'µg/m³';
    return [{ parameter: param, value, unit }];
  });
}

// map_latest sensor: { pm25, pm10, no2, so2, ... } flat object
function oaqSensorToMeasurements(sensor) {
  return ['pm25', 'pm10', 'no2', 'so2'].flatMap(param => {
    const value = Number(sensor[param]);
    if (sensor[param] == null || !Number.isFinite(value)) return [];
    return [{ parameter: param, value, unit: 'µg/m³' }];
  });
}

// ─────────────────────────────────────────────────────────────────────────────

function normalizeBaseUrl(value) {
  let url;
  try { url = new URL(String(value || DEFAULT_SETTINGS.apiBaseUrl)); }
  catch { throw new Error('API base URL must be a valid URL.'); }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('API base URL must use HTTPS.');
  return url.toString().replace(/\/$/, '');
}

function firstResult(payload) {
  if (Array.isArray(payload?.results)) return payload.results[0];
  if (Array.isArray(payload?.data)) return payload.data[0];
  return payload && typeof payload === 'object' ? payload : null;
}

function newestMeasurementDate(payload, result) {
  const dates = (payload?.results || []).map(item => item?.datetime?.utc || item?.datetime?.local).filter(Boolean).sort();
  return dates.at(-1) || result?.lastUpdated || result?.updatedAt || null;
}

function normalizeParameter(value) {
  return String(value || 'unknown').toLowerCase().replace(/[._\s-]/g, '').replace('pm2.5', 'pm25');
}

function normalizeUnit(value) {
  return String(value || '').toLowerCase().replace('µ', 'u').replace('μ', 'u').replace(/(?:\^3|³)/g, '3').replace(/\s/g, '');
}

function guessUnit(parameter) {
  return normalizeParameter(parameter) === 'co' ? 'mg/m³' : 'µg/m³';
}
