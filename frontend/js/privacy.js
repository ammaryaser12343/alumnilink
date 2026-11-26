const { request, message } = window.profileClient;
const form = document.getElementById("privacy");
const fields = [...form.querySelectorAll('input[type="checkbox"]')];

document.getElementById("select-all-privacy").addEventListener("click", () => {
  for (const field of fields) field.checked = true;
});

(async () => {
  try {
    const { privacy } = await request("/api/profiles/me/privacy");
    for (const [field, value] of Object.entries(privacy))
      form.elements[field].checked = value;
    form.hidden = false;
  } catch (error) {
    message(error.message, true);
  }
})();
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  const choices = Object.fromEntries(
    fields.map((input) => [
      input.name,
      input.checked,
    ]),
  );
  try {
    await request("/api/profiles/me/privacy", "PATCH", choices);
    message("Privacy choices saved.");
  } catch (error) {
    message(error.message, true);
  } finally {
    submit.disabled = false;
  }
});
