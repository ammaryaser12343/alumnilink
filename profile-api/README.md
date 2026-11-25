# Profile and Privacy

Ahmed owns profile creation/editing, skills, privacy choices, professional contact email, and profile deactivation. The service verifies signed user tokens and current eligibility through Daniel's Identity endpoint. Registration, login, approval, suspension, and audit-log administration belong to Daniel.

Run Node.js 24 from this folder:

```powershell
npm ci
npm test
npm start
```

The local server listens on port 3001 by default. Configure the variables in .env.example. DATABASE_URL is the restricted Profile database connection. MIGRATION_DATABASE_URL is the separate owner connection used only by migration and controlled integration tests. Both values stay in the ignored .env file. Use `npm run db:migrate` for the additive migration after inspecting the target schema.

## Folder structure

- `routes/` maps URLs and HTTP methods to the handlers.
- `controllers/` validates requests and handles Profile, Privacy, and contact email responses.
- `middleware/` verifies login tokens, service credentials, and account eligibility.
- `services/` holds PostgreSQL access and calls to Identity and Locations.
- `db/` contains migrations and database setup, `test/` contains automated tests, and `scripts/` contains local Floci checks.
- `app.js` wires the routes and shared request handling. `server.js` starts the local API, and `lambda.js` runs it on Floci.

## Vercel

Use `profile-api` as the Vercel project root with the Express preset. Enable the build setting that includes source outside that root, since authentication imports `shared/auth.js` from the team repo. Set the runtime values from `.env.example` in the project settings. The database migration uses its own credentials outside the hosted app.

Vercel loads the Express app exported by `app.js`. The same app is used by `server.js` and Floci’s `lambda.js`. After a preview deploy, request `/api/health` and expect status 200 with `{"service":"profile-and-privacy","status":"ok"}`. A request to `/api/profiles/me` without a token should return 401.

## Routes

| Method | Path | Result |
| --- | --- | --- |
| POST | /api/profiles | Create one profile for the authenticated Alumni account |
| GET | /api/profiles/me | Read the owner's complete profile |
| PATCH | /api/profiles/me | Update allowed fields, resolving changed location through Ammar |
| GET / PUT | /api/profiles/me/skills | Read or atomically replace normalized skills |
| GET / PATCH | /api/profiles/me/privacy | Read or update the owner's visibility choices |
| PATCH | /api/profiles/me/status | Set profile isActive without changing the account |
| GET | /internal/profiles/:id/contact?requestId=:requestId | Return contact email after verifying accepted consent |
| GET | /api/health | Liveness |

Profile JSON uses graduationYear, company, industry, bio, contactEmail, location and skills. A null location clears the location relationship. A null contactEmail clears the professional contact address. Skills are normalized to lowercase with repeated whitespace collapsed, deduplicated, and limited to 20.

All public profile operations require an active Alumni account. The backend derives ownership from the verified token. Profile writes and related skill changes use one SQL transaction on a single database client. Location resolution occurs before that transaction. A failed lookup preserves the previous profile.

The contact endpoint checks the shared X-Service-Key header and verifies the Student's original token from X-User-Token. The database checks the accepted request's sender and target, current account eligibility and profile activity. Responses and logs exclude contact email except for the permitted contact response.

## Database migration

Neon already contained users, locations, contact_requests, skills, alumni_skills and privacy_settings. The migration adds contact_email and location_id and retains the existing location text for compatible directory queries. A legacy skills array is imported once into normalized tables and retained as a recovery copy. Active code reads and writes the normalized tables. Missing visibility settings for non-seed profiles start hidden. Existing settings and the team’s seed privacy overrides remain intact.

The shared wire contract is in docs/internal-contracts.json at the project root. Profile uses shared/auth.js to verify Daniel’s login token and the shared SERVICE_KEY for internal requests. Location is saved as the validated text submitted to Ammar’s resolver so Search can join its coordinates cache.

## Evidence

`npm test` exercises real PostgreSQL behavior in disposable PGlite databases, including the migration from the previous starter.

```powershell
node --env-file=.env scripts/deployed-check.js
```

The deployed check uses Floci API Gateway/Lambda, the restricted Neon runtime connection and temporary synthetic records. Identity and Locations are HTTP test doubles. It restores Lambda configuration and removes its synthetic users, profiles, requests and location on completion. Only run it against the coursework database configured for this test. Results are written to docs/ahmed-deployed-evidence.json.

A local joint HTTP check used Daniel’s login and status routes, Ammar’s Search and Locations routes, and the updated Profile service on disposable PostgreSQL data. It verified login, location saves, directory privacy, deactivation, and contact disclosure for the requesting Student only. The Turnstile response was simulated and geocoding used a cached test row. The shared Floci or hosted run needs the team’s endpoint URLs and runtime credentials.
