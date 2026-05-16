/* ═══════════════════════════════════════════════════════════════
   Notifications module — owns the full notifications array plus
   every render path (full list + overview preview + navbar dot
   and badge count). The dashboard wires socket events into
   `addNotification()`; the language-switch handler calls
   `rerender()`. Everything else stays internal.
   ═══════════════════════════════════════════════════════════════ */

import { notifications as notifsApi } from '../../api.js';
import { toast, errorMessage }        from '../../auth.js';
import { t, getLang }                 from '../../i18n.js';

let _notifications = [];

export async function loadNotificationCount() {
  try {
    const data = await notifsApi.getAll({ limit: 50 });
    const items = data.data || [];
    const unread = items.filter(n => !n.read_at).length;
    updateNotifBadge(unread);
  } catch (_) {}
}

export async function loadNotifications() {
  try {
    const data = await notifsApi.getAll({ limit: 100 });
    _notifications = data.data || [];
    renderNotifications();
    renderOverviewNotifs();
    updateNotifBadge(_notifications.filter(n => !n.read_at).length);
  } catch (err) { toast(errorMessage(err), 'error'); }
}

// Called by socket handlers in dashboard.js when a new notification
// is pushed from the server. Re-renders both views and updates the
// badge — the caller is responsible for any toast.
export function addNotification(notif) {
  _notifications.unshift(notif);
  renderOverviewNotifs();
  renderNotifications();
  updateNotifBadge(_notifications.filter(n => !n.read_at).length);
}

// Called from onLangChange — date formats, status labels and the
// "empty" caption are language-dependent so we must re-render.
export function rerender() {
  if (!_notifications.length) return;
  renderNotifications();
  renderOverviewNotifs();
}

function renderNotifications() {
  const list = document.querySelector('#notif-list');
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
  const el = document.querySelector('#overview-notifs');
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
    await notifsApi.markRead(notif.id);
    notif.read_at = new Date().toISOString();
    renderNotifications();
    renderOverviewNotifs();
    updateNotifBadge(_notifications.filter(n => !n.read_at).length);
  } catch (_) {}
}

function updateNotifBadge(count) {
  const dot   = document.querySelector('#notif-dot');
  const badge = document.querySelector('#notif-badge');
  if (dot)   dot.style.display  = count > 0 ? '' : 'none';
  if (badge) {
    badge.textContent = count > 0 ? String(count) : '';
    badge.classList.toggle('hidden', count === 0);
  }
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

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Wire the "Mark all as read" button — owned by this module since it
// mutates _notifications directly.
document.querySelector('#btn-mark-all-read')?.addEventListener('click', async () => {
  const unread = _notifications.filter(n => !n.read_at);
  if (!unread.length) return;
  try {
    await notifsApi.markAllRead(unread.map(n => n.id));
    _notifications.forEach(n => { if (!n.read_at) n.read_at = new Date().toISOString(); });
    renderNotifications();
    renderOverviewNotifs();
    updateNotifBadge(0);
    toast(getLang() === 'en' ? 'All marked as read' : 'Все прочитаны', 'ok');
  } catch (err) { toast(errorMessage(err), 'error'); }
});
