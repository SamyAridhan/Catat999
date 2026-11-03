/* Catat 999 — record supplier payments and purchases at 999 Mart.
 * Plain JavaScript, no build step, no outside libraries. Talks to the Apps Script web app in config.js.
 * Offline: new transactions wait on the phone and are sent automatically when the internet is back.
 * Security: all text is HTML-escaped before display; the server re-checks every request.
 */
(function () {
  'use strict';

  var CFG = window.CATAT_CONFIG || {};
  var DEMO = new URLSearchParams(location.search).get('demo') === '1' || !CFG.API_URL;
  var LS = DEMO ? 'c9demo.' : 'c9.';
  var PAY = ['Transfer Ibu', 'Uang Kasir', 'Modal'];
  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  var HR = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  var BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  var BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var BIG = 20000000;

  // ───────────── storage ─────────────
  function load(k, d) { try { var v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { } }
  function drop(k) { try { localStorage.removeItem(LS + k); } catch (e) { } }

  var S = {
    token: load('token', ''), user: load('user', null), boot: load('boot', null), queue: load('queue', []),
    usage: load('usage', {}), names: load('names', []), hist: load('hist', {}),
    device: load('device', ''), clock: load('clock', null), logoutLater: load('logoutLater', []), screen: 'home', form: null, month: '', query: '', busy: false, notice: ''
  };
  S.queue.forEach(function (o) { if (!o.token && S.token) { o.token = S.token; o.by = S.user ? S.user.name : ''; } });
  if (!S.device) { S.device = 'HP-' + Math.random().toString(36).slice(2, 8).toUpperCase(); save('device', S.device); }
  function deviceStr() {
    var m = /\(([^)]+)\)/.exec(navigator.userAgent || '');
    return S.device + (m ? ' · ' + m[1].split(';').slice(0, 3).join(';') : '');
  }

  // ───────────── helpers ─────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rp(n) { return 'Rp ' + Number(n || 0).toLocaleString('id-ID'); }
  function dots(n) { return n ? Number(n).toLocaleString('id-ID') : ''; }
  function uid() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function pad(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2] || 1, 12); }
  function phoneToday() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { return ymd(new Date()); }
  }
  // "Today" follows the server: cheap phones often have the wrong date. S.clock.shift = server date − phone date (days).
  function shiftNow() {
    var c = S.clock; if (!c || !c.shift) return 0;
    var age = Date.now() - c.at;
    return age >= 0 && age < 12 * 3600e3 ? c.shift : 0;   // stale after 12 h: the phone's clock may have been fixed since
  }
  function today() { var t = phoneToday(), k = shiftNow(); return k ? addDays(t, k) : t; }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function addMonths(ym, n) { var d = parse(ym + '-01'); d.setMonth(d.getMonth() + n); return ymd(d).slice(0, 7); }
  function longDate(s) { var d = parse(s); return HARI[d.getDay()] + ', ' + d.getDate() + ' ' + BLN[d.getMonth()] + ' ' + d.getFullYear(); }
  function shortDate(s) { var d = parse(s); return d.getDate() + ' ' + BLN[d.getMonth()]; }
  function dayHead(s) { var d = parse(s); return HARI[d.getDay()] + ', ' + d.getDate() + ' ' + BLN[d.getMonth()]; }
  function monthName(ym) { var d = parse(ym + '-01'); return BULAN[d.getMonth()] + ' ' + d.getFullYear(); }
  function hhmm(s) { return s ? s.slice(11, 16).replace(':', '.') : ''; }
  function backDays() { return (S.boot && S.boot.limits && S.boot.limits.backDays) || 60; }
  function editDays() { return (S.boot && S.boot.limits && S.boot.limits.editDays) || 3; }
  function isAdmin() { return S.user && S.user.role === 'ADMIN'; }

  var SAT = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  function terbilang(n) {
    n = Math.floor(n);
    if (n < 12) return SAT[n];
    if (n < 20) return terbilang(n - 10) + ' belas';
    if (n < 100) return terbilang(Math.floor(n / 10)) + ' puluh' + (n % 10 ? ' ' + terbilang(n % 10) : '');
    if (n < 200) return 'seratus' + (n - 100 ? ' ' + terbilang(n - 100) : '');
    if (n < 1000) return terbilang(Math.floor(n / 100)) + ' ratus' + (n % 100 ? ' ' + terbilang(n % 100) : '');
    if (n < 2000) return 'seribu' + (n - 1000 ? ' ' + terbilang(n - 1000) : '');
    if (n < 1e6) return terbilang(Math.floor(n / 1000)) + ' ribu' + (n % 1000 ? ' ' + terbilang(n % 1000) : '');
    if (n < 1e9) return terbilang(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + terbilang(n % 1e6) : '');
    return terbilang(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + terbilang(n % 1e9) : '');
  }
  function words(n) { if (!n) return ''; var t = terbilang(n) + ' rupiah'; return t.charAt(0).toUpperCase() + t.slice(1); }

  var toastTimer;
  function toast(msg, kind) {
    var t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.className = 'toast show ' + (kind || '');
    t.textContent = msg;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.className = 'toast'; }, 2800);
  }

  // ───────────── supplier search (same key as the server) ─────────────
  function key(s) { return String(s || '').toUpperCase().replace(/^\s*(PT|CV|UD)\b\.?/, '').replace(/[^A-Z0-9]/g, ''); }
  function bigrams(s) { var o = {}; for (var i = 0; i < s.length - 1; i++) { var b = s.substr(i, 2); o[b] = (o[b] || 0) + 1; } return o; }
  function dice(a, b) {
    if (!a || !b || a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    var A = bigrams(a), B = bigrams(b), x = 0; for (var k in A) if (B[k]) x += Math.min(A[k], B[k]);
    return 2 * x / (a.length + b.length - 2);
  }
  function score(q, name) {
    var kq = key(q), kn = key(name); if (!kq) return 0;
    if (kn === kq) return 1;
    if (kn.indexOf(kq) === 0) return 0.95;
    var strip = function (s) { return s.toUpperCase().replace(/^\s*(PT|CV|UD)\b\.?/, '').split(/[^A-Z0-9]+/).filter(Boolean); };
    var qw = strip(q), nw = strip(name);
    if (qw.length && qw.every(function (w) { return nw.some(function (x) { return x.indexOf(w) === 0; }); })) return 0.9;
    if (kn.indexOf(kq) >= 0) return 0.8;
    // typo tolerance ("yafnido" → YAFINDO): the whole name, or every typed word roughly matching a word of the name.
    // A typed word that matches nothing ("SETOR rokok", "YANTO plastik", "colamas INDAH SEJATI") means it is probably
    // something else, so the score stays a guess. Words like ANGSUR (installment) don't count against a name.
    // Tuned on 15,000 names typed in the 999 Mart ledgers 2022–2026.
    var words = qw.filter(function (w) { return !/^(ANGSUR|ANSGUR|BAYAR|TOKO)$/.test(w); });
    if (!words.length) return 0;
    var per = words.map(function (w) { return Math.max.apply(null, nw.map(function (x) { return x.indexOf(w) === 0 ? 1 : dice(w, x); }).concat(0)); });
    var cover = per.reduce(function (a, b) { return a + b; }, 0) / per.length;
    var best = Math.max(dice(kq, kn), dice(kq, kn.slice(0, kq.length + 2)), cover);
    if (words.length > 1 && Math.min.apply(null, per) < 0.5) best = Math.min(best, 0.6);
    return Math.min(best * 0.95, 0.79);
  }
  var SURE = 0.66;   // at or above: shown as an answer; below: only under "Mungkin maksudnya:"
  function suppliers() { return (S.boot && S.boot.suppliers) || []; }
  function findSupplier(n) { var k = key(n); var l = suppliers(); for (var i = 0; i < l.length; i++) if (key(l[i]) === k) return l[i]; return ''; }
  function searchScored(q) {
    return suppliers().map(function (s) { return { s: s, sc: score(q, s) }; }).filter(function (x) { return x.sc >= 0.35; })
      .sort(function (a, b) { return (b.sc - a.sc) || ((S.usage[b.s] || 0) - (S.usage[a.s] || 0)); }).slice(0, 6);
  }
  function search(q) { return searchScored(q).map(function (x) { return x.s; }); }
  // For "Maksudnya yang ini?": a guess is only offered when every typed word is at least loosely in the name
  // (a typo "DAYLIS" for DAILYS, a piece "KU" of ADAKU). A word that isn't there at all ("SETOR rokok", "INDAH SEJATI")
  // means it is something else, so it is saved as the new name instead of being merged into another supplier.
  function bag(a, b) { var c = {}, x = 0, i; for (i = 0; i < a.length; i++) c[a[i]] = (c[a[i]] || 0) + 1; for (i = 0; i < b.length; i++) if (c[b[i]]) { c[b[i]]--; x++; } return 2 * x / (a.length + b.length); }
  function wordsFit(q, name) {
    var split = function (s) { return s.toUpperCase().replace(/^\s*(PT|CV|UD)\b\.?/, '').split(/[^A-Z0-9]+/).filter(Boolean); };
    var qw = split(q).filter(function (w) { return !/^(ANGSUR|ANSGUR|BAYAR|TOKO|PT|CV|UD)$/.test(w); }), nw = split(name);
    if (qw.length < 2) return true;
    return qw.every(function (w) {
      return nw.some(function (x) { return x.indexOf(w) === 0 || dice(w, x) >= 0.5 || (w.length >= 4 && x.length >= 4 && bag(w, x) >= 0.8) || (w.length >= 2 && x.indexOf(w) > 0); });
    });
  }
  function frequent() {
    var out = [];
    Object.keys(S.usage).sort(function (a, b) { return S.usage[b] - S.usage[a]; }).concat((S.boot && S.boot.frequent) || [], suppliers())
      .forEach(function (n) { if (out.length < 6 && out.indexOf(n) < 0 && findSupplier(n)) out.push(n); });
    return out;
  }

  // ───────────── API ─────────────
  function api(action, payload) {
    var body = Object.assign({ action: action, token: S.token, device: deviceStr() }, payload || {});
    if (DEMO) return window.CatatMockApi.handle(body);
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
    return fetch(CFG.API_URL, {
      method: 'POST', redirect: 'follow', credentials: 'omit', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body)
    }).then(function (r) {
      clearTimeout(timer);
      // a Google login page or an error page instead of data = the app is not connected to the script properly
      if (!r.ok) { var he = new Error('SERVER'); he.server = true; throw he; }
      return r.json().catch(function () { var je = new Error('SERVER'); je.server = true; throw je; });
    }, function () { clearTimeout(timer); var err = new Error('NETWORK'); err.network = true; throw err; });
  }
  var SERVER_MSG = 'Server tidak menjawab dengan benar. Coba lagi nanti; kalau terus begini, kabari Ibu.';
  function isNet(e) { return e && (e.network || e.message === 'NETWORK'); }
  function authFail(res) {
    if (res && res.code === 'AUTH') {
      S.token = ''; S.user = null; drop('token'); drop('user');
      S.notice = 'Sesi habis. Silakan masuk lagi.';
      closeSheet(); go('login', true);
      return true;
    }
    return false;
  }
  function refresh(quiet) {
    if (!S.token) return Promise.resolve();
    return api('boot').then(function (r) {
      if (authFail(r)) return;
      if (!r.ok) { if (!quiet) toast(r.error || 'Gagal memuat data', 'err'); return; }
      r.fetchedAt = new Date().toISOString(); S.boot = r; save('boot', r);
      if (/^\d{4}-\d{2}-\d{2}$/.test(r.today || '')) { S.clock = { shift: daysBetween(phoneToday(), r.today), at: Date.now() }; save('clock', S.clock); }
      rerenderIf(['home']);   // not under an open dialog (it would lose the button focus returns to)
    }, function (e) { if (!quiet) toast((e && e.server ? 'Server sedang gangguan.' : 'Tidak ada koneksi internet.') + ' Memakai data terakhir.', 'err'); });
  }

  // ───────────── offline queue (new transactions only) ─────────────
  function persistQueue() { save('queue', S.queue); }
  var flushing = false;
  function flush() {
    if (flushing) return Promise.resolve();
    var now = Date.now();
    var next = S.queue.filter(function (o) { return o.state === 'waiting' && (o.token || S.token) && !(o.retryAt > now); })[0];
    if (!next) return Promise.resolve();
    flushing = true;
    var tok = next.token || S.token;   // sent as the person who recorded it, even if someone else is logged in now
    return api('add', { entry: next.entry, force: !!next.force, token: tok }).then(function (r) {
      flushing = false;
      if (r && r.code === 'AUTH') {
        if (tok === S.token) { authFail(r); return; }
        // the recorder's session has ended: send with the current login, keeping the recorder's name in the note
        if (!S.token) return;
        next.token = S.token;
        if (next.by && (!S.user || next.by !== S.user.name)) next.entry.note = ((next.entry.note ? next.entry.note + ' · ' : '') + 'dicatat oleh ' + next.by).slice(0, 200);
        persistQueue(); return flush();
      }
      if (r.ok) {
        S.queue = S.queue.filter(function (o) { return o.qid !== next.qid; }); persistQueue();
        outdated(next.entry.date.slice(0, 7));
        endLaterSessions();
        if (!S.queue.length) toast('Transaksi yang tertunda sudah terkirim ✓', 'ok');
        return refresh(true).then(function () { rerenderIf(['home', 'history']); return flush(); });
      }
      if (r.code === 'DUP_INVOICE' || r.code === 'DUP_SIMILAR') { next.state = 'conflict'; next.existing = r.existing || null; }
      else if (r.code === 'INVALID' || /ID transaksi/.test(r.error || '')) next.state = 'invalid';
      else { next.retryAt = Date.now() + 60000; persistQueue(); return; }   // busy / too fast / server hiccup: try again in a minute
      next.error = r.error || 'Gagal';
      persistQueue(); endLaterSessions(); rerenderIf(['home', 'history']);
      return flush();
    }, function () { flushing = false; });
  }
  // A worker who logged out while entries were still waiting: end that session on the server once they are sent.
  function endLaterSessions() {
    S.logoutLater = S.logoutLater.filter(function (t) {
      if (S.queue.some(function (o) { return o.token === t && o.state === 'waiting'; })) return true;
      api('logout', { token: t }).catch(function () { });
      return false;
    });
    save('logoutLater', S.logoutLater);
  }
  function rerenderIf(list) { if (list.indexOf(S.screen) >= 0 && !$('#ov')) render(); }
  window.addEventListener('online', function () { flush(); if (S.screen === 'history') { failedAt = {}; loadMonth(S.month || today().slice(0, 7)); } });
  setInterval(function () { if (navigator.onLine !== false) flush(); }, 30000);

  // ───────────── navigation (phone back button works) ─────────────
  function go(screen, replace) {
    if (S.screen === 'done') replace = true; // the success screen is never a back-button target
    S.screen = screen;
    var tt = $('#toast'); if (tt) tt.className = 'toast';
    try { history[replace ? 'replaceState' : 'pushState']({ s: screen }, '', location.pathname + location.search); } catch (e) { }
    render(); window.scrollTo(0, 0);
    focusTitle();
  }
  // Screen readers: a new screen announces its title (unless the screen already put the cursor in a field).
  function focusTitle() {
    var a = document.activeElement;
    if (a && a !== document.body && document.body.contains(a) && a.matches('input, textarea')) return;
    var h = $('.bar h1') || $('.done h2'); if (!h) return;
    h.setAttribute('tabindex', '-1');
    try { h.focus({ preventScroll: true }); } catch (e) { }
  }
  window.addEventListener('popstate', function (e) {
    if ($('#ov')) { closeSheet(); try { history.pushState({ s: S.screen }, '', location.pathname + location.search); } catch (x) { } return; }
    var to = (e.state && e.state.s) || 'home';
    if (to === 'done' || ((to === 'form' || to === 'review') && !S.form)) to = 'home';
    if (S.screen === 'form' && formDirty()) {
      try { history.pushState({ s: 'form' }, '', location.pathname + location.search); } catch (x) { }
      askLeaveForm(); return;
    }
    if (!S.token) to = 'login';
    S.screen = to; render(); window.scrollTo(0, 0);
  });

  // ───────────── render ─────────────
  var app = $('#app');
  function bar(title, back) {
    return '<header class="bar">' + (back ? '<button class="back" data-act="back" aria-label="Kembali">←</button>' : '') +
      '<h1>' + esc(title) + '</h1>' +
      (S.user && !back ? '<span class="who">' + esc(S.user.name) + (isAdmin() ? ' <span class="tag">Admin</span>' : '') + '</span>' : '') + '</header>';
  }
  function render() {
    if (!S.token) S.screen = 'login';
    if ((S.screen === 'form' || S.screen === 'review') && !S.form) S.screen = 'home';
    if (S.screen === 'done' && !lastSaved) S.screen = 'home';
    var v = { login: vLogin, form: vForm, review: vReview, done: vDone, history: vHistory }[S.screen] || vHome;
    app.innerHTML = v();
    after();
  }

  // ── login ──
  function vLogin() {
    var last = S.names[0] || '';
    var h = bar('Catat 999');
    if (S.notice) h += '<div class="banner warn">' + esc(S.notice) + '</div>';
    h += '<form class="card stack" id="loginForm" autocomplete="on" novalidate>' +
      '<h2 class="h2">Masuk</h2>' +
      '<label class="lbl" for="lname">Nama</label>' +
      '<input class="in" id="lname" name="username" autocomplete="username" autocapitalize="words" maxlength="30" placeholder="Nama Anda" value="' + esc(last) + '">' +
      (S.names.length > 1 ? '<div class="chips">' + S.names.slice(0, 4).map(function (n) { return '<button type="button" class="chip" data-act="usename" data-v="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div>' : '') +
      '<label class="lbl" for="lpw">Kata sandi</label>' +
      '<div class="pw"><input class="in" id="lpw" name="password" type="password" autocomplete="current-password" maxlength="100" placeholder="Kata sandi">' +
      '<button type="button" class="eye" data-act="eye">Lihat</button></div>' +
      '<div class="err-msg" id="loginErr" role="alert"></div>' +
      '<button class="btn primary" id="loginBtn" type="submit">Masuk</button></form>';
    return h;
  }
  function doLogin() {
    if ($('#loginBtn').disabled) return;   // Enter pressed again while the first try is still on its way
    var name = $('#lname').value.trim(), pw = $('#lpw').value, err = $('#loginErr');
    if (!/^[A-Za-z][A-Za-z .'\-]{1,29}$/.test(name)) { err.textContent = 'Isi nama Anda (huruf saja).'; $('#lname').focus(); return; }
    if (!pw) { err.textContent = 'Isi kata sandi.'; $('#lpw').focus(); return; }
    setBusy('#loginBtn', 'Masuk…');
    api('login', { name: name, password: pw }).then(function (r) {
      if (!r.ok) { unBusy('#loginBtn', 'Masuk'); err.textContent = r.error || 'Gagal masuk.'; $('#lpw').value = ''; $('#lpw').focus(); return; }
      S.token = r.token; S.user = { name: r.name, role: r.role }; S.notice = '';
      save('token', S.token); save('user', S.user);
      S.names = [r.name].concat(S.names.filter(function (n) { return n !== r.name; })).slice(0, 5); save('names', S.names);
      go(S.form ? 'form' : 'home', true); toast('Selamat datang, ' + r.name, 'ok');
      refresh(true).then(flush);
    }, function (e) { unBusy('#loginBtn', 'Masuk'); err.textContent = e && e.server ? SERVER_MSG : 'Tidak ada koneksi internet. Coba lagi.'; });
  }

  // ── home ──
  function vHome() {
    var waiting = S.queue.filter(function (o) { return o.state === 'waiting'; }).length;
    var conflicts = S.queue.filter(function (o) { return o.state === 'conflict' || o.state === 'invalid'; }).length;
    var b = S.boot || {};
    var h = bar('Catat 999');
    if (DEMO) h += '<div class="banner info"><b>Mode coba.</b> Data hanya di HP ini, tidak masuk ke spreadsheet.</div>';
    var refused = S.queue.some(function (o) { return o.state === 'invalid'; });
    if (conflicts) h += '<div class="banner err"><b>' + conflicts + ' transaksi perlu dicek</b> — ' + (refused ? 'buka Riwayat untuk melihat kenapa.' : 'mungkin tercatat dua kali.') + '<button class="btn small danger" data-act="history">Lihat</button></div>';
    if (shiftNow()) h += '<div class="banner warn"><b>Tanggal di HP ini salah.</b> Aplikasi memakai tanggal yang benar: ' + esc(longDate(today())) + '.</div>';
    if (waiting) h += '<div class="banner warn"><b>' + waiting + ' transaksi belum terkirim.</b> Akan dikirim otomatis saat ada internet.<button class="btn small outline" data-act="flush">Kirim sekarang</button></div>';
    h += '<button class="tile big" data-act="new"><span class="ic plus" aria-hidden="true">+</span><span class="t"><b>Catat Transaksi</b><span>Bayar supplier atau belanja</span></span></button>';
    h += '<button class="tile" data-act="history"><span class="ic" aria-hidden="true">📋</span><span class="t"><b>Riwayat Transaksi</b><span>Lihat, ubah, atau hapus</span></span>' +
      '<span class="num">' + (b.todayCount || 0) + '<small>hari ini</small></span></button>';
    h += '<div class="foot">' + (b.fetchedAt ? 'Diperbarui ' + esc(hhmm(new Date(new Date(b.fetchedAt).getTime() + 7 * 3600e3).toISOString())) + ' · ' : '') +
      '<button data-act="refresh">Muat ulang</button> · <button data-act="logout">Keluar</button>' +
      (installEvt ? ' · <button data-act="install">Pasang di HP</button>' : '') + '</div>';
    return h;
  }

  // ── form (new + edit) ──
  function newForm(src) {
    var f = { mode: 'new', id: '', name: '', isNew: false, invoice: '', amount: 0, paidFrom: '', other: '', date: today(), note: '', q: '', errors: {}, orig: null };
    if (src) {
      var m = /^Lainnya: (.*)$/.exec(src.paidFrom || '');
      // a pay source typed by hand in the Sheet (e.g. "Cash") isn't one of the buttons: ask again instead of failing at the server
      var known = m || PAY.indexOf(src.paidFrom) >= 0;
      Object.assign(f, { mode: 'edit', id: src.id, name: src.name, invoice: src.invoice || '', amount: src.amount, paidFrom: m ? 'Lainnya' : known ? src.paidFrom : '',
        other: m ? m[1] : '', date: src.date, note: src.note || '', orig: src });
    }
    return f;
  }
  function formDirty() {
    var f = S.form; if (!f) return false;
    if (f.mode === 'edit') return JSON.stringify(entryFromForm()) !== JSON.stringify(entryFromOrig(f.orig));
    return !!(f.name || f.amount || f.invoice || f.note || f.q);
  }
  // forId: the field this label belongs to (a real <label for>); without it the step is a named group of buttons
  function step(n, id, label, opt, inner, err, forId) {
    var lab = '<span class="n" aria-hidden="true">' + n + '</span>' + label + (opt ? ' <span class="opt">(opsional)</span>' : '');
    return '<section class="step' + (err ? ' has-err' : '') + '" id="' + id + '"' + (forId ? '' : ' role="group" aria-labelledby="' + id + '-l"') + '>' +
      (forId ? '<label class="lbl" id="' + id + '-l" for="' + forId + '">' + lab + '</label>' : '<div class="lbl" id="' + id + '-l">' + lab + '</div>') +
      inner + (err ? '<div class="err-msg" id="' + id + '-e" role="alert">' + esc(err) + '</div>' : '') + '</section>';
  }
  function vForm() {
    var f = S.form, e = f.errors, t = today();
    var h = bar(f.mode === 'edit' ? 'Ubah Transaksi' : 'Catat Transaksi', true);
    // 1 name
    var nameHtml;
    if (f.name) nameHtml = '<div class="picked"><b>' + esc(f.name) + (f.isNew ? ' <span class="new">BARU</span>' : '') + '</b><button class="btn small outline" data-act="unpick">Ganti</button></div>';
    else nameHtml = '<input class="in" id="q" autocomplete="off" autocapitalize="characters" maxlength="60" placeholder="Cari nama PT / barang…" value="' + esc(f.q) + '"><div id="sugg"></div>' +
      (f.q ? '' : '<div class="hint">Sering dipakai:</div><div class="chips" id="freq">' + frequent().map(function (n) { return '<button class="chip" data-act="pick" data-v="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') + '</div>');
    h += step(1, 'st-name', 'Nama PT / Barang', false, nameHtml, e.name, f.name ? '' : 'q');
    // 2 invoice
    h += step(2, 'st-inv', 'No. Invoice', true, '<input class="in" id="inv" autocomplete="off" autocapitalize="characters" maxlength="30" placeholder="Lihat di kertas invoice" value="' + esc(f.invoice) + '">' +
      '<div class="hint">Kosongkan kalau tidak ada invoice.</div>', e.invoice, 'inv');
    // 3 amount
    h += step(3, 'st-amt', 'Nominal', false, '<div class="amount-wrap"><span class="rp">Rp</span><input class="in amount" id="amt" inputmode="numeric" autocomplete="off" maxlength="13" placeholder="0" value="' + esc(dots(f.amount)) + '"></div>' +
      '<div class="words" id="words" aria-live="polite">' + esc(words(f.amount)) + '</div>', e.amount, 'amt');
    // 4 paid from
    var pay = '<div class="choices">' + PAY.concat(['Lainnya']).map(function (p) { return '<button class="choice' + (f.paidFrom === p ? ' on' : '') + '" data-act="from" data-v="' + esc(p) + '" aria-pressed="' + (f.paidFrom === p) + '">' + esc(p) + '</button>'; }).join('') + '</div>' +
      (f.paidFrom === 'Lainnya' ? '<input class="in mt" id="other" aria-label="Uang siapa" autocapitalize="characters" maxlength="30" placeholder="Uang siapa? Contoh: Bujang" value="' + esc(f.other) + '">' : '');
    h += step(4, 'st-from', 'Bayar pakai', false, pay, e.paidFrom);
    // 5 date
    var y = addDays(t, -1), other = f.date !== t && f.date !== y;
    var dateHtml = '<div class="choices three">' +
      '<button class="choice' + (f.date === t ? ' on' : '') + '" aria-pressed="' + (f.date === t) + '" data-act="date" data-v="' + t + '">Hari ini<small>' + shortDate(t) + '</small></button>' +
      '<button class="choice' + (f.date === y ? ' on' : '') + '" aria-pressed="' + (f.date === y) + '" data-act="date" data-v="' + y + '">Kemarin<small>' + shortDate(y) + '</small></button>' +
      '<button class="choice' + (other ? ' on' : '') + '" data-act="cal">' + (other ? shortDate(f.date) + '<small>ganti</small>' : 'Pilih<small>tanggal</small>') + '</button></div>' +
      '<div class="hint strong">' + esc(longDate(f.date)) + '</div>';
    h += step(5, 'st-date', 'Tanggal', false, dateHtml, e.date);
    // 6 note
    h += step(6, 'st-note', 'Catatan', true, '<textarea class="in" id="note" maxlength="200" placeholder="Contoh: retur 2 dus">' + esc(f.note) + '</textarea>', '', 'note');
    h += '<div class="actionbar"><button class="btn primary" data-act="toReview">Lanjut</button></div>';
    return h;
  }
  function renderSugg() {
    var box = $('#sugg'); if (!box) return;
    var q = S.form.q.trim();
    if (!q) { box.innerHTML = ''; return; }
    var res = searchScored(q);
    var exact = res.some(function (x) { return key(x.s) === key(q); });
    var btn = function (x) { return '<button data-act="pick" data-v="' + esc(x.s) + '">' + esc(x.s) + '</button>'; };
    var sure = res.filter(function (x) { return x.sc >= SURE; }), guess = res.filter(function (x) { return x.sc < SURE; }).slice(0, 3);
    // only confident matches come first; guesses sit below "+ Tambah", so a quick first tap never picks a wrong supplier
    box.innerHTML = '<div class="sugg">' + sure.map(btn).join('') +
      (!exact && key(q).length >= 2 ? '<button class="add" data-act="addnew">+ Tambah "' + esc(q.toUpperCase()) + '"<small>Kalau tidak ada di daftar</small></button>' : '') +
      (guess.length ? '<div class="sugg-head">Mungkin maksudnya:</div>' + guess.map(btn).join('') : '') +
      (!res.length && key(q).length < 2 ? '<div class="sugg-empty">Ketik minimal 2 huruf</div>' : '') + '</div>';
  }
  function collect() {
    var f = S.form; if (!f) return;
    var g = function (id) { var el = $('#' + id); return el ? el.value : null; };
    if (g('inv') !== null) f.invoice = g('inv').trim().toUpperCase().replace(/\s+/g, '');
    if (g('note') !== null) f.note = g('note').trim();
    if (g('other') !== null) f.other = g('other').trim().toUpperCase();
    if (g('q') !== null) f.q = g('q');
  }
  function validate() {
    var f = S.form, e = {}, t = today();
    if (!f.name) e.name = f.q.trim() ? 'Pilih dari daftar, atau ketuk "+ Tambah".' : 'Wajib diisi.';
    if (f.invoice && !/^[A-Z0-9\-\/.]{1,30}$/.test(f.invoice)) e.invoice = 'Hanya huruf, angka, - dan /.';
    if (!f.amount) e.amount = 'Wajib diisi.';
    else if (f.amount > ((S.boot && S.boot.limits && S.boot.limits.maxAmount) || 500000000)) e.amount = 'Nominal terlalu besar. Cek lagi.';
    if (!f.paidFrom) e.paidFrom = 'Wajib diisi.';
    else if (f.paidFrom === 'Lainnya' && !/^[A-Z][A-Z .'\-]{0,29}$/.test(f.other)) e.paidFrom = 'Tulis uang siapa (huruf saja).';
    if (f.date > t) e.date = 'Tidak boleh lebih dari hari ini.';
    else if (f.date < addDays(t, -backDays()) && !(f.mode === 'edit' && f.orig && f.date === f.orig.date)) e.date = 'Terlalu lama. Minta Ibu untuk mencatat.';   // same rule as the server: an unchanged date is fine
    f.errors = e;
    return !Object.keys(e).length;
  }
  function entryFromForm() {
    var f = S.form;
    return { id: f.id, date: f.date, name: f.name, invoice: f.invoice, amount: f.amount, paidFrom: f.paidFrom === 'Lainnya' ? 'Lainnya: ' + f.other : f.paidFrom, note: f.note };
  }
  function entryFromOrig(o) { return { id: o.id, date: o.date, name: o.name, invoice: o.invoice || '', amount: o.amount, paidFrom: o.paidFrom, note: o.note || '' }; }

  // ── review ──
  function vReview() {
    var en = entryFromForm(), f = S.form, o = f.mode === 'edit' ? entryFromOrig(f.orig) : null;
    var ch = function (k) { return o && String(o[k]) !== String(en[k]) ? ' <span class="changed">diubah</span>' : ''; };
    // warnings go above the slip: the pinned Simpan button would otherwise hide them below the fold
    var warn = (en.amount >= BIG ? '<div class="banner err"><b>Nominal besar: ' + rp(en.amount) + '.</b> Pastikan jumlah angka nolnya benar.</div>' : '') +
      (o && !formDirty() ? '<div class="banner info">Belum ada yang diubah.</div>' : '');
    var h = bar('Cek Lagi', true) + warn + '<div class="hint center">Samakan dengan kertas invoice / nota.</div><div class="card review"><dl>' +
      '<dt>Nama PT / Barang' + ch('name') + '</dt><dd>' + esc(en.name) + '</dd>' +
      '<dt>No. Invoice' + ch('invoice') + '</dt><dd>' + (en.invoice ? esc(en.invoice) : '<span class="muted">—</span>') + '</dd>' +
      '<dt>Nominal' + ch('amount') + '</dt><dd class="money">' + rp(en.amount) + '<span class="words-sm">' + esc(words(en.amount)) + '</span></dd>' +
      '<dt>Bayar pakai' + ch('paidFrom') + '</dt><dd>' + esc(en.paidFrom) + '</dd>' +
      '<dt>Tanggal' + ch('date') + '</dt><dd>' + esc(longDate(en.date)) + '</dd>' +
      (en.note || (o && o.note) ? '<dt>Catatan' + ch('note') + '</dt><dd class="note">' + (en.note ? esc(en.note) : '<span class="muted">—</span>') + '</dd>' : '') +
      '</dl></div>';
    h += '<div class="actionbar stack"><button class="btn primary" id="saveBtn" data-act="save"' + (o && !formDirty() ? ' disabled' : '') + '>' + (o ? 'Simpan Perubahan' : 'Simpan') + '</button>' +
      '<button class="btn outline" data-act="back">Kembali</button></div>';
    return h;
  }

  var lastSaved = null;
  function doSave(force) {
    if (S.busy) return;
    var f = S.form, en = entryFromForm();
    if (f.mode === 'new' && !f.id) f.id = en.id = uid();
    S.busy = true; setBusy('#saveBtn', 'Menyimpan…');
    var req = f.mode === 'edit' ? api('update', { id: f.id, entry: en, force: !!force }) : api('add', { entry: en, force: !!force });
    req.then(function (r) {
      S.busy = false;
      if (authFail(r)) return;
      if (r.ok) { saved(r.entry ? Object.assign({}, en, r.entry) : en, false); return; }   // show what the server actually stored (cleaned name etc.)
      unBusy('#saveBtn', f.mode === 'edit' ? 'Simpan Perubahan' : 'Simpan');
      if (r.code === 'DUP_INVOICE' || r.code === 'DUP_SIMILAR') { dupSheet(r, function () { doSave(true); }); return; }
      toast(r.error || 'Gagal menyimpan.', 'err');
    }, function (e) {
      S.busy = false;
      if (f.mode === 'new' && (isNet(e) || (e && e.server))) {   // keep it on the phone and retry (same id → never saved twice)
        S.queue.push({ qid: uid(), state: 'waiting', entry: en, force: !!force, token: S.token, by: S.user ? S.user.name : '' }); persistQueue();
        saved(en, true); return;
      }
      unBusy('#saveBtn', f.mode === 'edit' ? 'Simpan Perubahan' : 'Simpan');
      toast(isNet(e) ? 'Tidak ada koneksi internet. Coba lagi nanti.' : e && e.server ? SERVER_MSG : 'Gagal menyimpan. Coba lagi.', 'err');
    });
  }
  function saved(en, offline) {
    S.usage[en.name] = (S.usage[en.name] || 0) + 1; save('usage', S.usage);
    if (S.form && S.form.orig) patchCache(S.form.orig, en);
    outdated(en.date.slice(0, 7));
    lastSaved = { entry: en, offline: offline, edit: S.form && S.form.mode === 'edit' };
    if (lastSaved.edit) S.month = en.date.slice(0, 7);
    S.form = null;
    go('done', true);
    if (!offline) refresh(true).then(flush);
  }
  function vDone() {
    var l = lastSaved || { entry: {} }, en = l.entry;
    var title = l.offline ? 'Belum terkirim' : l.edit ? 'Perubahan disimpan' : 'Berhasil disimpan';
    return bar(title) + '<div class="done"><div class="ok ' + (l.offline ? 'wait' : '') + '">' + (l.offline ? '⏳' : '✓') + '</div><h2>' + esc(title) + '</h2>' +
      '<p class="hint big">' + (l.offline ? 'Belum masuk ke spreadsheet (tidak ada internet atau server sedang gangguan). Transaksi tersimpan di HP dan akan dikirim otomatis.' : 'Sudah masuk ke spreadsheet.') + '</p>' +
      '<div class="card left"><b>' + esc(en.name) + '</b><div class="meta">' + rp(en.amount) + ' · ' + esc(en.paidFrom) + ' · ' + esc(shortDate(en.date || today())) + '</div></div></div>' +
      (l.edit ? '<div class="stack"><button class="btn primary" data-act="history" data-v="keep">Kembali ke Riwayat</button><button class="btn outline" data-act="home">Ke Beranda</button></div>'
        : '<div class="stack"><button class="btn primary" data-act="new"><span class="plus-s">+</span> Catat Lagi</button><button class="btn outline" data-act="home">Ke Beranda</button></div>');
  }

  // ── history ──
  function vHistory() {
    var ym = S.month || today().slice(0, 7), cur = today().slice(0, 7);
    var data = S.hist[ym];
    var h = bar('Riwayat Transaksi', true);
    h += '<div class="monthnav"><button class="btn small outline" data-act="month" data-v="-1" aria-label="Bulan sebelumnya">‹ ' + esc(BLN[parse(addMonths(ym, -1) + '-01').getMonth()]) + '</button>' +
      '<b>' + esc(monthName(ym)) + '</b>' +
      '<button class="btn small outline" data-act="month" data-v="1"' + (ym >= cur ? ' disabled' : '') + ' aria-label="Bulan berikutnya">' + esc(BLN[parse(addMonths(ym, 1) + '-01').getMonth()]) + ' ›</button></div>';
    h += '<input class="in search" id="hq" type="search" aria-label="Cari transaksi (nama PT atau no. invoice)" autocomplete="off" placeholder="Cari nama PT / no. invoice" value="' + esc(S.query) + '">';
    return h + '<div id="pend">' + pendList(ym) + '</div><div id="hlist">' + histList(ym, data) + '</div>';
  }
  // Entries still on this phone: conflicts first ("Perlu dicek"), then waiting for internet. Follows the search box.
  function pendList(ym) {
    var h = '';
    var qk = key(S.query);
    var check = function (o) { return o.state === 'conflict' || o.state === 'invalid'; };
    var pend = S.queue.filter(function (o) { return (o.entry.date.slice(0, 7) === ym || check(o)) && (!qk || key(o.entry.name).indexOf(qk) >= 0 || key(o.entry.invoice).indexOf(qk) >= 0); })
      .sort(function (a, b) { return (check(a) ? 0 : 1) - (check(b) ? 0 : 1); });
    if (pend.length) {
      var lastHead = '';
      h += pend.map(function (o) {
        var head = check(o) ? 'Perlu dicek' : 'Belum terkirim';
        var hh = head !== lastHead ? '<div class="group-head ' + (check(o) ? 'err' : 'warn') + '">' + head + '</div>' : '';
        lastHead = head;
        var acts;
        if (o.state === 'conflict') acts = '<div class="err-msg">' + esc(o.error) + (o.existing ? ' (sudah dicatat ' + esc(shortDate(o.existing.date)) + ' oleh ' + esc(o.existing.by) + ', ' + rp(o.existing.amount) + ')' : '') + '</div>' +
          '<div class="acts"><button class="btn small primary" data-act="qdrop" data-v="' + esc(o.qid) + '">Buang, sudah dicatat</button><button class="btn small outline" data-act="qforce" data-v="' + esc(o.qid) + '">Beda, tetap simpan</button></div>';
        else if (o.state === 'invalid') acts = '<div class="err-msg">Ditolak server: ' + esc(o.error) + ' Catat ulang dengan benar, lalu buang yang ini.</div>' +
          '<div class="acts"><button class="btn small outline" data-act="qdrop" data-v="' + esc(o.qid) + '">Buang</button></div>';
        else acts = '<div class="acts"><span class="badge wait">' + (o.retryAt ? 'Dicoba lagi sebentar' : 'Menunggu internet') + '</span><button class="btn small outline" data-act="qdrop" data-v="' + esc(o.qid) + '">Batalkan</button></div>';
        return hh + '<div class="item' + (check(o) ? ' conflict' : '') + '"><div class="top"><div class="nm">' + esc(o.entry.name) + '</div><div class="amt">' + rp(o.entry.amount) + '</div></div>' +
          '<div class="meta">' + esc(o.entry.paidFrom) + ' · ' + esc(shortDate(o.entry.date)) + (o.by ? ' · ' + esc(o.by) : '') + '</div>' + acts + '</div>';
      }).join('');
    }
    return h;
  }
  function histList(ym, data) {
    var h = '';
    if (!data) return '<div class="spinner" aria-label="Memuat"></div>';
    if (data.failed) return '<div class="banner err">' + esc(data.failed) + ' Riwayat bulan ini belum bisa dimuat.<button class="btn small outline" data-act="reload">Coba lagi</button></div>';
    if (data.stale) h += '<div class="banner warn">' + esc(data.stale) + ' Menampilkan data terakhir.<button class="btn small outline" data-act="reload">Coba lagi</button></div>';
    var q = key(S.query), list = data.entries.filter(function (e) { return !q || key(e.name).indexOf(q) >= 0 || key(e.invoice).indexOf(q) >= 0 || score(S.query, e.name) >= 0.6; });
    var total = list.reduce(function (s, e) { return s + e.amount; }, 0);
    h += '<div class="card total"><div class="hint">' + (q ? 'Hasil cari · ' : 'Total ' + esc(monthName(ym)) + ' · ') + list.length + ' transaksi</div><div class="big">' + rp(total) + '</div></div>';
    if (!list.length) return h + '<div class="empty">' + (q ? 'Tidak ada yang cocok. Coba ketik sebagian nama atau nomor saja.' : 'Belum ada transaksi bulan ini. Ketuk ‹ untuk melihat bulan sebelumnya.') + '</div>';
    var day = null;
    list.forEach(function (e) {
      if (e.date !== day) {
        day = e.date;
        var dt = list.filter(function (x) { return x.date === day; }).reduce(function (s, x) { return s + x.amount; }, 0);
        h += '<div class="group-head"><span>' + esc(dayHead(day)) + '</span><span>' + rp(dt) + '</span></div>';
      }
      h += '<button class="item tap" data-act="detail" data-v="' + esc(e.id) + '"><div class="top"><div class="nm">' + esc(e.name) + '</div><div class="amt">' + rp(e.amount) + '</div></div>' +
        '<div class="meta">' + esc(e.paidFrom) + (e.invoice ? ' · Inv ' + esc(e.invoice) : '') + ' · ' + esc(e.by) + ' ' + esc(hhmm(e.at)) + (e.editedBy ? ' · <i>diubah</i>' : '') + '</div></button>';
    });
    return h;
  }
  // Month cache: shown at once (also offline), refreshed in the background when older than a minute.
  var loading = {}, failedAt = {};
  function curMonth() { return S.month || today().slice(0, 7); }
  function needLoad(ym) {
    var c = S.hist[ym];
    if (loading[ym] || (failedAt[ym] && Date.now() - failedAt[ym] < 15000)) return false;
    return !c || !!c.stale || !!c.failed || Date.now() - (c.at || 0) > 60000;
  }
  function redrawList(ym) {
    if (S.screen !== 'history' || curMonth() !== ym || $('#ov')) return;
    var box = $('#hlist'); if (box) box.innerHTML = histList(ym, S.hist[ym]); else render();
  }
  function loadMonth(ym) {
    if (loading[ym]) return;
    loading[ym] = true;
    api('list', { month: ym }).then(function (r) {
      loading[ym] = false;
      if (authFail(r)) return;
      if (!r.ok) { failedAt[ym] = Date.now(); loadFailed(ym, r.error || 'Gagal memuat riwayat.'); return; }
      delete failedAt[ym];
      S.hist[ym] = { entries: r.entries, total: r.total, at: Date.now() }; save('hist', trimHist(ym));
      redrawList(ym);
    }, function (e) { loading[ym] = false; failedAt[ym] = Date.now(); loadFailed(ym, e && e.server ? 'Server sedang gangguan.' : 'Tidak ada koneksi internet.'); });
  }
  function loadFailed(ym, msg) {
    var c = S.hist[ym];
    S.hist[ym] = c && c.entries ? Object.assign({}, c, { stale: msg, failed: '' }) : { failed: msg };
    redrawList(ym);
  }
  function outdated(ym) { var c = S.hist[ym]; if (c && c.entries) { c.at = 0; save('hist', S.hist); } }
  // Show an edit or delete in the list right away; the background refresh then confirms it.
  function patchCache(orig, en) {
    var ym = orig.date.slice(0, 7), c = S.hist[ym]; if (!c || !c.entries) return;
    c.entries = c.entries.filter(function (x) { return x.id !== orig.id; });
    if (en && en.date.slice(0, 7) === ym) {
      c.entries.push(Object.assign({}, orig, en, { editedBy: S.user ? S.user.name : '', editedAt: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 19) }));
      c.entries.sort(function (x, y) { return x.date !== y.date ? (x.date < y.date ? 1 : -1) : (x.at < y.at ? 1 : -1); });
    }
    c.total = c.entries.reduce(function (s, x) { return s + x.amount; }, 0); c.at = 0;
    save('hist', S.hist);
  }
  // keep at most 3 months on the phone: the one just loaded (it is on screen) plus the newest others
  function trimHist(keep) {
    var ks = Object.keys(S.hist).sort().reverse().filter(function (k) { return k !== keep; }).slice(0, keep && S.hist[keep] ? 2 : 3);
    if (keep && S.hist[keep]) ks.push(keep);
    var o = {}; ks.forEach(function (k) { o[k] = S.hist[k]; }); S.hist = o; return o;
  }
  function findEntry(id) { var ym = S.month || today().slice(0, 7); return ((S.hist[ym] && S.hist[ym].entries) || []).filter(function (e) { return e.id === id; })[0]; }

  // ───────────── bottom sheets ─────────────
  var sheetReturn = null;
  function openSheet(html, onClick) {
    if (!$('#ov')) sheetReturn = document.activeElement;
    closeSheet(true);
    var tt = $('#toast'); if (tt) tt.className = 'toast';
    var o = document.createElement('div'); o.className = 'overlay'; o.id = 'ov';
    o.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(o);
    var head = o.querySelector('h2, .sheet-title b');
    if (head) { head.id = 'ov-title'; o.firstChild.setAttribute('aria-labelledby', 'ov-title'); }
    var first = o.querySelector('button:not([disabled])'); if (first) first.focus({ preventScroll: true });
    o.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { closeSheet(); return; }
      if (ev.key !== 'Tab') return;                       // keep Tab inside the dialog
      var f = o.querySelectorAll('button:not([disabled]), input, textarea'); if (!f.length) return;
      var a = f[0], z = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === a) { z.focus(); ev.preventDefault(); }
      else if (!ev.shiftKey && document.activeElement === z) { a.focus(); ev.preventDefault(); }
    });
    o.addEventListener('click', function (ev) {
      if (ev.target === o) { closeSheet(); return; }
      var b = ev.target.closest('button'); if (b && !b.disabled && onClick) onClick(b);
    });
  }
  function closeSheet(keepReturn) {
    var o = $('#ov'); if (!o) return;
    o.remove();
    if (!keepReturn && sheetReturn && document.body.contains(sheetReturn)) { try { sheetReturn.focus({ preventScroll: true }); } catch (e) { } }
  }

  function calendarSheet() {
    var f = S.form, t = today(), min = addDays(t, -backDays());
    var view = f.date.slice(0, 7);
    function draw() {
      var first = parse(view + '-01'), start = first.getDay(), days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      var cells = '';
      for (var i = 0; i < start; i++) cells += '<span></span>';
      for (var d = 1; d <= days; d++) {
        var s = view + '-' + pad(d), off = s > t || s < min;
        cells += '<button class="day' + (s === f.date ? ' sel' : '') + (s === t ? ' today' : '') + '" data-day="' + s + '" aria-label="' + esc(longDate(s)) + '"' +
          (s === f.date ? ' aria-pressed="true"' : '') + (s === t ? ' aria-current="date"' : '') + (off ? ' disabled' : '') + '>' + d + '</button>';
      }
      openSheet('<h2>Pilih tanggal</h2><div class="calnav"><button class="btn small outline" data-cal="-1"' + (view <= min.slice(0, 7) ? ' disabled' : '') + ' aria-label="Bulan sebelumnya">‹</button><b>' + esc(monthName(view)) +
        '</b><button class="btn small outline" data-cal="1"' + (view >= t.slice(0, 7) ? ' disabled' : '') + ' aria-label="Bulan berikutnya">›</button></div>' +
        '<div class="cal">' + HR.map(function (x) { return '<span class="wd">' + x + '</span>'; }).join('') + cells + '</div>' +
        '<button class="btn outline" data-close="1">Batal</button>', function (b) {
          if (b.hasAttribute('data-cal')) { view = addMonths(view, Number(b.getAttribute('data-cal'))); draw(); }
          else if (b.hasAttribute('data-day')) { f.date = b.getAttribute('data-day'); f.errors.date = ''; closeSheet(); render(); }
          else closeSheet();
        });
    }
    draw();
  }
  function dupSheet(r, onForce) {
    var x = r.existing || {};
    openSheet('<h2>⚠️ ' + esc(r.error) + '</h2><div class="card"><b>' + esc(x.name) + '</b><div class="meta">' + (x.invoice ? 'Inv ' + esc(x.invoice) + ' · ' : '') + rp(x.amount) + ' · ' + esc(x.paidFrom || '') + '</div>' +
      '<div class="meta">Dicatat ' + esc(shortDate(x.date || today())) + ' oleh ' + esc(x.by) + '</div></div>' +
      '<p>Kalau ini transaksi yang sama, <b>jangan disimpan lagi</b>.</p><div class="stack"><button class="btn primary" data-v="cancel">Jangan simpan</button>' +
      '<button class="btn outline" data-v="force">Beda transaksi, tetap simpan</button></div>', function (b) {
        closeSheet();
        if (b.getAttribute('data-v') === 'force') onForce();
        else { var wasEdit = S.form && S.form.mode === 'edit'; S.form = null; go(wasEdit ? 'history' : 'home', true); toast('Tidak disimpan.'); }
      });
  }
  function similarSheet(q, list) {
    openSheet('<h2>Maksudnya yang ini?</h2><p>Nama ini mirip dengan yang sudah ada. Pilih yang sama supaya catatan rapi.</p><div class="stack">' +
      list.map(function (n) { return '<button class="btn outline" data-v="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') +
      '<button class="btn ghost" data-v="">Bukan, pakai nama baru "' + esc(q) + '"</button></div>', function (b) {
        var n = b.getAttribute('data-v'); closeSheet();
        S.form.name = n || q; S.form.isNew = !n; S.form.q = ''; S.form.errors.name = ''; render();
      });
  }
  function detailSheet(id) {
    var e = findEntry(id); if (!e) return;
    var rows = [['Tanggal', longDate(e.date)], ['No. Invoice', e.invoice || '—'], ['Bayar pakai', e.paidFrom], ['Catatan', e.note || '—'],
      ['Dicatat oleh', e.by + (e.at ? ' · ' + shortDate(e.at.slice(0, 10)) + ' ' + hhmm(e.at) : '')]];
    if (e.editedBy) rows.push(['Diubah oleh', e.editedBy + (e.editedAt ? ' · ' + shortDate(e.editedAt.slice(0, 10)) + ' ' + hhmm(e.editedAt) : '')]);
    openSheet('<div class="sheet-title"><b>' + esc(e.name) + '</b><div class="money">' + rp(e.amount) + '</div></div><dl class="kv">' +
      rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
      (e.canEdit ? '<div class="row"><button class="btn outline" data-v="edit">Ubah</button><button class="btn danger-outline" data-v="del">Hapus</button></div>'
        : '<div class="banner info">' + (e.archived ? 'Transaksi lama, sudah dipindah ke tab Arsip. Kalau perlu diubah, ubah langsung di spreadsheet.' : 'Sudah lebih dari ' + editDays() + ' hari. Hanya Ibu yang bisa mengubah.') + '</div>') +
      '<button class="btn ghost" data-v="close">Tutup</button>', function (b) {
        var v = b.getAttribute('data-v'); closeSheet();
        if (v === 'edit') { S.form = newForm(e); go('form'); }
        else if (v === 'del') deleteSheet(e);
      });
  }
  function deleteSheet(e) {
    openSheet('<h2>Hapus transaksi ini?</h2><div class="card"><b>' + esc(e.name) + '</b><div class="meta">' + rp(e.amount) + ' · ' + esc(shortDate(e.date)) + '</div></div><p>Kenapa dihapus?</p>' +
      '<div class="stack"><button class="btn outline" data-v="Salah input">Salah input</button><button class="btn outline" data-v="Tercatat dua kali">Tercatat dua kali</button>' +
      '<button class="btn outline" data-v="Lainnya">Lainnya</button><button class="btn ghost" data-v="">Batal</button></div>', function (b) {
        var reason = b.getAttribute('data-v'); if (!reason) { closeSheet(); return; }
        var all = b.parentNode.querySelectorAll('button'); for (var i = 0; i < all.length; i++) all[i].disabled = true;   // one delete, even with a shaky tap
        b.innerHTML = '<span class="spin"></span> Menghapus…';
        api('remove', { id: e.id, reason: reason }).then(function (r) {
          closeSheet();
          if (authFail(r)) return;
          if (!r.ok) { toast(r.error || 'Gagal menghapus.', 'err'); return; }
          toast('Transaksi dihapus ✓', 'ok');
          patchCache(e, null); render(); refresh(true);
        }, function (err) { closeSheet(); toast(err && err.server ? SERVER_MSG : 'Tidak ada koneksi internet. Coba lagi nanti.', 'err'); });
      });
  }
  function askLeaveForm() {
    openSheet('<h2>Batalkan catatan ini?</h2><p>Isian yang sudah diketik akan hilang.</p><div class="stack"><button class="btn danger" data-v="leave">Ya, batalkan</button>' +
      '<button class="btn outline" data-v="stay">Lanjut isi</button></div>', function (b) {
        closeSheet();
        if (b.getAttribute('data-v') === 'leave') { var wasEdit = S.form && S.form.mode === 'edit'; S.form = null; go(wasEdit ? 'history' : 'home', true); }
      });
  }
  function logoutSheet() {
    var n = S.queue.length;
    openSheet('<h2>Keluar dari aplikasi?</h2>' + (n ? '<p>Masih ada <b>' + n + ' transaksi belum terkirim</b>. Transaksi itu tetap tersimpan di HP dan tetap tercatat atas nama yang mencatatnya.</p>' : '<p>Nanti harus masuk lagi dengan kata sandi.</p>') +
      '<div class="stack"><button class="btn danger" data-v="out">Keluar</button><button class="btn outline" data-v="">Batal</button></div>', function (b) {
        closeSheet(); if (!b.getAttribute('data-v')) return;
        if (S.queue.some(function (o) { return o.token === S.token && o.state === 'waiting'; })) { S.logoutLater.push(S.token); save('logoutLater', S.logoutLater); }
        else api('logout').catch(function () { });
        S.token = ''; S.user = null; drop('token'); drop('user'); S.hist = {}; drop('hist'); S.boot = null; drop('boot'); S.month = ''; S.query = ''; go('login', true);
      });
  }

  // ───────────── button feedback ─────────────
  function setBusy(sel, label) { var b = $(sel); if (b) { b.disabled = true; b.setAttribute('data-label', b.textContent); b.innerHTML = '<span class="spin"></span> ' + esc(label); } }
  function unBusy(sel, label) { var b = $(sel); if (b) { b.disabled = false; b.textContent = label; } }
  function clearErr(stepId, field) {
    if (!S.form || !S.form.errors[field]) return;
    S.form.errors[field] = '';
    var st = document.getElementById(stepId); if (!st) return;
    st.classList.remove('has-err');
    var m = st.querySelectorAll('.err-msg'); for (var i = 0; i < m.length; i++) m[i].remove();
  }

  // ───────────── events ─────────────
  function after() {
    var bad = document.querySelectorAll('.step.has-err');
    for (var bi = 0; bi < bad.length; bi++) {
      var fld = bad[bi].querySelector('input, textarea');
      if (fld) { fld.setAttribute('aria-invalid', 'true'); fld.setAttribute('aria-describedby', bad[bi].id + '-e'); }
    }
    var lf = $('#loginForm');
    if (lf) lf.addEventListener('submit', function (ev) { ev.preventDefault(); doLogin(); });
    var q = $('#q');
    if (q) {
      renderSugg();
      q.addEventListener('input', function () {
        S.form.q = q.value; clearErr('st-name', 'name'); var fr = $('#freq'); if (fr) { if (fr.previousElementSibling) fr.previousElementSibling.remove(); fr.remove(); }
        renderSugg();
      });
      if (S.form && S.form._focus) { q.focus(); S.form._focus = false; }
    }
    var amt = $('#amt');
    if (amt) amt.addEventListener('input', function () {
      var d = amt.value.replace(/[^\d]/g, '').replace(/^0+/, '').slice(0, 10);
      S.form.amount = d ? Number(d) : 0; amt.value = dots(S.form.amount);
      $('#words').textContent = words(S.form.amount);
      if (S.form.amount) clearErr('st-amt', 'amount');
    });
    var other = $('#other');
    if (other) other.addEventListener('input', function () { if (other.value.trim()) clearErr('st-from', 'paidFrom'); });
    var inv = $('#inv');
    if (inv) inv.addEventListener('input', function () { clearErr('st-inv', 'invoice'); });
    var hq = $('#hq');
    if (hq) hq.addEventListener('input', function () {
      S.query = hq.value; var ym = curMonth(), box = $('#hlist'), pb = $('#pend');
      if (box) box.innerHTML = histList(ym, S.hist[ym]);
      if (pb) pb.innerHTML = pendList(ym);
    });
    if (S.screen === 'history' && needLoad(curMonth())) loadMonth(curMonth());
  }

  // While typing, the pinned Lanjut/Simpan bar steps aside so it never covers the field (phone keyboard is up).
  document.addEventListener('focusin', function (ev) { if (ev.target.matches && ev.target.matches('input, textarea')) document.body.classList.add('typing'); });
  // Bring the bar back only after the tap that moved focus has finished, so nothing shifts under the finger.
  var typingTimer;
  document.addEventListener('focusout', function () {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function () {
      var a = document.activeElement;
      if (!(a && a.matches && a.matches('input, textarea'))) document.body.classList.remove('typing');
    }, 450);
  });

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]'); if (!t || t.disabled || $('#ov')) return;
    var act = t.getAttribute('data-act'), v = t.getAttribute('data-v');
    collect();
    switch (act) {
      case 'back': history.back(); break;
      case 'home': go('home'); break;
      case 'eye': var p = $('#lpw'); p.type = p.type === 'password' ? 'text' : 'password'; t.textContent = p.type === 'password' ? 'Lihat' : 'Sembunyikan'; break;
      case 'usename': $('#lname').value = v; $('#lpw').focus(); break;
      case 'new': S.form = newForm(); S.form._focus = true; go('form'); break;
      case 'history': if (v !== 'keep' || !S.month) { S.month = today().slice(0, 7); S.query = ''; } failedAt = {}; go('history'); break;
      case 'refresh': toast('Memuat ulang…'); refresh().then(flush); break;
      case 'flush': S.queue.forEach(function (o) { o.retryAt = 0; }); toast('Mengirim…'); flush(); break;
      case 'logout': logoutSheet(); break;
      case 'install': if (installEvt) { installEvt.prompt(); installEvt = null; render(); } break;
      case 'pick': S.form.name = v; S.form.isNew = false; S.form.q = ''; S.form.errors.name = ''; render(); break;
      case 'unpick': S.form.name = ''; S.form.isNew = false; S.form._focus = true; render(); break;
      case 'addnew': addNew(); break;
      case 'from': S.form.paidFrom = v; S.form.errors.paidFrom = ''; render(); if (v === 'Lainnya') { var o = $('#other'); if (o) o.focus(); } break;
      case 'date': S.form.date = v; S.form.errors.date = ''; render(); break;
      case 'cal': calendarSheet(); break;
      case 'toReview':
        if (!validate()) { render(); var first = $('.has-err'); if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('Ada yang belum diisi.', 'err'); return; }
        go('review'); break;
      case 'save': doSave(false); break;
      case 'month': S.month = addMonths(S.month || today().slice(0, 7), Number(v)); failedAt = {}; render(); break;
      case 'detail': detailSheet(v); break;
      case 'reload': failedAt[curMonth()] = 0; t.disabled = true; t.innerHTML = '<span class="spin"></span> Memuat…'; loadMonth(curMonth()); break;
      case 'qdrop': S.queue = S.queue.filter(function (o) { return o.qid !== v; }); persistQueue(); endLaterSessions(); render(); toast('Transaksi dibuang.'); break;
      case 'qforce': S.queue.forEach(function (o) { if (o.qid === v) { o.force = true; o.state = 'waiting'; o.retryAt = 0; } }); persistQueue(); render(); flush(); break;
    }
  });

  function addNew() {
    var q = S.form.q.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!/[A-Z0-9]{2}/.test(q.replace(/[^A-Z0-9]/g, ''))) return;
    var sim = searchScored(q).filter(function (x) { return x.sc >= 0.45 && wordsFit(q, x.s); }).slice(0, 3).map(function (x) { return x.s; });
    if (sim.length) { similarSheet(q, sim); return; }
    S.form.name = q; S.form.isNew = true; S.form.q = ''; S.form.errors.name = ''; render();
  }

  // ───────────── install + service worker ─────────────
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; if (S.screen === 'home') render(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { });
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (!reloaded && ['form', 'review'].indexOf(S.screen) < 0) { reloaded = true; location.reload(); } });
  }

  // ───────────── start ─────────────
  if (DEMO) document.body.insertAdjacentHTML('afterbegin', '<div class="demo">MODE COBA — belum tersambung ke spreadsheet</div>');
  S.screen = S.token ? 'home' : 'login';
  try { history.replaceState({ s: S.screen }, '', location.pathname + location.search); } catch (e) { }
  render();
  if (S.token) refresh(true).then(flush);
  // Exposed for the automated tests only (no secrets here; the server re-checks everything).
  window.CatatApp = {
    state: S, terbilang: terbilang, words: words, esc: esc, rp: rp, dots: dots, key: key, dice: dice, score: score, search: search,
    frequent: frequent, today: today, addDays: addDays, addMonths: addMonths, longDate: longDate, shortDate: shortDate, monthName: monthName,
    hhmm: hhmm, newForm: newForm, validate: validate, entryFromForm: entryFromForm, formDirty: formDirty, needLoad: needLoad,
    patchCache: patchCache, histList: histList, pendList: pendList, isNet: isNet, trimHist: trimHist,
    render: render, collect: collect, renderSugg: renderSugg, toast: toast, uid: uid, shiftNow: shiftNow, daysBetween: daysBetween,
    phoneToday: phoneToday, isAdmin: isAdmin, editDays: editDays, backDays: backDays, loadMonth: loadMonth, findEntry: findEntry,
    curMonth: curMonth, outdated: outdated, step: step,
    searchScored: searchScored, SURE: SURE, wordsFit: wordsFit, api: api, refresh: refresh, flush: flush, doSave: doSave, endLaterSessions: endLaterSessions, authFail: authFail, SERVER_MSG: SERVER_MSG
  };
})();
