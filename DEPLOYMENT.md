# Deploying Lifestyle to the gym PC

This runbook takes the gym from the hosted web app (Fly.io) to the desktop app on the front-desk PC. It assumes you install on-site. Commands are PowerShell, run from `lifestyle-desktop\` unless stated otherwise.

Give [docs/client-handover.md](docs/client-handover.md) to the owner at the end. It's a one-page sheet you print and fill in.

## 0. Overview

| When | What | Time |
|---|---|---|
| A few days before | Check the PC, set up Google Drive access, build the release, rehearse with a fresh dump | 2–3 h |
| Cutover day, after closing | Final dump, freeze the old app, import, install, connect backups, show the staff | ~2 h |
| Days 1–3 | Confirm daily backups are arriving | 5 min/day |
| Day 14 | Delete the Fly.io apps and database, clean up | 30 min |

**On your laptop:**
- this repo, with `npm ci` already run
- Node 22 or newer
- `pg_dump` 16 or newer
  - Install it with the PostgreSQL installer from <https://www.enterprisedb.com/downloads/postgres-postgresql-downloads>, ticking only **Command Line Tools**.
  - It lands in `C:\Program Files\PostgreSQL\<version>\bin`. Add that folder to PATH, or call `pg_dump.exe` by its full path.
- the Fly CLI, logged in to the account that owns the apps
  - Install it with `iwr https://fly.io/install.ps1 -useb | iex`, then run `fly auth login`.
  - It lands in `%USERPROFILE%\.fly\bin`. If `fly` isn't found, open a new terminal.

Check both work before the visit: `pg_dump --version` and `fly apps list`. All three apps below should be listed.

**Also bring:**
- a USB stick
- the gym's Google account email and password (or the owner, to sign in)

The old system runs as three Fly apps:

| App | What it is |
|---|---|
| `lifestyle-fitness` | web front end |
| `lifestyle-service` | API |
| `lifestyle-fitness-db` | Postgres, with volume `pg_data` |

---

## 1. Before the visit

### 1.1 Check the PC (ask the owner)

- [ ] **Windows 10 or 11, 64-bit.** The app (Electron 44) does not run on Windows 7 or 8.
- [ ] **Which Windows account the front desk signs in with.** The app keeps its data per Windows user, in `%APPDATA%\Lifestyle`. Install and use it under that one account, always.
- [ ] **Internet connection.** The app works offline, but backups need internet at least now and then.
- [ ] **Screen size.** Anything from 1366×768 up works, including at 125% scaling.
- [ ] **Free disk space:** about 500 MB.
- [ ] **Door check-in tablet (optional).** Any Android tablet with Chrome, or an iPad, on the same Wi-Fi as the PC. Also: can you sign in to the router (to give the PC a fixed address)?
- [ ] **Instructor phones (optional).** Which instructors will sell store items or update stock on their own phones? Their phones need the gym Wi-Fi. If the gym has a separate staff Wi-Fi, the PC and their phones should be on that one.
- [ ] **Printer for receipts (optional).** Any printer installed in Windows works. A small 80 mm receipt printer suits the receipt layout best.
- [ ] **Which phone has the gym's WhatsApp.** You'll link it to the PC for the reminder buttons (2.7), so it needs to be there on the day.

### 1.2 Google Drive access (once)

Backups go to the gym's own Google Drive. Create the Google Cloud project **while signed in as the gym's Google account**, so the gym owns it, and add yourself as an Editor under IAM. None of this costs anything, and no billing account is needed.

1. Go to <https://console.cloud.google.com> and create a project named **Lifestyle**.
2. **APIs & Services → Library →** enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (labelled "Google Auth Platform" in newer consoles):
   - User type: **External**. App name: **Lifestyle**. Support and developer email: the gym's.
   - Scopes: `.../auth/drive.file`, `openid`, `.../auth/userinfo.email`. Don't add any others.
   - **Publish the app ("In production").** In *Testing* mode Google cancels the sign-in after 7 days and backups silently stop. With these scopes, Google doesn't review the app.
