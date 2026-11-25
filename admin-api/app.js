// Identity and Administration API (the Express app). Owner: Daniel.
// server.js runs it on your computer; lambda.js runs it on AWS Lambda behind API Gateway.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const internalRoutes = require('./routes/internal');
const { notFound, errorHandler, sendError } = require('../shared/errors');

const app = express();

// Only the listed frontend origins may read responses (Lab 5).
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim());

app.disable('x-powered-by');
// X-Turnstile-Token must be allowed so the sign-up and login pages can send the ticket.
app.use(cors({ origin: allowedOrigins, allowedHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token'] }));
app.use(express.json({ limit: '10kb' }));

app.get('/', (req, res) => {
  res.status(200).json({
    name: 'AlumniLink Identity and Administration API',
    endpoints: [
      '/api/health',
      '/api/auth/register',
      '/api/auth/login',
      '/api/admin/verifications',
      '/api/admin/users',
      '/api/admin/users/:id/status',
      '/api/admin/logs'
    ]
  });
});

// Answers without touching the database, so it proves the deployment itself works.
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'identity',
    environment: process.env.NODE_ENV || 'development',
    runtime: process.env.AWS_LAMBDA_FUNCTION_NAME ? 'lambda' : 'local'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
// Called only by the Search and Profile backends, never by the browser.
app.use('/internal', internalRoutes);

app.use(notFound);

// A body over the 10 KB limit is the client's mistake (413), not a server error.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is larger than 10 KB.');
  }
  return next(err);
});
app.use(errorHandler);

module.exports = app;