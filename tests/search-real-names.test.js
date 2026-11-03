// Supplier search against names as they were really typed in the 999 Mart ledgers (2022–2026), on the real list
// of 123 suppliers. The rule that matters: a quick first tap must never pick the WRONG supplier.
//  - "sure" matches (shown first) must be right;
//  - something that is a different thing ("SETOR ROKOK" ≠ ROKOK) must not be shown first, and must not be offered
//    in "Maksudnya yang ini?" when a typed word is not in the name at all.
// Usage: node tests/search-real-names.test.js
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { serve } = require('./static-server');

const c = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Seed.gs'), 'utf8'), c);
const SEED = c.SEED_SUPPLIERS.map(x => x[0]);
// [typed in the ledger, the supplier it is] — NEW = not in the list (a different thing)
const RIGHT = [
  ['TOP ADA KU', 'TOP UP ADAKU'], ['ROTI DAILY', 'ROTI DAILYS'], ['ROTI DAYLIS', 'ROTI DAILYS'], ['YAKUL', 'YAKULT'],
  ['SANFORD GALON', 'AIR GALON SANFORD'], ['SANFOD GALON', 'AIR GALON SANFORD'], ['SANFOD BOTOL', 'SANFORD BOTOL'],
  ['PT.COLAMASS SUKSES MANDIRI', 'PT. COLAMAS SUKSES MANDIRI'], ['PT. COLLAMAS SUKSES MANDIRI', 'PT. COLAMAS SUKSES MANDIRI'],
  ['PT. COLLMAS SUKSES M.', 'PT. COLAMAS SUKSES MANDIRI'], ['PT.YAPINDO MITRA PERMATA', 'PT. YAFINDO MITRA PERMATA'],
  ['PT. YAFINDO M PERMATA', 'PT. YAFINDO MITRA PERMATA'], ['ASOY', 'KANTONG ASOY'], ['GAS PORTEBEL', 'GAS PORTABEL'],
  ['PT. SAMPURNA', 'PT. SAMPURNA SUKSES ABADI'], ['SAMPOERNA', 'PT. SAMPURNA SUKSES ABADI'], ['TOP UP FASTPAY', 'TOP UP SALDO FASTPAY'],
  ['TOP UP PASPAY', 'TOP UP SALDO FASTPAY'], ['PT.BINTANG CENTRAL IMADA', 'PT. BINTANG SENTRAL IMADA'],
  ['PT. STARMARA PRATAMA', 'PT. STARTMARA PRATAMA'], ['PT. DELINDO BERKAH S', 'PT. DILINDO BERKAH SEJAHTERA'],
  ['PT. PRIMA REKSA', 'PT. PRISMA REKSA SEJAHTERA BERSAMA'], ['PT. MITRA ABADI KIAT', 'PT. MITRA ABADI KIAT PERKASA'],
  ['PT.HANSEL DUTA NIAGA', 'PT. HANSEL DUTA NIAGA PRATAMA'], ['PT. CITRA UTAMA D', 'PT. CITRA UTAMA DISTRIBUSINDO RAYA'],
  ['PT. COCA-COLA', 'PT. COCA COLA DISTRIBUTION INDONESIA'], ['GELAS KOPI', 'GELAS KOPI / PAPER CUP'], ['TEH BOTOL', 'TEH BOTOL SOSRO'],
  ['F. THREE SNACK', 'F. THREE SNACK / SUNARTI'], ['F.THREE SNECK /SUNARTI', 'F. THREE SNACK / SUNARTI'],
  ['ANGSUR PT. OMEGA SUKSES ABADI', 'PT. OMEGA SUKSES ABADI'], ['PT. INDOSARI NIAGA N', 'PT. INDOSARI NIAGA NUSANTARA'],
  ['PT. BINTANG SUKSES MANDIRI', 'PT. BINTAN SUKSES MANDIRI'], ['AIR SANFORD GALON', 'AIR GALON SANFORD'],
  ['PT. KIAN JAYA MAKMUR', 'PT. KIAN JAYA MAKMUR SEMESTA'], ['PT. CIRTA UTAMA D', 'PT. CITRA UTAMA DISTRIBUSINDO RAYA'],
  ['PT.MULTIBOGA ARYA SENTOSA', 'PT. MULTIBOGA ARYA SENTOSA']
];
const OTHER = ['SETOR ROKOK', 'SETOR BANK ROKOK', 'PERMEN', 'DUNIA PLASTIK 28', 'ISI STAPLES', 'PT. COLAMAS INDAH SEJATI',
  'PT. BINTANG INTAN SARANA', 'DAIRY BAKERY', 'TOP UP PULSA', 'PT. SUMBER CIPTA MULTINIAGA', 'PT. SUMBERSARI PERMAI',
  'PENAMBAHAN MODAL', 'SENDOK TEH', 'BERAS BUMI AYU', 'PT. CIS'];

