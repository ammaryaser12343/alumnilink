-- AlumniLink database schema (Neon PostgreSQL)
-- Run this once in the Neon SQL Editor, then run seed.sql.
-- Running it again drops every table first, so all data is lost.

DROP TABLE IF EXISTS contact_requests, locations, audit_logs, verification_requests,
  privacy_settings, alumni_skills, skills, alumni_profiles, users CASCADE;

-- Every account: alumni, students/staff and admins.
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   TEXT         NOT NULL,
  role            VARCHAR(10)  NOT NULL CHECK (role IN ('alumni', 'student', 'admin')),
  account_status  VARCHAR(10)  NOT NULL DEFAULT 'pending'
                  CHECK (account_status IN ('pending', 'active', 'suspended', 'rejected')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- One professional profile per alum (Profile and Privacy service).
CREATE TABLE alumni_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  graduation_year  INTEGER NOT NULL CHECK (graduation_year BETWEEN 1950 AND 2100),
  company          VARCHAR(100),
  location         VARCHAR(100),
  industry         VARCHAR(50),
  bio              VARCHAR(500),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Skill names are stored once, in lower case.
CREATE TABLE skills (
  id    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  VARCHAR(50) NOT NULL UNIQUE CHECK (name = lower(name))
);

-- Many-to-many link between profiles and skills.
CREATE TABLE alumni_skills (
  profile_id  UUID    NOT NULL REFERENCES alumni_profiles(id) ON DELETE CASCADE,
  skill_id    INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, skill_id)
);

-- One row per hidden or visible field. A missing row means "visible".
CREATE TABLE privacy_settings (
  profile_id  UUID        NOT NULL REFERENCES alumni_profiles(id) ON DELETE CASCADE,
  field_name  VARCHAR(30) NOT NULL
              CHECK (field_name IN ('graduation_year', 'company', 'location', 'industry', 'bio', 'skills')),
  is_visible  BOOLEAN     NOT NULL DEFAULT TRUE,
  PRIMARY KEY (profile_id, field_name)
);

-- Sign-up requests that an admin approves or rejects (Admin service).
CREATE TABLE verification_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       VARCHAR(10) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Security events from all three services. Never store passwords or tokens here.
CREATE TABLE audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  service_name   VARCHAR(20) NOT NULL CHECK (service_name IN ('profile', 'search', 'admin')),
  action         VARCHAR(50) NOT NULL,
  target_id      VARCHAR(64),
  outcome        VARCHAR(20) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Place names resolved to coordinates by the Search service (Open-Meteo Geocoding API).
-- query_key is the place text in lower case with single spaces, e.g. 'new cairo'.
-- Each place is looked up once; after that the row is the cache.
CREATE TABLE locations (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  query_key    VARCHAR(100) NOT NULL UNIQUE,
  name         VARCHAR(100) NOT NULL,
  country      VARCHAR(100),
  latitude     DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude    DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  resolved_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A student asks an alum for contact details (Search service).
-- The alum's email is never stored here; it is fetched from the Profile service
-- only after the alum accepts.
CREATE TABLE contact_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alumni_profile_id  UUID NOT NULL REFERENCES alumni_profiles(id) ON DELETE CASCADE,
  message            VARCHAR(500) NOT NULL,
  status             VARCHAR(10) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at       TIMESTAMPTZ
);

-- A student can have only one open request to the same alum.
CREATE UNIQUE INDEX uq_contact_requests_pending
  ON contact_requests (student_user_id, alumni_profile_id) WHERE status = 'pending';
CREATE INDEX idx_contact_requests_profile ON contact_requests (alumni_profile_id);

-- Indexes for the Search service filters.
CREATE INDEX idx_profiles_location ON alumni_profiles (lower(location));
CREATE INDEX idx_profiles_industry ON alumni_profiles (industry);
CREATE INDEX idx_profiles_grad_year ON alumni_profiles (graduation_year);
CREATE INDEX idx_alumni_skills_skill ON alumni_skills (skill_id);
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at);
