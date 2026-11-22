const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateKeyPairSync, randomUUID, randomBytes } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");
const express = require("express");
const jwt = require("jsonwebtoken");
const { PGlite } = require("@electric-sql/pglite");
const { createApp } = require("../app");
const { createStore } = require("../store");
const { createServiceClient } = require("../service-client");

async function serve(app, t) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return "http://127.0.0.1:" + server.address().port;
}
const fixture = (name) => readFile(path.join(__dirname, name), "utf8");
test("Profile and Privacy with real SQL and HTTP teammate test doubles", async (t) => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(await fixture("team-schema.sql"));
  const migration = await readFile(
    path.join(__dirname, "../db/schema.sql"),
    "utf8",
  );
  await db.exec(migration);
  await db.exec(await fixture("contact-schema.sql"));
  const userIds = {
    alumni: randomUUID(),
    other: randomUUID(),
    student: randomUUID(),
    stranger: randomUUID(),
  };
  for (const [name, id] of Object.entries(userIds)) {
    await db.query(
      `INSERT INTO users(id,name,email,password_hash,role,account_status)
   VALUES($1,$2,$3,'test-fixture',$4,'active')`,
      [
        id,
        name,
        name + "@example.test",
        ["student", "stranger"].includes(name) ? "student" : "alumni",
      ],
    );
  }
  const secret = randomBytes(32).toString("hex");
  const requestIds = [];
  let locationMode = "ok";
  let identityMode = "ok";
  const teammate = express();
  teammate.use(express.json());
  teammate.use((req, res, next) => {
    if (req.get("Authorization") !== "Bearer " + secret)
      return res.sendStatus(401);
    requestIds.push(req.get("X-Request-Id"));
    next();
  });
  teammate.get("/internal/users/:id/status", async (req, res) => {
    if (identityMode === "fail") return res.sendStatus(500);
    const { rows } = await db.query(
      'SELECT id,role,account_status AS "accountStatus" FROM users WHERE id=$1',
      [req.params.id],
    );
    return rows[0] ? res.json({ user: rows[0] }) : res.sendStatus(404);
  });
  teammate.post("/internal/locations/resolve", async (req, res) => {
    if (locationMode === "fail") return res.sendStatus(500);
    if (locationMode === "timeout") return;
    if (locationMode === "malformed")
      return res.json({ location: { id: "bad" } });
    if (req.body.name !== "Cairo") return res.sendStatus(400);
    const { rows } =
      await db.query(`INSERT INTO locations(query_key,name,country,latitude,longitude)
   VALUES('cairo','Cairo','Egypt',30,31) ON CONFLICT(query_key) DO UPDATE SET name=excluded.name RETURNING id`);
    res.json({ location: rows[0] });
  });
  const base = await serve(teammate, t);
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const token = (name) =>
    jwt.sign(
      { role: ["student", "stranger"].includes(name) ? "student" : "alumni" },
      privateKey,
      {
        algorithm: "RS256",
        subject: userIds[name],
        expiresIn: "15m",
        issuer: "alumnilink-accounts",
        audience: "alumnilink-api",
      },
    );
  const tokens = Object.fromEntries(
    Object.keys(userIds).map((name) => [name, token(name)]),
  );
  const logs = [];
  const app = createApp({
    store: createStore(db),
    identity: createServiceClient({
      baseUrl: base,
      token: secret,
      service: "Identity",
      timeoutMs: 100,
    }),
    locations: createServiceClient({
      baseUrl: base,
      token: secret,
      service: "Locations",
      timeoutMs: 100,
    }),
    config: {
      publicKey: publicKey.export({ format: "pem", type: "spki" }),
      searchServiceToken: secret,
    },
    logger: {
      info: (line) => logs.push(line),
      error: (line) => logs.push(line),
    },
  });
  const url = await serve(app, t);
  async function api(
    route,
    method = "GET",
    body,
    who = "alumni",
    headers = {},
  ) {
    const response = await fetch(url + route, {
      method,
      headers: {
        ...(who ? { Authorization: "Bearer " + tokens[who] } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  }
  let profileId;
  const incoming = randomUUID();
  const contact = (
    sender = "student",
    id = profileId,
    requestId = incoming,
    credential = secret,
  ) =>
    api(
      "/internal/profiles/" + id + "/contact?requestId=" + requestId,
      "GET",
      null,
      null,
      {
        Authorization: "Bearer " + credential,
        "X-User-Token": tokens[sender],
      },
    );
  await t.test(
    "missing authentication, Student denial, and identity outage",
    async () => {
      assert.equal(
        (await api("/api/profiles/me", "GET", null, null)).status,
        401,
      );
      assert.equal(
        (await api("/api/profiles/me", "GET", null, "student")).status,
        403,
      );
      identityMode = "fail";
      assert.equal((await api("/api/profiles/me")).status, 503);
      identityMode = "ok";
    },
  );
  await t.test(
    "create, unique owner, contact email and normalized skills",
    async () => {
      const result = await api("/api/profiles", "POST", {
        graduationYear: 2020,
        company: "Original",
        contactEmail: "alumni@example.test",
        skills: [" Node.js ", "node.js", "SQL"],
        location: "Cairo",
      });
      assert.equal(result.status, 201);
      profileId = result.body.profile.id;
      assert.deepEqual(result.body.profile.skills, ["node.js", "sql"]);
      assert.equal(result.body.profile.location, "Cairo, Egypt");
      assert.equal(
        (await api("/api/profiles", "POST", { graduationYear: 2020 })).status,
        409,
      );
    },
  );
  await t.test("ownership and invalid fields", async () => {
    assert.equal(
      (
        await api("/api/profiles/me", "PATCH", {
          userId: userIds.other,
          company: "Bad",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await api(
          "/api/profiles/" + profileId,
          "PATCH",
          { company: "Bad" },
          "other",
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await api(
          "/api/profiles/me/privacy",
          "PATCH",
          { company: true },
          "other",
        )
      ).status,
      404,
    );
    assert.equal(
      (await api("/api/profiles/me")).body.profile.company,
      "Original",
    );
  });
  await t.test(
    "privacy choices default hidden and updates remain owner-scoped",
    async () => {
      const defaults = (await api("/api/profiles/me/privacy")).body.privacy;
      assert.equal(
        Object.values(defaults).every((value) => value === false),
        true,
      );
      assert.equal(
        (
          await api("/api/profiles/me/privacy", "PATCH", {
            company: true,
            location: false,
          })
        ).status,
        200,
      );
      assert.equal(
        (await api("/api/profiles/me/privacy")).body.privacy.company,
        true,
      );
      assert.equal(
        (
          await api("/api/profiles/me/privacy", "PATCH", {
            contact_email: true,
          })
        ).status,
        400,
      );
      assert.equal(
        (await api("/api/profiles/me/privacy", "PATCH", { company: "true" }))
          .status,
        400,
      );
    },
  );
  await t.test(
    "skills replace supports empty set and concurrent updates preserve consistency",
    async () => {
      assert.equal(
        (await api("/api/profiles/me/skills", "PUT", { skills: [] })).status,
        200,
      );
      assert.deepEqual((await api("/api/profiles/me/skills")).body.skills, []);
      const updates = await Promise.all([
        api("/api/profiles/me/skills", "PUT", { skills: ["A", "B"] }),
        api("/api/profiles/me/skills", "PUT", { skills: ["B", "C"] }),
      ]);
      assert.ok(updates.every((result) => result.status === 200));
      assert.ok(
        [JSON.stringify(["a", "b"]), JSON.stringify(["b", "c"])].includes(
          JSON.stringify((await api("/api/profiles/me/skills")).body.skills),
        ),
      );
    },
  );
  await t.test(
    "location failure, malformed result and timeout preserve old values",
    async () => {
      for (const mode of ["fail", "malformed", "timeout"]) {
        locationMode = mode;
        assert.equal(
          (
            await api("/api/profiles/me", "PATCH", {
              company: "Changed",
              location: "Cairo",
            })
          ).status,
          503,
        );
        assert.equal(
          (await api("/api/profiles/me")).body.profile.company,
          "Original",
        );
      }
      locationMode = "ok";
      assert.equal(
        (await api("/api/profiles/me", "PATCH", { location: "Unknown" }))
          .status,
        400,
      );
      assert.equal(
        (await api("/api/profiles/me", "PATCH", { location: null })).body
          .profile.locationId,
        null,
      );
    },
  );
  await db.query(
    "INSERT INTO contact_requests(id,student_user_id,alumni_profile_id) VALUES($1,$2,$3)",
    [incoming, userIds.student, profileId],
  );
  await t.test(
    "contact requires accepted consent, correct sender, target, and service credential",
    async () => {
      assert.equal((await contact()).status, 403);
      await db.query(
        "UPDATE contact_requests SET status='accepted' WHERE id=$1",
        [incoming],
      );
      assert.equal((await contact()).body.contactEmail, "alumni@example.test");
      assert.equal((await contact("stranger")).status, 403);
      assert.equal((await contact("student", randomUUID())).status, 403);
      assert.equal(
        (await contact("student", profileId, incoming, tokens.alumni)).status,
        401,
      );
      assert.equal((await contact("alumni")).status, 403);
      await db.query(
        "UPDATE contact_requests SET status='declined' WHERE id=$1",
        [incoming],
      );
      assert.equal((await contact()).status, 403);
      await db.query(
        "UPDATE contact_requests SET status='accepted' WHERE id=$1",
        [incoming],
      );
    },
  );
  await t.test(
    "deactivation and current account suspension block contact",
    async () => {
      assert.equal(
        (await api("/api/profiles/me/status", "PATCH", { isActive: false }))
          .status,
        200,
      );
      assert.equal((await contact()).status, 403);
      await api("/api/profiles/me/status", "PATCH", { isActive: true });
      await db.query(
        "UPDATE users SET account_status='suspended' WHERE id=$1",
        [userIds.student],
      );
      assert.equal((await contact()).status, 403);
      await db.query("UPDATE users SET account_status='active' WHERE id=$1", [
        userIds.student,
      ]);
      await db.query(
        "UPDATE users SET account_status='suspended' WHERE id=$1",
        [userIds.alumni],
      );
      assert.equal((await contact()).status, 403);
      assert.equal((await api("/api/profiles/me")).status, 403);
    },
  );
  await t.test(
    "migration rerun preserves changes and logs exclude credentials",
    async () => {
      await db.exec(migration);
      assert.equal(
        (
          await db.query(
            "SELECT is_visible FROM privacy_settings WHERE profile_id=$1 AND field_name='company'",
            [profileId],
          )
        ).rows[0].is_visible,
        true,
      );
      assert.ok(
        requestIds.length > 0 &&
          requestIds.every((id) => /^[a-f\d-]{36}$/.test(id)),
      );
      assert.ok(
        logs.every(
          (line) =>
            !line.includes("alumni@example.test") &&
            !line.includes(secret) &&
            !line.includes(tokens.student),
        ),
      );
    },
  );
});
test("legacy array skills migrate once and preserve existing profile data", async () => {
  const db = await PGlite.create();
  try {
    await db.exec(await fixture("team-schema.sql"));
    const user = randomUUID(),
      profile = randomUUID();
    await db.query(
      "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Legacy','legacy@example.test','fixture','alumni')",
      [user],
    );
    await db.exec(`CREATE TABLE alumni_profiles(id uuid PRIMARY KEY,user_id uuid UNIQUE REFERENCES users(id),
   graduation_year integer,company text,industry text,bio text,is_active boolean DEFAULT true,
   updated_at timestamptz DEFAULT now(),skills text[] DEFAULT '{}')`);
    await db.query(
      "INSERT INTO alumni_profiles(id,user_id,graduation_year,company,skills) VALUES($1,$2,2020,'Kept',ARRAY[' SQL ','sql','Node.js'])",
      [profile, user],
    );
    const migration = await readFile(
      path.join(__dirname, "../db/schema.sql"),
      "utf8",
    );
    await db.exec(migration);
    assert.deepEqual((await createStore(db).findProfile(user)).skills, [
      "node.js",
      "sql",
    ]);
    await createStore(db).setSkills(user, []);
    await db.exec(migration);
    assert.deepEqual((await createStore(db).findProfile(user)).skills, []);
    assert.equal((await createStore(db).findProfile(user)).company, "Kept");
  } finally {
    await db.close();
  }
});

test("Lambda retains JSON parsing and body limits", async () => {
  const { handler } = require("../lambda");
  const event = {
    version: "2.0", rawPath: "/api/profiles", rawQueryString: "",
    headers: { "content-type": "application/json" },
    requestContext: { http: { method: "POST", path: "/api/profiles", sourceIp: "127.0.0.1" } },
  };
  const malformed = await handler({ ...event, body: "{" }, {});
  assert.equal(malformed.statusCode, 400);
  assert.equal(JSON.parse(malformed.body).error.code, "INVALID_JSON");
  const oversized = await handler({ ...event, body: JSON.stringify({ bio: "x".repeat(17*1024) }) }, {});
  assert.equal(oversized.statusCode, 413);
  assert.equal(JSON.parse(oversized.body).error.code, "BODY_TOO_LARGE");
});