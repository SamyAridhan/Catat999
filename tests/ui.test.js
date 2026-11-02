// Drives the PWA (demo mode) in Chromium: a budget Android phone (360×740) and a laptop (1366×768).
// Usage: node tests/ui.test.js <shots_dir>   (expects a static server on :8765 serving web/)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const SHOTS = process.argv[2] || '/tmp/shots';
require('fs').mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => { errors.push('unexpected dialog: ' + d.message()); d.dismiss(); });
  let step = 0, passed = 0;
  const shot = async (name, p = page, full = true) => (await p.waitForTimeout(350), p.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, '0')}-${name}.png`, fullPage: full }));
  const ok = (cond, msg) => { assert.ok(cond, msg); passed++; console.log('  ✓', msg); };
  const btn = (t, root = 'body') => page.locator(`${root} button`, { hasText: t }).first();
  const tap = async (t, root) => btn(t, root).click();
  const wait = ms => page.waitForTimeout(ms);
  const text = async sel => (await page.locator(sel).first().textContent()) || '';
  const sheet = '#ov .sheet';

  await page.goto('http://localhost:8765/index.html?demo=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#loginForm');
  await shot('login');

  // ── login ──
  await page.fill('#lname', '');
  await tap('Masuk');
  ok((await text('#loginErr')).includes('Isi nama'), 'login: empty name is refused');
  await page.fill('#lname', 'Bujang');
  await tap('Masuk');
  ok((await text('#loginErr')).includes('Isi kata sandi'), 'login: empty password is refused');
  await page.fill('#lpw', 'salah123');
  await tap('Lihat');
  ok(await page.getAttribute('#lpw', 'type') === 'text', 'login: "Lihat" shows the password');
  await tap('Masuk');
  ok(await page.locator('#loginBtn').isDisabled(), 'login: button locks while checking ("Masuk…")');
  await page.waitForFunction(() => document.querySelector('#loginErr').textContent.includes('Kata sandi salah'));
  ok(true, 'login: wrong password → "Kata sandi salah"');
  ok(await page.inputValue('#lpw') === '', 'login: password box cleared after a wrong try');
  await page.fill('#lpw', 'toko12345');
  await page.press('#lpw', 'Enter');
  await page.waitForSelector('[data-act="new"]');
  await wait(500);
  await shot('home');
  ok((await text('.bar .who')) === 'BUJANG', 'login: free-typed name is used (uppercased)');
  ok(await page.locator('.bar .tag').count() === 0, 'worker has no Admin badge');
  ok((await text('.tile .num')).startsWith('1'), 'home: today counter shows the demo entry');

  // ── empty form → required errors only on required fields ──
  await page.click('[data-act="new"]');
  await page.waitForSelector('#q');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'q'), 'form: search box focused on open');
  ok(await page.locator('.opt').count() === 2, 'form: exactly two fields marked "(opsional)"');
  ok((await text('#st-date .choice.on')).includes('Hari ini'), 'form: date defaults to "Hari ini"');
  await shot('form-empty');
  await tap('Lanjut');
  await wait(300);
  ok(await page.locator('.step.has-err').count() === 3, 'form: 3 required fields flagged (nama, nominal, bayar pakai)');
  ok((await text('#st-amt .err-msg')) === 'Wajib diisi.', 'form: error text is "Wajib diisi."');
  ok(await page.locator('#st-inv.has-err, #st-note.has-err').count() === 0, 'form: optional fields are never flagged');
  await shot('form-errors');

  // amount clears its own error, terbilang shown
  await page.fill('#amt', '1776424');
  await page.locator('#amt').dispatchEvent('input');
  ok(await page.inputValue('#amt') === '1.776.424', 'nominal: formatted with dots');
  ok((await text('#words')).startsWith('Satu juta tujuh ratus tujuh puluh enam ribu'), 'nominal: terbilang shown');
  ok(await page.locator('#st-amt.has-err').count() === 0, 'nominal: error clears as soon as it is filled');

  // supplier search → pick
  await page.fill('#q', 'yafindo');
  await page.locator('#q').dispatchEvent('input');
  await wait(100);
  await page.locator('#sugg button', { hasText: 'YAFINDO' }).first().click();
  ok((await text('.picked b')).includes('YAFINDO MITRA PERMATA'), 'supplier: fuzzy search + pick');
  ok(await page.locator('#st-name.has-err').count() === 0, 'supplier: error cleared after pick');

  await page.fill('#inv', '007 781');
  await tap('Transfer Ibu');
  ok(await page.locator('#st-from .choice.on').count() === 1, 'bayar pakai: chosen button highlighted');

  // date: Kemarin, then calendar
  await tap('Kemarin');
  ok((await text('#st-date .choice.on')).includes('Kemarin'), 'date: "Kemarin" selects yesterday');
  await page.click('[data-act="cal"]');
  await page.waitForSelector('.cal');
  await shot('calendar', page, false);
  const futureDisabled = await page.evaluate(() => {
    const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
    const days = Array.from(document.querySelectorAll('.cal .day'));
    return days.filter(d => d.dataset.day > t).every(d => d.disabled) && days.some(d => d.dataset.day <= t && !d.disabled);
  });
  ok(futureDisabled, 'calendar: future dates disabled, past dates tappable');
  ok(await page.locator('.calnav [data-cal="1"]').isDisabled(), 'calendar: cannot go to next month');
  await page.click('.calnav [data-cal="-1"]');
  await page.locator('.cal .day:not([disabled])', { hasText: /^15$/ }).click();
  await wait(200);
  ok(await page.locator('#ov').count() === 0, 'calendar: closes after picking');
  ok((await text('#st-date .hint.strong')).includes('15'), 'calendar: picked date shown in words');
  // back to Hari ini for the rest of the test
  await page.locator('#st-date .choice').first().click();

  // ── review + save with busy state ──
  await tap('Lanjut');
  await page.waitForSelector('#saveBtn');
  ok((await text('.review')).includes('007781'), 'review: invoice normalised (no spaces)');
  ok((await text('.review dd.money')).includes('1.776.424'), 'review: amount shown');
  await shot('review');
  await page.click('#saveBtn');
  ok(await page.locator('#saveBtn').isDisabled(), 'save: button disabled while saving');
  ok((await text('#saveBtn')).includes('Menyimpan'), 'save: shows "Menyimpan…"');
  await page.waitForSelector('.done');
  ok((await text('.done h2')) === 'Berhasil disimpan', 'save: success screen');
  await shot('done');

  // ── duplicate invoice ──
  await tap('Catat Lagi');
  await page.waitForSelector('#q');
  ok(await page.locator('#freq .chip', { hasText: 'YAFINDO' }).count() === 1, 'form: "Sering dipakai" remembers the supplier');
  await page.locator('#freq .chip', { hasText: 'YAFINDO' }).click();
  await page.fill('#inv', '7781');
  await page.fill('#amt', '1776424'); await page.locator('#amt').dispatchEvent('input');
  await tap('Transfer Ibu');
  await tap('Lanjut'); await page.waitForSelector('#saveBtn'); await page.click('#saveBtn');
  await page.waitForSelector(sheet);
  ok((await text(sheet)).includes('Invoice ini sudah pernah dicatat'), 'duplicate: same invoice caught (leading zeros ignored)');
  await shot('duplicate', page, false);
  await tap('Jangan simpan', sheet);
  await page.waitForSelector('[data-act="new"]');
  ok(true, 'duplicate: "Jangan simpan" returns home without saving');

  // ── new supplier similar to an existing one ──
  await page.click('[data-act="new"]');
  await page.fill('#q', 'Sampurna Sukses');
  await page.locator('#q').dispatchEvent('input');
  await page.click('[data-act="addnew"]');
  await page.waitForSelector(sheet);
  ok((await text(sheet)).includes('Maksudnya yang ini?'), 'new supplier: similar name prompts "Maksudnya yang ini?"');
  await page.locator(`${sheet} button`, { hasText: 'SAMPURNA SUKSES ABADI' }).click();
  ok((await text('.picked b')).includes('PT. SAMPURNA SUKSES ABADI'), 'new supplier: existing name chosen instead');
  await tap('Ganti');
  await page.fill('#q', 'Toko Kue Mama Lina');
  await page.locator('#q').dispatchEvent('input');
  await page.click('[data-act="addnew"]');
  ok((await text('.picked')).includes('BARU'), 'new supplier: a truly new name is marked BARU');

  // ── XSS: note with markup is shown as text ──
  await page.fill('#amt', '25000000'); await page.locator('#amt').dispatchEvent('input');
  await tap('Lainnya');
  ok(await page.evaluate(() => document.activeElement.id === 'other'), 'Lainnya: name box opens focused');
  await tap('Lanjut');
  ok((await text('#st-from .err-msg')).includes('uang siapa'), 'Lainnya: must say whose money');
  await page.fill('#other', 'Muda');
  await page.fill('#note', '<img src=x onerror=alert(1)> =SUM(A1)');
  await tap('Lanjut');
  await page.waitForSelector('#saveBtn');
  ok(await page.locator('.review img').count() === 0, 'security: note markup not executed');
  ok((await text('.banner.err')).includes('Nominal besar'), 'review: big-amount warning at ≥ 20 juta');
  await page.click('#saveBtn');
  await page.waitForSelector('.done');
  await tap('Ke Beranda');

  // ── back button on a half-filled form asks first ──
  await page.click('[data-act="new"]');
  await page.fill('#amt', '5000'); await page.locator('#amt').dispatchEvent('input');
  await page.goBack();
  await page.waitForSelector(sheet);
  ok((await text(sheet)).includes('Batalkan catatan ini?'), 'back button: half-filled form asks before leaving');
  await tap('Lanjut isi', sheet);
  ok(await page.inputValue('#amt') === '5.000', 'back button: "Lanjut isi" keeps what was typed');
  await page.click('.bar .back');
  await page.waitForSelector(sheet);
  await tap('Ya, batalkan', sheet);
  await page.waitForSelector('[data-act="new"]');

  // ── offline queue ──
  await page.evaluate(() => localStorage.setItem('c9demo.offline', '1'));
  await page.click('[data-act="new"]');
  await page.fill('#q', 'rokok'); await page.locator('#q').dispatchEvent('input');
  await page.locator('#sugg button', { hasText: /^ROKOK$/ }).first().click();
  await page.fill('#amt', '150000'); await page.locator('#amt').dispatchEvent('input');
  await tap('Uang Kasir');
  await tap('Lanjut'); await page.waitForSelector('#saveBtn'); await page.click('#saveBtn');
  await page.waitForSelector('.done');
  ok((await text('.done h2')) === 'Belum terkirim', 'offline: saved on the phone, "Belum terkirim"');
  await shot('offline-done');
  await tap('Ke Beranda');
  ok((await text('.banner.warn')).includes('1 transaksi belum terkirim'), 'offline: home shows the waiting banner');
  await shot('home-offline');
  await page.evaluate(() => localStorage.removeItem('c9demo.offline'));
  await tap('Kirim sekarang');
  await page.waitForFunction(() => !document.querySelector('.banner.warn'), null, { timeout: 5000 });
  ok(true, 'offline: queue sent once internet is back');

  // ── history ──
  await page.click('.tile[data-act="history"]');
  await page.waitForSelector('#hlist .item.tap');
  await shot('history');
  const rows = await page.locator('#hlist .item.tap').count();
  ok(rows >= 3, 'riwayat: today’s entries listed (' + rows + ')');
  ok(await page.locator('.monthnav [data-v="1"]').isDisabled(), 'riwayat: cannot go to a future month');
  ok(await page.locator('.group-head').count() >= 1, 'riwayat: grouped per day with day totals');
  await page.fill('#hq', 'rokok');
  await page.locator('#hq').dispatchEvent('input');
  ok(await page.evaluate(() => document.activeElement.id === 'hq'), 'riwayat: search keeps the keyboard (focus stays)');
  ok((await page.locator('#hlist .item.tap').allTextContents()).every(t => t.includes('ROKOK')), 'riwayat: search filters by supplier');
  await page.fill('#hq', '7781'); await page.locator('#hq').dispatchEvent('input');
  ok(await page.locator('#hlist .item.tap').count() === 1, 'riwayat: search by invoice number');
  await page.fill('#hq', ''); await page.locator('#hq').dispatchEvent('input');

  // detail → edit
  await page.locator('#hlist .item.tap', { hasText: 'YAFINDO' }).filter({ hasText: '7781' }).click();
  await page.waitForSelector(sheet);
  ok((await text(sheet)).includes('Dicatat oleh') && (await text(sheet)).includes('BUJANG'), 'detail: shows who recorded it');
  await shot('detail', page, false);
  await tap('Ubah', sheet);
  await page.waitForSelector('#amt');
  ok((await text('.bar h1')) === 'Ubah Transaksi', 'edit: form opens in edit mode');
  ok(await page.inputValue('#amt') === '1.776.424', 'edit: existing values filled in');
  await page.fill('#amt', '1767424'); await page.locator('#amt').dispatchEvent('input');
  await tap('Lanjut');
  await page.waitForSelector('#saveBtn');
  ok(await page.locator('.changed').count() === 1, 'edit: review marks the changed field "diubah"');
  ok((await text('#saveBtn')) === 'Simpan Perubahan', 'edit: button says "Simpan Perubahan"');
  await shot('edit-review');
  await page.click('#saveBtn');
  await page.waitForSelector('.done');
  ok((await text('.done h2')) === 'Perubahan disimpan', 'edit: success screen');
  await tap('Kembali ke Riwayat');
  await page.waitForSelector('#hlist .item.tap');
  ok((await page.locator('#hlist').textContent()).includes('1.767.424'), 'edit: new amount in riwayat');
  ok((await page.locator('#hlist').textContent()).includes('diubah'), 'edit: entry marked as changed');

  // delete
  await page.locator('#hlist .item.tap', { hasText: 'ROKOK' }).filter({ hasText: '150.000' }).click();
  await page.waitForSelector(sheet);
  await tap('Hapus', sheet);
  await page.waitForSelector(`${sheet} h3`);
  ok((await text(`${sheet} h3`)).includes('Hapus transaksi ini?'), 'delete: asks to confirm with a reason');
  await shot('delete', page, false);
  await tap('Tercatat dua kali', sheet);
  await page.waitForFunction(() => !document.querySelector('#ov'));
  await page.waitForSelector('#hlist .item.tap');
  await wait(500);
  ok(!(await page.locator('#hlist').textContent()).includes('150.000'), 'delete: entry gone from riwayat');

  // older-than-3-days entry is read-only for workers (demo3 is 5 days old)
  const findOld = async () => {
    for (let i = 0; i < 2; i++) {
      const n = await page.locator('#hlist .item.tap', { hasText: 'INV/2210' }).count();
      if (n) return true;
      await page.click('.monthnav [data-v="-1"]'); await page.waitForSelector('#hlist .item.tap, #hlist .empty'); await wait(400);
    }
    return false;
  };
  ok(await findOld(), 'riwayat: previous month reachable with ‹');
  await page.locator('#hlist .item.tap', { hasText: 'INV/2210' }).click();
  await page.waitForSelector(sheet);
  ok((await text(sheet)).includes('Hanya Ibu yang bisa mengubah') && await btn('Ubah', sheet).count() === 0, '3-day rule: old entry has no Ubah/Hapus for workers');
  await tap('Tutup', sheet);

  // ── logout → admin login ──
  await page.click('.bar .back');
  await page.waitForSelector('[data-act="logout"]');
  await page.click('[data-act="logout"]');
  await page.waitForSelector(sheet);
  await tap('Keluar', sheet);
  await page.waitForSelector('#loginForm');
  ok(await page.inputValue('#lname') === 'BUJANG', 'logout: name remembered on this phone');
  await page.fill('#lname', 'Ibu');
  await page.fill('#lpw', 'ibu12345');
  await tap('Masuk');
  await page.waitForSelector('[data-act="new"]');
  ok((await text('.bar .tag')) === 'Admin', 'admin: Ibu sees the Admin badge');
  await page.click('.tile[data-act="history"]');
  await page.waitForSelector('#hlist .item.tap');
  await findOld();
  await page.locator('#hlist .item.tap', { hasText: 'INV/2210' }).click();
  await page.waitForSelector(sheet);
  ok(await btn('Ubah', sheet).count() === 1, 'admin: can change entries older than 3 days');
  await tap('Tutup', sheet);
  await page.click('.bar .back');
  await page.waitForSelector('[data-act="new"]');
  await page.click('[data-act="new"]');
  await page.click('[data-act="cal"]');
  ok(await page.locator('.calnav [data-cal="-1"]').isEnabled(), 'admin: calendar can go further back');
  await page.click('[data-close]');

  // no horizontal scroll on the phone
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone: no horizontal scrolling');

  // ── laptop size (Ibu at night) ──
  const lap = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  const lp = await lap.newPage();
  lp.on('pageerror', e => errors.push('laptop: ' + e.message));
  await lp.goto('http://localhost:8765/index.html?demo=1');
  await lp.fill('#lname', 'Ibu'); await lp.fill('#lpw', 'ibu12345'); await lp.click('#loginBtn');
  await lp.waitForSelector('[data-act="new"]');
  await shot('laptop-home', lp, false);
  const w = await lp.evaluate(() => document.querySelector('#app').getBoundingClientRect().width);
  ok(w <= 560, 'laptop: content stays a readable column (' + Math.round(w) + 'px)');
  await lp.click('[data-act="new"]');
  await lp.waitForSelector('#q');
  await shot('laptop-form', lp, false);
  await lp.click('[data-act="cal"]');
  await shot('laptop-calendar', lp, false);
  await lp.click('[data-close]');
  await lp.click('.bar .back');
  await lp.click('.tile[data-act="history"]');
  await lp.waitForSelector('#hlist .item.tap');
  await shot('laptop-history', lp, false);
  ok(true, 'laptop: home, form, calendar and riwayat render');

  ok(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(`\n${passed} UI checks passed`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
