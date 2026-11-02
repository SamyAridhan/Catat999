// Edge cases and exact boundaries for Code.gs — written to kill the "surviving mutants" from mutation testing:
// each check pins down a rule precisely (exact limit, anchored pattern, which branch runs), so a small code
// change that breaks the rule is noticed. Usage: TZ=Asia/Jakarta node tests/backend.edge.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { install } = require('./gas-mock');

const env = install(globalThis);
const dir = path.join(__dirname, '..', 'apps-script');
const codeFile = process.env.CODE_FILE ? path.resolve(__dirname, process.env.CODE_FILE) : path.join(dir, 'Code.gs');
vm.runInThisContext(fs.readFileSync(path.join(dir, 'Seed.gs'), 'utf8') + '\n' + fs.readFileSync(codeFile, 'utf8'), { filename: 'Code.gs' });

let passed = 0;
function test(name, fn) {
  env.cache.clear();
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name); console.log(e.stack.split('\n').slice(0, 6).join('\n')); process.exitCode = 1; }
}
const call = r => { env.cache.clear(); return handle_(r); };
const post = body => JSON.parse(doPost(body === undefined ? undefined : { postData: { contents: body } }).getContent());
const today = todayStr_();
const daysAgo = n => addDays_(today, -n);
let n = 0;
const id = () => 'edge' + String(++n).padStart(6, '0');
const entry = o => Object.assign({ id: id(), date: today, name: 'ROKOK', amount: 1000, paidFrom: 'Modal' }, o);
const dataRow = eid => env.ss.getSheetByName('Data').dump().find(r => r[C.ID] === eid);

setup();

test('doPost: missing event / postData / non-object JSON are refused politely', () => {
  assert.deepStrictEqual(JSON.parse(doPost().getContent()), { ok: false, error: 'Aksi tidak dikenal.' });
  assert.deepStrictEqual(JSON.parse(doPost({}).getContent()), { ok: false, error: 'Aksi tidak dikenal.' });
  assert.deepStrictEqual(post('"hello"'), { ok: false, error: 'Permintaan tidak valid.' });
  assert.deepStrictEqual(post('5'), { ok: false, error: 'Permintaan tidak valid.' });
  assert.deepStrictEqual(post('{"action":"ping"}'), { ok: true });
  assert.deepStrictEqual(post('{"action":"PING"}'), { ok: false, error: 'Aksi tidak dikenal.' });
});

test('passwords: leading OR trailing space each refused; worker may not equal admin either way', () => {
  assert.throws(() => setPassword_('worker', ' abcdefgh'), /spasi/);
  assert.throws(() => setPassword_('worker', 'abcdefgh '), /spasi/);
  assert.strictEqual(setPassword_('worker', 'ab cdefgh'), 'OK', 'a space in the middle is fine');
  assert.strictEqual(setPassword_('admin', 'ibuBatam2026!'), 'OK');
  assert.throws(() => setPassword_('worker', 'ibuBatam2026!'), /berbeda/);
  assert.throws(() => setPassword_('admin', 'ab cdefgh'), /berbeda/);
  assert.throws(() => setPassword_('worker', undefined), /minimal/);
  assert.strictEqual(setPassword_('worker', 'tokoSembilan9'), 'OK');
});

test('login: only-admin or only-worker password set still works; 100-char password allowed, 101 refused', () => {
  const p = PropertiesService.getScriptProperties();
  const saved = p.getProperty('PW_WORKER');
  p.setProperty('PW_WORKER', '');
  assert.strictEqual(call({ action: 'login', name: 'Ibu', password: 'ibuBatam2026!', device: 'x' }).role, 'ADMIN');
  p.setProperty('PW_WORKER', saved);
  const savedA = p.getProperty('PW_ADMIN'); p.setProperty('PW_ADMIN', '');
  assert.strictEqual(call({ action: 'login', name: 'Ani', password: 'tokoSembilan9', device: 'x' }).role, 'PEKERJA');
  p.setProperty('PW_ADMIN', savedA);
  assert.strictEqual(call({ action: 'login', name: 'Ani', password: 'x'.repeat(100), device: 'y' }).error, 'Kata sandi salah.');
  assert.strictEqual(call({ action: 'login', name: 'Ani', password: 'x'.repeat(101), device: 'y' }).error, 'Isi kata sandi.');
  const salt = p.getProperty('PW_SALT'); p.setProperty('PW_SALT', '');
  assert.match(call({ action: 'login', name: 'Ani', password: 'tokoSembilan9', device: 'y' }).error, /belum siap/);
  p.setProperty('PW_SALT', salt);
});

