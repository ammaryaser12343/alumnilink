const express = require('express');
const alumniController = require('../controllers/alumni');
const { requireLogin, requireRole } = require('../../shared/auth');

const router = express.Router();

// Every search route needs a login, and every signed-in role may search.
router.use(requireLogin, requireRole('alumni', 'student', 'admin'));

router.get('/', alumniController.searchAlumni);
router.get('/:id', alumniController.getAlumnus);

module.exports = router;
