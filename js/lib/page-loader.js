/* ═══════════════════════════════════════════════════════════════
   REMS — Full-page loader (cross-navigation bridge)
   ───────────────────────────────────────────────────────────────
   Companion to `lazy-loader.js`. Two scopes:

     · lazy-loader.js  — wraps one async op inside a single page.
                         showAfter: 500 ms, no min-visible floor.

     · page-loader.js  — bridges a NAVIGATION (e.g. landing → dashboard).
                         The trigger (user gesture) is on PAGE A; the
                         "render started" signal is on PAGE B. We can't
                         use a single in-process timer.

   Timing model (revised — see CHANGES.md "loader timings v2"):

     · The landing CTA click SCHEDULES `showPageLoader()` for 500 ms
       later via setTimeout. If the browser has already swapped to the
       new page before that, the timer is gone with the unloaded page
       and the loader never appears (fast nav → invisible).

     · The destination page (dashboard.html) has an inline pre-paint
       overlay element so that IF the timer DID fire on landing, the
       blur+spinner stays visible across the document swap without a
       flicker.

     · The destination page's first JS hit calls `hidePageLoader()`
       immediately. That's our "page has started to render" signal —
       per the new spec, the moment ANY content is visible we drop
       the spinner, even if data is still loading (the in-page
       attachLoader will handle the data-fetch feedback separately).

   The result:
     · Quick navigation (<500 ms): no spinner.
     · Slow navigation: spinner appears around 500 ms after click,
       disappears the instant dashboard JS boots.
   ═══════════════════════════════════════════════════════════════ */

const SHOW_AFTER = 500;

/**
 * Build (or reuse) the overlay element on the current document. Pure
 * helper — does not schedule anything. Safe to call multiple times.
 */
function ensureOverlay() {
  let el = document.getElementById('initial-page-loader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'initial-page-loader';
    el.className = 'loader-overlay loader-overlay--fixed';
    el.innerHTML = '<span class="spinner spinner-lg" aria-label="Loading"></span>';
    document.body.appendChild(el);
  } else {
    el.classList.remove('loader-overlay--fade');
    el.style.opacity = '';
  }
  return el;
}

/**
 * Schedule the overlay to appear `SHOW_AFTER` ms from now — IF the
 * page hasn't navigated away by then. Used on the LANDING side, right
 * before a slow navigation. Subsequent calls in the same page life
 * cycle don't queue extra timers (idempotent within a session).
 *
 * The returned function cancels the pending show if called before the
 * timer fires. Useful for click handlers that abort the navigation
 * (e.g., a "are you sure?" dialog), but the common case ignores it.
 */
export function scheduleNavLoader() {
  // Avoid double-scheduling within one click sequence.
  if (window.__remsLoaderTimer) return () => {};
  window.__remsLoaderTimer = setTimeout(() => {
    ensureOverlay();
    window.__remsLoaderTimer = null;
  }, SHOW_AFTER);
  return function cancel() {
    if (window.__remsLoaderTimer) {
      clearTimeout(window.__remsLoaderTimer);
      window.__remsLoaderTimer = null;
    }
  };
}

/**
 * Show the overlay IMMEDIATELY. Rarely used on its own — most callers
 * want `scheduleNavLoader()`. Kept for explicit "show no matter what"
 * cases.
 */
export function showPageLoader() {
  ensureOverlay();
}

/**
 * Tear the overlay down. No min-visible floor (per the revised spec):
 * the moment the destination page's JS gets here, we're "rendering" —
 * which is exactly when the user wants the spinner gone.
 *
 * The fade is purely cosmetic (200 ms opacity → 0) so the user sees
 * a smooth dissolve rather than an abrupt cut.
 */
export function hidePageLoader() {
  // Clear any still-pending schedule from THIS page (the landing-side
  // timer is on a different page life cycle; this just covers the
  // weird edge case where the same page both scheduled AND wants to
  // cancel without firing).
  if (window.__remsLoaderTimer) {
    clearTimeout(window.__remsLoaderTimer);
    window.__remsLoaderTimer = null;
  }
  const el = document.getElementById('initial-page-loader');
  if (!el) return;
  el.classList.add('loader-overlay--fade');
  setTimeout(() => el.remove(), 200);
}
