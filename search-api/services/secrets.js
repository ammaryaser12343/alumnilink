// Loads DATABASE_URL, TOKEN_SECRET and SERVICE_KEY from AWS Secrets Manager.
// On Floci or AWS, SECRET_ID names the secret and nothing secret is kept in
// Lambda environment variables or in the code. Locally, without SECRET_ID,
// the values come from .env as before.
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const SECRET_KEYS = ['DATABASE_URL', 'TOKEN_SECRET', 'SERVICE_KEY'];

async function loadSecrets() {
  const secretId = process.env.SECRET_ID;
  if (!secretId) {
    return false;
  }

  // The SDK reads AWS_REGION and AWS_ENDPOINT_URL (set by Floci) from the environment.
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const values = JSON.parse(result.SecretString);

  for (const key of SECRET_KEYS) {
    if (typeof values[key] !== 'string' || values[key] === '') {
      throw new Error(`Secret ${secretId} has no ${key}.`);
    }
    process.env[key] = values[key];
  }
  return true;
}

module.exports = { loadSecrets, SECRET_KEYS };
