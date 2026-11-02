// Property-based tests: instead of hand-picked examples, fast-check throws thousands of random inputs and
// random sequences of actions at the real Code.gs and checks rules that must ALWAYS hold. When something breaks,
// it shrinks the input to the smallest example that still fails.
// Usage: TZ=Asia/Jakarta node tests/backend.property.test.js     (FC_RUNS=… for more/fewer runs)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const fc = require('fast-check');
const { install } = require('./gas-mock');

const env = install(globalThis);
const dir = path.join(__dirname, '..', 'apps-script');
const codeFile = process.env.CODE_FILE ? path.resolve(__dirname, process.env.CODE_FILE) : path.join(dir, 'Code.gs');
vm.runInThisContext(fs.readFileSync(path.join(dir, 'Seed.gs'), 'utf8') + '\n' + fs.readFileSync(codeFile, 'utf8'), { filename: 'Code.gs' });

const RUNS = Number(process.env.FC_RUNS || 300);
if (process.env.FC_SEED) fc.configureGlobal({ seed: Number(process.env.FC_SEED) }); // fixed seed = repeatable runs (used by mutation testing)
let passed = 0, failed = 0;
function prop(name, fn) {
  if (process.env.ONLY && name.indexOf(process.env.ONLY) < 0) return;
  relogin();
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name); console.log(String(e.message).split('\n').slice(0, 12).join('\n')); }
}

setup();
setPassword_('worker', 'tokoSembilan9');
setPassword_('admin', 'ibuBatam2026!');
const today = todayStr_();
const call = req => { env.cache.clear(); return handle_(req); }; // clear rate-limit counters between random calls
let tokW, tokA;
function relogin() { // random API calls may include "logout" with a real token, so get fresh sessions per property
  tokW = call({ action: 'login', name: 'ANI', password: 'tokoSembilan9', device: 'p' }).token;
  tokA = call({ action: 'login', name: 'IBU', password: 'ibuBatam2026!', device: 'p' }).token;
}
relogin();
const dataRows = () => env.ss.getSheetByName('Data').dump().slice(1).filter(r => r.some(v => v !== ''));
const FORMULA = /^[=+\-@\t\r]/;

// any text, including the nasty bits: formula starters, control chars, emoji, HTML, quotes, very long
const nasty = fc.oneof(
  fc.string({ maxLength: 80 }), fc.fullUnicodeString({ maxLength: 40 }),
  fc.constantFrom('=SUM(A1)', '+1', '-1', '@x', '\t=1', '\r=1', "'=1", '<script>alert(1)</script>', '"; DROP TABLE', '  ', '', '0', 'null', 'undefined', '=IMPORTXML("http://x")', 'Lainnya:', 'lainnya : budi', 'TRANSFER IBU'),
  fc.string({ minLength: 100, maxLength: 400 }));
const anyValue = fc.oneof(nasty, fc.integer(), fc.double(), fc.boolean(), fc.constant(null), fc.constant(undefined), fc.array(fc.integer(), { maxLength: 3 }), fc.object({ maxDepth: 1 }));

