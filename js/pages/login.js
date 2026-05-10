/* ═══════════════════════════════════════════════════════════════
   REMS — Login page logic
   Step 1: password → POST /api/auth/login { email, password }
   Step 2: PIN      → POST /api/auth/login { email, pin }

   NOTE: Uses async IIFE instead of top-level await for maximum
   browser compatibility (avoids issues with older Chromium builds).
   ═══════════════════════════════════════════════════════════════ */

import { auth, getDeviceId }                 from '../api.js';
import { requireGuest, toast, errorMessage } from '../auth.js';
import { t, initI18n }                       from '../i18n.js';

// ── Helpers (hoisted, available everywhere in module) ─────────────
function q(sel) { return document.querySelector(sel); }
function setLoading(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('btn-loading', on);
}
function getPinValue() {
  return [...document.querySelectorAll('.pin-input')].map(i => i.value).join('');
}
function clearErrors() {
  document.querySelectorAll('.form-error').forEach(el => el.classList.remove('show'));
  document.querySelectorAll('.form-input.error').forEach(el => el.classList.remove('error'));
  hideAlert('err-login');
}
function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  const span = el.querySelector('span');
  if (span) span.textContent = msg;
  el.classList.add('show');
  el.closest('.form-group')?.querySelector('.form-input')?.classList.add('error');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function showAlert(alertId, textId, msg) {
  const alertEl = document.getElementById(alertId);
  if (!alertEl) return;
  alertEl.classList.add('show');
  const el = document.getElementById(textId);
  if (el) el.textContent = msg;
  alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideAlert(id) { document.getElementById(id)?.classList.remove('show'); }

// ─────────────────────────────────────────────────────────────────
// BOOT — async IIFE (no top-level await: works in all ES-module
// browsers including older Chromium/Safari builds)
// ─────────────────────────────────────────────────────────────────
(async () => {
  try { await initI18n(); } catch (e) { console.error('[login] i18n failed:', e); }

  requireGuest();
  getDeviceId().catch(() => {});

  // ── Saved state ───────────────────────────────────────────────
  const savedToken   = localStorage.getItem('rems_token');
  const savedContact = localStorage.getItem('rems_contact') || '';

  // Show PIN step if a returning user on this device has a cached token
  if (savedToken) {
    q('#step-password')?.classList.add('hidden');   // safe optional chaining
    q('#step-pin')?.classList.remove('hidden');
  }

  // ── Password visibility toggle ────────────────────────────────
  q('#toggle-pw')?.addEventListener('click', () => {
    const pw   = q('#password');
    if (!pw) return;
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    const icon = q('#pw-icon');
    if (icon) icon.className = show ? 'ph ph-eye-slash' : 'ph ph-eye';
  });

  // ─────────────────────────────────────────────────────────────
  // STEP 1 — PASSWORD LOGIN
  // Listen on both the form submit AND the button click so that
  // pressing Enter and clicking the button both work.
  // ─────────────────────────────────────────────────────────────
  async function handleLogin(e) {
    if (e?.preventDefault) e.preventDefault();
    clearErrors();

    const contact  = q('#contact')?.value.trim()  ?? '';
    const password = q('#password')?.value         ?? '';
    let valid = true;

    if (!contact)  { showFieldError('err-contact',  t('errors.required')); valid = false; }
    if (!password) { showFieldError('err-password', t('errors.required')); valid = false; }
    if (!valid) return;

    const btn = q('#btn-password');
    setLoading(btn, true);
    try {
      const data = await auth.login(contact, password);
      localStorage.setItem('rems_token',   data.data.token);
      localStorage.setItem('rems_contact', contact);
      window.location.href = '/pages/dashboard.html';
    } catch (err) {
      showAlert('err-login', 'err-login-text', errorMessage(err));
    } finally {
      setLoading(btn, false);
    }
  }

  // Form submit (Enter key) — preventDefault keeps fields intact
  q('#form-password')?.addEventListener('submit', handleLogin);
  // Button click — belt-and-suspenders in case form listener misses
  q('#btn-password')?.addEventListener('click',  handleLogin);

  // ─────────────────────────────────────────────────────────────
  // STEP 2 — PIN LOGIN
  // ─────────────────────────────────────────────────────────────
  q('#btn-pin')?.addEventListener('click', async () => {
    const pin = getPinValue();
    if (pin.length < 6) return;

    hideAlert('err-pin');
    const btn     = q('#btn-pin');
    const contact = savedContact || q('#contact')?.value?.trim() || '';
    setLoading(btn, true);

    try {
      const data = await auth.login(contact, null, pin);
      localStorage.setItem('rems_token', data.data.token);
      window.location.href = '/pages/dashboard.html';
    } catch (err) {
      showAlert('err-pin', 'err-pin-text', errorMessage(err));
      document.querySelectorAll('.pin-input').forEach(i => {
        i.value = '';
        i.classList.remove('filled');
      });
      document.querySelector('.pin-input')?.focus();
      if (btn) btn.disabled = true;
    } finally {
      setLoading(btn, false);
    }
  });

  // ── PIN inputs ────────────────────────────────────────────────
  document.querySelectorAll('.pin-input').forEach((input, idx, all) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/, '').slice(0, 1);
      input.classList.toggle('filled', !!input.value);
      if (input.value && idx < all.length - 1) all[idx + 1].focus();
      const full = getPinValue().length === 6;
      const btnPin = q('#btn-pin');
      if (btnPin) btnPin.disabled = !full;
      if (full) btnPin?.click();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        all[idx - 1].focus();
        all[idx - 1].value = '';
        all[idx - 1].classList.remove('filled');
        const btnPin = q('#btn-pin');
        if (btnPin) btnPin.disabled = true;
      }
    });

    input.addEventListener('paste', (e) => {
      const pasted = (e.clipboardData || window.clipboardData)
        .getData('text').replace(/\D/g, '').slice(0, 6);
      if (!pasted) return;
      e.preventDefault();
      [...pasted].forEach((ch, i) => {
        if (all[i]) { all[i].value = ch; all[i].classList.add('filled'); }
      });
      all[Math.min(pasted.length, all.length) - 1]?.focus();
      const full = getPinValue().length === 6;
      const btnPin = q('#btn-pin');
      if (btnPin) btnPin.disabled = !full;
      if (full) btnPin?.click();
    });
  });

  // ── Back to password ─────────────────────────────────────────
  q('#back-to-password')?.addEventListener('click', () => {
    localStorage.removeItem('rems_token');
    q('#step-pin')?.classList.add('hidden');
    q('#step-password')?.classList.remove('hidden');
  });

})().catch(err => {
  console.error('[login] Fatal initialization error:', err);
});