4. **Credentials → Create credentials → OAuth client ID →** type **Desktop app**, name **Lifestyle desktop**.
5. Copy `.env.example` to `.env` in this folder and paste in the client ID and client secret:
   ```
   MAIN_VITE_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
   MAIN_VITE_GOOGLE_CLIENT_SECRET=GOCSPX-...
   ```
   `.env` is git-ignored. Keep a copy in your password manager.

### 1.3 Build the release

```powershell
# set "version" in package.json to 1.0.0 first
npm ci
npm test
npm run build:win     # → dist\Lifestyle-Setup-1.0.0.exe
```

Close any running `npm run dev` window first. `npm ci` deletes `node_modules` before reinstalling, and on Windows a running app keeps its files locked: the install fails halfway and leaves `node_modules` broken. If that happens, close the app and run `npm ci` again.

Check the packaged build against a scratch data folder. This leaves your own `%APPDATA%` alone.

```powershell
.\dist\win-unpacked\Lifestyle.exe --user-data-dir="$env:TEMP\ls-check"
```

- [ ] The Welcome screen offers **Restore from Google Drive** and does *not* say "Not available in this build".
- [ ] Choose **Start fresh** and set any password.
- [ ] Settings → **Connect Google Drive** with a test Google account (tick the Google Drive box on Google's page) → **Back up now**. "Lifestyle Backups" appears in that Drive.
- [ ] Settings → **Show backups in Drive → Restore** works and sends you back to sign in.
- [ ] Settings → **Owner's daily summary** → **Update now**, then **Open in Google Sheets**: a "Lifestyle daily summary" sheet with the month and day rows. Press **Update now** again; the "Updated …" line in the sheet changes and no second sheet appears in Drive. Share it with your own email and check the email arrives.
- [ ] Then: Settings → **Disconnect**, close the app, and delete `$env:TEMP\ls-check`.

### 1.4 Rehearse the data move

Do a full dry run with a fresh dump (step 2.2). Nothing is frozen this time.

```powershell
npm run import-dump -- ..\dumps\rehearsal.sql ..\dumps\rehearsal.db --as-of 2026-11-01
.\dist\win-unpacked\Lifestyle.exe --user-data-dir="$env:TEMP\ls-rehearsal"
# Welcome → Restore from a file → ..\dumps\rehearsal.db → set a password
```

Compare it with the live web app, using the checks in step 2.1. Then delete `rehearsal.sql`, `rehearsal.db` and `$env:TEMP\ls-rehearsal`.

### 1.5 Pack the USB stick

- [ ] `dist\Lifestyle-Setup-1.0.0.exe`
- [ ] `sqlite3.exe`, used only for password resets (§7). Get it from <https://sqlite.org/download.html> → *sqlite-tools-win-x64* zip; it's a single exe with nothing to install.
- [ ] A printed copy of `docs/client-handover.md`.

The database file goes onto the stick on the day. It contains members' names, phone numbers and NICs. Delete it from the stick as soon as it's loaded.

---

## 2. Cutover day

### 2.1 Before closing: note figures to check against

The new dashboard's income figures will **not** match the old one. The old dashboard multiplied list price by the number of registrations; the new one adds up real payments. Compare these instead:

- [ ] **Registrations page:** the total in the table footer. It's the number of active registrations.
- [ ] Five members registered this week: name, phone, plan, end date.
- [ ] Two or three members who owe money, if the owner knows of any.

### 2.2 Final dump (after the last customer)

Make sure nobody has the web app open, then dump through a Fly proxy. Use two PowerShell windows.

```powershell
# window 1: leave running
fly proxy 15432:5432 -a lifestyle-fitness-db

# window 2 (from lifestyle-desktop\)
pg_dump --no-owner --no-privileges --format=plain `
  --file="..\dumps\final_$(Get-Date -Format yyyyMMdd_HHmm).sql" `
  "postgresql://postgres:<password>@localhost:15432/<database>"
```

- Use the same database name and password as for the earlier dump in `dumps\`. To list the databases: `psql "postgresql://postgres:<password>@localhost:15432/postgres" -c "\l"`.
- **Do not add `--inserts` or `--column-inserts`.** The import reads the `COPY … FROM stdin` blocks of the default plain format.
- Close the proxy (Ctrl+C) when done.

### 2.3 Freeze the old app

```powershell
fly scale count 0 -a lifestyle-fitness --yes
fly scale count 0 -a lifestyle-service --yes
```

- The web app is now offline, so nothing can be entered there by mistake.
- Use `scale count 0` rather than stopping machines. The API is set to auto-start stopped machines on the next request.
- **Leave `lifestyle-fitness-db` alone.** It is the rollback path (§3).

### 2.4 Import

```powershell
npm run import-dump -- ..\dumps\final_<stamp>.sql ..\dumps\lifestyle-final.db --as-of <today, YYYY-MM-DD>
```

Read the report:
- [ ] Every row count is the same on both sides, except `registration_users` and `membership_types`. Those can differ by the small fixes listed under *Fixes applied*: dead member links dropped, a placeholder plan added.
- [ ] **Payment total ✓**.
- [ ] **Registrations active on <today>** equals the footer count from 2.1. It may be off by the few memberships ending today: the old app compared against the time of day, the new one against the date.
- [ ] Copy the two **"For the client to review"** lists (registrations with no payment, or paid less than the amount) to go through with the owner. They contain names, so don't send them by chat or email.

Copy `lifestyle-final.db` to the USB stick.

### 2.5 Install on the gym PC

Sign in to Windows **as the front-desk user** (1.1).

1. Copy `Lifestyle-Setup-1.0.0.exe` from the USB stick and run it.
2. Windows SmartScreen says *"Windows protected your PC"* because the installer isn't code-signed. Click **More info → Run anyway**.
3. At *Choose Installation Options*, pick **Only for me**. This needs no admin password and installs to `%LOCALAPPDATA%\Programs\Lifestyle`.
4. Finish with **Run Lifestyle** ticked. A desktop shortcut "Lifestyle" is created.

If antivirus quarantines the app, restore it and add an exclusion for `%LOCALAPPDATA%\Programs\Lifestyle`.

### 2.6 Load the data and set the password

1. Welcome screen → **Restore from a file** → pick `lifestyle-final.db` on the USB stick.
2. **Choose a password.** The owner picks it; write it on the handover sheet.
3. **Check the PC's clock and time zone:** Settings → Time & language → *(UTC+05:30) Sri Jayawardenepura*, with the correct date and time. Every date in the app (start and end dates, "expiring", payment dates) comes from this clock.
4. **Delete `lifestyle-final.db` from the USB stick.** The app has its own copy in `%APPDATA%\Lifestyle\lifestyle.db`.

### 2.7 Connect backups

1. App → **Settings → Connect Google Drive**. The browser opens; sign in with **the gym's Google account**. On the permissions page, **make sure the Google Drive box is ticked** (*"See, edit, create, and delete only the specific Google Drive files you use with this app"*), then press Continue. If it's left unticked, the app says so and you connect again.
2. Back in the app, press **Back up now**. The top bar should then show "Backed up a few seconds ago".
3. Open <https://drive.google.com> as the gym account and check there's a **Lifestyle Backups** folder with a `lifestyle_<date>.db` file in it.

From now on the app backs up by itself:
- once a day while it's open
- when it closes, if the last backup is more than a day old

It keeps the newest 30 backups.

**Owner's daily summary** (5 min, with the owner's phone):

1. Settings → **Owner's daily summary** should be **On** and say "Last updated …" within a couple of minutes of connecting Drive. Press **Update now** if not.
2. Press **Open in Google Sheets** and check the sheet: a total for each month, then each day's takings (cash, card, bank transfer), memberships and store, new sign-ups, renewals and check-ins. Compare a recent day with **Payments → By day**.
3. Type the **owner's Google (Gmail) address** under "Share it with the owner's Google account" → **Share**. Google emails them the link. On their phone, open it and install the **Google Sheets** app if asked, then bookmark it.
4. Tell the owner: the app rewrites the sheet every hour while it's open and when it closes, so the evening's last payments are there once the desk closes the app. Changes they make in the sheet are overwritten.

**WhatsApp reminders** (5 min, with the gym's phone):

1. On the PC, install **WhatsApp** from the Microsoft Store. Link it to the gym's number: on the phone, WhatsApp → **Settings → Linked devices → Link a device**, then scan the QR code on the PC.
2. In Lifestyle, **Settings → WhatsApp reminders** should no longer say "WhatsApp isn't installed". If WhatsApp can't be installed, the app opens WhatsApp Web in the browser instead: link <https://web.whatsapp.com> the same way.
3. With the owner, read the three messages and change the wording if they want (Sinhala works). Under **Packages ticked to start with**, pick the plans the renewal messages usually offer. If none are picked, the 5 most popular are ticked. Staff can change the ticks for each message when sending. **Save messages.**
4. On **Renewals due**, press **WhatsApp** on a member the owner knows. A window shows the packages to offer and the message. Tick or untick packages, then press **Open WhatsApp**. WhatsApp opens with the message typed in but not sent. Check it, then send it or delete the text. The row now shows **Messaged**.

**Door check-in tablet** (15 min, if they have one):

1. **Fixed address for the PC.** In the router, reserve the PC's current IP address (often called "DHCP reservation" or "static lease"). The tablet keeps using that address. Without this it may change after a power cut, and the tablet then needs pairing again.
2. **Turn it on.** In Lifestyle, go to **Settings → Door check-in tablet** and switch it **On**.
   - If Windows asks whether Lifestyle may communicate on networks, tick **Private networks** and **Allow**. This needs an admin password once.
   - In Windows Settings → Network, the Wi-Fi or Ethernet connection must be **Private**, not Public.
3. **Pair the tablet.** Press **Pair a tablet**. On the tablet, scan the QR code with the camera and open the link. The tablet shows the keypad, and the desk shows "Tablet paired".
   - If scanning doesn't work, open the address shown (e.g. `http://192.168.1.20:8787`) in the tablet's browser and type the 6-digit code.
4. **Keep the tablet on the page.**
   - **Android:** Settings → Security → *Screen pinning* (or *App pinning*), then pin Chrome. In Developer options, turn on *Stay awake* while charging.
   - **iPad:** turn on *Guided Access* (Settings → Accessibility).
   - The first tap on the page makes it full screen.
5. **Test it.** Check in a staff member's number on the tablet. It appears under **Check-ins** at the desk.

**Instructor phones** (5 min per phone, if they want it):

Instructors can sell store items and record stock on their own phones. Each phone is paired under the instructor's name, and every sale and stock change records who made it. The page runs on port 8788.

1. **Fixed address and network:** as for the door tablet (steps 1–2 above). If the door tablet is already set up, both are done. Windows allows Lifestyle as a program, not per port, so it shouldn't ask again. If it does, tick **Private** and **Allow**.
2. **Turn it on.** In Lifestyle, go to **Settings → Instructor phones** and switch it **On**.
3. **Pair each phone.**
   1. Press **Pair a phone** and type the instructor's name.
   2. On their phone, connected to the gym Wi-Fi, they scan the QR code with the camera and open the link. If scanning doesn't work, they open the address shown (e.g. `http://192.168.1.20:8788`) and type the 6-digit code.
   3. The phone shows the product list, and the desk lists the phone under their name.
   4. Optionally, they use the browser's **Add to Home screen** (Chrome: **⋮** menu; Safari: **Share**) to get a shortcut.
4. **Test it.** Sell one item from the phone. The desk shows a short notice ("Kasun sold 1 × …"), and it's listed under **Store → Sales** with their name in the **By** column. Undo it from the phone's **Today** tab.
5. **Tell the instructors:**
   - **Sell:** tap the product and set how many. Under **Who's buying?**, choose the member (today's check-ins are listed first, or search by name or phone number), or leave it empty for a walk-in. Then choose Cash, Card or Bank transfer and press **Record sale**.
   - **Stock:** **Stock arrived** adds a delivery. **Counted it** sets the stock to what's on the shelf.
   - **Today:** what they've sold today, and the cash they should hand in. A wrong sale can be undone for 10 minutes. After that, the desk deletes it in **Payments**.
   - Prices and the product list are changed at the desk only.
   - The phone needs the gym Wi-Fi and the app open at the desk. Otherwise it says *"Can't reach the front desk computer"* and nothing is recorded.

