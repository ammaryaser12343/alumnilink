const { randomUUID } = require("node:crypto");
const cors = require("cors");
const express = require("express");
const { createProfilesRouter } = require("./routes/profiles");
const { createInternalRouter } = require("./routes/internal");
const { createActiveAccountCheck, createAlumniAccess, createDirectoryAccess } = require("./middleware/activeAccount");
const { ApiError } = require("./errors");
const { createRuntimeOptions } = require("./runtime");

function createApp({
  store,
  identity,
  locations,
  photos,
  config = {},
  logger = console,
}) {
  const app = express();
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
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
        allowedHeaders: ["Authorization", "Content-Type"],
        exposedHeaders: ["X-Request-Id"],
      }),
    );
  app.use(express.json({ limit: "16kb" }));
  app.get("/", (_req, res) =>
    res.json({
      name: "AlumniLink Profile and Privacy API",
      endpoints: [
        "/api/health",
        "/api/profiles",
        "/api/profiles/me",
        "/api/profiles/me/skills",
        "/api/profiles/me/privacy",
        "/api/profiles/me/status",
        "/api/profiles/me/photo",
        "/api/profiles/me/photo/audience",
        "/api/profiles/directory/photos",
      ],
    }),
  );
  app.get("/api/health", (_req, res) =>
    res.json({ service: "profile-and-privacy", status: "ok" }),
  );

  const requireActiveAccount = createActiveAccountCheck(identity);
  const requireAlumni = createAlumniAccess(requireActiveAccount);
  const requireDirectoryUser = createDirectoryAccess(requireActiveAccount);
  app.use(createProfilesRouter({ store, locations, photos, requireAlumni, requireDirectoryUser }));
  app.use(createInternalRouter({ store, identity, requireActiveAccount, serviceKey: config.serviceKey }));

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
module.exports = createApp(createRuntimeOptions());
module.exports.createApp = createApp;
