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
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
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
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'
  };
  HW.icon = function (n, cls) { return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || '') + '</svg>'; };

  /* ------------------------------------------------------------ theme + time */
  /* theme: 'auto' (follow the system), 'dark' or 'light'; returns the choice, the page gets the colours */
  var mq = matchMedia('(prefers-color-scheme: light)');
  HW.theme = function (t) {
    if (t) HW.ls('theme', t);
    var pick = HW.ls('theme') || 'auto';
    document.documentElement.setAttribute('data-theme', pick === 'auto' ? (mq.matches ? 'light' : 'dark') : pick);
    return pick;
  };
  HW.theme();
  if (mq.addEventListener) mq.addEventListener('change', function () { if ((HW.ls('theme') || 'auto') === 'auto') { HW.theme(); if (HW.onTheme) HW.onTheme(); } });
  HW.tz = HW.ls('tz') || 'utc';
  HW.TZ = [['utc', 'UTC'], ['local', 'Local']];
  HW.THEMES = [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']];
  /* theme as icons, in the same segmented style as UTC / Local: light, dark, follow the system */
  HW.themeSeg = function (el, onChange) {
    var it = [['light', HW.icon('sun'), 'Light', 1], ['dark', HW.icon('moon'), 'Dark', 1], ['auto', HW.icon('monitor'), 'Follow the system', 1]];
    var s = HW.seg(el, it, HW.ls('theme') || 'auto', function (v) { HW.theme(v); if (onChange) onChange(v); });
    el.classList.add('seg-i');
    return s;
  };
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
    var d = document.createElement('div'); d.className = 'drop prefs'; d.style.width = '290px';
    d.innerHTML = '<div class="row"><span class="small muted">Times</span><span data-s="tz"></span></div>' +
      '<div class="row"><span class="small muted">Theme</span><span data-s="th"></span></div>' +
      (o.login ? '<button data-l>' + o.login + '</button>' : '');
    document.body.appendChild(d); HW.place(d, anchor, 290);
    var r = anchor.getBoundingClientRect(); d.style.left = Math.max(8, Math.min(innerWidth - 298, r.right - 290)) + 'px';
    var close = function () { d.remove(); document.removeEventListener('mousedown', out, true); };
    var out = function (e) { if (!d.contains(e.target) && !anchor.contains(e.target)) close(); };
    setTimeout(function () { document.addEventListener('mousedown', out, true); });
    HW.seg(d.querySelector('[data-s=tz]'), HW.TZ, HW.tz, function (v) { HW.tz = v; HW.ls('tz', v); if (o.onChange) o.onChange(); });
    HW.themeSeg(d.querySelector('[data-s=th]'), function () { if (o.onChange) o.onChange(); });
    var l = d.querySelector('[data-l]'); if (l) l.onclick = function () { close(); o.onLogin(); };
    pops.push({ close: close });
  };

  /* ------------------------------------------------------------ segmented control + switch */
  HW.seg = function (el, items, value, onChange) {
    el.className = 'seg';
    el.innerHTML = items.map(function (it) { return '<button type="button" data-v="' + esc(it[0]) + '"' + (String(it[0]) === String(value) ? ' class="on"' : '') + (it[2] ? ' title="' + esc(it[2]) + '" aria-label="' + esc(it[2]) + '"' : '') + '>' + (it[3] ? it[1] : esc(it[1])) + '</button>'; }).join('');
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
  HW.rangePicker = function (el, presets, value, onChange, o) {
    o = o || {};
    el.className = 'range';
    el.innerHTML = '<span></span><button class="btn-s" data-c>' + HW.icon('clock') + '<span>Custom</span></button>';
    var sg = HW.seg(el.firstChild, presets.map(function (p) { return [p[0], p[1]]; }), value.range || '', function (v) { cur = { range: v === 'live' ? 'live' : +v }; label(); onChange(get()); });
    var cur = value, cb = el.querySelector('[data-c]');
    // 'live' = the last hour, kept moving; a number = the last N seconds; else a fixed window
    function get() { if (cur.range) { var t1 = Date.now() / 1000; return { from: t1 - (cur.range === 'live' ? (o.liveSpan || 3600) : cur.range), to: t1, range: cur.range }; } return { from: cur.from, to: cur.to }; }
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
  HW._groups = {};
  HW.chart = function (el, series, o) {
    o.hidden = o.hidden || {};
    if (!el._cv) { el.classList.add('chart'); el.innerHTML = '<canvas></canvas><div class="legend"></div>'; el._cv = el.firstChild; }
    var cv = el._cv, lg = el.querySelector('.legend'), H = o.height || 240;   // by name: helper layers are added after it
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
    if (o.peakLabels && !o.bars) {   // name each line at its highest point; skip labels that would overlap
      var placed = [];
      vis.map(function (s) { var bi = -1, bv = 0; s.v.forEach(function (v, i) { if (v != null && v > bv && s.t[i] >= o.t0 && s.t[i] <= o.t1) { bv = v; bi = i; } }); return [s, bi, bv]; })
        .filter(function (x) { return x[1] >= 0; }).sort(function (a, b) { return b[2] - a[2]; }).slice(0, 14).forEach(function (x) {
          var s = x[0], px = X(s.t[x[1]]), py = Y(x[2]), col = s.color || HW.color(s.name);
          c.font = '600 11px ui-sans-serif,system-ui,sans-serif';
          var lab = s.name + '  ' + HW.fnum(x[2], x[2] >= 10 ? 0 : 1) + (o.unit ? ' ' + o.unit : ''), w = c.measureText(lab).width + 10, h = 17;
          var bx = Math.min(Math.max(px + 6, L + 2), W - R - w), by = Math.max(T, Math.min(py - h - 3, H - B - h));
          if (placed.some(function (q) { return bx < q[0] + q[2] && bx + w > q[0] && by < q[1] + q[3] && by + h > q[1]; })) return;
          placed.push([bx, by, w, h]);
          c.fillStyle = HW.cssv('--surface'); c.globalAlpha = .92; c.fillRect(bx, by, w, h); c.globalAlpha = 1;
          c.strokeStyle = col; c.lineWidth = 1; c.strokeRect(bx + .5, by + .5, w - 1, h - 1);
          c.fillStyle = col; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(lab, bx + 5, by + h / 2 + .5);
          c.beginPath(); c.arc(px, py, 3, 0, 7); c.fill();
        });
      c.textBaseline = 'alphabetic';
    }
    if (o.emptyText && !vis.some(function (s) { return s.v.some(function (v) { return v; }); })) {
      c.fillStyle = HW.cssv('--muted'); c.font = '13px ui-sans-serif,system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(o.emptyText, L + (W - L - R) / 2, T + (H - T - B) / 2);
    }
    /* incident bands behind the lines would hide them, so they are drawn as a thin lane at the bottom */
    (o.bands || []).forEach(function (b) { var a = Math.max(L, X(b.t0)), z = Math.min(W - R, X(b.t1)); if (z < L || a > W - R) return;
      c.fillStyle = b.color || HW.cssv('--bad'); c.globalAlpha = .85; c.fillRect(a, H - B - 4, Math.max(2, z - a), 4); c.globalAlpha = 1; });
    (o.marks || []).forEach(function (m) { var x = X(m.t); if (x < L || x > W - R) return; c.fillStyle = m.color || HW.cssv('--accent');
      c.globalAlpha = .25; c.fillRect(Math.round(x), T, 1, H - T - B); c.globalAlpha = 1;
      c.beginPath(); c.moveTo(x, T + 1); c.lineTo(x - 5, T - 7 + 16); c.lineTo(x + 5, T - 7 + 16); c.closePath(); c.fill(); });
    if (o.pin && o.pin >= o.t0 && o.pin <= o.t1) {     // a pinned moment, the same on every chart of the page
      var px = Math.round(X(o.pin)) + .5; c.strokeStyle = HW.cssv('--accent'); c.lineWidth = 1.5; c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(px, T); c.lineTo(px, H - B); c.stroke(); c.setLineDash([]);
      c.fillStyle = HW.cssv('--accent'); c.beginPath(); c.arc(px, T + 2, 3.5, 0, 7); c.fill();
    }
    /* legend: hidden items are struck through, a bar says how many are shown and offers Show all */
    lg.innerHTML = '';
    if (series.length > 1 || o.legend) {
      var nh = series.filter(function (s) { return o.hidden[s.name]; }).length;
      if (nh) { var info = document.createElement('span'); info.className = 'lgstate';
        info.innerHTML = 'Showing ' + (series.length - nh) + ' of ' + series.length + ' <button type="button" class="btn-xs btn-p">Show all</button>';
        info.querySelector('button').onclick = function () { series.forEach(function (x) { delete o.hidden[x.name]; }); HW.chart(el, series, o); if (o.onFilter) o.onFilter(); };
        lg.appendChild(info); }
      series.forEach(function (s) {
        var b = document.createElement('button'); b.className = o.hidden[s.name] ? 'off' : ''; b.type = 'button';
        b.innerHTML = '<i style="background:' + (s.color || HW.color(s.name)) + '"></i>' + esc(s.name);
        b.title = 'Click: hide / show · double-click: only this one (again: all)';
        b.onclick = function (e) {
          clearTimeout(lg._t);
          if (e.detail >= 2) { var only = series.every(function (x) { return x.name === s.name ? !o.hidden[x.name] : o.hidden[x.name]; });
            series.forEach(function (x) { if (only) delete o.hidden[x.name]; else o.hidden[x.name] = x.name !== s.name; });
            HW.chart(el, series, o); if (o.onFilter) o.onFilter(); return; }
          lg._t = setTimeout(function () { if (o.hidden[s.name]) delete o.hidden[s.name]; else o.hidden[s.name] = true; HW.chart(el, series, o); if (o.onFilter) o.onFilter(); }, 240);
        };
        lg.appendChild(b);
      });
    }
    /* hover (synced crosshair across the charts of one group), zoom by dragging, click to pin */
    var tip = $('hwTip'); if (!tip) { tip = document.createElement('div'); tip.id = 'hwTip'; tip.className = 'tip hidden'; document.body.appendChild(tip); }
    var drag = null, sel = el.querySelector('.selbox'), xh = el.querySelector('.xhair');
    if (!sel) { sel = document.createElement('div'); sel.className = 'selbox'; sel.style.cssText = 'position:absolute;background:var(--accent-soft);border:1px solid var(--accent);display:none;pointer-events:none;border-radius:4px'; el.appendChild(sel); }
    if (!xh) { xh = document.createElement('div'); xh.className = 'xhair'; el.appendChild(xh); }
    sel.style.top = T + 'px'; sel.style.height = (H - T - B) + 'px'; xh.style.top = T + 'px'; xh.style.height = (H - T - B) + 'px';
    el._cross = function (t) { if (t == null || t < o.t0 || t > o.t1) { xh.style.display = 'none'; return; } xh.style.display = 'block'; xh.style.left = Math.round(X(t)) + 'px'; };
    var grp = o.group ? (HW._groups[o.group] = (HW._groups[o.group] || []).filter(function (x) { return document.body.contains(x) && x !== el; }).concat([el])) : [el];
    var sync = function (t) { grp.forEach(function (x) { if (x !== el && x._cross) x._cross(t); }); };
    var near = function (x) { return (o.marks || []).filter(function (m) { return Math.abs(X(m.t) - x) < 6; }); };
    var tAt = function (px) { return o.t0 + (Math.max(L, Math.min(W - R, px)) - L) / (W - L - R) * span; };
    cv.onmousedown = function (e) { var x = e.clientX - cv.getBoundingClientRect().left; if (x >= L && x <= W - R) { drag = x; e.preventDefault(); } };
    cv.onmouseup = function (e) {
      if (drag == null) return; var x = e.clientX - cv.getBoundingClientRect().left, a = Math.min(drag, x), b = Math.max(drag, x); drag = null; sel.style.display = 'none';
      if (b - a < 6) { var m = near(x)[0]; if (m && o.onMark) return o.onMark(m); if (o.onPin && e.detail < 2) { var tp = tAt(x); clearTimeout(cv._pt); cv._pt = setTimeout(function () { o.onPin(tp); }, 250); } return; }
      if (o.onZoom) o.onZoom(tAt(a), Math.max(tAt(b), tAt(a) + 60));
    };
    cv.ondblclick = function () { clearTimeout(cv._pt); if (o.onReset) o.onReset(); };
    cv.onmouseleave = function () { tip.className = 'tip hidden'; drag = null; sel.style.display = 'none'; xh.style.display = 'none'; sync(null); };
    cv.onmousemove = function (e) {
      var r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      if (drag != null) { var a = Math.min(drag, x), b = Math.max(drag, x); sel.style.display = 'block'; sel.style.left = a + 'px'; sel.style.width = (b - a) + 'px'; tip.className = 'tip hidden'; return; }
      if (x < L || x > W - R) { tip.className = 'tip hidden'; xh.style.display = 'none'; sync(null); return; }
      var t = tAt(x), rows = [], at = null;
      el._cross(t); sync(t);
      vis.forEach(function (s) { var bi = -1, bd = 1e18; for (var i = 0; i < s.t.length; i++) { var d = Math.abs(s.t[i] - t); if (d < bd) { bd = d; bi = i; } }
        if (bi >= 0 && s.v[bi] != null && bd < span / 40 + 120) { rows.push([s, s.v[bi]]); at = s.t[bi]; } });
      rows.sort(function (a, b) { return b[1] - a[1]; });
      if (o.tipHideZero) rows = rows.filter(function (r) { return r[1] > 0; });
      var ms = near(x), bs = (o.bands || []).filter(function (b) { return t >= b.t0 && t <= b.t1; });
      tip.innerHTML = '<b>' + HW.fdt(at || t) + '</b>' + rows.slice(0, 16).map(function (r) {
        return '<div class="r"><i style="background:' + (r[0].color || HW.color(r[0].name)) + '"></i><span class="ell">' + esc(r[0].name) + '</span><span class="v">' + HW.fnum(r[1], 1) + ' ' + (o.unit || '') + '</span></div>'; }).join('') +
        (rows.length > 16 ? '<div class="muted">+' + (rows.length - 16) + ' more</div>' : '') + (!rows.length ? '<div class="muted">' + (o.tipHideZero ? 'nothing over the limit' : 'no data') + '</div>' : '') +
        bs.slice(0, 4).map(function (b) { return '<div class="r" style="margin-top:4px"><i style="background:' + (b.color || 'var(--bad)') + '"></i>' + esc(b.label) + '</div>'; }).join('') +
        ms.map(function (m) { return '<div class="r" style="margin-top:4px"><i style="background:' + (m.color || 'var(--accent)') + '"></i>' + esc(m.label) + '</div>'; }).join('') +
        '<div class="muted xs" style="margin-top:4px">' + (ms.length ? 'click to open the MTR' : (o.onPin ? 'click to pin · ' : '') + 'drag to zoom') + '</div>';
      tip.className = 'tip'; tip.style.left = Math.min(e.clientX + 14, innerWidth - 300) + 'px'; tip.style.top = Math.min(e.clientY + 14, innerHeight - tip.offsetHeight - 8) + 'px';
    };
    return o;
  };

  /* a chart in a large dialog; same series and options, more room */
  HW.expandChart = function (title, series, o) {
    var m = HW.modal(title, '<div id="hwBig"></div>', '');
    m.classList.add('wide');
    var big = Object.assign({}, o, { height: Math.max(320, Math.round(innerHeight * 0.62)), group: null });
    setTimeout(function () { HW.chart($('hwBig'), series, big); }, 30);
  };

  /* ------------------------------------------------------------ column filter expressions
     HW.colFilter(expr, type) -> fn(text, value) or null when empty. A comma means "or".
       numbers ('num'):  5   =5   !=0   >5   >=5   <20   <=20   5..20   5-20
       times ('time'):   >14:00   <=15:30   14:00..15:30 (time of day)   >2026-11-18   18.11.2026
                         2026-11-18 14:00..2026-11-18 16:00   >-2h   >-30m   >-1d (relative to now)
       text (default):   abc (contains)   =abc (exactly)   !abc (does not contain)   !=abc   ^abc (starts)   abc$ (ends)
     Times use the UTC / local switch. Anything that doesn't parse as a number or time is matched as text. */
  HW.colFilter = function (expr, type) {
    var parts = String(expr || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) return null;
    var cmp = function (op, a, b) { return op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : op === '<=' ? a <= b : op === '!=' ? a !== b : a === b; };
    var utc = function () { return HW.tz === 'utc'; };
    var tod = function (sec) { var t = HW.parts(sec * 1000); return t.h * 60 + t.m + t.s / 60; };
    // "HH:MM" -> minutes of the day; a date (with or without time) -> [start, end] in epoch seconds; "-2h" -> epoch
    var ptime = function (s) {
      var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
      if (m) return { tod: +m[1] * 60 + +m[2] + (+m[3] || 0) / 60 };
      m = /^-(\d+(?:\.\d+)?)\s*(s|m|min|h|d)$/i.exec(s);
      if (m) return { abs: Date.now() / 1000 - +m[1] * { s: 1, m: 60, min: 60, h: 3600, d: 86400 }[m[2].toLowerCase()] };
      m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s) || /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
      if (!m) return null;
      var y = m[1].length === 4 ? +m[1] : +m[3], mo = +m[2] - 1, d = m[1].length === 4 ? +m[3] : +m[1], hasT = m[4] != null;
      var mk = function (h, mi) { return (utc() ? Date.UTC(y, mo, d, h, mi) : new Date(y, mo, d, h, mi).getTime()) / 1000; };
      return hasT ? { abs: mk(+m[4], +m[5]), end: mk(+m[4], +m[5]) + 60 } : { abs: mk(0, 0), end: mk(0, 0) + 86400 };
    };
    var one = function (p) {
      var lo = p.toLowerCase();
      if (type === 'num' || type === 'time') {
        var r = /^(.+?)\s*\.\.\s*(.+)$/.exec(p) || (type === 'num' ? /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/.exec(p) : null);
        var om = /^(>=|<=|!=|>|<|=)?\s*(.+)$/.exec(p), op = r ? null : om[1] || '=', v = r ? null : om[2];
        if (type === 'num') {
          if (r && !isNaN(parseFloat(r[1])) && !isNaN(parseFloat(r[2]))) { var a = parseFloat(r[1]), b = parseFloat(r[2]); return function (t, n) { return n != null && n >= Math.min(a, b) && n <= Math.max(a, b); }; }
          var x = parseFloat(v); if (!r && !isNaN(x) && /^-?\d+(\.\d+)?\s*%?$/.test(v)) return function (t, n) { return n != null && cmp(op, Math.round(n * 1000) / 1000, x); };
        } else {
          if (r) { var A = ptime(r[1].trim()), B = ptime(r[2].trim());
            if (A && B && A.tod != null && B.tod != null) return function (t, n) { if (n == null) return false; var q = tod(n); return A.tod <= B.tod ? q >= A.tod && q <= B.tod : q >= A.tod || q <= B.tod; };
            if (A && B && A.abs != null && B.abs != null) return function (t, n) { return n != null && n >= A.abs && n < (B.end || B.abs); }; }
          var P = v && ptime(v.trim());
          if (P && P.tod != null) return function (t, n) { return n != null && cmp(op, Math.floor(tod(n)), P.tod); };
          if (P && P.abs != null) return function (t, n) { if (n == null) return false;
            if (!P.end) return cmp(op, n, P.abs);                        // relative: -2h
            var inn = n >= P.abs && n < P.end;                            // a day or a minute
            return op === '=' ? inn : op === '!=' ? !inn : op === '>' ? n >= P.end : op === '>=' ? n >= P.abs : op === '<' ? n < P.abs : n < P.end; };
        }
      }
      if (lo.indexOf('!=') === 0) { var ne = lo.slice(2).trim(); return function (t) { return t.toLowerCase() !== ne; }; }
      if (lo[0] === '!') { var nc = lo.slice(1).trim(); return function (t) { return t.toLowerCase().indexOf(nc) < 0; }; }
      if (lo[0] === '=') { var eq = lo.slice(1).trim(); return function (t) { return t.toLowerCase() === eq; }; }
      if (lo[0] === '^') { var sw = lo.slice(1); return function (t) { return t.toLowerCase().indexOf(sw) === 0; }; }
      if (lo.length > 1 && lo[lo.length - 1] === '$') { var ew = lo.slice(0, -1); return function (t) { var s = t.toLowerCase(); return s.slice(s.length - ew.length) === ew; }; }
      return function (t) { return t.toLowerCase().indexOf(lo) >= 0; };
    };
    var fs = parts.map(one);
    return function (t, n) { return fs.some(function (f) { return f(t, n); }); };
  };
  HW.FILTER_HELP = { num: '>5  <=20  5..20  !=0', time: '>14:00  14:00..15:30  >2026-11-18  >-2h', text: 'contains  =exact  !not  ^starts' };

  /* ------------------------------------------------------------ data table
     HW.table(el, {id, rows, columns:[{key, label, html(row), text(row), sort(row), align:'r', hide:true}],
                   rowKey(row), onRow(row), select:{map}, rowClass(row)})
     - click a header to sort, Filters adds a text filter per column, Columns shows / hides / reorders
       (remembered per table); on narrow screens every row is a card so nothing hides off to the side
     - filterRow:true: a search box over everything plus a filter field under every header that
       understands HW.colFilter expressions; column type:'num' | 'time' (value from val(row) or sort(row)) */
  HW.table = function (el, o) {
    var key = 'tbl_' + o.id, st = HW.lsj(key, { order: null, hidden: null, sort: null, dir: 1 });
    var cols = o.columns, byKey = {}; cols.forEach(function (c) { byKey[c.key] = c; });
    if (!st.order || st.order.length !== cols.length || st.order.some(function (k) { return !byKey[k]; })) st.order = cols.map(function (c) { return c.key; });
    if (!st.hidden) st.hidden = cols.filter(function (c) { return c.hide; }).map(function (c) { return c.key; });
    el._tf = el._tf || {}; el._showF = el._showF || false; el._q = el._q || '';
    var FR = !!o.filterRow;
    var num = function (c, r) { var v = c.val ? c.val(r) : c.sort ? c.sort(r) : parseFloat(txt(c, r)); return v == null || v === '' || isNaN(v) ? null : +v; };
    var save = function () { HW.ls(key, st); };
    var txt = function (c, r) { return c.text ? String(c.text(r) == null ? '' : c.text(r)) : String(r[c.key] == null ? '' : r[c.key]); };
    function vis() { return st.order.map(function (k) { return byKey[k]; }).filter(function (c) { return st.hidden.indexOf(c.key) < 0; }); }
    function rows() {
      var list;
      if (FR) {
        var fl = Object.keys(el._tf).filter(function (k) { return byKey[k]; }).map(function (k) { var c = byKey[k]; return [c, HW.colFilter(el._tf[k], c.type)]; }).filter(function (x) { return x[1]; });
        var words = el._q.toLowerCase().split(/\s+/).filter(Boolean);
        list = o.rows.filter(function (r) {
          if (!fl.every(function (x) { return x[1](txt(x[0], r), x[0].type ? num(x[0], r) : null); })) return false;
          if (!words.length) return true;
          var all = cols.map(function (c) { return txt(c, r); }).join(' ').toLowerCase() + (o.searchText ? ' ' + String(o.searchText(r)).toLowerCase() : '');
          return words.every(function (w) { return all.indexOf(w) >= 0; }); });
      } else list = o.rows.filter(function (r) { return Object.keys(el._tf).every(function (k) { var f = (el._tf[k] || '').toLowerCase().trim(); return !f || !byKey[k] || txt(byKey[k], r).toLowerCase().indexOf(f) >= 0; }); });
      if (st.sort && byKey[st.sort]) { var c = byKey[st.sort], sv = c.sort || function (r) { var t = txt(c, r), n = parseFloat(t); return isNaN(n) || /[a-z]/i.test(t.replace(/ms|%/g, '')) ? t.toLowerCase() : n; };
        list = list.slice().sort(function (a, b) { var x = sv(a), y = sv(b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; }); }
      return list;
    }
    function render() {
      var V = vis(), L = rows(), narrow = el.clientWidth && el.clientWidth < 640 || innerWidth < 640, sel = o.select;
      var anyF = Object.keys(el._tf).some(function (k) { return el._tf[k]; });
      var bar = FR ? '<div class="row" style="margin-bottom:8px"><div class="search tsearch">' + HW.icon('search') + '<input data-q placeholder="Search everything" value="' + esc(el._q) + '"></div>' +
        '<span class="small muted">' + L.length + (L.length !== o.rows.length ? ' of ' + o.rows.length : '') + ' rows</span>' + (anyF || el._q ? '<button class="btn-xs btn-g" data-t="x">Clear</button>' : '') + '<span class="grow"></span>' +
        (narrow ? '<button class="btn-xs' + (el._showF || anyF ? ' btn-p' : '') + '" data-t="f">' + HW.icon('filter') + 'Column filters</button>' : '') + '<button class="btn-xs" data-t="c">' + HW.icon('layers') + 'Columns</button></div>'
        : '<div class="row" style="margin-bottom:8px"><span class="small muted">' + L.length + (L.length !== o.rows.length ? ' of ' + o.rows.length : '') + ' rows</span><span class="grow"></span>' +
        '<button class="btn-xs' + (el._showF || Object.keys(el._tf).some(function (k) { return el._tf[k]; }) ? ' btn-p' : '') + '" data-t="f">' + HW.icon('filter') + 'Filters</button><button class="btn-xs" data-t="c">' + HW.icon('layers') + 'Columns</button></div>';
      var ph = function (c) { return FR ? HW.FILTER_HELP[c.type || 'text'] : 'contains…'; };
      var tip = FR ? ' title="Comma = or. Numbers: >5 <=20 5..20 !=0 · Times: >14:00, 14:00..15:30, >2026-11-18, 18.11.2026, >-2h · Text: contains, =exact, !not, ^starts, ends$"' : '';
      var filt = el._showF && (!FR || narrow) ? '<div class="form" style="margin-bottom:8px">' + V.map(function (c) { return '<div class="field"><label>' + esc(c.label) + '</label><input data-f="' + c.key + '" value="' + esc(el._tf[c.key] || '') + '" placeholder="' + esc(ph(c)) + '"' + tip + '></div>'; }).join('') + '</div>' : '';
      var body;
      if (!L.length && !(FR && o.rows.length && !narrow)) body = '<div class="empty">' + (o.rows.length ? 'Nothing matches the search or the filters.' : (o.empty || 'Nothing here.')) + '</div>';
      else if (narrow) body = '<div class="tcards">' + L.map(function (r, i) {
        return '<div class="tcard' + (o.onRow ? ' click' : '') + (sel && sel[o.rowKey(r)] ? ' sel' : '') + '" data-i="' + i + '">' + (sel ? '<input type="checkbox" data-s="' + esc(o.rowKey(r)) + '"' + (sel[o.rowKey(r)] ? ' checked' : '') + '>' : '') +
          '<dl>' + V.map(function (c) { return '<dt>' + esc(c.label) + '</dt><dd>' + (c.html ? c.html(r) : esc(txt(c, r))) + '</dd>'; }).join('') + '</dl></div>'; }).join('') + '</div>';
      else body = '<div class="tw"><table class="table"><thead><tr>' + (sel ? '<th class="w0"><input type="checkbox" data-all></th>' : '') +
        V.map(function (c) { return '<th class="srt' + (c.align === 'r' ? ' r' : '') + '" data-k="' + c.key + '"' + (c.minw ? ' style="min-width:' + c.minw + 'px"' : '') + '>' + esc(c.label) + (st.sort === c.key ? (st.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr>' +
        (FR ? '<tr class="fr">' + (sel ? '<th class="w0"></th>' : '') + V.map(function (c) { return '<th><input data-f="' + c.key + '" value="' + esc(el._tf[c.key] || '') + '" placeholder="' + esc(ph(c)) + '"' + tip + ' class="' + (el._tf[c.key] ? 'on' : '') + '"></th>'; }).join('') + '</tr>' : '') + '</thead><tbody>' +
        L.map(function (r, i) { return '<tr data-i="' + i + '" class="' + (o.onRow ? 'click' : '') + (sel && sel[o.rowKey(r)] ? ' sel' : '') + (o.rowClass ? ' ' + o.rowClass(r) : '') + '">' + (sel ? '<td class="w0"><input type="checkbox" data-s="' + esc(o.rowKey(r)) + '"' + (sel[o.rowKey(r)] ? ' checked' : '') + '></td>' : '') +
          V.map(function (c) { return '<td' + (c.align === 'r' ? ' class="r"' : c.nowrap ? ' class="w0"' : '') + '>' + (c.html ? c.html(r) : esc(txt(c, r))) + '</td>'; }).join('') + '</tr>'; }).join('') + '' + (L.length ? '' : '<tr><td colspan="' + (V.length + (sel ? 1 : 0)) + '" class="empty">Nothing matches the search or the filters.</td></tr>') + '</tbody></table></div>';
      var ae = document.activeElement, fk = ae && el.contains(ae) && ae.dataset ? (ae.dataset.q != null ? '__q' : ae.dataset.f) : null, pos = fk ? ae.selectionStart : 0;
      var sx = el.querySelector('.tw') ? el.querySelector('.tw').scrollLeft : 0;
      el.innerHTML = bar + filt + body;
      if (fk) { var nf = el.querySelector(fk === '__q' ? '[data-q]' : '[data-f="' + fk + '"]'); if (nf) { nf.focus(); nf.setSelectionRange(pos, pos); } }   // live refresh keeps the filter you type in
      if (sx && el.querySelector('.tw')) el.querySelector('.tw').scrollLeft = sx;
      if (el.querySelector('[data-t=f]')) el.querySelector('[data-t=f]').onclick = function () { el._showF = !el._showF; render(); };
      if (el.querySelector('[data-t=x]')) el.querySelector('[data-t=x]').onclick = function () { el._tf = {}; el._q = ''; render(); };
      var qi = el.querySelector('[data-q]');
      if (qi) qi.oninput = function () { el._q = qi.value; var p = qi.selectionStart; render(); var n = el.querySelector('[data-q]'); if (n) { n.focus(); n.setSelectionRange(p, p); } };
      el.querySelector('[data-t=c]').onclick = function () { colMenu(this); };
      [].forEach.call(el.querySelectorAll('[data-f]'), function (i) { i.oninput = function () { el._tf[i.dataset.f] = i.value; var p = i.selectionStart, k = i.dataset.f; render(); var n = el.querySelector('[data-f="' + k + '"]'); if (n) { n.focus(); n.setSelectionRange(p, p); } }; });
      [].forEach.call(el.querySelectorAll('th.srt'), function (th) { th.onclick = function () { var k = th.dataset.k;
        if (st.sort !== k) { st.sort = k; st.dir = 1; } else if (st.dir > 0) st.dir = -1; else { st.sort = null; st.dir = 1; } save(); render(); }; });
      [].forEach.call(el.querySelectorAll('[data-i]'), function (row) { row.onclick = function (e) {
        var cb = e.target.closest('[data-s]');
        if (cb && sel) { if (cb.checked) sel[cb.dataset.s] = 1; else delete sel[cb.dataset.s]; render(); if (o.onSelect) o.onSelect(); return; }
        if (e.target.closest('a,button,input')) return;
        if (o.onRow) o.onRow(L[+row.dataset.i]); }; });
      var all = el.querySelector('[data-all]');
      if (all && sel) { all.checked = L.length && L.every(function (r) { return sel[o.rowKey(r)]; });
        all.onclick = function () { L.forEach(function (r) { if (all.checked) sel[o.rowKey(r)] = 1; else delete sel[o.rowKey(r)]; }); render(); if (o.onSelect) o.onSelect(); }; }
    }
    function colMenu(btn) {
      HW.closePops();
      var d = document.createElement('div'); d.className = 'drop'; d.style.width = '280px';
      var draw = function () {
        d.innerHTML = '<div class="small muted">Show, hide and order the columns</div>' + st.order.map(function (k, i) { var c = byKey[k];
          return '<div class="row wrapn"><label class="row wrapn gap4 grow" style="cursor:pointer"><input type="checkbox" data-h="' + k + '"' + (st.hidden.indexOf(k) < 0 ? ' checked' : '') + '>' + esc(c.label) + '</label>' +
            '<button class="btn-xs btn-g btn-i" data-up="' + i + '"' + (i ? '' : ' disabled') + ' title="Move up">▲</button><button class="btn-xs btn-g btn-i" data-dn="' + i + '"' + (i < st.order.length - 1 ? '' : ' disabled') + ' title="Move down">▼</button></div>'; }).join('') +
          '<div class="row"><button class="btn-xs" data-reset>Reset</button><span class="grow"></span><button class="btn-xs btn-p" data-ok>Done</button></div>';
        [].forEach.call(d.querySelectorAll('[data-h]'), function (c) { c.onchange = function () { var k = c.dataset.h;
          if (c.checked) st.hidden = st.hidden.filter(function (x) { return x !== k; }); else if (vis().length > 1) st.hidden.push(k); save(); render(); draw(); }; });
        [].forEach.call(d.querySelectorAll('[data-up],[data-dn]'), function (b) { b.onclick = function () { var i = +(b.dataset.up || b.dataset.dn), j = b.dataset.up != null ? i - 1 : i + 1;
          var t = st.order[i]; st.order[i] = st.order[j]; st.order[j] = t; save(); render(); draw(); }; });
        d.querySelector('[data-reset]').onclick = function () { st = { order: cols.map(function (c) { return c.key; }), hidden: cols.filter(function (c) { return c.hide; }).map(function (c) { return c.key; }), sort: null, dir: 1 }; save(); render(); draw(); };
        d.querySelector('[data-ok]').onclick = close;
      };
      document.body.appendChild(d); draw(); HW.place(d, btn, 280);
      var close = function () { d.remove(); document.removeEventListener('mousedown', out, true); };
      var out = function (e) { if (!d.contains(e.target) && !btn.contains(e.target)) close(); };
      setTimeout(function () { document.addEventListener('mousedown', out, true); });
      pops.push({ close: close });
    }
    render();
    if (!el._rs) { el._rs = 1; var w = innerWidth; window.addEventListener('resize', function () { if ((w < 640) !== (innerWidth < 640) && document.body.contains(el)) { w = innerWidth; render(); } }); }
    return { render: function (r) { if (r) o.rows = r; render(); } };
  };

  /* progress of a running MTR: elapsed against cycles x interval, as a small bar */
  HW.mtrProgress = function (r, interval) {
    if (r.status === 'queued') return '<span class="pill">waiting</span>';
    if (r.status !== 'running' || !r.started) return '';
    var est = (r.cycles || 100) * (interval || 1) + 5, el = Date.now() / 1000 - r.started, pc = Math.min(97, el / est * 100);
    return '<div class="col gap4" style="min-width:110px"><span class="xs muted">' + HW.fdur(el) + ' · about ' + HW.fdur(Math.max(0, est - el)) + ' left</span><div class="prog"><i style="width:' + pc + '%"></i></div></div>';
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
