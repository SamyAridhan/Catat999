// Acceptance tests, backend half: every requirement from docs/REQUIREMENTS.md that lives in the server and the Sheet,
// checked as the shop would see it (the real Code.gs + Seed.gs on the in-memory Sheet). Each check is labelled R##.
// Usage: TZ=Asia/Jakarta node tests/acceptance.backend.test.js
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

let passed = 0, failed = 0;
function req(id, name, fn) {
  env.cache.clear();   // rate-limit counters are per minute; the tests are faster than people
  try { fn(); passed++; console.log(`  ✓ ${id}  ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${id}  ${name}`); console.log('     ' + String(e.stack || e).split('\n').slice(0, 4).join('\n     ')); }
}
const post = r => JSON.parse(doPost({ postData: { contents: typeof r === 'string' ? r : JSON.stringify(r) } }).getContent());
const call = r => { env.cache.clear(); return post(r); };
const today = todayStr_(), ym = today.slice(0, 7);
const ago = n => addDays_(today, -n);
const sh = n => env.ss.getSheetByName(n);
const rows = n => sh(n).dump().slice(1).filter(r => r.some(v => v !== ''));
const data = () => rows('Data');
const logs = () => rows('Log');
const tabName = m => BULAN[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
const tab = m => sh(tabName(m));
let n = 0;
const nid = () => 'acc' + String(++n).padStart(5, '0') + 'x';
const W_PW = 'tokoSembilan9', A_PW = 'ibuBatam2026!';
const login = (name, pw, device) => call({ action: 'login', name, password: pw, device: device || 'hp-' + name });
const add = (tok, o, force) => call({ action: 'add', token: tok, entry: Object.assign({ id: nid(), date: today, name: 'ROKOK', amount: 10000 + n, paidFrom: 'Modal' }, o), force: !!force });
const rowOf = id => data().find(r => r[C.ID] === id);
const rowNo = id => sh('Data').dump().findIndex(r => r[C.ID] === id) + 1;
const setRecordedAgo = (id, days) => sh('Data').getRange(rowNo(id), C.AT + 1).setValue(new Date(Date.now() - days * 86400000));

console.log('today =', today);

// ─────────────── setup and passwords ───────────────
setup();
req('R01', 'nobody can log in before the passwords are set (no default passwords)', () => {
  const r = login('Ani', 'apa saja 123');
  assert.strictEqual(r.ok, false); assert.match(r.error, /belum siap|kata sandi belum diatur/i);
});
req('R02', 'passwords: at least 8 characters, worker and admin must differ, set from the Catat 999 menu', () => {
  assert.throws(() => setPassword_('worker', 'pendek'), /minimal 8/);
  env.ui.answers.push(['OK', W_PW]); menuWorkerPassword();
  env.ui.answers.push(['OK', W_PW]); menuAdminPassword();
  assert.match(env.ui.alerts.slice(-1)[0], /harus berbeda/);
  env.ui.answers.push(['OK', A_PW]); menuAdminPassword();
  assert.match(env.ui.alerts.slice(-1)[0], /disimpan/);
  onOpen();
  const menu = JSON.stringify(env.ui.menus);
  for (const item of ['Perbarui semua tab', 'Atur kata sandi pekerja', 'Atur kata sandi admin (Ibu)', 'Keluarkan semua HP']) assert.ok(menu.includes(item), item);
});
req('R03', 'passwords are never stored readable: not in the Sheet, only salted hashes in Script Properties', () => {
  const everything = JSON.stringify(env.ss.getSheets().map(s => s.dump())) + JSON.stringify(env.props || {});
  assert.ok(!everything.includes(W_PW) && !everything.includes(A_PW));
});

// ─────────────── login and sessions ───────────────
let W, A;
req('R04', 'worker logs in with any name + the shared worker password; Ibu with the admin password gets the admin role', () => {
  const w = login('ani', W_PW), a = login('Ibu', A_PW);
  assert.ok(w.ok && a.ok);
  assert.deepStrictEqual([w.name, w.role, a.name, a.role], ['ANI', 'PEKERJA', 'IBU', 'ADMIN']);
  W = w.token; A = a.token;
  assert.ok(logs().some(r => r[2] === 'Masuk' && r[1] === 'ANI') && logs().some(r => r[2] === 'Masuk (admin)'));
});
req('R05', 'wrong password says so, is logged, and 5 wrong tries lock that phone (other phones still work)', () => {
  env.cache.clear();
  for (let i = 0; i < 5; i++) assert.strictEqual(post({ action: 'login', name: 'Budi', password: 'salah' + i, device: 'hp-curang' }).error, 'Kata sandi salah.');
  assert.match(post({ action: 'login', name: 'Budi', password: W_PW, device: 'hp-curang' }).error, /Terlalu banyak percobaan/);
  assert.ok(post({ action: 'login', name: 'Budi', password: W_PW, device: 'hp-lain' }).ok);
  assert.ok(logs().filter(r => r[2] === 'Gagal masuk').length >= 5);
});
req('R06', 'many wrong tries from everywhere slow logins down but never lock the whole shop out (until 300)', () => {
  env.cache.clear(); env.cache.set('lf_all', '100');
  const sleeps = env.stats.sleeps;
  const r = post({ action: 'login', name: 'Cici', password: W_PW, device: 'hp-cici' });
  assert.ok(r.ok, 'still able to log in');
  assert.ok(env.stats.sleeps > sleeps, 'but slowed down');
  env.cache.set('lf_all', '300');
  assert.match(post({ action: 'login', name: 'Cici', password: W_PW, device: 'hp-cici2' }).error, /Terlalu banyak/);
  env.cache.clear();
});
req('R07', 'sessions: random 256-bit token, only its hash stored; the phone stays logged in; 90 days unused → logged out', () => {
  const r = login('Dedi', W_PW);
  assert.match(r.token, /^[a-f0-9]{64}$/);
  const ses = rows('Sesi');
  assert.ok(!JSON.stringify(ses).includes(r.token), 'token itself not stored');
  assert.ok(ses.some(s => s[0] === sha256_(r.token)), 'hash stored');
  assert.ok(call({ action: 'boot', token: r.token }).ok);
  const i = sh('Sesi').dump().findIndex(s => s[0] === sha256_(r.token));
  sh('Sesi').getRange(i + 1, 5).setValue(new Date(Date.now() - 89 * 86400000));
  assert.ok(call({ action: 'boot', token: r.token }).ok, '89 days → still logged in');
  sh('Sesi').getRange(i + 1, 5).setValue(new Date(Date.now() - 91 * 86400000));
  assert.strictEqual(call({ action: 'boot', token: r.token }).code, 'AUTH', '91 days unused → logged out');
});
req('R08', 'logging out ends only that session', () => {
  const a = login('Eka', W_PW).token, b = login('Fani', W_PW).token;
  assert.ok(call({ action: 'logout', token: a }).ok);
  assert.strictEqual(call({ action: 'boot', token: a }).code, 'AUTH');
  assert.ok(call({ action: 'boot', token: b }).ok);
});
req('R09', '"Keluarkan semua HP" and changing a password log every phone out', () => {
  const a = login('Gita', W_PW).token;
  menuLogoutAll();
  assert.strictEqual(call({ action: 'boot', token: a }).code, 'AUTH');
  const b = login('Gita', W_PW).token;
  env.ui.answers.push(['OK', 'tokoBaru2026']); menuWorkerPassword();
  assert.strictEqual(call({ action: 'boot', token: b }).code, 'AUTH');
  assert.strictEqual(login('Gita', W_PW).error, 'Kata sandi salah.', 'old password no longer works');
  setPassword_('worker', W_PW);
  W = login('Ani', W_PW).token; A = login('Ibu', A_PW).token;
});

// ─────────────── supplier list ───────────────
req('R10', 'the 124 known suppliers are there from the start, one spelling each, and the app gets them', () => {
  assert.strictEqual(SEED_SUPPLIERS.length, 124);
  assert.strictEqual(new Set(SEED_SUPPLIERS.map(nameKey_)).size, 124, 'no two spellings of the same supplier');
  assert.strictEqual(rows('Supplier').length, 124);
  assert.strictEqual(call({ action: 'boot', token: W }).suppliers.length, 124);
});
req('R11', 'the seed holds names only: no bank account or ID numbers', () => {
  const src = fs.readFileSync(path.join(dir, 'Seed.gs'), 'utf8');
  assert.ok(!/\d{8,}/.test(src.replace(/\s/g, '')), 'no long digit runs');
  assert.ok(!/rekening|no\.?\s*rek|norek|ktp|nik\b|npwp/i.test(src));
});
req('R12', 'a known supplier typed differently is stored with its one spelling; a new name is added to the list', () => {
  const r = add(W, { name: 'pt yafindo mitra permata', amount: 777001 });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.entry.name, 'PT. YAFINDO MITRA PERMATA');
  const r2 = add(W, { name: 'Toko Baru Jaya', amount: 777002 });
  assert.strictEqual(r2.entry.name, 'TOKO BARU JAYA');
  const s = rows('Supplier').find(x => x[0] === 'TOKO BARU JAYA');
  assert.ok(s && s[1] === 'YA' && s[2] === 'ANI', 'added, active, by whom');
  assert.ok(call({ action: 'boot', token: W }).suppliers.includes('TOKO BARU JAYA'));
});
req('R13', 'Ibu can hide a supplier (Aktif = TIDAK); using the name again brings it back', () => {
  const i = sh('Supplier').dump().findIndex(x => x[0] === 'TOKO BARU JAYA');
  sh('Supplier').getRange(i + 1, 2).setValue('TIDAK');
  assert.ok(!call({ action: 'boot', token: W }).suppliers.includes('TOKO BARU JAYA'));
  add(W, { name: 'toko baru jaya', amount: 777003 });
  assert.ok(call({ action: 'boot', token: W }).suppliers.includes('TOKO BARU JAYA'));
});

