// Regression tests for the frontend bugs found by the QA bug hunt (F1 retry, F2 phone clock, F3 recorder name).
const { chromium } = require('playwright');
const path = require('path');
const { serve } = require('./static-server');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function fresh(browser, base, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 360, height: 740 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' }, opts));
  const page = await ctx.newPage();
  await page.goto(base + '/index.html?demo=1'); await page.evaluate(() => localStorage.clear()); await page.reload();
  return { ctx, page };
}
async function loginAs(page, name, pw = 'toko12345') { await page.fill('#lname', name); await page.fill('#lpw', pw); await page.click('#loginBtn'); await page.waitForSelector('[data-act="new"]'); }
async function quickEntry(page, amount) {
  await page.click('[data-act="new"]'); await page.fill('#q', 'rokok'); await page.locator('#q').dispatchEvent('input');
  await page.locator('#sugg button', { hasText: /^ROKOK$/ }).click();
  await page.fill('#amt', String(amount)); await page.locator('#amt').dispatchEvent('input');
  await page.locator('#st-from .choice', { hasText: 'Modal' }).click();
  await page.click('[data-act="toReview"]'); await page.click('#saveBtn'); await page.waitForSelector('.done');
}

(async () => {
  const srv = await serve(path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();

  // F1: a queued (offline) entry that meets a temporary server refusal (rate limit / server busy) is turned into
  //     "Perlu dicek — mungkin tercatat dua kali" and never retried automatically.
  {
    const { ctx, page } = await fresh(browser, srv.url);
    await loginAs(page, 'Ani');
    await page.evaluate(() => localStorage.setItem('c9demo.offline', '1'));
    await quickEntry(page, 11111);
    await page.evaluate(() => {
      localStorage.removeItem('c9demo.offline');
      const real = window.CatatMockApi.handle;
      window.CatatMockApi.handle = b => b.action === 'add' ? Promise.resolve({ ok: false, error: 'Terlalu cepat. Tunggu sebentar lalu coba lagi.' }) : real(b);
    });
    await page.click('[data-act="home"]').catch(() => page.click('text=Ke Beranda'));
    await page.click('text=Kirim sekarang'); await page.waitForTimeout(1200);
    const q = await page.evaluate(() => window.CatatApp.state.queue.map(o => o.state));
    const banner = (await page.locator('.banner.err').textContent().catch(() => '')) || '';
    
    check('F1 temporary server error keeps the entry waiting (auto-retry)', q[0] === 'waiting', `queue state = ${JSON.stringify(q)}; banner = "${banner.trim().slice(0, 60)}"`);
    await ctx.close();
  }

  // F2: phone clock is wrong (1 day ahead): the form's "Hari ini" uses the phone date, not the server's date.
  {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
    const page = await ctx.newPage();
    await page.clock.install({ time: new Date(Date.now() + 86400e3) });   // phone thinks it is tomorrow
    await page.goto(srv.url + '/index.html?demo=1'); await page.evaluate(() => localStorage.clear()); await page.reload();
    // the server (mock) knows the real date
    await page.evaluate(() => { const real = window.CatatMockApi.handle; const t = new Date(Date.now() - 86400e3 + 7 * 3600e3).toISOString().slice(0, 10); window.CatatMockApi.handle = b => real(b).then(r => { if (b.action === 'boot' && r.ok) r.today = t; return r; }); });
    await loginAs(page, 'Ani');
    await page.waitForFunction(() => window.CatatApp.state.boot && window.CatatApp.state.boot.today);
    await page.click('[data-act="new"]');
    const s = await page.evaluate(() => ({ server: window.CatatApp.state.boot.today, form: window.CatatApp.state.form.date }));
    
    check('F2 "Hari ini" follows the server date, not a wrong phone clock', s.form === s.server, `server today ${s.server}, form date ${s.form}`);
    await ctx.close();
  }

  // F3: entries saved offline by Ani, then Ani logs out and Budi logs in on the same phone → sent as "Dicatat oleh BUDI".
  {
    const { ctx, page } = await fresh(browser, srv.url);
    await loginAs(page, 'Ani');
    await page.evaluate(() => localStorage.setItem('c9demo.offline', '1'));
    await quickEntry(page, 22222);
    await page.click('text=Ke Beranda');
    await page.evaluate(() => localStorage.removeItem('c9demo.offline'));
    await page.click('[data-act="logout"]'); await page.locator('#ov button', { hasText: 'Keluar' }).click();
    await page.waitForSelector('#loginForm'); await loginAs(page, 'Budi');
    await page.waitForFunction(() => window.CatatApp.state.queue.length === 0, null, { timeout: 8000 });
    const by = await page.evaluate(() => JSON.parse(localStorage.getItem('c9demo.data')).filter(r => r.amount === 22222).map(r => r.by));
    check('F3 offline entry keeps the name of who recorded it', by[0] === 'ANI', `recorded as ${JSON.stringify(by)}`);
    await ctx.close();
  }

  // F4: a date correction learned from the server is only trusted for 12 hours (the phone clock may have been fixed since)
  {
    const { ctx, page } = await fresh(browser, srv.url);
    await loginAs(page, 'Ani');
    const r = await page.evaluate(() => {
      const A = window.CatatApp, S = A.state, real = A.today();
      S.clock = { shift: 1, at: Date.now() - 60e3 }; const fresh = A.today();
      S.clock = { shift: 1, at: Date.now() - 13 * 3600e3 }; const stale = A.today();
      S.clock = { shift: 1, at: Date.now() + 3600e3 }; const back = A.today();
      return { real, fresh, stale, back, plus1: A.addDays(real, 1) };
    });
    check('F4 server date shift applied while fresh, ignored when stale or if the clock went back', r.fresh === r.plus1 && r.stale === r.real && r.back === r.real, JSON.stringify(r));
    await ctx.close();
  }

  // F5: Ani logs out with an entry still waiting → her session is kept until it is sent; if it turns out to be a
  //     duplicate (or is thrown away), her session is ended on the server anyway.
  {
    const { ctx, page } = await fresh(browser, srv.url);
    await loginAs(page, 'Ani');
    const tokA = await page.evaluate(() => window.CatatApp.state.token);
    await page.evaluate(() => localStorage.setItem('c9demo.offline', '1'));
    await quickEntry(page, 33333);
    await page.click('text=Ke Beranda');
    await page.click('[data-act="logout"]'); await page.locator('#ov button', { hasText: 'Keluar' }).click();
    const deferred = await page.evaluate(t => window.CatatApp.state.logoutLater.includes(t), tokA);
    await page.evaluate(() => {
      localStorage.removeItem('c9demo.offline');
      const real = window.CatatMockApi.handle;
      window.CatatMockApi.handle = b => b.action === 'add' ? Promise.resolve({ ok: false, code: 'DUP_SIMILAR', error: 'Sudah ada transaksi yang sama di tanggal itu.' }) : real(b);
    });
    await page.waitForSelector('#loginForm'); await loginAs(page, 'Budi');
    await page.waitForFunction(() => window.CatatApp.state.queue[0] && window.CatatApp.state.queue[0].state === 'conflict', null, { timeout: 8000 });
    await page.waitForTimeout(500);
    const after = await page.evaluate(t => ({ later: window.CatatApp.state.logoutLater.length, aliveA: !!JSON.parse(localStorage.getItem('c9demo.sessions'))[t] }), tokA);
    check('F5 deferred logout is completed once nothing of hers is left to send', deferred && after.later === 0 && !after.aliveA, JSON.stringify({ deferred, after }));
    await ctx.close();
  }

  await browser.close(); srv.close();
  if (results.includes(false)) process.exit(1);
})().catch(e => { console.error('ERROR', e.message); process.exit(2); });
