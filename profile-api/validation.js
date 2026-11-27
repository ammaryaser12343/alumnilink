const { ApiError } = require("./errors");
const privacyFields = [
  "graduation_year",
  "company",
  "location",
  "industry",
  "bio",
  "skills",
];
function invalid(message) {
  throw new ApiError(400, "INVALID_INPUT", message);
}
function fields(body, allowed) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !Object.keys(body).length ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    invalid("Send supported fields in a JSON object.");
}
function text(value, name, max, min = 0) {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    value.trim().length < min ||
    value.trim().length > max
  ) {
    invalid(name + " has an invalid length or type.");
  }
  return value.trim();
}
function id(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)
  )
    invalid("Use a valid UUID.");
  return value;
}
function skills(values) {
  if (!Array.isArray(values) || values.length > 20)
    invalid("Provide up to 20 skills.");
  return [
    ...new Set(
      values.map((value) =>
        text(value, "skill", 50, 1).replace(/\s+/g, " ").toLowerCase(),
      ),
    ),
  ].sort();
}
function profile(body, create = false) {
  fields(body, [
    "graduationYear",
    "company",
    "industry",
    "bio",
    "skills",
    "contactEmail",
    "location",
  ]);
  const result = {};
  if (create || Object.hasOwn(body, "graduationYear")) {
    if (
      !Number.isInteger(body.graduationYear) ||
      body.graduationYear < 1950 ||
      body.graduationYear > new Date().getUTCFullYear()
    )
      invalid("Enter a graduation year between 1950 and this year.");
    result.graduationYear = body.graduationYear;
  }
  for (const [name, max] of Object.entries({
    company: 100,
    industry: 50,
    bio: 500,
  })) {
    if (Object.hasOwn(body, name)) result[name] = text(body[name], name, max);
  }
  if (Object.hasOwn(body, "contactEmail")) {
    const email =
      body.contactEmail === null
        ? null
        : text(body.contactEmail, "contactEmail", 254, 3).toLowerCase();
    if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      invalid("Enter a valid contact email.");
    result.contactEmail = email;
  }
  if (Object.hasOwn(body, "location"))
    result.location =
      body.location === null ? null : text(body.location, "location", 100, 2);
  if (Object.hasOwn(body, "skills")) result.skills = skills(body.skills);
  return result;
}
function privacy(body) {
  fields(body, privacyFields);
  if (Object.values(body).some((value) => typeof value !== "boolean"))
    invalid("Visibility values must be true or false.");
  return body;
}
function status(body) {
  fields(body, ["isActive"]);
  if (typeof body.isActive !== "boolean")
    invalid("isActive must be true or false.");
  return body.isActive;
}
function photoAudience(body) {
  fields(body, ["audience"]);
  if (!["private", "alumni", "students", "directory"].includes(body.audience))
    invalid("Choose a supported photo audience.");
  return body.audience;
}
function directoryPhotoIds(value) {
  const ids = typeof value === "string" ? value.split(",") : [];
  if (!ids.length || ids.length > 10) invalid("Send up to 10 profile IDs.");
  return [...new Set(ids.map(id))];
}

module.exports = {
  photoAudience,
  directoryPhotoIds,
  fields,
  id,
  skills,
  profile,
  privacy,
  status,
  privacyFields,
};