// ─────────────── recording a transaction ───────────────
req('R14', 'a saved entry lands in Data with every field, who recorded it and when', () => {
  const before = Date.now();
  const r = add(W, { name: 'SARI ROTI', invoice: 'inv/0091', amount: 206100, paidFrom: 'Uang Kasir', note: 'retur 2 dus' });
  assert.ok(r.ok, r.error);
  const row = rowOf(r.entry.id);
  assert.strictEqual(fmtDate_(row[C.DATE]), today);
  assert.deepStrictEqual([row[C.NAME], row[C.INV], row[C.AMT], row[C.FROM], row[C.BY], row[C.NOTE], row[C.STATUS]],
    ['SARI ROTI', 'INV/0091', 206100, 'Uang Kasir', 'ANI', 'retur 2 dus', 'AKTIF']);
  assert.ok(row[C.AT] instanceof Date && row[C.AT].getTime() >= before - 1000);
  assert.ok(logs().some(l => l[2] === 'Tambah' && l[1] === 'ANI' && /206\.100/.test(l[5])), 'logged');
});
req('R15', 'invoice number and note are optional', () => {
  const r = add(W, { name: 'GALON', amount: 18000, invoice: '', note: '' });
  assert.ok(r.ok, r.error);
});
req('R16', 'pay sources: Transfer Ibu / Uang Kasir / Modal, or Lainnya with a name', () => {
  for (const p of ['Transfer Ibu', 'Uang Kasir', 'Modal']) assert.ok(add(W, { paidFrom: p, name: 'AQUA ' + p.toUpperCase(), amount: 5000 }).ok, p);
  assert.strictEqual(add(W, { paidFrom: 'Lainnya: Pak Rudi', name: 'ES BATU', amount: 5000 }).entry.paidFrom, 'Lainnya: PAK RUDI');
  assert.strictEqual(add(W, { paidFrom: 'Lainnya', name: 'ES BATU', amount: 6000 }).error, 'Pilih bayar pakai apa.', 'Lainnya needs a name');
  assert.strictEqual(add(W, { paidFrom: 'Cash', name: 'ES BATU', amount: 7000 }).error, 'Pilih bayar pakai apa.');
  assert.strictEqual(add(W, { paidFrom: '', name: 'ES BATU', amount: 8000 }).error, 'Pilih bayar pakai apa.');
});
req('R17', 'required: supplier name and amount', () => {
  assert.strictEqual(add(W, { name: '' }).error, 'Nama PT / barang wajib diisi.');
  assert.strictEqual(add(W, { amount: 0 }).error, 'Nominal wajib diisi.');
  assert.strictEqual(add(W, { amount: -5000 }).error, 'Nominal wajib diisi.');
  assert.strictEqual(add(W, { amount: 1500.5 }).error, 'Nominal wajib diisi.');
});
req('R18', 'amount limit Rp 500.000.000 per entry', () => {
  assert.ok(add(A, { name: 'MESIN KASIR', amount: 500000000 }).ok);
  assert.strictEqual(add(A, { name: 'MESIN KASIR', amount: 500000001 }).error, 'Nominal terlalu besar. Cek lagi.');
});
req('R19', 'dates: never in the future; workers up to 60 days back, Ibu up to 400; impossible dates refused', () => {
  assert.strictEqual(add(W, { date: addDays_(today, 1) }).error, 'Tanggal tidak boleh lebih dari hari ini.');
  assert.ok(add(W, { date: ago(1), amount: 1001 }).ok, 'kemarin');
  assert.ok(add(W, { date: ago(60), amount: 1002 }).ok, '60 days');
  assert.match(add(W, { date: ago(61), amount: 1003 }).error, /terlalu lama/);
  assert.ok(add(A, { date: ago(400), amount: 1004 }).ok, 'Ibu 400 days');
  assert.match(add(A, { date: ago(401), amount: 1005 }).error, /terlalu lama/);
  for (const d of ['2026-02-31', '03/11/2026', '', 'besok']) assert.strictEqual(add(W, { date: d }).error, 'Tanggal tidak valid.', d);
});
req('R20', 'invoice numbers: letters, digits, - / . only, max 30', () => {
  assert.ok(add(W, { invoice: 'SJ-2026/11.04', amount: 1101, name: 'NABATI' }).ok);
  assert.match(add(W, { invoice: 'INV#12', amount: 1102 }).error, /No\. invoice/);
  assert.match(add(W, { invoice: 'X'.repeat(31), amount: 1103 }).error, /No\. invoice/);
});

