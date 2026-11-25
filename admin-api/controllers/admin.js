// Administration and Verification: the admin's powers. Owner: Daniel.
// Every action that changes something writes a line in the audit log.
const { sendError } = require('../../shared/errors');
const {
  listVerifications: findVerifications,
  reviewVerification: decideVerification,
  changeUserStatus,
  listAuditLogs,
  listUsers: findUsers
} = require('../services/adminService');
const { writeAuditLog } = require('../services/auditLog');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Only allow the query parameters we expect (e.g. ?status=pending).
function unexpectedParams(query, allowed) {
  const extra = Object.keys(query).filter((key) => !allowed.includes(key));
  return extra.length ? `Unexpected parameter(s): ${extra.join(', ')}.` : null;
}

// Only allow the body fields we expect.
function unexpectedFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be a JSON object.';
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  return extra.length ? `Unexpected field(s): ${extra.join(', ')}.` : null;
}

function isRealDate(text) {
  if (typeof text !== 'string' || !DATE_PATTERN.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

// ?page= : whole number 1 to 500, default 1. Returns a number, or null if invalid.
function readPage(value) {
  if (value === undefined) return 1;
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 500 ? page : null;
}

// GET /api/admin/verifications?status=pending|approved|rejected|all  (default pending)
async function listVerifications(req, res, next) {
  try {
    const paramError = unexpectedParams(req.query, ['status']);
    if (paramError) return sendError(res, 400, 'VALIDATION_ERROR', paramError);

    const status = req.query.status || 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'status must be pending, approved, rejected or all.');
    }

    const rows = await findVerifications(status);
    return res.status(200).json({
      status,
      count: rows.length,
      results: rows.map((row) => ({
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        user: { id: row.user_id, name: row.name, email: row.email, role: row.role, accountStatus: row.account_status }
      }))
    });
  } catch (error) {
    return next(error);
  }
}

// PATCH /api/admin/verifications/:id   body: { "decision": "approved" | "rejected" }
async function reviewVerification(req, res, next) {
  try {
    if (!UUID_PATTERN.test(req.params.id)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Verification id is not valid.');
    }
    const fieldError = unexpectedFields(req.body, ['decision']);
    if (fieldError) return sendError(res, 400, 'VALIDATION_ERROR', fieldError);

    const { decision } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'decision must be "approved" or "rejected".');
    }

    const outcome = await decideVerification({ requestId: req.params.id, decision, adminId: req.user.id });

    if (outcome.result === 'not_found') {
      return sendError(res, 404, 'VERIFICATION_NOT_FOUND', 'Verification request not found.');
    }
    if (outcome.result === 'already_reviewed') {
      return sendError(res, 409, 'VERIFICATION_ALREADY_REVIEWED', `This request was already ${outcome.status}.`);
    }

    const { request } = outcome;
    await writeAuditLog({
      actorUserId: req.user.id,
      action: decision === 'approved' ? 'APPROVE_USER' : 'REJECT_USER',
      targetId: request.user_id,
      outcome: 'success'
    });

    return res.status(200).json({
      message: decision === 'approved' ? 'Account approved. The user can now log in.' : 'Registration rejected.',
      verification: { id: request.id, status: request.status, reviewedAt: request.reviewed_at },
      user: { id: request.user_id, accountStatus: request.account_status }
    });
  } catch (error) {
    return next(error);
  }
}

