# Catat 999 — testing report

What was checked before release, what was found, and what was fixed. Every bug in the tables below has a test that keeps it fixed.

## How it was tested

| Layer | Tool | What it does |
|---|---|---|
| Backend examples | `tests/backend.test.js` (36) | Login, passwords, sessions, add / change / delete, duplicates, 3-day rule, month tabs, sheet edits |
| Backend edge cases | `tests/backend.edge.test.js` (27) | Exact limits and boundaries (60/400 days, 3 days, 8–64-char IDs, 30-char invoices, 100-char passwords …) |
| Backend snapshot | `tests/backend.snapshot.test.js` (121 results) | One long "day in the life" with a frozen clock. Every answer, message, cell, colour and log line is compared with an approved copy. |
| Backend properties | `tests/backend.property.test.js` (11) | Thousands of random inputs and random action sequences (fast-check). Rules that must always hold: no formulas get in, totals add up, the log is complete … |
| App logic | `tests/app-logic.test.js` (141) | Amount in words, supplier search and typos, form rules, dates, Riwayat totals and cache |
| App click-through | `tests/ui.test.js` (72) | Full flows on a phone (360×740) and a laptop (1366×768) |
| Screen walkthrough | `tests/ui-walkthrough.js` | Every screen at 320 / 360 / 412 px and on a laptop: overflow, cut-off text, tap-target size, axe-core accessibility, screenshots |
| Keyboard | `tests/ui-keyboard.test.js` (12) | Ibu on a laptop with keyboard only: Tab / Enter / Escape, dialogs keep focus |
| App plumbing | `tests/app-flows.test.js` (110) | Talking to the server, sending waiting entries, saving from Cek Lagi, deferred logouts, double taps, with every server answer scripted |
| Regressions | `tests/ui-regressions.test.js` (6) | The app bugs found below stay fixed |
| Hand edits | `tests/backend.sheet.test.js` (20) | Ibu editing the Sheet: pasted rows, typed dates/amounts, moved months, who edited, tab rebuilding |
| Demo = real | `tests/contract.test.js` (51) | Demo mode answers exactly like the real backend, so app tests mean something |
| End-to-end | `tests/e2e-real-backend.test.js` (22) | The real app (not demo) against the real backend code: save, duplicate, offline, server hiccup, edit, delete |
| Monkey | `tests/ui-monkey.js` | A "random user" taps, types junk, presses back and switches the internet on and off, with sanity checks after every step. 1,800+ steps per run. |
| **Requirements** | `tests/acceptance.backend.test.js` (43) + `tests/acceptance.ui.test.js` (57) | One check per requirement in [REQUIREMENTS.md](REQUIREMENTS.md), on the backend and on a phone with the real app and backend |
| Mutation testing | Stryker (`npm run mutate:backend` / `mutate:app`) | Plants deliberate small bugs in the code and checks whether the tests notice |

## Bugs found and fixed

### Found by the QA bug hunt (QA Bug Hunter)
| # | Bug | Severity | Fixed by |
|---|---|---|---|
| 1 | Logging out ended **another** worker's session, while the one who logged out stayed logged in | High | Sessions are read without skipping blank rows, so row numbers stay correct |
| 2 | Entries saved offline were sent under the **next** user's name after logout/login on the same phone | High | Each waiting entry remembers who recorded it and is sent with their session |
| 3 | A temporary server refusal (busy, too many at once) turned waiting entries into "maybe a duplicate" with no retry | High | Only real duplicates ask a person; anything temporary retries a minute later |
| 4 | "Hari ini" used the phone's clock, and cheap phones are often set to the wrong date | Medium | Uses the server's date and warns "Tanggal di HP ini salah" |
| 5 | Anyone with the public link could lock every worker out with 30 wrong passwords | Medium | Shop-wide failures now only slow logins down; there's a hard stop at 300, and each phone still gets a 15-minute pause after 5 wrong tries |
| 6 | A tab Ibu made herself named like a month (e.g. `NOV 2026`) would be overwritten | Medium | It's renamed `NOV 2026 (lama)` instead |
| 7 | "Last used" time was saved on the wrong session row | Medium | Same fix as #1 |
| 8 | Copy-pasting a row in Data duplicated its hidden ID | Low | The pasted copy gets a new ID wherever it's pasted |
| 9 | A worker couldn't fix the amount of an entry whose date had become just over 60 days old, even within the 3-day window | Low | An unchanged date isn't re-checked |
| 10 | Rows Ibu adds by hand were written back whole, which could turn `'+62…` or `'=…` into a number or formula | Medium | Only the cells the script fills are written |
| 11 | Phones could keep using an old cached `config.js` (demo mode) after the real link was set | Medium | Network-first for `config.js` and the page |

