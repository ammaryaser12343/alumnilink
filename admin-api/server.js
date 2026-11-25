// Runs the Identity API on your computer: npm run dev
// If SECRET_ID is set (for example with Floci running), the secrets are read
// from Secrets Manager first; otherwise they come from .env.
const app = require('./app');
const { loadSecrets } = require('./services/secrets');

const PORT = process.env.PORT || 3003;

loadSecrets()
  .then((loaded) => {
    if (loaded) console.log(`Secrets loaded from Secrets Manager (${process.env.SECRET_ID}).`);
    app.listen(PORT, () => {
      console.log(`Admin API running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error(`Could not load secrets: ${error.message}`);
    process.exit(1);
  });

module.exports = app;