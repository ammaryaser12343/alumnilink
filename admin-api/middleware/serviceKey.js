// Protects /internal routes: only the other AlumniLink backends, which know
// SERVICE_KEY, may call them. Browsers never get this key.
// Same check as search-api/middleware/serviceKey.js, so all services behave alike.
const crypto = require('crypto');
const { sendError } = require('../../shared/errors');

function getServiceKey() {
  const key = process.env.SERVICE_KEY;
  // Fail closed: without a key no internal call can be trusted.
  if (!key || key.length < 32) {
    throw new Error('SERVICE_KEY is missing or shorter than 32 characters.');
  }
  return key;
}

function digest(text) {
  return crypto.createHash('sha256').update(text).digest();
}

function requireServiceKey(req, res, next) {
  try {
    const given = req.get('X-Service-Key') || '';
    // Compare fixed-length hashes so the check takes the same time for any input.
    if (!given || !crypto.timingSafeEqual(digest(given), digest(getServiceKey()))) {
      console.warn(`Rejected internal call to ${req.method} ${req.originalUrl}: bad or missing service key.`);
      return sendError(res, 401, 'SERVICE_KEY_INVALID', 'Missing or invalid service key.');
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireServiceKey };