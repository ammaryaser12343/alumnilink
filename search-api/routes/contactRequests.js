const express = require('express');
const controller = require('../controllers/contactRequests');
const { requireLogin, requireRole } = require('../../shared/auth');
const { requireActiveAccount } = require('../middleware/activeAccount');

const router = express.Router();

// Role check first (no network call), then ask Identity if the account is still active.
router.post('/', requireLogin, requireRole('student'), requireActiveAccount, controller.createContactRequest);
router.get('/', requireLogin, requireRole('student', 'alumni'), requireActiveAccount, controller.listContactRequests);
router.patch('/:id', requireLogin, requireRole('alumni'), requireActiveAccount, controller.answerContactRequest);

module.exports = router;
