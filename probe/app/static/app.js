/* Hopwatch Probe web UI (uses the shared kit in /ui/hw.js). */
'use strict';
(function () {
  var $ = HW.$, esc = HW.esc, I = HW.icon;
  var S = { info: null, status: null, cfg: null, timers: [], view: '', gen: 0 };
  /* Answers that come back after the user moved to another page are dropped: the page they were for
     is gone, and drawing them would write into elements that no longer exist. */
  var api = function (path, opt) {
    var gen = S.gen;
    return HW.api(path, opt).then(function (r) { return gen === S.gen ? r : new Promise(function () { /* never */ }); },
      function (e) { if (gen !== S.gen) return new Promise(function () { /* never */ }); throw e; });
  };
  var NAV = [['overview', 'grid', 'Overview'], ['charts', 'chart', 'Charts'], ['mtr', 'route', 'MTR'], ['events', 'bell', 'Events'],
    ['evidence', 'box', 'Evidence'], ['settings', 'gear', 'Settings']];
  var TRIG = { manual: ['Manual', 'info'], auto: ['Automatic', 'warn'], schedule: ['Scheduled', 'purple'], cross: ['Cross-site', 'info'] };
  var STATUS = { ok: 'OK', warn: 'Warning', crit: 'Critical', down: 'Down', unknown: 'Waiting', disabled: 'Off' };
  var RANK = { down: 4, crit: 3, warn: 2, unknown: 1, ok: 0, disabled: -1 };
  var markColor = function (trig) { return trig === 'auto' ? HW.cssv('--warn') : trig === 'schedule' ? HW.cssv('--purple') : HW.cssv('--accent'); };

  /* ------------------------------------------------------------ shell */
  function admin() { return S.info && S.info.auth.admin; }
  function every(fn, ms) { fn(); S.timers.push(setInterval(fn, ms)); }
  function clearTimers() { S.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); S.timers = []; }
  function head(title, sub, actions) { $('title').textContent = title; $('subtitle').innerHTML = sub || ''; $('topActions').innerHTML = actions || ''; }
  function nav() {
    $('nav').innerHTML = NAV.map(function (n) { return '<a href="#/' + n[0] + '" class="' + (S.view === n[0] ? 'on' : '') + '">' + I(n[1]) + '<span class="lbl">' + n[2] + '</span></a>'; }).join('');
    $('loginBtn').innerHTML = admin() ? I('out') + 'Log out' : S.info && !S.info.auth.password_set ? I('lock') + 'Set password' : I('lock') + 'Log in';
    if (S.thSeg) S.thSeg.set(HW.ls('theme') || 'auto');
    $('prefsBtn').innerHTML = I('more');
  }
  function loadInfo() {
    return api('/api/info').then(function (i) {
      S.info = i; $('site').textContent = i.site; document.title = 'Hopwatch Probe · ' + i.site;
      var b = $('banner'); b.className = i.error ? 'banner' : 'hidden'; b.innerHTML = i.error ? I('alert') + esc(i.error) : '';
      nav(); return i;
    });
  }
  function fail(e) {
    if (e && e.status === 401) return loadInfo().then(route);
    var net = e && !e.status && /fetch|network|load failed/i.test(e.message || '');
    if (!net && !(e && e.status) && window.console) console.error(e);
    var b = $('banner'); b.className = 'banner';
    b.innerHTML = I('alert') + (net ? 'Cannot reach the probe – check that the container runs.' : e && e.status ? esc(e.message) : 'Something went wrong on this page: ' + esc(e && e.message) + ' – reload the page; if it happens again, please report it.');
  }
  // unsaved settings are not thrown away by leaving the page or the Settings view without asking
  window.addEventListener('beforeunload', function (e) { if (S.unsaved) { e.preventDefault(); e.returnValue = ''; } });
  function route() {
    if (S.unsaved && S.view === 'settings' && !/^#\/?settings/.test(location.hash)) {
      if (!confirm('Your settings changes are not saved. Leave and lose them?')) { history.replaceState(null, '', S.lastHash || '#/settings'); return; }
      S.unsaved = false;
    }
    S.lastHash = location.hash;
    S.gen++; clearTimers(); HW.closePops(); HW.closeModal(); $('banner').className = S.info && S.info.error ? 'banner' : 'hidden';
    var h = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
    S.view = h[0] || 'overview'; nav();
    $('main').innerHTML = '';
    if (S.info && !S.info.auth.can_view) return loginBox(true);
    if (S.info && !S.info.auth.password_set && S.view === 'settings') return setup();
    var v = { overview: vOverview, charts: vCharts, mtr: function () { h[1] ? vRun(+h[1]) : vMtr(); }, events: vEvents, evidence: vEvidence, settings: vSettings }[S.view] || vOverview;
    v();
  }
  function qs(k) { var m = new RegExp('[?&]' + k + '=([^&]+)').exec(location.hash); return m ? decodeURIComponent(m[1]) : null; }
  HW.seg($('tzSeg'), HW.TZ, HW.tz, function (v) { HW.tz = v; HW.ls('tz', v); route(); });
  $('prefsBtn').onclick = function () {
    HW.prefs(this, { login: $('loginBtn').innerHTML, onLogin: function () { $('loginBtn').click(); },
      onChange: function () { HW.seg($('tzSeg'), HW.TZ, HW.tz, function (v) { HW.tz = v; HW.ls('tz', v); route(); }); route(); } });
  };
  S.thSeg = HW.themeSeg($('themeSeg'), function () { route(); });
  HW.onTheme = function () { route(); };
  $('loginBtn').onclick = function () {
    if (admin()) api('/api/logout', { method: 'POST' }).then(function () { loadInfo().then(route); });
    else if (S.info && !S.info.auth.password_set) location.hash = '#/settings';
    else loginBox(false);
  };
  function loginBox(required) {
    HW.modal('Log in', (required ? '<p class="muted">This probe needs a login to view.</p>' : '') +
      '<div class="field"><label>Admin password</label><input type="password" id="lpw" autocomplete="current-password"></div>' +
      '<p class="xs muted mt12">Forgot it? Set the container variable HOPWATCH_RESET_PASSWORD to true and restart the container.</p>',
      '<button class="btn-p" id="lgo">Log in</button>');
    var go = function () { api('/api/login', { method: 'POST', body: { password: $('lpw').value } }).then(function () { HW.closeModal(); loadInfo().then(route); }).catch(function (e) { HW.toast(e.message, true); }); };
    $('lgo').onclick = go; $('lpw').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }
  function setup() {
    head('Welcome', 'Set an admin password to start');
    $('main').innerHTML = '<div class="card" style="max-width:560px"><div class="bd"><p>The admin password protects the settings and starting MTR runs. Viewing stays open unless you change that in Settings → Security.</p>' +
      '<div class="form"><div class="field"><label>New password</label><input type="password" id="np1" autocomplete="new-password"></div><div class="field"><label>Repeat</label><input type="password" id="np2" autocomplete="new-password"></div></div>' +
      '<div class="row mt16"><button class="btn-p" id="npgo">Set password</button><span class="xs muted">At least 8 characters</span></div></div></div>';
    $('npgo').onclick = function () {
      if ($('np1').value !== $('np2').value) return HW.toast('The passwords differ', true);
      api('/api/password', { method: 'POST', body: { new: $('np1').value } }).then(function () { HW.toast('Password set'); loadInfo().then(route); }).catch(function (e) { HW.toast(e.message, true); });
    };
  }

  /* ------------------------------------------------------------ shared data */
  function status() { return api('/api/status').then(function (st) { S.status = st; return st; }); }
  function tcpOk(t) { return t && t.tcp && (t.tcp.state === 'open' || t.tcp.state === 'refused'); }
  function targetOpts(st, onlyOn) {
    return (st || S.status).targets.filter(function (t) { return !onlyOn || t.enabled; }).map(function (t) {
      return { value: t.host, label: t.name ? t.host + ' · ' + t.name : t.host, group: t.group || t.location, hint: tcpOk(t) ? 'TCP ' + t.tcp.port : '' }; });
  }
  function locOpts(st) { var seen = {}; return (st || S.status).targets.filter(function (t) { if (seen[t.location]) return false; seen[t.location] = 1; return true; }).map(function (t) { return { value: t.location, label: t.location }; }); }
  function tcpPort() { var t = ((S.status || {}).targets || []).filter(function (x) { return x.tcp; })[0]; return t ? t.tcp.port : 443; }

  /* MTR start dialog, used everywhere */
  function mtrDialog(hosts) {
    if (!admin()) return loginBox(false);
    var p = S.status ? Promise.resolve(S.status) : status();
    Promise.all([p, S.cfg ? Promise.resolve(S.cfg) : api('/api/config')]).then(function (r) {
      var st = r[0], cfg = S.cfg = r[1], mode = HW.ls('mtrMode') || 'icmp';
      HW.modal('Run MTR', '<div class="col gap12">' +
        '<div class="field"><label>Targets</label><div id="mdT"></div><span class="hint">Several targets run in parallel (at most ' + cfg.mtr.max_parallel + ' at once, the rest wait).</span></div>' +
        '<div class="field"><label>Mode</label><span id="mdM"></span><span class="hint" id="mdH"></span></div>' +
        '<div class="form"><div class="field"><label>TCP port</label><input type="number" id="mdP" value="' + cfg.tcp_check.port + '" min="1" max="65535"></div>' +
        '<div class="field"><label>Cycles</label><input type="number" id="mdC" value="' + cfg.mtr.cycles + '" min="5" max="1000"><span class="hint" id="mdD"></span></div></div></div>',
        '<button class="btn-g" id="mdX">Cancel</button><button class="btn-p" id="mdGo">' + I('play') + 'Start</button>');
      var t = HW.ms($('mdT'), { options: targetOpts(st, true), value: hosts || [], placeholder: 'Pick targets…' });
      var hint = { icmp: 'Classic ping-style trace. Works for every target.', tcp: 'SYN packets to the port. Gets through where ICMP is filtered or rate limited.',
        udp: 'UDP packets, like traceroute on Linux.', tcp_if_open: 'TCP for targets where the port answered the daily check, ICMP for the others.' };
      HW.seg($('mdM'), [['icmp', 'ICMP'], ['tcp', 'TCP'], ['udp', 'UDP'], ['tcp_if_open', 'TCP where it answers']], mode, function (v) { mode = v; $('mdH').textContent = hint[v]; });
      $('mdH').textContent = hint[mode];
      var dur = function () { $('mdD').textContent = 'About ' + HW.fdur(+$('mdC').value * cfg.mtr.interval_s + 5) + ' per target'; };
      $('mdC').oninput = dur; dur();
      $('mdX').onclick = HW.closeModal;
      $('mdGo').onclick = function () {
        var hs = t.get(); if (!hs.length) return HW.toast('Pick at least one target', true);
        HW.ls('mtrMode', mode);
        api('/api/mtr', { method: 'POST', body: { hosts: hs, mode: mode, port: +$('mdP').value, cycles: +$('mdC').value } }).then(function (r) {
          HW.closeModal(); HW.toast(r.ids.length === 1 ? 'MTR started' : r.ids.length + ' MTR runs started');
          location.hash = r.ids.length === 1 ? '#/mtr/' + r.ids[0] : '#/mtr';
        }).catch(function (e) { HW.toast(e.message, true); });
      };
    }).catch(fail);
  }
  function quickMtr(hosts, mode) {
    if (!admin()) return loginBox(false);
    api('/api/mtr', { method: 'POST', body: { hosts: hosts, mode: mode } }).then(function (r) {
      HW.toast(r.ids.length === 1 ? 'MTR started' : r.ids.length + ' MTR runs started');
      if (r.ids.length === 1) location.hash = '#/mtr/' + r.ids[0];
    }).catch(function (e) { HW.toast(e.message, true); });
  }

  /* ------------------------------------------------------------ overview */
  function vOverview() {
    head('Overview', 'Live status of every target over the alert window', '<button class="btn-p" id="runBtn">' + I('play') + 'Run MTR</button>');
    $('runBtn').onclick = function () { mtrDialog([]); };
    var f = HW.lsj('ovf', { q: '', only: 'all', locs: [] });
    f.range = f.range || 'live';
    $('main').innerHTML = '<div class="row"><span id="ovR"></span><span class="grow"></span></div><div class="kpis" id="kpis"></div>' +
      '<div class="row"><div class="search" style="width:260px">' + I('search') + '<input id="ovQ" placeholder="Filter by name or IP" value="' + esc(f.q) + '"></div>' +
      '<span id="ovOnly"></span><div id="ovLoc"></div><span class="grow"></span><span class="xs muted" id="ovUpd"></span></div><div class="tiles" id="tiles"></div>';
    var spark = {}, agg = {}, mtr24 = null, locMs = null;
    var save = function () { HW.ls('ovf', f); draw(); };
    var RNG = [['live', 'Live'], ['900', '15m'], ['3600', '1h'], ['10800', '3h'], ['21600', '6h'], ['86400', '24h']];
    HW.seg($('ovR'), RNG, f.range, function (v) { f.range = v; HW.ls('ovf', f); agg = {}; loadSpark(); draw(); });
    $('ovQ').oninput = function () { f.q = this.value; save(); };
    var onlySeg = HW.seg($('ovOnly'), [['all', 'All'], ['bad', 'Problems only']], f.only, function (v) { f.only = v; save(); });
    function draw() {
      var st0 = S.status; if (!st0) return;
      var live = f.range === 'live';
      // in a range the numbers and colours come from that range; the dot keeps the live state
      var st = live ? st0 : Object.assign({}, st0, { targets: st0.targets.map(function (t) { var a = agg[t.host]; if (!t.enabled) return t;
        if (!a) return Object.assign({}, t, { avg: null, loss: null, jitter: null });
        return Object.assign({}, t, { avg: a.avg, loss: a.loss, jitter: a.jit, maxloss: a.max, live: t.status,
          status: a.max >= 20 ? 'crit' : a.loss > 0.5 ? 'warn' : a.avg == null && a.loss == null ? 'unknown' : 'ok' }); }) });
      if (!locMs) locMs = HW.ms($('ovLoc'), { options: locOpts(st), value: f.locs, label: 'Locations', placeholder: 'All', onChange: function (v) { f.locs = v; save(); } });
      var locs = {}, order = [];
      st.targets.forEach(function (t) { if (!locs[t.location]) { locs[t.location] = []; order.push(t.location); } locs[t.location].push(t); });
      var worstOf = function (ts) { return ts.reduce(function (a, t) { return RANK[t.status] > RANK[a] ? t.status : a; }, 'disabled'); };
      var bad = order.filter(function (l) { return RANK[worstOf(locs[l])] >= 2; });
      var on = st.targets.filter(function (t) { return t.enabled && t.avg != null; });
      var med = on.map(function (t) { return t.avg; }).sort(function (a, b) { return a - b; })[on.length >> 1];
      var lossy = st.targets.filter(function (t) { return t.loss > 0; }).length;
      $('kpis').innerHTML =
        kpi('server', 'Targets', st.targets.length, order.length + ' locations', '#/settings?tab=targets') +
        kpi('alert', 'Locations with problems', '<span class="' + (bad.length ? 'bad' : 'ok') + '">' + bad.length + '</span>', bad.length ? esc(bad.slice(0, 3).join(', ')) + (bad.length > 3 ? '…' : '') : 'all fine', '@bad') +
        kpi('chart', 'Median latency', HW.fnum(med) + '<span class="small muted"> ms</span>', lossy + ' IPs with some loss', '#/charts') +
        kpi('route', 'MTR runs, 24 h', mtr24 == null ? '…' : mtr24.n, (st.mtr.running.length ? st.mtr.running.length + ' running · ' : '') + (st.mtr.queued.length ? st.mtr.queued.length + ' waiting · ' : '') + (mtr24 ? mtr24.auto + ' automatic' : ''), '#/mtr?tab=runs');
      onKpi({ bad: function () { f.only = 'bad'; onlySeg.set('bad'); save(); $('tiles').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
      var q = f.q.toLowerCase();
      var html = order.filter(function (l) {
        if (f.locs.length && f.locs.indexOf(l) < 0) return false;
        if (f.only === 'bad' && RANK[worstOf(locs[l])] < 2) return false;
        return !q || l.toLowerCase().indexOf(q) >= 0 || locs[l].some(function (t) { return (t.host + ' ' + (t.name || '')).toLowerCase().indexOf(q) >= 0; });
      }).sort(function (a, b) { return RANK[worstOf(locs[b])] - RANK[worstOf(locs[a])] || a.localeCompare(b); }).map(function (l) {
        var ts = locs[l], w = worstOf(ts), hosts = ts.filter(function (t) { return t.enabled; }).map(function (t) { return t.host; });
        return '<div class="tile st-' + w + '"><div class="th"><span class="dot ' + w + '"></span><b class="ell">' + esc(l) + '</b>' +
          (RANK[w] >= 2 ? '<span class="pill ' + w + '">' + STATUS[w] + '</span>' : '') + '<span class="grow"></span>' +
          '<a class="btn-xs btn-g" href="#/charts?loc=' + encodeURIComponent(l) + '" title="Charts">' + I('chart') + '</a>' +
          '<button class="btn-xs" data-lm="' + esc(JSON.stringify(hosts)) + '">' + I('route') + 'MTR</button></div>' +
          byRole(ts, st.roles).map(function (t, k, arr) {
            var sp = spark[t.host] || { v: [], l: [] };
            var rh = t.dc && (t.role || arr.some(function (x) { return x.role; })) && (k === 0 || arr[k - 1].role !== t.role)
              ? '<div class="rolehd">' + esc(t.role || 'no role') + (roleUp(st.roles, t.role) ? ' <span class="tag">ISP edge</span>' : '') + '</div>' : '';
            var ds = live ? t.status : t.live;
            return rh + '<div class="ipr"><div class="ip"><span class="dot ' + ds + (ds === 'ok' ? ' live' : '') + '" title="now: ' + (STATUS[ds] || ds) + '"></span><span class="ell' + (t.name ? ' nm' : '') + '" title="' + esc(t.name ? t.name + ' · ' + t.host : t.host) + '">' + (t.name ? esc(t.name) + '<span class="xs faint">' + esc(t.host) + '</span>' : esc(t.host)) + '</span>' + (tcpOk(t) ? '<span class="tag tcp" title="TCP ' + t.tcp.port + ' answers: TCP MTR possible">TCP</span>' : '') + '</div>' +
              '<div>' + HW.spark(sp.v, sp.l, t.status === 'ok' ? 'var(--accent)' : 'var(--' + (t.status === 'warn' ? 'warn' : 'bad') + ')') + '</div>' +
              '<div class="r">' + (t.status === 'down' ? '<span class="down">down</span>' : t.avg == null ? '<span class="faint">–</span>' : HW.fnum(t.avg) + '<span class="faint"> ms</span>') + '</div>' +
              '<div class="r ' + (t.loss > 0 ? (RANK[t.status] >= 3 ? 'bad' : 'warn') : 'faint') + '"' + (!live && t.maxloss ? ' title="average loss; worst moment ' + HW.fnum(t.maxloss, 0) + '%"' : '') + '>' + (t.loss == null ? '–' : HW.fnum(t.loss, t.loss > 0 && t.loss < 1 ? 1 : 0) + '%') + '</div>' +
              '<div class="r faint jit" title="jitter">±' + HW.fnum(t.jitter) + '</div>' +
              '<div><button class="btn-xs btn-g btn-i" data-ip="' + esc(t.host) + '" title="Actions">' + I('more') + '</button></div></div>';
          }).join('') + '</div>';
      }).join('');
      $('tiles').innerHTML = html || '<div class="card"><div class="empty">' + (st.targets.length ? 'Nothing matches the filter.' : 'No targets yet. Add them in <a href="#/settings">Settings</a>.') + '</div></div>';
      $('ovUpd').textContent = (live ? 'last ' + st.window_s + ' s' : 'average over the last ' + RNG.filter(function (r) { return r[0] === f.range; })[0][1] + ', worst moment in the tooltip') + ' · updated ' + HW.ftime(st.now);
      [].forEach.call($('tiles').querySelectorAll('[data-lm]'), function (b) {
        b.onclick = function () { var hs = JSON.parse(b.dataset.lm); HW.menu(b, [
          { label: 'MTR all ' + hs.length + ' IPs · ICMP', icon: 'play', onClick: function () { quickMtr(hs, 'icmp'); } },
          { label: 'MTR all · TCP where it answers', icon: 'play', onClick: function () { quickMtr(hs, 'tcp_if_open'); } },
          { label: 'MTR with options…', icon: 'gear', onClick: function () { mtrDialog(hs); } }]); };
      });
      [].forEach.call($('tiles').querySelectorAll('[data-ip]'), function (b) {
        b.onclick = function () { var h = b.dataset.ip, t = st.targets.filter(function (x) { return x.host === h; })[0], items = [
          { label: 'MTR · ICMP', icon: 'play', onClick: function () { quickMtr([h], 'icmp'); } }];
          if (tcpOk(t)) items.push({ label: 'MTR · TCP ' + t.tcp.port, icon: 'play', onClick: function () { quickMtr([h], 'tcp'); } });
          items.push({ label: 'MTR with options…', icon: 'gear', onClick: function () { mtrDialog([h]); } }, { sep: 1 },
            { label: 'Chart of this IP', icon: 'chart', onClick: function () { location.hash = '#/charts?host=' + encodeURIComponent(h); } },
            { label: 'MTR runs to this IP', icon: 'route', onClick: function () { location.hash = '#/mtr?host=' + encodeURIComponent(h); } },
            { label: 'Copy IP', icon: 'copy', onClick: function () { HW.copy(h, 'IP'); } });
          HW.menu(b, items); };
      });
    }
    every(function () { status().then(draw).catch(fail); }, 3000);
    function loadSpark() {
      var t1 = Date.now() / 1000, span = f.range === 'live' ? 900 : +f.range;
      api('/api/series?from=' + Math.floor(t1 - span) + '&to=' + Math.ceil(t1) + '&points=60&group=host').then(function (d) {
        d.series.forEach(function (s) {
          var v = s.points.map(function (p) { return p[1]; }), l = s.points.map(function (p) { return p[2]; }), j = s.points.map(function (p) { return p[3]; });
          spark[s.host] = { v: v, l: l };
          var mean = function (a) { a = a.filter(function (x) { return x != null; }); return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
          agg[s.host] = { avg: mean(v), loss: mean(l), jit: mean(j), max: Math.max.apply(null, l.filter(function (x) { return x != null; }).concat([0])) };
        }); draw();
      }).catch(function () { /* sparklines are optional */ });
    }
    every(loadSpark, 15000);
    every(function () {
      api('/api/mtr?limit=2000&from=' + Math.floor(Date.now() / 1000 - 86400)).then(function (r) {
        mtr24 = { n: r.runs.length, auto: r.runs.filter(function (x) { return x.trig === 'auto'; }).length }; draw(); }).catch(function () { /* optional */ });
    }, 30000);
  }
  /* targets of a location in role order: the ISP edge first, then the order of the roles list */
  function byRole(ts, roles) {
    var ord = {}; (roles || []).forEach(function (r, i) { ord[r.name] = (isEdge(r.name) ? 0 : 100) + i; });
    return ts.slice().sort(function (a, b) { var x = a.role ? (ord[a.role] == null ? 500 : ord[a.role]) : 999, y = b.role ? (ord[b.role] == null ? 500 : ord[b.role]) : 999; return x - y; });
  }
  function roleUp(roles, name) { return isEdge(name); }
  /* same rule as the server: a role named ISP / GW / gateway / upstream is the ISP edge */
  function isEdge(name) { return /^(isp|gw|gateway|upstream)/i.test(name || ''); }
  /* a tile; with go it is a link (a "#/..." address) or an action on this page ("@name", see onKpi) */
  function kpi(ic, l, v, s, go) {
    var inner = '<div class="l">' + I(ic) + esc(l) + '</div><div class="v">' + v + '</div><div class="s">' + (s || '') + '</div>';
    if (!go) return '<div class="kpi">' + inner + '</div>';
    return go[0] === '@' ? '<button type="button" class="kpi click" data-kpi="' + esc(go.slice(1)) + '">' + inner + '</button>' : '<a class="kpi click" href="' + esc(go) + '">' + inner + '</a>';
  }
  function onKpi(acts) { [].forEach.call(document.querySelectorAll('[data-kpi]'), function (b) { b.onclick = function () { if (acts[b.dataset.kpi]) acts[b.dataset.kpi](); }; }); }

  /* ------------------------------------------------------------ charts */
  var RANGES = [[900, '15m'], [3600, '1h'], [21600, '6h'], [86400, '24h'], [604800, '7d'], [2592000, '30d'], [7776000, '90d'], [31536000, '1y']];
  function vCharts() {
    var cf = HW.lsj('chf', { range: 3600, group: 'location', sel: [], marks: true });
    if (qs('loc')) { cf.sel = ['loc:' + qs('loc')]; cf.group = 'host'; }
    if (qs('host')) { cf.sel = [qs('host')]; cf.group = 'host'; }
    head('Charts', 'Latency, loss and jitter over time · drag across a chart to zoom, double-click to go back',
      '<button class="btn-s" id="csv">' + I('download') + 'CSV</button>');
    $('main').innerHTML = '<div class="card"><div class="bd row gap12"><span id="rg"></span><div id="sel"></div><span id="grp"></span>' +
      '<label class="switch"><input type="checkbox" id="mk"' + (cf.marks ? ' checked' : '') + '><span class="t">MTR marks</span></label><span class="grow"></span><span class="xs muted" id="res"></span></div></div>' +
      [['rtt', 'Latency', 'average round-trip time, ms'], ['loss', 'Packet loss', '% of pings lost'], ['jit', 'Jitter', 'mean difference between pings, ms']].map(function (c) {
        return '<div class="card"><div class="hd"><h2>' + c[1] + '</h2><span class="sub">' + c[2] + '</span><span class="grow"></span><button class="btn-s btn-g btn-i" id="x_' + c[0] + '" title="Enlarge">' + I('expand') + '</button></div><div class="bd"><div id="c_' + c[0] + '"><div class="empty" style="height:240px;display:flex;align-items:center;justify-content:center">Loading…</div></div></div></div>'; }).join('');
    var win = cf.custom ? { from: cf.custom[0], to: cf.custom[1] } : { range: cf.range };
    var hidden = { rtt: {}, loss: {}, jit: {} }, pin = null;
    var rp = HW.rangePicker($('rg'), RANGES, win, function (w) { win = w.range ? { range: w.range } : w; cf.custom = w.range ? null : [w.from, w.to]; if (w.range) cf.range = w.range; HW.ls('chf', cf); load(); });
    HW.seg($('grp'), [['location', 'Per location'], ['role', 'Per role'], ['host', 'Per IP']], cf.group, function (v) { cf.group = v; HW.ls('chf', cf); load(); });
    $('mk').onchange = function () { cf.marks = this.checked; HW.ls('chf', cf); load(); };
    status().then(function (st) {
      var opts = locOpts(st).map(function (l) { return { value: 'loc:' + l.value, label: 'All of ' + l.label, group: 'Locations' }; }).concat(targetOpts(st));
      HW.ms($('sel'), { options: opts, value: cf.sel, label: 'Show', placeholder: 'everything', onChange: function (v) { cf.sel = v; HW.ls('chf', cf); load(); } });
      load();
    }).catch(fail);
    function params() {
      var w = rp.get(), hosts = cf.sel.filter(function (x) { return x.indexOf('loc:') !== 0; }), locs = cf.sel.filter(function (x) { return x.indexOf('loc:') === 0; }).map(function (x) { return x.slice(4); });
      return { w: w, q: 'from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to) + (hosts.length ? '&host=' + encodeURIComponent(hosts.join(',')) : '') + (locs.length ? '&location=' + encodeURIComponent(locs.join(',')) : '') };
    }
    $('csv').onclick = function () { HW.download('/api/series.csv?' + params().q + '&points=5000'); };
    function load() {
      var p = params(), w = p.w, W = ($('c_rtt').clientWidth || 900);
      Promise.all([api('/api/series?' + p.q + '&points=' + Math.round(W / 2) + '&group=' + cf.group),
        cf.marks ? api('/api/mtr?limit=1000&from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to)) : Promise.resolve({ runs: [] })]).then(function (r) {
        var d = r[0], runs = r[1].runs;
        $('res').textContent = 'resolution ' + HW.fdur(d.step) + ' · ' + { raw: 'every ping', m1: '1-minute data', m5: '5-minute data' }[d.tier];
        var mk = function (col) { return d.series.map(function (s) { return { name: s.name, t: s.points.map(function (x) { return x[0]; }), v: s.points.map(function (x) { return x[col]; }) }; }); };
        var marks = runs.map(function (m) { return { t: m.started || m.created, color: markColor(m.trig), label: 'MTR ' + m.host + ' · ' + TRIG[m.trig][0] + (m.reason ? ' · ' + m.reason : ''), id: m.id }; });
        var o = function (k, unit, pct) { return { t0: w.from, t1: w.to, unit: unit, pct: pct, hidden: hidden[k], marks: marks, group: 'pc', pin: pin, peakLabels: k === 'loss', tipHideZero: k === 'loss',
          onPin: function (t) { pin = pin && Math.abs(pin - t) < (w.to - w.from) / 200 ? null : t; load(); },
          onMark: function (m) { location.hash = '#/mtr/' + m.id; },
          onZoom: function (a, b) { rp.set({ from: a, to: b }); win = { from: a, to: b }; cf.custom = [a, b]; HW.ls('chf', cf); load(); },
          onReset: function () { if (cf.custom) { cf.custom = null; rp.set({ range: cf.range }); win = { range: cf.range }; HW.ls('chf', cf); load(); } } }; };
        var all = { rtt: [mk(1), o('rtt', 'ms'), 'Latency'], loss: [mk(2), o('loss', '%', true), 'Packet loss'], jit: [mk(3), o('jit', 'ms'), 'Jitter'] };
        Object.keys(all).forEach(function (k) { HW.chart($('c_' + k), all[k][0], all[k][1]); $('x_' + k).onclick = function () { HW.expandChart(all[k][2], all[k][0], all[k][1]); }; });
      }).catch(fail);
    }
    S.timers.push(setInterval(function () { if (!cf.custom) load(); }, 15000));
    window.onresize = function () { if (S.view === 'charts') load(); };
  }

  /* ------------------------------------------------------------ MTR */
  function trigPill(r) { var t = TRIG[r.trig] || [r.trig, '']; return '<span class="pill ' + t[1] + '">' + t[0] + '</span>'; }
  function statusPill(r) {
    var m = { done: 'ok', running: 'info', queued: '', error: 'bad', cancelled: '' }[r.status];
    var tx = r.status === 'running' && r.started ? 'running ' + HW.fdur(Date.now() / 1000 - r.started) : r.status;
    return '<span class="pill ' + m + '">' + esc(tx) + '</span>';
  }
  function modeName(r) { return r.mode === 'tcp' ? 'TCP ' + r.port : (r.mode || '').toUpperCase(); }
  function lossCell(v) { if (v == null) return '<span class="faint">–</span>'; var c = v >= 20 ? 'var(--bad)' : v > 0 ? 'var(--warn)' : 'var(--ok)';
    return '<div class="hopbar"><span class="num" style="width:44px;text-align:right;color:' + c + '">' + HW.fnum(v) + '%</span><div class="bar"><i style="width:' + Math.min(100, Math.max(v, v > 0 ? 3 : 0)) + '%;background:' + c + '"></i></div></div>'; }

  function vMtr() {
    var tab = qs('tab') || HW.ls('mtrTab') || 'runs';
    head('MTR', 'Traces of the path to your targets, hop by hop', '<button class="btn-p" id="runBtn">' + I('play') + 'Run MTR</button>');
    $('runBtn').onclick = function () { mtrDialog([]); };
    $('main').innerHTML = '<div class="tabs" id="mtabs"></div><div id="mbody" class="col gap12"></div>';
    var tabs = [['runs', 'Runs'], ['schedules', 'Schedules'], ['how', 'How it works']];
    $('mtabs').innerHTML = tabs.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</button>'; }).join('');
    $('mtabs').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; HW.ls('mtrTab', b.dataset.t); location.hash = '#/mtr?tab=' + b.dataset.t; };
    ({ runs: mtrRuns, schedules: mtrSchedules, how: mtrHow })[tab]();
  }
  function mtrRuns() {
    var f = HW.lsj('mrf', { range: 604800, hosts: [], trig: [], status: [], q: '' });
    if (qs('host')) f.hosts = [qs('host')];
    var sel = {}, last = [];
    $('mbody').innerHTML = '<div class="card"><div class="bd row gap12"><span id="mrR"></span><div id="mrH"></div><div id="mrT"></div><div id="mrS"></div>' +
      '<div class="search" style="width:200px">' + I('search') + '<input id="mrQ" placeholder="Search reason, IP…" value="' + esc(f.q) + '"></div></div></div>' +
      '<div class="card"><div class="hd"><h2 id="mrN">Runs</h2><span class="sub" id="mrB"></span><span class="grow"></span><span id="mrSel" class="row"></span>' +
      '<button class="btn-s" id="mrAll">' + I('download') + 'Export shown</button></div><div class="bd"><div id="mrList"></div></div></div>';
    var rp = HW.rangePicker($('mrR'), [[86400, '24h'], [604800, '7d'], [2592000, '30d'], [31536000, '1y']], f.custom ? { from: f.custom[0], to: f.custom[1] } : { range: f.range }, function (w) {
      f.custom = w.range ? null : [w.from, w.to]; if (w.range) f.range = w.range; HW.ls('mrf', f); refresh(); });
    status().then(function (st) {
      HW.ms($('mrH'), { options: targetOpts(st), value: f.hosts, label: 'Targets', onChange: function (v) { f.hosts = v; HW.ls('mrf', f); refresh(); } });
    });
    HW.ms($('mrT'), { options: [{ value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Automatic' }, { value: 'schedule', label: 'Scheduled' }], value: f.trig, label: 'Trigger', onChange: function (v) { f.trig = v; HW.ls('mrf', f); refresh(); } });
    HW.ms($('mrS'), { options: ['done', 'running', 'queued', 'error', 'cancelled'].map(function (x) { return { value: x, label: x }; }), value: f.status, label: 'Status', onChange: function (v) { f.status = v; HW.ls('mrf', f); refresh(); } });
    $('mrQ').oninput = function () { f.q = this.value; HW.ls('mrf', f); draw(); };
    var idsOf = function (list) { return list.map(function (r) { return r.id; }).join(','); };
    $('mrAll').onclick = function () { var l = filtered(); if (!l.length) return HW.toast('Nothing to export', true); exportMenu(this, l.map(function (r) { return r.id; })); };
    function exportMenu(btn, ids) {
      HW.menu(btn, [{ label: 'ZIP: every report as .txt + .json', icon: 'download', onClick: function () { HW.download('/api/mtr/export?format=zip&ids=' + ids.join(',')); } },
        { label: 'One .txt with all reports', icon: 'download', onClick: function () { HW.download('/api/mtr/export?format=txt&ids=' + ids.join(',')); } },
        { label: 'Copy all reports as text', icon: 'copy', onClick: function () { fetch('/api/mtr/export?format=txt&ids=' + ids.join(',')).then(function (r) { return r.text(); }).then(function (t) { HW.copy(t, ids.length + ' reports'); }); } }]);
    }
    function filtered() {
      var q = f.q.toLowerCase();
      return last.filter(function (r) { return !q || (r.host + ' ' + r.location + ' ' + (r.reason || '') + ' ' + (r.error || '')).toLowerCase().indexOf(q) >= 0; });
    }
    function drawSel() {
      var ids = Object.keys(sel).map(Number);
      $('mrSel').innerHTML = ids.length ? '<span class="pill info">' + ids.length + ' selected</span><button class="btn-s" id="mrX">' + I('download') + 'Export selected</button><button class="btn-s btn-g" id="mrC">Clear</button>' : '';
      if (ids.length) { $('mrX').onclick = function () { exportMenu(this, ids); }; $('mrC').onclick = function () { Object.keys(sel).forEach(function (k) { delete sel[k]; }); draw(); }; }
    }
    var tbl = null;
    function draw() {
      var list = filtered(), iv = (S.cfg && S.cfg.mtr && S.cfg.mtr.interval_s) || 1;
      $('mrN').textContent = list.length + ' runs';
      var cols = [
        { key: 'started', label: 'Started', nowrap: true, text: function (r) { return HW.fdt(r.started || r.created); }, sort: function (r) { return r.started || r.created; } },
        { key: 'location', label: 'Location' },
        { key: 'host', label: 'Target', html: function (r) { return '<span class="mono small">' + esc(r.host) + '</span>'; } },
        { key: 'mode', label: 'Mode', text: modeName },
        { key: 'trig', label: 'Trigger', text: function (r) { return TRIG[r.trig][0] + (r.reason ? ' ' + r.reason : ''); }, html: function (r) { return trigPill(r) + (r.reason ? ' <span class="xs muted">' + esc(r.reason) + '</span>' : ''); } },
        { key: 'status', label: 'Status', text: function (r) { return r.status; }, html: function (r) { return (r.status === 'running' || r.status === 'queued' ? HW.mtrProgress(r, iv) : statusPill(r)) + (r.error ? ' <span class="xs ' + (r.status === 'done' ? 'muted' : 'bad') + '">' + esc(r.error.slice(0, 80)) + '</span>' : ''); } },
        { key: 'dst_loss', label: 'Loss at target', minw: 140, text: function (r) { return r.dst_loss == null ? '' : r.dst_loss + '%'; }, sort: function (r) { return r.dst_loss == null ? -1 : r.dst_loss; }, html: function (r) { return lossCell(r.dst_loss); } },
        { key: 'hops', label: 'Hops', align: 'r', sort: function (r) { return r.hops || 0; } }];
      var opts = { id: 'probe-mtr', rows: list, columns: cols, rowKey: function (r) { return String(r.id); }, select: sel, onSelect: drawSel,
        onRow: function (r) { location.hash = '#/mtr/' + r.id; }, empty: 'No runs match. Start one with <b>Run MTR</b>, or set up a schedule.' };
      if (tbl) tbl.render(list); else tbl = HW.table($('mrList'), opts);
      drawSel();
    }
    function refresh() {
      var w = rp.get();
      api('/api/mtr?limit=2000&from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to) + (f.hosts.length ? '&host=' + encodeURIComponent(f.hosts.join(',')) : '') +
        (f.trig.length ? '&trig=' + f.trig.join(',') : '') + (f.status.length ? '&status=' + f.status.join(',') : '')).then(function (r) {
        last = r.runs;
        $('mrB').textContent = (r.running.length ? r.running.length + ' running' : 'none running') + (r.queued.length ? ' · ' + r.queued.length + ' waiting' : '');
        draw();
      }).catch(fail);
    }
    refresh(); S.timers.push(setInterval(refresh, 5000));
  }
  function mtrSchedules() {
    Promise.all([api('/api/config').catch(function () { return null; }), status(), api('/api/mtr?trig=schedule&limit=2000&from=' + Math.floor(Date.now() / 1000 - 30 * 86400))]).then(function (r) {
      var cfg = S.cfg = r[0], st = r[1], runs = r[2].runs, lastBy = {};
      runs.forEach(function (x) { if (x.schedule && !lastBy[x.schedule]) lastBy[x.schedule] = x; });
      if (!cfg) { $('mbody').innerHTML = '<div class="card"><div class="empty">Log in to see and change schedules.</div></div>'; return; }
      var sch = cfg.schedules;
      var perHour = sch.filter(function (s) { return s.enabled; }).reduce(function (a, s) { return a + s.hosts.length * 60 / s.every_min; }, 0);
      var busy = sch.filter(function (s) { return s.enabled; }).reduce(function (a, s) { return a + s.hosts.length * 60 / s.every_min * (s.cycles * cfg.mtr.interval_s + 5); }, 0) / cfg.mtr.max_parallel / 36;
      $('mbody').innerHTML = '<div class="card"><div class="hd"><h2>Periodic MTR</h2><span class="sub">a record of the normal path, to compare with when something goes wrong</span><span class="grow"></span>' +
        (admin() ? '<button class="btn-p btn-s" id="schAdd">' + I('plus') + 'New schedule</button>' : '') + '</div><div class="bd">' +
        (busy > 0 ? '<div class="banner ' + (busy > 70 ? 'warn' : 'info') + '">' + I('info') + 'About ' + Math.round(perHour) + ' scheduled runs per hour, using ' + Math.round(busy) + '% of the MTR capacity (' + cfg.mtr.max_parallel + ' at once).' + (busy > 70 ? ' Runs to a target are skipped while the previous one still waits; use fewer targets, fewer cycles or longer intervals.' : '') + '</div><div class="mt12"></div>' : '') +
        (sch.length ? '<div class="tw"><table class="table"><thead><tr><th>On</th><th>Name</th><th>Targets</th><th>Every</th><th>Mode</th><th class="r">Cycles</th><th>Last run</th><th></th></tr></thead><tbody>' +
          sch.map(function (s, i) { var l = lastBy[s.id];
            return '<tr><td class="w0"><label class="switch"><input type="checkbox" data-on="' + i + '"' + (s.enabled ? ' checked' : '') + (admin() ? '' : ' disabled') + '></label></td><td><b>' + esc(s.name) + '</b></td>' +
              '<td>' + s.hosts.length + ' <span class="xs muted">' + esc(s.hosts.slice(0, 3).join(', ')) + (s.hosts.length > 3 ? '…' : '') + '</span></td><td>' + every_(s.every_min) + '</td><td>' + (s.mode === 'tcp_if_open' ? 'TCP where it answers' : s.mode.toUpperCase()) + '</td>' +
              '<td class="r">' + s.cycles + '</td><td>' + (l ? '<a href="#/mtr?tab=runs">' + HW.fago(l.created) + '</a>' : '<span class="faint">not yet</span>') + '</td>' +
              '<td class="w0">' + (admin() ? '<button class="btn-xs btn-g btn-i" data-ed="' + i + '">' + I('edit') + '</button><button class="btn-xs btn-g btn-i" data-del="' + i + '">' + I('trash') + '</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'
          : '<div class="empty">No schedules yet. A common start: all targets every hour, 100 cycles, so there is always a recent "normal" path on record.</div>') + '</div></div>';
      var save = function () { return api('/api/config', { method: 'PUT', body: cfg }).then(function (c) { S.cfg = c; HW.toast('Schedules saved'); mtrSchedules(); }).catch(function (e) { HW.toast(e.message, true); }); };
      if ($('schAdd')) $('schAdd').onclick = function () { schDialog(st, cfg, null, save); };
      [].forEach.call($('mbody').querySelectorAll('[data-ed]'), function (b) { b.onclick = function () { schDialog(st, cfg, +b.dataset.ed, save); }; });
      [].forEach.call($('mbody').querySelectorAll('[data-del]'), function (b) { b.onclick = function () { if (confirm('Delete schedule "' + cfg.schedules[+b.dataset.del].name + '"?')) { cfg.schedules.splice(+b.dataset.del, 1); save(); } }; });
      [].forEach.call($('mbody').querySelectorAll('[data-on]'), function (b) { b.onchange = function () { cfg.schedules[+b.dataset.on].enabled = b.checked; save(); }; });
    }).catch(fail);
  }
  function every_(m) { return m % 1440 === 0 ? (m / 1440 === 1 ? 'day' : m / 1440 + ' days') : m % 60 === 0 ? (m / 60 === 1 ? 'hour' : m / 60 + ' hours') : m + ' min'; }
  function schDialog(st, cfg, i, save) {
    var s = i == null ? { name: 'Baseline', enabled: true, hosts: [], every_min: 60, cycles: 100, mode: 'icmp' } : JSON.parse(JSON.stringify(cfg.schedules[i]));
    HW.modal(i == null ? 'New schedule' : 'Edit schedule', '<div class="col gap12"><div class="field"><label>Name</label><input id="sN" value="' + esc(s.name) + '"></div>' +
      '<div class="field"><label>Targets</label><div id="sT"></div></div>' +
      '<div class="form"><div class="field"><label>Every</label><select id="sE">' + [15, 30, 60, 120, 180, 360, 720, 1440].map(function (m) { return '<option value="' + m + '"' + (m === s.every_min ? ' selected' : '') + '>' + every_(m) + '</option>'; }).join('') +
      ([15, 30, 60, 120, 180, 360, 720, 1440].indexOf(s.every_min) < 0 ? '<option value="' + s.every_min + '" selected>' + every_(s.every_min) + '</option>' : '') + '</select></div>' +
      '<div class="field"><label>Cycles</label><input type="number" id="sC" min="5" max="1000" value="' + s.cycles + '"></div></div>' +
      '<div class="field"><label>Mode</label><span id="sM"></span></div>' + HW.sw('sOn', s.enabled, 'Enabled') + '</div>',
      '<button class="btn-g" id="sX">Cancel</button><button class="btn-p" id="sOk">Save</button>');
    var t = HW.ms($('sT'), { options: targetOpts(st, true), value: s.hosts, placeholder: 'Pick targets…' });
    HW.seg($('sM'), [['icmp', 'ICMP'], ['tcp', 'TCP'], ['udp', 'UDP'], ['tcp_if_open', 'TCP where it answers']], s.mode, function (v) { s.mode = v; });
    $('sX').onclick = HW.closeModal;
    $('sOk').onclick = function () {
      s.name = $('sN').value; s.hosts = t.get(); s.every_min = +$('sE').value; s.cycles = +$('sC').value; s.enabled = $('sOn').checked;
      if (!s.hosts.length) return HW.toast('Pick at least one target', true);
      if (i == null) cfg.schedules.push(s); else cfg.schedules[i] = s;
      HW.closeModal(); save();
    };
  }
  function mtrHow() {
    $('mbody').innerHTML = '<div class="card"><div class="bd" style="max-width:900px">' +
      '<h3 style="margin-top:0">What MTR shows</h3><p>MTR combines traceroute and ping. It sends packets with a rising TTL, so every router on the way answers once the TTL runs out. It repeats that for every cycle (100 by default) and reports, per hop: loss %, sent, last / average / best / worst latency and the standard deviation.</p>' +
      '<h3>How to read it</h3><div class="steps">' +
      '<div><span><b>Look at the last hop first.</b> No loss there means the path works, whatever the middle hops show.</span></div>' +
      '<div><span><b>Loss that starts at one hop and continues to the end</b> is real. The problem is at that hop or the link before it. Hopwatch points this out above the hop table.</span></div>' +
      '<div><span><b>Loss on a middle hop only</b> is usually that router limiting how often it answers ICMP. Its forwarding is fine.</span></div>' +
      '<div><span><b>A jump in latency that stays</b> for all later hops shows where the delay comes from (often a long-distance link or a congested peering).</span></div>' +
      '<div><span><b>ICMP vs TCP:</b> some networks treat ICMP differently. A TCP MTR to port 443 follows the path real traffic takes. Hopwatch checks daily which targets answer on the TCP port and offers TCP MTR there.</span></div></div>' +
      '<h3>When Hopwatch runs MTR</h3><div class="steps">' +
      '<div><span><b>Manual:</b> Run MTR here, or from a location or IP on the Overview.</span></div>' +
      '<div><span><b>Automatic:</b> when a target goes down, when loss stays over the limit, or when latency rises (Settings → Automatic MTR). One more run when it recovers shows the path that works again.</span></div>' +
      '<div><span><b>Scheduled:</b> periodic runs (the Schedules tab) keep a record of the normal path. Compare any run with the previous one to the same target to see if the path changed.</span></div></div>' +
      '<h3>Giving it to support</h3><p>Open a run and use <b>Copy for support</b>: plain text in the layout of <code>mtr -rwbz</code>, with your site, public IP, target, mode and start time in UTC on top. For several runs, select them in the Runs tab and export a ZIP or one text file. For a whole incident, use <a href="#/evidence">Evidence</a>: one ZIP with a summary, every ping as CSV, the status changes and all MTR runs of the time window.</p>' +
      '</div></div>';
  }

  /* run detail */
  function vRun(id) {
    head('MTR run #' + id, '', '');
    $('main').innerHTML = '<div class="card"><div class="empty">Loading…</div></div>';
    var cmp = null, prev = null;     // cmp: the run shown next to this one
    function hopTable(hubs, other) {
      var mx = Math.max.apply(null, hubs.map(function (h) { return h.Wrst || 0; }).concat([1]));
      var oip = other ? other.map(function (h) { return HW.hopIp(h.host); }) : null;
      return '<div class="tw"><table class="table"><thead><tr><th class="r">#</th><th>Host</th><th>AS</th><th style="min-width:130px">Loss</th><th class="r">Sent</th><th class="r">Last</th><th style="min-width:140px">Avg</th><th class="r">Best</th><th class="r">Worst</th><th class="r">StDev</th></tr></thead><tbody>' +
        hubs.map(function (h, i) { var ch = oip && oip[i] !== HW.hopIp(h.host);
          return '<tr' + (ch ? ' class="chg" title="Different from the other run"' : '') + '><td class="r">' + h.count + '</td><td class="mono small">' + esc(h.host) + '</td><td class="small muted">' + esc(h.ASN || '') + '</td>' +
            '<td>' + lossCell(h['Loss%'] || 0) + '</td><td class="r">' + h.Snt + '</td><td class="r">' + HW.fnum(h.Last) + '</td>' +
            '<td><div class="hopbar"><span class="num" style="width:44px;text-align:right">' + HW.fnum(h.Avg) + '</span><div class="bar"><i style="width:' + (h.Avg / mx * 100) + '%;background:var(--accent)"></i></div></div></td>' +
            '<td class="r">' + HW.fnum(h.Best) + '</td><td class="r">' + HW.fnum(h.Wrst) + '</td><td class="r">' + HW.fnum(h.StDev) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    function draw() {
      api('/api/mtr/' + id).then(function (r) {
        var hubs = (r.result && r.result.report && r.result.report.hubs) || [];
        var running = r.status === 'running' || r.status === 'queued';
        head(r.host + ' · ' + r.location, 'MTR #' + r.id + ' · ' + modeName(r) + ' · ' + r.cycles + ' cycles · ' + HW.fdt(r.started || r.created),
          '<a class="btn-s btn-g" href="#/mtr">' + I('route') + 'All runs</a>');
        var v = HW.mtrVerdict(hubs), el = (r.started ? Date.now() / 1000 - r.started : 0), est = r.cycles * ((S.cfg && S.cfg.mtr.interval_s) || 1) + 5;
        var hp = prev && prev.result ? (prev.result.report || {}).hubs || [] : null;
        var ch = cmp && cmp.result ? (cmp.result.report || {}).hubs || [] : null;
        var same = hp && hp.length === hubs.length && hp.every(function (h, i) { return HW.hopIp(h.host) === HW.hopIp(hubs[i].host); });
        $('main').innerHTML = '<div class="kpis">' +
          kpi('info', 'Status', statusPill(r), r.error ? '<span class="bad">' + esc(r.error) + '</span>' : r.finished && r.status === 'done' ? 'took ' + HW.fdur(r.finished - r.started) : '') +
          kpi('alert', 'Loss at target', r.dst_loss == null ? '–' : '<span class="' + (r.dst_loss >= 20 ? 'bad' : r.dst_loss > 0 ? 'warn' : 'ok') + '">' + HW.fnum(r.dst_loss) + '%</span>', hubs.length ? hubs.length + ' hops' : '') +
          kpi('chart', 'Avg latency at target', hubs.length ? HW.fnum(hubs[hubs.length - 1].Avg) + '<span class="small muted"> ms</span>' : '–', hubs.length ? 'worst ' + HW.fnum(hubs[hubs.length - 1].Wrst) + ' ms' : '') +
          kpi('clock', 'Trigger', trigPill(r), esc(r.reason || (r.trig === 'manual' ? 'started by hand' : ''))) + '</div>' +
          (running ? '<div class="card"><div class="bd"><div class="row"><b>' + (r.status === 'queued' ? 'Waiting for a free slot…' : 'Tracing… about ' + HW.fdur(Math.max(0, est - el)) + ' left') + '</b><span class="grow"></span>' + (admin() ? '<button class="btn-s btn-d" id="cancel">' + I('stop') + 'Cancel</button>' : '') + '</div><div class="prog mt8"><i style="width:' + (r.status === 'queued' ? 2 : Math.min(98, el / est * 100)) + '%"></i></div></div></div>' : '') +
          (v ? '<div class="banner ' + (v.level === 'ok' ? 'info' : v.level) + '">' + I(v.level === 'ok' ? 'check' : 'alert') + esc(v.text) + '</div>' : '') +
          (hubs.length ? '<div class="card"><div class="hd"><h2>Hops</h2>' + (hp ? '<span class="pill ' + (same ? 'ok' : 'warn') + '">' + (same ? 'same path as the previous run' : 'path differs from the previous run') + '</span>' : '') + '<span class="grow"></span>' +
            '<button class="btn-s btn-p" id="copy">' + I('copy') + 'Copy for support</button><button class="btn-s" id="dl">' + I('download') + 'Download</button>' +
            '<button class="btn-s" id="cmpB">' + I('layers') + (cmp ? 'Hide comparison' : 'Compare with…') + '</button>' +
            (admin() ? '<button class="btn-s" id="again">' + I('refresh') + 'Run again</button>' : '') + '</div><div class="bd">' +
            (ch ? '<div class="cmp"><div><div class="small muted" style="margin-bottom:6px">This run · ' + esc(r.host) + ' · ' + HW.fdt(r.started) + '</div>' + hopTable(hubs, ch) + '</div><div><div class="small muted" style="margin-bottom:6px"><a href="#/mtr/' + cmp.id + '">#' + cmp.id + '</a> · ' + esc(cmp.host) + (cmp.host !== r.host ? ' (' + esc(cmp.location) + ')' : '') + ' · ' + HW.fdt(cmp.started) + ' · ' + esc((TRIG[cmp.trig] || [cmp.trig])[0]) + '</div>' + hopTable(ch, hubs) + '</div></div>' : hopTable(hubs)) +
            '</div></div>' : '') +
          (r.report ? '<div class="card"><div class="hd"><h2>Text for support</h2><span class="sub">the layout of mtr -rwbz, with who, what and when on top</span></div><div class="bd"><pre class="rep" id="rep"></pre></div></div>' : '');
        if (r.report) $('rep').textContent = r.report;
        if ($('copy')) $('copy').onclick = function () { HW.copy(r.report, 'Report'); };
        if ($('dl')) $('dl').onclick = function () { HW.menu(this, [
          { label: 'Report as .txt', icon: 'download', onClick: function () { HW.download('/api/mtr/report/' + r.id); } },
          { label: 'Raw result as .json', icon: 'download', onClick: function () { HW.download('/api/mtr/export?format=json&ids=' + r.id); } },
          { label: 'ZIP with both', icon: 'download', onClick: function () { HW.download('/api/mtr/export?format=zip&ids=' + r.id + (cmp ? ',' + cmp.id : '')); } }]); };
        if ($('cancel')) $('cancel').onclick = function () { api('/api/mtr/cancel/' + r.id, { method: 'POST' }).then(draw); };
        if ($('again')) $('again').onclick = function () { api('/api/mtr', { method: 'POST', body: { hosts: [r.host], mode: r.mode, port: r.port, cycles: r.cycles } }).then(function (x) { location.hash = '#/mtr/' + x.ids[0]; }).catch(function (e) { HW.toast(e.message, true); }); };
        if ($('cmpB')) $('cmpB').onclick = function () { if (cmp) { cmp = null; draw(); } else pickRun(r, function (x) { cmp = x; draw(); }); };
        if (r.previous && !prev) api('/api/mtr/' + r.previous).then(function (p) { prev = p; draw(); });
        if (running) { clearTimers(); S.timers.push(setTimeout(draw, 2500)); }
      }).catch(fail);
    }
    if (!S.cfg && admin()) api('/api/config').then(function (c) { S.cfg = c; });
    draw();
  }

  /* pick a run to put next to r: the previous one to the same IP, others of the same location
     around that time (e.g. a second IP of the same DC), then everything else of that day */
  function pickRun(r, done) {
    var t = r.started || r.created, place = function (x) { return String(x.location || '').split(' · ')[0]; };
    HW.modal('Compare with', '<div class="search" style="margin-bottom:8px">' + I('search') + '<input id="pkQ" placeholder="Filter by IP, location, trigger"></div><div id="pkL" class="col gap4" style="max-height:55vh;overflow:auto"><div class="small muted">Loading…</div></div>', '<button class="btn-g" id="pkX">Cancel</button>');
    $('pkX').onclick = HW.closeModal;
    api('/api/mtr?limit=500&status=done&from=' + Math.floor(t - 86400) + '&to=' + Math.ceil(t + 86400)).then(function (x) {
      var runs = x.runs.filter(function (o) { return o.id !== r.id; });
      var near = function (o) { return Math.abs((o.started || o.created) - t) <= 1800; };
      var sec = [['Previous run to this IP', runs.filter(function (o) { return o.id === r.previous; })],
        ['Same location, within 30 minutes', runs.filter(function (o) { return o.id !== r.previous && place(o) === place(r) && near(o); })],
        ['Everything else that day', runs.filter(function (o) { return o.id !== r.previous && !(place(o) === place(r) && near(o)); })]];
      var draw = function () {
        var q = ($('pkQ').value || '').toLowerCase();
        $('pkL').innerHTML = sec.map(function (s) { var l = s[1].filter(function (o) { return !q || (o.host + ' ' + o.location + ' ' + o.trig + ' ' + (o.reason || '')).toLowerCase().indexOf(q) >= 0; });
          return l.length ? '<div class="xs muted" style="margin-top:8px">' + s[0] + '</div>' + l.slice(0, 80).map(function (o) {
            return '<button class="btn-s btn-g pkr" data-pk="' + o.id + '"><span class="mono small">' + esc(o.host) + '</span><span class="small muted ell">' + esc(o.location) + ' · ' + HW.fdt(o.started || o.created) + ' · ' + esc((TRIG[o.trig] || [o.trig])[0]) + '</span>' +
              '<span class="grow"></span><span class="small ' + (o.dst_loss >= 20 ? 'bad' : o.dst_loss > 0 ? 'warn' : 'ok') + '">' + (o.dst_loss == null ? '–' : HW.fnum(o.dst_loss) + '%') + '</span></button>'; }).join('') : ''; }).join('') || '<div class="small muted">No other finished runs that day.</div>';
        [].forEach.call($('pkL').querySelectorAll('[data-pk]'), function (b) { b.onclick = function () { api('/api/mtr/' + b.dataset.pk).then(function (o) { HW.closeModal(); done(o); }); }; });
      };
      $('pkQ').oninput = draw; draw();
    }).catch(function (e) { $('pkL').textContent = e.message; });
  }

  /* ------------------------------------------------------------ events */
  function vEvents() {
    var f = HW.lsj('evf', { range: 604800, hosts: [], kinds: [], levels: [] });
    head('Events', 'Status changes and automatic MTR runs');
    $('main').innerHTML = '<div class="card"><div class="bd row gap12"><span id="evR"></span><div id="evH"></div><div id="evK"></div><div id="evL"></div></div></div><div class="card"><div class="bd"><div id="ev"></div></div></div>';
    var rp = HW.rangePicker($('evR'), [[86400, '24h'], [604800, '7d'], [2592000, '30d'], [31536000, '1y']], { range: f.range }, function (w) { if (w.range) f.range = w.range; HW.ls('evf', f); load(); });
    status().then(function (st) { HW.ms($('evH'), { options: targetOpts(st), value: f.hosts, label: 'Targets', onChange: function (v) { f.hosts = v; HW.ls('evf', f); load(); } }); });
    HW.ms($('evK'), { options: [{ value: 'status', label: 'Status changes' }, { value: 'auto_mtr', label: 'Automatic MTR' }], value: f.kinds, label: 'Kind', onChange: function (v) { f.kinds = v; HW.ls('evf', f); load(); } });
    HW.ms($('evL'), { options: ['down', 'crit', 'warn', 'ok'].map(function (x) { return { value: x, label: STATUS[x] }; }), value: f.levels, label: 'Level', onChange: function (v) { f.levels = v; HW.ls('evf', f); draw(); } });
    var last = [], tbl = null;
    function what(e) {
      return e.kind === 'status' ? '<span class="pill ' + e.level + '">' + esc(STATUS[e.level] || e.level) + '</span> <span class="xs muted">was ' + esc(STATUS[e.before] || e.before) + (e.loss != null ? ' · loss ' + HW.fnum(e.loss, 0) + '%' : '') + (e.avg != null ? ' · ' + HW.fnum(e.avg) + ' ms' : '') + '</span>'
        : e.kind === 'auto_mtr' ? '<span class="pill warn">Automatic MTR</span> <a href="#/mtr/' + e.mtr_id + '">#' + e.mtr_id + '</a> <span class="xs muted">' + esc(e.reason || '') + '</span>' : esc(e.kind);
    }
    function draw() {
      var l = last.filter(function (e) { return !f.levels.length || f.levels.indexOf(e.level) >= 0; });
      var cols = [
        { key: 't', label: 'Time', nowrap: true, text: function (e) { return HW.fdt(e.t); }, sort: function (e) { return e.t; } },
        { key: 'location', label: 'Location' },
        { key: 'host', label: 'Target', html: function (e) { return '<span class="mono small">' + esc(e.host || '') + '</span>'; } },
        { key: 'what', label: 'What', text: function (e) { return e.kind === 'status' ? (STATUS[e.level] || e.level) + ' was ' + (STATUS[e.before] || e.before) : 'Automatic MTR ' + (e.reason || ''); }, html: what },
        { key: 'ev', label: 'Evidence', html: function (e) { return '<a class="btn-xs btn-g" href="#/evidence?at=' + Math.floor(e.t) + (e.host ? '&host=' + encodeURIComponent(e.host) : '') + '" title="Evidence for this moment">' + I('box') + '</a>'; }, text: function () { return ''; } }];
      if (tbl) tbl.render(l); else tbl = HW.table($('ev'), { id: 'probe-events', rows: l, columns: cols, empty: 'Nothing in this time range.' });
    }
    function load() { var w = rp.get();
      api('/api/events?limit=5000&from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to) + (f.hosts.length ? '&host=' + encodeURIComponent(f.hosts.join(',')) : '') + (f.kinds.length ? '&kind=' + f.kinds.join(',') : ''))
        .then(function (r) { last = r.events; draw(); }).catch(fail); }
    load(); S.timers.push(setInterval(load, 15000));
  }

  /* ------------------------------------------------------------ evidence */
  function vEvidence() {
    head('Evidence', 'Everything about a time window in one file, ready for a support ticket');
    var at = +qs('at'), host = qs('host');
    var win = at ? { from: at - 1800, to: Math.min(Date.now() / 1000, at + 1800) } : { range: 86400 };
    var sel = host ? [host] : [];
    $('main').innerHTML = '<div class="card"><div class="hd"><h2>1 · Time window</h2><span class="sub">pick a preset, or a custom window around the incident</span></div><div class="bd col gap12"><span id="eR"></span><div id="eInc"></div></div></div>' +
      '<div class="card"><div class="hd"><h2>2 · Targets</h2><span class="sub">empty = all targets</span></div><div class="bd"><div id="eT"></div></div></div>' +
      '<div class="card"><div class="hd"><h2>3 · Note</h2><span class="sub">optional, goes into README.txt (ticket number, what you saw)</span></div><div class="bd"><textarea id="eN" style="min-height:70px" placeholder="e.g. Ticket 12345: users report timeouts to DC1 since 09:10 UTC"></textarea></div></div>' +
      '<div class="card"><div class="hd"><h2>4 · Download</h2></div><div class="bd col gap12"><div id="ePrev" class="small muted">…</div><div class="row">' +
      '<button class="btn-p" id="eZip">' + I('box') + 'Evidence pack (.zip)</button><button id="eCsv">' + I('download') + 'Ping data (.csv)</button><button id="eMtr">' + I('route') + 'MTR runs only</button></div>' +
      '<div class="xs muted">The ZIP holds README.txt (summary per target, status changes, MTR list), ping.csv (every ping for short windows, else 1- or 5-minute data), events.csv and every MTR report as .txt and .json. Times are UTC.</div></div></div>';
    var rp = HW.rangePicker($('eR'), [[3600, '1h'], [21600, '6h'], [86400, '24h'], [604800, '7d'], [2592000, '30d']], win, function () { prev(); });
    var ts = null;
    status().then(function (st) {
      ts = HW.ms($('eT'), { options: locOpts(st).map(function (l) { return { value: 'loc:' + l.value, label: 'All of ' + l.label, group: 'Locations' }; }).concat(targetOpts(st)), value: sel, label: 'Targets', placeholder: 'all', onChange: prev });
      prev();
    }).catch(fail);
    api('/api/events?limit=50&kind=status&from=' + Math.floor(Date.now() / 1000 - 30 * 86400)).then(function (r) {
      var inc = r.events.filter(function (e) { return e.level === 'down' || e.level === 'crit'; }).slice(0, 8);
      $('eInc').innerHTML = inc.length ? '<div class="small muted" style="margin-bottom:6px">Recent problems – click to use ±30 minutes around one:</div><div class="row gap4">' + inc.map(function (e) {
        return '<button class="btn-s" data-t="' + Math.floor(e.t) + '" data-h="' + esc(e.host || '') + '"><span class="dot ' + e.level + '"></span>' + HW.fdt(e.t, 1) + ' · ' + esc(e.location || e.host) + '</button>'; }).join('') + '</div>' : '';
      [].forEach.call($('eInc').querySelectorAll('[data-t]'), function (b) { b.onclick = function () { var t = +b.dataset.t; rp.set({ from: t - 1800, to: Math.min(Date.now() / 1000, t + 1800) }); if (ts && b.dataset.h) ts.set([b.dataset.h]); prev(); }; });
    });
    function q() {
      var w = rp.get(), v = ts ? ts.get() : sel, hosts = v.filter(function (x) { return x.indexOf('loc:') !== 0; }), locs = v.filter(function (x) { return x.indexOf('loc:') === 0; }).map(function (x) { return x.slice(4); });
      return 'from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to) + (hosts.length ? '&host=' + encodeURIComponent(hosts.join(',')) : '') + (locs.length ? '&location=' + encodeURIComponent(locs.join(',')) : '');
    }
    function prev() {
      var w = rp.get(), v = ts ? ts.get() : sel, hosts = v.filter(function (x) { return x.indexOf('loc:') !== 0; });
      var locs = v.filter(function (x) { return x.indexOf('loc:') === 0; }).map(function (x) { return x.slice(4); });
      if (locs.length && S.status) S.status.targets.forEach(function (t) { if (locs.indexOf(t.location) >= 0 && hosts.indexOf(t.host) < 0) hosts.push(t.host); });
      var hq = hosts.length ? '&host=' + encodeURIComponent(hosts.join(',')) : '';
      Promise.all([api('/api/mtr?limit=5000&from=' + Math.floor(w.from - 600) + '&to=' + Math.ceil(w.to + 600) + hq), api('/api/events?limit=10000&kind=status&from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to) + hq)]).then(function (r) {
        $('ePrev').innerHTML = HW.fdt(w.from) + ' – ' + HW.fdt(w.to) + ' (' + HW.fdur(w.to - w.from) + ') · ' + (hosts.length || 'all') + ' targets · <b>' + r[0].runs.length + '</b> MTR runs · <b>' + r[1].events.length + '</b> status changes';
        $('eMtr').onclick = function () { if (!r[0].runs.length) return HW.toast('No MTR runs in this window', true); HW.download('/api/mtr/export?format=zip&ids=' + r[0].runs.map(function (x) { return x.id; }).join(',')); };
      }).catch(fail);
    }
    $('eZip').onclick = function () { HW.download('/api/evidence?' + q() + '&note=' + encodeURIComponent($('eN').value)); HW.toast('Preparing the ZIP…'); };
    $('eCsv').onclick = function () { HW.download('/api/series.csv?' + q()); };
  }

  /* ------------------------------------------------------------ settings */
  function vSettings() {
    if (!admin()) { head('Settings', ''); $('main').innerHTML = '<div class="card"><div class="empty">Log in to change the settings.<div class="mt12"><button class="btn-p" id="li">' + I('lock') + 'Log in</button></div></div></div>'; $('li').onclick = function () { loginBox(false); }; return; }
    var tab = qs('tab') || HW.ls('setTab') || 'targets';
    head('Settings', 'Everything is set here; changes apply as soon as you save', '<span class="xs muted" id="dirty"></span><button class="btn-p" id="save">' + I('check') + 'Save</button>');
    Promise.all([api('/api/config'), status()]).then(function (r) {
      var cfg = S.cfg = r[0], D = JSON.parse(JSON.stringify(cfg));
      var tabs = [['targets', 'Targets'], ['monitor', 'General & ping'], ['auto', 'Automatic MTR'], ['mtr', 'MTR & TCP'], ['retention', 'Retention'], ['security', 'Security'], ['import', 'Import']];
      if (!tabs.some(function (t) { return t[0] === tab; })) tab = tabs[0][0];
      $('main').innerHTML = '<div class="tabs" id="stabs">' + tabs.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div id="sbody" class="col gap12"></div>';
      var dirty = function () { $('dirty').textContent = 'unsaved changes'; S.unsaved = true; };
      $('stabs').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; tab = b.dataset.t; HW.ls('setTab', tab);
        [].forEach.call($('stabs').children, function (x) { x.className = x === b ? 'on' : ''; }); show(); };
      $('save').onclick = function (msg) { msg = typeof msg === 'string' ? msg : '';
        api('/api/config', { method: 'PUT', body: D }).then(function (c) { S.cfg = c; cfg = c; D = JSON.parse(JSON.stringify(c)); $('dirty').textContent = ''; S.unsaved = false; HW.toast(msg || 'Saved'); loadInfo(); show(); })
          .catch(function (e) { HW.toast(e.message, true); });
      };
      var get = function (p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, D); };
      var set = function (p, v) { var ks = p.split('.'), l = ks.pop(); ks.reduce(function (a, k) { return a[k]; }, D)[l] = v; dirty(); };
      var fld = function (p, label, hint, type, extra) {
        var v = get(p);
        if (type === 'bool') return '<div class="field">' + HW.sw('f-' + p, v, label, hint).replace('<input', '<input data-p="' + p + '"') + '</div>';
        return '<div class="field"><label>' + esc(label) + '</label><input data-p="' + p + '" data-n="' + (type === 'text' ? '' : 1) + '" type="' + (type || 'number') + '" value="' + esc(v) + '"' + (extra || '') + '>' + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
      };
      var bind = function () {
        [].forEach.call($('sbody').querySelectorAll('[data-p]'), function (e) {
          e.addEventListener(e.type === 'checkbox' ? 'change' : 'input', function () { set(e.dataset.p, e.type === 'checkbox' ? e.checked : e.dataset.n ? +e.value : e.value); });
        });
      };
      var card = function (title, sub, body) { return '<div class="card"><div class="hd"><h2>' + title + '</h2>' + (sub ? '<span class="sub">' + sub + '</span>' : '') + '</div><div class="bd">' + body + '</div></div>'; };
      function show() {
        var B = $('sbody');
        if (tab === 'targets') return targets();
        if (tab === 'monitor') B.innerHTML = card('Site', 'the name of this probe', '<div class="form">' + fld('site_name', 'Site name', 'Shown in the header, in every report and in the hub. Empty = container host name.', 'text') + '</div>') +
          card('Ping', 'one ping per target per interval', '<div class="form">' + fld('ping.interval_ms', 'Interval (ms)', '1000 = every second') + fld('ping.timeout_ms', 'Timeout (ms)', 'No reply within this time counts as lost') + fld('ping.size', 'Payload (bytes)', 'fping default is 56') + '</div>') +
          card('Status and alerts', 'how the Overview colours targets', '<div class="form">' + fld('alerts.window_s', 'Window (s)', 'Loss and latency are judged over this many seconds') + fld('alerts.loss_warn', 'Loss warning (%)') + fld('alerts.loss_crit', 'Loss critical (%)') +
            fld('alerts.rtt_warn_ms', 'Latency warning (ms)', '0 = off') + fld('alerts.rtt_crit_ms', 'Latency critical (ms)', '0 = off') + '</div>');
        if (tab === 'auto') B.innerHTML = card('Automatic MTR', 'evidence is recorded the moment something goes wrong', '<div class="col gap12">' + fld('auto_mtr.enabled', 'Run MTR automatically', 'Master switch for everything on this page', 'bool') + '</div>') +
          card('When', '', '<div class="col gap12">' + fld('auto_mtr.on_down', 'When a target goes down', 'Every ping lost over the alert window', 'bool') +
            '<div class="form">' + fld('auto_mtr.loss_pct', 'When loss is over (%)', 'Measured over the window below') + fld('auto_mtr.window_s', 'Window (s)', '') + '</div>' +
            fld('auto_mtr.on_latency', 'When latency is high', 'Uses the limits below', 'bool') +
            '<div class="form">' + fld('auto_mtr.latency_ms', 'Latency over (ms)', '0 = off') + fld('auto_mtr.latency_rise_ms', 'Or this much over normal (ms)', 'Normal = median of the last 24 h. 0 = off') + '</div>' +
            fld('auto_mtr.on_recovery', 'Once more when it recovers', 'Shows the working path next to the broken one', 'bool') + '</div>') +
          card('Limits', 'so an outage does not flood the queue', '<div class="form">' + fld('auto_mtr.cooldown_min', 'Cooldown (min)', 'No new automatic run for the same target or location') +
            fld('auto_mtr.max_per_hour', 'At most per hour', 'All targets together') + '<div class="field"><label>Mode</label><select data-p="auto_mtr.mode">' + [['both', 'ICMP, and TCP too where the port answers'], ['tcp_if_open', 'TCP where the port answers, else ICMP'], ['icmp', 'ICMP only'], ['tcp', 'TCP only']].map(function (o) { return '<option value="' + o[0] + '"' + (get('auto_mtr.mode') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div></div>' +
            '<div class="mt12">' + fld('auto_mtr.per_location', 'One run per location', 'The cooldown counts per location instead of per IP', 'bool') + '</div>');
        if (tab === 'mtr') B.innerHTML = card('MTR', 'defaults for every run', '<div class="form">' + fld('mtr.cycles', 'Cycles', 'Pings per hop; support usually asks for 100') + fld('mtr.interval_s', 'Interval (s)', 'Between cycles') +
            fld('mtr.max_parallel', 'Runs at once', 'The rest wait in the queue') + fld('mtr.public_ip_url', 'Public IP lookup URL', 'Put into reports. Empty = off', 'text') + '</div><div class="col gap12 mt12">' +
            fld('mtr.resolve', 'Show host names', 'Reverse DNS for every hop', 'bool') + fld('mtr.asn', 'Show AS numbers', 'Which network each hop belongs to', 'bool') + '</div>') +
          card('TCP port check', 'decides where TCP MTR is offered', '<div class="col gap12">' + fld('tcp_check.enabled', 'Check which targets answer on a TCP port', '', 'bool') + '<div class="form">' + fld('tcp_check.port', 'Port') + fld('tcp_check.every_h', 'Every (hours)') + '</div><div><button class="btn-s" id="tcpNow">' + I('refresh') + 'Check now</button></div></div>');
        if (tab === 'retention') { B.innerHTML = card('Retention', 'older data is rolled up and removed automatically', '<div class="form">' + fld('retention.raw_days', 'Every ping (days)') + fld('retention.m1_days', '1-minute data (days)') + fld('retention.m5_days', '5-minute data (days)') +
            fld('retention.mtr_days', 'MTR runs (days)') + fld('retention.mtr_max', 'MTR runs (max count)') + '</div><div class="small muted mt12" id="stor"></div>');
          api('/api/storage').then(function (s) { $('stor').textContent = 'Database now ' + (s.bytes / 1048576).toFixed(1) + ' MB · ' + s.mtr + ' MTR runs'; }); }
        if (tab === 'security') {
          B.innerHTML = card('Access', '', '<div class="col gap12">' + fld('security.view_requires_login', 'Viewing needs a login too', 'Off: anyone on the network can look, only admins change things', 'bool') +
            '<div class="form">' + fld('security.cors_origins', 'Allowed origins (CORS)', 'Pages that may read this probe from a browser. * = any, empty = none', 'text') + '</div></div>') +
            card('Change password', '', '<div class="form"><div class="field"><label>Current</label><input type="password" id="pO" autocomplete="current-password"></div><div class="field"><label>New</label><input type="password" id="pN" autocomplete="new-password"></div></div><div class="mt12"><button id="pGo">Change password</button></div>') +
            card('API tokens', 'for Hopwatch Hub or scripts: <code>Authorization: Bearer …</code> · a token can do everything an admin can', '<div id="toks"></div><div class="row mt12"><input id="tkN" placeholder="Name, e.g. hub"><button id="tkGo">' + I('plus') + 'Create token</button></div>');
          $('pGo').onclick = function () { api('/api/password', { method: 'POST', body: { old: $('pO').value, new: $('pN').value } }).then(function () { HW.toast('Password changed'); $('pO').value = $('pN').value = ''; }).catch(function (e) { HW.toast(e.message, true); }); };
          var toks = function (l) {
            $('toks').innerHTML = l.length ? '<div class="tw"><table class="table"><tbody>' + l.map(function (t) { return '<tr><td><b>' + esc(t.name) + '</b></td><td class="muted">created ' + HW.fdt(t.created, 1) + '</td><td class="w0"><button class="btn-xs btn-d" data-tk="' + t.id + '">' + I('trash') + 'Delete</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="small muted">No tokens.</div>';
            [].forEach.call($('toks').querySelectorAll('[data-tk]'), function (b) { b.onclick = function () { if (confirm('Delete this token? Whatever uses it stops working.')) api('/api/tokens/' + b.dataset.tk, { method: 'DELETE' }).then(function () { api('/api/config').then(function (c) { toks(c.security.tokens); }); }); }; });
          };
          toks(cfg.security.tokens);
          $('tkGo').onclick = function () { api('/api/tokens', { method: 'POST', body: { name: $('tkN').value || 'token' } }).then(function (r) {
            HW.modal('New token', '<p class="muted">Copy it now, it is not shown again.</p><pre class="rep">' + esc(r.token) + '</pre>', '<button id="tc">' + I('copy') + 'Copy</button><button class="btn-p" id="tk">Done</button>');
            $('tc').onclick = function () { HW.copy(r.token, 'Token'); }; $('tk').onclick = HW.closeModal; api('/api/config').then(function (c) { toks(c.security.tokens); }); }).catch(function (e) { HW.toast(e.message, true); }); };
        }
        if (tab === 'import') {
          var ro = function (id, cur) { return '<select id="' + id + '"><option value="">–</option>' + (D.roles || []).map(function (r) { return '<option' + (r.name === cur ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('') + '</select>'; };
          var up = (D.roles || []).filter(function (r) { return isEdge(r.name); })[0], own = (D.roles || []).filter(function (r) { return !isEdge(r.name) && !/^(ext|public|internet)/i.test(r.name); })[0],
            ext = (D.roles || []).filter(function (r) { return /^(ext|public|internet)/i.test(r.name); })[0];
          B.innerHTML = card('Targets from Netdata', 'reads the go.d ping jobs: job name = location',
            '<div class="col gap12"><div class="row"><input id="ndU" placeholder="http://netdata-host:19999" style="width:280px" value="' + esc(HW.ls('ndUrl') || '') + '"></div>' +
            '<div class="form"><div class="field"><label>Jobs ending with</label><input id="ndS" value="' + esc(HW.ls('ndSuf') || 'GW') + '"><span class="hint">e.g. "DC1 GW" → location DC1. Empty = keep the job names</span></div>' +
            '<div class="field"><label>… get the role</label>' + ro('ndRS', up ? up.name : '') + '</div><div class="field"><label>Other jobs of those locations get</label>' + ro('ndRO', own ? own.name : '') + '</div>' +
            '<div class="field"><label>Jobs with no such pair get</label>' + ro('ndRL', ext ? ext.name : '') + '<span class="hint">e.g. "Cloudflare DNS": no location, the job name becomes its name</span></div></div>' +
            '<div class="small muted">Roles are set up under Targets → Roles.</div>' + HW.sw('ndUp', true, 'Update targets already in the list', 'their name, location and role change to the imported ones') +
            '<div class="row"><button id="ndR">Read</button></div><div id="ndO" class="small muted"></div></div>') +
            card('History from Netdata', 'copies 1- and 5-minute history of your targets; existing data is kept', '<div class="row"><label class="small muted">Days</label><input type="number" id="hD" value="30"><button id="hGo">' + I('download') + 'Import history</button></div><div id="hS" class="small muted mt12"></div>');
          $('ndR').onclick = function () { HW.ls('ndUrl', $('ndU').value); HW.ls('ndSuf', $('ndS').value); $('ndO').textContent = 'Reading…';
            api('/api/import/targets', { method: 'POST', body: { url: $('ndU').value, suffix: $('ndS').value, suffix_role: $('ndRS').value, other_role: $('ndRO').value, lone_role: $('ndRL').value } }).then(function (x) {
              var have = {}; D.targets.forEach(function (t) { have[t.host] = t; });
              var nw = x.targets.filter(function (t) { return !have[t.host]; }), ch = x.targets.filter(function (t) { var o = have[t.host]; return o && ((o.name || '') !== t.name || o.location !== t.location || (o.role || '') !== t.role); });
              var locs = {}; x.targets.forEach(function (t) { if (t.location) locs[t.location] = 1; });
              $('ndO').innerHTML = 'Found ' + x.targets.length + ' IPs in ' + Object.keys(locs).length + ' locations: ' + nw.length + ' new, ' + ch.length + ' with a different name, location or role. ' +
                (nw.length || ch.length ? '<button class="btn-s btn-p" id="ndA">Apply and save</button>' : '') +
                '<div class="tw mt8" style="max-height:240px"><table class="table"><thead><tr><th>Name</th><th>Location</th><th>Role</th><th>IP</th><th></th></tr></thead><tbody>' + x.targets.map(function (t) {
                  return '<tr><td>' + esc(t.name || '–') + '</td><td>' + esc(t.location || '–') + '</td><td>' + esc(t.role || '–') + '</td><td class="mono small">' + esc(t.host) + '</td><td class="xs muted">' + (!have[t.host] ? 'new' : ch.indexOf(t) >= 0 ? 'changes' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
              if ($('ndA')) $('ndA').onclick = function () { var upd = $('ndUp').checked;
                nw.forEach(function (t) { D.targets.push({ name: t.name, location: t.location, host: t.host, enabled: true, role: t.role }); });
                if (upd) ch.forEach(function (t) { have[t.host].name = t.name; have[t.host].location = t.location; have[t.host].role = t.role; });
                dirty(); $('save').onclick(nw.length + ' added' + (upd ? ', ' + ch.length + ' updated' : '') + ' – saved'); $('ndO').textContent = 'Applied and saved.'; };
            }).catch(function (e) { $('ndO').textContent = e.message; }); };
          var poll = function () { api('/api/import/history').then(function (j) {
            $('hS').textContent = j.state === 'idle' ? '' : j.state === 'running' ? 'Importing… ' + j.done + ' of ' + (j.total || '?') + ' targets, ' + j.records + ' records' : j.state === 'done' ? 'Done: ' + j.records + ' records for ' + j.total + ' targets.' : 'Failed: ' + (j.error || '');
            if (j.state === 'running') S.timers.push(setTimeout(poll, 2000)); }); };
          $('hGo').onclick = function () { HW.ls('ndUrl', $('ndU').value); api('/api/import/history', { method: 'POST', body: { url: $('ndU').value, days: +$('hD').value } }).then(poll).catch(function (e) { HW.toast(e.message, true); }); };
          poll();
        }
        bind();
        if ($('tcpNow')) $('tcpNow').onclick = function () { api('/api/tcpcheck', { method: 'POST' }).then(function () { HW.toast('Checking – the Overview shows the result in a minute'); }); };
      }
      function targets() {
        var tf = { q: '', locs: [], roles: [] }, picked = {};
        D.roles = D.roles || [];
        $('sbody').innerHTML = '<div class="card"><div class="hd"><h2>Roles</h2><span class="sub">groups of targets, e.g. ISP for the provider\u2019s gateway and Servers for your own; in a location each role is its own group</span><span class="grow"></span><button class="btn-s" id="rAdd">' + I('plus') + 'Add role</button></div>' +
          '<div class="bd"><div id="rList"></div><div class="xs muted mt8">A role that is off pauses all its targets. A role named <b>ISP</b> (or GW, gateway, upstream) is the ISP edge: when it is clean but the other targets of the location lose packets, the problem is past the ISP \u2013 the hub says so.</div></div></div>' +
          '<div class="card"><div class="hd"><h2>Targets</h2><span class="sub" id="tCount"></span><span class="grow"></span>' +
          '<button class="btn-s" id="tAdd">' + I('plus') + 'Add</button><button class="btn-s" id="tPaste">Paste a list…</button></div><div class="bd col gap12">' +
          '<div class="row"><div class="search" style="width:240px">' + I('search') + '<input id="tQ" placeholder="Filter"></div><div id="tL"></div><div id="tR"></div><span class="grow"></span><span id="tBulk" class="row"></span></div>' +
          '<div class="tw" style="max-height:60vh"><table class="table"><thead><tr><th class="w0"><input type="checkbox" id="tAll"></th><th class="w0">On</th><th>Name</th><th>Location</th><th>IP or host name</th><th>Role</th><th class="w0"></th></tr></thead><tbody id="tB"></tbody></table></div>' +
          '<div class="xs muted">Name and location are optional. IPs with the same location are one tile on the Overview, split by role (DC1 · ISP, DC1 · Servers); IPs without a location are grouped by role. Press Save (top right) to apply.</div></div></div>';
        var roleOpts = function (cur) { return '<option value="">–</option>' + D.roles.map(function (r) { return '<option' + (r.name === cur ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join(''); };
        function drawRoles() {
          $('rList').innerHTML = D.roles.length ? '<div class="tw"><table class="table"><thead><tr><th class="w0">On</th><th>Name</th><th class="r">Targets</th><th class="w0"></th></tr></thead><tbody>' + D.roles.map(function (r, i) {
            var n = D.targets.filter(function (t) { return t.role === r.name; }).length;
            return '<tr><td class="w0"><label class="switch"><input type="checkbox" data-ru="' + i + '"' + (r.enabled !== false ? ' checked' : '') + '></label></td><td><span class="row wrapn gap4"><input data-rn="' + i + '" value="' + esc(r.name) + '" style="width:200px;max-width:44vw">' + (isEdge(r.name) ? '<span class="tag" style="white-space:nowrap">ISP edge</span>' : '') + '</span></td><td class="r">' + n + '</td>' +
              '<td class="w0"><button class="btn-xs btn-g btn-i" data-rd="' + i + '" title="Remove">' + I('trash') + '</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="small muted">No roles: targets are grouped by location only.</div>';
          [].forEach.call($('rList').querySelectorAll('[data-rn]'), function (e) { e.onchange = function () { var r = D.roles[+e.dataset.rn], old = r.name, nw = e.value.trim();
            if (!nw) { e.value = old; return; } D.targets.forEach(function (t) { if (t.role === old) t.role = nw; }); r.name = nw; dirty(); drawRoles(); draw(); }; });
          [].forEach.call($('rList').querySelectorAll('[data-ru]'), function (e) { e.onchange = function () { D.roles[+e.dataset.ru].enabled = e.checked; dirty(); }; });
          [].forEach.call($('rList').querySelectorAll('[data-rd]'), function (e) { e.onclick = function () { var r = D.roles[+e.dataset.rd], n = D.targets.filter(function (t) { return t.role === r.name; }).length;
            if (n && !confirm('Remove role "' + r.name + '"? ' + n + ' targets lose it.')) return;
            D.targets.forEach(function (t) { if (t.role === r.name) t.role = ''; }); D.roles.splice(+e.dataset.rd, 1); dirty(); drawRoles(); draw(); }; });
          if (rm) rm.options(D.roles.map(function (r) { return { value: r.name, label: r.name }; }).concat([{ value: '', label: '(no role)' }]));
        }
        $('rAdd').onclick = function () { var n = 'Role ' + (D.roles.length + 1); D.roles.push({ name: n, enabled: true }); dirty(); drawRoles(); var ins = $('rList').querySelectorAll('[data-rn]'); ins[ins.length - 1].select(); };
        var lm = HW.ms($('tL'), { options: [], label: 'Location', onChange: function (v) { tf.locs = v; draw(); } });
        var rm = HW.ms($('tR'), { options: [], label: 'Role', onChange: function (v) { tf.roles = v; draw(); } });
        $('tQ').oninput = function () { tf.q = this.value.toLowerCase(); draw(); };
        function vis() { return D.targets.map(function (t, i) { return [t, i]; }).filter(function (x) { var t = x[0];
          return (!tf.locs.length || tf.locs.indexOf(t.location || '') >= 0) && (!tf.roles.length || tf.roles.indexOf(t.role || '') >= 0) && (!tf.q || ((t.name || '') + ' ' + t.location + ' ' + t.host + ' ' + (t.role || '')).toLowerCase().indexOf(tf.q) >= 0); }); }
        function draw() {
          var seen = {}; lm.options(D.targets.filter(function (t) { if (seen[t.location]) return false; seen[t.location] = 1; return true; }).map(function (t) { return { value: t.location || '', label: t.location || '(no location)' }; }));
          var v = vis();
          $('tCount').textContent = D.targets.length + ' targets' + (v.length !== D.targets.length ? ', ' + v.length + ' shown' : '');
          $('tB').innerHTML = v.map(function (x) { var t = x[0], i = x[1];
            return '<tr' + (picked[i] ? ' class="sel"' : '') + '><td class="w0"><input type="checkbox" data-pk="' + i + '"' + (picked[i] ? ' checked' : '') + '></td><td class="w0"><label class="switch"><input type="checkbox" data-i="' + i + '" data-k="enabled"' + (t.enabled ? ' checked' : '') + '></label></td>' +
              '<td><input data-i="' + i + '" data-k="name" value="' + esc(t.name || '') + '" placeholder="–" style="width:100%"></td><td><input data-i="' + i + '" data-k="location" value="' + esc(t.location) + '" placeholder="–" style="width:100%"></td>' +
              '<td><input data-i="' + i + '" data-k="host" value="' + esc(t.host) + '" style="width:100%" class="mono"></td><td><select data-i="' + i + '" data-k="role">' + roleOpts(t.role) + '</select></td>' +
              '<td class="w0"><button class="btn-xs btn-g btn-i" data-rm="' + i + '" title="Remove">' + I('trash') + '</button></td></tr>'; }).join('') || '<tr><td colspan="7" class="empty">No targets.</td></tr>';
          [].forEach.call($('tB').querySelectorAll('[data-k]'), function (e) { e.addEventListener(e.type === 'checkbox' || e.tagName === 'SELECT' ? 'change' : 'input', function () { D.targets[+e.dataset.i][e.dataset.k] = e.type === 'checkbox' ? e.checked : e.value.trim(); dirty(); if (e.tagName === 'SELECT') drawRoles(); }); });
          [].forEach.call($('tB').querySelectorAll('[data-rm]'), function (b) { b.onclick = function () { D.targets.splice(+b.dataset.rm, 1); picked = {}; dirty(); draw(); drawRoles(); }; });
          [].forEach.call($('tB').querySelectorAll('[data-pk]'), function (b) { b.onchange = function () { if (b.checked) picked[b.dataset.pk] = 1; else delete picked[b.dataset.pk]; draw(); }; });
          $('tAll').checked = v.length && v.every(function (x) { return picked[x[1]]; });
          $('tAll').onchange = function () { var on = this.checked; v.forEach(function (x) { if (on) picked[x[1]] = 1; else delete picked[x[1]]; }); draw(); };
          var n = Object.keys(picked).length;
          $('tBulk').innerHTML = n ? '<span class="pill info">' + n + ' selected</span><button class="btn-s" data-b="on">Enable</button><button class="btn-s" data-b="off">Disable</button><button class="btn-s" data-b="loc">Set location…</button><button class="btn-s" data-b="role">Set role…</button><button class="btn-s btn-d" data-b="rm">' + I('trash') + 'Remove</button>' : '';
          [].forEach.call($('tBulk').querySelectorAll('[data-b]'), function (b) { b.onclick = function () {
            var idx = Object.keys(picked).map(Number).sort(function (a, c) { return c - a; });
            if (b.dataset.b === 'role') {
              HW.modal('Set role', '<div class="field"><label>Role for the ' + idx.length + ' selected targets</label><select id="srS">' + roleOpts('') + '</select></div>', '<button class="btn-g" id="srX">Cancel</button><button class="btn-p" id="srO">Set</button>');
              $('srX').onclick = HW.closeModal; $('srO').onclick = function () { var r = $('srS').value; idx.forEach(function (i) { D.targets[i].role = r; }); HW.closeModal(); dirty(); draw(); drawRoles(); }; return; }
            if (b.dataset.b === 'loc') { var l = prompt('Location for the ' + idx.length + ' selected targets (empty = none)'); if (l == null) return; idx.forEach(function (i) { D.targets[i].location = l.trim() === '-' ? '' : l.trim(); }); }
            else if (b.dataset.b === 'rm') { if (!confirm('Remove ' + idx.length + ' targets?')) return; idx.forEach(function (i) { D.targets.splice(i, 1); }); picked = {}; }
            else idx.forEach(function (i) { D.targets[i].enabled = b.dataset.b === 'on'; });
            dirty(); draw(); drawRoles(); }; });
        }
        $('tAdd').onclick = function () { var l = D.targets[D.targets.length - 1]; D.targets.push({ name: '', location: l ? l.location : '', host: '', enabled: true, role: l ? l.role : '' }); dirty(); tf.q = ''; $('tQ').value = ''; draw();
          var ins = $('tB').querySelectorAll('[data-k=host]'); if (ins.length) ins[ins.length - 1].focus(); };
        $('tPaste').onclick = function () {
          HW.modal('Paste targets', '<p class="small muted">One per line: <code>Name, Location, IP, Role</code>. Use <code>-</code> or leave it empty for no name or no location. <code>Location, IP, Role</code> and only <code>IP</code> work too, and so do tabs and semicolons. Roles that don\u2019t exist yet are created.</p>' +
            '<textarea id="bulk" placeholder="Cloudflare DNS, -, 1.1.1.1, Public&#10;-, DC1, 192.0.2.10, Servers&#10;DC1 gateway, DC1, 192.0.2.1, ISP&#10;198.51.100.7"></textarea>' +
            '<div class="mt12">' + HW.sw('bUpd', true, 'Update targets already in the list', 'their name, location and role change to what you paste') + '</div>', '<button class="btn-g" id="bx">Cancel</button><button class="btn-p" id="bo">Apply and save</button>');
          $('bx').onclick = HW.closeModal;
          $('bo').onclick = function () {
            var add = 0, upd = 0, upd_on = $('bUpd').checked, have = {}; D.targets.forEach(function (t) { have[t.host] = t; });
            $('bulk').value.split(/\n/).forEach(function (l) { l = l.trim(); if (!l || l[0] === '#') return; var p = l.split(/[,;\t]/).map(function (x) { x = x.trim(); return x === '-' ? '' : x; });
              // Name, Location, IP, Role – or fewer columns: the IP is the first field that looks like one
              var hi = p.length >= 4 ? 2 : p.length === 1 ? 0 : p.findIndex(function (x) { return /^[\w.-]*[.:][\w.:-]*$/.test(x); });
              if (hi < 0) hi = Math.min(1, p.length - 1);
              var host = p[hi], before = p.slice(0, hi), name = before.length >= 2 ? before[0] : '', loc = before.length ? before[before.length - 1] : '', role = p[hi + 1] || '';
              if (!host) return;
              if (role && !D.roles.some(function (r) { return r.name.toLowerCase() === role.toLowerCase(); })) D.roles.push({ name: role, enabled: true });
              if (role) role = D.roles.filter(function (r) { return r.name.toLowerCase() === role.toLowerCase(); })[0].name;
              if (have[host]) { if (upd_on && p.length > 1) { if (before.length >= 2) have[host].name = name; if (before.length) have[host].location = loc; if (p.length > hi + 1) have[host].role = role; upd++; } }
              else { var t = { name: name, location: loc, host: host, enabled: true, role: role }; D.targets.push(t); have[host] = t; add++; } });
            HW.closeModal(); dirty(); draw(); drawRoles(); $('save').onclick(add + ' added, ' + upd + ' updated – saved'); };
        };
        draw(); drawRoles();
      }
      show();
    }).catch(fail);
  }

  window.addEventListener('hashchange', route);
  loadInfo().then(route).catch(fail);
  setInterval(function () { loadInfo().catch(function () { /* banner shows it */ }); }, 30000);
})();