// ─────────────── duplicates ───────────────
req('R21', 'same supplier + same invoice (leading zeros ignored) → warning, nothing saved; "tetap simpan" saves', () => {
  const a = add(W, { name: 'PT. OMEGA SUKSES ABADI', invoice: '0012345', amount: 2450000 });
  assert.ok(a.ok);
  const count = data().length;
  const d = add(W, { name: 'omega sukses abadi', invoice: '12345', amount: 999 });
  assert.strictEqual(d.code, 'DUP_INVOICE'); assert.strictEqual(d.error, 'Invoice ini sudah pernah dicatat.');
  assert.strictEqual(d.existing.id, a.entry.id, 'shows the existing entry');
  assert.strictEqual(data().length, count, 'nothing saved');
  const f = add(W, { name: 'omega sukses abadi', invoice: '12345', amount: 999 }, true);
  assert.ok(f.ok); assert.strictEqual(data().length, count + 1);
  assert.ok(logs().some(l => l[2] === 'Tambah' && /disimpan walau ada yang mirip/.test(l[5])), 'forced save is visible in the Log');
  assert.ok(add(W, { name: 'NABATI', invoice: '777', amount: 5100 }).ok);
  assert.strictEqual(add(W, { name: 'NABATI', invoice: '000777', amount: 5200 }).code, 'DUP_INVOICE', 'zeros typed the other way round');
  assert.ok(add(W, { name: 'SARI ROTI', invoice: '777', amount: 5300 }).ok, 'same number from another supplier is fine');
});
req('R22', 'no invoice + same supplier, date and amount → "Sudah ada transaksi yang sama"', () => {
  assert.ok(add(W, { name: 'ROTI MAMA', amount: 350000, invoice: '' }).ok);
  const d = add(W, { name: 'ROTI MAMA', amount: 350000, invoice: '' });
  assert.strictEqual(d.code, 'DUP_SIMILAR');
  assert.ok(add(W, { name: 'ROTI MAMA', amount: 350000, date: ago(1) }).ok, 'another day is fine');
  assert.ok(add(W, { name: 'ROTI MAMA', amount: 350001 }).ok, 'another amount is fine');
});
req('R23', 'a resend of the same entry (same ID, e.g. after a lost answer offline) never saves twice', () => {
  const id = nid();
  const e = { id, date: today, name: 'TELUR', amount: 54000, paidFrom: 'Modal' };
  assert.ok(call({ action: 'add', token: W, entry: e }).ok);
  const again = call({ action: 'add', token: W, entry: e });
  assert.ok(again.ok && again.already);
  assert.strictEqual(data().filter(r => r[C.ID] === id).length, 1);
});