test('login: wrong-password counter is per phone (another phone is not locked)', () => {
  for (let i = 0; i < 5; i++) handle_({ action: 'login', name: 'Ani', password: 'bad' + i, device: 'phone-1' });
  assert.match(handle_({ action: 'login', name: 'Ani', password: 'tokoSembilan9', device: 'phone-1' }).error, /Terlalu banyak/);
  assert.strictEqual(handle_({ action: 'login', name: 'Ani', password: 'tokoSembilan9', device: 'phone-2' }).ok, true);
  assert.strictEqual(handle_({ action: 'login', name: 'Ani', password: 'tokoSembilan9', device: '' }).ok, true, 'no device name is its own bucket');
});

const W = call({ action: 'login', name: "Ani O'Neil", password: 'tokoSembilan9', device: 'w' }).token;
const A = call({ action: 'login', name: 'Ibu', password: 'ibuBatam2026!', device: 'a' }).token;

test('tokens: exact 64-hex only (no prefix/suffix tricks); names with apostrophe come back clean', () => {
  assert.strictEqual(call({ action: 'boot', token: 'x' + W }).code, 'AUTH');
  assert.strictEqual(call({ action: 'boot', token: W + 'x' }).code, 'AUTH');
  assert.strictEqual(call({ action: 'boot', token: W.toUpperCase() }).code, 'AUTH');
  const b = call({ action: 'boot', token: W });
  assert.deepStrictEqual(b.user, { name: "ANI O'NEIL", role: 'PEKERJA' });
  assert.strictEqual(call({ action: 'boot', token: A }).user.role, 'ADMIN');
});

test('session expiry boundary: 89 days unused works, 91 does not; "last used" is refreshed after an hour, not before', () => {
  const t = call({ action: 'login', name: 'Budi', password: 'tokoSembilan9', device: 'b' }).token;
  const ses = env.ss.getSheetByName('Sesi'), h = sha256_(t);
  const row = ses.dump().findIndex(r => r[0] === h);
  const set = ms => { ses.cells[row][4] = new Date(Date.now() - ms); };
  set(30 * 60e3); call({ action: 'boot', token: t });
  assert.ok(Date.now() - ses.dump()[row][4].getTime() >= 30 * 60e3 - 1000, 'not refreshed within the hour');
  set(2 * 3600e3); call({ action: 'boot', token: t });
  assert.ok(Date.now() - ses.dump()[row][4].getTime() < 5000, 'refreshed after an hour');
  set(89 * 86400e3); assert.strictEqual(call({ action: 'boot', token: t }).ok, true);
  set(91 * 86400e3); assert.strictEqual(call({ action: 'boot', token: t }).code, 'AUTH');
});

test('add: id must be 8–64 of [A-Za-z0-9_-] exactly', () => {
  for (const bad of [' abcdefgh', 'abcdefgh!', 'abcdefg', 'a'.repeat(65), 'abc/defgh', '']) assert.strictEqual(call({ action: 'add', token: W, entry: entry({ id: bad }) }).error, 'ID transaksi tidak valid.', bad);
  ['abcdefgh', 'A'.repeat(64), 'ab-cd_ef'].forEach((good, k) => assert.strictEqual(call({ action: 'add', token: W, entry: entry({ id: good, amount: 100 + k }) }).ok, true, good));
});

test('add: entry that is not an object → "Data tidak valid."', () => {
  for (const bad of ['x', 5, null]) {
    const r = validateEntry_(bad, { role: 'PEKERJA' });
    assert.deepStrictEqual(r, { error: 'Data tidak valid.' });
  }
});

test('dates: anchored yyyy-mm-dd, real calendar dates only, leap years', () => {
  assert.strictEqual(checkDate_('x' + today, 60), 'Tanggal tidak valid.');
  assert.strictEqual(checkDate_(today + 'x', 60), 'Tanggal tidak valid.');
  assert.strictEqual(checkDate_('2026-13-01', 9999), 'Tanggal tidak valid.');
  assert.strictEqual(checkDate_('2026-04-31', 9999), 'Tanggal tidak valid.');
  assert.strictEqual(checkDate_('2025-02-29', 9999), 'Tanggal tidak valid.');
  assert.strictEqual(checkDate_('2024-02-29', 9999), '');
  assert.strictEqual(checkDate_(today, 0), '');
  assert.strictEqual(checkDate_(daysAgo(1), 0), 'Tanggal terlalu lama. Minta Ibu untuk mencatat.');
});

