// Shared error helpers. Every error from every backend uses the Lab 4 shape:
// { "error": { "code": "...", "message": "..." } }

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// Registered after all routes: any unknown path ends here.
function notFound(req, res) {
  return sendError(res, 404, 'ROUTE_NOT_FOUND', 'Route not found.');
}

// Registered last. Runs when a controller calls next(error) or express.json() fails.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'VALIDATION_ERROR', 'Request body is not valid JSON.');
  }
  // Log the details for Vercel Logs, but never send them to the browser.
  console.error(err);
  return sendError(res, 500, 'INTERNAL_ERROR', 'An unexpected server error occurred.');
}

module.exports = { sendError, notFound, errorHandler };
