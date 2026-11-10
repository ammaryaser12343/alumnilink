// Search and Directory API. Owner: Ammar.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const alumniRoutes = require('./routes/alumni');
const { notFound, errorHandler } = require('../shared/errors');

const app = express();
const PORT = process.env.PORT || 3002;

// Only the listed frontend origins may read responses (Lab 5).
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim());

app.disable('x-powered-by');
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '10kb' }));

app.get('/', (req, res) => {
  res.status(200).json({
    name: 'AlumniLink Search and Directory API',
    endpoints: ['/api/health', '/api/alumni', '/api/alumni/:id']
  });
});

// Answers without touching the database, so a failing /api/alumni with a
// working /api/health points straight at the database settings.
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'search', environment: process.env.NODE_ENV || 'development' });
});

app.use('/api/alumni', alumniRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Search API running on http://localhost:${PORT}`);
});

module.exports = app;