test('amounts: numbers or digit text; anything else refused', () => {
  const v = x => validateEntry_(entry({ amount: x }), { role: 'PEKERJA' });
  assert.strictEqual(v('Rp 1.500').amount, 1500);
  assert.strictEqual(v(1500).amount, 1500);
  assert.strictEqual(v(undefined).error, 'Nominal wajib diisi.');
  assert.strictEqual(v('').error, 'Nominal wajib diisi.');
});

test('text_: only strings and finite numbers are text', () => {
  assert.strictEqual(text_('a'), 'a'); assert.strictEqual(text_(12), '12'); assert.strictEqual(text_(0), '0');
  for (const x of [NaN, Infinity, null, undefined, true, {}, [], new Date()]) assert.strictEqual(text_(x), '', String(x));
});

test('supplier names: spaces collapsed, symbols stripped, 60-char limit exact, leading formula chars removed', () => {
  assert.strictEqual(cleanSupplierName_('  pt.   sari    roti  '), 'PT. SARI ROTI');
  assert.strictEqual(cleanSupplierName_('toko#1 * baru'), 'TOKO 1 BARU');
  assert.strictEqual(cleanSupplierName_('=+@-abc'), 'ABC');
  assert.strictEqual(cleanSupplierName_('A'.repeat(60)), 'A'.repeat(60));
  assert.strictEqual(cleanSupplierName_('A'.repeat(59) + ' B'), 'A'.repeat(59));
  assert.strictEqual(cleanSupplierName_("o'brien & co (bdg)/x+y,z"), "O'BRIEN & CO (BDG)/X+Y,Z");
});

test('invoice: spaces removed, upper-cased, exact allowed set', () => {
  assert.strictEqual(cleanInvoice_(' inv 001 / 2 '), 'INV001/2');
  assert.strictEqual(cleanInvoice_('a.b-c'), 'A.B-C');
  assert.strictEqual(cleanInvoice_('A_1'), null);
  assert.strictEqual(cleanInvoice_(''), '');
  assert.strictEqual(cleanInvoice_('X'.repeat(30)), 'X'.repeat(30));
  assert.strictEqual(cleanInvoice_('X'.repeat(31)), null);
});

test('pay source: every way of writing "Lainnya", names cleaned, junk refused', () => {
  const t = { 'transfer ibu': 'Transfer Ibu', ' UANG KASIR ': 'Uang Kasir', 'modal': 'Modal', 'Lainnya:Budi': 'Lainnya: BUDI', 'lainnya budi': 'Lainnya: BUDI',
    'LAINNYA :   budi   santoso ': 'Lainnya: BUDI SANTOSO', 'Lainnya: budi2': 'Lainnya: BUDI', "lainnya: o'neil-x": "Lainnya: O'NEIL-X", 'xlainnya: budi': '', 'Lainnya: 123': '', 'Lainnya': '', 'Kartu': '' };
  for (const k in t) assert.strictEqual(cleanPayFrom_(k), t[k], k);
  assert.strictEqual(cleanPayFrom_('Lainnya: ' + 'A'.repeat(40)), 'Lainnya: ' + 'A'.repeat(30));
});

test('free text: control characters → spaces, runs of spaces collapsed, trimmed, cut at the limit', () => {
  assert.strictEqual(cleanFree_('a\tb\n\nc\u0007d   e', 100), 'a b c d e');
  assert.strictEqual(cleanFree_('abcdef', 3), 'abc');
  assert.strictEqual(cleanFree_(12, 5), '12');
});

