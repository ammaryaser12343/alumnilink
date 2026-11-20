// Endpoints for the other AlumniLink backends only (checked by requireServiceKey).
const { resolveLocation, GeocodingUnavailableError } = require('../services/geocoding');
const { sendError } = require('../../shared/errors');

// POST /internal/locations/resolve  { "location": "Cairo" }
// The Profile service calls this when an alum saves a location, so the place is
// ready for near-me search. Answers from the locations cache when it can.
async function resolveLocationForService(req, res, next) {
  try {
    const text = req.body && typeof req.body.location === 'string' ? req.body.location.trim() : '';
    if (text.length < 2 || text.length > 100) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'location must be between 2 and 100 characters.');
    }

    const resolved = await resolveLocation(text);
    if (!resolved) {
      return sendError(res, 404, 'LOCATION_NOT_FOUND', 'That place could not be found.');
    }
    return res.status(200).json(resolved);
  } catch (error) {
    if (error instanceof GeocodingUnavailableError) {
      console.error(error.message);
      return sendError(res, 503, 'GEOCODING_UNAVAILABLE', 'Geocoding is unavailable right now. Try again later.');
    }
    return next(error);
  }
}

module.exports = { resolveLocationForService };
