// Database queries for the Search and Directory service.
// Rules every query follows:
//   - only active alumni accounts with an active profile appear
//   - a filter never matches a field the owner has hidden, so hidden values cannot be guessed
//   - every value goes in as a parameter (sql`...${value}...`), never as SQL text
//   - near-me distance uses only a visible location that is already in the locations table
const { getSql } = require('./db');

// Escape % and _ so a user's text is searched literally inside ILIKE.
function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// near: null, or { latitude, longitude, radiusKm } of the place the user searched around.
async function searchAlumni({ q, location, industry, gradYear, near, sort, page, pageSize }) {
  const sql = getSql();
  const qPattern = q ? likePattern(q) : null;
  const locationPattern = location ? likePattern(location) : null;
  const offset = (page - 1) * pageSize;
  const nearLat = near ? near.latitude : null;
  const nearLng = near ? near.longitude : null;
  const radiusKm = near ? near.radiusKm : null;

  const rows = await sql`
    SELECT
      p.id,
      p.user_id          AS "userId",
      u.name,
      p.graduation_year  AS "graduationYear",
      p.company,
      p.location,
      p.industry,
      p.bio,
      COALESCE(sk.names, '{}')  AS skills,
      h.fields                  AS "hiddenFields",
      ROUND(d.km::numeric, 1)::float8 AS "distanceKm",
      COUNT(*) OVER ()::int     AS "totalCount"
    FROM alumni_profiles p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(array_agg(ps.field_name), '{}') AS fields
      FROM privacy_settings ps
      WHERE ps.profile_id = p.id AND ps.is_visible = FALSE
    ) h ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(s.name ORDER BY s.name) AS names
      FROM alumni_skills a JOIN skills s ON s.id = a.skill_id
      WHERE a.profile_id = p.id
    ) sk ON TRUE
    LEFT JOIN locations l
      ON l.query_key = lower(regexp_replace(trim(p.location), '[[:space:]]+', ' ', 'g'))
    -- Great-circle distance in km (haversine). NULL when there is no near-me search,
    -- the place is not resolved yet, or the owner hid their location.
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN ${nearLat}::float8 IS NULL OR l.id IS NULL OR 'location' = ANY (h.fields) THEN NULL
        ELSE 2 * 6371 * asin(LEAST(1, sqrt(
               power(sin(radians(l.latitude - ${nearLat}::float8) / 2), 2)
             + cos(radians(${nearLat}::float8)) * cos(radians(l.latitude))
             * power(sin(radians(l.longitude - ${nearLng}::float8) / 2), 2))))
      END AS km
    ) d ON TRUE
    WHERE u.role = 'alumni'
      AND u.account_status = 'active'
      AND p.is_active = TRUE
      AND (${nearLat}::float8 IS NULL OR d.km <= ${radiusKm}::float8)
      AND (${qPattern}::text IS NULL
           OR u.name ILIKE ${qPattern}
           OR (NOT 'skills' = ANY (h.fields) AND EXISTS (
                 SELECT 1 FROM alumni_skills a JOIN skills s ON s.id = a.skill_id
                 WHERE a.profile_id = p.id AND s.name ILIKE ${qPattern})))
      AND (${locationPattern}::text IS NULL
           OR (NOT 'location' = ANY (h.fields) AND p.location ILIKE ${locationPattern}))
      AND (${industry}::text IS NULL
           OR (NOT 'industry' = ANY (h.fields) AND p.industry = ${industry}))
      AND (${gradYear}::int IS NULL
           OR (NOT 'graduation_year' = ANY (h.fields) AND p.graduation_year = ${gradYear}))
    ORDER BY
      CASE WHEN ${sort} = 'distance' THEN d.km END ASC NULLS LAST,
      CASE WHEN ${sort} = 'newest' AND NOT 'graduation_year' = ANY (h.fields)
           THEN p.graduation_year END DESC NULLS LAST,
      CASE WHEN ${sort} = 'oldest' AND NOT 'graduation_year' = ANY (h.fields)
           THEN p.graduation_year END ASC NULLS LAST,
      u.name ASC
    LIMIT ${pageSize} OFFSET ${offset}`;

  const total = rows.length > 0 ? rows[0].totalCount : 0;
  return { rows: rows.map(({ totalCount, ...row }) => row), total };
}

async function getAlumnusById(id) {
  const sql = getSql();
  const rows = await sql`
    SELECT
      p.id,
      p.user_id          AS "userId",
      u.name,
      p.graduation_year  AS "graduationYear",
      p.company,
      p.location,
      p.industry,
      p.bio,
      COALESCE(sk.names, '{}')  AS skills,
      h.fields                  AS "hiddenFields"
    FROM alumni_profiles p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(array_agg(ps.field_name), '{}') AS fields
      FROM privacy_settings ps
      WHERE ps.profile_id = p.id AND ps.is_visible = FALSE
    ) h ON TRUE
    LEFT JOIN LATERAL (
      SELECT array_agg(s.name ORDER BY s.name) AS names
      FROM alumni_skills a JOIN skills s ON s.id = a.skill_id
      WHERE a.profile_id = p.id
    ) sk ON TRUE
    WHERE p.id = ${id}
      AND u.role = 'alumni'
      AND u.account_status = 'active'
      AND p.is_active = TRUE`;
  return rows[0] || null;
}

// Filter options for the search page. Counts only active alumni, and only the
// fields each owner left visible, so the numbers cannot reveal a hidden value.
async function getFilterOptions(industry) {
  const sql = getSql();
  const rows = await sql`
    WITH visible AS (
      SELECT p.id, p.industry, p.location, p.graduation_year, h.fields
      FROM alumni_profiles p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(array_agg(ps.field_name), '{}') AS fields
        FROM privacy_settings ps
        WHERE ps.profile_id = p.id AND ps.is_visible = FALSE
      ) h ON TRUE
      WHERE u.role = 'alumni' AND u.account_status = 'active' AND p.is_active = TRUE
    ),
    scoped AS (
      SELECT * FROM visible
      WHERE ${industry}::text IS NULL
         OR (industry = ${industry} AND NOT 'industry' = ANY (fields))
    )
    SELECT
      (SELECT COALESCE(json_agg(x), '[]') FROM (
         SELECT industry AS name, COUNT(*)::int AS count
         FROM visible
         WHERE industry IS NOT NULL AND NOT 'industry' = ANY (fields)
         GROUP BY industry
       ) x) AS industries,
      (SELECT json_build_object('min', MIN(graduation_year), 'max', MAX(graduation_year))
       FROM scoped
       WHERE NOT 'graduation_year' = ANY (fields)) AS "graduationYears",
      (SELECT COALESCE(json_agg(x), '[]') FROM (
         SELECT s.name, COUNT(*)::int AS count
         FROM scoped v
         JOIN alumni_skills a ON a.profile_id = v.id
         JOIN skills s ON s.id = a.skill_id
         WHERE NOT 'skills' = ANY (v.fields)
         GROUP BY s.name
         ORDER BY count DESC, s.name
         LIMIT 20
       ) x) AS skills,
      (SELECT COALESCE(json_agg(x), '[]') FROM (
         SELECT MIN(trim(location)) AS name, COUNT(*)::int AS count
         FROM scoped
         WHERE location IS NOT NULL AND NOT 'location' = ANY (fields)
         GROUP BY lower(trim(location))
         ORDER BY count DESC, name
         LIMIT 20
       ) x) AS locations`;
  return rows[0];
}

module.exports = { searchAlumni, getAlumnusById, getFilterOptions };
