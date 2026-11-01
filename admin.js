/* IT BOOSTER — ADMIN PANEL  (applications · users · app control). Uses window.AUTH from auth.js */
(function () {
  'use strict';
  const A = window.AUTH, esc = A.esc, $ = (id) => document.getElementById(id);
  const st = { regs: {}, users: {}, cfg: {}, tab: 'apps', appF: 'pending', userF: 'all', open: null, cred: null };
  const fmt = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const say = (id, type, html) => { const e = $(id); e.className = 'ag-msg ' + (type || '') + (html ? '' : ' hidden'); e.innerHTML = html || ''; };
  const toast = (type, html) => { say('admMsg', type, html); if (html) { clearTimeout(toast.t); toast.t = setTimeout(() => say('admMsg'), 7000); } };
  function genPw() { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', a = new Uint32Array(9); crypto.getRandomValues(a); return Array.from(a, (x) => c[x % c.length]).join(''); }
  const objList = (o) => Object.keys(o || {}).map((k) => Object.assign({ _id: k }, o[k]));
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });          // YYYY-MM-DD, Bangladesh time
  const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const badge = (s) => `<span class="adm-st ${esc(s)}">${esc(s)}</span>`;

  /* ------------------------------- data ---------------------------------- */
  const byId = (arr) => Object.fromEntries((arr || []).map((x) => [String(x._id), x]));
  async function loadAll() {
    const [r, u, c] = await Promise.all([A.call('itb_admin_regs'), A.call('itb_admin_users'), A.getConfig()]);
    st.regs = byId(r); st.users = byId(u); st.cfg = c || {};
    render();
  }

  /* ------------------------------ actions -------------------------------- */
  async function approve(rid, town, idRaw, pw, exp) {
    const reg = st.regs[rid]; if (!reg) throw new Error('Application not found.');
    const id = A.idKey(idRaw);
    if (!town.trim()) throw new Error('Town is required.');
    if (!A.okId(id)) throw new Error('User ID: 3–30 letters, numbers, - or _ only.');
    if (pw.length < 6) throw new Error('Password must be at least 6 characters.');
    if (exp && !isoOk(exp)) throw new Error('Choose a valid access end date (or No limit).');
    await A.call('itb_admin_approve', { p_reg_id: rid, p_town: town.trim(), p_login_id: id, p_password: pw, p_expires_on: exp || '' });
    return { id, pw, name: reg.itName, exp: exp || '' };
  }
  const reject = (rid, reason) => A.call('itb_admin_reject', { p_reg_id: rid, p_reason: reason || '' });
  const setStatus = (uid, status) => A.call('itb_admin_set_status', { p_user_id: String(uid), p_status: status });
  async function resetPw(uid, pw) {
    const u = st.users[uid]; if (!u) throw new Error('User not found.');
    if (pw.length < 6) throw new Error('Password must be at least 6 characters.');
    await A.call('itb_admin_reset_pw', { p_user_id: String(uid), p_password: pw });
    return { id: u.loginId, pw, name: u.itName };
  }
  const setExpiry = (uid, exp) => A.call('itb_admin_set_expiry', { p_user_id: String(uid), p_expires_on: exp || '' });
  const removeUser = (uid) => A.call('itb_admin_remove', { p_user_id: String(uid) });

  /* ------------------------------- views --------------------------------- */
  function credBox() {
    if (!st.cred) return '';
    const c = st.cred, msg = `IT BOOSTER login\nUser ID: ${c.id}\nPassword: ${c.pw}${c.exp ? '\nAccess until: ' + A.fmtDay(c.exp) + ' (midnight, Bangladesh time)' : ''}\nLink: ${location.origin}${location.pathname.replace(/admin\.html$/, '')}`;
    return `<div class="adm-cred"><div><b>${esc(c.title)}</b><p>Share these with <b>${esc(c.name || 'the user')}</b>. The password is shown only now — it is not stored anywhere.</p>
      <pre id="credTxt">${esc(msg)}</pre></div><div class="adm-cred-b"><button class="ag-primary" data-act="copycred" type="button">Copy message</button><button class="adm-btn" data-act="closecred" type="button">Done</button></div></div>`;
  }
  function renderKpis() {
    const R = objList(st.regs), U = objList(st.users).filter((u) => u.role !== 'admin');
    const n = (a, f) => a.filter(f).length;
    $('kpiApps').innerHTML = [['Pending', n(R, (r) => r.status === 'pending'), 'warn'], ['Approved', n(R, (r) => r.status === 'approved'), 'ok'], ['Rejected', n(R, (r) => r.status === 'rejected'), 'bad'], ['Total', R.length, '']].map((k) => `<div class="adm-kpi ${k[2]}"><small>${k[0]}</small><b>${k[1]}</b></div>`).join('');
    $('kpiUsers').innerHTML = [['Active users', n(U, (u) => u.status === 'active'), 'ok'], ['Suspended', n(U, (u) => u.status === 'suspended'), 'warn'], ['Ending in 7 days', n(U, (u) => u.daysLeft != null && u.daysLeft >= 0 && u.daysLeft <= 7), 'warn'], ['Expired', n(U, (u) => u.daysLeft != null && u.daysLeft < 0), 'bad'], ['Total users', U.length, '']].map((k) => `<div class="adm-kpi ${k[2]}"><small>${k[0]}</small><b>${k[1]}</b></div>`).join('');
    const p = n(R, (r) => r.status === 'pending'), b = $('bdApps'); b.textContent = p; b.classList.toggle('hidden', !p);
  }
  function renderApps() {
    const q = $('appSearch').value.trim().toLowerCase();
    let L = objList(st.regs).filter((r) => st.appF === 'all' || r.status === st.appF).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (q) L = L.filter((r) => [r.town, r.sap, r.itName, r.house, r.email, r.itPhone, r.mgrPhone, r.loginId].join(' ').toLowerCase().includes(q));
    $('appList').innerHTML = (st.tab === 'apps' ? credBox() : '') + (L.length ? L.map((r) => {
      const o = st.open && st.open.id === r._id ? st.open.mode : '';
      let extra = '';
      if (o === 'approve') extra = `<div class="adm-form"><label>Town<input data-f="town" value="${esc(r.town)}"></label><label>User ID<input data-f="id" value="${esc(String(r.sap || '').toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}" autocapitalize="characters"></label>
        <label>Password<span class="ag-pw"><input data-f="pw" value="${esc(genPw())}"><button type="button" data-act="gen">New</button></span></label>
        <label>Access until<input data-f="exp" type="date" value="${addDays(today(), 30)}"></label>
        <div class="full adm-presets"><small>Quick:</small><button class="adm-btn" data-act="preset" data-days="30" type="button">30 days</button><button class="adm-btn" data-act="preset" data-days="90" type="button">90 days</button><button class="adm-btn" data-act="preset" data-days="365" type="button">1 year</button><button class="adm-btn" data-act="preset" data-days="0" type="button">No limit</button><small>Access ends at midnight (Bangladesh time) at the end of this date.</small></div>
        <div class="adm-form-b"><button class="ag-primary" data-act="doapprove" data-id="${r._id}" type="button">Approve &amp; create account</button><button class="adm-btn" data-act="cancel" type="button">Cancel</button></div></div>`;
      if (o === 'reject') extra = `<div class="adm-form"><label class="full">Reason (shown to the applicant, optional)<input data-f="reason" placeholder="e.g. SAP code not found"></label>
        <div class="adm-form-b"><button class="adm-btn danger" data-act="doreject" data-id="${r._id}" type="button">Reject application</button><button class="adm-btn" data-act="cancel" type="button">Cancel</button></div></div>`;
      return `<article class="adm-item"><div class="adm-item-h"><div><b>${esc(r.itName)}</b> <span class="adm-muted">· ${esc(r.house)}</span><div class="adm-muted">${esc(r.town)} · SAP ${esc(r.sap)} · applied ${fmt(r.createdAt)}</div></div>${badge(r.status || 'pending')}</div>
        <div class="adm-fields"><span><small>Email</small>${esc(r.email)}</span><span><small>IT phone</small>${esc(r.itPhone)}</span><span><small>Manager phone</small>${esc(r.mgrPhone)}</span>${r.loginId ? `<span><small>User ID</small><b>${esc(r.loginId)}</b></span>` : ''}${r.reason ? `<span><small>Reason</small>${esc(r.reason)}</span>` : ''}</div>
        ${r.status === 'pending' && !o ? `<div class="adm-act"><button class="ag-primary" data-act="approve" data-id="${r._id}" type="button">Approve…</button><button class="adm-btn danger" data-act="reject" data-id="${r._id}" type="button">Reject…</button></div>` : ''}${extra}</article>`;
    }).join('') : '<div class="adm-empty">Nothing here.</div>');
  }
  function expiryCell(u) {
    if (!u.expiresOn) return '<span class="adm-st active">No limit</span>';
    const d = u.daysLeft;
    const tag = d < 0 ? '<span class="adm-st rejected">Expired</span>' : d <= 7 ? '<span class="adm-st pending">' + d + ' day' + (d === 1 ? '' : 's') + ' left</span>' : '<span class="adm-muted">' + d + ' days left</span>';
    return '<b>' + esc(A.fmtDay(u.expiresOn)) + '</b><br>' + tag;
  }
  function renderUsers() {
    const q = $('userSearch').value.trim().toLowerCase();
    let L = objList(st.users).filter((u) => u.role !== 'admin' && (st.userF === 'all' || u.status === st.userF)).sort((a, b) => String(a.loginId).localeCompare(String(b.loginId)));
    if (q) L = L.filter((u) => [u.loginId, u.town, u.itName, u.house, u.sap, u.email].join(' ').toLowerCase().includes(q));
    $('userList').innerHTML = (st.tab === 'users' ? credBox() : '') + (L.length ? `<div class="adm-table"><table><thead><tr><th>User ID</th><th>Name</th><th>Town</th><th>SAP</th><th>House</th><th>Contact</th><th>Access until</th><th>Status</th><th></th></tr></thead><tbody>${L.map((u) => {
      const open = st.open && st.open.id === u._id && st.open.mode === 'reset', openE = st.open && st.open.id === u._id && st.open.mode === 'expiry';
      return `<tr><td><b>${esc(u.loginId)}</b></td><td>${esc(u.itName)}</td><td>${esc(u.town)}</td><td>${esc(u.sap)}</td><td>${esc(u.house)}</td><td>${esc(u.itPhone)}<br><span class="adm-muted">${esc(u.email)}</span></td><td>${expiryCell(u)}</td><td>${badge(u.status)}</td>
        <td class="adm-rowact">${u.status === 'active' ? `<button class="adm-btn" data-act="suspend" data-id="${u._id}">Suspend</button>` : `<button class="adm-btn" data-act="activate" data-id="${u._id}">Activate</button>`}<button class="adm-btn" data-act="extend" data-id="${u._id}">+30 days</button><button class="adm-btn" data-act="expiry" data-id="${u._id}">Set date</button><button class="adm-btn" data-act="reset" data-id="${u._id}">Reset password</button><button class="adm-btn danger" data-act="remove" data-id="${u._id}">Remove</button></td></tr>
        ${openE ? `<tr><td colspan="9"><div class="adm-form"><label>Access until<input data-f="exp" type="date" value="${esc(u.expiresOn || addDays(today(), 30))}"></label><div class="full adm-presets"><small>Quick:</small><button class="adm-btn" data-act="preset" data-days="30" type="button">+30 days from today</button><button class="adm-btn" data-act="preset" data-days="365" type="button">1 year</button><button class="adm-btn" data-act="preset" data-days="0" type="button">No limit</button></div><div class="adm-form-b"><button class="ag-primary" data-act="doexpiry" data-id="${u._id}" type="button">Save date</button><button class="adm-btn" data-act="cancel" type="button">Cancel</button></div></div></td></tr>` : ''}
        ${open ? `<tr><td colspan="9"><div class="adm-form"><label>New password<span class="ag-pw"><input data-f="pw" value="${esc(genPw())}"><button type="button" data-act="gen">New</button></span></label><div class="adm-form-b"><button class="ag-primary" data-act="doreset" data-id="${u._id}" type="button">Set new password</button><button class="adm-btn" data-act="cancel" type="button">Cancel</button></div></div></td></tr>` : ''}`;
    }).join('')}</tbody></table></div>` : '<div class="adm-empty">No users yet.</div>');
  }
  function renderCtrl() {
    const c = st.cfg; $('cEnabled').checked = c.enabled !== false; $('cReg').checked = c.registrationOpen !== false;
    $('cMsg').value = c.message || ''; $('cAnn').value = c.announcement || '';
  }
  /* ------------------------- Memo Skipper dashboard ------------------------- */
  const num = (v) => Number(v || 0), pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-');
  const money = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sum = (arr, k) => arr.reduce((s, r) => s + num(r[k]), 0);
  async function loadMemo() {
    const from = $('mFrom').value, to = $('mTo').value;
    if (!isoOk(from) || !isoOk(to) || from > to) { toast('error', 'Choose a valid date range.'); return; }
    st.memo = (await A.call('itb_admin_memo_log', { p_from: from, p_to: to })) || [];
    renderMemo();
  }
  function renderMemo() {
    const rows = st.memo || [];
    const T = { total: sum(rows, 'total'), valid: sum(rows, 'valid'), damage: sum(rows, 'damage'), payout: sum(rows, 'payout'), skipped: sum(rows, 'skipped'), amt: sum(rows, 'skippedAmount') };
    const users = new Set(rows.map((r) => r.loginId));
    $('kpiMemo').innerHTML = [['Memos processed', T.total, ''], ['Skipped', T.skipped, 'bad'], ['Skip rate', pct(T.skipped, T.total), 'warn'], ['Skipped amount (৳)', money(T.amt), 'warn'], ['Users active', users.size, 'ok']]
      .map((k) => `<div class="adm-kpi ${k[2]}"><small>${k[0]}</small><b>${k[1]}</b></div>`).join('');
    const days = {}; rows.forEach((r) => { const d = days[r.date] = days[r.date] || { date: r.date, users: new Set(), total: 0, valid: 0, damage: 0, payout: 0, skipped: 0, amt: 0 };
      d.users.add(r.loginId); d.total += num(r.total); d.valid += num(r.valid); d.damage += num(r.damage); d.payout += num(r.payout); d.skipped += num(r.skipped); d.amt += num(r.skippedAmount); });
    const dl = Object.values(days).sort((a, b) => (a.date < b.date ? 1 : -1)), mx = Math.max(1, ...dl.map((d) => d.skipped));
    $('memoDays').innerHTML = dl.length ? `<div class="adm-table"><table><thead><tr><th>Date</th><th>Users</th><th>Memos</th><th>Valid</th><th>Damage</th><th>Payout</th><th>Skipped</th><th>Skip rate</th><th>Skipped amount (৳)</th></tr></thead><tbody>${dl.map((d) =>
      `<tr><td><b>${esc(A.fmtDay(d.date))}</b></td><td>${d.users.size}</td><td>${d.total}</td><td>${d.valid}</td><td>${d.damage}</td><td>${d.payout}</td><td><div class="adm-bar-c"><i style="width:${Math.round(d.skipped / mx * 100)}%"></i><span>${d.skipped}</span></div></td><td>${pct(d.skipped, d.total)}</td><td>${money(d.amt)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="adm-empty">No records in this range.</div>';
    const us = {}; rows.forEach((r) => { const u = us[r.loginId] = us[r.loginId] || { loginId: r.loginId, itName: r.itName, town: r.town, days: new Set(), total: 0, skipped: 0, amt: 0 };
      u.days.add(r.date); u.total += num(r.total); u.skipped += num(r.skipped); u.amt += num(r.skippedAmount); });
    const ul = Object.values(us).sort((a, b) => b.skipped - a.skipped);
    $('memoUsers').innerHTML = ul.length ? `<div class="adm-table"><table><thead><tr><th>User ID</th><th>Name</th><th>Town</th><th>Days used</th><th>Memos</th><th>Skipped</th><th>Skip rate</th><th>Skipped amount (৳)</th></tr></thead><tbody>${ul.map((u) =>
      `<tr><td><b>${esc(u.loginId)}</b></td><td>${esc(u.itName)}</td><td>${esc(u.town)}</td><td>${u.days.size}</td><td>${u.total}</td><td>${u.skipped}</td><td>${pct(u.skipped, u.total)}</td><td>${money(u.amt)}</td></tr>`).join('')}</tbody></table></div>` : '';
  }
  function memoCsv() {
    const rows = st.memo || []; if (!rows.length) { toast('error', 'Nothing to export.'); return; }
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [['Date', 'User ID', 'Name', 'Town', 'Memos', 'Valid', 'Damage', 'Payout', 'Skipped', 'Skipped amount'].join(',')]
      .concat(rows.map((r) => [r.date, q(r.loginId), q(r.itName), q(r.town), r.total, r.valid, r.damage, r.payout, r.skipped, r.skippedAmount].join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'memo_skipper_' + $('mFrom').value + '_' + $('mTo').value + '.csv'; a.click();
  }
  function render() { renderKpis(); renderApps(); renderUsers(); if (!render.once) { renderCtrl(); render.once = 1; } }

  /* ------------------------------- wiring -------------------------------- */
  async function run(fn, okMsg) {
    try { await fn(); if (okMsg) toast('ok', okMsg); await loadAll(); }
    catch (e) { toast('error', esc(e.message)); }
  }
  function field(btn, name) { const f = btn.closest('.adm-form'); const el = f && f.querySelector('[data-f="' + name + '"]'); return el ? el.value : ''; }
  function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'approve' || act === 'reject' || act === 'reset' || act === 'expiry') { st.open = { id, mode: act }; return render(); }
    if (act === 'cancel') { st.open = null; return render(); }
    if (act === 'preset') { const i = b.closest('.adm-form').querySelector('[data-f="exp"]'); const n = +b.dataset.days; i.value = n ? addDays(today(), n) : ''; return; }
    if (act === 'extend') { const u = st.users[id]; const base = u && u.expiresOn && u.expiresOn >= today() ? u.expiresOn : today(); const nx = addDays(base, 30);
      return run(() => setExpiry(id, nx), 'Access extended to ' + A.fmtDay(nx) + '.'); }
    if (act === 'doexpiry') { b.disabled = true; const x = field(b, 'exp'); if (x && !isoOk(x)) { toast('error', 'Choose a valid date.'); b.disabled = false; return; }
      return run(async () => { await setExpiry(id, x); st.open = null; }, x ? 'Access end date saved.' : 'Access limit removed.'); }
    if (act === 'gen') { const i = b.closest('.ag-pw').querySelector('input'); i.value = genPw(); return; }
    if (act === 'closecred') { st.cred = null; return render(); }
    if (act === 'copycred') { try { navigator.clipboard.writeText($('credTxt').textContent); b.textContent = 'Copied'; } catch (x) { /* ignore */ } return; }
    if (act === 'doapprove') { b.disabled = true; const t = field(b, 'town'), i = field(b, 'id'), p = field(b, 'pw'), x = field(b, 'exp');
      return run(async () => { const c = await approve(id, t, i, p, x); st.cred = Object.assign(c, { title: 'Account created' }); st.open = null; }, 'Application approved.'); }
    if (act === 'doreject') { b.disabled = true; const r = field(b, 'reason'); return run(async () => { await reject(id, r); st.open = null; }, 'Application rejected.'); }
    if (act === 'doreset') { b.disabled = true; const p = field(b, 'pw');
      return run(async () => { const c = await resetPw(id, p); st.cred = Object.assign(c, { title: 'Password changed' }); st.open = null; }, 'Password changed.'); }
    if (act === 'suspend') return run(() => setStatus(id, 'suspended'), 'User suspended.');
    if (act === 'activate') return run(() => setStatus(id, 'active'), 'User activated.');
    if (act === 'remove') { if (confirm('Remove this user? They will no longer be able to log in.')) return run(() => removeUser(id), 'User removed.'); }
  }

  function enter() {
    $('admLogin').classList.add('hidden'); $('admApp').classList.remove('hidden');
    $('admWho').textContent = (A.profile() || {}).loginId || '';
    loadAll().catch((e) => toast('error', esc(e.message)));
  }
  function init() {
    $('admForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = $('admLoginBtn'); say('admLoginMsg'); btn.disabled = true; btn.textContent = 'Logging in…';
      try { await A.adminLogin($('admEmail').value, $('admPw').value); enter(); }
      catch (err) { say('admLoginMsg', 'error', esc(err.message)); }
      btn.disabled = false; btn.textContent = 'Log in';
    });
    $('admOut').addEventListener('click', () => { A.logout(); location.reload(); });
    $('admRefresh').addEventListener('click', () => run(async () => {}, 'Refreshed.'));
    $('admTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.tab = b.dataset.t; st.open = null;
      document.querySelectorAll('#admTabs button').forEach((x) => x.classList.toggle('on', x === b));
      ['apps', 'users', 'ctrl', 'memo'].forEach((t) => $('tab-' + t).classList.toggle('hidden', t !== st.tab)); render();
      if (st.tab === 'memo' && !st.memo) loadMemo().catch((e) => toast('error', esc(e.message))); });
    const seg = (id, key) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st[key] = b.dataset.f; $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); render(); });
    seg('appFilter', 'appF'); seg('userFilter', 'userF');
    $('appSearch').addEventListener('input', renderApps); $('userSearch').addEventListener('input', renderUsers);
    $('mTo').value = today(); $('mFrom').value = addDays(today(), -29);
    $('mLoad').addEventListener('click', () => loadMemo().catch((e) => toast('error', esc(e.message))));
    $('mCsv').addEventListener('click', memoCsv);
    $('mQuick').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; $('mTo').value = today(); $('mFrom').value = addDays(today(), -(+b.dataset.d - 1));
      $('mQuick').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); loadMemo().catch((er) => toast('error', esc(er.message))); });
    $('tab-apps').addEventListener('click', onClick); $('tab-users').addEventListener('click', onClick);
    $('cSave').addEventListener('click', async () => {
      const body = { enabled: $('cEnabled').checked, registrationOpen: $('cReg').checked, message: $('cMsg').value.trim(), announcement: $('cAnn').value.trim() };
      try { await A.call('itb_admin_config_set', { p_enabled: body.enabled, p_reg_open: body.registrationOpen, p_message: body.message, p_announcement: body.announcement }); st.cfg = body; say('cMsgOut', 'ok', 'Saved. The change is live for all users.'); setTimeout(() => say('cMsgOut'), 4000); }
      catch (e) { say('cMsgOut', 'error', esc(e.message)); }
    });
    if (!A.keyReady()) say('admLoginMsg', 'warn', '<b>Setup needed:</b> add the Supabase URL and key in <code>config.js</code>.');
    A.restore(true).then((p) => { if (p) enter(); });
  }
  init();
})();
