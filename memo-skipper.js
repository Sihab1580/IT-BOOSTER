/*PURE-START*/
/* ===== Memo Skipper logic (taken from the supplied file; no UI here) ===== */
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

/* one half-page of a memo → memo number, dates, amount, damage / payout flags, outlet */
function parseBlock(blockText, ctx) {
  const rawAlpha = blockText.replace(/[^\u0980-\u09FFa-zA-Z]/g, '');
  const eng = bengaliToEnglish(blockText).replace(/,/g, '').replace(/(\d)\s*\.\s*(\d)/g, '$1.$2');
  const clean = eng.replace(/\s+/g, '');

  const memoMatch = clean.match(/(26\d{8})/);
  const pNum = (clean.match(/P(\d+)of(\d+)/i) || [0, 1])[1];
  const memoNo = memoMatch ? memoMatch[1]
    : (pNum > 1 ? ctx.lastMemoNo : (eng.includes('S-SMART') ? 'No_Num_' + Math.floor(Math.random() * 10000) : ctx.lastMemoNo));

  const dateRegex = /(\d{1,2}\s+[অ-হক-জ্ঞ]+\s+\d{4})|(\d{2}[-/.]\d{2}[-/.]\d{2,4})|(\d{4}[-/.]\d{2}[-/.]\d{2})/g;
  const found = [...blockText.matchAll(dateRegex)].map((m) => m[0]);
  const deliveryDate = found[0] || 'N/A';
  const orderDate = found[1] || deliveryDate;

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
  return { memoNo, orderDate, deliveryDate, amount, isDamage, hasPayout, outlet };
}

/* print / skip decision.  'skipped' = a normal memo below the minimum amount */
function categoryOf(m, min) {
  if (m.hasPayout) return 'payout';
  if (m.isDamage || m.amount === 0) return 'damage';
  return m.amount >= min ? 'valid' : 'skipped';
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
function toast(t) { let e = document.querySelector('.toast'); if (!e) { e = document.createElement('div'); e.className = 'toast'; document.body.appendChild(e); } e.textContent = t; clearTimeout(toastT); toastT = setTimeout(() => e.remove(), 4200); }

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

/* ------------------------------ minimum amount ------------------------------ */
$('minAmt').value = S.min;
$('minAmt').addEventListener('change', () => {
  const v = parseFloat($('minAmt').value);
  if (!isFinite(v) || v < 0) { $('minAmt').value = S.min; return; }
  S.min = v; ls.set('itbMemoMin', String(v));
  Object.values(S.groups).forEach((g) => g.memos.forEach((m) => { delete m.sel; }));     // tick boxes follow the new amount
  render(); toast('Minimum amount set to ৳' + v + '. Ticks updated.');
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
  $('scanBtn').disabled = true; $('progCard').classList.remove('hidden'); $('results').innerHTML = ''; $('kpis').classList.add('hidden');
  S.bufs = {}; S.groups = {};
  const all = {};
  const outlets = Object.keys(S.ol).map((k) => [k, k.replace(/\s+/g, ''), S.ol[k]]).filter((x) => x[1]);
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
          if (!m) m = all[r.memoNo] = { memo_no: r.memoNo, amount: 0.0, isDamage: false, hasPayout: false, parts: [], deliveryMan, outlet: '', orderDate: r.orderDate, deliveryDate: r.deliveryDate };
          const key = fid + ':' + (i - 1) + ':' + blk.half;
          if (!m.parts.includes(key)) m.parts.push(key);
          if (r.amount > m.amount) m.amount = r.amount;
          if (r.isDamage) m.isDamage = true;
          if (r.hasPayout) m.hasPayout = true;
          if (!m.outlet && r.outlet) m.outlet = r.outlet;
          if (m.orderDate === 'N/A' && r.orderDate !== 'N/A') m.orderDate = r.orderDate;
          if (m.deliveryDate === 'N/A' && r.deliveryDate !== 'N/A') m.deliveryDate = r.deliveryDate;
        }
      }
    }
    Object.values(all).forEach((m) => { (S.groups[m.deliveryMan] = S.groups[m.deliveryMan] || { memos: [], open: false, tab: 'print', fo: 'all', fd: 'all' }).memos.push(m); });
    render();
    $('upCard').classList.add('hidden');
  } catch (err) { console.error(err); toast('Error while scanning the memos. Check that the files are valid PDFs.'); }
  finally { $('progCard').classList.add('hidden'); $('progBar').style.width = '0'; $('scanBtn').disabled = false; }
}

