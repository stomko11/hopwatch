"""Settings: defaults, validation and the JSON file in the data folder.

Everything a user can change lives here and is edited in the web UI. Environment variables only
cover what must be known before the UI is reachable (port, data folder, password reset).
"""
import copy
import ipaddress
import json
import os
import re
import threading

VERSION = "0.2.15"

DEFAULTS = {
    "site_name": "",
    "targets": [
        {"name": "Cloudflare DNS", "location": "", "host": "1.1.1.1", "enabled": True, "role": ""},
        {"name": "Google DNS", "location": "", "host": "8.8.8.8", "enabled": True, "role": ""},
    ],
    # A target has an optional name, an optional location (the DC it is in) and a role (its group).
    # Within a location the roles stay apart: "DC1 · ISP" and "DC1 · Servers". Without a location the
    # role alone is the group. A role turned off pauses all its targets. A role named ISP (or GW,
    # gateway, upstream) is the ISP edge: when it is clean and the others of the location are not,
    # the problem is past the ISP.
    "roles": [],
    "ping": {"interval_ms": 1000, "timeout_ms": 1000, "size": 56},
    "alerts": {"window_s": 60, "loss_warn": 5, "loss_crit": 20, "rtt_warn_ms": 0, "rtt_crit_ms": 0},
    # Automatic MTR: when something goes wrong (and once more when it is fixed), so there is evidence
    "auto_mtr": {"enabled": True, "loss_pct": 20, "window_s": 60, "cooldown_min": 30,
                 "per_location": True, "max_per_hour": 20, "mode": "both",
                 "on_down": True, "on_latency": False, "latency_ms": 0, "latency_rise_ms": 100,
                 "on_recovery": True},
    # Periodic MTR: a baseline of the normal path, to compare with when there is a problem
    "schedules": [],
    "mtr": {"cycles": 100, "interval_s": 1.0, "resolve": True, "asn": True, "max_parallel": 4,
            "public_ip_url": "https://api.ipify.org"},
    "tcp_check": {"enabled": True, "port": 443, "every_h": 24},
    "retention": {"raw_days": 7, "m1_days": 90, "m5_days": 365, "mtr_days": 365, "mtr_max": 5000},
    "security": {"password_hash": "", "view_requires_login": False, "cors_origins": "*", "tokens": []},
}

# (section, key) -> (type, min, max)
LIMITS = {
    ("ping", "interval_ms"): (int, 200, 10000),
    ("ping", "timeout_ms"): (int, 100, 10000),
    ("ping", "size"): (int, 0, 1472),
    ("alerts", "window_s"): (int, 10, 3600),
    ("alerts", "loss_warn"): (float, 0, 100),
    ("alerts", "loss_crit"): (float, 0, 100),
    ("alerts", "rtt_warn_ms"): (float, 0, 60000),
    ("alerts", "rtt_crit_ms"): (float, 0, 60000),
    ("auto_mtr", "loss_pct"): (float, 1, 100),
    ("auto_mtr", "window_s"): (int, 10, 3600),
    ("auto_mtr", "cooldown_min"): (int, 1, 1440),
    ("auto_mtr", "max_per_hour"): (int, 1, 500),
    ("auto_mtr", "latency_ms"): (float, 0, 60000),
    ("auto_mtr", "latency_rise_ms"): (float, 0, 60000),
    ("mtr", "cycles"): (int, 5, 1000),
    ("mtr", "interval_s"): (float, 0.1, 10),
    ("mtr", "max_parallel"): (int, 1, 16),
    ("tcp_check", "port"): (int, 1, 65535),
    ("tcp_check", "every_h"): (int, 1, 168),
    ("retention", "raw_days"): (int, 1, 60),
    ("retention", "m1_days"): (int, 1, 730),
    ("retention", "m5_days"): (int, 1, 3650),
    ("retention", "mtr_days"): (int, 1, 3650),
    ("retention", "mtr_max"): (int, 10, 100000),
}
BOOLS = {("auto_mtr", "enabled"), ("auto_mtr", "per_location"), ("auto_mtr", "on_down"), ("auto_mtr", "on_latency"),
         ("auto_mtr", "on_recovery"), ("mtr", "resolve"), ("mtr", "asn"),
         ("tcp_check", "enabled"), ("security", "view_requires_login")}