**Security note:** the page uses plain `http` on the local network. Someone on the same Wi-Fi with the right tools could copy a phone's sign-in and record false sales or stock changes. Every phone action shows at the desk with the phone's name and time. **Remove** in Settings cuts a phone off at once. When choosing a buyer, phones see members' names and the last 3 digits of their phone. Searches are limited to 20 results and a few a minute. Phones never see other member details or cost prices.

**Receipts** (5 min):

1. **Settings → Receipts:** fill in the gym's address and phone (printed under the name), and the **owner's WhatsApp number**, for sending a day's summary from **Payments → By day**. **Save.**
2. Press **Print a sample receipt** and pick the receipt printer. If there's no printer yet, choose **Microsoft Print to PDF** to see the layout.

### 2.8 Check it with the owner (15 min)

- [ ] **Registrations** shows the same active count as the old app (2.1).
- [ ] The five members from 2.1: find each with the top search box (name or phone), open them, and check the plan and end date.
- [ ] **Renewals due** for this month looks right to the owner.
- [ ] Go through the "for the client to review" lists. Use **Add payment** on a member's registration where money was actually received.
- [ ] **Joining fees.** The import moved registrations on the old "with Reg." plans onto the plain plans, recording the difference as a joining fee. Totals didn't change.
  - **Plans:** check the **Joining fee** column (per new member) with the owner. Plans that never had a "with Reg." version show **None**, so set the fee on any that should have one.
  - **Break rule:** check the "break of more than 10 days" rule at the top of the page.
  - **Review list:** go through the "joining fee charged to someone who had registered before" list (45 in the October dump). These are re-joining fees or old mistakes; fix any with **Edit** on the registration.
