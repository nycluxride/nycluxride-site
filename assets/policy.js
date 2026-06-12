/*
 * NYC LUX RIDE — single source of truth for shared policy wording.
 *
 * The cancellation text below is read by BOTH the FAQ accordion (rendered by
 * app.6xvjthKL.js) and the static /card-authorization page, so the two can
 * never drift apart. Edit the wording HERE only.
 *
 * This file is loaded (classic, non-deferred) BEFORE the app bundle on every
 * page, so window.NLR_POLICY is defined before the bundle evaluates its FAQ
 * data. The card-authorization page also injects it into any element marked
 * data-policy="cancellation" on DOMContentLoaded.
 *
 * TODO (owner): replace with the firmer final policy when provided — specific
 * cancellation fees (e.g. a percentage charged within 24h), pet policy, and
 * cleanup/soiling fees. Update this one string and both pages follow.
 */
window.NLR_POLICY = window.NLR_POLICY || {};
window.NLR_POLICY.cancellation =
  "Reservations canceled more than 24 hours before pickup are fully refundable. Cancellations within 24 hours may incur a service fee.";

document.addEventListener("DOMContentLoaded", function () {
  var text = window.NLR_POLICY.cancellation;
  document.querySelectorAll('[data-policy="cancellation"]').forEach(function (el) {
    el.textContent = text;
  });
});
