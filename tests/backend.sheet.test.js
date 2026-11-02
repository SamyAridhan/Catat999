// Ibu editing the Sheet by hand, month-tab rebuilding and the small helpers around them — pinned down precisely.
// (Written from the mutation-testing survivors: each test fails if the matching rule is changed.)
// Usage: TZ=Asia/Jakarta node tests/backend.sheet.test.js
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
setup(); setPassword_('worker', 'tokoSembilan9'); setPassword_('admin', 'ibuBatam2026!');
const call = r => { env.cache.clear(); return handle_(r); };
const W = call({ action: 'login', name: 'Ani', password: 'tokoSembilan9', device: 'w' }).token;
const A = call({ action: 'login', name: 'Ibu', password: 'ibuBatam2026!', device: 'a' }).token;
const today = todayStr_(), ym = today.slice(0, 7);
const prevYm = addDays_(ym + '-01', -1).slice(0, 7), prevDay = prevYm + '-15';
const tabName = m => BULAN[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
const tab = m => env.ss.getSheetByName(tabName(m));
const data = () => env.ss.getSheetByName('Data');
const logs = () => env.ss.getSheetByName('Log').dump().slice(1).filter(r => r.some(v => v !== ''));
let n = 0; const id = () => 'sh' + String(++n).padStart(8, '0');
const add = (o, tok = W) => { const e = Object.assign({ id: id(), date: today, name: 'ROKOK', amount: 1000 + n, paidFrom: 'Modal' }, o); const r = call({ action: 'add', token: tok, entry: e }); assert.ok(r.ok, r.error); return e; };
const rowNo = eid => data().dump().findIndex(r => r[C.ID] === eid) + 1;
const spy = (name, fn) => { const orig = globalThis[name]; const calls = []; globalThis[name] = function () { calls.push([].slice.call(arguments)); return orig.apply(this, arguments); }; try { fn(); } finally { globalThis[name] = orig; } return calls; };

test('onDataEdit ignores: no event, no range, other tabs, the header row, blank rows', () => {
  const before = logs().length;
  onDataEdit(); onDataEdit(null); onDataEdit({});
  onDataEdit({ range: env.ss.getSheetByName('Supplier').getRange(2, 1) });
  onDataEdit({ range: data().getRange(1, 1) });
  const blank = data().getLastRow() + 3;
  onDataEdit({ range: data().getRange(blank, 1, 2, 12) });
  assert.strictEqual(logs().length, before, 'nothing logged');
});

test('several new rows pasted at once: each gets its own ID in its own row', () => {
  const sh = data(), start = sh.getLastRow() + 1;
  sh.cells[start - 1] = [toDate_(today), 'galon', '', 5000, 'Modal', '', '', '', '', '', '', ''];
  sh.cells[start] = [toDate_(today), 'sari roti', '', 6000, 'Uang Kasir', '', '', '', '', '', '', ''];
  onDataEdit({ range: sh.getRange(start, 1, 2, 7) });
  const a = sh.dump()[start - 1], b = sh.dump()[start];
  assert.ok(/^m[0-9a-f]{15}$/.test(a[C.ID]) && /^m[0-9a-f]{15}$/.test(b[C.ID]) && a[C.ID] !== b[C.ID]);
  assert.deepStrictEqual([a[C.NAME], b[C.NAME]], ['GALON', 'SARI ROTI'], 'names cleaned in their own rows');
  assert.deepStrictEqual([a[C.BY], b[C.BY], a[C.STATUS]], ['MANUAL', 'MANUAL', 'AKTIF']);
  assert.ok(a[C.AT] instanceof Date);
  assert.ok(logs().slice(-2).every(l => l[2] === 'Tambah manual' && l[5] === 'Ditambah langsung di sheet'));
});

test('manual row: an already-clean name is not rewritten; who/when/status typed by Ibu are kept', () => {
  const sh = data(), r = sh.getLastRow() + 1, when = new Date(Date.now() - 86400e3);
  sh.cells[r - 1] = [toDate_(today), 'ROKOK', '', 7000, 'Modal', 'IBU', 'x', when, '', '', 'AKTIF', ''];
  const w = sh.writes.length;
  onDataEdit({ range: sh.getRange(r, 1, 1, 12) });
  const cols = sh.writes.slice(w).filter(x => x[0] === r).map(x => x[1]);
  assert.ok(!cols.includes(C.NAME + 1), 'name untouched'); assert.ok(!cols.includes(C.NOTE + 1), 'note untouched');
  assert.strictEqual(sh.dump()[r - 1][C.BY], 'IBU'); assert.strictEqual(sh.dump()[r - 1][C.AT], when);
});

test('who edited: Google account email, or SHEET when unknown / when asking fails', () => {
  const e = add({ amount: 11111 }), r = rowNo(e.id), sh = data();
  onDataEdit({ range: sh.getRange(r, C.NOTE + 1), oldValue: undefined, value: 'cek', user: { getEmail: () => 'ibu@x.id' } });
  assert.deepStrictEqual(logs().slice(-1)[0].slice(1, 3), ['ibu@x.id', 'Ubah manual']);
  assert.strictEqual(logs().slice(-1)[0][5], 'Catatan: → cek', 'missing old value shown empty');
  assert.strictEqual(logs().slice(-1)[0][6], 'Google Sheets');
  onDataEdit({ range: sh.getRange(r, C.NOTE + 1), oldValue: 'cek', user: { getEmail: () => { throw new Error('no permission'); } } });
  assert.deepStrictEqual(logs().slice(-1)[0].slice(1, 3), ['SHEET', 'Ubah manual']);
  assert.strictEqual(logs().slice(-1)[0][5], 'Catatan: cek →', 'missing new value shown empty');
  onDataEdit({ range: sh.getRange(r, C.NOTE + 1), oldValue: 'a', value: 'b', user: {} });
  assert.strictEqual(logs().slice(-1)[0][1], 'SHEET');
  onDataEdit({ range: sh.getRange(r, 1, 1, 2) });
  assert.strictEqual(logs().slice(-1)[0][5], 'Beberapa sel diubah');
  onDataEdit({ range: sh.getRange(r, 1, 2, 1) });
  assert.strictEqual(logs().slice(-1)[0][5], 'Beberapa sel diubah');
});

test('an existing row with correct values is not written back at all', () => {
  const e = add({ amount: 12121 }), r = rowNo(e.id), sh = data(), w = sh.writes.length;
  onDataEdit({ range: sh.getRange(r, C.NOTE + 1), oldValue: '', value: '' });
  assert.strictEqual(sh.writes.slice(w).filter(x => x[0] === r).length, 0);
});

test('moving a date to another month by hand rebuilds BOTH months', () => {
  const e = add({ date: prevDay, amount: 2222 }, A), r = rowNo(e.id), sh = data();
  assert.ok(tab(prevYm).dump()[2][0] >= 2222);
  const prevTotal = tab(prevYm).dump()[2][0], curTotal = tab(ym).dump()[2][0];
  sh.cells[r - 1][C.DATE] = toDate_(today);
  onDataEdit({ range: sh.getRange(r, C.DATE + 1), oldValue: prevDay, value: today });
  assert.strictEqual(tab(prevYm).dump()[2][0], prevTotal - 2222, 'old month total drops');
  assert.strictEqual(tab(ym).dump()[2][0], curTotal + 2222, 'new month total grows');
  // old value typed dd/mm/yyyy also understood; an edit outside the date column does not touch other months
  const calls = spy('buildMonth_', () => onDataEdit({ range: sh.getRange(r, C.AMT + 1), oldValue: '15/' + prevYm.slice(5) + '/' + prevYm.slice(0, 4), value: 1 }));
  assert.deepStrictEqual(calls.map(c => c[0]), [ym]);
  const calls2 = spy('buildMonth_', () => onDataEdit({ range: sh.getRange(r, C.DATE + 1), oldValue: '15/' + prevYm.slice(5) + '/' + prevYm.slice(0, 4), value: today }));
  assert.deepStrictEqual(calls2.map(c => c[0]).sort(), [prevYm, ym].sort());
  const calls3 = spy('buildMonth_', () => onDataEdit({ range: sh.getRange(r, C.DATE + 1), oldValue: 'bukan tanggal', value: today }));
  assert.deepStrictEqual(calls3.map(c => c[0]), [ym]);
});

test('a pasted copy: BY=MANUAL, fresh time, "diubah" cleared; log says it was copied', () => {
  const e = add({ amount: 3333 }), sh = data(), src = rowNo(e.id);
  call({ action: 'update', token: W, id: e.id, entry: Object.assign({}, e, { amount: 3334 }) });
  const at = sh.getLastRow() + 1, copy = sh.dump()[src - 1].slice();
  copy[C.AT] = new Date(2020, 0, 1); sh.cells[at - 1] = copy;
  onDataEdit({ range: sh.getRange(at, 1, 1, 12) });
  const c = sh.dump()[at - 1];
  assert.strictEqual(c[C.BY], 'MANUAL'); assert.ok(Date.now() - c[C.AT].getTime() < 60000);
  assert.strictEqual(c[C.EDITBY], ''); assert.strictEqual(c[C.EDITAT], '');
  assert.strictEqual(logs().slice(-1)[0][5], 'Baris disalin di sheet (ID baru)');
  assert.strictEqual(sh.dump()[src - 1][C.EDITBY], 'ANI', 'original untouched');
  // two identical rows pasted together (both new): first keeps nothing to collide with, second gets another ID
  const at2 = sh.getLastRow() + 1, twin = sh.dump()[at - 1].slice();
  sh.cells[at2 - 1] = twin.slice(); sh.cells[at2] = twin.slice();
  sh.cells[at - 1][C.ID] = 'zz' + sh.cells[at - 1][C.ID];                     // pretend the first copy had a different id
  onDataEdit({ range: sh.getRange(at2, 1, 2, 12) });
  assert.notStrictEqual(sh.dump()[at2 - 1][C.ID], sh.dump()[at2][C.ID], 'twins inside one paste get different IDs');
});

test('typed text date/amount in an existing row are fixed in place (date and amount cells only)', () => {
  const e = add({ amount: 4444 }), r = rowNo(e.id), sh = data();
  sh.cells[r - 1][C.DATE] = today.slice(8) + '/' + today.slice(5, 7) + '/' + today.slice(0, 4);
  sh.cells[r - 1][C.AMT] = 'Rp 4.445';
  const w = sh.writes.length;
  onDataEdit({ range: sh.getRange(r, C.AMT + 1), oldValue: 4444, value: 'Rp 4.445' });
  assert.ok(sh.dump()[r - 1][C.DATE] instanceof Date); assert.strictEqual(sh.dump()[r - 1][C.AMT], 4445);
  assert.deepStrictEqual(sh.writes.slice(w).filter(x => x[0] === r).map(x => x[1]).sort(), [C.DATE + 1, C.AMT + 1].sort());
});

test('normalizeTypedRow_ reports exactly whether it changed something', () => {
  const r = []; r[C.DATE] = new Date(); r[C.AMT] = 5;
  assert.strictEqual(normalizeTypedRow_(r), false);
  r[C.DATE] = ''; r[C.AMT] = '0'; assert.strictEqual(normalizeTypedRow_(r), false); assert.strictEqual(r[C.AMT], '0');
  r[C.DATE] = 'kemarin'; r[C.AMT] = 'x'; assert.strictEqual(normalizeTypedRow_(r), false); assert.strictEqual(r[C.DATE], 'kemarin');
  r[C.DATE] = '2/11/2026'; assert.strictEqual(normalizeTypedRow_(r), true); assert.ok(r[C.DATE] instanceof Date);
  r[C.DATE] = new Date(); r[C.AMT] = '1.000'; assert.strictEqual(normalizeTypedRow_(r), true); assert.strictEqual(r[C.AMT], 1000);
});

test('parseLooseDate_ / fmtDate_: accepted forms and refusals', () => {
  const t = {
    '2026-11-02': '2026-11-02', '2026-11-02T10:00:00': '2026-11-02', ' 3/11/26 ': '2026-11-03', '3.11.2026': '2026-11-03', '03-11-2026': '2026-11-03',
    '1/1/99': '2099-01-01', '3/11/123': '', 'x3/11/2026': '', '3/11/2026x': '', '31/04/2026': '', '29/02/2025': '', '29/02/2024': '2024-02-29',
    '2026-02-31': '', '2026-13-01': '', '': '', 'abc': ''
  };
  for (const k in t) assert.strictEqual(parseLooseDate_(k), t[k], k);
  assert.strictEqual(parseLooseDate_(20261102), '');
  assert.strictEqual(fmtDate_(new Date(2026, 10, 2, 12)), '2026-11-02');
  assert.strictEqual(fmtDate_(new Date('x')), '');
  assert.strictEqual(fmtDate_('2/11/2026'), '2026-11-02');
  assert.strictEqual(fmtDate_(null), '');
});

test('month tab: same day sorted by time recorded; days in order; unknown pay sources count as Lainnya', () => {
  const m = '2025-12', admin = { name: 'IBU', role: 'ADMIN' };
  const sh = data(), base = sh.getLastRow() + 1;
  const mk = (d, at, amt, from) => [toDate_(m + '-' + d), 'X', '', amt, from, 'IBU', '', new Date(2026, 0, 1, at), '', '', 'AKTIF', id()];
  sh.cells[base - 1] = mk('10', 9, 100, 'Modal'); sh.cells[base] = mk('10', 8, 200, 'Cash'); sh.cells[base + 1] = mk('03', 10, 300, 'Lainnya: BUDI');
  refreshViews_([m]);
  const v = tab(m).dump();
  assert.deepStrictEqual(v[2].slice(0, 6), [600, 0, 0, 100, 500, 3], 'Cash and Lainnya: BUDI both under Lainnya');
  const entries = v.slice(5).filter(r => r[0] instanceof Date).map(r => r[3]);
  assert.deepStrictEqual(entries, [300, 200, 100], 'by date, then earlier recorded first');
  void admin;
});

test('refreshViews_: bad month keys ignored, each month built once', () => {
  const calls = spy('buildMonth_', () => refreshViews_([ym, ym, '2026-1', 'x', null, undefined, '2026-111', prevYm]));
  assert.deepStrictEqual(calls.map(c => c[0]), [ym, prevYm]);
  assert.strictEqual(spy('buildMonth_', () => refreshViews_()).length, 0);
});

test('refreshAll rebuilds every month with data AND existing month tabs that are now empty', () => {
  const lonely = '2024-06';
  env.ss.insertSheet(tabName(lonely)).getRange(1, 1).setValue('999 MART — JUNI 2024');
  const calls = spy('buildMonth_', () => refreshAll());
  const months = calls.map(c => c[0]);
  assert.ok(months.includes(lonely) && months.includes(ym) && months.includes(prevYm));
  assert.deepStrictEqual(months, months.slice().sort(), 'oldest first');
  assert.strictEqual(tab(lonely).dump()[2][0], 0, 'empty month shows zero');
});

test('no tab is created for a month without transactions; an empty existing tab is kept', () => {
  refreshViews_(['2023-01']);
  assert.strictEqual(tab('2023-01'), null);
});

test('foreign tab moved aside as "(lama)", then "(lama 2)" for the next one; log explains it', () => {
  const m = '2025-11', name = tabName(m);
  add({ date: m + '-20', amount: 999 }, A);
  for (const k of [1, 2]) {
    env.ss.deleteSheet(tab(m));
    env.ss.insertSheet(name).getRange(1, 1).setValue('punya Ibu ' + k);
    refreshViews_([m]);
  }
  assert.strictEqual(env.ss.getSheetByName(name + ' (lama)').getRange(1, 1).getValue(), 'punya Ibu 1');
  assert.strictEqual(env.ss.getSheetByName(name + ' (lama 2)').getRange(1, 1).getValue(), 'punya Ibu 2');
  const l = logs().filter(x => x[2] === 'Tab dipindah').slice(-1)[0];
  assert.deepStrictEqual([l[1], l[5]], ['SISTEM', 'Tab "' + name + '" bukan buatan aplikasi, diganti nama jadi "' + name + ' (lama 2)"']);
  // an EMPTY tab with that name is simply used
  env.ss.deleteSheet(tab(m)); env.ss.insertSheet(name);
  refreshViews_([m]);
  assert.ok(String(tab(m).getRange(1, 1).getValue()).startsWith('999 MART'));
  assert.strictEqual(env.ss.getSheetByName(name + ' (lama 3)'), null);
});

test('onDataChange: only row inserts/deletes/other changes rebuild everything', () => {
  for (const [t, want] of [['REMOVE_ROW', 1], ['INSERT_ROW', 1], ['OTHER', 1], ['EDIT', 0], ['FORMAT', 0], ['INSERT_COLUMN', 0], [undefined, 0]])
    assert.strictEqual(spy('refreshAll', () => onDataChange({ changeType: t })).length, want, String(t));
  assert.strictEqual(spy('refreshAll', () => onDataChange()).length, 0);
});

test('ensureRows_: adds at least 500 rows only when needed', () => {
  const s = env.ss.insertSheet('tmp-rows'); const max = s.getMaxRows();
  ensureRows_(s, max); assert.strictEqual(s.getMaxRows(), max, 'exactly the last row: nothing added');
  ensureRows_(s, max + 1); assert.strictEqual(s.getMaxRows(), max + 500);
  ensureRows_(s, s.getMaxRows() + 900); assert.strictEqual(s.getMaxRows(), max + 500 + 900);
  env.ss.deleteSheet(s);
});

test('readTable_: skips blank rows (null or empty), empty sheet gives []', () => {
  const s = env.ss.insertSheet('tmp-read');
  assert.deepStrictEqual(readTable_('tmp-read', 2), []);
  s.cells = [['h', 'h'], ['a', ''], [null, ''], ['', ''], ['', 'b'], [0, '']];
  assert.deepStrictEqual(readTable_('tmp-read', 2), [['a', ''], ['', 'b'], [0, '']]);
  env.ss.deleteSheet(s);
});

test('server busy (lock not available) → polite message, nothing written', () => {
  const real = LockService.getScriptLock;
  let released = 0;
  LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock: () => { released++; } });
  const before = data().getLastRow();
  const r = call({ action: 'add', token: W, entry: { id: id(), date: today, name: 'X', amount: 77, paidFrom: 'Modal' } });
  LockService.getScriptLock = real;
  assert.deepStrictEqual(r, { ok: false, error: 'Server sibuk, coba lagi sebentar.' });
  assert.strictEqual(data().getLastRow(), before);
  // and the lock is always released, even when the work throws
  LockService.getScriptLock = () => ({ tryLock: () => true, releaseLock: () => { released++; } });
  assert.throws(() => withLock_(() => { throw new Error('boom'); }));
  LockService.getScriptLock = real;
  assert.strictEqual(released, 1);
});

test('"hari ini" count: recorded today only (not yesterday, not deleted)', () => {
  const t = call({ action: 'login', name: 'Cnt', password: 'tokoSembilan9', device: 'c' }).token;
  const c0 = call({ action: 'boot', token: t }).todayCount;
  const e = add({ amount: 5656 });
  assert.strictEqual(call({ action: 'boot', token: t }).todayCount, c0 + 1);
  data().cells[rowNo(e.id) - 1][C.AT] = new Date(Date.now() - 86400e3 * 2);
  assert.strictEqual(call({ action: 'boot', token: t }).todayCount, c0);
});

console.log(`\n${passed} sheet tests passed${process.exitCode ? ', SOME FAILED' : ''}`);
