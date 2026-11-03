// Phone-feel details: the keyboard per field (type, Enter label, what Enter does), taps that don't jump the page or
// close the keyboard, the header buttons, pull-to-refresh, the install card, "Terakhir dicatat" on home and the
// "Memperbarui…" note in Riwayat.  Usage: node tests/app-ux.test.js
'use strict';
const { chromium, devices } = require('playwright');
const path = require('path');
const { serve } = require('./static-server');

(async () => {
  const srv = await serve(process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();
  const results = [];
  const check = (ok, msg, detail) => results.push([!!ok, msg, detail]);
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 740 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const attr = (sel, a) => page.getAttribute(sel, a);
  const focused = () => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
  await page.goto(srv.url + '/index.html?demo=1');
  await page.evaluate(() => localStorage.clear()); await page.reload();

  // ── login keyboard ──
  check(await attr('#lname', 'enterkeyhint') === 'next' && await attr('#lname', 'autocorrect') === 'off', 'login name: Enter says "next", no autocorrect');
  check(await attr('#lpw', 'enterkeyhint') === 'go', 'password: Enter says "go"');
  await page.fill('#lname', 'Bujang'); await page.focus('#lname'); await page.keyboard.press('Enter');
  check(await focused() === 'lpw', 'Enter on the name goes to the password', await focused());
  await page.fill('#lpw', 'toko12345'); await page.keyboard.press('Enter');
  await page.waitForSelector('[data-act="new"]');
  check(true, 'Enter on the password logs in');

  // ── header ──
  check((await page.locator('.bar button.who').textContent()).includes('BUJANG') && await page.locator('.bar button.who svg').count() === 1, 'home header: name with a person icon (a button)');
  check(await page.locator('.bar .bar-btn[aria-label="Muat ulang"] svg').count() === 1, 'home header: refresh icon button');
  await page.waitForTimeout(300);
  const boots = () => page.evaluate(() => window.__boots || 0);
  await page.evaluate(() => { const real = window.CatatMockApi.handle; window.__boots = 0; window.CatatMockApi.handle = b => { if (b.action === 'boot') window.__boots++; return new Promise(r => setTimeout(r, 300)).then(() => real(b)); }; });
  await page.tap('.bar-btn');
  check(await page.evaluate(() => document.querySelector('.bar-btn').classList.contains('busy')), 'refresh icon spins while loading');
  await page.waitForFunction(() => !document.querySelector('.bar-btn.busy'));
  check(await boots() === 1 && /Data sudah terbaru/.test(await page.textContent('#toast')), 'refresh: data fetched, "Data sudah terbaru ✓"');
  await page.tap('.bar button.who'); await page.waitForSelector('#ov');
  const acct = await page.textContent('#ov');
  check(/Akun/.test(acct) && /Masuk sebagai BUJANG/.test(acct) && await page.locator('#ov button', { hasText: 'Keluar' }).count() === 1, 'tapping the name: who is logged in + Keluar', acct.slice(0, 80));
  await page.keyboard.press('Escape');
  check(await page.locator('.updated').count() === 1 && (await page.locator('.updated').evaluate(e => parseFloat(getComputedStyle(e).fontSize))) <= 13, '"Diperbarui" is small at the bottom');

  // ── install card (browser only, dismissible) ──
  check(await page.locator('.install').count() === 1, 'in the browser: "Pasang di HP" card');
  await page.tap('.install [data-act="install"]'); await page.waitForSelector('#ov');
  check(/Tambahkan ke layar utama/.test(await page.textContent('#ov')), 'no install prompt available → clear steps (⋮ → Tambahkan ke layar utama)');
  await page.keyboard.press('Escape');
  await page.tap('.install [data-act="installHide"]');
  check(await page.locator('.install').count() === 0, '× hides the card');
  check(/ketuk nama Anda di kanan atas/.test(await page.textContent('#toast')), '…and says where to find it again');
  await page.tap('.bar button.who'); await page.waitForSelector('#ov');
  check(await page.locator('#ov button', { hasText: 'Pasang di HP' }).count() === 1, 'the account pop-up (tap your name) has "Pasang di HP"');
  await page.locator('#ov button', { hasText: 'Pasang di HP' }).tap(); await page.waitForSelector('#ov');
  check(/Tambahkan ke layar utama/.test(await page.textContent('#ov')), '…which shows the install steps');
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('[data-act="new"]');
  check(await page.locator('.install').count() === 0, '…and it stays hidden');

  // ── recent entries on home ──
  const recent = await page.locator('.recent .item').count();
  check(recent >= 1 && /Terakhir dicatat/.test(await page.textContent('.recent h2')), `"Terakhir dicatat" shows the latest entries (${recent})`);

  // Riwayat opened once earlier in the day (so this month is on the phone)
  await page.tap('.tile[data-act="history"]'); await page.waitForSelector('#hlist .item.tap');
  await page.tap('.bar .back'); await page.waitForSelector('[data-act="new"]');

  // ── form keyboard + Enter ──
  await page.tap('[data-act="new"]');
  check(await attr('#q', 'enterkeyhint') === 'next' && await attr('#q', 'autocorrect') === 'off' && await attr('#q', 'spellcheck') === 'false', 'supplier search: no autocorrect, Enter "next"');
  await page.fill('#q', 'yakul'); await page.locator('#q').dispatchEvent('input');
  await page.focus('#q'); await page.keyboard.press('Enter');
  check(/YAKULT/.test(await page.textContent('.picked')) && await focused() === 'inv', 'Enter on a sure match picks it and goes to the invoice', await focused());
  check(await attr('#inv', 'enterkeyhint') === 'next' && await attr('#inv', 'autocorrect') === 'off', 'invoice: no autocorrect, Enter "next"');
  await page.keyboard.type('a12'); await page.keyboard.press('Enter');
  check(await focused() === 'amt', 'Enter on the invoice goes to the amount', await focused());
  check(await attr('#amt', 'inputmode') === 'numeric' && await attr('#amt', 'enterkeyhint') === 'done', 'amount: number keyboard, Enter "done"');
  await page.keyboard.type('47200'); await page.keyboard.press('Enter');
  check(await focused() !== 'amt', 'Enter on the amount puts the keyboard away', await focused());
  await page.fill('#q', '').catch(() => {});
  // the page must not jump, and the box being typed in must not be destroyed, when tapping a choice
  await page.focus('#amt');
  await page.evaluate(() => { window.__amtNode = document.querySelector('#amt'); document.querySelector('#st-from').scrollIntoView({ block: 'center' }); });
  const pos = sel => page.evaluate(s => Math.round(document.querySelector(s).getBoundingClientRect().top), sel);
  const before = await pos('#st-from');
  await page.tap('#st-from .choice[data-v="Transfer Ibu"]');
  check(await pos('#st-from') === before, 'tapping "Transfer Ibu": the page does not move');
  check(await page.evaluate(() => document.querySelector('#amt') === window.__amtNode), '…and the amount box is not rebuilt (keyboard does not snap shut)');
  check(await page.getAttribute('#st-from .choice[data-v="Transfer Ibu"]', 'aria-pressed') === 'true', '…and Transfer Ibu is selected');
  const bd = await pos('#st-date');
  await page.tap('#st-date .choice:nth-child(2)');
  check(await pos('#st-date') === bd && await page.evaluate(() => document.querySelector('#amt') === window.__amtNode), 'tapping "Kemarin": no jump, nothing rebuilt');
  await page.tap('#st-from .choice[data-v="Lainnya"]');
  check(await focused() === 'other' && await attr('#other', 'enterkeyhint') === 'done', '"Lainnya" opens "Uang siapa?" with the keyboard; Enter "done"', await focused());
  await page.keyboard.type('Pak Rudi'); await page.keyboard.press('Enter');
  check(await focused() !== 'other', 'Enter on "Uang siapa?" puts the keyboard away');
  await page.tap('#st-from .choice[data-v="Modal"]');
  check(await page.locator('#other').count() === 0, 'another choice removes "Uang siapa?"');
  check(await attr('#note', 'enterkeyhint') === 'done', 'note: Enter "done"');
  await page.focus('#note'); await page.keyboard.type('retur 2 dus'); await page.keyboard.press('Enter');
  check(await page.inputValue('#note') === 'retur 2 dus' && await focused() !== 'note', 'Enter on the note: no new line, keyboard away');
  // still saves correctly after the partial updates
  await page.tap('[data-act="toReview"]'); await page.waitForSelector('#saveBtn');
  const rv = await page.textContent('.card.review');
  check(/YAKULT/.test(rv) && /A12/.test(rv) && /47\.200/.test(rv) && /Modal/.test(rv) && /retur 2 dus/.test(rv), 'Cek Lagi shows everything entered', rv.replace(/\s+/g, ' ').slice(0, 160));
  await page.tap('#saveBtn'); await page.waitForSelector('.done');

  // ── saved entry is on home and in Riwayat straight away; Riwayat says when it's refreshing ──
  await page.evaluate(() => { const real = window.CatatMockApi.handle; window.CatatMockApi.handle = b => b.action === 'list' ? new Promise(r => setTimeout(r, 800)).then(() => real(b)) : real(b); });
  await page.tap('.done [data-act="home"], button[data-act="home"]');
  await page.waitForSelector('.recent .item');
  check(/YAKULT/.test(await page.locator('.recent .item').first().textContent()), 'home: the new entry is first in "Terakhir dicatat"');
  await page.tap('.tile[data-act="history"]');
  await page.waitForSelector('#hlist');
  const firstList = await page.textContent('#hlist');
  check(/YAKULT/.test(firstList) && /Memperbarui/.test(firstList), 'Riwayat: the new entry shows at once, with "Memperbarui…" while it checks', firstList.slice(0, 120));
  await page.waitForFunction(() => !/Memperbarui/.test(document.querySelector('#hlist').textContent), null, { timeout: 5000 });
  check(true, '"Memperbarui…" goes away when done');
  // a pop-up open while Riwayat finishes loading must not leave "Memperbarui…" stuck on the screen
  await page.evaluate(() => { const real = window.CatatMockApi.handle; window.CatatMockApi.handle = b => b.action === 'list' ? new Promise(r => setTimeout(r, 900)).then(() => real(b)) : real(b); });
  await page.tap('.bar-btn');
  await page.waitForFunction(() => /Memperbarui/.test(document.querySelector('#hlist').textContent));
  await page.tap('#hlist .item.tap'); await page.waitForSelector('#ov');
  check(await page.locator('#ov button', { hasText: 'Tutup' }).evaluate(b => b.classList.contains('outline')), 'detail pop-up: "Tutup" is a normal outlined button');
  check(/\d\d:\d\d/.test(await page.textContent('#ov')) && !/\d\d\.\d\d(?!\d)/.test((await page.textContent('#ov')).replace(/Rp [\d.]+/g, '')), 'times read 11:52 (not 11.52, which looks like a version)');
  await page.waitForFunction(() => !window.CatatApp.isLoading(), null, { timeout: 10000 });   // finished while the pop-up was open
  await page.tap('#ov button:has-text("Tutup")');
  check(!/Memperbarui/.test(await page.textContent('#hlist')), 'after closing the pop-up the list is up to date, not stuck on "Memperbarui…"');
  check(await page.locator('.bar .back svg').count() === 1 && await page.getAttribute('.bar .back', 'aria-label') === 'Kembali', 'back button: a real arrow icon, named "Kembali"');
  check(await attr('#hq', 'enterkeyhint') === 'search', 'Riwayat search: Enter "search"');
  await page.evaluate(() => { window.CatatApp.state.hist = {}; });
  await page.waitForFunction(() => !window.CatatApp.isLoading(), null, { timeout: 10000 });
  await page.tap('.bar-btn');
  check(/Memuat riwayat/.test(await page.textContent('#hlist')) || /Memperbarui/.test(await page.textContent('#hlist')), 'Riwayat refresh with nothing cached: "Memuat riwayat…"');
  await page.waitForSelector('#hlist .item.tap');

  // ── pull down to refresh ──
  await page.evaluate(() => window.scrollTo(0, 0));
  const lists = () => page.evaluate(() => window.__lists || 0);
  await page.evaluate(() => { const real = window.CatatMockApi.handle; window.__lists = 0; window.CatatMockApi.handle = b => { if (b.action === 'list') window.__lists++; return real(b); }; });
  const pull = (dy) => page.evaluate(dy => {
    const t = document.querySelector('#app');
    const mk = y => new Touch({ identifier: 1, target: t, clientX: 180, clientY: y });
    t.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(120)], bubbles: true }));
    for (let y = 120; y <= 120 + dy; y += 20) t.dispatchEvent(new TouchEvent('touchmove', { touches: [mk(y)], bubbles: true }));
    const e = document.querySelector('#ptr'), during = e ? e.className : '';
    t.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
    return { during, after: e ? e.className : '' };
  }, dy);
  const shortPull = await pull(60);
  await page.waitForTimeout(300);
  check(await lists() === 0 && /show/.test(shortPull.during) && !/ready/.test(shortPull.during) && shortPull.after === '', 'a short pull: the circle follows the finger, then goes away without refreshing', JSON.stringify(shortPull));
  const longPull = await pull(200);
  check(/ready/.test(longPull.during) && /spinning/.test(longPull.after), 'pulling far enough: the circle turns green, then keeps spinning after letting go', JSON.stringify(longPull));
  await page.waitForFunction(() => !document.querySelector('#ptr.spinning'), null, { timeout: 8000 });
  check(await lists() === 1 && await page.evaluate(() => window.CatatApp.state.screen) === 'history', '…Riwayat reloads once, and you stay on Riwayat', `${await lists()} / ${await page.evaluate(() => window.CatatApp.state.screen)}`);
  check(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY === 'contain' && getComputedStyle(document.body).overscrollBehaviorY === 'contain'), "Chrome's own pull-to-refresh (reloads the page → lands on home) is off on the page root too");
  // the same on home
  await page.tap('.bar .back'); await page.waitForSelector('.tile[data-act="new"]');
  await page.evaluate(() => { const real = window.CatatMockApi.handle; window.__boots = 0; window.CatatMockApi.handle = b => { if (b.action === 'boot') window.__boots++; return real(b); }; });
  await pull(200);
  await page.waitForFunction(() => !document.querySelector('#ptr.spinning'), null, { timeout: 8000 });
  check(await boots() === 1 && await page.evaluate(() => window.CatatApp.state.screen) === 'home', 'pull on home: refreshes once, stays on home');
  await page.tap('.tile[data-act="history"]'); await page.waitForSelector('#hlist .item.tap');

  // ── toast: short messages on one line, long ones wrap inside the screen ──
  for (const w of [320, 412]) {
    await page.setViewportSize({ width: w, height: 740 });
    const t = await page.evaluate(() => { const r = []; for (const m of ['Data sudah terbaru ✓', 'Server tidak menjawab dengan benar. Coba lagi nanti; kalau terus begini, kabari Ibu.']) { window.CatatApp.toast(m, 'ok'); const e = document.querySelector('#toast'), rc = e.getBoundingClientRect(); r.push({ lines: Math.round((rc.height - 24) / parseFloat(getComputedStyle(e).lineHeight)), l: rc.left, r: innerWidth - rc.right }); } return r; });
    check(t[0].lines === 1 && t[1].l >= 15 && t[1].r >= 15 && Math.abs(t[1].l - t[1].r) < 2, `${w}px: "Data sudah terbaru ✓" on one line; long messages wrap centred inside the screen`, JSON.stringify(t));
  }
  await page.setViewportSize({ width: 360, height: 740 });

  // ── viewport: the page is resized for the keyboard (predictable) ──
  check(/interactive-widget=resizes-content/.test(await page.getAttribute('meta[name="viewport"]', 'content')), 'keyboard resizes the page instead of sliding it (interactive-widget)');

  // ── installed app: no install card ──
  const ctx2 = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 740 }, locale: 'id-ID' });
  await ctx2.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = q => /display-mode: standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {} } : mm(q); });
  const p2 = await ctx2.newPage();
  await p2.goto(srv.url + '/index.html?demo=1'); await p2.evaluate(() => localStorage.clear()); await p2.reload();
  await p2.fill('#lname', 'Ani'); await p2.fill('#lpw', 'toko12345'); await p2.click('#loginBtn'); await p2.waitForSelector('[data-act="new"]');
  check(await p2.locator('.install').count() === 0, 'opened as the installed app: no install card');
  await p2.click('.bar button.who'); await p2.waitForSelector('#ov');
  check(await p2.locator('#ov button', { hasText: 'Pasang di HP' }).count() === 0, '…and no "Pasang di HP" in the account pop-up');
  await ctx2.close();

  await browser.close(); srv.close();
  let failed = 0;
  for (const [ok, msg, detail] of results) { if (!ok) failed++; console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${ok || !detail ? '' : '  → ' + detail}`); }
  if (errors.length) { failed++; console.log('  ✗ page errors: ' + errors.join(' | ')); }
  console.log(`\n${results.length - failed} phone-feel checks passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
