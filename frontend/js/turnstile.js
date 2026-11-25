// Cloudflare Turnstile ("Verify you are human") for the sign-up and login pages. Owner: Daniel.
// The SITE key is public and is meant to be in the page. The SECRET key is only in admin-api/.env.
// Locally we use Cloudflare's test site key, which always passes (Lab 5).
const TURNSTILE_SITE_KEY = isLocal ? '1x00000000000000000000AA' : 'YOUR-TURNSTILE-SITE-KEY';

let turnstileWidgetId = null;

// Draws the widget inside the element (e.g. '#turnstile-widget').
function renderTurnstile(selector) {
  if (window.turnstile) {
    turnstileWidgetId = window.turnstile.render(selector, { sitekey: TURNSTILE_SITE_KEY });
  }
}

// The one-time ticket to send in the X-Turnstile-Token header ('' if not ready yet).
function getTurnstileToken() {
  if (!window.turnstile || turnstileWidgetId === null) return '';
  return window.turnstile.getResponse(turnstileWidgetId) || '';
}

// Each ticket works once, so get a fresh one after every attempt.
function resetTurnstile() {
  if (window.turnstile && turnstileWidgetId !== null) {
    window.turnstile.reset(turnstileWidgetId);
  }
}