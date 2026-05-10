/* ═══════════════════════════════════════════════════════════════
   REMS — HTTP API client
   All paths are verified against backend/src/index.ts route mounts.

   Route map (backend/src/index.ts):
     /api/auth              ← verification + usersAuth + usersPin
     /api/profile           ← usersProfile
     /api/users/membership  ← usersMembership
     /api/orgs/profile      ← orgsProfile
     /api/orgs/members      ← orgsMembers
     /api/notifications     ← notifications
     /api/upload            ← upload (authenticated)
═══════════════════════════════════════════════════════════════ */

import { getDeviceId, getDeviceIdSync } from './device-id.js';

const API_BASE = '/api';

// ── Core request helper ──────────────────────────────────────────
async function request(method, path, body, opts = {}) {
  const token = localStorage.getItem('rems_token');

  const headers = {};
  if (body !== undefined)  headers['Content-Type'] = 'application/json';
  if (token)               headers['Authorization'] = `Bearer ${token}`;

  // Stable per-device id (random + localStorage). Backend hashes and stores.
  headers['X-Device-Id'] = await getDeviceId();

  if (opts.extraHeaders) Object.assign(headers, opts.extraHeaders);

  const res  = await fetch(API_BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  // Token rotation: if the server sends a fresh token, persist it
  if (data?.data?.token) localStorage.setItem('rems_token', data.data.token);

  if (!res.ok) {
    const err      = new Error(data?.message || data?.error_key || 'Request failed');
    err.status     = res.status;
    err.error_key  = data?.error_key;
    err.data       = data;
    throw err;
  }

  return data;
}

// ── Multipart upload (no JSON content-type) ──────────────────────
async function upload(path, formData) {
  const token = localStorage.getItem('rems_token');
  const did   = await getDeviceId();

  const headers = { 'X-Device-Id': did };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res  = await fetch(API_BASE + path, { method: 'POST', headers, body: formData });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err      = new Error(data?.message || data?.error_key || 'Upload failed');
    err.status     = res.status;
    err.error_key  = data?.error_key;
    err.data       = data;
    throw err;
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────
// AUTH   →  /api/auth/*
// Verification: POST /api/auth/code   { target, type, purpose }
//               POST /api/auth/verify { target, code, purpose }
// Users auth:   POST /api/auth/register, /login, /logout, /accept-invite
// PIN:          POST /api/auth/set-pin, /api/auth/verify-pin
// ─────────────────────────────────────────────────────────────────

/** Detect whether a contact string is an email or a phone number. */
function detectContactType(contact) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? 'email' : 'phone';
}

export const auth = {
  /**
   * Request a verification code.
   * Backend contract: POST /api/auth/code { target, type, purpose }.
   * For registration, purpose defaults to 'register' (the only one currently
   * routed through this public endpoint).
   */
  sendCode: (contact, purpose = 'register') => request('POST', '/auth/code', {
    target:  contact,
    type:    detectContactType(contact),
    purpose,
  }),

  /** Verify a code. Backend: POST /api/auth/verify { target, code, purpose }. */
  verifyCode: (contact, code, purpose = 'register') => request('POST', '/auth/verify', {
    target: contact,
    code,
    purpose,
  }),

  register: (payload) => request('POST', '/auth/register', payload),
  /** email can be email or phone — backend checks both. password OR pin required. */
  login: (email, password, pin) => request('POST', '/auth/login', {
    email,
    ...(password != null && { password }),
    ...(pin      != null && { pin }),
  }),
  logout:       ()                  => request('POST', '/auth/logout',        {}),
  acceptInvite: (token, payload)    => request('POST', '/auth/accept-invite', { token, ...payload }),
  setPin:       (pin)               => request('POST', '/auth/set-pin',       { pin }),
  verifyPin:    (pin)               => request('POST', '/auth/verify-pin',    { pin }),
};

// ─────────────────────────────────────────────────────────────────
// USER PROFILE  →  /api/profile/*
// GET  /api/profile/me
// POST /api/profile/change-password
// POST /api/profile/change-email
// POST /api/profile/change-phone
// POST /api/profile/send-code
// POST /api/profile/avatar/confirm
// ─────────────────────────────────────────────────────────────────
export const profile = {
  get: () => request('GET', '/profile/me'),

  /** payload: { old_password, new_password, new_password_confirm, verification_code, verification_target } */
  changePassword: (payload) => request('POST', '/profile/change-password', payload),

  /** payload: { new_email, verification_code, verification_target } */
  changeEmail: (payload) => request('POST', '/profile/change-email', payload),

  /** payload: { new_phone, verification_code, verification_target } */
  changePhone: (payload) => request('POST', '/profile/change-phone', payload),

  /** payload: { target, type: 'email'|'phone', purpose: 'change_password'|'change_email'|'change_phone' } */
  sendCode: (payload) => request('POST', '/profile/send-code', payload),

  /** Confirm a temp upload as the user's avatar. mediaFileId from POST /api/upload/temp response. */
  confirmAvatar: (mediaFileId) => request('POST', '/profile/avatar/confirm', { media_file_id: mediaFileId }),
};

// ─────────────────────────────────────────────────────────────────
// MEMBERSHIP  →  /api/users/membership/*
// ─────────────────────────────────────────────────────────────────
export const membership = {
  status:  () => request('GET',  '/users/membership/status'),
  reapply: () => request('POST', '/users/membership/reapply', {}),
};

// ─────────────────────────────────────────────────────────────────
// ORGANISATION PROFILE  →  /api/orgs/profile/*
// GET   /api/orgs/profile/me
// PATCH /api/orgs/profile/settings  (owner only; body: { organization_name })
// POST  /api/orgs/profile/logo/confirm
// ─────────────────────────────────────────────────────────────────
export const org = {
  getProfile: () => request('GET', '/orgs/profile/me'),

  /** payload: { organization_name } */
  updateSettings: (payload) => request('PATCH', '/orgs/profile/settings', payload),

  /** Confirm a temp upload as the org logo. */
  confirmLogo: (mediaFileId) => request('POST', '/orgs/profile/logo/confirm', { media_file_id: mediaFileId }),
};

// ─────────────────────────────────────────────────────────────────
// ORGANISATION MEMBERS  →  /api/orgs/members/*
// GET   /api/orgs/members/pending
// POST  /api/orgs/members/invite   body: { contact, requested_role }
// PATCH /api/orgs/members/manage   body: { userId, action, new_role? }
// ─────────────────────────────────────────────────────────────────
export const members = {
  listPending: () => request('GET', '/orgs/members/pending'),

  /** contact: email, phone, or numeric userId string; role: 'employee'|'technician'|'manager' */
  invite: (contact, role) => request('POST', '/orgs/members/invite', { contact, requested_role: role }),

  /** action: 'approved'|'rejected'|'suspended'; newRole is optional */
  manage: (userId, action, newRole) =>
    request('PATCH', '/orgs/members/manage', { userId, action, ...(newRole && { new_role: newRole }) }),
};

// ─────────────────────────────────────────────────────────────────
// NOTIFICATIONS  →  /api/notifications
// GET   /api/notifications
// PATCH /api/notifications/:id/read   (one at a time)
// ─────────────────────────────────────────────────────────────────
export const notifications = {
  getAll: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/notifications${qs ? '?' + qs : ''}`);
  },

  /** Mark a single notification as read. */
  markRead: (id) => request('PATCH', `/notifications/${id}/read`),

  /** Convenience: mark multiple notifications read in parallel. */
  markAllRead: (ids) => Promise.all(ids.map(id => notifications.markRead(id))),
};

// ─────────────────────────────────────────────────────────────────
// UPLOAD  →  /api/upload/*
// POST   /api/upload/temp           (multipart; requires auth)
// GET    /api/upload/:id/file       (serve private file)
// DELETE /api/upload/:id
//
// entity_type values:
//   'user' | 'organization' | 'equipment' | 'request_attachments'
//   'fault_category' | 'equipment_category'
// ─────────────────────────────────────────────────────────────────
export const media = {
  /**
   * Upload a file to the temp folder.
   * Returns { data: { media_file_id, preview_url, mime_type, width?, height?, ... } }
   */
  uploadTemp: (file, entityType = 'user') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entity_type', entityType);
    return upload('/upload/temp', fd);
  },

  /** Delete a media file by ID. */
  delete: (mediaFileId) => request('DELETE', `/upload/${mediaFileId}`),

  /** Build URL for a private file served via the authenticated endpoint. */
  privateUrl: (mediaFileId) => `${API_BASE}/upload/${mediaFileId}/file`,
};

// ─────────────────────────────────────────────────────────────────
// Convenience helpers (re-exported for consumers that don't need all modules)
// ─────────────────────────────────────────────────────────────────
export const isLoggedIn  = ()  => !!localStorage.getItem('rems_token');
export const clearSession = () => localStorage.removeItem('rems_token');
export { getDeviceId, getDeviceIdSync };