(async () => {
  const srv = await serve(path.join(__dirname, '..', 'web'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(srv.url + '/index.html?demo=1');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.fill('#lname', 'Ani'); await page.fill('#lpw', 'toko12345'); await page.click('#loginBtn');
  await page.waitForSelector('[data-act="new"]');
  const out = await page.evaluate(({ SEED, RIGHT, OTHER }) => {
    const A = window.CatatApp, S = A.state; S.boot = Object.assign({}, S.boot, { suppliers: SEED }); S.usage = {};
    const res = [];
    const firstTap = q => { const r = A.searchScored(q); return r[0] && r[0].sc >= A.SURE ? r[0].s : '+ Tambah'; };
    const offered = q => A.searchScored(q).filter(x => x.sc >= 0.45 && A.wordsFit(q, x.s)).map(x => x.s);
    for (const [q, want] of RIGHT) {
      const f = firstTap(q), off = offered(q);
      res.push([f === want || (f === '+ Tambah' && (off.includes(want) || A.searchScored(q).some(x => x.s === want))), `"${q}" → ${want} (first tap: ${f})`]);
    }
    for (const q of OTHER) res.push([firstTap(q) === '+ Tambah', `"${q}" is something else: first tap is "+ Tambah", not ${firstTap(q)}`]);
    for (const q of ['SETOR ROKOK', 'SETOR BANK ROKOK', 'PT. COLAMAS INDAH SEJATI', 'DUNIA PLASTIK 28', 'PT. SUMBER CIPTA MULTINIAGA'])
      res.push([!offered(q).length, `"${q}" is not offered as one of ${JSON.stringify(offered(q))} in "Maksudnya yang ini?"`]);
    return res;
  }, { SEED, RIGHT, OTHER });

  // on screen: guesses sit under "+ Tambah" with a label; "+ Tambah" saves a different thing as itself
  await page.evaluate(SEED => { window.CatatApp.state.boot.suppliers = SEED; }, SEED);
  await page.click('[data-act="new"]');
  const typeQ = async v => { await page.fill('#q', v); await page.locator('#q').dispatchEvent('input'); };
  await typeQ('setor rokok');
  const order = await page.$$eval('#sugg .sugg > *', els => els.map(e => (e.className.includes('sugg-head') ? 'HEAD:' : '') + (e.getAttribute('data-act') || '') + ':' + e.textContent.trim().split('\n')[0]));
  out.push([order[0].startsWith('addnew') && order[1] === 'HEAD::Mungkin maksudnya:' && /ROKOK/.test(order[2]), `"setor rokok": "+ Tambah" first, ROKOK under "Mungkin maksudnya:" — ${JSON.stringify(order)}`]);
  await page.click('[data-act="addnew"]');
  out.push([(await page.locator('#ov').count()) === 0 && /SETOR ROKOK/.test(await page.textContent('.picked')), '"+ Tambah" saves SETOR ROKOK as its own name, without asking about ROKOK']);
  await page.click('[data-act="unpick"]');
  await typeQ('roti daylis'); await page.click('[data-act="addnew"]');
  out.push([(await page.locator('#ov').count()) === 1 && /ROTI DAILYS/.test(await page.textContent('#ov')), 'a plain typo ("roti daylis") still asks "Maksudnya yang ini? ROTI DAILYS"']);
  await page.locator('#ov button', { hasText: 'ROTI DAILYS' }).click();
  out.push([/^ROTI DAILYS/.test((await page.textContent('.picked')).trim()), '…and picking it uses the existing name']);
  await page.click('[data-act="unpick"]');
  await typeQ('yakul');
  out.push([(await page.locator('#sugg button').first().textContent()).trim() === 'YAKULT', 'a sure match ("yakul" → YAKULT) is still the first button']);

  await browser.close(); srv.close();
  let failed = 0;
  for (const [ok, msg] of out) { if (!ok) failed++; console.log(`${ok ? '  ✓' : '  ✗'} ${msg}`); }
  if (errors.length) { failed++; console.log('  ✗ page errors: ' + errors.join(' | ')); }
  console.log(`\n${out.length - failed} search checks passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
