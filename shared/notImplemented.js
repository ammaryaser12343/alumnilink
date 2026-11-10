// Placeholder for routes that are planned but not built yet.
// Answers 501 so nobody mistakes an unfinished route for a working one.
const { sendError } = require('./errors');

function notImplemented(name) {
  return (req, res) => sendError(res, 501, 'NOT_IMPLEMENTED', `${name} is not built yet.`);
}

module.exports = { notImplemented };
