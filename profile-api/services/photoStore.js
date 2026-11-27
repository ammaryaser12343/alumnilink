const { createCipheriv, createDecipheriv, randomBytes } = require("node:crypto");
const sharp = require("sharp");
const { ApiError } = require("../errors");

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const DIRECTORY_PHOTO_SIZE = 256;
const CONTENT_TYPE = "image/webp";
const inputFormats = {
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff]),
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};
const keyFor = (profileId) => `profile-photos/${profileId}.webp`;

async function resizePhoto(bytes, contentType) {
  const signature = inputFormats[contentType];
  if (signature && Buffer.isBuffer(bytes) && bytes.subarray(0, signature.length).equals(signature)) {
    try {
      return await sharp(bytes, { limitInputPixels: 16_000_000, failOn: "warning" })
        .autoOrient()
        .resize(512, 512, { fit: "cover", withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch {
      // The image decoder rejected the file or its dimensions.
    }
  }
  throw new ApiError(400, "INVALID_PHOTO", "Choose a valid JPEG or PNG photo up to 16 megapixels.");
}

async function directoryThumbnail(photo) {
  const image = sharp(photo);
  const { width, height } = await image.metadata();
  if (width <= DIRECTORY_PHOTO_SIZE && height <= DIRECTORY_PHOTO_SIZE) return photo;
  return image
    .resize(DIRECTORY_PHOTO_SIZE, DIRECTORY_PHOTO_SIZE, { fit: "cover", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}

function encryptPhoto(photo, key, objectKey) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(objectKey));
  const ciphertext = Buffer.concat([cipher.update(photo), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

function decryptPhoto(payload, key, objectKey) {
  const decipher = createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(objectKey));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
}

function createS3PhotoStore(env) {
  const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
  const bucket = env.PROFILE_PHOTO_BUCKET;
  const endpoint = env.PROFILE_PHOTO_FLOCI_ENDPOINT;
  // Floci may serve unsigned object URLs even when public access is blocked.
  const key = endpoint ? Buffer.from(env.PROFILE_PHOTO_FLOCI_KEY ?? "", "base64") : null;
  if (key && key.length !== 32) return null;
  const objectKeyFor = (profileId) => key ? keyFor(profileId) + ".enc" : keyFor(profileId);
  const client = new S3Client({
    region: env.AWS_REGION || "us-east-1",
    ...(endpoint && {
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  });
  const send = (command) => client.send(command, { abortSignal: AbortSignal.timeout(5000) });
  return {
    async read(profileId) {
      try {
        const objectKey = objectKeyFor(profileId);
        const photo = await send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
        const bytes = Buffer.from(await photo.Body.transformToByteArray());
        return key ? decryptPhoto(bytes, key, objectKey) : bytes;
      } catch (error) {
        if (error.name === "NoSuchKey") return null;
        throw error;
      }
    },
    save(profileId, photo) {
      const objectKey = objectKeyFor(profileId);
      return send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: key ? encryptPhoto(photo, key, objectKey) : photo,
        ContentType: key ? "application/octet-stream" : CONTENT_TYPE,
        CacheControl: "private, no-store",
      }));
    },
    remove(profileId) {
      return send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKeyFor(profileId) }));
    },
  };
}

function createPhotoStore(env) {
  if (env.PROFILE_PHOTO_BUCKET) return createS3PhotoStore(env);
  if (!env.BLOB_STORE_ID && !env.BLOB_READ_WRITE_TOKEN) return null;

  const { del, get, put } = require("@vercel/blob");
  return {
    async read(profileId) {
      const photo = await get(keyFor(profileId), {
        access: "private", useCache: false, abortSignal: AbortSignal.timeout(8000),
      });
      return photo ? Buffer.from(await new Response(photo.stream).arrayBuffer()) : null;
    },
    save(profileId, photo) {
      return put(keyFor(profileId), photo, {
        access: "private",
        contentType: CONTENT_TYPE,
        allowOverwrite: true,
        abortSignal: AbortSignal.timeout(8000),
      });
    },
    remove(profileId) {
      return del(keyFor(profileId), { abortSignal: AbortSignal.timeout(8000) });
    },
  };
}

module.exports = { createPhotoStore, resizePhoto, directoryThumbnail, inputFormats, MAX_PHOTO_BYTES };
