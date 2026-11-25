// Limits sign-up and login attempts (threat 1: password guessing and scripted sign-ups).
// Two counters per minute:
//   - per network address (IP): stops one machine hammering the form
//   - per email, login only:    stops many machines guessing ONE person's password
// The email is hashed before counting, so the counter store never holds real emails.
// Runs BEFORE the Turnstile check, so floods never reach Cloudflare either.
const crypto = require('crypto');
const { sendError } = require('../../shared/errors');
const { countAttempt } = require('../services/rateLimit');
const { writeAuditLog } = require('../services/auditLog');

function readLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
}

// action: 'register' or 'login'
function limitAuthAttempts(action) {
  return async (req, res, next) => {
    try {
      const ipLimit = readLimit('AUTH_RATE_LIMIT_PER_IP', 10);
      const emailLimit = readLimit('AUTH_RATE_LIMIT_PER_EMAIL', 5);

      const ipHits = await countAttempt(`${action}#ip#${req.ip}`);

      let emailHits = 0;
      const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (action === 'login' && email) {
        emailHits = await countAttempt(`login#email#${hash(email)}`);
      }

      if (ipHits > ipLimit || emailHits > emailLimit) {
        await writeAuditLog({ actorUserId: null, action: action.toUpperCase(), targetId: null, outcome: 'rate_limited' });
        res.set('Retry-After', '60');
        return sendError(res, 429, 'RATE_LIMITED', 'Too many attempts. Please wait a minute and try again.');
      }
      return next();
    } catch (error) {
      // Same choice as Search: if the counter store is down, keep login usable,
      // but print the problem so it shows up in the logs.
      console.error('Rate limit check failed:', error.message);
      return next();
    }
  };
}

module.exports = { limitAuthAttempts };