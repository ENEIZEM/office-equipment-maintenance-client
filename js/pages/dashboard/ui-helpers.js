/* ═══════════════════════════════════════════════════════════════
   UI primitives shared by every dashboard modal.
   Tiny, dependency-free DOM helpers — kept in one place so the
   modal modules don't each carry their own copy.
   ═══════════════════════════════════════════════════════════════ */

export function openModal(id)  { document.querySelector(`#${id}`)?.classList.add('open'); }
export function closeModal(id) { document.querySelector(`#${id}`)?.classList.remove('open'); }

export function setLoading(btn, on) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('btn-loading', on);
}

export function setFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  const span = el.querySelector('span');
  if (span) span.textContent = msg;
  el.classList.add('show');
}

export function clearFieldErrorById(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('show');
  const span = el.querySelector('span');
  if (span) span.textContent = '';
}

export function showAlertText(alertId, textId, msg) {
  const a = document.getElementById(alertId);
  if (!a) return;
  a.classList.add('show');
  a.classList.remove('hidden');
  const t = document.getElementById(textId);
  if (t) t.textContent = msg;
}

export function hideAlertById(id) {
  const a = document.getElementById(id);
  if (!a) return;
  a.classList.remove('show');
  a.classList.add('hidden');
}