- [ ] Do one real transaction, if a customer is there. If not, use **Members → Add member** to create a test member and then delete them.
- [ ] Explain the income figures (2.1): they are real payments now.

### 2.9 Show the staff (10 min)

- Signing in. The password is asked for every time the app opens.
- **New registration** (top right):
  1. choose the plan
  2. pick existing members, or add new ones; it warns when a phone number is already registered. Each member has a **Joining fee** tick box, with the reason shown. It's ticked for new members. On a **renewal** it's never ticked for existing members: staff tick it if needed, and the app points out anyone back after a break longer than the rule ("Back after a 45-day break · tick to charge it").
  3. enter what they paid
  4. review and save
- **Renewals due / Not renewed:** press **WhatsApp** (or call), then **Renew** or **Dismiss**. Don't delete. The old app lost two years of registration history because registrations were deleted to clear lists.
  - **WhatsApp** first shows the message. Tick the packages to offer this person (for couples, also choose who to send to), then press **Open WhatsApp**. WhatsApp opens with the reminder typed in; read it and press send. The button then says **Messaged**, so nobody messages the same person twice.
- **Member details:** click any name. From there you can add a payment or send a **WhatsApp payment reminder** (… menu on a registration), renew, or edit.
- **Store → Sell.** Choose the member under **Bought by**, or leave it empty for a walk-in. The purchase then shows in the member's details, and the receipt's WhatsApp button goes to them. To change stock, use **Stock** on the product's row: **Stock arrived** adds a delivery, and **Counted the shelf** sets it to what's there. **Edit** no longer changes stock, so a sale made on an instructor's phone meanwhile isn't undone. **Store → Stock changes** lists every delivery and count, with who made it.
- **Instructor phones:** a short notice shows each sale or stock change made on a phone. **Store → Sales** shows who sold each item, in the **By** column.
- **Personal training:** trainers are set up in **Settings → Personal trainers** (the owner ticked as owner, others with their commission %), and the packages under **Personal training → Session types**. **New package** sells one to a member with a current membership, with any payment and a receipt. At check-in, a member with sessions left chooses **Gym workout** or **Personal training with …**; that uses a session. **Personal training → Commission** shows each trainer's commission by month.
- **On credit:** for a member who'll pay later, choose **On credit** when selling (at the desk or on a phone); they must choose the member. Nothing is paid, so there's no receipt and it isn't counted in the takings. **On credit** in the menu lists who owes and for what. **Take payment** takes any amount up to what they owe, and a receipt opens that shows what's left. **WhatsApp** opens a reminder listing the items. The member's details show it too.
- **Door tablet:** members type their mobile number and tap their name. Anyone expired, owing money or with no membership is asked to see the desk. An alert pops up here with an **Open** button; it stays until it's closed.
  - **Check-ins** lists everyone who came in.
  - Use **Check in a member** there, or **Check in** on a member's details, for people who don't use the tablet.
  - **Remove** fixes a wrong tap.
