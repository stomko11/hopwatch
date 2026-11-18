"""HTTP server: the web UI and a JSON API (also what Hopwatch Hub will use)."""
import json
import logging
import mimetypes
import os
import re
import threading
import time
import urllib.parse

import evidence
import httpbase
import netdata_import
from config import VERSION, ConfigError, group as _group, place as _place

log = logging.getLogger("web")
STATIC = os.path.join(os.path.dirname(__file__), "static")
# shared UI kit: next to the app in the image, at the repo root when run from a checkout
UI = httpbase.find_ui(os.path.dirname(os.path.abspath(__file__)))


class App:
    """Everything the handlers need, set up by main.py."""

    def __init__(self, cfg, store, pinger, mtr, auth, hostname):
        self.cfg, self.store, self.pinger, self.mtr, self.auth = cfg, store, pinger, mtr, auth
        self.hostname = hostname
        self.started = time.time()
        self.import_job = {"state": "idle"}


class Handler(httpbase.Handler):
    server_version = "hopwatch-probe"
    version = VERSION
    static_dir = STATIC
    ui_dir = UI


# -------------------------------------------------------------------- API
def api_info(h, q, _):
    a = h.app
    c = a.cfg.get()
    sec = c["security"]
    return {"product": "Hopwatch Probe", "version": VERSION, "site": c["site_name"] or a.hostname,
            "now": time.time(), "uptime": time.time() - a.started, "error": a.pinger.error,
            "auth": {"admin": h.is_admin(), "password_set": bool(sec["password_hash"]),
                     "view_requires_login": sec["view_requires_login"], "can_view": h.can_view()}}


def api_status(h, q, _):
    a = h.app
    tcp = dict(a.mtr.tcp)
    rows = a.pinger.status()
    for r in rows:
        r["tcp"] = tcp.get(r["host"])
    busy = a.mtr.busy()
    c = a.cfg.get()
    return {"now": time.time(), "targets": rows, "mtr": busy, "error": a.pinger.error,
            "window_s": c["alerts"]["window_s"], "roles": c["roles"]}


def api_series(h, q, _):
    a = h.app
    c = a.cfg.get()
    now = time.time()
    t1 = float(q.get("to") or now)
    t0 = float(q.get("from") or (t1 - 3600))
    if t1 <= t0:
        raise ValueError("'from' must be before 'to'")
    points = int(q.get("points") or 300)
    targets = [t for t in c["targets"]]
    hosts, locs = set(_list(q, "host")), set(_list(q, "location"))
    if hosts or locs:      # a target is shown when its IP or its place (location, else role) is picked
        targets = [t for t in targets if t["host"] in hosts or _place(t) in locs or _group(t) in locs]
    with a.pinger.lock:
        live = {k: list(v) for k, v in a.pinger.minutes.items()}
    data, tier, step = a.store.series([t["host"] for t in targets], int(t0), int(t1), points, c["retention"], now, live)
    group = q.get("group") or "host"
    out = []
    if group in ("location", "role"):
        # "role" keeps the roles of a location apart: "AMS · ISP" and "AMS · FX" are never averaged together
        locs, meta = {}, {}
        for t in targets:
            key = _place(t) if group == "location" else _group(t)
            locs.setdefault(key, []).append(t["host"])
            meta[key] = (_place(t), (t.get("role") or "") if group == "role" else "")
        for loc, hosts in locs.items():
            buckets = []
            for i in range(len(data[hosts[0]])):
                ts = data[hosts[0]][i][0]
                vals = [data[x][i][1] for x in hosts if data[x][i][1]]
                if not vals:
                    buckets.append([ts, None, None, None, None])
                    continue
                sent = sum(v["sent"] for v in vals)
                lost = sum(v["lost"] for v in vals)
                avgs = [v["avg"] for v in vals if v["avg"] is not None]
                jits = [v["jitter"] for v in vals if v["jitter"] is not None]
                buckets.append([ts, round(sum(avgs) / len(avgs), 2) if avgs else None, round(100.0 * lost / sent, 2),
                                round(sum(jits) / len(jits), 2) if jits else None, max(v["max"] or 0 for v in vals) or None])
            out.append({"name": loc, "location": meta[loc][0], "role": meta[loc][1], "group": loc, "hosts": hosts, "points": buckets})
    else:
        for t in targets:
            pts = [[ts, v["avg"], v["loss"], v["jitter"], v["max"]] if v else [ts, None, None, None, None]
                   for ts, v in data[t["host"]]]
            out.append({"name": t["host"], "label": t.get("name") or "", "location": _place(t), "dc": t["location"],
                        "role": t.get("role") or "", "group": _group(t), "host": t["host"], "points": pts})
    return {"tier": tier, "step": step, "from": t0, "to": t1, "columns": ["t", "avg", "loss", "jitter", "max"], "series": out}


def _list(q, k):
    return [x for x in (q.get(k) or "").split(",") if x]


