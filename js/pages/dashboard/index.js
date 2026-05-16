/* ═══════════════════════════════════════════════════════════════
   REMS — Dashboard page logic
   Tabs: overview, requests, equipment, notifications, members, org, profile
   ═══════════════════════════════════════════════════════════════ */

import { auth, profile, org, members } from '../../api.js';
import { requireAuth, logout, toast, errorMessage }    from '../../auth.js';
import { t, initI18n, getLang, onLangChange }          from '../../i18n.js';
import { connectSocket, on as socketOn }               from '../../socket.js';
import { wireFormGuard }                               from '../../form-guard.js';
import { wireMediaAttach }                             from '../../media-attach.js';
import {
  statusBadge,
  orgStatusBadge,
  orgTypeBadge,
  roleBadgeDescriptor,
  renderIconBadge,
  renderRowChip,
} from './badges.js';
import { loadSessions } from './sessions.js';
import {
  loadNotifications,
  loadNotificationCount,
  addNotification,
  rerender as rerenderNotifications,
} from './notifications.js';
import {
  openModal,
  closeModal,
  setLoading,
  setFieldError,
  clearFieldErrorById,
  showAlertText,
  hideAlertById,
} from './ui-helpers.js';
import { wireFieldEdit }      from './modals/field-edit.js';
import { wireChangePassword } from './modals/change-password.js';
import { wireChangePin }      from './modals/change-pin.js';
import { wireChangeContact,  openChangeContact  } from './modals/change-contact.js';
import { wireDetachContact,  openDetachContact  } from './modals/detach-contact.js';
import { fmtDate, setAvatar, initials, roleLabel } from './format.js';
import { renderProfileTab }     from './tabs/profile.js';
import { populateOrgTab }       from './tabs/organization.js';

// ── Init ──────────────────────────────────────────────────────────
await initI18n();
if (!requireAuth()) throw new Error('not logged in');

// ─────────────────────────────────────────────────────────────────
// TAB NAVIGATION
// ─────────────────────────────────────────────────────────────────
const TAB_IDS = ['overview', 'requests', 'equipment', 'notifications', 'members', 'org', 'profile'];
let currentTab = 'overview';

function switchTab(name, { updateHash = true } = {}) {
  if (!TAB_IDS.includes(name)) return;
  currentTab = name;
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  TAB_IDS.forEach(id => {
    document.getElementById(`tab-${id}`)?.classList.toggle('active', id === name);
  });
  // Sync URL hash so a hard-reload or shared link reopens the same tab.
  // We do this with replaceState to avoid polluting browser history with
  // every sidebar click.
  if (updateHash) {
    try {
      const nextHash = '#' + name;
      if (location.hash !== nextHash) {
        history.replaceState(null, '', location.pathname + location.search + nextHash);
      }
    } catch {}
  }
  if (name === 'notifications') loadNotifications();
  if (name === 'members')       loadMembers();
  if (name === 'org')           loadOrgProfile();
  if (name === 'profile')       loadSessions();    // refresh session list each open
}

document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
document.querySelectorAll('[data-tab-trigger]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tabTrigger));
});

// Open the tab matching #hash on initial load (e.g. landing-header
// "Профиль" link → /pages/dashboard.html#profile) AND on hashchange
// (e.g. user presses Back).
function applyHashTab() {
  const tab = (location.hash || '').replace(/^#/, '');
  if (TAB_IDS.includes(tab)) switchTab(tab, { updateHash: false });
}
window.addEventListener('hashchange', applyHashTab);
// "settings" is currently mapped to the same panel as "profile" — keep it
// here so the landing-header dropdown link works.
if (location.hash === '#settings') switchTab('profile', { updateHash: false });
else applyHashTab();

// ─────────────────────────────────────────────────────────────────
// USER DROPDOWN — opens on hover (with a small close-delay so a slow
// mouse-glide from the avatar to a menu item doesn't drop the panel).
// Click still toggles for touch devices and keyboard users.
// ─────────────────────────────────────────────────────────────────
const userDropdown = q('#user-dropdown');
const userMenuWrap = q('.user-menu-wrap');
let _ddCloseTimer = null;

function openDD()  { if (_ddCloseTimer) { clearTimeout(_ddCloseTimer); _ddCloseTimer = null; } userDropdown?.classList.remove('hidden'); }
function closeDD() { userDropdown?.classList.add('hidden'); }
function deferCloseDD() {
  if (_ddCloseTimer) clearTimeout(_ddCloseTimer);
  _ddCloseTimer = setTimeout(closeDD, 120);
}

userMenuWrap?.addEventListener('mouseenter', openDD);
userMenuWrap?.addEventListener('mouseleave', deferCloseDD);

q('#btn-user-menu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  userDropdown?.classList.toggle('hidden');
});
// Tap outside the wrap collapses the menu (touch fallback).
document.addEventListener('click', (e) => {
  if (userMenuWrap && !userMenuWrap.contains(e.target)) closeDD();
});

