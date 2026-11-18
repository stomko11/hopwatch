"""Hub HTTP API and web UI."""
import io
import json
import logging
import os
import time
import urllib.parse
import zipfile
from datetime import datetime, timezone

import httpbase
import hub
from config import VERSION

log = logging.getLogger("web")
HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
UI = httpbase.find_ui(HERE)


class App:
    def __init__(self, cfg, auth):
        self.cfg, self.auth = cfg, auth
        self.cache = hub.Cache()
        self.started = time.time()


class Handler(httpbase.Handler):
    server_version = "hopwatch-hub"
    version = VERSION
    static_dir = STATIC
    ui_dir = UI


def _list(q, k):
    return [x for x in (q.get(k) or "").split(",") if x]


def _f(q, k):
    return float(q[k]) if q.get(k) else None


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def probes(h, q=None, enabled=True):
    """Probes picked in ?probe=a,b (default: all enabled)."""
    ps = [p for p in h.app.cfg.probes() if p["enabled"] or not enabled]
    want = set(_list(q or {}, "probe"))
    return [p for p in ps if not want or p["id"] in want]


def by_id(h, pid):
    p = next((p for p in h.app.cfg.probes() if p["id"] == pid), None)
    if not p:
        raise KeyError("no such probe")
    return p


# -------------------------------------------------------------------- info + live status
def api_info(h, q, _):
    c = h.app.cfg.get()
    sec = c["security"]
    return {"product": "Hopwatch Hub", "version": VERSION, "site": c["name"], "now": time.time(),
            "probes": len(h.app.cfg.probes()),
            "auth": {"admin": h.is_admin(), "password_set": bool(sec["password_hash"]),
                     "view_requires_login": sec["view_requires_login"], "can_view": h.can_view()}}


def _live(h):
    def one(p):
        st = hub.call(p, "/api/status", timeout=6)
        info = hub.call(p, "/api/info", timeout=6)
        return {"site": info.get("site"), "version": info.get("version"), "error": st.get("error"),
                "targets": st["targets"], "mtr": st["mtr"], "window_s": st["window_s"], "now": st["now"]}
    ps = probes(h)
    res = h.app.cache.get("live", 2.5, lambda: hub.each(ps, one))
    return [{"id": p["id"], "name": p["name"], "url": p["url"], **res.get(p["id"], {"error": "no answer"})} for p in ps]


def api_live(h, q, _):
    return {"now": time.time(), "probes": _live(h), "correlate": h.app.cfg.get()["correlate"]}


# -------------------------------------------------------------------- series + correlation
def _series(h, q, group="host"):
    t1 = _f(q, "to") or time.time()
    t0 = _f(q, "from") or t1 - 3600
    if t1 <= t0:
        raise ValueError("'from' must be before 'to'")
    pts = int(q.get("points") or 300)
    qs = f"/api/series?from={int(t0)}&to={int(t1)}&points={pts}&group={group}"
    for k in ("host", "location"):
        if q.get(k):
            qs += f"&{k}=" + urllib.parse.quote(q[k])
    ps = probes(h, q)
    key = ("series", qs, tuple(p["id"] for p in ps))
    ttl = 15 if t1 > time.time() - 120 else 300
    return ps, t0, t1, h.app.cache.get(key, ttl, lambda: hub.each(ps, lambda p: hub.call(p, qs, timeout=60)))


def _th(q, c):
    k = c["correlate"]
    pick = lambda name: (float(q[name]) if q.get(name) not in (None, "", "off") else None) if name in q \
        else (k[name] if k["use_" + name] else None)
    return {"loss": pick("loss"), "jitter": pick("jitter"), "delay": pick("delay")}


def api_correlate(h, q, _):
    c = h.app.cfg.get()
    ps, t0, t1, res = _series(h, q, "host")
    names = {p["id"]: p["name"] for p in ps}
    data = {pid: d for pid, d in res.items() if "error" not in d}
    k = int(q.get("min_sites") or c["correlate"]["min_sites"])
    out = hub.correlate(data, names, _th(q, c), min(k, max(1, len(data))) if k > 0 else 1, c["correlate"]["site_share"] / 100)
    out.update({"from": t0, "to": t1, "probes": [{"id": p["id"], "name": p["name"]} for p in ps],
                "errors": {names[pid]: d["error"] for pid, d in res.items() if "error" in d},
                "min_sites": k, "thresholds": _th(q, c)})
    return out