// ─────────────── month tabs ───────────────
req('R24', 'month tab: made on the first save of a month, title, summary per pay source, daily totals, supplier totals', () => {
  const t = tab(ym).dump();
  assert.ok(String(t[0][0]).startsWith('999 MART — ' + BULAN_PANJANG[Number(ym.slice(5, 7)) - 1]), 'title');
  assert.deepStrictEqual(t[1].slice(0, 6), ['Total', 'Transfer Ibu', 'Uang Kasir', 'Modal', 'Lainnya', 'Transaksi']);
  const live = data().filter(r => fmtDate_(r[C.DATE]).slice(0, 7) === ym && r[C.STATUS] !== 'DIHAPUS');
  const sum = f => live.filter(f).reduce((s, r) => s + r[C.AMT], 0);
  assert.strictEqual(t[2][0], sum(() => true), 'month total');
  assert.strictEqual(t[2][1], sum(r => r[C.FROM] === 'Transfer Ibu'));
  assert.strictEqual(t[2][2], sum(r => r[C.FROM] === 'Uang Kasir'));
  assert.strictEqual(t[2][3], sum(r => r[C.FROM] === 'Modal'));
  assert.strictEqual(t[2][4], sum(r => /^Lainnya/.test(r[C.FROM])));
  assert.strictEqual(t[2][5], live.length, 'number of transactions');
  const dd = today.slice(8, 10) + '/' + today.slice(5, 7);
  const dayRow = t.find(r => r[1] === 'Total ' + dd);
  assert.ok(dayRow, 'daily total row');
  assert.strictEqual(dayRow[3], sum(r => fmtDate_(r[C.DATE]) === today), 'daily total amount');
  const supHead = t.findIndex(r => r[0] === 'TOTAL PER SUPPLIER');
  assert.ok(supHead > 0, 'supplier totals');
  const rokok = t.slice(supHead).find(r => r[1] === 'ROKOK');
  assert.strictEqual(rokok[3], sum(r => r[C.NAME] === 'ROKOK'));
});
req('R25', 'month tabs: one per month, newest on the far left, after an older month was saved first', () => {
  const names = env.ss.getSheets().map(s => s.getName());
  const months = names.filter(x => /^[A-Z]{3} \d{4}$/.test(x));
  assert.strictEqual(names[0], tabName(ym), 'this month first');
  const order = months.map(parseMonthName_);
  assert.deepStrictEqual(order, order.slice().sort().reverse(), 'newest → oldest');
  assert.strictEqual(new Set(months).size, months.length);
});
req('R26', 'Ibu\'s own tab with a month-style name is kept as "(lama)", never overwritten', () => {
  const old = addDays_(ago(400), 10).slice(0, 7);
  const own = env.ss.insertSheet(tabName(old));
  own.getRange(1, 1).setValue('catatan pribadi Ibu');
  assert.ok(add(A, { date: old + '-15', amount: 1234 }).ok);
  assert.strictEqual(sh(tabName(old) + ' (lama)').dump()[0][0], 'catatan pribadi Ibu');
  assert.ok(String(tab(old).dump()[0][0]).startsWith('999 MART — '));
});

