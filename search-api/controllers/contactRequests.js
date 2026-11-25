// Contact requests: a student asks an alum for their contact email.
// Only students send, only the addressed alum answers, and the email is shown
// to the student only after the alum accepts.
const service = require('../services/contactRequestService');
const { getProfileContact, ServiceUnavailableError } = require('../services/serviceClient');
const { writeAuditLog } = require('../services/auditLog');
const { sendError } = require('../../shared/errors');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PENDING = 5;
const ANSWERS = ['accepted', 'declined'];

function onlyFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }
  const extra = Object.keys(body).find((key) => !allowed.includes(key));
  return extra ? `Unknown field: ${extra}.` : null;
}

// POST /api/contact-requests  { "alumniId": "<profile id>", "message": "..." }  Student only
async function createContactRequest(req, res, next) {
  try {
    const bodyProblem = onlyFields(req.body, ['alumniId', 'message']);
    if (bodyProblem) return sendError(res, 400, 'VALIDATION_ERROR', bodyProblem);

    const { alumniId } = req.body;
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (typeof alumniId !== 'string' || !UUID_PATTERN.test(alumniId)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'alumniId must be a profile id from the search results.');
    }
    if (message.length < 10 || message.length > 500) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'message must be between 10 and 500 characters.');
    }

    const alumnus = await service.findContactableAlumnus(alumniId);
    if (!alumnus) {
      return sendError(res, 404, 'ALUMNUS_NOT_FOUND', 'Alumnus not found.');
    }

    // Limits spam: a student can wait on at most 5 answers at a time.
    // (The 429 itself is recorded by the auditDenied middleware.)
    if (await service.countPendingFromStudent(req.user.id) >= MAX_PENDING) {
      return sendError(res, 429, 'TOO_MANY_PENDING', `You already have ${MAX_PENDING} requests waiting for an answer.`);
    }

    const created = await service.createRequest({ studentUserId: req.user.id, alumniProfileId: alumniId, message });
    if (!created) {
      return sendError(res, 409, 'REQUEST_ALREADY_PENDING', 'You already have an open request to this alum.');
    }

    await writeAuditLog({ actorUserId: req.user.id, action: 'CONTACT_REQUEST_CREATE', targetId: created.id, outcome: 'success' });
    return res.status(201).json({ ...created, alumniName: alumnus.name });
  } catch (error) {
    return next(error);
  }
}

// GET /api/contact-requests  Student: requests sent. Alumni: requests received.
async function listContactRequests(req, res, next) {
  try {
    if (req.user.role === 'alumni') {
      const received = await service.listReceivedByAlumnus(req.user.id);
      return res.status(200).json({ role: 'alumni', requests: received });
    }

    const sent = await service.listSentByStudent(req.user.id);
    const userToken = req.get('Authorization').slice('Bearer '.length).trim();
    // For accepted requests, ask the Profile service for the alum's contact email.
    // If Profile is down, the list still loads and the email is marked unavailable.
    const requests = await Promise.all(sent.map(async (request) => {
      if (request.status !== 'accepted') return request;
      try {
        return { ...request, contactEmail: await getProfileContact(request.alumniId, request.id, userToken) };
      } catch (error) {
        if (!(error instanceof ServiceUnavailableError)) throw error;
        console.error(error.message);
        return { ...request, contactEmail: null, contactUnavailable: true };
      }
    }));
    return res.status(200).json({ role: 'student', requests });
  } catch (error) {
    return next(error);
  }
}

// PATCH /api/contact-requests/:id  { "status": "accepted" | "declined" }  Alumni only, own requests
async function answerContactRequest(req, res, next) {
  try {
    const { id } = req.params;
    if (!UUID_PATTERN.test(id)) {
      return sendError(res, 404, 'REQUEST_NOT_FOUND', 'Contact request not found.');
    }
    const bodyProblem = onlyFields(req.body, ['status']);
    if (bodyProblem) return sendError(res, 400, 'VALIDATION_ERROR', bodyProblem);
    if (!ANSWERS.includes(req.body.status)) {
      return sendError(res, 400, 'VALIDATION_ERROR', `status must be one of: ${ANSWERS.join(', ')}.`);
    }

    const result = await service.answerRequest({ requestId: id, alumniUserId: req.user.id, status: req.body.status });
    if (result.problem === 'NOT_FOUND') {
      // Same answer for "does not exist" and "belongs to another alum", so ids cannot be probed.
      await writeAuditLog({ actorUserId: req.user.id, action: 'CONTACT_REQUEST_ANSWER', targetId: id, outcome: 'not_found' });
      return sendError(res, 404, 'REQUEST_NOT_FOUND', 'Contact request not found.');
    }
    if (result.problem === 'ALREADY_ANSWERED') {
      return sendError(res, 409, 'REQUEST_ALREADY_ANSWERED', 'This request has already been answered.');
    }

    await writeAuditLog({ actorUserId: req.user.id, action: `CONTACT_REQUEST_${req.body.status.toUpperCase()}`, targetId: id, outcome: 'success' });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = { createContactRequest, listContactRequests, answerContactRequest };
