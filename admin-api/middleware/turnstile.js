// Checks the Cloudflare Turnstile ticket before sign-up and login (Lab 5 pattern).
// The browser sends the ticket in the X-Turnstile-Token header. Only the server
// knows the secret key, so only the server can ask Cloudflare if the ticket is real.
const { sendError } = require('../../shared/errors');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstile(req, res, next) {
  try {
    const token = req.get('X-Turnstile-Token');
    if (!token) {
      return sendError(res, 403, 'BOT_CHECK_FAILED', 'Bot check token is missing.');
    }

    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      // Fail closed: if the secret is missing, nobody gets through (500).
      throw new Error('TURNSTILE_SECRET_KEY is not set');
    }

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: req.ip }),
      signal: AbortSignal.timeout(5000) // don't wait forever if Cloudflare is slow
    });
    const result = await response.json();

    if (!result.success) {
      console.warn('Turnstile rejected a token:', result['error-codes']);
      return sendError(res, 403, 'BOT_CHECK_FAILED', 'Bot check failed. Please try again.');
    }
    return next(); // ticket is real: continue to sign-up / login
  } catch (error) {
    return next(error);
  }
}

module.exports = { verifyTurnstile };