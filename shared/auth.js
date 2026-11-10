// Shared login-token and role checks, used by all three backends.
// Owner: Ahmed (requireLogin, signToken) and Daniel (requireRole).
//
// Starter version built only on Node's built-in crypto module, so /shared needs
// no npm packages. Swap in the library approved after the authentication lab
// if the module requires one; keep the same function names so routes do not change.
//
// Token format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)
// Payload: { sub: <user id>, role: 'alumni' | 'student' | 'admin', exp: <unix seconds> }

const crypto = require('crypto');
const { sendError } = require('./errors');

function getSecret() {
  const secret = process.env.TOKEN_SECRET;
  // Fail closed: without a secret nobody can be verified, so stop with a 500.
  if (!secret || secret.length < 32) {
    throw new Error('TOKEN_SECRET is missing or shorter than 32 characters.');
  }
  return secret;
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

// Used by the Profile backend's login route.
function signToken({ sub, role }, ttlSeconds = 60 * 60) {
  const payload = { sub, role, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, getSecret())}`;
}

function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  const expected = Buffer.from(sign(body, getSecret()));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.sub || !payload.role || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// Middleware: request must carry "Authorization: Bearer <token>".
function requireLogin(req, res, next) {
  try {
    const header = req.get('Authorization') || '';
    if (!header.startsWith('Bearer ')) {
      return sendError(res, 401, 'AUTH_REQUIRED', 'Please log in first.');
    }
    const payload = verifyToken(header.slice('Bearer '.length).trim());
    if (!payload) {
      return sendError(res, 401, 'INVALID_TOKEN', 'Your login is invalid or has expired.');
    }
    req.user = { id: payload.sub, role: payload.role };
    return next();
  } catch (error) {
    return next(error);
  }
}

// Middleware factory: requireRole('admin') or requireRole('alumni', 'student', 'admin').
// Always place it after requireLogin.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to do this.');
    }
    return next();
  };
}

module.exports = { signToken, verifyToken, requireLogin, requireRole };
