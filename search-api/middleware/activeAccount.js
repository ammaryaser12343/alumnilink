// Runs after requireLogin. A token stays valid for an hour, but an admin can
// suspend an account at any time, so every request asks the Identity service
// (Daniel) whether this account is still active. Answers are cached for 60 seconds.
// If Identity cannot be reached, the request is refused (fail closed).
const { sendError } = require('../../shared/errors');
const { getUserStatus, ServiceUnavailableError } = require('../services/serviceClient');

async function requireActiveAccount(req, res, next) {
  try {
    const account = await getUserStatus(req.user.id);
    if (!account || account.accountStatus !== 'active') {
      return sendError(res, 403, 'ACCOUNT_INACTIVE', 'Your account is not active.');
    }
    if (account.role !== req.user.role) {
      return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to do this.');
    }
    return next();
  } catch (error) {
    if (error instanceof ServiceUnavailableError) {
      console.error(error.message);
      return sendError(res, 503, 'SERVICE_UNAVAILABLE', 'Account check is unavailable. Please try again shortly.');
    }
    return next(error);
  }
}

module.exports = { requireActiveAccount };