def api_overview(h, q, _):
    """Everything the overview needs for a time range in one call:
    per site and moment: average loss over all targets, latency above each target's own normal, jitter;
    the moments several sites / one site saw a problem; and per location and site the range values."""
    c = h.app.cfg.get()
    ps, t0, t1, res = _series(h, q, "host")
    names = {p["id"]: p["name"] for p in ps}
    data = {pid: d for pid, d in res.items() if "error" not in d}
    k = c["correlate"]
    corr = hub.correlate(data, names, _th({}, c), min(k["min_sites"], max(1, len(data))), k["site_share"] / 100)
    step, grid, locs = hub.align(data)
    normal = {hst: {p: hub._median([v[0] for v in grid[hst].get(p, {}).values()]) for p in data} for hst in grid}
    lines = {}
    for p in data:
        acc = {}
        for hst, by in grid.items():
            base = normal[hst].get(p)
            for t, (avg, loss, jit) in by.get(p, {}).items():
                a = acc.setdefault(t, [0.0, 0, 0.0, 0, 0.0, 0])
                if loss is not None:
                    a[0] += loss
                    a[1] += 1
                if avg is not None and base is not None:
                    a[2] += max(0.0, avg - base)
                    a[3] += 1
                if jit is not None:
                    a[4] += jit
                    a[5] += 1
        ts = sorted(acc)
        lines[p] = {"t": ts, "loss": [round(acc[t][0] / acc[t][1], 2) if acc[t][1] else None for t in ts],
                    "excess": [round(acc[t][2] / acc[t][3], 2) if acc[t][3] else None for t in ts],
                    "jitter": [round(acc[t][4] / acc[t][5], 2) if acc[t][5] else None for t in ts]}
    verdict = {}
    for i in corr["incidents"]:
        v = verdict.setdefault(i["location"], {"target": set(), "one": set()})
        (v["target"] if i["kind"] == "target" else v["one"]).update(i["site_names"])
    rows = {}
    for hst, by in grid.items():
        loc = locs[hst]
        r = rows.setdefault(loc, {"location": loc, "hosts": [], "by": {}})
        r["hosts"].append(hst)
        for p, pts in by.items():
            b = r["by"].setdefault(p, {"avg": [], "loss": [], "jit": []})
            for avg, loss, jit in pts.values():
                if avg is not None:
                    b["avg"].append(avg)
                if loss is not None:
                    b["loss"].append(loss)
                if jit is not None:
                    b["jit"].append(jit)
    out_rows = []
    for loc, r in sorted(rows.items()):
        by = {}
        for p, b in r["by"].items():
            by[p] = {"avg": round(sum(b["avg"]) / len(b["avg"]), 2) if b["avg"] else None,
                     "loss": round(sum(b["loss"]) / len(b["loss"]), 2) if b["loss"] else None,
                     "max_loss": round(max(b["loss"]), 1) if b["loss"] else None,
                     "jitter": round(sum(b["jit"]) / len(b["jit"]), 2) if b["jit"] else None}
        v = verdict.get(loc, {"target": set(), "one": set()})
        out_rows.append({"location": loc, "hosts": sorted(r["hosts"]), "by": by,
                         "several": sorted(v["target"]), "one": sorted(v["one"] - v["target"])})
    return {"from": t0, "to": t1, "step": step, "probes": [{"id": p["id"], "name": p["name"]} for p in ps],
            "lines": lines, "simultaneous": corr["buckets"], "locations": out_rows,
            "errors": {names[pid]: d["error"] for pid, d in res.items() if "error" in d}}


def api_series(h, q, _):
    group = q.get("group") or "location"
    ps, t0, t1, res = _series(h, q, group)
    out, errors = [], {}
    for p in ps:
        d = res.get(p["id"]) or {}
        if "error" in d:
            errors[p["name"]] = d["error"]
            continue
        for s in d["series"]:
            out.append({"name": f"{s['name']} · {p['name']}", "probe": p["id"], "probe_name": p["name"], "location": s["location"],
                        "host": s.get("host"), "points": s["points"]})
    steps = [d["step"] for d in res.values() if "step" in d]
    return {"from": t0, "to": t1, "step": max(steps) if steps else None, "series": out, "errors": errors}


