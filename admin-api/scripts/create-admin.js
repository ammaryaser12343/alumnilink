// Creates an admin account from the terminal.
// Admins can NOT sign up on the website (on purpose). Only someone who has the
// database address in .env can run this, so only the team can create admins.
// Usage (from admin-api):  npm run create-admin
require('dotenv').config();

const readline = require('readline/promises');
const { getSql } = require('../services/db');
const { hashPassword } = require('../services/passwords');
const { writeAuditLog } = require('../services/auditLog');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const name = (await rl.question('Admin name: ')).trim();
  const email = (await rl.question('Admin email: ')).trim().toLowerCase();
  const password = await rl.question('Admin password (8+ chars, letters and numbers): ');
  rl.close();

  if (name.length < 2 || name.length > 100) throw new Error('Name must be 2 to 100 characters.');
  if (!EMAIL_PATTERN.test(email)) throw new Error('That email is not valid.');
  if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('Password must be 8 to 72 characters with at least one letter and one number.');
  }

  const sql = getSql();
  const existing = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (existing[0]) throw new Error('A user with that email already exists. Use a different email.');

  const passwordHash = await hashPassword(password);
  const rows = await sql`
    INSERT INTO users (name, email, password_hash, role, account_status)
    VALUES (${name}, ${email}, ${passwordHash}, 'admin', 'active')
    RETURNING id`;

  await writeAuditLog({ actorUserId: null, action: 'CREATE_ADMIN', targetId: rows[0].id, outcome: 'success' });
  console.log(`Admin created. You can now log in as ${email}.`);
}

main().catch((error) => {
  console.error('Could not create admin:', error.message);
  process.exit(1);
});