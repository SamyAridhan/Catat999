// Runs the real Code.gs + Seed.gs against the in-memory mock. Usage: TZ=Asia/Jakarta node tests/backend.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { install } = require('./gas-mock');

const env = install(globalThis);
const dir = path.join(__dirname, '..', 'apps-script');
// CODE_FILE lets the mutation run point at a .js copy (Stryker can't parse the .gs extension).
const codeFile = process.env.CODE_FILE ? path.resolve(__dirname, process.env.CODE_FILE) : path.join(dir, 'Code.gs');
vm.runInThisContext(fs.readFileSync(path.join(dir, 'Seed.gs'), 'utf8') + '\n' + fs.readFileSync(codeFile, 'utf8'), { filename: 'Code.gs' });

let passed = 0;
function test(name, fn) {
  if (!/brute force/.test(name)) env.cache.clear(); // rate-limit counters would otherwise never expire in the mock
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.log('  ✗', name); console.log(e.stack); process.exitCode = 1; }
}
const call = req => handle_(req);
const post = req => JSON.parse(doPost({ postData: { contents: JSON.stringify(req) } }).getContent());
const today = todayStr_();
const daysAgo = n => addDays_(today, -n);
let n = 0;
const nid = () => 'test' + (++n).toString().padStart(4, '0') + Math.random().toString(36).slice(2, 8);
const names = () => env.ss.getSheets().map(s => s.getName());
const dataRows = () => env.ss.getSheetByName('Data').dump().slice(1).filter(r => r.some(v => v !== ''));
const logRows = () => env.ss.getSheetByName('Log').dump().slice(1).filter(r => r.some(v => v !== ''));
const monthName = ym => BULAN[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
const entry = (o = {}) => Object.assign({ id: nid(), date: today, name: 'SARI ROTI', amount: 206100, paidFrom: 'Uang Kasir' }, o);
const login = (name, pw, device = 'hp-' + name) => call({ action: 'login', name, password: pw, device });

console.log('today =', today);

// ── setup ──
test('setup: tabs in order, locale/timezone, hidden ID column + session tab, triggers, no month tab yet', () => {
  assert.strictEqual(setup(), 'OK');
  assert.deepStrictEqual(names(), ['Data', 'Supplier', 'Log', 'Sesi']);
  assert.strictEqual(env.ss.locale, 'id_ID'); assert.strictEqual(env.ss.tz, 'Asia/Jakarta');
  assert.ok(env.ss.getSheetByName('Sesi').hidden);
  assert.deepStrictEqual(env.ss.getSheetByName('Data').hiddenCols, [12]);
  assert.ok(env.ss.getSheetByName('Data').filter, 'filter enabled on Data');
  assert.deepStrictEqual(env.triggers.sort(), ['archiveOld', 'onDataChange', 'onDataEdit']);
  assert.strictEqual(env.ss.getSheetByName('Supplier').getLastRow(), 1 + SEED_SUPPLIERS.length);
});
test('setup twice: no duplicate seed or triggers', () => {
  setup();
  assert.strictEqual(env.ss.getSheetByName('Supplier').getLastRow(), 1 + SEED_SUPPLIERS.length);
  assert.strictEqual(env.triggers.length, 3);
});

// ── auth ──
test('login is closed until passwords are set (no defaults)', () => {
  const r = login('ANDI', 'anything');
  assert.strictEqual(r.ok, false); assert.match(r.error, /belum diatur/);
});
test('passwords: min length, must differ, stored only as hashes', () => {
  assert.throws(() => setPassword_('worker', 'short'), /minimal 8/);
  setPassword_('worker', 'tokoSembilan9');
  assert.throws(() => setPassword_('admin', 'tokoSembilan9'), /berbeda/);
  setPassword_('admin', 'ibuBatam2026!');
  const all = JSON.stringify([...env.props.values()]) + JSON.stringify(env.ss.getSheets().map(s => s.dump()));
  assert.ok(!all.includes('tokoSembilan9') && !all.includes('ibuBatam2026!'), 'plain password not stored anywhere');
  assert.match(env.props.get('PW_WORKER'), /^[a-f0-9]{64}$/);
});

let W, A;
test('login: any name + worker password → PEKERJA; admin password → ADMIN', () => {
  const w = login('  andi  setiawan ', 'tokoSembilan9');
  assert.ok(w.ok, w.error); assert.strictEqual(w.name, 'ANDI SETIAWAN'); assert.strictEqual(w.role, 'PEKERJA');
  assert.match(w.token, /^[a-f0-9]{64}$/); W = w.token;
  const a = login('Ibu', 'ibuBatam2026!'); assert.strictEqual(a.role, 'ADMIN'); A = a.token;
  const ses = env.ss.getSheetByName('Sesi').dump();
  assert.ok(!JSON.stringify(ses).includes(W), 'raw token not stored');
});
test('login: name must be letters 2–30; password required', () => {
  assert.match(login('1', 'tokoSembilan9').error, /nama/i);
  assert.match(login('=HYPERLINK("x")', 'tokoSembilan9').error, /nama/i);
  assert.match(login('BUDI', '').error, /kata sandi/i);
});
test('brute force: wrong password slows down, logs, locks the device after 5', () => {
  const before = env.stats.sleeps;
  for (let i = 0; i < 5; i++) assert.match(login('XX', 'wrongpass', 'attacker-phone').error, /salah/);
  assert.strictEqual(env.stats.sleeps - before, 5);
  assert.match(login('XX', 'tokoSembilan9', 'attacker-phone').error, /Terlalu banyak/);
  assert.ok(login('BUDI', 'tokoSembilan9', 'budi-phone').ok, 'other phones unaffected');
  assert.ok(logRows().some(r => r[2] === 'Gagal masuk'));
});
test('brute force: many failures from anywhere SLOW logins (no shop-wide lockout); hard stop only at 300', () => {
  for (let i = 0; i < 30; i++) login('XX', 'nope' + i, 'dev' + i);
  const sleeps = env.stats.sleeps;
  assert.strictEqual(login('ANDI', 'tokoSembilan9', 'fresh').ok, true, 'a real worker can still log in');
  assert.strictEqual(env.stats.sleeps, sleeps + 1, 'but it is slowed down');
  env.cache.set('lf_all', '300');
  assert.match(login('ANDI', 'tokoSembilan9', 'fresh2').error, /Terlalu banyak/);
  env.cache.clear();
});
test('tokens: bad/missing/forged → AUTH; unknown action rejected', () => {
  assert.strictEqual(call({ action: 'boot' }).code, 'AUTH');
  assert.strictEqual(call({ action: 'boot', token: 'a'.repeat(64) }).code, 'AUTH');
  assert.strictEqual(call({ action: 'boot', token: "' OR 1=1" }).code, 'AUTH');
  assert.match(call({ action: 'deleteEverything', token: W }).error, /tidak dikenal/);
});
test('request hygiene: oversized / malformed bodies rejected, internals never leaked', () => {
  assert.match(JSON.parse(doPost({ postData: { contents: 'x'.repeat(30000) } }).getContent()).error, /terlalu besar/);
  assert.match(JSON.parse(doPost({ postData: { contents: '{bad' } }).getContent()).error, /tidak valid/);
  assert.match(JSON.parse(doPost({ postData: { contents: '[1,2]' } }).getContent()).error, /tidak valid/);
  assert.ok(post({ action: 'ping' }).ok);
});

// ── create ──
let first;
test('add: messy name → one canonical spelling, invoice keeps leading zero, amount parsed, month tab created far left', () => {
  const r = call({ action: 'add', token: W, entry: entry({ name: ' pt yafindo   mitra-permata ', invoice: ' 0085 ', amount: '1.776.424', paidFrom: 'transfer ibu' }) });
  assert.ok(r.ok, r.error); first = r.entry;
  assert.strictEqual(r.entry.name, 'PT. YAFINDO MITRA PERMATA'); assert.strictEqual(r.entry.invoice, '0085');
  assert.strictEqual(r.entry.amount, 1776424); assert.strictEqual(r.entry.paidFrom, 'Transfer Ibu'); assert.strictEqual(r.entry.by, 'ANDI SETIAWAN');
  assert.ok(dataRows()[0][0] instanceof Date);
  assert.strictEqual(names()[0], monthName(today.slice(0, 7)));
});
test('add: resend of the same id (offline retry) never duplicates', () => {
  const r = call({ action: 'add', token: W, entry: entry({ id: first.id, name: 'PT. YAFINDO MITRA PERMATA', invoice: '0085', amount: 1776424, paidFrom: 'Transfer Ibu' }) });
  assert.ok(r.already); assert.strictEqual(dataRows().length, 1);
});
test('duplicates: same invoice (leading zeros ignored) or same name+amount+date → warning; force saves', () => {
  const e = entry({ name: 'PT YAFINDO MITRA PERMATA', invoice: '85', amount: 50000 });
  assert.strictEqual(call({ action: 'add', token: W, entry: e }).code, 'DUP_INVOICE');
  assert.ok(call({ action: 'add', token: W, entry: e, force: true }).ok);
  assert.ok(call({ action: 'add', token: W, entry: entry({ name: 'ROKOK', amount: 1350000 }) }).ok);
  assert.strictEqual(call({ action: 'add', token: W, entry: entry({ name: 'rokok', amount: 1350000 }) }).code, 'DUP_SIMILAR');
});
test('validation (Indonesian messages)', () => {
  const bad = (patch, re, tok = W) => { const r = call({ action: 'add', token: tok, entry: entry(patch) }); assert.strictEqual(r.ok, false, JSON.stringify(patch)); assert.match(r.error, re); };
  bad({ date: addDays_(today, 1) }, /lebih dari hari ini/);
  bad({ date: daysAgo(61) }, /terlalu lama/);
  bad({ date: '2026-02-30' }, /tidak valid/);
  bad({ date: '02/11/2026' }, /tidak valid/);
  bad({ amount: 0 }, /wajib/); bad({ amount: -5 }, /wajib/); bad({ amount: 12.5 }, /wajib/); bad({ amount: 'abc' }, /wajib/);
  bad({ amount: 600000000 }, /terlalu besar/);
  bad({ name: '' }, /wajib/); bad({ name: '###' }, /wajib/);
  bad({ invoice: 'INV 12;DROP' }, /invoice/i); bad({ invoice: 'X'.repeat(31) }, /invoice/i);
  bad({ paidFrom: '' }, /bayar pakai/); bad({ paidFrom: 'Lainnya:' }, /bayar pakai/); bad({ paidFrom: 'cash' }, /bayar pakai/);
  bad({ id: 'a b' }, /ID/);
  assert.ok(call({ action: 'add', token: A, entry: entry({ date: daysAgo(200), name: 'GAS PORTABEL' }) }).ok, 'admin may enter older dates');
});
test('formula injection is neutralised in every text field', () => {
  const r = call({ action: 'add', token: W, entry: entry({ name: '=IMPORTXML("http://evil","//a")', note: '=HYPERLINK("http://evil")', paidFrom: 'Lainnya: =cmd' }) });
  assert.ok(r.ok, r.error);
  const row = dataRows().find(x => x[11] === r.entry.id);
  [row[1], row[4], row[6]].forEach(v => assert.ok(!/^[=+\-@]/.test(String(v)), 'starts like a formula: ' + v));
  assert.strictEqual(row[6], "'=HYPERLINK(\"http://evil\")", 'note kept as plain text');
  const sup = env.ss.getSheetByName('Supplier').dump();
  assert.ok(!sup.some(s => /^[=+\-@]/.test(String(s[0]))));
  const tab = env.ss.getSheetByName(monthName(today.slice(0, 7))).dump();
  assert.ok(!tab.some(rw => rw.some(v => typeof v === 'string' && /^[=+\-@]/.test(v))), 'month tab has no formula-like text');
});
test('"Lainnya: name" accepted and cleaned', () => {
  const r = call({ action: 'add', token: W, entry: entry({ name: 'GAS PORTABEL', amount: 465000, paidFrom: 'lainnya: bg  bujang' }) });
  assert.strictEqual(r.entry.paidFrom, 'Lainnya: BG BUJANG');
});
test('new supplier added once with who added it; hidden supplier reactivated when used', () => {
  call({ action: 'add', token: W, entry: entry({ name: 'toko sinar harapan', amount: 85000 }) });
  call({ action: 'add', token: W, entry: entry({ name: 'TOKO  SINAR-HARAPAN', amount: 86000 }) });
  const sup = env.ss.getSheetByName('Supplier').dump().filter(r => r[0] === 'TOKO SINAR HARAPAN');
  assert.strictEqual(sup.length, 1); assert.strictEqual(sup[0][2], 'ANDI SETIAWAN');
  env.ss.getSheetByName('Supplier').getRange(2, 2).setValue('TIDAK');
  assert.ok(!call({ action: 'boot', token: W }).suppliers.includes(SEED_SUPPLIERS[0][0]));
});
test('write rate limit: max 20 writes/minute per session', () => {
  const t = login('CEPAT', 'tokoSembilan9').token;
  let last;
  for (let i = 0; i < 21; i++) last = call({ action: 'add', token: t, entry: entry({ name: 'PERMEN', amount: 1000 + i }) });
  assert.match(last.error, /Terlalu cepat/);
  env.cache.clear();
});

// ── read ──
test('boot: suppliers (names only), frequent, today count, limits per role', () => {
  const b = call({ action: 'boot', token: W });
  assert.ok(b.ok); assert.ok(typeof b.suppliers[0] === 'string');
  assert.ok(b.frequent.length > 0); assert.ok(b.todayCount >= 5);
  assert.strictEqual(b.limits.editDays, 3); assert.strictEqual(b.limits.backDays, 60);
  assert.strictEqual(call({ action: 'boot', token: A }).limits.backDays, 400);
});
test('list: a month newest first, deleted excluded, canEdit flag, total; bad month rejected', () => {
  const l = call({ action: 'list', token: W, month: today.slice(0, 7) });
  assert.ok(l.ok); assert.ok(l.entries.length >= 5);
  assert.strictEqual(l.total, l.entries.reduce((s, e) => s + e.amount, 0));
  assert.ok(l.entries.every(e => e.canEdit === true));
  const ds = l.entries.map(e => e.date); assert.deepStrictEqual(ds, ds.slice().sort().reverse());
  assert.match(call({ action: 'list', token: W, month: '2026-13' }).error, /tidak valid/);
});

// ── update / delete with the 3-day window ──
test('update: changes fields, logs before→after, moves between month tabs', () => {
  const prevMonthDay = addDays_(today.slice(0, 7) + '-01', -1); // last day of previous month
  const r = call({ action: 'update', token: W, id: first.id, entry: Object.assign({}, first, { amount: 1767424, date: prevMonthDay, note: 'koreksi' }), force: true });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.entry.amount, 1767424); assert.strictEqual(r.entry.editedBy, 'ANDI SETIAWAN');
  const lg = logRows().filter(x => x[2] === 'Ubah').pop();
  assert.match(lg[5], /Nominal: Rp 1\.776\.424 → Rp 1\.767\.424/); assert.match(lg[5], /Tanggal:/);
  assert.ok(names().includes(monthName(prevMonthDay.slice(0, 7))));
  const ms = names().map(parseMonthName_).filter(Boolean);
  assert.deepStrictEqual(ms, ms.slice().sort().reverse(), 'newest month first: ' + names().join(','));
  assert.deepStrictEqual(names().slice(-4), ['Data', 'Supplier', 'Log', 'Sesi']);
  const unchanged = call({ action: 'update', token: W, id: first.id, entry: r.entry, force: true });
  assert.ok(unchanged.unchanged);
});
test('update: duplicate check excludes itself but catches others', () => {
  const other = call({ action: 'add', token: W, entry: entry({ name: 'PT. LIM SIANG HUAT', invoice: '4761', amount: 634250 }) }).entry;
  const r = call({ action: 'update', token: W, id: other.id, entry: Object.assign({}, other, { invoice: '0085', name: 'PT. YAFINDO MITRA PERMATA' }) });
  assert.strictEqual(r.code, 'DUP_INVOICE');
});
test('3-day window: worker blocked on entries recorded >3 days ago (even if dated recently); admin allowed', () => {
  const e = call({ action: 'add', token: W, entry: entry({ name: 'YAKULT', amount: 47200 }) }).entry;
  const sh = env.ss.getSheetByName('Data');
  const i = sh.dump().findIndex(r => r[11] === e.id);
  sh.getRange(i + 1, 8).setValue(new Date(Date.now() - 4 * 86400000)); // recorded 4 days ago
  assert.match(call({ action: 'update', token: W, id: e.id, entry: Object.assign({}, e, { amount: 1 }) }).error, /hanya bisa diubah oleh Ibu/);
  assert.match(call({ action: 'remove', token: W, id: e.id, reason: 'Salah input' }).error, /hanya bisa diubah oleh Ibu/);
  const l = call({ action: 'list', token: W, month: today.slice(0, 7) });
  assert.strictEqual(l.entries.find(x => x.id === e.id).canEdit, false);
  assert.ok(call({ action: 'update', token: A, id: e.id, entry: Object.assign({}, e, { amount: 47300 }) }).ok);
  sh.getRange(i + 1, 8).setValue(new Date(Date.now() - 2.5 * 86400000)); // 2.5 days → still editable
  assert.ok(call({ action: 'update', token: W, id: e.id, entry: Object.assign({}, e, { amount: 47400 }) }).ok);
});
test('remove: needs a reason, marks DIHAPUS (never deletes), logs, leaves views', () => {
  const e = call({ action: 'add', token: W, entry: entry({ name: 'BOLU KERING', amount: 20000 }) }).entry;
  assert.match(call({ action: 'remove', token: W, id: e.id }).error, /alasan/);
  assert.ok(call({ action: 'remove', token: W, id: e.id, reason: 'Dobel' }).ok);
  const row = dataRows().find(r => r[11] === e.id);
  assert.strictEqual(row[10], 'DIHAPUS');
  assert.ok(logRows().some(r => r[2] === 'Hapus' && /Dobel/.test(r[5])));
  assert.ok(!call({ action: 'list', token: W, month: today.slice(0, 7) }).entries.some(x => x.id === e.id));
  const tab = env.ss.getSheetByName(monthName(today.slice(0, 7))).dump();
  assert.ok(!tab.some(r => r[1] === 'BOLU KERING'));
  assert.ok(!call({ action: 'update', token: A, id: e.id, entry: e }).ok, 'deleted entries cannot be edited');
});

