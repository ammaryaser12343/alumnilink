// LOCAL TESTING ONLY. Stands in for the two internal endpoints Search calls,
// until Daniel's and Ahmed's real ones are built:
//   Identity  GET /internal/users/:id/status      (port 4003)
//   Profile   GET /internal/profiles/:id/contact  (port 4001)
// Reads the same database and checks the same SERVICE_KEY as the real ones will.
// Usage (from search-api/):  npm run mock-services
// Then in .env: IDENTITY_API_URL=http://localhost:4003  PROFILE_API_URL=http://localhost:4001
require('dotenv').config();

const express = require('express');
const { getSql } = require('../services/db');
const { requireServiceKey } = require('../middleware/serviceKey');

const identity = express();
identity.use(requireServiceKey);
identity.get('/internal/users/:id/status', async (req, res) => {
  try {
    const sql = getSql();
    const rows = await sql`SELECT id, role, account_status FROM users WHERE id::text = ${req.params.id}`;
    if (!rows[0]) return res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
    return res.json({ id: rows[0].id, role: rows[0].role, accountStatus: rows[0].account_status });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Mock failed.' } });
  }
});

const profile = express();
profile.use(requireServiceKey);
profile.get('/internal/profiles/:id/contact', async (req, res) => {
  try {
    const sql = getSql();
    // The real Profile service will return alumni_profiles.contact_email.
    // The mock uses the login email so it works on the current schema.
    const rows = await sql`
      SELECT p.id, u.email FROM alumni_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.id::text = ${req.params.id}`;
    if (!rows[0]) return res.status(404).json({ error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found.' } });
    return res.json({ profileId: rows[0].id, contactEmail: rows[0].email });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Mock failed.' } });
  }
});

identity.listen(4003, () => console.log('Mock Identity internal API on http://localhost:4003'));
profile.listen(4001, () => console.log('Mock Profile internal API on http://localhost:4001'));
