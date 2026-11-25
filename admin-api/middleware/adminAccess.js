// Guard for every /api/admin route. Runs after requireLogin (the badge check).
// 1) The badge must say "admin". Anyone else gets 403 and a line in the diary.
// 2) The account must STILL be an active admin in the database right now,
//    so a suspended admin is locked out at once, not when their badge expires.
const { sendError } = require('../../shared/errors');
const { getSql } = require('../services/db');
const { writeAuditLog } = require('../services/auditLog');

async function requireAdmin(req, res, next) {
  try {
    if (req.user.role !== 'admin') {
      await writeAuditLog({ actorUserId: req.user.id, action: 'ADMIN_ACCESS', targetId: null, outcome: 'denied_not_admin' });
      return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to do this.');
    }

    const sql = getSql();
    const rows = await sql`SELECT role, account_status FROM users WHERE id = ${req.user.id}`;
    const account = rows[0];
    if (!account || account.role !== 'admin' || account.account_status !== 'active') {
      await writeAuditLog({ actorUserId: account ? req.user.id : null, action: 'ADMIN_ACCESS', targetId: null, outcome: 'denied_inactive' });
      return sendError(res, 403, 'ACCOUNT_INACTIVE', 'Your account is not active.');
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireAdmin };