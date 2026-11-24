const { Router } = require("express");
const { createContactController } = require("../controllers/internal");
const { requireService } = require("../middleware/auth");

function createInternalRouter({ store, identity, requireActiveAccount, serviceKey }) {
  const router = Router();
  const getContact = createContactController({ store, identity, requireActiveAccount });
  router.get("/internal/profiles/:id/contact", requireService(serviceKey), getContact);
  return router;
}

module.exports = { createInternalRouter };
