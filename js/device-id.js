/* ═══════════════════════════════════════════════════════════════
   REMS — stable per-device id (random + localStorage).

   Returns a stable opaque ID that survives reloads of the same browser.
   No external CDN, no library, no detection of any browser properties —
   just a random 160-bit value persisted in localStorage. The backend
   hashes it and stores it in the user_sessions table for device-bound
   session validation.
═══════════════════════════════════════════════════════════════ */

const LS_KEY = 'rems_did';
let _cached  = null;

function generateId() {
  // 20 random bytes (160 bits) — plenty of entropy for an opaque device id
  return Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Returns a stable opaque device id (async API kept for backwards compatibility,
 * but resolves synchronously on the same tick).
 */
export async function getDeviceId() {
  if (_cached) return _cached;
  let id = localStorage.getItem(LS_KEY);
  if (!id) {
    id = generateId();
    try { localStorage.setItem(LS_KEY, id); } catch {}
  }
  _cached = id;
  return id;
}

/** Synchronous accessor. Returns the cached id or a fresh one on first call. */
export function getDeviceIdSync() {
  if (_cached) return _cached;
  let id = localStorage.getItem(LS_KEY);
  if (!id) {
    id = generateId();
    try { localStorage.setItem(LS_KEY, id); } catch {}
  }
  _cached = id;
  return id;
}