// ─────────────── Riwayat ───────────────
req('R27', 'Riwayat lists a month (newest first) with its total; deleted entries are left out', () => {
  const l = call({ action: 'list', token: W, month: ym });
  assert.ok(l.ok);
  const live = data().filter(r => fmtDate_(r[C.DATE]).slice(0, 7) === ym && r[C.STATUS] !== 'DIHAPUS');
  assert.strictEqual(l.entries.length, live.length);
  assert.strictEqual(l.total, live.reduce((s, r) => s + r[C.AMT], 0));
  const keys = l.entries.map(e => e.date + e.at);
  assert.deepStrictEqual(keys, keys.slice().sort().reverse(), 'newest first');
  assert.ok(l.entries.every(e => e.by && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(e.at)), 'who and when for every entry');
  assert.strictEqual(call({ action: 'list', token: W, month: '2026-13' }).error, 'Bulan tidak valid.');
});

// ─────────────── change and delete ───────────────
req('R28', 'a worker can change an entry up to 3 days after recording it; the Log shows before → after', () => {
  const e = add(W, { name: 'YAKULT', amount: 47200 }).entry;
  setRecordedAgo(e.id, 2.9);
  const r = call({ action: 'update', token: W, id: e.id, entry: Object.assign({}, e, { amount: 47300 }) });
  assert.ok(r.ok, r.error);
  const row = rowOf(e.id);
  assert.deepStrictEqual([row[C.AMT], row[C.EDITBY]], [47300, 'ANI']);
  assert.ok(logs().some(l => l[2] === 'Ubah' && /47\.200 → Rp 47\.300/.test(l[5])));
});
req('R29', 'after 3 days only Ibu can change or delete it (the app is told, so it can say so)', () => {
  const e = add(W, { name: 'YAKULT', amount: 47900 }).entry;
  setRecordedAgo(e.id, 3.1);
  assert.strictEqual(call({ action: 'update', token: W, id: e.id, entry: Object.assign({}, e, { amount: 1 }) }).error, 'Transaksi lebih dari 3 hari hanya bisa diubah oleh Ibu.');
  assert.strictEqual(call({ action: 'remove', token: W, id: e.id, reason: 'Salah input' }).error, 'Transaksi lebih dari 3 hari hanya bisa diubah oleh Ibu.');
  assert.strictEqual(call({ action: 'list', token: W, month: ym }).entries.find(x => x.id === e.id).canEdit, false);
  assert.strictEqual(call({ action: 'list', token: A, month: ym }).entries.find(x => x.id === e.id).canEdit, true);
  assert.ok(call({ action: 'update', token: A, id: e.id, entry: Object.assign({}, e, { amount: 48000 }) }).ok, 'Ibu can');
});
req('R30', 'workers can also change entries others recorded (shop-wide), within the 3 days', () => {
  const b = login('Budi', W_PW).token;
  const e = add(W, { name: 'TISU', amount: 12000 }).entry;
  assert.ok(call({ action: 'update', token: b, id: e.id, entry: Object.assign({}, e, { amount: 12500 }) }).ok);
  assert.strictEqual(rowOf(e.id)[C.EDITBY], 'BUDI');
});
req('R31', 'moving an entry to another date/month updates both month tabs', () => {
  const prev = addDays_(ym + '-01', -1);
  const e = add(W, { name: 'PINDAH BULAN', amount: 31000 }).entry;
  const r = call({ action: 'update', token: W, id: e.id, entry: Object.assign({}, e, { date: prev }) });
  assert.ok(r.ok, r.error);
  assert.ok(!JSON.stringify(tab(ym).dump()).includes('PINDAH BULAN'));
  assert.ok(JSON.stringify(tab(prev.slice(0, 7)).dump()).includes('PINDAH BULAN'));
});
req('R32', 'delete needs a reason; the row is kept as DIHAPUS, logged, and leaves the totals', () => {
  const e = add(W, { name: 'BOLU KERING', amount: 20000 }).entry;
  const totalBefore = tab(ym).dump()[2][0];
  assert.strictEqual(call({ action: 'remove', token: W, id: e.id }).error, 'Pilih alasan hapus.');
  assert.ok(call({ action: 'remove', token: W, id: e.id, reason: 'Tercatat dua kali' }).ok);
  const row = rowOf(e.id);
  assert.deepStrictEqual([row[C.STATUS], row[C.EDITBY]], ['DIHAPUS', 'ANI']);
  assert.ok(logs().some(l => l[2] === 'Hapus' && /Tercatat dua kali/.test(l[5])));
  assert.strictEqual(tab(ym).dump()[2][0], totalBefore - 20000);
  assert.ok(!call({ action: 'list', token: W, month: ym }).entries.some(x => x.id === e.id));
  assert.strictEqual(call({ action: 'update', token: W, id: e.id, entry: Object.assign({}, e, { amount: 1 }) }).error, 'Transaksi ini sudah dihapus.');
});

