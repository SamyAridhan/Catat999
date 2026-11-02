// Contract test: the demo-mode API (web/mock-api.js), which the app tests run against, must answer exactly like the
// real backend (apps-script/Code.gs) — same ok/code/error text and the same fields — for the same requests.
// If they drift apart, the app could pass its tests in demo mode and still misbehave against the real Sheet.
// Usage: TZ=Asia/Jakarta node tests/contract.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const crypto = require('crypto');
const { install } = require('./gas-mock');

// real backend
const env = install(globalThis);
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Seed.gs'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), { filename: 'Code.gs' });
setup(); setPassword_('worker', 'toko12345'); setPassword_('admin', 'ibu12345');
const real = req => { env.cache.clear(); return Promise.resolve(handle_(JSON.parse(JSON.stringify(req)))); };

// demo API in a fake browser window
const store = new Map();
const win = {
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  crypto: { getRandomValues: a => crypto.randomFillSync(a) },
  CATAT_SEED: SEED_SUPPLIERS
};
win.window = win;
const sandbox = Object.assign(vm.createContext({ setTimeout: (f) => f(), Promise, Date, Uint8Array, JSON, Math, String, Number, Object, Array, RegExp, isFinite }), win);
sandbox.window = sandbox;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'mock-api.js'), 'utf8'), sandbox);
store.set('c9demo.data', '[]');   // start the demo with no sample rows, like a fresh Sheet
const demo = req => sandbox.CatatMockApi.handle(JSON.parse(JSON.stringify(req))).then(r => JSON.parse(JSON.stringify(r)));  // over the wire, like real JSON

const shape = v => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort() : typeof v);
let passed = 0, failed = 0;
async function same(label, reqR, reqD = reqR, opts = {}) {
  const [a, b] = await Promise.all([real(reqR), demo(reqD)]);
  const pick = r => ({ ok: r.ok, code: r.code, error: r.error, already: r.already, unchanged: r.unchanged });
  try {
    assert.deepStrictEqual(pick(b), pick(a));
    if (!opts.skipShape) {
      assert.deepStrictEqual(shape(b), shape(a), 'top-level fields');
      if (a.entry) assert.deepStrictEqual(shape(b.entry), shape(a.entry), 'entry fields');
      if (a.existing) assert.deepStrictEqual(shape(b.existing), shape(a.existing), 'existing fields');
      if (a.entries && a.entries[0]) assert.deepStrictEqual(shape(b.entries[0]), shape(a.entries[0]), 'list entry fields');
      if (a.user) assert.deepStrictEqual(b.user, a.user, 'user');
      if (a.limits) assert.deepStrictEqual(b.limits, a.limits, 'limits');
    }
    passed++; console.log('  ✓', label);
  } catch (e) { failed++; console.log('  ✗', label, '\n     real:', JSON.stringify(a).slice(0, 220), '\n     demo:', JSON.stringify(b).slice(0, 220), '\n    ', e.message.split('\n')[0]); }
  return [a, b];
}

