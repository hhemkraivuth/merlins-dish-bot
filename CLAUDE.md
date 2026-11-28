# Merlin's Dish order app (customer ordering)

Read this first. This is the customer facing side, so care comes before speed.

## Who and how
- Owner: Lily (Hemvalee), Bangkok, runs Merlin's Dish alone, no coding background. Plain words, answer first.
- Australian English, DD/MM/YYYY, Thai Baht (฿). No dashes joining clauses. Address her as "you".
- Never say "I haven't checked". Check, then tell her. Never claim something works until one real test proves it.
- Standing permission (26/11/2026): you may push and merge BOH and bot code without asking again. System safety checks still apply. Say what was done afterwards.
- For visible design or layout changes, show a preview first and push after she has seen and approved it.

## The repo
- Node and Express, deployed on Railway. Repo: hhemkraivuth/merlins-dish-bot (main). LINE Messaging API and LIFF for ordering, Google Sheets through a service account, Cloudinary for images, Thunder API for payment slip checks.
- Main files: server.js (routes and LINE flow), menu.js and menuStore.js (menu), adminApi.js (admin commands), stockCommand.js and stockState.js (the `left` stock command), closeText.js and scheduling.js (closed days and lead times), ageGate.js (wine age check), public/ (the order web).
- Tests: `node --test test/*.test.js` (54 passing on 28/11/2026).
- Pushing: if `git push` returns 403, call add_repo for this repo with access push, then push again. Commit messages end with the attribution lines the session reminder gives.
- The back office app is a separate repo, hhemkraivuth/merlins-dish-backoffice. Customer ordering must never be put at risk by a change in either repo.

## Business rules the code must respect
- Wine is sold on the order web only, behind an age gate set at 20 (not 18). Never write promotional alcohol copy.
- The Place order button stays greyed out until a payment slip is attached. The page tells the customer so.
- The CRM link never lives in the order web.
- Bank details and the QR image are Railway variables (BUSINESS_PAYMENT_INFO, QR_IMAGE_URL), not code. Lily updates them herself.
- Premium items need 2 days lead time. Weekends are always closed. Closure dates: last trading days Fri 04/12/2026 (back Mon 14/12) and Fri 25/12/2026 (back Mon 04/01/2027).
- Christmas and New Year decorations run 23/11/2026 to 15/01/2027 (public/xmas.css and xmas.js).
- Menu, prices, noodles, announcements and settings must be editable by Lily in the BOH, not only in code.
- The order app's admin commands are also reachable from the BOH LINE group through a token gated endpoint, so a command change needs a check on both sides.
- Environment variable names in use: LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, LINE_INTERNAL_TARGET_ID, ADMIN_USER_ID, LIFF_ID, LINE_OA_URL, THUNDER_API_KEY, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, BUSINESS_PAYMENT_INFO, QR_IMAGE_URL, FREE_DELIVERY_MIN, SMALL_ORDER_FEE, SHOP_LAT, SHOP_LNG, CARTO_KEY, PORT. Values live in Railway only, never in git.

## Where the rest lives
The claude.ai Project "Merlin's Dish" holds the living handovers. Start with `claude/start-here.md`. BOH rules are in the BOH repo's CLAUDE.md.
