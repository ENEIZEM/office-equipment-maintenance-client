/* ═══════════════════════════════════════════════════════════════
   REMS — Dashboard page logic
   Tabs: overview, requests, equipment, notifications, members, org, profile
   ═══════════════════════════════════════════════════════════════ */

import { profile, org, members, notifications, media } from '../api.js';
import { requireAuth, logout, toast, errorMessage }    from '../auth.js';
import { t, initI18n, getLang, onLangChange }          from '../i18n.js';
import { connectSocket, on as socketOn }               from '../socket.js';

// ── Init ──────────────────────────────────────────────────────────
await initI18n();
if (!requireAuth()) throw new Error('not logged in');

// ─────────────────────────────────────────────────────────────────
// TAB NAVIGATION
// ─────────────────────────────────────────────────────────────────
const TAB_IDS = ['overview', 'requests', 'equipment', 'notifications', 'members', 'org', 'profile'];
let currentTab = 'overview';

function switchTab(name) {
  if (!TAB_IDS.includes(name)) return;
  currentTab = name;
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === name);
  });
  TAB_IDS.forEach(id => {
    document.getElementById(`tab-${id}`)?.classList.toggle('active', id === name);
  });
  if (name === 'notifications') loadNotifications();
  if (name === 'members')       loadMembers();
  if (name === 'org')           loadOrgProfile();
}

document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});
document.querySelectorAll('[data-tab-trigger]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tabTrigger));
});

// ─────────────────────────────────────────────────────────────────
// USER DROPDOWN
// ─────────────────────────────────────────────────────────────────
const userDropdown = q('#user-dropdown');

q('#btn-user-menu')?.addEventListener('click', (e) => {
  e.stopPropagation();
  userDropdown?.classList.toggle('hidden');
});
document.addEventListener('click', () => userDropdown?.classList.add('hidden'));
q('#dd-profile')?.addEventListener('click',  () => { userDropdown?.classList.add('hidden'); switchTab('profile'); });
q('#dd-settings')?.addEventListener('click', () => { userDropdown?.classList.add('hidden'); switchTab('profile'); });
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
// MODAL HELPERS
// ─────────────────────────────────────────────────────────────────
function openModal(id)  { q(`#${id}`)?.classList.add('open'); }
function closeModal(id) { q(`#${id}`)?.classList.remove('open'); }

document.querySelectorAll('[data-close-modal]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
});
document.querySelectorAll('.modal-backdrop').forEach(bd => {
  bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('open'); });
});

// ─────────────────────────────────────────────────────────────────
// LOAD USER PROFILE
// ─────────────────────────────────────────────────────────────────
let _userProfile = null;