# -------------------------------------------------------------------- MTR across probes
def api_mtr_list(h, q, _):
    qs = "/api/mtr?limit=" + str(int(q.get("limit") or 500))
    for k in ("from", "to", "host", "trig", "status"):
        if q.get(k):
            qs += f"&{k}=" + urllib.parse.quote(q[k])
    ps = probes(h, q)
    res = hub.each(ps, lambda p: hub.call(p, qs, timeout=20))
    runs, errors, busy = [], {}, {}
    for p in ps:
        d = res.get(p["id"]) or {}
        if "error" in d:
            errors[p["name"]] = d["error"]
            continue
        busy[p["id"]] = {"running": len(d.get("running", [])), "queued": len(d.get("queued", []))}
        for r in d["runs"]:
            runs.append({**r, "probe": p["id"], "probe_name": p["name"]})
    runs.sort(key=lambda r: -(r.get("started") or r["created"]))
    return {"runs": runs, "errors": errors, "busy": busy}


def api_run(h, q, _):
    p = by_id(h, q.get("probe"))
    r = hub.call(p, f"/api/mtr/{int(q['id'])}")
    r.update({"probe": p["id"], "probe_name": p["name"]})
    return r


def api_run_file(h, q, _):
    """Pass a report / export file through from a probe."""
    p = by_id(h, q.get("probe"))
    path = f"/api/mtr/report/{int(q['id'])}" if q.get("kind") != "export" else \
        "/api/mtr/export?format=" + (q.get("format") or "zip") + "&ids=" + ",".join(str(int(x)) for x in _list(q, "ids"))
    data, ctype, disp = hub.call(p, path, raw=True, timeout=60)
    name = disp.split("filename=")[-1].strip('"') if "filename=" in disp else "mtr.txt"
    name = "".join(ch for ch in name if ch.isalnum() or ch in "-_.") or "mtr.txt"     # never trust a header from elsewhere
    h._send(200, data, ctype or "application/octet-stream", {"Content-Disposition": f'attachment; filename="{"".join(ch for ch in p["name"] if ch.isalnum() or ch in "-_") or "probe"}-{name}"'})


def api_mtr_start(h, q, _):
    b = h._body()
    hosts = b.get("hosts") or []
    if not hosts:
        raise ValueError("pick at least one target")
    want = set(b.get("probes") or [])
    ps = [p for p in probes(h) if not want or p["id"] in want]
    if not ps:
        raise ValueError("pick at least one probe")
    body = {"hosts": hosts, "mode": b.get("mode") or "icmp", "port": b.get("port"), "cycles": b.get("cycles"),
            "note": "from hub"}

    def start(p):
        # a probe only traces its own targets: send each probe the ones it has
        st = hub.call(p, "/api/status", timeout=8)
        mine = [x for x in hosts if any(t["host"] == x and t["enabled"] for t in st["targets"])]
        if not mine:
            return {"ids": [], "skipped": hosts}
        r = hub.call(p, "/api/mtr", {**body, "hosts": mine}, timeout=20)
        return {"ids": r["ids"], "skipped": [x for x in hosts if x not in mine]}
    res = hub.each(ps, start)
    return {"results": [{"probe": p["id"], "probe_name": p["name"], **res.get(p["id"], {})} for p in ps]}


