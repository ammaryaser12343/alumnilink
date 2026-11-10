// Neon connection (Lab 5 pattern). The sql`...` tagged template sends every
// ${value} as a separate parameter, so values can never change the SQL itself.
const { neon } = require('@neondatabase/serverless');

let sql;

function getSql() {
  if (!process.env.DATABASE_URL) {
    // /api/health still works without a database, which makes this easy to spot.
    throw new Error('DATABASE_URL is not set. Add it to .env locally, or in Vercel: Settings > Environment Variables, then Redeploy.');
  }
  if (!sql) {
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

module.exports = { getSql };
