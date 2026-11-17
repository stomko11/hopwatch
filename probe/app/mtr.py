"""MTR runs (on demand and automatic), the text report support teams ask for, and the TCP port check."""
import json
import logging
import socket
import subprocess
import threading
import time
import urllib.request
from datetime import datetime, timezone

log = logging.getLogger("mtr")


def build_cmd(host, mode, port, cycles, interval, resolve, asn):
    cmd = ["mtr", "--json", "-c", str(int(cycles)), "-i", str(interval)]
    cmd.append("-b" if resolve else "-n")
    if asn:
        cmd.append("-z")
    if mode == "tcp":
        cmd += ["-T", "-P", str(int(port))]
    elif mode == "udp":
        cmd += ["-u"]
    return cmd + ["--", host]


def _host_parts(h: str):
    """mtr -b gives 'name (ip)'; -n gives 'ip'."""
    if h.endswith(")") and " (" in h:
        name, ip = h[:-1].split(" (", 1)
        return name, ip
    return h, h


def summarize(result: dict):
    hubs = (result.get("report") or {}).get("hubs") or []
    if not hubs:
        return None, 0
    return float(hubs[-1].get("Loss%", 0.0)), len(hubs)


def report_text(result: dict, meta: dict) -> str:
    """Plain text in the layout of `mtr -rwbz`, with a header that tells support who, what and when."""
    rep = result.get("report") or {}
    hubs = rep.get("hubs") or []
    started = datetime.fromtimestamp(meta["started"], timezone.utc)
    mode = {"icmp": "ICMP", "tcp": f"TCP port {meta.get('port')}", "udp": "UDP"}.get(meta["mode"], meta["mode"])
    lines = [
        f"MTR from {meta.get('site') or 'probe'}" + (f" (public IP {meta['public_ip']})" if meta.get("public_ip") else ""),
        f"Target:  {meta['host']}" + (f"  [{meta['location']}]" if meta.get("location") and meta["location"] != meta["host"] else ""),
        f"Mode:    {mode}, {meta['cycles']} cycles, {meta['interval']} s interval",
        f"Start:   {started.strftime('%Y-%m-%d %H:%M:%S')} UTC" + (f"  (automatic: {meta['reason']})" if meta.get("trig") == "auto" else ""),
        "",
    ]
    rows = []
    for h in hubs:
        rows.append((f"{h.get('count', 0):3d}.", h.get("ASN", ""), h.get("host", "???"),
                     f"{h.get('Loss%', 0):5.1f}%", f"{h.get('Snt', 0):5d}", f"{h.get('Last', 0):6.1f}",
                     f"{h.get('Avg', 0):6.1f}", f"{h.get('Best', 0):6.1f}", f"{h.get('Wrst', 0):6.1f}",
                     f"{h.get('StDev', 0):6.1f}"))
    hw = max([len(r[2]) for r in rows] + [20])
    aw = max([len(r[1]) for r in rows] + [0])
    head = f"HOST: {(meta.get('site') or 'probe')}"
    lines.append(f"{head:<{5 + (aw + 1 if aw else 0) + hw}}  Loss%   Snt   Last    Avg   Best   Wrst  StDev")
    for r in rows:
        asn = f"{r[1]:<{aw}} " if aw else ""
        lines.append(f"{r[0]} {asn}{r[2]:<{hw}} {r[3]} {r[4]} {r[5]} {r[6]} {r[7]} {r[8]} {r[9]}")
    return "\n".join(lines) + "\n"


class PublicIP:
    def __init__(self):
        self.value, self.t, self.url = None, 0, None

    def get(self, url):
        if not url:
            return None
        if url == self.url and time.time() - self.t < 600:     # also remembers a failure, so runs don't wait each time
            return self.value
        self.url, self.t = url, time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "hopwatch-probe"}), timeout=5) as r:
                v = r.read(64).decode().strip()
            if v and all(ch in "0123456789abcdefABCDEF.:" for ch in v):
                self.value = v
        except Exception as e:
            log.info("public IP lookup failed: %s", e)
        return self.value


