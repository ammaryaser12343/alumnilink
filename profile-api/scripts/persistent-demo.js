// Local development only. Never package this script or its owner credentials.
const { Pool } = require('pg');
const express = require('express');
const { signToken, verifyToken } = require('../../shared/auth');
const { randomUUID, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const base = path.join(__dirname, '..');
const statePath = path.join(base, '.env.persistent-demo.json');
const recoveryPath = path.join(base, '.env.persistent-demo-runtime');
const lockPath = path.join(base, '.env.test-session-lock');
const controlPath = path.join(base, '.env.persistent-demo-control');
const stopPath = path.join(base, '.env.persistent-demo-stop');
const origin = 'http://localhost:4566';
const site = origin + '/alumnilink-accounts-web/';

function cloud(action, payload = {}) {
  const code = `
import boto3,json,sys
p=json.load(sys.stdin)
s=boto3.Session(aws_access_key_id='test',aws_secret_access_key='test',region_name='us-east-1')
l=s.client('lambda',endpoint_url='http://127.0.0.1:4566')
b=s.client('s3',endpoint_url='http://127.0.0.1:4566')
bucket='alumnilink-accounts-web'
if p['action']=='snapshot':
 print(json.dumps({'settings':l.get_function_configuration(FunctionName='alumnilink-accounts')['Environment']['Variables'],'config':b.get_object(Bucket=bucket,Key='js/profile-config.js')['Body'].read().decode()}))
elif p['action']=='settings':
 l.update_function_configuration(FunctionName='alumnilink-accounts',Environment={'Variables':p['settings']})
 l.get_waiter('function_updated_v2').wait(FunctionName='alumnilink-accounts')
 print('{}')
elif p['action']=='upload':
 b.put_object(Bucket=bucket,Key=p['key'],Body=p['body'].encode(),ContentType=p['contentType'],CacheControl='no-store')
 print('{}')
`;
  const r = spawnSync('docker', ['exec', '-i', 'alumnilink-floci-1', 'python3', '-c', code], {
    input: JSON.stringify({ action, ...payload }), encoding: 'utf8', windowsHide: true, timeout: 45000,
  });
  if (r.status !== 0) throw new Error('Could not access the local Floci configuration.');
  return JSON.parse(r.stdout);
}
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function openDemo(token) {
  if (process.argv.includes('--no-open')) return;
  const launched = spawnSync('powershell.exe',['-NoProfile','-Command','Start-Process -FilePath $env:ALUMNILINK_DEMO_URL'],{
    env:{...process.env,ALUMNILINK_DEMO_URL:site+'demo-session.html#'+token},encoding:'utf8',windowsHide:true,
  });
  if (launched.status !== 0) throw new Error('Could not open the browser.');
}
async function reopenDemo() {
  const state = await readJson(statePath);
  if (!state || !(await readJson(recoveryPath)))
    throw new Error('A smoke test or timed demo is running. Wait for it to finish.');
  const current = cloud('snapshot');
  const match = /DEMO_SESSION_URL=(.*);/.exec(current.config);
  if (!match) throw new Error('The existing demo is still starting. Retry shortly.');
  const url = new URL(JSON.parse(match[1]));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^\/session\/[a-f0-9]{64}$/.test(url.pathname))
    throw new Error('The local demo session address is invalid.');
  const response = await fetch(url,{headers:{Origin:origin},signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error('The existing demo is unavailable. Stop it with demo.ps1 -Stop, then start again.');
  const { token } = await response.json();
  if (!current.settings.TOKEN_SECRET) throw new Error('Stop the older demo and redeploy Profile before reopening it.');
  process.env.TOKEN_SECRET = current.settings.TOKEN_SECRET;
  const claims = verifyToken(token);
  if (claims?.sub !== state.userId || claims.role !== 'alumni') throw new Error('The running session is not your demo account.');
  const api = /http:\/\/[0-9a-z]+\.execute-api\.localhost\.floci\.io:4566/.exec(current.config)?.[0];
  if (!api) throw new Error('The local Profile API address is missing.');
  const checked = await fetch(api+'/api/profiles/me',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if (![200,404].includes(checked.status)) throw new Error('The running demo could not reach the Profile API. Stop and start the demo again.');
  openDemo(token);
  console.log(process.argv.includes('--no-open') ? 'Verified the running demo and its Profile API.' : 'Your local demo is already running. Reopened the same saved account.');
  console.log('To stop it: .\\infra\\floci\\demo.ps1 -Stop');
}
async function main() {
  // The same lock is used by disposable smoke tests and the older timed demo.
  const previous = await fs.readFile(lockPath,'utf8').catch(e => { if(e.code === 'ENOENT') return null; throw e; });
  if (previous !== null) {
    const pid = Number(previous);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid demo lock; inspect it before continuing.');
    let running = true;
    try { process.kill(pid,0); }
    catch(e) { if(e.code === 'ESRCH') { await fs.unlink(lockPath); running=false; } else throw e; }
    if (running) {
      if (process.argv.includes('--stop')) {
        const control = await readJson(controlPath);
        if (control?.pid !== pid) throw new Error('This older demo must be stopped from its original terminal before using -Stop.');
        await fs.writeFile(stopPath,String(pid));
        for (let attempt=0;attempt<60;attempt++) {
          try { await fs.access(lockPath); } catch(e) { if(e.code==='ENOENT') { console.log('Demo stopped. Saved Neon data is kept.'); return; } throw e; }
          await new Promise(resolve=>setTimeout(resolve,500));
        }
        throw new Error('Stop requested; cleanup is still running. Retry shortly.');
      }
      await reopenDemo(); return;
    }
  }
  if (process.argv.includes('--stop')) { console.log('No demo is running. Saved Neon data is kept.'); return; }
  const lock = await fs.open(lockPath, 'wx').catch(() => {
    throw new Error('Another demo/test is active. Stop it before starting this one.');
  });
  await lock.writeFile(String(process.pid));
  await fs.unlink(stopPath).catch(e=>{if(e.code!=='ENOENT')throw e;});
  let original, services, sessions, db;
  let ready = false;
  try {
    original = await readJson(recoveryPath) || cloud('snapshot');
    await fs.writeFile(recoveryPath, JSON.stringify(original));
    if (!original.settings.DATABASE_URL || !process.env.MIGRATION_DATABASE_URL)
      throw new Error('Configure the existing Neon connections first.');
    db = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL, connectionTimeoutMillis: 8000 });
    let state = await readJson(statePath);
    if (!state) {
      state = { userId: randomUUID(), email: 'ahmed-local-demo-' + randomUUID() + '@example.test', locationKey: 'ahmed-persistent-demo-' + randomUUID() };
      await fs.writeFile(statePath, JSON.stringify(state, null, 2));
    }
    // This dedicated synthetic identity survives stop/restart; normal accounts are never changed.
    await db.query(`INSERT INTO users(id,name,email,password_hash,role,account_status)
      VALUES($1,'Ahmed local demo',$2,'local-demo-only-no-password-login','alumni','active')
      ON CONFLICT(id) DO NOTHING`, [state.userId, state.email]);
    const identity = (await db.query('SELECT role,account_status FROM users WHERE id=$1', [state.userId])).rows[0];
    if (identity?.role !== 'alumni' || identity.account_status !== 'active')
      throw new Error('The local demo identity is not an active Alumni account.');
    await db.query(`INSERT INTO locations(query_key,name,country,latitude,longitude)
      VALUES($1,'Demo city','Egypt',30,31) ON CONFLICT(query_key) DO UPDATE SET query_key=EXCLUDED.query_key RETURNING id`, [state.locationKey]);
    const serviceToken = randomBytes(32).toString('hex');
    const tokenSecret = randomBytes(32).toString('hex');
    process.env.TOKEN_SECRET = tokenSecret;
    const issueToken = () => signToken({ sub: state.userId, role: 'alumni' }, 5 * 60);
    const doubles = express();
    doubles.use(express.json());
    doubles.use((req,res,next) => req.get('X-Service-Key') === serviceToken ? next() : res.sendStatus(401));
    doubles.get('/internal/users/:id/status', async (req,res) => {
      if (req.params.id !== state.userId) return res.sendStatus(404);
      try {
        const result = await db.query('SELECT id,role,account_status AS "accountStatus" FROM users WHERE id=$1', [state.userId]);
        if (!result.rows[0]) return res.sendStatus(404);
        res.json(result.rows[0]);
      } catch { res.sendStatus(503); }
    });
    doubles.post('/internal/locations/resolve', (_req,res) => res.json({ location: { name: "Demo city", country: "Egypt", latitude: 30, longitude: 31 }, cached: true }));
    services = doubles.listen(0, '0.0.0.0');
    await once(services, 'listening');
    const sessionApp = express();
    const sessionRoute = '/session/' + randomBytes(32).toString('hex');
    sessionApp.use((req,res,next) => {
      res.set('Cache-Control','no-store');
      if (req.get('Origin') !== origin) return res.sendStatus(403);
      res.set('Access-Control-Allow-Origin',origin).set('Vary','Origin');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
    sessionApp.get(sessionRoute, async (_req,res) => {
      try {
        const user = (await db.query('SELECT account_status FROM users WHERE id=$1',[state.userId])).rows[0];
        if (user?.account_status !== 'active') return res.sendStatus(403);
        res.json({ token: issueToken() });
      } catch { res.sendStatus(503); }
    });
    // Only this loopback listener can mint a token, for the single synthetic account.
    sessions = sessionApp.listen(0, '127.0.0.1');
    await once(sessions,'listening');
    const sessionUrl = 'http://127.0.0.1:' + sessions.address().port + sessionRoute;
    const doubleUrl = 'http://host.docker.internal:' + services.address().port;
    cloud('settings', { settings: { ...original.settings,
      TOKEN_SECRET: tokenSecret, SERVICE_KEY: serviceToken,
      IDENTITY_API_URL: doubleUrl, SEARCH_API_URL: doubleUrl,
    } });
    // Publish the current frontend client; no demo endpoint is added to its normal config.
    cloud('upload',{ key:'js/profile-client.js', body:await fs.readFile(path.join(base,'../frontend/js/profile-client.js'),'utf8'), contentType:'application/javascript' });
    cloud('upload',{ key:'js/profile-config.js', body:original.config + '\nwindow.ALUMNILINK.DEMO_SESSION_URL=' + JSON.stringify(sessionUrl) + ';\n',contentType:'application/javascript' });
    cloud('upload',{ key:'demo-session.html',body:'<meta charset="utf-8"><title>Local test session</title><script>const t=location.hash.slice(1);if(t){sessionStorage.setItem("alumnilink.accessToken",t);location.replace("profile.html");}</script><p>Run the local demo to open a new test session.</p>',contentType:'text/html' });
    // Verify renewal restrictions and the real deployed API before opening the browser.
    if ((await fetch(sessionUrl)).status !== 403) throw new Error('Session origin restriction failed.');
    const renewed = await fetch(sessionUrl,{headers:{Origin:origin}});
    const { token } = await renewed.json();
    if (verifyToken(token)?.sub !== state.userId)
      throw new Error('Session renewal failed.');
    const api = /http:\/\/[0-9a-z]+\.execute-api\.localhost\.floci\.io:4566/.exec(original.config)?.[0];
    const response = await fetch(api + '/api/profiles/me',{headers:{Authorization:'Bearer '+token}});
    if (![200,404].includes(response.status)) throw new Error('The deployed Profile API did not accept the demo session.');
    console.log('Local demo ready. No session timer. Saved Neon data is kept after stopping.');
    console.log('Identity and Locations are test substitutes; Location resolves to Demo city, Egypt.');
    console.log('Profile: ' + site + 'profile.html');
    console.log('Privacy: ' + site + 'privacy.html');
    console.log('Neon demo account: ' + state.email);
    console.log('Checks passed: origin restriction, short-lived token renewal, deployed API authentication.');
    console.log('Keep this terminal and Docker running. Press Enter or Ctrl+C to stop.');
    ready = true;
    await fs.writeFile(controlPath,JSON.stringify({pid:process.pid}));
    openDemo(issueToken());
    await new Promise(resolve => {
      let timer;
      const finish = () => { clearInterval(timer); process.stdin.off('data',finish); process.off('SIGINT',finish); process.off('SIGTERM',finish); process.stdin.pause(); resolve(); };
      timer = setInterval(()=>fs.readFile(stopPath,'utf8').then(pid=>{if(pid.trim()===String(process.pid))finish();}).catch(()=>{}),500);
      process.stdin.once('data',finish); process.once('SIGINT',finish); process.once('SIGTERM',finish); process.stdin.resume();
    });
  } finally {
    try {
      if (original) {
        cloud('settings',{settings:original.settings});
        cloud('upload',{key:'js/profile-config.js',body:original.config,contentType:'application/javascript'});
        await fs.unlink(recoveryPath);
      }
    } finally {
      for (const server of [sessions,services]) if (server) await new Promise(resolve=>server.close(resolve));
      if (db) await db.end();
      await fs.unlink(controlPath).catch(e=>{if(e.code!=='ENOENT')throw e;});
      await fs.unlink(stopPath).catch(e=>{if(e.code!=='ENOENT')throw e;});
      await lock.close(); await fs.unlink(lockPath);
    }
    if (ready) console.log('Stopped. Your demo profile and privacy data remain in Neon.');
  }
}
main().catch(e=>{console.error('Local demo failed:',e.code || e.message);process.exitCode=1;});
