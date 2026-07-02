/*
 * NYC LUX RIDE — (inert).
 *
 * The WhatsApp + Call buttons are STATIC markup (#nlr-fab-stack) in every page,
 * outside #root, positioned entirely by CSS (assets/nlr-contact.css): Call on the
 * left edge, WhatsApp on the right edge, vertically centered.
 *
 * This file used to (a) inject its own floating WhatsApp FAB + a top-bar WhatsApp
 * link, and later (b) lift a bottom-right stack above the cookie banner. Both roles
 * are gone: the buttons are now side-centered, so there is no bottom anchor to
 * manage and nothing to inject. The file is kept as a no-op only so the <script>
 * tag referenced by all pages does not 404. No WhatsApp button is created here.
 */
/* intentionally empty */