- **Receipts:** after every payment (registration, Add payment, Store sale) the receipt opens. Press **WhatsApp** or **Print**. Payments can be Cash, Card or Bank transfer. Old receipts are under **Payments** (receipt icon on each row).
- **At closing: just close the app.** There's nothing to count or close: the owner's sheet in Google Drive updates as the app closes. **Payments → By day** shows each day's takings by method; the WhatsApp button on a day sends that day's summary to the owner if they ask for it.
- The **backup button** in the top bar, and what an orange banner means (see the handover sheet).

### 2.10 Leave

- [ ] Fill in and hand over `docs/client-handover.md`: password, Google account, your phone number.
- [ ] Keep `final_<stamp>.sql` and `lifestyle-final.db` on your laptop (encrypted disk) for 14 days as a fallback. Delete them on day 14 (§4).

---

## 3. Rollback (only if the new app can't be used)

The old system was only scaled down and its database is untouched. To bring it back exactly as it was at the final dump:

```powershell
fly scale count 1 -a lifestyle-service --yes
fly scale count 1 -a lifestyle-fitness --yes
```

Anything entered in the new app since the switch has to be re-entered in the old one. Fix the problem, then repeat from 2.2.

---

## 4. After go-live

**Days 1–3:**
- [ ] Ask the owner what the top bar says ("Backed up … ago"), or look in the gym's Drive. There should be one new file per day.