test('boot: deleted rows and entries older than 60 days do not count in "Sering dipakai"; most used first', () => {
  const t = call({ action: 'login', name: 'Fresh', password: 'tokoSembilan9', device: 'f' }).token;
  for (let i = 0; i < 3; i++) call({ action: 'add', token: t, entry: entry({ name: 'PT. SUMBER SARI', amount: 10 + i }) });
  for (let i = 0; i < 2; i++) call({ action: 'add', token: t, entry: entry({ name: 'PT. OMEGA SUKSES ABADI', amount: 20 + i }) });
  for (let i = 0; i < 9; i++) call({ action: 'add', token: A, entry: entry({ name: 'PT. DILINDO BERKAH SEJAHTERA', amount: 30 + i, date: daysAgo(61) }) });
  const gone = entry({ name: 'PT. ROTI BATAM SEJAHTERA', amount: 99 });
  for (let i = 0; i < 9; i++) call({ action: 'add', token: t, entry: Object.assign({}, gone, { id: id(), amount: 90 + i }) });
  const data = env.ss.getSheetByName('Data');
  data.dump().forEach((r, i) => { if (r[C.NAME] === 'PT. ROTI BATAM SEJAHTERA') data.cells[i][C.STATUS] = 'DIHAPUS'; });
  const b = call({ action: 'boot', token: t });
  assert.ok(!b.frequent.includes('PT. DILINDO BERKAH SEJAHTERA'), 'older than 60 days ignored');
  assert.ok(!b.frequent.includes('PT. ROTI BATAM SEJAHTERA'), 'deleted ignored');
  assert.ok(b.frequent.indexOf('PT. SUMBER SARI') < b.frequent.indexOf('PT. OMEGA SUKSES ABADI'), 'most used first');
  const count = data.dump().slice(1).filter(r => r[C.ID] && r[C.STATUS] !== 'DIHAPUS' && fmtDate_(r[C.AT]) === today).length;
  assert.strictEqual(b.todayCount, count, 'today count = recorded today, not deleted');
  // entry exactly 60 days back still counts
  call({ action: 'add', token: A, entry: entry({ name: 'PT. PRISMA REKSA SEJAHTERA BERSAMA', amount: 5, date: daysAgo(60) }) });
  assert.ok(call({ action: 'boot', token: t }).frequent.includes('PT. PRISMA REKSA SEJAHTERA BERSAMA'));
});

test('list: month must be exactly yyyy-mm; newest date first, then newest recorded first', () => {
  for (const bad of ['2026-11x', 'x2026-11', '2026-00', '2026-1', '']) assert.strictEqual(call({ action: 'list', token: W, month: bad }).error, 'Bulan tidak valid.', bad);
  const ym = today.slice(0, 7);
  const d1 = today, d0 = today.slice(8) === '01' ? today : addDays_(today, -1);
  const a = entry({ date: d0, amount: 501 }), b = entry({ date: d1, amount: 502 }), c = entry({ date: d1, amount: 503 });
  [a, b, c].forEach(e => call({ action: 'add', token: W, entry: e }));
  const data = env.ss.getSheetByName('Data');
  data.cells[data.dump().findIndex(r => r[C.ID] === b.id)][C.AT] = new Date(Date.now() - 60000);
  const ids = call({ action: 'list', token: W, month: ym }).entries.map(e => e.id).filter(x => [a.id, b.id, c.id].includes(x));
  assert.deepStrictEqual(ids, d0 === d1 ? [c.id, b.id, a.id] : [c.id, b.id, a.id]);
});

test('suppliers hidden with TIDAK / NO / N / FALSE / 0 (any case, spaces) stay out of the list; YA stays in', () => {
  const sup = env.ss.getSheetByName('Supplier');
  const names = sup.dump().slice(1, 8).map(r => r[0]);
  ['tidak', ' NO ', 'n', 'False', '0', 'YA', 'ya '].forEach((v, i) => { sup.cells[i + 1][1] = v; });
  const list = listSuppliers_();
  names.slice(0, 5).forEach(nm => assert.ok(!list.includes(nm), 'hidden: ' + nm));
  names.slice(5).forEach(nm => assert.ok(list.includes(nm), 'shown: ' + nm));
  // using a hidden supplier makes it visible again
  call({ action: 'add', token: W, entry: entry({ name: names[0], amount: 777 }) });
  assert.strictEqual(sup.dump()[1][1], 'YA');
  assert.ok(listSuppliers_().includes(names[0]));
});

test('3-day window: exactly 3 days is still allowed, a second later is not; deleted entries never editable', () => {
  const e = entry({ amount: 4444 }); call({ action: 'add', token: W, entry: e });
  const data = env.ss.getSheetByName('Data'), i = data.dump().findIndex(r => r[C.ID] === e.id);
  data.cells[i][C.AT] = new Date(Date.now() - 3 * 86400e3 + 2000);
  assert.strictEqual(canEdit_({ role: 'PEKERJA' }, data.dump()[i]), true);
  data.cells[i][C.AT] = new Date(Date.now() - 3 * 86400e3 - 2000);
  assert.strictEqual(canEdit_({ role: 'PEKERJA' }, data.dump()[i]), false);
  data.cells[i][C.AT] = '';
  assert.strictEqual(canEdit_({ role: 'PEKERJA' }, data.dump()[i]), false, 'no recorded time → not editable by workers');
  data.cells[i][C.STATUS] = 'DIHAPUS';
  assert.strictEqual(canEdit_({ role: 'ADMIN' }, data.dump()[i]), false);
});

