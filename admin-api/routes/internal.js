// Internal routes: only for the other AlumniLink backends.
// Every call must carry X-Service-Key, otherwise 401.
const express = require('express');
const internalController = require('../controllers/internal');
const { requireServiceKey } = require('../middleware/serviceKey');

const router = express.Router();

router.use(requireServiceKey);

router.get('/users/:id/status', internalController.getUserStatus);

module.exports = router;