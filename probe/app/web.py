"""HTTP server: the web UI and a JSON API (also what Hopwatch Hub will use)."""
import json
import logging
import mimetypes
import os
import re
import threading
import time
import urllib.parse
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import auth as authmod
import evidence
import netdata_import
from config import VERSION, ConfigError

log = logging.getLogger("web")
STATIC = os.path.join(os.path.dirname(__file__), "static")
# shared UI kit: next to the app in the image, at the repo root when run from a checkout
UI = next((d for d in (os.environ.get("HOPWATCH_UI"), os.path.join(os.path.dirname(__file__), "ui"),
                       os.path.join(os.path.dirname(__file__), "..", "..", "ui")) if d and os.path.isdir(d)), STATIC)
UI = os.path.abspath(UI)
COOKIE = "hopwatch_session"


class App:
    """Everything the handlers need, set up by main.py."""

    def __init__(self, cfg, store, pinger, mtr, auth, hostname):
        self.cfg, self.store, self.pinger, self.mtr, self.auth = cfg, store, pinger, mtr, auth
        self.hostname = hostname
        self.started = time.time()
        self.import_job = {"state": "idle"}


class Handler(BaseHTTPRequestHandler):
    server_version = "hopwatch-probe"
    sys_version = ""
    app: App = None

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.address_string(), fmt % args)

    # ---------------------------------------------------------------- helpers
    def _cors(self):
        origins = self.app.cfg.get()["security"]["cors_origins"]
        origin = self.headers.get("Origin")
        if not origin or not origins:
            return
        allowed = [o.strip() for o in origins.split(",") if o.strip()]
        if "*" in allowed:
            self.send_header("Access-Control-Allow-Origin", "*")
        elif origin in allowed:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        else:
            return
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Hopwatch")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

    def _send(self, code, body, ctype="application/json", extra=None):
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if ctype.startswith("text/html"):
            self.send_header("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                                                        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
            self.send_header("X-Frame-Options", "DENY")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _err(self, code, msg):
        self._send(code, {"error": msg})

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            raise ValueError("request too large")
        if not n:
            return {}
        return json.loads(self.rfile.read(n))

    def _cookie(self):
        c = cookies.SimpleCookie(self.headers.get("Cookie") or "")
        return c[COOKIE].value if COOKIE in c else None

    def _client_ip(self):
        return self.client_address[0]

    def is_admin(self):
        a = self.app.auth
        h = self.headers.get("Authorization") or ""
        if h.startswith("Bearer ") and a.check_token(h[7:].strip()):
            return True
        if not self.app.cfg.get()["security"]["password_hash"]:
            return False
        s = self._cookie()
        return bool(s and a.check_session(s))

    def can_view(self):
        sec = self.app.cfg.get()["security"]
        return not sec["view_requires_login"] or not sec["password_hash"] or self.is_admin()

    def _csrf_ok(self):
        # A custom header can't be sent cross-site without a CORS preflight; with a token it is not needed.
        return self.headers.get("X-Hopwatch") == "1" or (self.headers.get("Authorization") or "").startswith("Bearer ")

    # ---------------------------------------------------------------- dispatch
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def _dispatch(self, method):
        url = urllib.parse.urlparse(self.path)
        path = url.path
        q = {k: v[-1] for k, v in urllib.parse.parse_qs(url.query).items()}
        try:
            if path == "/api/health" or path == "/healthz":
                return self._send(200, {"ok": True, "version": VERSION})
            if method == "GET" and not path.startswith("/api/"):
                return self._static(path)
            if method != "GET" and not self._csrf_ok():
                return self._err(403, "missing X-Hopwatch header")
            route = ROUTES.get((method, re.sub(r"/\d+$", "/{id}", re.sub(r"/[0-9a-f]{12}$", "/{tid}", path))))
            if not route:
                return self._err(404, "not found")
            fn, level = route
            if level == "view" and not self.can_view():
                return self._err(401, "login required")
            if level == "admin" and not self.is_admin():
                return self._err(401, "login required")
            m = re.search(r"/(\d+|[0-9a-f]{12})$", path)
            res = fn(self, q, m.group(1) if m else None)
            if res is not None:
                self._send(200, res)
        except ConfigError as e:
            self._err(400, str(e))
        except (ValueError, KeyError, TypeError) as e:
            self._err(400, str(e) or e.__class__.__name__)
        except BrokenPipeError:
            pass
        except Exception as e:
            log.exception("error in %s %s", method, path)
            self._err(500, f"internal error: {e.__class__.__name__}")

    def _static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        root, rel = (UI, path[4:]) if path.startswith("/ui/") else (STATIC, path.lstrip("/"))
        full = os.path.normpath(os.path.join(root, rel))
        if not full.startswith(root + os.sep) or not os.path.isfile(full):
            if path.startswith("/ui/") or "." in os.path.basename(path):
                return self._err(404, "not found")
            full = os.path.join(STATIC, "index.html")
        with open(full, "rb") as f:
            data = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, data, ctype)


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
    return {"now": time.time(), "targets": rows, "mtr": busy, "error": a.pinger.error,
            "window_s": a.cfg.get()["alerts"]["window_s"]}


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
    if hosts or locs:      # a target is shown when its IP or its location is picked
        targets = [t for t in targets if t["host"] in hosts or t["location"] in locs]
    with a.pinger.lock:
        live = {k: list(v) for k, v in a.pinger.minutes.items()}
    data, tier, step = a.store.series([t["host"] for t in targets], int(t0), int(t1), points, c["retention"], now, live)
    group = q.get("group") or "host"
    out = []
    if group == "location":
        locs = {}
        for t in targets:
            locs.setdefault(t["location"], []).append(t["host"])
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
            out.append({"name": loc, "location": loc, "hosts": hosts, "points": buckets})
    else:
        for t in targets:
            pts = [[ts, v["avg"], v["loss"], v["jitter"], v["max"]] if v else [ts, None, None, None, None]
                   for ts, v in data[t["host"]]]
            out.append({"name": t["host"], "location": t["location"], "host": t["host"], "points": pts})
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
        targets = [t for t in targets if t["host"] in hosts or t["location"] in locs]
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