test('a copy pasted ABOVE its original gets the new ID; the original keeps its ID on later edits', () => {
  const e = entry({ amount: 5151 }); call({ action: 'add', token: W, entry: e });
  const data = env.ss.getSheetByName('Data');
  const src = data.dump().findIndex(r => r[C.ID] === e.id);
  const copy = data.dump()[src].slice(); copy[C.AMT] = 5252;
  data.cells.splice(src, 0, copy); data.maxRows++;                        // insert row above + paste
  onDataEdit({ range: data.getRange(src + 1, 1, 1, 12) });
  assert.notStrictEqual(data.dump()[src][C.ID], e.id, 'pasted copy got a new ID');
  assert.strictEqual(data.dump()[src + 1][C.ID], e.id, 'original kept its ID');
  onDataEdit({ range: data.getRange(src + 2, C.AMT + 1), oldValue: 5151, value: 5151 });   // later edit of the original
  assert.strictEqual(data.dump()[src + 1][C.ID], e.id, 'still the same ID after editing the original');
  assert.strictEqual(call({ action: 'update', token: W, id: e.id, entry: Object.assign({}, e, { amount: 5153 }) }).ok, true);
});

test('hand-typed amounts: only plain rupiah text becomes a number; shorthand stays as typed', () => {
  const cases = { '350000': 350000, '350.000': 350000, 'Rp 1.500': 1500, 'rp.2,500,000': 2500000, ' 45.500 ': 45500,
    '50rb': '50rb', '2 juta': '2 juta', '-5.000': '-5.000', '1,5': '1,5', '12.50': '12.50', '1.5000': '1.5000' };
  for (const k in cases) {
    const r = []; r[C.DATE] = ''; r[C.AMT] = k;
    normalizeTypedRow_(r);
    assert.strictEqual(r[C.AMT], cases[k], k);
  }
});

test('rows written to Data never contain undefined/null (blank instead) and text is formula-safe', () => {
  writeRow_(env.ss.getSheetByName('Data').getLastRow() + 1, [toDate_(today), '=X', null, 5, undefined, 'A', '', '', '', '', 'AKTIF', 'edgerow01']);
  const r = dataRow('edgerow01');
  assert.strictEqual(r[C.NAME], "'=X"); assert.strictEqual(r[C.INV], ''); assert.strictEqual(r[C.FROM], '');
});

test('duplicates: invoice stored with a protective apostrophe still matches', () => {
  const e = entry({ name: 'PT. SARI ROTI', invoice: 'INV9', amount: 321 }); call({ action: 'add', token: W, entry: e });
  const data = env.ss.getSheetByName('Data'), i = data.dump().findIndex(r => r[C.ID] === e.id);
  data.cells[i][C.INV] = "'INV9";
  assert.strictEqual(call({ action: 'add', token: W, entry: entry({ name: 'PT. SARI ROTI', invoice: 'inv9', amount: 1 }) }).code, 'DUP_INVOICE');
});

test('remove goes through the API (and the lock) and only with a session', () => {
  const e = entry({ amount: 8888 }); call({ action: 'add', token: W, entry: e });
  assert.strictEqual(call({ action: 'remove', token: 'f'.repeat(64), id: e.id, reason: 'x' }).code, 'AUTH');
  assert.deepStrictEqual(call({ action: 'remove', token: W, id: e.id, reason: 'Salah input' }), { ok: true });
  assert.strictEqual(dataRow(e.id)[C.STATUS], 'DIHAPUS');
});

test('server errors are caught: generic message, no details leaked', () => {
  const real = SpreadsheetApp.openById;
  const realActive = SpreadsheetApp.getActiveSpreadsheet;
  SpreadsheetApp.openById = () => { throw new Error('secret internal detail'); };
  SpreadsheetApp.getActiveSpreadsheet = () => { throw new Error('secret internal detail'); };
  const origErr = console.error; console.error = () => { };
  const r = call({ action: 'boot', token: W });
  console.error = origErr;
  SpreadsheetApp.openById = real; SpreadsheetApp.getActiveSpreadsheet = realActive;
  assert.deepStrictEqual(r, { ok: false, error: 'Terjadi kesalahan di server. Coba lagi.' });
});

test('write rate limit is per session (another login can still write)', () => {
  env.cache.clear();
  for (let i = 0; i < 20; i++) handle_({ action: 'add', token: W, entry: entry({ amount: 6000 + i }) });
  assert.match(handle_({ action: 'add', token: W, entry: entry({ amount: 7000 }) }).error, /Terlalu cepat/);
  assert.strictEqual(handle_({ action: 'add', token: A, entry: entry({ amount: 7001 }) }).ok, true);
});

console.log(`\n${passed} edge-case tests passed${process.exitCode ? ', SOME FAILED' : ''}`);
