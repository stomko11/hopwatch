"""Hub settings, edited in the web UI and kept in config.json in the data folder."""
import copy
import json
import os
import re
import secrets
import threading

VERSION = "0.2.0"

DEFAULTS = {
    "name": "Hopwatch Hub",
    "probes": [],            # [{"id", "name", "url", "token", "enabled"}]
    "correlate": {"min_sites": 2, "loss": 1.0, "jitter": 10.0, "delay": 50.0,
                  "use_loss": True, "use_jitter": False, "use_delay": False, "site_share": 50},
    "security": {"password_hash": "", "view_requires_login": False, "cors_origins": "", "tokens": []},
}


class ConfigError(ValueError):
    pass


def _merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(out.get(k), dict) and isinstance(v, dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def validate(cfg: dict) -> dict:
    c = _merge(DEFAULTS, cfg)
    c["name"] = str(c.get("name") or "Hopwatch Hub").strip()[:60]
    k = c["correlate"]
    try:
        k["min_sites"] = int(k["min_sites"])
        for f in ("loss", "jitter", "delay", "site_share"):
            k[f] = float(k[f])
    except (TypeError, ValueError):
        raise ConfigError("correlation: not a number")
    if not 1 <= k["min_sites"] <= 50:
        raise ConfigError("correlation: sites must be 1 to 50")
    if not 1 <= k["site_share"] <= 100:
        raise ConfigError("correlation: site share must be 1 to 100 %")
    for f in ("use_loss", "use_jitter", "use_delay"):
        k[f] = bool(k[f])
    seen, probes = set(), []
    for p in c.get("probes") or []:
        name = str(p.get("name") or "").strip()[:40]
        url = str(p.get("url") or "").strip().rstrip("/")
        if not name:
            raise ConfigError("every probe needs a name")
        if not re.match(r"^https?://[A-Za-z0-9.\-\[\]:]+(/[^\s]*)?$", url):
            raise ConfigError(f"probe '{name}': address must look like http://host:8095")
        pid = str(p.get("id") or "") or secrets.token_hex(4)
        if not re.match(r"^[0-9a-zA-Z_-]{1,24}$", pid) or pid in seen:
            raise ConfigError(f"probe '{name}': bad id")
        seen.add(pid)
        probes.append({"id": pid, "name": name, "url": url, "token": str(p.get("token") or "").strip(),
                       "enabled": bool(p.get("enabled", True))})
    if len(probes) > 50:
        raise ConfigError("at most 50 probes")
    c["probes"] = probes
    c["security"]["cors_origins"] = str(c["security"].get("cors_origins") or "").strip()
    c["security"]["view_requires_login"] = bool(c["security"].get("view_requires_login"))
    return c


class Config:
    def __init__(self, path: str):
        self.path = path
        self.lock = threading.Lock()
        self.listeners = []
        data = {}
        if os.path.exists(path):
            with open(path) as f:
                data = json.load(f)
        self.data = validate(data)
        self._write()

    def get(self):
        with self.lock:
            return copy.deepcopy(self.data)

    def _write(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.data, f, indent=1)
        os.chmod(tmp, 0o600)          # holds the probe tokens
        os.replace(tmp, self.path)

    def update(self, new: dict):
        """Security only changes through its own calls; probe tokens left empty keep the stored one."""
        with self.lock:
            cur = copy.deepcopy(self.data)
            new = dict(new)
            new["security"] = {**cur["security"], **{k: v for k, v in (new.get("security") or {}).items()
                                                    if k in ("view_requires_login", "cors_origins")}}
            old_tok = {p["id"]: p["token"] for p in cur["probes"]}
            for p in new.get("probes") or []:
                if not p.get("token") and p.get("id") in old_tok:
                    p["token"] = old_tok[p["id"]]
            self.data = validate(new)
            self._write()
            out = copy.deepcopy(self.data)
        for fn in self.listeners:
            fn(out)
        return out

    def set_security(self, **kw):
        with self.lock:
            self.data["security"].update(kw)
            self._write()

    def public(self):
        c = self.get()
        sec = c["security"]
        c["security"] = {"view_requires_login": sec["view_requires_login"], "cors_origins": sec["cors_origins"],
                         "password_set": bool(sec["password_hash"]),
                         "tokens": [{"id": t["id"], "name": t["name"], "created": t["created"]} for t in sec["tokens"]]}
        for p in c["probes"]:
            p["token_set"] = bool(p.pop("token"))
        return c
