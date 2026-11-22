const {Pool}=require('pg');
const {randomBytes}=require('node:crypto');
const {readFile,writeFile}=require('node:fs/promises');
const path=require('node:path');
async function main(){
 if (process.env.MIGRATION_DATABASE_URL) throw new Error('A runtime login is already provisioned. Use db:migrate for schema updates.');
 const owner=process.env.DATABASE_URL;
 const pool=new Pool({connectionString:owner,connectionTimeoutMillis:8000});
 const client=await pool.connect();
 try{
  const schema=await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'");
  for(const [table,columns] of Object.entries({users:['id','role','account_status'],locations:['id'],contact_requests:['student_user_id','alumni_profile_id','status']})){
   if(!columns.every(column=>schema.rows.some(row=>row.table_name===table&&row.column_name===column))) throw new Error('SCHEMA_CONTRACT');
  }
  await client.query(await readFile(path.join(__dirname,'schema.sql'),'utf8'));
  const role='alumnilink_profile_ahmed_'+randomBytes(4).toString('hex');
  const password=randomBytes(32).toString('hex');
  await client.query('BEGIN');
  await client.query('CREATE ROLE '+role+" LOGIN PASSWORD '"+password+"'");
  await client.query('GRANT CONNECT ON DATABASE neondb TO '+role);
  await client.query('GRANT USAGE ON SCHEMA public TO '+role);
  for(const table of ['alumni_profiles','privacy_settings']) await client.query('GRANT SELECT,INSERT,UPDATE ON '+table+' TO '+role);
  await client.query('GRANT SELECT,INSERT,DELETE ON alumni_skills TO '+role);
  await client.query('GRANT SELECT,INSERT ON skills TO '+role);
  await client.query('GRANT UPDATE(name) ON skills TO '+role);
  await client.query('GRANT SELECT ON locations TO '+role);
  await client.query('GRANT SELECT(id,student_user_id,alumni_profile_id,status) ON contact_requests TO '+role);
  await client.query('GRANT SELECT(id,role,account_status) ON users TO '+role);
  const seq=await client.query("SELECT pg_get_serial_sequence('skills','id') AS name");
  if(seq.rows[0].name) await client.query('GRANT USAGE,SELECT ON SEQUENCE '+seq.rows[0].name+' TO '+role);
  await client.query('COMMIT');
  const runtime=new URL(owner);
  runtime.username=role;runtime.password=password;runtime.searchParams.set('sslmode','verify-full');
  await writeFile(path.join(__dirname,'../.env'),'DATABASE_URL='+runtime+'\nMIGRATION_DATABASE_URL='+owner+'\n');
  console.log('Applied the inspected Neon migration and saved a separate Profile runtime login.');
  const check=new Pool({connectionString:runtime.toString(),connectionTimeoutMillis:8000});
  try{
   const result=await check.query("SELECT has_column_privilege(current_user,'users','password_hash','SELECT') AS read_password,has_table_privilege(current_user,'users','UPDATE') AS change_identity,has_table_privilege(current_user,'alumni_profiles','UPDATE') AS edit_profiles");
   console.log(JSON.stringify(result.rows[0]));
  }finally{await check.end();}
 }catch(error){
  try{await client.query('ROLLBACK');}catch{}
  console.error('Neon setup failed',error.code??error.message);process.exitCode=1;
 }finally{client.release();await pool.end();}
}
main().catch(error=>{console.error('Neon connection failed',error.code??'CONFIGURATION');process.exitCode=1;});
