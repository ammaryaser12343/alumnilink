const {readFile}=require('node:fs/promises');
const path=require('node:path');
const {Pool}=require('pg');

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL??process.env.DATABASE_URL,connectionTimeoutMillis:8000});
  const client=await pool.connect();
  try {
    const {rows}=await client.query(`SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('users','locations')`);
    for (const table of ['users','locations']) {
      if (!rows.some(row=>row.table_name===table && row.column_name==='id')) throw new Error('Required team schema is missing.');
    }
    console.log('Inspected the shared users and locations schema.');
    await client.query(await readFile(path.join(__dirname,'schema.sql'),'utf8'));
    console.log('Profile and Privacy migration applied.');
  } finally { client.release(); await pool.end(); }
}
migrate().catch(error=>{
  console.error('Migration could not complete. Database error code',error.code??'CONFIGURATION');
  process.exitCode=1;
});
