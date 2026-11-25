// Search and Directory API (Express app). Owner: Ammar.
// server.js runs it locally; lambda.js runs it on AWS Lambda behind API Gateway.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const alumniRoutes = require('./routes/alumni');
const contactRequestRoutes = require('./routes/contactRequests');
const internalRoutes = require('./routes/internal');
const { auditDenied } = require('./middleware/auditDenied');
const { notFound, errorHandler, sendError } = require('../shared/errors');

const app = express();

// Only the listed frontend origins may read responses (Lab 5).
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim());

app.disable('x-powered-by');
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '10kb' }));
app.use(auditDenied);

app.get('/', (req, res) => {
  res.status(200).json({
    name: 'AlumniLink Search and Directory API',
    endpoints: ['/api/health', '/api/alumni', '/api/alumni/filters', '/api/alumni/:id', '/api/contact-requests']
  });
});

// Answers without touching the database, so a failing /api/alumni with a
// working /api/health points straight at the database settings.
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'search', environment: process.env.NODE_ENV || 'development' });
});

app.use('/api/alumni', alumniRoutes);
app.use('/api/contact-requests', contactRequestRoutes);
// Called only by the Profile and Identity backends, never by the browser.
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
