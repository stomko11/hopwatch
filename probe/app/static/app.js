/* Hopwatch Probe web UI. Plain JavaScript, no build step. */
'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var S = { info: null, status: null, cfg: null, view: 'overview', timers: [], hidden: {} };
  var LS = function (k, v) { try { if (v === undefined) return localStorage.getItem('hw_' + k); localStorage.setItem('hw_' + k, v); } catch (e) { return null; } };
  var TZ = LS('tz') || 'local';
  var PAL = ['#4e9cf5', '#f5a524', '#2fbf71', '#e5484d', '#a970ff', '#16c1c8', '#ff7ab6', '#c3e14b', '#ff8a4c', '#7aa7ff',
    '#5fd3a0', '#ffd166', '#ef476f', '#9b8cff', '#3fd0ff', '#f78fb3', '#b0e57c', '#ffb26b', '#8fb4ff', '#e6e6e6'];

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function P2(n) { return (n < 10 ? '0' : '') + n; }
  function parts(ms) { var d = new Date(ms), u = TZ === 'utc';
    return { Y: u ? d.getUTCFullYear() : d.getFullYear(), M: (u ? d.getUTCMonth() : d.getMonth()) + 1, D: u ? d.getUTCDate() : d.getDate(),
      h: u ? d.getUTCHours() : d.getHours(), m: u ? d.getUTCMinutes() : d.getMinutes(), s: u ? d.getUTCSeconds() : d.getSeconds() }; }
  function fdt(sec) { if (!sec) return ''; var t = parts(sec * 1000); return t.D + '.' + t.M + '.' + t.Y + ' ' + P2(t.h) + ':' + P2(t.m) + ':' + P2(t.s) + (TZ === 'utc' ? ' UTC' : ''); }
  function ftime(sec) { var t = parts(sec * 1000); return P2(t.h) + ':' + P2(t.m) + ':' + P2(t.s); }
  function fnum(v, d) { return v == null ? '–' : (+v).toFixed(d == null ? 1 : d); }
  function fdur(s) { s = Math.max(0, Math.round(s)); return s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : s < 172800 ? (s / 3600).toFixed(1) + ' h' : Math.round(s / 86400) + ' d'; }
  function toast(msg, err) { var t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); clearTimeout(toast.tm); toast.tm = setTimeout(function () { t.className = 'toast hidden'; }, 3500); }

  function api(path, opt) {
    opt = opt || {};
    var o = { method: opt.method || 'GET', headers: { 'X-Hopwatch': '1' }, credentials: 'same-origin' };
    if (opt.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
    return fetch(path, o).then(function (r) {
      return r.text().then(function (txt) {
        var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = { error: txt }; }
        if (!r.ok) { var e = new Error((j && j.error) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function admin() { return S.info && S.info.auth.admin; }

  /* ------------------------------------------------------------ shell */
  function every(fn, ms) { fn(); S.timers.push(setInterval(fn, ms)); }
  function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }
  function loadInfo() {
    return api('/api/info').then(function (i) {
      S.info = i;
      $('site').textContent = i.site;
      document.title = 'Hopwatch Probe · ' + i.site;
      $('loginBtn').textContent = i.auth.admin ? 'Log out' : (i.auth.password_set ? 'Log in' : 'Set password');
      $('banner').className = i.error ? 'banner' : 'banner hidden';
      $('banner').textContent = i.error || '';
      return i;
    });
  }
  function route() {
    clearTimers(); closeMenu();
    var h = location.hash.replace(/^#\/?/, '').split('/');
    var v = h[0] || 'overview';
    S.view = v;
    [].forEach.call(document.querySelectorAll('#nav a'), function (a) { a.className = a.dataset.v === v ? 'on' : ''; });
    if (S.info && !S.info.auth.can_view) return loginBox(true);
    if (S.info && !S.info.auth.password_set && v === 'settings') return setupBox();
    ({ overview: viewOverview, charts: viewCharts, mtr: function () { h[1] ? viewMtrRun(+h[1]) : viewMtr(); },
      events: viewEvents, settings: viewSettings }[v] || viewOverview)();
  }
  function modal(html) { $('modalBox').innerHTML = html; $('modal').className = 'modal'; var f = $('modalBox').querySelector('input'); if (f) f.focus(); }
  function closeModal() { $('modal').className = 'modal hidden'; }
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

  function loginBox(required) {
    modal('<h2>Log in</h2>' + (required ? '<div class="muted small">This probe needs a login to view.</div>' : '') +
      '<label class="f">Password<input type="password" id="lpw" autocomplete="current-password"></label>' +
      '<div class="row"><span class="grow"></span>' + (required ? '' : '<button id="lcancel">Cancel</button>') + '<button class="pri" id="lgo">Log in</button></div>' +
      '<div class="muted small">Forgot it? Set the container variable HOPWATCH_RESET_PASSWORD to true and restart.</div>');
    var go = function () {
      api('/api/login', { method: 'POST', body: { password: $('lpw').value } }).then(function () { closeModal(); loadInfo().then(route); })
        .catch(function (e) { toast(e.message, true); });
    };
    $('lgo').onclick = go; $('lpw').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    if ($('lcancel')) $('lcancel').onclick = closeModal;
  }
  function setupBox() {
    $('main').innerHTML = '<section class="card"><h2>Welcome to Hopwatch Probe</h2>' +
      '<p>Set an admin password first. It protects the settings and starting MTR runs. Viewing stays open unless you change that in Settings → Security.</p>' +
      '<div class="form"><label class="f">New password<input type="password" id="np1" autocomplete="new-password"></label>' +
      '<label class="f">Repeat<input type="password" id="np2" autocomplete="new-password"></label></div>' +
      '<div class="row"><button class="pri" id="npgo">Set password</button></div></section>';
    $('npgo').onclick = function () {
      if ($('np1').value !== $('np2').value) return toast('The passwords differ', true);
      api('/api/password', { method: 'POST', body: { new: $('np1').value } }).then(function () { toast('Password set'); loadInfo().then(route); })
        .catch(function (e) { toast(e.message, true); });
    };
  }
  $('loginBtn').onclick = function () {
    if (admin()) api('/api/logout', { method: 'POST' }).then(function () { loadInfo().then(route); });
    else if (S.info && !S.info.auth.password_set) location.hash = '#/settings';
    else loginBox(false);
  };
  function tzUi() { [].forEach.call(document.querySelectorAll('#tzSeg button'), function (b) { b.className = b.dataset.tz === TZ ? 'on' : ''; }); }
  [].forEach.call(document.querySelectorAll('#tzSeg button'), function (b) { b.onclick = function () { TZ = b.dataset.tz; LS('tz', TZ); tzUi(); route(); }; });
  tzUi();

  /* ------------------------------------------------------------ MTR menu (tiles, rows) */
  var menuEl = null;
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  document.addEventListener('click', function (e) { if (menuEl && !menuEl.contains(e.target) && !e.target.closest('[data-mtr]')) closeMenu(); });
  function mtrMenu(btn, hosts, tcp) {
    closeMenu();
    var port = (S.status && S.status.tcp_port) || 443;
    var anyTcp = hosts.some(function (h) { var x = tcp[h]; return x && (x.state === 'open' || x.state === 'refused'); });
    var m = document.createElement('div'); m.className = 'menu';
    var items = [['icmp', 'MTR · ICMP']];
    if (hosts.length > 1) items.push(['tcp_if_open', 'MTR · TCP ' + port + ' where it answers, else ICMP']);
    else if (anyTcp) items.push(['tcp', 'MTR · TCP ' + port]);
    m.innerHTML = items.map(function (it) { return '<button data-m="' + it[0] + '">' + esc(it[1]) + (hosts.length > 1 ? ' (' + hosts.length + ' IPs)' : '') + '</button>'; }).join('');
    document.body.appendChild(m);
    var r = btn.getBoundingClientRect();
    m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + 'px'; m.style.top = (r.bottom + scrollY + 4) + 'px';
    m.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return; closeMenu();
      api('/api/mtr', { method: 'POST', body: { hosts: hosts, mode: b.dataset.m } }).then(function (r) {
        toast(r.ids.length === 1 ? 'MTR started' : r.ids.length + ' MTR runs started');
        if (r.ids.length === 1) location.hash = '#/mtr/' + r.ids[0];
      }).catch(function (e) { toast(e.message, true); });
    };
    menuEl = m;
  }
  function busyChip(st) {
    var b = $('busy'), n = st.mtr.running.length, q = st.mtr.queued.length;
    b.className = n || q ? 'chip' : 'chip hidden';
    b.innerHTML = 'MTR: ' + n + ' running' + (q ? ', ' + q + ' queued' : '');
    b.onclick = function () { location.hash = '#/mtr'; };
  }

  /* ------------------------------------------------------------ overview */
  var RANK = { down: 4, crit: 3, warn: 2, unknown: 1, ok: 0, disabled: -1 };
  function viewOverview() {
    $('main').innerHTML = '<section class="card"><h2>Targets <span id="sum" class="chip"></span><span class="muted small" id="win"></span></h2><div class="tiles" id="tiles"></div></section>';
    every(function () {
      api('/api/status').then(function (st) {
        S.status = st; busyChip(st);
        var tcp = {}; st.targets.forEach(function (t) { if (t.tcp) { tcp[t.host] = t.tcp; st.tcp_port = t.tcp.port; } });
        var locs = {}, order = [];
        st.targets.forEach(function (t) { if (!locs[t.location]) { locs[t.location] = []; order.push(t.location); } locs[t.location].push(t); });
        var bad = 0;
        var html = order.map(function (l) {
          var ts = locs[l], worst = ts.reduce(function (a, t) { return RANK[t.status] > RANK[a] ? t.status : a; }, 'disabled');
          if (RANK[worst] >= 2) bad++;
          var hosts = ts.filter(function (t) { return t.enabled; }).map(function (t) { return t.host; });
          return '<div class="loc ' + worst + '"><div class="lh"><b title="' + esc(l) + '">' + esc(l) + '</b><span class="grow"></span>' +
            '<a class="small" href="#/charts?loc=' + encodeURIComponent(l) + '">chart</a>' +
            (admin() && hosts.length ? ' <button class="small" data-mtr="' + esc(JSON.stringify(hosts)) + '">MTR</button>' : '') + '</div>' +
            '<table class="ips">' + ts.map(function (t) {
              var tc = t.tcp && (t.tcp.state === 'open' || t.tcp.state === 'refused') ? '<span class="chip small" title="TCP ' + t.tcp.port + ' ' + t.tcp.state + ' – TCP MTR possible">tcp</span>' : '';
              return '<tr><td class="ip"><span class="dot ' + t.status + '"></span>' + esc(t.host) + ' ' + tc + '</td>' +
                '<td class="n">' + (t.status === 'down' ? '<span class="down">down</span>' : fnum(t.avg) + ' ms') + '</td>' +
                '<td class="n ' + (t.loss > 0 ? (t.status === 'ok' ? 'warn' : t.status) : 'muted') + '">' + (t.loss == null ? '–' : fnum(t.loss, 0) + '%') + '</td>' +
                '<td class="n muted" title="jitter">±' + fnum(t.jitter) + '</td>' +
                (admin() && t.enabled ? '<td><button class="small" data-mtr="' + esc(JSON.stringify([t.host])) + '" title="MTR to ' + esc(t.host) + '">⋯</button></td>' : '<td></td>') + '</tr>';
            }).join('') + '</table></div>';
        }).join('');
        $('tiles').innerHTML = html || '<p class="muted">No targets yet. Add them in <a href="#/settings">Settings</a>.</p>';
        $('sum').textContent = st.targets.length + ' IPs · ' + (bad ? bad + ' locations with problems' : 'all OK');
        $('sum').className = 'chip ' + (bad ? 'warn' : 'ok');
        $('win').textContent = 'last ' + st.window_s + ' s · updated ' + ftime(st.now);
        [].forEach.call($('tiles').querySelectorAll('[data-mtr]'), function (b) {
          b.onclick = function (e) { e.stopPropagation(); mtrMenu(b, JSON.parse(b.dataset.mtr), tcp); };
        });
      }).catch(fail);
    }, 2000);
  }
  function fail(e) { if (e.status === 401) return loadInfo().then(route); $('banner').className = 'banner'; $('banner').textContent = 'Cannot reach the probe: ' + e.message; }

  /* ------------------------------------------------------------ charts */
  var RANGES = [['15m', 900], ['1h', 3600], ['6h', 21600], ['24h', 86400], ['7d', 604800], ['30d', 2592000], ['90d', 7776000], ['1y', 31536000]];
  var C = { range: +(LS('range') || 3600), zoom: null, loc: null };
  function viewCharts() {
    var qs = location.hash.split('?')[1] || ''; var m = /loc=([^&]+)/.exec(qs);
    C.loc = m ? decodeURIComponent(m[1]) : (C.loc || '');
    $('main').innerHTML = '<section class="card"><div class="row"><span class="seg" id="rg"></span>' +
      '<button id="unzoom" class="small hidden"></button><span class="grow"></span>' +
      '<label class="c small muted">Show <select id="locSel"><option value="">all locations</option></select></label></div>' +
      '<div class="muted small" id="chInfo"></div></section>' +
      ['rtt', 'loss', 'jit'].map(function (k) {
        return '<section class="card"><h2>' + { rtt: 'Latency <span class="muted small">avg RTT, ms</span>', loss: 'Packet loss <span class="muted small">%, ▲ = MTR run</span>', jit: 'Jitter <span class="muted small">ms</span>' }[k] +
          '</h2><canvas id="c_' + k + '"></canvas><div class="legend" id="l_' + k + '"></div></section>';
      }).join('');
    $('rg').innerHTML = RANGES.map(function (r) { return '<button data-r="' + r[1] + '">' + r[0] + '</button>'; }).join('');
    [].forEach.call($('rg').children, function (b) { b.onclick = function () { C.range = +b.dataset.r; LS('range', C.range); C.zoom = null; load(); }; });
    $('unzoom').onclick = function () { C.zoom = null; load(); };
    api('/api/status').then(function (st) {
      var seen = {}; st.targets.forEach(function (t) { if (!seen[t.location]) { seen[t.location] = 1; $('locSel').insertAdjacentHTML('beforeend', '<option>' + esc(t.location) + '</option>'); } });
      $('locSel').value = C.loc; });
    $('locSel').onchange = function () { C.loc = $('locSel').value; S.hidden = {}; load(); };
    var load = function () {
      [].forEach.call($('rg').children, function (b) { b.className = (!C.zoom && +b.dataset.r === C.range) ? 'on' : ''; });
      var now = Date.now() / 1000, t0 = C.zoom ? C.zoom[0] : now - C.range, t1 = C.zoom ? C.zoom[1] : now;
      $('unzoom').className = C.zoom ? 'small' : 'small hidden'; if (C.zoom) $('unzoom').textContent = fdt(t0) + ' – ' + fdt(t1) + '  ×';
      var w = Math.max(300, Math.min(1500, $('c_rtt').clientWidth || 800));
      var q = '/api/series?from=' + Math.floor(t0) + '&to=' + Math.ceil(t1) + '&points=' + Math.round(w / 2) +
        (C.loc ? '&location=' + encodeURIComponent(C.loc) + '&group=host' : '&group=location');
      Promise.all([api(q), api('/api/mtr?limit=500&from=' + Math.floor(t0) + '&to=' + Math.ceil(t1))]).then(function (r) {
        var d = r[0], runs = r[1].runs;
        $('chInfo').textContent = (C.loc ? C.loc + ' – per IP' : 'all locations – average of their IPs') + ' · resolution ' + fdur(d.step) +
          ' (' + { raw: 'every ping', m1: '1-minute', m5: '5-minute' }[d.tier] + ' data) · drag to zoom, double-click to go back';
        var mk = function (col) { return d.series.map(function (s) { return { name: s.name, t: s.points.map(function (p) { return p[0]; }), v: s.points.map(function (p) { return p[col]; }) }; }); };
        var opts = { t0: t0, t1: t1, onZoom: function (a, b) { C.zoom = [a, b]; load(); }, onReset: function () { if (C.zoom) { C.zoom = null; load(); } } };
        chart('c_rtt', 'l_rtt', mk(1), 'ms', opts);
        chart('c_loss', 'l_loss', mk(2), '%', Object.assign({ marks: runs, pct: true }, opts));
        chart('c_jit', 'l_jit', mk(3), 'ms', opts);
      }).catch(fail);
    };
    load();
    S.timers.push(setInterval(function () { if (!C.zoom) load(); }, 15000));
    window.onresize = function () { if (S.view === 'charts') load(); };
  }
  function color(name) { var k = 'c_' + name; if (!color[k]) color[k] = PAL[Object.keys(color).length % PAL.length]; return color[k]; }
  function chart(cid, lid, ser, unit, o) {
    var cv = $(cid); if (!cv) return;
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    var L = 46, R = 10, T = 10, B = 22, vis = ser.filter(function (s) { return !S.hidden[cid + s.name]; });
    var max = 0; vis.forEach(function (s) { s.v.forEach(function (v) { if (v != null && v > max) max = v; }); });
    max = o.pct ? Math.max(5, Math.min(100, Math.ceil(max / 5) * 5)) : (max ? max * 1.12 : 10);
    var X = function (t) { return L + (t - o.t0) / (o.t1 - o.t0) * (W - L - R); }, Y = function (v) { return T + (1 - v / max) * (H - T - B); };
    c.font = '11px system-ui'; c.lineWidth = 1;
    for (var i = 0; i <= 4; i++) { var v = max * i / 4, y = Y(v); c.strokeStyle = '#243040'; c.beginPath(); c.moveTo(L, y); c.lineTo(W - R, y); c.stroke(); c.fillStyle = '#8796a8'; c.fillText(v.toFixed(v < 10 ? 1 : 0), 4, y + 4); }
    var span = o.t1 - o.t0;
    for (var k = 0; k <= 5; k++) { var tt = o.t0 + span * k / 5, p = parts(tt * 1000); var lab = span > 172800 ? p.D + '.' + p.M + ' ' + P2(p.h) + ':' + P2(p.m) : P2(p.h) + ':' + P2(p.m); c.fillStyle = '#8796a8'; c.fillText(lab, Math.min(Math.max(X(tt) - 18, L), W - R - 60), H - 6); }
    vis.forEach(function (s) {
      c.strokeStyle = color(s.name); c.lineWidth = 1.5; c.beginPath(); var pen = false;
      s.v.forEach(function (v, i) { if (v == null) { pen = false; return; } var x = X(s.t[i]), y = Y(Math.min(v, max)); if (pen) c.lineTo(x, y); else { c.moveTo(x, y); pen = true; } });
      c.stroke();
    });
    (o.marks || []).forEach(function (m) { var x = X(m.started || m.created); if (x < L || x > W - R) return; c.fillStyle = m.trig === 'auto' ? '#f5a524' : '#4e9cf5';
      c.beginPath(); c.moveTo(x, T); c.lineTo(x - 5, T + 8); c.lineTo(x + 5, T + 8); c.fill(); });
    var lg = $(lid); lg.innerHTML = '';
    ser.forEach(function (s) {
      var b = document.createElement('button'); b.className = S.hidden[cid + s.name] ? 'off' : '';
      b.innerHTML = '<i style="background:' + color(s.name) + '"></i>' + esc(s.name);
      b.onclick = function (e) {
        if (e.detail >= 2) { var only = ser.every(function (x) { return x.name === s.name ? !S.hidden[cid + x.name] : S.hidden[cid + x.name]; });
          ser.forEach(function (x) { if (only) delete S.hidden[cid + x.name]; else S.hidden[cid + x.name] = x.name !== s.name; }); }
        else S.hidden[cid + s.name] = !S.hidden[cid + s.name];
        chart(cid, lid, ser, unit, o);
      };
      lg.appendChild(b);
    });
    var drag = null, tip = $('tip');
    cv.onmousedown = function (e) { var x = e.clientX - cv.getBoundingClientRect().left; if (x >= L) drag = x; };
    cv.onmouseup = function (e) {
      if (drag == null) return; var x = e.clientX - cv.getBoundingClientRect().left, a = Math.min(drag, x), b = Math.max(drag, x); drag = null;
      if (b - a < 6) {   // a click: open an MTR mark near the pointer
        var hit = (o.marks || []).filter(function (m) { return Math.abs(X(m.started || m.created) - x) < 6; })[0];
        if (hit) location.hash = '#/mtr/' + hit.id; return; }
      var f = function (px) { return o.t0 + (Math.max(L, Math.min(W - R, px)) - L) / (W - L - R) * span; };
      o.onZoom(f(a), Math.max(f(b), f(a) + 60));
    };
    cv.ondblclick = o.onReset;
    cv.onmouseleave = function () { tip.className = 'tip hidden'; drag = null; };
    cv.onmousemove = function (e) {
      var r = cv.getBoundingClientRect(), x = e.clientX - r.left; if (x < L || x > W - R) { tip.className = 'tip hidden'; return; }
      var t = o.t0 + (x - L) / (W - L - R) * span, rows = [], at = null;
      vis.forEach(function (s) { var bi = -1, bd = 1e18; for (var i = 0; i < s.t.length; i++) { var d = Math.abs(s.t[i] - t); if (d < bd) { bd = d; bi = i; } }
        if (bi >= 0 && s.v[bi] != null) { rows.push([s.name, s.v[bi]]); at = s.t[bi]; } });
      rows.sort(function (a, b) { return b[1] - a[1]; });
      var near = (o.marks || []).filter(function (m) { return Math.abs(X(m.started || m.created) - x) < 6; });
      tip.innerHTML = '<b>' + fdt(at || t) + '</b>' + rows.slice(0, 20).map(function (r) { return '<br><i class="dot" style="background:' + color(r[0]) + '"></i>' + esc(r[0]) + ': ' + fnum(r[1], o.pct ? 1 : 1) + ' ' + unit; }).join('') +
        (rows.length > 20 ? '<br><span class="muted">+' + (rows.length - 20) + ' more</span>' : '') +
        near.map(function (m) { return '<br>▲ MTR ' + esc(m.host) + ' (' + esc(m.trig) + ') – click to open'; }).join('');
      tip.className = 'tip'; tip.style.left = Math.min(e.clientX + 14, innerWidth - 300) + 'px'; tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px';
    };
  }

  /* ------------------------------------------------------------ MTR */
  function modeName(r) { return r.mode === 'tcp' ? 'TCP ' + r.port : r.mode.toUpperCase(); }
  function statusChip(r) {
    var cls = { done: 'ok', running: 'warn', queued: '', error: 'bad', cancelled: '' }[r.status];
    var txt = r.status;
    if (r.status === 'running' && r.started) txt += ' · ' + fdur(Date.now() / 1000 - r.started);
    return '<span class="chip ' + cls + '">' + esc(txt) + '</span>';
  }
  function viewMtr() {
    $('main').innerHTML = (admin() ? '<section class="card"><h2>Run MTR</h2><div class="row">' +
      '<label class="f">Target<select id="mHost"></select></label>' +
      '<label class="f">Mode<select id="mMode"><option value="icmp">ICMP</option><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>' +
      '<label class="f">TCP port<input type="number" id="mPort" min="1" max="65535"></label>' +
      '<label class="f">Cycles<input type="number" id="mCycles" min="5" max="1000"></label>' +
      '<button class="pri" id="mGo">Start</button></div><div class="muted small" id="mHint"></div></section>' : '') +
      '<section class="card"><h2>Runs <span class="muted small">newest first · ▲ automatic runs start when loss stays over the limit set in Settings</span></h2><div class="scroll" id="mList"></div></section>';
    if (admin()) {
      Promise.all([api('/api/status'), api('/api/config')]).then(function (r) {
        var st = r[0], cfg = r[1], locs = {};
        st.targets.forEach(function (t) { if (t.enabled) (locs[t.location] = locs[t.location] || []).push(t); });
        $('mHost').innerHTML = Object.keys(locs).map(function (l) {
          return '<optgroup label="' + esc(l) + '"><option value="loc:' + esc(l) + '">all IPs of ' + esc(l) + '</option>' +
            locs[l].map(function (t) { var tc = t.tcp && (t.tcp.state === 'open' || t.tcp.state === 'refused');
              return '<option value="' + esc(t.host) + '">' + esc(t.host) + (tc ? '  (TCP ' + t.tcp.port + ' answers)' : '') + '</option>'; }).join('') + '</optgroup>';
        }).join('');
        $('mPort').value = cfg.tcp_check.port; $('mCycles').value = cfg.mtr.cycles;
        $('mHint').textContent = 'A run takes about ' + fdur(cfg.mtr.cycles * cfg.mtr.interval_s + 5) + '. At most ' + cfg.mtr.max_parallel + ' run at once, the rest wait.';
        $('mGo').onclick = function () {
          var v = $('mHost').value, hosts = v.indexOf('loc:') === 0 ? locs[v.slice(4)].map(function (t) { return t.host; }) : [v];
          api('/api/mtr', { method: 'POST', body: { hosts: hosts, mode: $('mMode').value, port: +$('mPort').value, cycles: +$('mCycles').value } })
            .then(function (r) { toast(r.ids.length + ' run(s) started'); if (r.ids.length === 1) location.hash = '#/mtr/' + r.ids[0]; else refresh(); })
            .catch(function (e) { toast(e.message, true); });
        };
      });
    }
    var refresh = function () {
      api('/api/mtr?limit=300').then(function (r) {
        $('mList').innerHTML = r.runs.length ? '<table class="tbl"><thead><tr><th>Started</th><th>Location</th><th>Target</th><th>Mode</th><th>Trigger</th><th>Status</th><th class="n">Loss at target</th><th class="n">Hops</th></tr></thead><tbody>' +
          r.runs.map(function (x) {
            return '<tr class="click" data-id="' + x.id + '"><td>' + fdt(x.started || x.created) + '</td><td>' + esc(x.location) + '</td><td>' + esc(x.host) + '</td><td>' + modeName(x) + '</td>' +
              '<td>' + (x.trig === 'auto' ? '▲ auto <span class="muted small">' + esc(x.reason || '') + '</span>' : 'manual') + '</td><td>' + statusChip(x) + (x.error ? ' <span class="small bad">' + esc(x.error) + '</span>' : '') + '</td>' +
              '<td class="n ' + (x.dst_loss > 0 ? 'bad' : '') + '">' + (x.dst_loss == null ? '' : fnum(x.dst_loss) + '%') + '</td><td class="n">' + (x.hops || '') + '</td></tr>';
          }).join('') + '</tbody></table>' : '<p class="muted">No runs yet.</p>';
        [].forEach.call($('mList').querySelectorAll('tr.click'), function (tr) { tr.onclick = function () { location.hash = '#/mtr/' + tr.dataset.id; }; });
      }).catch(fail);
    };
    every(refresh, 4000);
  }
  function viewMtrRun(id) {
    $('main').innerHTML = '<section class="card" id="run"><p class="muted">Loading…</p></section>';
    var draw = function () {
      api('/api/mtr/' + id).then(function (r) {
        var hubs = (r.result && r.result.report && r.result.report.hubs) || [];
        var est = r.started ? Math.max(0, r.cycles - (Date.now() / 1000 - r.started)) : null;
        $('run').innerHTML = '<h2><a href="#/mtr">MTR</a> › ' + esc(r.host) + ' <span class="muted small">' + esc(r.location) + '</span> ' + statusChip(r) + '</h2>' +
          '<div class="row small muted">' + modeName(r) + ' · ' + r.cycles + ' cycles · ' + (r.trig === 'auto' ? '▲ automatic: ' + esc(r.reason || '') : 'manual') +
          ' · started ' + fdt(r.started || r.created) + (r.finished && r.status === 'done' ? ' · took ' + fdur(r.finished - r.started) : '') +
          (r.status === 'running' && est != null ? ' · about ' + fdur(est) + ' left' : '') + '</div>' +
          (r.error ? '<div class="banner">' + esc(r.error) + '</div>' : '') +
          '<div class="row">' + (r.report ? '<button class="pri" id="copy">Copy for support</button><a class="btn" href="/api/mtr/report/' + r.id + '">Download .txt</a>' : '') +
          (admin() && (r.status === 'running' || r.status === 'queued') ? '<button class="danger" id="cancel">Cancel</button>' : '') +
          (admin() && r.status !== 'running' && r.status !== 'queued' ? '<button id="again">Run again</button>' : '') + '</div>' +
          (hubs.length ? '<div class="scroll"><table class="tbl"><thead><tr><th>#</th><th>Host</th><th>AS</th><th class="n">Loss</th><th class="n">Sent</th><th class="n">Last</th><th class="n">Avg</th><th class="n">Best</th><th class="n">Worst</th><th class="n">StDev</th></tr></thead><tbody>' +
            hubs.map(function (h) { var l = h['Loss%'] || 0;
              return '<tr><td>' + h.count + '</td><td>' + esc(h.host) + '</td><td class="muted">' + esc(h.ASN || '') + '</td>' +
                '<td class="n ' + (l >= 50 ? 'bad' : l > 0 ? 'warn' : '') + '">' + fnum(l) + '%</td><td class="n">' + h.Snt + '</td><td class="n">' + fnum(h.Last) + '</td><td class="n">' + fnum(h.Avg) + '</td>' +
                '<td class="n">' + fnum(h.Best) + '</td><td class="n">' + fnum(h.Wrst) + '</td><td class="n">' + fnum(h.StDev) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
            '<div class="muted small">Loss on a middle hop that does not continue to later hops is usually that router limiting its ICMP answers, not real loss.</div>' : '') +
          (r.report ? '<h3>Text for support</h3><pre class="rep" id="rep"></pre>' : '');
        if (r.report) $('rep').textContent = r.report;
        if ($('copy')) $('copy').onclick = function () { copyText(r.report); };
        if ($('cancel')) $('cancel').onclick = function () { api('/api/mtr/cancel/' + r.id, { method: 'POST' }).then(draw); };
        if ($('again')) $('again').onclick = function () {
          api('/api/mtr', { method: 'POST', body: { hosts: [r.host], mode: r.mode, port: r.port, cycles: r.cycles } }).then(function (x) { location.hash = '#/mtr/' + x.ids[0]; });
        };
        if (r.status === 'running' || r.status === 'queued') { clearTimers(); S.timers.push(setTimeout(draw, 3000)); }
      }).catch(fail);
    };
    draw();
  }
  function copyText(t) {
    var done = function () { toast('Copied'); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(done, function () { fallback(); });
    fallback();
    function fallback() { var a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Select the text below and copy it', true); } a.remove(); }
  }

  /* ------------------------------------------------------------ events */
  function viewEvents() {
    $('main').innerHTML = '<section class="card"><h2>Events <span class="muted small">status changes and automatic MTR runs, newest first</span></h2><div class="scroll" id="ev"></div></section>';
    every(function () {
      api('/api/events?limit=500').then(function (r) {
        $('ev').innerHTML = r.events.length ? '<table class="tbl"><thead><tr><th>Time</th><th>Location</th><th>Target</th><th>What</th></tr></thead><tbody>' +
          r.events.map(function (e) {
            var what = e.kind === 'status' ? '<span class="dot ' + e.level + '"></span>' + esc(e.before) + ' → <b class="' + e.level + '">' + esc(e.level) + '</b>' +
              (e.loss != null ? ' <span class="muted">loss ' + fnum(e.loss, 0) + '%' + (e.avg != null ? ', ' + fnum(e.avg) + ' ms' : '') + '</span>' : '')
              : e.kind === 'auto_mtr' ? '▲ automatic MTR <a href="#/mtr/' + e.mtr_id + '">#' + e.mtr_id + '</a> <span class="muted">' + esc(e.reason || '') + '</span>' : esc(e.kind);
            return '<tr><td>' + fdt(e.t) + '</td><td>' + esc(e.location || '') + '</td><td>' + esc(e.host || '') + '</td><td>' + what + '</td></tr>';
          }).join('') + '</tbody></table>' : '<p class="muted">Nothing yet.</p>';
      }).catch(fail);
    }, 10000);
  }

  /* ------------------------------------------------------------ settings */
  var FIELDS = [
    ['General', [['site_name', 'Site name', 'text', 'Shown in the header and in MTR reports. Empty = container host name.']]],
    ['Ping', [['ping.interval_ms', 'Interval (ms)', 'number', 'One ping per target every …'], ['ping.timeout_ms', 'Timeout (ms)', 'number', 'No reply within this time = lost'],
      ['ping.size', 'Payload (bytes)', 'number', 'fping default is 56']]],
    ['Status and alerts', [['alerts.window_s', 'Window (s)', 'number', 'Loss and latency are judged over this many seconds'],
      ['alerts.loss_warn', 'Loss warning (%)', 'number', ''], ['alerts.loss_crit', 'Loss critical (%)', 'number', ''],
      ['alerts.rtt_warn_ms', 'Latency warning (ms)', 'number', '0 = off'], ['alerts.rtt_crit_ms', 'Latency critical (ms)', 'number', '0 = off']]],
    ['Automatic MTR', [['auto_mtr.enabled', 'Start MTR when loss is high', 'bool', ''], ['auto_mtr.loss_pct', 'Loss over (%)', 'number', ''],
      ['auto_mtr.window_s', 'For (s)', 'number', 'Loss is measured over this window'], ['auto_mtr.cooldown_min', 'Cooldown (min)', 'number', 'No new automatic run for the same target during this time'],
      ['auto_mtr.per_location', 'One run per location', 'bool', 'Cooldown per location instead of per IP'], ['auto_mtr.max_per_hour', 'At most per hour', 'number', 'For all targets together'],
      ['auto_mtr.mode', 'Mode', ['icmp:ICMP', 'tcp:TCP', 'tcp_if_open:TCP where the port answers, else ICMP'], '']]],
    ['MTR', [['mtr.cycles', 'Cycles', 'number', 'Pings per hop; support usually asks for 100'], ['mtr.interval_s', 'Interval (s)', 'number', ''],
      ['mtr.resolve', 'Show host names', 'bool', 'Reverse DNS for every hop'], ['mtr.asn', 'Show AS numbers', 'bool', ''],
      ['mtr.max_parallel', 'Runs at once', 'number', ''], ['mtr.public_ip_url', 'Public IP lookup URL', 'text', 'Put into reports. Empty = off']]],
    ['TCP port check', [['tcp_check.enabled', 'Check which targets answer on a TCP port', 'bool', 'Decides where TCP MTR is offered'],
      ['tcp_check.port', 'Port', 'number', ''], ['tcp_check.every_h', 'Every (hours)', 'number', '']]],
    ['Retention', [['retention.raw_days', 'Every ping (days)', 'number', ''], ['retention.m1_days', '1-minute data (days)', 'number', ''],
      ['retention.m5_days', '5-minute data (days)', 'number', ''], ['retention.mtr_days', 'MTR runs (days)', 'number', ''], ['retention.mtr_max', 'MTR runs (max count)', 'number', '']]],
  ];
  function getP(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setP(o, p, v) { var ks = p.split('.'), last = ks.pop(); ks.reduce(function (a, k) { return a[k] = a[k] || {}; }, o)[last] = v; }
  function viewSettings() {
    if (!admin()) { $('main').innerHTML = '<section class="card"><p>Log in to change the settings.</p><button class="pri" id="li">Log in</button></section>'; $('li').onclick = function () { loginBox(false); }; return; }
    api('/api/config').then(function (cfg) {
      S.cfg = cfg;
      var html = '<section class="card"><h2>Targets <span class="muted small">' + cfg.targets.length + ' · location name groups the IPs</span></h2>' +
        '<div class="scroll tlist"><table class="tbl" id="tt"><thead><tr><th>On</th><th>Location</th><th>IP or host name</th><th></th></tr></thead><tbody></tbody></table></div>' +
        '<div class="row"><button id="tAdd">+ Add target</button><button id="tBulk">Paste a list…</button><button id="tNd">Import from Netdata…</button></div></section>';
      FIELDS.forEach(function (sec) {
        html += '<section class="card"><h2>' + sec[0] + '</h2><div class="form">' + sec[1].map(function (f) {
          var v = getP(cfg, f[0]), id = 'f_' + f[0].replace('.', '_');
          if (f[2] === 'bool') return '<label class="c"><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + '> ' + esc(f[1]) + (f[3] ? ' <span class="muted small">' + esc(f[3]) + '</span>' : '') + '</label>';
          if (Array.isArray(f[2])) return '<label class="f">' + esc(f[1]) + '<select id="' + id + '">' + f[2].map(function (o) { var p = o.split(':'); return '<option value="' + p[0] + '"' + (p[0] === v ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select></label>';
          return '<label class="f">' + esc(f[1]) + '<input type="' + f[2] + '" id="' + id + '" value="' + esc(v) + '"' + (f[2] === 'number' ? ' step="any"' : '') + '>' + (f[3] ? '<span class="h">' + esc(f[3]) + '</span>' : '') + '</label>';
        }).join('') + '</div>' + (sec[0] === 'TCP port check' ? '<div class="row"><button id="tcpNow" class="small">Check now</button></div>' : '') + '</section>';
      });
      html += '<section class="card"><h2>Security</h2><div class="form">' +
        '<label class="c"><input type="checkbox" id="f_security_view_requires_login"' + (cfg.security.view_requires_login ? ' checked' : '') + '> Viewing needs a login too</label>' +
        '<label class="f">Allowed origins (CORS)<input id="f_security_cors_origins" value="' + esc(cfg.security.cors_origins) + '"><span class="h">Other pages that may read this probe, comma separated. * = any, empty = none</span></label></div>' +
        '<h3>Change password</h3><div class="form"><label class="f">Current<input type="password" id="pOld" autocomplete="current-password"></label>' +
        '<label class="f">New<input type="password" id="pNew" autocomplete="new-password"></label><div class="row"><button id="pGo">Change</button></div></div>' +
        '<h3>API tokens</h3><div class="muted small">For Hopwatch Hub or scripts: send as <code>Authorization: Bearer …</code>. A token can do everything an admin can.</div><div id="toks"></div>' +
        '<div class="row"><input id="tokName" placeholder="name, e.g. hub"><button id="tokNew">Create token</button></div></section>' +
        '<section class="card"><h2>History from Netdata</h2><div class="muted small">Copies the per-minute and 5-minute history of the targets above from a Netdata agent with the go.d ping collector. Existing data is kept.</div>' +
        '<div class="row"><input id="hUrl" placeholder="http://netdata-host:19999" size="32"><label class="c small">days <input type="number" id="hDays" value="365"></label><button id="hGo">Import history</button></div><div id="hSt" class="small muted"></div>' +
        '<h3>Storage</h3><div id="stor" class="small muted"></div></section>' +
        '<div class="row" style="position:sticky;bottom:0;background:var(--bg);padding:8px 0"><span class="grow"></span><span id="dirty" class="muted small"></span><button class="pri" id="save">Save settings</button></div>';
      $('main').innerHTML = html;
      var T = cfg.targets.map(function (t) { return Object.assign({}, t); });
      var drawT = function () {
        $('tt').tBodies[0].innerHTML = T.map(function (t, i) {
          return '<tr><td><input type="checkbox" data-i="' + i + '" data-k="enabled"' + (t.enabled ? ' checked' : '') + '></td>' +
            '<td><input data-i="' + i + '" data-k="location" value="' + esc(t.location) + '"></td>' +
            '<td><input data-i="' + i + '" data-k="host" value="' + esc(t.host) + '"></td>' +
            '<td><button class="small danger" data-del="' + i + '">✕</button></td></tr>';
        }).join('') || '<tr><td colspan="4" class="muted">No targets.</td></tr>';
        [].forEach.call($('tt').querySelectorAll('input'), function (inp) {
          inp.oninput = function () { T[+inp.dataset.i][inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value.trim(); dirty(); };
        });
        [].forEach.call($('tt').querySelectorAll('[data-del]'), function (b) { b.onclick = function () { T.splice(+b.dataset.del, 1); drawT(); dirty(); }; });
      };
      drawT();
      var dirty = function () { $('dirty').textContent = 'unsaved changes'; };
      [].forEach.call(document.querySelectorAll('[id^=f_]'), function (e) { e.addEventListener('input', dirty); e.addEventListener('change', dirty); });
      $('tAdd').onclick = function () { var last = T[T.length - 1]; T.push({ location: last ? last.location : '', host: '', enabled: true }); drawT(); dirty(); };
      $('tBulk').onclick = function () {
        modal('<h2>Paste targets</h2><div class="muted small">One per line: <code>Location, IP</code> or just <code>IP</code>. They are added to the list.</div><textarea id="bulk"></textarea>' +
          '<div class="row"><span class="grow"></span><button id="bc">Cancel</button><button class="pri" id="bo">Add</button></div>');
        $('bc').onclick = closeModal;
        $('bo').onclick = function () {
          $('bulk').value.split(/\n/).forEach(function (l) { l = l.trim(); if (!l) return; var p = l.split(/[,;\t]/).map(function (x) { return x.trim(); });
            var host = p.length > 1 ? p[1] : p[0], loc = p.length > 1 ? p[0] : p[0];
            if (!T.some(function (t) { return t.host === host; })) T.push({ location: loc, host: host, enabled: true }); });
          closeModal(); drawT(); dirty();
        };
      };
      $('tNd').onclick = function () {
        modal('<h2>Import targets from Netdata</h2><label class="f">Netdata address<input id="ndu" placeholder="http://netdata-host:19999"></label><div id="ndr" class="small muted"></div>' +
          '<div class="row"><span class="grow"></span><button id="ndc">Cancel</button><button id="ndl">Read</button><button class="pri hidden" id="ndo">Add these</button></div>');
        var found = [];
        $('ndc').onclick = closeModal;
        $('ndl').onclick = function () {
          $('ndr').textContent = 'Reading…';
          api('/api/import/targets', { method: 'POST', body: { url: $('ndu').value } }).then(function (r) {
            found = r.targets; var locs = {}; found.forEach(function (t) { locs[t.location] = 1; });
            $('ndr').textContent = 'Found ' + found.length + ' IPs in ' + Object.keys(locs).length + ' locations. Targets you already have are skipped.';
            $('ndo').className = found.length ? 'pri' : 'pri hidden';
          }).catch(function (e) { $('ndr').textContent = e.message; });
        };
        $('ndo').onclick = function () {
          found.forEach(function (f) { if (!T.some(function (t) { return t.host === f.host; })) T.push({ location: f.location, host: f.host, enabled: true }); });
          $('hUrl').value = $('ndu').value; closeModal(); drawT(); dirty();
        };
      };
      $('tcpNow').onclick = function () { api('/api/tcpcheck', { method: 'POST' }).then(function () { toast('Checking, results show on the Overview in a minute'); }); };
      $('save').onclick = function () {
        var c = JSON.parse(JSON.stringify(cfg)); c.targets = T.filter(function (t) { return t.host; });
        FIELDS.forEach(function (sec) { sec[1].forEach(function (f) { var e = $('f_' + f[0].replace('.', '_'));
          setP(c, f[0], f[2] === 'bool' ? e.checked : f[2] === 'number' ? +e.value : e.value); }); });
        c.security = { view_requires_login: $('f_security_view_requires_login').checked, cors_origins: $('f_security_cors_origins').value };
        api('/api/config', { method: 'PUT', body: c }).then(function () { toast('Saved'); loadInfo(); viewSettings(); }).catch(function (e) { toast(e.message, true); });
      };
      $('pGo').onclick = function () {
        api('/api/password', { method: 'POST', body: { old: $('pOld').value, new: $('pNew').value } }).then(function () { toast('Password changed'); $('pOld').value = $('pNew').value = ''; })
          .catch(function (e) { toast(e.message, true); });
      };
      var drawTok = function (list) {
        $('toks').innerHTML = list.length ? '<table class="tbl"><tbody>' + list.map(function (t) { return '<tr><td>' + esc(t.name) + '</td><td class="muted">created ' + fdt(t.created) + '</td><td><button class="small danger" data-tok="' + t.id + '">Delete</button></td></tr>'; }).join('') + '</tbody></table>' : '<p class="muted small">none</p>';
        [].forEach.call($('toks').querySelectorAll('[data-tok]'), function (b) { b.onclick = function () { if (confirm('Delete this token?')) api('/api/tokens/' + b.dataset.tok, { method: 'DELETE' }).then(function () { api('/api/config').then(function (c) { drawTok(c.security.tokens); }); }); }; });
      };
      drawTok(cfg.security.tokens);
      $('tokNew').onclick = function () {
        api('/api/tokens', { method: 'POST', body: { name: $('tokName').value || 'token' } }).then(function (r) {
          modal('<h2>New token</h2><div class="muted small">Copy it now, it is not shown again.</div><pre class="rep">' + esc(r.token) + '</pre><div class="row"><span class="grow"></span><button id="tc">Copy</button><button class="pri" id="tk">Done</button></div>');
          $('tc').onclick = function () { copyText(r.token); }; $('tk').onclick = closeModal;
          api('/api/config').then(function (c) { drawTok(c.security.tokens); });
        }).catch(function (e) { toast(e.message, true); });
      };
      var hPoll = function () {
        api('/api/import/history').then(function (j) {
          $('hSt').textContent = j.state === 'idle' ? '' : j.state === 'running' ? 'Importing… ' + j.done + ' of ' + (j.total || '?') + ' targets, ' + j.records + ' records' :
            j.state === 'done' ? 'Done: ' + j.records + ' records for ' + j.total + ' targets.' : 'Failed: ' + (j.error || '');
          if (j.state === 'running') setTimeout(hPoll, 2000);
        });
      };
      $('hGo').onclick = function () { api('/api/import/history', { method: 'POST', body: { url: $('hUrl').value, days: +$('hDays').value } }).then(hPoll).catch(function (e) { toast(e.message, true); }); };
      hPoll();
      api('/api/storage').then(function (s) { $('stor').textContent = 'Database ' + (s.bytes / 1048576).toFixed(1) + ' MB · ' + s.raw + ' minute rows · ' + s.mtr + ' MTR runs'; });
    }).catch(fail);
  }

  window.addEventListener('hashchange', route);
  loadInfo().then(route).catch(fail);
  setInterval(loadInfo, 30000);
})();