q('#dd-profile')?.addEventListener('click',  () => { closeDD(); switchTab('profile'); });
// Org row inside the dropdown → switch to the org tab. Only meaningful for
// approved members (otherwise the tab is hidden and switchTab() no-ops).
q('#dd-org-link')?.addEventListener('click', () => { closeDD(); switchTab('org'); });
q('#btn-logout')?.addEventListener('click',  () => logout());

// ─────────────────────────────────────────────────────────────────
// SIDEBAR MOBILE TOGGLE
// ─────────────────────────────────────────────────────────────────
const sidebar = q('#sidebar');
const sidebarToggle = q('#sidebar-toggle');

function checkMobile() {
  const isMobile = window.innerWidth <= 768;
  if (sidebarToggle) sidebarToggle.style.display = isMobile ? '' : 'none';
}
checkMobile();
window.addEventListener('resize', checkMobile);

sidebarToggle?.addEventListener('click', () => sidebar?.classList.toggle('open'));
document.addEventListener('click', (e) => {
  if (sidebar?.classList.contains('open') && !sidebar.contains(e.target) && e.target !== sidebarToggle) {
    sidebar.classList.remove('open');
  }
});

// ─────────────────────────────────────────────────────────────────
// NOTIFICATIONS BUTTON
// ─────────────────────────────────────────────────────────────────
q('#btn-notifications')?.addEventListener('click', () => switchTab('notifications'));

// ─────────────────────────────────────────────────────────────────
// MODAL HELPERS — primitives live in ./dashboard/ui-helpers.js.
// What remains here is the page-wide [data-close-modal] delegation.
// ─────────────────────────────────────────────────────────────────
document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
});
// Backdrop click does NOT close the modal. Every modal has explicit
// Cancel / Back / × buttons — accidental outside-clicks would otherwise
// wipe whatever the user had typed.

// ─────────────────────────────────────────────────────────────────
// LOAD USER PROFILE
// ─────────────────────────────────────────────────────────────────
let _userProfile = null;
// Verified contacts the user can prove ownership of for step-up auth
// (change password / change contact). Populated by loadProfile().
let _availableContacts = [];

let _userPermissions = {};
let _orgData         = null;