// ─────────────── Ibu editing the Sheet by hand ───────────────
const ibu = { getEmail: () => 'ibu@example.com' };
req('R33', 'fixing a cell in Data: the month tab follows and the Log says who did it ("Ubah manual")', () => {
  const e = add(W, { name: 'KACANG GARUDA', amount: 88000 }).entry;
  const r = rowNo(e.id);
  sh('Data').getRange(r, C.AMT + 1).setValue(89000);
  onDataEdit({ range: sh('Data').getRange(r, C.AMT + 1), user: ibu });
  const sup = tab(ym).dump().find(x => x[1] === 'KACANG GARUDA');
  assert.strictEqual(sup[3], 89000);
  assert.ok(logs().some(l => l[2] === 'Ubah manual' && l[1] === 'ibu@example.com'));
});
req('R34', 'adding a row by hand: ID, MANUAL, time and status filled in; typed text dates and amounts become real ones', () => {
  const r = sh('Data').getLastRow() + 1;
  const dd = today.slice(8, 10) + '/' + today.slice(5, 7) + '/' + today.slice(2, 4);
  sh('Data').getRange(r, 1, 1, 5).setValues([[dd, 'MANUAL TEH', '', 'Rp 45.500', 'Modal']]);
  onDataEdit({ range: sh('Data').getRange(r, 1, 1, 5), user: ibu });
  const row = sh('Data').dump()[r - 1];
  assert.ok(row[C.DATE] instanceof Date && fmtDate_(row[C.DATE]) === today, 'date');
  assert.strictEqual(row[C.AMT], 45500, 'amount');
  assert.strictEqual(row[C.BY], 'MANUAL');
  assert.ok(row[C.AT] instanceof Date);
  assert.strictEqual(row[C.STATUS], 'AKTIF');
  assert.match(String(row[C.ID]), /^[A-Za-z0-9_-]{8,64}$/);
  assert.ok(JSON.stringify(tab(ym).dump()).includes('MANUAL TEH'));
});
req('R35', 'shorthand like "50rb" stays as typed (visibly wrong) instead of becoming a believable wrong number', () => {
  const r = sh('Data').getLastRow() + 1;
  sh('Data').getRange(r, 1, 1, 5).setValues([[toDate_(today), 'MANUAL SINGKAT', '', '50rb', 'Modal']]);
  onDataEdit({ range: sh('Data').getRange(r, 1, 1, 5), user: ibu });
  assert.strictEqual(sh('Data').dump()[r - 1][C.AMT], '50rb');
});
req('R36', 'copying a row: the copy gets its own ID, the original keeps its own', () => {
  const e = add(W, { name: 'SALIN BARIS', amount: 61000 }).entry;
  const src = sh('Data').dump()[rowNo(e.id) - 1];
  const r = sh('Data').getLastRow() + 1;
  sh('Data').getRange(r, 1, 1, 12).setValues([src.slice(0, 12)]);
  onDataEdit({ range: sh('Data').getRange(r, 1, 1, 12), user: ibu });
  const copies = data().filter(x => x[C.NAME] === 'SALIN BARIS');
  assert.strictEqual(copies.length, 2);
  assert.notStrictEqual(copies[0][C.ID], copies[1][C.ID]);
  assert.ok(copies.some(x => x[C.ID] === e.id), 'original keeps its ID');
});
req('R37', 'typing DIHAPUS in Status by hand takes it out of the totals', () => {
  const e = add(W, { name: 'HAPUS MANUAL', amount: 70000 }).entry;
  const before = tab(ym).dump()[2][0];
  const r = rowNo(e.id);
  sh('Data').getRange(r, C.STATUS + 1).setValue('DIHAPUS');
  onDataEdit({ range: sh('Data').getRange(r, C.STATUS + 1), user: ibu });
  assert.strictEqual(tab(ym).dump()[2][0], before - 70000);
});
req('R38', '"Perbarui semua tab" rebuilds every month tab from Data', () => {
  const t = tab(ym); const keep = t.dump()[2][0];
  t.getRange(3, 1).setValue(1);   // someone typed over the total
  refreshAll();
  assert.strictEqual(tab(ym).dump()[2][0], keep);
});

