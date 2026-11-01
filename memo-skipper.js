/*PURE-START*/
/* ===== Memo Skipper logic (no UI here) ===== */
const BN = { '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9' };
const bengaliToEnglish = (s) => s.replace(/[০-৯]/g, (m) => BN[m]);

function processCSVData(text) {
  const result = {};
  text.split(/\r?\n/).forEach((line) => {
    const parts = line.split(',');
    if (parts.length >= 2) {
      const code = parts[0].trim().replace(/^["']|["']$/g, '');
      const name = parts.slice(1).join(',').trim().replace(/^["']|["']$/g, '');
      if (code && name && code.toLowerCase() !== 'code' && code.toLowerCase() !== 'outlet code') result[code] = name;
    }
  });
  return result;
}

/* ---------------------------------- dates ---------------------------------- */
const MON_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS = { jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8,
  sep:9, sept:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12,
  'জানুয়ারি':1, 'জানুয়ারী':1, 'ফেব্রুয়ারি':2, 'ফেব্রুয়ারী':2, 'মার্চ':3, 'এপ্রিল':4, 'মে':5, 'জুন':6, 'জুলাই':7, 'আগস্ট':8, 'আগষ্ট':8,
  'সেপ্টেম্বর':9, 'অক্টোবর':10, 'নভেম্বর':11, 'ডিসেম্বর':12 };
const pad2 = (n) => String(n).padStart(2, '0');
function ymd(y, m, d) {
  if (y < 2020 || y > 2099 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return { key: y + '-' + pad2(m) + '-' + pad2(d), label: pad2(d) + ' ' + MON_EN[m - 1] + ' ' + y };
}
/* day-first (DD/MM/YYYY) like the rest of the app; returns {key:'2026-10-12', label:'12 Oct 2026'} or null */
function parseDate(str) {
  const s = bengaliToEnglish(String(str)).trim().toLowerCase();
  let m = s.match(/^(\d{1,2})\s+([^\d\s]+)\s+(\d{4})$/);
  if (m && MONTHS[m[2]]) return ymd(+m[3], MONTHS[m[2]], +m[1]);
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return ymd(y, +m[2], +m[1]); }
  return null;
}
const DATE_RE = /\d{1,2}\s+[A-Za-z\u0980-\u09FF]{2,14}\s+\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g;
const ORDER_RE = /order|অর্ডার|অডার|অর্ডর/g;
const DELIV_RE = /deliver|ডেলিভারি|ডেলিভেরি|ডেলিভার|বিতরণ|চালান|supply/g;
const lastHit = (re, s) => { let last = -1, m; re.lastIndex = 0; while ((m = re.exec(s))) last = m.index; return last; };

/* Which date is the ORDER date and which is the DELIVERY date.
   1) a date that has the word "order" / "delivery" (English or Bengali) just before it is taken by that label;
   2) otherwise the original rule: first date = delivery, second date = order;
   3) only one date and no label → order date is assumed equal to it (marked as assumed). */
function findDates(eng) {
  const list = [];
  for (const m of eng.matchAll(DATE_RE)) {
    const prev = eng[m.index - 1];
    if (prev && /[\d.\-/]/.test(prev)) continue;               // part of a longer number
    const d = parseDate(m[0]); if (!d) continue;
    const ctx = eng.slice(Math.max(0, m.index - 45), m.index).toLowerCase();
    const o = lastHit(ORDER_RE, ctx), v = lastHit(DELIV_RE, ctx);
    list.push({ d, role: o < 0 && v < 0 ? '' : (o > v ? 'order' : 'delivery') });
  }
  let order = null, deliv = null;
  list.forEach((x) => {
    if (x.role === 'order' && !order) order = x.d; else if (x.role === 'delivery' && !deliv) deliv = x.d; else x.role = '';
  });
  const free = list.filter((x) => !x.role).map((x) => x.d);
  let guessed = false;
  if (!order && !deliv) { deliv = free[0] || null; order = free[1] || null; if (!order && deliv) { order = deliv; guessed = true; } }
  else if (!deliv) { deliv = free.find((d) => d.key !== order.key) || order; }
  else if (!order) { order = free.find((d) => d.key !== deliv.key) || null; if (!order) { order = deliv; guessed = true; } }
  const uniq = []; list.forEach((x) => { if (!uniq.includes(x.d.label)) uniq.push(x.d.label); });
  return { order, deliv, guessed, all: uniq };
}

/* ------------------------------ one half page ------------------------------ */
/* one half-page of a memo → memo number, dates, amount, damage / payout flags, outlet */
function parseBlock(blockText, ctx) {
  const rawAlpha = blockText.replace(/[^\u0980-\u09FFa-zA-Z]/g, '');
  const eng = bengaliToEnglish(blockText).replace(/,/g, '').replace(/(\d)\s*\.\s*(\d)/g, '$1.$2');
  const clean = eng.replace(/\s+/g, '');

  const memoMatch = clean.match(/(26\d{8})/);
  const pNum = (clean.match(/P(\d+)of(\d+)/i) || [0, 1])[1];
  const memoNo = memoMatch ? memoMatch[1]
    : (pNum > 1 ? ctx.lastMemoNo : (eng.includes('S-SMART') ? 'No_Num_' + Math.floor(Math.random() * 10000) : ctx.lastMemoNo));

  const dt = findDates(eng);
  const NA = { key: 'N/A', label: 'N/A' };
  const orderD = dt.order || NA, delivD = dt.deliv || NA;

  let amount = 0.0, isDamage = false, hasPayout = false;
  if (rawAlpha.includes('পেআউট') || rawAlpha.includes('েপআউট') || rawAlpha.includes('পআউট') || rawAlpha.includes('আউট') || /payout/i.test(rawAlpha) || /p-out/i.test(eng)) hasPayout = true;
  if (rawAlpha.includes('ক্ষতিগ্রস্থ') || rawAlpha.includes('ক্ষতিগ্রস্ত') || rawAlpha.includes('ডেমেজ') || rawAlpha.includes('ড্যামেজ') || /damage/i.test(rawAlpha)) {
    if (!hasPayout) { isDamage = true; amount = 0.0; }
  }
  const decimals = [...eng.matchAll(/(\d+\.\d{1,2})/g)].map((m) => parseFloat(m[1]));
  if (decimals.length > 0) amount = Math.max(...decimals);
  if (amount === 0 && !hasPayout) isDamage = true;

  let outlet = '';
  if (ctx.outlets && ctx.outlets.length) {
    for (let k = 0; k < ctx.outlets.length; k++) {
      if (clean.includes(ctx.outlets[k][1]) || eng.includes(ctx.outlets[k][0])) { outlet = ctx.outlets[k][2]; break; }
    }
  }
  return { memoNo, orderDate: orderD.label, orderKey: orderD.key, deliveryDate: delivD.label, deliveryKey: delivD.key,
    orderGuessed: dt.guessed, dates: dt.all, amount, isDamage, hasPayout, outlet };
}

/* print / skip decision.  'skipped' = a normal memo below the minimum amount */
function categoryOf(m, min) {
  if (m.hasPayout) return 'payout';
  if (m.isDamage || m.amount === 0) return 'damage';
  return m.amount >= min ? 'valid' : 'skipped';
}

/* numbers for the daily record */
function summarize(memos, min) {
  const r = { total: memos.length, valid: 0, damage: 0, payout: 0, skipped: 0, skippedAmount: 0 };
  memos.forEach((m) => { const c = categoryOf(m, min); r[c]++; if (c === 'skipped') r.skippedAmount += m.amount; });
  r.skippedAmount = Math.round(r.skippedAmount * 100) / 100;
  return r;
}
/*PURE-END*/

/* ============================== app ============================== */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { toast('Could not save in this browser (storage full or blocked).'); } } };
const load = (k) => { try { return JSON.parse(ls.get(k) || '{}') || {}; } catch (e) { return {}; } };

const S = { dm: load('itbMemoDm'), ol: load('itbMemoOl'), min: parseFloat(ls.get('itbMemoMin')), bufs: {}, groups: {}, mdType: 'dm' };
if (!isFinite(S.min) || S.min < 0) S.min = 300;
let toastT;
function toast(t) { let e = document.querySelector('.toast'); if (!e) { e = document.createElement('div'); e.className = 'toast'; document.body.appendChild(e); } e.textContent = t; clearTimeout(toastT); toastT = setTimeout(() => e.remove(), 4800); }

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

/* ------------------------------ minimum amount ------------------------------ */
$('minAmt').value = S.min;
$('minAmt').addEventListener('change', () => {
  const v = parseFloat($('minAmt').value);
  if (!isFinite(v) || v < 0) { $('minAmt').value = S.min; return; }
  S.min = v; ls.set('itbMemoMin', String(v));
  Object.values(S.groups).forEach((g) => g.memos.forEach((m) => { delete m.sel; }));     // tick boxes follow the new amount
  render(); toast('Minimum amount set to ৳' + v + '. Ticks updated.');
  if (Object.keys(S.groups).length) saveLog();
});

/* ------------------------------ choose files ------------------------------- */
const fileInput = $('pdfInput'), drop = $('drop');
const fileInfo = () => { $('fileInfo').textContent = fileInput.files.length ? 'Selected: ' + fileInput.files.length + ' PDF file(s)' : ''; };
drop.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', fileInfo);
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files.length) { fileInput.files = e.dataTransfer.files; fileInfo(); } });

/* --------------------------------- scan ------------------------------------ */
$('scanBtn').addEventListener('click', scan);
async function scan() {
  const files = Array.from(fileInput.files);
  if (!files.length) { toast('Please choose PDF files first.'); return; }
  $('scanBtn').disabled = true; $('progCard').classList.remove('hidden'); $('results').innerHTML = ''; $('kpis').classList.add('hidden'); $('gf').classList.add('hidden');
  S.bufs = {}; S.groups = {};
  const all = {};
  const outlets = Object.keys(S.ol).map((k) => [k, k.replace(/\s+/g, ''), S.ol[k]]).filter((x) => x[1]);
  let ok = false;
  try {
    for (let f = 0; f < files.length; f++) {
      const fileCode = files[f].name.replace(/\.[^/.]+$/, '').trim();
      const engCode = bengaliToEnglish(fileCode);
      const deliveryMan = S.dm[engCode] || 'Delivery Group (' + engCode + ')';
      const bytes = await files[f].arrayBuffer(), fid = 'file_' + f;
      S.bufs[fid] = bytes;
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;   // a copy, so the original bytes stay usable for printing
      const ctx = { lastMemoNo: 'Unknown_' + fileCode, outlets };
      for (let i = 1; i <= pdf.numPages; i++) {
        $('progText').textContent = 'File ' + (f + 1) + ' of ' + files.length + ' · page ' + i + ' of ' + pdf.numPages + ' · ' + files[f].name;
        $('progBar').style.width = Math.round(((f + (i - 1) / pdf.numPages) / files.length) * 100) + '%';
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const midY = page.getViewport({ scale: 1.0 }).height / 2;
        const top = [], bottom = [];
        tc.items.forEach((it) => { if (it.transform[5] > midY) top.push(it.str.trim()); else bottom.push(it.str.trim()); });
        for (const blk of [{ t: top.join(' '), half: 'top' }, { t: bottom.join(' '), half: 'bottom' }]) {
          if (blk.t.trim().length < 15) continue;
          const r = parseBlock(blk.t, ctx);
          ctx.lastMemoNo = r.memoNo;
          let m = all[r.memoNo];
          if (!m) m = all[r.memoNo] = { memo_no: r.memoNo, amount: 0.0, isDamage: false, hasPayout: false, parts: [], deliveryMan, outlet: '', orderDate: r.orderDate, orderKey: r.orderKey, orderGuessed: r.orderGuessed,
            deliveryDate: r.deliveryDate, deliveryKey: r.deliveryKey, dates: [] };
          const key = fid + ':' + (i - 1) + ':' + blk.half;
          if (!m.parts.includes(key)) m.parts.push(key);
          if (r.amount > m.amount) m.amount = r.amount;
          if (r.isDamage) m.isDamage = true;
          if (r.hasPayout) m.hasPayout = true;
          if (!m.outlet && r.outlet) m.outlet = r.outlet;
          r.dates.forEach((d) => { if (!m.dates.includes(d)) m.dates.push(d); });
          // a later half of the same memo can replace an order date that was only assumed, or fill a missing one
          if ((m.orderKey === 'N/A' || m.orderGuessed) && r.orderKey !== 'N/A' && !r.orderGuessed) { m.orderDate = r.orderDate; m.orderKey = r.orderKey; m.orderGuessed = false; }
          else if (m.orderKey === 'N/A' && r.orderKey !== 'N/A') { m.orderDate = r.orderDate; m.orderKey = r.orderKey; m.orderGuessed = r.orderGuessed; }
          if (m.deliveryKey === 'N/A' && r.deliveryKey !== 'N/A') { m.deliveryDate = r.deliveryDate; m.deliveryKey = r.deliveryKey; }
        }
      }
    }
    Object.values(all).forEach((m) => { (S.groups[m.deliveryMan] = S.groups[m.deliveryMan] || { memos: [], open: false, tab: 'print', fo: 'all', fd: 'all' }).memos.push(m); });
    render();
    $('upCard').classList.add('hidden'); ok = true;
  } catch (err) { console.error(err); toast('Error while scanning the memos. Check that the files are valid PDFs.'); }
  finally { $('progCard').classList.add('hidden'); $('progBar').style.width = '0'; $('scanBtn').disabled = false; }
  if (ok && Object.keys(S.groups).length) saveLog();
}

