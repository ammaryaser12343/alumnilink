const { randomUUID } = require("node:crypto");
const { ApiError } = require("../errors");
const { privacyFields } = require("../validation");

const columns = `p.id, p.user_id AS "userId", p.graduation_year AS "graduationYear",
 COALESCE(p.company,'') AS company, COALESCE(p.industry,'') AS industry, COALESCE(p.bio,'') AS bio,
 p.contact_email AS "contactEmail", p.location_id AS "locationId",
 COALESCE(p.location,'') AS location, p.is_active AS "isActive",
 COALESCE((SELECT json_agg(s.name ORDER BY s.name) FROM alumni_skills a JOIN skills s ON s.id=a.skill_id
           WHERE a.profile_id=p.id), '[]'::json) AS skills`;

async function readProfile(db, userId) {
  const { rows } = await db.query(
    `SELECT ${columns} FROM alumni_profiles p WHERE p.user_id=$1`,
    [userId],
  );
  return rows[0];
}
async function lockProfile(db, userId) {
  const { rows } = await db.query(
    "SELECT id FROM alumni_profiles WHERE user_id=$1 FOR UPDATE",
    [userId],
  );
  if (!rows[0])
    throw new ApiError(404, "PROFILE_NOT_FOUND", "Create your profile first.");
  return rows[0].id;
}
async function replaceSkills(db, profileId, names) {
  const ids = [];
  // Stable order avoids deadlocks when two profiles create the same new skills.
  for (const name of [...names].sort()) {
    const { rows } = await db.query(
      `INSERT INTO skills(name) VALUES($1)
      ON CONFLICT(name) DO UPDATE SET name=excluded.name RETURNING id`,
      [name],
    );
    ids.push(rows[0].id);
  }
  await db.query("DELETE FROM alumni_skills WHERE profile_id=$1", [profileId]);
  for (const id of ids) {
    await db.query(
      "INSERT INTO alumni_skills(profile_id,skill_id) VALUES($1,$2)",
      [profileId, id],
    );
  }
}
function createStore(db) {
  return {
    findProfile: (userId) => readProfile(db, userId),
    saveProfile(userId, changes, create = false) {
      return db.transaction(async (tx) => {
        let profileId;
        if (create) {
          const { rows } = await tx.query(
            `INSERT INTO alumni_profiles
            (id,user_id,graduation_year,company,industry,bio,contact_email,location)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id) DO NOTHING RETURNING id`,
            [
              randomUUID(),
              userId,
              changes.graduationYear,
              changes.company ?? "",
              changes.industry ?? "",
              changes.bio ?? "",
              changes.contactEmail ?? null,
              changes.location ?? null,
            ],
          );
          if (!rows[0])
            throw new ApiError(
              409,
              "PROFILE_EXISTS",
              "This account already has a profile.",
            );
          profileId = rows[0].id;
          for (const field of privacyFields) {
            await tx.query(
              "INSERT INTO privacy_settings(profile_id,field_name,is_visible) VALUES($1,$2,false)",
              [profileId, field],
            );
          }
        } else {
          profileId = await lockProfile(tx, userId);
          await tx.query(
            `UPDATE alumni_profiles SET
            graduation_year=COALESCE($2,graduation_year), company=COALESCE($3,company),
            industry=COALESCE($4,industry), bio=COALESCE($5,bio),
            contact_email=CASE WHEN $6 THEN $7 ELSE contact_email END,
            location_id=CASE WHEN $8 THEN NULL ELSE location_id END,
            location=CASE WHEN $8 THEN $9 ELSE location END, updated_at=now()
            WHERE id=$1`,
            [
              profileId,
              changes.graduationYear ?? null,
              changes.company ?? null,
              changes.industry ?? null,
              changes.bio ?? null,
              Object.hasOwn(changes, "contactEmail"),
              changes.contactEmail ?? null,
              Object.hasOwn(changes, "location"),
              changes.location ?? null,
            ],
          );
        }
        if (changes.skills) await replaceSkills(tx, profileId, changes.skills);
        return readProfile(tx, userId);
      });
    },
    setSkills(userId, names) {
      return db.transaction(async (tx) => {
        const profileId = await lockProfile(tx, userId);
        await replaceSkills(tx, profileId, names);
        return (await readProfile(tx, userId)).skills;
      });
    },
    async getPrivacy(userId) {
      const { rows } = await db.query(
        `SELECT s.field_name,s.is_visible FROM alumni_profiles p
        JOIN privacy_settings s ON s.profile_id=p.id WHERE p.user_id=$1`,
        [userId],
      );
      return Object.fromEntries(
        privacyFields.map((field) => [
          field,
          rows.find((row) => row.field_name === field)?.is_visible ?? false,
        ]),
      );
    },
    setPrivacy(userId, changes) {
      return db.transaction(async (tx) => {
        const profileId = await lockProfile(tx, userId);
        for (const [field, value] of Object.entries(changes)) {
          await tx.query(
            `INSERT INTO privacy_settings(profile_id,field_name,is_visible) VALUES($1,$2,$3)
            ON CONFLICT(profile_id,field_name) DO UPDATE SET is_visible=excluded.is_visible`,
            [profileId, field, value],
          );
        }
      });
    },
    async setStatus(userId, isActive) {
      const { rows } = await db.query(
        "UPDATE alumni_profiles SET is_active=$2,updated_at=now() WHERE user_id=$1 RETURNING id",
        [userId, isActive],
      );
      if (!rows[0])
        throw new ApiError(
          404,
          "PROFILE_NOT_FOUND",
          "Create your profile first.",
        );
      return readProfile(db, userId);
    },
    async contactContext(profileId, requestId, senderId) {
      const { rows } = await db.query(
        `SELECT p.user_id AS "ownerId" FROM alumni_profiles p
        JOIN contact_requests r ON r.alumni_profile_id=p.id
        WHERE p.id=$1 AND r.id=$2 AND r.student_user_id=$3 AND r.status='accepted' AND p.is_active`,
        [profileId, requestId, senderId],
      );
      return rows[0];
    },
    async contactEmail(profileId, requestId, senderId) {
      const { rows } = await db.query(
        `SELECT p.contact_email AS "contactEmail" FROM alumni_profiles p
        JOIN contact_requests r ON r.alumni_profile_id=p.id
        JOIN users sender ON sender.id=r.student_user_id
        JOIN users recipient ON recipient.id=p.user_id
        WHERE p.id=$1 AND r.id=$2 AND r.student_user_id=$3 AND r.status='accepted' AND p.is_active
        AND sender.role='student' AND sender.account_status='active'
        AND recipient.role='alumni' AND recipient.account_status='active'`,
        [profileId, requestId, senderId],
      );
      return rows[0];
    },
  };
}
module.exports = { createStore };
