const express = require('express');
const adminController = require('../controllers/admin');
const { requireLogin } = require('../../shared/auth');
const { requireAdmin } = require('../middleware/adminAccess');

const router = express.Router();

// Every admin route: a valid badge (401 if not), then an active admin (403 if not).
router.use(requireLogin, requireAdmin);

router.get('/verifications', adminController.listVerifications);
router.patch('/verifications/:id', adminController.reviewVerification);
router.patch('/users/:id/status', adminController.updateUserStatus);
router.get('/logs', adminController.listLogs);

module.exports = router;