/* -------------------------------- results ---------------------------------- */
const isOn = (m) => (m.sel === undefined ? categoryOf(m, S.min) !== 'skipped' : m.sel);
const partLabel = (k) => { const p = k.split(':'); return 'p' + (parseInt(p[1], 10) + 1) + ' ' + p[2]; };
function view(g) { return g.memos.filter((m) => (g.fo === 'all' || m.orderKey === g.fo) && (g.fd === 'all' || m.deliveryKey === g.fd)); }
const groupAt = (i) => S.groups[Object.keys(S.groups)[+i]];
function listOf(g, tab) { return view(g).filter((m) => (categoryOf(m, S.min) === 'skipped') === (tab === 'skip')); }

function datesCell(m) {
  const extra = m.dates.length > 2 || m.orderGuessed ? '<br><span class="dt2" title="All dates found in this memo">Dates found: ' + esc(m.dates.join(', ') || '-') + '</span>' : '';
  return '<td class="dt">Order: <b>' + esc(m.orderDate) + '</b>' + (m.orderGuessed ? ' <i>(assumed)</i>' : '') + '<br>Delivery: <b>' + esc(m.deliveryDate) + '</b>' + extra + '</td>';
}
function rowHtml(m, gi, mi) {
  const cat = categoryOf(m, S.min);
  let badge = '<span class="badge b-ok">Selected</span>', amt = money(m.amount), cls = 'amt';
  if (cat === 'payout') badge = '<span class="badge b-po">Payout (priority)</span>';
  else if (cat === 'damage') { badge = '<span class="badge b-dmg">Damage / 0 BDT</span>'; if (m.isDamage) amt = '0.00'; }
  else if (cat === 'skipped') { badge = '<span class="badge b-sk">Skipped</span>'; cls = 'amt r'; }
  return '<tr><td style="text-align:center"><input type="checkbox" data-act="sel" data-g="' + gi + '" data-m="' + mi + '"' + (isOn(m) ? ' checked' : '') + '></td>' +
    '<td><b>' + esc(m.memo_no) + '</b></td><td>' + (m.outlet ? esc(m.outlet) : '<span style="color:#94A3B8">-</span>') + '</td>' + datesCell(m) + '<td>' + badge + '</td>' +
    '<td><span class="' + cls + '">৳ ' + amt + '</span></td><td class="dt">' + esc(m.parts.map(partLabel).join(', ')) + '</td></tr>';
}
const THEAD = '<thead><tr><th style="width:46px;text-align:center">Sel</th><th>Memo no</th><th>Shop name</th><th>Order / delivery date</th><th>Status</th><th>Amount</th><th>Pages</th></tr></thead>';
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dateOpts = (keys, labels, cur, word) => '<option value="all">All ' + word + ' dates</option>' + keys.map((k) => '<option value="' + esc(k) + '"' + (cur === k ? ' selected' : '') + '>' + esc(cap(word)) + ': ' + esc(labels[k]) + '</option>').join('');
const sortKeys = (set) => [...set].sort((a, b) => (a === 'N/A' ? 1 : b === 'N/A' ? -1 : a < b ? -1 : a > b ? 1 : 0));