/* -------------------------------- results ---------------------------------- */
const isOn = (m) => (m.sel === undefined ? categoryOf(m, S.min) !== 'skipped' : m.sel);
const partLabel = (k) => { const p = k.split(':'); return 'p' + (parseInt(p[1], 10) + 1) + ' ' + p[2]; };
function view(g) { return g.memos.filter((m) => (g.fo === 'all' || m.orderDate === g.fo) && (g.fd === 'all' || m.deliveryDate === g.fd)); }

function rowHtml(m, gi, mi, kind) {
  const cat = categoryOf(m, S.min);
  let badge = '<span class="badge b-ok">Selected</span>', amt = money(m.amount), cls = 'amt';
  if (cat === 'payout') badge = '<span class="badge b-po">Payout (priority)</span>';
  else if (cat === 'damage') { badge = '<span class="badge b-dmg">Damage / 0 BDT</span>'; if (m.isDamage) amt = '0.00'; }
  else if (cat === 'skipped') { badge = '<span class="badge b-sk">Skipped</span>'; cls = 'amt r'; }
  return '<tr><td style="text-align:center"><input type="checkbox" data-act="sel" data-g="' + gi + '" data-m="' + mi + '"' + (isOn(m) ? ' checked' : '') + '></td>' +
    '<td><b>' + esc(m.memo_no) + '</b></td><td>' + (m.outlet ? esc(m.outlet) : '<span style="color:#94A3B8">-</span>') + '</td>' +
    '<td class="dt">Order: <b>' + esc(m.orderDate) + '</b><br>Delivery: <b>' + esc(m.deliveryDate) + '</b></td><td>' + badge + '</td>' +
    '<td><span class="' + cls + '">৳ ' + amt + '</span></td><td class="dt">' + esc(m.parts.map(partLabel).join(', ')) + '</td></tr>';
}
const THEAD = '<thead><tr><th style="width:46px;text-align:center">Sel</th><th>Memo no</th><th>Shop name</th><th>Order / delivery date</th><th>Status</th><th>Amount</th><th>Pages</th></tr></thead>';

