const { randomUUID } = require("node:crypto");
const cors = require("cors");
const express = require("express");
const jwt = require("jsonwebtoken");
const { createVerifier, bearer, requireService } = require("./profile-auth");
const { ApiError } = require("./errors");
const validate = require("./validation");

function requireProfile(value) {
  if (!value)
    throw new ApiError(404, "PROFILE_NOT_FOUND", "Create your profile first.");
  return value;
}
function createApp({
  store,
  identity,
  locations,
  config = {},
  logger = console,
}) {
  const app = express();
  const verify = createVerifier({ ...config, jwt });
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    req.requestId = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(
      req.get("X-Request-Id") ?? "",
    )
      ? req.get("X-Request-Id")
      : randomUUID();
    const start = performance.now();
    res.set({
      "X-Request-Id": req.requestId,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.once("finish", () =>
      logger.info(
        JSON.stringify({
          service: "profile",
          requestId: req.requestId,
          method: req.method,
          route: req.route?.path ?? null,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        }),
      ),
    );
    next();
  });
  if (config.frontendOrigin)
    app.use(
      cors({
        origin: config.frontendOrigin,
        methods: ["GET", "POST", "PATCH", "PUT"],
        allowedHeaders: ["Authorization", "Content-Type"],
        exposedHeaders: ["X-Request-Id"],
      }),
    );
  app.use(express.json({ limit: "16kb" }));
  app.get("/api/health", (_req, res) =>
    res.json({ service: "profile-and-privacy", status: "ok" }),
  );

  async function eligible(claims, role, requestId) {
    const account = await identity(
      "/internal/users/" + claims.sub + "/status",
      { requestId },
    );
    if (
      !account?.user ||
      account.user.id !== claims.sub ||
      account.user.role !== claims.role ||
      account.user.role !== role ||
      account.user.accountStatus !== "active"
    ) {
      throw new ApiError(
        403,
        "ACCOUNT_INELIGIBLE",
        "An active " + role + " account is required.",
      );
    }
  }
  async function alumni(req, _res, next) {
    const claims = verify(bearer(req));
    if (claims.role !== "alumni")
      throw new ApiError(
        403,
        "ALUMNI_REQUIRED",
        "An Alumni account is required.",
      );
    await eligible(claims, "alumni", req.requestId);
    req.userId = claims.sub;
    next();
  }
  async function resolvedDetails(req, create = false) {
    const details = validate.profile(req.body, create);
    if (Object.hasOwn(details, "location")) {
      if (details.location === null) details.locationId = null;
      else {
        const result = await locations("/internal/locations/resolve", {
          body: { name: details.location },
          requestId: req.requestId,
        });
        if (
          !Number.isSafeInteger(result?.location?.id) ||
          result.location.id <= 0
        ) {
          throw new ApiError(
            503,
            "INVALID_LOCATION_RESPONSE",
            "Locations returned an invalid result.",
          );
        }
        const saved = await store.locationExists(result.location.id);
        if (!saved)
          throw new ApiError(
            503,
            "LOCATION_NOT_SAVED",
            "The resolved location is unavailable. Retry the request.",
          );
        details.locationId = saved.id;
        details.location = [saved.name, saved.country]
          .filter(Boolean)
          .join(", ")
          .slice(0, 100);
      }
    }
    return details;
  }
  app.post("/api/profiles", alumni, async (req, res) => {
    res
      .status(201)
      .json({
        profile: await store.saveProfile(
          req.userId,
          await resolvedDetails(req, true),
          true,
        ),
      });
  });
  app.get("/api/profiles/me", alumni, async (req, res) => {
    res.json({ profile: requireProfile(await store.findProfile(req.userId)) });
  });
  app.patch("/api/profiles/me", alumni, async (req, res) => {
    requireProfile(await store.findProfile(req.userId));
    res.json({
      profile: await store.saveProfile(req.userId, await resolvedDetails(req)),
    });
  });
  app.get("/api/profiles/me/skills", alumni, async (req, res) => {
    res.json({
      skills: requireProfile(await store.findProfile(req.userId)).skills,
    });
  });
  app.put("/api/profiles/me/skills", alumni, async (req, res) => {
    validate.fields(req.body, ["skills"]);
    res.json({
      skills: await store.setSkills(
        req.userId,
        validate.skills(req.body.skills),
      ),
    });
  });
  app.get("/api/profiles/me/privacy", alumni, async (req, res) => {
    requireProfile(await store.findProfile(req.userId));
    res.json({ privacy: await store.getPrivacy(req.userId) });
  });
  app.patch("/api/profiles/me/privacy", alumni, async (req, res) => {
    await store.setPrivacy(req.userId, validate.privacy(req.body));
    res.json({ privacy: await store.getPrivacy(req.userId) });
  });
  app.patch("/api/profiles/me/status", alumni, async (req, res) => {
    res.json({
      profile: await store.setStatus(req.userId, validate.status(req.body)),
    });
  });
  app.get(
    "/internal/profiles/:id/contact",
    requireService(config.searchServiceToken),
    async (req, res) => {
      const claims = verify(req.get("X-User-Token"));
      if (claims.role !== "student")
        throw new ApiError(
          403,
          "STUDENT_REQUIRED",
          "Only a Student may reveal accepted contact details.",
        );
      const profileId = validate.id(req.params.id);
      const requestId = validate.id(req.query.requestId);
      await eligible(claims, "student", req.requestId);
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
        owner?.user?.id !== context.ownerId ||
        owner.user.role !== "alumni" ||
        owner.user.accountStatus !== "active"
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
      res.json({ contactEmail: contact.contactEmail });
    },
  );
  app.use((_req, _res, next) =>
    next(new ApiError(404, "NOT_FOUND", "The endpoint was not found.")),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const known =
      Number.isInteger(error.status) &&
      error.code &&
      error.status >= 400 &&
      error.status < 600;
    if (known)
      return res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message } });
    if (error.type === "entity.parse.failed")
      return res
        .status(400)
        .json({ error: { code: "INVALID_JSON", message: "Send valid JSON." } });
    if (error.type === "entity.too.large")
      return res
        .status(413)
        .json({
          error: {
            code: "BODY_TOO_LARGE",
            message: "Maximum body size is 16KB.",
          },
        });
    logger.error(
      JSON.stringify({
        service: "profile",
        requestId: req.requestId,
        event: "unexpected_error",
      }),
    );
    res
      .status(500)
      .json({
        error: {
          code: "INTERNAL_ERROR",
          message: "The operation could not be completed.",
        },
      });
  });
  return app;
}
module.exports = { createApp };