function render() {
  const names = Object.keys(S.groups);
  const host = $('results'); host.innerHTML = '';
  if (!names.length) { $('kpis').classList.add('hidden'); $('gf').classList.add('hidden'); return; }
  const T = { total: 0, valid: 0, damage: 0, payout: 0, skipped: 0 };
  // global date lists (union of every delivery man)
  const oLab = {}, dLab = {}, oSet = new Set(), dSet = new Set();
  names.forEach((n) => S.groups[n].memos.forEach((m) => { oSet.add(m.orderKey); oLab[m.orderKey] = m.orderDate; dSet.add(m.deliveryKey); dLab[m.deliveryKey] = m.deliveryDate; }));
  const oKeys = sortKeys(oSet), dKeys = sortKeys(dSet);
  let html = '';
  names.forEach((dmName, gi) => {
    const g = S.groups[dmName], list = view(g);
    const cnt = { valid: 0, damage: 0, payout: 0, skipped: 0 };
    list.forEach((m) => { cnt[categoryOf(m, S.min)]++; });
    const printable = listOf(g, 'print'), skipped = listOf(g, 'skip');
    T.total += list.length; T.valid += cnt.valid; T.damage += cnt.damage; T.payout += cnt.payout; T.skipped += cnt.skipped;
    const go = new Set(g.memos.map((m) => m.orderKey)), gd = new Set(g.memos.map((m) => m.deliveryKey));
    const oOpt = dateOpts(sortKeys(go), oLab, g.fo, 'order'), dOpt = dateOpts(sortKeys(gd), dLab, g.fd, 'delivery');
    const body = (rows, kind) => rows.length ? rows.map((m) => rowHtml(m, gi, g.memos.indexOf(m))).join('') : '<tr><td colspan="7" class="empty">' + (kind === 'print' ? 'No printable memos for this date filter.' : 'No skipped memos.') + '</td></tr>';
    const bar = (rows, tab, cls, note) => '<div class="tbar' + cls + '"><span>' + note + ' · Selected ' + rows.filter(isOn).length + ' of ' + rows.length + '</span><div class="tb-btns">' +
      '<button class="btn sm sec" data-act="selall" data-g="' + gi + '" data-t="' + tab + '"' + (rows.length ? '' : ' disabled') + '>Select all</button>' +
      '<button class="btn sm sec" data-act="clr" data-g="' + gi + '" data-t="' + tab + '"' + (rows.length ? '' : ' disabled') + '>Clear</button>' +
      '<button class="btn sm" data-act="print" data-g="' + gi + '"' + (rows.length ? '' : ' disabled') + '>Print selected</button></div></div>';
    html += '<section class="dm' + (g.open ? ' open' : '') + '"><div class="dmh" data-act="toggle" data-g="' + gi + '"><div class="t"><div class="n">Delivery man: ' + esc(dmName) + '</div><div class="pills">' +
      '<span class="pill">Total: ' + list.length + '</span><span class="pill ok">Valid: ' + cnt.valid + '</span><span class="pill info">Damage: ' + cnt.damage + '</span>' +
      (cnt.payout ? '<span class="pill warn">Payouts: ' + cnt.payout + '</span>' : '') + '<span class="pill err">Skipped: ' + cnt.skipped + '</span></div></div>' +
      '<select data-act="fo" data-g="' + gi + '">' + oOpt + '</select><select data-act="fd" data-g="' + gi + '">' + dOpt + '</select><span class="chev">▼</span></div>' +
      '<div class="dmb"><div class="tabs"><button class="tab' + (g.tab === 'print' ? ' on' : '') + '" data-act="tab" data-g="' + gi + '" data-t="print">Valid &amp; print memos (' + printable.length + ')</button>' +
      '<button class="tab' + (g.tab === 'skip' ? ' on' : '') + '" data-act="tab" data-g="' + gi + '" data-t="skip">Skipped memos (' + skipped.length + ')</button></div>' +
      '<div' + (g.tab === 'print' ? '' : ' class="hidden"') + '>' + bar(printable, 'print', '', 'Ready for stitching &amp; printing') +
      '<div class="tw"><table>' + THEAD + '<tbody>' + body(printable, 'print') + '</tbody></table></div></div>' +
      '<div' + (g.tab === 'skip' ? '' : ' class="hidden"') + '>' + bar(skipped, 'skip', ' sk', 'Skipped: below ৳' + esc(S.min) + ' (tick a memo to print it anyway)') +
      '<div class="tw"><table>' + THEAD + '<tbody>' + body(skipped, 'skip') + '</tbody></table></div></div></div></section>';
  });
  host.innerHTML = html;
  $('kpis').innerHTML = [['Total memos', T.total, ''], ['Valid', T.valid, 'ok'], ['Damage', T.damage, 'info'], ['Payout', T.payout, 'warn'], ['Skipped', T.skipped, 'err']]
    .map((k) => '<div class="kpi ' + k[2] + '"><small>' + k[0] + '</small><b>' + k[1] + '</b></div>').join('');
  $('kpis').classList.remove('hidden');
  // global date filter (shows a value only when every delivery man uses the same one)
  const same = (key) => { const s = new Set(names.map((n) => S.groups[n][key])); return s.size === 1 ? [...s][0] : 'all'; };
  $('gOrder').innerHTML = dateOpts(oKeys, oLab, same('fo'), 'order'); $('gDeliv').innerHTML = dateOpts(dKeys, dLab, same('fd'), 'delivery');
  $('gf').classList.remove('hidden');
}

