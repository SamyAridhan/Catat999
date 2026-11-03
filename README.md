# Catat 999

A phone app (PWA) for 999 Mart workers to record **payments that have already happened**: supplier invoices paid by Ibu's transfer, and cash purchases (rokok, roti, galon…). Each entry lands in a Google Sheet, sorted into monthly tabs with daily totals, which Ibu uses as her reference for the month-end books.

The current workflow stays the same: notebook → photo to Ibu → Ibu transfers → proof shown to the sales rep. The app only replaces the last step, **typing it into the spreadsheet**.

```
Phone / laptop (PWA, Bahasa Indonesia)
        │  HTTPS POST (JSON)
        ▼
Google Apps Script web app ──writes──▶ Google Sheet (your Drive)
                                       ├─ NOV 2026, OKT 2026, …  ← one tab per month, newest on the far left
                                       ├─ Data      ← every transaction (source of truth; Ibu may edit)
                                       ├─ Supplier  ← one spelling per supplier
                                       ├─ Log       ← who added / changed / deleted what, and when
                                       ├─ Arsip     ← rows older than ~15 months, moved automatically (keeps saves fast)
                                       └─ Sesi (hidden) ← login sessions
```

There's no server and nothing to pay for. The web files are static (GitHub Pages), and the backend is the Apps Script attached to the Sheet.

## What the app does

| | |
|---|---|
| **Masuk** | Type your name (anything; remembered on the phone) and the shared **worker password**. Ibu uses the **admin password**. |
| **Catat Transaksi** | Nama PT / Barang (search the list; typos still find it) · No. Invoice *(opsional)* · Nominal (with the amount spelled out) · Bayar pakai: Transfer Ibu / Uang Kasir / Modal / Lainnya · Tanggal: **Hari ini** / **Kemarin** / **Pilih tanggal** (big calendar) · Catatan *(opsional)* → **Cek lagi** → **Simpan** |
| **Riwayat Transaksi** | Month by month (‹ ›), search by supplier or invoice number, daily totals. Tap an entry to see who recorded it and when. |
| **Ubah / Hapus** | Workers can change or delete an entry up to **3 days after it was recorded**. Ibu can change anything. Deleting needs a reason. Deleted rows are kept, marked `DIHAPUS`, and logged. |
| **No internet** | New entries wait on the phone ("Belum terkirim") and are sent automatically when the signal returns. They stay credited to whoever recorded them, even if someone else logs in on that phone. A temporary refusal from the server (busy, too many at once) just retries a minute later; only a likely duplicate asks a person ("Perlu dicek"). |
| **Wrong phone date** | "Hari ini" follows the server's date. If the phone's date is wrong, the home screen says so. |

Mistakes it prevents:
- **Supplier spelled 20 different ways.** You pick from the list. A new name that looks like an existing one asks "Maksudnya yang ini?"
- **Same invoice entered twice.** Leading zeros are ignored when comparing invoice numbers. A missing invoice number with the same supplier, date and amount is also caught.
- **Day/month swapped.** Dates are tapped, not typed.
- **Hand-made monthly tabs and hand-added totals.** The script builds and totals them.

## Setup (about 30 minutes, once)

### 1. Google Sheet and backend
1. In Google Drive, create a new **Google Sheet**, e.g. `Catat 999 — 999 Mart`.
2. Open **Extensions → Apps Script**. Delete the sample code, then:
   - paste `apps-script/Code.gs` into `Code.gs`;
   - click **+ → Script**, name it `Seed`, and paste `apps-script/Seed.gs`;
   - in **Project Settings (gear)**, tick **Show "appsscript.json"**, then replace that file's contents with ours (this sets the WIB timezone).
