// Writes security events to the audit_logs table (the "security diary").
// service_name is always 'admin' for events from this backend.
// NEVER pass passwords, tokens or emails into this function.
const { getSql } = require('./db');

async function writeAuditLog({ actorUserId, action, targetId, outcome }) {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO audit_logs (actor_user_id, service_name, action, target_id, outcome)
      VALUES (${actorUserId || null}, 'admin', ${action}, ${targetId || null}, ${outcome})`;
  } catch (error) {
    // If writing the diary fails, don't break the user's action,
    // but print it so it shows up in the server logs.
    console.error('Audit log write failed:', error.message);
  }
}

module.exports = { writeAuditLog };