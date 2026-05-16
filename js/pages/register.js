/* ═══════════════════════════════════════════════════════════════
   REMS — Registration wizard
   Step 1: contact + role + (owner: org name | other: org id)
   Step 2: 6-digit email/SMS verification code
   Step 3: full_name, department?, password, password_confirm, pin?
   Step 4: success

   Backend contract:
     POST /api/auth/code     { target, type, purpose, organization_id? }
     POST /api/auth/verify   { target, code, purpose }
     POST /api/auth/register { ...payload }

   The /api/auth/code endpoint performs eager validation on step 1
   (contact-not-registered, org existence/active/capacity), so the user
   never gets past step 1 with a fundamentally broken input.

   NOTE: Uses async IIFE instead of top-level await for maximum
   browser compatibility (avoids issues with older Chromium builds).
   ═══════════════════════════════════════════════════════════════ */

import { auth }                              from '../api.js';
import { requireGuest, toast, errorMessage } from '../auth.js';
import { t, initI18n, getLang, onLangChange, applyTranslations } from '../i18n.js';
import { wireFormGuard }                     from '../form-guard.js';
import { createCodeInput }                   from '../lib/code-input.js';

// ── Hoisted helpers ─────────────────────────────────────────────
function q(sel) { return document.querySelector(sel); }

function setLoading(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('btn-loading', on);
}

function getCodeValue() {
  return [...document.querySelectorAll('.code-input')].map(i => i.value).join('');
}
function getRegPinValue() {
  return [...document.querySelectorAll('#reg-pin-inputs .pin-input')].map(i => i.value).join('');
}

function isValidContact(val) {
  // Mirrors backend/src/lib/auth-helpers.ts → detectContactType so the
  // client doesn't pass shorter-than-real-life phones (e.g. "+7996531")
  // that the backend would accept here but reject later.
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRe = /^\+?\d{10,15}$/;
  return emailRe.test(val) || phoneRe.test(val.replace(/[\s\-().]/g, ''));
}
function isStrongPassword(pw) {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw);
}
function calcStrength(pw) {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8)    s++;
  if (/[A-Z]/.test(pw))  s++;
  if (/[a-z]/.test(pw))  s++;
  if (/\d/.test(pw))     s++;
  return Math.max(1, s);
}

// ── Error / alert helpers (i18n-friendly) ───────────────────────
// All visible error text is rendered through an i18n KEY stored on the
// element's data-i18n attribute, so applyTranslations() re-translates
// them automatically when the user switches language.