function render() {
  const names = Object.keys(S.groups);
  const host = $('results'); host.innerHTML = '';
  if (!names.length) { $('kpis').classList.add('hidden'); return; }
  const T = { total: 0, valid: 0, damage: 0, payout: 0, skipped: 0 };
  let html = '';
  names.forEach((dmName, gi) => {
    const g = S.groups[dmName], list = view(g);
    const cnt = { valid: 0, damage: 0, payout: 0, skipped: 0 };
    list.forEach((m) => { cnt[categoryOf(m, S.min)]++; });
    const printable = [], skipped = [];
    list.forEach((m) => { (categoryOf(m, S.min) === 'skipped' ? skipped : printable).push(m); });
    names.length && (T.total += list.length, T.valid += cnt.valid, T.damage += cnt.damage, T.payout += cnt.payout, T.skipped += cnt.skipped);
    const oSet = [...new Set(g.memos.map((m) => m.orderDate).filter((d) => d !== 'N/A'))], dSet = [...new Set(g.memos.map((m) => m.deliveryDate).filter((d) => d !== 'N/A'))];
    const oOpt = '<option value="all">All order dates</option>' + oSet.map((d) => '<option value="' + esc(d) + '"' + (g.fo === d ? ' selected' : '') + '>Order: ' + esc(d) + '</option>').join('');
    const dOpt = '<option value="all">All delivery dates</option>' + dSet.map((d) => '<option value="' + esc(d) + '"' + (g.fd === d ? ' selected' : '') + '>Delivery: ' + esc(d) + '</option>').join('');
    const body = (rows, kind) => rows.length ? rows.map((m) => rowHtml(m, gi, g.memos.indexOf(m), kind)).join('') : '<tr><td colspan="7" class="empty">' + (kind === 'print' ? 'No printable memos for this date filter.' : 'No skipped memos.') + '</td></tr>';
    html += '<section class="dm' + (g.open ? ' open' : '') + '"><div class="dmh" data-act="toggle" data-g="' + gi + '"><div class="t"><div class="n">Delivery man: ' + esc(dmName) + '</div><div class="pills">' +
      '<span class="pill">Total: ' + list.length + '</span><span class="pill ok">Valid: ' + cnt.valid + '</span><span class="pill info">Damage: ' + cnt.damage + '</span>' +
      (cnt.payout ? '<span class="pill warn">Payouts: ' + cnt.payout + '</span>' : '') + '<span class="pill err">Skipped: ' + cnt.skipped + '</span></div></div>' +
      '<select data-act="fo" data-g="' + gi + '">' + oOpt + '</select><select data-act="fd" data-g="' + gi + '">' + dOpt + '</select><span class="chev">▼</span></div>' +
      '<div class="dmb"><div class="tabs"><button class="tab' + (g.tab === 'print' ? ' on' : '') + '" data-act="tab" data-g="' + gi + '" data-t="print">Valid &amp; print memos (' + printable.length + ')</button>' +
      '<button class="tab' + (g.tab === 'skip' ? ' on' : '') + '" data-act="tab" data-g="' + gi + '" data-t="skip">Skipped memos (' + skipped.length + ')</button></div>' +
      '<div' + (g.tab === 'print' ? '' : ' class="hidden"') + '><div class="tbar"><span>Ready for stitching &amp; printing</span><button class="btn sm" data-act="print" data-g="' + gi + '"' + (printable.length ? '' : ' disabled') + '>Print selected</button></div>' +
      '<div class="tw"><table>' + THEAD + '<tbody>' + body(printable, 'print') + '</tbody></table></div></div>' +
      '<div' + (g.tab === 'skip' ? '' : ' class="hidden"') + '><div class="tbar sk"><span>Skipped: below ৳' + esc(S.min) + ' (tick a memo to print it anyway)</span><button class="btn sm" data-act="print" data-g="' + gi + '">Print selected</button></div>' +
      '<div class="tw"><table>' + THEAD + '<tbody>' + body(skipped, 'skip') + '</tbody></table></div></div></div></section>';
  });
  host.innerHTML = html;
  $('kpis').innerHTML = [['Total memos', T.total, ''], ['Valid', T.valid, 'ok'], ['Damage', T.damage, 'info'], ['Payout', T.payout, 'warn'], ['Skipped', T.skipped, 'err']]
    .map((k) => '<div class="kpi ' + k[2] + '"><small>' + k[0] + '</small><b>' + k[1] + '</b></div>').join('');
  $('kpis').classList.remove('hidden');
}

$('results').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act, g = S.groups[Object.keys(S.groups)[+el.dataset.g]];
  if (act === 'toggle') { if (e.target.closest('select')) return; g.open = !g.open; render(); }
  else if (act === 'tab') { g.tab = el.dataset.t; render(); }
  else if (act === 'sel') { g.memos[+el.dataset.m].sel = el.checked; }
  else if (act === 'print') printGroup(g, el);
});
$('results').addEventListener('change', (e) => {
  const el = e.target.closest('select[data-act]'); if (!el) return;
  const g = S.groups[Object.keys(S.groups)[+el.dataset.g]];
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
