/* ═══════════════════════════════════════════════════════════════
   Detach-contact modal (#detach-contact-modal).

   Single-step proof: type the full contact + the account password.
   Backend (POST /profile/detach-contact) refuses to detach the
   user's last verified contact. Sessions are NOT revoked — only
   password change triggers a system-wide logout.

   Reached from the "Открепить контакт" link inside the
   change-contact wizard. The "Назад" button hands back to it
   via openChangeContact(type) supplied by the wiring caller.
   ═══════════════════════════════════════════════════════════════ */

import { profile }                from '../../../api.js';
import { toast, errorMessage }    from '../../../auth.js';
import { t, getLang }             from '../../../i18n.js';
import {
  openModal, closeModal, setLoading,
  setFieldError, clearFieldErrorById,
  showAlertText, hideAlertById,
} from '../ui-helpers.js';

let _ctx = {
  refresh:            () => {},
  openChangeContact:  () => {},
};

let _type = null;

export function openDetachContact(type) {
  _type = type;
  hideAlertById('err-dtc');
  clearFieldErrorById('err-dtc-contact');
  clearFieldErrorById('err-dtc-password');
  const contact = document.querySelector('#dtc-contact');
  const pwd     = document.querySelector('#dtc-password');
  if (contact) contact.value = '';
  if (pwd)     pwd.value     = '';
  const titleKey = type === 'email' ? 'profile.detach_email' : 'profile.detach_phone';
  const titleEl = document.querySelector('#dtc-title');
  if (titleEl) {
    titleEl.setAttribute('data-i18n', titleKey);
    titleEl.textContent = t(titleKey);
  }
  closeModal('change-contact-modal');
  openModal('detach-contact-modal');
  setTimeout(() => document.querySelector('#dtc-contact')?.focus(), 80);
}

export function wireDetachContact(ctx) {
  Object.assign(_ctx, ctx);

  // "Назад" inside the detach modal — return to the change-contact wizard
  // (where the user originally clicked the trash link).
  document.querySelector('#btn-dtc-back')?.addEventListener('click', () => {
    closeModal('detach-contact-modal');
    if (_type) _ctx.openChangeContact(_type);
  });

  document.querySelector('#btn-dtc-submit')?.addEventListener('click', async () => {
    hideAlertById('err-dtc');
    clearFieldErrorById('err-dtc-contact');
    clearFieldErrorById('err-dtc-password');

    if (!_type) return;
    const contact = (document.querySelector('#dtc-contact')?.value || '').trim();
    const pwd     =  document.querySelector('#dtc-password')?.value || '';

    let valid = true;
    if (!contact) { setFieldError('err-dtc-contact',  t('errors.required')); valid = false; }
    if (!pwd)     { setFieldError('err-dtc-password', t('errors.required')); valid = false; }
    if (!valid) return;

    const btn = document.querySelector('#btn-dtc-submit');
    setLoading(btn, true);
    try {
      await profile.detachContact({
        target_type:     _type,
        current_contact: contact,
        password:        pwd,
      });
      closeModal('detach-contact-modal');
      toast(getLang() === 'en' ? 'Contact detached' : 'Контакт откреплён', 'ok');
      _ctx.refresh();
    } catch (err) {
      // Surface contact-mismatch errors against the contact field so the
      // user knows what to fix.
      if (err?.error_key === 'profile.change_contact_current_mismatch') {
        setFieldError('err-dtc-contact', errorMessage(err));
      } else if (err?.error_key === 'errors.auth.invalid_credentials') {
        setFieldError('err-dtc-password', errorMessage(err));
      } else {
        showAlertText('err-dtc', 'err-dtc-text', errorMessage(err));
      }
    } finally {
      setLoading(btn, false);
    }
  });
}
