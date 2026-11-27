const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID, randomBytes } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");
const express = require("express");
const sharp = require("sharp");
const { MAX_PHOTO_BYTES } = require("../services/photoStore");
const { signToken } = require("../../shared/auth");
const { PGlite } = require("@electric-sql/pglite");
const { createApp } = require("../app");
const { createStore } = require("../services/profileStore");
const { createServiceClient } = require("../services/serviceClient");

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
    admin: randomUUID(),
  };
  const roleFor = (name) => ({ student: "student", stranger: "student", admin: "admin" })[name] ?? "alumni";
  for (const [name, id] of Object.entries(userIds)) {
    await db.query(
      `INSERT INTO users(id,name,email,password_hash,role,account_status)
   VALUES($1,$2,$3,'test-fixture',$4,'active')`,
      [
        id,
        name,
        name + "@example.test",
        roleFor(name),
      ],
    );
  }
  const secret = randomBytes(32).toString("hex");
  process.env.TOKEN_SECRET = randomBytes(32).toString("hex");
  const requestIds = [];
  let locationMode = "ok";
  let identityMode = "ok";
  const teammate = express();
  teammate.use(express.json());
  teammate.use((req, res, next) => {
    if (req.get("X-Service-Key") !== secret)
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
    return rows[0] ? res.json(rows[0]) : res.sendStatus(404);
  });
  teammate.post("/internal/locations/resolve", async (req, res) => {
    if (locationMode === "fail") return res.sendStatus(500);
    if (locationMode === "timeout") return;
    if (locationMode === "malformed")
      return res.json({ location: { id: "bad" } });
    if (req.body.location !== "Cairo") return res.sendStatus(400);
    const { rows } =
      await db.query(`INSERT INTO locations(query_key,name,country,latitude,longitude)
   VALUES('cairo','Cairo','Egypt',30,31) ON CONFLICT(query_key) DO UPDATE SET name=excluded.name RETURNING id`);
    assert.ok(rows[0].id);
    res.json({ location: { name: "Cairo", country: "Egypt", latitude: 30, longitude: 31 }, cached: true });
  });
  const base = await serve(teammate, t);
  const token = (name) => signToken({
    sub: userIds[name],
    role: roleFor(name),
  });
  const tokens = Object.fromEntries(
    Object.keys(userIds).map((name) => [name, token(name)]),
  );
  const logs = [];
  const photos = new Map();
  const app = createApp({
    store: createStore(db),
    photos: {
      read: async (id) => photos.get(id),
      save: async (id, photo) => photos.set(id, photo),
      remove: async (id) => photos.delete(id),
    },
    identity: createServiceClient({
      baseUrl: base,
      serviceKey: secret,
      service: "Identity",
      timeoutMs: 100,
    }),
    locations: createServiceClient({
      baseUrl: base,
      serviceKey: secret,
      service: "Locations",
      timeoutMs: 100,
    }),
    config: {
      serviceKey: secret,
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
        "X-Service-Key": credential,
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
      assert.equal(result.body.profile.location, "Cairo");
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
  await t.test("photo upload, validation, replacement, and owner-only access", async () => {
    const route = "/api/profiles/me/photo";
    const requestPhoto = (method = "GET", who = "alumni", body, type, suffix = "") =>
      fetch(url + route + suffix, {
        method,
        headers: {
          ...(who && { Authorization: "Bearer " + tokens[who] }),
          ...(type && { "Content-Type": type }),
        },
        body,
      });

    assert.equal((await requestPhoto("GET", null)).status, 401);
    assert.equal((await requestPhoto("GET", "student")).status, 403);
    assert.equal((await requestPhoto("GET", "other")).status, 404);
    assert.equal((await requestPhoto()).status, 204);

    const png = await sharp({
      create: { width: 960, height: 720, channels: 3, background: "red" },
    }).png().withMetadata().toBuffer();
    const jpeg = await sharp({
      create: { width: 60, height: 40, channels: 3, background: "blue" },
    }).jpeg().toBuffer();

    const initial = await requestPhoto("PUT", "alumni", png, "image/png");
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get("content-type"), "image/webp");
    assert.equal(initial.headers.get("cache-control"), "no-store");
    const initialBytes = Buffer.from(await initial.arrayBuffer());
    const metadata = await sharp(initialBytes).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ["webp", 512, 512]);
    assert.equal(metadata.exif, undefined);

    assert.equal((await requestPhoto("PUT", "alumni", jpeg, "image/png")).status, 400);
    assert.equal((await requestPhoto("PUT", "alumni", png, "image/svg+xml")).status, 415);
    const oversized = await requestPhoto("PUT", "alumni", Buffer.alloc(MAX_PHOTO_BYTES + 1), "image/png");
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error.code, "PHOTO_TOO_LARGE");
    assert.deepEqual(Buffer.from(await (await requestPhoto()).arrayBuffer()), initialBytes);

    const alternate = await createStore(db).saveProfile(userIds.other, { graduationYear: 2022 }, true);
    assert.equal((await requestPhoto("GET", "other", undefined, undefined, "?profileId=" + profileId)).status, 204);
    assert.equal((await requestPhoto("DELETE", "other", undefined, undefined, "?profileId=" + profileId)).status, 204);
    assert.equal(photos.has(alternate.id), false);
    assert.deepEqual(photos.get(profileId), initialBytes);

    const replacement = await requestPhoto("PUT", "alumni", jpeg, "image/jpeg");
    assert.equal(replacement.status, 200);
    const replacementBytes = Buffer.from(await replacement.arrayBuffer());
    assert.notDeepEqual(replacementBytes, initialBytes);
    const smallPhoto = await sharp(replacementBytes).metadata();
    assert.ok(smallPhoto.width <= 60 && smallPhoto.height <= 40);
    assert.deepEqual(Buffer.from(await (await requestPhoto()).arrayBuffer()), replacementBytes);

    assert.equal((await requestPhoto("DELETE")).status, 204);
    assert.equal((await requestPhoto("DELETE")).status, 204);
    assert.equal((await requestPhoto()).status, 204);
  });

  await t.test("directory photos honor audience, ownership, and current account state", async () => {
    const audiencePath = "/api/profiles/me/photo/audience";
    const list = (who, ids = profileId) =>
      api("/api/profiles/directory/photos?ids=" + ids, "GET", null, who);
    const set = (audience, who = "alumni") =>
      api(audiencePath, "PATCH", { audience }, who);
    const sample = await sharp({
      create: { width: 512, height: 512, channels: 3, background: "red" },
    }).webp().toBuffer();
    photos.set(profileId, sample);
    const compressed = await sharp(sample).resize(256, 256).webp({ quality: 82 }).toBuffer();
    const allowedPhoto = { [profileId]: compressed.toString("base64") };

    assert.deepEqual((await api(audiencePath)).body, { audience: "private" });
    assert.equal((await list(null)).status, 401);
    assert.equal((await list("student", "invalid")).status, 400);
    assert.equal((await set("public")).status, 400);
    assert.equal((await set("directory", "student")).status, 403);
    assert.deepEqual((await list("other")).body.photos, {});
    assert.deepEqual((await list("student")).body.photos, {});

    assert.deepEqual((await set("students")).body, { audience: "students" });
    assert.deepEqual((await list("student")).body.photos, allowedPhoto);
    assert.deepEqual((await list("other")).body.photos, {});
    assert.deepEqual((await list("admin")).body.photos, {});
    await set("directory", "other");
    assert.deepEqual((await api(audiencePath)).body, { audience: "students" });

    await set("alumni");
    assert.deepEqual((await list("student")).body.photos, {});
    assert.deepEqual((await list("other")).body.photos, allowedPhoto);
    assert.deepEqual((await list("admin")).body.photos, {});

    await set("directory");
    for (const viewer of ["student", "other", "admin"]) {
      assert.deepEqual((await list(viewer)).body.photos, allowedPhoto);
    }
    await db.query("UPDATE users SET account_status='suspended' WHERE id=$1", [userIds.student]);
    assert.equal((await list("student")).status, 403);
    await db.query("UPDATE users SET account_status='active' WHERE id=$1", [userIds.student]);
    await api("/api/profiles/me/status", "PATCH", { isActive: false });
    assert.deepEqual((await list("other")).body.photos, {});
    await api("/api/profiles/me/status", "PATCH", { isActive: true });
    await db.query("UPDATE users SET account_status='suspended' WHERE id=$1", [userIds.alumni]);
    assert.deepEqual((await list("other")).body.photos, {});
    await db.query("UPDATE users SET account_status='active' WHERE id=$1", [userIds.alumni]);

    await set("private");
    assert.deepEqual((await list("student")).body.photos, {});
    assert.deepEqual((await list("admin")).body.photos, {});
    assert.deepEqual(photos.get(profileId), sample);
    photos.delete(profileId);
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
          .profile.location,
        "",
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
      assert.deepEqual((await contact()).body, { profileId, contactEmail: "alumni@example.test" });
      assert.equal(
        (await api("/internal/profiles/" + profileId + "/contact", "GET", null, null, { "X-Service-Key": secret })).status,
        401,
      );
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
  await t.test("an Alumni sender can reveal accepted contact details for another Alum", async () => {
    const requestId = randomUUID();
    await db.query(
      "INSERT INTO contact_requests(id,student_user_id,alumni_profile_id) VALUES($1,$2,$3)",
      [requestId, userIds.other, profileId],
    );
    assert.equal((await contact("other", profileId, requestId)).status, 403);

    await db.query("UPDATE contact_requests SET status='accepted' WHERE id=$1", [
      requestId,
    ]);
    const result = await contact("other", profileId, requestId);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { profileId, contactEmail: "alumni@example.test" });
    assert.equal((await contact("alumni", profileId, requestId)).status, 403);
    assert.equal((await contact("student", profileId, requestId)).status, 403);

    const selfRequestId = randomUUID();
    await db.query(
      "INSERT INTO contact_requests(id,student_user_id,alumni_profile_id,status) VALUES($1,$2,$3,'accepted')",
      [selfRequestId, userIds.alumni, profileId],
    );
    assert.equal((await contact("alumni", profileId, selfRequestId)).status, 403);

    await db.query("UPDATE users SET account_status='suspended' WHERE id=$1", [
      userIds.other,
    ]);
    assert.equal((await contact("other", profileId, requestId)).status, 403);
  });
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

test("Express deployment entry serves health and keeps profile routes protected", async (t) => {
  const app = require("../app");
  const url = await serve(app, t);
  const health = await fetch(url + "/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { service: "profile-and-privacy", status: "ok" });
  const protectedProfile = await fetch(url + "/api/profiles/me");
  assert.equal(protectedProfile.status, 401);
  assert.equal((await protectedProfile.json()).error.code, "AUTH_REQUIRED");
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
