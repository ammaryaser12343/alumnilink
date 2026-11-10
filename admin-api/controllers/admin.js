// TODO (Daniel): admin functions. Write an audit_logs row for every admin action.
const { notImplemented } = require('../../shared/notImplemented');

module.exports = {
  listVerifications: notImplemented('GET /api/admin/verifications'),
  reviewVerification: notImplemented('PATCH /api/admin/verifications/:id'),
  updateUserStatus: notImplemented('PATCH /api/admin/users/:id/status'),
  listLogs: notImplemented('GET /api/admin/logs')
};
