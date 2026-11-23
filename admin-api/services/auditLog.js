// The "security diary". Every event is written in two places:
//   1. one JSON line starting with "AUDIT" (same format as Search). On Floci or AWS,
//      Lambda sends everything it prints to CloudWatch Logs (/aws/lambda/alumnilink-identity).
//   2. a row in the shared audit_logs table, so it shows on the admin page.
// service_name is always 'admin'. NEVER pass passwords, tokens or emails into this function.
const { getSql } = require('./db');

const pending = new Set();

async function saveToDatabase({ actorUserId, action, targetId, outcome }) {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO audit_logs (actor_user_id, service_name, action, target_id, outcome)
      VALUES (${actorUserId}, 'admin', ${action}, ${targetId}, ${outcome})`;
  } catch (error) {
    // If writing the diary fails, don't break the user's action, but make it visible.
    console.error('Audit log write failed:', error.message);
  }
}

function writeAuditLog({ actorUserId, action, targetId, outcome }) {
  const event = {
    service: 'admin',
    action,
    actorUserId: actorUserId || null,
    targetId: targetId ? String(targetId).slice(0, 64) : null,
    outcome,
    time: new Date().toISOString()
  };
  console.log(`AUDIT ${JSON.stringify(event)}`);

  const write = saveToDatabase(event);
  pending.add(write);
  write.finally(() => pending.delete(write));
  return write;
}

// Lambda freezes as soon as the handler returns, so lambda.js waits for these first.
async function flushAuditLogs() {
  await Promise.all([...pending]);
}

module.exports = { writeAuditLog, flushAuditLogs };