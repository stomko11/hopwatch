/* Hopwatch UI kit (shared by Probe and Hub). Plain JavaScript, exposes window.HW. */
'use strict';
(function () {
  var HW = window.HW = {};
  var $ = HW.$ = function (id) { return document.getElementById(id); };
  var esc = HW.esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  HW.ls = function (k, v) { try { if (v === undefined) return localStorage.getItem('hw_' + k); localStorage.setItem('hw_' + k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) { return null; } };
  HW.lsj = function (k, d) { try { var v = localStorage.getItem('hw_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };

  /* ------------------------------------------------------------ icons (stroke, 24 grid) */
  var P = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    route: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h7a3 3 0 0 0 0-6H10a3 3 0 0 1 0-6h7"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    download: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    play: '<path d="m7 4 13 8-13 8z"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'
  };
  HW.icon = function (n, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>'; };

  /* ------------------------------------------------------------ theme + time */
  HW.theme = function (t) {
    if (t) HW.ls('theme', t);
    t = HW.ls('theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', t);
    return t;
  };
  HW.theme();
  HW.tz = HW.ls('tz') || 'local';
  function P2(n) { return (n < 10 ? '0' : '') + n; }
  HW.parts = function (ms) { var d = new Date(ms), u = HW.tz === 'utc';
    return { Y: u ? d.getUTCFullYear() : d.getFullYear(), M: (u ? d.getUTCMonth() : d.getMonth()) + 1, D: u ? d.getUTCDate() : d.getDate(),
      h: u ? d.getUTCHours() : d.getHours(), m: u ? d.getUTCMinutes() : d.getMinutes(), s: u ? d.getUTCSeconds() : d.getSeconds() }; };
  HW.fdt = function (sec, noSec) { if (!sec) return ''; var t = HW.parts(sec * 1000);
    return t.D + '.' + t.M + '.' + t.Y + ' ' + P2(t.h) + ':' + P2(t.m) + (noSec ? '' : ':' + P2(t.s)) + (HW.tz === 'utc' ? ' UTC' : ''); };
  HW.ftime = function (sec) { var t = HW.parts(sec * 1000); return P2(t.h) + ':' + P2(t.m) + ':' + P2(t.s); };
  HW.fago = function (sec) { var d = Date.now() / 1000 - sec; return d < 60 ? 'just now' : d < 3600 ? Math.round(d / 60) + ' min ago' : d < 86400 ? Math.round(d / 3600) + ' h ago' : Math.round(d / 86400) + ' d ago'; };
  HW.fdur = function (s) { s = Math.max(0, Math.round(s)); return s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : s < 172800 ? (s / 3600).toFixed(1).replace('.0', '') + ' h' : Math.round(s / 86400) + ' d'; };
  HW.fnum = function (v, d) { return v == null || isNaN(v) ? '–' : (+v).toFixed(d == null ? 1 : d); };
  HW.toInput = function (sec) { var t = HW.parts(sec * 1000); return t.Y + '-' + P2(t.M) + '-' + P2(t.D) + 'T' + P2(t.h) + ':' + P2(t.m); };
  HW.fromInput = function (v) { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ''); if (!m) return null;
    return (HW.tz === 'utc' ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]).getTime()) / 1000; };

  /* ------------------------------------------------------------ api, toast, modal, menu */
  HW.api = function (path, opt) {
    opt = opt || {};
    var o = { method: opt.method || 'GET', headers: { 'X-Hopwatch': '1' }, credentials: 'same-origin' };
    if (opt.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
    return fetch(path, o).then(function (r) {
      return r.text().then(function (txt) {
        var j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = { error: txt.slice(0, 200) }; }
        if (!r.ok) { var e = new Error((j && j.error) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  };
  HW.toast = function (msg, err) {
    var t = $('hwToast'); if (!t) { t = document.createElement('div'); t.id = 'hwToast'; document.body.appendChild(t); }
    t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; clearTimeout(HW.toast.tm);
    HW.toast.tm = setTimeout(function () { t.className = 'toast hidden'; }, err ? 6000 : 3200);
  };
  HW.modal = function (title, body, buttons) {
    HW.closeModal();
    var m = document.createElement('div'); m.className = 'modal'; m.id = 'hwModal';
    m.innerHTML = '<div class="box" role="dialog" aria-modal="true"><div class="hd"><h2>' + esc(title) + '</h2><span class="grow"></span>' +
      '<button class="btn-g btn-s btn-i" data-x>' + HW.icon('x') + '</button></div><div class="bd">' + body + '</div>' +
      (buttons ? '<div class="ft">' + buttons + '</div>' : '') + '</div>';
    document.body.appendChild(m);
    m.addEventListener('mousedown', function (e) { if (e.target === m) HW.closeModal(); });
    m.querySelector('[data-x]').onclick = HW.closeModal;
    var f = m.querySelector('input,textarea'); if (f) setTimeout(function () { f.focus(); }, 30);
    return m;
  };
  HW.closeModal = function () { var m = $('hwModal'); if (m) m.remove(); };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { HW.closeModal(); HW.closePops(); } });
  var pops = [];
  HW.closePops = function () { pops.splice(0).forEach(function (p) { try { p.close(); } catch (e) { /* gone */ } }); };
  HW.place = function (el, anchor, w) {
    var r = anchor.getBoundingClientRect(), ww = w || el.offsetWidth, h = el.offsetHeight;
    var left = Math.max(8, Math.min(r.left, innerWidth - ww - 8)), top = r.bottom + 6;
    if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    el.style.left = left + 'px'; el.style.top = Math.max(8, top) + 'px';
  };
  /* items: [{label, icon, onClick, danger, sep}] */
  HW.menu = function (anchor, items) {
    HW.closePops();
    var m = document.createElement('div'); m.className = 'menu';
    m.innerHTML = items.map(function (it, i) { return it.sep ? '<hr>' : '<button data-i="' + i + '"' + (it.danger ? ' class="btn-d"' : '') + '>' + (it.icon ? HW.icon(it.icon) : '') + esc(it.label) + '</button>'; }).join('');
    document.body.appendChild(m); HW.place(m, anchor);
    var close = function () { m.remove(); document.removeEventListener('mousedown', out, true); };
    var out = function (e) { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
    setTimeout(function () { document.addEventListener('mousedown', out, true); });
    m.onclick = function (e) { var b = e.target.closest('button'); if (!b) return; close(); items[+b.dataset.i].onClick(); };
    pops.push({ close: close });
  };
  HW.copy = function (t, what) {
    var done = function () { HW.toast((what || 'Text') + ' copied'); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(done, fb);
    fb();
    function fb() { var a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'; document.body.appendChild(a); a.select();
      try { document.execCommand('copy'); done(); } catch (e) { HW.toast('Copy did not work, select the text and copy it', true); } a.remove(); }
  };
  HW.download = function (url) { var a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };

  /* ------------------------------------------------------------ small settings popover (phones)
     o: {login: label, onLogin(), onChange()} – times, theme and login in one place */
  HW.prefs = function (anchor, o) {
    HW.closePops();
    var d = document.createElement('div'); d.className = 'drop prefs';
    d.innerHTML = '<div class="row"><span class="small muted">Times</span><span data-s="tz"></span></div>' +
      '<div class="row"><span class="small muted">Theme</span><span data-s="th"></span></div>' +
      (o.login ? '<button data-l>' + o.login + '</button>' : '');
    document.body.appendChild(d); HW.place(d, anchor, 260);
    var r = anchor.getBoundingClientRect(); d.style.left = Math.max(8, Math.min(innerWidth - 268, r.right - 260)) + 'px';
    var close = function () { d.remove(); document.removeEventListener('mousedown', out, true); };
    var out = function (e) { if (!d.contains(e.target) && !anchor.contains(e.target)) close(); };
    setTimeout(function () { document.addEventListener('mousedown', out, true); });
    HW.seg(d.querySelector('[data-s=tz]'), [['local', 'Local'], ['utc', 'UTC']], HW.tz, function (v) { HW.tz = v; HW.ls('tz', v); if (o.onChange) o.onChange(); });
    HW.seg(d.querySelector('[data-s=th]'), [['dark', 'Dark'], ['light', 'Light']], document.documentElement.getAttribute('data-theme'), function (v) { HW.theme(v); if (o.onChange) o.onChange(); });
    var l = d.querySelector('[data-l]'); if (l) l.onclick = function () { close(); o.onLogin(); };
    pops.push({ close: close });
  };

  /* ------------------------------------------------------------ segmented control + switch */
  HW.seg = function (el, items, value, onChange) {
    el.className = 'seg';
    el.innerHTML = items.map(function (it) { return '<button type="button" data-v="' + esc(it[0]) + '"' + (String(it[0]) === String(value) ? ' class="on"' : '') + (it[2] ? ' title="' + esc(it[2]) + '"' : '') + '>' + esc(it[1]) + '</button>'; }).join('');
    el.onclick = function (e) { var b = e.target.closest('button'); if (!b) return;
      [].forEach.call(el.children, function (x) { x.className = x === b ? 'on' : ''; }); onChange(b.dataset.v); };
    return { set: function (v) { [].forEach.call(el.children, function (x) { x.className = x.dataset.v === String(v) ? 'on' : ''; }); } };
  };
  HW.sw = function (id, checked, label, hint) {
    return '<label class="switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span class="t"><span>' + esc(label) + '</span>' + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</span></label>';
  };

  /* ------------------------------------------------------------ multiselect
     HW.ms(el, {options:[{value,label,group,hint}], value:[...], label:'Targets', placeholder:'All', single:false,
                allMeansAll:true, onChange:fn(values)})
     - type to filter (several words = all must match), arrow keys + Enter, Esc
     - All / None act on the filtered list, a group header selects its whole group, × clears */
  HW.ms = function (el, o) {
    var state = { options: o.options || [], value: (o.value || []).slice(), q: '' };
    el.classList.add('ms');
    var trig = document.createElement('button'); trig.type = 'button'; trig.className = 'trig'; el.innerHTML = ''; el.appendChild(trig);
    var pop = null, hl = -1;
    function lab(v) { var x = state.options.filter(function (op) { return op.value === v; })[0]; return x ? x.label : v; }
    function summary() {
      var n = state.value.length, all = state.options.length;
      var t = (o.label ? '<span class="lab">' + esc(o.label) + '</span>' : '');
      if (!n) t += '<span class="val muted">' + esc(o.placeholder || (o.single ? 'Choose…' : 'All')) + '</span>';
      else if (o.single || n === 1) t += '<span class="val">' + esc(lab(state.value[0])) + '</span>';
      else if (n === all && !o.single) t += '<span class="val">All <span class="chip">' + n + '</span></span>';
      else {
        var groups = {}; state.options.forEach(function (op) { if (op.group) (groups[op.group] = groups[op.group] || []).push(op.value); });
        var full = Object.keys(groups).filter(function (g) { return groups[g].every(function (v) { return state.value.indexOf(v) >= 0; }); });
        var txt = full.length && full.length <= 3 && full.reduce(function (a, g) { return a + groups[g].length; }, 0) === n ? full.join(', ') : lab(state.value[0]) + ', ' + lab(state.value[1] || '') ;
        t += '<span class="val">' + esc(txt.replace(/, $/, '')) + '</span><span class="chip">' + n + '</span>';
      }
      t += (n && !o.single && o.clear !== false ? '<span class="x" data-clear title="Clear">' + HW.icon('x') + '</span>' : '<span class="x">' + HW.icon('down') + '</span>');
      trig.innerHTML = t;
    }
    function filtered() {
      var words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      return state.options.filter(function (op) { var s = (op.label + ' ' + (op.group || '') + ' ' + op.value + ' ' + (op.hint || '')).toLowerCase();
        return words.every(function (w) { return s.indexOf(w) >= 0; }); });
    }
    function emit() { summary(); if (o.onChange) o.onChange(state.value.slice()); }
    function toggle(v) {
      if (o.single) { state.value = [v]; emit(); close(); return; }
      var i = state.value.indexOf(v); if (i >= 0) state.value.splice(i, 1); else state.value.push(v); emit(); render();
    }
    function render() {
      if (!pop) return;
      var list = filtered(), sel = {}, html = '', lastG = null, idx = 0;
      state.value.forEach(function (v) { sel[v] = 1; });
      var byG = {}; list.forEach(function (op) { if (op.group) (byG[op.group] = byG[op.group] || []).push(op); });
      pop._items = [];
      list.forEach(function (op) {
        if (op.group && op.group !== lastG) {
          lastG = op.group; var g = byG[op.group], on = g.filter(function (x) { return sel[x.value]; }).length;
          html += '<div class="grp" data-g="' + esc(op.group) + '">' + (o.single ? '' : '<span class="box' + (on === g.length ? ' on' : on ? ' part' : '') + '"></span>') + esc(op.group) + '<span class="grow"></span><span class="xs">' + g.length + '</span></div>';
        }
        pop._items.push(op.value);
        html += '<div class="opt' + (op.group ? ' in' : '') + (sel[op.value] ? ' on' : '') + (idx === hl ? ' hl' : '') + '" data-v="' + esc(op.value) + '" data-i="' + idx + '"><span class="box"></span><span class="ell">' + esc(op.label) + '</span>' + (op.hint ? '<span class="h">' + esc(op.hint) + '</span>' : '') + '</div>';
        idx++;
      });
      pop.querySelector('.list').innerHTML = html || '<div class="empty small">Nothing matches</div>';
      var c = pop.querySelector('.cnt'); if (c) c.textContent = state.value.length + ' of ' + state.options.length;
    }
    function open() {
      HW.closePops();
      pop = document.createElement('div'); pop.className = 'ms-pop' + (o.single ? ' single' : '');
      pop.innerHTML = '<div class="s"><div class="search">' + HW.icon('search') + '<input placeholder="Type to filter…" aria-label="Filter"></div></div>' +
        (o.single ? '' : '<div class="acts"><button class="btn-xs" data-a="all">All</button><button class="btn-xs" data-a="none">None</button><button class="btn-xs btn-g" data-a="inv">Invert</button><span class="cnt"></span></div>') +
        '<div class="list" role="listbox"></div>';
      document.body.appendChild(pop); el.classList.add('open');
      var r = trig.getBoundingClientRect(); pop.style.width = Math.max(r.width, 300) + 'px'; HW.place(pop, trig, Math.max(r.width, 300));
      var inp = pop.querySelector('input'); inp.value = state.q; setTimeout(function () { inp.focus(); });
      inp.oninput = function () { state.q = inp.value; hl = -1; render(); };
      inp.onkeydown = function (e) {
        var n = (pop._items || []).length;
        if (e.key === 'ArrowDown') { hl = Math.min(n - 1, hl + 1); render(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); render(); e.preventDefault(); }
        else if (e.key === 'Enter') { if (hl >= 0) toggle(pop._items[hl]); else if (n === 1) toggle(pop._items[0]); e.preventDefault(); }
      };
      pop.onmousedown = function (e) { if (e.target.tagName !== 'INPUT') e.preventDefault(); };
      pop.onclick = function (e) {
        var a = e.target.closest('[data-a]'), op = e.target.closest('.opt'), g = e.target.closest('.grp');
        var vis = filtered().map(function (x) { return x.value; });
        if (a) {
          if (a.dataset.a === 'all') vis.forEach(function (v) { if (state.value.indexOf(v) < 0) state.value.push(v); });
          if (a.dataset.a === 'none') state.value = state.value.filter(function (v) { return vis.indexOf(v) < 0; });
          if (a.dataset.a === 'inv') vis.forEach(function (v) { var i = state.value.indexOf(v); if (i >= 0) state.value.splice(i, 1); else state.value.push(v); });
          emit(); render();
        } else if (op) toggle(op.dataset.v);
        else if (g && !o.single) {
          var gv = filtered().filter(function (x) { return x.group === g.dataset.g; }).map(function (x) { return x.value; });
          var allOn = gv.every(function (v) { return state.value.indexOf(v) >= 0; });
          if (allOn) state.value = state.value.filter(function (v) { return gv.indexOf(v) < 0; });
          else gv.forEach(function (v) { if (state.value.indexOf(v) < 0) state.value.push(v); });
          emit(); render();
        }
      };
      setTimeout(function () { document.addEventListener('mousedown', outside, true); });
      pops.push({ close: close });
      render();
    }
    function outside(e) { if (pop && !pop.contains(e.target) && !el.contains(e.target)) close(); }
    function close() { if (!pop) return; pop.remove(); pop = null; el.classList.remove('open'); document.removeEventListener('mousedown', outside, true); }
    trig.onclick = function (e) {
      if (e.target.closest('[data-clear]')) { state.value = []; emit(); if (pop) render(); e.stopPropagation(); return; }
      if (pop) close(); else open();
    };
    summary();
    return {
      get: function () { return state.value.slice(); },
      set: function (v, silent) { state.value = (v || []).slice(); summary(); render(); if (!silent && o.onChange) o.onChange(state.value.slice()); },
      options: function (opts) { state.options = opts; var ok = {}; opts.forEach(function (x) { ok[x.value] = 1; });
        state.value = state.value.filter(function (v) { return ok[v]; }); summary(); render(); },
      close: close
    };
  };

  /* ------------------------------------------------------------ time range picker
     presets [[seconds,label]], value {range} or {from,to}; onChange({from,to,range}) */
  HW.rangePicker = function (el, presets, value, onChange) {
    el.className = 'range';
    el.innerHTML = '<span></span><button class="btn-s" data-c>' + HW.icon('clock') + '<span>Custom</span></button>';
    var sg = HW.seg(el.firstChild, presets.map(function (p) { return [p[0], p[1]]; }), value.range || '', function (v) { cur = { range: +v }; label(); onChange(get()); });
    var cur = value, cb = el.querySelector('[data-c]');
    function get() { if (cur.range) { var t1 = Date.now() / 1000; return { from: t1 - cur.range, to: t1, range: cur.range }; } return { from: cur.from, to: cur.to }; }
    function label() { sg.set(cur.range || ''); cb.lastChild.textContent = cur.range ? 'Custom' : HW.fdt(cur.from, 1) + ' – ' + HW.fdt(cur.to, 1); cb.className = 'btn-s' + (cur.range ? '' : ' btn-p'); }
    cb.onclick = function () {
      HW.closePops();
      var g = get(), d = document.createElement('div'); d.className = 'drop';
      d.innerHTML = '<div class="field"><label>From</label><input type="datetime-local" step="60"></div><div class="field"><label>To</label><input type="datetime-local" step="60"></div>' +
        '<div class="xs muted">Times are ' + (HW.tz === 'utc' ? 'UTC' : 'local') + '.</div><div class="row"><span class="grow"></span><button class="btn-s" data-n>Cancel</button><button class="btn-s btn-p" data-ok>Apply</button></div>';
      document.body.appendChild(d); HW.place(d, cb, 300);
      var ins = d.querySelectorAll('input'); ins[0].value = HW.toInput(g.from); ins[1].value = HW.toInput(g.to);
      var close = function () { d.remove(); document.removeEventListener('mousedown', out, true); };
      var out = function (e) { if (!d.contains(e.target) && !cb.contains(e.target)) close(); };
      setTimeout(function () { document.addEventListener('mousedown', out, true); });
      d.querySelector('[data-n]').onclick = close;
      d.querySelector('[data-ok]').onclick = function () {
        var a = HW.fromInput(ins[0].value), b = HW.fromInput(ins[1].value);
        if (a == null || b == null || b <= a) return HW.toast('Pick a From before To', true);
        cur = { from: a, to: Math.min(b, Date.now() / 1000) }; close(); label(); onChange(get());
      };
      pops.push({ close: close });
    };
    label();
    return { get: get, set: function (v) { cur = v; label(); } };
  };

  /* ------------------------------------------------------------ colours */
  var PAL = ['#7c93ff', '#f59e0b', '#34d399', '#f87171', '#a78bfa', '#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#60a5fa',
    '#2dd4bf', '#facc15', '#e879f9', '#818cf8', '#4ade80', '#fda4af', '#93c5fd', '#fdba74', '#c4b5fd', '#94a3b8'];
  var cmap = {};
  HW.color = function (name) { if (!cmap[name]) cmap[name] = PAL[Object.keys(cmap).length % PAL.length]; return cmap[name]; };
  HW.cssv = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };

  /* ------------------------------------------------------------ sparkline (SVG)
     vals: numbers or null (lost). Red ticks at the bottom mark loss. */
  HW.spark = function (vals, loss, color) {
    var w = 120, h = 26, n = vals.length; if (!n) return '<svg class="spark" viewBox="0 0 120 26"></svg>';
    var mx = 0, mn = 1e9; vals.forEach(function (v) { if (v != null) { if (v > mx) mx = v; if (v < mn) mn = v; } });
    if (mx === 0) mx = 1; if (mn === 1e9) mn = 0; var span = Math.max(mx - mn, mx * 0.15, 0.5);
    var X = function (i) { return n === 1 ? w : i / (n - 1) * w; }, Y = function (v) { return h - 5 - (v - mn) / span * (h - 9); };
    var d = '', pen = false, area = '';
    vals.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
    var ticks = '';
    (loss || []).forEach(function (l, i) { if (l > 0) ticks += '<rect x="' + (X(i) - 1).toFixed(1) + '" y="' + (h - Math.max(2, Math.min(6, l / 100 * 6 + 2))) + '" width="2" height="6" fill="var(--bad)"/>'; });
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + (color || 'var(--accent)') + '" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' + ticks + area + '</svg>';
  };

  /* ------------------------------------------------------------ line chart (canvas)
     HW.chart(el, series:[{name, t:[sec], v:[..], color, dash}], {t0, t1, unit, pct, height, marks:[{t, color, label, id}],
              onZoom(a,b), onReset(), onMark(mark), hidden:{}, stacked:false}) */
  HW.chart = function (el, series, o) {
    o.hidden = o.hidden || {};
    if (!el._cv) { el.classList.add('chart'); el.innerHTML = '<canvas></canvas><div class="legend"></div>'; el._cv = el.firstChild; }
    var cv = el._cv, lg = el.lastChild, H = o.height || 240;
    cv.style.height = H + 'px';
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth || el.clientWidth || 600;
    cv.width = W * dpr; cv.height = H * dpr;
    var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    var gridC = HW.cssv('--border'), txtC = HW.cssv('--muted');
    var L = 44, R = 12, T = 12, B = 24, vis = series.filter(function (s) { return !o.hidden[s.name]; });
    var max = 0; vis.forEach(function (s) { s.v.forEach(function (v) { if (v != null && v > max) max = v; }); });
    if (o.bars) { var tot = {}; vis.forEach(function (s) { s.v.forEach(function (v, i) { tot[s.t[i]] = (tot[s.t[i]] || 0) + (v || 0); if (tot[s.t[i]] > max) max = tot[s.t[i]]; }); }); }
    var nice = function (x) { var p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
    max = o.pct ? Math.max(5, Math.min(100, nice(max * 1.1 || 5))) : nice((max || 8) * 1.1);
    if (o.bars) max = Math.max(4, Math.ceil(max * 1.1 / 4) * 4);     // whole numbers on the axis for counts
    var X = function (t) { return L + (t - o.t0) / (o.t1 - o.t0) * (W - L - R); }, Y = function (v) { return T + (1 - Math.min(v, max) / max) * (H - T - B); };
    c.font = '11px ui-sans-serif,system-ui,sans-serif'; c.textBaseline = 'middle';
    for (var i = 0; i <= 4; i++) { var v = max * i / 4, y = Math.round(Y(v)) + .5; c.strokeStyle = gridC; c.lineWidth = 1; c.setLineDash(i ? [3, 4] : []);
      c.beginPath(); c.moveTo(L, y); c.lineTo(W - R, y); c.stroke(); c.fillStyle = txtC; c.textAlign = 'right'; c.fillText(v >= 100 ? v.toFixed(0) : +v.toFixed(2) + '', L - 8, y); }
    c.setLineDash([]); c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    var span = o.t1 - o.t0, nt = Math.max(2, Math.min(7, Math.floor((W - L - R) / 110)));
    for (var k = 0; k <= nt; k++) { var tt = o.t0 + span * k / nt, p = HW.parts(tt * 1000), P2f = function (n) { return (n < 10 ? '0' : '') + n; };
      var lab = span > 172800 ? p.D + '.' + p.M + '.' + (span > 86400 * 20 ? '' : ' ' + P2f(p.h) + ':' + P2f(p.m)) : P2f(p.h) + ':' + P2f(p.m);
      c.fillStyle = txtC; c.fillText(lab, Math.min(Math.max(X(tt), L + 18), W - R - 18), H - 6); }
    var single = vis.length === 1;
    if (o.bars) {      // counts per moment: stacked bars read better than lines
      var base = {};
      vis.forEach(function (s) {
        var col = s.color || HW.color(s.name), n = s.t.length, bw = Math.max(2, Math.min(14, (W - L - R) / Math.max(1, span / (o.step || (n > 1 ? s.t[1] - s.t[0] : 60))) * 0.8));
        c.fillStyle = col;
        s.v.forEach(function (v, i) { if (!v) return; var b0 = base[s.t[i]] || 0, x = X(s.t[i]), y1 = Y(b0 + v), y0 = Y(b0);
          c.fillRect(Math.round(x - bw / 2), y1, bw, y0 - y1); base[s.t[i]] = b0 + v; });
      });
    }
    if (!o.bars) vis.forEach(function (s) {
      var col = s.color || HW.color(s.name);
      c.strokeStyle = col; c.lineWidth = single ? 1.8 : 1.4; c.setLineDash(s.dash ? [5, 3] : []); c.lineJoin = 'round';
      c.beginPath(); var pen = false, segs = [], cur = null;
      s.v.forEach(function (v, i) { if (v == null) { pen = false; cur = null; return; } var x = X(s.t[i]), y = Y(v);
        if (pen) c.lineTo(x, y); else { c.moveTo(x, y); pen = true; cur = []; segs.push(cur); } cur.push([x, y]); });
      c.stroke();
      if (single && !s.dash) {   // soft area under a lone line
        var g = c.createLinearGradient(0, T, 0, H - B); g.addColorStop(0, col + '40'); g.addColorStop(1, col + '00'); c.fillStyle = g;
        segs.forEach(function (sg) { if (sg.length < 2) return; c.beginPath(); c.moveTo(sg[0][0], H - B); sg.forEach(function (p) { c.lineTo(p[0], p[1]); }); c.lineTo(sg[sg.length - 1][0], H - B); c.fill(); });
      }
    });
    c.setLineDash([]);
    (o.marks || []).forEach(function (m) { var x = X(m.t); if (x < L || x > W - R) return; c.fillStyle = m.color || HW.cssv('--accent');
      c.globalAlpha = .25; c.fillRect(Math.round(x), T, 1, H - T - B); c.globalAlpha = 1;
      c.beginPath(); c.moveTo(x, T + 1); c.lineTo(x - 5, T - 7 + 16); c.lineTo(x + 5, T - 7 + 16); c.closePath(); c.fill(); });
    /* legend */
    lg.innerHTML = '';
    if (series.length > 1 || o.legend) series.forEach(function (s) {
      var b = document.createElement('button'); b.className = o.hidden[s.name] ? 'off' : ''; b.type = 'button';
      b.innerHTML = '<i style="background:' + (s.color || HW.color(s.name)) + '"></i>' + esc(s.name);
      b.title = 'Click: hide / show · double-click: only this one';
      b.onclick = function (e) {
        if (e.detail >= 2) { var only = series.every(function (x) { return x.name === s.name ? !o.hidden[x.name] : o.hidden[x.name]; });
          series.forEach(function (x) { if (only) delete o.hidden[x.name]; else o.hidden[x.name] = x.name !== s.name; }); }
        else { clearTimeout(lg._t); lg._t = setTimeout(function () { o.hidden[s.name] = !o.hidden[s.name]; HW.chart(el, series, o); }, 230); return; }
        clearTimeout(lg._t); HW.chart(el, series, o);
      };
      lg.appendChild(b);
    });
    /* hover, zoom, marks */
    var tip = $('hwTip'); if (!tip) { tip = document.createElement('div'); tip.id = 'hwTip'; tip.className = 'tip hidden'; document.body.appendChild(tip); }
    var drag = null, sel = el.querySelector('.selbox');
    if (!sel) { sel = document.createElement('div'); sel.className = 'selbox'; sel.style.cssText = 'position:absolute;top:' + T + 'px;height:' + (H - T - B) + 'px;background:var(--accent-soft);border:1px solid var(--accent);display:none;pointer-events:none;border-radius:4px'; el.appendChild(sel); }
    var near = function (x) { return (o.marks || []).filter(function (m) { return Math.abs(X(m.t) - x) < 6; }); };
    cv.onmousedown = function (e) { var x = e.clientX - cv.getBoundingClientRect().left; if (x >= L && x <= W - R) { drag = x; e.preventDefault(); } };
    cv.onmouseup = function (e) {
      if (drag == null) return; var x = e.clientX - cv.getBoundingClientRect().left, a = Math.min(drag, x), b = Math.max(drag, x); drag = null; sel.style.display = 'none';
      if (b - a < 6) { var m = near(x)[0]; if (m && o.onMark) o.onMark(m); return; }
      var f = function (px) { return o.t0 + (Math.max(L, Math.min(W - R, px)) - L) / (W - L - R) * span; };
      if (o.onZoom) o.onZoom(f(a), Math.max(f(b), f(a) + 60));
    };
    cv.ondblclick = function () { if (o.onReset) o.onReset(); };
    cv.onmouseleave = function () { tip.className = 'tip hidden'; drag = null; sel.style.display = 'none'; };
    cv.onmousemove = function (e) {
      var r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      if (drag != null) { var a = Math.min(drag, x), b = Math.max(drag, x); sel.style.display = 'block'; sel.style.left = a + 'px'; sel.style.width = (b - a) + 'px'; tip.className = 'tip hidden'; return; }
      if (x < L || x > W - R || !vis.length) { tip.className = 'tip hidden'; return; }
      var t = o.t0 + (x - L) / (W - L - R) * span, rows = [], at = null;
      vis.forEach(function (s) { var bi = -1, bd = 1e18; for (var i = 0; i < s.t.length; i++) { var d = Math.abs(s.t[i] - t); if (d < bd) { bd = d; bi = i; } }
        if (bi >= 0 && s.v[bi] != null && bd < span / 40 + 120) { rows.push([s, s.v[bi]]); at = s.t[bi]; } });
      rows.sort(function (a, b) { return b[1] - a[1]; });
      var ms = near(x);
      tip.innerHTML = '<b>' + HW.fdt(at || t) + '</b>' + rows.slice(0, 16).map(function (r) {
        return '<div class="r"><i style="background:' + (r[0].color || HW.color(r[0].name)) + '"></i><span class="ell">' + esc(r[0].name) + '</span><span class="v">' + HW.fnum(r[1], o.pct || r[1] >= 100 ? 1 : 1) + ' ' + (o.unit || '') + '</span></div>'; }).join('') +
        (rows.length > 16 ? '<div class="muted">+' + (rows.length - 16) + ' more</div>' : '') + (!rows.length ? '<div class="muted">no data</div>' : '') +
        ms.map(function (m) { return '<div class="r" style="margin-top:4px"><i style="background:' + (m.color || 'var(--accent)') + '"></i>' + esc(m.label) + '</div>'; }).join('') +
        (ms.length ? '<div class="muted xs">click to open</div>' : '');
      tip.className = 'tip'; tip.style.left = Math.min(e.clientX + 14, innerWidth - 300) + 'px'; tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px';
    };
    return o;
  };

  /* ------------------------------------------------------------ MTR helpers (shared by Probe and Hub) */
  HW.hopIp = function (h) { var m = /\(([^)]+)\)$/.exec(h || ''); return m ? m[1] : h; };
  /* Where does loss start that continues to the destination? A hop that drops answers but later hops
     are fine is only rate limiting its own replies. */
  HW.mtrVerdict = function (hubs) {
    if (!hubs || !hubs.length) return null;
    var last = hubs[hubs.length - 1], dl = last['Loss%'] || 0, reached = last.host !== '???';
    if (!reached) return { level: 'bad', text: 'The target never answered. The last hop that answered is #' + ((hubs.filter(function (h) { return h.host !== '???'; }).pop() || {}).count || '?') + '.' };
    if (dl < 0.5) {
      var rl = hubs.filter(function (h) { return (h['Loss%'] || 0) > 0 && h !== last; });
      var worst = hubs.reduce(function (a, h) { return h.Avg > a.Avg ? h : a; }, hubs[0]);
      return { level: 'ok', text: 'No loss at the target' + (rl.length ? '; loss on hop ' + rl.map(function (h) { return '#' + h.count; }).join(', ') + ' does not continue, so it is only those routers limiting their replies' : '') + '. Highest average latency: ' + HW.fnum(worst.Avg) + ' ms at hop #' + worst.count + '.' };
    }
    var start = hubs.length - 1;
    for (var i = hubs.length - 1; i >= 0; i--) { if ((hubs[i]['Loss%'] || 0) >= dl * 0.5 || hubs[i].host === '???') start = i; else break; }
    var h = hubs[start];
    return { level: dl >= 20 ? 'bad' : 'warn', text: dl.toFixed(1) + '% loss at the target. It starts at hop #' + h.count + ' ' + h.host + (h.ASN && h.ASN !== 'AS???' ? ' (' + h.ASN + ')' : '') + ' and continues to the end, so the problem is at or after that hop.' };
  };
})();
