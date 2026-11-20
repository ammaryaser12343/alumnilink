const express = require('express');
const controller = require('../controllers/internal');
const { requireServiceKey } = require('../middleware/serviceKey');

const router = express.Router();

// No user token here: the caller is another backend, proved by SERVICE_KEY.
router.use(requireServiceKey);
router.post('/locations/resolve', controller.resolveLocationForService);

module.exports = router;