(async () => {
  const today = todayStr_();
  await same('login: bad name', { action: 'login', name: '1', password: 'x', device: 'd' });
  await same('login: no password', { action: 'login', name: 'Ani', password: '', device: 'd' });
  await same('login: wrong password', { action: 'login', name: 'Ani', password: 'salah123', device: 'd' });
  const [lw, lwd] = await same('login: worker', { action: 'login', name: ' ani  putri ', password: 'toko12345', device: 'd' }, undefined, { skipShape: false });
  const [la, lad] = await same('login: admin', { action: 'login', name: 'Ibu', password: 'ibu12345', device: 'd' });
  const W = lw.token, Wd = lwd.token, A = la.token, Ad = lad.token;
  assert.strictEqual(lw.name, lwd.name, 'name cleaned the same way');
  await same('unknown action', { action: 'hack', token: W }, { action: 'hack', token: Wd });
  await same('no token', { action: 'boot' });
  await same('bad token', { action: 'boot', token: 'f'.repeat(64) });
  await same('boot (worker)', { action: 'boot', token: W }, { action: 'boot', token: Wd });
  await same('boot (admin)', { action: 'boot', token: A }, { action: 'boot', token: Ad });

  const add = async (label, e, force) => same(label, { action: 'add', token: W, entry: e, force }, { action: 'add', token: Wd, entry: e, force });
  await add('add ok', { id: 'contract01', date: today, name: 'pt yafindo mitra-permata', invoice: ' 0012 345', amount: '1776424', paidFrom: 'transfer ibu', note: ' retur ' });
  await add('add same id again', { id: 'contract01', date: today, name: 'X', amount: 5, paidFrom: 'Modal' });
  await add('dup invoice (leading zeros)', { id: 'contract02', date: today, name: 'PT. YAFINDO MITRA PERMATA', invoice: '12345', amount: 1, paidFrom: 'Modal' });
  await add('same invoice, other supplier', { id: 'contract03', date: today, name: 'PT. OMEGA SUKSES ABADI', invoice: '12345', amount: 1, paidFrom: 'Modal' });
  await add('cash, no invoice', { id: 'contract04', date: today, name: 'rokok', amount: 350000, paidFrom: 'Uang Kasir' });
  await add('dup similar', { id: 'contract05', date: today, name: 'ROKOK', amount: 350000, paidFrom: 'Modal' });
  await add('dup similar forced', { id: 'contract06', date: today, name: 'ROKOK', amount: 350000, paidFrom: 'Modal' }, true);
  await add('Lainnya cleaned', { id: 'contract07', date: today, name: 'galon', amount: 2, paidFrom: 'lainnya : bujang 2' });
  await add('new supplier', { id: 'contract08', date: today, name: 'toko kue mama lina', amount: 3, paidFrom: 'Modal' });
  for (const [k, e] of Object.entries({
    'no name': { name: '  ' }, 'symbols only': { name: '=+-@' }, 'bad invoice': { invoice: 'INV#1' }, 'invoice 31': { invoice: 'A'.repeat(31) },
    'amount 0': { amount: 0 }, 'amount decimal': { amount: 1.5 }, 'amount text': { amount: 'abc' }, 'amount over max': { amount: 500000001 },
    'no pay source': { paidFrom: '' }, 'unknown pay source': { paidFrom: 'Kartu' }, 'Lainnya no name': { paidFrom: 'Lainnya:' },
    'future date': { date: addDays_(today, 1) }, 'bad date': { date: '02/11/2026' }, 'impossible date': { date: '2026-02-30' },
    '60 days back ok': { date: addDays_(today, -60) }, '61 days back': { date: addDays_(today, -61) }, 'short id': { id: 'short' }
  })) await add('validation: ' + k, Object.assign({ id: 'cv' + k.replace(/\W/g, '').padEnd(8, 'x').slice(0, 20), date: today, name: 'SARI ROTI', amount: 1000 + k.length, paidFrom: 'Modal' }, e));
  await same('admin 400 days back', { action: 'add', token: A, entry: { id: 'contract09', date: addDays_(today, -400), name: 'X', amount: 9, paidFrom: 'Modal' } }, { action: 'add', token: Ad, entry: { id: 'contract09', date: addDays_(today, -400), name: 'X', amount: 9, paidFrom: 'Modal' } });

  const ym = today.slice(0, 7);
  const [lr, ld] = await same('list month', { action: 'list', token: W, month: ym }, { action: 'list', token: Wd, month: ym });
  assert.deepStrictEqual(ld.entries.map(e => [e.id, e.amount, e.name, e.paidFrom, e.invoice, e.canEdit]), lr.entries.map(e => [e.id, e.amount, e.name, e.paidFrom, e.invoice, e.canEdit]), 'same rows in same order');
  assert.strictEqual(ld.total, lr.total);
  await same('list bad month', { action: 'list', token: W, month: '2026-13' }, { action: 'list', token: Wd, month: '2026-13' });

  const up = (label, id, e, force) => same(label, { action: 'update', token: W, id, entry: e, force }, { action: 'update', token: Wd, id, entry: e, force });
  const base = { date: today, name: 'ROKOK', invoice: '', amount: 350000, paidFrom: 'Uang Kasir', note: '' };
  await up('update unchanged', 'contract04', base);
  await up('update amount', 'contract04', Object.assign({}, base, { amount: 360000 }));
  await up('update into dup invoice', 'contract04', Object.assign({}, base, { name: 'PT. YAFINDO MITRA PERMATA', invoice: '0012345' }));
  await up('update invalid', 'contract04', Object.assign({}, base, { amount: -1 }));
  await up('update unknown id', 'nope00000', base);
  const rm = (label, id, reason) => same(label, { action: 'remove', token: W, id, reason }, { action: 'remove', token: Wd, id, reason });
  await rm('remove without reason', 'contract04', ' ');
  await rm('remove', 'contract04', 'Salah input');
  await rm('remove again', 'contract04', 'x');
  await rm('remove unknown', 'nope00000', 'x');
  await up('update a deleted entry', 'contract04', base);
  await same('logout', { action: 'logout', token: W }, { action: 'logout', token: Wd });
  await same('after logout', { action: 'boot', token: W }, { action: 'boot', token: Wd });

  console.log(`\n${passed} contract checks match, ${failed} differ`);
  if (failed) process.exitCode = 1;
})();
