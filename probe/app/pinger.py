"""Runs fping in loop mode for all enabled targets and turns its output into per-second samples.

Loss is decided by sequence numbers, not by fping's own "timed out" lines alone: every sequence
number that has no reply once its timeout has passed is a lost ping. That also covers ICMP errors
(host unreachable) and replies that never come.
"""
import collections
import logging
import math
import re
import subprocess
import threading
import time

from config import group as _group, place as _place
from store import LOST, ms_to_u16

log = logging.getLogger("pinger")

LINE = re.compile(r"^\[(\d+\.\d+)\]\s+(\S+)\s+:\s+\[(\d+)\],\s+(?:(\d+) bytes, ([\d.]+) ms|timed out)")


class HostState:
    __slots__ = ("host", "next_seq", "got", "anchor", "index", "recent", "status", "since", "last_rtt", "last_t")

    def __init__(self, host, index, keep):
        self.host = host
        self.index = index          # position in the fping target list (send offset inside a round)
        self.next_seq = 0           # every seq below this is accounted for
        self.got = set()            # seqs >= next_seq already recorded
        self.anchor = None          # (seq, send_time) of the latest reply
        self.recent = collections.deque(maxlen=keep)   # (second, rtt_ms or None)
        self.status = "unknown"
        self.since = time.time()
        self.last_rtt = None
        self.last_t = None


def parse_line(line: str):
    """-> (recv_time, host, seq, rtt_ms or None) or None for lines that are not ping results."""
    m = LINE.match(line)
    if not m:
        return None
    return float(m.group(1)), m.group(2), int(m.group(3)), (float(m.group(5)) if m.group(5) else None)


def stats(samples):
    """Loss %, avg / last RTT and jitter from [(second, rtt_ms or None)]."""
    sent = len(samples)
    if not sent:
        return {"sent": 0, "loss": None, "avg": None, "jitter": None}
    rtts = [r for _, r in samples if r is not None]
    jit = [abs(b - a) for a, b in zip(rtts, rtts[1:])]
    return {"sent": sent, "loss": round(100.0 * (sent - len(rtts)) / sent, 1),
            "avg": round(sum(rtts) / len(rtts), 2) if rtts else None,
            "jitter": round(sum(jit) / len(jit), 2) if jit else None}


