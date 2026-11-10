// Reads the request, validates it, calls the service and sends the response (Lab 4 layers).
const alumniService = require('../services/alumniService');
const { sendError } = require('../../shared/errors');
const { applyPrivacy } = require('../../shared/privacy');
const { INDUSTRIES } = require('../../shared/constants');

const ALLOWED_PARAMS = ['q', 'location', 'industry', 'gradYear', 'sort', 'page'];
const SORTS = ['name', 'newest', 'oldest'];
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
  const sort = (query.sort || 'name').trim();
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

  if (!SORTS.includes(sort)) {
    return { problem: `sort must be one of: ${SORTS.join(', ')}.` };
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
      sort,
      page: Number(pageText),
      pageSize: PAGE_SIZE
    }
  };
}

// GET /api/alumni?q=&location=&industry=&gradYear=&sort=&page=
async function searchAlumni(req, res, next) {
  try {
    const { filters, problem } = validateSearchQuery(req.query);
    if (problem) {
      return sendError(res, 400, 'VALIDATION_ERROR', problem);
    }

    const { rows, total } = await alumniService.searchAlumni(filters);
    const results = rows.map(({ hiddenFields, ...profile }) => applyPrivacy(profile, hiddenFields, req.user));

    // An empty result is still a successful search: 200 with an empty list.
    return res.status(200).json({ page: filters.page, pageSize: filters.pageSize, total, results });
  } catch (error) {
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
