/* Hopwatch Hub web UI (uses the shared kit in /ui/hw.js). */
'use strict';
(function () {
  var $ = HW.$, esc = HW.esc, I = HW.icon;
  var S = { info: null, live: null, cfg: null, timers: [], view: '', gen: 0 };
  /* Answers that come back after the user moved to another page are dropped: the page they were for
     is gone, and drawing them would write into elements that no longer exist. */
  var api = function (path, opt) {
    var gen = S.gen;
    return HW.api(path, opt).then(function (r) { return gen === S.gen ? r : new Promise(function () { /* never */ }); },
      function (e) { if (gen !== S.gen) return new Promise(function () { /* never */ }); throw e; });
  };
  var NAV = [['overview', 'grid', 'Overview'], ['incidents', 'alert', 'Incidents'], ['compare', 'chart', 'Compare'], ['mtr', 'route', 'MTR'],
    ['evidence', 'box', 'Evidence'], ['settings', 'gear', 'Settings']];
  var RANK = { down: 4, crit: 3, warn: 2, unknown: 1, ok: 0, disabled: -1 };
  var STATUS = { ok: 'OK', warn: 'Warning', crit: 'Critical', down: 'Down', unknown: 'Waiting', disabled: 'Off' };
  var KIND = { target: ['Seen from several sites', 'bad', 'The target or its network: more than one site sees it at the same time'],
    path: ['One site only', 'warn', 'Only one site sees it: the path from that site to the target'],
    site: ['Site link', 'purple', 'One site sees it on many targets at once: that site\u2019s own uplink or ISP'] };
  var SIG = { loss: 'loss', jitter: 'jitter', delay: 'delay' };
  var TRIG = { manual: ['Manual', 'info'], auto: ['Automatic', 'warn'], schedule: ['Scheduled', 'purple'] };

  function admin() { return S.info && S.info.auth.admin; }
  function every(fn, ms) { fn(); S.timers.push(setInterval(fn, ms)); }
  function clearTimers() { S.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); S.timers = []; }
  function head(t, sub, act) { $('title').textContent = t; $('subtitle').innerHTML = sub || ''; $('topActions').innerHTML = act || ''; }
  function qs(k) { var m = new RegExp('[?&]' + k + '=([^&]+)').exec(location.hash); return m ? decodeURIComponent(m[1]) : null; }
  function nav() {
    $('nav').innerHTML = NAV.map(function (n) { return '<a href="#/' + n[0] + '" class="' + (S.view === n[0] ? 'on' : '') + '">' + I(n[1]) + '<span class="lbl">' + n[2] + '</span></a>'; }).join('');
    $('loginBtn').innerHTML = admin() ? I('out') + 'Log out' : S.info && !S.info.auth.password_set ? I('lock') + 'Set password' : I('lock') + 'Log in';
    $('themeBtn').innerHTML = I(document.documentElement.getAttribute('data-theme') === 'light' ? 'moon' : 'sun');
  }
  function loadInfo() { return api('/api/info').then(function (i) { S.info = i; $('site').textContent = i.site; document.title = i.site; nav(); return i; }); }
  function fail(e) {
    if (e && e.status === 401) return loadInfo().then(route);
    var net = e && !e.status && /fetch|network|load failed/i.test(e.message || '');
    if (!net && !(e && e.status) && window.console) console.error(e);
    var b = $('banner'); b.className = 'banner';
    b.innerHTML = I('alert') + (net ? 'Cannot reach the hub – check that the container runs.' : e && e.status ? esc(e.message) : 'Something went wrong on this page: ' + esc(e && e.message) + ' – reload the page; if it happens again, please report it.');
  }
  function route() {
    S.gen++; clearTimers(); HW.closePops(); HW.closeModal(); $('banner').className = 'hidden';
    var h = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
    S.view = h[0] || 'overview'; nav(); $('main').innerHTML = '';
    if (S.info && !S.info.auth.can_view) return loginBox(true);
    if (S.info && !S.info.auth.password_set) return setup();
    if (S.info && !S.info.probes && S.view !== 'settings') return noProbes();
    ({ overview: vOverview, incidents: vIncidents, compare: vCompare, mtr: vMtr, run: vRun, evidence: vEvidence, settings: vSettings }[S.view] || vOverview)();
  }
  HW.seg($('tzSeg'), [['local', 'Local'], ['utc', 'UTC']], HW.tz, function (v) { HW.tz = v; HW.ls('tz', v); route(); });
  $('themeBtn').onclick = function () { HW.theme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); route(); };
  $('loginBtn').onclick = function () {
    if (admin()) api('/api/logout', { method: 'POST' }).then(function () { loadInfo().then(route); });
    else if (S.info && !S.info.auth.password_set) setup(); else loginBox(false);
  };
  function loginBox(req) {
    HW.modal('Log in', (req ? '<p class="muted">This hub needs a login to view.</p>' : '') + '<div class="field"><label>Admin password</label><input type="password" id="lpw" autocomplete="current-password"></div>', '<button class="btn-p" id="lgo">Log in</button>');
    var go = function () { api('/api/login', { method: 'POST', body: { password: $('lpw').value } }).then(function () { HW.closeModal(); loadInfo().then(route); }).catch(function (e) { HW.toast(e.message, true); }); };
    $('lgo').onclick = go; $('lpw').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  }
  function setup() {
    head('Welcome to Hopwatch Hub', 'Set an admin password, then add your probes');
    $('main').innerHTML = '<div class="card" style="max-width:560px"><div class="bd"><p>The password protects the settings, the probe tokens and starting MTR runs.</p><div class="form"><div class="field"><label>New password</label><input type="password" id="np1" autocomplete="new-password"></div><div class="field"><label>Repeat</label><input type="password" id="np2" autocomplete="new-password"></div></div><div class="row mt16"><button class="btn-p" id="npgo">Set password</button></div></div></div>';
    $('npgo').onclick = function () { if ($('np1').value !== $('np2').value) return HW.toast('The passwords differ', true);
      api('/api/password', { method: 'POST', body: { new: $('np1').value } }).then(function () { loadInfo().then(function () { location.hash = '#/settings'; route(); }); }).catch(function (e) { HW.toast(e.message, true); }); };
  }
  function noProbes() {
    head('No probes yet', '');
    $('main').innerHTML = '<div class="card" style="max-width:720px"><div class="bd"><h3 style="margin-top:0">Connect your first probe</h3><div class="steps">' +
      '<div><span>On the probe: <b>Settings → Security → API tokens</b>, create a token named <i>hub</i> and copy it.</span></div>' +
      '<div><span>Here: <b>Settings → Probes → Add probe</b>, paste the probe address (e.g. <code>http://192.0.2.10:8095</code>) and the token, press <b>Test</b>, then <b>Save</b>.</span></div>' +
      '<div><span>Repeat for every site. The hub asks the probes for their data; they keep their own history.</span></div></div>' +
      '<a class="btn btn-p mt12" href="#/settings">' + I('gear') + 'Open settings</a></div></div>';
  }
  function live() { return api('/api/live').then(function (l) { S.live = l; return l; }); }
  function okProbes(l) { return (l || S.live).probes.filter(function (p) { return !p.error || p.targets; }); }
  function probeOpts(l) { return (l || S.live).probes.map(function (p) { return { value: p.id, label: p.name, hint: p.error && !p.targets ? 'offline' : '' }; }); }
  function targetOpts(l, withLoc) {
    var seen = {}, out = [], locs = {};
    okProbes(l).forEach(function (p) { (p.targets || []).forEach(function (t) { if (!seen[t.host]) { seen[t.host] = 1; out.push({ value: t.host, label: t.host, group: t.location }); locs[t.location] = 1; } }); });
    out.sort(function (a, b) { return a.group.localeCompare(b.group) || a.value.localeCompare(b.value); });
    return withLoc ? Object.keys(locs).sort().map(function (x) { return { value: 'loc:' + x, label: 'All of ' + x, group: 'Locations' }; }).concat(out) : out;
  }
  function splitSel(v) { return { hosts: v.filter(function (x) { return x.indexOf('loc:') !== 0; }), locs: v.filter(function (x) { return x.indexOf('loc:') === 0; }).map(function (x) { return x.slice(4); }) }; }
  function selQ(v) { var s = splitSel(v); return (s.hosts.length ? '&host=' + encodeURIComponent(s.hosts.join(',')) : '') + (s.locs.length ? '&location=' + encodeURIComponent(s.locs.join(',')) : ''); }
  function kpi(ic, l, v, s) { return '<div class="kpi"><div class="l">' + I(ic) + esc(l) + '</div><div class="v">' + v + '</div><div class="s">' + (s || '') + '</div></div>'; }

  /* run MTR from several probes */
  function mtrDialog(hosts) {
    if (!admin()) return loginBox(false);
    (S.live ? Promise.resolve(S.live) : live()).then(function (l) {
      var mode = HW.ls('hubMode') || 'icmp';
      HW.modal('MTR from several sites', '<div class="col gap12"><div class="field"><label>Targets</label><div id="mT"></div></div>' +
        '<div class="field"><label>From these probes</label><div id="mP"></div><span class="hint">Each probe traces the targets it has. All start at the same moment, so the paths can be compared.</span></div>' +
        '<div class="field"><label>Mode</label><span id="mM"></span></div><div class="field"><label>Cycles</label><input type="number" id="mC" value="100" min="5" max="1000"></div></div>',
        '<button class="btn-g" id="mX">Cancel</button><button class="btn-p" id="mGo">' + I('play') + 'Start</button>');
      var t = HW.ms($('mT'), { options: targetOpts(l), value: hosts || [], placeholder: 'Pick targets…' });
      var p = HW.ms($('mP'), { options: probeOpts(l), value: okProbes(l).map(function (x) { return x.id; }) });
      HW.seg($('mM'), [['icmp', 'ICMP'], ['tcp', 'TCP'], ['udp', 'UDP'], ['tcp_if_open', 'TCP where it answers']], mode, function (v) { mode = v; });
      $('mX').onclick = HW.closeModal;
      $('mGo').onclick = function () {
        if (!t.get().length || !p.get().length) return HW.toast('Pick targets and probes', true);
        HW.ls('hubMode', mode);
        api('/api/mtr', { method: 'POST', body: { hosts: t.get(), probes: p.get(), mode: mode, cycles: +$('mC').value } }).then(function (r) {
          HW.closeModal();
          var n = r.results.reduce(function (a, x) { return a + (x.ids ? x.ids.length : 0); }, 0), errs = r.results.filter(function (x) { return x.error; });
          HW.toast(n + ' runs started on ' + r.results.filter(function (x) { return x.ids && x.ids.length; }).length + ' probes' + (errs.length ? ' · ' + errs.map(function (x) { return x.error; }).join('; ') : ''), errs.length > 0);
          location.hash = '#/mtr';
        }).catch(function (e) { HW.toast(e.message, true); });
      };
    }).catch(fail);
  }

  /* ------------------------------------------------------------ overview: locations x sites */
  function vOverview() {
    head('Overview', 'Every location as seen from every site, right now', '<button class="btn-p" id="runBtn">' + I('play') + 'MTR from all sites</button>');
    $('runBtn').onclick = function () { mtrDialog([]); };
    var f = HW.lsj('hovf', { q: '', only: 'all', locs: [] }), locMs = null;
    $('main').innerHTML = '<div class="kpis" id="kpis"></div><div class="row" id="pstrip"></div>' +
      '<div class="card"><div class="hd"><h2>Locations</h2><span class="sub" id="ovSub"></span></div><div class="bd col gap12"><div class="row"><div class="search" style="width:240px">' + I('search') + '<input id="ovQ" placeholder="Filter" value="' + esc(f.q) + '"></div><span id="ovOnly"></span><div id="ovL"></div></div><div class="tw" id="mx"></div></div></div>';
    $('ovQ').oninput = function () { f.q = this.value.toLowerCase(); HW.ls('hovf', f); draw(); };
    HW.seg($('ovOnly'), [['all', 'All'], ['bad', 'Problems only']], f.only, function (v) { f.only = v; HW.ls('hovf', f); draw(); });
    function draw() {
      var l = S.live; if (!l) return;
      var ps = l.probes, K = Math.min(l.correlate.min_sites, Math.max(1, okProbes(l).length));
      var locs = {}, order = [];
      ps.forEach(function (p) { (p.targets || []).forEach(function (t) {
        var L = locs[t.location]; if (!L) { L = locs[t.location] = { hosts: {}, by: {} }; order.push(t.location); }
        L.hosts[t.host] = 1; var c = L.by[p.id] = L.by[p.id] || { st: 'disabled', avg: [], loss: 0, n: 0 };
        if (RANK[t.status] > RANK[c.st]) c.st = t.status; if (t.avg != null) c.avg.push(t.avg); c.loss = Math.max(c.loss, t.loss || 0); c.n++; }); });
      order.sort();
      if (!locMs) locMs = HW.ms($('ovL'), { options: order.map(function (x) { return { value: x, label: x }; }), value: f.locs, label: 'Locations', onChange: function (v) { f.locs = v; HW.ls('hovf', f); draw(); } });
      var verdict = function (L) { var bad = ps.filter(function (p) { return L.by[p.id] && RANK[L.by[p.id].st] >= 2; });
        return bad.length >= K && K > 1 ? ['bad', 'Seen from ' + bad.length + ' sites', bad] : bad.length ? ['warn', 'Only from ' + bad.map(function (p) { return p.name; }).join(', '), bad] : ['ok', 'OK', bad]; };
      var multi = 0, single = 0;
      order.forEach(function (x) { var v = verdict(locs[x]); if (v[0] === 'bad') multi++; else if (v[0] === 'warn') single++; });
      var online = ps.filter(function (p) { return !p.error || p.targets; });
      var running = ps.reduce(function (a, p) { return a + (p.mtr ? p.mtr.running.length : 0); }, 0);
      $('kpis').innerHTML = kpi('server', 'Probes online', '<span class="' + (online.length < ps.length ? 'warn' : 'ok') + '">' + online.length + '</span><span class="small muted"> / ' + ps.length + '</span>', ps.filter(function (p) { return p.error && !p.targets; }).map(function (p) { return esc(p.name) + ' offline'; }).join(', ') || 'all answering') +
        kpi('alert', 'Seen from several sites', '<span class="' + (multi ? 'bad' : 'ok') + '">' + multi + '</span>', 'locations, likely the target side') +
        kpi('info', 'Seen from one site only', '<span class="' + (single ? 'warn' : 'ok') + '">' + single + '</span>', 'locations, likely that site\u2019s path') +
        kpi('route', 'MTR running', running, 'on all probes');
      $('pstrip').innerHTML = ps.map(function (p) { var bad = (p.targets || []).filter(function (t) { return RANK[t.status] >= 2; }).length;
        return '<span class="pill ' + (p.error && !p.targets ? 'bad' : bad ? 'warn' : 'ok') + '" title="' + esc(p.error || p.url) + '">' + I('server') + esc(p.name) + (p.targets ? ' · ' + p.targets.length + ' targets' + (bad ? ' · ' + bad + ' with problems' : '') : ' · ' + esc(p.error || 'offline')) + '</span>'; }).join('');
      var rows = order.filter(function (x) { var L = locs[x];
        if (f.locs.length && f.locs.indexOf(x) < 0) return false;
        if (f.only === 'bad' && verdict(L)[0] === 'ok') return false;
        return !f.q || x.toLowerCase().indexOf(f.q) >= 0 || Object.keys(L.hosts).some(function (h) { return h.indexOf(f.q) >= 0; }); })
        .sort(function (a, b) { var r = { bad: 2, warn: 1, ok: 0 }; return r[verdict(locs[b])[0]] - r[verdict(locs[a])[0]] || a.localeCompare(b); });
      $('ovSub').textContent = order.length + ' locations · ' + ps.length + ' sites · updated ' + HW.ftime(l.now);
      $('mx').innerHTML = '<table class="table"><thead><tr><th>Location</th>' + ps.map(function (p) { return '<th>' + esc(p.name) + '</th>'; }).join('') + '<th>Verdict</th><th class="w0"></th></tr></thead><tbody>' +
        rows.map(function (x) { var L = locs[x], v = verdict(L);
          return '<tr><td><b>' + esc(x) + '</b> <span class="xs muted">' + Object.keys(L.hosts).length + ' IP</span></td>' + ps.map(function (p) { var c = L.by[p.id];
            if (!c) return '<td class="faint">–</td>';
            var avg = c.avg.length ? c.avg.reduce(function (a, b) { return a + b; }, 0) / c.avg.length : null;
            return '<td><span class="row wrapn gap4"><span class="dot ' + c.st + '"></span><span class="num">' + (c.st === 'down' ? '<span class="down">down</span>' : HW.fnum(avg) + '<span class="faint"> ms</span>') + '</span>' + (c.loss > 0 ? '<span class="num ' + (RANK[c.st] >= 3 ? 'bad' : 'warn') + '">' + HW.fnum(c.loss, 0) + '%</span>' : '') + '</span></td>'; }).join('') +
            '<td><span class="pill ' + v[0] + '">' + esc(v[1]) + '</span></td><td class="w0"><button class="btn-xs btn-g btn-i" data-loc="' + esc(x) + '">' + I('more') + '</button></td></tr>'; }).join('') + '</tbody></table>';
      [].forEach.call($('mx').querySelectorAll('[data-loc]'), function (b) { b.onclick = function () { var x = b.dataset.loc, hs = Object.keys(locs[x].hosts);
        HW.menu(b, [{ label: 'Compare sites on a chart', icon: 'chart', onClick: function () { location.hash = '#/compare?loc=' + encodeURIComponent(x); } },
          { label: 'MTR from all sites', icon: 'play', onClick: function () { mtrDialog(hs); } },
          { label: 'Incidents for this location', icon: 'alert', onClick: function () { location.hash = '#/incidents?loc=' + encodeURIComponent(x); } }]); }; });
    }
    every(function () { live().then(draw).catch(fail); }, 4000);
  }

  /* ------------------------------------------------------------ incidents */
  var RANGES = [[3600, '1h'], [21600, '6h'], [86400, '24h'], [604800, '7d'], [2592000, '30d']];
  function vIncidents() {
    head('Incidents', 'What several sites see at the same time, and what only one site sees');
    var f = HW.lsj('hinc', { range: 86400, kinds: [], locs: [], probes: [], sig: [] });
    if (qs('loc')) f.locs = [qs('loc')];
    live().then(function (l) {
      var c = l.correlate;
      var th = HW.lsj('hth', { min: c.min_sites, uL: c.use_loss, L: c.loss, uJ: c.use_jitter, J: c.jitter, uD: c.use_delay, D: c.delay });
      $('main').innerHTML = '<div class="card"><div class="bd col gap12"><div class="row gap12"><span id="iR"></span><div id="iP"></div><div id="iL"></div><div id="iK"></div><div id="iS"></div></div>' +
        '<div class="row gap12"><label class="row gap4 small"><b>Seen from at least</b><input type="number" id="tMin" min="1" max="50" value="' + th.min + '" style="width:70px"><span>sites</span></label>' +
        '<label class="row gap4 small"><input type="checkbox" id="tuL"' + (th.uL ? ' checked' : '') + '>loss &gt;<input type="number" id="tL" value="' + th.L + '" style="width:70px">%</label>' +
        '<label class="row gap4 small"><input type="checkbox" id="tuJ"' + (th.uJ ? ' checked' : '') + '>jitter &gt;<input type="number" id="tJ" value="' + th.J + '" style="width:70px">ms</label>' +
        '<label class="row gap4 small"><input type="checkbox" id="tuD"' + (th.uD ? ' checked' : '') + '>delay &gt; normal +<input type="number" id="tD" value="' + th.D + '" style="width:70px">ms</label><label class="row gap4 small">lasting at least<input type="number" id="tDur" min="0" value="' + (f.dur || 0) + '" style="width:70px">s</label><span class="grow"></span><span class="xs muted" id="iRes"></span></div></div></div>' +
        '<div class="card"><div class="hd"><h2>Timeline</h2><span class="sub">IPs over the limits per moment: red = several sites, amber = one site\u2019s path, purple = one site\u2019s own link</span></div><div class="bd"><div id="iTl"></div></div></div>' +
        '<div class="card"><div class="hd"><h2 id="iN">Incidents</h2><span class="grow"></span><button class="btn-s" id="iEv">' + I('box') + 'Evidence for this window</button></div><div class="bd"><div class="tw" id="iT"></div></div></div>';
      var rp = HW.rangePicker($('iR'), RANGES, qs('from') ? { from: +qs('from'), to: +qs('to') } : { range: f.range }, function (w) { if (w.range) f.range = w.range; HW.ls('hinc', f); load(); });
      HW.ms($('iP'), { options: probeOpts(l), value: f.probes, label: 'Sites', onChange: function (v) { f.probes = v; HW.ls('hinc', f); load(); } });
      var locs = {}; targetOpts(l).forEach(function (t) { locs[t.group] = 1; });
      HW.ms($('iL'), { options: Object.keys(locs).sort().map(function (x) { return { value: x, label: x }; }), value: f.locs, label: 'Locations', onChange: function (v) { f.locs = v; HW.ls('hinc', f); draw(); } });
      HW.ms($('iK'), { options: Object.keys(KIND).map(function (k) { return { value: k, label: KIND[k][0] }; }), value: f.kinds, label: 'Kind', onChange: function (v) { f.kinds = v; HW.ls('hinc', f); draw(); } });
      HW.ms($('iS'), { options: Object.keys(SIG).map(function (k) { return { value: k, label: SIG[k] }; }), value: f.sig, label: 'Signal', onChange: function (v) { f.sig = v; HW.ls('hinc', f); draw(); } });
      ['tMin', 'tuL', 'tL', 'tuJ', 'tJ', 'tuD', 'tD'].forEach(function (id) { $(id).addEventListener('change', function () {
        th = { min: +$('tMin').value, uL: $('tuL').checked, L: +$('tL').value, uJ: $('tuJ').checked, J: +$('tJ').value, uD: $('tuD').checked, D: +$('tD').value }; HW.ls('hth', th); load(); }); });
      var last = null;
      $('tDur').oninput = function () { f.dur = +this.value || 0; HW.ls('hinc', f); draw(); };
      $('iEv').onclick = function () { var w = rp.get(); location.hash = '#/evidence?from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to); };
      function draw() {
        if (!last) return;
        var list = last.incidents.filter(function (i) { return (i.t1 - i.t0 >= (f.dur || 0)) && (!f.kinds.length || f.kinds.indexOf(i.kind) >= 0) && (!f.locs.length || f.locs.indexOf(i.location) >= 0) && (!f.sig.length || f.sig.indexOf(i.signal) >= 0); });
        $('iN').textContent = list.length + ' incidents';
        var names = last.probes.map(function (p) { return p.name; });
        $('iT').innerHTML = list.length ? '<table class="table"><thead><tr><th>Started</th><th>Duration</th><th>Kind</th><th>Location</th><th>Target</th><th>Signal</th>' + names.map(function (n) { return '<th class="r">' + esc(n) + '</th>'; }).join('') + '<th class="w0"></th></tr></thead><tbody>' +
          list.slice(0, 500).map(function (i, k) { var u = i.signal === 'loss' ? '%' : 'ms';
            return '<tr><td class="w0">' + HW.fdt(i.t0) + '</td><td>' + HW.fdur(i.t1 - i.t0) + '</td><td><span class="pill ' + KIND[i.kind][1] + '" title="' + esc(KIND[i.kind][2]) + '">' + KIND[i.kind][0] + '</span></td>' +
              '<td>' + esc(i.location) + '</td><td class="mono small">' + esc(i.host) + '</td><td>' + i.signal + '</td>' +
              names.map(function (n) { var v = i.worst[n]; return '<td class="r num ' + (v != null ? (i.kind === 'target' ? 'bad' : 'warn') : 'faint') + '">' + (v != null ? HW.fnum(v) + ' ' + u : '–') + '</td>'; }).join('') +
              '<td class="w0"><button class="btn-xs btn-g btn-i" data-i="' + k + '">' + I('more') + '</button></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">Nothing over the limits in this window.</div>';
        [].forEach.call($('iT').querySelectorAll('[data-i]'), function (b) { b.onclick = function () { var i = list[+b.dataset.i], pad = Math.max(600, (i.t1 - i.t0));
          HW.menu(b, [{ label: 'Compare sites around this', icon: 'chart', onClick: function () { location.hash = '#/compare?host=' + encodeURIComponent(i.host) + '&from=' + Math.floor(i.t0 - pad) + '&to=' + Math.ceil(Math.min(Date.now() / 1000, i.t1 + pad)); } },
            { label: 'MTR runs around this', icon: 'route', onClick: function () { location.hash = '#/mtr?host=' + encodeURIComponent(i.host) + '&from=' + Math.floor(i.t0 - 1800) + '&to=' + Math.ceil(i.t1 + 1800); } },
            { label: 'MTR from all sites now', icon: 'play', onClick: function () { mtrDialog([i.host]); } },
            { label: 'Evidence pack for this incident', icon: 'box', onClick: function () { location.hash = '#/evidence?from=' + Math.floor(i.t0 - pad) + '&to=' + Math.ceil(Math.min(Date.now() / 1000, i.t1 + pad)) + '&host=' + encodeURIComponent(i.host); } }]); }; });
      }
      function load() {
        var w = rp.get(), W = $('iTl').clientWidth || 900;
        var q = 'from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to) + '&points=' + Math.round(W / 2) + '&min_sites=' + th.min +
          '&loss=' + (th.uL ? th.L : 'off') + '&jitter=' + (th.uJ ? th.J : 'off') + '&delay=' + (th.uD ? th.D : 'off') + (f.probes.length ? '&probe=' + f.probes.join(',') : '');
        $('iRes').textContent = 'loading…';
        api('/api/correlate?' + q).then(function (r) {
          last = r;
          $('iRes').textContent = 'resolution ' + HW.fdur(r.step) + (Object.keys(r.errors).length ? ' · not answering: ' + Object.keys(r.errors).join(', ') : '');
          var t = r.buckets.map(function (b) { return b[0]; });
          HW.chart($('iTl'), [{ name: 'Several sites', color: HW.cssv('--bad'), t: t, v: r.buckets.map(function (b) { return b[1]; }) },
            { name: 'One site path', color: HW.cssv('--warn'), t: t, v: r.buckets.map(function (b) { return b[2]; }) },
            { name: 'Site link', color: HW.cssv('--purple'), t: t, v: r.buckets.map(function (b) { return b[3]; }) }],
            { t0: w.from, t1: w.to, unit: 'IPs', height: 150, legend: true, bars: true, step: r.step,
              onZoom: function (a, b) { rp.set({ from: a, to: b }); load(); }, onReset: function () { rp.set({ range: f.range }); load(); } });
          draw();
        }).catch(fail);
      }
      load();
      S.timers.push(setInterval(function () { if (rp.get().range) load(); }, 60000));
    }).catch(fail);
  }

  /* ------------------------------------------------------------ compare sites */
  function vCompare() {
    head('Compare sites', 'The same targets measured from each site · dashed lines are the second, fourth… site');
    var f = HW.lsj('hcmp', { range: 21600, sel: [], probes: [], group: 'location' });
    if (qs('loc')) { f.sel = ['loc:' + qs('loc')]; f.group = 'location'; }
    if (qs('host')) { f.sel = [qs('host')]; f.group = 'host'; }
    live().then(function (l) {
      $('main').innerHTML = '<div class="card"><div class="bd row gap12"><span id="cR"></span><div id="cT"></div><div id="cP"></div><span id="cG"></span><span class="grow"></span><span class="xs muted" id="cRes"></span></div></div>' +
        [['rtt', 'Latency', 'ms'], ['loss', 'Packet loss', '%'], ['jit', 'Jitter', 'ms']].map(function (c) { return '<div class="card"><div class="hd"><h2>' + c[1] + '</h2><span class="sub">' + c[2] + '</span></div><div class="bd"><div id="k_' + c[0] + '"><div class="empty">Pick one or a few targets or locations above.</div></div></div></div>'; }).join('');
      var rp = HW.rangePicker($('cR'), [[3600, '1h'], [21600, '6h'], [86400, '24h'], [604800, '7d'], [2592000, '30d']], qs('from') ? { from: +qs('from'), to: +qs('to') } : { range: f.range }, function (w) { if (w.range) f.range = w.range; HW.ls('hcmp', f); load(); });
      HW.ms($('cT'), { options: targetOpts(l, true), value: f.sel, label: 'Show', placeholder: 'pick…', onChange: function (v) { f.sel = v; HW.ls('hcmp', f); load(); } });
      HW.ms($('cP'), { options: probeOpts(l), value: f.probes, label: 'Sites', onChange: function (v) { f.probes = v; HW.ls('hcmp', f); load(); } });
      HW.seg($('cG'), [['location', 'Per location'], ['host', 'Per IP']], f.group, function (v) { f.group = v; HW.ls('hcmp', f); load(); });
      var hidden = { rtt: {}, loss: {}, jit: {} };
      function load() {
        if (!f.sel.length) return;
        var w = rp.get(), W = $('k_rtt').clientWidth || 900;
        api('/api/series?from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to) + '&points=' + Math.round(W / 2) + '&group=' + f.group + selQ(f.sel) + (f.probes.length ? '&probe=' + f.probes.join(',') : '')).then(function (d) {
          $('cRes').textContent = (d.step ? 'resolution ' + HW.fdur(d.step) : '') + (Object.keys(d.errors).length ? ' · not answering: ' + Object.keys(d.errors).join(', ') : '');
          var order = l.probes.map(function (p) { return p.id; });
          var mk = function (col) { return d.series.map(function (s) { return { name: s.name, dash: order.indexOf(s.probe) % 2 === 1, color: HW.color((f.group === 'host' ? s.host : s.location) + '|' + s.probe),
            t: s.points.map(function (x) { return x[0]; }), v: s.points.map(function (x) { return x[col]; }) }; }); };
          var o = function (k, unit, pct) { return { t0: w.from, t1: w.to, unit: unit, pct: pct, hidden: hidden[k], legend: true,
            onZoom: function (a, b) { rp.set({ from: a, to: b }); load(); }, onReset: function () { rp.set({ range: f.range }); load(); } }; };
          HW.chart($('k_rtt'), mk(1), o('rtt', 'ms')); HW.chart($('k_loss'), mk(2), o('loss', '%', true)); HW.chart($('k_jit'), mk(3), o('jit', 'ms'));
        }).catch(fail);
      }
      load();
    }).catch(fail);
  }

  /* ------------------------------------------------------------ MTR across probes */
  function modeName(r) { return r.mode === 'tcp' ? 'TCP ' + r.port : (r.mode || '').toUpperCase(); }
  function trigPill(r) { var t = TRIG[r.trig] || [r.trig, '']; return '<span class="pill ' + t[1] + '">' + t[0] + '</span>'; }
  function statusPill(r) { var m = { done: 'ok', running: 'info', queued: '', error: 'bad', cancelled: '' }[r.status]; return '<span class="pill ' + m + '">' + esc(r.status) + '</span>'; }
  function lossCell(v) { if (v == null) return '<span class="faint">–</span>'; var c = v >= 20 ? 'var(--bad)' : v > 0 ? 'var(--warn)' : 'var(--ok)';
    return '<div class="hopbar"><span class="num" style="width:44px;text-align:right;color:' + c + '">' + HW.fnum(v) + '%</span><div class="bar"><i style="width:' + Math.min(100, Math.max(v, v > 0 ? 3 : 0)) + '%;background:' + c + '"></i></div></div>'; }
  function vMtr() {
    head('MTR', 'Runs from every site, newest first', '<button class="btn-p" id="runBtn">' + I('play') + 'MTR from all sites</button>');
    $('runBtn').onclick = function () { mtrDialog([]); };
    var f = HW.lsj('hmtr', { range: 604800, hosts: [], probes: [], trig: [] });
    if (qs('host')) f.hosts = [qs('host')];
    live().then(function (l) {
      $('main').innerHTML = '<div class="card"><div class="bd row gap12"><span id="rR"></span><div id="rH"></div><div id="rP"></div><div id="rT"></div></div></div>' +
        '<div class="card"><div class="hd"><h2 id="rN">Runs</h2><span class="sub" id="rB"></span></div><div class="bd"><div class="tw" id="rL"></div></div></div>';
      var rp = HW.rangePicker($('rR'), [[86400, '24h'], [604800, '7d'], [2592000, '30d']], qs('from') ? { from: +qs('from'), to: +qs('to') } : { range: f.range }, function (w) { if (w.range) f.range = w.range; HW.ls('hmtr', f); load(); });
      HW.ms($('rH'), { options: targetOpts(l), value: f.hosts, label: 'Targets', onChange: function (v) { f.hosts = v; HW.ls('hmtr', f); load(); } });
      HW.ms($('rP'), { options: probeOpts(l), value: f.probes, label: 'Sites', onChange: function (v) { f.probes = v; HW.ls('hmtr', f); load(); } });
      HW.ms($('rT'), { options: Object.keys(TRIG).map(function (k) { return { value: k, label: TRIG[k][0] }; }), value: f.trig, label: 'Trigger', onChange: function (v) { f.trig = v; HW.ls('hmtr', f); load(); } });
      function load() {
        var w = rp.get();
        api('/api/mtr?limit=500&from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to) + (f.hosts.length ? '&host=' + encodeURIComponent(f.hosts.join(',')) : '') + (f.probes.length ? '&probe=' + f.probes.join(',') : '') + (f.trig.length ? '&trig=' + f.trig.join(',') : '')).then(function (r) {
          $('rN').textContent = r.runs.length + ' runs';
          $('rB').textContent = Object.keys(r.errors).length ? 'not answering: ' + Object.keys(r.errors).join(', ') : '';
          $('rL').innerHTML = r.runs.length ? '<table class="table"><thead><tr><th>Started</th><th>Site</th><th>Location</th><th>Target</th><th>Mode</th><th>Trigger</th><th>Status</th><th style="min-width:140px">Loss at target</th><th class="r">Hops</th></tr></thead><tbody>' +
            r.runs.map(function (x) { return '<tr class="click" data-p="' + esc(x.probe) + '" data-id="' + x.id + '"><td class="w0">' + HW.fdt(x.started || x.created) + '</td><td><b>' + esc(x.probe_name) + '</b></td><td>' + esc(x.location) + '</td><td class="mono small">' + esc(x.host) + '</td><td>' + modeName(x) + '</td><td>' + trigPill(x) + (x.reason ? ' <span class="xs muted">' + esc(x.reason) + '</span>' : '') + '</td><td>' + statusPill(x) + '</td><td>' + lossCell(x.dst_loss) + '</td><td class="r">' + (x.hops || '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No runs in this window.</div>';
          [].forEach.call($('rL').querySelectorAll('tr.click'), function (tr) { tr.onclick = function () { location.hash = '#/run?probe=' + tr.dataset.p + '&id=' + tr.dataset.id; }; });
        }).catch(fail);
      }
      load(); S.timers.push(setInterval(load, 10000));
    }).catch(fail);
  }
  function hopTable(hubs, other) {
    var mx = Math.max.apply(null, hubs.map(function (h) { return h.Wrst || 0; }).concat([1])), oip = other ? other.map(function (h) { return HW.hopIp(h.host); }) : null;
    return '<div class="tw"><table class="table"><thead><tr><th class="r">#</th><th>Host</th><th>AS</th><th style="min-width:120px">Loss</th><th class="r">Sent</th><th style="min-width:130px">Avg</th><th class="r">Best</th><th class="r">Worst</th></tr></thead><tbody>' +
      hubs.map(function (h, i) { return '<tr' + (oip && oip[i] !== HW.hopIp(h.host) ? ' class="chg"' : '') + '><td class="r">' + h.count + '</td><td class="mono small">' + esc(h.host) + '</td><td class="small muted">' + esc(h.ASN || '') + '</td><td>' + lossCell(h['Loss%'] || 0) + '</td><td class="r">' + h.Snt + '</td>' +
        '<td><div class="hopbar"><span class="num" style="width:44px;text-align:right">' + HW.fnum(h.Avg) + '</span><div class="bar"><i style="width:' + (h.Avg / mx * 100) + '%;background:var(--accent)"></i></div></div></td><td class="r">' + HW.fnum(h.Best) + '</td><td class="r">' + HW.fnum(h.Wrst) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function vRun() {
    var pid = qs('probe'), id = +qs('id'), others = null, cmp = null;
    head('MTR run', '');
    function draw() {
      api('/api/run?probe=' + encodeURIComponent(pid) + '&id=' + id).then(function (r) {
        var hubs = (r.result && r.result.report && r.result.report.hubs) || [], v = HW.mtrVerdict(hubs);
        head(r.host + ' from ' + r.probe_name, r.location + ' · ' + modeName(r) + ' · ' + r.cycles + ' cycles · ' + HW.fdt(r.started || r.created), '<a class="btn-s btn-g" href="#/mtr">' + I('route') + 'All runs</a>');
        var t = r.started || r.created;
        if (!others) { others = []; api('/api/mtr?limit=200&host=' + encodeURIComponent(r.host) + '&from=' + Math.floor(t - 1800) + '&to=' + Math.ceil(t + 1800)).then(function (x) {
          others = x.runs.filter(function (o) { return !(o.probe === r.probe && o.id === r.id) && o.status === 'done'; }); draw(); }); }
        var cmpHubs = cmp && cmp.result ? cmp.result.report.hubs : null;
        $('main').innerHTML = '<div class="kpis">' + kpi('server', 'Site', esc(r.probe_name), '') + kpi('info', 'Status', statusPill(r), r.error ? esc(r.error) : '') +
          kpi('alert', 'Loss at target', r.dst_loss == null ? '–' : HW.fnum(r.dst_loss) + '%', (hubs.length || '') + ' hops') + kpi('clock', 'Trigger', trigPill(r), esc(r.reason || '')) + '</div>' +
          (v ? '<div class="banner ' + (v.level === 'ok' ? 'info' : v.level) + '">' + I(v.level === 'ok' ? 'check' : 'alert') + esc(v.text) + '</div>' : '') +
          '<div class="card"><div class="hd"><h2>Same target from other sites</h2><span class="sub">runs within 30 minutes · pick one to put it next to this one</span></div><div class="bd">' +
          (others && others.length ? '<div class="row gap4">' + others.map(function (o, k) { return '<button class="btn-s' + (cmp && cmp.id === o.id && cmp.probe === o.probe ? ' btn-p' : '') + '" data-o="' + k + '">' + esc(o.probe_name) + ' · ' + HW.fdt(o.started || o.created) + ' · ' + modeName(o) + ' · ' + (o.dst_loss == null ? '' : HW.fnum(o.dst_loss) + '% loss') + '</button>'; }).join('') + '</div>'
            : '<div class="small muted">' + (others ? 'None. Use <b>MTR from all sites</b> to get one from every site at the same moment.' : 'Looking…') + '</div>') + '</div></div>' +
          (hubs.length ? '<div class="card"><div class="hd"><h2>Hops</h2><span class="grow"></span><button class="btn-s btn-p" id="copy">' + I('copy') + 'Copy for support</button><a class="btn btn-s" href="/api/run/file?probe=' + encodeURIComponent(pid) + '&id=' + id + '">' + I('download') + '.txt</a></div><div class="bd">' +
            (cmpHubs ? '<div class="cmp"><div><div class="small muted" style="margin-bottom:6px">' + esc(r.probe_name) + '</div>' + hopTable(hubs, cmpHubs) + '</div><div><div class="small muted" style="margin-bottom:6px">' + esc(cmp.probe_name) + ' · ' + HW.fdt(cmp.started) + '</div>' + hopTable(cmpHubs, hubs) + '</div></div>' : hopTable(hubs)) + '</div></div>' : '') +
          (r.report ? '<div class="card"><div class="hd"><h2>Text for support</h2></div><div class="bd"><pre class="rep" id="rep"></pre></div></div>' : '');
        if (r.report) $('rep').textContent = r.report + (cmp && cmp.report ? '\n\n' + cmp.report : '');
        if ($('copy')) $('copy').onclick = function () { HW.copy(r.report + (cmp && cmp.report ? '\n\n' + cmp.report : ''), cmp ? 'Both reports' : 'Report'); };
        [].forEach.call($('main').querySelectorAll('[data-o]'), function (b) { b.onclick = function () { var o = others[+b.dataset.o];
          api('/api/run?probe=' + encodeURIComponent(o.probe) + '&id=' + o.id).then(function (x) { cmp = x; draw(); }); }; });
        if (r.status === 'running' || r.status === 'queued') S.timers.push(setTimeout(draw, 3000));
      }).catch(fail);
    }
    draw();
  }

  /* ------------------------------------------------------------ evidence */
  function vEvidence() {
    head('Evidence', 'One ZIP with every site\u2019s data for a time window, plus what was seen from several sites');
    live().then(function (l) {
      var win = qs('from') ? { from: +qs('from'), to: +qs('to') } : { range: 86400 };
      $('main').innerHTML = '<div class="card"><div class="hd"><h2>Time window</h2></div><div class="bd"><span id="eR"></span></div></div>' +
        '<div class="card"><div class="hd"><h2>Targets and sites</h2><span class="sub">empty = all</span></div><div class="bd row gap12"><div id="eT"></div><div id="eP"></div></div></div>' +
        '<div class="card"><div class="hd"><h2>Note</h2><span class="sub">goes into README.txt</span></div><div class="bd"><textarea id="eN" style="min-height:70px" placeholder="Ticket number, what users reported…"></textarea></div></div>' +
        '<div class="card"><div class="bd col gap12"><div class="row"><button class="btn-p" id="eGo">' + I('box') + 'Download evidence pack</button></div>' +
        '<div class="xs muted">README.txt lists the incidents seen from several sites and those seen from one site only; one folder per site holds that site\u2019s README, ping.csv, events.csv and MTR reports.</div></div></div>';
      var rp = HW.rangePicker($('eR'), [[3600, '1h'], [21600, '6h'], [86400, '24h'], [604800, '7d']], win, function () {});
      var t = HW.ms($('eT'), { options: targetOpts(l, true), value: qs('host') ? [qs('host')] : [], label: 'Targets', placeholder: 'all' });
      var p = HW.ms($('eP'), { options: probeOpts(l), value: [], label: 'Sites', placeholder: 'all' });
      $('eGo').onclick = function () { var w = rp.get(); HW.toast('Collecting from every site…');
        HW.download('/api/evidence?from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to) + selQ(t.get()) + (p.get().length ? '&probe=' + p.get().join(',') : '') + '&note=' + encodeURIComponent($('eN').value)); };
    }).catch(fail);
  }

  /* ------------------------------------------------------------ settings */
  function vSettings() {
    if (!admin()) { head('Settings', ''); $('main').innerHTML = '<div class="card"><div class="empty">Log in to change the settings.<div class="mt12"><button class="btn-p" id="li">' + I('lock') + 'Log in</button></div></div></div>'; $('li').onclick = function () { loginBox(false); }; return; }
    var tab = qs('tab') || HW.ls('hsTab') || 'probes';
    head('Settings', '', '');
    Promise.all([api('/api/config'), api('/api/live').catch(function () { return { probes: [] }; })]).then(function (r) {
      var cfg = r[0], lv = {}; r[1].probes.forEach(function (p) { lv[p.id] = p; });
      var tabs = [['probes', 'Probes'], ['correlate', 'Correlation'], ['security', 'Security']];
      $('main').innerHTML = '<div class="tabs" id="st">' + tabs.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div id="sb" class="col gap12"></div>';
      $('st').onclick = function (e) { var b = e.target.closest('button'); if (b) { HW.ls('hsTab', b.dataset.t); location.hash = '#/settings?tab=' + b.dataset.t; } };
      var save = function (c) { return api('/api/config', { method: 'PUT', body: c }).then(function (x) { HW.toast('Saved'); loadInfo().then(route); return x; }).catch(function (e) { HW.toast(e.message, true); }); };
      if (tab === 'probes') {
        $('sb').innerHTML = '<div class="card"><div class="hd"><h2>Probes</h2><span class="sub">the sites this hub reads</span><span class="grow"></span><button class="btn-s btn-p" id="pAdd">' + I('plus') + 'Add probe</button></div><div class="bd">' +
          (cfg.probes.length ? '<div class="tw"><table class="table"><thead><tr><th>On</th><th>Name</th><th>Address</th><th>Token</th><th>Now</th><th class="w0"></th></tr></thead><tbody>' + cfg.probes.map(function (p, i) { var x = lv[p.id];
            return '<tr><td class="w0"><label class="switch"><input type="checkbox" data-on="' + i + '"' + (p.enabled ? ' checked' : '') + (p.local ? ' disabled' : '') + '></label></td><td><b>' + esc(p.name) + '</b>' + (p.local ? ' <span class="pill info">this container</span>' : '') + '</td><td class="mono small">' + esc(p.url) + '</td><td>' + (p.token_set ? '<span class="pill ok">set</span>' : '<span class="pill bad">missing</span>') + '</td>' +
              '<td>' + (!p.enabled ? '<span class="faint">off</span>' : !x ? '<span class="faint">…</span>' : x.error && !x.targets ? '<span class="small bad">' + esc(x.error) + '</span>' : '<span class="pill ok">' + x.targets.length + ' targets</span> <span class="xs muted">v' + esc(x.version) + '</span>') + '</td>' +
              '<td class="w0">' + (p.local ? '<span class="xs muted">built in</span>' : '<button class="btn-xs btn-g btn-i" data-ed="' + i + '">' + I('edit') + '</button><button class="btn-xs btn-g btn-i" data-rm="' + i + '">' + I('trash') + '</button>') + '</td></tr>'; }).join('') + '</tbody></table></div>'
            : '<div class="empty">No probes yet.</div>') +
          '<details class="help mt12"><summary>' + I('info') + 'How to connect a probe</summary><div><div class="steps"><div><span>Open the probe, <b>Settings → Security → API tokens</b>, create a token called <i>hub</i>.</span></div><div><span>Here, <b>Add probe</b>: name it after the site, paste the probe address and the token, <b>Test</b>, <b>Save</b>.</span></div><div><span>The hub must reach the probe on its port (VPN or LAN). The probe never needs to reach the hub.</span></div></div></div></details></div></div>';
        $('pAdd').onclick = function () { probeDialog(cfg, null, save); };
        [].forEach.call($('sb').querySelectorAll('[data-ed]'), function (b) { b.onclick = function () { probeDialog(cfg, +b.dataset.ed, save); }; });
        [].forEach.call($('sb').querySelectorAll('[data-rm]'), function (b) { b.onclick = function () { if (confirm('Remove probe "' + cfg.probes[+b.dataset.rm].name + '"? Its data stays on the probe.')) { cfg.probes.splice(+b.dataset.rm, 1); save(cfg); } }; });
        [].forEach.call($('sb').querySelectorAll('[data-on]'), function (b) { b.onchange = function () { cfg.probes[+b.dataset.on].enabled = b.checked; save(cfg); }; });
      }
      if (tab === 'correlate') {
        var k = cfg.correlate;
        $('sb').innerHTML = '<div class="card"><div class="hd"><h2>Correlation defaults</h2><span class="sub">what counts as a problem, and when it is the target\u2019s side</span></div><div class="bd col gap12">' +
          '<div class="form"><div class="field"><label>Seen from at least (sites)</label><input type="number" id="cK" min="1" max="50" value="' + k.min_sites + '"><span class="hint">A problem this many sites see at the same moment is put on the target\u2019s side</span></div>' +
          '<div class="field"><label>Site link when (% of its targets)</label><input type="number" id="cS" min="1" max="100" value="' + k.site_share + '"><span class="hint">One site with loss on this share of its targets at once: its own uplink</span></div></div>' +
          HW.sw('cuL', k.use_loss, 'Packet loss', '') + '<div class="form"><div class="field"><label>Loss over (%)</label><input type="number" id="cL" value="' + k.loss + '"></div></div>' +
          HW.sw('cuJ', k.use_jitter, 'Jitter', '') + '<div class="form"><div class="field"><label>Jitter over (ms)</label><input type="number" id="cJ" value="' + k.jitter + '"></div></div>' +
          HW.sw('cuD', k.use_delay, 'Delay', 'compared with each site\u2019s own normal for that target') + '<div class="form"><div class="field"><label>Delay over normal + (ms)</label><input type="number" id="cD" value="' + k.delay + '"></div></div>' +
          '<div><button class="btn-p" id="cSave">' + I('check') + 'Save</button></div></div></div>';
        $('cSave').onclick = function () { cfg.correlate = { min_sites: +$('cK').value, site_share: +$('cS').value, use_loss: $('cuL').checked, loss: +$('cL').value, use_jitter: $('cuJ').checked, jitter: +$('cJ').value, use_delay: $('cuD').checked, delay: +$('cD').value }; try { localStorage.removeItem('hw_hth'); } catch (e) { /* private mode */ } save(cfg); };
      }
      if (tab === 'security') {
        $('sb').innerHTML = '<div class="card"><div class="hd"><h2>Access</h2></div><div class="bd col gap12">' + HW.sw('sV', cfg.security.view_requires_login, 'Viewing needs a login too', 'Off: anyone on the network can look') +
          '<div><button class="btn-s" id="sVs">Save</button></div></div></div>' +
          '<div class="card"><div class="hd"><h2>Change password</h2></div><div class="bd"><div class="form"><div class="field"><label>Current</label><input type="password" id="pO"></div><div class="field"><label>New</label><input type="password" id="pN"></div></div><div class="mt12"><button id="pGo">Change</button></div></div></div>';
        $('sVs').onclick = function () { cfg.security.view_requires_login = $('sV').checked; save(cfg); };
        $('pGo').onclick = function () { api('/api/password', { method: 'POST', body: { old: $('pO').value, new: $('pN').value } }).then(function () { HW.toast('Password changed'); }).catch(function (e) { HW.toast(e.message, true); }); };
      }
    }).catch(fail);
  }
  function probeDialog(cfg, i, save) {
    var p = i == null ? { name: '', url: 'http://', token: '', enabled: true } : JSON.parse(JSON.stringify(cfg.probes[i]));
    HW.modal(i == null ? 'Add probe' : 'Edit probe', '<div class="col gap12"><div class="field"><label>Name</label><input id="pn" value="' + esc(p.name) + '" placeholder="e.g. Home, Office, DC Frankfurt"><span class="hint">Shown in every table and chart</span></div>' +
      '<div class="field"><label>Address</label><input id="pu" value="' + esc(p.url) + '" placeholder="http://192.0.2.10:8095"></div>' +
      '<div class="field"><label>API token</label><input id="pt" type="password" placeholder="' + (p.token_set ? 'stored – leave empty to keep it' : 'hw_…') + '"><span class="hint">From the probe: Settings → Security → API tokens</span></div>' +
      '<div id="pr" class="small"></div></div>', '<button id="ptest">' + I('refresh') + 'Test</button><span class="grow"></span><button class="btn-g" id="px">Cancel</button><button class="btn-p" id="pok">Save</button>');
    var body = function () { return { id: p.id, name: $('pn').value.trim(), url: $('pu').value.trim(), token: $('pt').value.trim(), enabled: p.enabled }; };
    $('ptest').onclick = function () { $('pr').innerHTML = '<span class="muted">Testing…</span>';
      api('/api/probes/test', { method: 'POST', body: body() }).then(function (x) { $('pr').innerHTML = '<span class="pill ok">' + I('check') + 'OK</span> site <b>' + esc(x.site) + '</b>, version ' + esc(x.version) + ', ' + x.targets + ' targets'; if (!$('pn').value) $('pn').value = x.site; })
        .catch(function (e) { $('pr').innerHTML = '<span class="bad">' + esc(e.message) + '</span>'; }); };
    $('px').onclick = HW.closeModal;
    $('pok').onclick = function () { var b = body(); if (i == null) cfg.probes.push(b); else cfg.probes[i] = b; HW.closeModal(); save(cfg); };
  }

  window.addEventListener('hashchange', route);
  loadInfo().then(route).catch(fail);
  setInterval(function () { loadInfo().catch(function () { /* banner */ }); }, 30000);
})();
