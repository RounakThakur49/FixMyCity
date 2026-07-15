// =============================================================================
// axios.baseClient.ts — Axios instance with JWT Bearer token interceptor
// =============================================================================
// Every request automatically attaches the JWT stored in sessionStorage so
// components don't need to manually pass Authorization headers.
//
// Token storage key: 'fmc_token'  (set by auth saga on login success)
// =============================================================================

import axios from 'axios';

export const TOKEN_KEY = 'fmc_token';

export const apiBaseFMCClient = axios.create({
    baseURL: '',          // Vite proxy routes /api/* to localhost:5000
    timeout: 150000,      // 150s — Render free tier ML inference can take 60-120s
    headers: {
        'Content-Type': 'application/json',
        // ngrok-skip-browser-warning allows demo tunneling without the warning page
        'ngrok-skip-browser-warning': 'true',
    },
});

// ── Request interceptor ──────────────────────────────────────────────────────
// Attach the JWT Bearer token from sessionStorage on every outgoing request.
// If no token exists, the request goes out without Authorization (for public
// routes like /api/auth/login and /api/auth/register this is correct).
apiBaseFMCClient.interceptors.request.use(
    (config) => {
        const token = sessionStorage.getItem(TOKEN_KEY);
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error),
);

// ── Response interceptor ─────────────────────────────────────────────────────
// On a 401, clear the stored session so stale/expired tokens don't loop.
// The saga/component layer then handles the loggedOut state by showing login.
apiBaseFMCClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            // Clear both storage keys on session expiry
            sessionStorage.removeItem(TOKEN_KEY);
            sessionStorage.removeItem('user');
            // Don't redirect here — let the Redux reducer/component handle it
        }
        return Promise.reject(error);
    },
);