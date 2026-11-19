"""Hopwatch Hub: talks to the probes and finds what several sites see at the same time.

The probes keep their own history; the hub asks them over their API (with a token per probe), so
nothing is stored twice and a probe that was offline still has its own data when it comes back.
"""
import concurrent.futures as cf
import collections
import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("hub")
POOL = cf.ThreadPoolExecutor(max_workers=16)


class ProbeError(RuntimeError):
    pass


def call(probe, path, body=None, method=None, timeout=20, raw=False):
    """One request to a probe. Raises ProbeError with a message fit for the UI."""
    url = probe["url"].rstrip("/") + path
    h = {"Authorization": "Bearer " + probe.get("token", ""), "User-Agent": "hopwatch-hub", "X-Hopwatch": "1"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = r.read()
            return (d, r.headers.get("Content-Type", ""), r.headers.get("Content-Disposition", "")) if raw else json.loads(d or b"null")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error")
        except Exception:
            msg = None
        raise ProbeError(f"{probe['name']}: {msg or 'HTTP ' + str(e.code)}" + (" (check the token)" if e.code == 401 else ""))
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise ProbeError(f"{probe['name']}: cannot reach {probe['url']} ({getattr(e, 'reason', e)})")
    except ValueError:
        raise ProbeError(f"{probe['name']}: not a Hopwatch Probe at {probe['url']}")


def each(probes, fn):
    """Run fn(probe) for every probe in parallel -> {probe_id: result or {"error": ...}}."""
    futs = {POOL.submit(fn, p): p for p in probes}
    out = {}
    for f, p in futs.items():
        try:
            out[p["id"]] = f.result()
        except ProbeError as e:
            out[p["id"]] = {"error": str(e)}
        except Exception as e:      # never let one probe break the page
            log.exception("probe %s", p["name"])
            out[p["id"]] = {"error": f"{p['name']}: {e.__class__.__name__}"}
    return out


class Cache:
    def __init__(self):
        self.d = {}

    def get(self, key, ttl, fn):
        hit = self.d.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
        v = fn()
        self.d[key] = (time.time(), v)
        if len(self.d) > 200:
            for k in sorted(self.d, key=lambda k: self.d[k][0])[:100]:
                self.d.pop(k, None)
        return v


# ------------------------------------------------------------------------ correlation
SIGNALS = ("loss", "jitter", "delay")


def sites_needed(setting, answering):
    """0 means all sites that answer; otherwise the setting, but never more than answer."""
    answering = max(1, answering)
    return answering if not setting else min(int(setting), answering)


def _median(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    n = len(vals)
    return vals[n // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2


def align(per_probe):
    """per_probe: {pid: {"step", "series": [{host, location, points: [[t, avg, loss, jitter, max]]}]}}
    -> step, {host: {pid: {t: (avg, loss, jitter)}}}, {host: location}
    Buckets are put on one grid (the coarsest step), worst value wins when several fall together."""
    step = max([d["step"] for d in per_probe.values() if isinstance(d, dict) and "step" in d] or [60])
    grid, locs = {}, {}
    for pid, d in per_probe.items():
        if not isinstance(d, dict) or "series" not in d:
            continue
        for s in d["series"]:
            h = s["host"]
            # a role keeps its own name everywhere: "DC1 · ISP" and "DC1 · Servers" are separate
            # (probes before 0.2.5 send no "group")
            locs.setdefault(h, s.get("group") or (s["location"] + (" · " + s["role"] if s.get("role") else "")))
            dst = grid.setdefault(h, {}).setdefault(pid, {})
            for t, avg, loss, jit, _mx in s["points"]:
                if loss is None and avg is None:
                    continue
                b = int(t - t % step)
                old = dst.get(b)
                if old:
                    avg = max(x for x in (avg, old[0]) if x is not None) if (avg is not None or old[0] is not None) else None
                    loss = max(loss or 0, old[1] or 0)
                    jit = max(jit or 0, old[2] or 0) if (jit is not None or old[2] is not None) else None
                dst[b] = (avg, loss, jit)
    return step, grid, locs


def correlate(per_probe, names, th, min_sites, site_share=0.5, join_s=60):
    """Find incidents.

    th: {"loss": % or None, "jitter": ms or None, "delay": ms over normal or None}
    min_sites: how many probes must see it at the same time for a "target" incident
    site_share: when one probe sees a problem on at least this share of all targets at once, it is
                that site's own uplink ("site" incident) rather than the targets.
    join_s:     problems on the same target less than this far apart are one incident (random loss
                has short gaps without loss).

    Returns {"step", "incidents": [...], "buckets": {t: {"target": n, "site": {pid: n}}}}"""
    step, grid, locs = align(per_probe)
    pids = [p for p in per_probe if isinstance(per_probe[p], dict) and "series" in per_probe[p]]
    normal = {h: {p: _median([v[0] for v in grid[h].get(p, {}).values()]) for p in pids} for h in grid}
    nhosts = {p: sum(1 for h in grid if p in grid[h]) for p in pids}

    def over(sig, v, base):
        if v is None:
            return None
        avg, loss, jit = v
        if sig == "loss" and th.get("loss") is not None and loss is not None and loss > th["loss"]:
            return loss
        if sig == "jitter" and th.get("jitter") is not None and jit is not None and jit > th["jitter"]:
            return jit
        if sig == "delay" and th.get("delay") is not None and avg is not None and base is not None and avg - base > th["delay"]:
            return avg - base
        return None

    hits = {}            # (host, sig, t) -> {pid: value}
    site_load = {}       # (pid, t) -> number of hosts over any threshold
    for h, by in grid.items():
        ts = sorted({t for p in by for t in by[p]})
        for t in ts:
            for sig in SIGNALS:
                vals = {}
                for p in pids:
                    x = over(sig, by.get(p, {}).get(t), normal[h].get(p))
                    if x is not None:
                        vals[p] = x
                if vals:
                    hits[(h, sig, t)] = vals
                    for p in vals:
                        site_load[(p, t)] = site_load.get((p, t), 0) + (1 if sig == "loss" else 0)
    # a site whose own link is bad: many of its targets at once
    site_bad = {k for k, n in site_load.items() if nhosts.get(k[0]) and n >= max(2, site_share * nhosts[k[0]])}
    items = []
    for (h, sig, t), vals in hits.items():
        seen = [p for p in vals]
        if len(seen) >= min_sites:
            kind = "target"
        elif all((p, t) in site_bad for p in seen):
            kind = "site"
        else:
            kind = "path"          # one site only, but not its whole uplink: the path from that site
        items.append((h, sig, kind, tuple(sorted(seen)) if kind != "target" else (), t, vals))
    # join neighbouring buckets of the same host / signal / kind into one incident
    items.sort(key=lambda x: (x[0], x[1], x[2], x[3], x[4]))
    gap = max(2 * step, join_s)
    inc = []
    for h, sig, kind, who, t, vals in items:
        c = inc[-1] if inc else None
        if c and c["host"] == h and c["signal"] == sig and c["kind"] == kind and c["_who"] == who and t - c["t1"] <= gap:
            c["t1"] = t
            c["buckets"] += 1
            for p, v in vals.items():
                c["worst"][p] = max(c["worst"].get(p, 0), v)
            c["sites"] = sorted(set(c["sites"]) | set(vals))
        else:
            inc.append({"host": h, "location": locs.get(h, h), "signal": sig, "kind": kind, "_who": who, "t0": t, "t1": t,
                        "buckets": 1, "worst": dict(vals), "sites": sorted(vals)})
    for c in inc:
        c.pop("_who")
        c["t1"] += step
    # with random loss a single bucket often shows on one site only in the middle of an incident that
    # every site sees: such fragments belong to that incident
    tg = [c for c in inc if c["kind"] == "target"]
    keep = []
    for c in inc:
        if c["kind"] != "target":
            host = next((t for t in tg if t["host"] == c["host"] and t["signal"] == c["signal"]
                         and c["t0"] >= t["t0"] - gap and c["t1"] <= t["t1"] + gap), None)
            if host:
                for p, v in c["worst"].items():
                    host["worst"][p] = max(host["worst"].get(p, 0), v)
                host["t0"], host["t1"] = min(host["t0"], c["t0"]), max(host["t1"], c["t1"])
                continue
        keep.append(c)
    inc = keep
    for c in inc:
        c["site_names"] = [names.get(p, p) for p in c["sites"]]
        c["worst"] = {names.get(p, p): round(v, 2) for p, v in c["worst"].items()}
    inc.sort(key=lambda c: -c["t0"])
    buckets = {}
    for (h, sig, t), vals in hits.items():
        b = buckets.setdefault(t, {"target": 0, "path": 0, "site": 0})
        if len(vals) >= min_sites:
            b["target"] += 1
        elif all((p, t) in site_bad for p in vals):
            b["site"] += 1
        else:
            b["path"] += 1
    return {"step": step, "incidents": inc, "buckets": sorted([t, b["target"], b["path"], b["site"]] for t, b in buckets.items())}


class CrossCapture:
    """When a probe starts an automatic MTR, ask the other probes for the same trace at once.

    A site that sees nothing still gives a clean run of the same moment to put next to the bad one,
    which is what a DC asks for. A probe that has its own run to the target around then (it saw the
    problem too) is left alone. Per target a cooldown, and an hourly cap across all targets."""
    POLL_S = 15
    NEAR_S = 300           # a probe's own run this close counts as "already has one"

    def __init__(self, cfg, call_fn=None, each_fn=None):
        self.cfg = cfg
        self.call = call_fn or call
        self.each = each_fn or each
        self.since = time.time()
        self.seen = {}                     # (probe id, run id) -> time seen
        self.last = {}                     # host -> time of the last cross-site request
        self.sent = collections.deque()    # times of requests, for the hourly cap
        self.log = collections.deque(maxlen=30)

    def start(self):
        threading.Thread(target=self._loop, name="cross", daemon=True).start()

    def _loop(self):
        while True:
            time.sleep(self.POLL_S)
            try:
                self.tick()
            except Exception:
                log.exception("cross-site MTR")

    def tick(self, now=None):
        now = now or time.time()
        x = self.cfg.get()["cross"]
        ps = [p for p in self.cfg.probes() if p["enabled"]]
        if not x["enabled"] or len(ps) < 2:
            return
        for k in [k for k, t in self.seen.items() if t < now - 7200]:
            del self.seen[k]
        frm = max(self.since, now - 1800)
        res = self.each(ps, lambda p: self.call(p, f"/api/mtr?trig=auto&limit=50&from={int(frm)}", timeout=10))
        new = []
        for p in ps:
            for r in (res.get(p["id"]) or {}).get("runs", []):
                k = (p["id"], r["id"])
                if k not in self.seen:
                    self.seen[k] = now
                    new.append((r["created"], p, r))
        for _, origin, r in sorted(new, key=lambda z: z[0]):
            self._one(origin, r, ps, x, now)

    def _one(self, origin, r, ps, x, now):
        host = r["host"]
        while self.sent and self.sent[0] < now - 3600:
            self.sent.popleft()
        if now - self.last.get(host, 0) < x["cooldown_min"] * 60:
            return
        if len(self.sent) >= x["max_per_hour"]:
            self._note(now, host, origin, [], "hourly cap reached")
            return
        t0 = r["created"] - self.NEAR_S

        def ask(p):
            st = self.call(p, "/api/status", timeout=8)
            if not any(t["host"] == host and t["enabled"] for t in st.get("targets", [])):
                return "no such target"
            own = self.call(p, f"/api/mtr?host={urllib.parse.quote(host)}&from={int(t0)}&limit=5", timeout=10)
            if [o for o in own.get("runs", []) if o.get("status") != "failed"]:
                return "has its own run"
            body = {"hosts": [host], "mode": r.get("mode") or "icmp", "port": r.get("port"), "cycles": r.get("cycles"),
                    "trig": "cross", "note": f"{origin['name']} saw a problem ({r.get('reason') or 'automatic'}), its run #{r['id']}"}
            return "started #" + ",".join(str(i) for i in self.call(p, "/api/mtr", body, timeout=20).get("ids", []))
        others = [p for p in ps if p["id"] != origin["id"]]
        out = self.each(others, ask)
        started = [p["name"] for p in others if str(out.get(p["id"], "")).startswith("started")]
        self.last[host] = now
        if started:
            self.sent.append(now)
        self._note(now, host, origin, [(p["name"], out.get(p["id"]) if not isinstance(out.get(p["id"]), dict)
                                         else out[p["id"]].get("error")) for p in others])

    def _note(self, now, host, origin, results, why=None):
        self.log.appendleft({"t": now, "host": host, "from": origin["name"], "results": results, "note": why})
