// The app's "plumbing", checked directly in the browser: talking to the server (api), refreshing data (refresh),
// sending entries that waited on the phone (flush) and finishing deferred logouts (endLaterSessions).
// The server's answers are scripted, so every branch is reached on purpose. Written from mutation-test survivors.
// Usage: node tests/app-flows.test.js
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { serve } = require('./static-server');

(async () => {
  const srv = await serve(process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();
  const results = [];
  const errors = [];

  // ── part 1: demo mode with a scripted server ──
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url + '/index.html?demo=1');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.fill('#lname', 'Budi'); await page.fill('#lpw', 'toko12345'); await page.click('#loginBtn');
  await page.waitForFunction(() => window.CatatApp.state.boot && window.CatatApp.state.boot.suppliers.length > 50);
  await page.waitForTimeout(300);

  results.push(...await page.evaluate(async () => {
    const A = window.CatatApp, S = A.state, out = [];
    const eq = (got, want, msg) => out.push([JSON.stringify(got) === JSON.stringify(want), msg, got, want]);
    const real = window.CatatMockApi.handle;
    let calls = [], replies = {};
    window.CatatMockApi.handle = b => {
      calls.push(JSON.parse(JSON.stringify(b)));
      const q = replies[b.action];
      if (q && q.length) { const r = q.shift(); return r instanceof Error ? Promise.reject(r) : Promise.resolve(typeof r === 'function' ? r(b) : r); }
      return real(b);
    };
    const reset = () => { calls = []; replies = {}; };
    const stored = k => JSON.parse(localStorage.getItem('c9demo.' + k) || 'null');
    const toastText = () => { const t = document.querySelector('#toast'); return t && /show/.test(t.className) ? t.textContent : ''; };
    const clearToast = () => { const t = document.querySelector('#toast'); if (t) { t.className = 'toast'; t.textContent = ''; } };
    const T = S.token, ME = S.user.name, today = A.today();
    const entry = (n, extra) => Object.assign({ id: 'e' + n + 'abcdefgh', type: 'SUPPLIER', date: today, name: 'ROKOK', invoice: '', amount: 1000 * n, paidFrom: 'Modal', note: '' }, extra || {});
    const item = (n, extra) => Object.assign({ qid: 'q' + n, state: 'waiting', entry: entry(n), force: false, token: T, by: ME }, extra || {});
    const adds = () => calls.filter(c => c.action === 'add');
    const setQueue = q => { S.queue = q; localStorage.setItem('c9demo.queue', JSON.stringify(q)); };

    // ── flush: what gets sent ──
    reset(); setQueue([]); await A.flush();
    eq(calls.length, 0, 'flush: empty queue sends nothing');

    reset(); setQueue([item(1, { retryAt: Date.now() + 30000 })]); await A.flush();
    eq(adds().length, 0, 'flush: an entry waiting for its retry minute is not sent yet');
    reset(); setQueue([item(1, { retryAt: Date.now() - 1 })]); replies.add = [{ ok: true }]; await A.flush();
    eq(adds().length, 1, 'flush: once the retry minute has passed it is sent');

    reset(); setQueue([item(1, { state: 'conflict' }), item(2, { state: 'invalid' })]); await A.flush();
    eq(adds().length, 0, 'flush: entries waiting for a person are not sent automatically');

    const tok = S.token; S.token = '';
    reset(); setQueue([item(1, { token: '' })]); await A.flush();
    eq(adds().length, 0, 'flush: no token anywhere → nothing sent');
    S.token = tok;

    reset(); setQueue([item(1, { token: 'OTHERTOKEN', force: true })]); replies.add = [{ ok: true }]; await A.flush();
    eq([adds()[0].token, adds()[0].force, adds()[0].entry.id], ['OTHERTOKEN', true, 'e1abcdefgh'], 'flush: sent with the recorder\'s token, force flag and the same ID');
    reset(); setQueue([item(1, { token: '' })]); replies.add = [{ ok: true }]; await A.flush();
    eq([adds()[0].token, adds()[0].force], [T, false], 'flush: legacy item without a token uses the current login; force is a real boolean');

    // ── flush: success ──
    reset(); clearToast();
    S.hist[today.slice(0, 7)] = { entries: [], total: 0, at: Date.now() };
    setQueue([item(1), item(2)]); replies.add = [{ ok: true }, { ok: true }];
    await A.flush();
    eq(adds().map(c => c.entry.id), ['e1abcdefgh', 'e2abcdefgh'], 'flush: sends every waiting entry, oldest first');
    eq(calls.map(c => c.action), ['add', 'boot', 'add', 'boot'], 'flush: refreshes the data after each sent entry');
    eq([S.queue.length, stored('queue').length], [0, 0], 'flush: sent entries leave the queue (and the saved copy)');
    eq(S.hist[today.slice(0, 7)].at, 0, 'flush: that month\'s history is marked out of date');
    eq(toastText(), 'Transaksi yang tertunda sudah terkirim ✓', 'flush: says so when everything has been sent');

    reset(); clearToast();
    setQueue([item(1), item(2)]); replies.add = [{ ok: true }, { ok: false, code: 'DUP_INVOICE', error: 'Invoice ini sudah pernah dicatat', existing: { id: 'x' } }];
    await A.flush();
    eq(toastText(), '', 'flush: no "all sent" message while something is still waiting');

    // ── flush: refusals ──
    eq([S.queue.length, S.queue[0].state, S.queue[0].existing, S.queue[0].error], [1, 'conflict', { id: 'x' }, 'Invoice ini sudah pernah dicatat'], 'flush: duplicate invoice → "Perlu dicek" with the existing entry');
    eq(stored('queue')[0].state, 'conflict', 'flush: the conflict is saved on the phone');
    reset(); setQueue([item(1)]); replies.add = [{ ok: false, code: 'DUP_SIMILAR' }]; await A.flush();
    eq([S.queue[0].state, S.queue[0].existing, S.queue[0].error], ['conflict', null, 'Gagal'], 'flush: similar entry → conflict; missing details become null / "Gagal"');
    reset(); setQueue([item(1), item(2)]); replies.add = [{ ok: false, code: 'INVALID', error: 'Tanggal tidak valid.' }, { ok: true }]; await A.flush();
    eq([S.queue.length, S.queue[0].state, S.queue[0].error, adds().length], [1, 'invalid', 'Tanggal tidak valid.', 2], 'flush: refused entry → "invalid", and the next one is still sent');
    reset(); setQueue([item(1)]); replies.add = [{ ok: false, error: 'ID transaksi tidak valid.' }]; await A.flush();
    eq(S.queue[0].state, 'invalid', 'flush: a bad-ID message without a code also counts as invalid');
    reset(); setQueue([item(1), item(2)]);
    replies.add = [{ ok: false, error: 'Terlalu cepat. Tunggu sebentar lalu coba lagi.' }];
    const t0 = Date.now(); await A.flush();
    const it = S.queue[0];
    eq([it.state, it.retryAt >= t0 + 59000 && it.retryAt <= Date.now() + 61000, adds().length], ['waiting', true, 1], 'flush: temporary refusal → stays waiting, retried in a minute, nothing else sent now');
    eq(stored('queue')[0].retryAt, it.retryAt, 'flush: the retry time is saved');

    // ── flush: sessions ──
    reset(); setQueue([item(1, { token: 'OLDTOKEN', by: 'ANI', entry: entry(1, { note: 'bayar sebagian' }) })]);
    replies.add = [{ ok: false, code: 'AUTH' }, { ok: true }];
    await A.flush();
    eq(adds().map(c => c.token), ['OLDTOKEN', T], 'flush: recorder\'s session ended → resent with the current login');
    eq(adds()[1].entry.note, 'bayar sebagian · dicatat oleh ANI', 'flush: …keeping who recorded it in the note');
    reset(); setQueue([item(1, { token: 'OLDTOKEN', by: 'ANI' })]); replies.add = [{ ok: false, code: 'AUTH' }, { ok: true }]; await A.flush();
    eq(adds()[1].entry.note, 'dicatat oleh ANI', 'flush: empty note → just "dicatat oleh"');
    reset(); setQueue([item(1, { token: 'OLDTOKEN', by: ME })]); replies.add = [{ ok: false, code: 'AUTH' }, { ok: true }]; await A.flush();
    eq(adds()[1].entry.note, '', 'flush: same person logged in again → note unchanged');
    reset(); setQueue([item(1, { token: 'OLDTOKEN', by: '' })]); replies.add = [{ ok: false, code: 'AUTH' }, { ok: true }]; await A.flush();
    eq(adds()[1].entry.note, '', 'flush: unknown recorder → note unchanged');
    reset(); setQueue([item(1, { token: 'OLDTOKEN', by: 'ANI', entry: entry(1, { note: 'x'.repeat(195) }) })]); replies.add = [{ ok: false, code: 'AUTH' }, { ok: true }]; await A.flush();
    eq(adds()[1].entry.note.length, 200, 'flush: note stays within 200 characters');
    reset(); setQueue([item(1, { token: 'OLDTOKEN', by: 'ANI' })]); replies.add = [{ ok: false, code: 'AUTH' }, { ok: false, error: 'Server sibuk' }]; await A.flush();
    eq([S.queue[0].token, stored('queue')[0].token], [T, T], 'flush: the new token is saved with the entry');

    S.token = '';
    reset(); setQueue([item(1, { token: 'OLDTOKEN', by: 'ANI' })]); replies.add = [{ ok: false, code: 'AUTH' }]; await A.flush();
    eq([adds().length, S.queue[0].token, S.queue[0].state], [1, 'OLDTOKEN', 'waiting'], 'flush: recorder\'s session ended and nobody is logged in → wait for a login');
    S.token = T;

    // a network failure doesn't leave flush stuck
    reset(); setQueue([item(1)]); replies.add = [new Error('NETWORK')]; await A.flush().catch(() => {});
    replies.add = [{ ok: true }]; await A.flush();
    eq([adds().length, S.queue.length], [2, 0], 'flush: works again after a network failure');
    // two flushes at the same moment send once
    reset(); setQueue([item(1)]); replies.add = [{ ok: true }, { ok: true }];
    await Promise.all([A.flush(), A.flush()]);
    eq(adds().length, 1, 'flush: two at once → sent once');

    // ── deferred logouts ──
    reset(); setQueue([item(1, { token: 'T1' }), item(2, { token: 'T3', state: 'conflict' })]);
    S.logoutLater = ['T1', 'T2', 'T3'];
    A.endLaterSessions();
    eq(S.logoutLater, ['T1'], 'endLaterSessions: keeps only sessions that still have entries waiting to be sent');
    eq(stored('logoutLater'), ['T1'], 'endLaterSessions: saved');
    eq(calls.filter(c => c.action === 'logout').map(c => c.token), ['T2', 'T3'], 'endLaterSessions: ends the others on the server');
    reset(); setQueue([]); S.logoutLater = []; localStorage.removeItem('c9demo.logoutLater');

    // ── refresh ──
    reset(); clearToast(); replies.boot = [{ ok: false, error: 'Spreadsheet sedang dikunci.' }]; await A.refresh();
    eq(toastText(), 'Spreadsheet sedang dikunci.', 'refresh: server refusal shown');
    reset(); clearToast(); replies.boot = [{ ok: false }]; await A.refresh();
    eq(toastText(), 'Gagal memuat data', 'refresh: refusal without a message → "Gagal memuat data"');
    reset(); clearToast(); replies.boot = [{ ok: false, error: 'x' }]; await A.refresh(true);
    eq(toastText(), '', 'refresh(quiet): refusal not shown');
    reset(); clearToast(); replies.boot = [Object.assign(new Error('NETWORK'), { network: true })]; await A.refresh();
    eq(toastText(), 'Tidak ada koneksi internet. Memakai data terakhir.', 'refresh: offline message');
    reset(); clearToast(); replies.boot = [Object.assign(new Error('SERVER'), { server: true })]; await A.refresh();
    eq(toastText(), 'Server sedang gangguan. Memakai data terakhir.', 'refresh: server-trouble message');
    reset(); clearToast(); replies.boot = [new Error('NETWORK')]; await A.refresh(true);
    eq(toastText(), '', 'refresh(quiet): offline not shown');

    const bootReply = d => b => Object.assign({}, S.boot, { ok: true, today: d, suppliers: S.boot.suppliers });
    const plus2 = A.addDays(A.phoneToday(), 2);
    S.clock = null; localStorage.removeItem('c9demo.clock');
    reset(); replies.boot = [bootReply(plus2)]; const before = Date.now(); await A.refresh(true);
    eq(S.clock && S.clock.shift, 2, 'refresh: learns the server date (phone 2 days behind)');
    eq(S.clock.at >= before && S.clock.at <= Date.now(), true, 'refresh: …and when it learned it');
    eq(stored('clock').shift, 2, 'refresh: the date correction is saved');
    eq(typeof S.boot.fetchedAt === 'string' && Date.now() - Date.parse(S.boot.fetchedAt) < 5000, true, 'refresh: remembers when data was fetched');
    eq(stored('boot').today, plus2, 'refresh: data saved on the phone');
    for (const bad of ['', 'x' + plus2, plus2 + 'x', plus2.slice(0, 9)]) {
      S.clock = null; reset(); replies.boot = [bootReply(bad)]; await A.refresh(true);
      eq(S.clock, null, 'refresh: no correction learned from a malformed date "' + bad + '"');
    }
    S.clock = null; localStorage.removeItem('c9demo.clock');

    // home screen redraws with fresh data, other screens don't
    reset(); S.screen = 'home'; A.render(); document.querySelector('#app').insertAdjacentHTML('beforeend', '<i id="mark"></i>');
    await A.refresh(true);
    eq(!!document.querySelector('#mark'), false, 'refresh: home screen redrawn');
    S.screen = 'history'; A.render(); document.querySelector('#app').insertAdjacentHTML('beforeend', '<i id="mark"></i>');
    await A.refresh(true);
    eq(!!document.querySelector('#mark'), true, 'refresh: other screens left alone');
    S.screen = 'home'; A.render(); document.querySelector('#app').insertAdjacentHTML('beforeend', '<i id="mark"></i>'); document.body.insertAdjacentHTML('beforeend', '<div id="ov"></div>');
    await A.refresh(true);
    eq(!!document.querySelector('#mark'), true, 'refresh: home not redrawn under an open dialog');
    document.querySelector('#ov').remove();
    S.screen = 'home'; A.render();

    // a sent entry redraws home/Riwayat, but not under an open dialog
    reset(); setQueue([item(1)]); replies.add = [{ ok: true }];
    A.render(); document.querySelector('#app').insertAdjacentHTML('beforeend', '<i id="mark"></i>'); document.body.insertAdjacentHTML('beforeend', '<div id="ov"></div>');
    await A.flush();
    eq(!!document.querySelector('#mark'), true, 'flush: no redraw while a dialog is open');
    document.querySelector('#ov').remove();
    reset(); setQueue([item(1)]); replies.add = [{ ok: false, code: 'DUP_INVOICE' }];
    A.render(); document.querySelector('#app').insertAdjacentHTML('beforeend', '<i id="mark"></i>');
    await A.flush();
    eq(!!document.querySelector('#mark'), false, 'flush: home redrawn to show "Perlu dicek"');
    S.screen = 'form'; S.form = A.newForm(); A.render(); document.querySelector('#app').insertAdjacentHTML('beforeend', '<i id="mark"></i>');
    reset(); setQueue([item(1)]); replies.add = [{ ok: true }]; await A.flush();
    eq(!!document.querySelector('#mark'), true, 'flush: the form being filled in is not redrawn');
    S.form = null; S.screen = 'home'; A.render(); setQueue([]);

    // ── authFail ──
    eq([A.authFail(null), A.authFail({ ok: false, code: 'INVALID' }), A.authFail({ ok: true })], [false, false, false], 'authFail: only for AUTH');
    reset(); setQueue([item(1, { token: T })]); replies.add = [{ ok: false, code: 'AUTH' }]; await A.flush();
    eq([S.token, S.user, S.screen, S.notice, stored('token'), stored('user')], ['', null, 'login', 'Sesi habis. Silakan masuk lagi.', null, null], 'flush: own session ended → back to login with a message');
    eq(S.queue.length, 1, 'flush: …and the entry is kept');
    window.CatatMockApi.handle = real;
    return out;
  }));

  // the "online" event sends waiting entries and reloads Riwayat
  await page.fill('#lname', 'Budi'); await page.fill('#lpw', 'toko12345'); await page.click('#loginBtn');
  await page.waitForSelector('[data-act="new"]');
  results.push(...await page.evaluate(async () => {
    const A = window.CatatApp, S = A.state, out = [];
    const calls = []; const real = window.CatatMockApi.handle;
    window.CatatMockApi.handle = b => { calls.push(b.action + (b.month ? ':' + b.month : '')); return b.action === 'add' ? Promise.resolve({ ok: true }) : real(b); };
S.queue = [];
    S.screen = 'history'; S.month = A.today().slice(0, 7); A.render();
    await new Promise(r => setTimeout(r, 600)); calls.length = 0;
    S.queue = [{ qid: 'q1', state: 'waiting', entry: { id: 'e1abcdefgh', type: 'SUPPLIER', date: A.today(), name: 'ROKOK', invoice: '', amount: 5000, paidFrom: 'Modal', note: '' }, token: S.token, by: S.user.name }];
    window.dispatchEvent(new Event('online'));
    await new Promise(r => setTimeout(r, 1200));
    out.push([calls.includes('add'), 'online event: waiting entries are sent', calls.slice(), 'add']);
    out.push([calls.some(c => c.startsWith('list')), 'online event on Riwayat: the month is reloaded', calls, 'list']);
    S.screen = 'home'; A.render(); calls.length = 0;
    window.dispatchEvent(new Event('online'));
    await new Promise(r => setTimeout(r, 800));
    out.push([!calls.some(c => c.startsWith('list')), 'online event elsewhere: Riwayat not reloaded', calls, 'no list']);
    window.CatatMockApi.handle = real;
    return out;
  }));
  await ctx.close();

  // ── part 2: the real api() against a fake Google endpoint ──
  const API = 'https://script.google.com/macros/s/TEST/exec';
  const ctx2 = await browser.newContext({ locale: 'id-ID', timezoneId: 'Asia/Jakarta', serviceWorkers: 'block' });
  await ctx2.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `window.CATAT_CONFIG = { API_URL: '${API}' };` }));
  let mode = 'json', seen = null;
  await ctx2.route(API, route => {
    const req = route.request();
    seen = { method: req.method(), type: req.headers()['content-type'], body: JSON.parse(req.postData() || '{}') };
    if (mode === 'abort') return route.abort('internetdisconnected');
    if (mode === '500') return route.fulfill({ status: 500, contentType: 'text/html', body: 'error' });
    if (mode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Sign in</html>' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, echo: 1 }) });
  });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push(e.message));
  await p2.goto(srv.url + '/index.html');
  const run = m => { mode = m; return p2.evaluate(() => window.CatatApp.api('boot', { month: '2026-11' }).then(r => ({ ok: r }), e => ({ err: { network: !!e.network, server: !!e.server, msg: e.message, isNet: window.CatatApp.isNet(e) } }))); };
  const eq2 = (got, want, msg) => results.push([JSON.stringify(got) === JSON.stringify(want), msg, got, want]);
  await p2.evaluate(() => { window.CatatApp.state.token = 'TOK123'; });
  eq2(await run('json'), { ok: { ok: true, echo: 1 } }, 'api: JSON answer is passed back');
  eq2([seen.method, seen.type, seen.body.action, seen.body.token, seen.body.month, typeof seen.body.device === 'string' && seen.body.device.length > 0],
    ['POST', 'text/plain;charset=utf-8', 'boot', 'TOK123', '2026-11', true], 'api: POST, plain text (no CORS preflight), action + token + device + payload');
  eq2(await run('500'), { err: { network: false, server: true, msg: 'SERVER', isNet: false } }, 'api: error status → "server trouble", not "no internet"');
  eq2(await run('html'), { err: { network: false, server: true, msg: 'SERVER', isNet: false } }, 'api: a web page instead of data → "server trouble"');
  eq2(await run('abort'), { err: { network: true, server: false, msg: 'NETWORK', isNet: true } }, 'api: no connection → "no internet"');
  eq2(await p2.evaluate(() => window.CatatApp.SERVER_MSG), 'Server tidak menjawab dengan benar. Coba lagi nanti; kalau terus begini, kabari Ibu.', 'api: server-trouble wording');
  // a hanging request is given up after 30 s
  await p2.clock.install();
  await p2.reload();
  mode = 'hang';
  await ctx2.unroute(API);
  await ctx2.route(API, () => { /* never answers */ });
  const hang = p2.evaluate(() => window.CatatApp.api('boot').then(() => 'answered', e => (e.network ? 'network' : 'other')));
  await p2.waitForTimeout(200);
  await p2.clock.runFor(29000);
  const early = await Promise.race([hang, new Promise(r => setTimeout(() => r('still waiting'), 300))]);
  await p2.clock.runFor(2000);
  const late = await Promise.race([hang, new Promise(r => setTimeout(() => r('still waiting'), 2000))]);
  eq2([early, late], ['still waiting', 'network'], 'api: a request that never answers is given up after 30 s (counted as no internet)');
  await ctx2.close();

  await browser.close(); srv.close();
  let failed = 0;
  for (const [ok, msg, got, want] of results) { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}${ok ? '' : `\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`}`); }
  if (errors.length) { failed++; console.log('FAIL  page errors: ' + errors.join(' | ')); }
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
