// Creates a login token for local testing before the real login route exists.
// Run it from inside a backend folder, so that folder's .env (TOKEN_SECRET) is used:
//   node ../shared/scripts/make-test-token.js student
//   node ../shared/scripts/make-test-token.js alumni
//   node ../shared/scripts/make-test-token.js admin
// Never use it in production. The token only works with the TOKEN_SECRET in your .env.

const fs = require('fs');
const path = require('path');

// Read TOKEN_SECRET from ./.env without needing the dotenv package in /shared.
const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*TOKEN_SECRET\s*=\s*(.*)\s*$/);
    if (match) process.env.TOKEN_SECRET = match[1].replace(/^["']|["']$/g, '');
  }
}

const { signToken } = require('../auth');

// Fixed ids of seed accounts in docs/seed.sql
const SEED_USERS = {
  admin: '00000000-0000-4000-8000-000000000001',
  student: '00000000-0000-4000-8000-000000000010',
  alumni: '00000000-0000-4000-8000-000000000100'
};

const role = process.argv[2] || 'student';
if (!SEED_USERS[role]) {
  console.error('Role must be one of: alumni, student, admin');
  process.exit(1);
}
console.log(signToken({ sub: SEED_USERS[role], role }));