async function loadProfile() {
  try {
    const data = await profile.get();
    const user = data.data;
    _userProfile = user;

    // Nav avatar
    setAvatar(q('#nav-avatar-initials'), q('#nav-avatar-img'), user);
    q('#dd-name').textContent  = user.full_name || '—';
    q('#dd-email').textContent = user.email || user.phone || '—';

    // Dashboard welcome
    updateWelcome(user);

    // Profile tab
    setAvatar(q('#profile-initials'), q('#profile-avatar-img'), user);
    q('#profile-fullname').textContent  = user.full_name || '—';
    q('#profile-role-badge').textContent = roleLabel(user.role);
    q('#info-fullname').textContent     = user.full_name || '—';
    q('#info-email').textContent        = user.email     || '—';
    q('#info-phone').textContent        = user.phone     || '—';
    q('#info-dept').textContent         = user.department || '—';
    q('#info-role').textContent         = roleLabel(user.role);
    q('#info-lang').textContent         = user.language_code === 'en' ? 'English' : 'Русский';

    // Org sections
    const hasOrg   = !!user.organization_id;
    const canManage = ['owner', 'manager'].includes(user.role);
    q('#org-nav-section').style.display = (hasOrg && canManage) ? '' : 'none';
    q('#no-org-notice').classList.toggle('hidden', hasOrg);

    if (hasOrg) loadOrgProfile();
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

function setAvatar(initialsEl, imgEl, user) {
  if (!initialsEl) return;
  if (user?.avatar_url) {
    initialsEl.style.display = 'none';
    if (imgEl) { imgEl.src = user.avatar_url; imgEl.style.display = ''; }
  } else {
    initialsEl.textContent = initials(user?.full_name || user?.email || '?');
    if (imgEl) imgEl.style.display = 'none';
  }
}

function initials(name) {
  return String(name).split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

function roleLabel(role) {
  return t(`roles.${role}`) || role || '—';
}

// ─────────────────────────────────────────────────────────────────
// AVATAR UPLOAD
// ─────────────────────────────────────────────────────────────────
q('#avatar-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const up = await media.uploadTemp(file, 'user');
    await profile.confirmAvatar(up.data.media_file_id);
    toast(getLang() === 'en' ? 'Avatar updated' : 'Фото обновлено', 'ok');
    loadProfile();
  } catch (err) { toast(errorMessage(err), 'error'); }
  e.target.value = '';
});
q('#btn-change-avatar')?.addEventListener('click', () => q('#avatar-input')?.click());

// ─────────────────────────────────────────────────────────────────
// CHANGE PASSWORD
// ─────────────────────────────────────────────────────────────────
q('#btn-change-password')?.addEventListener('click', async () => {
  const oldPw  = q('#old-password').value;
  const newPw  = q('#new-password').value;
  const newPw2 = q('#new-password2').value;

  const errEl  = q('#err-chpw');
  const errTxt = q('#err-chpw-text');
  errEl?.classList.add('hidden');

  const setErr = (msg) => {
    if (errEl)  { errEl.classList.remove('hidden'); errEl.classList.add('show'); }
    if (errTxt) errTxt.textContent = msg;
  };

  if (!oldPw || !newPw || !newPw2) { setErr(t('errors.required')); return; }
  if (newPw !== newPw2)             { setErr(t('errors.password_mismatch')); return; }
  if (newPw.length < 8 || !/[A-Z]/.test(newPw) || !/[a-z]/.test(newPw) || !/\d/.test(newPw)) {
    setErr(t('errors.password_weak')); return;
  }

  const btn = q('#btn-change-password');
  setLoading(btn, true);
  try {
    await profile.changePassword({ old_password: oldPw, new_password: newPw, new_password_confirm: newPw2 });
    toast(getLang() === 'en' ? 'Password changed' : 'Пароль изменён', 'ok');
    ['#old-password', '#new-password', '#new-password2'].forEach(sel => { const el = q(sel); if (el) el.value = ''; });
  } catch (err) { setErr(errorMessage(err)); }
  finally { setLoading(btn, false); }
});

// ─────────────────────────────────────────────────────────────────
// ORG PROFILE
// ─────────────────────────────────────────────────────────────────
let _orgProfile = null;

async function loadOrgProfile() {
  try {
    const data = await org.getProfile();
    const o = data.data;
    _orgProfile = o;
    q('#org-name-val').textContent     = o.organization_name || '—';
    q('#org-id-val').textContent       = o.organization_id   || '—';
    q('#org-type-val').textContent     = o.occupation        || '—';
    q('#org-name-display').textContent = o.organization_name || '—';
    if (o.logo_url) {
      const av = q('#org-logo-avatar');
      if (av) av.innerHTML = `<img src="${o.logo_url}" alt="Logo" style="width:100%;height:100%;object-fit:cover;">`;
    }
  } catch (_) {}
}

q('#btn-edit-org')?.addEventListener('click', () => {
  if (q('#edit-org-name')) q('#edit-org-name').value = _orgProfile?.organization_name || '';
  openModal('edit-org-modal');
});

q('#btn-save-org-name')?.addEventListener('click', async () => {
  const name = q('#edit-org-name')?.value.trim();
  q('#err-edit-org')?.classList.remove('show');
  if (!name) { showFieldError('err-edit-org', t('errors.required')); return; }
  const btn = q('#btn-save-org-name');
  setLoading(btn, true);
  try {
    await org.updateSettings({ organization_name: name });
    closeModal('edit-org-modal');
    toast(getLang() === 'en' ? 'Saved' : 'Сохранено', 'ok');
    loadOrgProfile();
  } catch (err) { showFieldError('err-edit-org', errorMessage(err)); }
  finally { setLoading(btn, false); }
});

q('#org-logo-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const up = await media.uploadTemp(file, 'organization');
    await org.confirmLogo(up.data.media_file_id);
    toast(getLang() === 'en' ? 'Logo updated' : 'Логотип обновлён', 'ok');
    loadOrgProfile();
  } catch (err) { toast(errorMessage(err), 'error'); }
  e.target.value = '';
});

// ─────────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────
let _notifications = [];

async function loadNotificationCount() {
  try {
    const data = await notifications.getAll({ limit: 50 });
    const items = data.data || [];
    const unread = items.filter(n => !n.read_at).length;
    updateNotifBadge(unread);
  } catch (_) {}
}

async function loadNotifications() {
  try {
    const data = await notifications.getAll({ limit: 100 });
    _notifications = data.data || [];
    renderNotifications();
    renderOverviewNotifs();
    updateNotifBadge(_notifications.filter(n => !n.read_at).length);
  } catch (err) { toast(errorMessage(err), 'error'); }
}

function renderNotifications() {
  const list = q('#notif-list');
  if (!list) return;
  if (!_notifications.length) {
    list.innerHTML = `<div class="empty-state"><i class="ph ph-bell-slash"></i><p class="empty-state-text">${t('notifications.empty')}</p></div>`;
    return;
  }
  list.innerHTML = _notifications.map(notifItemHTML).join('');
  list.querySelectorAll('.notification-item').forEach((el, i) => {
    el.addEventListener('click', () => markNotifRead(_notifications[i]));
  });
}

