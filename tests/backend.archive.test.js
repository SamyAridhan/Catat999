// Moving old rows to the Arsip tab (keeps every save fast for years). Nothing may be lost, changed or doubled,
// month tabs and Riwayat must still show old months, and saves must not get slower as years pass.
// Usage: TZ=Asia/Jakarta node tests/backend.archive.test.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const { install } = require('./gas-mock');
const env = install(globalThis);
const dir = path.join(__dirname, '..', 'apps-script');
const codeFile = process.env.CODE_FILE ? path.resolve(__dirname, process.env.CODE_FILE) : path.join(dir, 'Code.gs');
vm.runInThisContext(fs.readFileSync(path.join(dir, 'Seed.gs'), 'utf8') + '\n' + fs.readFileSync(codeFile, 'utf8'), { filename: 'Code.gs' });

let passed = 0;
function test(name, fn) { env.cache.clear(); try { fn(); passed++; console.log('  ✓', name); } catch (e) { console.log('  ✗', name); console.log(String(e.stack).split('\n').slice(0, 6).join('\n')); process.exitCode = 1; } }
setup(); setPassword_('worker', 'tokoSembilan9'); setPassword_('admin', 'ibuBatam2026!');
const call = r => { env.cache.clear(); return handle_(r); };
const W = call({ action: 'login', name: 'Ani', password: 'tokoSembilan9', device: 'w' }).token;
const A = call({ action: 'login', name: 'Ibu', password: 'ibuBatam2026!', device: 'a' }).token;
const today = todayStr_(), ym = today.slice(0, 7);
const D = () => env.ss.getSheetByName('Data'), ARC = () => env.ss.getSheetByName('Arsip');
const rows = sh => sh ? sh.dump().slice(1).filter(r => r.some(v => v !== '')) : [];
const tabName = m => BULAN[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
const monthsAgo = k => { let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - k; while (m < 1) { m += 12; y--; } return y + '-' + String(m).padStart(2, '0'); };
let n = 0;
function putRow(date, extra) {   // a row as years of use leave it (straight into Data, like the app or Ibu wrote it)
  const r = []; r[C.DATE] = toDate_(date); r[C.NAME] = 'ROKOK'; r[C.INV] = ''; r[C.AMT] = 1000 + (++n); r[C.FROM] = 'Modal'; r[C.BY] = 'ANI';
  r[C.NOTE] = ''; r[C.AT] = new Date(toDate_(date).getTime() + 3600e3); r[C.EDITBY] = ''; r[C.EDITAT] = ''; r[C.STATUS] = 'AKTIF'; r[C.ID] = 'a' + String(n).padStart(9, '0');
  Object.assign(r, extra || {});
  const at = D().getLastRow() + 1; if (at > D().getMaxRows()) D().insertRowsAfter(D().getMaxRows(), 500);
  D().getRange(at, 1, 1, 12).setValues([r]); return r;
}
// 20 months of data, appended out of order (back-dated entries and hand-added rows happen any time)
const all = [];
for (let k = 19; k >= 0; k--) for (let i = 1; i <= 6; i++) all.push(putRow(monthsAgo(k) + '-' + String(i * 4).padStart(2, '0')));
all.push(putRow(monthsAgo(17) + '-09', { [C.NAME]: "'=JANGAN RUMUS", [C.NOTE]: "'@catatan aneh", [C.BY]: 'MANUAL' }));   // text that must stay text
all.push(putRow(monthsAgo(16) + '-10', { [C.STATUS]: 'DIHAPUS' }));
all.push(putRow(monthsAgo(1) + '-02'));   // recent, written late
refreshAll();
const byId = rs => Object.fromEntries(rs.map(r => [r[C.ID], JSON.stringify(r.map(v => v instanceof Date ? v.getTime() : v))]));
const before = byId(all);
const cutoff = archiveCutoff_();
const oldMonth = monthsAgo(17);
const tabBefore = JSON.stringify(env.ss.getSheetByName(tabName(oldMonth)).dump());
const listBefore = call({ action: 'list', token: A, month: oldMonth });
let res;

test('cutoff: keeps this month and the 14 before it; everything older is beyond every edit and back-date limit', () => {
  assert.strictEqual(cutoff, monthsAgo(14) + '-01');
  assert.ok(addDays_(today, -LIMIT.adminBackDays) >= cutoff, 'Ibu can never date or change anything in Arsip from the app');
});
test('archive: moves exactly the rows dated before the cutoff, nothing lost, changed or doubled', () => {
  res = archiveOld();
  assert.ok(res.ok);
  const old = all.filter(r => fmtDate_(r[C.DATE]) < cutoff);
  assert.strictEqual(res.moved, old.length);
  const d = rows(D()), a = rows(ARC());
  assert.ok(d.every(r => fmtDate_(r[C.DATE]) >= cutoff), 'Data keeps only recent rows');
  assert.ok(a.every(r => fmtDate_(r[C.DATE]) < cutoff), 'Arsip has only old rows');
  assert.strictEqual(d.length + a.length, all.length);
  assert.deepStrictEqual(byId(d.concat(a)), before, 'every row identical, text that looks like a formula still text');
});
test('archive: Arsip hides the ID column and warns before hand edits', () => {
  assert.deepStrictEqual(ARC().hiddenCols, [12]);
  assert.ok(ARC().protections.some(p => /Perbarui semua tab/.test(p.desc || '')));
});
test('archive: logged, and running it again moves nothing', () => {
  assert.ok(rows(env.ss.getSheetByName('Log')).some(l => l[2] === 'Arsip' && new RegExp(res.moved + ' transaksi').test(l[5])));
  assert.deepStrictEqual(archiveOld(), { ok: true, moved: 0 });
});
test('old month tabs are untouched by the move, and "Perbarui semua tab" rebuilds them from Arsip', () => {
  const strip = s => s.replace(/Diperbarui [0-9/: ]+\./, '');
  assert.strictEqual(strip(JSON.stringify(env.ss.getSheetByName(tabName(oldMonth)).dump())), strip(tabBefore));
  refreshAll();
  assert.strictEqual(strip(JSON.stringify(env.ss.getSheetByName(tabName(oldMonth)).dump())), strip(tabBefore));
});
test('Riwayat still shows archived months (same entries and total), marked archived and not editable', () => {
  const l = call({ action: 'list', token: A, month: oldMonth });
  assert.strictEqual(l.total, listBefore.total);
  assert.deepStrictEqual(l.entries.map(e => e.id).sort(), listBefore.entries.map(e => e.id).sort());
  assert.ok(l.entries.every(e => e.archived === true && e.canEdit === false));
  assert.strictEqual(call({ action: 'list', token: A, month: ym }).entries.some(e => e.archived), false);
});
test('Ibu hand-adds an old row in Data: its month tab includes the archived rows too', () => {
  const r = D().getLastRow() + 1;
  D().getRange(r, 1, 1, 5).setValues([[toDate_(oldMonth + '-20'), 'TAMBAH LAMA', '', 5000, 'Modal']]);
  onDataEdit({ range: D().getRange(r, 1, 1, 5), user: { getEmail: () => 'ibu@x' } });
  const tab = env.ss.getSheetByName(tabName(oldMonth)).dump();
  assert.strictEqual(tab[2][0], listBefore.total + 5000, 'month total = archived rows + the new one');
  assert.ok(JSON.stringify(tab).includes('TAMBAH LAMA'));
  const l = call({ action: 'list', token: A, month: oldMonth });
  assert.strictEqual(l.total, listBefore.total + 5000, 'Riwayat shows both');
});
test('saving after the move: duplicates still caught, month tab right', () => {
  const e = { id: 'arcsave0001', date: today, name: 'SARI ROTI', invoice: 'Q77', amount: 50000, paidFrom: 'Modal' };
  assert.ok(call({ action: 'add', token: W, entry: e }).ok);
  assert.strictEqual(call({ action: 'add', token: W, entry: Object.assign({}, e, { id: 'arcsave0002' }) }).code, 'DUP_INVOICE');
  const live = rows(D()).filter(r => fmtDate_(r[C.DATE]).slice(0, 7) === ym && r[C.STATUS] !== 'DIHAPUS');
  assert.strictEqual(env.ss.getSheetByName(tabName(ym)).dump()[2][0], live.reduce((s, r) => s + r[C.AMT], 0));
});
test('a monthly trigger runs it, and Ibu can run it from the menu', () => {
  assert.ok(env.triggers.includes('archiveOld'));
  onOpen(); assert.ok(JSON.stringify(env.ui.menus).includes('Pindahkan data lama ke Arsip'));
  menuArchive(); assert.match(env.ui.alerts.slice(-1)[0], /Belum ada data lama|dipindah/);
});
test('speed: with the monthly move, a save reads about the same at 5 years as at 1 year', () => {
  const save = () => { const b = env.stats.cellsRead; call({ action: 'add', token: W, entry: { id: 'spd' + (++n) + 'xxxxxx', date: today, name: 'TISU', amount: 7000 + n, paidFrom: 'Modal' } }); return env.stats.cellsRead - b; };
  const one = save();
  for (let k = 0; k < 48; k++) for (let i = 0; i < 30; i++) putRow(monthsAgo(k + 20) + '-' + String((i % 27) + 1).padStart(2, '0'));   // 4 more years, older
  archiveOld();
  const five = save();
  assert.ok(five < one * 1.2, `cells read per save: ${one} → ${five}`);
});
console.log(`\n${passed} archive tests passed`);
