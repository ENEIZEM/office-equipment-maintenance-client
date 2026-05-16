/* ═══════════════════════════════════════════════════════════════
   Change-PIN modal (#change-pin-modal) — three 6-digit groups.

   • Current PIN group is hidden when the user doesn't have a PIN
     yet (first-time set) — the form-guard treats a hidden group as
     "passed" so the save button can light up with just new+confirm.
   ═══════════════════════════════════════════════════════════════ */

import { auth }                   from '../../../api.js';
import { toast, errorMessage }    from '../../../auth.js';
import { t, getLang }             from '../../../i18n.js';
import { wireFormGuard }          from '../../../form-guard.js';
import {
  openModal, closeModal, setLoading,
  showAlertText, hideAlertById,
} from '../ui-helpers.js';

let _ctx = {
  getUserProfile: () => null,
  refresh:        () => {},
};

let _guard = null;
let _curInputs = [];
let _newInputs = [];
let _cfmInputs = [];

function wirePinGroup(rootSel) {
  const inputs = [...document.querySelectorAll(`${rootSel} .pin-input`)];
  inputs.forEach((input, idx) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/, '').slice(0, 1);
      input.classList.toggle('filled', !!input.value);
      if (input.value && idx < inputs.length - 1) inputs[idx + 1].focus();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        inputs[idx - 1].focus();
        inputs[idx - 1].value = '';
        inputs[idx - 1].classList.remove('filled');
      }
    });
    input.addEventListener('paste', (e) => {
      const raw = (e.clipboardData || window.clipboardData)
        .getData('text').replace(/\D/g, '').slice(0, inputs.length);
      if (!raw) return;
      e.preventDefault();
      [...raw].forEach((ch, i) => { if (inputs[i]) { inputs[i].value = ch; inputs[i].classList.add('filled'); } });
      inputs[Math.min(raw.length, inputs.length) - 1]?.focus();
    });
  });
  return inputs;
}

function readDigits(inputs)  { return inputs.map(i => i.value).join(''); }
function clearDigits(inputs) { inputs.forEach(i => { i.value = ''; i.classList.remove('filled'); }); }

export function wireChangePin(ctx) {
  Object.assign(_ctx, ctx);

  _curInputs = wirePinGroup('#chpin-current');
  _newInputs = wirePinGroup('#chpin-new');
  _cfmInputs = wirePinGroup('#chpin-confirm');

  _guard = wireFormGuard({
    button:   '#btn-save-pin',
    required: [{
      kind:  'fn',
      watch: ['#chpin-current .pin-input', '#chpin-new .pin-input', '#chpin-confirm .pin-input'],
      fn: () => {
        const join = (sel) =>
          [...document.querySelectorAll(`${sel} .pin-input`)].map(i => i.value).join('');
        const newOk     = join('#chpin-new')     .length === 6;
        const confirmOk = join('#chpin-confirm') .length === 6;
        // Current PIN group may be hidden (user has no PIN yet) — skip in that case.
        const currentGroup = document.getElementById('chpin-current-group');
        const currentHidden = !currentGroup || currentGroup.offsetParent === null;
        const currentOk = currentHidden ? true : join('#chpin-current').length === 6;
        return newOk && confirmOk && currentOk;
      },
    }],
  });

  document.querySelector('#btn-open-change-pin')?.addEventListener('click', () => {
    // If user doesn't yet have a PIN, hide the "current PIN" group entirely.
    const hasPin = !!_ctx.getUserProfile()?.has_pin;
    document.querySelector('#chpin-current-group')?.style.setProperty('display', hasPin ? '' : 'none');
    [_curInputs, _newInputs, _cfmInputs].forEach(clearDigits);
    hideAlertById('err-chpin');
    openModal('change-pin-modal');
    (hasPin ? _curInputs[0] : _newInputs[0])?.focus();
    // Modal just rendered — recompute gray-look (hidden current-group, empty digits)
    _guard?.refresh();
  });

  document.querySelector('#btn-save-pin')?.addEventListener('click', async () => {
    hideAlertById('err-chpin');
    const hasPin = !!_ctx.getUserProfile()?.has_pin;
    const current = hasPin ? readDigits(_curInputs) : null;
    const fresh   = readDigits(_newInputs);
    const confirm = readDigits(_cfmInputs);

    if (hasPin && current.length !== 6) {
      return showAlertText('err-chpin', 'err-chpin-text', t('errors.required'));
    }
    if (fresh.length !== 6) {
      return showAlertText('err-chpin', 'err-chpin-text', t('errors.pin_length'));
    }
    if (fresh !== confirm) {
      return showAlertText('err-chpin', 'err-chpin-text', t('errors.validation.pin_mismatch') || 'PIN codes do not match');
    }

    const btn = document.querySelector('#btn-save-pin');
    setLoading(btn, true);
    try {
      const payload = { pin: fresh, pin_confirm: confirm };
      if (current) payload.current_pin = current;
      await auth.setPin(payload);
      toast(getLang() === 'en' ? 'PIN updated' : 'PIN изменён', 'ok');
      closeModal('change-pin-modal');
      _ctx.refresh();
    } catch (err) {
      showAlertText('err-chpin', 'err-chpin-text', errorMessage(err));
    } finally {
      setLoading(btn, false);
    }
  });
}
