"""SQLite storage, packed so that a year of 1-second pings for 50+ targets stays around 250 MB.

raw  one row per target per minute:  60 x uint16 RTT in 0.1 ms   (0 = no ping, 0xFFFF = lost)
m1   one row per target per hour:    60 x minute record           (kept for months)
m5   one row per target per day:    288 x 5-minute record         (kept for a year)

A record is <BBHHHH: sent, lost, min, avg, max, jitter (RTT values in 0.1 ms; sent = 0 means no data).
"""
import json
import sqlite3
import struct
import threading
import time

LOST = 0xFFFF
REC = struct.Struct("<BBHHHH")
EMPTY_REC = REC.pack(0, 0, 0, 0, 0, 0)


def ms_to_u16(ms: float) -> int:
    return max(1, min(LOST - 1, int(round(ms * 10))))


def rec_from_samples(slots) -> bytes:
    """Minute record from up to 60 raw slots."""
    sent = lost = 0
    rtts = []
    jit = []
    prev = None
    for v in slots:
        if v == 0:
            continue
        sent += 1
        if v == LOST:
            lost += 1
            continue
        rtts.append(v)
        if prev is not None:
            jit.append(abs(v - prev))
        prev = v
    if not sent:
        return EMPTY_REC
    if rtts:
        return REC.pack(min(sent, 255), min(lost, 255), min(rtts), int(round(sum(rtts) / len(rtts))), max(rtts),
                        int(round(sum(jit) / len(jit))) if jit else 0)
    return REC.pack(min(sent, 255), min(lost, 255), 0, 0, 0, 0)


def merge_recs(recs) -> bytes:
    sent = lost = 0
    mn, mx = None, 0
    s_avg = s_jit = n = 0
    for r in recs:
        a = REC.unpack(r) if isinstance(r, (bytes, bytearray)) else r
        if not a[0]:
            continue
        sent += a[0]
        lost += a[1]
        got = a[0] - a[1]
        if got > 0:
            mn = a[2] if mn is None else min(mn, a[2])
            mx = max(mx, a[4])
            s_avg += a[3] * got
            s_jit += a[5] * got
            n += got
    if not sent:
        return EMPTY_REC
    if not n:
        return REC.pack(min(sent, 255), min(lost, 255), 0, 0, 0, 0)
    return REC.pack(min(sent, 255), min(lost, 255), mn, int(round(s_avg / n)), mx, int(round(s_jit / n)))


class Acc:
    """Accumulates samples or records into one chart bucket."""
    __slots__ = ("sent", "lost", "mn", "mx", "s", "n", "js", "jn")

    def __init__(self):
        self.sent = self.lost = self.n = self.jn = 0
        self.mn = None
        self.mx = 0
        self.s = self.js = 0.0

    def rec(self, sent, lost, mn, avg, mx, jit):
        if not sent:
            return
        self.sent += sent
        self.lost += lost
        got = sent - lost
        if got > 0:
            self.mn = mn if self.mn is None else min(self.mn, mn)
            self.mx = max(self.mx, mx)
            self.s += avg * got
            self.n += got
            self.js += jit * got
            self.jn += got

    def out(self):
        if not self.sent:
            return None
        return {"sent": self.sent, "lost": self.lost, "loss": round(100.0 * self.lost / self.sent, 2),
                "avg": round(self.s / self.n / 10, 2) if self.n else None,
                "min": round(self.mn / 10, 2) if self.n else None,
                "max": round(self.mx / 10, 2) if self.n else None,
                "jitter": round(self.js / self.jn / 10, 2) if self.jn else None}