class Pinger:
    def __init__(self, cfg, store, on_minutes=None):
        self.cfg = cfg
        self.store = store
        self.lock = threading.RLock()
        self.proc = None
        self.hosts = {}
        self.minutes = {}            # (host, minute) -> [60 slots]
        self.started = 0.0
        self.period = 1.0
        self.timeout = 1.0
        self.inter = 0.01
        self.error = None
        self.restart_wanted = threading.Event()
        self.stop_wanted = threading.Event()
        self.listeners = []          # fn(host_state, stats) after every evaluation
        self.on_alert = None         # fn(host, location, old, new, stats)

    # ---------------------------------------------------------------- process
    def start(self) -> None:
        threading.Thread(target=self._run, name="fping", daemon=True).start()
        threading.Thread(target=self._sweeper, name="sweeper", daemon=True).start()

    def restart(self) -> None:
        self.restart_wanted.set()
        p = self.proc
        if p:
            try:
                p.terminate()
            except OSError:
                pass

    def stop(self) -> None:
        self.stop_wanted.set()
        self.restart()
        self.flush(final=True)

    def _targets(self, c):
        return [t["host"] for t in c["targets"] if t["enabled"]]

    def _run(self) -> None:
        backoff = 1
        while not self.stop_wanted.is_set():
            c = self.cfg.get()
            hosts = self._targets(c)
            self.restart_wanted.clear()
            if not hosts:
                with self.lock:
                    self.hosts = {}
                    self.error = None
                self.restart_wanted.wait(5)
                continue
            p = c["ping"]
            self.period = p["interval_ms"] / 1000
            self.timeout = p["timeout_ms"] / 1000
            self.inter = max(0.001, min(0.01, self.period / max(1, len(hosts)) / 2))
            keep = max(c["alerts"]["window_s"], c["auto_mtr"]["window_s"]) * max(1, math.ceil(1 / self.period)) + 5
            cmd = ["fping", "-l", "-D", "-p", str(p["interval_ms"]), "-t", str(p["timeout_ms"]),
                   "-b", str(p["size"]), "-i", str(max(1, int(self.inter * 1000))), "-r", "0", "--"] + hosts
            with self.lock:
                old = self.hosts
                self.hosts = {}
                for i, h in enumerate(hosts):
                    st = HostState(h, i, keep)
                    if h in old:      # keep live history and alert state over a restart
                        st.recent.extend(old[h].recent)
                        st.status, st.since = old[h].status, old[h].since
                        st.last_rtt, st.last_t = old[h].last_rtt, old[h].last_t
                    self.hosts[h] = st
            log.info("starting fping for %d targets", len(hosts))
            try:
                self.started = time.time()
                self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
            except OSError as e:
                self.error = f"cannot start fping: {e}"
                log.error(self.error)
                time.sleep(min(60, backoff))
                backoff *= 2
                continue
            err_lines = collections.deque(maxlen=5)
            threading.Thread(target=self._read_err, args=(self.proc, err_lines), daemon=True).start()
            for line in self.proc.stdout:
                r = parse_line(line)
                if r:
                    self._sample(*r)
            rc = self.proc.wait()
            if self.restart_wanted.is_set() or self.stop_wanted.is_set():
                self.error = None
                backoff = 1
                continue
            self.error = f"fping stopped (exit {rc}): {' / '.join(err_lines) or 'no message'}"
            log.warning(self.error)
            time.sleep(min(60, backoff))
            backoff = min(60, backoff * 2)

    def _read_err(self, proc, keep) -> None:
        for line in proc.stderr:
            line = line.strip()
            # ICMP errors for single packets are normal during an outage; the sweep counts them as lost.
            if line and not line.startswith("ICMP "):
                keep.append(line)
                log.debug("fping: %s", line)

    # ---------------------------------------------------------------- samples
    def _record(self, st: HostState, seq: int, send_t: float, rtt) -> None:
        sec = int(send_t)
        m = sec - sec % 60
        slots = self.minutes.get((st.host, m))
        if slots is None:
            slots = self.minutes[(st.host, m)] = [0] * 60
        slots[sec - m] = LOST if rtt is None else ms_to_u16(rtt)
        st.recent.append((sec, rtt))
        if rtt is not None:
            st.last_rtt, st.last_t = rtt, send_t

    def _sample(self, recv_t, host, seq, rtt) -> None:
        with self.lock:
            st = self.hosts.get(host)
            if not st or seq < st.next_seq or seq in st.got:
                return
            if rtt is not None:
                send_t = recv_t - rtt / 1000
                st.anchor = (seq, send_t)
            else:
                send_t = self._send_time(st, seq)
            self._record(st, seq, send_t, rtt)
            st.got.add(seq)
            while st.next_seq in st.got:
                st.got.discard(st.next_seq)
                st.next_seq += 1

    def _send_time(self, st, seq) -> float:
        if st.anchor:
            return st.anchor[1] + (seq - st.anchor[0]) * self.period
        return self.started + seq * self.period + st.index * self.inter

    def _sweep(self, now) -> None:
        """Mark every seq whose timeout has passed without a reply as lost."""
        with self.lock:
            n = len(self.hosts)
            for st in self.hosts.values():
                limit = math.floor((now - self.started - self.timeout - n * self.inter - 0.5) / self.period)
                while st.next_seq <= limit:
                    if st.next_seq in st.got:
                        st.got.discard(st.next_seq)
                    else:
                        self._record(st, st.next_seq, self._send_time(st, st.next_seq), None)
                    st.next_seq += 1

    def flush(self, final=False) -> None:
        """Write finished minutes (or everything on shutdown) to the store."""
        now = time.time()
        cutoff = now - self.timeout - 3
        with self.lock:
            done = [k for k in self.minutes if final or k[1] + 60 <= cutoff]
            items = [(h, m, self.minutes.pop((h, m))) for h, m in done]
        if items:
            try:
                self.store.write_minutes(items)
            except Exception:
                log.exception("writing samples failed")

    def _sweeper(self) -> None:
        last_flush = 0
        while not self.stop_wanted.is_set():
            now = time.time()
            if self.proc and self.proc.poll() is None:
                self._sweep(now)
            self._evaluate(now)
            if now - last_flush >= 10:
                self.flush()
                last_flush = now
            time.sleep(1 - (time.time() % 1) + 0.05)

    # ---------------------------------------------------------------- live status + alerts
    def window(self, st, seconds, now=None):
        now = int(now or time.time())
        with self.lock:      # the fping reader appends to recent at the same time
            items = list(st.recent)
        return [x for x in items if x[0] > now - seconds - self.timeout - 2]

    def _evaluate(self, now) -> None:
        c = self.cfg.get()
        a = c["alerts"]
        locs = {t["host"]: _group(t) for t in c["targets"]}
        with self.lock:
            items = list(self.hosts.values())
        for st in items:
            s = stats(self.window(st, a["window_s"], now))
            if not s["sent"]:
                level = "unknown"
            elif s["loss"] >= 100:
                level = "down"
            elif s["loss"] >= a["loss_crit"] or (a["rtt_crit_ms"] and s["avg"] and s["avg"] >= a["rtt_crit_ms"]):
                level = "crit"
            elif s["loss"] >= a["loss_warn"] or (a["rtt_warn_ms"] and s["avg"] and s["avg"] >= a["rtt_warn_ms"]):
                level = "warn"
            else:
                level = "ok"
            if level != st.status:
                old, st.status, st.since = st.status, level, now
                # the first ok after a start is not news; everything else is an event
                if self.on_alert and (old != "unknown" or level not in ("ok", "unknown")):
                    try:
                        self.on_alert(st.host, locs.get(st.host, st.host), old, level, s)
                    except Exception:
                        log.exception("alert handler failed")
            for fn in self.listeners:
                try:
                    fn(st, locs.get(st.host, st.host), c)
                except Exception:
                    log.exception("listener failed")

    def status(self):
        c = self.cfg.get()
        w = c["alerts"]["window_s"]
        out = []
        with self.lock:
            hosts = dict(self.hosts)
        for t in c["targets"]:
            st = hosts.get(t["host"])
            s = stats(self.window(st, w)) if st else {"sent": 0, "loss": None, "avg": None, "jitter": None}
            out.append({**t, **s, "dc": t["location"], "location": _place(t), "group": _group(t), "status": (st.status if st else ("disabled" if not t["enabled"] else "unknown")),
                        "since": st.since if st else None, "last_rtt": st.last_rtt if st else None,
                        "last_t": st.last_t if st else None})
        return out
