// Sign up and login (Identity). Owner: Daniel.
// Uses the tools: passwords (blender), userService (clerk), auditLog (diary),
// and signToken from shared/auth.js (the ID badge maker).
const { sendError } = require('../../shared/errors');
const { signToken } = require('../../shared/auth');
const { hashPassword, verifyPassword } = require('../services/passwords');
const { findUserByEmail, createUserWithRequest } = require('../services/userService');
const { writeAuditLog } = require('../services/auditLog');

// Only these two roles can sign up. Admins are never created through the website.
const SIGNUP_ROLES = ['student', 'alumni'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Used when the email doesn't exist, so a wrong email takes as long as a wrong
// password. Otherwise an attacker could time the answer to learn who has an account.
let dummyHashPromise;
function getDummyHash() {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('not-a-real-password');
  return dummyHashPromise;
}

// Accept only the fields we expect, and only as text.
function onlyFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be a JSON object.';
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length) return `Unexpected field(s): ${extra.join(', ')}.`;
  return null;
}

// POST /api/auth/register
async function register(req, res, next) {
  try {
    const shapeError = onlyFields(req.body, ['name', 'email', 'password', 'role']);
    if (shapeError) return sendError(res, 400, 'VALIDATION_ERROR', shapeError);

    const { name, email, password, role } = req.body;

    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Name must be 2 to 100 characters.');
    }
    if (typeof email !== 'string' || email.length > 255 || !EMAIL_PATTERN.test(email.trim())) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Please enter a valid email address.');
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 72
        || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return sendError(res, 400, 'VALIDATION_ERROR',
        'Password must be 8 to 72 characters and include at least one letter and one number.');
    }
    if (!SIGNUP_ROLES.includes(role)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Role must be "student" or "alumni".');
    }

    const passwordHash = await hashPassword(password);

    let user;
    try {
      user = await createUserWithRequest({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash,
        role
      });
    } catch (error) {
      if (error.code === '23505') {
        // The database refused a second account with the same email.
        return sendError(res, 409, 'EMAIL_ALREADY_REGISTERED', 'This email is already registered.');
      }
      throw error;
    }

    await writeAuditLog({ actorUserId: user.id, action: 'REGISTER', targetId: user.id, outcome: 'success' });

    return res.status(201).json({
      message: 'Account created. An admin must approve it before you can log in.',
      user: { id: user.id, name: user.name, email: user.email, role: user.role, accountStatus: user.account_status }
    });
  } catch (error) {
    return next(error);
  }
}

// POST /api/auth/login
async function login(req, res, next) {
  try {
    const shapeError = onlyFields(req.body, ['email', 'password']);
    if (shapeError) return sendError(res, 400, 'VALIDATION_ERROR', shapeError);

    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Email and password are required.');
    }

    const user = await findUserByEmail(email.trim().toLowerCase());

    if (!user) {
      await verifyPassword(password, await getDummyHash()); // same time as a real check
      await writeAuditLog({ actorUserId: null, action: 'LOGIN', targetId: null, outcome: 'unknown_email' });
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk) {
      await writeAuditLog({ actorUserId: user.id, action: 'LOGIN', targetId: user.id, outcome: 'wrong_password' });
      return sendError(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    // Correct password, but is the account allowed in?
    const blocked = {
      pending: ['ACCOUNT_PENDING', 'Your account is waiting for admin approval.'],
      suspended: ['ACCOUNT_SUSPENDED', 'Your account has been suspended.'],
      rejected: ['ACCOUNT_REJECTED', 'Your registration was not approved.']
    }[user.account_status];
    if (blocked) {
      await writeAuditLog({ actorUserId: user.id, action: 'LOGIN', targetId: user.id, outcome: `blocked_${user.account_status}` });
      return sendError(res, 403, blocked[0], blocked[1]);
    }

    const token = signToken({ sub: user.id, role: user.role }); // valid for 1 hour
    await writeAuditLog({ actorUserId: user.id, action: 'LOGIN', targetId: user.id, outcome: 'success' });

    return res.status(200).json({
      token,
      user: { id: user.id, name: user.name, role: user.role }
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { register, login };