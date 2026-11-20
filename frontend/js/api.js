// Shared fetch helper for every page.
// Sends the login token (saved by the login page in sessionStorage) and turns
// API errors ({ error: { code, message } }) into thrown Errors.
async function apiRequest(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = sessionStorage.getItem('token');
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(data?.error?.message || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}

// Reads role and id from the saved token, only to decide what to show on the page.
// This is not a security check: every API still checks the token and role itself.
function currentUser() {
  const token = sessionStorage.getItem('token');
  if (!token) return null;
  try {
    const body = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(body));
    return { id: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}
