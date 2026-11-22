CREATE TABLE contact_requests (
 id uuid PRIMARY KEY, student_user_id uuid NOT NULL REFERENCES users(id),
 alumni_profile_id uuid NOT NULL REFERENCES alumni_profiles(id),
 message varchar(1000) NOT NULL DEFAULT '',
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined')),
 created_at timestamptz NOT NULL DEFAULT now(), responded_at timestamptz
);
