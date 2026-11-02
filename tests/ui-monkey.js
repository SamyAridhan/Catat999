// Monkey test: a "random user" taps buttons, types junk, presses the phone's back button and turns the internet
// off and on — hundreds of steps per run — and after EVERY step checks that the app is still in a sane state.
// When something breaks it prints the seed and the last steps so the exact run can be replayed.
// Usage: node tests/ui-monkey.js [steps=300] [runs=3] [seed]
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { serve } = require('./static-server');
const STEPS = Number(process.argv[2] || 300), RUNS = Number(process.argv[3] || 3);
const SEED0 = Number(process.argv[4] || Date.now() % 100000);

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const JUNK = ['', ' ', 'a', 'rokok', 'yafindo', 'PT. Baru Sekali', '=SUM(A1)', '<img src=x onerror=alert(1)>', "O'Brien", '١٢٣', '😀', '0', '0000000', '999999999999', '12.500', 'x'.repeat(80), 'Lainnya', 'INV/001', '   spasi   '];

async function checks(page, log) {
  const s = await page.evaluate(() => {
    const out = [];
    const app = document.querySelector('#app');
    if (!app || !app.innerHTML.trim()) out.push('blank screen');
    if (!document.querySelector('.bar h1')) out.push('no title bar');
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push('page scrolls sideways');
    const ov = document.querySelector('#ov');
    if (ov && !ov.querySelector('button')) out.push('dialog with no way out');
    if (document.querySelectorAll('#ov').length > 1) out.push('two dialogs stacked');
    // money adds up on Riwayat
    const tot = document.querySelector('#hlist .card.total .big');
    if (tot) {
      const num = t => Number(t.replace(/[^\d]/g, '')) || 0;
      const rows = [...document.querySelectorAll('#hlist .item.tap .amt')].reduce((a, e) => a + num(e.textContent), 0);
      if (num(tot.textContent) !== rows) out.push(`Riwayat total ${tot.textContent} ≠ sum of rows ${rows}`);
      let days = 0; document.querySelectorAll('#hlist .group-head span:last-child').forEach(e => { days += num(e.textContent); });
      if (days !== rows) out.push(`day totals ${days} ≠ rows ${rows}`);
    }
    // a word-amount that disagrees with the number
    const amt = document.querySelector('#amt'), words = document.querySelector('#words');
    if (amt && words && !!amt.value !== !!words.textContent.trim()) out.push('terbilang out of sync with amount');
    // anything rendered as HTML from user text?
    if (document.querySelector('#app img, #ov img, #app script')) out.push('user text rendered as HTML');
    return out;
  });
  // a button stuck in "Menyimpan…/Memuat…/Menghapus…" for long is a hang
  const busy = await page.locator('button:has(.spin)').count();
  if (busy) {
    await page.waitForTimeout(4000);
    if (await page.locator('button:has(.spin)').count()) s.push('button stuck in loading state');
  }
  return s;
}

