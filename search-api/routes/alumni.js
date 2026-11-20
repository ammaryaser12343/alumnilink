const express = require('express');
const alumniController = require('../controllers/alumni');
const { requireLogin, requireRole } = require('../../shared/auth');
const { requireActiveAccount } = require('../middleware/activeAccount');

const router = express.Router();

// Every search route needs a login and an account that is still active.
// Every signed-in role may search.
router.use(requireLogin, requireRole('alumni', 'student', 'admin'), requireActiveAccount);

router.get('/', alumniController.searchAlumni);
router.get('/:id', alumniController.getAlumnus);

module.exports = router;
