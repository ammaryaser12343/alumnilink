const { Router } = require("express");
const { createProfilesController } = require("../controllers/profiles");

function createProfilesRouter({ store, locations, requireAlumni }) {
  const router = Router();
  const controller = createProfilesController({ store, locations });
  const root = "/api/profiles";

  router.post(root, requireAlumni, controller.createProfile);
  router.get(root + "/me", requireAlumni, controller.getProfile);
  router.patch(root + "/me", requireAlumni, controller.updateProfile);
  router.get(root + "/me/skills", requireAlumni, controller.getSkills);
  router.put(root + "/me/skills", requireAlumni, controller.replaceSkills);
  router.get(root + "/me/privacy", requireAlumni, controller.getPrivacy);
  router.patch(root + "/me/privacy", requireAlumni, controller.updatePrivacy);
  router.patch(root + "/me/status", requireAlumni, controller.updateStatus);
  return router;
}

module.exports = { createProfilesRouter };