// ── sanitisers: rules that must hold for EVERY input ──
prop('safeText_: never lets text start like a formula, and unquote_ gives the original back', () => {
  fc.assert(fc.property(nasty, s => {
    const out = safeText_(s);
    assert.ok(!FORMULA.test(out), JSON.stringify(out));
    assert.strictEqual(unquote_(out), String(s));
  }), { numRuns: RUNS * 3 });
});
prop('cleanSupplierName_: ≤ 60 chars, allowed characters only, never a formula, idempotent', () => {
  fc.assert(fc.property(anyValue, v => {
    const s = cleanSupplierName_(v);
    assert.ok(s.length <= 60 && /^[A-Z0-9 .,&\/()'+\-]*$/.test(s) && !FORMULA.test(s) && s === s.trim(), JSON.stringify(s));
    assert.strictEqual(cleanSupplierName_(s), s);
  }), { numRuns: RUNS * 3 });
});
prop('cleanInvoice_: empty, rejected (null), or a safe invoice code', () => {
  fc.assert(fc.property(anyValue, v => {
    const s = cleanInvoice_(v);
    assert.ok(s === '' || s === null || (/^[A-Z0-9\-\/.]{1,30}$/.test(s)), JSON.stringify(s));
  }), { numRuns: RUNS * 3 });
});
prop('cleanPersonName_ / cleanPayFrom_: only known shapes come out', () => {
  fc.assert(fc.property(anyValue, v => {
    const n = cleanPersonName_(v);
    assert.ok(n === '' || /^[A-Z][A-Z .'\-]{1,29}$/.test(n), JSON.stringify(n));
    const p = cleanPayFrom_(v);
    assert.ok(p === '' || PAY_FROM.indexOf(p) >= 0 || /^Lainnya: [A-Z .'\-]{1,30}$/.test(p), JSON.stringify(p));
  }), { numRuns: RUNS * 3 });
});
prop('cleanFree_: no control characters, trimmed, length limit kept', () => {
  fc.assert(fc.property(anyValue, fc.integer({ min: 0, max: 300 }), (v, max) => {
    const s = cleanFree_(v, max);
    assert.ok(s.length <= max && !/[\u0000-\u001F\u007F]/.test(s) && s === s.trim(), JSON.stringify(s));
  }), { numRuns: RUNS * 2 });
});
prop('nameKey_: same supplier however it is typed', () => {
  fc.assert(fc.property(fc.constantFrom(...SEED_SUPPLIERS.map(s => s[0])), fc.constantFrom('', 'PT ', 'PT. ', 'pt.'), fc.boolean(), (name, prefix, lower) => {
    let typed = prefix + name.replace(/^(PT|CV|UD)\.?\s*/, '').replace(/ /g, () => (Math.random() < 0.5 ? '  ' : '-'));
    if (lower) typed = typed.toLowerCase();
    if (prefix) assert.strictEqual(nameKey_(typed), nameKey_(name));
  }), { numRuns: RUNS });
});

// ── the web API: random garbage never crashes it or leaks internals ──
prop('doPost: any body → valid JSON with ok:true|false, never a stack trace', () => {
  fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 300 }), anyValue.map(v => JSON.stringify(v === undefined ? null : v)), fc.record({
    action: fc.oneof(fc.constantFrom(...ACTIONS), nasty), token: fc.oneof(nasty, fc.constant(tokW)), name: anyValue, password: anyValue, month: anyValue, id: anyValue, entry: anyValue, reason: anyValue, force: anyValue
  }).map(o => JSON.stringify(o))), body => {
    env.cache.clear();
    const res = JSON.parse(doPost({ postData: { contents: body } }).getContent());
    assert.strictEqual(typeof res.ok, 'boolean');
    if (!res.ok) assert.ok(typeof res.error === 'string' && !/at \w+ \(|TypeError|ReferenceError|Code\.gs/.test(res.error), res.error);
  }), { numRuns: RUNS * 2 });
});
prop('no token → every action except login/ping is refused', () => {
  fc.assert(fc.property(fc.constantFrom('boot', 'add', 'update', 'remove', 'list', 'logout'), anyValue, (action, junk) => {
    const r = call({ action, token: typeof junk === 'string' ? junk : '', entry: { id: 'abcdefgh1', date: today, name: 'X', amount: 1, paidFrom: 'Modal' } });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.code, 'AUTH');
  }), { numRuns: RUNS });
});

// ── random entries: whatever is accepted is stored clean ──
const entryArb = fc.record({
  id: fc.oneof(fc.stringMatching(/^[A-Za-z0-9_-]{8,20}$/), nasty),
  date: fc.oneof(fc.integer({ min: -70, max: 3 }).map(n => addDays_(today, n)), nasty),
  name: fc.oneof(fc.constantFrom(...SEED_SUPPLIERS.slice(0, 15).map(s => s[0])), nasty),
  invoice: fc.oneof(fc.constant(''), fc.stringMatching(/^[A-Z0-9\/-]{1,12}$/), nasty),
  amount: fc.oneof(fc.integer({ min: -5, max: 600000000 }), fc.double(), nasty, fc.constant(null)),
  paidFrom: fc.oneof(fc.constantFrom('Transfer Ibu', 'Uang Kasir', 'Modal', 'Lainnya: BUJANG'), nasty),
  note: fc.oneof(fc.constant(''), nasty)
}, { requiredKeys: [] });
prop('add: accepted rows are always clean (date in range, whole amount in range, no formulas, known pay source)', () => {
  fc.assert(fc.property(entryArb, fc.boolean(), (e, admin) => {
    const r = call({ action: 'add', token: admin ? tokA : tokW, entry: e, force: true });
    assert.strictEqual(typeof r.ok, 'boolean');
    if (!r.ok) { assert.ok(typeof r.error === 'string' && r.error.length > 0); return; }
    const x = r.entry;
    assert.ok(x.date <= today && x.date >= addDays_(today, -(admin ? LIMIT.adminBackDays : LIMIT.workerBackDays)), 'date ' + x.date);
    assert.ok(Number.isInteger(x.amount) && x.amount >= 1 && x.amount <= LIMIT.maxAmount, 'amount ' + x.amount);
    assert.ok(PAY_FROM.indexOf(x.paidFrom) >= 0 || /^Lainnya: /.test(x.paidFrom), x.paidFrom);
    assert.ok(x.name && x.name.length <= 60);
  }), { numRuns: RUNS });
  for (const row of dataRows()) row.forEach(v => { if (typeof v === 'string') assert.ok(!FORMULA.test(v), 'formula-like cell: ' + JSON.stringify(v)); });
});

// ── model-based: random sequences of add / update / remove by worker and admin ──
// After every step the Sheet must agree with a simple in-memory model.
prop('random action sequences keep Data, month tabs, Log and the model in agreement', () => {
  const cmd = fc.oneof(
    fc.record({ t: fc.constant('add'), admin: fc.boolean(), days: fc.integer({ min: 0, max: 45 }), sup: fc.integer({ min: 0, max: 8 }), amount: fc.integer({ min: 1, max: 9000000 }), pay: fc.constantFrom(...PAY_FROM, 'Lainnya: MUDA'), inv: fc.oneof(fc.constant(''), fc.stringMatching(/^[0-9]{1,6}$/)) }),
    fc.record({ t: fc.constant('update'), admin: fc.boolean(), pick: fc.nat(), amount: fc.integer({ min: 1, max: 9000000 }), days: fc.integer({ min: 0, max: 45 }) }),
    fc.record({ t: fc.constant('remove'), admin: fc.boolean(), pick: fc.nat() }),
    fc.record({ t: fc.constant('resend'), pick: fc.nat() }));
  fc.assert(fc.property(fc.array(cmd, { minLength: 1, maxLength: 25 }), cmds => {
    const model = new Map(); // id -> {date, amount, pay, deleted}
    const startRows = dataRows().length, startLog = env.ss.getSheetByName('Log').getLastRow();
    let writes = 0, n = 0;
    const live = () => [...model.entries()].filter(([, v]) => !v.deleted);
    for (const c of cmds) {
      const token = c.admin ? tokA : tokW;
      if (c.t === 'add') {
        const id = 'mb' + Date.now().toString(36) + (n++) + Math.random().toString(36).slice(2, 6);
        const e = { id, date: addDays_(today, -c.days), name: SEED_SUPPLIERS[c.sup][0], invoice: c.inv, amount: c.amount, paidFrom: c.pay };
        const r = call({ action: 'add', token, entry: e, force: true });
        assert.ok(r.ok && !r.already, 'add failed: ' + JSON.stringify(r).slice(0, 200));
        model.set(id, { date: e.date, amount: c.amount, pay: c.pay, deleted: false, entry: e }); writes++;
      } else if (c.t === 'resend') {
        const all = [...model.keys()]; if (!all.length) continue;
        const id = all[c.pick % all.length];
        const r = call({ action: 'add', token: tokW, entry: model.get(id).entry });
        assert.ok(r.ok && r.already, 'resend must be a no-op');
      } else {
        const l = live(); if (!l.length) continue;
        const [id, m] = l[c.pick % l.length];
        if (c.t === 'update') {
          const e = Object.assign({}, m.entry, { amount: c.amount, date: addDays_(today, -c.days) });
          const r = call({ action: 'update', token, id, entry: e, force: true });
          assert.ok(r.ok, 'update failed: ' + r.error);
          if (!r.unchanged) { writes++; Object.assign(m, { amount: c.amount, date: e.date, entry: e }); }
        } else {
          const r = call({ action: 'remove', token, id, reason: 'Salah input' });
          assert.ok(r.ok, 'remove failed: ' + r.error);
          m.deleted = true; writes++;
        }
      }
    }
    // Data has one row per add (deletes are soft), nothing more
    assert.strictEqual(dataRows().length - startRows, model.size);
    // every write logged
    assert.strictEqual(env.ss.getSheetByName('Log').getLastRow() - startLog, writes);
    // server's view of each month equals the model, and month tabs add up
    const months = new Set([...model.values()].map(v => v.date.slice(0, 7)));
    for (const ym of months) {
      const listed = call({ action: 'list', token: tokA, month: ym });
      const mine = new Map(listed.entries.filter(x => model.has(x.id)).map(x => [x.id, x]));
      for (const [id, v] of model) {
        if (v.date.slice(0, 7) !== ym) continue;
        if (v.deleted) assert.ok(!mine.has(id), 'deleted entry still listed');
        else { assert.ok(mine.has(id), 'entry missing from its month'); assert.strictEqual(mine.get(id).amount, v.amount); }
      }
      const tab = env.ss.getSheetByName(BULAN[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4));
      assert.ok(tab, 'month tab missing for ' + ym);
      assert.strictEqual(tab.dump()[2][0], listed.total, 'month tab total ≠ listed total for ' + ym);
    }
  }), { numRuns: Math.max(20, Math.round(RUNS / 6)) });
});

// ── 3-day window holds for any recording age ──
prop('3-day edit window: worker allowed exactly when recorded ≤ 3 days ago; admin always', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 10 * 24 }), hoursAgo => {
    const id = 'win' + Math.random().toString(36).slice(2, 10);
    assert.ok(call({ action: 'add', token: tokW, entry: { id, date: today, name: 'ROKOK', amount: 1000 + hoursAgo, paidFrom: 'Modal' }, force: true }).ok);
    const sh = env.ss.getSheetByName('Data'), rows = sh.dump();
    const i = rows.findIndex(r => r[C.ID] === id);
    // 1 minute of slack either side of each hour so the exact-72h case doesn't depend on test speed
    const ageMs = hoursAgo * 3600e3 + (hoursAgo === 72 ? -60000 : 0);
    sh.cells[i][C.AT] = new Date(Date.now() - ageMs);
    const r = call({ action: 'remove', token: tokW, id, reason: 'x' });
    assert.strictEqual(r.ok, hoursAgo <= 72, `recorded ${hoursAgo}h ago → ${r.ok}`);
    if (!r.ok) assert.ok(call({ action: 'remove', token: tokA, id, reason: 'x' }).ok);
  }), { numRuns: 60 });
});

console.log(`\n${passed} properties held, ${failed} broken`);
if (failed) process.exitCode = 1;
