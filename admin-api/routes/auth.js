// Sign up and login doors.
// Order matters: 1) rate limit, 2) Turnstile "are you human?", 3) the controller.
const express = require('express');
const authController = require('../controllers/auth');
const { verifyTurnstile } = require('../middleware/turnstile');
const { limitAuthAttempts } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/register', limitAuthAttempts('register'), verifyTurnstile, authController.register);
router.post('/login', limitAuthAttempts('login'), verifyTurnstile, authController.login);

module.exports = router;