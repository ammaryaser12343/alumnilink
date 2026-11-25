// Internal answers for the other backends (never called by the browser).
// Contract from docs/api.md:
//   GET /internal/users/:id/status -> 200 { id, role, accountStatus } or 404
const { sendError } = require('../../shared/errors');
const { findUserStatusById } = require('../services/userService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getUserStatus(req, res, next) {
  try {
    // An id that isn't even a valid id can't belong to anyone: answer 404 like
    // "no such user". (Search treats anything other than 200/404 as "service down".)
    if (!UUID_PATTERN.test(req.params.id)) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'User not found.');
    }

    const user = await findUserStatusById(req.params.id);
    if (!user) {
      return sendError(res, 404, 'USER_NOT_FOUND', 'User not found.');
    }

    return res.status(200).json({ id: user.id, role: user.role, accountStatus: user.account_status });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getUserStatus };