3. Pick the function **`setup`** and click **Run**. Google asks for permission: **Review permissions → your account → Advanced → Go to … (unsafe) → Allow**. ("Unsafe" only means Google hasn't reviewed a script you wrote yourself.)
4. Reload the Sheet. A **Catat 999** menu appears:
   - **Atur kata sandi pekerja**: one password shared by all workers, at least 8 characters.
   - **Atur kata sandi admin (Ibu)**: must be different from the worker password.

   Nobody can log in until both are set. There are no default passwords.
5. Open **Deploy → New deployment → Web app**. Set Execute as **Me** and Who has access **Anyone**, click **Deploy**, then copy the URL ending in `/exec`.

### 2. The app (GitHub Pages)
1. Put the URL in `web/config.js`:
   ```js
   window.CATAT_CONFIG = { API_URL: 'https://script.google.com/macros/s/XXXX/exec' };
   ```
2. Push to GitHub. The included workflow (`.github/workflows/pages.yml`) publishes the `web/` folder.
3. On GitHub, go to **Settings → Pages → Source: GitHub Actions**. After a minute the app is at `https://<user>.github.io/<repo>/`.
4. On each phone, open the link in **Chrome → ⋮ → Tambahkan ke layar utama**. Log in once; the phone stays logged in for 90 days.

### Try it without any setup
Open `index.html?demo=1`, or leave `API_URL` empty. Data stays in that browser only. The demo passwords are `toko12345` (worker) and `ibu12345` (Ibu).

## The Sheet

**Monthly tab** (e.g. `NOV 2026`). It is created on the first save for that month and placed on the far left:
- **Row 1:** the title.
- **Rows 2–3:** the summary (Total · Transfer Ibu · Uang Kasir · Modal · Lainnya · number of transactions).
- **Below that:** every transaction by date, with a shaded **Total dd/mm** row per day.
- **At the bottom:** **TOTAL PER SUPPLIER**.

The monthly tab is read-only in practice, because it is rebuilt automatically. Edit **Data** instead.

**Editing by hand (Ibu, on the laptop).** The **Data** tab can be edited normally. It shows a warning first, which is expected.
- **Fix a cell:** the monthly tab refreshes by itself, and the change is written to **Log** as "Ubah manual".
- **Add a row:** fill in Tanggal (dd/mm/yyyy), Nama, Nominal and Bayar Pakai. The script fills in ID, Dicatat Oleh = `MANUAL`, Waktu Catat and Status. A date or amount typed as text ("3/11/26", "Rp 45.500") is turned into a real date or number.
- **Copy a row:** fine. The copy gets its own new ID, so the app can tell the two apart.
- **Who changed what:** every hand edit is written to **Log** under the Google account that made it.
- **Delete a transaction:** prefer typing `DIHAPUS` in **Status**, which keeps a record. Deleting the whole row also works.
- **If something looks out of date:** use the menu **Catat 999 → Perbarui semua tab**.
- **Your own tabs are safe.** If a tab you made has a month-style name the app wants (e.g. `NOV 2026`), the app renames yours to `NOV 2026 (lama)` instead of overwriting it.

**Supplier tab:** set **Aktif** to `TIDAK` to hide a name from the app's list.

**Arsip tab (automatic).** Every save reads the whole Data tab, so Data is kept small. On the 1st of each month, around 03:00, rows older than about 15 months move to **Arsip**. That's this month plus the 14 before it, which is past every limit: nobody can add or change entries that old from the app. Nothing is lost:
- Month tabs stay as they are.
- Riwayat still shows those months (read-only).
- **Catat 999 → Perbarui semua tab** rebuilds from Data and Arsip together.

Ibu doesn't need to do anything. **Catat 999 → Pindahkan data lama ke Arsip** runs the same move by hand. If an archived row ever needs fixing, change it in Arsip, then run *Perbarui semua tab*.

## Security
- **Passwords.** Only salted, iterated SHA-256 hashes are stored, in Script Properties, never in the Sheet or the code.
  - Five wrong tries from one phone lock that phone out for 15 minutes.
  - After 30 wrong tries in total (from anywhere), every login is slowed down. That way a stranger can't lock the whole shop out. A hard stop only kicks in at 300.
  - Every wrong try is slowed down and written to the Log.
- **Sessions.** Each login gets a random 256-bit token. Only its hash is stored, and it expires after 90 days.
  - Changing a password, or **Catat 999 → Keluarkan semua HP**, logs every phone out.
- **Every request is checked on the server.** Login, role, the 3-day edit window, date range, amount limit, allowed characters and the action whitelist are all enforced there. The app's own checks are only for convenience.
- **Injection.** Text that starts with `= + - @` is stored as plain text, so it can't run as a Sheet formula. The app escapes everything it displays, has a strict Content-Security-Policy, and loads no third-party scripts.
- **Abuse limits.** Writes are limited to 20 per minute per login, request size is capped, and a script lock prevents two saves colliding. Every entry has a unique ID, so an offline resend can't create a duplicate.
- **Minimal data.** No bank account numbers or ID numbers are handled. The app only receives supplier names and your own transactions.
- **Who can see what.** Anyone the Sheet is shared with can see everything in it, so share it only with Ibu. `config.js` holds the web-app URL, which is not a secret by itself, but keep the repo private if you prefer.

## Updating later
- **Backend:** edit the code, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.
- **App:** change the files and push to `main`. Each publish stamps a new version, and installed phones update by themselves: when the app comes back to the front, or within 30 minutes. It never reloads in the middle of a form, and it shows *"Aplikasi sudah diperbarui ✓"*.

## Limits
- Workers can date an entry up to 60 days back; Ibu, up to about 13 months. No future dates.
- The maximum is Rp 500.000.000 per entry. Rp 20 juta and above gets a "check the zeros" warning.
- A save takes a few seconds while the month tab is rebuilt. Data never grows past about 15 months (see **Arsip tab**), so saves don't get slower as the years pass.

## Tests
```
npm install                              # dev tools only (Stryker, fast-check, axe-core); playwright is assumed installed
npm run test:backend                     # Code.gs on an in-memory Sheet: examples, edge cases, hand edits, golden snapshot,
                                         # random properties, demo-vs-real contract
node tests/contract.test.js               # demo mode answers exactly like the real backend (so app tests mean something)
npm run test:acceptance                  # one check per requirement (docs/REQUIREMENTS.md): backend + a phone walk-through
node tests/app-flows.test.js             # talking to the server, waiting entries, saving, double taps (server answers scripted)
node tests/app-render.test.js            # what each screen is made of (fields, labels, buttons, waiting list, toasts)
node tests/app-logic.test.js             # the app's own logic in a real browser (amount in words, search, validation, cache)
node tests/e2e-real-backend.test.js      # the real app (not demo) against the real Code.gs: save, offline, edit, delete
node tests/ui.test.js /tmp/shots         # click-through on a phone (360×740) and a laptop (1366×768)
node tests/ui-regressions.test.js        # bugs found by the QA hunt stay fixed
node tests/ui-keyboard.test.js           # keyboard-only use (Tab / Enter / Escape, dialogs keep focus)
node tests/ui-walkthrough.js /tmp/walk   # every screen at 320/360/412 px and laptop: overflow, cut-off text,
                                         # tap targets, accessibility (axe-core); screenshots to review
node tests/ui-monkey.js 300 6            # "random user": taps, junk typing, back button, internet on/off
npm run mutate:backend                   # mutation testing (Stryker): how many deliberate bugs the tests catch
npm run mutate:app
```
Reports land in `reports/mutation/*.html`. To approve a deliberate change to the backend's behaviour, run the snapshot test with `UPDATE_SNAPSHOT=1` and review the diff of `tests/snapshots/backend-scenario.json`.

## Files
```
apps-script/Code.gs          backend: API, security, validation, monthly tabs, triggers, menu
apps-script/Seed.gs          124 supplier names, one spelling each, from the 2025–26 ledgers
apps-script/appsscript.json  WIB timezone, web-app settings
web/                         the PWA (published by GitHub Pages)
docs/PANDUAN-PEKERJA.md      one-page guide for workers (Bahasa Indonesia)
tests/                       backend + UI tests
```
