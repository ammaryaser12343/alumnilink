const { ApiError } = require("../errors");
const validate = require("../validation");
const { resizePhoto, directoryThumbnail } = require("../services/photoStore");

function requireProfile(value) {
  if (!value)
    throw new ApiError(404, "PROFILE_NOT_FOUND", "Create your profile first.");
  return value;
}

function createProfilesController({ store, locations, photos }) {
  async function withPhotoStore(operation) {
    if (!photos) {
      throw new ApiError(503, "PHOTO_STORAGE_NOT_CONFIGURED", "Photo storage is not configured on this deployment.");
    }
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "PHOTO_STORAGE_UNAVAILABLE", "Photo storage is unavailable. Please retry.");
    }
  }

  async function resolvedDetails(req, create = false) {
    const details = validate.profile(req.body, create);
    if (Object.hasOwn(details, "location") && details.location !== null) {
      const result = await locations("/internal/locations/resolve", {
        body: { location: details.location },
        requestId: req.requestId,
      });
      if (!result) {
        throw new ApiError(400, "INVALID_LOCATION", "The selected location could not be resolved.");
      }
      const place = result.location;
      if (
        typeof place?.name !== "string" ||
        !place.name.trim() ||
        (place.country !== null && typeof place.country !== "string") ||
        !Number.isFinite(place.latitude) ||
        !Number.isFinite(place.longitude)
      ) {
        throw new ApiError(503, "INVALID_LOCATION_RESPONSE", "Locations returned an invalid result.");
      }
      // Search caches the coordinates under the submitted text, including aliases.
    }
    return details;
  }

  return {
    async getPhotoAudience(req, res) {
      res.json({ audience: requireProfile(await store.getPhotoAudience(req.userId)) });
    },
    async updatePhotoAudience(req, res) {
      const audience = validate.photoAudience(req.body);
      res.json({ audience: requireProfile(await store.setPhotoAudience(req.userId, audience)) });
    },
    async getDirectoryPhotos(req, res) {
      const ids = validate.directoryPhotoIds(req.query.ids);
      const visible = photos ? await store.findDirectoryPhotoIds(ids, req.directoryRole) : [];
      const entries = await Promise.all(visible.map(async (id) => {
        const thumbnail = await withPhotoStore(async () => {
          const photo = await photos.read(id);
          return photo ? directoryThumbnail(photo) : null;
        });
        return thumbnail ? [id, thumbnail.toString("base64")] : null;
      }));
      res.json({ photos: Object.fromEntries(entries.filter(Boolean)) });
    },
    async getPhoto(req, res) {
      const { id } = requireProfile(await store.findProfile(req.userId));
      const photo = await withPhotoStore(() => photos.read(id));
      if (!photo) return res.status(204).end();
      res.type("webp").send(photo);
    },
    async savePhoto(req, res) {
      const { id } = requireProfile(await store.findProfile(req.userId));
      const photo = await withPhotoStore(async () => {
        const resized = await resizePhoto(req.body, req.is(["image/jpeg", "image/png"]));
        await photos.save(id, resized);
        return resized;
      });
      res.type("webp").send(photo);
    },
    async removePhoto(req, res) {
      const { id } = requireProfile(await store.findProfile(req.userId));
      await withPhotoStore(() => photos.remove(id));
      res.status(204).end();
    },
    async createProfile(req, res) {
      res
        .status(201)
        .json({
          profile: await store.saveProfile(
            req.userId,
            await resolvedDetails(req, true),
            true,
          ),
        });
    },
    async getProfile(req, res) {
      res.json({ profile: requireProfile(await store.findProfile(req.userId)) });
    },
    async updateProfile(req, res) {
      requireProfile(await store.findProfile(req.userId));
      res.json({
        profile: await store.saveProfile(req.userId, await resolvedDetails(req)),
      });
    },
    async getSkills(req, res) {
      res.json({
        skills: requireProfile(await store.findProfile(req.userId)).skills,
      });
    },
    async replaceSkills(req, res) {
      validate.fields(req.body, ["skills"]);
      res.json({
        skills: await store.setSkills(
          req.userId,
          validate.skills(req.body.skills),
        ),
      });
    },
    async getPrivacy(req, res) {
      requireProfile(await store.findProfile(req.userId));
      res.json({ privacy: await store.getPrivacy(req.userId) });
    },
    async updatePrivacy(req, res) {
      await store.setPrivacy(req.userId, validate.privacy(req.body));
      res.json({ privacy: await store.getPrivacy(req.userId) });
    },
    async updateStatus(req, res) {
      res.json({
        profile: await store.setStatus(req.userId, validate.status(req.body)),
      });
    },
  };
}

module.exports = { createProfilesController };
