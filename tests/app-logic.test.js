// Fast checks of the app's own logic (amount in words, supplier search, form validation, dates, history cache),
// run inside a real browser page in one go (~3 s). Complements the slower click-through in ui.test.js.
// Usage: node tests/app-logic.test.js     (WEB_DIR=… to test another copy of web/)
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { serve } = require('./static-server');
const ACTIVE_MUTANT = process.env.__STRYKER_ACTIVE_MUTANT__;

(async () => {
  const srv = await serve(process.env.WEB_DIR ? path.resolve(process.env.WEB_DIR) : path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
  if (ACTIVE_MUTANT) await ctx.addInitScript(`globalThis.__stryker__ = globalThis.__stryker__ || {}; globalThis.__stryker__.activeMutant = ${JSON.stringify(ACTIVE_MUTANT)};`);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url + '/index.html?demo=1');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#loginForm');
  // log in so boot data (suppliers, limits) is loaded like on a real phone
  await page.fill('#lname', 'Tester'); await page.fill('#lpw', 'toko12345'); await page.click('#loginBtn');
  await page.waitForFunction(() => window.CatatApp.state.boot && window.CatatApp.state.boot.suppliers.length > 50);

  const results = await page.evaluate(() => {
    const A = window.CatatApp, S = A.state, out = [];
    const eq = (got, want, msg) => out.push([JSON.stringify(got) === JSON.stringify(want), msg, got, want]);
    const t = A.today();

    // ── amount in words (terbilang) ──
    eq(A.terbilang(0), '', 'terbilang 0');
    eq(A.terbilang(1), 'satu', 'terbilang 1');
    eq(A.terbilang(10), 'sepuluh', 'terbilang 10');
    eq(A.terbilang(11), 'sebelas', 'terbilang 11');
    eq(A.terbilang(12), 'dua belas', 'terbilang 12');
    eq(A.terbilang(19), 'sembilan belas', 'terbilang 19');
    eq(A.terbilang(20), 'dua puluh', 'terbilang 20');
    eq(A.terbilang(99), 'sembilan puluh sembilan', 'terbilang 99');
    eq(A.terbilang(100), 'seratus', 'terbilang 100');
    eq(A.terbilang(101), 'seratus satu', 'terbilang 101');
    eq(A.terbilang(199), 'seratus sembilan puluh sembilan', 'terbilang 199');
    eq(A.terbilang(200), 'dua ratus', 'terbilang 200');
    eq(A.terbilang(999), 'sembilan ratus sembilan puluh sembilan', 'terbilang 999');
    eq(A.terbilang(1000), 'seribu', 'terbilang 1000');
    eq(A.terbilang(1001), 'seribu satu', 'terbilang 1001');
    eq(A.terbilang(1999), 'seribu sembilan ratus sembilan puluh sembilan', 'terbilang 1999');
    eq(A.terbilang(2000), 'dua ribu', 'terbilang 2000');
    eq(A.terbilang(10000), 'sepuluh ribu', 'terbilang 10000');
    eq(A.terbilang(11000), 'sebelas ribu', 'terbilang 11000');
    eq(A.terbilang(100000), 'seratus ribu', 'terbilang 100000');
    eq(A.terbilang(999999), 'sembilan ratus sembilan puluh sembilan ribu sembilan ratus sembilan puluh sembilan', 'terbilang 999999');
    eq(A.terbilang(1000000), 'satu juta', 'terbilang 1 juta');
    eq(A.terbilang(1000001), 'satu juta satu', 'terbilang 1 juta 1');
    eq(A.terbilang(1776424), 'satu juta tujuh ratus tujuh puluh enam ribu empat ratus dua puluh empat', 'terbilang 1.776.424');
    eq(A.terbilang(125500000), 'seratus dua puluh lima juta lima ratus ribu', 'terbilang 125.500.000');
    eq(A.terbilang(999999999), 'sembilan ratus sembilan puluh sembilan juta sembilan ratus sembilan puluh sembilan ribu sembilan ratus sembilan puluh sembilan', 'terbilang max below miliar');
    eq(A.terbilang(1000000000), 'satu miliar', 'terbilang 1 miliar');
    eq(A.terbilang(2000000005), 'dua miliar lima', 'terbilang 2 miliar 5');
    eq(A.terbilang(1500.7), 'seribu lima ratus', 'terbilang drops decimals');
    eq(A.words(0), '', 'words 0 is empty');
    eq(A.words(5000), 'Lima ribu rupiah', 'words capitalised + rupiah');

    // ── money + escaping ──
    eq(A.rp(1776424), 'Rp 1.776.424', 'rp format');
    eq(A.rp(0), 'Rp 0', 'rp zero');
    eq(A.rp(undefined), 'Rp 0', 'rp missing');
    eq(A.dots(0), '', 'dots empty for 0');
    eq(A.dots(1234567), '1.234.567', 'dots');
    eq(A.esc(`<b a="1">'&`), '&lt;b a=&quot;1&quot;&gt;&#39;&amp;', 'esc escapes all 5 characters');
    eq(A.esc(null), '', 'esc null');
    eq(A.esc(undefined), '', 'esc undefined');
    eq(A.esc(0), '0', 'esc zero');

    // ── supplier key + search ──
    eq(A.key('PT. Yafindo Mitra-Permata'), 'YAFINDOMITRAPERMATA', 'key strips PT and punctuation');
    eq(A.key('cv sumber'), 'SUMBER', 'key strips CV');
    eq(A.key('UD. MAJU'), 'MAJU', 'key strips UD');
    eq(A.key('PTX ABC'), 'PTXABC', 'key keeps PT inside a word');
    eq(A.key(null), '', 'key null');
    eq(A.dice('ABCD', 'ABCD'), 1, 'dice identical');
    eq(A.dice('AB', 'CD'), 0, 'dice disjoint');
    eq(A.dice('A', 'A'), 1, 'dice 1-char equal');
    eq(A.dice('A', 'B'), 0, 'dice 1-char different');
    eq(A.dice('', 'AB'), 0, 'dice empty');
    eq(Math.round(A.dice('ABCD', 'ABCE') * 100), 67, 'dice partial');
    eq(A.score('', 'PT. X'), 0, 'score empty query');
    eq(A.score('pt yafindo mitra permata', 'PT. YAFINDO MITRA PERMATA'), 1, 'score exact');
    eq(A.score('yafin', 'PT. YAFINDO MITRA PERMATA'), 0.95, 'score prefix');
    eq(A.score('mitra yaf', 'PT. YAFINDO MITRA PERMATA'), 0.9, 'score word prefixes in any order');
    eq(A.score('ndomitra', 'PT. YAFINDO MITRA PERMATA'), 0.8, 'score substring');
    eq(A.score('zzzz', 'PT. YAFINDO MITRA PERMATA') < 0.35, true, 'score unrelated is low');
    eq(A.search('yafindo')[0], 'PT. YAFINDO MITRA PERMATA', 'search finds by partial name');
    eq(A.search('yafnido').indexOf('PT. YAFINDO MITRA PERMATA') >= 0, true, 'search survives a typo');
    eq(A.search('rokk').indexOf('ROKOK') >= 0, true, 'search survives a missing letter');
    eq(A.score('yafnido', 'PT. ZZZ') < 0.35, true, 'typo match needs real overlap');
    eq(A.score('abcdefg', 'X ABCDEFG') <= 0.9, true, 'whole-word match');
    eq(A.search('sumber').length <= 6, true, 'search returns at most 6');
    eq(A.search('qqqqqq'), [], 'search nothing');
    S.usage = { 'PT. SUMBER SARI': 5 };
    eq(A.search('sumber')[0], 'PT. SUMBER SARI', 'search ranks often-used first on a tie');
    eq(A.frequent()[0], 'PT. SUMBER SARI', 'frequent: most used first');
    eq(A.frequent().length, 6, 'frequent: 6 chips');
    S.usage = { 'NOT A SUPPLIER': 9 };
    eq(A.frequent().indexOf('NOT A SUPPLIER'), -1, 'frequent: ignores names not in list');
    S.usage = {};

    // ── dates ──
    eq(A.addDays('2026-03-01', -1), '2026-02-28', 'addDays across month');
    eq(A.addDays('2024-03-01', -1), '2024-02-29', 'addDays leap year');
    eq(A.addDays('2026-12-31', 1), '2027-01-01', 'addDays across year');
    eq(A.addMonths('2026-01', -1), '2025-12', 'addMonths back across year');
    eq(A.addMonths('2026-12', 1), '2027-01', 'addMonths forward across year');
    eq(A.longDate('2026-11-02'), 'Senin, 2 Nov 2026', 'longDate');
    eq(A.shortDate('2026-08-17'), '17 Agu', 'shortDate');
    eq(A.monthName('2026-10'), 'Oktober 2026', 'monthName');
    eq(A.hhmm('2026-11-02T09:05:00'), '09.05', 'hhmm');
    eq(A.hhmm(''), '', 'hhmm empty');
    eq(/^\d{4}-\d{2}-\d{2}$/.test(t), true, 'today format');

    // ── form validation ──
    const form = o => { S.form = Object.assign(A.newForm(), o); A.validate(); return S.form.errors; };
    const ok = { name: 'ROKOK', amount: 1000, paidFrom: 'Uang Kasir' };
    eq(form(ok), {}, 'valid form has no errors');
    eq(Object.keys(form({})).sort(), ['amount', 'name', 'paidFrom'], 'empty form: 3 required errors');
    eq(form({})['name'], 'Wajib diisi.', 'name required message');
    eq(form(Object.assign({}, ok, { name: '', q: 'abc' })).name, 'Pilih dari daftar, atau ketuk "+ Tambah".', 'typed but not picked');
    eq(form(Object.assign({}, ok, { invoice: 'INV/01-2.3' })).invoice, undefined, 'invoice allowed characters');
    eq(form(Object.assign({}, ok, { invoice: 'INV#1' })).invoice, 'Hanya huruf, angka, - dan /.', 'invoice bad character');
    eq(form(Object.assign({}, ok, { invoice: 'A'.repeat(31) })).invoice !== undefined, true, 'invoice max 30');
    eq(form(Object.assign({}, ok, { invoice: 'A'.repeat(30) })).invoice, undefined, 'invoice 30 ok');
    eq(form(Object.assign({}, ok, { amount: 500000000 })).amount, undefined, 'amount at max ok');
    eq(form(Object.assign({}, ok, { amount: 500000001 })).amount, 'Nominal terlalu besar. Cek lagi.', 'amount over max');
    eq(form(Object.assign({}, ok, { paidFrom: 'Lainnya', other: '' })).paidFrom, 'Tulis uang siapa (huruf saja).', 'Lainnya needs a name');
    eq(form(Object.assign({}, ok, { paidFrom: 'Lainnya', other: 'B' })).paidFrom, undefined, 'Lainnya one letter ok');
    eq(form(Object.assign({}, ok, { paidFrom: 'Lainnya', other: '9X' })).paidFrom !== undefined, true, 'Lainnya must start with a letter');
    eq(form(Object.assign({}, ok, { paidFrom: 'Lainnya', other: 'A'.repeat(31) })).paidFrom !== undefined, true, 'Lainnya max 30');
    eq(form(Object.assign({}, ok, { date: A.addDays(t, 1) })).date, 'Tidak boleh lebih dari hari ini.', 'no future date');
    eq(form(Object.assign({}, ok, { date: t })).date, undefined, 'today ok');
    eq(form(Object.assign({}, ok, { date: A.addDays(t, -60) })).date, undefined, 'worker: 60 days back ok');
    eq(form(Object.assign({}, ok, { date: A.addDays(t, -61) })).date, 'Terlalu lama. Minta Ibu untuk mencatat.', 'worker: 61 days back refused');
    S.form = Object.assign(A.newForm(), ok, { paidFrom: 'Lainnya', other: 'BUJANG', invoice: 'X1', note: 'n' });
    const en = A.entryFromForm();
    eq([en.paidFrom, en.invoice, en.note, en.date], ['Lainnya: BUJANG', 'X1', 'n', t], 'entryFromForm');
    S.form = A.newForm(); eq(A.formDirty(), false, 'new form is not dirty');
    S.form.note = 'x'; eq(A.formDirty(), true, 'typed note makes it dirty');
    S.form = A.newForm(); S.form.q = 'ab'; eq(A.formDirty(), true, 'typed search makes it dirty');
    const orig = { id: 'a1', date: '2026-11-01', name: 'ROKOK', invoice: '', amount: 5000, paidFrom: 'Lainnya: MUDA', note: '' };
    S.form = A.newForm(orig);
    eq([S.form.mode, S.form.paidFrom, S.form.other], ['edit', 'Lainnya', 'MUDA'], 'edit form splits Lainnya');
    eq(A.formDirty(), false, 'unchanged edit form is not dirty');
    S.form.amount = 6000; eq(A.formDirty(), true, 'changed edit form is dirty');
    const old = { id: 'o1', date: A.addDays(t, -70), name: 'ROKOK', invoice: '', amount: 5000, paidFrom: 'Modal', note: '' };
    S.form = A.newForm(old); S.form.amount = 5100; A.validate();
    eq(S.form.errors.date, undefined, 'edit: an unchanged old date is allowed (same as server)');
    S.form.date = A.addDays(t, -71); A.validate();
    eq(S.form.errors.date, 'Terlalu lama. Minta Ibu untuk mencatat.', 'edit: moving to an even older date is refused');
    S.form = A.newForm(Object.assign({}, old, { paidFrom: 'Cash' })); A.validate();
    eq([S.form.paidFrom, S.form.errors.paidFrom], ['', 'Wajib diisi.'], 'edit: unknown hand-typed pay source must be picked again');
    S.form = null;

    // ── history cache ──
    const now = Date.now();
    S.hist = { '2026-05': { entries: [], at: now } };
    eq(A.needLoad('2026-05'), false, 'fresh month: no reload');
    S.hist['2026-05'].at = now - 61000; eq(A.needLoad('2026-05'), true, 'month older than a minute reloads');
    S.hist['2026-05'] = { entries: [], at: now, stale: 'x' }; eq(A.needLoad('2026-05'), true, 'stale month reloads');
    S.hist['2026-05'] = { failed: 'x' }; eq(A.needLoad('2026-05'), true, 'failed month reloads');
    eq(A.needLoad('2026-04'), true, 'unknown month loads');
    const e1 = { id: 'x1', date: '2026-05-03', at: '2026-05-03T10:00:00', name: 'A', amount: 100 }, e2 = { id: 'x2', date: '2026-05-02', at: '2026-05-02T10:00:00', name: 'B', amount: 50 };
    S.hist = { '2026-05': { entries: [e1, e2], total: 150, at: now } };
    A.patchCache(e2, Object.assign({}, e2, { date: '2026-05-04', amount: 70 }));
    eq(S.hist['2026-05'].entries.map(x => x.id + ':' + x.amount), ['x2:70', 'x1:100'], 'patchCache: edit re-sorts newest first');
    eq(S.hist['2026-05'].total, 170, 'patchCache: total recomputed');
    eq(S.hist['2026-05'].at, 0, 'patchCache: marks month for refresh');
    A.patchCache(e1, null);
    eq(S.hist['2026-05'].entries.map(x => x.id), ['x2'], 'patchCache: delete removes it');
    A.patchCache(S.hist['2026-05'].entries[0], Object.assign({}, e2, { date: '2026-06-01' }));
    eq(S.hist['2026-05'].entries.length, 0, 'patchCache: moved to another month leaves this one');
    S.hist = { '2026-01': {}, '2026-02': {}, '2026-03': {}, '2026-04': {} };
    eq(Object.keys(A.trimHist()).sort(), ['2026-02', '2026-03', '2026-04'], 'trimHist keeps newest 3 months');

    // ── history list rendering ──
    const rows = [
      { id: 'r1', date: '2026-05-03', at: '2026-05-03T09:30:00', name: 'PT. ALFA', invoice: 'INV9', amount: 1000, paidFrom: 'Modal', by: 'ANI' },
      { id: 'r2', date: '2026-05-03', at: '2026-05-03T08:00:00', name: 'ROKOK', invoice: '', amount: 500, paidFrom: 'Uang Kasir', by: 'BUDI', editedBy: 'IBU' },
      { id: 'r3', date: '2026-05-01', at: '2026-05-01T08:00:00', name: '<i>X</i>', invoice: '', amount: 250, paidFrom: 'Modal', by: 'ANI' }];
    const html = A.histList('2026-05', { entries: rows, at: now });
    const d = document.createElement('div'); d.innerHTML = html;
    eq(d.querySelectorAll('.item.tap').length, 3, 'histList: one row per entry');
    eq(Array.from(d.querySelectorAll('.group-head')).map(x => x.textContent), ['Minggu, 3 Mei' + 'Rp 1.500', 'Jumat, 1 Mei' + 'Rp 250'], 'histList: day heads with day totals');
    eq(d.querySelector('.card.total .big').textContent, 'Rp 1.750', 'histList: month total');
    eq(d.querySelector('.card.total .hint').textContent, 'Total Mei 2026 · 3 transaksi', 'histList: count');
    eq(d.querySelectorAll('i').length, 1, 'histList: names escaped (only our own "diubah" tag is markup)');
    eq(d.querySelector('[data-v="r1"] .meta').textContent, 'Modal · Inv INV9 · ANI 09.30', 'histList: row meta');
    S.query = 'rokok';
    d.innerHTML = A.histList('2026-05', { entries: rows, at: now });
    eq(d.querySelectorAll('.item.tap').length, 1, 'histList: search by name');
    eq(d.querySelector('.card.total .hint').textContent, 'Hasil cari · 1 transaksi', 'histList: search label');
    S.query = 'inv9'; d.innerHTML = A.histList('2026-05', { entries: rows, at: now });
    eq(d.querySelectorAll('.item.tap').length, 1, 'histList: search by invoice');
    S.query = 'zzz'; d.innerHTML = A.histList('2026-05', { entries: rows, at: now });
    eq(d.querySelector('.empty').textContent, 'Tidak ada yang cocok. Coba ketik sebagian nama atau nomor saja.', 'histList: no match');
    S.query = '';
    d.innerHTML = A.histList('2026-05', { entries: [], at: now });
    eq(d.querySelector('.empty').textContent, 'Belum ada transaksi bulan ini. Ketuk ‹ untuk melihat bulan sebelumnya.', 'histList: empty month');
    d.innerHTML = A.histList('2026-05', { failed: 'Tidak ada koneksi internet.' });
    eq(!!d.querySelector('.banner.err [data-act="reload"]') && !d.querySelector('.card.total'), true, 'histList: failed load shows retry, no fake total');
    d.innerHTML = A.histList('2026-05', { entries: rows, at: now, stale: 'Tidak ada koneksi internet.' });
    eq(!!d.querySelector('.banner.warn') && d.querySelectorAll('.item.tap').length === 3, true, 'histList: stale shows old data + warning');
    d.innerHTML = A.histList('2026-05', undefined);
    eq(!!d.querySelector('.spinner'), true, 'histList: spinner while loading');

    // ── pending list ──
    S.queue = [
      { qid: 'q1', state: 'waiting', entry: { name: 'ROKOK', date: '2026-05-02', amount: 10, paidFrom: 'Modal' } },
      { qid: 'q2', state: 'conflict', error: 'Dobel', entry: { name: 'PT. ALFA', date: '2026-04-02', amount: 20, paidFrom: 'Modal' } },
      { qid: 'q3', state: 'waiting', entry: { name: 'GALON', date: '2026-04-09', amount: 30, paidFrom: 'Modal' } }];
    d.innerHTML = A.pendList('2026-05');
    eq(Array.from(d.querySelectorAll('.group-head')).map(x => x.textContent), ['Perlu dicek', 'Belum terkirim'], 'pendList: conflicts first');
    eq(d.querySelectorAll('.item').length, 2, 'pendList: other-month waiting entries hidden, conflicts always shown');
    S.query = 'alfa'; d.innerHTML = A.pendList('2026-05');
    eq(d.querySelectorAll('.item').length, 1, 'pendList: follows search');
    S.query = ''; S.queue = [];
    eq(A.pendList('2026-05'), '', 'pendList: empty when nothing waiting');

    eq(A.isNet({ network: true }) && A.isNet(new Error('NETWORK')) && !A.isNet(new Error('x')), true, 'isNet');
    return out.map(([pass, msg, got, want]) => ({ pass, msg, got, want }));
  });

  let failed = 0;
  results.forEach(r => { if (!r.pass) { failed++; console.log('  ✗', r.msg, '— got', JSON.stringify(r.got), 'want', JSON.stringify(r.want)); } });
  if (errors.length) { failed++; console.log('  ✗ JS errors:', errors.join(' | ')); }
  await browser.close(); srv.close();
  console.log(`${results.length - (failed && results.filter(r => !r.pass).length)} / ${results.length} logic checks passed`);
  if (failed) process.exit(1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
