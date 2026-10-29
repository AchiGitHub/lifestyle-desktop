# Lifestyle (desktop)

Front-desk app for Lifestyle Fitness Studio: members, registrations and renewals, payments, the drinks/supplement store, and a dashboard. It replaces the hosted `user-mgt` web app (Spring Boot + Next.js + Postgres on Fly.io) with a single Windows program that keeps its data in a local SQLite file, so it costs nothing to run.

- **Data:** `%APPDATA%\Lifestyle\lifestyle.db` (SQLite, WAL mode). Nothing needs installing besides the app; SQLite is built in.
- **Backups:** a copy goes to the gym's Google Drive (folder "Lifestyle Backups") once a day and when the app closes, if a day has passed since the last one. The newest 30 are kept. A daily copy is also kept locally for 14 days in `%APPDATA%\Lifestyle\backups`.
- **Restore:** Settings → restore from Drive, a local backup, or a file. The first-run screen offers the same, which is how a replacement PC gets the data back.
- **Door check-in:** with **Settings → Door check-in tablet** on, the app serves a check-in page on the local network (port 8787; `src/main/door`). A tablet on the gym Wi-Fi opens it after pairing. The desk shows a 6-digit code and QR; the tablet gets a token, and the PC keeps only its hash, in `config.json`. Members type their mobile number and tap their name. The page only ever receives first name + initial and status, never phone numbers or money. Lookups are rate-limited, and non-OK check-ins pop up an alert at the desk. In development the page is served from `out/renderer`, so run `npx electron-vite build` after changing it. Set `LIFESTYLE_LAN_HOST=127.0.0.1` to keep test servers off the network.
- **Instructor phones:** the same way, **Settings → Instructor phones** serves a store page on port 8788 (`src/main/staff`, page `src/renderer/staff`). Each phone is paired under the instructor's name. Instructors sell, add deliveries and record counts, and can undo their own sale for 10 minutes. A sale can name the member who bought it (`payments.member_id`, also chosen at the desk). The phone lists today's check-ins first, or searches by name or part of a phone number. A search needs 2 letters or 3 digits, returns at most 20 results and is rate-limited. Phones only ever get members' names and the last 3 digits of their phone, never cost prices or other member details. Sales are ordinary `payments` rows with `recorded_by`/`device_id`; deliveries and counts go to `stock_changes`. The desk gets a notice for each and refreshes its lists. The door and staff servers share `src/main/lan` (HTTP, pairing, lifecycle), with separate device lists, so a door token can't record a sale. Stock only changes through sales, Received and Count (editing a product leaves it alone), so a phone sale is never overwritten by a form opened earlier.
- **Updates:** the installed app checks this repository's GitHub Releases (electron-updater) a couple of minutes after opening and every 4 hours, downloads new versions in the background, and installs them when the app closes or from the "Update ready – restart" button, after saving a local copy of the data. Development builds don't update unless `LIFESTYLE_UPDATE_FEED` points at a test feed.
- **Joining fees:** each plan has a joining fee per new member. New registration adds it for new members, and for existing members back after a break longer than the rule on the Plans page (10 days by default). Renewals never add it for existing members; the break is only pointed out. Staff can tick or untick it per member. It's stored per member on the registration and shown separately on receipts and the dashboard. The old "with Reg." plans are converted when a database is opened (including a restored backup) and in the import: registrations move to the plain plan, and the price difference becomes the joining fee.
- **Receipts:** every payment (Cash, Card or Bank transfer) gets a receipt number (R-00124). The receipt opens after the payment, to send on WhatsApp or print through the Windows print dialog (a 72 mm slip that also prints on A4). Migrated payments are numbered in date order.
- **Daily takings and the owner's summary:** nothing is counted or closed at the desk. **Payments → By day** works out each day's takings by method from the payments, and can WhatsApp a day's summary to the owner. With Drive connected, the app also keeps a Google Sheet, "Lifestyle daily summary", in the gym's Drive (`src/main/summary`). It lists each day of this month and the two before, with totals by method, memberships vs store, sign-ups, renewals and check-ins. It's rewritten from a CSV upload every hour while the app is open and when it closes, using the same `drive.file` access as backups. It's tagged with an `appProperties` key so a new PC finds it again, and it can be shared with the owner's Google account, which emails them the link.
- **WhatsApp reminders:** buttons on Renewals due, Not renewed and unpaid registrations open WhatsApp Desktop (or WhatsApp Web) with a message typed in; staff press send. Nothing is sent automatically and no WhatsApp API or account is needed. The wording is in Settings. `{packages}` becomes a price list of the plans staff tick when sending: the renewal buttons open a dialog with the message as it will be sent. Settings picks which plans are ticked to start with (or the 5 most popular of the last year). Each renewal reminder is recorded so the lists show who's been messaged.

