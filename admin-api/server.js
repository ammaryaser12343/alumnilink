// Administration and Verification API. Owner: Daniel.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const { notFound, errorHandler } = require('../shared/errors');

const app = express();
const PORT = process.env.PORT || 3003;

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim());

app.disable('x-powered-by');
// X-Turnstile-Token must be allowed so the sign-up and login pages can send the ticket.
app.use(cors({ origin: allowedOrigins, allowedHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token'] }));
app.use(express.json({ limit: '10kb' }));

app.get('/', (req, res) => {
  res.status(200).json({
    name: 'AlumniLink Administration API',
    endpoints: ['/api/health', '/api/admin/verifications', '/api/admin/users/:id/status', '/api/admin/logs']
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'admin', environment: process.env.NODE_ENV || 'development' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Admin API running on http://localhost:${PORT}`);
});

module.exports = app;