# -------------------------------------------------------------------- evidence across probes
def api_evidence(h, q, _):
    c = h.app.cfg.get()
    t1 = _f(q, "to") or time.time()
    t0 = _f(q, "from") or t1 - 3600
    params = {"from": int(t0), "to": int(t1), "note": (q.get("note") or "")[:500]}
    for k in ("host", "location"):
        if q.get(k):
            params[k] = q[k]
    qs = "/api/evidence?" + urllib.parse.urlencode(params)
    ps = probes(h, q)
    res = hub.each(ps, lambda p: hub.call(p, qs, raw=True, timeout=180))
    corr = api_correlate(h, {**q, "from": str(t0), "to": str(t1), "points": "2000"}, None)
    lines = [f"Evidence pack from {c['name']} (Hopwatch Hub {VERSION})",
             f"Window:  {iso(t0)}  to  {iso(t1)}  (UTC)", f"Created: {iso(time.time())}",
             f"Sites:   {', '.join(p['name'] for p in ps)}", ""]
    if params["note"]:
        lines += ["Note: " + params["note"], ""]
    lines += ["Each site has its own folder with its README, ping data, events and MTR reports.", "",
              f"Problems seen from at least {corr['min_sites']} sites at the same time (target side):"]
    tg = [i for i in corr["incidents"] if i["kind"] == "target"]
    for i in sorted(tg, key=lambda x: x["t0"]):
        lines.append(f"  {iso(i['t0'])} for {int(i['t1'] - i['t0'])} s  {i['location']} {i['host']}  {i['signal']}  "
                     + ", ".join(f"{k} {v}" for k, v in i["worst"].items()))
    if not tg:
        lines.append("  none")
    lines += ["", "Seen from one site only (the path from that site, or that site's own link):"]
    one = [i for i in corr["incidents"] if i["kind"] != "target"]
    for i in sorted(one, key=lambda x: x["t0"])[:300]:
        lines.append(f"  {iso(i['t0'])} for {int(i['t1'] - i['t0'])} s  {i['location']} {i['host']}  {i['signal']}  "
                     f"{'site link' if i['kind'] == 'site' else 'path'} at {', '.join(i['site_names'])}")
    if not one:
        lines.append("  none")
    if corr["errors"]:
        lines += ["", "Sites that did not answer: " + "; ".join(f"{k}: {v}" for k, v in corr["errors"].items())]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("README.txt", "\n".join(lines) + "\n")
        z.writestr("incidents.json", json.dumps(corr["incidents"], indent=1))
        for p in ps:
            d = res.get(p["id"])
            if isinstance(d, dict):
                z.writestr(f"{p['name']}/ERROR.txt", d.get("error", "no answer") + "\n")
                continue
            folder = "".join(ch if ch.isalnum() or ch in "-_ ." else "_" for ch in p["name"])
            with zipfile.ZipFile(io.BytesIO(d[0])) as inner:
                for n in inner.namelist():
                    z.writestr(f"{folder}/{n}", inner.read(n))
    name = f"hopwatch-evidence-{time.strftime('%Y%m%d-%H%M%SZ', time.gmtime())}.zip"
    h._send(200, buf.getvalue(), "application/zip", {"Content-Disposition": f'attachment; filename="{name}"'})


# -------------------------------------------------------------------- settings
def api_config_get(h, q, _):
    return h.app.cfg.public()


def api_config_put(h, q, _):
    h.app.cfg.update(h._body())
    h.app.cache.d.clear()
    return h.app.cfg.public()


def api_probe_test(h, q, _):
    """Check address and token before saving: info is public, config needs the token."""
    b = h._body()
    p = {"name": b.get("name") or "probe", "url": str(b.get("url") or "").rstrip("/"), "token": b.get("token") or ""}
    if not p["token"] and b.get("id"):
        p["token"] = next((x["token"] for x in h.app.cfg.probes() if x["id"] == b["id"]), "")
    info = hub.call(p, "/api/info", timeout=8)
    if info.get("product") != "Hopwatch Probe":
        raise ValueError("that address does not answer like a Hopwatch Probe")
    cfg = hub.call(p, "/api/config", timeout=8)
    return {"site": info["site"], "version": info["version"], "targets": len(cfg["targets"])}


ROUTES = {
    ("GET", "/api/info"): (api_info, "public"),
    ("GET", "/api/live"): (api_live, "view"),
    ("GET", "/api/correlate"): (api_correlate, "view"),
    ("GET", "/api/overview"): (api_overview, "view"),
    ("GET", "/api/series"): (api_series, "view"),
    ("GET", "/api/mtr"): (api_mtr_list, "view"),
    ("GET", "/api/run"): (api_run, "view"),
    ("GET", "/api/run/file"): (api_run_file, "view"),
    ("POST", "/api/mtr"): (api_mtr_start, "admin"),
    ("GET", "/api/evidence"): (api_evidence, "view"),
    ("GET", "/api/config"): (api_config_get, "admin"),
    ("PUT", "/api/config"): (api_config_put, "admin"),
    ("POST", "/api/probes/test"): (api_probe_test, "admin"),
}
ROUTES.update(httpbase.COMMON_ROUTES)
Handler.routes = ROUTES


def serve(app, port, bind=""):
    httpbase.serve(Handler, app, port, bind)
