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
  var TRIG = { manual: ['Manual', 'info'], auto: ['Automatic', 'warn'], schedule: ['Scheduled', 'purple'], cross: ['Cross-site', 'info'] };

  function admin() { return S.info && S.info.auth.admin; }
  function every(fn, ms) { fn(); S.timers.push(setInterval(fn, ms)); }
  function clearTimers() { S.timers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); S.timers = []; }
  function head(t, sub, act) { $('title').textContent = t; $('subtitle').innerHTML = sub || ''; $('topActions').innerHTML = act || ''; }
  function qs(k) { var m = new RegExp('[?&]' + k + '=([^&]+)').exec(location.hash); return m ? decodeURIComponent(m[1]) : null; }
  function nav() {
    $('nav').innerHTML = NAV.map(function (n) { return '<a href="#/' + n[0] + '" class="' + (S.view === n[0] ? 'on' : '') + '">' + I(n[1]) + '<span class="lbl">' + n[2] + '</span></a>'; }).join('');
    $('loginBtn').innerHTML = admin() ? I('out') + 'Log out' : S.info && !S.info.auth.password_set ? I('lock') + 'Set password' : I('lock') + 'Log in';
    if (S.thSeg) S.thSeg.set(HW.ls('theme') || 'auto');
    $('prefsBtn').innerHTML = I('more');
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
  HW.seg($('tzSeg'), HW.TZ, HW.tz, function (v) { HW.tz = v; HW.ls('tz', v); route(); });
  $('prefsBtn').onclick = function () {
    HW.prefs(this, { login: $('loginBtn').innerHTML, onLogin: function () { $('loginBtn').click(); },
      onChange: function () { HW.seg($('tzSeg'), HW.TZ, HW.tz, function (v) { HW.tz = v; HW.ls('tz', v); route(); }); route(); } });
  };
  S.thSeg = HW.themeSeg($('themeSeg'), function () { route(); });
  HW.onTheme = function () { route(); };
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
  /* a tile; with go it is a link (a "#/..." address) or an action on this page ("@name", see onKpi) */
  function kpi(ic, l, v, s, go) {
    var inner = '<div class="l">' + I(ic) + esc(l) + '</div><div class="v">' + v + '</div><div class="s">' + (s || '') + '</div>';
    if (!go) return '<div class="kpi">' + inner + '</div>';
    return go[0] === '@' ? '<button type="button" class="kpi click" data-kpi="' + esc(go.slice(1)) + '">' + inner + '</button>' : '<a class="kpi click" href="' + esc(go) + '">' + inner + '</a>';
  }
  function onKpi(acts) { [].forEach.call(document.querySelectorAll('[data-kpi]'), function (b) { b.onclick = function () { if (acts[b.dataset.kpi]) acts[b.dataset.kpi](); }; }); }

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

  /* ------------------------------------------------------------ overview: one main chart + locations x sites */
  var SIGS = [['loss', 'Loss', '%', true], ['delay', 'Latency rise', 'ms', false], ['jitter', 'Jitter', 'ms', false]];
  function vOverview() {
    head('Overview', 'What the sites see – together or each on its own', '<button class="btn-p" id="runBtn">' + I('play') + '<span>MTR from all sites</span></button>');
    $('runBtn').onclick = function () { mtrDialog([]); };
    var f = HW.lsj('hovf', { q: '', only: 'bad', locs: [] });
    if (!f.v29) { f.only = 'bad'; f.v29 = 1; HW.ls('hovf', f); }     // the old default "All" listed every location; start from the chart once
    f.view = f.view || 'common'; f.sig = f.sig || 'loss';
    var locMs = null, ov = null, hidden = {}, pin = null;
    $('main').innerHTML = '<div class="card"><div class="bd row gap12"><span id="ovR"></span><span class="grow"></span><span class="xs muted" id="ovUpd"></span></div></div>' +
      '<div class="kpis" id="kpis"></div><div class="row" id="pstrip"></div>' +
      '<div class="card"><div class="hd"><h2 id="mcT">…</h2><span class="sub" id="mcS"></span><span class="grow"></span><span id="ovV"></span><span id="ovS"></span>' +
      '<button class="btn-s btn-g btn-i" id="mcX" title="Enlarge">' + I('expand') + '</button></div><div class="bd"><div id="mcW"></div><div id="pinbar"></div><div id="mc"><div class="empty" style="height:300px;display:flex;align-items:center;justify-content:center">Loading…</div></div>' +
      '<div class="mt12 small muted">How many IPs had problems · red = several sites, amber = one site only, purple = one site\u2019s own link</div><div id="ms"></div></div></div>' +
      '<div class="card"><div class="hd"><h2>Locations</h2><span class="sub" id="ovSub"></span></div><div class="bd col gap12"><div class="row"><div class="search" style="width:240px">' + I('search') + '<input id="ovQ" placeholder="Filter" value="' + esc(f.q) + '"></div><span id="ovOnly"></span><div id="ovL"></div></div><div id="mx"></div></div></div>';
    $('ovQ').oninput = function () { f.q = this.value.toLowerCase(); HW.ls('hovf', f); draw(); };
    var onlySeg = HW.seg($('ovOnly'), [['bad', 'As in the chart'], ['all', 'All locations']], f.only, function (v) { f.only = v; HW.ls('hovf', f); draw(); });
    var rp = HW.rangePicker($('ovR'), [['live', 'Live'], [900, '15m'], [3600, '1h'], [10800, '3h'], [21600, '6h'], [86400, '24h'], [604800, '7d']],
      f.win || { range: 'live' }, function (w) { f.win = w.range ? { range: w.range } : { from: w.from, to: w.to }; HW.ls('hovf', f); ov = null; loadOv(); draw(); });
    HW.seg($('ovS'), SIGS.map(function (x) { return [x[0], x[1]]; }), f.sig, function (v) { f.sig = v; HW.ls('hovf', f); hidden = {}; charts(); draw(); });
    function viewSeg() {
      var l = S.live; if (!l) return;
      var opts = l.probes.map(function (p) { return [p.id, p.name, 'What ' + p.name + ' saw on its own']; }).concat([['common', 'Common', 'Only what all sites saw at the same moment']]);
      if (!opts.some(function (x) { return x[0] === f.view; })) f.view = 'common';
      HW.seg($('ovV'), opts, f.view, function (v) { f.view = v; HW.ls('hovf', f); hidden = {}; charts(); draw(); });
      $('ovV').dataset.n = l.probes.length;
    }
    function series() {
      if (!ov) return [];
      var src = f.view === 'common' ? ov.lines[f.sig] : ((ov.by_probe[f.view] || {})[f.sig] || []);
      return src.map(function (x) { return { name: x.name, color: HW.color('loc|' + x.name), t: x.t, v: x.v }; });
    }
    function bands() {
      if (!ov) return [];
      var pname = f.view === 'common' ? null : (ov.probes.filter(function (p) { return p.id === f.view; })[0] || {}).name;
      return ov.incidents.filter(function (i) { return i.signal === f.sig && (pname ? i.site_names.indexOf(pname) >= 0 : i.kind === 'target'); })
        .map(function (i) { return { t0: i.t0, t1: i.t1, color: HW.cssv(i.kind === 'target' ? '--bad' : i.kind === 'site' ? '--purple' : '--warn'), label: i.location + ' ' + i.host + ' – ' + KIND[i.kind][0] }; });
    }
    function opts(height) {
      var sg = SIGS.filter(function (x) { return x[0] === f.sig; })[0], w = rp.get();
      return { t0: ov ? ov.from : w.from, t1: ov ? ov.to : w.to, unit: sg[2], pct: sg[3], height: height || 300, legend: true, hidden: hidden, peakLabels: true, tipHideZero: true, group: 'ov', pin: pin,
        bands: bands(), emptyText: f.view === 'common' ? 'Nothing seen from all sites at the same moment' : 'Nothing over the limit from this site',
        onZoom: function (a, b) { rp.set({ from: a, to: b }); f.win = { from: a, to: b }; HW.ls('hovf', f); ov = null; loadOv(); draw(); },
        onReset: function () { rp.set({ range: 'live' }); f.win = { range: 'live' }; HW.ls('hovf', f); ov = null; loadOv(); draw(); },
        onPin: function (t) { pin = t; charts(); } };
    }
    function charts() {
      viewSeg();
      if (!ov) return;
      var sg = SIGS.filter(function (x) { return x[0] === f.sig; })[0], th = ov.thresholds, K = ov.min_sites;
      var pname = f.view === 'common' ? null : (ov.probes.filter(function (p) { return p.id === f.view; })[0] || {}).name;
      $('mcT').textContent = sg[1] + (pname ? ' · from ' + pname : ' · seen from all sites');
      $('mcS').textContent = (pname ? 'locations where ' + pname + ' saw ' : 'locations where ' + (ov.all_sites ? 'all ' + K : 'at least ' + K) + ' sites saw at the same moment ') +
        ({ loss: 'loss over ' + th.loss + '%', delay: 'latency over its normal by ' + th.delay + ' ms or more', jitter: 'jitter over ' + th.jitter + ' ms' })[f.sig] + ' · coloured lane at the bottom = incidents';
      var miss = Object.keys(ov.errors || {}), total = (S.live ? S.live.probes.length : ov.probes.length);
      $('pinbar').dataset.miss = miss.length;
      var warn = miss.length ? '<div class="banner warn" style="margin-bottom:10px">' + I('alert') + 'Not answering: ' + esc(miss.join(', ')) + '. ' +
        (f.view === 'common' ? 'Common now shows what the remaining ' + (total - miss.length) + ' of ' + total + ' sites saw – it can\u2019t tell the target\u2019s side from a site problem until all answer.' : '') + '</div>' : '';
      var ser = series(), o = opts();
      HW.chart($('mc'), ser, o);
      $('mcW').innerHTML = warn;
      $('mcX').onclick = function () { HW.expandChart($('mcT').textContent, ser, opts()); };
      var t = ov.simultaneous.map(function (b) { return b[0]; });
      HW.chart($('ms'), [{ name: 'Several sites', color: HW.cssv('--bad'), t: t, v: ov.simultaneous.map(function (b) { return b[1]; }) },
        { name: 'One site', color: HW.cssv('--warn'), t: t, v: ov.simultaneous.map(function (b) { return b[2]; }) },
        { name: 'Site link', color: HW.cssv('--purple'), t: t, v: ov.simultaneous.map(function (b) { return b[3]; }) }],
        Object.assign(opts(90), { bars: true, step: ov.step, peakLabels: false, bands: [], legend: false, hidden: {}, unit: 'IPs', pct: false, emptyText: 'No problems' }));
      pinBar();
    }
    function pinBar() {
      if (!pin) { $('pinbar').innerHTML = ''; return; }
      var near = ov ? ov.incidents.filter(function (i) { return pin >= i.t0 - 60 && pin <= i.t1 + 60; }) : [];
      $('pinbar').innerHTML = '<div class="pinbar mt8" style="margin-bottom:10px">' + I('clock') + '<span>Pinned <b>' + HW.fdt(pin) + '</b></span>' +
        (near.length ? '<span class="small">' + near.slice(0, 3).map(function (i) { return esc(i.location) + ' (' + KIND[i.kind][0].toLowerCase() + ')'; }).join(', ') + '</span>' : '') +
        '<span class="grow"></span><button class="btn-xs" data-p="zoom">Zoom to ±15 min</button><button class="btn-xs" data-p="mtr">MTR runs around</button><button class="btn-xs" data-p="ev">Evidence</button><button class="btn-xs btn-g btn-i" data-p="x" title="Unpin">' + I('x') + '</button></div>';
      [].forEach.call($('pinbar').querySelectorAll('[data-p]'), function (b) { b.onclick = function () { var a = Math.floor(pin - 900), z = Math.ceil(Math.min(Date.now() / 1000, pin + 900));
        if (b.dataset.p === 'x') { pin = null; charts(); }
        else if (b.dataset.p === 'zoom') { rp.set({ from: a, to: z }); f.win = { from: a, to: z }; HW.ls('hovf', f); ov = null; loadOv(); draw(); }
        else if (b.dataset.p === 'mtr') location.hash = '#/mtr?from=' + a + '&to=' + z;
        else location.hash = '#/evidence?from=' + a + '&to=' + z; }; });
    }
    function loadOv() {
      var w = rp.get(), t1 = w.range ? Math.floor(Date.now() / 15000) * 15 : Math.ceil(w.to), t0 = w.range ? t1 - (w.to - w.from) : Math.floor(w.from), W = ($('mc') && $('mc').clientWidth) || 600;
      api('/api/overview?from=' + t0 + '&to=' + t1 + '&points=' + (W > 500 ? 200 : 120)).then(function (r) { ov = r; charts(); draw(); }).catch(fail);
    }
    function draw() {
      var l = S.live; if (!l) return;
      var ps = l.probes, nOk = Math.max(1, okProbes(l).length), K = l.correlate.min_sites ? Math.min(l.correlate.min_sites, nOk) : nOk, live = rp.get().range === 'live';
      var upRoles = {}; ps.forEach(function (p) { (p.roles || []).forEach(function (r) { if (r.upstream) upRoles[r.name] = 1; }); });
      if (!live && !ov) return;
      var locs = {}, order = [];
      if (live) {
        ps.forEach(function (p) { (p.targets || []).forEach(function (t) {
          var key = t.group || (t.location + (t.role ? ' · ' + t.role : ''));
          var L = locs[key]; if (!L) { L = locs[key] = { hosts: {}, by: {} }; order.push(key); }
          L.hosts[t.host] = 1; var c = L.by[p.id] = L.by[p.id] || { st: 'disabled', avg: [], loss: 0 };
          if (RANK[t.status] > RANK[c.st]) c.st = t.status; if (t.avg != null) c.avg.push(t.avg); c.loss = Math.max(c.loss, t.loss || 0); }); });
        Object.keys(locs).forEach(function (x) { var L = locs[x]; Object.keys(L.by).forEach(function (p) { var c = L.by[p]; c.avgv = c.avg.length ? c.avg.reduce(function (a, b) { return a + b; }, 0) / c.avg.length : null; }); });
      } else {
        ov.locations.forEach(function (r) { var L = locs[r.location] = { hosts: {}, by: {}, several: r.several, one: r.one, sig: r.sig || {} }; order.push(r.location);
          r.hosts.forEach(function (h) { L.hosts[h] = 1; });
          Object.keys(r.by).forEach(function (p) { var b = r.by[p]; L.by[p] = { avgv: b.avg, loss: b.loss || 0, max: b.max_loss || 0,
            st: (b.max_loss || 0) >= 20 ? 'crit' : (b.loss || 0) > 0.5 ? 'warn' : b.avg == null ? 'unknown' : 'ok' }; }); });
      }
      order.sort();
      if (!locMs) locMs = HW.ms($('ovL'), { options: order.map(function (x) { return { value: x, label: x }; }), value: f.locs, label: 'Locations', onChange: function (v) { f.locs = v; HW.ls('hovf', f); draw(); } });
      // What a location shows follows the chart: Common = seen from the sites at the same moment,
      // a site = what that site saw; in a time window also the chosen signal (loss, latency, jitter)
      var vname = f.view === 'common' ? null : (ps.filter(function (p) { return p.id === f.view; })[0] || {}).name;
      var sigName = (SIGS.filter(function (x) { return x[0] === f.sig; })[0] || ['', 'Loss'])[1].toLowerCase();
      var both = function (a) { return a.length === 2 ? a.join(' and ') : a.join(', '); };
      var verdictAll = function (L) {      // any signal, for the counters on top
        if (!live) return L.several.length ? ['bad', ''] : L.one.length ? ['warn', ''] : ['ok', ''];
        var bad = ps.filter(function (p) { return L.by[p.id] && RANK[L.by[p.id].st] >= 2; });
        return bad.length >= K && K > 1 ? ['bad', ''] : bad.length ? ['warn', ''] : ['ok', '']; };
      var verdict = function (L) {
        var tog, alone;
        if (live) {
          var bad = ps.filter(function (p) { return L.by[p.id] && RANK[L.by[p.id].st] >= 2; }).map(function (p) { return p.name; });
          tog = bad.length >= K && K > 1 ? bad : []; alone = tog.length ? [] : bad;
        } else { var sg = (L.sig || {})[f.sig] || { together: [], alone: [] }; tog = sg.together; alone = sg.alone.filter(function (n) { return tog.indexOf(n) < 0; }); }
        if (vname) {
          if (tog.indexOf(vname) >= 0) return ['bad', vname + ' – at the same moment as ' + both(tog.filter(function (n) { return n !== vname; }))];
          if (alone.indexOf(vname) >= 0) return ['warn', vname + ' only'];
          return ['ok', 'OK from ' + vname];
        }
        if (tog.length) return ['bad', 'Same moment: ' + both(tog)];
        if (alone.length > 1) return ['warn', both(alone) + ', never at the same moment'];
        if (alone.length) return ['warn', 'Only ' + alone[0]];
        return ['ok', 'OK']; };
      var multi = 0, single = 0;
      order.forEach(function (x) { var v = verdictAll(locs[x]); if (v[0] === 'bad') multi++; else if (v[0] === 'warn') single++; });
      var online = ps.filter(function (p) { return !p.error || p.targets; });
      var running = ps.reduce(function (a, p) { return a + (p.mtr ? p.mtr.running.length : 0); }, 0), rl = live ? 'now' : 'in the chosen window';
      $('kpis').innerHTML = kpi('server', 'Probes online', '<span class="' + (online.length < ps.length ? 'warn' : 'ok') + '">' + online.length + '</span><span class="small muted"> / ' + ps.length + '</span>', ps.filter(function (p) { return p.error && !p.targets; }).map(function (p) { return esc(p.name) + ' offline'; }).join(', ') || 'all answering', '#/settings?tab=probes') +
        kpi('alert', 'Seen from several sites', '<span class="' + (multi ? 'bad' : 'ok') + '">' + multi + '</span>', 'locations ' + rl + ', likely the target side', '@several') +
        kpi('info', 'Seen from one site only', '<span class="' + (single ? 'warn' : 'ok') + '">' + single + '</span>', 'locations ' + rl + ', likely that site\u2019s path', '#/incidents?kind=path,site') +
        kpi('route', 'MTR running', running, 'on all probes', '#/mtr?status=running,queued');
      onKpi({ several: function () { f.view = 'common'; f.only = 'bad'; HW.ls('hovf', f); onlySeg.set('bad'); viewSeg(); charts(); draw(); $('mx').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
      $('pstrip').innerHTML = ps.map(function (p) { var bad = (p.targets || []).filter(function (t) { return RANK[t.status] >= 2; }).length;
        return '<span class="pill ' + (p.error && !p.targets ? 'bad' : bad ? 'warn' : 'ok') + '" title="' + esc(p.error || p.url) + '">' + I('server') + esc(p.name) + (p.targets ? ' · ' + p.targets.length + ' targets' + (bad ? ' · ' + bad + ' with problems now' : '') : ' · ' + esc(p.error || 'offline')) + '</span>'; }).join('');
      var rows = order.filter(function (x) { var L = locs[x];
        if (f.locs.length && f.locs.indexOf(x) < 0) return false;
        if (f.only === 'bad' && (vname ? verdict(L)[0] === 'ok' : verdict(L)[0] !== 'bad')) return false;
        return !f.q || x.toLowerCase().indexOf(f.q) >= 0 || Object.keys(L.hosts).some(function (h) { return h.indexOf(f.q) >= 0; }); })
        .sort(function (a, b) { var r = { bad: 2, warn: 1, ok: 0 }; return r[verdict(locs[b])[0]] - r[verdict(locs[a])[0]] || a.localeCompare(b); });
      $('ovSub').textContent = (f.only === 'bad' ? rows.length + ' of ' + order.length + ' locations: ' + (vname ? 'where ' + vname + ' saw ' : 'where ' + (K > 1 && !ov ? K + ' sites' : (ov && ov.all_sites ? 'all ' + K + ' sites' : 'at least ' + K + ' sites')) + ' saw at the same moment ') + (live ? 'problems' : sigName) : order.length + ' locations') +
        ' · ' + (live ? 'live, last ' + l.probes.filter(function (p) { return p.window_s; }).map(function (p) { return p.window_s; })[0] + ' s' : rl + ', values are the average and the worst moment');
      $('ovUpd').textContent = 'updated ' + HW.ftime(l.now);
      var cell = function (c) {
        if (!c) return '<span class="faint">–</span>';
        return '<span class="row wrapn gap4"><span class="dot ' + c.st + '"></span><span class="num">' + (c.st === 'down' ? '<span class="down">down</span>' : HW.fnum(c.avgv) + '<span class="faint"> ms</span>') + '</span>' +
          (c.loss > 0 ? '<span class="num ' + (RANK[c.st] >= 3 ? 'bad' : 'warn') + '" title="' + (live ? 'loss now' : 'average loss; worst moment ' + HW.fnum(c.max, 0) + '%') + '">' + HW.fnum(c.loss, c.loss < 1 ? 1 : 0) + '%' + (!live && c.max > c.loss ? '<span class="faint"> ↑' + HW.fnum(c.max, 0) + '</span>' : '') + '</span>' : '') + '</span>'; };
      var vr = { bad: 2, warn: 1, ok: 0 };
      // with an ISP-edge role in the location: is the problem behind the ISP's gateway or at it?
      var where = function (x) {
        var parts = x.split(' · '), base = parts[0], role = parts[1];
        if (!role || verdict(locs[x])[0] === 'ok') return '';
        var edge = order.filter(function (k) { var pr = k.split(' · '); return pr[0] === base && pr[1] && upRoles[pr[1]]; });
        if (!edge.length) return '';
        if (upRoles[role]) return 'at the ISP edge or before it';
        return edge.every(function (k) { return verdict(locs[k])[0] === 'ok'; }) ? 'past the ISP edge (it is clean)' : 'ISP edge affected too';
      };
      var cols = [{ key: 'loc', label: 'Location', text: function (x) { return x; }, html: function (x) { return '<b>' + esc(x) + '</b> <span class="xs muted">' + Object.keys(locs[x].hosts).length + ' IP</span>'; } }]
        .concat(ps.map(function (p) { return { key: 'p:' + p.id, label: p.name, text: function (x) { var c = locs[x].by[p.id]; return c ? HW.fnum(c.avgv) + ' ms ' + HW.fnum(c.loss, 0) + '%' : ''; },
          sort: function (x) { var c = locs[x].by[p.id]; return c ? (c.loss || 0) * 1000 + (c.avgv || 0) : -1; }, html: function (x) { return cell(locs[x].by[p.id]); } }; }))
        .concat([{ key: 'where', label: 'Where', text: function (x) { return where(x); }, html: function (x) { var w = where(x); return w ? '<span class="small ' + (/past/.test(w) ? 'warn' : 'bad') + '">' + esc(w) + '</span>' : '<span class="faint">–</span>'; } },
          { key: 'verdict', label: 'Verdict', text: function (x) { return verdict(locs[x])[1]; }, sort: function (x) { return vr[verdict(locs[x])[0]]; }, html: function (x) { var v = verdict(locs[x]); return '<span class="pill ' + v[0] + '">' + esc(v[1]) + '</span>'; } },
          { key: 'more', label: 'More', text: function () { return ''; }, html: function (x) { return '<button class="btn-xs btn-g btn-i" data-loc="' + esc(x) + '">' + I('more') + '</button>'; } }]);
      var mxKey = 'hub-ov-' + ps.map(function (p) { return p.id; }).join('-');
      if (!S.mx || S.mx.key !== mxKey) S.mx = { key: mxKey, t: HW.table($('mx'), { id: mxKey, rows: rows, columns: cols, empty: 'No locations match.' }) };
      else { S.mx.t = HW.table($('mx'), { id: mxKey, rows: rows, columns: cols, empty: 'No locations match.' }); }
      [].forEach.call($('mx').querySelectorAll('[data-loc]'), function (b) { b.onclick = function () { var x = b.dataset.loc, hs = Object.keys(locs[x].hosts);
        HW.menu(b, [{ label: 'Compare sites on a chart', icon: 'chart', onClick: function () { location.hash = '#/compare?loc=' + encodeURIComponent(x); } },
          { label: 'MTR from all sites', icon: 'play', onClick: function () { mtrDialog(hs); } },
          { label: 'Incidents for this location', icon: 'alert', onClick: function () { location.hash = '#/incidents?loc=' + encodeURIComponent(x); } }]); }; });
    }
    every(function () { live().then(function () { viewSeg(); draw(); }).catch(fail); }, 10000);
    every(function () { if (!ov || rp.get().range) loadOv(); }, 20000);
    window.onresize = function () { if (S.view === 'overview') charts(); };
  }

  /* ------------------------------------------------------------ incidents */
  var RANGES = [[3600, '1h'], [21600, '6h'], [86400, '24h'], [604800, '7d'], [2592000, '30d']];
  function vIncidents() {
    head('Incidents', 'What several sites see at the same time, and what only one site sees');
    var f = HW.lsj('hinc', { range: 86400, kinds: [], locs: [], probes: [], sig: [] });
    if (qs('loc')) f.locs = [qs('loc')];
    if (qs('kind')) f.kinds = qs('kind').split(',');
    live().then(function (l) {
      var c = l.correlate;
      var th = HW.lsj('hth2', { min: c.min_sites, uL: c.use_loss, L: c.loss, uJ: c.use_jitter, J: c.jitter, uD: c.use_delay, D: c.delay });
      $('main').innerHTML = '<div class="card"><div class="bd col gap12"><div class="row gap12"><span id="iR"></span><div id="iP"></div><div id="iL"></div><div id="iK"></div><div id="iS"></div></div>' +
        '<div class="row gap12"><label class="row gap4 small"><b>Seen from</b><select id="tMin"><option value="0"' + (+th.min === 0 ? ' selected' : '') + '>all sites</option>' + l.probes.map(function (p, i) { return i ? '<option value="' + (i + 1) + '"' + (+th.min === i + 1 ? ' selected' : '') + '>at least ' + (i + 1) + '</option>' : ''; }).join('') + '<option value="1"' + (+th.min === 1 ? ' selected' : '') + '>any one site</option></select></label>' +
        '<label class="row gap4 small"><input type="checkbox" id="tuL"' + (th.uL ? ' checked' : '') + '>loss &gt;<input type="number" id="tL" value="' + th.L + '" style="width:70px">%</label>' +
        '<label class="row gap4 small"><input type="checkbox" id="tuJ"' + (th.uJ ? ' checked' : '') + '>jitter &gt;<input type="number" id="tJ" value="' + th.J + '" style="width:70px">ms</label>' +
        '<label class="row gap4 small"><input type="checkbox" id="tuD"' + (th.uD ? ' checked' : '') + '>delay &gt; normal +<input type="number" id="tD" value="' + th.D + '" style="width:70px">ms</label><label class="row gap4 small">lasting at least<input type="number" id="tDur" min="0" value="' + (f.dur || 0) + '" style="width:70px">s</label><span class="grow"></span><span class="xs muted" id="iRes"></span></div></div></div>' +
        '<div class="card"><div class="hd"><h2>Timeline</h2><span class="sub">IPs over the limits per moment: red = several sites, amber = one site\u2019s path, purple = one site\u2019s own link</span></div><div class="bd"><div id="iTl"></div></div></div>' +
        '<div class="card"><div class="hd"><h2 id="iN">Incidents</h2><span class="grow"></span><button class="btn-s" id="iEv">' + I('box') + 'Evidence for this window</button></div><div class="bd"><div id="iT"></div></div></div>';
      var rp = HW.rangePicker($('iR'), RANGES, qs('from') ? { from: +qs('from'), to: +qs('to') } : { range: f.range }, function (w) { if (w.range) f.range = w.range; HW.ls('hinc', f); load(); });
      HW.ms($('iP'), { options: probeOpts(l), value: f.probes, label: 'Sites', onChange: function (v) { f.probes = v; HW.ls('hinc', f); load(); } });
      var locs = {}; targetOpts(l).forEach(function (t) { locs[t.group] = 1; });
      HW.ms($('iL'), { options: Object.keys(locs).sort().map(function (x) { return { value: x, label: x }; }), value: f.locs, label: 'Locations', onChange: function (v) { f.locs = v; HW.ls('hinc', f); draw(); } });
      HW.ms($('iK'), { options: Object.keys(KIND).map(function (k) { return { value: k, label: KIND[k][0] }; }), value: f.kinds, label: 'Kind', onChange: function (v) { f.kinds = v; HW.ls('hinc', f); draw(); } });
      HW.ms($('iS'), { options: Object.keys(SIG).map(function (k) { return { value: k, label: SIG[k] }; }), value: f.sig, label: 'Signal', onChange: function (v) { f.sig = v; HW.ls('hinc', f); draw(); } });
      ['tMin', 'tuL', 'tL', 'tuJ', 'tJ', 'tuD', 'tD'].forEach(function (id) { $(id).addEventListener('change', function () {
        th = { min: +$('tMin').value, uL: $('tuL').checked, L: +$('tL').value, uJ: $('tuJ').checked, J: +$('tJ').value, uD: $('tuD').checked, D: +$('tD').value }; HW.ls('hth2', th); load(); }); });
      var last = null, tbl = null;
      $('tDur').oninput = function () { f.dur = +this.value || 0; HW.ls('hinc', f); draw(); };
      $('iEv').onclick = function () { var w = rp.get(); location.hash = '#/evidence?from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to); };
      function draw() {
        if (!last) return;
        var list = last.incidents.filter(function (i) { return (i.t1 - i.t0 >= (f.dur || 0)) && (!f.kinds.length || f.kinds.indexOf(i.kind) >= 0) && (!f.locs.length || f.locs.indexOf(i.location) >= 0) && (!f.sig.length || f.sig.indexOf(i.signal) >= 0); });
        $('iN').textContent = list.length + ' incidents';
        var names = last.probes.map(function (p) { return p.name; });
        var cols = [
          { key: 't0', label: 'Started', nowrap: true, text: function (i) { return HW.fdt(i.t0); }, sort: function (i) { return i.t0; } },
          { key: 'dur', label: 'Duration', text: function (i) { return HW.fdur(i.t1 - i.t0); }, sort: function (i) { return i.t1 - i.t0; } },
          { key: 'kind', label: 'Kind', text: function (i) { return KIND[i.kind][0]; }, html: function (i) { return '<span class="pill ' + KIND[i.kind][1] + '" title="' + esc(KIND[i.kind][2]) + '">' + KIND[i.kind][0] + '</span>'; } },
          { key: 'location', label: 'Location' },
          { key: 'host', label: 'Target', html: function (i) { return '<span class="mono small">' + esc(i.host) + '</span>'; } },
          { key: 'signal', label: 'Signal' }].concat(names.map(function (n) { return { key: 'site:' + n, label: n, align: 'r',
            text: function (i) { return i.worst[n] == null ? '' : HW.fnum(i.worst[n]) + (i.signal === 'loss' ? ' %' : ' ms'); }, sort: function (i) { return i.worst[n] == null ? -1 : i.worst[n]; },
            html: function (i) { var v = i.worst[n]; return '<span class="num ' + (v != null ? (i.kind === 'target' ? 'bad' : 'warn') : 'faint') + '">' + (v != null ? HW.fnum(v) + (i.signal === 'loss' ? ' %' : ' ms') : '–') + '</span>'; } }; }))
          .concat([{ key: 'act', label: 'More', text: function () { return ''; }, html: function (i) { return '<button class="btn-xs btn-g btn-i" data-inc="' + list.indexOf(i) + '">' + I('more') + '</button>'; } }]);
        if (tbl) tbl.render(list.slice(0, 1000)); else tbl = HW.table($('iT'), { id: 'hub-inc-' + names.length, rows: list.slice(0, 1000), columns: cols, empty: 'Nothing over the limits in this window.' });
        [].forEach.call($('iT').querySelectorAll('[data-inc]'), function (b) { b.onclick = function () { var i = list[+b.dataset.inc], pad = Math.max(600, (i.t1 - i.t0));
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
    var f = HW.lsj('hcmp', { range: 21600, sel: [], probes: [], group: 'role' });
    if (f.group === 'location') f.group = 'role';
    if (qs('loc')) { f.sel = ['loc:' + qs('loc')]; f.group = 'role'; }
    if (qs('host')) { f.sel = [qs('host')]; f.group = 'host'; }
    live().then(function (l) {
      $('main').innerHTML = '<div class="card"><div class="bd row gap12"><span id="cR"></span><div id="cT"></div><div id="cP"></div><span id="cG"></span><span class="grow"></span><span class="xs muted" id="cRes"></span></div></div>' +
        [['rtt', 'Latency', 'ms'], ['loss', 'Packet loss', '%'], ['jit', 'Jitter', 'ms']].map(function (c) { return '<div class="card"><div class="hd"><h2>' + c[1] + '</h2><span class="sub">' + c[2] + '</span><span class="grow"></span><button class="btn-s btn-g btn-i" id="kx_' + c[0] + '" title="Enlarge">' + I('expand') + '</button></div><div class="bd"><div id="k_' + c[0] + '"><div class="empty">Pick one or a few targets or locations above.</div></div></div></div>'; }).join('');
      var rp = HW.rangePicker($('cR'), [[3600, '1h'], [21600, '6h'], [86400, '24h'], [604800, '7d'], [2592000, '30d']], qs('from') ? { from: +qs('from'), to: +qs('to') } : { range: f.range }, function (w) { if (w.range) f.range = w.range; HW.ls('hcmp', f); load(); });
      HW.ms($('cT'), { options: targetOpts(l, true), value: f.sel, label: 'Show', placeholder: 'pick…', onChange: function (v) { f.sel = v; HW.ls('hcmp', f); load(); } });
      HW.ms($('cP'), { options: probeOpts(l), value: f.probes, label: 'Sites', onChange: function (v) { f.probes = v; HW.ls('hcmp', f); load(); } });
      // per location = like the Overview: roles apart (DC2 · Servers, DC2 · ISP) and the worst IP at each moment
      HW.seg($('cG'), [['role', 'Per location (worst IP)'], ['host', 'Per IP']], f.group, function (v) { f.group = v; HW.ls('hcmp', f); load(); });
      var hidden = { rtt: {}, loss: {}, jit: {} }, pin = null;
      function load() {
        if (!f.sel.length) return;
        var w = rp.get(), W = $('k_rtt').clientWidth || 900;
        api('/api/series?from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to) + '&points=' + Math.round(W / 2) + '&group=' + f.group + (f.group === 'role' ? '&agg=worst' : '') + selQ(f.sel) + (f.probes.length ? '&probe=' + f.probes.join(',') : '')).then(function (d) {
          $('cRes').textContent = (d.step ? 'resolution ' + HW.fdur(d.step) : '') + (Object.keys(d.errors).length ? ' · not answering: ' + Object.keys(d.errors).join(', ') : '');
          var order = l.probes.map(function (p) { return p.id; });
          var mk = function (col) { return d.series.map(function (s) { return { name: s.name, dash: order.indexOf(s.probe) % 2 === 1, color: HW.color((f.group === 'host' ? s.host : s.name.split(' · ').slice(0, -1).join(' · ')) + '|' + s.probe),
            t: s.points.map(function (x) { return x[0]; }), v: s.points.map(function (x) { return x[col]; }) }; }); };
          var o = function (k, unit, pct) { return { t0: w.from, t1: w.to, unit: unit, pct: pct, hidden: hidden[k], legend: true, group: 'cmp', pin: pin, peakLabels: k === 'loss', tipHideZero: k === 'loss',
            onPin: function (t) { pin = pin && Math.abs(pin - t) < (w.to - w.from) / 200 ? null : t; load(); },
            onZoom: function (a, b) { rp.set({ from: a, to: b }); load(); }, onReset: function () { rp.set({ range: f.range }); load(); } }; };
          var all = { rtt: [mk(1), o('rtt', 'ms'), 'Latency'], loss: [mk(2), o('loss', '%', true), 'Packet loss'], jit: [mk(3), o('jit', 'ms'), 'Jitter'] };
          Object.keys(all).forEach(function (k) { HW.chart($('k_' + k), all[k][0], all[k][1]); $('kx_' + k).onclick = function () { HW.expandChart(all[k][2], all[k][0], all[k][1]); }; });
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
    var f = HW.lsj('hmtr', { range: 604800 });
    (function () {
      $('main').innerHTML = '<div class="card"><div class="bd row gap12"><span id="rR"></span></div></div>' +
        '<div class="card"><div class="hd"><h2 id="rN">Runs</h2><span class="sub" id="rB"></span></div><div class="bd"><div id="rL"></div></div></div>';
      var rp = HW.rangePicker($('rR'), [[86400, '24h'], [604800, '7d'], [2592000, '30d']], qs('from') ? { from: +qs('from'), to: +qs('to') } : { range: f.range }, function (w) { if (w.range) f.range = w.range; HW.ls('hmtr', f); load(); });
      // filtering is in the table: a search box and a filter under every column (links preset the target)
      var tbl = null;
      $('rL')._tf = {};
      if (qs('host')) $('rL')._tf.host = { in: [qs('host')] };
      if (qs('status')) $('rL')._tf.status = { in: qs('status').split(',') };
      function load() {
        var w = rp.get();
        api('/api/mtr?limit=2000&from=' + Math.floor(w.from) + '&to=' + Math.ceil(w.to)).then(function (r) {
          $('rN').textContent = r.runs.length + ' runs';
          $('rB').textContent = Object.keys(r.errors).length ? 'not answering: ' + Object.keys(r.errors).join(', ') : '';
          var cols = [
            { key: 'started', label: 'Started', type: 'time', nowrap: true, text: function (x) { return HW.fdt(x.started || x.created); }, sort: function (x) { return x.started || x.created; } },
            { key: 'probe_name', label: 'Site', html: function (x) { return '<b>' + esc(x.probe_name) + '</b>'; } },
            { key: 'location', label: 'Location' },
            { key: 'host', label: 'Target', html: function (x) { return '<span class="mono small">' + esc(x.host) + '</span>'; } },
            { key: 'mode', label: 'Mode', text: modeName },
            { key: 'trig', label: 'Trigger', facet: function (x) { return (TRIG[x.trig] || [x.trig])[0]; }, text: function (x) { return (TRIG[x.trig] || [x.trig])[0] + (x.reason ? ' ' + x.reason : ''); }, html: function (x) { return trigPill(x) + (x.reason ? ' <span class="xs muted">' + esc(x.reason) + '</span>' : ''); } },
            { key: 'status', label: 'Status', html: function (x) { return x.status === 'running' || x.status === 'queued' ? HW.mtrProgress(x, 1) : statusPill(x); } },
            { key: 'dst_loss', label: 'Loss at target', type: 'num', val: function (x) { return x.dst_loss; }, minw: 140, text: function (x) { return x.dst_loss == null ? '' : x.dst_loss + '%'; }, sort: function (x) { return x.dst_loss == null ? -1 : x.dst_loss; }, html: function (x) { return lossCell(x.dst_loss); } },
            { key: 'hops', label: 'Hops', type: 'num', align: 'r', val: function (x) { return x.hops; }, sort: function (x) { return x.hops || 0; } }];
          if (tbl) tbl.render(r.runs); else tbl = HW.table($('rL'), { id: 'hub-mtr', rows: r.runs, columns: cols, filterRow: true, empty: 'No runs in this window.',
            searchText: function (x) { return x.id + ' ' + (x.error || ''); },
            onRow: function (x) { location.hash = '#/run?probe=' + x.probe + '&id=' + x.id; } });
        }).catch(fail);
      }
      load(); S.timers.push(setInterval(load, 10000));
    })();
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
        var place = function (x) { return String(x.location || '').split(' · ')[0]; };
        if (!others) { others = []; api('/api/mtr?limit=500&from=' + Math.floor(t - 1800) + '&to=' + Math.ceil(t + 1800)).then(function (x) {
          // the same IP from the other sites first, then the other IPs of the same location (any site)
          others = x.runs.filter(function (o) { return !(o.probe === r.probe && o.id === r.id) && o.status === 'done' && (o.host === r.host || place(o) === place(r)); })
            .sort(function (a, b) { return (a.host === r.host ? 0 : 1) - (b.host === r.host ? 0 : 1) || Math.abs((a.started || a.created) - t) - Math.abs((b.started || b.created) - t); }); draw(); }); }
        var cmpHubs = cmp && cmp.result ? cmp.result.report.hubs : null;
        $('main').innerHTML = '<div class="kpis">' + kpi('server', 'Site', esc(r.probe_name), '') + kpi('info', 'Status', statusPill(r), r.error ? esc(r.error) : '') +
          kpi('alert', 'Loss at target', r.dst_loss == null ? '–' : HW.fnum(r.dst_loss) + '%', (hubs.length || '') + ' hops') + kpi('clock', 'Trigger', trigPill(r), esc(r.reason || '')) + '</div>' +
          (r.status === 'running' || r.status === 'queued' ? '<div class="card"><div class="bd"><b>' + (r.status === 'queued' ? 'Waiting for a free slot on ' + esc(r.probe_name) + '…' : 'Tracing from ' + esc(r.probe_name) + '…') + '</b><div class="mt8">' + HW.mtrProgress(r, 1) + '</div></div></div>' : '') +
          (v ? '<div class="banner ' + (v.level === 'ok' ? 'info' : v.level) + '">' + I(v.level === 'ok' ? 'check' : 'alert') + esc(v.text) + '</div>' : '') +
          '<div class="card"><div class="hd"><h2>Compare with</h2><span class="sub">runs within 30 minutes: this IP from the other sites, then the other IPs of ' + esc(place(r)) + ' · pick one to put it next to this one</span></div><div class="bd">' +
          (others && others.length ? '<div class="row gap4">' + others.map(function (o, k) { return '<button class="btn-s' + (cmp && cmp.id === o.id && cmp.probe === o.probe ? ' btn-p' : '') + '" data-o="' + k + '">' + (o.host !== r.host ? '<span class="mono">' + esc(o.host) + '</span> · ' : '') + esc(o.probe_name) + ' · ' + esc((TRIG[o.trig] || [o.trig])[0]) + ' · ' + HW.fdt(o.started || o.created) + ' · ' + modeName(o) + ' · ' + (o.dst_loss == null ? '' : HW.fnum(o.dst_loss) + '% loss') + '</button>'; }).join('') + '</div>'
            : '<div class="small muted">' + (others ? 'None. Use <b>MTR from all sites</b> to get one from every site at the same moment.' : 'Looking…') + '</div>') + '</div></div>' +
          (hubs.length ? '<div class="card"><div class="hd"><h2>Hops</h2><span class="grow"></span><button class="btn-s btn-p" id="copy">' + I('copy') + 'Copy for support</button><a class="btn btn-s" href="/api/run/file?probe=' + encodeURIComponent(pid) + '&id=' + id + '">' + I('download') + '.txt</a></div><div class="bd">' +
            (cmpHubs ? '<div class="cmp"><div><div class="small muted" style="margin-bottom:6px">' + esc(r.probe_name) + ' · ' + esc(r.host) + '</div>' + hopTable(hubs, cmpHubs) + '</div><div><div class="small muted" style="margin-bottom:6px">' + esc(cmp.probe_name) + ' · ' + esc(cmp.host) + ' · ' + HW.fdt(cmp.started) + '</div>' + hopTable(cmpHubs, hubs) + '</div></div>' : hopTable(hubs)) + '</div></div>' : '') +
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
      var tabs = [['probes', 'Probes'], ['sync', 'Probe settings'], ['correlate', 'Correlation'], ['security', 'Security']];
      if (!tabs.some(function (t) { return t[0] === tab; })) tab = tabs[0][0];
      $('main').innerHTML = '<div class="tabs" id="st">' + tabs.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div id="sb" class="col gap12"></div>';
      $('st').onclick = function (e) { var b = e.target.closest('button'); if (b) { HW.ls('hsTab', b.dataset.t); location.hash = '#/settings?tab=' + b.dataset.t; } };
      var save = function (c) { return api('/api/config', { method: 'PUT', body: c }).then(function (x) { HW.toast('Saved'); loadInfo().then(route); return x; }).catch(function (e) { HW.toast(e.message, true); }); };
      if (tab === 'probes') {
        $('sb').innerHTML = '<div class="card"><div class="hd"><h2>Probes</h2><span class="sub">the sites this hub reads</span><span class="grow"></span><button class="btn-s btn-p" id="pAdd">' + I('plus') + 'Add probe</button></div><div class="bd">' +
          (cfg.probes.length ? '<div class="tw"><table class="table"><thead><tr><th>On</th><th>Name</th><th>Address</th><th>Token</th><th>Now</th><th class="w0"></th></tr></thead><tbody>' + cfg.probes.map(function (p, i) { var x = lv[p.id];
            return '<tr><td class="w0"><label class="switch"><input type="checkbox" data-on="' + i + '"' + (p.enabled ? ' checked' : '') + (p.local ? ' disabled' : '') + '></label></td><td><b>' + esc(p.name) + '</b>' + (p.local ? ' <span class="pill info">this container</span>' : '') + '</td><td class="mono small">' + esc(p.url) + '</td><td>' + (p.token_set ? '<span class="pill ok">set</span>' : '<span class="pill bad">missing</span>') + '</td>' +
              '<td>' + (!p.enabled ? '<span class="faint">off</span>' : !x ? '<span class="faint">…</span>' : x.error && !x.targets ? '<span class="small bad">' + esc(x.error) + '</span>' : '<span class="pill ok">' + x.targets.length + ' targets</span> <span class="xs muted">v' + esc(x.version) + '</span>') + '</td>' +
              '<td class="w0"><button class="btn-xs btn-g btn-i" data-ed="' + i + '" title="Rename / edit">' + I('edit') + '</button>' + (p.local ? '' : '<button class="btn-xs btn-g btn-i" data-rm="' + i + '">' + I('trash') + '</button>') + '</td></tr>'; }).join('') + '</tbody></table></div>'
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
          '<div class="form"><div class="field"><label>Seen from</label><select id="cK"><option value="0"' + (!k.min_sites ? ' selected' : '') + '>All sites that answer (now ' + cfg.probes.filter(function (p) { return p.enabled; }).length + ')</option>' + (function () { var n = cfg.probes.filter(function (p) { return p.enabled; }).length, a = []; for (var i = 1; i < Math.max(n, 2); i++) a.push(i); if (k.min_sites && a.indexOf(k.min_sites) < 0) a.push(k.min_sites); return a; })().map(function (n) { return '<option value="' + n + '"' + (k.min_sites === n ? ' selected' : '') + '>at least ' + n + '</option>'; }).join('') + '</select><span class="hint">A problem this many sites see at the same moment is put on the target\u2019s side. Sites that don\u2019t answer are not counted.</span></div>' +
          '<div class="field"><label>Site link when (% of its targets)</label><input type="number" id="cS" min="1" max="100" value="' + k.site_share + '"><span class="hint">One site with loss on this share of its targets at once: its own uplink</span></div></div>' +
          HW.sw('cuL', k.use_loss, 'Packet loss', '') + '<div class="form"><div class="field"><label>Loss over (%)</label><input type="number" id="cL" value="' + k.loss + '"></div></div>' +
          HW.sw('cuJ', k.use_jitter, 'Jitter', '') + '<div class="form"><div class="field"><label>Jitter over (ms)</label><input type="number" id="cJ" value="' + k.jitter + '"></div></div>' +
          HW.sw('cuD', k.use_delay, 'Delay', 'compared with each site\u2019s own normal for that target') + '<div class="form"><div class="field"><label>Delay over normal + (ms)</label><input type="number" id="cD" value="' + k.delay + '"></div></div>' +
          '<div><button class="btn-p" id="cSave">' + I('check') + 'Save</button></div></div></div>' +
          '<div class="card"><div class="hd"><h2>Cross-site MTR</h2><span class="sub">something to compare when only one site sees a problem</span></div><div class="bd col gap12">' +
          HW.sw('xOn', cfg.cross.enabled, 'When a probe starts an automatic MTR, the other probes trace the same target too', 'A probe that has its own run to that target within 5 minutes (it saw the problem as well) is left alone') +
          '<div class="form"><div class="field"><label>Cooldown per target (min)</label><input type="number" id="xC" min="0" max="1440" value="' + cfg.cross.cooldown_min + '"></div>' +
          '<div class="field"><label>At most per hour</label><input type="number" id="xH" min="1" max="500" value="' + cfg.cross.max_per_hour + '"><span class="hint">requests across all targets</span></div></div>' +
          '<div><button class="btn-p" id="xSave">' + I('check') + 'Save</button></div><div id="xLog"></div></div></div>';
        $('xSave').onclick = function () { cfg.cross = { enabled: $('xOn').checked, cooldown_min: +$('xC').value, max_per_hour: +$('xH').value }; save(cfg); };
        api('/api/cross').then(function (x) {
          $('xLog').innerHTML = '<div class="small muted" style="margin-bottom:6px">Latest</div>' + (x.log.length ? '<div class="tw"><table class="table"><thead><tr><th>When</th><th>Target</th><th>Problem seen by</th><th>Other sites</th></tr></thead><tbody>' + x.log.map(function (e) {
            return '<tr><td class="small">' + HW.fdt(e.t) + '</td><td class="mono small">' + esc(e.host) + '</td><td>' + esc(e.from) + '</td><td class="small">' + (e.note ? '<span class="warn">' + esc(e.note) + '</span>' : e.results.map(function (r) { return '<b>' + esc(r[0]) + '</b>: ' + esc(r[1] || ''); }).join(' · ')) + '</td></tr>'; }).join('') + '</tbody></table></div>'
            : '<div class="small muted">Nothing yet since the hub started.</div>'); }).catch(function () { /* optional */ });
        $('cSave').onclick = function () { cfg.correlate = { min_sites: +$('cK').value, site_share: +$('cS').value, use_loss: $('cuL').checked, loss: +$('cL').value, use_jitter: $('cuJ').checked, jitter: +$('cJ').value, use_delay: $('cuD').checked, delay: +$('cD').value }; try { localStorage.removeItem('hw_hth2'); } catch (e) { /* private mode */ } save(cfg); };
      }
      if (tab === 'sync') {
        $('sb').innerHTML = '<div class="card"><div class="hd"><h2>Same settings on every probe</h2><span class="sub">pick the probe that is right, see where the others differ, copy</span></div><div class="bd col gap12" id="syB"><div class="small muted">Reading the probes…</div></div></div>' +
          '<div class="card"><div class="hd"><h2>Backup</h2><span class="sub">hub settings and every probe\u2019s settings in one file, without passwords and tokens</span></div><div class="bd"><a class="btn btn-s" href="/api/backup">' + I('download') + 'Download backup</a></div></div>';
        var LBL = { 'ping.interval_ms': 'Ping every (ms)', 'ping.timeout_ms': 'Ping timeout (ms)', 'ping.size': 'Packet size (bytes)', 'alerts.window_s': 'Status window (s)', 'alerts.loss_warn': 'Warning at loss (%)',
          'alerts.loss_crit': 'Critical at loss (%)', 'alerts.rtt_warn_ms': 'Warning at latency (ms)', 'alerts.rtt_crit_ms': 'Critical at latency (ms)', 'auto_mtr.enabled': 'Automatic MTR on', 'auto_mtr.loss_pct': 'Start at loss (%)',
          'auto_mtr.window_s': 'Loss measured over (s)', 'auto_mtr.cooldown_min': 'Cooldown (min)', 'auto_mtr.per_location': 'One run per location', 'auto_mtr.max_per_hour': 'At most per hour', 'auto_mtr.mode': 'Mode',
          'auto_mtr.on_down': 'When a target is down', 'auto_mtr.on_latency': 'On high latency', 'auto_mtr.latency_ms': 'Latency over (ms)', 'auto_mtr.latency_rise_ms': 'Latency rise over (ms)', 'auto_mtr.on_recovery': 'Once more when fixed',
          'mtr.cycles': 'MTR cycles', 'mtr.interval_s': 'MTR interval (s)', 'mtr.resolve': 'Resolve names', 'mtr.asn': 'Show AS numbers', 'mtr.max_parallel': 'Runs at the same time', 'mtr.public_ip_url': 'Public IP from',
          'tcp_check.enabled': 'TCP port check', 'tcp_check.port': 'TCP port', 'tcp_check.every_h': 'Check every (h)', 'retention.raw_days': 'Per-second data (days)', 'retention.m1_days': '1-minute data (days)',
          'retention.m5_days': '5-minute data (days)', 'retention.mtr_days': 'MTR runs (days)', 'retention.mtr_max': 'MTR runs (at most)' };
        var SEC = [['targets', 'Targets and roles'], ['alerts', 'Ping and status'], ['auto', 'Automatic MTR'], ['schedules', 'Periodic MTR'], ['mtr', 'MTR and TCP'], ['retention', 'Retention']];
        var tsig = function (t) { return [t.name || '', t.location || '', t.role || '', t.enabled !== false].join('|'); };
        var show = function (v) { return v === true ? 'on' : v === false ? 'off' : v == null || v === '' ? '–' : String(v); };
        api('/api/probe-settings').then(function (d) {
          var ok = d.probes.filter(function (p) { return p.config; });
          var st = { src: (ok[0] || {}).id, secs: {}, to: {}, all: false };
          // rows of one part: every setting of its sections; lists (targets, roles, schedules) as one summary row each
          var rowsOf = function (sec) { var src = (ok.filter(function (p) { return p.id === st.src; })[0] || ok[0]).config, out = [];
            d.sections[sec].forEach(function (k) { var v = src[k];
              if (Array.isArray(v) || v == null) out.push({ label: { targets: 'Targets', roles: 'Roles', schedules: 'Schedules' }[k] || k, key: k, list: true });
              else Object.keys(v).forEach(function (s) { out.push({ label: LBL[k + '.' + s] || k + '.' + s, key: k, sub: s }); }); });
            return out; };
          var val = function (cfg, r) { var v = cfg[r.key]; return r.list ? v : v ? v[r.sub] : undefined; };
          var cellText = function (cfg, r, src) {
            var v = val(cfg, r);
            if (!r.list) return show(v);
            v = v || [];
            if (r.key === 'targets') { var a = {}, b = {}; (src[r.key] || []).forEach(function (t) { a[t.host] = tsig(t); }); v.forEach(function (t) { b[t.host] = tsig(t); });
              var add = Object.keys(a).filter(function (h) { return !(h in b); }).length, ext = Object.keys(b).filter(function (h) { return !(h in a); }).length, ch = Object.keys(b).filter(function (h) { return h in a && a[h] !== b[h]; }).length;
              return v.length + ' targets' + (add || ext || ch ? ' (' + [add ? add + ' missing' : '', ext ? ext + ' extra' : '', ch ? ch + ' different' : ''].filter(Boolean).join(', ') + ')' : ''); }
            if (r.key === 'roles') return v.map(function (x) { return x.name + (x.enabled === false ? ' (off)' : ''); }).join(', ') || '–';
            return v.length ? v.map(function (x) { return x.name + ' · ' + x.every_min + ' min · ' + (x.hosts || []).length + ' IPs' + (x.enabled ? '' : ' (off)'); }).join('; ') : 'none'; };
          var same = function (cfg, r, src) { return JSON.stringify(val(cfg, r)) === JSON.stringify(val(src, r)); };
          function draw() {
            var src = (ok.filter(function (p) { return p.id === st.src; })[0] || {}).config;
            if (!src) { $('syB').innerHTML = '<div class="small muted">No probe answers. ' + d.probes.map(function (p) { return esc(p.name) + ': ' + esc(p.error || ''); }).join(' · ') + '</div>'; return; }
            var others = ok.filter(function (p) { return p.id !== st.src; });
            var nd = function (sec, p) { return rowsOf(sec).filter(function (r) { return !same(p.config, r, src); }).length; };
            var html = '<div class="row gap12"><label class="row gap4 small"><b>Copy from</b><select id="syS">' + ok.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === st.src ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
              '<span class="grow"></span>' + HW.sw('syAll', st.all, 'Show settings that are the same too', '') + '</div>' +
              (d.probes.length > ok.length ? '<div class="banner warn">' + I('alert') + 'Not answering, left out: ' + esc(d.probes.filter(function (p) { return !p.config; }).map(function (p) { return p.name + ' (' + (p.error || '') + ')'; }).join(', ')) + '</div>' : '') +
              SEC.map(function (s) { var rows = rowsOf(s[0]), diff = others.reduce(function (a, p) { return a + nd(s[0], p); }, 0);
                var vis = rows.filter(function (r) { return st.all || others.some(function (p) { return !same(p.config, r, src); }); });
                return '<div class="sysec"><div class="row"><label class="row gap4"><input type="checkbox" data-sec="' + s[0] + '"' + (st.secs[s[0]] ? ' checked' : '') + '><b>' + s[1] + '</b></label>' +
                  '<span class="pill ' + (diff ? 'warn' : 'ok') + '">' + (diff ? diff + ' different' : 'the same everywhere') + '</span></div>' +
                  (vis.length ? '<div class="tw mt8"><table class="table"><thead><tr><th>Setting</th><th>' + esc((ok.filter(function (p) { return p.id === st.src; })[0] || {}).name) + ' <span class="xs muted">source</span></th>' + others.map(function (p) { return '<th>' + esc(p.name) + ' <span class="xs muted">v' + esc(p.version || '?') + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
                    vis.map(function (r) { return '<tr><td class="small">' + esc(r.label) + '</td><td class="small">' + esc(cellText(src, r, src)) + '</td>' + others.map(function (p) { var eq = same(p.config, r, src);
                      return '<td class="small' + (eq ? ' muted' : ' sydiff') + '">' + esc(cellText(p.config, r, src)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' : '') + '</div>'; }).join('') +
              '<div class="row gap12"><b class="small">Copy to</b>' + others.map(function (p) { return '<label class="row gap4 small"><input type="checkbox" data-to="' + esc(p.id) + '"' + (st.to[p.id] !== false ? ' checked' : '') + '>' + esc(p.name) + '</label>'; }).join('') +
              '<span class="grow"></span><button class="btn-p" id="syGo">' + I('check') + 'Copy</button></div>' +
              '<div class="xs muted">The site name, password, tokens and access settings stay as they are on each probe. Each probe checks what it gets; one that can\u2019t take it keeps its own settings and says why.</div>';
            $('syB').innerHTML = html;
            $('syS').onchange = function () { st.src = this.value; draw(); };
            $('syAll').onchange = function () { st.all = this.checked; draw(); };
            [].forEach.call($('syB').querySelectorAll('[data-sec]'), function (c) { c.onchange = function () { st.secs[c.dataset.sec] = c.checked; }; });
            [].forEach.call($('syB').querySelectorAll('[data-to]'), function (c) { c.onchange = function () { st.to[c.dataset.to] = c.checked; }; });
            $('syGo').onclick = function () {
              var secs = SEC.map(function (s) { return s[0]; }).filter(function (s) { return st.secs[s]; }), to = others.filter(function (p) { return st.to[p.id] !== false; });
              if (!secs.length) return HW.toast('Tick the parts to copy', true);
              if (!to.length) return HW.toast('Tick at least one probe to copy to', true);
              var srcName = (ok.filter(function (p) { return p.id === st.src; })[0] || {}).name;
              HW.modal('Copy settings', '<p>Copy <b>' + secs.map(function (s) { return SEC.filter(function (x) { return x[0] === s; })[0][1]; }).join(', ') + '</b> from <b>' + esc(srcName) + '</b> to <b>' + esc(to.map(function (p) { return p.name; }).join(', ')) + '</b>?</p>' +
                (secs.indexOf('targets') >= 0 ? '<p class="small warn">Targets: the list on those probes becomes the same as on ' + esc(srcName) + '. Their ping history of removed IPs stays until retention clears it.</p>' : '') +
                (secs.indexOf('schedules') >= 0 && secs.indexOf('targets') < 0 ? '<p class="small muted">Schedules name IPs; a probe without those IPs refuses them.</p>' : ''),
                '<button class="btn-g" id="cpX">Cancel</button><button class="btn-p" id="cpO">Copy</button>');
              $('cpX').onclick = HW.closeModal;
              $('cpO').onclick = function () { HW.closeModal();
                api('/api/probe-settings/apply', { method: 'POST', body: { source: st.src, to: to.map(function (p) { return p.id; }), sections: secs } }).then(function (r) {
                  var bad = r.results.filter(function (x) { return x.error; });
                  HW.toast(bad.length ? bad.map(function (x) { return x.name + ': ' + x.error; }).join(' · ') : 'Copied to ' + r.results.map(function (x) { return x.name; }).join(', '), !!bad.length);
                  api('/api/probe-settings').then(function (n) { d = n; ok = d.probes.filter(function (p) { return p.config; }); draw(); });
                }).catch(function (e) { HW.toast(e.message, true); }); };
            };
          }
          draw();
        }).catch(function (e) { $('syB').innerHTML = '<div class="small bad">' + esc(e.message) + '</div>'; });
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
    if (p.local) {      // the probe in this container: only its name can change here
      HW.modal('Rename probe', '<div class="field"><label>Name</label><input id="pn" value="' + esc(p.name) + '"><span class="hint">Shown in every table, chart and evidence pack of this hub. Empty = the probe’s own site name.</span></div>',
        '<button class="btn-g" id="px">Cancel</button><button class="btn-p" id="pok">Save</button>');
      $('px').onclick = HW.closeModal;
      $('pok').onclick = function () { cfg.probes[i] = Object.assign({}, p, { name: $('pn').value.trim() }); HW.closeModal(); save(cfg); };
      return;
    }
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
