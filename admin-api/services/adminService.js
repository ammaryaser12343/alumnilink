// The "admin clerk": all database work for the admin's powers.
// Every ${value} is sent separately from the SQL text (parameterized),
// so nothing a user types can change the query (blocks SQL injection).
const { getSql } = require('./db');

const PAGE_SIZE = 20;

// Job 1: the waiting list.
// status: 'pending' | 'approved' | 'rejected' | 'all'
async function listVerifications(status) {
  const sql = getSql();
  const filter = status === 'all' ? null : status;
  return sql`
    SELECT vr.id, vr.status, vr.created_at, vr.reviewed_at,
           u.id AS user_id, u.name, u.email, u.role, u.account_status
    FROM verification_requests vr
    JOIN users u ON u.id = vr.user_id
    WHERE (${filter}::text IS NULL OR vr.status = ${filter})
    ORDER BY vr.created_at ASC
    LIMIT 100`;
}

// Job 2: approve or reject ONE pending request.
// Updates the request AND the user's account in a single statement.
// Returns { result: 'done' | 'already_reviewed' | 'not_found', ... }
async function reviewVerification({ requestId, decision, adminId }) {
  const sql = getSql();
  const newAccountStatus = decision === 'approved' ? 'active' : 'rejected';

  const rows = await sql`
    WITH req AS (
      UPDATE verification_requests
      SET status = ${decision}, reviewed_by = ${adminId}, reviewed_at = now()
      WHERE id = ${requestId} AND status = 'pending'
      RETURNING id, user_id, status, reviewed_at
    ),
    usr AS (
      UPDATE users SET account_status = ${newAccountStatus}
      FROM req
      WHERE users.id = req.user_id AND users.account_status = 'pending'
      RETURNING users.id, users.account_status
    )
    SELECT req.id, req.user_id, req.status, req.reviewed_at, usr.account_status
    FROM req LEFT JOIN usr ON usr.id = req.user_id`;

  if (rows[0]) return { result: 'done', request: rows[0] };

  // Nothing changed: either the request doesn't exist, or it was already decided.
  const existing = await sql`SELECT status FROM verification_requests WHERE id = ${requestId}`;
  if (!existing[0]) return { result: 'not_found' };
  return { result: 'already_reviewed', status: existing[0].status };
}

// Job 3: suspend (active -> suspended) or reactivate (suspended -> active).
// Admin accounts can never be changed here.
// Returns { result: 'done' | 'not_found' | 'is_admin' | 'wrong_status', ... }
async function changeUserStatus({ userId, newStatus }) {
  const sql = getSql();
  const fromStatus = newStatus === 'suspended' ? 'active' : 'suspended';

  const rows = await sql`
    UPDATE users SET account_status = ${newStatus}
    WHERE id = ${userId} AND account_status = ${fromStatus} AND role <> 'admin'
    RETURNING id, name, role, account_status`;

  if (rows[0]) return { result: 'done', user: rows[0] };

  const existing = await sql`SELECT role, account_status FROM users WHERE id = ${userId}`;
  if (!existing[0]) return { result: 'not_found' };
  if (existing[0].role === 'admin') return { result: 'is_admin' };
  return { result: 'wrong_status', status: existing[0].account_status };
}

// Job 4: read the diary with optional filters, 20 lines per page, newest first.
// from / to are dates like '2026-11-22' (to includes that whole day).
async function listAuditLogs({ service = null, action = null, outcome = null, from = null, to = null, page = 1 }) {
  const sql = getSql();
  const offset = (page - 1) * PAGE_SIZE;

  const rows = await sql`
    SELECT l.id, l.service_name, l.action, l.target_id, l.outcome, l.created_at,
           l.actor_user_id, u.name AS actor_name, u.role AS actor_role
    FROM audit_logs l
    LEFT JOIN users u ON u.id = l.actor_user_id
    WHERE (${service}::text IS NULL OR l.service_name = ${service})
      AND (${action}::text  IS NULL OR l.action = ${action})
      AND (${outcome}::text IS NULL OR l.outcome = ${outcome})
      AND (${from}::date    IS NULL OR l.created_at >= ${from}::date)
      AND (${to}::date      IS NULL OR l.created_at <  ${to}::date + 1)
    ORDER BY l.created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM audit_logs l
    WHERE (${service}::text IS NULL OR l.service_name = ${service})
      AND (${action}::text  IS NULL OR l.action = ${action})
      AND (${outcome}::text IS NULL OR l.outcome = ${outcome})
      AND (${from}::date    IS NULL OR l.created_at >= ${from}::date)
      AND (${to}::date      IS NULL OR l.created_at <  ${to}::date + 1)`;

  return { page, pageSize: PAGE_SIZE, total: countRows[0].total, results: rows };
}

// Job 5: list accounts with optional filters, 20 per page, newest first.
// q matches part of the name or email. Never returns password hashes.
async function listUsers({ role = null, status = null, q = null, page = 1 }) {
  const sql = getSql();
  const offset = (page - 1) * PAGE_SIZE;
  // Treat % and _ in the search text as normal characters, not wildcards.
  const pattern = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : null;

  const rows = await sql`
    SELECT id, name, email, role, account_status, created_at
    FROM users
    WHERE (${role}::text    IS NULL OR role = ${role})
      AND (${status}::text  IS NULL OR account_status = ${status})
      AND (${pattern}::text IS NULL OR name ILIKE ${pattern} OR email ILIKE ${pattern})
    ORDER BY created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM users
    WHERE (${role}::text    IS NULL OR role = ${role})
      AND (${status}::text  IS NULL OR account_status = ${status})
      AND (${pattern}::text IS NULL OR name ILIKE ${pattern} OR email ILIKE ${pattern})`;

  return { page, pageSize: PAGE_SIZE, total: countRows[0].total, results: rows };
}

module.exports = { listVerifications, reviewVerification, changeUserStatus, listAuditLogs, listUsers };