// Limits each signed-in user to RATE_LIMIT_PER_MINUTE requests (default 60).
// Stops one account from scraping the whole directory or guessing ids quickly.
// Place it after requireLogin so req.user is known.
const { sendError } = require('../../shared/errors');
const { countRequest } = require('../services/rateLimit');

function limitPerMinute() {
  const value = Number(process.env.RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(value) && value > 0 ? value : 60;
}

async function rateLimit(req, res, next) {
  try {
    const hits = await countRequest(req.user.id);
    if (hits > limitPerMinute()) {
      res.set('Retry-After', '60');
      return sendError(res, 429, 'RATE_LIMITED', 'Too many requests. Please wait a minute and try again.');
    }
    return next();
  } catch (error) {
    // If the counter store is down, keep the service usable but make the problem visible.
    console.error('Rate limit check failed:', error.message);
    return next();
  }
}

module.exports = { rateLimit };
