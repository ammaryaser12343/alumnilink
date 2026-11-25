// Password hashing with Node's built-in scrypt (no extra packages needed).
// We never store a password, only "scrypt$<salt>$<hash>".
// The salt is random per user, so equal passwords get different hashes.
const crypto = require('crypto');

const KEY_LENGTH = 64;

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derived) => {
      if (err) return reject(err);
      resolve(`scrypt$${salt}$${derived.toString('hex')}`);
    });
  });
}

// true if the typed password matches the stored hash, otherwise false.
function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return resolve(false);
    const [, salt, hashHex] = parts;
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derived) => {
      if (err) return reject(err);
      const expected = Buffer.from(hashHex, 'hex');
      // timingSafeEqual: the check takes the same time whether it's
      // almost right or totally wrong, so attackers learn nothing from timing.
      resolve(expected.length === derived.length && crypto.timingSafeEqual(expected, derived));
    });
  });
}

module.exports = { hashPassword, verifyPassword };