$('gOrder').addEventListener('change', () => { Object.values(S.groups).forEach((g) => { g.fo = $('gOrder').value; }); render(); });
$('gDeliv').addEventListener('change', () => { Object.values(S.groups).forEach((g) => { g.fd = $('gDeliv').value; }); render(); });

$('results').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, g = groupAt(el.dataset.g);
  if (act === 'toggle') { if (e.target.closest('select')) return; g.open = !g.open; render(); }
  else if (act === 'tab') { g.tab = el.dataset.t; render(); }
  else if (act === 'sel') { g.memos[+el.dataset.m].sel = el.checked; render(); }
  else if (act === 'selall' || act === 'clr') { listOf(g, el.dataset.t).forEach((m) => { m.sel = act === 'selall'; }); render(); }
  else if (act === 'print') printGroup(g, el);
});
$('results').addEventListener('change', (e) => {
  const el = e.target.closest('select[data-act]'); if (!el) return;
  const g = groupAt(el.dataset.g);
  if (el.dataset.act === 'fo') g.fo = el.value; else g.fd = el.value;
  render();
});

/* -------------------------------- printing --------------------------------- */
async function printGroup(g, btn) {
  const chosen = view(g).filter(isOn);
  if (!chosen.length) { toast('Select at least one memo.'); return; }
  const orig = btn.textContent; btn.textContent = 'Preparing…'; btn.disabled = true;
  try {
    const seen = new Map();
    chosen.forEach((m) => m.parts.forEach((k) => { const [f, p, h] = k.split(':'); seen.set(k, { fileId: f, pageIndex: +p, half: h }); }));
    const parts = Array.from(seen.values());
    const { PDFDocument } = PDFLib, out = await PDFDocument.create(), loaded = {};
    for (const p of parts) if (!loaded[p.fileId]) loaded[p.fileId] = await PDFDocument.load(S.bufs[p.fileId]);
    let page = null, slot = 0;
    for (const p of parts) {
      const src = loaded[p.fileId].getPage(p.pageIndex), { width, height } = src.getSize(), midY = height / 2;
      if (slot === 0) page = out.addPage([width, height]);
      const box = p.half === 'top' ? { left: 0, bottom: midY, right: width, top: height } : { left: 0, bottom: 0, right: width, top: midY };
      const emb = await out.embedPage(src, box);
      page.drawPage(emb, { x: 0, y: slot === 0 ? midY : 0, width, height: midY });
      slot = (slot + 1) % 2;
    }
    const url = URL.createObjectURL(new Blob([await out.save()], { type: 'application/pdf' }));
    const fr = $('printFrame'); fr.src = url;
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { window.open(url); } setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1000); };
  } catch (err) { console.error(err); toast('Print error. Please try again.'); btn.textContent = orig; btn.disabled = false; }
}

