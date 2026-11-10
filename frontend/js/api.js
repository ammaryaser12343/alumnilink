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
