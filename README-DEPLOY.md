# NYC Lux Ride — Front-End Mirror (deploy-ready, 2 placeholders to fill)

Mirrored from the live site on 2026-06-09 for the business owner. 36 pages:
home, services + 3 service-detail pages, 12 location pages, schedule, contact,
about, FAQ, blog index + 11 posts, privacy, terms. All assets local. All
internal links root-relative. Cloudflare email obfuscation decoded to plain
mailto links (no Cloudflare dependency).

## BEFORE LAUNCH — find & replace these two placeholders

1. `YOUR-NEW-MOOVS-SLUG`  (in HTML files + assets/app.6xvjthKL.js)
   -> your new Moovs booking slug, from operator.moovs.app after signup.
   Every Book Now button points to customer.moovs.app/<slug>/request/new.
   DO NOT deploy before this swap: the placeholder makes booking buttons
   dead on purpose, so customers can't be funneled to the old locked account.

2. `https://YOUR-DOMAIN.example`  (canonical/og/twitter meta, JS, sitemap.xml)
   -> final domain once decided (transferred nycluxride.com or new).

One-liner once you know both values:
  grep -rl 'YOUR-NEW-MOOVS-SLUG' . | xargs sed -i 's/YOUR-NEW-MOOVS-SLUG/real-slug-here/g'
  grep -rl 'YOUR-DOMAIN.example' . | xargs sed -i 's|https://YOUR-DOMAIN.example|https://realdomain.com|g'

## Deploy
Static files — drag-and-drop to Netlify, Cloudflare Pages, or Vercel.
Enable "clean URLs / pretty URLs" (default on Netlify & CF Pages) so
/about serves about.html. Then point the domain's DNS at the host.

## Email (separate from the website)
- Booking/quote confirmation emails are sent BY MOOVS, not the site.
  Requires Moovs STANDARD plan ($149/mo + $299 setup). Free tier does NOT send them.
- info@ mailbox = email hosting (Google Workspace/Zoho) via MX records at the
  domain registrar. Independent of site hosting.
- Contact page: check whether the form needs a backend (Formspree/Web3Forms)
  once you test it — static hosts don't process forms natively.

## Known issues inherited from the original build
- JSON-LD in assets/app.6xvjthKL.js references /car1.jpg, /car2.jpg, /car3.jpg
  which were 404 on the live site too. Harmless visually; fix or remove the
  references for clean SEO structured data.
- privacy-policy.html / terms-of-service.html prose mentions www.nycluxride.com —
  update text only if the domain changes.
- TikTok link uses handle @nycluxride.com — verify the account is accessible.
