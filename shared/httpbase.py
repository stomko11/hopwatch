"""HTTP plumbing shared by Hopwatch Probe and Hub: JSON API dispatch, CORS, sessions, tokens,
static files and the login / password / token calls."""
import json
import logging
import mimetypes
import os
import re
import urllib.parse
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import auth as authmod

log = logging.getLogger("web")
COOKIE = "hopwatch_session"   # base name; every app and port gets its own (see serve)


def find_ui(app_dir):
    """The shared UI kit: next to the app in an image, at the repo root in a checkout."""
    for d in (os.environ.get("HOPWATCH_UI"), os.path.join(app_dir, "ui"), os.path.join(app_dir, "..", "ui"),
              os.path.join(app_dir, "..", "..", "ui")):
        if d and os.path.isdir(d):
            return os.path.abspath(d)
    return os.path.join(app_dir, "static")


class Handler(BaseHTTPRequestHandler):
    server_version = "hopwatch"
    routes: dict = {}
    cookie = COOKIE
    static_dir = ""
    ui_dir = ""
    sys_version = ""
    app = None
    version = ""

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
        return c[self.cookie].value if self.cookie in c else None

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
                return self._send(200, {"ok": True, "version": self.version})
            if method == "GET" and not path.startswith("/api/"):
                return self._static(path)
            if method != "GET" and not self._csrf_ok():
                return self._err(403, "missing X-Hopwatch header")
            route = self.routes.get((method, re.sub(r"/\d+$", "/{id}", re.sub(r"/[0-9a-f]{12}$", "/{tid}", path))))
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
        root, rel = (self.ui_dir, path[4:]) if path.startswith("/ui/") else (self.static_dir, path.lstrip("/"))
        full = os.path.normpath(os.path.join(root, rel))
        if not full.startswith(root + os.sep) or not os.path.isfile(full):
            if path.startswith("/ui/") or "." in os.path.basename(path):
                return self._err(404, "not found")
            full = os.path.join(self.static_dir, "index.html")
        with open(full, "rb") as f:
            data = f.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, data, ctype)



# -------------------------------------------------------------------- calls every app has
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
    h._send(200, {"ok": True}, extra={"Set-Cookie": f"{h.cookie}={val}; Path=/; HttpOnly; SameSite=Strict; Max-Age={maxage}"})


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



COMMON_ROUTES = {
    ("POST", "/api/login"): (api_login, "public"),
    ("POST", "/api/logout"): (api_logout, "public"),
    ("POST", "/api/password"): (api_password, "public"),
    ("POST", "/api/tokens"): (api_token_new, "admin"),
    ("DELETE", "/api/tokens/{tid}"): (api_token_del, "admin"),
}


def serve(handler_cls, app, port: int, bind: str = ""):
    handler_cls.app = app
    # browsers share cookies between ports of one host: probe and hub on one server need different names
    handler_cls.cookie = f"{COOKIE}_{handler_cls.server_version.replace('hopwatch-', '')}_{port}"
    srv = ThreadingHTTPServer((bind, port), handler_cls)
    srv.daemon_threads = True
    log.info("web UI on port %d", port)
    srv.serve_forever()
