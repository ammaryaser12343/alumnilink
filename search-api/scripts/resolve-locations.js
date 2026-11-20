// Looks up every profile location that is not in the locations table yet, using
// the Open-Meteo Geocoding API, so near-me search works on existing data
// (for example right after running seed.sql).
// Usage (from search-api/):  npm run resolve-locations
require('dotenv').config();

const { getSql } = require('../services/db');
const { resolveLocation, locationKey } = require('../services/geocoding');

async function main() {
  const sql = getSql();
  const rows = await sql`
    SELECT DISTINCT trim(location) AS location FROM alumni_profiles
    WHERE location IS NOT NULL AND length(trim(location)) >= 2`;
  const seen = new Set();

  for (const { location } of rows) {
    const key = locationKey(location);
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const result = await resolveLocation(location);
      if (!result) {
        console.log(`NOT FOUND  ${location}`);
      } else {
        const { name, country, latitude, longitude } = result.location;
        console.log(`${result.cached ? 'CACHED   ' : 'RESOLVED '}  ${location} -> ${name}, ${country} (${latitude}, ${longitude})`);
      }
    } catch (error) {
      console.log(`FAILED     ${location}: ${error.message}`);
    }
    // Be polite to the free API: at most one new lookup per second.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
