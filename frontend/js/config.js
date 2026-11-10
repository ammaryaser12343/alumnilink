// On your laptop the page calls the local APIs; on Vercel it calls the deployed ones.
// Replace each YOUR-...-PROJECT with the real Vercel domain after deploying (Lab 5).
// These addresses are not secrets. Never put DATABASE_URL or TOKEN_SECRET in frontend code.
const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);

const API = isLocal
  ? {
      profile: 'http://localhost:3001/api',
      search: 'http://localhost:3002/api',
      admin: 'http://localhost:3003/api'
    }
  : {
      profile: 'https://YOUR-PROFILE-PROJECT.vercel.app/api',
      search: 'https://YOUR-SEARCH-PROJECT.vercel.app/api',
      admin: 'https://YOUR-ADMIN-PROJECT.vercel.app/api'
    };

// Must match INDUSTRIES in shared/constants.js
const INDUSTRIES = ['Software', 'Cybersecurity', 'Telecommunications', 'Banking and Finance', 'Data and AI', 'Consulting'];
