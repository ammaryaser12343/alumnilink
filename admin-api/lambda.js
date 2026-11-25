// AWS Lambda entry point (handler: admin-api/lambda.handler).
// API Gateway sends every request here; serverless-http turns it into a normal
// Express request, so the routes are exactly the same as on your computer (Lab 7).
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
  // Lambda freezes as soon as we return, so finish writing the audit log first.
  await flushAuditLogs();
  return response;
};