const express = require('express');
const alumniController = require('../controllers/alumni');
const { requireLogin, requireRole } = require('../../shared/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { requireActiveAccount } = require('../middleware/activeAccount');

const router = express.Router();

// Every search route: valid token (401), allowed role (403), request limit (429),
// then the Identity service confirms the account is still active (403 / 503).
router.use(requireLogin, requireRole('alumni', 'student', 'admin'), rateLimit, requireActiveAccount);

router.get('/', alumniController.searchAlumni);
// Must come before /:id, otherwise "filters" would be read as an id.
router.get('/filters', alumniController.getFilters);
router.get('/:id', alumniController.getAlumnus);

module.exports = router;
