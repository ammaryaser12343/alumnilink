// Audit log for the Search service.
// Every event is printed as one JSON line starting with "AUDIT". On Floci or AWS,
// Lambda sends these lines to CloudWatch Logs (/aws/lambda/alumnilink-search).
// Events with a signed-in actor are also saved in the shared audit_logs table,
// so they show on the admin logs page. Anonymous events (bad or missing token)
// are not written to the database, so they cannot be used to flood it.
// Never log message text, emails, tokens or keys.
const { getSql } = require('./db');

const pending = new Set();

async function saveToDatabase({ actorUserId, action, targetId, outcome }) {
  try {
    const sql = getSql();
    await sql`
      INSERT INTO audit_logs (actor_user_id, service_name, action, target_id, outcome)
      VALUES (${actorUserId}, 'search', ${action}, ${targetId || null}, ${outcome})`;
  } catch (error) {
    // A failed log row must not undo the user's action, but it must be visible.
    console.error('Audit log write failed:', error.message);
  }
}

function writeAuditLog({ actorUserId, action, targetId, outcome }) {
  const event = {
    service: 'search',
    action,
    actorUserId: actorUserId || null,
    targetId: targetId ? String(targetId).slice(0, 64) : null,
    outcome,
    time: new Date().toISOString()
  };
  console.log(`AUDIT ${JSON.stringify(event)}`);

  if (!event.actorUserId) {
    return Promise.resolve();
  }
  const write = saveToDatabase(event);
  pending.add(write);
  write.finally(() => pending.delete(write));
  return write;
}

// Lambda freezes as soon as the handler returns, so it waits for these first.
async function flushAuditLogs() {
  await Promise.all([...pending]);
}

module.exports = { writeAuditLog, flushAuditLogs };
