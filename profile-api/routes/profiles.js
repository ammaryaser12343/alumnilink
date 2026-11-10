const express = require('express');
const profileController = require('../controllers/profiles');
const { requireLogin, requireRole } = require('../../shared/auth');

const router = express.Router();

// Only signed-in alumni manage profiles. The owner always comes from req.user,
// never from an id sent by the client.
router.use(requireLogin, requireRole('alumni'));

router.post('/', profileController.createProfile);
router.get('/me', profileController.getMyProfile);
router.patch('/me', profileController.updateMyProfile);
router.patch('/me/privacy', profileController.updateMyPrivacy);
router.patch('/me/status', profileController.updateMyStatus);

module.exports = router;
