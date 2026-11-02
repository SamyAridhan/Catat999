# Catat 999: requirements and the tests that check them

Every requirement has an acceptance check. **R##** checks run against the backend and the Sheet (`tests/acceptance.backend.test.js`). **U##** checks walk through the real app on a phone, talking to the real backend (`tests/acceptance.ui.test.js`). The other suites test the same things in more detail, including edge cases, random inputs and keyboard use. They're listed under "Also" by suite name.

Run both: `npm run test:acceptance`

## Purpose
Workers record **payments that have already happened** (supplier invoices paid by Ibu's transfer, cash purchases). The notebook, the photo to Ibu, the transfer and the proof for the sales rep stay as they are. The app only replaces typing the payment into the lobby PC's spreadsheet. Each entry lands in Ibu's Google Sheet, sorted into monthly tabs with totals she uses for the month-end books.

## Login and sessions
| # | Requirement | Check | Also |
|---|---|---|---|
| 1 | No default passwords: nobody can log in until both passwords are set | R01 | backend |
| 2 | One shared worker password and a separate admin password for Ibu: at least 8 characters, different from each other, set from the Sheet's Catat 999 menu | R02 | snapshot, edge |
| 3 | Passwords are never stored readable (salted, iterated hashes in Script Properties only) | R03 | backend |
| 4 | A worker logs in with their own name plus the worker password; Ibu gets the admin role | R04, U02, U21 | backend, e2e |
| 5 | Wrong password: a clear message, logged; 5 wrong tries lock that phone for 15 min (other phones unaffected) | R05, U02 | backend, edge |
| 6 | A stranger can't lock the whole shop out: shop-wide failures only slow logins down (hard stop at 300) | R06 | backend, snapshot |
| 7 | The phone stays logged in (90 days of non-use logs it out); only a hash of the session token is stored | R07, U03 | backend, property |
| 8 | Logging out ends only that phone's session | R08 | regressions F5 |
| 9 | "Keluarkan semua HP" or a password change logs every phone out | R09 | backend |
| 10 | The phone remembers the last names used (one tap to fill in) | U19 | ui |

## Supplier names
| # | Requirement | Check | Also |
|---|---|---|---|
| 11 | 123 known suppliers are there from day one, one spelling each | R10 | backend |
| 12 | The list holds names only: no bank account or ID numbers | R11 | — |
| 13 | Search finds names despite typos | U04 | app-logic |
| 14 | A known name typed differently is stored with its one spelling | R12, U11 | backend, contract |
| 15 | A new name is added with "+ Tambah" and joins the list; if it looks like an existing one, the app asks "Maksudnya yang ini?" | R12, U11, U12 | ui, app-logic |
| 16 | Ibu can hide a name (Aktif = TIDAK) | R13 | backend |

## Recording a payment
| # | Requirement | Check | Also |
|---|---|---|---|
| 17 | Fields: name, invoice (optional), amount, pay source, date, note (optional) → Cek Lagi → Simpan | R14, R15, U08, U09 | ui, e2e |
| 18 | Required fields are marked "Wajib diisi" | R17, U05 | app-logic, render |
| 19 | The amount is spelled out in words, so wrong zeros are easy to spot | U06 | app-logic |
| 20 | Rp 20 juta and above shows a "Nominal besar" warning; Rp 500 juta is the maximum | R18, U13 | ui, edge |
| 21 | Pay source: Transfer Ibu / Uang Kasir / Modal, or Lainnya with whose money | R16, U12 | contract, edge |
| 22 | Dates are tapped, not typed: Hari ini, Kemarin, calendar; never in the future; workers ≤ 60 days back, Ibu ≤ 400 | R19, U07, U21 | edge, app-logic |
| 23 | Invoice numbers: letters, digits, `- / .`, at most 30 characters | R20 | edge |
| 24 | Saved entries go to Data with who recorded them and when, and to the Log | R14, U09 | backend, snapshot |
| 25 | "Kembali" from Cek Lagi keeps everything filled in | U13 | ui |

## Duplicates
| # | Requirement | Check | Also |
|---|---|---|---|
| 26 | Same supplier + same invoice (leading zeros ignored) → warning showing the existing entry | R21, U10 | backend, contract |
| 27 | No invoice + same supplier, date and amount → warning | R22, U10 | backend |
| 28 | "Jangan simpan" saves nothing; "Beda transaksi, tetap simpan" saves and the Log says so | R21, U10 | flows, e2e |
| 29 | A resend (e.g. after a lost answer offline) never saves twice | R23 | property, e2e |

## The Sheet
| # | Requirement | Check | Also |
|---|---|---|---|
| 30 | One tab per month, made on the first save, newest on the far left | R24, R25 | sheet, snapshot |
| 31 | Month tab: title, totals per pay source + count, daily totals, totals per supplier | R24 | snapshot |
| 32 | Ibu's own tabs are never overwritten (renamed "(lama)") | R26 | sheet |
| 33 | Fixing a cell in Data updates the month tab and logs who did it ("Ubah manual") | R33 | sheet |
| 34 | A row added by hand gets ID, MANUAL, time and status; typed text dates/amounts become real ones; shorthand like "50rb" stays visibly wrong | R34, R35 | sheet |
| 35 | A copied row gets its own ID | R36 | sheet |
| 36 | Typing DIHAPUS in Status removes it from the totals | R37 | sheet |
| 37 | "Perbarui semua tab" rebuilds every month tab | R38 | sheet |

## Riwayat, change and delete
| # | Requirement | Check | Also |
|---|---|---|---|
| 38 | Month by month (no future months), newest first, month total, daily totals | R27, U14 | app-logic, render |
| 39 | Search by supplier name or invoice number | U14 | app-logic |
| 40 | Tap an entry to see who recorded it and when | R27, U15 | render |
| 41 | Workers can change or delete any entry up to 3 days after it was recorded; after that only Ibu can, and the app says so | R28, R29, R30, U15, U21 | backend |
| 42 | Changes are logged before → after; "diubah" marks what changed before saving | R28, U16 | e2e |
| 43 | Moving an entry to another month updates both month tabs | R31 | backend |
| 44 | Delete needs a reason; the row is kept as DIHAPUS, logged, and leaves the totals | R32, U17 | backend, e2e |

## No internet, wrong phone date
| # | Requirement | Check | Also |
|---|---|---|---|
| 45 | No internet: the entry waits on the phone ("Belum terkirim") and is sent automatically, exactly once | U18 | e2e, flows, monkey |
| 46 | A waiting entry stays credited to whoever recorded it, even if someone else logs in | U18 | regressions F3 |
| 47 | Temporary server trouble retries a minute later; only a likely duplicate asks a person ("Perlu dicek") | — | flows, regressions F1 |
| 48 | Wrong phone date: "Hari ini" uses the server's date and home says "Tanggal di HP ini salah" | U22 | regressions F2, F4 |
| 49 | Leaving a half-filled form asks first; a session that expires mid-form keeps the form | U20 | regressions F6 |

## Security
| # | Requirement | Check | Also |
|---|---|---|---|
| 50 | Text that looks like a formula is stored as plain text | R39 | property |
| 51 | Typed text is shown as text, never run as code | U15 | render |
| 52 | The server checks everything (login, role, dates, amounts, characters, actions, size), whatever the app sends | R16–R20, R40 | property, edge |
| 53 | At most 20 saves per minute per login | R41 | backend |
| 54 | Server errors never show internal details | R42 | backend |
| 55 | Every addition, change, deletion, login, failed login and hand edit is in the Log | R43 | snapshot |

## Phones and laptop
| # | Requirement | Check | Also |
|---|---|---|---|
| 56 | Indonesian, made for budget Android phones (320–412 px), also usable on Ibu's laptop | U01, U23 | walkthrough, keyboard |
| 57 | Installable, and opens without internet once visited | U24 | — |
| 58 | Usable with a screen reader and keyboard (labels, focus, contrast, tap sizes) | U05 | walkthrough (axe), keyboard |
| 59 | No JavaScript errors anywhere | U25 | all browser suites |

Still checked by hand only: the real Google Sheet (run `setup` once, do one entry from a phone) and a quick try with TalkBack.
