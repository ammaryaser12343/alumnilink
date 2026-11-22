const { createPublicKey, createHash, timingSafeEqual } = require("node:crypto");

function failure(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function createVerifier({
  publicKey,
  issuer = "alumnilink-accounts",
  audience = "alumnilink-api",
  jwt,
}) {
  let key;
  return (token) => {
    if (!token)
      throw failure(401, "AUTH_REQUIRED", "A user access token is required.");
    if (!publicKey)
      throw failure(
        503,
        "AUTH_UNAVAILABLE",
        "The identity verification key is not configured.",
      );
    key ??= createPublicKey(publicKey.replace(/\\n/g, "\n"));
    try {
      const claims = jwt.verify(token, key, {
        algorithms: ["RS256"],
        issuer,
        audience,
      });
      if (
        typeof claims !== "object" ||
        !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(claims.sub) ||
        !["student", "alumni", "admin"].includes(claims.role) ||
        !Number.isInteger(claims.exp)
      ) {
        throw new Error("Invalid claims");
      }
      return claims;
    } catch {
      throw failure(
        401,
        "INVALID_TOKEN",
        "A valid user access token is required.",
      );
    }
  };
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
    const token = bearer(req);
    if (!token)
      throw failure(
        401,
        "SERVICE_AUTH_REQUIRED",
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
        "INVALID_SERVICE_TOKEN",
        "Invalid service credential.",
      );
    next();
  };
}

module.exports = { createVerifier, bearer, requireService };
