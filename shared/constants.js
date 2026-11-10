// Values shared by all services. Change them here only, and tell the team.

const ROLES = ['alumni', 'student', 'admin'];

// Must match the CHECK constraint on privacy_settings.field_name in docs/schema.sql.
const PRIVACY_FIELDS = ['graduation_year', 'company', 'location', 'industry', 'bio', 'skills'];

// Fixed list so industry filters and profile forms always use the same spelling.
const INDUSTRIES = [
  'Software',
  'Cybersecurity',
  'Telecommunications',
  'Banking and Finance',
  'Data and AI',
  'Consulting'
];

module.exports = { ROLES, PRIVACY_FIELDS, INDUSTRIES };
