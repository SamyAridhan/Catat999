// Acceptance tests, app half: every requirement from docs/REQUIREMENTS.md that a worker or Ibu sees on screen,
// walked through on a phone (360×740) the way they would use it, with the REAL app (not demo mode) talking to the
// REAL backend (Code.gs on the in-memory Sheet; Playwright answers the app's calls by running doPost() here).
// Each check is labelled U##.  Usage: TZ=Asia/Jakarta node tests/acceptance.ui.test.js
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { install } = require('./gas-mock');
const { serve } = require('./static-server');

const env = install(globalThis);
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Seed.gs'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), { filename: 'Code.gs' });
setup(); setPassword_('worker', 'tokoSembilan9'); setPassword_('admin', 'ibuBatam2026!');

const API = 'https://script.google.com/macros/s/TEST/exec';
const today = todayStr_(), ym = today.slice(0, 7);
let mode = 'ok';
let passed = 0, failed = 0;
const results = [];
function check(id, name, ok, detail) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${id}  ${name}${ok || detail === undefined ? '' : '\n       → ' + detail}`);
}
const data = () => env.ss.getSheetByName('Data').dump().slice(1).filter(r => r.some(v => v !== ''));
const rowBy = (f) => data().find(f);

(async () => {
  const srv = await serve(path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();
  const route = async ctx => {
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.CATAT_CONFIG = { API_URL: '${API}' };` }));
    await ctx.route(API, async r => {
      if (mode === 'offline') return r.abort('internetdisconnected');
      env.cache.clear();
      const out = doPost({ postData: { contents: r.request().postData() } }).getContent();
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out });
    });
  };
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta', serviceWorkers: 'block' });
  await route(ctx);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  const text = async sel => ((await page.locator(sel).first().textContent()) || '').replace(/\s+/g, ' ').trim();
  const typeIn = async (sel, v) => { await page.fill(sel, v); await page.locator(sel).dispatchEvent('input'); };
  const tap = sel => page.locator(sel).first().click();
  const tapText = (sel, t) => page.locator(sel, { hasText: t }).first().click();
  const toastSays = async t => { try { await page.waitForFunction(x => { const e = document.querySelector('#toast'); return e && /show/.test(e.className) && e.textContent.includes(x); }, t, { timeout: 4000 }); return true; } catch (e) { return false; } };
  const login = async (name, pw) => {
    await page.waitForSelector('#loginForm');
    await page.fill('#lname', name); await page.fill('#lpw', pw); await tap('#loginBtn');
  };
  const pickSupplier = async (q, pick) => { await typeIn('#q', q); await page.locator('#sugg button', { hasText: pick }).first().click(); };
  const fill = async ({ q, pick, inv, amount, pay, other, note }) => {
    if (!(await page.locator('#q').count()) && !(await page.locator('.picked').count())) await tap('[data-act="new"]');
    if (q) await pickSupplier(q, pick);
    if (inv) await page.fill('#inv', inv);
    if (amount) await typeIn('#amt', String(amount));
    if (pay) await tapText('#st-from .choice', pay);
    if (other) await page.fill('#other', other);
    if (note) await page.fill('#note', note);
  };
  const saveIt = async () => { await tap('[data-act="toReview"]'); await page.waitForSelector('#saveBtn'); await tap('#saveBtn'); };
  const home = async () => { if (await page.locator('[data-act="home"]').count()) await tap('[data-act="home"]'); await page.waitForSelector('[data-act="new"]'); };

  // ── U01–U03 login ──
  await page.goto(srv.url + '/index.html');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('#loginForm');
  check('U01', 'app opens in Indonesian on the login screen (Nama, Kata sandi, Masuk), not in demo mode',
    (await page.getAttribute('html', 'lang')) === 'id' && /Nama/.test(await text('#loginForm')) && /Kata sandi/.test(await text('#loginForm')) && (await page.locator('.demo').count()) === 0);
  await page.fill('#lname', 'Bujang'); await tap('#loginBtn');
  check('U02', 'empty password → "Isi kata sandi."', (await text('#loginErr')) === 'Isi kata sandi.');
  await page.fill('#lpw', 'salahsalah'); await tap('#loginBtn');
  await page.waitForFunction(() => document.querySelector('#loginErr').textContent === 'Kata sandi salah.');
  check('U02', 'wrong password → "Kata sandi salah." and the password box is cleared', (await page.inputValue('#lpw')) === '');
  await page.fill('#lpw', 'tokoSembilan9'); await tap('#loginBtn');
  await page.waitForSelector('[data-act="new"]');
  check('U02', 'right password → home, with the worker\'s name on top', (await text('.bar .who')) === 'BUJANG');
  await page.waitForFunction(() => window.CatatApp.state.boot && window.CatatApp.state.boot.suppliers.length === 124);
  await page.reload(); await page.waitForSelector('[data-act="new"]');
  check('U03', 'the phone stays logged in (reopening the app goes straight to home)', (await page.locator('#loginForm').count()) === 0);

  // ── U04–U12 recording ──
  await tap('[data-act="new"]');
  await typeIn('#q', 'yafndo');
  check('U04', 'supplier search finds the name despite a typo ("yafndo" → YAFINDO)', /YAFINDO/.test(await text('#sugg')));
  await typeIn('#q', '');
  await tap('[data-act="toReview"]');
  const errs = await page.locator('.err-msg').allTextContents();
  check('U05', 'Lanjut with nothing filled in: name, amount and pay source are marked "Wajib diisi."', errs.filter(e => e === 'Wajib diisi.').length === 3, JSON.stringify(errs));
  check('U05', 'the fields in error are marked for screen readers too', (await page.locator('[aria-invalid="true"]').count()) >= 1);
  await pickSupplier('yafindo', 'YAFINDO');
  await typeIn('#amt', '250000');
  check('U06', 'the amount is spelled out under the box (Rp 250.000 → "dua ratus lima puluh ribu")', /dua ratus lima puluh ribu/i.test(await text('#words')) && (await page.inputValue('#amt')) === '250.000');
  await tapText('#st-from .choice', 'Transfer Ibu');
  await page.fill('#inv', '0091');
  const yesterday = addDays_(today, -1);
  await tapText('#st-date .choice', 'Kemarin');
  check('U07', '"Kemarin" sets yesterday\'s date', (await page.evaluate(() => window.CatatApp.state.form.date)) === yesterday);
  await tapText('#st-date .choice', 'Hari ini');
  // calendar: future days can't be picked; a worker can go back 60 days, not more
  await tap('[data-act="cal"]'); await page.waitForSelector('#ov .cal');
  const tomorrow = addDays_(today, 1);
  const futureOk = tomorrow.slice(0, 7) === ym ? await page.locator(`#ov [data-day="${tomorrow}"]`).isDisabled() : await page.locator('#ov [data-cal="1"]').isDisabled();
  check('U07', 'calendar: tomorrow can\'t be picked and there is no next month', futureOk && await page.locator('#ov [data-cal="1"]').isDisabled());
  let backs = 0; while (backs < 6 && !(await page.locator('#ov [data-cal="-1"]').isDisabled())) { await tap('#ov [data-cal="-1"]'); backs++; }
  const min = addDays_(today, -60), tooOld = addDays_(today, -61);
  const tooOldBtn = page.locator(`#ov [data-day="${tooOld}"]`);
  check('U07', 'calendar: a worker can go back 60 days, not 61', backs === (Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7))) - (Number(min.slice(0, 4)) * 12 + Number(min.slice(5, 7))) &&
    (!(await tooOldBtn.count()) || await tooOldBtn.isDisabled()) && (min.slice(0, 7) !== tooOld.slice(0, 7) || !(await page.locator(`#ov [data-day="${min}"]`).isDisabled())), `went back ${backs} months`);
  await page.keyboard.press('Escape');
  await page.fill('#note', 'bayar lunas');
  await tap('[data-act="toReview"]'); await page.waitForSelector('#saveBtn');
  const rv = await text('.card.review');
  check('U08', 'Cek Lagi shows everything before saving', /PT\. YAFINDO MITRA PERMATA/.test(rv) && /0091/.test(rv) && /Rp 250\.000/.test(rv) && /Transfer Ibu/.test(rv) && /bayar lunas/.test(rv), rv);
  await tap('#saveBtn'); await page.waitForSelector('.done');
  const r1 = rowBy(r => r[C.INV] === '0091');
  check('U09', 'Simpan → "Berhasil disimpan", and the row is in the Sheet under the worker\'s name',
    (await text('.done h2')) === 'Berhasil disimpan' && r1 && r1[C.AMT] === 250000 && r1[C.BY] === 'BUJANG' && r1[C.FROM] === 'Transfer Ibu' && r1[C.NOTE] === 'bayar lunas');
  check('U09', 'the month tab is made/updated straight away', !!env.ss.getSheetByName(BULAN[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4)));

  // duplicates
  await tap('text=Catat Lagi');
  await fill({ q: 'yafindo', pick: 'YAFINDO', inv: '91', amount: 250000, pay: 'Transfer Ibu' });
  await saveIt(); await page.waitForSelector('#ov');
  check('U10', 'same supplier + invoice (zeros ignored) → "Invoice ini sudah pernah dicatat" with who recorded it', /Invoice ini sudah pernah dicatat/.test(await text('#ov')) && /BUJANG/.test(await text('#ov')));
  const n0 = data().length;
  await tapText('#ov button', 'Jangan simpan');
  check('U10', '"Jangan simpan" → nothing saved, back home, says "Tidak disimpan."', await toastSays('Tidak disimpan.') && data().length === n0 && (await page.locator('[data-act="new"]').count()) === 1);
  await fill({ q: 'yafindo', pick: 'YAFINDO', inv: '91', amount: 250000, pay: 'Transfer Ibu' });
  await saveIt(); await page.waitForSelector('#ov');
  await tapText('#ov button', 'tetap simpan'); await page.waitForSelector('.done');
  check('U10', '"Beda transaksi, tetap simpan" saves it', data().length === n0 + 1);
  await tap('text=Catat Lagi');
  await fill({ q: 'rokok', pick: /^ROKOK$/, amount: 350000, pay: 'Uang Kasir' }); await saveIt(); await page.waitForSelector('.done');
  await tap('text=Catat Lagi');
  await fill({ q: 'rokok', pick: /^ROKOK$/, amount: 350000, pay: 'Modal' }); await saveIt(); await page.waitForSelector('#ov');
  check('U10', 'no invoice + same supplier, day and amount → "Sudah ada transaksi yang sama"', /Sudah ada transaksi yang sama/.test(await text('#ov')));
  await tapText('#ov button', 'Jangan simpan'); await page.waitForSelector('[data-act="new"]');

  // new names
  await tap('[data-act="new"]');
  await typeIn('#q', 'Toko Sinar Jaya');
  await tap('[data-act="addnew"]');
  check('U11', 'a new name: "+ Tambah" picks it, marked BARU', /TOKO SINAR JAYA/.test(await text('.picked')) && /BARU/.test(await text('.picked')));
  await tap('[data-act="unpick"]');
  await typeIn('#q', 'Yafindo Mitra Permat');
  await tap('[data-act="addnew"]'); await page.waitForSelector('#ov');
  check('U11', 'a new name that looks like an existing one asks "Maksudnya yang ini?"', /Maksudnya yang ini\?/.test(await text('#ov')) && /PT\. YAFINDO MITRA PERMATA/.test(await text('#ov')));
  await tapText('#ov button', 'PT. YAFINDO MITRA PERMATA');
  check('U11', '…and choosing it uses the existing spelling', /^PT\. YAFINDO MITRA PERMATA/.test(await text('.picked')) && !/BARU/.test(await text('.picked')));
  await tap('[data-act="unpick"]');
  await typeIn('#q', 'Toko Sinar Jaya'); await tap('[data-act="addnew"]');
  // Lainnya needs a name
  await typeIn('#amt', '75000'); await tapText('#st-from .choice', 'Lainnya');
  await tap('[data-act="toReview"]');
  check('U12', '"Lainnya" without saying whose money → asks for it', /Tulis uang siapa/.test(await text('#st-from')));
  await page.fill('#other', 'Pak Rudi');
  await saveIt(); await page.waitForSelector('.done');
  const r2 = rowBy(r => r[C.NAME] === 'TOKO SINAR JAYA');
  check('U12', '…with a name it is saved as "Lainnya: PAK RUDI", and the new supplier joins the list',
    r2 && r2[C.FROM] === 'Lainnya: PAK RUDI' && env.ss.getSheetByName('Supplier').dump().some(s => s[0] === 'TOKO SINAR JAYA'));
  // big amount
  await tap('text=Catat Lagi');
  await fill({ q: 'galon', pick: 'GALON', amount: 25000000, pay: 'Modal' });
  await tap('[data-act="toReview"]'); await page.waitForSelector('#saveBtn');
  check('U13', 'Rp 20 juta and above: "Nominal besar" warning above the slip', /Nominal besar/.test(await text('.banner.err')));
  await tap('[data-act="back"]'); await page.waitForSelector('#amt');
  check('U13', '"Kembali" goes back to the form with everything still filled in', (await page.inputValue('#amt')) === '25.000.000' && /GALON/.test(await text('.picked')));
  await typeIn('#amt', '18000'); await saveIt(); await page.waitForSelector('.done');
  // HTML in a note is shown as text
  await tap('text=Catat Lagi');
  await fill({ q: 'aqua', pick: 'AQUA', amount: 12000, pay: 'Modal', note: '<img src=x onerror="window.__hacked=1"> 2 dus' });
  await saveIt(); await page.waitForSelector('.done');
  await home();

  // ── U14–U17 Riwayat, change, delete ──
  await tap('.tile[data-act="history"]'); await page.waitForSelector('#hlist .item.tap');
  const live = data().filter(r => r[C.STATUS] === 'AKTIF' && fmtDate_(r[C.DATE]).slice(0, 7) === ym);
  const sum = live.reduce((s, r) => s + r[C.AMT], 0);
  const rp = n => 'Rp ' + n.toLocaleString('id-ID');
  check('U14', 'Riwayat opens on this month; the next-month button is off', (await page.locator('[data-act="month"][data-v="1"]').isDisabled()) && (await text('.monthnav b')).includes(String(today.slice(0, 4))));
  check('U14', 'month total and number of transactions match the Sheet', (await text('.card.total .big')) === rp(sum) && (await text('.card.total .hint')).includes(live.length + ' transaksi'), `${await text('.card.total')} vs ${rp(sum)}`);
  const todaySum = live.filter(r => fmtDate_(r[C.DATE]) === today).reduce((s, r) => s + r[C.AMT], 0);
  check('U14', 'entries are grouped by day with a daily total', (await text('#hlist .group-head')).includes(rp(todaySum)));
  await typeIn('#hq', 'sinar');
  check('U14', 'search by supplier name', (await page.locator('#hlist .item.tap').count()) === 1 && /TOKO SINAR JAYA/.test(await text('#hlist')));
  await typeIn('#hq', '0091');
  check('U14', 'search by invoice number', (await page.locator('#hlist .item.tap').count()) === 1 && /YAFINDO/.test(await text('#hlist')));
  await typeIn('#hq', '');
  await tapText('#hlist .item.tap', 'AQUA'); await page.waitForSelector('#ov');
  const det = await text('#ov');
  check('U15', 'tapping an entry shows who recorded it and when, with Ubah and Hapus', /Dicatat oleh/.test(det) && /BUJANG/.test(det) && /\d\d\.\d\d/.test(det) && /Ubah/.test(det) && /Hapus/.test(det), det);
  check('U15', 'text typed into a note is shown as text, never run as code', det.includes('<img src=x') && !(await page.evaluate(() => window.__hacked)));
  await page.keyboard.press('Escape');
  // older than 3 days: only Ibu
  const sinarRow = env.ss.getSheetByName('Data').dump().findIndex(r => r[C.NAME] === 'TOKO SINAR JAYA') + 1;
  env.ss.getSheetByName('Data').getRange(sinarRow, C.AT + 1).setValue(new Date(Date.now() - 4 * 86400e3));
  await page.evaluate(() => { window.CatatApp.state.hist = {}; });
  await tap('.bar .back'); await tap('.tile[data-act="history"]'); await page.waitForSelector('#hlist .item.tap');
  await tapText('#hlist .item.tap', 'TOKO SINAR JAYA'); await page.waitForSelector('#ov');
  check('U15', 'recorded more than 3 days ago: no Ubah/Hapus for a worker, "Hanya Ibu yang bisa mengubah"', /Hanya Ibu yang bisa mengubah/.test(await text('#ov')) && (await page.locator('#ov [data-v="edit"]').count()) === 0);
  await page.keyboard.press('Escape');
  // change
  await tapText('#hlist .item.tap', 'GALON'); await page.waitForSelector('#ov');
  await tapText('#ov button', 'Ubah'); await page.waitForSelector('#amt');
  check('U16', 'Ubah opens the form filled in with the entry', (await page.inputValue('#amt')) === '18.000' && /GALON/.test(await text('.picked')));
  await typeIn('#amt', '19000');
  await tap('[data-act="toReview"]'); await page.waitForSelector('#saveBtn');
  check('U16', 'Cek Lagi marks what changed ("diubah")', (await page.locator('.changed').count()) === 1 && (await text('#saveBtn')) === 'Simpan Perubahan');
  await tap('#saveBtn'); await page.waitForSelector('.done');
  const g = rowBy(r => /GALON/.test(r[C.NAME]));
  check('U16', 'saved: "Perubahan disimpan", the Sheet has the new amount and who changed it', (await text('.done h2')) === 'Perubahan disimpan' && g[C.AMT] === 19000 && g[C.EDITBY] === 'BUJANG');
  await tap('text=Kembali ke Riwayat'); await page.waitForSelector('#hlist .item.tap');
  check('U16', '"Kembali ke Riwayat" shows the new amount', /Rp 19\.000/.test(await text('#hlist')));
  // delete
  await tapText('#hlist .item.tap', 'GALON'); await page.waitForSelector('#ov');
  await tapText('#ov button', 'Hapus');
  check('U17', 'Hapus asks why (Salah input / Tercatat dua kali / Lainnya) and can be cancelled', /Kenapa dihapus\?/.test(await text('#ov')) && (await page.locator('#ov [data-v="Salah input"]').count()) === 1 && (await page.locator('#ov [data-v="Tercatat dua kali"]').count()) === 1);
  await tapText('#ov button', 'Tercatat dua kali');
  const delToast = await toastSays('Transaksi dihapus');
  await page.waitForTimeout(300);
  check('U17', 'deleted: gone from Riwayat, kept in the Sheet as DIHAPUS', delToast && !/GALON/.test(await text('#hlist')) && rowBy(r => /GALON/.test(r[C.NAME]))[C.STATUS] === 'DIHAPUS');
  await tap('.bar .back'); await page.waitForSelector('[data-act="new"]');

  // ── U18 offline, credited to the recorder ──
  mode = 'offline';
  await fill({ q: 'telur', pick: 'TELUR', amount: 54000, pay: 'Modal' });
  await saveIt(); await page.waitForSelector('.done');
  check('U18', 'no internet: "Belum terkirim", kept on the phone', (await text('.done h2')) === 'Belum terkirim');
  await home();
  check('U18', 'home says 1 entry is waiting, with "Kirim sekarang"', /1 transaksi belum terkirim/.test(await text('#app')) && (await page.locator('[data-act="flush"]').count()) === 1);
  await tap('[data-act="logout"]'); await page.waitForSelector('#ov');
  check('U18', 'logging out warns that it is still waiting and stays credited to its recorder', /1 transaksi belum terkirim/.test(await text('#ov')));
  await tapText('#ov button', 'Keluar');
  mode = 'ok';
  await login('Siti', 'tokoSembilan9'); await page.waitForSelector('[data-act="new"]');
  await page.waitForFunction(() => window.CatatApp.state.queue.length === 0, null, { timeout: 10000 }).catch(() => {});
  const telur = data().filter(r => r[C.NAME] === 'TELUR');
  check('U18', 'back online with Siti logged in: sent once, still credited to BUJANG', telur.length === 1 && telur[0][C.BY] === 'BUJANG', JSON.stringify(telur.map(r => r[C.BY])));
  check('U18', 'and Bujang\'s old session is ended once his entry is sent', await page.evaluate(() => window.CatatApp.state.logoutLater.length === 0));

  // ── U19 names remembered, back button, logout ──
  await tap('[data-act="logout"]'); await tapText('#ov button', 'Keluar'); await page.waitForSelector('#loginForm');
  check('U19', 'after logging out the last name is filled in, and earlier names are one tap away', (await page.inputValue('#lname')) === 'SITI' && /BUJANG/.test(await text('#loginForm .chips')));
  await tapText('#loginForm .chip', 'BUJANG');
  check('U19', 'tapping a name chip fills it in', (await page.inputValue('#lname')) === 'BUJANG');
  await page.fill('#lpw', 'tokoSembilan9'); await tap('#loginBtn'); await page.waitForSelector('[data-act="new"]');
  await tap('[data-act="new"]'); await typeIn('#amt', '5000');
  await page.goBack(); await page.waitForSelector('#ov');
  check('U20', 'phone back button on a half-filled form asks "Batalkan catatan ini?"', /Batalkan catatan ini\?/.test(await text('#ov')));
  await tapText('#ov button', 'Lanjut isi');
  check('U20', '"Lanjut isi" keeps what was typed', (await page.inputValue('#amt')) === '5.000');
  await page.goBack(); await page.waitForSelector('#ov'); await tapText('#ov button', 'Ya, batalkan'); await page.waitForSelector('[data-act="new"]');

  // ── U21 Ibu ──
  await tap('[data-act="logout"]'); await tapText('#ov button', 'Keluar');
  await login('Ibu', 'ibuBatam2026!'); await page.waitForSelector('[data-act="new"]');
  check('U21', 'Ibu logs in with the admin password and is shown as Admin', (await text('.bar .tag')) === 'Admin');
  await tap('.tile[data-act="history"]'); await page.waitForSelector('#hlist .item.tap');
  await tapText('#hlist .item.tap', 'TOKO SINAR JAYA'); await page.waitForSelector('#ov');
  check('U21', 'Ibu can still change an entry older than 3 days', (await page.locator('#ov [data-v="edit"]').count()) === 1);
  await page.keyboard.press('Escape'); await tap('.bar .back');
  await tap('[data-act="new"]'); await tap('[data-act="cal"]'); await page.waitForSelector('#ov .cal');
  let ib = 0; while (ib < 3 && !(await page.locator('#ov [data-cal="-1"]').isDisabled())) { await tap('#ov [data-cal="-1"]'); ib++; }
  check('U21', 'Ibu can date entries further back than workers (over 60 days)', ib === 3);
  await page.keyboard.press('Escape');
  await ctx.close();

  // ── U22 phone date wrong ──
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta', serviceWorkers: 'block' });
  await route(ctx2);
  const p2 = await ctx2.newPage();
  await p2.clock.install({ time: new Date(Date.now() + 2 * 86400e3) });   // the phone thinks it is 2 days later
  await p2.goto(srv.url + '/index.html'); await p2.evaluate(() => localStorage.clear()); await p2.reload();
  await p2.fill('#lname', 'Ani'); await p2.fill('#lpw', 'tokoSembilan9'); await p2.click('#loginBtn');
  await p2.waitForFunction(() => window.CatatApp.state.boot && window.CatatApp.state.boot.today);
  await p2.waitForSelector('.banner.warn');
  check('U22', 'phone date wrong: home says "Tanggal di HP ini salah"', /Tanggal di HP ini salah/.test(await p2.textContent('#app')));
  await p2.click('[data-act="new"]');
  check('U22', '…and "Hari ini" is the real date', (await p2.evaluate(() => window.CatatApp.state.form.date)) === today);
  await ctx2.close();

  // ── U23 laptop ──
  const ctx3 = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta', serviceWorkers: 'block' });
  await route(ctx3);
  const p3 = await ctx3.newPage();
  await p3.goto(srv.url + '/index.html'); await p3.evaluate(() => localStorage.clear()); await p3.reload();
  await p3.fill('#lname', 'Ibu'); await p3.fill('#lpw', 'ibuBatam2026!'); await p3.keyboard.press('Enter');
  await p3.waitForSelector('[data-act="new"]');
  await p3.click('[data-act="new"]'); await p3.fill('#q', 'sari roti'); await p3.locator('#q').dispatchEvent('input');
  await p3.locator('#sugg button', { hasText: 'SARI ROTI' }).first().click();
  await p3.fill('#amt', '206100'); await p3.locator('#amt').dispatchEvent('input');
  await p3.locator('#st-from .choice', { hasText: 'Uang Kasir' }).click();
  await p3.click('[data-act="toReview"]'); await p3.click('#saveBtn'); await p3.waitForSelector('.done');
  const wide = await p3.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check('U23', 'works on Ibu\'s laptop too (keyboard login, record, no sideways scrolling)', wide && data().some(r => r[C.NAME] === 'SARI ROTI' && r[C.BY] === 'IBU'));
  await ctx3.close();

  // ── U24 installable, works without internet ──
  const ctx4 = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'id-ID' });
  await route(ctx4);
  const p4 = await ctx4.newPage();
  await p4.goto(srv.url + '/index.html');
  const manifest = await p4.evaluate(async () => { const l = document.querySelector('link[rel="manifest"]'); if (!l) return null; return (await fetch(l.href)).json(); });
  // the app registers sw.js only over https (GitHub Pages); the test server is http, so register it the same way here
  await p4.evaluate(() => navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready));
  await p4.reload();
  await p4.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(() => {});
  await p4.waitForTimeout(500);
  await ctx4.setOffline(true);
  let offlineOk = false;
  try { await p4.reload({ timeout: 8000 }); await p4.waitForSelector('#loginForm, [data-act="new"]', { timeout: 5000 }); offlineOk = true; } catch (e) { }
  check('U24', 'installable (manifest with name and icons) and opens without internet once visited',
    !!manifest && /Catat 999/.test(manifest.name || manifest.short_name) && (manifest.icons || []).length >= 2 && offlineOk, JSON.stringify({ manifest: !!manifest, offlineOk }));
  await ctx4.close();

  check('U25', 'no JavaScript errors anywhere in the walk-through', errors.length === 0, errors.join(' | '));
  await browser.close(); srv.close();
  console.log(`\n${passed} app requirement checks passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
