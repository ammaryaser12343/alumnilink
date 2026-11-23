// Login page. Owner: Daniel.
// Sends email + password + Turnstile ticket to the Identity API.
// On success it keeps the badge (token) in sessionStorage under "token", where
// Ammar's apiRequest() and Ahmed's profile pages look for it, then goes to the
// right page for the role.
const form = document.getElementById('login-form');
const statusBox = document.getElementById('status');
const button = document.getElementById('login-button');

renderTurnstile('#turnstile-widget');

// Same green/red message box as Ahmed's pages. textContent, never innerHTML.
function showStatus(text, isError = false) {
  statusBox.textContent = text;
  statusBox.classList.toggle('error', isError);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) {
    showStatus('Please enter your email and password.', true);
    return;
  }

  const ticket = getTurnstileToken();
  if (!ticket) {
    showStatus('Please wait for the "Verify you are human" check to finish.', true);
    return;
  }

  button.disabled = true;
  showStatus('Logging in...');

  try {
    const data = await apiRequest(`${API.admin}/auth/login`, {
      method: 'POST',
      headers: { 'X-Turnstile-Token': ticket },
      body: JSON.stringify({ email, password })
    });

    sessionStorage.setItem('token', data.token);
    sessionStorage.setItem('userName', data.user.name);
    window.location.href = data.user.role === 'admin' ? 'admin.html' : 'index.html';
  } catch (error) {
    // The Identity API's own message, e.g. "Email or password is incorrect."
    showStatus(error.message, true);
    resetTurnstile();
    button.disabled = false;
  }
});