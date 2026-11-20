// Turns a place name into coordinates with the Open-Meteo Geocoding API
// (free, no API key). Results are saved in the locations table, so each place
// is sent to Open-Meteo only once.
// API docs: https://open-meteo.com/en/docs/geocoding-api
const { getSql } = require('./db');

const GEOCODING_URL = process.env.GEOCODING_URL || 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEOUT_MS = 3000;

class GeocodingUnavailableError extends Error {}

// 'New  Cairo ' -> 'new cairo'. The same rule is used in the near-me SQL.
function locationKey(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function findCached(key) {
  const sql = getSql();
  const rows = await sql`
    SELECT name, country, latitude, longitude
    FROM locations WHERE query_key = ${key}`;
  return rows[0] || null;
}

async function askOpenMeteo(text) {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set('name', text);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new GeocodingUnavailableError(`Open-Meteo answered ${response.status}`);
    }
    const data = await response.json();
    const place = Array.isArray(data.results) ? data.results[0] : null;
    if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') {
      return null;
    }
    return {
      name: String(place.name || text).slice(0, 100),
      country: place.country ? String(place.country).slice(0, 100) : null,
      latitude: place.latitude,
      longitude: place.longitude
    };
  } catch (error) {
    if (error instanceof GeocodingUnavailableError) throw error;
    throw new GeocodingUnavailableError(error.name === 'AbortError' ? 'Open-Meteo timed out' : 'Open-Meteo not reachable');
  } finally {
    clearTimeout(timer);
  }
}

// Returns { location: { name, country, latitude, longitude }, cached } or null if the
// place does not exist. Throws GeocodingUnavailableError if Open-Meteo is down.
async function resolveLocation(text) {
  const key = locationKey(text);
  const cached = await findCached(key);
  if (cached) {
    return { location: cached, cached: true };
  }

  const place = await askOpenMeteo(text.trim());
  if (!place) {
    return null;
  }

  const sql = getSql();
  // ON CONFLICT: two requests for the same new place at once both succeed.
  const rows = await sql`
    INSERT INTO locations (query_key, name, country, latitude, longitude)
    VALUES (${key}, ${place.name}, ${place.country}, ${place.latitude}, ${place.longitude})
    ON CONFLICT (query_key) DO UPDATE SET query_key = EXCLUDED.query_key
    RETURNING name, country, latitude, longitude`;
  return { location: rows[0], cached: false };
}

module.exports = { resolveLocation, locationKey, GeocodingUnavailableError };