### Found by property and snapshot tests
- A note starting with an apostrophe lost it.
- Text ending in a space after cutting to the length limit.
- A name like `+ -` became `-`.
- Non-text values (objects) crashed the cleaners.
- **Adding** a transaction wasn't written to the Log.
- Editing an already-deleted entry showed the wrong message.
- Dates and amounts typed as text in the Sheet stayed text.
- Impossible dates like `31/02` were accepted when typed by hand.

### Found by the contract and end-to-end tests
- Demo mode accepted or refused different things than the real server:
  - lower-case pay sources;
  - `Lainnya : name`;
  - impossible dates;
  - an empty password;
  - editing a deleted entry.

  The app's demo-mode tests could therefore pass while real use behaved differently. Demo mode now uses the same rules.
- If Google ever answered with an error or login page instead of data, the app said "no internet" and **dropped the new entry**. It now keeps the entry and retries (same ID, so it's never saved twice), with a clear message.
- A test depended on the time of day (it failed just after midnight). The demo data was fixed.

### Found by reading the code overnight
- **Two workers logging in at the same moment** could overwrite each other's session (written at "last row + 1" without a lock). Sessions are now appended atomically.
- **Editing an old entry:** the server allowed fixing the amount when the date was unchanged but older than 60 days, while the app still refused it. The app now uses the same rule.
- **Pay sources typed by hand:** editing an entry whose pay source Ibu typed in the Sheet (e.g. "Cash") failed only at the server. The app now asks for it again.
- **Session expiring mid-form:** the half-filled form was lost. Now, after logging in again, the form is still there.
- **"Perlu dicek" banner:** it said "maybe a duplicate" even for entries the server had refused for another reason.
- **After saving:** the done screen showed what the phone sent, not what the server stored (cleaned supplier name).

### Found by mutation testing and reading the code (morning of 3 Nov)
- **Riwayat stuck loading:** opening a 4th older month loaded it and threw it away at once (the phone keeps 3 months), so the spinner never ended.
- **Double login:** pressing Enter again while logging in sent a second login, using up the 5 tries twice as fast.
- **Double delete:** tapping another reason while a delete was running sent a second delete.
- A background refresh redrew the home screen under an open dialog, so focus couldn't return to the button.
- Edited entries showed "Diubah oleh" without the time until the next refresh.

### Found by the code review (two independent reviewers)
- A deferred logout never finished if the waiting entry was thrown away.
- The server-date correction stayed active after the phone clock was fixed (it's now trusted for 12 h only).
- Hand-typed shorthand like `50rb` became Rp 50 (it now stays as typed so it's visibly wrong).
- Entries queued by the old version had no owner.

### Found by the screen walkthrough, monkey and accessibility reviews (A11y Enforcer, Design)
**Riwayat (history):**
- Offline it showed "Rp 0 / no transactions" instead of "couldn't load".
- It never refreshed once the internet came back.
- It reopened on an old month.

**Small screens and layout:**
- On 320 px phones, amounts and placeholders were cut off.
- Several tap targets were under 44 px.
- Faint text failed contrast checks, and so did the borders around input boxes.

**Forms and controls:**
- Inputs had no real labels.
- A tap on "+ Tambah" could land on the pinned "Lanjut" button.

**Pop-up dialogs:**
- They didn't take focus, didn't close with Escape, and didn't return focus to the button that opened them.

**Screen readers:**
- Screen changes weren't announced.
- Calendar days were read as bare numbers.

**Duplicates:**
- The duplicate warning in Riwayat made "save anyway" the main button. It's now "Buang, sudah dicatat".

## Mutation testing scores
Stryker plants small deliberate bugs, such as flipping a `<`, deleting a line or emptying a message, and runs the tests to see which bugs they catch. Low scores pointed to the weakest tests. Each gap was closed with new checks, and the run was repeated.

| Part | First run | Final |
|---|---|---|
| Backend (`Code.gs`, 2,029 planted bugs) | 56% | **91%** |
| App: rules, search, dates, cache (`app.js`) | 52% | **82%** (more checks were added after this run) |
| App: talking to the server, waiting entries (`app.js` `api` / `flush`) | 44% | **88%** |
| App: saving from Cek Lagi (`app.js` `doSave` / `saved`) | 52% | **93%** |

The bugs the tests still miss are mostly harmless. Some behave the same as the real code, such as a pattern missing its start anchor where a later check rejects the input anyway. Others are wording or timer details that don't change what a worker can do.

## Still to check by hand
These need the real environment and can't be tested here:
- **Real Google Sheets:** run `setup` once on a real Sheet and do one entry from a phone. The mock behaves like Sheets, but it isn't Sheets.
- **Screen reader:** give the app a quick try with TalkBack on an Android phone.
