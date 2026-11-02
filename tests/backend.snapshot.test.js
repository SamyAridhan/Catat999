// Golden-snapshot test: runs one long, fixed "day in the life" scenario against the real Code.gs with a frozen
// clock and fixed random IDs, then compares EVERYTHING it produced — every API answer and message, every cell,
// number format, colour, column width, frozen row, protection, menu item, log line and stored setting — with the
// approved snapshot in tests/snapshots/backend-scenario.json. Any unintended change shows up as a diff.
//
// Usage: TZ=Asia/Jakarta node tests/backend.snapshot.test.js
//        UPDATE_SNAPSHOT=1 … to approve a deliberate change (then review the diff in git before committing)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { install } = require('./gas-mock');

// ── frozen clock: Mon 2 Nov 2026, 10:00 WIB; the test moves it forward explicitly ──
const RealDate = Date;
let NOW = RealDate.UTC(2026, 10, 2, 3, 0, 0);
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
globalThis.Date = FakeDate;
const advance = ms => { NOW += ms; };
const HOUR = 3600e3, DAY = 24 * HOUR;

const env = install(globalThis);
let uuidN = 0;
Utilities.getUuid = () => { const h = (++uuidN).toString(16).padStart(32, '0'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const dir = path.join(__dirname, '..', 'apps-script');
const codeFile = process.env.CODE_FILE ? path.resolve(__dirname, process.env.CODE_FILE) : path.join(dir, 'Code.gs');
vm.runInThisContext(fs.readFileSync(path.join(dir, 'Seed.gs'), 'utf8') + '\n' + fs.readFileSync(codeFile, 'utf8'), { filename: 'Code.gs' });

const out = [];
const norm = v => JSON.parse(JSON.stringify(v, (k, x) => (x instanceof RealDate ? { date: x.toISOString() } : x === undefined ? '<undefined>' : x)));
const rec = (label, v) => out.push([label, norm(v)]);
const tryRec = (label, fn) => { try { rec(label, { returned: fn() }); } catch (e) { rec(label, { threw: e.message }); } };
const api = (label, req) => { const r = handle_(req); rec(label, r); return r; };
const post = (label, body) => { const r = JSON.parse(doPost({ postData: { contents: body } }).getContent()); rec(label, r); return r; };
const clearRate = () => env.cache.clear();

// ── 1. setup + menu ──
rec('doGet', JSON.parse(doGet().getContent()));
rec('setup', setup());
rec('setup again (idempotent)', setup());
onOpen();
rec('menu', env.ui.menus);
api('login before passwords set', { action: 'login', name: 'Ani', password: 'whatever1', device: 'HP-A' });

// passwords: every rule, via the code and via the Sheet menu
tryRec('password 7 chars', () => setPassword_('worker', 'abcdefg'));
tryRec('password leading space', () => setPassword_('worker', ' abcdefgh'));
tryRec('password trailing space', () => setPassword_('worker', 'abcdefgh '));
tryRec('password 8 chars ok', () => setPassword_('worker', 'abcdefgh'));
tryRec('admin same as worker', () => setPassword_('admin', 'abcdefgh'));
env.ui.answers.push(['OK', 'tokoSembilan9']); menuWorkerPassword();
env.ui.answers.push(['OK', 'pendek']); menuAdminPassword();
env.ui.answers.push(['CANCEL', 'ibuBatam2026!']); menuAdminPassword();
env.ui.answers.push(['OK', 'ibuBatam2026!']); menuAdminPassword();
rec('ui prompts + alerts', { prompts: env.ui.prompts, alerts: env.ui.alerts });
rec('stored properties', Object.fromEntries([...env.props.entries()].sort()));

// ── 2. login ──
api('login: 1-letter name', { action: 'login', name: 'A', password: 'tokoSembilan9', device: 'HP-A' });
api('login: digits in name', { action: 'login', name: 'Ani2', password: 'tokoSembilan9', device: 'HP-A' });
api('login: 31-letter name refused', { action: 'login', name: 'A'.repeat(31), password: 'x', device: 'HP-A' });
api('login: 30-letter name ok', { action: 'login', name: 'A'.repeat(30), password: 'tokoSembilan9', device: 'HP-30' });
api('login: empty password', { action: 'login', name: 'Ani', password: '', device: 'HP-A' });
api('login: 101-char password', { action: 'login', name: 'Ani', password: 'x'.repeat(101), device: 'HP-A' });
for (let i = 1; i <= 6; i++) api('login: wrong password #' + i, { action: 'login', name: 'Ani', password: 'salah' + i, device: 'HP-LOCK' });
rec('sleeps after wrong passwords', env.stats.sleeps);
api('login: right password but device locked', { action: 'login', name: 'Ani', password: 'tokoSembilan9', device: 'HP-LOCK' });
clearRate();
const W = api('login: worker', { action: 'login', name: '  ani   putri ', password: 'tokoSembilan9', device: 'HP-A (Android 10; SM-A105)' }).token;
const A = api('login: admin', { action: 'login', name: 'Ibu', password: 'ibuBatam2026!', device: 'Laptop' }).token;
for (let i = 1; i <= 30; i++) handle_({ action: 'login', name: 'Bot', password: 'nope' + i, device: 'bot-' + i });
const sl = env.stats.sleeps;
api('login: after 30 failures from strangers a real worker still gets in', { action: 'login', name: 'Ani', password: 'tokoSembilan9', device: 'HP-NEW' });
rec('…but slowed down (extra sleeps)', env.stats.sleeps - sl);
env.cache.set('lf_all', '300');
api('login: hard stop at 300 failures', { action: 'login', name: 'Ani', password: 'tokoSembilan9', device: 'HP-NEW2' });
clearRate();

// ── 3. requests that must be refused ──
post('doPost: malformed JSON', '{oops');
post('doPost: array', '[1,2]');
post('doPost: null', 'null');
post('doPost: empty body', '');
const sized = n => JSON.stringify({ action: 'ping', pad: 'x'.repeat(n - 26) });
assert.strictEqual(sized(LIMIT.maxBody).length, LIMIT.maxBody);
post('doPost: exactly max size', sized(LIMIT.maxBody));
post('doPost: one over max size', sized(LIMIT.maxBody + 1));
api('unknown action', { action: 'dropTables', token: W });
api('missing token', { action: 'boot' });
api('forged token', { action: 'boot', token: 'f'.repeat(64) });
api('token wrong shape', { action: 'boot', token: 'abc' });

// ── 4. boot + adds ──
api('boot: worker', { action: 'boot', token: W });
api('boot: admin limits', { action: 'boot', token: A });
const add = (label, entry, token = W, force = false) => { clearRate(); return api(label, { action: 'add', token, entry: Object.assign({ id: 'id-' + label.replace(/[^a-z0-9]/gi, '').slice(0, 30).padEnd(8, 'x') }, entry), force }); };
add('add: transfer with invoice', { date: '2026-11-02', name: 'pt yafindo mitra-permata', invoice: ' 0012 345', amount: '1776424', paidFrom: 'transfer ibu', note: 'retur 2 dus' });
advance(5 * 60e3);
add('add: cash, no invoice', { date: '2026-11-02', name: 'ROKOK', amount: 350000, paidFrom: 'Uang Kasir' });
advance(5 * 60e3);
add('add: Lainnya + new supplier', { date: '2026-11-01', name: 'Toko Kue Mama Lina', amount: 125000, paidFrom: 'lainnya : bujang', note: '=HYPERLINK("http://x")' });
add('add: modal, previous month', { date: '2026-10-28', name: 'cv sumber cipta agung', invoice: 'INV/2210', amount: 2450000, paidFrom: 'Modal' });
add('add: same id again (offline resend)', { date: '2026-11-02', name: 'ROKOK', amount: 350000, paidFrom: 'Uang Kasir', id: 'id-addcashnoinvoice' });
add('dup: same invoice, leading zeros', { date: '2026-11-02', name: 'PT. YAFINDO MITRA PERMATA', invoice: '12345', amount: 1, paidFrom: 'Modal' });
add('dup: same invoice other supplier is fine', { date: '2026-11-02', name: 'PT. OMEGA SUKSES ABADI', invoice: '0012345', amount: 1000, paidFrom: 'Modal' });
add('dup: same name+date+amount, no invoice', { date: '2026-11-02', name: 'rokok', amount: 350000, paidFrom: 'Modal' });
add('dup: same name+amount, other date is fine', { date: '2026-11-01', name: 'ROKOK', amount: 350000, paidFrom: 'Modal' });
add('dup: forced', { date: '2026-11-02', name: 'ROKOK', amount: 350000, paidFrom: 'Modal' }, W, true);
// validation, every rule and boundary
add('bad: no name', { date: '2026-11-02', name: '  ', amount: 1, paidFrom: 'Modal' });
add('bad: name only symbols', { date: '2026-11-02', name: '=+-@', amount: 1, paidFrom: 'Modal' });
add('bad: invoice chars', { date: '2026-11-02', name: 'X', invoice: 'INV#1', amount: 1, paidFrom: 'Modal' });
add('bad: invoice 31 chars', { date: '2026-11-02', name: 'X', invoice: 'A'.repeat(31), amount: 1, paidFrom: 'Modal' });
add('ok: invoice 30 chars', { date: '2026-11-02', name: 'X', invoice: 'B'.repeat(30), amount: 2, paidFrom: 'Modal' });
add('bad: amount 0', { date: '2026-11-02', name: 'X', amount: 0, paidFrom: 'Modal' });
add('bad: amount negative', { date: '2026-11-02', name: 'X', amount: -5, paidFrom: 'Modal' });
add('bad: amount decimal', { date: '2026-11-02', name: 'X', amount: 10.5, paidFrom: 'Modal' });
add('bad: amount text', { date: '2026-11-02', name: 'X', amount: 'abc', paidFrom: 'Modal' });
add('ok: amount "Rp 1.500"', { date: '2026-11-02', name: 'X', amount: 'Rp 1.500', paidFrom: 'Modal' });
add('ok: amount at max', { date: '2026-11-02', name: 'X', amount: 500000000, paidFrom: 'Modal' }, A);
add('bad: amount over max', { date: '2026-11-02', name: 'X', amount: 500000001, paidFrom: 'Modal' });
add('bad: no pay source', { date: '2026-11-02', name: 'X', amount: 3, paidFrom: '' });
add('bad: unknown pay source', { date: '2026-11-02', name: 'X', amount: 3, paidFrom: 'Kartu Kredit' });
add('bad: Lainnya without name', { date: '2026-11-02', name: 'X', amount: 3, paidFrom: 'Lainnya:' });
add('bad: date tomorrow', { date: '2026-11-03', name: 'X', amount: 3, paidFrom: 'Modal' });
add('bad: date not a date', { date: '02/11/2026', name: 'X', amount: 3, paidFrom: 'Modal' });
add('bad: date impossible', { date: '2026-02-30', name: 'X', amount: 3, paidFrom: 'Modal' });
add('ok: worker 60 days back', { date: '2026-09-03', name: 'X', amount: 4, paidFrom: 'Modal' });
add('bad: worker 61 days back', { date: '2026-09-02', name: 'X', amount: 4, paidFrom: 'Modal' });
add('ok: admin 400 days back', { date: '2025-09-28', name: 'X', amount: 5, paidFrom: 'Modal' }, A);
add('bad: admin 401 days back', { date: '2025-09-27', name: 'X', amount: 5, paidFrom: 'Modal' }, A);
add('bad: id too short', { id: 'short', date: '2026-11-02', name: 'X', amount: 6, paidFrom: 'Modal' });
add('bad: id odd chars', { id: 'abc def gh', date: '2026-11-02', name: 'X', amount: 6, paidFrom: 'Modal' });
add('ok: long note trimmed to 200', { date: '2026-11-02', name: 'X', amount: 7, paidFrom: 'Modal', note: 'n'.repeat(250) });

// write rate limit: 20 per minute per session
clearRate();
const rl = [];
for (let i = 0; i < 21; i++) rl.push(handle_({ action: 'add', token: W, entry: { id: 'rate' + String(i).padStart(6, '0'), date: '2026-11-02', name: 'GALON', amount: 1000 + i, paidFrom: 'Modal' } }).ok);
rec('rate limit: 20 ok then refused', rl);
rec('rate limit message', handle_({ action: 'add', token: W, entry: { id: 'rate999999', date: '2026-11-02', name: 'GALON', amount: 1, paidFrom: 'Modal' } }));
clearRate();

// ── 5. list, update, remove, 3-day window ──
api('list: Nov (worker)', { action: 'list', token: W, month: '2026-11' });
api('list: Oct (worker)', { action: 'list', token: W, month: '2026-10' });
api('list: bad month', { action: 'list', token: W, month: '2026-13' });
const upd = (label, id, entry, token = W, force = false) => { clearRate(); return api(label, { action: 'update', token, id, entry, force }); };
const base = { date: '2026-11-02', name: 'PT. YAFINDO MITRA PERMATA', invoice: '0012345', amount: 1776424, paidFrom: 'Transfer Ibu', note: 'retur 2 dus' };
upd('update: nothing changed', 'id-addtransferwithinvoice', base);
advance(HOUR);
upd('update: amount', 'id-addtransferwithinvoice', Object.assign({}, base, { amount: 1767424 }));
upd('update: every field + move to Oct', 'id-addtransferwithinvoice', { date: '2026-10-30', name: 'PT. OMEGA SUKSES ABADI', invoice: 'A-1', amount: 1000000, paidFrom: 'Lainnya: Muda', note: '' });
upd('update: into a duplicate invoice', 'id-addtransferwithinvoice', { date: '2026-10-28', name: 'CV. SUMBER CIPTA AGUNG', invoice: 'INV/2210', amount: 1, paidFrom: 'Modal' });
upd('update: into a duplicate, forced', 'id-addtransferwithinvoice', { date: '2026-10-29', name: 'CV. SUMBER CIPTA AGUNG', invoice: 'INV/2210', amount: 1, paidFrom: 'Modal' }, W, true);
upd('update: invalid', 'id-addtransferwithinvoice', Object.assign({}, base, { amount: 0 }));
upd('update: unknown id', 'nope-nope-nope', base);
clearRate(); api('remove: no reason', { action: 'remove', token: W, id: 'id-addcashnoinvoice', reason: '  ' });
clearRate(); api('remove: ok', { action: 'remove', token: W, id: 'id-addcashnoinvoice', reason: 'Tercatat dua kali' });
clearRate(); api('remove: again', { action: 'remove', token: W, id: 'id-addcashnoinvoice', reason: 'x' });
clearRate(); api('remove: unknown', { action: 'remove', token: W, id: 'zzzzzzzzzz', reason: 'x' });
advance(3 * DAY - 61 * 60e3); // Lainnya entry was recorded at 10:10; it is now 10:09 three days later (3 days minus a minute)
clearRate(); api('3 days minus a minute: worker may edit', { action: 'update', token: W, id: 'id-addLainnyanewsupplier', entry: { date: '2026-11-01', name: 'TOKO KUE MAMA LINA', amount: 125001, paidFrom: 'Lainnya: BUJANG' } });
advance(2 * 60e3);
clearRate(); api('3 days plus a minute: worker blocked', { action: 'update', token: W, id: 'id-addLainnyanewsupplier', entry: { date: '2026-11-01', name: 'TOKO KUE MAMA LINA', amount: 125002, paidFrom: 'Lainnya: BUJANG' } });
clearRate(); api('3 days plus a minute: worker cannot delete', { action: 'remove', token: W, id: 'id-addLainnyanewsupplier', reason: 'x' });
clearRate(); api('admin may still edit (and delete)', { action: 'update', token: A, id: 'id-addLainnyanewsupplier', entry: { date: '2026-11-01', name: 'TOKO KUE MAMA LINA', amount: 125003, paidFrom: 'Lainnya: BUJANG' } });
clearRate(); api('admin deletes it', { action: 'remove', token: A, id: 'id-addLainnyanewsupplier', reason: 'Salah input' });
clearRate(); api('editing a deleted entry', { action: 'update', token: A, id: 'id-addLainnyanewsupplier', entry: { date: '2026-11-01', name: 'TOKO KUE MAMA LINA', amount: 1, paidFrom: 'Modal' } });
api('list: Nov (worker) after changes', { action: 'list', token: W, month: '2026-11' });
api('list: Oct (admin)', { action: 'list', token: A, month: '2026-10' });

// ── 6. Ibu edits the Sheet directly ──
const data = env.ss.getSheetByName('Data');
const rowOf = id => data.dump().findIndex(r => r[C.ID] === id) + 1;
const r1 = rowOf('id-addcashnoinvoice');
data.cells[r1 - 1][C.AMT] = 360000;
onDataEdit({ range: data.getRange(r1, C.AMT + 1), oldValue: 350000, value: 360000, user: { getEmail: () => 'ibu@example.com' } });
const r2 = rowOf('id-addmodalpreviousmonth');
data.cells[r2 - 1][C.DATE] = new Date(2026, 10, 1, 12);
onDataEdit({ range: data.getRange(r2, C.DATE + 1), oldValue: '28/10/2026', value: '01/11/2026' });
const newRow = data.getLastRow() + 1;
data.cells[newRow - 1] = ['05/11/2026', 'galon sanford', '', 30000, 'Uang Kasir', '', 'diketik manual', '', '', '', '', ''];
data.cells[newRow - 1][0] = '01/11/2026';
onDataEdit({ range: data.getRange(newRow, 1, 1, 7) });
onDataEdit({ range: env.ss.getSheetByName('Log').getRange(2, 1), value: 'x' }); // edits outside Data are ignored
// typed by hand as text: date "3/11/26" and amount "Rp 45.500" are turned into a real date and number
const r3 = rowOf('id-okamountRp1500');
data.cells[r3 - 1][C.DATE] = '3/11/26'; data.cells[r3 - 1][C.AMT] = 'Rp 45.500';
onDataEdit({ range: data.getRange(r3, 1, 1, 4), user: { getEmail: () => 'ibu@example.com' } });
rec('typed text date/amount normalised', data.dump()[r3 - 1].slice(0, 4));
tryRec('parseLooseDate_ table', () => ['2026-11-02', '2/11/2026', '02-11-26', '31/02/2026', '13/13/2026', '1/1/1', 'abc', '', '2026-02-30T00'].map(parseLooseDate_));
data.deleteRow(rowOf('id-okinvoice30chars'));
onDataChange({ changeType: 'REMOVE_ROW' });
onDataChange({ changeType: 'FORMAT' });

// ── 7. sessions ──
clearRate(); api('logout', { action: 'logout', token: W });
api('after logout', { action: 'boot', token: W });
const W2 = handle_({ action: 'login', name: 'Budi', password: 'tokoSembilan9', device: 'HP-B' }).token;
advance(91 * DAY);
api('after 91 days unused', { action: 'boot', token: W2 });
const W3 = handle_({ action: 'login', name: 'Budi', password: 'tokoSembilan9', device: 'HP-B' }).token;
menuLogoutAll();
api('after "Keluarkan semua HP"', { action: 'boot', token: W3 });
api('admin also logged out', { action: 'boot', token: A });
rec('alerts at end', env.ui.alerts);
refreshAll();

// ── 8. the whole spreadsheet ──
rec('sheet order', env.ss.getSheets().map(s => s.getName()));
for (const sh of env.ss.getSheets()) {
  rec('sheet ' + sh.getName(), {
    hidden: sh.hidden, frozen: sh.frozen, hiddenCols: sh.hiddenCols, widths: sh.widths, filter: !!sh.filter,
    protections: sh.protections.map(p => ({ desc: p.desc, warn: p.warn })),
    values: sh.getName() === 'Supplier' ? sh.dump().slice(0, 3).concat(sh.dump().slice(-4)) : sh.dump(),
    formatting: sh.getName() === 'Data' ? sh.calls.slice(0, 14).concat(sh.calls.slice(-3)) : sh.calls
  });
}
rec('triggers', env.triggers);
rec('properties at end', Object.fromEntries([...env.props.entries()].sort()));

// ── compare with the approved snapshot ──
const snapFile = path.join(__dirname, 'snapshots', 'backend-scenario.json');
const actual = JSON.stringify(out, null, 1);
if (process.env.UPDATE_SNAPSHOT || !fs.existsSync(snapFile)) {
  fs.mkdirSync(path.dirname(snapFile), { recursive: true });
  fs.writeFileSync(snapFile, actual);
  console.log(`snapshot written: ${out.length} recorded results → ${path.relative(process.cwd(), snapFile)}`);
} else {
  const want = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  let diffs = 0;
  for (let i = 0; i < Math.max(want.length, out.length); i++) {
    const a = out[i], b = want[i];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      if (++diffs <= 5) {
        console.log(`  ✗ ${(b || a)[0]}`);
        console.log('     expected: ' + JSON.stringify(b && b[1]).slice(0, 400));
        console.log('     got:      ' + JSON.stringify(a && a[1]).slice(0, 400));
      }
    }
  }
  if (diffs) { console.log(`\n${diffs} of ${want.length} snapshot results differ`); process.exitCode = 1; }
  else console.log(`${out.length} snapshot results match`);
}
assert.ok(true);
