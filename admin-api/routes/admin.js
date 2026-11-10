const express = require('express');
const adminController = require('../controllers/admin');
const { requireLogin, requireRole } = require('../../shared/auth');

const router = express.Router();

// Every admin route: signed in AND role admin. Anyone else gets 401 or 403.
router.use(requireLogin, requireRole('admin'));

router.get('/verifications', adminController.listVerifications);
router.patch('/verifications/:id', adminController.reviewVerification);
router.patch('/users/:id/status', adminController.updateUserStatus);
router.get('/logs', adminController.listLogs);

module.exports = router;
