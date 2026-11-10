// TODO (Ahmed): profile and privacy functions. Use req.user.id as the owner in every query.
const { notImplemented } = require('../../shared/notImplemented');

module.exports = {
  createProfile: notImplemented('POST /api/profiles'),
  getMyProfile: notImplemented('GET /api/profiles/me'),
  updateMyProfile: notImplemented('PATCH /api/profiles/me'),
  updateMyPrivacy: notImplemented('PATCH /api/profiles/me/privacy'),
  updateMyStatus: notImplemented('PATCH /api/profiles/me/status')
};
