// End-to-end: the REAL app (not demo mode) talking to the REAL backend code (Code.gs on the in-memory Sheet).
// Playwright intercepts the app's calls to script.google.com and answers them by running doPost() here in Node —
// so the whole path is exercised: fetch, JSON, tokens, validation, the Sheet, month tabs and the Log.
// Usage: TZ=Asia/Jakarta node tests/e2e-real-backend.test.js
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { install } = require('./gas-mock');
const { serve } = require('./static-server');

const env = install(globalThis);
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Seed.gs'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), { filename: 'Code.gs' });
setup(); setPassword_('worker', 'tokoSembilan9'); setPassword_('admin', 'ibuBatam2026!');

const API = 'https://script.google.com/macros/s/TEST/exec';
let mode = 'ok';       // ok | offline | html | slow
let calls = 0;
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ✓', m); };

(async () => {
  const srv = await serve(path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  // point the app at the "real" API
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.CATAT_CONFIG = { API_URL: '${API}' };` }));
  await ctx.route(API, async route => {
    calls++;
    if (mode === 'offline') return route.abort('internetdisconnected');
    if (mode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Sign in – Google Accounts</body></html>' });
    const req = route.request();
    assert.strictEqual(req.method(), 'POST');
    assert.match(req.headers()['content-type'], /^text\/plain/, 'simple request (no CORS preflight)');
    env.cache.clear();   // rate-limit counters are per minute; the test clicks faster than people do
    const out = doPost({ postData: { contents: req.postData() } }).getContent();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out });
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.dismiss());
  const data = () => env.ss.getSheetByName('Data').dump().slice(1).filter(r => r.some(v => v !== ''));
  const typeIn = async (sel, v) => { await page.fill(sel, v); await page.locator(sel).dispatchEvent('input'); };
  const record = async (q, pick, amount, pay, inv) => {
    if (!(await page.locator('#q').count())) await page.click('[data-act="new"]');
    await typeIn('#q', q);
    await page.locator('#sugg button', { hasText: pick }).first().click();
    if (inv) await page.fill('#inv', inv);
    await typeIn('#amt', String(amount));
    await page.locator('#st-from .choice', { hasText: pay }).click();
    await page.click('[data-act="toReview"]'); await page.click('#saveBtn');
  };

  await page.goto(srv.url + '/index.html');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  ok(await page.locator('.demo').count() === 0, 'runs in real mode (no "MODE COBA" bar)');

  // wrong password, then right one
  await page.fill('#lname', 'Bujang'); await page.fill('#lpw', 'salahsalah'); await page.click('#loginBtn');
  await page.waitForFunction(() => document.querySelector('#loginErr').textContent.length > 0);
  ok((await page.textContent('#loginErr')) === 'Kata sandi salah.', 'server says "Kata sandi salah."');
  await page.fill('#lpw', 'tokoSembilan9'); await page.click('#loginBtn');
  await page.waitForSelector('[data-act="new"]');
  ok((await page.textContent('.bar .who')).trim() === 'BUJANG', 'logged in through the real backend');
  await page.waitForFunction(() => window.CatatApp.state.boot && window.CatatApp.state.boot.suppliers.length > 100);
  ok(true, 'supplier list (124 seeded names) loaded from the Sheet');

  // record a supplier payment → lands in Data, month tab and Log
  await record('yafindo', 'YAFINDO', 1776424, 'Transfer Ibu', '0012345');
  await page.waitForSelector('.done');
  ok((await page.textContent('.done h2')) === 'Berhasil disimpan', 'saved');
  let rows = data();
  ok(rows.length === 1 && rows[0][C.NAME] === 'PT. YAFINDO MITRA PERMATA' && rows[0][C.AMT] === 1776424 && rows[0][C.BY] === 'BUJANG', 'row written to Data with the right values');
  const tabName = BULAN[Number(todayStr_().slice(5, 7)) - 1] + ' ' + todayStr_().slice(0, 4);
  ok(env.ss.getSheetByName(tabName).dump()[2][0] === 1776424, 'month tab total updated');
  ok(env.ss.getSheetByName('Log').dump().some(r => r[2] === 'Tambah' && r[1] === 'BUJANG'), 'Log has the addition');

  // same invoice again → duplicate warning from the server
  await page.click('text=Catat Lagi');
  await record('yafindo', 'YAFINDO', 5000, 'Modal', '12345');
  await page.waitForSelector('#ov');
  ok((await page.textContent('#ov')).includes('Invoice ini sudah pernah dicatat'), 'server duplicate check reaches the user');
  await page.locator('#ov button', { hasText: 'Jangan simpan' }).click();
  ok(data().length === 1, 'nothing saved after "Jangan simpan"');

  // offline → queued → sent once the connection is back, exactly once
  mode = 'offline';
  await record('rokok', /^ROKOK$/, 350000, 'Uang Kasir');
  await page.waitForSelector('.done');
  ok((await page.textContent('.done h2')) === 'Belum terkirim', 'offline: kept on the phone');
  await page.click('text=Ke Beranda');
  mode = 'ok';
  await page.click('text=Kirim sekarang');
  await page.waitForFunction(() => window.CatatApp.state.queue.length === 0, null, { timeout: 10000 });
  ok(data().filter(r => r[C.NAME] === 'ROKOK').length === 1, 'sent exactly once when back online');

  // the server answers with a web page instead of data → clear message, entry kept and sent later
  mode = 'html';
  await record('galon', 'GALON', 18000, 'Modal');
  await page.waitForSelector('.done');
  ok((await page.textContent('.done p')).includes('server sedang gangguan'), 'server hiccup: entry kept, user told why');
  mode = 'ok';
  await page.click('text=Ke Beranda'); await page.click('text=Kirim sekarang');
  await page.waitForFunction(() => window.CatatApp.state.queue.length === 0, null, { timeout: 10000 });
  ok(data().filter(r => /GALON/.test(r[C.NAME])).length === 1, '…and delivered once the server is fine');

  // history from the real list, edit and delete through the real backend
  await page.click('.tile[data-act="history"]');
  await page.waitForSelector('#hlist .item.tap');
  ok((await page.locator('#hlist .item.tap').count()) === 3, 'Riwayat lists the 3 real rows');
  await page.locator('#hlist .item.tap', { hasText: 'ROKOK' }).click();
  await page.locator('#ov button', { hasText: 'Ubah' }).click();
  await typeIn('#amt', '360000');
  await page.click('[data-act="toReview"]'); await page.click('#saveBtn');
  await page.waitForSelector('.done');
  ok(data().find(r => r[C.NAME] === 'ROKOK')[C.AMT] === 360000, 'edit reached the Sheet');
  ok(env.ss.getSheetByName('Log').dump().some(r => r[2] === 'Ubah' && /350\.000 → Rp 360\.000/.test(r[5])), 'Log shows before → after');
  await page.click('text=Kembali ke Riwayat'); await page.waitForSelector('#hlist .item.tap');
  await page.locator('#hlist .item.tap', { hasText: 'ROKOK' }).click();
  await page.locator('#ov button', { hasText: 'Hapus' }).click();
  await page.locator('#ov button', { hasText: 'Salah input' }).click();
  await page.waitForFunction(() => !document.querySelector('#ov'));
  await page.waitForTimeout(800);
  ok(data().find(r => r[C.NAME] === 'ROKOK')[C.STATUS] === 'DIHAPUS', 'delete marks DIHAPUS in the Sheet');
  ok(!(await page.locator('#hlist').textContent()).includes('ROKOK'), 'and it is gone from Riwayat');

  // login page served instead of data: clear message on login too
  await page.click('.bar .back'); await page.click('[data-act="logout"]'); await page.locator('#ov button', { hasText: 'Keluar' }).click();
  await page.waitForSelector('#loginForm');
  mode = 'html';
  await page.fill('#lname', 'Ibu'); await page.fill('#lpw', 'ibuBatam2026!'); await page.click('#loginBtn');
  await page.waitForFunction(() => document.querySelector('#loginErr').textContent.length > 0);
  ok((await page.textContent('#loginErr')).startsWith('Server tidak menjawab dengan benar'), 'misconfigured server is not reported as "no internet"');
  mode = 'ok';
  await page.click('#loginBtn'); await page.waitForSelector('[data-act="new"]');
  ok((await page.textContent('.bar .tag')) === 'Admin', 'admin login through the real backend');

  ok(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close(); srv.close();
  console.log(`\n${passed} end-to-end checks passed (${calls} API calls)`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