def _f(q, k):
    return float(q[k]) if q.get(k) else None


def api_events(h, q, _):
    return {"events": h.app.store.events(_f(q, "from"), _f(q, "to"), int(q.get("limit") or 500),
                                         _list(q, "host"), _list(q, "kind"))}


def api_mtr_list(h, q, _):
    a = h.app
    return {"runs": a.store.mtr_list(int(q.get("limit") or 200), _list(q, "host"), _f(q, "from"), _f(q, "to"),
                                     _list(q, "trig"), _list(q, "status")), **a.mtr.busy()}


def api_mtr_get(h, q, rid):
    r = h.app.store.mtr_get(int(rid))
    if not r:
        raise KeyError("no such MTR run")
    r["previous"] = h.app.store.mtr_previous(int(rid))
    return r


def _download(h, data, name, ctype):
    h._send(200, data if isinstance(data, bytes) else data.encode(), ctype,
            {"Content-Disposition": f'attachment; filename="{name}"'})


def _stamp():
    return time.strftime("%Y%m%d-%H%M%SZ", time.gmtime())


def api_mtr_export(h, q, _):
    """?ids=1,2,3&format=zip|txt|json"""
    ids = [int(x) for x in _list(q, "ids")][:1000]
    if not ids:
        raise ValueError("pass ids")
    runs = [h.app.store.mtr_get(i) for i in ids]
    runs = [r for r in runs if r]
    fmt = q.get("format") or "zip"
    if fmt == "txt":
        return _download(h, evidence.runs_text(runs), f"mtr-{_stamp()}.txt", "text/plain; charset=utf-8")
    if fmt == "json":
        return _download(h, json.dumps(runs, indent=1), f"mtr-{_stamp()}.json", "application/json")
    _download(h, evidence.runs_zip(runs), f"mtr-{_stamp()}.zip", "application/zip")


def _window(h, q, max_points=20000):
    """Targets, time window and series data for exports (fine resolution: every ping for short windows)."""
    a = h.app
    c = a.cfg.get()
    now = time.time()
    t1 = _f(q, "to") or now
    t0 = _f(q, "from") or t1 - 3600
    if t1 <= t0:
        raise ValueError("'from' must be before 'to'")
    targets = c["targets"]
    hosts, locs = set(_list(q, "host")), set(_list(q, "location"))
    if hosts or locs:
        targets = [t for t in targets if t["host"] in hosts or _place(t) in locs or _group(t) in locs]
        if not targets:
            raise ValueError("none of the picked targets or locations exist (any more)")
    with a.pinger.lock:
        live = {k: list(v) for k, v in a.pinger.minutes.items()}
    points = min(max_points, int(q.get("points") or max_points))
    data, tier, step = a.store.series([t["host"] for t in targets], int(t0), int(t1), points, c["retention"], now, live,
                                      max_points=max_points)
    return c, targets, t0, t1, data, step


def api_series_csv(h, q, _):
    c, targets, t0, t1, data, step = _window(h, q)
    _download(h, evidence.series_csv(data, targets, step), f"ping-{_stamp()}.csv", "text/csv; charset=utf-8")


def api_evidence(h, q, _):
    """ZIP with summary, ping data, events and MTR runs for a window (and optional targets / locations)."""
    a = h.app
    c, targets, t0, t1, data, step = _window(h, q)
    hosts = [t["host"] for t in targets]
    events = a.store.events(t0, t1, 100000, hosts)
    margin = 600      # include runs that started a little before or after the window
    runs = [a.store.mtr_get(r["id"]) for r in a.store.mtr_list(5000, hosts, t0 - margin, t1 + margin)]
    site = c["site_name"] or a.hostname
    blob = evidence.pack(site, a.mtr.public_ip.get(c["mtr"]["public_ip_url"]), t0, t1, targets, data, step, events, runs,
                         (q.get("note") or "")[:500])
    _download(h, blob, f"hopwatch-evidence-{site.replace(' ', '_')}-{_stamp()}.zip", "application/zip")


def api_mtr_report(h, q, rid):
    r = h.app.store.mtr_get(int(rid))
    if not r or not r.get("report"):
        return h._err(404, "no report for this run")
    name = f"mtr-{r['host']}-{time.strftime('%Y%m%d-%H%M%S', time.gmtime(r['started'] or r['created']))}Z.txt"
    h._send(200, r["report"].encode(), "text/plain; charset=utf-8", {"Content-Disposition": f'attachment; filename="{name}"'})


def api_mtr_start(h, q, _):
    b = h._body()
    hosts = b.get("hosts") or ([b["host"]] if b.get("host") else [])
    if not hosts:
        raise ValueError("pass host or hosts")
    if len(hosts) > 100:
        raise ValueError("at most 100 targets at once")
    a = h.app
    mode = b.get("mode", "icmp")
    ids = []
    for host in hosts:
        m = mode
        if m == "tcp_if_open":
            m = "tcp" if (a.mtr.tcp.get(host) or {}).get("state") in ("open", "refused") else "icmp"
        ids.append(a.mtr.request(host, m, b.get("port"), b.get("cycles"), "manual", b.get("note") or None))
    return {"ids": ids}


