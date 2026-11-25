-- Synthetic fixtures matching the inspected Neon contract. Other students own these tables.
CREATE TABLE users (
 id uuid PRIMARY KEY, name varchar(100) NOT NULL, email varchar(254) UNIQUE NOT NULL,
 password_hash text NOT NULL, role varchar(20) NOT NULL CHECK(role IN ('student','alumni','admin')),
 account_status varchar(20) NOT NULL DEFAULT 'pending' CHECK(account_status IN ('active','pending','rejected','suspended')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE locations (
 id serial PRIMARY KEY, query_key varchar(120) UNIQUE NOT NULL, name varchar(120) NOT NULL,
 country varchar(100), latitude double precision NOT NULL, longitude double precision NOT NULL,
 resolved_at timestamptz NOT NULL DEFAULT now()
);
