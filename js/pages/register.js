/* ═══════════════════════════════════════════════════════════════
   REMS — Registration wizard
   Step 1: contact + role selection (owner → org name; others → optional org ID)
   Step 2: 6-digit email/SMS verification code
   Step 3: full_name, department?, password, password_confirm, pin?
   Step 4: success

   API flow:
     POST /api/auth/code    { contact }
     POST /api/auth/verify  { contact, code }
     POST /api/auth/register { ...payload }

   NOTE: Uses async IIFE instead of top-level await for maximum
   browser compatibility (avoids issues with older Chromium builds).
   ═══════════════════════════════════════════════════════════════ */

import { auth }                              from '../api.js';
import { requireGuest, toast, errorMessage } from '../auth.js';
import { t, initI18n, getLang }              from '../i18n.js';

// ── Helpers (hoisted — available everywhere in module) ────────────
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
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRe = /^\+?[\d\s\-().]{7,}$/;
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

function clearAllErrors() {
  document.querySelectorAll('.form-error').forEach(el => el.classList.remove('show'));
  document.querySelectorAll('.form-input.error').forEach(el => el.classList.remove('error'));
  document.querySelectorAll('.alert').forEach(el => el.classList.remove('show'));
}
function clearFieldError(id) {
  document.getElementById(id)?.classList.remove('show');
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
  const s = document.getElementById(textId);
  if (s) s.textContent = msg;
  alertEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideAlert(id) {
  document.getElementById(id)?.classList.remove('show');
}

// ─────────────────────────────────────────────────────────────────
// BOOT — async IIFE (no top-level await: works in all ES-module
// browsers including older Chromium/Safari builds)
// ─────────────────────────────────────────────────────────────────
(async () => {
  try { await initI18n(); } catch (e) { console.error('[register] i18n failed:', e); }

  requireGuest();

  // ── Wizard state ─────────────────────────────────────────────
  let currentStep  = 1;
  let selectedRole = null;
  let resendTimer  = null;
  let resendSecs   = 60;

  const state = {
    contact:           '',
    role:              '',
    organization_name: '',
    organization_id:   null,
  };

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

  // ── Resend timer ─────────────────────────────────────────────
  function startResendTimer() {
    clearResendTimer();
    resendSecs = 60;
    const wait      = q('#resend-wait');
    const btnResend = q('#btn-resend');
    const counter   = q('#resend-countdown');
    if (wait)      wait.classList.remove('hidden');
    if (btnResend) btnResend.style.display = 'none';
    if (counter)   counter.textContent = resendSecs;

    resendTimer = setInterval(() => {
      resendSecs--;
      if (counter) counter.textContent = resendSecs;
      if (resendSecs <= 0) {
        clearResendTimer();
        if (wait)      wait.classList.add('hidden');
        if (btnResend) btnResend.style.display = '';
      }
    }, 1000);
  }
  function clearResendTimer() {
    if (resendTimer) { clearInterval(resendTimer); resendTimer = null; }
  }

  // ─────────────────────────────────────────────────────────────
  // ROLE SELECTION — native radio + explicit .selected class
  // (CSS :has(input:checked) alone fails in some older browsers)
  // ─────────────────────────────────────────────────────────────
  document.querySelectorAll('input[name="role"]').forEach(radio => {
    radio.addEventListener('change', () => {
      selectedRole = radio.value;

      // Explicit .selected class — guarantees visual feedback in ALL browsers
      document.querySelectorAll('.role-card').forEach(card => {
        const r = card.querySelector('input[name="role"]');
        card.classList.toggle('selected', !!r?.checked);
      });

      // Toggle org fields
      const orgNameGrp = document.getElementById('org-name-group');
      const orgIdGrp   = document.getElementById('org-id-group');
      if (orgNameGrp) orgNameGrp.style.display = selectedRole === 'owner' ? '' : 'none';
      if (orgIdGrp)   orgIdGrp.style.display   = selectedRole === 'owner' ? 'none' : '';

      clearFieldError('err-role');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // STEP 1 — Validate & send verification code
  // ─────────────────────────────────────────────────────────────
  q('#btn-step1')?.addEventListener('click', async () => {
    clearAllErrors();

    const contact = q('#reg-contact')?.value.trim() ?? '';
    let valid = true;

    if (!contact) {
      showFieldError('err-contact', t('errors.required'));
      valid = false;
    } else if (!isValidContact(contact)) {
      showFieldError('err-contact', t('errors.invalid_contact'));
      valid = false;
    }

    if (!selectedRole) {
      showFieldError('err-role', t('errors.select_role'));
      valid = false;
    }

    if (selectedRole === 'owner') {
      const orgName = q('#org-name')?.value.trim() ?? '';
      if (!orgName) {
        showFieldError('err-org-name', t('errors.required'));
        valid = false;
      } else {
        state.organization_name = orgName;
        state.organization_id   = null;
      }
    } else if (selectedRole) {
      const orgIdRaw = q('#org-id')?.value.trim() ?? '';
      const orgIdNum = parseInt(orgIdRaw, 10);
      if (!orgIdRaw || !Number.isFinite(orgIdNum) || orgIdNum < 1) {
        showFieldError('err-org-id', t('errors.required'));
        valid = false;
      } else {
        state.organization_name = '';
        state.organization_id   = orgIdNum;
      }
    }

    if (!valid) return;

    state.contact = contact;
    state.role    = selectedRole;

    const btn = q('#btn-step1');
    setLoading(btn, true);
    try {
      await auth.sendCode(contact);
      const display = q('#contact-display');
      if (display) display.textContent = contact;
      goStep(2);
      startResendTimer();
      setTimeout(() => document.querySelector('.code-input')?.focus(), 80);
    } catch (err) {
      showAlert('err-step1', 'err-step1-text', errorMessage(err));
    } finally {
      setLoading(btn, false);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // STEP 2 — Verification code inputs
  // ─────────────────────────────────────────────────────────────
  const codeInputs = document.querySelectorAll('.code-input');

  codeInputs.forEach((input, idx, all) => {
    input.addEventListener('input', () => {
      input.classList.remove('error');   // clear error state on re-type
      hideAlert('err-step2');
      input.value = input.value.replace(/\D/, '').slice(0, 1);
      if (input.value && idx < all.length - 1) all[idx + 1].focus();
      const btn2 = q('#btn-step2');
      if (btn2) btn2.disabled = getCodeValue().length < 6;
      if (getCodeValue().length === 6) btn2?.click();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        all[idx - 1].focus();
        all[idx - 1].value = '';
        const btn2 = q('#btn-step2');
        if (btn2) btn2.disabled = true;
      }
    });

    input.addEventListener('paste', (e) => {
      const raw = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
      if (!raw) return;
      e.preventDefault();
      [...raw].forEach((ch, i) => { if (all[i]) all[i].value = ch; });
      all[Math.min(raw.length, all.length) - 1]?.focus();
      const btn2 = q('#btn-step2');
      if (btn2) btn2.disabled = getCodeValue().length < 6;
      if (getCodeValue().length === 6) btn2?.click();
    });
  });

  q('#btn-step2')?.addEventListener('click', async () => {
    const code = getCodeValue();
    if (code.length < 6) return;

    hideAlert('err-step2');
    const btn = q('#btn-step2');
    setLoading(btn, true);
    try {
      await auth.verifyCode(state.contact, code);
      goStep(3);
      setTimeout(() => q('#reg-name')?.focus(), 80);
    } catch (err) {
      showAlert('err-step2', 'err-step2-text', errorMessage(err));
      // Mark inputs as error; don't clear them so user can see what they entered
      codeInputs.forEach(i => i.classList.add('error'));
      if (btn) btn.disabled = false;
      codeInputs[0]?.focus();
    } finally {
      setLoading(btn, false);
    }
  });

  q('#btn-back-step1')?.addEventListener('click', () => { clearResendTimer(); goStep(1); });

  // Resend code
  q('#btn-resend')?.addEventListener('click', async () => {
    hideAlert('err-step2');
    try {
      await auth.sendCode(state.contact);
      startResendTimer();
      toast(t('auth.register.code_resend') + '…', 'ok');
    } catch (err) {
      showAlert('err-step2', 'err-step2-text', errorMessage(err));
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

  // PIN inputs in step 3
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
      showFieldError('err-name', t('errors.required'));
      valid = false;
    }
    if (!password) {
      showFieldError('err-reg-password', t('errors.required'));
      valid = false;
    } else if (!isStrongPassword(password)) {
      showFieldError('err-reg-password', t('errors.password_weak'));
      valid = false;
    }
    if (!password2) {
      showFieldError('err-reg-password2', t('errors.required'));
      valid = false;
    } else if (password && password !== password2) {
      showFieldError('err-reg-password2', t('errors.password_mismatch'));
      valid = false;
    }
    if (pin && pin.length !== 6) {
      showFieldError('err-reg-pin', t('errors.pin_length'));
      valid = false;
    }
    if (!valid) return;

    const payload = {
      contact:          state.contact,
      full_name:        fullName,
      password,
      password_confirm: password2,
      language_code:    getLang(),
    };
    if (dept)                    payload.department        = dept;
    if (pin)                     payload.pin               = pin;
    if (state.role === 'owner')  payload.organization_name = state.organization_name;
    else {
      if (state.organization_id) payload.organization_id   = state.organization_id;
      payload.requested_role = state.role;
    }

    const btn = q('#btn-step3');
    setLoading(btn, true);
    try {
      await auth.register(payload);
      clearResendTimer();
      goStep(4);
    } catch (err) {
      showAlert('err-step3', 'err-step3-text', errorMessage(err));
    } finally {
      setLoading(btn, false);
    }
  });

})().catch(err => {
  console.error('[register] Fatal initialization error:', err);
});
