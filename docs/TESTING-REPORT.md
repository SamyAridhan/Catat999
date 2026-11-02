# Catat 999 — testing report

What was checked before release, what was found, and what was fixed. Every bug in the tables below has a test that keeps it fixed.

## How it was tested

| Layer | Tool | What it does |
|---|---|---|
| Backend examples | `tests/backend.test.js` (36) | Login, passwords, sessions, add / change / delete, duplicates, 3-day rule, month tabs, sheet edits |
| Backend edge cases | `tests/backend.edge.test.js` (27) | Exact limits and boundaries (60/400 days, 3 days, 8–64-char IDs, 30-char invoices, 100-char passwords …) |
| Backend snapshot | `tests/backend.snapshot.test.js` (121 results) | One long "day in the life" with a frozen clock. Every answer, message, cell, colour and log line is compared with an approved copy. |
| Backend properties | `tests/backend.property.test.js` (11) | Thousands of random inputs and random action sequences (fast-check). Rules that must always hold: no formulas get in, totals add up, the log is complete … |
| App logic | `tests/app-logic.test.js` (134) | Amount in words, supplier search and typos, form rules, dates, Riwayat totals and cache |
| App click-through | `tests/ui.test.js` (72) | Full flows on a phone (360×740) and a laptop (1366×768) |
| Screen walkthrough | `tests/ui-walkthrough.js` | Every screen at 320 / 360 / 412 px and on a laptop: overflow, cut-off text, tap-target size, axe-core accessibility, screenshots |
| Keyboard | `tests/ui-keyboard.test.js` (12) | Ibu on a laptop with keyboard only: Tab / Enter / Escape, dialogs keep focus |
| Regressions | `tests/ui-regressions.test.js` (5) | The app bugs found below stay fixed |
| Monkey | `tests/ui-monkey.js` | A "random user" taps, types junk, presses back and switches the internet on and off, with sanity checks after every step. 1,800+ steps per run. |
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
| Part | First run | Now |
|---|---|---|
| Backend (`Code.gs`) | 56% | see final run below |
| App (`app.js`) | — | see final run below |

## Still to check by hand
These need the real environment and can't be tested here:
- **Real Google Sheets:** run `setup` once on a real Sheet and do one entry from a phone. The mock behaves like Sheets, but it isn't Sheets.
- **Screen reader:** give the app a quick try with TalkBack on an Android phone.