// ── month tab layout ──
test('month tab: summary row by payment source; per-day totals and per-supplier totals both add up', () => {
  const ym = today.slice(0, 7);
  const tab = env.ss.getSheetByName(monthName(ym)).dump();
  const live = dataRows().filter(r => r[10] !== 'DIHAPUS' && fmtDate_(r[0]).slice(0, 7) === ym);
  const total = live.reduce((s, r) => s + r[3], 0);
  assert.deepStrictEqual(tab[1].slice(0, 6), ['Total', 'Transfer Ibu', 'Uang Kasir', 'Modal', 'Lainnya', 'Transaksi']);
  assert.strictEqual(tab[2][0], total);
  assert.strictEqual(tab[2][1] + tab[2][2] + tab[2][3] + tab[2][4], total);
  assert.strictEqual(tab[2][5], live.length);
  assert.deepStrictEqual(tab[4], ['Tanggal', 'Nama PT / Barang', 'No. Invoice', 'Nominal', 'Bayar Pakai', 'Dicatat Oleh', 'Catatan']);
  const body = tab.slice(5);
  const entries = body.filter(r => r[0] instanceof Date);
  assert.strictEqual(entries.length, live.length);
  assert.strictEqual(body.filter(r => /^Total \d\d\/\d\d$/.test(r[1])).reduce((s, r) => s + r[3], 0), total);
  const supStart = body.findIndex(r => r[0] === 'TOTAL PER SUPPLIER');
  assert.ok(supStart > 0);
  assert.strictEqual(body.slice(supStart + 1).reduce((s, r) => s + (r[3] || 0), 0), total);
  assert.strictEqual(env.ss.getSheetByName(monthName(ym)).frozen, 5);
});

