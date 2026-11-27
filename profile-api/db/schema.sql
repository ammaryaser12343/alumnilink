BEGIN;
SELECT pg_advisory_xact_lock(245882, 1);
-- users and locations belong to Daniel and Ammar and must exist first.
CREATE TABLE IF NOT EXISTS alumni_profiles (
 id uuid PRIMARY KEY, user_id uuid NOT NULL UNIQUE REFERENCES users(id),
 graduation_year integer NOT NULL CHECK (graduation_year BETWEEN 1950 AND 2100),
 company varchar(100), location varchar(100), industry varchar(50), bio varchar(500),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE alumni_profiles ADD COLUMN IF NOT EXISTS contact_email varchar(254);
ALTER TABLE alumni_profiles ADD COLUMN IF NOT EXISTS location_id integer REFERENCES locations(id);
ALTER TABLE alumni_profiles ADD COLUMN IF NOT EXISTS location varchar(100);
ALTER TABLE alumni_profiles ADD COLUMN IF NOT EXISTS photo_audience varchar(12) NOT NULL DEFAULT 'private'
 CHECK (photo_audience IN ('private','alumni','students','directory'));
CREATE TABLE IF NOT EXISTS skills (
 id serial PRIMARY KEY, name varchar(50) NOT NULL UNIQUE CHECK (name = lower(name))
);
CREATE TABLE IF NOT EXISTS alumni_skills (
 profile_id uuid NOT NULL REFERENCES alumni_profiles(id) ON DELETE CASCADE,
 skill_id integer NOT NULL REFERENCES skills(id),
 PRIMARY KEY (profile_id, skill_id)
);
CREATE TABLE IF NOT EXISTS privacy_settings (
 profile_id uuid NOT NULL REFERENCES alumni_profiles(id) ON DELETE CASCADE,
 field_name varchar(30) NOT NULL CHECK (field_name IN ('graduation_year','company','location','industry','bio','skills')),
 is_visible boolean NOT NULL DEFAULT false,
 PRIMARY KEY (profile_id, field_name)
);
CREATE TABLE IF NOT EXISTS profile_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
-- Import the earlier starter's array exactly once and keep its original column as a recovery copy.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='alumni_profiles' AND column_name='skills')
 AND NOT EXISTS (SELECT 1 FROM profile_schema_migrations WHERE version='001-normalized-skills') THEN
  INSERT INTO skills(name)
  SELECT DISTINCT lower(regexp_replace(trim(s), '\s+', ' ', 'g'))
  FROM alumni_profiles p CROSS JOIN LATERAL unnest(p.skills) s WHERE trim(s) <> ''
  ON CONFLICT(name) DO NOTHING;
  INSERT INTO alumni_skills(profile_id,skill_id)
  SELECT DISTINCT p.id,k.id FROM alumni_profiles p CROSS JOIN LATERAL unnest(p.skills) s
  JOIN skills k ON k.name=lower(regexp_replace(trim(s), '\s+', ' ', 'g'))
  ON CONFLICT DO NOTHING;
 END IF;
END $$;
INSERT INTO profile_schema_migrations(version) VALUES('001-normalized-skills') ON CONFLICT DO NOTHING;
-- Existing choices are preserved. Seed accounts use sparse overrides in docs/seed.sql.
INSERT INTO privacy_settings(profile_id,field_name,is_visible)
SELECT p.id, field, false FROM alumni_profiles p
JOIN users u ON u.id = p.user_id
CROSS JOIN unnest(ARRAY['graduation_year','company','location','industry','bio','skills']) field
WHERE u.password_hash IS DISTINCT FROM 'SEED_ACCOUNT_NO_LOGIN'
ON CONFLICT DO NOTHING;
COMMIT;