def api_mtr_cancel(h, q, rid):
    return {"cancelled": h.app.mtr.cancel(int(rid))}


def api_config_get(h, q, _):
    return h.app.cfg.public()


def api_config_put(h, q, _):
    b = h._body()
    h.app.cfg.update(b)
    return h.app.cfg.public()


def api_tcpcheck(h, q, _):
    h.app.mtr.tcp_check_now()
    return {"ok": True}


def api_import_targets(h, q, _):
    """Targets of a Netdata agent. Optional: jobs whose name ends with `suffix` (e.g. "GW") get
    `suffix_role` and lose the suffix, so "AMS GW" becomes location "AMS" with role "ISP"; the
    jobs of those locations get `other_role`. A job with no such pair (e.g. "Cloudflare DNS") is
    not in a location: the job name becomes the target's name and it gets `lone_role`."""
    b = h._body()
    suffix = str(b.get("suffix") or "").strip()
    found = netdata_import.targets(b.get("url"))
    sfx = " " + suffix.lower()
    paired = {t["location"][: -len(sfx)].strip().lower() for t in found if suffix and t["location"].lower().endswith(sfx)}
    out = []
    for t in found:
        job, name, role = t["location"], "", str(b.get("other_role") or "")
        if suffix and job.lower().endswith(sfx):
            job, role = job[: -len(sfx)].strip(), str(b.get("suffix_role") or "")
        elif suffix and job.lower() not in paired:
            job, name, role = "", job, str(b.get("lone_role") or "")
        out.append({"name": name, "location": job, "host": t["host"], "role": role})
    return {"targets": out}


def api_import_history(h, q, _):
    a = h.app
    if a.import_job.get("state") == "running":
        raise ValueError("an import is already running")
    b = h._body()
    url = netdata_import.clean_url(b.get("url"))
    days = max(1, min(400, int(b.get("days") or 30)))
    a.import_job = {"state": "running", "url": url, "done": 0, "total": 0, "records": 0, "started": time.time()}
    threading.Thread(target=_run_import, args=(a, url, days), daemon=True).start()
    return a.import_job


def _run_import(a, url, days):
    job = a.import_job
    try:
        found = netdata_import.targets(url)
        mine = {t["host"] for t in a.cfg.get()["targets"]}
        found = [t for t in found if t["host"] in mine]
        job["total"] = len(found)
        ret = a.cfg.get()["retention"]
        for t in found:
            n = 0
            d1 = min(days, ret["m1_days"])
            n += a.store.import_records(t["host"], "m1", netdata_import.history(url, t["chart"], d1, 60))
            n += a.store.import_records(t["host"], "m5", netdata_import.history(url, t["chart"], min(days, ret["m5_days"]), 300))
            job["records"] += n
            job["done"] += 1
        job["state"] = "done"
    except Exception as e:
        log.exception("Netdata import failed")
        job["state"] = "error"
        job["error"] = str(e)
    job["finished"] = time.time()


def api_import_status(h, q, _):
    return h.app.import_job


def api_storage(h, q, _):
    return h.app.store.size_info()


ROUTES = {
    ("GET", "/api/info"): (api_info, "public"),
    ("GET", "/api/status"): (api_status, "view"),
    ("GET", "/api/series"): (api_series, "view"),
    ("GET", "/api/events"): (api_events, "view"),
    ("GET", "/api/mtr"): (api_mtr_list, "view"),
    ("GET", "/api/mtr/{id}"): (api_mtr_get, "view"),
    ("GET", "/api/mtr/report/{id}"): (api_mtr_report, "view"),
    ("GET", "/api/mtr/export"): (api_mtr_export, "view"),
    ("GET", "/api/series.csv"): (api_series_csv, "view"),
    ("GET", "/api/evidence"): (api_evidence, "view"),
    ("POST", "/api/mtr"): (api_mtr_start, "admin"),
    ("POST", "/api/mtr/cancel/{id}"): (api_mtr_cancel, "admin"),
    ("GET", "/api/config"): (api_config_get, "admin"),
    ("PUT", "/api/config"): (api_config_put, "admin"),
    ("POST", "/api/tcpcheck"): (api_tcpcheck, "admin"),
    ("POST", "/api/import/targets"): (api_import_targets, "admin"),
    ("POST", "/api/import/history"): (api_import_history, "admin"),
    ("GET", "/api/import/history"): (api_import_status, "admin"),
    ("GET", "/api/storage"): (api_storage, "view"),
}


ROUTES.update(httpbase.COMMON_ROUTES)
Handler.routes = ROUTES


def serve(app: App, port: int, bind: str = ""):
    httpbase.serve(Handler, app, port, bind)