// ── Ibu editing the sheet directly ──
test('sheet edit: Ibu changes an amount in Data → logged, month tab refreshed', () => {
  const sh = env.ss.getSheetByName('Data');
  const rows = sh.dump();
  const i = rows.findIndex((r, k) => k > 0 && r[1] === 'ROKOK');
  const old = rows[i][3];
  sh.getRange(i + 1, 4).setValue(1400000);
  onDataEdit({ range: sh.getRange(i + 1, 4), oldValue: String(old), value: '1400000' });
  assert.ok(logRows().some(r => r[2] === 'Ubah manual' && /Nominal: 1350000 → 1400000/.test(r[5])));
  const tab = env.ss.getSheetByName(monthName(today.slice(0, 7))).dump();
  assert.ok(tab.some(r => r[1] === 'ROKOK' && r[3] === 1400000));
});
test('sheet edit: Ibu types a new row in Data (dd/mm/yyyy) → gets ID, MANUAL, appears in month tab', () => {
  const sh = env.ss.getSheetByName('Data');
  const r = sh.getLastRow() + 1;
  const d = today.split('-').reverse().join('/');
  sh.getRange(r, 1, 1, 5).setValues([[d, 'pt tempo', '', 99000, 'Transfer Ibu']]);
  onDataEdit({ range: sh.getRange(r, 1, 1, 5) });
  const row = sh.dump()[r - 1];
  assert.match(row[11], /^m[a-f0-9]{15}$/); assert.strictEqual(row[5], 'MANUAL'); assert.strictEqual(row[10], 'AKTIF');
  assert.strictEqual(row[1], 'PT TEMPO');
  const tab = env.ss.getSheetByName(monthName(today.slice(0, 7))).dump();
  assert.ok(tab.some(x => x[1] === 'PT TEMPO' && x[3] === 99000));
  assert.ok(call({ action: 'list', token: A, month: today.slice(0, 7) }).entries.some(x => x.name === 'PT TEMPO'));
});
test('sheet edit: Ibu deletes a row → onChange rebuilds month tabs', () => {
  const sh = env.ss.getSheetByName('Data');
  const i = sh.dump().findIndex(r => r[1] === 'PT TEMPO');
  sh.deleteRow(i + 1);
  onDataChange({ changeType: 'REMOVE_ROW' });
  assert.ok(!env.ss.getSheetByName(monthName(today.slice(0, 7))).dump().some(x => x[1] === 'PT TEMPO'));
});

