const { ApiError } = require("../errors");
const { verifyUser } = require("../middleware/auth");
const validate = require("../validation");

function createContactController({ store, identity, requireActiveAccount }) {
  return async function getContact(req, res) {
    const claims = verifyUser(req.get("X-User-Token"));
    if (claims.role !== "student" && claims.role !== "alumni")
      throw new ApiError(
        403,
        "CONTACT_SENDER_REQUIRED",
        "Only a Student or an Alum may reveal accepted contact details.",
      );
    const profileId = validate.id(req.params.id);
    const requestId = validate.id(req.query.requestId);
    await requireActiveAccount(claims, claims.role, req.requestId);
    const context = await store.contactContext(
      profileId,
      requestId,
      claims.sub,
    );
    if (!context)
      throw new ApiError(
        403,
        "CONTACT_DENIED",
        "This contact request does not grant access.",
      );
    const owner = await identity(
      "/internal/users/" + context.ownerId + "/status",
      { requestId: req.requestId },
    );
    if (
      owner?.id !== context.ownerId ||
      owner.role !== "alumni" ||
      owner.accountStatus !== "active"
    ) {
      throw new ApiError(
        403,
        "CONTACT_DENIED",
        "The recipient account is unavailable.",
      );
    }
    const contact = await store.contactEmail(
      profileId,
      requestId,
      claims.sub,
    );
    if (!contact)
      throw new ApiError(
        403,
        "CONTACT_DENIED",
        "Contact details are unavailable.",
      );
    res.json({ profileId, contactEmail: contact.contactEmail });
  };
}

module.exports = { createContactController };
