/* ═══════════════════════════════════════════════════════════════
   Personal "Профиль" tab — identity strip + 2 cards (Личные
   данные / Аккаунт). Pure render: takes (user, role, isOwner,
   ownerOrgCreatedAt) and paints the existing DOM.
   ═══════════════════════════════════════════════════════════════ */

import { t } from '../../../i18n.js';
import {
  statusBadge, roleBadgeDescriptor,
  renderIconBadge, renderRowChip,
} from '../badges.js';
import { fmtDate, setAvatar } from '../format.js';

export function renderProfileTab(user, role, isOwner, ownerOrgCreatedAt) {
  // ── Identity strip ─────────────────────────────────────────
  setAvatar(document.querySelector('#profile-initials'), document.querySelector('#profile-avatar-img'), user);
  document.querySelector('#profile-fullname').textContent      = user.full_name || '—';
  document.querySelector('#profile-userid-inline').textContent = `#${user.id ?? '—'}`;
  document.querySelector('#profile-head-email').textContent    = user.email_masked || '';
  document.querySelector('#profile-head-phone').textContent    = user.phone_masked || '';

  // Role + status pills — both use the icon+text badge style
  renderIconBadge(document.querySelector('#profile-role-badge'), roleBadgeDescriptor(role));
  const statusEl = document.querySelector('#profile-status-badge');
  if (statusEl) {
    if (isOwner) {
      statusEl.style.display = 'none';
    } else {
      statusEl.style.display = '';
      renderIconBadge(statusEl, statusBadge(user.membership_status));
    }
  }

  // ── LEFT card: Личные данные ───────────────────────────────
  document.querySelector('#info-fullname').textContent = user.full_name  || '—';
  document.querySelector('#info-dept').textContent     = user.department || '—';
  // Role inside «Личные данные»: container-less chip (read-only info).
  renderRowChip(document.querySelector('#info-role'), roleBadgeDescriptor(role));

  // Role-tooltip:
  //   owner   → hidden (nothing useful to say)
  //   manager → shown with the "you can change technician/employee" hint
  //   other   → shown with the generic "ask your owner/manager" hint
  const roleTipPersonal = document.querySelector('#info-role-tooltip');
  if (roleTipPersonal) {
    let tipKey = null;
    if (role === 'manager')    tipKey = 'profile.role_change_hint_manager';
    else if (role !== 'owner') tipKey = 'profile.role_change_hint';
    if (tipKey) {
      roleTipPersonal.classList.remove('hidden');
      roleTipPersonal.setAttribute('data-tooltip-key', tipKey);
      roleTipPersonal.setAttribute('data-tooltip-text', t(tipKey));
    } else {
      roleTipPersonal.classList.add('hidden');
    }
  }

  // Contacts: masked value as sub-line under label, action button on right.
  // The button flips between "Сменить" (gray) and "Привязать" (green)
  // depending on whether the user already has a contact of this type.
  // The dedicated "verified" pill is gone — verification is implied by
  // the fact that the contact is shown at all.
  const setRowAction = (btnEl, mode) => {
    if (!btnEl) return;
    btnEl.classList.remove('btn-row-change', 'btn-row-link');
    btnEl.classList.add(mode === 'link' ? 'btn-row-link' : 'btn-row-change');
  };

  const emailSub  = document.querySelector('#info-email-sub');
  const emailBtn  = document.querySelector('#btn-edit-email');
  const emailBtnL = document.querySelector('#btn-edit-email-label');
  if (user.email_masked) {
    emailSub.textContent = user.email_masked;
    emailBtnL.setAttribute('data-i18n', 'common.change');
    emailBtnL.textContent = t('common.change');
    setRowAction(emailBtn, 'change');
  } else {
    emailSub.textContent = '';
    emailBtnL.setAttribute('data-i18n', 'common.link');
    emailBtnL.textContent = t('common.link');
    setRowAction(emailBtn, 'link');
  }

  const phoneSub  = document.querySelector('#info-phone-sub');
  const phoneBtn  = document.querySelector('#btn-edit-phone');
  const phoneBtnL = document.querySelector('#btn-edit-phone-label');
  if (user.phone_masked) {
    phoneSub.textContent = user.phone_masked;
    phoneBtnL.setAttribute('data-i18n', 'common.change');
    phoneBtnL.textContent = t('common.change');
    setRowAction(phoneBtn, 'change');
  } else {
    phoneSub.textContent = '';
    phoneBtnL.setAttribute('data-i18n', 'common.link');
    phoneBtnL.textContent = t('common.link');
    setRowAction(phoneBtn, 'link');
  }

  // ── RIGHT card: Аккаунт ────────────────────────────────────
  // Password + PIN dates render as a sub-line under their labels.
  const pwdSub = document.querySelector('#info-pwd-changed');
  pwdSub.textContent = user.updated_at ? `${t('profile.password_last_changed')}: ${fmtDate(user.updated_at)}` : '—';
  const pinSub = document.querySelector('#info-pin-set');
  pinSub.textContent = user.pin_set_at ? `${t('profile.pin_last_changed')}: ${fmtDate(user.pin_set_at)}` : '—';
  document.querySelector('#info-created-at').textContent = fmtDate(user.created_at);
  document.querySelector('#info-last-login').textContent = fmtDate(user.last_login);
  // For owners, "в организации с" shows org creation date; for others, last update.
  document.querySelector('#info-joined').textContent = isOwner ? fmtDate(ownerOrgCreatedAt) : fmtDate(user.updated_at);
}