class Store:
    def __init__(self, path: str):
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=30)
        self.lock = threading.RLock()
        with self.lock:
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA synchronous=NORMAL")
            for t in ("raw", "m1", "m5"):
                self.db.execute(f"CREATE TABLE IF NOT EXISTS {t} (host TEXT, t INTEGER, d BLOB, PRIMARY KEY(host, t)) WITHOUT ROWID")
            self.db.execute("""CREATE TABLE IF NOT EXISTS mtr (id INTEGER PRIMARY KEY, created REAL, started REAL,
                finished REAL, host TEXT, location TEXT, mode TEXT, port INTEGER, cycles INTEGER, trig TEXT,
                reason TEXT, status TEXT, error TEXT, dst_loss REAL, hops INTEGER, result TEXT, report TEXT)""")
            self.db.execute("CREATE INDEX IF NOT EXISTS mtr_created ON mtr(created)")
            self.db.execute("""CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, t REAL, kind TEXT,
                host TEXT, location TEXT, level TEXT, data TEXT)""")
            self.db.execute("CREATE INDEX IF NOT EXISTS events_t ON events(t)")

    # ---------------------------------------------------------------- writes
    def write_minutes(self, items) -> None:
        """items: [(host, minute_start, slots[60])]. Updates raw, m1 and m5 in one transaction."""
        if not items:
            return
        with self.lock:
            cur = self.db.cursor()
            cur.execute("BEGIN")
            try:
                for host, m, slots in items:
                    old = cur.execute("SELECT d FROM raw WHERE host=? AND t=?", (host, m)).fetchone()
                    if old:   # a restart in the middle of a minute: keep what was there
                        prev = struct.unpack("<60H", old[0])
                        slots = [s if s else p for s, p in zip(slots, prev)]
                    cur.execute("INSERT OR REPLACE INTO raw VALUES (?,?,?)", (host, m, struct.pack("<60H", *slots)))
                    rec = rec_from_samples(slots)
                    hour = m - m % 3600
                    row = cur.execute("SELECT d FROM m1 WHERE host=? AND t=?", (host, hour)).fetchone()
                    d1 = bytearray(row[0]) if row else bytearray(EMPTY_REC * 60)
                    i = (m - hour) // 60
                    d1[i * REC.size:(i + 1) * REC.size] = rec
                    cur.execute("INSERT OR REPLACE INTO m1 VALUES (?,?,?)", (host, hour, bytes(d1)))
                    k = i // 5
                    five = merge_recs(bytes(d1[j * REC.size:(j + 1) * REC.size]) for j in range(k * 5, k * 5 + 5))
                    day = m - m % 86400
                    row = cur.execute("SELECT d FROM m5 WHERE host=? AND t=?", (host, day)).fetchone()
                    d5 = bytearray(row[0]) if row else bytearray(EMPTY_REC * 288)
                    j = (m - day) // 300
                    d5[j * REC.size:(j + 1) * REC.size] = five
                    cur.execute("INSERT OR REPLACE INTO m5 VALUES (?,?,?)", (host, day, bytes(d5)))
                cur.execute("COMMIT")
            except Exception:
                cur.execute("ROLLBACK")
                raise

    def import_records(self, host: str, tier: str, recs) -> int:
        """recs: [(t, sent, lost, min_ms, avg_ms, max_ms, jitter_ms)] into m1 (t = minute) or m5 (t = 5 min).
        Used by the Netdata history import. Existing data is never overwritten."""
        size, span, slot = (60, 3600, 60) if tier == "m1" else (288, 86400, 300)
        rows = {}
        for t, sent, lost, mn, avg, mx, jit in recs:
            base = int(t) - int(t) % span
            rows.setdefault(base, []).append((int(t), sent, lost, mn, avg, mx, jit))
        n = 0
        with self.lock:
            cur = self.db.cursor()
            cur.execute("BEGIN")
            for base, items in rows.items():
                row = cur.execute(f"SELECT d FROM {tier} WHERE host=? AND t=?", (host, base)).fetchone()
                d = bytearray(row[0]) if row else bytearray(EMPTY_REC * size)
                for t, sent, lost, mn, avg, mx, jit in items:
                    i = (t - base) // slot
                    if REC.unpack_from(d, i * REC.size)[0]:
                        continue
                    got = sent - lost
                    v = (lambda x: ms_to_u16(x) if (got > 0 and x is not None) else 0)
                    REC.pack_into(d, i * REC.size, min(255, sent), min(255, lost), v(mn), v(avg), v(mx), v(jit))
                    n += 1
                cur.execute(f"INSERT OR REPLACE INTO {tier} VALUES (?,?,?)", (host, base, bytes(d)))
            cur.execute("COMMIT")
        return n

    # ---------------------------------------------------------------- reads
    def series(self, hosts, t0: int, t1: int, points: int, retention: dict, now=None, live=None):
        """Buckets for each host: {host: [(t, acc_dict or None)]}, plus the tier used and the bucket step.
        live: {(host, minute): slots} not yet written (the current minute), merged into raw reads."""
        now = now or time.time()
        points = max(10, min(2000, int(points)))
        span = max(60, t1 - t0)
        step = max(1, span / points)
        if step < 60 and t0 >= now - retention["raw_days"] * 86400 - 60:
            tier = "raw"
        elif step < 300 and t0 >= now - retention["m1_days"] * 86400 - 3600:
            tier = "m1"
        else:
            tier = "m5"
        if tier == "raw":
            step = max(1, int(round(step)))
        elif tier == "m1":
            step = max(60, int(round(step / 60)) * 60)
        else:
            step = max(300, int(round(step / 300)) * 300)
        t0 = int(t0 - t0 % step)
        nb = int((t1 - t0) // step) + 1
        out = {}
        with self.lock:
            for host in hosts:
                accs = [Acc() for _ in range(nb)]
                if tier == "raw":
                    rows = {m: list(struct.unpack("<60H", d)) for m, d in self.db.execute(
                        "SELECT t, d FROM raw WHERE host=? AND t>=? AND t<=?", (host, t0 - 60, t1))}
                    for (lh, m), slots in (live or {}).items():
                        if lh == host and t0 - 60 <= m <= t1:
                            base = rows.get(m) or [0] * 60
                            rows[m] = [s if s else b for s, b in zip(slots, base)]
                    prev = None
                    for m in sorted(rows):
                        for i, v in enumerate(rows[m]):
                            if not v:
                                continue
                            ts = m + i
                            b = int((ts - t0) // step)
                            if not 0 <= b < nb:
                                continue
                            a = accs[b]
                            if v == LOST:
                                a.sent += 1
                                a.lost += 1
                                continue
                            a.sent += 1
                            a.mn = v if a.mn is None else min(a.mn, v)
                            a.mx = max(a.mx, v)
                            a.s += v
                            a.n += 1
                            if prev is not None and ts - prev[0] <= 10:
                                a.js += abs(v - prev[1])
                                a.jn += 1
                            prev = (ts, v)
                else:
                    span_row, slot, size = (3600, 60, 60) if tier == "m1" else (86400, 300, 288)
                    q = self.db.execute(f"SELECT t, d FROM {tier} WHERE host=? AND t>=? AND t<=? ORDER BY t",
                                        (host, t0 - span_row, t1))
                    for base, d in q:
                        for i in range(size):
                            ts = base + i * slot
                            b = int((ts - t0) // step)
                            if 0 <= b < nb:
                                accs[b].rec(*REC.unpack_from(d, i * REC.size))
                out[host] = [(t0 + i * step, a.out()) for i, a in enumerate(accs)]
        return out, tier, step

    def raw_samples(self, host: str, t0: int, t1: int):
        """[(ts, rtt_ms or None for lost)] - for the live view."""
        res = []
        with self.lock:
            for m, d in self.db.execute("SELECT t, d FROM raw WHERE host=? AND t>=? AND t<=? ORDER BY t",
                                        (host, t0 - 60, t1)):
                for i, v in enumerate(struct.unpack("<60H", d)):
                    if v and t0 <= m + i <= t1:
                        res.append((m + i, None if v == LOST else v / 10))
        return res

    # ---------------------------------------------------------------- mtr + events
    def mtr_add(self, **kw) -> int:
        cols = ",".join(kw)
        with self.lock:
            cur = self.db.execute(f"INSERT INTO mtr ({cols}) VALUES ({','.join('?' * len(kw))})", tuple(kw.values()))
            return cur.lastrowid

    def mtr_update(self, rid: int, **kw) -> None:
        with self.lock:
            self.db.execute(f"UPDATE mtr SET {','.join(k + '=?' for k in kw)} WHERE id=?", (*kw.values(), rid))

    MTR_LIST = "id, created, started, finished, host, location, mode, port, cycles, trig, reason, status, error, dst_loss, hops"

    def mtr_list(self, limit=200, host=None, t0=None, t1=None):
        q, a = f"SELECT {self.MTR_LIST} FROM mtr WHERE 1=1", []
        if host:
            q += " AND host=?"
            a.append(host)
        if t0:
            q += " AND created>=?"
            a.append(t0)
        if t1:
            q += " AND created<=?"
            a.append(t1)
        q += " ORDER BY id DESC LIMIT ?"
        a.append(int(limit))
        names = [c.strip() for c in self.MTR_LIST.split(",")]
        with self.lock:
            return [dict(zip(names, r)) for r in self.db.execute(q, a)]

    def mtr_get(self, rid: int):
        with self.lock:
            cur = self.db.execute("SELECT * FROM mtr WHERE id=?", (rid,))
            r = cur.fetchone()
            if not r:
                return None
            d = dict(zip([c[0] for c in cur.description], r))
        d["result"] = json.loads(d["result"]) if d["result"] else None
        return d

    def event(self, kind, host=None, location=None, level=None, **data) -> None:
        with self.lock:
            self.db.execute("INSERT INTO events (t, kind, host, location, level, data) VALUES (?,?,?,?,?,?)",
                            (time.time(), kind, host, location, level, json.dumps(data) if data else None))

    def events(self, t0=None, t1=None, limit=500):
        q, a = "SELECT t, kind, host, location, level, data FROM events WHERE 1=1", []
        if t0:
            q += " AND t>=?"
            a.append(t0)
        if t1:
            q += " AND t<=?"
            a.append(t1)
        q += " ORDER BY id DESC LIMIT ?"
        a.append(int(limit))
        with self.lock:
            return [{"t": t, "kind": k, "host": h, "location": l, "level": lv, **(json.loads(d) if d else {})}
                    for t, k, h, l, lv, d in self.db.execute(q, a)]

    # ---------------------------------------------------------------- housekeeping
    def cleanup(self, ret: dict, now=None) -> None:
        now = now or time.time()
        with self.lock:
            self.db.execute("DELETE FROM raw WHERE t<?", (now - ret["raw_days"] * 86400,))
            self.db.execute("DELETE FROM m1 WHERE t<?", (now - ret["m1_days"] * 86400 - 3600,))
            self.db.execute("DELETE FROM m5 WHERE t<?", (now - ret["m5_days"] * 86400 - 86400,))
            self.db.execute("DELETE FROM mtr WHERE created<?", (now - ret["mtr_days"] * 86400,))
            self.db.execute("DELETE FROM mtr WHERE id NOT IN (SELECT id FROM mtr ORDER BY id DESC LIMIT ?)",
                            (ret["mtr_max"],))
            self.db.execute("DELETE FROM events WHERE t<?", (now - ret["m5_days"] * 86400,))

    def size_info(self):
        with self.lock:
            pages = self.db.execute("PRAGMA page_count").fetchone()[0]
            psize = self.db.execute("PRAGMA page_size").fetchone()[0]
            counts = {t: self.db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("raw", "m1", "m5", "mtr")}
        return {"bytes": pages * psize, **counts}
