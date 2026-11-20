// Writes security events to audit_logs with service_name = 'search'.
// Never store message text, emails or tokens here.
const { getSql } = require('./db');

async function writeAuditLog({ actorUserId, action, targetId, outcome }) {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO audit_logs (actor_user_id, service_name, action, target_id, outcome)
      VALUES (${actorUserId || null}, 'search', ${action}, ${targetId || null}, ${outcome})`;
  } catch (error) {
    // A failed log line must not undo the user's action, but it must be visible in Vercel Logs.
    console.error('Audit log write failed:', error.message);
  }
}

module.exports = { writeAuditLog };