async function loadProfile() {
  try {
    const resp  = await profile.get();
    const user  = resp.data?.user         ?? resp.data;
    const org   = resp.data?.organization ?? null;
    const perms = resp.data?.permissions  ?? {};
    _userProfile        = user;
    _userPermissions    = perms;
    _orgData            = org;
    _availableContacts  = Array.isArray(resp.data?.available_contacts)
      ? resp.data.available_contacts
      : [];

    const role     = user.org_role || user.role;
    const isOwner  = role === 'owner';
    const canEditOrg = !!perms.can_edit_organization;
    const canEditLim = !!perms.can_edit_limits;
    const hasOrg     = !!org && user.membership_status === 'approved';

    // ── Navbar mini-avatar + dropdown identity block ───────────
    setAvatar(q('#nav-avatar-initials'), q('#nav-avatar-img'), user);
    q('#dd-name').textContent  = user.full_name || '—';
    q('#dd-email').textContent = user.email_masked || user.phone_masked || '—';

    // Org row in the dropdown: name + role-or-status pill, clickable → #org.
    // Approved members get the role pill (gold/teal/etc.). Pending/rejected/
    // suspended/no-org users get the status pill so they understand WHY the
    // dashboard might be limited.
    const ddOrgEl  = q('#dd-org');
    const ddPillEl = q('#dd-pill');
    if (ddOrgEl)  ddOrgEl.textContent = org?.name || '—';
    if (ddPillEl) {
      if (hasOrg && role) {
        renderRowChip(ddPillEl, roleBadgeDescriptor(role));
      } else {
        renderRowChip(ddPillEl, statusBadge(user.membership_status));
      }
    }
    // Hide the org link entirely when there is no org row to navigate to.
    const ddOrgLink = q('#dd-org-link');
    if (ddOrgLink) ddOrgLink.style.display = hasOrg ? '' : 'none';

    updateWelcome(user);

    // ── Profile tab (identity strip + 2 cards) ─────────────────
    renderProfileTab(user, role, isOwner, org?.created_at);

    // ── ORG TAB visibility — only when approved member of an org ──
    const navItemOrg = q('#nav-item-org');
    if (navItemOrg) navItemOrg.style.display = hasOrg ? '' : 'none';
    if (!hasOrg && currentTab === 'org') switchTab('profile', { updateHash: true });

    // Sidebar Organization section (Members + Your-Org) — appears if
    // user is at least an approved member; specific items inside have
    // their own permission filters.
    const canManage = ['owner', 'manager'].includes(role);
    q('#org-nav-section').style.display = hasOrg ? '' : 'none';
    q('#nav-item-members').style.display = (hasOrg && canManage) ? '' : 'none';
    q('#no-org-notice')?.classList.toggle('hidden', hasOrg);

    // ── Populate the «Ваша организация» tab ────────────────────
    if (hasOrg && org) populateOrgTab(org, role, canEditOrg, canEditLim);

    // ── Tooltip text injection (CSS reads data-tooltip-text) ───
    document.querySelectorAll('[data-tooltip-key]').forEach(el => {
      el.setAttribute('data-tooltip-text', t(el.dataset.tooltipKey));
    });

    loadNotificationCount();

  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

function updateWelcome(user) {
  const lang  = getLang();
  const first = (user?.full_name || '').split(' ')[0] || (lang === 'en' ? 'there' : '');
  const greeting = lang === 'en'
    ? `Welcome, ${first}!`
    : `Добро пожаловать, ${first}!`;
  const el = q('#welcome-title');
  if (el) el.textContent = greeting;
}

// ─────────────────────────────────────────────────────────────────
// AVATAR UPLOAD — uses the shared media-attach controller (see
// frontend/js/media-attach.js). Same preview/confirm flow used by
// the org logo, so both widgets share the modal styling and the
// pick → preview → confirm pipeline.
// ─────────────────────────────────────────────────────────────────
wireMediaAttach({
  input:       '#avatar-input',
  trigger:     '#btn-change-avatar',
  entityType:  'user',
  confirm:     (mediaFileId) => profile.confirmAvatar(mediaFileId),
  onSuccess:   () => {
    toast(getLang() === 'en' ? 'Avatar updated' : 'Фото обновлено', 'ok');
    loadProfile();
  },
  titleKey: 'profile.media_avatar_title',
  hintKey:  'profile.media_avatar_hint',
  cropPreview: 'circle',         // avatar is rendered as a circle
  t, toast, errorMessage,
});

// ─────────────────────────────────────────────────────────────────
// CHANGE PASSWORD — owned by ./dashboard/modals/change-password.js.
// Wired via wireChangePassword() at boot (see bottom of this file).
// ─────────────────────────────────────────────────────────────────
// Generic show/hide password toggle. Any [data-toggle-pw="<input id>"]
// button flips the target input between type=password and type=text and
// swaps the eye icon. Page-wide — used by change-password, detach-contact,
// and any other form that mounts a password input.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle-pw]');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.togglePw);
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  const icon = btn.querySelector('i');
  if (icon) icon.className = showing ? 'ph ph-eye' : 'ph ph-eye-slash';
});