**Day 14, if all is well:**
```powershell
fly apps destroy lifestyle-fitness --yes
fly apps destroy lifestyle-service --yes
fly apps destroy lifestyle-fitness-db --yes   # also deletes the pg_data volume
```
- [ ] Check the Fly.io billing page shows nothing left running and no volumes.
- [ ] Delete your copies of the final dump and `.db`, and the earlier dumps in `..\dumps\`.
- [ ] Treat the credentials committed in `user-mgt` as compromised and never reuse them: the database password in `application.properties`, `certs\private.pem`, and the hard-coded login in `SecurityConfig.java`. Deleting the apps and database above makes them useless.

---

## 5. Updating the app later

The installed app updates itself from this repository's GitHub Releases (`AchiGitHub/lifestyle-desktop`, which is public, so the app needs no password to read it).

**At the gym:**
- **Checking:** a couple of minutes after the app opens, and every 4 hours after that, it looks for a newer version. If it finds one, it downloads it quietly.
- **Installing:** the top bar then shows **Update ready – restart**. Staff can press it, and the app closes, updates and reopens in about a minute. Otherwise the update installs when the app is next closed.
- **Data:** a copy is saved first ("Before update" under Settings → Backups on this computer). Database changes apply when the new version opens. `%APPDATA%\Lifestyle` itself is never touched by the installer.
- **Settings → App updates** shows the version, the last check, and a **Check now** button.

**One-time setup on your laptop:**
1. Create a GitHub token: github.com → Settings → Developer settings → **Fine-grained tokens** → *Generate new token*.
   - **Repository access:** only `AchiGitHub/lifestyle-desktop`.
   - **Permissions:** **Contents: Read and write**.
2. Keep it out of the repository. Set it for your Windows user:
   ```powershell
   [Environment]::SetEnvironmentVariable('GH_TOKEN', '<token>', 'User')   # then open a new terminal
   ```
3. Turn on two-step sign-in for the GitHub account. Anyone who can publish a release there can put software on the gym PC.

**Each release:**
```powershell
npm version patch --no-git-tag-version   # 1.0.0 → 1.0.1 (or edit "version" in package.json)
npm test
npm run release                          # builds, then uploads a *draft* release to GitHub
```
1. **Check the draft:** on github.com → the repository → **Releases**, the draft must hold **all three files**: `Lifestyle-Setup-<version>.exe`, its `.blockmap` and `latest.yml`. If the upload stopped partway (the installer is ~120 MB), drag the missing ones in from `dist\` before publishing. Optionally download the installer and try it first.
2. **Publish it:** press **Publish release**. Installed apps pick it up within about 4 hours, or straight away with **Check now**. A draft is never offered to the gym, so nothing goes out until you publish.

**Notes:**
- **First install by hand:** the first version with automatic updates has to be installed by hand once (§2.5). Every version after that arrives by itself.
- **Features to turn on after updating:** **Instructor phones** (1.1.0) is off until someone switches it on in Settings and pairs the phones (§2.7). The owner can do it with the steps in the owner's sheet. The update adds the stock history, "recorded by" columns and the store credit tables to the database when it first opens, after its automatic "Before update" copy. **On credit** needs no setting up: it's in the menu, and the reminder wording is under Settings → WhatsApp reminders. **Personal training** needs the trainers added in Settings and the session types on its page before the first sale; the update adds its tables and the personal-training columns on payments and check-ins.
- **Rolling back:** publish the previous code again under a higher version number (e.g. 1.0.3 containing 1.0.1's code). Apps only move up in version.
- **Download check:** the installer isn't code-signed, so the first manual install shows the Windows "unknown publisher" warning. Automatic updates don't, but the app checks every download against the checksum in `latest.yml` from the same release.
- **Manual fallback:** if the gym PC is offline for a long time, `npm run build:win` still makes an installer you can run by hand, as before.

---

## 6. If the PC dies, is stolen, or is replaced

The data is in the gym's Google Drive, at most a day old.

1. Get any Windows 10/11 PC and install `Lifestyle-Setup-x.y.z.exe` (2.5). Use the same or a newer version than the one that made the backup.
2. Welcome screen → **Restore from Google Drive** → sign in with the gym's Google account → **Restore** the newest backup.
3. Sign in with the **old password**; it comes back with the data.
4. Settings → **Connect Google Drive** if it's not already connected, then **Back up now**.

If the PC still works but the data is damaged or a mistake needs undoing, use **Settings → Backups on this computer**. It keeps one copy per day for two weeks, plus a copy from just before each of the last five restores.

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| **Password forgotten** | Developer only. See below. |
| Banner: *"The Google Drive sign-in has expired"* | Settings → **Disconnect** → **Connect Google Drive** again. If it keeps happening, the consent screen is still in *Testing* mode (1.2, step 3). |
| *"Lifestyle isn't allowed to use Google Drive"* (or *"Request had insufficient authentication scopes"* in older builds) | The Google Drive box was left unticked when connecting. Settings → **Disconnect** → **Connect Google Drive**, and tick the box this time. |
| Banner: backups failing, *"Couldn't reach Google Drive"* | Check the internet, then press **Back up now**. Nothing is lost meanwhile; the daily local copies continue. |
| **WhatsApp** button greyed out | The member's mobile number is missing or not a phone number. Fix it in their details (click the name → Edit). |
| WhatsApp opens in the browser instead of the app | WhatsApp Desktop isn't installed, or isn't linked. See 2.7, *WhatsApp reminders*. |
| Tablet says *"Check-in isn't available right now"* | The PC is off or the app is closed, or the PC's address changed. Open the app and check **Settings → Door check-in tablet** shows **On** with an address. If the address changed, pair the tablet again and reserve the address on the router. |
| Tablet can't open the page at all | Windows Firewall is blocking it, or the network is set to Public. Set the network to **Private**. In *Windows Defender Firewall → Allow an app*, make sure **Lifestyle** is ticked for Private. Also check the tablet is on the same Wi-Fi, not a guest network. |
| Tablet shows *"Pair this tablet"* | It was removed in Settings or its browser data was cleared. Pair it again. |
| *"Port … is already used"* in Settings | Another program uses that port. Change the port in **Settings → Door check-in tablet** (or **Instructor phones**), then pair the tablet or phones again. |
| Instructor's phone says *"Can't reach the front desk computer"* | Same causes as the tablet: the app is closed, the phone isn't on the gym Wi-Fi (or is on a guest network), or the PC's address changed. Check **Settings → Instructor phones** shows **On** with an address. |
| Instructor's phone shows *"Pair this phone"* | It was removed in Settings, or its browser data was cleared. Pair it again under the same name. Its earlier sales keep the name. |
| An instructor's phone is lost, or they've left | **Settings → Instructor phones →** the bin icon next to their name. The phone is locked out at once. Their past sales and stock changes keep their name. |
| A published release doesn't show up in the app | Open the release on GitHub. It needs `Lifestyle-Setup-<version>.exe`, its `.blockmap` and `latest.yml`. **Edit** it and attach the missing files from `dist\`, taken from the same build. Then press **Check now** in Settings → App updates. |
| *"…missing its latest.yml file"* in Settings → App updates | Same fix: the newest release is incomplete. |
| *"Add the owner's WhatsApp number…"* on Payments → By day | Settings → **Receipts** → owner's WhatsApp number → **Save**. |
| Owner's sheet not updating (*"The last update failed"* in Settings → Owner's daily summary) | Same causes and fixes as the Drive backup rows above; then press **Update now**. If someone deleted the sheet, the app makes a new one and shares it again (the owner gets a new link). |
| Owner didn't get the sheet's link | Check the address in Settings → **Owner's daily summary**, and their spam folder. Or open the sheet with **Open in Google Sheets** and use Google's **Share** button. |
| Receipt prints too small or too wide | The layout is a 72 mm slip. Once the printer is known, the width can be adjusted in `src/main/print/html.ts`. |
| Dates or "expiring" a day off | The Windows time zone or clock is wrong (2.6, step 3). |
| App window doesn't open or is quarantined | Antivirus. Restore the file and add an exclusion for `%LOCALAPPDATA%\Programs\Lifestyle`. |
| "Couldn't open the file" / "This isn't a Lifestyle database" when restoring | Wrong file. Backups are the `lifestyle_….db` files from Drive or `%APPDATA%\Lifestyle\backups`. |
| "This backup was made by a newer version of the app" | Install the latest installer first, then restore. |

**Resetting a forgotten password.** This keeps all the data; only the password is removed.

1. Close the app.
2. Open PowerShell in the folder holding `sqlite3.exe` and run:
   ```powershell
   .\sqlite3.exe "$env:APPDATA\Lifestyle\lifestyle.db" "DELETE FROM settings WHERE key='auth.passwordHash';"
   ```
3. Open the app. It shows **Choose a password**; set a new one.

**Where things are on the gym PC:**

| What | Where |
|---|---|
| Data | `%APPDATA%\Lifestyle\lifestyle.db` |
| Daily local backups | `%APPDATA%\Lifestyle\backups\` |
| Google sign-in and backup status | `%APPDATA%\Lifestyle\config.json` (the sign-in is encrypted for this PC and user) |
| The app itself | `%LOCALAPPDATA%\Programs\Lifestyle\` |
