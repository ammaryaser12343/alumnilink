// The "users clerk": all database work for the users and verification_requests tables.
// Every ${value} is sent separately from the SQL text (parameterized), so what
// a user types can never change the query itself (blocks SQL injection).
const { getSql } = require('./db');

// Job 1: find one user by email (already lower-cased by the caller).
// Returns the user row, or null if no one has that email.
async function findUserByEmail(email) {
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, email, password_hash, role, account_status
    FROM users
    WHERE email = ${email}`;
  return rows[0] || null;
}

// Job 2: create a pending user AND their verification request in ONE statement,
// so we never end up with a user that no admin can see.
// Throws an error with code '23505' if the email is already taken.
async function createUserWithRequest({ name, email, passwordHash, role }) {
  const sql = getSql();
  const rows = await sql`
    WITH new_user AS (
      INSERT INTO users (name, email, password_hash, role)
      VALUES (${name}, ${email}, ${passwordHash}, ${role})
      RETURNING id, name, email, role, account_status, created_at
    ),
    new_request AS (
      INSERT INTO verification_requests (user_id)
      SELECT id FROM new_user
      RETURNING id
    )
    SELECT new_user.*, new_request.id AS request_id
    FROM new_user, new_request`;
  return rows[0];
}

// Job 3: role and account status of one user, for the internal status line.
// Returns { id, role, account_status } or null if no such user.
async function findUserStatusById(userId) {
  const sql = getSql();
  const rows = await sql`
    SELECT id, role, account_status
    FROM users
    WHERE id = ${userId}`;
  return rows[0] || null;
}

module.exports = { findUserByEmail, createUserWithRequest, findUserStatusById };