// ─────────────── security ───────────────
req('R39', 'text that looks like a formula is stored as plain text', () => {
  const e = add(W, { name: 'AMAN', amount: 1201, note: '=HYPERLINK("http://x")' }).entry;
  assert.strictEqual(rowOf(e.id)[C.NOTE], '\'=HYPERLINK("http://x")');
  const s = add(W, { name: '=SUM(A1)', amount: 1202 });
  assert.ok(!/^[=+\-@]/.test(s.entry.name));
});
req('R40', 'every request is checked by the server: no login → refused; unknown action, bad JSON, huge body → refused', () => {
  assert.strictEqual(call({ action: 'add', entry: { id: nid(), date: today, name: 'X', amount: 1, paidFrom: 'Modal' } }).code, 'AUTH');
  assert.strictEqual(call({ action: 'add', token: 'f'.repeat(64), entry: {} }).code, 'AUTH');
  assert.strictEqual(call({ action: 'hapusSemua', token: W }).error, 'Aksi tidak dikenal.');
  assert.strictEqual(post('{bukan json').error, 'Permintaan tidak valid.');
  assert.strictEqual(post('[1,2]').error, 'Permintaan tidak valid.');
  assert.strictEqual(post(JSON.stringify({ action: 'ping', pad: 'x'.repeat(21000) })).error, 'Permintaan terlalu besar.');
  assert.strictEqual(call({ action: 'add', token: W, entry: { id: 'pendek', date: today, name: 'X', amount: 1, paidFrom: 'Modal' } }).error, 'ID transaksi tidak valid.');
});
req('R41', 'at most 20 saves per minute per login', () => {
  env.cache.clear();
  const tok = login('Hadi', W_PW).token;
  let ok = 0, last;
  for (let i = 0; i < 22; i++) { last = post({ action: 'add', token: tok, entry: { id: nid(), date: today, name: 'CEPAT', amount: 2000 + i, paidFrom: 'Modal' } }); if (last.ok) ok++; }
  assert.strictEqual(ok, 20);
  assert.match(last.error, /Terlalu cepat/);
});
req('R42', 'server errors never leak details', () => {
  const orig = globalThis.boot_;
  globalThis.boot_ = () => { throw new Error('secret stack detail'); };
  const ce = console.error; console.error = () => {};
  try { const r = call({ action: 'boot', token: W }); assert.strictEqual(r.error, 'Terjadi kesalahan di server. Coba lagi.'); }
  finally { globalThis.boot_ = orig; console.error = ce; }
});
req('R43', 'everything is in the Log: additions, changes, deletions, logins, failed logins, hand edits', () => {
  const acts = new Set(logs().map(l => l[2]));
  for (const a of ['Tambah', 'Ubah', 'Hapus', 'Masuk', 'Masuk (admin)', 'Gagal masuk', 'Ubah manual']) assert.ok(acts.has(a), a);
});

console.log(`\n${passed} requirement checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
