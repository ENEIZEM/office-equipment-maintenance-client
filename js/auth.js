/* ═══════════════════════════════════════════════════════════════
   REMS — Auth helpers
   Route guards, session management, toast, error messages.
   ═══════════════════════════════════════════════════════════════ */

import { isLoggedIn, clearSession, auth } from './api.js';
import { disconnectSocket }               from './socket.js';
import { t, apiError }                    from './i18n.js';

// ── Route guards ─────────────────────────────────────────────────

export function requireAuth() {
  if (!isLoggedIn()) { redirectTo('/pages/login.html'); return false; }
  return true;
}

export function requireGuest() {
  if (isLoggedIn()) { redirectTo('/pages/dashboard.html'); return false; }
  return true;
}

// ── Logout ───────────────────────────────────────────────────────
export async function logout() {
  try { await auth.logout(); } catch (_) {}
  clearSession();
  disconnectSocket();
  redirectTo('/pages/login.html');
}

// ── Path helper (works from root and from /pages/) ───────────────
function redirectTo(path) {
  const fromPages = location.pathname.toLowerCase().includes('/pages/');
  location.href   = (fromPages ? '..' : '.') + path;
}

// ── JWT decode (display only — no signature validation) ──────────
export function decodeToken() {
  const token = localStorage.getItem('rems_token');
  if (!token) return null;
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  } catch { return null; }
}

// ── Toast notification ────────────────────────────────────────────
export function toast(message, type = 'info', duration = 3500) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? 'success' : type === 'error' ? 'error' : type === 'warn' ? 'warning' : ''}`;

  const iconMap = {
    ok:    'ph-check-circle',
    error: 'ph-x-circle',
    warn:  'ph-warning',
    info:  'ph-info',
  };
  el.innerHTML = `<i class="ph ${iconMap[type] || 'ph-info'}"></i><span>${message}</span>`;
  container.appendChild(el);

  setTimeout(() => {
    el.style.transition = 'opacity 0.25s, transform 0.25s';
    el.style.opacity    = '0';
    el.style.transform  = 'translateY(0.5rem)';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// Error message resolver — single source of truth.
// Backend error_key values mirror the locale JSON structure exactly
// (e.g. 'errors.auth.invalid_credentials'), so we simply translate them.
export function errorMessage(err) {
  return apiError(err);
}
