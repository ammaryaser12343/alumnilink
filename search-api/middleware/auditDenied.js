// Records every refused request (401, 403, 429) in the audit log,
// whichever check refused it: token, role, account status, service key or rate limit.
const { writeAuditLog } = require('../services/auditLog');

const OUTCOMES = { 401: 'unauthenticated', 403: 'forbidden', 429: 'rate_limited' };

function auditDenied(req, res, next) {
  res.on('finish', () => {
    const outcome = OUTCOMES[res.statusCode];
    if (!outcome) return;
    writeAuditLog({
      actorUserId: req.user ? req.user.id : null,
      action: `DENIED ${req.method}`,
      targetId: req.originalUrl.split('?')[0],
      outcome
    });
  });
  next();
}

module.exports = { auditDenied };