// ─────────────────────────────────────────────────────────────────
// MODAL WIRING — each modal owns its own state, form-guard, and DOM
// handlers; this file just passes in the live state getters.
// ─────────────────────────────────────────────────────────────────
wireFieldEdit({
  getUserProfile: () => _userProfile,
  getOrgData:     () => _orgData,
  refresh:        () => loadProfile(),
});

wireChangePassword({
  getAvailableContacts: () => _availableContacts,
  refresh:              () => loadProfile(),
});

wireChangePin({
  getUserProfile: () => _userProfile,
  refresh:        () => loadProfile(),
});

// "Upgrade subscription" — coming-soon toast
q('#btn-upgrade-sub')?.addEventListener('click', (e) => {
  e.preventDefault();
  toast(t('profile.upgrade_coming_soon'), 'info');
});
// "Link Telegram" — coming-soon toast
q('#btn-link-telegram')?.addEventListener('click', (e) => {
  e.preventDefault();
  toast(t('profile.telegram_coming_soon'), 'info');
});
// Email / Phone change/link buttons → open the 3-step contact-change wizard.
q('#btn-edit-email')?.addEventListener('click', () => openChangeContact('email'));
q('#btn-edit-phone')?.addEventListener('click', () => openChangeContact('phone'));

wireChangeContact({
  getUserProfile:       () => _userProfile,
  getAvailableContacts: () => _availableContacts,
  refresh:              () => loadProfile(),
  openDetach:           openDetachContact,
});
wireDetachContact({
  refresh:           () => loadProfile(),
  openChangeContact,
});

// ─────────────────────────────────────────────────────────────────
// ORG PROFILE — populated by populateOrgTab() inside loadProfile();
// switchTab('org') just re-fetches /api/profile/me which carries the
// org payload already.
// ─────────────────────────────────────────────────────────────────
async function loadOrgProfile() {
  // Refresh to pick up any pending changes (e.g. someone else just
  // updated the org name) without leaving the user on stale data.
  await loadProfile();
}

// (legacy #btn-edit-org + #btn-save-org-name handlers removed —
//  org-name edits now go through the generic #field-edit-modal)

// Org logo — wired via the shared media-attach controller. Permission to
// trigger (clicking the wrap) is gated elsewhere by .editable on the
// wrapping element; the wireMediaAttach trigger here just hands the click
// through to the <input>.
wireMediaAttach({
  input:       '#org-logo-input',
  trigger:     '#org-logo-wrap.editable',
  entityType:  'organization',
  confirm:     (mediaFileId) => org.confirmLogo(mediaFileId),
  onSuccess:   () => {
    toast(getLang() === 'en' ? 'Logo updated' : 'Логотип обновлён', 'ok');
    loadOrgProfile();
  },
  titleKey: 'profile.media_logo_title',
  hintKey:  'profile.media_logo_hint',
  cropPreview: 'square',         // org logo is rendered as a square tile
  t, toast, errorMessage,
});

// ─────────────────────────────────────────────────────────────────
// MEMBERS
// ─────────────────────────────────────────────────────────────────
async function loadMembers() {
  try {
    const data = await members.listPending();
    const list = data.data || [];
    const section = q('#pending-section');
    const el      = q('#pending-list');
    if (!list.length) { if (section) section.style.display = 'none'; return; }
    if (section) section.style.display = '';
    if (!el) return;
    el.innerHTML = list.map(m => `
      <div class="notification-item" style="padding:.75rem 1rem; border-bottom:1px solid var(--clr-border);">
        <div class="avatar avatar-sm">${initials(m.full_name || m.contact || '?')}</div>
        <div class="notification-content">
          <p class="notification-text" style="font-weight:500;">${escapeHTML(m.full_name || m.contact || '—')}</p>
          <p class="notification-time">${roleLabel(m.requested_role)}</p>
        </div>
        <div style="display:flex;gap:.5rem;flex-shrink:0;">
          <button class="btn btn-secondary btn-sm btn-approve" data-id="${m.user_id}">${t('members.approve')}</button>
          <button class="btn btn-danger btn-sm btn-reject"     data-id="${m.user_id}">${t('members.reject')}</button>
        </div>
      </div>`).join('');

    el.querySelectorAll('.btn-approve').forEach(btn => btn.addEventListener('click', () => manageMember(btn.dataset.id, 'approved')));
    el.querySelectorAll('.btn-reject').forEach(btn  => btn.addEventListener('click', () => manageMember(btn.dataset.id, 'rejected')));
  } catch (_) {}
}

