const { request, message } = window.profileClient;
const form = document.getElementById("profile");
const toggle = document.getElementById("toggle-profile");
let current;
form.elements.graduationYear.max = new Date().getUTCFullYear();
function render(profile) {
  current = profile;
  for (const field of [
    "graduationYear",
    "company",
    "industry",
    "location",
    "contactEmail",
    "bio",
  ]) {
    form.elements[field].value = profile?.[field] ?? "";
  }
  form.elements.skills.value = profile?.skills.join(", ") ?? "";
  toggle.hidden = !profile;
  toggle.textContent = profile?.isActive
    ? "Deactivate profile"
    : "Reactivate profile";
  document.getElementById("active-state").textContent = profile
    ? profile.isActive
      ? "Your profile is active."
      : "Your profile is hidden from the directory. You can still sign in and edit it."
    : "";
  form.hidden = false;
}
(async () => {
  try {
    render((await request("/api/profiles/me")).profile);
  } catch (error) {
    if (error.code === "PROFILE_NOT_FOUND") render();
    else message(error.message, true);
  }
})();
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  toggle.disabled = true;
  const fields = Object.fromEntries(new FormData(form));
  const body = {
    graduationYear: Number(fields.graduationYear),
    company: fields.company,
    industry: fields.industry,
    bio: fields.bio,
    contactEmail: fields.contactEmail.trim() || null,
    skills: fields.skills
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
  if (fields.location.trim() !== (current?.location ?? ""))
    body.location = fields.location.trim() || null;
  try {
    render(
      (
        await request(
          current ? "/api/profiles/me" : "/api/profiles",
          current ? "PATCH" : "POST",
          body,
        )
      ).profile,
    );
    message("Profile saved.");
  } catch (error) {
    message(error.message, true);
  } finally {
    submit.disabled = false;
    toggle.disabled = false;
  }
});
toggle.addEventListener("click", async () => {
  toggle.disabled = true;
  try {
    render(
      (
        await request("/api/profiles/me/status", "PATCH", {
          isActive: !current.isActive,
        })
      ).profile,
    );
    message(current.isActive ? "Profile reactivated." : "Profile deactivated.");
  } catch (error) {
    message(error.message, true);
  } finally {
    toggle.disabled = false;
  }
});
