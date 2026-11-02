// Minimal in-memory stand-ins for the Google Apps Script services Code.gs uses.
// Strict where it matters (out-of-bounds ranges throw like the real thing, dimension checks on setValues).
'use strict';
const crypto = require('crypto');

class MockRange {
  constructor(sheet, r, c, nr, nc) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`Invalid range ${r},${c},${nr},${nc}`);
    if (r + nr - 1 > sheet.maxRows) throw new Error(`Range out of bounds: rows ${r}-${r + nr - 1} > max ${sheet.maxRows} on ${sheet.name}`);
    Object.assign(this, { sheet, r, c, nr, nc });
    const p = new Proxy(this, {
      get(t, k) {
        if (k in t) return t[k];
        if (typeof k === 'string' && /^set|^clear|^merge|^apply/.test(k)) return () => p;
        return undefined;
      }
    });
    return p;
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.cells[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
      out.push(o);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(v) {
    if (!Array.isArray(v) || v.length !== this.nr) throw new Error(`setValues rows ${v.length} != ${this.nr}`);
    v.forEach((row, i) => {
      if (row.length !== this.nc) throw new Error(`setValues cols ${row.length} != ${this.nc} (row ${i})`);
      const tgt = this.sheet.cells[this.r - 1 + i] || (this.sheet.cells[this.r - 1 + i] = []);
      row.forEach((val, j) => {
        if (val === undefined) throw new Error('undefined value in setValues');
        tgt[this.c - 1 + j] = val;
      });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormats(f) { if (f.length !== this.nr || f[0].length !== this.nc) throw new Error('setNumberFormats dims mismatch'); return this; }
  setFontWeights(f) { if (f.length !== this.nr || f[0].length !== this.nc) throw new Error('setFontWeights dims mismatch'); return this; }
  setBackgrounds(f) { if (f.length !== this.nr || f[0].length !== this.nc) throw new Error('setBackgrounds dims mismatch'); return this; }
  setFontColors(f) { if (f.length !== this.nr || f[0].length !== this.nc) throw new Error('setFontColors dims mismatch'); return this; }
  setNumberFormat() { return this; }
  createFilter() { this.sheet.filter = {}; return this.sheet.filter; }
  getSheet() { return this.sheet; }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
}

class MockSheet {
  constructor(name, maxRows = 1000) { this.name = name; this.cells = []; this.maxRows = maxRows; this.hidden = false; this.frozen = 0; this.protections = []; this.hiddenCols = []; this.filter = null; }
  getName() { return this.name; }
  getRange(r, c, nr = 1, nc = 1) { return new MockRange(this, r, c, nr, nc); }
  getLastRow() {
    for (let i = this.cells.length - 1; i >= 0; i--) {
      const row = this.cells[i];
      if (row && row.some(v => v !== '' && v !== undefined && v !== null)) return i + 1;
    }
    return 0;
  }
  getLastColumn() { return this.cells.reduce((m, r) => Math.max(m, r ? r.length : 0), 0); }
  getMaxRows() { return this.maxRows; }
  appendRow(arr) { const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; this.cells[r - 1] = arr.slice(); return this; }
  insertRowsAfter(after, n) { this.maxRows += n; return this; }
  deleteRow(r) { this.cells.splice(r - 1, 1); return this; }
  clear() { this.cells = []; return this; }
  setFrozenRows(n) { this.frozen = n; }
  setColumnWidth() { }
  hideColumns(c) { this.hiddenCols.push(c); }
  hideSheet() { this.hidden = true; }
  getFilter() { return this.filter; }
  protect() { const p = { setDescription() { return p; }, setWarningOnly() { return p; } }; this.protections.push(p); return p; }
  getProtections() { return this.protections; }
  dump() { return this.cells.map(r => (r || []).map(v => v === undefined ? '' : v)); }
}

class MockSpreadsheet {
  constructor() { this.sheets = [new MockSheet('Sheet1')]; this.locale = 'en_US'; this.tz = 'UTC'; this.active = null; }
  getId() { return 'SS123'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(name, index) {
    if (this.getSheetByName(name)) throw new Error('Sheet exists: ' + name);
    const s = new MockSheet(name);
    if (index === undefined || index > this.sheets.length) this.sheets.push(s); else this.sheets.splice(index, 0, s);
    return s;
  }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  setActiveSheet(s) { this.active = s; return s; }
  moveActiveSheet(pos) { const s = this.active; this.sheets = this.sheets.filter(x => x !== s); this.sheets.splice(pos - 1, 0, s); }
  setSpreadsheetTimeZone(t) { this.tz = t; }
  setSpreadsheetLocale(l) { this.locale = l; }
}

function formatDate(d, tz, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d).map(p => [p.type, p.value]));
  if (parts.hour === '24') parts.hour = '00';
  return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss/g, (m, lit) => {
    if (lit !== undefined) return lit;
    return { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second }[m];
  });
}

function install(globalObj) {
  const ss = new MockSpreadsheet();
  const props = new Map();
  const cache = new Map();
  const triggers = [];
  const stats = { sleeps: 0 };
  Object.assign(globalObj, {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
      getUi: () => ({ createMenu: () => { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => m }; return m; } })
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.map(h => ({ getHandlerFunction: () => h })),
      newTrigger: h => { const b = { forSpreadsheet: () => b, onEdit: () => b, onChange: () => b, create: () => { triggers.push(h); return b; } }; return b; }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)) }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate,
      sleep: () => { stats.sleeps++; },
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b))
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: s => { const o = { content: s, setMimeType: () => o, getContent: () => s }; return o; }
    }
  });
  globalObj.console = console;
  return { ss, props, cache, triggers, stats };
}

module.exports = { install, MockSheet, formatDate };