function renderOverviewNotifs() {
  const el = q('#overview-notifs');
  if (!el) return;
  const recent = _notifications.slice(0, 5);
  if (!recent.length) {
    el.innerHTML = `<div class="empty-state" style="padding:2rem;"><i class="ph ph-bell-slash"></i><p class="empty-state-text">${t('notifications.empty')}</p></div>`;
    return;
  }
  el.innerHTML = recent.map(notifItemHTML).join('');
  el.querySelectorAll('.notification-item').forEach((el2, i) => {
    el2.addEventListener('click', () => markNotifRead(recent[i]));
  });
}

function notifItemHTML(n) {
  const unread = !n.read_at;
  const icon   = n.notification_type === 'success' ? 'ph-check-circle'
               : n.notification_type === 'warning' ? 'ph-warning'
               : n.notification_type === 'error'   ? 'ph-x-circle'
               : 'ph-info';
  const time   = formatRelativeTime(n.created_at);
  return `
    <div class="notification-item ${unread ? 'unread' : ''}" data-id="${n.id}">
      <div class="notification-icon"><i class="ph ${icon}"></i></div>
      <div class="notification-content">
        <p class="notification-text">${escapeHTML(n.message_text || '')}</p>
        <p class="notification-time">${time}</p>
      </div>
      ${unread ? '<div style="width:.5rem;height:.5rem;border-radius:50%;background:var(--clr-accent);flex-shrink:0;margin-top:.3rem;"></div>' : ''}
    </div>`;
}

async function markNotifRead(notif) {
  if (notif.read_at) return;
  try {
    await notifications.markRead(notif.id);
    notif.read_at = new Date().toISOString();
    renderNotifications();
    renderOverviewNotifs();
    updateNotifBadge(_notifications.filter(n => !n.read_at).length);
  } catch (_) {}
}

q('#btn-mark-all-read')?.addEventListener('click', async () => {
  const unread = _notifications.filter(n => !n.read_at);
  if (!unread.length) return;
  try {
    await notifications.markAllRead(unread.map(n => n.id));
    _notifications.forEach(n => { if (!n.read_at) n.read_at = new Date().toISOString(); });
    renderNotifications();
    renderOverviewNotifs();
    updateNotifBadge(0);
    toast(getLang() === 'en' ? 'All marked as read' : 'Все прочитаны', 'ok');
  } catch (err) { toast(errorMessage(err), 'error'); }
});

function updateNotifBadge(count) {
  const dot   = q('#notif-dot');
  const badge = q('#notif-badge');
  if (dot)   dot.style.display  = count > 0 ? '' : 'none';
  if (badge) {
    badge.textContent = count > 0 ? String(count) : '';
    badge.classList.toggle('hidden', count === 0);
  }
}

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
  if (!contact) { showFieldError('err-invite-contact', t('errors.required')); valid = false; }
  if (!role)    { showFieldError('err-invite-role',    t('errors.select_role')); valid = false; }
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
      _notifications.unshift(notif);
      renderOverviewNotifs();
      if (currentTab === 'notifications') renderNotifications();
      updateNotifBadge(_notifications.filter(n => !n.read_at).length);
      toast(data.message_text || 'Новое уведомление', 'info');
    });

    socketOn('org:notification', (data) => {
      const notif = { ...data, id: data.id || Date.now(), created_at: new Date().toISOString(), read_at: null };
      _notifications.unshift(notif);
      renderOverviewNotifs();
      if (currentTab === 'notifications') renderNotifications();
      updateNotifBadge(_notifications.filter(n => !n.read_at).length);
    });
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────
// LANGUAGE CHANGE
// ─────────────────────────────────────────────────────────────────
onLangChange(() => {
  if (_userProfile) {
    updateWelcome(_userProfile);
    q('#profile-role-badge').textContent = roleLabel(_userProfile.role);
    q('#info-role').textContent          = roleLabel(_userProfile.role);
    q('#info-lang').textContent          = _userProfile.language_code === 'en' ? 'English' : 'Русский';
  }
  if (_notifications.length) {
    renderNotifications();
    renderOverviewNotifs();
  }
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

function setLoading(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('btn-loading', on);
}

function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  const span = el.querySelector('span');
  if (span) span.textContent = msg;
  el.classList.add('show');
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  const diff  = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  const lang  = getLang();
  if (mins < 1)   return lang === 'en' ? 'just now'     : 'только что';
  if (mins < 60)  return lang === 'en' ? `${mins}m ago`  : `${mins} мин. назад`;
  if (hours < 24) return lang === 'en' ? `${hours}h ago` : `${hours} ч. назад`;
  if (days < 7)   return lang === 'en' ? `${days}d ago`  : `${days} д. назад`;
  return new Date(isoStr).toLocaleDateString(lang === 'en' ? 'en-US' : 'ru-RU');
}
