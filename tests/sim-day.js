// A simulated shop day: Ibu (admin) and two workers using the real app at the same time against the real backend
// (Code.gs on the in-memory Sheet). Each actor has their own phone/laptop (browser context), network speed and signal.
// After every step the Sheet, month tab, Log and the app must agree. Screenshots of every step go to the output folder.
// Usage: TZ=Asia/Jakarta node tests/sim-day.js [outDir]
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { install } = require('./gas-mock');
const { serve } = require('./static-server');

const OUT = path.resolve(process.argv[2] || 'sim-out');
fs.mkdirSync(OUT, { recursive: true });
const env = install(globalThis);
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Seed.gs'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), { filename: 'Code.gs' });
setup(); setPassword_('worker', 'tokoSembilan9'); setPassword_('admin', 'ibuBatam2026!');
const WPW = 'tokoSembilan9', APW = 'ibuBatam2026!';
const API = 'https://script.google.com/macros/s/TEST/exec';
const today = todayStr_(), ym = today.slice(0, 7);
const yesterday = addDays_(today, -1);
const prevMonthDay = addDays_(ym + '-01', -3);

const findings = [];   // { sev, actor, step, what }
const checks = [];     // { ok, step, what, detail }
const timeline = [];
const metrics = [];    // { actor, what, taps, ms }
let shot = 0;
function check(step, what, ok, detail) { checks.push({ ok: !!ok, step, what, detail: ok ? '' : String(detail || '') }); console.log(`  ${ok ? '✓' : '✗'} [${step}] ${what}${ok ? '' : '  → ' + detail}`); }
function finding(sev, actor, step, what) { findings.push({ sev, actor, step, what }); console.log(`  ⚠ ${sev} [${step}] ${actor}: ${what}`); }
const rows = n => env.ss.getSheetByName(n).dump().slice(1).filter(r => r.some(v => v !== ''));
const data = () => rows('Data');
const live = m => data().filter(r => r[C.STATUS] !== 'DIHAPUS' && fmtDate_(r[C.DATE]).slice(0, 7) === m);
const tabName = m => BULAN[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
const tabTotal = m => { const t = env.ss.getSheetByName(tabName(m)); return t ? t.dump()[2][0] : null; };
const rp = n => 'Rp ' + Number(n).toLocaleString('id-ID');

// Everything must always agree: Data ↔ month tab ↔ Log; no duplicate IDs; every row has a recorder.
function invariants(step) {
  const all = data();
  const ids = all.map(r => r[C.ID]);
  const months = [...new Set(all.map(r => fmtDate_(r[C.DATE]).slice(0, 7)))];
  const bad = [];
  if (new Set(ids).size !== ids.length) bad.push('duplicate IDs in Data');
  if (all.some(r => !r[C.BY])) bad.push('a row without "Dicatat Oleh"');
  for (const m of months) {
    const sum = live(m).reduce((s, r) => s + Number(r[C.AMT]), 0);
    if (tabTotal(m) !== sum) bad.push(`${tabName(m)} total ${tabTotal(m)} ≠ Data ${sum}`);
  }
  const adds = rows('Log').filter(l => l[2] === 'Tambah').length;
  const appRows = all.filter(r => r[C.BY] !== 'MANUAL').length;
  if (adds !== appRows) bad.push(`Log has ${adds} "Tambah" for ${appRows} app rows`);
  check(step, 'Sheet, month tabs and Log agree', !bad.length, bad.join('; '));
}

(async () => {
  const srv = await serve(path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();

  // one device = one browser context, with its own latency and signal
  async function device(label, viewport, latencyMs) {
    const ctx = await browser.newContext({ viewport, locale: 'id-ID', timezoneId: 'Asia/Jakarta', serviceWorkers: 'block', hasTouch: viewport.width < 800, isMobile: viewport.width < 800 });
    const dev = { label, ctx, online: true, latency: latencyMs, calls: 0, errors: [] };
    await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.CATAT_CONFIG = { API_URL: '${API}' };` }));
    await ctx.route(API, async r => {
      dev.calls++;
      if (!dev.online) return r.abort('internetdisconnected');
      await new Promise(res => setTimeout(res, dev.latency));
      if (!dev.online) return r.abort('internetdisconnected');
      env.cache.clear();   // per-minute counters: the simulation is faster than a real day
      const out = doPost({ postData: { contents: r.request().postData() } }).getContent();
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out });
    });
    dev.page = await ctx.newPage();
    dev.page.on('pageerror', e => dev.errors.push(e.message));
    dev.page.on('dialog', d => d.dismiss());
    dev.taps = 0;
    await dev.page.goto(srv.url + '/index.html');
    return dev;
  }
  const P = d => d.page;
  const tap = async (d, sel, opts) => { d.taps++; await P(d).locator(sel).first().click(opts); };
  const tapText = async (d, sel, t) => { d.taps++; await P(d).locator(sel, { hasText: t }).first().click(); };
  const type = async (d, sel, v) => { await P(d).fill(sel, v); await P(d).locator(sel).dispatchEvent('input'); };
  const text = async (d, sel) => ((await P(d).locator(sel).first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  const snap = async (d, name) => { const f = path.join(OUT, String(++shot).padStart(2, '0') + '-' + d.label + '-' + name + '.png'); await P(d).screenshot({ path: f, fullPage: true }); return f; };
  const at = (time, who, what) => { timeline.push({ time, who, what }); console.log(`\n${time}  ${who}: ${what}`); };
  const login = async (d, name, pw) => { await P(d).waitForSelector('#loginForm'); await P(d).fill('#lname', name); await P(d).fill('#lpw', pw); await tap(d, '#loginBtn'); await P(d).waitForSelector('[data-act="new"]', { timeout: 15000 }); };
  const screen = d => P(d).evaluate(() => window.CatatApp.state.screen);
  const toHome = async d => {
    for (let i = 0; i < 4 && (await screen(d)) !== 'home'; i++) {
      if (await P(d).locator('#ov').count()) await P(d).keyboard.press('Escape');
      else if (await P(d).locator('button[data-act="home"]').count()) await tap(d, 'button[data-act="home"]');
      else await tap(d, '.bar .back');
      await P(d).waitForTimeout(150);
    }
    await P(d).waitForSelector('.tile[data-act="new"]');
  };
  // a worker's way of recording: search, pick, (invoice), amount, pay source, (date), (note), Lanjut, Simpan
  async function record(d, o, step) {
    const t0 = Date.now(), taps0 = d.taps;
    if (!(await P(d).locator('#q').count()) && !(await P(d).locator('.picked').count())) await tap(d, '[data-act="new"]');
    await P(d).waitForSelector('#q, .picked');
    if (o.q) { await type(d, '#q', o.q); if (o.pick) await tapText(d, '#sugg button', o.pick); }
    if (o.inv) await P(d).fill('#inv', o.inv);
    if (o.amount) await type(d, '#amt', String(o.amount));
    if (o.pay) await tapText(d, '#st-from .choice', o.pay);
    if (o.other) await P(d).fill('#other', o.other);
    if (o.date === 'kemarin') await tapText(d, '#st-date .choice', 'Kemarin');
    if (o.note) await P(d).fill('#note', o.note);
    if (o.stopBeforeReview) return;
    await tap(d, '[data-act="toReview"]'); await P(d).waitForSelector('#saveBtn');
    if (o.stopAtReview) return;
    if (o.doubleTap) { const b = await P(d).locator('#saveBtn').boundingBox(); d.taps += 2; await P(d).mouse.click(b.x + b.width / 2, b.y + b.height / 2); await P(d).mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
    else await tap(d, '#saveBtn');
    await P(d).waitForSelector('.done, #ov', { timeout: 20000 });
    metrics.push({ actor: d.label, what: (o.pick || o.q || '').toString(), taps: d.taps - taps0, ms: Date.now() - t0, step });
  }

  // ── devices ──
  const bujang = await device('bujang', { width: 360, height: 740 }, 2500);   // slow Apps Script replies
  const muda = await device('muda', { width: 320, height: 640 }, 1200);
  const ibuHp = await device('ibu-hp', { width: 412, height: 860 }, 1500);
  for (const d of [bujang, muda, ibuHp]) await P(d).evaluate(() => localStorage.clear());

  // ── 07:30 Bujang, first login ever ──
  at('07:30', 'Bujang', 'first login, then the morning bread/drink deliveries paid from the cash drawer');
  await P(bujang).reload(); await snap(bujang, 'login-first-time');
  await P(bujang).fill('#lname', 'bujang'); await P(bujang).fill('#lpw', WPW); await tap(bujang, '#loginBtn');
  const busyLabel = await text(bujang, '#loginBtn');
  check('07:30', 'login button shows it is working while the slow server answers', /Masuk…/.test(busyLabel), busyLabel);
  await P(bujang).waitForSelector('[data-act="new"]', { timeout: 15000 });
  await P(bujang).waitForFunction(() => window.CatatApp.state.boot && window.CatatApp.state.boot.suppliers.length === 124, null, { timeout: 15000 });
  await snap(bujang, 'home-empty');
  await record(bujang, { q: 'sari', pick: 'SARI ROTI', amount: 186000, pay: 'Uang Kasir' }, '07:30');
  check('07:30', 'SARI ROTI saved', (await text(bujang, '.done h2')) === 'Berhasil disimpan');
  await snap(bujang, 'saved-sari-roti');
  await tap(bujang, 'text=Catat Lagi');
  await record(bujang, { q: 'dailys', pick: 'ROTI DAILYS', amount: 95000, pay: 'Uang Kasir' }, '07:30');
  await tap(bujang, 'text=Catat Lagi');
  await record(bujang, { q: 'yakul', pick: 'YAKULT', amount: 47200, pay: 'Uang Kasir' }, '07:30');
  invariants('07:30');

  // ── 09:00 PT invoice paid by Ibu's transfer; slow save, double tap ──
  at('09:00', 'Bujang', 'YAFINDO invoice 2099, Rp 1.776.424, Transfer Ibu — taps Simpan twice because it is slow');
  await tap(bujang, 'text=Catat Lagi');
  await record(bujang, { q: 'yafindo', pick: 'YAFINDO', inv: '2099', amount: 1776424, pay: 'Transfer Ibu', doubleTap: true }, '09:00');
  check('09:00', 'double tap on a slow Simpan saves once', data().filter(r => r[C.INV] === '2099').length === 1, data().filter(r => r[C.INV] === '2099').length + ' rows');
  invariants('09:00');

  // ── 10:00 Muda logs in; both record the same invoice at the same moment ──
  at('10:00', 'Muda + Bujang', 'Muda logs in; both record the OMEGA invoice 0012345 (Rp 2.450.000) at the same moment');
  await P(muda).reload(); await login(muda, 'Muda', WPW);
  await P(muda).waitForFunction(() => window.CatatApp.state.boot, null, { timeout: 15000 });
  await toHome(bujang);
  await Promise.all([
    record(bujang, { q: 'omega', pick: 'OMEGA', inv: '0012345', amount: 2450000, pay: 'Transfer Ibu', stopAtReview: true }, '10:00'),
    record(muda, { q: 'omega', pick: 'OMEGA', inv: '12345', amount: 2450000, pay: 'Transfer Ibu', stopAtReview: true }, '10:00')
  ]);
  await Promise.all([tap(bujang, '#saveBtn'), tap(muda, '#saveBtn')]);
  await Promise.all([P(bujang).waitForSelector('.done, #ov', { timeout: 20000 }), P(muda).waitForSelector('.done, #ov', { timeout: 20000 })]);
  const omega = data().filter(r => /OMEGA/.test(r[C.NAME]));
  const warned = [(await P(bujang).locator('#ov').count()) ? 'BUJANG' : '', (await P(muda).locator('#ov').count()) ? 'MUDA' : ''].filter(Boolean);
  check('10:00', 'same invoice from two phones at once: saved once, the other phone is warned', omega.length === 1 && warned.length === 1, `${omega.length} rows, warned: ${warned}`);
  const loser = warned[0] === 'MUDA' ? muda : bujang, winner = loser === muda ? bujang : muda;
  await snap(loser, 'duplicate-warning');
  const dupText = await text(loser, '#ov');
  check('10:00', 'the warning says who recorded it', new RegExp(omega[0] ? omega[0][C.BY] : 'x').test(dupText), dupText);
  await tapText(loser, '#ov button', 'Jangan simpan');
  await toHome(winner);
  invariants('10:00');

  at('10:15', 'Muda', 'types "sampoerna" for PT. SAMPURNA SUKSES ABADI');
  await tap(muda, '[data-act="new"]');
  await type(muda, '#q', 'sampoerna');
  const sugg = await text(muda, '#sugg');
  await snap(muda, 'search-sampoerna');
  if (/SAMPURNA/.test(sugg)) check('10:15', '"sampoerna" finds PT. SAMPURNA SUKSES ABADI in the list', true);
  else {
    check('10:15', '"sampoerna" finds PT. SAMPURNA SUKSES ABADI in the list', false, sugg);
    await tap(muda, '[data-act="addnew"]');
    const asked = (await P(muda).locator('#ov').count()) && /SAMPURNA/.test(await text(muda, '#ov'));
    check('10:15', '…or at least "+ Tambah" asks "Maksudnya yang ini?"', asked, await text(muda, '#ov'));
    if (asked) { await snap(muda, 'maksudnya-yang-ini'); await tapText(muda, '#ov button', 'SAMPURNA'); }
  }
  if (await P(muda).locator('#sugg button', { hasText: 'SAMPURNA' }).count()) await tapText(muda, '#sugg button', 'SAMPURNA');
  await record(muda, { inv: 'SJ-88120', amount: 3120500, pay: 'Transfer Ibu' }, '10:15');
  check('10:15', 'stored with the one known spelling', data().some(r => r[C.NAME] === 'PT. SAMPURNA SUKSES ABADI'));
  check('10:15', 'no new spelling added to the supplier list', !rows('Supplier').some(s => /SAMPOERNA/.test(s[0])));
  await toHome(muda);
  invariants('10:15');

  // ── 11:00 a zero too many; yesterday's forgotten nota ──
  at('11:00', 'Bujang', 'types Rp 24.500.000 instead of 2.450.000; then yesterday\'s forgotten ROKOK nota');
  await record(bujang, { q: 'colamas', pick: 'COLAMAS', inv: '77801', amount: 24500000, pay: 'Transfer Ibu', stopAtReview: true }, '11:00');
  await snap(bujang, 'big-amount-warning');
  check('11:00', '"Nominal besar" warning is visible without scrolling', await P(bujang).locator('.banner.err').isVisible() && (await P(bujang).locator('.banner.err').boundingBox()).y < 740);
  await tap(bujang, '[data-act="back"]'); await type(bujang, '#amt', '2450000');
  await tap(bujang, '[data-act="toReview"]'); await tap(bujang, '#saveBtn'); await P(bujang).waitForSelector('.done', { timeout: 20000 });
  check('11:00', 'saved with the corrected amount', data().some(r => /COLAMAS/.test(r[C.NAME]) && r[C.AMT] === 2450000) && !data().some(r => r[C.AMT] === 24500000));
  await tap(bujang, 'text=Catat Lagi');
  await record(bujang, { q: 'rokok', pick: /^ROKOK$/, amount: 350000, pay: 'Uang Kasir', date: 'kemarin', note: 'nota kemarin lupa' }, '11:00');
  check('11:00', '"Kemarin" lands on yesterday', data().some(r => r[C.NAME] === 'ROKOK' && fmtDate_(r[C.DATE]) === yesterday));
  await toHome(bujang);
  invariants('11:00');

  // ── 12:00 Ibu on her phone: checks, fixes an amount, deletes a double entry ──
  at('12:00', 'Ibu (HP)', 'checks Riwayat, fixes YAKULT (should be 47.900), deletes a double ROTI DAILYS that Muda also entered');
  await record(muda, { q: 'dailys', pick: 'ROTI DAILYS', amount: 95000, pay: 'Modal' }, '12:00');
  const mudaDup = (await P(muda).locator('#ov').count()) > 0;
  check('12:00', 'Muda re-entering Bujang\'s ROTI DAILYS (no invoice, same day+amount) is caught', mudaDup);
  if (mudaDup) { await snap(muda, 'similar-warning'); await tapText(muda, '#ov button', 'tetap simpan'); await P(muda).waitForSelector('.done', { timeout: 20000 }); }
  await toHome(muda);
  await P(ibuHp).reload(); await login(ibuHp, 'Ibu', APW);
  await tap(ibuHp, '.tile[data-act="history"]'); await P(ibuHp).waitForSelector('#hlist .item.tap', { timeout: 15000 });
  await snap(ibuHp, 'riwayat-noon');
  const appTotal = await text(ibuHp, '.card.total .big');
  const sheetSum = live(ym).reduce((s, r) => s + r[C.AMT], 0);
  check('12:00', 'Riwayat total on Ibu\'s phone = the Sheet', appTotal === rp(sheetSum), `${appTotal} vs ${rp(sheetSum)}`);
  await tapText(ibuHp, '#hlist .item.tap', 'YAKULT'); await P(ibuHp).waitForSelector('#ov');
  await tapText(ibuHp, '#ov button', 'Ubah'); await P(ibuHp).waitForSelector('#amt');
  await type(ibuHp, '#amt', '47900'); await tap(ibuHp, '[data-act="toReview"]'); await tap(ibuHp, '#saveBtn');
  await P(ibuHp).waitForSelector('.done', { timeout: 20000 });
  const yk = data().find(r => r[C.NAME] === 'YAKULT');
  check('12:00', 'Ibu\'s fix is in the Sheet with her name', yk[C.AMT] === 47900 && yk[C.EDITBY] === 'IBU' && yk[C.BY] === 'BUJANG');
  await tap(ibuHp, 'text=Kembali ke Riwayat'); await P(ibuHp).waitForSelector('#hlist .item.tap');
  const dailys = await P(ibuHp).locator('#hlist .item.tap', { hasText: 'ROTI DAILYS' }).count();
  check('12:00', 'Ibu sees both ROTI DAILYS entries and who recorded each', dailys === 2 && /MUDA/.test(await text(ibuHp, '#hlist')) && /BUJANG/.test(await text(ibuHp, '#hlist')), `${dailys} shown`);
  await P(ibuHp).locator('#hlist .item.tap', { hasText: 'ROTI DAILYS' }).filter({ hasText: 'MUDA' }).first().click();
  await P(ibuHp).waitForSelector('#ov'); await tapText(ibuHp, '#ov button', 'Hapus'); await tapText(ibuHp, '#ov button', 'Tercatat dua kali');
  await P(ibuHp).waitForFunction(() => !document.querySelector('#ov'), null, { timeout: 15000 });
  await P(ibuHp).waitForTimeout(400);
  check('12:00', 'the double entry is deleted (kept as DIHAPUS)', data().filter(r => r[C.NAME] === 'ROTI DAILYS' && r[C.STATUS] === 'AKTIF').length === 1);
  await snap(ibuHp, 'riwayat-after-delete');
  invariants('12:00');

  // ── 13:00 Muda in the storeroom without signal ──
  at('13:00', 'Muda', 'no signal in the storeroom: AIR GALON and GAS PORTABEL; signal comes back');
  muda.online = false;
  await record(muda, { q: 'galon', pick: 'AIR GALON BIASA', amount: 90000, pay: 'Uang Kasir' }, '13:00');
  check('13:00', 'offline: "Belum terkirim" shown', (await text(muda, '.done h2')) === 'Belum terkirim');
  await snap(muda, 'offline-belum-terkirim');
  await tap(muda, 'text=Catat Lagi');
  await record(muda, { q: 'gas', pick: 'GAS PORTABEL', amount: 72000, pay: 'Uang Kasir' }, '13:00');
  await toHome(muda); await snap(muda, 'home-2-waiting');
  check('13:00', 'home says 2 are waiting', /2 transaksi belum terkirim/.test(await text(muda, '#app')));
  muda.online = true;
  await P(muda).evaluate(() => window.dispatchEvent(new Event('online')));
  await P(muda).waitForFunction(() => window.CatatApp.state.queue.length === 0, null, { timeout: 20000 }).catch(() => {});
  check('13:00', 'both sent by themselves when the signal is back, once each', data().filter(r => /GALON|GAS PORTABEL/.test(r[C.NAME])).length === 2);
  await P(muda).waitForTimeout(300); await snap(muda, 'home-after-sent');
  invariants('13:00');

  // ── 17:00 shift change on the shared shop phone ──
  at('17:00', 'Bujang → Muda', 'Bujang records KANTONG ASOY with no signal, logs out; Muda logs in on the same phone');
  bujang.online = false;
  await record(bujang, { q: 'asoy', pick: 'KANTONG ASOY', amount: 64000, pay: 'Modal' }, '17:00');
  await toHome(bujang);
  await tap(bujang, '[data-act="logout"]'); await P(bujang).waitForSelector('#ov');
  await snap(bujang, 'logout-with-waiting');
  await tapText(bujang, '#ov button', 'Keluar');
  bujang.online = true;
  await login(bujang, 'Muda', WPW);
  await P(bujang).waitForFunction(() => window.CatatApp.state.queue.length === 0, null, { timeout: 20000 }).catch(() => {});
  const asoy = data().filter(r => r[C.NAME] === 'KANTONG ASOY');
  check('17:00', 'Bujang\'s waiting entry is sent once, still under BUJANG', asoy.length === 1 && asoy[0][C.BY] === 'BUJANG', JSON.stringify(asoy.map(r => r[C.BY])));
  await record(bujang, { q: 'thermal', pick: 'KERTAS THERMAL', amount: 55000, pay: 'Uang Kasir' }, '17:00');
  check('17:00', 'Muda\'s own entry on the shared phone is under MUDA', data().find(r => r[C.NAME] === 'KERTAS THERMAL')[C.BY] === 'MUDA');
  await toHome(bujang);
  invariants('17:00');

  // ── 20:00 Ibu on the laptop ──
  at('20:00', 'Ibu (laptop)', 'compares app and month tab; searches an invoice for a sales rep; edits the Sheet by hand');
  const lap = await device('ibu-laptop', { width: 1366, height: 768 }, 1500);
  await P(lap).evaluate(() => localStorage.clear()); await P(lap).reload();
  await login(lap, 'Ibu', APW);
  await tap(lap, '.tile[data-act="history"]'); await P(lap).waitForSelector('#hlist .item.tap', { timeout: 15000 });
  await type(lap, '#hq', '2099');
  check('20:00', 'searching invoice 2099 finds the YAFINDO payment', (await P(lap).locator('#hlist .item.tap').count()) === 1 && /YAFINDO/.test(await text(lap, '#hlist')));
  await snap(lap, 'search-invoice');
  await type(lap, '#hq', '');
  check('20:00', 'app month total = month tab total', (await text(lap, '.card.total .big')) === rp(tabTotal(ym)), `${await text(lap, '.card.total .big')} vs ${rp(tabTotal(ym))}`);
  // hand edits: fix the GAS amount, add a payment Ibu made herself
  const D = env.ss.getSheetByName('Data');
  const gasRow = D.dump().findIndex(r => r[C.NAME] === 'GAS PORTABEL') + 1;
  D.getRange(gasRow, C.AMT + 1).setValue(74000);
  onDataEdit({ range: D.getRange(gasRow, C.AMT + 1), user: { getEmail: () => 'ibu@gmail.com' } });
  const nr = D.getLastRow() + 1;
  D.getRange(nr, 1, 1, 5).setValues([[today.slice(8, 10) + '/' + today.slice(5, 7) + '/' + today.slice(0, 4), 'UANG SAMPAH', '', '50.000', 'Modal']]);
  onDataEdit({ range: D.getRange(nr, 1, 1, 5), user: { getEmail: () => 'ibu@gmail.com' } });
  const us = data().find(r => r[C.NAME] === 'UANG SAMPAH');
  check('20:00', 'Ibu\'s hand-added row is completed (date, amount, MANUAL, ID)', us && us[C.AMT] === 50000 && us[C.BY] === 'MANUAL' && us[C.ID] && us[C.DATE] instanceof Date);
  await tap(lap, '[data-act="reload"]').catch(() => {});
  await P(lap).evaluate(() => { window.CatatApp.state.hist = {}; });
  await tap(lap, '.bar .back'); await tap(lap, '.tile[data-act="history"]'); await P(lap).waitForSelector('#hlist .item.tap', { timeout: 15000 });
  await P(lap).waitForTimeout(300);
  check('20:00', 'the app shows Ibu\'s hand edits (UANG SAMPAH, GAS 74.000)', /UANG SAMPAH/.test(await text(lap, '#hlist')) && /Rp 74\.000/.test(await text(lap, '#hlist')));
  check('20:00', 'app total = month tab after hand edits', (await text(lap, '.card.total .big')) === rp(tabTotal(ym)), `${await text(lap, '.card.total .big')} vs ${rp(tabTotal(ym))}`);
  await snap(lap, 'riwayat-evening');
  invariants('20:00');

  // ── later: day +4 and an invoice from last month ──
  at('Day +4', 'Bujang', 'wants to fix this morning\'s SARI ROTI; then records a last-month invoice');
  const sari = D.dump().findIndex(r => r[C.NAME] === 'SARI ROTI') + 1;
  D.getRange(sari, C.AT + 1).setValue(new Date(Date.now() - 4 * 86400e3));
  await tap(bujang, '[data-act="logout"]'); await tapText(bujang, '#ov button', 'Keluar');
  await login(bujang, 'Bujang', WPW);
  await tap(bujang, '.tile[data-act="history"]'); await P(bujang).waitForSelector('#hlist .item.tap', { timeout: 15000 });
  await tapText(bujang, '#hlist .item.tap', 'SARI ROTI'); await P(bujang).waitForSelector('#ov');
  await snap(bujang, 'older-than-3-days');
  check('Day +4', 'Bujang is told only Ibu can change it now', /Hanya Ibu yang bisa mengubah/.test(await text(bujang, '#ov')) && !(await P(bujang).locator('#ov [data-v="edit"]').count()));
  await P(bujang).keyboard.press('Escape'); await tap(bujang, '.bar .back');
  await tap(bujang, '[data-act="new"]'); await type(bujang, '#q', 'graphika'); await tapText(bujang, '#sugg button', 'GRAPHIKA');
  await P(bujang).fill('#inv', '30234'); await type(bujang, '#amt', '235237'); await tapText(bujang, '#st-from .choice', 'Transfer Ibu');
  await tap(bujang, '[data-act="cal"]'); await P(bujang).waitForSelector('#ov .cal');
  if (prevMonthDay.slice(0, 7) !== ym) await tap(bujang, '#ov [data-cal="-1"]');
  await tap(bujang, `#ov [data-day="${prevMonthDay}"]`);
  await tap(bujang, '[data-act="toReview"]'); await snap(bujang, 'last-month-review'); await tap(bujang, '#saveBtn'); await P(bujang).waitForSelector('.done', { timeout: 20000 });
  const pm = prevMonthDay.slice(0, 7);
  check('Day +4', 'last month\'s invoice lands in last month\'s tab', !!env.ss.getSheetByName(tabName(pm)) && JSON.stringify(env.ss.getSheetByName(tabName(pm)).dump()).includes('GRAPHIKA'));
  check('Day +4', 'month tabs stay newest-first', env.ss.getSheets().map(s => s.getName()).filter(n => /^[A-Z]{3} \d{4}$/.test(n))[0] === tabName(ym));
  invariants('Day +4');

  // ── a real day from the 999 Mart ledger, names typed exactly as they were typed there ──
  const realDayFile = process.env.REAL_DAY;   // [[typed name, amount], ...] — kept outside the repo
  if (realDayFile && fs.existsSync(realDayFile)) {
    at('Real day', 'Bujang + Muda', 'replaying a real ledger day; a hurried worker taps the first button every time');
    const day = JSON.parse(fs.readFileSync(realDayFile, 'utf8')).filter(x => x[1]);
    await toHome(bujang); await toHome(muda);
    const outcomes = [];
    for (let i = 0; i < day.length; i++) {
      const [typed, amount] = day[i]; const d = i % 2 ? muda : bujang;
      await tap(d, '[data-act="new"]'); await type(d, '#q', typed);
      // hurried: taps whatever button is first (a sure match, or "+ Tambah"), and the first choice if asked
      await tap(d, '#sugg button');
      if (await P(d).locator('#ov').count()) await tap(d, '#ov button');
      const picked = await P(d).evaluate(() => window.CatatApp.state.form.name);
      await type(d, '#amt', String(amount)); await tapText(d, '#st-from .choice', 'Transfer Ibu');
      await tap(d, '[data-act="toReview"]'); await tap(d, '#saveBtn'); await P(d).waitForSelector('.done, #ov', { timeout: 20000 });
      if (await P(d).locator('#ov').count()) { await tapText(d, '#ov button', 'tetap simpan'); await P(d).waitForSelector('.done', { timeout: 20000 }); }
      outcomes.push({ typed, picked, amount, by: d.label });
      await toHome(d);
    }
    timeline.push({ time: 'Real day', who: 'outcomes', what: JSON.stringify(outcomes) });
    for (const o of outcomes) console.log(`     ${o.typed.padEnd(30)} → ${o.picked}`);
    const dayTotal = day.reduce((s, x) => s + x[1], 0);
    check('Real day', 'every real payment saved once (total matches the ledger)', outcomes.length === day.length && data().filter(r => outcomes.some(o => o.picked === r[C.NAME] && o.amount === r[C.AMT])).length >= day.length, `${outcomes.length}/${day.length}, ledger total ${dayTotal}`);
    invariants('Real day');
  }

  // ── wrap up ──
  for (const d of [bujang, muda, ibuHp, lap]) check('end', `no JavaScript errors on ${d.label}'s device`, !d.errors.length, d.errors.join(' | '));
  const report = { today, timeline, checks, findings, metrics, log: rows('Log').map(r => [r[1], r[2], r[4], r[5]]), shots: fs.readdirSync(OUT).filter(f => f.endsWith('.png')) };
  fs.writeFileSync(path.join(OUT, 'sim-report.json'), JSON.stringify(report, null, 2));
  await browser.close(); srv.close();
  const bad = checks.filter(c => !c.ok).length;
  console.log(`\n${checks.length - bad}/${checks.length} checks passed · ${metrics.length} entries timed · ${shot} screenshots → ${OUT}`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message.split('\n').slice(0, 8).join('\n')); process.exit(2); });
