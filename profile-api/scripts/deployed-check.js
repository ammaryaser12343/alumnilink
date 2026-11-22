const assert = require("node:assert/strict");
const { Pool } = require("pg");
const express = require("express");
const jwt = require("jsonwebtoken");
const { generateKeyPairSync, randomUUID, randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { writeFile, mkdir, access, unlink, open } = require("node:fs/promises");
const path = require("node:path");

const functionName = "alumnilink-accounts";
function cloud(action, payload = {}) {
  const code = `
import boto3,json,sys
p=json.load(sys.stdin)
session=boto3.Session(aws_access_key_id='test',aws_secret_access_key='test',region_name='us-east-1')
c=session.client('lambda',endpoint_url='http://127.0.0.1:4566')
if p['action']=='get':
 print(json.dumps(c.get_function_configuration(FunctionName='alumnilink-accounts')['Environment']['Variables']))
elif p['action']=='update':
 c.update_function_configuration(FunctionName='alumnilink-accounts',Environment={'Variables':p['settings']})
 c.get_waiter('function_updated_v2').wait(FunctionName='alumnilink-accounts')
 print('{}')
elif p['action']=='publish-demo':
 s3=session.client('s3',endpoint_url='http://127.0.0.1:4566')
 html='<meta charset="utf-8"><title>AlumniLink temporary demo</title><script>const token=location.hash.slice(1);if(token){sessionStorage.setItem("alumnilink.accessToken",token);location.replace("profile.html");}</script><p>Opening your temporary Alumni demo.</p>'
 s3.put_object(Bucket='alumnilink-accounts-web',Key='demo-session.html',Body=html.encode(),ContentType='text/html',CacheControl='no-store')
 print('{}')
elif p['action']=='remove-demo':
 session.client('s3',endpoint_url='http://127.0.0.1:4566').delete_object(Bucket='alumnilink-accounts-web',Key='demo-session.html')
 print('{}')
else:
 logs=session.client('logs',endpoint_url='http://127.0.0.1:4566')
 result=logs.filter_log_events(logGroupName='/aws/lambda/alumnilink-accounts',startTime=p['start'])
 print(json.dumps([e['message'] for e in result.get('events',[])]))
`;
  const result = spawnSync(
    "docker",
    ["exec", "-i", "alumnilink-floci-1", "python3", "-c", code],
    {
      input: JSON.stringify({ action, ...payload }),
      encoding: "utf8",
      windowsHide: true,
      timeout: 45000,
    },
  );
  if (result.status !== 0)
    throw new Error(
      "Could not configure or inspect the Floci test deployment.",
    );
  return JSON.parse(result.stdout);
}
async function main() {
  const owner = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    connectionTimeoutMillis: 8000,
  });
  const original = cloud("get");
  if (!original.DATABASE_URL)
    throw new Error("Deploy the Profile service first.");
  const suffix = randomUUID();
  const ids = {
    alumni: randomUUID(),
    other: randomUUID(),
    student: randomUUID(),
    stranger: randomUUID(),
  };
  const secrets = randomBytes(32).toString("hex");
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const tokens = Object.fromEntries(
    Object.entries(ids).map(([name, id]) => [
      name,
      jwt.sign(
        {
          role: ["student", "stranger"].includes(name) ? "student" : "alumni",
        },
        privateKey,
        {
          algorithm: "RS256",
          subject: id,
          issuer: "alumnilink-accounts",
          audience: "alumnilink-api",
          expiresIn: "15m",
        },
      ),
    ]),
  );
  let locationId;
  let locationFails = false;
  let identityFails = false;
  const double = express();
  double.use(express.json());
  double.use((req, res, next) => {
    if (req.get("Authorization") !== "Bearer " + secrets)
      return res.sendStatus(401);
    next();
  });
  double.get("/internal/users/:id/status", async (req, res) => {
    if (identityFails) return res.sendStatus(503);
    if (!Object.values(ids).includes(req.params.id)) return res.sendStatus(404);
    const { rows } = await owner.query(
      'SELECT id,role,account_status AS "accountStatus" FROM users WHERE id=$1',
      [req.params.id],
    );
    res.json({ user: rows[0] });
  });
  double.post("/internal/locations/resolve", (req, res) => {
    if (locationFails) return res.sendStatus(503);
    res.json({ location: { id: locationId } });
  });
  const server = double.listen(0, "0.0.0.0");
  await once(server, "listening");
  const results = [];
  const started = Date.now();
  try {
    for (const [name, id] of Object.entries(ids)) {
      await owner.query(
        `INSERT INTO users(id,name,email,password_hash,role,account_status)
    VALUES($1,$2,$3,'synthetic-test-only',$4,'active')`,
        [
          id,
          "Profile test",
          name + "-" + suffix + "@example.test",
          ["student", "stranger"].includes(name) ? "student" : "alumni",
        ],
      );
    }
    locationId = (
      await owner.query(
        `INSERT INTO locations(query_key,name,country,latitude,longitude)
   VALUES($1,'Demo city','Egypt',30,31) RETURNING id`,
        ["profile-test-" + suffix],
      )
    ).rows[0].id;
    const doubleUrl = "http://host.docker.internal:" + server.address().port;
    cloud("update", {
      settings: {
        ...original,
        JWT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "pem" }),
        JWT_ISSUER: "alumnilink-accounts",
        JWT_AUDIENCE: "alumnilink-api",
        ADMIN_API_URL: doubleUrl,
        SEARCH_API_URL: doubleUrl,
        PROFILE_TO_ADMIN_TOKEN: secrets,
        PROFILE_TO_SEARCH_TOKEN: secrets,
        SEARCH_TO_PROFILE_TOKEN: secrets,
      },
    });
    const config = await (
      await fetch("http://localhost:4566/alumnilink-accounts-web/js/profile-config.js")
    ).text();
    const api =
      /http:\/\/[0-9a-z]+\.execute-api\.localhost\.floci\.io:4566/.exec(
        config,
      )?.[0];
    assert.ok(api);
    async function check(
      label,
      route,
      status,
      { method = "GET", body, who = "alumni", headers = {} } = {},
    ) {
      const response = await fetch(api + route, {
        method,
        headers: {
          ...(who ? { Authorization: "Bearer " + tokens[who] } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      assert.equal(
        response.status,
        status,
        label + " (" + (data.error?.code ?? "ok") + ")",
      );
      results.push({
        scenario: label,
        expected: status,
        actual: response.status,
        result: "pass",
        requestId: response.headers.get("x-request-id"),
      });
      console.log(label + "  " + response.status);
      return data;
    }
    await check("Gateway health", "/api/health", 200);
    await check("Missing authentication", "/api/profiles/me", 401, {
      who: null,
    });
    await check("Student role denial", "/api/profiles/me", 403, {
      who: "student",
    });
    await check("Reject client-selected owner", "/api/profiles", 400, {
      method: "POST",
      body: { userId: ids.other, graduationYear: 2020 },
    });
    const created = await check("Create Alumni profile", "/api/profiles", 201, {
      method: "POST",
      body: {
        graduationYear: 2020,
        company: "Original",
        contactEmail: "contact@example.test",
        skills: [" SQL ", "sql"],
        location: "Demo city",
      },
    });
    const profileId = created.profile.id;
    assert.deepEqual(created.profile.skills, ["sql"]);
    await check("Cross-user privacy denial", "/api/profiles/me/privacy", 404, {
      method: "PATCH",
      who: "other",
      body: { company: true },
    });
    await check("Save visibility choices", "/api/profiles/me/privacy", 200, {
      method: "PATCH",
      body: { company: true, location: false },
    });
    await check(
      "Contact field cannot become directory-visible",
      "/api/profiles/me/privacy",
      400,
      { method: "PATCH", body: { contact_email: true } },
    );
    await check("Replace skills", "/api/profiles/me/skills", 200, {
      method: "PUT",
      body: { skills: ["Express", "Node.js"] },
    });
    locationFails = true;
    await check("Location outage preserves profile", "/api/profiles/me", 503, {
      method: "PATCH",
      body: { company: "Changed", location: "Demo city" },
    });
    locationFails = false;
    assert.equal(
      (await check("Read unchanged profile", "/api/profiles/me", 200)).profile
        .company,
      "Original",
    );
    const requestId = randomUUID();
    await owner.query(
      `INSERT INTO contact_requests(id,student_user_id,alumni_profile_id,message,status)
   VALUES($1,$2,$3,'Synthetic test','pending')`,
      [requestId, ids.student, profileId],
    );
    const route =
      "/internal/profiles/" + profileId + "/contact?requestId=" + requestId;
    const headers = {
      Authorization: "Bearer " + secrets,
      "X-User-Token": tokens.student,
    };
    await check("Pending contact denied", route, 403, { who: null, headers });
    await owner.query(
      "UPDATE contact_requests SET status='accepted' WHERE id=$1",
      [requestId],
    );
    assert.equal(
      (
        await check("Accepted contact revealed", route, 200, {
          who: null,
          headers,
        })
      ).contactEmail,
      "contact@example.test",
    );
    await check("Different Student denied", route, 403, {
      who: null,
      headers: { ...headers, "X-User-Token": tokens.stranger },
    });
    await check("User token cannot impersonate Search", route, 401, {
      who: "student",
    });
    await check("Deactivate own profile", "/api/profiles/me/status", 200, {
      method: "PATCH",
      body: { isActive: false },
    });
    await check("Inactive profile contact denied", route, 403, {
      who: null,
      headers,
    });
    await check("Reactivate own profile", "/api/profiles/me/status", 200, {
      method: "PATCH",
      body: { isActive: true },
    });
    await owner.query(
      "UPDATE users SET account_status='suspended' WHERE id=$1",
      [ids.alumni],
    );
    await check("Suspended recipient contact denied", route, 403, {
      who: null,
      headers,
    });
    await check("Existing suspended token denied", "/api/profiles/me", 403);
    identityFails = true;
    await check("Identity outage fails closed", "/api/profiles/me", 503);
    let messages = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      messages = cloud("logs", { start: started });
      if (
        messages.filter((message) => /"status":403/.test(message)).length >= 6
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const denials = messages.filter((message) =>
      /"status":403/.test(message),
    ).length;
    assert.ok(denials >= 6);
    const db = new Pool({ connectionString: original.DATABASE_URL });
    try {
      const { rows } = await db.query(
        "SELECT has_column_privilege(current_user,'users','password_hash','SELECT') AS read_password, has_table_privilege(current_user,'users','UPDATE') AS change_identity",
      );
      assert.equal(rows[0].read_password, false);
      assert.equal(rows[0].change_identity, false);
      results.push({
        scenario: "Restricted runtime database privileges",
        expected: "no password read or identity writes",
        actual: rows[0],
        result: "pass",
      });
    } finally {
      await db.end();
    }
    const evidence = {
      timestamp: new Date().toISOString(),
      environment: "Floci API Gateway and Lambda with Neon PostgreSQL",
      teammateServices:
        "Explicit HTTP test doubles for Identity status and Locations. Live teammate code is unverified.",
      cloudWatchDenials: denials,
      results,
    };
    await mkdir(path.join(__dirname, "../../docs"), { recursive: true });
    await writeFile(
      path.join(__dirname, "../../docs/ahmed-deployed-evidence.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(
      "Recorded " +
        results.length +
        " checks and " +
        denials +
        " CloudWatch denials.",
    );

    if (process.argv.includes("--demo")) {
      identityFails = false;
      await owner.query("UPDATE users SET account_status='active' WHERE id=$1", [ids.alumni]);
      cloud("publish-demo");
      const url = "http://localhost:4566/alumnilink-accounts-web/demo-session.html#" + tokens.alumni;
      console.log("Temporary Alumni demo ready.");
      console.log("Profile: http://localhost:4566/alumnilink-accounts-web/profile.html");
      console.log("Privacy: http://localhost:4566/alumnilink-accounts-web/privacy.html");
      console.log("Inspect Neon while this terminal stays open. Press Enter to stop and remove the demo records.");
      const opened = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-Command", "Start-Process -FilePath $env:ALUMNILINK_DEMO_URL"],
        { env: { ...process.env, ALUMNILINK_DEMO_URL: url }, windowsHide: true, encoding: "utf8" }
      );
      if (opened.status !== 0) throw new Error("Could not open the default browser.");
      await new Promise((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          process.stdin.removeListener("data", finish);
          process.removeListener("SIGINT", finish);
          process.stdin.pause();
          resolve();
        };
        const timer = setTimeout(finish, 14 * 60 * 1000);
        process.stdin.once("data", finish);
        process.once("SIGINT", finish);
        process.stdin.resume();
      });
    }

    if (process.argv.includes("--browser")) {
      identityFails = false;
      await owner.query("UPDATE users SET account_status='active' WHERE id=$1", [ids.alumni]);
      const demoFile = path.join(__dirname, "../.env.browser-check");
      await writeFile(demoFile, JSON.stringify({ token: tokens.alumni, url: "http://localhost:4566/alumnilink-accounts-web/profile.html" }));
      console.log("Browser verification is ready for four minutes.");
      try {
        for (let attempt=0; attempt<240; attempt++) {
          try { await access(demoFile); } catch { break; }
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
      } finally { await unlink(demoFile).catch(()=>{}); }
    }
  } finally {
    try {
      cloud("update", { settings: original });
    } finally {
      if (process.argv.includes("--demo")) cloud("remove-demo");
    }
    const tx = await owner.connect();
    try {
      await tx.query("BEGIN");
      await tx.query(
        "DELETE FROM contact_requests WHERE student_user_id=ANY($1::uuid[])",
        [Object.values(ids)],
      );
      await tx.query(
        "DELETE FROM alumni_profiles WHERE user_id=ANY($1::uuid[])",
        [Object.values(ids)],
      );
      await tx.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
        Object.values(ids),
      ]);
      if (locationId)
        await tx.query("DELETE FROM locations WHERE id=$1 AND query_key=$2", [
          locationId,
          "profile-test-" + suffix,
        ]);
      await tx.query("COMMIT");
    } catch (error) {
      await tx.query("ROLLBACK");
      throw error;
    } finally {
      tx.release();
    }
    await new Promise((resolve) => server.close(resolve));
    await owner.end();
  }
}

async function withSessionLock() {
  const lockPath = path.join(__dirname, "../.env.test-session-lock");
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error("A demo or smoke test is already active. Stop it before starting another session.");
    }
    throw error;
  }
  try {
    await handle.writeFile(String(process.pid));
    await main();
  } finally {
    await handle.close();
    await unlink(lockPath);
  }
}

withSessionLock().catch((error) => {
  console.error("Deployed verification failed:", error.code ?? error.message);
  process.exitCode = 1;
});
