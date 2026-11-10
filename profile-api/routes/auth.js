const express = require('express');
const authController = require('../controllers/auth');

const router = express.Router();

// TODO (Ahmed): put the Turnstile middleware from Lab 5 in front of both routes.
router.post('/register', authController.register);
router.post('/login', authController.login);

module.exports = router;
