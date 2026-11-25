# Identity and Administration API (`admin-api`)

Owner: **Daniel Zerdelian**. Part of AlumniLink (Group 13).

This service is the front door of AlumniLink. It signs people up and logs them in, gives every
other service the login token they trust, and lets admins approve new accounts, suspend users
and read the security audit log. Search and Profile ask it whether a user is still active.

## What it does

| Function | Endpoint | Who |
|---|---|---|
| Sign up (Turnstile check, password hashing, account starts **pending**) | `POST /api/auth/register` | Visitor |
| Log in, returns a signed token valid for 1 hour | `POST /api/auth/login` | Visitor |
| List verification requests (waiting list) | `GET /api/admin/verifications` | Admin |
| Approve or reject a request | `PATCH /api/admin/verifications/:id` | Admin |
| List and search accounts | `GET /api/admin/users` | Admin |
| Suspend or reactivate an account | `PATCH /api/admin/users/:id/status` | Admin |
| Read the audit log with filters | `GET /api/admin/logs` | Admin |
| Is this user still active? (for Search and Profile) | `GET /internal/users/:id/status` | Other backends (service key) |
| Health check | `GET /api/health` | Anyone |

Errors use the team format: `{ "error": { "code": "...", "message": "..." } }`.

## Business rules

- New accounts are always `pending` and cannot log in until an admin approves them.
- Only `student` or `alumni` can be chosen at sign-up. Admins are created only from the terminal (`npm run create-admin`).
- A verification request can be decided once (second decision: 409).
- Only `active` accounts can be suspended and only `suspended` ones reactivated (otherwise 409).
- Admin accounts cannot be suspended through the API (403).
- A suspended or demoted admin is refused immediately: every admin request re-checks the database, not only the token.
- Search asks `/internal/users/:id/status` on every request (cached 60 s), so a suspension also blocks Search within a minute.

## Security controls

| Threat | Control | Where |
|---|---|---|
| Password guessing, scripted sign-ups | Turnstile check; rate limit 10 attempts/min per IP and 5/min per email (hashed); same message for unknown email and wrong password; equal-time password check | `middleware/turnstile.js`, `middleware/rateLimit.js`, `controllers/auth.js` |
| Stolen database leaks passwords | scrypt hash with a random salt per user | `services/passwords.js` |
| Non-admin calls an admin endpoint | Token check (401), then admin role + live account status from the database (403) | `shared/auth.js`, `middleware/adminAccess.js` |
| Self-promotion to admin | Sign-up accepts only `student`/`alumni`; only listed fields accepted | `controllers/auth.js` |
| SQL injection | Every query is parameterised (`sql\`...${value}\``); filter values are allow-listed | `services/*.js`, `controllers/admin.js` |
| Stored script in names | Pages write user text with `textContent`, never `innerHTML` | `frontend/js/admin.js` |
| Outsiders calling internal routes | `X-Service-Key` compared in constant time (401) | `middleware/serviceKey.js` |
| Leaked secrets | `.env` ignored by Git; on Floci the secrets live in Secrets Manager, not in Lambda settings | `services/secrets.js`, `aws/deploy.js` |
| Missing evidence of attacks | Every login, sign-up, admin action and refusal is written to `audit_logs` and printed as an `AUDIT` line (CloudWatch on Floci). No passwords, tokens or emails are logged | `services/auditLog.js` |

## Run it locally

You need Node.js 18+ and the team's Neon database.

```
cd admin-api
npm install
cp .env.example .env      # then fill in the values (comments in the file explain each one)
npm run dev               # http://localhost:3003/api/health
```

Locally `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` is Cloudflare's test key, which always passes.

Create the first admin (asks for name, email and password in the terminal):

```
npm run create-admin
```

## Tests

Open the files with the VS Code REST Client extension and click **Send Request**. The comment above
each request says what must come back. Admin email/password and the service key are read from `.env`.

| File | What it covers |
|---|---|
| `requests.http` | T1-T31: sign-up, login, pending/suspended accounts, role checks (401/403), approve/reject, suspend/reactivate, invalid input, audit log filters, internal status line |
| `integration.http` | I1-I7: Search (port 3002) asks this service for the account status; a suspended student is blocked in Search |
| `floci.http` | F1-F6: the deployed Lambda through API Gateway, Secrets Manager, DynamoDB rate limit |

## Deploy to Floci (AWS emulator)

Start Docker Desktop and Floci (same command as Search):

```
docker run -d --name floci -p 4566:4566 -v /var/run/docker.sock:/var/run/docker.sock -e FLOCI_RUN_AS_ROOT=true floci/floci:latest
```

Then, from `admin-api` with `.env` filled in:

```
npm run aws:deploy        # creates or updates everything below
npm run aws:logs          # prints the AUDIT lines from CloudWatch Logs (last 60 minutes)
```

| AWS service | Name | Job |
|---|---|---|
| API Gateway (HTTP API) | `alumnilink-identity-api` | Public address; every request goes to the Lambda function |
| Lambda | `alumnilink-identity` | Runs this Express app through `lambda.js` and `serverless-http` |
| Secrets Manager | `alumnilink/identity` | `DATABASE_URL`, `TOKEN_SECRET`, `SERVICE_KEY`, `TURNSTILE_SECRET_KEY` |
| DynamoDB | `alumnilink-identity-ratelimit` | Login and sign-up counters, rows expire by TTL |
| CloudWatch Logs | `/aws/lambda/alumnilink-identity` | Lambda output and `AUDIT` lines, kept 14 days |
| IAM role | `alumnilink-identity-role` | Least privilege: read one secret, update one table, write its own logs |

The first request after a deploy can take a few minutes while Floci downloads the Node.js runtime.

## Frontend pages

`frontend/login.html`, `frontend/register.html` and `frontend/admin.html` (with `js/login.js`,
`js/register.js`, `js/admin.js`, `js/turnstile.js` and `css/identity.css`). Login saves the token in
`sessionStorage` under `token`, where the Search and Profile pages read it.

## Folder layout

```
admin-api/
├── app.js            Express app (routes, guards, errors)
├── server.js         runs app.js on port 3003
├── lambda.js         runs app.js on AWS Lambda
├── routes/           auth.js, admin.js, internal.js
├── middleware/       turnstile.js, rateLimit.js, adminAccess.js, serviceKey.js
├── controllers/      auth.js, admin.js, internal.js
├── services/         passwords.js, userService.js, adminService.js, auditLog.js, rateLimit.js, secrets.js, db.js
├── scripts/          create-admin.js
├── aws/              deploy.js, logs.js
└── requests.http, integration.http, floci.http
```

Tables owned: `users`, `verification_requests`, `audit_logs` (see `docs/schema.sql`).