CHOICES = {("auto_mtr", "mode"): ("icmp", "tcp", "tcp_if_open", "both")}

_HOST_RE = re.compile(r"^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))*\.?$")


class ConfigError(ValueError):
    pass


def valid_host(h: str) -> bool:
    """IPv4 / IPv6 literal or a DNS name. Never starts with '-', so it can't be read as a CLI option."""
    if not isinstance(h, str) or not h or h.startswith("-"):
        return False
    try:
        ipaddress.ip_address(h)
        return True
    except ValueError:
        return bool(_HOST_RE.match(h))


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(out.get(k), dict) and isinstance(v, dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


EDGE_RE = re.compile(r"^(isp|gw|gateway|upstream)", re.I)


def is_edge(role: str) -> bool:
    """A role named ISP / GW / gateway / upstream is the ISP's gateway in front of a location."""
    return bool(role and EDGE_RE.match(role))


def active(t, c) -> bool:
    """Pinged: the target is on and so is its role."""
    return bool(t["enabled"]) and not any(r["name"] == t.get("role") and not r.get("enabled", True) for r in c.get("roles") or [])


def place(t) -> str:
    """Where a target belongs on the overview: its location, else its role, else its name or IP."""
    return t.get("location") or t.get("role") or t.get("name") or t["host"]


def group(t) -> str:
    """Its group: "DC1 · ISP" when it has a location and a role, else the place."""
    return f'{t["location"]} · {t["role"]}' if t.get("location") and t.get("role") else place(t)


def label(t) -> str:
    """For texts: the group, with the name when it has one."""
    g = group(t)
    return f'{t["name"]} ({g})' if t.get("name") and t["name"] != g else g


def validate(cfg: dict) -> dict:
    """Return a cleaned copy or raise ConfigError with a message for the UI."""
    c = _merge(DEFAULTS, cfg)
    c["site_name"] = str(c.get("site_name") or "").strip()[:60]
    for (sec, key), (typ, lo, hi) in LIMITS.items():
        try:
            v = typ(c[sec][key])
        except (TypeError, ValueError):
            raise ConfigError(f"{sec}.{key}: not a number")
        if not lo <= v <= hi:
            raise ConfigError(f"{sec}.{key}: must be between {lo} and {hi}")
        c[sec][key] = v
    for sec, key in BOOLS:
        c[sec][key] = bool(c[sec][key])
    for (sec, key), opts in CHOICES.items():
        if c[sec][key] not in opts:
            raise ConfigError(f"{sec}.{key}: one of {', '.join(opts)}")
    if c["alerts"]["loss_crit"] < c["alerts"]["loss_warn"]:
        raise ConfigError("alerts: critical loss must be at least the warning loss")
    if c["ping"]["timeout_ms"] > c["ping"]["interval_ms"]:
        raise ConfigError("ping: timeout can't be longer than the interval")
    url = str(c["mtr"].get("public_ip_url") or "").strip()
    if url and not re.match(r"^https?://[^\s]+$", url):
        raise ConfigError("mtr.public_ip_url: must start with http:// or https://")
    c["mtr"]["public_ip_url"] = url
    origins = str(c["security"].get("cors_origins") or "").strip()
    c["security"]["cors_origins"] = origins
    roles, rnames = [], set()
    for r in c.get("roles") or []:
        n = str(r.get("name") or "").strip()[:30]
        if not n:
            continue
        if n.lower() in rnames:
            raise ConfigError(f"role '{n}' is listed twice")
        rnames.add(n.lower())
        roles.append({"name": n, "enabled": bool(r.get("enabled", True)), "upstream": is_edge(n)})
    if len(roles) > 20:
        raise ConfigError("at most 20 roles")
    c["roles"] = roles
    known = {r["name"].lower(): r["name"] for r in roles}
    seen, targets = set(), []
    for t in c.get("targets") or []:
        host = str(t.get("host") or "").strip()
        loc = str(t.get("location") or "").strip()[:60]
        name = str(t.get("name") or "").strip()[:60]
        if not valid_host(host):
            raise ConfigError(f"target '{host}': not an IP address or host name")
        if host in seen:
            raise ConfigError(f"target '{host}' is listed twice")
        seen.add(host)
        role = known.get(str(t.get("role") or "").strip().lower(), "")     # a removed role leaves the target without one
        targets.append({"name": name, "location": loc, "host": host, "enabled": bool(t.get("enabled", True)), "role": role})
    if len(targets) > 500:
        raise ConfigError("at most 500 targets")
    c["targets"] = targets
    c["schedules"] = [_schedule(x, seen) for x in (c.get("schedules") or [])]
    if len(c["schedules"]) > 50:
        raise ConfigError("at most 50 schedules")
    return c


def _schedule(x, hosts) -> dict:
    name = str(x.get("name") or "").strip()[:60] or "Schedule"
    try:
        every, cycles = int(x.get("every_min") or 60), int(x.get("cycles") or 100)
    except (TypeError, ValueError):
        raise ConfigError(f"schedule '{name}': not a number")
    if not 5 <= every <= 10080:
        raise ConfigError(f"schedule '{name}': every 5 to 10080 minutes")
    if not 5 <= cycles <= 1000:
        raise ConfigError(f"schedule '{name}': 5 to 1000 cycles")
    mode = x.get("mode") or "icmp"
    if mode not in ("icmp", "tcp", "udp", "tcp_if_open"):
        raise ConfigError(f"schedule '{name}': unknown mode")
    sel = [h for h in (x.get("hosts") or []) if h in hosts]     # removed targets drop out silently
    sid = str(x.get("id") or "") or os.urandom(4).hex()
    if not re.match(r"^[0-9a-zA-Z_-]{1,24}$", sid):
        raise ConfigError("bad schedule id")
    return {"id": sid, "name": name, "enabled": bool(x.get("enabled", True)), "hosts": sel,
            "every_min": every, "cycles": cycles, "mode": mode}


class Config:
    """Thread-safe holder; listeners are called after every successful save."""

    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()
        self.listeners = []
        data = {}
        if os.path.exists(path):
            with open(path) as f:
                data = json.load(f)
        self.data = validate(data)
        if not os.path.exists(path):
            self._write()

    def get(self) -> dict:
        with self.lock:
            return copy.deepcopy(self.data)

    def _write(self) -> None:
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.data, f, indent=1)
        os.replace(tmp, self.path)

    def update(self, new: dict, keep_security: bool = True) -> dict:
        """Replace the settings. The security block is only changed through its own calls."""
        with self.lock:
            cur = copy.deepcopy(self.data)
            if keep_security:
                sec = cur["security"]
                new = dict(new)
                new["security"] = {**sec, **{k: v for k, v in (new.get("security") or {}).items()
                                            if k in ("view_requires_login", "cors_origins")}}
            self.data = validate(new)
            self._write()
            out = copy.deepcopy(self.data)
        for fn in self.listeners:
            fn(out)
        return out

    def set_security(self, **kw) -> None:
        with self.lock:
            self.data["security"].update(kw)
            self._write()

    def public(self) -> dict:
        """Settings as shown in the UI: no password hash, token hashes replaced by names."""
        c = self.get()
        sec = c["security"]
        c["security"] = {"view_requires_login": sec["view_requires_login"], "cors_origins": sec["cors_origins"],
                         "password_set": bool(sec["password_hash"]),
                         "tokens": [{"id": t["id"], "name": t["name"], "created": t["created"]} for t in sec["tokens"]]}
        return c
