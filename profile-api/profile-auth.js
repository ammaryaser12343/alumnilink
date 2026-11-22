const { createHash, timingSafeEqual } = require("node:crypto");
const { verifyToken } = require("../shared/auth");

function failure(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function verifyUser(token) {
  if (!token)
    throw failure(401, "AUTH_REQUIRED", "A user access token is required.");
  if ((process.env.TOKEN_SECRET?.length ?? 0) < 32)
    throw failure(503, "AUTH_UNAVAILABLE", "TOKEN_SECRET is not configured.");
  const claims = verifyToken(token);
  if (
    !claims ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(claims.sub) ||
    !["student", "alumni", "admin"].includes(claims.role) ||
    !Number.isInteger(claims.exp)
  ) {
    throw failure(401, "INVALID_TOKEN", "A valid user access token is required.");
  }
  return claims;
}

function bearer(req) {
  return /^Bearer ([^\s]+)$/i.exec(req.get("Authorization") ?? "")?.[1];
}

function requireService(secret) {
  const expected =
    secret?.length >= 32
      ? createHash("sha256").update(secret).digest()
      : undefined;
  return (req, _res, next) => {
    const token = req.get("X-Service-Key");
    if (!token)
      throw failure(
        401,
        "SERVICE_KEY_INVALID",
        "The Search service credential is required.",
      );
    if (!expected)
      throw failure(
        503,
        "SERVICE_AUTH_UNAVAILABLE",
        "The service credential is not configured.",
      );
    const actual = createHash("sha256").update(token).digest();
    if (!timingSafeEqual(actual, expected))
      throw failure(
        401,
        "SERVICE_KEY_INVALID",
        "Invalid service credential.",
      );
    next();
  };
}

module.exports = { verifyUser, bearer, requireService };