// ── sessions ──
test('logout ends only that session', () => {
  const t = login('SITI', 'tokoSembilan9').token;
  assert.ok(call({ action: 'logout', token: t }).ok);
  assert.strictEqual(call({ action: 'boot', token: t }).code, 'AUTH');
  assert.ok(call({ action: 'boot', token: W }).ok);
});
test('session expires after 90 days unused', () => {
  const t = login('LAMA', 'tokoSembilan9').token;
  const sh = env.ss.getSheetByName('Sesi');
  const i = sh.dump().findIndex(r => r[1] === 'LAMA');
  sh.getRange(i + 1, 5).setValue(new Date(Date.now() - 91 * 86400000));
  assert.strictEqual(call({ action: 'boot', token: t }).code, 'AUTH');
});
test('changing a password or "Keluarkan semua HP" logs every phone out', () => {
  setPassword_('worker', 'passwordBaru2');
  assert.strictEqual(call({ action: 'boot', token: W }).code, 'AUTH');
  assert.strictEqual(call({ action: 'boot', token: A }).code, 'AUTH');
  assert.strictEqual(login('ANDI', 'tokoSembilan9').ok, false, 'old password no longer works');
  const t = login('ANDI', 'passwordBaru2').token;
  assert.ok(call({ action: 'boot', token: t }).ok);
  bumpEpoch_();
  assert.strictEqual(call({ action: 'boot', token: t }).code, 'AUTH');
});