## Development

```powershell
npm install
node node_modules/electron/install.js   # npm 11 skips install scripts; this fetches Electron for `npm run dev`
npm run dev          # app with hot reload
npm test             # service tests on an in-memory database
npm run typecheck
npm run build:win    # installer in dist\Lifestyle-Setup-<version>.exe
npm run release      # build and upload a draft GitHub release (needs GH_TOKEN); see DEPLOYMENT.md §5
```

Stack: Electron 44 with electron-vite. The main process (`src/main`) owns the database (better-sqlite3 + Drizzle) and all business logic. The UI (`src/renderer`) is React 19 with Mantine 9 and talks to it only through the typed `window.api` in `src/preload`. Input is validated with the same zod schemas on both sides (`src/shared/schemas.ts`).

To run against a throwaway data folder instead of `%APPDATA%\Lifestyle`, set `LIFESTYLE_USER_DATA` (development builds only).

### Changing the database

Edit `src/main/db/schema.ts`, then `npm run db:generate`. This writes a migration to `drizzle/`. Migrations run automatically when the app starts, including on restored backups.

## Google Drive setup (once, before building the installer)

1. In Google Cloud Console, create a project, enable the **Google Drive API**, and configure the OAuth consent screen (External; app name "Lifestyle").
2. Add only the `.../auth/drive.file` scope. The app can then see only files it created, and Google doesn't require an app review.
3. **Publish the consent screen ("In production").** In Testing mode, Google expires the sign-in after 7 days and backups silently stop.
4. Create credentials → OAuth client ID → **Desktop app**.
5. Copy `.env.example` to `.env` and paste in the client ID and secret.
6. Rebuild. In the app: Settings → Connect Google Drive → sign in with the gym's account.

## Moving the data over from the old app

The migration reads the old app's plain-SQL `pg_dump` directly; no Postgres is needed.

```powershell
npm run import-dump -- ..\dumps\<dump>.sql ..\dumps\lifestyle-migrated.db --as-of 2026-10-27
```

It prints a reconciliation report: row counts, payment totals per month and category, active registrations, and lists for the client to check. Every figure should match the old system. Then, on the gym PC, open the app, choose **Restore from a file** and pick the `.db`, and set the front-desk password.

What the import does with the old data:
- Payments whose registration had been deleted in the old app are kept, marked "registration deleted", so income history stays complete.
- Payments with no category become membership fees.
- Dates are converted from the old UTC values to Sri Lankan calendar dates.
- Links to members that no longer exist are dropped, and a registration whose plan was deleted gets a "(deleted type)" placeholder.

**The dump and the `.db` contain members' personal details.** Keep them out of git (`dumps/` and `*.db` are ignored), don't upload them anywhere, and delete working copies after the switch-over.

## Deploying to the gym PC

Follow [DEPLOYMENT.md](DEPLOYMENT.md). It covers checking the PC, setting up Google Drive access, the cutover day (final dump, freezing the old app, import, install), rollback, decommissioning Fly.io, updates, disaster recovery, and troubleshooting (including password resets). Hand the owner a filled-in printout of [docs/client-handover.md](docs/client-handover.md).