async function manageMember(userId, action) {
  try {
    await members.manage(userId, action);
    const msg = getLang() === 'en'
      ? (action === 'approved' ? 'Approved' : 'Rejected')
      : (action === 'approved' ? 'Одобрено' : 'Отклонено');
    toast(msg, 'ok');
    loadMembers();
  } catch (err) { toast(errorMessage(err), 'error'); }
}

q('#btn-invite')?.addEventListener('click', () => openModal('invite-modal'));

q('#btn-invite-confirm')?.addEventListener('click', async () => {
  const contact = q('#invite-contact')?.value.trim();
  const role    = q('#invite-role')?.value;

  q('#err-invite-contact')?.classList.remove('show');
  q('#err-invite-role')?.classList.remove('show');
  q('#err-invite')?.classList.add('hidden');

  let valid = true;
  if (!contact) { setFieldError('err-invite-contact', t('errors.required')); valid = false; }
  if (!role)    { setFieldError('err-invite-role',    t('errors.select_role')); valid = false; }
  if (!valid) return;

  const btn = q('#btn-invite-confirm');
  setLoading(btn, true);
  try {
    await members.invite(contact, role);
    closeModal('invite-modal');
    toast(getLang() === 'en' ? 'Invitation sent' : 'Приглашение отправлено', 'ok');
    if (q('#invite-contact')) q('#invite-contact').value = '';
    if (q('#invite-role'))    q('#invite-role').value    = '';
  } catch (err) {
    const errEl = q('#err-invite');
    if (errEl)  { errEl.classList.remove('hidden'); errEl.classList.add('show'); }
    const txt = q('#err-invite-text');
    if (txt)    txt.textContent = errorMessage(err);
  } finally { setLoading(btn, false); }
});

// ─────────────────────────────────────────────────────────────────
// SOCKET
// ─────────────────────────────────────────────────────────────────
function initSocketConn() {
  try {
    const socket = connectSocket();
    if (!socket) return;

    socketOn('user:notification', (data) => {
      const notif = { ...data, id: data.id || Date.now(), created_at: new Date().toISOString(), read_at: null };
      addNotification(notif);
      toast(data.message_text || 'Новое уведомление', 'info');
    });

    socketOn('org:notification', (data) => {
      const notif = { ...data, id: data.id || Date.now(), created_at: new Date().toISOString(), read_at: null };
      addNotification(notif);
    });
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────
// LANGUAGE CHANGE
// ─────────────────────────────────────────────────────────────────
// On language switch, applyTranslations() handles every static [data-i18n]
// element, but a lot of profile/org content is built dynamically by JS
// (dates, sub-lines like "до N шт./заявку", role/status chips, sessions,
// etc.) — those don't carry a data-i18n by themselves. The cleanest way
// to keep everything in sync is to re-run the same render that initially
// populated the tabs. loadProfile() is idempotent and uses cached data
// at the network layer.
//
// Previously this callback also did `textContent = roleLabel(...)` on
// #info-role and #profile-role-badge — that destroyed the chip's icon +
// inner translatable <span>, leaving plain text behind. Removed.
onLangChange(() => {
  if (_userProfile) loadProfile().catch(() => {});
  // Sessions render their own labels ("session_current", date formats,
  // OS strings) inside loadSessions(); re-run it so the language switch
  // takes effect immediately on the open Profile tab.
  if (currentTab === 'profile') loadSessions().catch(() => {});
  rerenderNotifications();
});

// ─────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────
loadProfile();
initSocketConn();

// ─────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────
function q(sel) { return document.querySelector(sel); }

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