(async () => {
  const srv = await serve(process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();
  let failures = 0, totalSteps = 0;
  for (let run = 0; run < RUNS; run++) {
    const seed = SEED0 + run, rand = rng(seed), pick = a => a[Math.floor(rand() * a.length)];
    const phone = run % 2 === 0;
    const ctx = await browser.newContext(phone ? { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, locale: 'id-ID', timezoneId: 'Asia/Jakarta' } : { viewport: { width: 1366, height: 768 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { errors.push('browser dialog: ' + d.message()); d.dismiss(); });
    await page.goto(srv.url + '/index.html?demo=1');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.fill('#lname', pick(['Ani', 'Ibu', 'Budi'])); await page.fill('#lpw', rand() < 0.5 ? 'ibu12345' : 'toko12345'); await page.click('#loginBtn');
    await page.waitForSelector('[data-act="new"]');
    const trail = [];
    let broken = null;
    for (let i = 0; i < STEPS && !broken; i++) {
      const r = rand();
      let did = '';
      try {
        if (r < 0.04) { const off = rand() < 0.5; await page.evaluate(o => o ? localStorage.setItem('c9demo.offline', '1') : localStorage.removeItem('c9demo.offline'), off); did = off ? 'internet OFF' : 'internet ON'; }
        else if (r < 0.10) {
          await page.goBack().catch(() => { }); did = 'phone back button';
          // back on the home screen closes the app (normal on Android) → open it again, as a user would
          if (!page.url().startsWith(srv.url)) { await page.goto(srv.url + '/index.html?demo=1'); await page.waitForSelector('.bar h1'); did += ' → app closed, reopened'; }
        }
        else if (r < 0.22 && await page.locator('#st-amt').count()) {
          // sometimes behave like a real worker: fill the form properly, so the run reaches review, save, duplicates…
          if (await page.locator('#freq .chip').count()) await pick(await page.locator('#freq .chip').all()).click();
          else if (await page.locator('#q').count()) { await page.fill('#q', pick(['rokok', 'yafindo', 'galon', 'sari roti'])); await page.locator('#q').dispatchEvent('input'); const sg = await page.locator('#sugg button').all(); if (sg.length) await pick(sg).click(); }
          const amt = page.locator('#amt'); await amt.fill(''); await amt.type(String(pick([350000, 1776424, 20000, 25000000]) ), { delay: 0 });
          await pick(await page.locator('#st-from .choice').all()).click();
          if (await page.locator('#other').count()) await page.fill('#other', 'BUJANG');
          await page.locator('[data-act="toReview"]').click();
          did = 'fill the form properly + Lanjut';
        }
        else if (r < 0.32) {
          const inputs = await page.locator('#app input:visible, #app textarea:visible, #ov input:visible').all();
          if (inputs.length) {
            const el = pick(inputs), v = pick(JUNK) + (rand() < 0.3 ? String(Math.floor(rand() * 5e6)) : '');
            const id = await el.getAttribute('id');
            if (id === 'amt') { await el.fill(''); await el.type(v.slice(0, 14), { delay: 0 }); } else { await el.fill(v); await el.dispatchEvent('input'); }
            did = `type "${v.slice(0, 30)}" into #${id}`;
          }
        } else {
          const btns = await page.locator('#ov button:visible:enabled').count()
            ? await page.locator('#ov button:visible:enabled').all()
            : await page.locator('button:visible:enabled').all();
          // don't log out too often, it just restarts the run
          const usable = [];
          for (const b of btns) { const t = (await b.textContent()) || ''; if (!/^Keluar$/.test(t.trim()) || rand() < 0.05) usable.push([b, t.trim()]); }
          if (usable.length) { const [b, t] = pick(usable); await b.click({ timeout: 3000 }); did = `tap "${t.slice(0, 30)}"`; }
          if (await page.locator('#loginForm').count()) { await page.fill('#lname', 'Ani'); await page.fill('#lpw', 'toko12345'); await page.click('#loginBtn'); await page.waitForSelector('[data-act="new"]', { timeout: 5000 }).catch(() => { }); did += ' → logged in again'; }
        }
      } catch (e) { did += ' (action failed: ' + e.message.split('\n')[0] + ')'; }
      trail.push(did); totalSteps++;
      if (process.env.MONKEY_DEBUG) console.log('   ', i, did, '→', await page.locator('.bar h1').first().textContent().catch(() => '?'));
      await page.waitForTimeout(rand() < 0.2 ? 450 : 60);
      const bad = (await checks(page)).concat(errors.splice(0));
      if (bad.length) broken = bad;
    }
    if (broken) {
      failures++;
      console.log(`✗ run ${run + 1} (seed ${seed}, ${phone ? 'phone' : 'laptop'}) after ${trail.length} steps: ${broken.join('; ')}`);
      console.log('   last steps:\n     ' + trail.slice(-10).join('\n     '));
      await page.screenshot({ path: `/tmp/monkey-fail-${seed}.png` });
    } else console.log(`✓ run ${run + 1} (seed ${seed}, ${phone ? 'phone' : 'laptop'}): ${trail.length} random steps, no problems`);
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(`\n${totalSteps} random steps, ${failures} broken run(s)`);
  if (failures) process.exit(1);
})().catch(e => { console.error('FAIL:', e.stack); process.exit(1); });
