// What the screens are made of, checked directly in the browser (fast, no clicking around):
// the form's fields, labels and buttons, supplier suggestions, the waiting list, toasts — plus the small
// helpers behind them (IDs, dates, clock correction, history cache loading). Written from mutation-test survivors.
// Usage: node tests/app-render.test.js
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { serve } = require('./static-server');
const ACTIVE_MUTANT = process.env.__STRYKER_ACTIVE_MUTANT__;

(async () => {
  const srv = await serve(process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();
  const results = [];
  const errors = [];

  // ── part 1: everything in a normal phone context ──
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  if (ACTIVE_MUTANT) await ctx.addInitScript(`globalThis.__stryker__ = globalThis.__stryker__ || {}; globalThis.__stryker__.activeMutant = ${JSON.stringify(ACTIVE_MUTANT)};`);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url + '/index.html?demo=1');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.fill('#lname', 'Tester'); await page.fill('#lpw', 'toko12345'); await page.click('#loginBtn');
  await page.waitForFunction(() => window.CatatApp.state.boot && window.CatatApp.state.boot.suppliers.length > 50);

  results.push(...await page.evaluate(async () => {
    const A = window.CatatApp, S = A.state, out = [];
    const eq = (got, want, msg) => out.push([JSON.stringify(got) === JSON.stringify(want), msg, got, want]);
    const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
    const t = A.today();
    const show = (screen, form) => { S.form = form; S.screen = screen; A.render(); };

    // ── small helpers ──
    const ids = new Set(); for (let i = 0; i < 500; i++) ids.add(A.uid());
    eq(ids.size, 500, 'uid: unique');
    eq([...ids].every(x => /^e[0-9a-z]{9,16}$/.test(x)), true, 'uid: e + base36, valid server id length');
    eq(A.daysBetween('2026-11-01', '2026-11-03'), 2, 'daysBetween forward');
    eq(A.daysBetween('2026-11-03', '2026-11-01'), -2, 'daysBetween backward');
    eq(A.daysBetween('2026-03-28', '2026-03-30'), 2, 'daysBetween over a month');
    S.clock = null; eq(A.shiftNow(), 0, 'shiftNow: nothing learned');
    S.clock = { shift: 0, at: Date.now() }; eq(A.shiftNow(), 0, 'shiftNow: zero');
    S.clock = { shift: -2, at: Date.now() - 1000 }; eq(A.shiftNow(), -2, 'shiftNow: negative shift applied');
    S.clock = { shift: 3, at: Date.now() - 12 * 3600e3 + 5000 }; eq(A.shiftNow(), 3, 'shiftNow: just under 12 h');
    S.clock = { shift: 3, at: Date.now() - 12 * 3600e3 - 5000 }; eq(A.shiftNow(), 0, 'shiftNow: just over 12 h');
    S.clock = null;
    const boot = S.boot, user = S.user;
    S.boot = null; eq([A.backDays(), A.editDays()], [60, 3], 'defaults without server data');
    S.boot = { limits: { backDays: 400, editDays: 5 } }; eq([A.backDays(), A.editDays()], [400, 5], 'limits from the server');
    S.boot = boot;
    S.user = { name: 'X', role: 'ADMIN' }; eq(!!A.isAdmin(), true, 'isAdmin true for ADMIN');
    S.user = { name: 'X', role: 'PEKERJA' }; eq(!!A.isAdmin(), false, 'isAdmin false for worker');
    S.user = null; eq(!!A.isAdmin(), false, 'isAdmin false when logged out'); S.user = user;
    eq(A.curMonth(), S.month || t.slice(0, 7), 'curMonth');

    // ── frequent chips: usage first, then server list, only known suppliers, max 6, no repeats ──
    S.usage = { 'ROKOK': 3, 'PT. SUMBER SARI': 9, 'NOT KNOWN': 50 };
    S.boot.frequent = ['PT. OMEGA SUKSES ABADI', 'ROKOK', 'PT. SUMBER SARI'];
    const fq = A.frequent();
    eq(fq.slice(0, 3), ['PT. SUMBER SARI', 'ROKOK', 'PT. OMEGA SUKSES ABADI'], 'frequent: usage order, then server suggestions');
    eq(fq.length === 6 && new Set(fq).size === 6, true, 'frequent: 6 different');
    S.usage = {}; S.boot.frequent = [];
    eq(A.frequent(), S.boot.suppliers.slice(0, 6), 'frequent: falls back to the supplier list');

    // ── search ranking details ──
    eq(A.search('omega')[0], 'PT. OMEGA SUKSES ABADI', 'search: prefix after PT');
    eq(A.search('sukses abadi').slice(0, 2).every(s => /SUKSES ABADI/.test(s)), true, 'search: all words');
    eq(A.score('sari', 'PT. SUMBER SARI') >= 0.8, true, 'score: word prefix in the middle');
    eq(A.score('ab', 'AB') , 1, 'score: two letters exact');
    eq(A.dice('ABC', 'ABD'), 0.5, 'dice: half the pairs');
    eq(A.dice('AABB', 'AB'), 2 * 1 / (4 + 2 - 2), 'dice: repeated pairs counted once each');

    // ── the form: structure, labels, optional marks, buttons ──
    show('form', A.newForm());
    eq($$('#app section.step').length, 6, 'form: 6 steps');
    eq($$('#app section.step .n').map(e => e.textContent), ['1', '2', '3', '4', '5', '6'], 'form: numbered in order');
    eq($$('#app .opt').map(e => e.closest('section').id), ['st-inv', 'st-note'], 'form: optional = invoice and note');
    eq(['q', 'inv', 'amt', 'note'].map(id => !!$('label[for="' + id + '"]')), [true, true, true, true], 'form: real labels for the 4 typed fields');
    eq(['st-from', 'st-date'].map(id => $('#' + id).getAttribute('role') + '|' + $('#' + id).getAttribute('aria-labelledby')), ['group|st-from-l', 'group|st-date-l'], 'form: button groups are named groups');
    eq($$('#st-from .choice').map(b => b.textContent), ['Transfer Ibu', 'Uang Kasir', 'Modal', 'Lainnya'], 'form: pay buttons');
    eq($$('#st-from .choice').map(b => b.getAttribute('aria-pressed')), ['false', 'false', 'false', 'false'], 'form: nothing pre-selected');
    eq($$('#st-date .choice').map(b => b.getAttribute('data-v') || b.getAttribute('data-act')), [t, A.addDays(t, -1), 'cal'], 'form: Hari ini / Kemarin / Pilih');
    eq($('#st-date .choice.on').textContent.startsWith('Hari ini'), true, 'form: today selected');
    eq($('#st-date .hint.strong').textContent, A.longDate(t), 'form: date in words');
    eq($$('#freq .chip').length, 6, 'form: 6 frequent chips');
    eq($('#amt').getAttribute('inputmode'), 'numeric', 'form: number keyboard for the amount');
    eq($('#amt').value + '|' + $('#words').textContent, '|', 'form: empty amount, no words');
    eq(!!$('#other'), false, 'form: "uang siapa" hidden until Lainnya');
    eq($('[data-act="toReview"]').textContent, 'Lanjut', 'form: Lanjut button');
    eq($('.bar h1').textContent + '|' + !!$('.bar .back'), 'Catat Transaksi|true', 'form: title and back button');

    const f = A.newForm(); Object.assign(f, { name: 'TOKO BARU', isNew: true, amount: 1500, paidFrom: 'Lainnya', other: 'BUDI', date: A.addDays(t, -5), invoice: 'X1', note: 'n' });
    f.errors = { amount: 'Wajib diisi.', paidFrom: 'Tulis uang siapa (huruf saja).' };
    show('form', f);
    eq($('.picked b').textContent, 'TOKO BARU BARU', 'form: picked name with BARU tag');
    eq(!!$('#q'), false, 'form: no search box once picked');
    eq($('#amt').value + '|' + $('#words').textContent, '1.500|Seribu lima ratus rupiah', 'form: amount and words');
    eq($('#other').value, 'BUDI', 'form: Lainnya name box filled');
    eq($('#st-from .choice.on').textContent, '✓ Lainnya'.replace('✓ ', ''), 'form: Lainnya highlighted');
    eq($('#st-date .choice.on').getAttribute('data-act'), 'cal', 'form: another date highlights "Pilih"');
    eq($('#st-date .choice.on').textContent, A.shortDate(A.addDays(t, -5)) + 'ganti', 'form: picked date shown on the button');
    eq($$('.step.has-err').map(e => e.id), ['st-amt', 'st-from'], 'form: errors shown on the right steps');
    eq($('#st-amt-e').textContent + '|' + $('#st-amt-e').getAttribute('role'), 'Wajib diisi.|alert', 'form: error message is announced');
    eq($('#amt').getAttribute('aria-invalid') + '|' + $('#amt').getAttribute('aria-describedby'), 'true|st-amt-e', 'form: field linked to its error');
    eq($('#inv').value + '|' + $('#note').value, 'X1|n', 'form: invoice and note kept');

    // collect(): what is read back from the fields
    $('#inv').value = ' inv  12 / a '; $('#note').value = '  catatan  '; $('#other').value = ' budi santoso ';
    A.collect();
    eq([S.form.invoice, S.form.note, S.form.other], ['INV12/A', 'catatan', 'BUDI SANTOSO'], 'collect: invoice upper/no spaces, note and name trimmed');
    S.form = null; A.collect(); eq(true, true, 'collect without a form does nothing');

    // edit mode
    const orig = { id: 'r1', date: t, name: 'ROKOK', invoice: 'A1', amount: 5000, paidFrom: 'Uang Kasir', note: 'x', by: 'ANI', at: t + 'T10:00:00' };
    show('form', A.newForm(orig));
    eq($('.bar h1').textContent, 'Ubah Transaksi', 'edit: title');
    eq($('#st-from .choice.on').textContent.includes('Uang Kasir') && $('#inv').value === 'A1', true, 'edit: values filled');

    // supplier suggestions
    show('form', A.newForm());
    S.form.q = 'yafin'; A.renderSugg();
    eq($$('#sugg button[data-act="pick"]')[0].textContent, 'PT. YAFINDO MITRA PERMATA', 'suggest: best match first');
    eq(!!$('#sugg [data-act="addnew"]'), true, 'suggest: "+ Tambah" offered when no exact match');
    eq($('#sugg [data-act="addnew"]').textContent.startsWith('+ Tambah "YAFIN"'), true, 'suggest: add button shows the typed text in capitals');
    S.form.q = 'rokok'; A.renderSugg();
    eq(!!$('#sugg [data-act="addnew"]'), false, 'suggest: no "+ Tambah" when it already exists');
    S.form.q = '!'; A.renderSugg();
    eq($('#sugg .sugg-empty') && $('#sugg .sugg-empty').textContent, 'Ketik minimal 2 huruf', 'suggest: hint when there is nothing searchable yet');
    S.form.q = '   '; A.renderSugg();
    eq($('#sugg').innerHTML, '', 'suggest: blank query shows nothing');
    S.form.q = 'zzzzzz'; A.renderSugg();
    eq($$('#sugg button[data-act="pick"]').length, 0, 'suggest: no matches');
    eq(!!$('#sugg [data-act="addnew"]'), true, 'suggest: but can add it');

    // step(): wiring
    const st = document.createElement('div');
    st.innerHTML = A.step(7, 'st-x', 'Label', true, '<input id="xx">', 'Salah', 'xx');
    eq([st.querySelector('label').getAttribute('for'), st.querySelector('label').id, st.querySelector('.err-msg').id, !!st.querySelector('.has-err, section.has-err'), st.querySelector('.opt').textContent], ['xx', 'st-x-l', 'st-x-e', true, '(opsional)'], 'step: label/for, ids, error, optional');
    st.innerHTML = A.step(8, 'st-y', 'Grup', false, '<button>a</button>', '', '');
    eq([st.querySelector('section').getAttribute('role'), !!st.querySelector('label'), !!st.querySelector('.err-msg'), !!st.querySelector('.opt')], ['group', false, false, false], 'step: group without label/error/optional');

    // waiting list details
    S.query = '';
    S.queue = [{ qid: 'w1', state: 'waiting', retryAt: Date.now() + 60000, by: 'ANI', entry: { name: 'GALON', date: t, amount: 10, paidFrom: 'Modal' } },
      { qid: 'i1', state: 'invalid', error: 'Tanggal terlalu lama.', by: 'BUDI', entry: { name: 'ROTI', date: t, amount: 20, paidFrom: 'Modal' } },
      { qid: 'c1', state: 'conflict', error: 'Invoice ini sudah pernah dicatat.', existing: { date: t, by: 'MUDA', amount: 30 }, entry: { name: 'PT. X', date: t, amount: 30, paidFrom: 'Modal' } }];
    const d = document.createElement('div'); d.innerHTML = A.pendList(t.slice(0, 7));
    const items = Array.from(d.querySelectorAll('.item'));
    eq(items.map(x => x.querySelector('.nm').textContent), ['ROTI', 'PT. X', 'GALON'], 'pending: needs-check first, waiting last');
    eq(items[0].querySelector('.err-msg').textContent, 'Ditolak server: Tanggal terlalu lama. Catat ulang dengan benar, lalu buang yang ini.', 'pending: refused entry explains what to do');
    eq(Array.from(items[0].querySelectorAll('button')).map(b => b.textContent), ['Buang'], 'pending: refused entry can only be thrown away');
    eq(items[1].querySelector('.err-msg').textContent, 'Invoice ini sudah pernah dicatat. (sudah dicatat ' + A.shortDate(t) + ' oleh MUDA, Rp 30)', 'pending: duplicate says who already recorded it');
    eq(Array.from(items[1].querySelectorAll('button')).map(b => b.textContent + ':' + b.className), ['Buang, sudah dicatat:btn small primary', 'Beda, tetap simpan:btn small outline'], 'pending: safe choice is the main button');
    eq(items[2].querySelector('.badge').textContent, 'Dicoba lagi sebentar', 'pending: retrying entry says so');
    eq(items[2].querySelector('.meta').textContent, 'Modal · ' + A.shortDate(t) + ' · ANI', 'pending: shows who recorded it');
    eq(Array.from(d.querySelectorAll('.group-head')).map(x => x.className), ['group-head err', 'group-head warn'], 'pending: heading colours');
    S.queue[0].retryAt = 0; d.innerHTML = A.pendList(t.slice(0, 7));
    eq(d.querySelector('.badge').textContent, 'Menunggu internet', 'pending: plain waiting entry');
    S.queue = [];

    // toast
    A.toast('Halo', 'ok');
    const tt = $('#toast');
    eq([tt.getAttribute('role'), tt.className, tt.textContent], ['status', 'toast show ok', 'Halo'], 'toast: announced, styled, text');
    A.toast('Lagi');
    eq(tt.className, 'toast show ', 'toast: neutral style');
    await new Promise(r => setTimeout(r, 3000));
    eq(tt.className, 'toast', 'toast: hides by itself after ~3 s');

    // history cache loading
    const ym = t.slice(0, 7), real = window.CatatMockApi.handle;
    S.screen = 'history'; S.month = ym; S.hist = {}; A.render();
    await new Promise(r => setTimeout(r, 900));
    eq(!!S.hist[ym] && Array.isArray(S.hist[ym].entries) && S.hist[ym].at > 0, true, 'loadMonth: month loaded into the cache');
    eq(!!document.querySelector('#hlist .card.total'), true, 'loadMonth: list drawn');
    const n0 = S.hist[ym].entries.length;
    window.CatatMockApi.handle = b => b.action === 'list' ? Promise.reject(Object.assign(new Error('NETWORK'), { network: true })) : real(b);
    S.hist[ym].at = 0; A.loadMonth(ym);
    await new Promise(r => setTimeout(r, 50));
    eq([S.hist[ym].stale, S.hist[ym].entries.length], ['Tidak ada koneksi internet.', n0], 'loadMonth offline: old list kept, marked stale');
    eq(!!document.querySelector('#hlist .banner.warn [data-act="reload"]'), true, 'loadMonth offline: retry button shown');
    delete S.hist['2001-01']; A.loadMonth('2001-01'); await new Promise(r => setTimeout(r, 50));
    eq(S.hist['2001-01'], { failed: 'Tidak ada koneksi internet.' }, 'loadMonth offline without cache: marked failed, no fake data');
    window.CatatMockApi.handle = b => b.action === 'list' ? Promise.resolve({ ok: false, error: 'Bulan tidak valid.' }) : real(b);
    delete S.hist['2001-02']; A.loadMonth('2001-02'); await new Promise(r => setTimeout(r, 50));
    eq(S.hist['2001-02'], { failed: 'Bulan tidak valid.' }, 'loadMonth refused: server message kept');
    let calls = 0; window.CatatMockApi.handle = b => { if (b.action === 'list') calls++; return new Promise(() => { }); };
    A.loadMonth('2001-03'); A.loadMonth('2001-03');
    eq(calls, 1, 'loadMonth: never two loads of the same month at once');
    window.CatatMockApi.handle = real;
    // needLoad respects the 15 s pause after a failure
    S.hist['2001-04'] = { failed: 'x' };
    eq(A.needLoad('2001-04'), true, 'needLoad: failed month retried');
    // findEntry looks in the month on screen
    S.month = ym; S.hist[ym] = { entries: [{ id: 'q9', amount: 1 }], at: Date.now() };
    eq(A.findEntry('q9'), { id: 'q9', amount: 1 }, 'findEntry: found in current month');
    eq(A.findEntry('nope'), undefined, 'findEntry: unknown');
    S.month = '2001-05'; eq(A.findEntry('q9'), undefined, 'findEntry: other month not searched');
    S.month = ym;
    // outdated + patchCache edge cases
    S.hist = { '2026-01': { entries: [{ id: 'a', date: '2026-01-05', at: '1', amount: 5 }], total: 5, at: 123 } };
    A.outdated('2026-01'); eq(S.hist['2026-01'].at, 0, 'outdated: marks month for refresh');
    A.outdated('1999-01'); eq(S.hist['1999-01'], undefined, 'outdated: unknown month untouched');
    A.patchCache({ id: 'zz', date: '1999-02-01' }, null); eq(S.hist['1999-02'], undefined, 'patchCache: month not cached → nothing');
    A.patchCache({ id: 'a', date: '2026-01-05', at: '1', amount: 5 }, { id: 'a', date: '2026-01-06', amount: 7, name: 'N' });
    eq([S.hist['2026-01'].entries[0].amount, S.hist['2026-01'].entries[0].editedBy, S.hist['2026-01'].total], [7, 'TESTER', 7], 'patchCache: edit shows new values and who changed it');
    return out.map(([pass, msg, got, want]) => ({ pass, msg, got, want }));
  }));
  await ctx.close();

  // ── part 2: phone set to UTC late in the evening → "today" must still be the shop's date (WIB) ──
  const ctx2 = await browser.newContext({ timezoneId: 'UTC', locale: 'id-ID' });
  if (ACTIVE_MUTANT) await ctx2.addInitScript(`globalThis.__stryker__ = globalThis.__stryker__ || {}; globalThis.__stryker__.activeMutant = ${JSON.stringify(ACTIVE_MUTANT)};`);
  const p2 = await ctx2.newPage();
  await p2.clock.setFixedTime(new Date('2026-03-31T20:30:00Z'));   // 03:30 on 1 April in Batam
  await p2.goto(srv.url + '/index.html?demo=1');
  const r2 = await p2.evaluate(() => [window.CatatApp.phoneToday(), window.CatatApp.today()]);
  results.push({ pass: r2[0] === '2026-04-01' && r2[1] === '2026-04-01', msg: 'phoneToday: Batam date even if the phone is set to another time zone', got: r2, want: ['2026-04-01', '2026-04-01'] });
  await ctx2.close();

  let failed = 0;
  results.forEach(r => { if (!r.pass) { failed++; console.log('  ✗', r.msg, '— got', JSON.stringify(r.got), 'want', JSON.stringify(r.want)); } });
  if (errors.length) { failed++; console.log('  ✗ JS errors:', errors.join(' | ')); }
  await browser.close(); srv.close();
  console.log(`${results.length - results.filter(r => !r.pass).length} / ${results.length} render checks passed`);
  if (failed) process.exit(1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
