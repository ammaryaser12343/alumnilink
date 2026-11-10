// TODO (Ahmed): sign-up and login.
// register: validate input, hash the password, insert into users (account_status 'pending')
//           and verification_requests, answer 201.
// login:    check the password hash and account_status = 'active', then answer 200
//           with signToken({ sub: user.id, role: user.role }) from shared/auth.js.
const { notImplemented } = require('../../shared/notImplemented');

module.exports = {
  register: notImplemented('POST /api/auth/register'),
  login: notImplemented('POST /api/auth/login')
};
