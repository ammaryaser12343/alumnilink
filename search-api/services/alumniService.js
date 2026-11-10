// Database queries for the Search and Directory service.
// Rules every query follows:
//   - only active alumni accounts with an active profile appear
//   - a filter never matches a field the owner has hidden, so hidden values cannot be guessed
//   - every value goes in as a parameter (sql`...${value}...`), never as SQL text
const { getSql } = require('./db');

// Escape % and _ so a user's text is searched literally inside ILIKE.
function likePattern(text) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

async function searchAlumni({ q, location, industry, gradYear, sort, page, pageSize }) {
  const sql = getSql();
  const qPattern = q ? likePattern(q) : null;
  const locationPattern = location ? likePattern(location) : null;
  const offset = (page - 1) * pageSize;

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
    WHERE u.role = 'alumni'
      AND u.account_status = 'active'
      AND p.is_active = TRUE
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

module.exports = { searchAlumni, getAlumnusById };
