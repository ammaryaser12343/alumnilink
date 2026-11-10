// Profile and Privacy API (also serves sign-up and login). Owner: Ahmed.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profiles');
const { notFound, errorHandler } = require('../shared/errors');

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8080')
  .split(',')
  .map((origin) => origin.trim());

app.disable('x-powered-by');
// allowedHeaders includes X-Turnstile-Token for the sign-up and login bot check (Lab 5).
app.use(cors({ origin: allowedOrigins, allowedHeaders: ['Content-Type', 'Authorization', 'X-Turnstile-Token'] }));
app.use(express.json({ limit: '10kb' }));

app.get('/', (req, res) => {
  res.status(200).json({
    name: 'AlumniLink Profile and Privacy API',
    endpoints: ['/api/health', '/api/auth/register', '/api/auth/login', '/api/profiles']
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'profile', environment: process.env.NODE_ENV || 'development' });
});

app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Profile API running on http://localhost:${PORT}`);
});

module.exports = app;
