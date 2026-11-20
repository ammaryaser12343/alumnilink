// Reads the request, validates it, calls the service and sends the response (Lab 4 layers).
const alumniService = require('../services/alumniService');
const { resolveLocation, GeocodingUnavailableError } = require('../services/geocoding');
const { sendError } = require('../../shared/errors');
const { applyPrivacy } = require('../services/privacy');
const { INDUSTRIES } = require('../../shared/constants');

const ALLOWED_PARAMS = ['q', 'location', 'industry', 'gradYear', 'near', 'radiusKm', 'sort', 'page'];
const SORTS = ['name', 'newest', 'oldest', 'distance'];
const DEFAULT_RADIUS_KM = 50;
const MAX_RADIUS_KM = 500;
const PAGE_SIZE = 10;
const MAX_PAGE = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns { filters } when the query is valid, or { problem } with a message.
function validateSearchQuery(query) {
  for (const key of Object.keys(query)) {
    if (!ALLOWED_PARAMS.includes(key)) {
      return { problem: `Unknown query parameter: ${key}.` };
    }
    if (typeof query[key] !== 'string') {
      return { problem: `${key} must be given once, as plain text.` };
    }
  }

  const q = (query.q || '').trim();
  const location = (query.location || '').trim();
  const industry = (query.industry || '').trim();
  const gradYearText = (query.gradYear || '').trim();
  const near = (query.near || '').trim();
  const radiusText = (query.radiusKm || '').trim();
  // Near-me results are sorted by distance unless the user picks another order.
  const sort = (query.sort || (near ? 'distance' : 'name')).trim();
  const pageText = (query.page || '1').trim();

  if (q && (q.length < 2 || q.length > 50)) {
    return { problem: 'q must be between 2 and 50 characters.' };
  }
  if (location && (location.length < 2 || location.length > 100)) {
    return { problem: 'location must be between 2 and 100 characters.' };
  }
  if (industry && !INDUSTRIES.includes(industry)) {
    return { problem: `industry must be one of: ${INDUSTRIES.join(', ')}.` };
  }

  let gradYear = null;
  if (gradYearText) {
    const currentYear = new Date().getFullYear();
    if (!/^\d{4}$/.test(gradYearText) || Number(gradYearText) < 1950 || Number(gradYearText) > currentYear) {
      return { problem: `gradYear must be a year between 1950 and ${currentYear}.` };
    }
    gradYear = Number(gradYearText);
  }

  if (near && (near.length < 2 || near.length > 100)) {
    return { problem: 'near must be between 2 and 100 characters.' };
  }
  let radiusKm = DEFAULT_RADIUS_KM;
  if (radiusText) {
    if (!near) {
      return { problem: 'radiusKm can only be used together with near.' };
    }
    if (!/^\d+$/.test(radiusText) || Number(radiusText) < 1 || Number(radiusText) > MAX_RADIUS_KM) {
      return { problem: `radiusKm must be a whole number between 1 and ${MAX_RADIUS_KM}.` };
    }
    radiusKm = Number(radiusText);
  }

  if (!SORTS.includes(sort)) {
    return { problem: `sort must be one of: ${SORTS.join(', ')}.` };
  }
  if (sort === 'distance' && !near) {
    return { problem: 'sort=distance needs a near place.' };
  }
  if (!/^\d+$/.test(pageText) || Number(pageText) < 1 || Number(pageText) > MAX_PAGE) {
    return { problem: `page must be a whole number between 1 and ${MAX_PAGE}.` };
  }

  return {
    filters: {
      q: q || null,
      location: location || null,
      industry: industry || null,
      gradYear,
      near: near ? { place: near, radiusKm } : null,
      sort,
      page: Number(pageText),
      pageSize: PAGE_SIZE
    }
  };
}

// Drops distanceKm when it is empty (no near-me search, or location not shown).
function cleanResult(profile) {
  if (profile.distanceKm === null || profile.distanceKm === undefined) {
    delete profile.distanceKm;
  }
  return profile;
}

// GET /api/alumni?q=&location=&industry=&gradYear=&near=&radiusKm=&sort=&page=
async function searchAlumni(req, res, next) {
  try {
    const { filters, problem } = validateSearchQuery(req.query);
    if (problem) {
      return sendError(res, 400, 'VALIDATION_ERROR', problem);
    }

    let nearPlace = null;
    if (filters.near) {
      const resolved = await resolveLocation(filters.near.place);
      if (!resolved) {
        return sendError(res, 400, 'LOCATION_NOT_FOUND', 'That place could not be found. Try a city name.');
      }
      nearPlace = resolved.location;
      filters.near = { latitude: nearPlace.latitude, longitude: nearPlace.longitude, radiusKm: filters.near.radiusKm };
    }

    const { rows, total } = await alumniService.searchAlumni(filters);
    const results = rows.map(({ hiddenFields, ...profile }) => cleanResult(applyPrivacy(profile, hiddenFields, req.user)));

    // An empty result is still a successful search: 200 with an empty list.
    const body = { page: filters.page, pageSize: filters.pageSize, total, results };
    if (nearPlace) {
      body.near = { name: nearPlace.name, country: nearPlace.country, radiusKm: filters.near.radiusKm };
    }
    return res.status(200).json(body);
  } catch (error) {
    if (error instanceof GeocodingUnavailableError) {
      console.error(error.message);
      return sendError(res, 503, 'GEOCODING_UNAVAILABLE', 'Near-me search is unavailable right now. Other filters still work.');
    }
    return next(error);
  }
}

// GET /api/alumni/:id
async function getAlumnus(req, res, next) {
  try {
    const { id } = req.params;
    // A value that is not a UUID can never match, so answer 404 without a query.
    if (!UUID_PATTERN.test(id)) {
      return sendError(res, 404, 'ALUMNUS_NOT_FOUND', 'Alumnus not found.');
    }

    const row = await alumniService.getAlumnusById(id);
    if (!row) {
      return sendError(res, 404, 'ALUMNUS_NOT_FOUND', 'Alumnus not found.');
    }

    const { hiddenFields, ...profile } = row;
    return res.status(200).json(applyPrivacy(profile, hiddenFields, req.user));
  } catch (error) {
    return next(error);
  }
}

module.exports = { searchAlumni, getAlumnus };
