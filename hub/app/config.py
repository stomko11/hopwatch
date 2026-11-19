"""Hub settings, edited in the web UI and kept in config.json in the data folder."""
import copy
import json
import os
import re
import secrets
import threading

VERSION = "0.2.16"

DEFAULTS = {
    "name": "Hopwatch Hub",
    "probes": [],            # [{"id", "name", "url", "token", "enabled"}]
    "local_name": "",        # name for the probe in the same container (empty = its own site name)
    # min_sites 0 = all sites that answer (follows the number of probes)
    "correlate": {"min_sites": 0, "loss": 1.0, "jitter": 10.0, "delay": 50.0,
                  "use_loss": True, "use_jitter": False, "use_delay": False, "site_share": 50},
    # Cross-site MTR: when one probe starts an automatic MTR, the others trace the same target too,
    # so there is something to compare (unless they already have a run of their own around then)
    "cross": {"enabled": True, "cooldown_min": 15, "max_per_hour": 30},
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


SCHEMA = 2      # 2: min_sites 0 = all sites (before, 2 was the default and was written into every file)


def validate(cfg: dict) -> dict:
    cfg = dict(cfg or {})
    if cfg and int(cfg.get("schema") or 1) < 2 and (cfg.get("correlate") or {}).get("min_sites") == 2:
        cfg["correlate"] = {**cfg["correlate"], "min_sites": 0}     # the old default: follow the number of probes
    c = _merge(DEFAULTS, cfg)
    c["schema"] = SCHEMA
    c["name"] = str(c.get("name") or "Hopwatch Hub").strip()[:60]
    c["local_name"] = str(c.get("local_name") or "").strip()[:40]
    k = c["correlate"]
    try:
        k["min_sites"] = int(k["min_sites"])
        for f in ("loss", "jitter", "delay", "site_share"):
            k[f] = float(k[f])
    except (TypeError, ValueError):
        raise ConfigError("correlation: not a number")
    if not 0 <= k["min_sites"] <= 50:
        raise ConfigError("correlation: sites must be 0 (all) to 50")
    if not 1 <= k["site_share"] <= 100:
        raise ConfigError("correlation: site share must be 1 to 100 %")
    for f in ("use_loss", "use_jitter", "use_delay"):
        k[f] = bool(k[f])
    x = c["cross"]
    try:
        x["cooldown_min"], x["max_per_hour"] = int(x["cooldown_min"]), int(x["max_per_hour"])
    except (TypeError, ValueError):
        raise ConfigError("cross-site MTR: not a number")
    if not 0 <= x["cooldown_min"] <= 1440 or not 1 <= x["max_per_hour"] <= 500:
        raise ConfigError("cross-site MTR: cooldown 0–1440 min, 1–500 per hour")
    x["enabled"] = bool(x["enabled"])
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

    @staticmethod
    def _local_site_name():
        try:
            with open(os.environ.get("HOPWATCH_LOCAL_PROBE_CONFIG", "")) as f:
                return (json.load(f).get("site_name") or "").strip()[:40]
        except (OSError, ValueError):
            return ""

    def local_probe(self):
        """The probe in the same container (set up by the launcher), or None. Not stored, not editable."""
        url, tok = os.environ.get("HOPWATCH_LOCAL_PROBE_URL"), os.environ.get("HOPWATCH_LOCAL_TOKEN")
        if not url or not tok:
            return None
        own = (self.get().get("local_name") or "").strip()
        name = self._local_site_name() or "This site"
        return {"id": "local", "name": (own or name)[:40], "url": url, "token": tok, "enabled": True, "local": True}

    def probes(self):
        lp = self.local_probe()
        return ([lp] if lp else []) + self.get()["probes"]

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
            loc = next((p for p in (new.get("probes") or []) if p.get("local") or p.get("id") == "local"), None)
            if loc is not None:      # renaming the built-in probe is stored as local_name (only if it differs)
                nm = str(loc.get("name") or "").strip()
                new["local_name"] = "" if nm in ("", self._local_site_name(), "This site") else nm
            new["probes"] = [p for p in (new.get("probes") or []) if not p.get("local") and p.get("id") != "local"]
            new["security"] = {**cur["security"], **{k: v for k, v in (new.get("security") or {}).items()
                                                    if k in ("view_requires_login", "cors_origins")}}
            old_tok = {p["id"]: p["token"] for p in cur["probes"]}
            for p in new.get("probes") or []:
                if not p.get("token") and p.get("id") in old_tok:
                    p["token"] = old_tok[p["id"]]
            new["schema"] = SCHEMA        # a value chosen in the UI is never taken for the old default
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
        lp = self.local_probe()
        if lp:
            lp.pop("token")
            c["probes"].insert(0, {**lp, "token_set": True})
        return c
