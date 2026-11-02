// Screen-by-screen walkthrough of every app state, at several screen sizes.
// For each screen it saves a screenshot and runs automatic checks:
//   - horizontal overflow / elements sticking out of the screen
//   - text cut off inside buttons, chips and labels
//   - tap targets smaller than 44×44 px
//   - accessibility (axe-core: contrast, labels, names, roles)
//   - JavaScript errors
// Usage: node tests/ui-walkthrough.js <shots_dir> [width x height ...]
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { serve } = require('./static-server');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const OUT = process.argv[2] || '/tmp/walk';
fs.mkdirSync(OUT, { recursive: true });
const SIZES = process.argv.slice(3).length ? process.argv.slice(3).map(s => s.split('x').map(Number)) : [[360, 740], [320, 568], [412, 915], [1366, 768]];

async function checks(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
    const label = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '')) + ' "' + (el.textContent || el.placeholder || '').trim().slice(0, 30) + '"';
    if (document.documentElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px > ${vw}px)`);
    document.querySelectorAll('#app *, #ov *').forEach(el => {
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) out.push('sticks out of screen: ' + label(el) + ` [${Math.round(r.left)}..${Math.round(r.right)}]`);
    });
    document.querySelectorAll('button, .chip, .lbl, .nm, .amt, h1, h2, h3, dd, .money, .big').forEach(el => {
      if (!visible(el)) return;
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') out.push('text cut off: ' + label(el));
      if (el.scrollWidth > el.clientWidth + 2 && el.matches('button, .chip')) out.push('text wider than its button: ' + label(el));
    });
    document.querySelectorAll('input').forEach(el => {
      if (visible(el) && el.value && el.scrollWidth > el.clientWidth + 1) out.push('typed value cut off in box: ' + label(el) + ' "' + el.value + '"');
    });
    document.querySelectorAll('button, input, textarea, a').forEach(el => {
      if (!visible(el) || el.disabled) return;
      if (el.closest('.cal')) { const r = el.getBoundingClientRect(); if (r.height < 40 || r.width < 36) out.push('calendar day too small: ' + label(el)); return; }
      const r = el.getBoundingClientRect();
      if (r.height < 44 || r.width < 44) out.push(`small tap target ${Math.round(r.width)}×${Math.round(r.height)}: ` + label(el));
    });
    return out;
  });
}

(async () => {
  const srv = await serve(path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();
  const report = {};
  const errors = [];
  for (const [w, h] of SIZES) {
    const phone = w < 600;
    const tag = `${w}x${h}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, locale: 'id-ID', timezoneId: 'Asia/Jakarta', bypassCSP: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
    let n = 0;
    const snap = async (name, full = false) => {
      await page.waitForTimeout(450);
      const file = `${tag}-${String(++n).padStart(2, '0')}-${name}.png`;
      await page.screenshot({ path: path.join(OUT, file), fullPage: full });
      const found = await checks(page);
      await page.evaluate(AXE);
      const axe = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] });
        return r.violations.map(v => `axe ${v.id} (${v.impact}): ` + v.nodes.slice(0, 3).map(x => x.target.join(' ')).join(' | '));
      });
      const all = found.concat(axe);
      if (all.length) report[file] = all;
      console.log(`${all.length ? '✗' : '✓'} ${file}`);
      all.forEach(x => console.log('     · ' + x));
    };
    const tap = (t, root = 'body') => page.locator(`${root} button`, { hasText: t }).first().click();
    const typeIn = async (sel, v) => { await page.fill(sel, v); await page.locator(sel).dispatchEvent('input'); };

    await page.goto(srv.url + '/index.html?demo=1');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#loginForm');
    await snap('login');
    await page.fill('#lname', 'Bujang'); await page.fill('#lpw', 'salah123'); await tap('Masuk');
    await page.waitForFunction(() => document.querySelector('#loginErr').textContent);
    await snap('login-wrong-password');
    await page.fill('#lpw', 'toko12345'); await tap('Masuk');
    await page.waitForSelector('[data-act="new"]');
    await snap('home');

    await page.click('[data-act="new"]'); await page.waitForSelector('#q');
    await snap('form-empty', true);
    await tap('Lanjut');
    await snap('form-errors', true);
    await typeIn('#q', 'sumber');
    await snap('form-suggestions');
    await typeIn('#q', 'Toko Kue Mama Lina Sejahtera Abadi');
    await page.click('[data-act="addnew"]');
    await typeIn('#amt', '125000000');
    await tap('Lainnya');
    await page.fill('#other', 'BUJANG');
    await page.fill('#inv', 'INV/2026/11/000123');
    await page.fill('#note', 'Retur 2 dus, sisanya dibayar minggu depan oleh Ibu lewat transfer');
    await snap('form-filled-long-values', true);
    await page.click('[data-act="cal"]'); await page.waitForSelector('.cal');
    await snap('calendar');
    await page.click('.calnav [data-cal="-1"]');
    await snap('calendar-prev-month');
    await page.locator('.cal .day:not([disabled])').first().click();
    await tap('Lanjut'); await page.waitForSelector('#saveBtn');
    await snap('review-big-amount', true);
    await page.click('#saveBtn');
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(OUT, `${tag}-${String(++n).padStart(2, '0')}-saving.png`) });
    await page.waitForSelector('.done');
    await snap('done');

    // similar-name sheet + duplicate sheet
    await tap('Catat Lagi'); await page.waitForSelector('#q');
    await typeIn('#q', 'Sampurna Sukses'); await page.click('[data-act="addnew"]');
    await page.waitForSelector('#ov');
    await snap('similar-name-sheet');
    await page.locator('#ov button').first().click();
    await typeIn('#amt', '350000'); await tap('Uang Kasir');
    await tap('Lanjut'); await page.click('#saveBtn'); await page.waitForSelector('.done');
    await tap('Catat Lagi'); await page.waitForSelector('#q');
    await typeIn('#q', 'Sampurna Sukses'); await page.locator('#sugg button').first().click();
    await typeIn('#amt', '350000'); await tap('Uang Kasir');
    await tap('Lanjut'); await page.click('#saveBtn'); await page.waitForSelector('#ov');
    await snap('duplicate-sheet');
    await tap('Jangan simpan', '#ov');

    // offline
    await page.evaluate(() => localStorage.setItem('c9demo.offline', '1'));
    await page.click('[data-act="new"]'); await typeIn('#q', 'rokok'); await page.locator('#sugg button').first().click();
    await typeIn('#amt', '350000'); await tap('Uang Kasir'); await tap('Kemarin');
    await tap('Lanjut'); await page.click('#saveBtn'); await page.waitForSelector('.done');
    await snap('done-offline');
    await tap('Ke Beranda');
    await snap('home-offline-banner');
    await page.click('.tile[data-act="history"]');
    await page.waitForSelector('#hlist .banner, #hlist .item, #hlist .empty');
    await snap('history-offline', true);
    await page.click('.bar .back');
    await page.evaluate(() => localStorage.removeItem('c9demo.offline'));
    await tap('Kirim sekarang');
    // the queued entry duplicates "ROKOK 350.000 yesterday"? (demo row is yesterday 350.000) → conflict
    await page.waitForFunction(() => !document.querySelector('.banner.warn'), null, { timeout: 8000 }).catch(() => { });
    await page.waitForTimeout(600);
    await snap('home-after-send');

    // history
    await page.click('.tile[data-act="history"]'); await page.waitForSelector('#hlist .item.tap');
    await snap('history', true);
    await typeIn('#hq', 'sampurna');
    await snap('history-search');
    await typeIn('#hq', 'zzzz');
    await snap('history-search-empty');
    await typeIn('#hq', '');
    await page.locator('#hlist .item.tap').first().click(); await page.waitForSelector('#ov');
    await snap('detail-editable');
    await tap('Ubah', '#ov'); await page.waitForSelector('#amt');
    await snap('edit-form', true);
    await tap('Lanjut'); await page.waitForSelector('#saveBtn');
    await snap('edit-review-no-changes', true);
    await page.click('.bar .back');
    await typeIn('#amt', '125500000');
    await tap('Lanjut'); await page.waitForSelector('#saveBtn');
    await snap('edit-review-changed', true);
    await page.click('#saveBtn'); await page.waitForSelector('.done');
    await snap('done-edit');
    await tap('Kembali ke Riwayat'); await page.waitForSelector('#hlist .item.tap');
    await page.locator('#hlist .item.tap').first().click(); await page.waitForSelector('#ov');
    await tap('Hapus', '#ov'); await page.waitForSelector('#ov h3');
    await snap('delete-sheet');
    await tap('Batal', '#ov');
    for (let i = 0; i < 2; i++) {
      if (await page.locator('#hlist .item.tap', { hasText: 'INV/2210' }).count()) break;
      await page.click('.monthnav [data-v="-1"]'); await page.waitForTimeout(700);
    }
    await page.locator('#hlist .item.tap', { hasText: 'INV/2210' }).click(); await page.waitForSelector('#ov');
    await snap('detail-locked');
    await page.locator('#ov button').last().click();
    await page.click('.monthnav [data-v="-1"]'); await page.waitForTimeout(700);
    await snap('history-empty-month');

    // leave + logout sheets
    await page.click('.bar .back'); await page.waitForSelector('[data-act="new"]');
    await page.click('[data-act="new"]'); await typeIn('#amt', '5000');
    await page.goBack(); await page.waitForSelector('#ov');
    await snap('leave-form-sheet');
    await tap('Ya, batalkan', '#ov'); await page.waitForSelector('[data-act="logout"]');
    await page.click('[data-act="logout"]'); await page.waitForSelector('#ov');
    await snap('logout-sheet');
    await tap('Keluar', '#ov'); await page.waitForSelector('#loginForm');
    await page.fill('#lname', 'Ibu'); await page.fill('#lpw', 'ibu12345'); await tap('Masuk');
    await page.waitForSelector('[data-act="new"]');
    await snap('home-admin');
    await page.click('.tile[data-act="history"]'); await page.waitForSelector('#hlist .item.tap');
    await snap('history-admin');
    await ctx.close();
  }
  await browser.close(); srv.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ report, errors }, null, 2));
  const total = Object.values(report).reduce((s, a) => s + a.length, 0);
  console.log(`\n${Object.keys(report).length} screens with issues, ${total} issues, ${errors.length} JS errors → ${path.join(OUT, 'report.json')}`);
})().catch(e => { console.error('FAIL:', e.stack); process.exit(1); });
