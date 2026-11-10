# AlumniLink API contract

Agreed endpoint list (proposal section 5.1). Do not change an endpoint without telling the team.

## Error format (Lab 4), used by every backend

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Readable explanation." } }
```

Common codes: `VALIDATION_ERROR` (400), `AUTH_REQUIRED` / `INVALID_TOKEN` (401), `FORBIDDEN` (403),
`ROUTE_NOT_FOUND` / `*_NOT_FOUND` (404), `INTERNAL_ERROR` (500), `NOT_IMPLEMENTED` (501, placeholders only).

## Login token

Protected routes need the header `Authorization: Bearer <token>`.
The Profile backend's login route creates the token with `signToken()` from `shared/auth.js`.
All three backends check it with the same `TOKEN_SECRET`.

## Profile and Privacy backend (Ahmed), local port 3001

| Method | Endpoint | Purpose | Success | Errors | Roles |
|---|---|---|---|---|---|
| POST | /api/auth/register | Create account + verification request (Turnstile) | 201 | 400, 403, 409 | Not logged in |
| POST | /api/auth/login | Sign in, returns token | 200 | 400, 401, 403 | Not logged in |
| POST | /api/profiles | Create own profile | 201 | 400, 401, 409 | Alumni |
| GET | /api/profiles/me | View own full profile | 200 | 401, 404 | Alumni |
| PATCH | /api/profiles/me | Update details and skills | 200 | 400, 401, 404 | Alumni |
| PATCH | /api/profiles/me/privacy | Update visibility settings | 200 | 400, 401 | Alumni |
| PATCH | /api/profiles/me/status | Deactivate own profile | 200 | 400, 401, 403, 404 | Alumni |

## Search and Directory backend (Ammar), local port 3002

| Method | Endpoint | Purpose | Success | Errors | Roles |
|---|---|---|---|---|---|
| GET | /api/alumni | Search, filter, sort, paginate | 200 | 400, 401, 403 | Alumni, Student, Admin |
| GET | /api/alumni/:id | Visible fields of one profile | 200 | 401, 404 | Alumni, Student, Admin |

Query parameters for `GET /api/alumni` (any other parameter answers 400):

| Parameter | Rule |
|---|---|
| q | Name or skill, 2 to 50 characters |
| location | 2 to 100 characters, partial match |
| industry | One of `INDUSTRIES` in `shared/constants.js` |
| gradYear | Four digits, 1950 to the current year |
| sort | `name` (default), `newest`, `oldest` |
| page | 1 to 500 (default 1); 10 results per page |

Response: `{ "page": 1, "pageSize": 10, "total": 21, "results": [ ... ] }`.
Hidden fields are removed from each result, and filters never match a hidden field.

## Administration backend (Daniel), local port 3003

| Method | Endpoint | Purpose | Success | Errors | Roles |
|---|---|---|---|---|---|
| GET | /api/admin/verifications | List verification requests | 200 | 401, 403 | Admin |
| PATCH | /api/admin/verifications/:id | Approve or reject | 200 | 400, 401, 403, 404 | Admin |
| PATCH | /api/admin/users/:id/status | Suspend or reactivate | 200 | 400, 401, 403, 404 | Admin |
| GET | /api/admin/logs | Filtered audit events | 200 | 401, 403 | Admin |
