const { ApiError } = require("../errors");
const { verifyUser, bearer } = require("./auth");

function createActiveAccountCheck(identity) {
  return async function requireActiveAccount(claims, role, requestId) {
    const account = await identity(
      "/internal/users/" + claims.sub + "/status",
      { requestId },
    );
    if (
      !account ||
      account.id !== claims.sub ||
      account.role !== claims.role ||
      account.role !== role ||
      account.accountStatus !== "active"
    ) {
      throw new ApiError(
        403,
        "ACCOUNT_INELIGIBLE",
        "An active " + role + " account is required.",
      );
    }
  };
}

function createAlumniAccess(requireActiveAccount) {
  return async function alumni(req, _res, next) {
    const claims = verifyUser(bearer(req));
    if (claims.role !== "alumni")
      throw new ApiError(
        403,
        "ALUMNI_REQUIRED",
        "An Alumni account is required.",
      );
    await requireActiveAccount(claims, "alumni", req.requestId);
    req.userId = claims.sub;
    next();
  };
}

function createDirectoryAccess(requireActiveAccount) {
  return async function directory(req, _res, next) {
    const claims = verifyUser(bearer(req));
    await requireActiveAccount(claims, claims.role, req.requestId);
    req.directoryRole = claims.role;
    next();
  };
}

module.exports = { createActiveAccountCheck, createAlumniAccess, createDirectoryAccess };
