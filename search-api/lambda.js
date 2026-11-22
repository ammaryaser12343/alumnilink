// AWS Lambda entry point (handler: search-api/lambda.handler).
// API Gateway (HTTP API) sends every request here; serverless-http turns it
// into a normal Express request, so the routes are the same as locally.
const serverless = require('serverless-http');
const app = require('./app');
const { loadSecrets } = require('./services/secrets');
const { flushAuditLogs } = require('./services/auditLog');

const expressHandler = serverless(app);
let secretsReady = null;

exports.handler = async (event, context) => {
  try {
    // Read the secrets once per Lambda instance, on its first request.
    secretsReady = secretsReady || loadSecrets();
    await secretsReady;
  } catch (error) {
    secretsReady = null; // try again on the next request
    console.error(`Could not load secrets: ${error.message}`);
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is starting. Please try again.' } })
    };
  }

  const response = await expressHandler(event, context);
  await flushAuditLogs();
  return response;
};
