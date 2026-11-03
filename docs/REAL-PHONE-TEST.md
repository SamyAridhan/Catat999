# Catat 999: real-phone test checklist

The things automated tests can't check: the real Google Sheet, real phones and real signal. Allow about 30 minutes. You need the Sheet set up (README → Setup), plus 2 Android phones (or 1 phone and a laptop).

Tick each box. If something doesn't match **"You should see"**, note the step number and take a screenshot.

## A. The Sheet (laptop, once)
1. **Setup**
   - [ ] Run `setup`, then reload the Sheet.
   - You should see: tabs **Data, Supplier, Log** and a **Catat 999** menu. Supplier has **124** names.
2. **Passwords**
   - [ ] Set both passwords from the menu, using the same one for both first.
   - You should see: it refuses (*"harus berbeda"*). With different passwords it says *"Kata sandi disimpan"*.
3. **Triggers**
   - [ ] Apps Script → **Triggers** (clock icon).
   - You should see: 3 triggers: `onDataEdit`, `onDataChange`, `archiveOld` (monthly).

## B. One phone, normal use
4. **Install**
   - [ ] Open the link in Chrome → ⋮ → *Tambahkan ke layar utama*, then open it from the icon.
   - You should see: it opens full screen, with no "MODE COBA" bar.
5. **Login**
   - [ ] Enter a wrong password, then the right one.
   - You should see: *"Kata sandi salah."*, then home with your name on top.
6. **First payment**
   - [ ] Catat Transaksi → type `yafindo` → pick it → invoice `TEST1` → amount `250000` → Transfer Ibu → Lanjut → Simpan.
   - **Time the save** from tapping Simpan until ✓ (write it here: ____ s).
   - You should see: *"Berhasil disimpan"*.
   - In the Sheet: a row in **Data**, a new month tab (e.g. `NOV 2026`) on the far left with the right total, and a *Tambah* line in **Log**.
7. **Typos**
   - [ ] Type `roti daylis`.
   - You should see: **ROTI DAILYS** offered.
   - [ ] Then type `setor rokok`.
   - You should see: **SETOR ROKOK** first, never plain ROKOK.
8. **Keyboard**
   - [ ] On the form, tap the Nominal box.
   - You should see: the number keyboard, and the box not hidden behind it.
   - [ ] Tap Catatan.
   - You should see: you can still see what you're typing.
9. **Duplicate**
   - [ ] Enter step 6 again, same invoice `TEST1`.
   - You should see: *"Invoice ini sudah pernah dicatat"*. Tap **Jangan simpan**, and nothing new appears in Data.

## C. No signal
10. **Offline save**
    - [ ] Turn on airplane mode → record ROKOK Rp 50.000 → Simpan.
    - You should see: ⏳ *"Belum terkirim"*. Home shows *"1 transaksi belum terkirim"*.
11. **Back online**
    - [ ] Turn airplane mode off and wait up to a minute (or tap *Kirim sekarang*).
    - You should see: the banner disappears, and **one** ROKOK row is in Data, not two.
12. **Close while offline**
    - [ ] Airplane mode on → record something → **close the app completely** (swipe it away) → airplane mode off → open the app.
    - You should see: it is sent once.

## D. Two phones at once
13. **Same invoice**
    - [ ] Log in on both phones with different names. Both record invoice `TEST2` from the same supplier, then tap Simpan at the same moment.
    - You should see: **one** row saved. The other phone says *"Invoice ini sudah pernah dicatat … oleh <name>"*.
14. **Shared phone**
    - [ ] Phone A, airplane mode on → record GALON → Keluar → log in as someone else → airplane mode off.
    - You should see: the GALON row in Data shows the **first** person under *Dicatat Oleh*.

## E. Ibu
15. **Change**
    - [ ] Log in with the admin password → Riwayat → tap an entry → Ubah → change the amount → Simpan.
    - You should see: *"Perubahan disimpan"*. In Data the new amount shows *Diubah Oleh* IBU, and the Log shows old → new.
16. **Delete**
    - [ ] Hapus → *Tercatat dua kali*.
    - You should see: it's gone from Riwayat. In Data it's marked `DIHAPUS`, and the month total drops.
17. **Hand edit**
    - [ ] In the Sheet, change an amount in **Data** by hand.
    - You should see: a warning first (expected). The month tab total updates by itself, and the Log says *Ubah manual* with your Google account.
18. **Archive**
    - [ ] Menu → *Pindahkan data lama ke Arsip*.
    - You should see: *"Belum ada data lama untuk dipindah"*, which is right for a new Sheet.

## F. Phone date and screen reader
19. **Wrong date**
    - [ ] Settings → set the phone's date to tomorrow → open the app.
    - You should see: *"Tanggal di HP ini salah"* on home, and *Hari ini* in the form still shows the real date. Then set the date back.
20. **TalkBack**
    - [ ] Settings → Accessibility → TalkBack on. Swipe through home and the form.
    - You should hear: every button and box named in Indonesian (e.g. *"Nama PT / Barang"*, *"Nominal"*), not "button" or "unlabelled".

## Clean up
- [ ] In Data, type `DIHAPUS` in Status for the TEST rows (or delete those rows), then run *Perbarui semua tab*.

**Send me:** the save time from step 6, plus a screenshot of anything that didn't match.