// ── regressions for bugs found by the QA bug hunt (qa-bug-hunt/bug-report-20261102-150930-catat999.md) ──
test('bug #1/#7: logging out never ends someone else\'s session; "last used" lands on the right row', () => {
  env.cache.clear();
  const a = login('ANI', 'passwordBaru2', 'p-a').token, b = login('BUDI', 'passwordBaru2', 'p-b').token, c = login('CITRA', 'passwordBaru2', 'p-c').token;
  assert.ok(call({ action: 'logout', token: a }).ok);
  assert.ok(call({ action: 'logout', token: c }).ok);
  assert.strictEqual(call({ action: 'boot', token: b }).ok, true, 'Budi stays logged in');
  assert.strictEqual(call({ action: 'boot', token: c }).code, 'AUTH', 'Citra is logged out');
  const ses = env.ss.getSheetByName('Sesi'), hb = sha256_(b);
  const row = ses.dump().findIndex(r => r[0] === hb);
  ses.cells[row][4] = new Date(Date.now() - 2 * 3600e3);
  call({ action: 'boot', token: b });
  assert.ok(Date.now() - ses.dump()[row][4].getTime() < 60000, 'Budi\'s own "Terakhir Dipakai" refreshed');
});
test('bug #6: a tab Ibu made with a month-like name is renamed "(lama)", never wiped', () => {
  const name = monthName(today.slice(0, 7)).replace(/^(\w+)/, m => m) ; // e.g. "NOV 2026"
  const tabName = BULAN[Number(today.slice(5, 7)) - 1] + ' ' + today.slice(0, 4);
  const existing = env.ss.getSheetByName(tabName); if (existing) env.ss.deleteSheet(existing);
  const own = env.ss.insertSheet(tabName, 0);
  own.getRange(1, 1, 1, 2).setValues([['Catatan Ibu', 123]]);
  env.cache.clear();
  const t = login('ANI', 'passwordBaru2', 'p-tab').token;
  assert.ok(call({ action: 'add', token: t, entry: entry({ amount: 4321 }) }).ok);
  assert.strictEqual(env.ss.getSheetByName(tabName + ' (lama)').getRange(1, 1).getValue(), 'Catatan Ibu');
  assert.ok(String(env.ss.getSheetByName(tabName).getRange(1, 1).getValue()).startsWith('999 MART'));
  assert.ok(logRows().some(r => r[2] === 'Tab dipindah'));
  void name;
});
test('bug #8: a row pasted as a copy in Data gets its own new ID (the original keeps its ID)', () => {
  env.cache.clear();
  const t = login('ANI', 'passwordBaru2', 'p-copy').token;
  const e = entry({ amount: 5555 }); assert.ok(call({ action: 'add', token: t, entry: e }).ok);
  const data = env.ss.getSheetByName('Data'), src = data.dump().findIndex(r => r[C.ID] === e.id);
  const copy = data.dump()[src].slice(); copy[C.AMT] = 6666;
  const at = data.getLastRow() + 1; data.cells[at - 1] = copy;
  onDataEdit({ range: data.getRange(at, 1, 1, 12) });
  const ids = data.dump().slice(1).map(r => r[C.ID]).filter(Boolean);
  assert.strictEqual(new Set(ids).size, ids.length, 'all IDs unique');
  assert.strictEqual(data.dump()[src][C.ID], e.id, 'original keeps its ID');
  assert.strictEqual(data.dump()[at - 1][C.BY], 'MANUAL');
});
test('bug #9: fixing the amount of an entry whose (unchanged) date is now >60 days back is allowed', () => {
  env.cache.clear();
  const t = login('ANI', 'passwordBaru2', 'p-old').token;
  const e = entry({ date: daysAgo(60), amount: 7777 }); assert.ok(call({ action: 'add', token: t, entry: e }).ok);
  const data = env.ss.getSheetByName('Data'), i = data.dump().findIndex(r => r[C.ID] === e.id);
  data.cells[i][C.DATE] = toDate_(daysAgo(62));                      // as if two days have passed
  const r = call({ action: 'update', token: t, id: e.id, entry: Object.assign({}, e, { date: daysAgo(62), amount: 7778 }) });
  assert.ok(r.ok, r.error);
  const moved = call({ action: 'update', token: t, id: e.id, entry: Object.assign({}, e, { date: daysAgo(63), amount: 7778 }) });
  assert.match(moved.error, /terlalu lama/, 'changing the date to an older one is still refused');
});
test('bug #10: manual rows — only the cells the script fills are written back (typed text is never re-written)', () => {
  const data = env.ss.getSheetByName('Data');
  const at = data.getLastRow() + 1;
  data.cells[at - 1] = ['05/' + today.slice(5, 7) + '/' + today.slice(0, 4), 'ROKOK', '', 'Rp 12.000', 'Modal', '', "'+6281234", '', '', '', '', ''];
  const before = data.writes.length;
  onDataEdit({ range: data.getRange(at, 1, 1, 7) });
  const writes = data.writes.slice(before).filter(w => w[0] === at);
  const cols = []; writes.forEach(([, c, , nc]) => { for (let k = 0; k < nc; k++) cols.push(c + k); });
  assert.ok(!cols.includes(C.NOTE + 1), 'note cell not re-written');
  assert.ok(cols.includes(C.ID + 1) && cols.includes(C.DATE + 1) && cols.includes(C.AMT + 1));
  assert.strictEqual(data.dump()[at - 1][C.AMT], 12000);
});

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
