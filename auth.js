/* =============================================================================
 *  IT BOOSTER — ACCOUNTS
 *   • Registration (pending) → administrator approves + creates User ID & Password → login
 *   • Backend: Supabase database functions (passwords are bcrypt-hashed on the server)
 *   • window.AUTH is shared by the app (index.html) and the admin panel (admin.html)
 *   • Never touches reports, calculations or uploaded data
 * ============================================================================= */
(function (root) {
  'use strict';
  const CFG = root.APP_CONFIG, SKEY = 'itbSession', RKEY = 'itbLastReg';
  const idKey = (s) => String(s == null ? '' : s).trim().toUpperCase();
  const okId = (s) => /^[A-Z0-9_-]{3,30}$/.test(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } };
  const keyReady = () => !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY && String(CFG.SUPABASE_KEY).indexOf('PASTE_') !== 0);

  let S = null, profile = null;                                   // S = { token }

  function friendly(m) {
    m = String(m || '');
    if (/Could not find the function|schema cache|does not exist/i.test(m)) return 'The database is not set up yet. Run supabase-setup.sql in the Supabase SQL Editor.';
    if (/invalid api key|JWT|apikey/i.test(m)) return 'The Supabase key in config.js is not valid.';
    return m || 'Something went wrong.';
  }
  async function rpc(fn, args) {
    if (!keyReady()) throw new Error('Setup needed: add the Supabase URL and key in config.js.');
    let r;
    try {
      r = await fetch(CFG.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', apikey: CFG.SUPABASE_KEY }, body: JSON.stringify(args || {}) });
    } catch (e) { throw new Error('Could not reach the server — check your internet connection.'); }
    let j = null; try { j = await r.json(); } catch (e) { /* empty body */ }
    if (!r.ok) throw new Error(friendly((j && (j.message || j.error_description || j.hint)) || ('Server error ' + r.status)));
    return j;
  }
  const call = (fn, args) => rpc(fn, Object.assign({ p_token: S ? S.token : null }, args || {}));
  const token = async () => (S ? S.token : null);
  const save = () => lsSet(SKEY, S ? JSON.stringify({ token: S.token }) : null);
  const getConfig = async () => { try { return (await rpc('itb_config_get')) || {}; } catch (e) { return {}; } };

  async function login(idRaw, pw) {
    const id = idKey(idRaw);
    if (!okId(id)) throw new Error('Enter your User ID.');
    if (!pw) throw new Error('Enter your password.');
    const j = await rpc('itb_login', { p_login_id: id, p_password: pw });
    if (!j || j.error) throw new Error((j && j.error) || 'Login failed.');
    S = { token: j.token }; profile = j.user; save(); return profile;
  }
  async function adminLogin(id, pw) {
    const p = await login(id, pw);
    if (p.role !== 'admin') { logout(); throw new Error('This account is not an administrator.'); }
    return p;
  }
  async function restore(adminMode) {
    const raw = lsGet(SKEY); if (!raw) return null;
    try {
      const s = JSON.parse(raw); if (!s || !s.token) return null;
      S = { token: s.token }; profile = await call('itb_me');
      if (adminMode && profile.role !== 'admin') throw new Error('not admin');
      return profile;
    } catch (e) { S = null; profile = null; if (!adminMode) save(); return null; }
  }
  function logout() { if (S) { const t = S.token; rpc('itb_logout', { p_token: t }).catch(() => {}); } S = null; profile = null; save(); }

  async function register(f) {
    const id = await rpc('itb_register', { p_town: f.town, p_sap: f.sap, p_it_name: f.itName, p_house: f.house, p_email: f.email, p_it_phone: f.itPhone, p_mgr_phone: f.mgrPhone });
    lsSet(RKEY, id); return id;
  }
  const regStatus = (rid) => rpc('itb_reg_status', { p_id: String(rid).trim() });

  root.AUTH = { token, call, rpc, login, adminLogin, restore, logout, register, regStatus, getConfig, idKey, okId, esc, friendly,
    profile: () => profile, session: () => S, lastReg: () => lsGet(RKEY), keyReady };

  /* =========================================================================
   *  LOGIN / REGISTER SCREEN  (only on the main app page)
   * ========================================================================= */
  if (document.getElementById('itbAdminPage') || (document.body && document.body.hasAttribute('data-itb-nogate'))) return;
  const ic = (d, w) => `<svg viewBox="0 0 24 24" width="${w || 18}" height="${w || 18}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const BOLT = '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>';
  const $ = (id) => document.getElementById(id);
  const say = (id, type, html) => { const e = $(id); if (!e) return; e.className = 'ag-msg ' + (type || '') + (html ? '' : ' hidden'); e.innerHTML = html || ''; };
  const busy = (btn, on, txt) => { btn.disabled = on; if (txt) btn.dataset.t = btn.dataset.t || btn.textContent; btn.textContent = on ? (txt || 'Please wait…') : (btn.dataset.t || btn.textContent); };

  function build() {
    const g = document.createElement('div'); g.id = 'itbGate';
    g.innerHTML = `<div class="ag-wrap">
      <div class="ag-brand"><span class="ag-logo">${ic(BOLT, 22)}</span><div><b>IT BOOSTER</b><small>Distribution reporting</small></div></div>
      <div class="ag-card">
        <div id="agNotice" class="ag-msg warn hidden"></div>
        <div class="ag-tabs" role="tablist"><button type="button" data-t="login" class="on">Login</button><button type="button" data-t="reg">Register</button><button type="button" data-t="track">Application status</button></div>

        <form id="agLogin" data-p="login" novalidate autocomplete="on">
          <h2>Welcome back</h2><p class="ag-sub">Log in with the User ID and password given by your administrator.</p>
          <label>User ID<input id="agId" autocomplete="username" autocapitalize="characters" spellcheck="false" placeholder="e.g. UBL1234"></label>
          <label>Password<span class="ag-pw"><input id="agPw" type="password" autocomplete="current-password" placeholder="Your password"><button type="button" id="agEye" aria-label="Show password">Show</button></span></label>
          <div id="agLoginMsg" class="ag-msg hidden"></div>
          <button class="ag-primary" id="agLoginBtn" type="submit">Log in</button>
          <p class="ag-foot">No account yet? <a href="#" data-go="reg">Register here</a></p>
        </form>

        <form id="agReg" data-p="reg" class="hidden" novalidate>
          <h2>Register</h2><p class="ag-sub">Fill in your details. After the administrator approves your application, you will receive a User ID and password.</p>
          <div class="ag-grid">
            <label>Town Name<input name="town" autocomplete="off" placeholder="Town"></label>
            <label>SAP Code<input name="sap" autocomplete="off" placeholder="SAP code"></label>
            <label>IT Name<input name="itName" autocomplete="name" placeholder="Your full name"></label>
            <label>House Name<input name="house" autocomplete="off" placeholder="House / distributor name"></label>
            <label class="full">Email<input name="email" type="email" autocomplete="email" placeholder="name@example.com"></label>
            <label>IT Phone No<input name="itPhone" type="tel" autocomplete="tel" placeholder="01XXXXXXXXX"></label>
            <label>Manager Phone No<input name="mgrPhone" type="tel" autocomplete="off" placeholder="01XXXXXXXXX"></label>
          </div>
          <div id="agRegMsg" class="ag-msg hidden"></div>
          <button class="ag-primary" id="agRegBtn" type="submit">Apply for access</button>
          <p class="ag-foot">Already approved? <a href="#" data-go="login">Log in</a></p>
        </form>
        <div id="agRegDone" class="hidden" data-p="regdone"></div>

        <form id="agTrack" data-p="track" class="hidden" novalidate>
          <h2>Application status</h2><p class="ag-sub">Enter the reference number you received after registering.</p>
          <label>Reference number<input id="agRef" autocomplete="off" spellcheck="false" placeholder="Reference number"></label>
          <div id="agTrackMsg" class="ag-msg hidden"></div>
          <button class="ag-primary" id="agTrackBtn" type="submit">Check status</button>
        </form>
      </div>
      <div class="ag-copy">© IT BOOSTER</div></div>`;
    document.body.insertBefore(g, document.body.firstChild);
    return g;
  }

  function showTab(t) {
    document.querySelectorAll('#itbGate .ag-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    ['login', 'reg', 'track'].forEach((p) => { const f = $(p === 'login' ? 'agLogin' : p === 'reg' ? 'agReg' : 'agTrack'); f.classList.toggle('hidden', p !== t); });
    $('agRegDone').classList.add('hidden');
  }

  function unlock() {
    const p = profile;
    document.body.classList.remove('itb-locked');
    const g = $('itbGate'); if (g) g.remove();
    const vm = $('viewMsg'); if (vm) { vm.className = 'alert hidden'; vm.innerHTML = ''; }
    const rt = $('refreshTowns'); if (rt) rt.click();                  // reload the town list now that we are signed in
    const slot = $('mvActSlot') || document.querySelector('.top-actions');
    if (slot && !$('itbLogout')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'itbLogout'; b.className = 'menu-btn signout';
      b.title = 'Log out of ' + (p.itName || p.loginId || 'your account');
      b.innerHTML = ic('<path d="m16 17 5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>', 15) + ' Log out · ' + esc(p.loginId || '');
      b.addEventListener('click', () => { logout(); location.reload(); });
      slot.insertBefore(b, slot.firstChild);
    }
    getConfig().then((c) => {
      if (!c.announcement) return;
      const n = document.createElement('div'); n.id = 'itbNotice'; n.innerHTML = '<span>' + esc(c.announcement) + '</span><button type="button" aria-label="Dismiss">✕</button>';
      n.querySelector('button').onclick = () => n.remove(); document.body.appendChild(n);
    });
  }

  const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
  const phoneOk = (s) => /^\+?[0-9][0-9\s-]{8,15}$/.test(s);

  async function init() {
    const g = build();
    g.querySelectorAll('.ag-tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.t)));
    g.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showTab(a.dataset.go); }));
    $('agEye').addEventListener('click', () => { const i = $('agPw'), s = i.type === 'password'; i.type = s ? 'text' : 'password'; $('agEye').textContent = s ? 'Hide' : 'Show'; });
    const last = lastRegId(); if (last) $('agRef').value = last;

    $('agLogin').addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = $('agLoginBtn'); say('agLoginMsg');
      busy(btn, true, 'Logging in…');
      try { await login($('agId').value, $('agPw').value); if (window.ITB_APP_LOADED) unlock(); else location.reload(); }
      catch (err) { say('agLoginMsg', 'error', esc(err.message)); busy(btn, false); }
    });

    $('agReg').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target, btn = $('agRegBtn'); say('agRegMsg');
      const v = {}; ['town', 'sap', 'itName', 'house', 'email', 'itPhone', 'mgrPhone'].forEach((k) => { v[k] = f.elements[k].value.replace(/\s+/g, ' ').trim(); });
      const names = { town: 'Town Name', sap: 'SAP Code', itName: 'IT Name', house: 'House Name', email: 'Email', itPhone: 'IT Phone No', mgrPhone: 'Manager Phone No' };
      const miss = Object.keys(names).filter((k) => !v[k]); if (miss.length) return say('agRegMsg', 'error', 'Please fill in: ' + miss.map((k) => names[k]).join(', ') + '.');
      if (!emailOk(v.email)) return say('agRegMsg', 'error', 'Enter a valid email address.');
      if (!phoneOk(v.itPhone)) return say('agRegMsg', 'error', 'Enter a valid IT phone number.');
      if (!phoneOk(v.mgrPhone)) return say('agRegMsg', 'error', 'Enter a valid manager phone number.');
      busy(btn, true, 'Submitting…');
      try {
        const rid = await register(v);
        f.classList.add('hidden');
        const d = $('agRegDone'); d.classList.remove('hidden');
        d.innerHTML = `<div class="ag-done"><span class="ag-tick">${ic('<path d="M5 13l4 4L19 7"/>', 26)}</span><h2>Application submitted</h2>
          <p class="ag-sub">Your application is waiting for approval. Once approved, the administrator will give you your User ID and password.</p>
          <div class="ag-ref"><small>Your reference number</small><code>${esc(rid)}</code><button type="button" id="agCopy">Copy</button></div>
          <p class="ag-sub">Keep this number — you can use it under <b>Application status</b> to check your request.</p>
          <button class="ag-primary" type="button" id="agBack">Back to login</button></div>`;
        $('agCopy').onclick = () => { try { navigator.clipboard.writeText(rid); $('agCopy').textContent = 'Copied'; } catch (x) { /* ignore */ } };
        $('agBack').onclick = () => { f.reset(); f.classList.remove('hidden'); busy(btn, false); showTab('login'); };
        $('agRef').value = rid;
      } catch (err) { say('agRegMsg', 'error', esc(err.message)); busy(btn, false); }
    });

    $('agTrack').addEventListener('submit', async (e) => {
      e.preventDefault(); const ref = $('agRef').value.trim(), btn = $('agTrackBtn'); say('agTrackMsg');
      if (!ref) return say('agTrackMsg', 'error', 'Enter your reference number.');
      busy(btn, true, 'Checking…');
      try {
        const r = await regStatus(ref);
        if (!r) say('agTrackMsg', 'error', 'No application found with this reference number.');
        else if (r.status === 'approved') say('agTrackMsg', 'ok', `<b>Approved.</b> Your User ID is <b>${esc(r.loginId || '')}</b>. The administrator will share your password with you.`);
        else if (r.status === 'rejected') say('agTrackMsg', 'error', '<b>Not approved.</b> ' + esc(r.reason || 'Please contact your administrator.'));
        else say('agTrackMsg', 'warn', '<b>Pending.</b> Your application is waiting for the administrator.');
      } catch (err) { say('agTrackMsg', 'error', esc(err.message)); }
      busy(btn, false);
    });

    // app control: maintenance / closed registrations
    getConfig().then((c) => {
      if (c.enabled === false) { const n = $('agNotice'); n.className = 'ag-msg warn'; n.innerHTML = '<b>Temporarily unavailable.</b> ' + esc(c.message || 'Please try again later.'); }
      else if (c.registrationOpen === false) { const n = $('agNotice'); n.className = 'ag-msg warn'; n.innerHTML = 'New registrations are closed at the moment.'; }
    });
    if (!keyReady()) say('agLoginMsg', 'warn', '<b>Setup needed:</b> add the Supabase URL and key in <code>config.js</code>.');

    // already signed in on this device?
    if (lsGet(SKEY)) { document.body.classList.add('itb-restoring'); const p = await restore(false); document.body.classList.remove('itb-restoring'); if (p) unlock(); }
  }
  function lastRegId() { return lsGet(RKEY) || ''; }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
