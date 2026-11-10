// Shared privacy helper. Owner: Ahmed.
// Removes every field the profile owner has hidden before a profile leaves the API.
// The owner and admins still see everything.

const { PRIVACY_FIELDS } = require('./constants');

// profile: a plain object from the database, including profile.userId
// hiddenFields: array of field names with is_visible = false, e.g. ['company', 'location']
// viewer: req.user ({ id, role }) or undefined
function applyPrivacy(profile, hiddenFields, viewer) {
  const isOwner = viewer && viewer.id === profile.userId;
  const isAdmin = viewer && viewer.role === 'admin';

  const result = { ...profile };
  if (!isOwner && !isAdmin) {
    for (const field of hiddenFields || []) {
      if (PRIVACY_FIELDS.includes(field)) {
        delete result[toCamel(field)];
      }
    }
  }
  delete result.userId; // internal id, never needed by the frontend
  return result;
}

function toCamel(field) {
  return field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

module.exports = { applyPrivacy };