def api_login(h, q, _):
    a = h.app
    ip = h._client_ip()
    if not a.auth.allowed(ip):
        return h._err(429, "too many attempts, wait 5 minutes")
    b = h._body()
    stored = a.cfg.get()["security"]["password_hash"]
    if not stored or not authmod.check_password(str(b.get("password") or ""), stored):
        a.auth.failed(ip)
        return h._err(401, "wrong password")
    _set_cookie(h, a.auth.make_session())


def _set_cookie(h, val, maxage=authmod.SESSION_DAYS * 86400):
    h._send(200, {"ok": True}, extra={"Set-Cookie": f"{COOKIE}={val}; Path=/; HttpOnly; SameSite=Strict; Max-Age={maxage}"})


def api_logout(h, q, _):
    _set_cookie(h, "", 0)


def api_password(h, q, _):
    """First setup (no password yet) or change (needs the current one)."""
    a = h.app
    b = h._body()
    new = str(b.get("new") or "")
    if len(new) < 8:
        raise ValueError("the password needs at least 8 characters")
    stored = a.cfg.get()["security"]["password_hash"]
    if stored:
        if not h.is_admin():
            return h._err(401, "login required")
        if not authmod.check_password(str(b.get("old") or ""), stored):
            return h._err(401, "the current password is wrong")
    a.cfg.set_security(password_hash=authmod.hash_password(new))
    _set_cookie(h, a.auth.make_session())


def api_token_new(h, q, _):
    tok, item = h.app.auth.new_token(str(h._body().get("name") or "token"))
    return {"token": tok, "id": item["id"], "name": item["name"]}


def api_token_del(h, q, tid):
    h.app.auth.delete_token(tid)
    return {"ok": True}


def api_tcpcheck(h, q, _):
    h.app.mtr.tcp_check_now()
    return {"ok": True}


def api_import_targets(h, q, _):
    return {"targets": [{k: t[k] for k in ("location", "host")} for t in netdata_import.targets(h._body().get("url"))]}


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
    ("POST", "/api/login"): (api_login, "public"),
    ("POST", "/api/logout"): (api_logout, "public"),
    ("POST", "/api/password"): (api_password, "public"),
    ("POST", "/api/tokens"): (api_token_new, "admin"),
    ("DELETE", "/api/tokens/{tid}"): (api_token_del, "admin"),
    ("POST", "/api/tcpcheck"): (api_tcpcheck, "admin"),
    ("POST", "/api/import/targets"): (api_import_targets, "admin"),
    ("POST", "/api/import/history"): (api_import_history, "admin"),
    ("GET", "/api/import/history"): (api_import_status, "admin"),
    ("GET", "/api/storage"): (api_storage, "view"),
}


def serve(app: App, port: int, bind: str = ""):
    Handler.app = app
    srv = ThreadingHTTPServer((bind, port), Handler)
    srv.daemon_threads = True
    log.info("web UI on port %d", port)
    srv.serve_forever()