function clearAllErrors() {
  document.querySelectorAll('.form-error').forEach(el => {
    el.classList.remove('show');
    const span = el.querySelector('span');
    if (span) { span.removeAttribute('data-i18n'); span.textContent = ''; }
  });
  document.querySelectorAll('.form-input.error').forEach(el => el.classList.remove('error'));
  document.querySelectorAll('.alert').forEach(el => {
    el.classList.remove('show');
    const txt = el.querySelector('[id^="err-"][id$="-text"]');
    if (txt) { txt.removeAttribute('data-i18n'); txt.textContent = ''; }
  });
}
function clearFieldError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('show');
  const span = el.querySelector('span');
  if (span) { span.removeAttribute('data-i18n'); span.textContent = ''; }
}
function showFieldError(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  const span = el.querySelector('span');
  if (span) {
    span.setAttribute('data-i18n', key);
    span.textContent = t(key);
  }
  el.classList.add('show');
  el.closest('.form-group')?.querySelector('.form-input')?.classList.add('error');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function showAlertKey(alertId, textId, key, fallback) {
  const alertEl = document.getElementById(alertId);
  if (!alertEl) return;
  alertEl.classList.add('show');
  const el = document.getElementById(textId);
  if (el) {
    el.setAttribute('data-i18n', key);
    const translated = t(key);
    el.textContent = (translated !== key) ? translated : (fallback || translated);
  }
  alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function showAlertFromError(alertId, textId, err) {
  const key = err?.error_key || 'errors.server_error';
  showAlertKey(alertId, textId, key, err?.message || errorMessage(err));
}
function hideAlert(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('show');
  const txt = el.querySelector('[id$="-text"]');
  if (txt) { txt.removeAttribute('data-i18n'); txt.textContent = ''; }
}

// ─────────────────────────────────────────────────────────────────
// BOOT — async IIFE (no top-level await: works in all ES-module
// browsers including older Chromium/Safari builds)
// ─────────────────────────────────────────────────────────────────
(async () => {
  try { await initI18n(); } catch (e) { console.error('[register] i18n failed:', e); }

  if (!requireGuest()) return;   // already logged in — bail out before touching UI

  // Re-translate visible alerts/field-errors when language changes.
  onLangChange(() => applyTranslations());

  // ── Wizard state ─────────────────────────────────────────────
  let currentStep  = 1;
  let selectedRole = null;

  const state = {
    contact:           '',
    role:              '',
    organization_name: '',
    organization_id:   null,
  };

  // ── Code-input controller (step 2) ───────────────────────────
  // The wiring (auto-advance, paste, backspace, resend countdown)
  // lives in lib/code-input.js so registration, change-password
  // and change-contact all behave identically.
  const codeCtl = createCodeInput({
    inputs:        '.code-input',
    resendButton:  '#btn-resend',
    resendWait:    '#resend-wait',
    resendCounter: '#resend-countdown',
    onChange: () => {
      hideAlert('err-step2');
      const btn2 = q('#btn-step2');
      const val  = codeCtl.read();
      if (btn2) btn2.disabled = val.length < 6;
      // Auto-submit on 6th digit (preserves the existing UX).
      if (val.length === 6) btn2?.click();
    },
  });

  // ── Step navigation ──────────────────────────────────────────
  function goStep(n) {
    currentStep = n;
    for (let i = 1; i <= 4; i++) {
      q(`#step-${i}`)?.classList.toggle('hidden', i !== n);

      const circle = q(`#step-circle-${i}`);
      if (!circle) continue;
      circle.classList.remove('active', 'done');

      if (i < n) {
        circle.classList.add('done');
        circle.innerHTML = '<i class="ph ph-check" style="font-size:.875rem;"></i>';
      } else {
        circle.textContent = String(i);
        if (i === n) circle.classList.add('active');
      }

      const line = q(`#step-line-${i}`);
      if (line) line.classList.toggle('done', i < n);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ROLE SELECTION
  // ─────────────────────────────────────────────────────────────
  document.querySelectorAll('input[name="role"]').forEach(radio => {
    radio.addEventListener('change', () => {
      selectedRole = radio.value;

      // Explicit .selected class — guaranteed in all browsers
      document.querySelectorAll('.role-card').forEach(card => {
        const r = card.querySelector('input[name="role"]');
        card.classList.toggle('selected', !!r?.checked);
      });

      const orgNameGrp = document.getElementById('org-name-group');
      const orgIdGrp   = document.getElementById('org-id-group');
      const occGrp     = document.getElementById('org-occupation-group');
      if (orgNameGrp) orgNameGrp.style.display = selectedRole === 'owner' ? '' : 'none';
      if (occGrp)     occGrp.style.display     = selectedRole === 'owner' ? '' : 'none';
      if (orgIdGrp)   orgIdGrp.style.display   = selectedRole === 'owner' ? 'none' : '';

      clearFieldError('err-role');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // OCCUPATION RADIO — same .selected visual feedback as role cards.
  // Only owner sees this group (toggled by the role handler above).
  // ─────────────────────────────────────────────────────────────
  let selectedOccupation = 'customer';   // sensible default — most signups
  document.querySelectorAll('input[name="occupation"]').forEach(radio => {
    radio.addEventListener('change', () => {
      selectedOccupation = radio.value;
      document.querySelectorAll('#occupation-grid .role-card').forEach(card => {
        const r = card.querySelector('input[name="occupation"]');
        card.classList.toggle('selected', !!r?.checked);
      });
    });
  });
  // Apply the initial "selected" visual to the default-checked card.
  document.querySelectorAll('#occupation-grid .role-card').forEach(card => {
    const r = card.querySelector('input[name="occupation"]');
    if (r?.checked) card.classList.add('selected');
  });

  // ─────────────────────────────────────────────────────────────
  // VISUAL FORM-GUARDS — gray-out the CTA until required fields look
  // filled. Click is still allowed (real validation lives in the click
  // handlers), this is purely a visual "pending" cue.
  // ─────────────────────────────────────────────────────────────
  const guardStep1 = wireFormGuard({
    button:   '#btn-step1',
    required: [
      { sel: '#reg-contact',          kind: 'text' },
      { sel: 'input[name="role"]',    kind: 'radio-group' },
      // Conditional: owner needs org-name (+ occupation), joining role needs org-id.
      {
        kind:  'fn',
        watch: ['#org-name', '#org-id', 'input[name="role"]'],
        fn: () => {
          const role = document.querySelector('input[name="role"]:checked')?.value;
          if (!role) return false;
          if (role === 'owner') {
            return !!document.querySelector('#org-name')?.value.trim();
          }
          const v = document.querySelector('#org-id')?.value.trim();
          return !!v && Number.isFinite(parseInt(v, 10)) && parseInt(v, 10) > 0;
        },
      },
    ],
  });

  const guardStep3 = wireFormGuard({
    button:   '#btn-step3',
    required: [
      { sel: '#reg-name',      kind: 'text' },
      { sel: '#reg-password',  kind: 'text' },
      { sel: '#reg-password2', kind: 'text' },
      { sel: '#reg-pin-inputs .pin-input', kind: 'digit-group', total: 6 },
    ],
  });

  // ─────────────────────────────────────────────────────────────
  // STEP 1 — Validate inputs, then ask backend to issue a code.
  // Backend performs all heavy checks (contact-already-registered,
  // org-exists/active/has-capacity) so step 1 stops the user before
  // step 2 if anything is wrong.
  // ─────────────────────────────────────────────────────────────
  q('#btn-step1')?.addEventListener('click', async () => {
    clearAllErrors();

    const contact = q('#reg-contact')?.value.trim() ?? '';
    let valid = true;

    if (!contact) {
      showFieldError('err-contact', 'errors.required');
      valid = false;
    } else if (!isValidContact(contact)) {
      showFieldError('err-contact', 'errors.invalid_contact');
      valid = false;
    }

    if (!selectedRole) {
      showFieldError('err-role', 'errors.select_role');
      valid = false;
    }

    if (selectedRole === 'owner') {
      const orgName = q('#org-name')?.value.trim() ?? '';
      if (!orgName) {
        showFieldError('err-org-name', 'errors.required');
        valid = false;
      } else {
        state.organization_name = orgName;
        state.organization_id   = null;
        state.occupation        = selectedOccupation;
      }
    } else if (selectedRole) {
      const orgIdRaw = q('#org-id')?.value.trim() ?? '';
      const orgIdNum = parseInt(orgIdRaw, 10);
      if (!orgIdRaw || !Number.isFinite(orgIdNum) || orgIdNum < 1) {
        showFieldError('err-org-id', 'errors.required');
        valid = false;
      } else {
        state.organization_name = '';
        state.organization_id   = orgIdNum;
        state.occupation        = null;     // inherited from the existing org
      }
    }

    if (!valid) return;

    state.contact = contact;
    state.role    = selectedRole;

    const btn = q('#btn-step1');
    setLoading(btn, true);
    try {
      const resp = await auth.sendCode(contact, 'register', state.organization_id);
      const display = q('#contact-display');
      if (display) display.textContent = contact;
      goStep(2);

      // Backend differentiates a freshly issued code from a re-use of an
      // existing in-flight code (when the user goes back to step 1 and
      // forward again within the cooldown window).
      //   reused=true  → tell the user to use the code already sent
      //   reused=false → tell the user a fresh code was sent (and clear
      //                  any stale digits in the inputs)
      const reused   = resp?.data?.reused === true;
      const cooldown = Number(resp?.data?.cooldown) || 60;
      codeCtl.startResendTimer(cooldown);

      if (reused) {
        toast(t('auth.register.code_use_existing'), 'info');
      } else {
        // Clear any leftover digits from a previous code-entry attempt
        document.querySelectorAll('.code-input').forEach(i => {
          i.value = '';
          i.classList.remove('error', 'filled');
        });
        const btn2 = q('#btn-step2');
        if (btn2) btn2.disabled = true;
      }

      setTimeout(() => document.querySelector('.code-input')?.focus(), 80);
    } catch (err) {
      // Map specific backend errors to the matching field instead of a generic alert.
      if (err?.error_key === 'errors.contact_already_registered' ||
          err?.error_key === 'errors.email_already_registered'   ||
          err?.error_key === 'errors.phone_already_registered') {
        showFieldError('err-contact', err.error_key);
        return;
      }
      if (err?.error_key === 'errors.organization.not_found'   ||
          err?.error_key === 'errors.organization.inactive'    ||
          err?.error_key === 'errors.organization.employee_limit_reached') {
        showFieldError('err-org-id', err.error_key);
        return;
      }
      showAlertFromError('err-step1', 'err-step1-text', err);
    } finally {
      setLoading(btn, false);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // STEP 2 — Verification code (inputs + resend wired by codeCtl)
  // ─────────────────────────────────────────────────────────────
  q('#btn-step2')?.addEventListener('click', async () => {
    const code = codeCtl.read();
    if (code.length < 6) return;

    hideAlert('err-step2');
    const btn = q('#btn-step2');
    setLoading(btn, true);
    try {
      await auth.verifyCode(state.contact, code);
      goStep(3);
      setTimeout(() => q('#reg-name')?.focus(), 80);
    } catch (err) {
      showAlertFromError('err-step2', 'err-step2-text', err);
      document.querySelectorAll('.code-input').forEach(i => i.classList.add('error'));
      if (btn) btn.disabled = false;
      codeCtl.focus();
    } finally {
      setLoading(btn, false);
    }
  });

  q('#btn-back-step1')?.addEventListener('click', () => { codeCtl.stopResendTimer(); goStep(1); });

  // Resend code (step 2)
  q('#btn-resend')?.addEventListener('click', async () => {
    hideAlert('err-step2');
    try {
      const resp = await auth.sendCode(state.contact, 'register', state.organization_id);
      const cooldown = Number(resp?.data?.cooldown) || 60;
      codeCtl.startResendTimer(cooldown);
      // If backend reused the existing code (shouldn't normally happen on
      // resend because UI disables the button during cooldown, but defensive),
      // tell the user; otherwise show a "code resent" confirmation.
      if (resp?.data?.reused) {
        toast(t('auth.register.code_use_existing'), 'info');
      } else {
        toast(t('auth.register.code_resend') + '…', 'ok');
        codeCtl.clear();
        codeCtl.focus();
        const btn2 = q('#btn-step2');
        if (btn2) btn2.disabled = true;
      }
    } catch (err) {
      showAlertFromError('err-step2', 'err-step2-text', err);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // STEP 3 — Personal info & finish
  // ─────────────────────────────────────────────────────────────

  // Password visibility toggle
  q('#toggle-reg-pw')?.addEventListener('click', () => {
    const pw = q('#reg-password');
    if (!pw) return;
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    const icon = q('#reg-pw-icon');
    if (icon) icon.className = show ? 'ph ph-eye-slash' : 'ph ph-eye';
  });

  // Password strength bar
  q('#reg-password')?.addEventListener('input', () => {
    const pw       = q('#reg-password')?.value ?? '';
    const strength = calcStrength(pw);
    const bars     = document.querySelectorAll('.pw-bar');
    const colors   = ['#ef4444', '#f59e0b', '#0d9488', '#0f766e'];
    const labels_ru = ['Очень слабый', 'Слабый', 'Хороший', 'Надёжный'];
    const labels_en = ['Very weak', 'Weak', 'Good', 'Strong'];
    const labels    = getLang() === 'en' ? labels_en : labels_ru;

    const strengthEl = q('#pw-strength');
    if (strengthEl) strengthEl.style.display = pw ? '' : 'none';
    bars.forEach((bar, i) => {
      bar.style.background = i < strength ? colors[strength - 1] : 'var(--clr-border)';
    });
    const lbl = q('#pw-strength-label');
    if (lbl) { lbl.textContent = pw ? labels[strength - 1] : ''; lbl.style.color = colors[strength - 1]; }
  });

  // PIN inputs in step 3 (PIN is OPTIONAL)
  document.querySelectorAll('#reg-pin-inputs .pin-input').forEach((input, idx, all) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/, '').slice(0, 1);
      input.classList.toggle('filled', !!input.value);
      if (input.value && idx < all.length - 1) all[idx + 1].focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        all[idx - 1].focus();
        all[idx - 1].value = '';
        all[idx - 1].classList.remove('filled');
      }
    });
  });

  q('#btn-back-step2')?.addEventListener('click', () => goStep(2));

  q('#btn-step3')?.addEventListener('click', async () => {
    clearAllErrors();

    const fullName  = q('#reg-name')?.value.trim()  ?? '';
    const dept      = q('#reg-dept')?.value.trim()   ?? '';
    const password  = q('#reg-password')?.value      ?? '';
    const password2 = q('#reg-password2')?.value     ?? '';
    const pin       = getRegPinValue();
    let valid = true;

    if (!fullName) {
      showFieldError('err-name', 'errors.required');
      valid = false;
    }
    if (!password) {
      showFieldError('err-reg-password', 'errors.required');
      valid = false;
    } else if (!isStrongPassword(password)) {
      showFieldError('err-reg-password', 'errors.password_weak');
      valid = false;
    }
    if (!password2) {
      showFieldError('err-reg-password2', 'errors.required');
      valid = false;
    } else if (password && password !== password2) {
      showFieldError('err-reg-password2', 'errors.password_mismatch');
      valid = false;
    }
    // PIN is required (6 digits)
    if (!pin) {
      showFieldError('err-reg-pin', 'errors.required');
      valid = false;
    } else if (pin.length !== 6) {
      showFieldError('err-reg-pin', 'errors.pin_length');
      valid = false;
    }
    if (!valid) return;

    const payload = {
      contact:          state.contact,
      full_name:        fullName,
      password,
      password_confirm: password2,
      pin,                       // 6 digits, required
      language_code:    getLang(),
    };
    if (dept) payload.department = dept;
    if (state.role === 'owner') {
      payload.organization_name = state.organization_name;
      // Owner also picks customer/contractor at registration time —
      // the backend stores it on the freshly-created organisation.
      if (state.occupation) payload.occupation = state.occupation;
    } else {
      if (state.organization_id) payload.organization_id = state.organization_id;
      payload.requested_role = state.role;
    }

    const btn = q('#btn-step3');
    setLoading(btn, true);
    try {
      await auth.register(payload);
      codeCtl.stopResendTimer();
      goStep(4);
    } catch (err) {
      showAlertFromError('err-step3', 'err-step3-text', err);
    } finally {
      setLoading(btn, false);
    }
  });

})().catch(err => {
  console.error('[register] Fatal initialization error:', err);
});
