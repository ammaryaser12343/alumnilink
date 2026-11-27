const { request, message } = window.profileClient;
const form = document.getElementById("profile");
const toggle = document.getElementById("toggle-profile");
const directory = document.getElementById("profile-directory");
const activeState = document.getElementById("active-state");
const directoryStatus = document.getElementById("profile-directory-status");
const saveStatus = document.getElementById("profile-save-status");
let current;
form.elements.graduationYear.max = new Date().getUTCFullYear();
function render(profile) {
  const profileLoaded = !current && profile;
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
  directory.hidden = !profile;
  toggle.textContent = profile?.isActive
    ? "Deactivate profile"
    : "Reactivate profile";
  activeState.textContent = profile?.isActive ? "Active in directory" : "Hidden from directory";
  activeState.classList.toggle("is-active", Boolean(profile?.isActive));
  form.hidden = false;
  if (!profile) window.profilePhoto.showBeforeCreation();
  if (profileLoaded) window.profilePhoto.load();
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
  message("", false, saveStatus);
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
    message("Profile saved.", false, saveStatus);
  } catch (error) {
    message(error.message, true, saveStatus);
  } finally {
    submit.disabled = false;
    toggle.disabled = false;
  }
});
toggle.addEventListener("click", async () => {
  toggle.disabled = true;
  message("", false, directoryStatus);
  try {
    render(
      (
        await request("/api/profiles/me/status", "PATCH", {
          isActive: !current.isActive,
        })
      ).profile,
    );
    message(current.isActive ? "Profile reactivated." : "Profile deactivated.", false, directoryStatus);
  } catch (error) {
    message(error.message, true, directoryStatus);
  } finally {
    toggle.disabled = false;
  }
});
