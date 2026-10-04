# TapDot Portal

TapDot builds mobile "tap tag" landing pages (for NFC tags and QR codes) and keeps them live on a church's
website. This repo has the visual page editor and the client portal around it, hosted on Cloudflare Pages
at `tapdot.camdengoff.com`.

Bethany First Church's original editor setup lives in the public repo
`camdengoff/TapDot-Code-Editor-`, which stays as it is so their Squarespace code block keeps working.

## Try the editor on its own

Open `index.html` in a browser. Projects save in that browser, and Copy HTML gives a paste-ready block.

## Client portal (tapdot.camdengoff.com/app/)

The portal gives each church an account: its staff sign in, keep their pages online (not just in one
browser), and publish them. A church pastes one code block into Squarespace per page, once; after that,
every Publish updates the live page.

- **Sign-in:** email and password, or Sign in with Google. Nobody can sign up on their own: an admin or a
  church owner adds their email, then copies them a one-time password link (also used for resets). Google
  sign-in works for anyone who has been added, with no link.
- **Roles:** admins (`ADMIN_EMAILS`) manage every church. In a church, owners add and remove people;
  editors create, edit and publish pages.
- **Pages:** the editor opens at `/app/editor?church=…&page=…` and autosaves to the account. Visitors see
  only what was last published. If two people edit at once, the second save asks whose version to keep.
- **Live pages:** `/p/<church>/<page>` is the published HTML the code block loads (via `/embed.js`), and
  `/view/<church>/<page>` is the same page on its own, handy for QR codes and tap tags.

### One-time setup in Cloudflare

1. Workers & Pages → Create → Pages → Connect to Git, and pick this repo. Build command
   `node tools/build.js`, build output directory `dist`. Pages picks up the `functions/` folder (the API)
   by itself, and every push to `main` redeploys.

2. Storage & Databases → D1 → Create database (e.g. `tapdot-portal`). The tables are created on first use.
3. Storage & Databases → KV → Create namespace (e.g. `tapdot-pages`).
4. Pages project → Settings → Bindings: add the D1 database as `DB` and the KV namespace as `PAGES`.
5. Pages project → Settings → Variables and secrets (Production):
   - `ADMIN_EMAILS`: your email (comma-separate several).
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (secrets): from Google, below.
   - `SETUP_KEY` (secret, optional): lets an admin set a password before Google is set up, from
     "First-time admin setup" on the sign-in page. Delete it once you have signed in.
6. Pages project → Custom domains: add `tapdot.camdengoff.com`.
7. Deployments → Retry the latest deployment so the settings take effect, then open
   `https://tapdot.camdengoff.com/app/`.

### Sign in with Google

1. console.cloud.google.com → create a project (e.g. TapDot).
2. APIs & Services → OAuth consent screen: External, app name TapDot, your email as support contact.
   Publish the app so it isn't limited to test users (the email/profile scopes need no Google review).
3. APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
   Authorized redirect URI: `https://tapdot.camdengoff.com/api/auth/google/callback`.
4. Copy the client ID and secret into the Cloudflare secrets above.

### Run it locally

```sh
npx wrangler pages dev dist --d1 DB=local-db --kv PAGES
```

with a `.dev.vars` file (not committed) such as `ADMIN_EMAILS=you@example.com` and `SETUP_KEY=anything`.
Run `node tools/build.js` after changing `portal/`, `public/` or the editor.

## What it does

- **Blocks**: hero image or fading slideshow, section heading with "See all" link, text, buttons
  (scrolling row, wrapping row, 2/3-across grid, full-width stack), banner cards, image card rows,
  dropdowns (FAQ style), swipeable slides, single image, photo grid with tap-to-zoom,
  copy boxes (Wi-Fi, address, giving info), live Squarespace events list, YouTube/Vimeo video,
  countdown, spacer/divider and custom HTML.
- **Button actions**: open a link, open a page in a pop-up sheet, open your own pop-up menu
  (like "Next Steps"), copy text with a confirmation message, call, text, email, scroll to a block, share.
- **Images**: paste a link or upload. Uploads are resized and compressed, then embedded in the export.
- **Theme**: hex colors with an opacity %, typed or picked (with presets), card and button corner radius, spacing, fonts, load animation,
  and a centered phone-width column or full width on tablet and desktop.
  Every block can override colors, radius and spacing. Every size slider also has a box to type an exact value.
- **Time tabs**: the Blocks list has a tab for the normal page plus one per special time
  (for example "Chapel", Tue/Thu 10:00–11:30 CT, or a date range for a season). Pick a tab to see and
  edit that version; the eye button shows or hides a block during that time. The preview follows the tab
  you're editing, or can show what's live right now.
- **Word colors**: text fields show formatted text. Highlight words and tap a color (or Accent, 🎨 for
  any color, bold, italic, link); tapping another color replaces it. Behind the scenes it is stored as
  simple markup such as `[[#ef4444|words]]` and `**bold**`.
- **Export**: copy or download the HTML. Options for the Squarespace fixes, full-screen vs inline layout,
  and keeping an editable copy inside the HTML so it can be reopened later.
- **Version history** (🕘 History): save named versions, and one is kept automatically when you copy or
  download the HTML and every 10 minutes while editing. Open any version to go back to it (Undo returns).
  Versions live in that browser; use Save project for a copy elsewhere.
- Autosaves in the browser, plus Save project (`.json`), Open, undo/redo and drag-to-reorder.

## Files

- `index.html`: editor shell
- `editor/schema.js`: block types, theme options and templates
- `editor/render.js`: turns a project into the exported HTML (including the small runtime script)
- `editor/app.js`: editor UI
- `editor/styles.css`: editor styles
- `tools/build.js`: builds `dist/` for Cloudflare Pages, including `dist/tapdot-editor.js`, the single-file editor
- `portal/`: the client portal pages (copied to `dist/app/` by the build)
- `public/embed.js`: the loader that the live-page code block uses
- `functions/` and `server/`: the portal API on Cloudflare Pages Functions (`server/api.js` routes,
  `server/auth.js` sign-in, `server/db.js` tables)

## Pop-up proxy (for sites that won't open in a pop-up)

Many sites send headers that forbid being shown inside another page, so "Open page in pop-up sheet"
shows a blank or error box. `worker/popup-proxy.js` is a small Cloudflare Worker that fetches the page,
removes those headers, and hands it back so the pop-up can show it.

1. In Cloudflare, open Workers & Pages and either edit your existing proxy worker or create a new one.
2. Replace its code with `worker/popup-proxy.js` and deploy.
3. Edit `ALLOWED_HOSTS` at the top to list the sites you want to show in pop-ups. Only those sites are
   proxied, so strangers can't use your worker as an open proxy.
4. The editor already uses the BFC worker (`https://bethanynaz-proxy.cgoff.workers.dev`). To use a different one,
   change **Export → Pop-up proxy → Worker address**; if it is blank, pop-up links open in a new tab instead.

After that, paste normal links into pop-up buttons and they go through the worker automatically.
Old-style links such as `https://<worker>/prayer` still map to `https://bethanynaz.org/prayer`.
A button can opt out with "Skip the pop-up proxy for this link". Logins, payments and some forms may
not work when proxied; open those as normal links instead.
