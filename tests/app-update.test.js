// Updates reach an installed app by themselves, without reinstalling.
// The test server answers like GitHub Pages (browsers may keep files for 10 minutes); two new versions are
// "published" while the app is open, and the app must pick each one up — but never in the middle of a form.
// Usage: node tests/app-update.test.js
'use strict';
const { chromium, devices } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const SRC = process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : path.join(__dirname, '..', 'web');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'catat-upd-'));
fs.cpSync(SRC, TMP, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(TMP, rel === '/' ? 'index.html' : rel);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });   // like GitHub Pages
    res.end(buf);
  });
});
function publish(n) {   // a new release: new code + the version stamp the publish step writes
  fs.appendFileSync(path.join(TMP, 'app.js'), `\nwindow.__ver = ${n};\n`);
  const sw = path.join(TMP, 'sw.js');
  fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace(/^var VERSION = '[^']*';/m, `var VERSION = 'catat999-test${n}';`));
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 740 }, locale: 'id-ID' });
  const page = await ctx.newPage();
  const results = [];
  const check = (ok, msg, detail) => results.push([!!ok, msg, detail]);
  const comeBack = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // app brought to the front
  const activeVersion = () => page.evaluate(() => caches.keys().then(k => k.join(',')));

  await page.goto(base + '/index.html?demo=1&sw=1');
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  await page.fill('#lname', 'Bujang'); await page.fill('#lpw', 'toko12345'); await page.tap('#loginBtn');
  await page.waitForSelector('[data-act="new"]');
  check(await page.evaluate(() => window.__ver) === undefined, 'installed and running the first version');

  // ── an update while on home: picked up when the app comes back to the front, then reloads by itself ──
  publish(2);
  let reloaded = page.waitForEvent('load', { timeout: 20000 }).catch(() => null);
  await comeBack();
  await reloaded; await page.waitForSelector('[data-act="new"]');
  check(await page.evaluate(() => window.__ver) === 2, 'new version running without reinstalling (not the 10-minute browser copy)', await activeVersion());
  check(await page.waitForFunction(() => /Aplikasi sudah diperbarui/.test((document.querySelector('#toast') || {}).textContent || ''), null, { timeout: 3000 }).then(() => true, () => false), 'says "Aplikasi sudah diperbarui ✓"');
  check(await page.evaluate(() => !!window.CatatApp.state.token), 'still logged in after the update');

  // ── an update while filling in a form: nothing is lost; it loads once the worker is back on home ──
  await page.tap('[data-act="new"]');
  await page.fill('#amt', '43210'); await page.locator('#amt').dispatchEvent('input');
  publish(3);
  await comeBack();
  await page.waitForFunction(() => caches.keys().then(k => k.includes('catat999-test3')), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check(await page.evaluate(() => window.__ver) === 2 && await page.inputValue('#amt') === '43.210', 'during a form: no reload, the typed amount is kept');
  reloaded = page.waitForEvent('load', { timeout: 20000 }).catch(() => null);
  await page.goBack(); await page.waitForSelector('#ov');
  await page.locator('#ov button', { hasText: 'Ya, batalkan' }).tap();
  await reloaded; await page.waitForSelector('[data-act="new"]');
  check(await page.evaluate(() => window.__ver) === 3, 'back on home: the waiting update loads', await activeVersion());
  check((await activeVersion()) === 'catat999-test3', 'old versions are cleaned up (one copy on the phone)', await activeVersion());

  // ── the publish step stamps a new version on every release ──
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pages.yml'), 'utf8');
  check(/sed -i "s\/\^var VERSION/.test(wf) && /GITHUB_SHA/.test(wf), 'every publish gets its own version (stamped from the commit)');

  await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true });
  let failed = 0;
  for (const [ok, msg, detail] of results) { if (!ok) failed++; console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${ok || !detail ? '' : '  → ' + detail}`); }
  console.log(`\n${results.length - failed} update checks passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) { } process.exit(1); });