/* ------------------------------ daily record ------------------------------- */
async function saveLog() {
  try {
    const rows = Object.keys(S.groups).map((n) => Object.assign({ dm: n, minAmount: S.min }, summarize(S.groups[n].memos, S.min)));
    await AUTH.call('itb_memo_log_save', { p_rows: rows });
    await loadRecord();
  } catch (e) { toast('Daily record not saved: ' + e.message); }
}
async function loadRecord() {
  try { renderRecord((await AUTH.call('itb_memo_log_mine', { p_days: 30 })) || []); }
  catch (e) { $('recBody').innerHTML = '<div class="empty">Could not load the daily record.</div>'; }
}
function renderRecord(rows) {
  const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-');
  if (!rows.length) { $('recBody').innerHTML = '<div class="empty">No record yet. It is saved automatically each time you scan memos.</div>'; return; }
  const mx = Math.max(1, ...rows.map((r) => r.skipped));
  const T = rows.reduce((a, r) => { a.total += r.total; a.valid += r.valid; a.damage += r.damage; a.payout += r.payout; a.skipped += r.skipped; a.amt += Number(r.skippedAmount || 0); return a; }, { total: 0, valid: 0, damage: 0, payout: 0, skipped: 0, amt: 0 });
  $('recBody').innerHTML = '<div class="tw rec"><table><thead><tr><th>Date</th><th>Delivery men</th><th>Memos</th><th>Valid</th><th>Damage</th><th>Payout</th><th>Skipped</th><th>Skip rate</th><th>Skipped amount (৳)</th></tr></thead><tbody>' +
    rows.map((r) => '<tr><td><b>' + esc(AUTH.fmtDay(r.date)) + '</b></td><td>' + r.dms + '</td><td>' + r.total + '</td><td>' + r.valid + '</td><td>' + r.damage + '</td><td>' + r.payout +
      '</td><td><div class="rbar"><i style="width:' + Math.round(r.skipped / mx * 100) + '%"></i><span>' + r.skipped + '</span></div></td><td>' + pct(r.skipped, r.total) + '</td><td>' + money(r.skippedAmount || 0) + '</td></tr>').join('') +
    '</tbody><tfoot><tr><td><b>Last 30 days</b></td><td></td><td><b>' + T.total + '</b></td><td><b>' + T.valid + '</b></td><td><b>' + T.damage + '</b></td><td><b>' + T.payout + '</b></td><td><b>' + T.skipped + '</b></td><td><b>' + pct(T.skipped, T.total) + '</b></td><td><b>' + money(T.amt) + '</b></td></tr></tfoot></table></div>';
}
$('recRefresh').addEventListener('click', loadRecord);
loadRecord();

