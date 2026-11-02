/* Demo-mode stand-in for the Apps Script backend. Same actions, same rules, same messages.
 * Data stays in this browser only (localStorage). Used when config.js has no API_URL, or with ?demo=1.
 * Demo passwords: pekerja "toko12345", Ibu (admin) "ibu12345".
 * To simulate no internet: localStorage.setItem('c9demo.offline', '1').
 */
(function () {
  'use strict';
  var K = 'c9demo.';
  var PAY = ['Transfer Ibu', 'Uang Kasir', 'Modal'];
  var LIMIT = { maxAmount: 500000000, workerBackDays: 60, adminBackDays: 400, editDays: 3 };
  var PW = { worker: 'toko12345', admin: 'ibu12345' };

  function get(k, d) { try { var v = localStorage.getItem(K + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) { } }
  function pad(n) { return ('0' + n).slice(-2); }
  function wib(d) { return new Date((d || new Date()).getTime() + 7 * 3600e3).toISOString(); }
  function today() { return wib().slice(0, 10); }
  function nowStr() { return wib().slice(0, 19); }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function key(s) { return String(s || '').toUpperCase().replace(/^\s*(PT|CV|UD)\b\.?/, '').replace(/[^A-Z0-9]/g, ''); }
  function invKey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+/, ''); }

  function suppliers() {
    var s = get('suppliers', null);
    if (!s) { s = (window.CATAT_SEED || []).map(function (x) { return x[0]; }); put('suppliers', s); }
    return s;
  }
  function data() {
    var d = get('data', null);
    if (d) return d;
    // a few sample rows so Riwayat is not empty on first open
    var t = today(), sup = suppliers(), ago = function (days, h) { return wib(new Date(Date.now() - days * 86400e3 - (h || 0) * 3600e3)).slice(0, 19); };
    d = [
      { id: 'demo1', date: t, name: sup[0] || 'PT. CONTOH', invoice: '0012345', amount: 1776424, paidFrom: 'Transfer Ibu', by: 'BUJANG', note: '', at: ago(0, 1), editedBy: '', editedAt: '', status: 'AKTIF' },
      { id: 'demo2', date: addDays(t, -1), name: 'ROKOK', invoice: '', amount: 350000, paidFrom: 'Uang Kasir', by: 'MUDA', note: '', at: ago(1), editedBy: '', editedAt: '', status: 'AKTIF' },
      { id: 'demo3', date: addDays(t, -5), name: sup[1] || 'PT. CONTOH DUA', invoice: 'INV/2210', amount: 2450000, paidFrom: 'Transfer Ibu', by: 'BUJANG', note: 'retur 2 dus', at: ago(5), editedBy: '', editedAt: '', status: 'AKTIF' }
    ];
    put('data', d);
    return d;
  }
  function sessions() { return get('sessions', {}); }

  function rnd() { var a = new Uint8Array(32); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function pub(r, user) {
    return { id: r.id, date: r.date, name: r.name, invoice: r.invoice, amount: r.amount, paidFrom: r.paidFrom, by: r.by, note: r.note, at: r.at,
      editedBy: r.editedBy, editedAt: r.editedAt };
  }
  function canEdit(user, r) {
    if (r.status === 'DIHAPUS') return false;
    if (user.role === 'ADMIN') return true;
    return Date.now() - new Date(r.at + '+07:00').getTime() <= LIMIT.editDays * 86400e3;
  }
  // ── same rules and messages as apps-script/Code.gs (kept identical by tests/contract.test.js) ──
  function text(v) { return typeof v === 'string' ? v : (typeof v === 'number' && isFinite(v) ? String(v) : ''); }
  function personName(v) { var s = text(v).toUpperCase().replace(/\s+/g, ' ').trim(); return /^[A-Z][A-Z .'\-]{1,29}$/.test(s) ? s : ''; }
  function cleanName(v) {
    var s = text(v).toUpperCase().replace(/[^A-Z0-9 .,&\/()'+\-]/g, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(/^[=+\-@\s]+/, '').trim();
    return s.length > 60 ? s.slice(0, 60).trim() : s;
  }
  function cleanInvoice(v) { var s = text(v).toUpperCase().replace(/\s+/g, '').trim(); if (!s) return ''; return /^[A-Z0-9\-\/.]{1,30}$/.test(s) ? s : null; }
  function cleanPay(v) {
    var s = text(v).trim();
    for (var i = 0; i < PAY.length; i++) if (s.toUpperCase() === PAY[i].toUpperCase()) return PAY[i];
    var m = /^lainnya\s*:?\s*(.*)$/i.exec(s);
    if (m) { var who = m[1].toUpperCase().replace(/[^A-Z .'\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30); return who ? 'Lainnya: ' + who : ''; }
    return '';
  }
  function cleanFree(v, max) { return text(v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim(); }
  function checkDate(s, back) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'Tanggal tidak valid.';
    var p = s.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    if (d.getUTCFullYear() !== p[0] || d.getUTCMonth() !== p[1] - 1 || d.getUTCDate() !== p[2]) return 'Tanggal tidak valid.';
    var t = today();
    if (s > t) return 'Tanggal tidak boleh lebih dari hari ini.';
    if (s < addDays(t, -back)) return 'Tanggal terlalu lama. Minta Ibu untuk mencatat.';
    return '';
  }

  function validate(e, user, keepDate) {
    if (!e || typeof e !== 'object') return { error: 'Data tidak valid.' };
    var date = String(e.date || '');
    var back = keepDate && date === keepDate ? 100000 : (user.role === 'ADMIN' ? LIMIT.adminBackDays : LIMIT.workerBackDays);
    var dErr = checkDate(date, back); if (dErr) return { error: dErr };
    var name = cleanName(e.name);
    if (!name) return { error: 'Nama PT / barang wajib diisi.' };
    var inv = cleanInvoice(e.invoice);
    if (inv === null) return { error: 'No. invoice hanya boleh huruf, angka, - dan / (maks. 30).' };
    var amt = typeof e.amount === 'number' ? e.amount : Number(String(e.amount === undefined ? '' : e.amount).replace(/[^\d]/g, ''));
    if (!isFinite(amt) || Math.floor(amt) !== amt || amt <= 0) return { error: 'Nominal wajib diisi.' };
    if (amt > LIMIT.maxAmount) return { error: 'Nominal terlalu besar. Cek lagi.' };
    var pf = cleanPay(e.paidFrom);
    if (!pf) return { error: 'Pilih bayar pakai apa.' };
    var canon = suppliers().filter(function (s) { return key(s) === key(name); })[0];
    return { v: { date: date, name: canon || name, invoice: inv, amount: amt, paidFrom: pf, note: cleanFree(e.note, 200) } };
  }
  function dup(d, v, selfId) {
    var inv = v.invoice.replace(/^0+/, '');
    for (var i = d.length - 1; i >= 0; i--) {
      var r = d[i]; if (r.status === 'DIHAPUS' || r.id === selfId || key(r.name) !== key(v.name)) continue;
      if (inv && String(r.invoice).trim().toUpperCase().replace(/^0+/, '') === inv)
        return { ok: false, code: 'DUP_INVOICE', error: 'Invoice ini sudah pernah dicatat.', existing: pub(r) };
      if (!inv && r.date === v.date && r.amount === v.amount)
        return { ok: false, code: 'DUP_SIMILAR', error: 'Sudah ada transaksi yang sama di tanggal itu.', existing: pub(r) };
    }
    return null;
  }

  function handle(req) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (localStorage.getItem(K + 'offline') === '1') { var e = new Error('NETWORK'); e.network = true; reject(e); return; }
        try { resolve(run(req)); } catch (err) { resolve({ ok: false, error: 'Terjadi kesalahan di server. Coba lagi.' }); }
      }, 350);
    });
  }

  function run(req) {
    var a = req.action;
    if (a === 'ping') return { ok: true };
    if (a === 'login') {
      var nm = personName(req.name);
      if (!nm) return { ok: false, error: 'Isi nama Anda (huruf saja, 2–30 karakter).' };
      if (!req.password || String(req.password).length > 100) return { ok: false, error: 'Isi kata sandi.' };
      var role = req.password === PW.admin ? 'ADMIN' : req.password === PW.worker ? 'PEKERJA' : '';
      if (!role) return { ok: false, error: 'Kata sandi salah.' };
      var tok = rnd(), ss = sessions(); ss[tok] = { name: nm, role: role }; put('sessions', ss);
      return { ok: true, token: tok, name: nm, role: role };
    }
    var user = sessions()[req.token];
    if (!user) return { ok: false, code: 'AUTH', error: 'Sesi habis. Silakan masuk lagi.' };
    var d = data(), t = today();
    if (a === 'logout') { var s2 = sessions(); delete s2[req.token]; put('sessions', s2); return { ok: true }; }
    if (a === 'boot') {
      var freq = {};
      d.forEach(function (r) { if (r.status !== 'DIHAPUS' && r.date >= addDays(t, -60)) freq[r.name] = (freq[r.name] || 0) + 1; });
      return { ok: true, user: user, today: t, payFrom: PAY, suppliers: suppliers(),
        frequent: Object.keys(freq).sort(function (x, y) { return freq[y] - freq[x]; }).slice(0, 10),
        todayCount: d.filter(function (r) { return r.status !== 'DIHAPUS' && r.at.slice(0, 10) === t; }).length,
        limits: { maxAmount: LIMIT.maxAmount, backDays: user.role === 'ADMIN' ? LIMIT.adminBackDays : LIMIT.workerBackDays, editDays: LIMIT.editDays } };
    }
    if (a === 'list') {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.month || '')) return { ok: false, error: 'Bulan tidak valid.' };
      var out = d.filter(function (r) { return r.status !== 'DIHAPUS' && r.date.slice(0, 7) === req.month; }).map(function (r) { var o = pub(r); o.canEdit = canEdit(user, r); return o; });
      out.sort(function (x, y) { return x.date !== y.date ? (x.date < y.date ? 1 : -1) : (x.at < y.at ? 1 : -1); });
      return { ok: true, month: req.month, entries: out, total: out.reduce(function (s, r) { return s + r.amount; }, 0) };
    }
    if (a === 'add') {
      var e = req.entry || {};
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(e.id || '')) return { ok: false, error: 'ID transaksi tidak valid.' };
      var had = d.filter(function (r) { return r.id === e.id; })[0];
      if (had) return { ok: true, already: true, entry: pub(had) };
      var v = validate(e, user); if (v.error) return { ok: false, code: 'INVALID', error: v.error };
      if (!req.force) { var dp = dup(d, v.v, ''); if (dp) return dp; }
      var sup = suppliers(); if (!sup.some(function (s) { return key(s) === key(v.v.name); })) { sup.push(v.v.name); put('suppliers', sup); }
      var row = Object.assign({ id: e.id, by: user.name, at: nowStr(), editedBy: '', editedAt: '', status: 'AKTIF' }, v.v);
      d.push(row); put('data', d);
      return { ok: true, entry: pub(row) };
    }
    if (a === 'update' || a === 'remove') {
      var r = d.filter(function (x) { return x.id === req.id; })[0];
      if (!r) return { ok: false, error: 'Transaksi tidak ditemukan. Mungkin sudah dihapus — muat ulang Riwayat.' };
      if (a === 'remove' && r.status === 'DIHAPUS') return { ok: true, already: true };
      if (a === 'update' && r.status === 'DIHAPUS') return { ok: false, error: 'Transaksi ini sudah dihapus.' };
      if (!canEdit(user, r)) return { ok: false, error: 'Transaksi lebih dari ' + LIMIT.editDays + ' hari hanya bisa diubah oleh Ibu.' };
      if (a === 'remove') {
        if (!cleanFree(req.reason, 100)) return { ok: false, error: 'Pilih alasan hapus.' };
        r.status = 'DIHAPUS'; r.editedBy = user.name; r.editedAt = nowStr(); put('data', d); return { ok: true };
      }
      var u = validate(req.entry, user, r.date); if (u.error) return { ok: false, code: 'INVALID', error: u.error };
      if (!req.force) { var dq = dup(d, u.v, r.id); if (dq) return dq; }
      var changed = ['date', 'name', 'invoice', 'amount', 'paidFrom', 'note'].some(function (k) { return String(r[k]) !== String(u.v[k]); });
      if (!changed) return { ok: true, unchanged: true, entry: pub(r) };
      Object.assign(r, u.v, { editedBy: user.name, editedAt: nowStr() }); put('data', d);
      return { ok: true, entry: pub(r) };
    }
    return { ok: false, error: 'Aksi tidak dikenal.' };
  }

  window.CatatMockApi = { handle: handle };
})();
