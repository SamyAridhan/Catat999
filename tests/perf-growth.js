// How the cost of one save grows with years of data. Speed on real Google Sheets is roughly proportional to the
// number of cells a request reads, so this counts cells read per save (add + the app's refresh afterwards).
// Usage: TZ=Asia/Jakarta node tests/perf-growth.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const { install } = require('./gas-mock');
const env = install(globalThis);
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Seed.gs'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), { filename: 'Code.gs' });
setup(); setPassword_('worker', 'tokoSembilan9');
const W = handle_({ action: 'login', name: 'Ani', password: 'tokoSembilan9', device: 'p' }).token;
const today = todayStr_();
const D = env.ss.getSheetByName('Data');
const PER_MONTH = 300;   // the 2025–2026 ledgers: 160–335 payments a month
let added = 0, n = 0;
function fillMonths(from, to) {   // rows straight into Data for months `from`..`to` ago (older history each step)
  const rows = [];
  for (let m = to; m >= from; m--) {
    for (let i = 0; i < PER_MONTH; i++) {
      const d = addDays_(today, -Math.round(m * 30.4) + (i % 28));
      const at = new Date(toDate_(d).getTime() + 3600e3);
      const r = []; r[C.DATE] = toDate_(d); r[C.NAME] = SEED_SUPPLIERS[i % SEED_SUPPLIERS.length][0]; r[C.INV] = ''; r[C.AMT] = 10000 + i; r[C.FROM] = 'Modal';
      r[C.BY] = 'ANI'; r[C.NOTE] = ''; r[C.AT] = at; r[C.EDITBY] = ''; r[C.EDITAT] = ''; r[C.STATUS] = 'AKTIF'; r[C.ID] = 'p' + String(++n).padStart(9, '0');
      rows.push(r);
    }
  }
  const start = D.getLastRow() + 1;
  if (start + rows.length > D.getMaxRows()) D.insertRowsAfter(D.getMaxRows(), start + rows.length - D.getMaxRows() + 10);
  D.getRange(start, 1, rows.length, 12).setValues(rows);
  added += rows.length;
}
function oneSave() {
  env.cache.clear();
  const before = env.stats.cellsRead;
  const r = handle_({ action: 'add', token: W, entry: { id: 'x' + Date.now() + Math.random().toString(36).slice(2, 8), date: today, name: 'ROKOK', amount: 12345 + n++, paidFrom: 'Modal' } });
  if (!r.ok) throw new Error(r.error);
  handle_({ action: 'boot', token: W });   // the app refreshes right after saving
  return env.stats.cellsRead - before;
}
const out = [];
let monthsSoFar = 0;
for (const years of [0.5, 1, 2, 3, 5]) {
  const months = Math.round(years * 12);
  fillMonths(monthsSoFar + 1, months); monthsSoFar = months;
  if (process.env.ARCHIVE && typeof archiveOld === 'function') archiveOld();
  out.push({ years, dataRows: D.getLastRow() - 1, cellsPerSave: oneSave() });
}
console.table(out);
