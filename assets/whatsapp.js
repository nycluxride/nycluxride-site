/*
 * NYC LUX RIDE — floating contact stack positioner.
 *
 * The WhatsApp + Call buttons now live as STATIC markup (#nlr-fab-stack) in every
 * page's HTML, outside #root so React hydration never removes them. This file's
 * only remaining job is to keep that stack clear of the dismissible cookie banner
 * on desktop (self-healing via a MutationObserver, since the banner can appear or
 * be dismissed after hydration).
 *
 * Previously this script injected its OWN floating WhatsApp button plus a top-bar
 * WhatsApp link. Both are gone: the static top utility bar and the static stack
 * now serve those roles, so there is exactly one WhatsApp button per breakpoint
 * (desktop stack / mobile bottom bar) and no duplicate is created.
 */

function nlrPositionFabStack() {
  var stack = document.getElementById("nlr-fab-stack");
  if (!stack) return;
  // Sit above the cookie banner (found via its close button) so nothing is covered.
  var bottom = 24;
  var closeBtn = document.querySelector('button[aria-label="Close cookie notice"]');
  var bar = closeBtn ? closeBtn.closest("div.fixed") : null;
  if (bar && bar.offsetParent !== null && bar.offsetHeight) bottom = bar.offsetHeight + 16;
  stack.style.bottom = "calc(" + bottom + "px + env(safe-area-inset-bottom, 0px))";
}

function nlrContactApply() {
  if (typeof document === "undefined" || !document.body) return;
  try { nlrPositionFabStack(); } catch (e) { /* degrade silently */ }
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", nlrContactApply);
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("resize", nlrContactApply);
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(nlrContactApply).observe(document.documentElement, { childList: true, subtree: true });
  }
}
