# AlumniLink

University alumni directory for Cloud Computing and Cloud Security (26CSCN29H), Group 13.
Alumni manage profiles with skills, graduation year and company; signed-in users search by skill,
location or industry; privacy settings decide which fields others see.

## Structure and owners

| Folder | What it is | Owner | Local port |
|---|---|---|---|
| `frontend/` | Shared HTML/CSS/JS site (one Vercel project) | Each owner builds their own pages; Ammar deploys | 8080 |
| `profile-api/` | Profile and Privacy backend, plus sign-up and login | Ahmed Ramadan | 3001 |
| `search-api/` | Search, near-me locations (Open-Meteo) and contact requests backend; enforces privacy on results | Ammar Yaser | 3002 |
| `admin-api/` | Administration and Verification backend | Daniel Zerdelian | 3003 |
| `shared/` | Code every backend includes: error format, login-token and role checks, constants | Ahmed (auth), Daniel (roles) | – |
| `docs/` | `schema.sql`, `seed.sql`, `api.md` (the endpoint contract) | Ammar (database) | – |

Each backend follows the Lab 4 layers: `routes/` → `controllers/` (validation, responses) → `services/` (database).

## 1. Database (once, by the database lead)

1. Create a project in Neon (free plan).
2. Open the **SQL Editor**, paste all of `docs/schema.sql` and run it.
3. Paste all of `docs/seed.sql` and run it. This adds 25 fictional alumni, 3 students and 1 admin.
   Seed accounts cannot log in; they exist for search testing and the demo.
4. For near-me search on the seed data, look up the seed cities once (needs internet):
   `cd search-api && npm run resolve-locations`.
5. **Connect** → copy the connection string. Share it with the team privately, never in Git.

Running `schema.sql` again deletes every table and its data.

## 2. Run locally

Needs Node.js 18 or later. In each backend folder:

```bash
cd search-api            # or profile-api / admin-api
npm install
cp .env.example .env     # then fill in DATABASE_URL and TOKEN_SECRET
npm run dev
```

All three backends must use the **same** `TOKEN_SECRET`. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
npm start                # http://localhost:8080
```

Check each backend at `http://localhost:<port>/api/health`.

## 3. Test before the login page exists

Search needs a login token. Until the real login route is built, make a test token from inside a backend folder:

```bash
cd search-api
node ../shared/scripts/make-test-token.js student   # or alumni / admin
```

- **Postman or REST Client:** paste it into `search-api/requests.http` (normal, invalid and security cases).
- **Browser:** open the Console on `http://localhost:8080` and run
  `sessionStorage.setItem('token', 'PASTE-TOKEN')`, then reload.

Test tokens only work with your own local `TOKEN_SECRET`. Never use this script in production.

## 4. Deploy to Vercel (four projects, one repository)

Import the same GitHub repository four times. The only difference is the **Root Directory**:

| Vercel project | Root Directory | Environment variables |
|---|---|---|
| Frontend | `frontend` | none |
| Profile API | `profile-api` | `DATABASE_URL`, `TOKEN_SECRET`, `CORS_ORIGINS`, `TURNSTILE_SECRET_KEY` |
| Search API | `search-api` | `DATABASE_URL`, `TOKEN_SECRET`, `SERVICE_KEY`, `IDENTITY_API_URL`, `PROFILE_API_URL`, `CORS_ORIGINS` |
| Admin API | `admin-api` | `DATABASE_URL`, `TOKEN_SECRET`, `CORS_ORIGINS` |

- `CORS_ORIGINS` = `http://localhost:8080,https://YOUR-FRONTEND.vercel.app` (no trailing slash).
- In each API project, keep **Settings → Build and Deployment → "Include files outside the root directory in the Build Step"** enabled, so `../shared` is deployed with the backend.
- After deploying the APIs, put their domains in `frontend/js/config.js` and `frontend/vercel.json`, then push again.
- Test `https://<api-domain>/api/health` first. If health works but `/api/alumni` fails, check `DATABASE_URL` in Vercel and redeploy.

## 5. Git workflow

- Never push to `main` directly. Work on your branch (`feature/profile`, `feature/search`, `feature/admin`) and open a pull request; another member reviews before merging.
- Commit from your own GitHub account. Commits are the evidence of who built each service.
- `.env` is in `.gitignore`. If a secret is ever committed, change it in Neon/Vercel straight away.

## What is still to build

- **Ahmed:** register and login (password hashing, Turnstile from Lab 5, `signToken`), profile and privacy routes, login and profile pages.
- **Daniel:** verification, account status and audit-log routes, admin page, audit logging for admin actions.
- **Ammar:** search, near-me (Open-Meteo), contact requests, the account-status check and `/internal/locations/resolve` are built and tested with local stand-ins (`npm run mock-services`). Next: switch to the real Identity and Profile internal routes once they exist, then deploy.
- **Everyone:** replace the starter token code in `shared/auth.js` with the library approved after the authentication lab, if one is required (keep the same function names).