/* ------------------------------ master data -------------------------------- */
const mdKey = () => (S.mdType === 'dm' ? 'itbMemoDm' : 'itbMemoOl');
const mdMap = () => S[S.mdType];
function mdStatus(t) { $('mdStatus').textContent = t || ''; }
function mdPersist() { ls.set(mdKey(), JSON.stringify(mdMap())); mdRender(); }
function mdRender() {
  const map = mdMap(), q = $('mdSearch').value.trim().toLowerCase(), tb = $('mdBody');
  const all = Object.keys(map).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const rows = all.filter((c) => !q || c.toLowerCase().includes(q) || String(map[c]).toLowerCase().includes(q));
  $('mdInfo').textContent = 'Total ' + all.length + (q ? ' · matches ' + rows.length : '') + (rows.length > 300 ? ' · showing first 300' : '');
  tb.innerHTML = '';
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="3" class="empty">No data yet.</td></tr>'; return; }
  rows.slice(0, 300).forEach((code) => {
    const tr = document.createElement('tr');
    const c1 = document.createElement('td'), b = document.createElement('b'); b.textContent = code; c1.appendChild(b);
    const c2 = document.createElement('td'), inp = document.createElement('input'); inp.className = 'srch'; inp.style.width = '100%'; inp.value = map[code];
    inp.onchange = () => { const v = inp.value.trim(); if (v) { map[code] = v; mdPersist(); } else inp.value = map[code]; };
    c2.appendChild(inp);
    const c3 = document.createElement('td'), d = document.createElement('button'); d.className = 'btn sm sec'; d.textContent = '✕'; d.onclick = () => { delete map[code]; mdPersist(); }; c3.appendChild(d);
    tr.append(c1, c2, c3); tb.appendChild(tr);
  });
}
function mdSwitch(t) {
  S.mdType = t; $('mdTabDm').classList.toggle('on', t === 'dm'); $('mdTabOl').classList.toggle('on', t === 'ol');
  $('mdSearch').value = ''; $('mdCode').placeholder = t === 'dm' ? 'e.g. 86' : 'e.g. C19-05025'; mdStatus(''); mdRender();
}
$('openMaster').addEventListener('click', () => { $('mdOv').classList.add('on'); mdSwitch('dm'); });
$('mdClose').addEventListener('click', () => $('mdOv').classList.remove('on'));
$('mdOv').addEventListener('click', (e) => { if (e.target === $('mdOv')) $('mdOv').classList.remove('on'); });
$('mdTabDm').addEventListener('click', () => mdSwitch('dm'));
$('mdTabOl').addEventListener('click', () => mdSwitch('ol'));
$('mdSearch').addEventListener('input', mdRender);
$('mdAdd').addEventListener('click', () => {
  const c = $('mdCode').value.trim(), n = $('mdName').value.trim();
  if (!c || !n) { toast('Enter both code and name.'); return; }
  mdMap()[c] = n; $('mdCode').value = ''; $('mdName').value = ''; mdPersist(); mdStatus('Saved.');
});
$('mdUp').addEventListener('click', () => $('mdFile').click());
$('mdFile').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = (ev) => {
    const data = processCSVData(String(ev.target.result).replace(/^\uFEFF/, '')), n = Object.keys(data).length;
    if (!n) { toast('No valid rows found in the CSV.'); return; }
    Object.assign(mdMap(), data); mdPersist(); mdStatus(n + ' rows loaded.');
  };
  r.readAsText(f, 'UTF-8'); e.target.value = '';
});
$('mdClear').addEventListener('click', () => { if (!confirm('Delete ALL records in this list?')) return; S[S.mdType] = {}; mdPersist(); mdStatus('Cleared.'); });
$('mdSample').addEventListener('click', () => {
  const txt = '\uFEFF' + (S.mdType === 'dm' ? 'code,name\n86,Delivery Man One\n7,Delivery Man Two\n' : 'code,name\nC19-05025,Sample Store One\nC19-05026,Sample Store Two\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = (S.mdType === 'dm' ? 'delivery_men' : 'outlets') + '_sample.csv'; a.click();
});
