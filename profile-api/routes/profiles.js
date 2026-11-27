const { Router, raw } = require("express");
const { ApiError } = require("../errors");
const { MAX_PHOTO_BYTES, inputFormats } = require("../services/photoStore");
const { createProfilesController } = require("../controllers/profiles");

const parsePhoto = raw({ type: Object.keys(inputFormats), limit: MAX_PHOTO_BYTES, inflate: false });

function readUpload(req, res, next) {
  if (!req.is(Object.keys(inputFormats))) {
    return next(new ApiError(415, "PHOTO_TYPE_UNSUPPORTED", "Choose a JPEG or PNG photo."));
  }
  parsePhoto(req, res, (error) => {
    if (error?.type === "entity.too.large") {
      return next(new ApiError(413, "PHOTO_TOO_LARGE", "Photos must be 2 MB or smaller."));
    }
    if (error?.type === "encoding.unsupported") {
      return next(new ApiError(415, "PHOTO_ENCODING_UNSUPPORTED", "Send an uncompressed photo upload."));
    }
    next(error);
  });
}

function createProfilesRouter({ store, locations, photos, requireAlumni, requireDirectoryUser }) {
  const router = Router();
  const controller = createProfilesController({ store, locations, photos });
  const root = "/api/profiles";

  router.post(root, requireAlumni, controller.createProfile);
  router.get(root + "/me", requireAlumni, controller.getProfile);
  router.patch(root + "/me", requireAlumni, controller.updateProfile);
  router.get(root + "/me/skills", requireAlumni, controller.getSkills);
  router.put(root + "/me/skills", requireAlumni, controller.replaceSkills);
  router.get(root + "/me/privacy", requireAlumni, controller.getPrivacy);
  router.patch(root + "/me/privacy", requireAlumni, controller.updatePrivacy);
  router.patch(root + "/me/status", requireAlumni, controller.updateStatus);
  router.get(root + "/me/photo", requireAlumni, controller.getPhoto);
  router.put(root + "/me/photo", requireAlumni, readUpload, controller.savePhoto);
  router.delete(root + "/me/photo", requireAlumni, controller.removePhoto);
  router.get(root + "/me/photo/audience", requireAlumni, controller.getPhotoAudience);
  router.patch(root + "/me/photo/audience", requireAlumni, controller.updatePhotoAudience);
  router.get(root + "/directory/photos", requireDirectoryUser, controller.getDirectoryPhotos);
  return router;
}

module.exports = { createProfilesRouter };
