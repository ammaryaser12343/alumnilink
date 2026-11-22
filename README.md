# AlumniLink

A university alumni directory built as three separately deployed Node.js services on one PostgreSQL database.
Alumni keep a profile with their skills, graduation year, company and location. Signed-in students and alumni
search the directory by name, skill, industry, graduation year or distance from a city, and each alum's
privacy settings decide which fields other people can see. Students can ask an alum for contact details;
the alum's email is shared only if they accept.

Group project for Cloud Computing and Cloud Security (26CSCN29H), Group 13.

## Features

**Search and Directory** (`search-api`, built)
- Search by name or skill, location, industry and graduation year, with sorting and pagination
- Near-me search: alumni within a chosen distance of a city, closest first, using the
  [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api); each place is looked up once and cached
- Privacy enforced on every result: hidden fields are removed, and filters (including distance) never match a hidden field
- Contact requests: students send them, only the addressed alum can accept or decline, and the email is fetched
  from the Profile service only after acceptance
- Checks with the Identity service on every request that the account is still active (fails closed with 503)
- Service-to-service calls authenticated with a shared service key, with a 3-second timeout
- Security events written to an audit log

**Profile and Privacy** (`profile-api`, built and tested independently)
- Alumni profile, skills, privacy, activation and consent-checked contact access.
- Floci deployment and temporary test-session setup are documented in [infra/floci/README.md](infra/floci/README.md).
- Profile uses Daniel’s signed tokens, live account status and Ammar’s Locations API. Search forwards the Student token and accepted request ID for contact disclosure.

**Identity and Administration** (`admin-api`)
- Team integration is pending.

## Architecture

```
                      Frontend (HTML, CSS, JavaScript)
                                   |
             +---------------------+---------------------+
             |                     |                     |
        profile-api            search-api            admin-api
        (port 3001)            (port 3002)           (port 3003)
             |                     |                     |
             +----------- Neon PostgreSQL ---------------+

             search-api  ->  Open-Meteo Geocoding API
```

- All backends verify user tokens with the team’s TOKEN_SECRET. Internal calls send X-Service-Key with the shared SERVICE_KEY.
- Profile verifies the original Student token and exact accepted request before releasing contact email.
- Each backend follows the same layers: `routes/` → `controllers/` (validation, responses) → `services/` (database and external calls).
- Errors always use one format: `{ "error": { "code": "...", "message": "..." } }`.

The full endpoint contract, including the internal calls, is in [`docs/api.md`](docs/api.md).

## Technologies

| Area | Used |
|---|---|
| Frontend | HTML, CSS, vanilla JavaScript |
| Backend | Node.js 18+, Express, `cors`, `dotenv` |
| Database | Neon serverless PostgreSQL (`@neondatabase/serverless`) |
| External API | Open-Meteo Geocoding (free, no API key) |
| Hosting | Floci for Profile and Privacy; Vercel setup for the Search demo |
| Testing | VS Code REST Client or Postman (`search-api/requests.http`) |

## Project structure

```
alumnilink/
├── frontend/       Web pages: search with near-me, contact requests
├── profile-api/    Profile, skills, privacy and contact disclosure backend
├── search-api/     Search, locations and contact requests backend
│   ├── controllers/  middleware/  routes/  services/
│   ├── scripts/      mock-services.js, resolve-locations.js
│   └── requests.http normal, invalid and security test requests
├── admin-api/      Administration and verification backend (placeholder handlers)
├── shared/         Error format, login-token and role checks, constants
└── docs/           schema.sql, seed.sql, api.md
```

## Getting started

You need Node.js 18 or later and a free [Neon](https://neon.tech) account.

### 1. Database

1. Create a Neon project and open the **SQL Editor**.
2. Run all of `docs/schema.sql`, then all of `docs/seed.sql`. The seed adds 25 fictional alumni,
   3 students and 1 admin for testing; these accounts cannot log in.
3. Copy the connection string from **Connect**. Keep it private and never commit it.

> Running `schema.sql` again drops every table and deletes all data.

### 2. Search API

```bash
cd search-api
npm install
cp .env.example .env
```

Fill in `.env` (the comments in `.env.example` explain each value):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string |
| `TOKEN_SECRET` | Random secret, the same in all three backends |
| `SERVICE_KEY` | A different random secret, the same in all three backends |
| `IDENTITY_API_URL`, `PROFILE_API_URL` | `http://localhost:4003` and `http://localhost:4001` while using the stand-ins below |

Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then run, each in its own terminal from `search-api`:

```bash
npm run mock-services       # local stand-ins for the Identity and Profile internal endpoints
npm run resolve-locations   # once: looks up the seed cities so near-me search works
npm run dev                 # http://localhost:3002/api/health
```

### 3. Frontend

```bash
cd frontend
npm install
npm start                   # http://localhost:8080
```

## Usage

Until the login page exists, create a test token from inside `search-api`:

```bash
node ../shared/scripts/make-test-token.js student   # or alumni / admin
```

- **Browser:** in the Console on `http://localhost:8080`, run `sessionStorage.setItem('token', 'PASTE-TOKEN')` and reload.
  Search, try a city in **Near**, and as a student use **Request contact**. The **Contact requests** page shows
  students the requests they sent, and shows alumni the requests they received with Accept and Decline.
- **API tests:** open `search-api/requests.http` with the VS Code REST Client extension, paste a student token,
  an alumni token and your `SERVICE_KEY`, and send each request. The comment above each one gives the expected status.

Test tokens only work with your local `TOKEN_SECRET`. Never use the token script in production.

## Deployment

See [Floci setup](infra/floci/README.md) for Profile and Privacy. For the standalone Search demo, the previous Vercel settings are listed below for the frontend, Search and Admin.

| Vercel project | Root Directory | Environment variables |
|---|---|---|
| Frontend | `frontend` | none |
| Search API | `search-api` | `DATABASE_URL`, `TOKEN_SECRET`, `SERVICE_KEY`, `IDENTITY_API_URL`, `PROFILE_API_URL`, `CORS_ORIGINS` |
| Admin API | `admin-api` | `DATABASE_URL`, `TOKEN_SECRET`, `CORS_ORIGINS` |

- `CORS_ORIGINS` is a comma-separated list such as `http://localhost:8080,https://your-frontend.vercel.app`.
- Keep **Include files outside the root directory in the Build Step** enabled so `shared/` is deployed with each backend.
- After the APIs are deployed, put their domains in `frontend/js/config.js` and `frontend/vercel.json`.

## Project status

| Service | Owner | Status |
|---|---|---|
| Search, locations and contact requests | Ammar Yaser | Built; tested against Neon, Open-Meteo and the local stand-ins |
| Profile and Privacy | Ahmed Ramadan | Built and tested independently on Floci |
| Identity and Administration | Daniel Zerdelian | Repository contains placeholders; integration pending |

The standalone Search demo uses `search-api/scripts/mock-services.js`. Profile and Search were also tested against an isolated copy of the team database to verify directory privacy and deactivation. See [docs/api.md](docs/api.md) for the shared HTTP contracts.

## Contributing

- Work on your own branch (`feature/profile`, `feature/search`, `feature/admin`) and open a pull request;
  another member reviews it before it is merged into `main`.
- Never commit `.env` files. If a secret is ever committed, change it in Neon and Vercel straight away.