// PATCH /api/admin/users/:id/status   body: { "status": "suspended" | "active" }
async function updateUserStatus(req, res, next) {
  try {
    if (!UUID_PATTERN.test(req.params.id)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'User id is not valid.');
    }
    const fieldError = unexpectedFields(req.body, ['status']);
    if (fieldError) return sendError(res, 400, 'VALIDATION_ERROR', fieldError);

    const { status } = req.body;
    if (!['suspended', 'active'].includes(status)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'status must be "suspended" or "active".');
    }

    const outcome = await changeUserStatus({ userId: req.params.id, newStatus: status });
    const action = status === 'suspended' ? 'SUSPEND_USER' : 'REACTIVATE_USER';

    if (outcome.result === 'not_found') {
      return sendError(res, 404, 'USER_NOT_FOUND', 'User not found.');
    }
    if (outcome.result === 'is_admin') {
      await writeAuditLog({ actorUserId: req.user.id, action, targetId: req.params.id, outcome: 'denied_admin_target' });
      return sendError(res, 403, 'CANNOT_CHANGE_ADMIN', 'Admin accounts cannot be suspended or reactivated here.');
    }
    if (outcome.result === 'wrong_status') {
      const reason = status === 'suspended'
        ? `Only active accounts can be suspended (this one is ${outcome.status}).`
        : `Only suspended accounts can be reactivated (this one is ${outcome.status}).`;
      return sendError(res, 409, 'INVALID_STATUS_CHANGE', reason);
    }

    await writeAuditLog({ actorUserId: req.user.id, action, targetId: outcome.user.id, outcome: 'success' });

    return res.status(200).json({
      message: status === 'suspended' ? 'Account suspended.' : 'Account reactivated.',
      user: { id: outcome.user.id, name: outcome.user.name, role: outcome.user.role, accountStatus: outcome.user.account_status }
    });
  } catch (error) {
    return next(error);
  }
}

// GET /api/admin/users?role=&status=&q=&page=
async function listUsers(req, res, next) {
  try {
    const paramError = unexpectedParams(req.query, ['role', 'status', 'q', 'page']);
    if (paramError) return sendError(res, 400, 'VALIDATION_ERROR', paramError);

    const { role, status } = req.query;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : req.query.q;

    if (role !== undefined && !['student', 'alumni', 'admin'].includes(role)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'role must be student, alumni or admin.');
    }
    if (status !== undefined && !['pending', 'active', 'suspended', 'rejected'].includes(status)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'status must be pending, active, suspended or rejected.');
    }
    if (q !== undefined && q !== '' && (typeof q !== 'string' || q.length < 2 || q.length > 100)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Search text must be 2 to 100 characters.');
    }
    const page = readPage(req.query.page);
    if (page === null) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'page must be a whole number from 1 to 500.');
    }

    const data = await findUsers({ role: role || null, status: status || null, q: q || null, page });

    return res.status(200).json({
      page: data.page,
      pageSize: data.pageSize,
      total: data.total,
      results: data.results.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        accountStatus: row.account_status,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    return next(error);
  }
}

// GET /api/admin/logs?service=&action=&outcome=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=
async function listLogs(req, res, next) {
  try {
    const paramError = unexpectedParams(req.query, ['service', 'action', 'outcome', 'from', 'to', 'page']);
    if (paramError) return sendError(res, 400, 'VALIDATION_ERROR', paramError);

    const { service, action, outcome, from, to } = req.query;

    if (service !== undefined && !['profile', 'search', 'admin'].includes(service)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'service must be profile, search or admin.');
    }
    if (action !== undefined && !/^[A-Z_]{2,50}$/.test(action)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'action must be capital letters and underscores, e.g. LOGIN.');
    }
    if (outcome !== undefined && !/^[a-z_]{2,20}$/.test(outcome)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'outcome must be lower-case letters and underscores, e.g. success.');
    }
    if (from !== undefined && !isRealDate(from)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'from must be a date like 2026-11-22.');
    }
    if (to !== undefined && !isRealDate(to)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'to must be a date like 2026-11-22.');
    }
    if (from && to && from > to) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'from must be on or before to.');
    }
    const page = readPage(req.query.page);
    if (page === null) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'page must be a whole number from 1 to 500.');
    }

    const data = await listAuditLogs({
      service: service || null,
      action: action || null,
      outcome: outcome || null,
      from: from || null,
      to: to || null,
      page
    });

    return res.status(200).json({
      page: data.page,
      pageSize: data.pageSize,
      total: data.total,
      results: data.results.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        service: row.service_name,
        action: row.action,
        outcome: row.outcome,
        targetId: row.target_id,
        actor: row.actor_user_id ? { id: row.actor_user_id, name: row.actor_name, role: row.actor_role } : null
      }))
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { listVerifications, reviewVerification, updateUserStatus, listUsers, listLogs };