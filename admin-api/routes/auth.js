// Sign up and login doors. The Turnstile ticket checker runs first on both.
const express = require('express');
const authController = require('../controllers/auth');
const { verifyTurnstile } = require('../middleware/turnstile');

const router = express.Router();

router.post('/register', verifyTurnstile, authController.register);
router.post('/login', verifyTurnstile, authController.login);

module.exports = router;