class MtrRunner:
    def __init__(self, cfg, store):
        self.cfg = cfg
        self.store = store
        self.lock = threading.Lock()
        self.queue = []                 # run ids waiting
        self.running = {}               # id -> Popen
        self.cancelled = set()
        self.wake = threading.Event()
        self.public_ip = PublicIP()
        self.auto_last = {}             # cooldown key -> time
        self.auto_times = []            # times of automatic runs in the last hour
        self.tcp = {}                   # host -> {"state": open|refused|timeout|error, "t": time}
        self.tcp_lock = threading.Lock()
        self.tcp_last = 0
        self.tcp_wake = threading.Event()

    def start(self) -> None:
        threading.Thread(target=self._loop, name="mtr", daemon=True).start()
        threading.Thread(target=self._tcp_loop, name="tcpcheck", daemon=True).start()
        # runs that were queued or running when the container stopped will not finish any more
        with self.store.lock:
            self.store.db.execute("UPDATE mtr SET status='error', error='stopped by a restart' WHERE status IN ('queued','running')")

    # ---------------------------------------------------------------- queue
    def request(self, host, mode="icmp", port=None, cycles=None, trig="manual", reason=None) -> int:
        c = self.cfg.get()
        locs = {t["host"]: t["location"] for t in c["targets"]}
        if host not in locs:
            raise ValueError("MTR runs only to configured targets")
        if mode not in ("icmp", "tcp", "udp"):
            raise ValueError("mode must be icmp, tcp or udp")
        port = int(port or c["tcp_check"]["port"])
        if not 1 <= port <= 65535:
            raise ValueError("port out of range")
        cycles = int(cycles or c["mtr"]["cycles"])
        if not 5 <= cycles <= 1000:
            raise ValueError("cycles must be 5..1000")
        with self.lock:
            if len(self.queue) >= 200:
                raise ValueError("too many MTR runs waiting")
            rid = self.store.mtr_add(created=time.time(), host=host, location=locs[host], mode=mode,
                                     port=port if mode == "tcp" else None, cycles=cycles, trig=trig,
                                     reason=reason, status="queued")
            self.queue.append(rid)
        self.wake.set()
        return rid

    def cancel(self, rid: int) -> bool:
        with self.lock:
            if rid in self.queue:
                self.queue.remove(rid)
                self.store.mtr_update(rid, status="cancelled", finished=time.time())
                return True
            p = self.running.get(rid)
            if rid in self.running:
                self.cancelled.add(rid)
                if p:
                    p.terminate()
                return True
        return False

    def busy(self):
        with self.lock:
            return {"queued": list(self.queue), "running": list(self.running)}

    def _loop(self) -> None:
        while True:
            self.wake.wait(2)
            self.wake.clear()
            par = self.cfg.get()["mtr"]["max_parallel"]
            while True:
                with self.lock:
                    if not self.queue or len(self.running) >= par:
                        break
                    rid = self.queue.pop(0)
                    self.running[rid] = None
                threading.Thread(target=self._run, args=(rid,), daemon=True).start()

    def _run(self, rid: int) -> None:
        c = self.cfg.get()
        m = c["mtr"]
        row = self.store.mtr_get(rid)
        started = time.time()
        self.store.mtr_update(rid, status="running", started=started)
        cmd = build_cmd(row["host"], row["mode"], row["port"], row["cycles"], m["interval_s"], m["resolve"], m["asn"])
        status, error, result, report, dst_loss, hops = "error", None, None, None, None, None
        try:
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            with self.lock:
                self.running[rid] = p
                if rid in self.cancelled:    # cancelled between leaving the queue and starting
                    p.terminate()
            try:
                out, err = p.communicate(timeout=row["cycles"] * m["interval_s"] * 3 + 120)
            except subprocess.TimeoutExpired:
                p.kill()
                out, err = p.communicate()
                raise RuntimeError("mtr took too long and was stopped")
            if rid in self.cancelled:
                status, error = "cancelled", None
            elif p.returncode != 0:
                raise RuntimeError((err or out or f"exit {p.returncode}").strip()[:500])
            else:
                result = json.loads(out)
                dst_loss, hops = summarize(result)
                meta = {**row, "started": started, "interval": m["interval_s"], "site": c["site_name"] or socket.gethostname(),
                        "public_ip": self.public_ip.get(m["public_ip_url"])}
                report = report_text(result, meta)
                status = "done"
        except Exception as e:
            error = str(e)
            log.warning("mtr %s to %s failed: %s", rid, row["host"], error)
        finally:
            with self.lock:
                self.running.pop(rid, None)
                self.cancelled.discard(rid)
            self.store.mtr_update(rid, status=status, error=error, finished=time.time(),
                                  result=json.dumps(result) if result else None, report=report,
                                  dst_loss=dst_loss, hops=hops)
            self.wake.set()

    # ---------------------------------------------------------------- automatic capture
    def consider(self, st, location, c, pinger) -> None:
        """Called every second per target by the pinger. Starts an MTR when loss stays over the limit."""
        a = c["auto_mtr"]
        if not a["enabled"]:
            return
        from pinger import stats
        win = pinger.window(st, a["window_s"])
        if len(win) < max(5, a["window_s"] * 0.8 / pinger.period):
            return
        s = stats(win)
        if s["loss"] is None or s["loss"] < a["loss_pct"]:
            return
        now = time.time()
        key = location if a["per_location"] else st.host
        if now - self.auto_last.get(key, 0) < a["cooldown_min"] * 60:
            return
        self.auto_times = [t for t in self.auto_times if now - t < 3600]
        if len(self.auto_times) >= a["max_per_hour"]:
            return
        mode = a["mode"]
        if mode == "tcp_if_open":
            mode = "tcp" if self.tcp.get(st.host, {}).get("state") in ("open", "refused") else "icmp"
        self.auto_last[key] = now
        self.auto_times.append(now)
        reason = f"loss {s['loss']:.0f}% over {a['window_s']} s"
        try:
            rid = self.request(st.host, mode=mode, trig="auto", reason=reason)
            self.store.event("auto_mtr", host=st.host, location=location, level="info", mtr_id=rid, reason=reason)
        except ValueError as e:
            log.info("automatic MTR not started: %s", e)

    # ---------------------------------------------------------------- TCP port check
    def tcp_check_now(self) -> None:
        self.tcp_last = 0
        self.tcp_wake.set()

    def _tcp_loop(self) -> None:
        while True:
            c = self.cfg.get()
            tc = c["tcp_check"]
            if tc["enabled"] and time.time() - self.tcp_last >= tc["every_h"] * 3600:
                self.tcp_last = time.time()
                hosts = [t["host"] for t in c["targets"] if t["enabled"]]
                res = {}
                threads = []
                for h in hosts:
                    th = threading.Thread(target=lambda h=h: res.__setitem__(h, self._probe_tcp(h, tc["port"])), daemon=True)
                    th.start()
                    threads.append(th)
                    if len(threads) % 20 == 0:
                        time.sleep(0.2)
                for th in threads:
                    th.join(10)
                with self.tcp_lock:
                    self.tcp = {h: {"state": res.get(h, "error"), "port": tc["port"], "t": time.time()} for h in hosts}
            self.tcp_wake.wait(60)
            self.tcp_wake.clear()

    @staticmethod
    def _probe_tcp(host, port) -> str:
        try:
            infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError:
            return "error"
        fam, typ, proto, _, addr = infos[0]
        s = socket.socket(fam, typ, proto)
        s.settimeout(3)
        try:
            s.connect(addr)
            return "open"
        except ConnectionRefusedError:
            return "refused"     # the host answered with a reset: TCP MTR still reaches it
        except socket.timeout:
            return "timeout"
        except OSError:
            return "error"
        finally:
            s.close()
