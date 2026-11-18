import json
import os
import struct
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
sys.path.insert(1, os.path.join(os.path.dirname(__file__), "..", "..", "shared"))

import auth            # noqa: E402
import config          # noqa: E402
import mtr             # noqa: E402
import pinger          # noqa: E402
import store           # noqa: E402


class ParseTest(unittest.TestCase):
    def test_reply(self):
        r = pinger.parse_line("[1794955537.97993] 1.1.1.1   : [0], 64 bytes, 1.45 ms (1.45 avg, 0% loss)\n")
        self.assertEqual(r, (1794955537.97993, "1.1.1.1", 0, 1.45))

    def test_timeout(self):
        r = pinger.parse_line("[1794955540.12] 192.0.2.1 : [3], timed out (NaN avg, 100% loss)")
        self.assertEqual(r[1:], ("192.0.2.1", 3, None))

    def test_other_lines(self):
        self.assertIsNone(pinger.parse_line("ICMP Host Unreachable from 198.51.100.1 for ICMP Echo sent to 198.51.100.9"))
        self.assertIsNone(pinger.parse_line(""))


class FakeCfg:
    def __init__(self, c):
        self.c = c

    def get(self):
        return self.c


class SweepTest(unittest.TestCase):
    """Lost pings are found from missing sequence numbers once their timeout has passed."""

    def test_gap_becomes_loss(self):
        c = config.validate({"targets": [{"location": "A", "host": "192.0.2.1"}]})
        p = pinger.Pinger(FakeCfg(c), None)
        p.period, p.timeout, p.inter = 1.0, 1.0, 0.01
        p.started = 1000.0
        p.hosts = {"192.0.2.1": pinger.HostState("192.0.2.1", 0, 100)}
        p._sample(1000.02, "192.0.2.1", 0, 20.0)
        p._sample(1003.02, "192.0.2.1", 3, 20.0)      # 1 and 2 never answered
        p._sweep(1003.5)                                # not late enough for seq 2 yet
        st = p.hosts["192.0.2.1"]
        self.assertEqual([r for _, r in st.recent], [20.0, 20.0, None])
        p._sweep(1004.6)                                # seq 2 is past its timeout, seq 4 not yet sent+timed out
        self.assertEqual(sorted(s for s, r in st.recent if r is None), [1001, 1002])
        self.assertEqual(pinger.stats(list(st.recent))["loss"], 50.0)


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.s = store.Store(os.path.join(self.dir, "t.db"))
        self.ret = {"raw_days": 7, "m1_days": 90, "m5_days": 365}

    def test_minute_roundtrip_and_tiers(self):
        now = int(time.time())
        m = now - now % 60 - 600
        slots = [store.ms_to_u16(10 + i % 3) for i in range(60)]
        slots[5] = store.LOST
        slots[6] = 0
        self.s.write_minutes([("h", m, slots)])
        raw, tier, step = self.s.series(["h"], m, m + 59, 60, self.ret, now)
        self.assertEqual(tier, "raw")
        vals = [v for _, v in raw["h"] if v]
        self.assertEqual(sum(v["sent"] for v in vals), 59)
        self.assertEqual(sum(v["lost"] for v in vals), 1)
        agg, tier, step = self.s.series(["h"], m - 3 * 3600, m + 3600, 50, self.ret, now)
        self.assertEqual(tier, "m1")
        b = [v for _, v in agg["h"] if v]
        self.assertEqual(len(b), 1)
        self.assertEqual(b[0]["sent"], 59)
        self.assertAlmostEqual(b[0]["loss"], 100 / 59, places=1)
        self.assertAlmostEqual(b[0]["avg"], 11.0, delta=0.1)
        year, tier, step = self.s.series(["h"], now - 200 * 86400, now, 300, self.ret, now)
        self.assertEqual(tier, "m5")
        self.assertEqual(sum(v["sent"] for _, v in year["h"] if v), 59)

    def test_restart_keeps_earlier_part_of_minute(self):
        m = 1_800_000_000 - 1_800_000_000 % 60
        a = [0] * 60
        a[:30] = [100] * 30
        b = [0] * 60
        b[30:] = [200] * 30
        self.s.write_minutes([("h", m, a)])
        self.s.write_minutes([("h", m, b)])
        row = self.s.db.execute("SELECT d FROM raw WHERE host='h' AND t=?", (m,)).fetchone()[0]
        self.assertEqual(struct.unpack("<60H", row), tuple([100] * 30 + [200] * 30))

    def test_import_does_not_overwrite(self):
        t = 1_800_000_000 - 1_800_000_000 % 3600
        self.s.import_records("h", "m1", [(t, 30, 3, 9.0, 10.0, 12.0, 0.5)])
        n = self.s.import_records("h", "m1", [(t, 30, 30, None, None, None, None)])
        self.assertEqual(n, 0)
        d = self.s.db.execute("SELECT d FROM m1 WHERE host='h' AND t=?", (t,)).fetchone()[0]
        self.assertEqual(store.REC.unpack_from(d, 0), (30, 3, 90, 100, 120, 5))


class ConfigTest(unittest.TestCase):
    def test_bad_host(self):
        for h in ("-c 1", "a b", "", "x;rm"):
            with self.assertRaises(config.ConfigError):
                config.validate({"targets": [{"location": "x", "host": h}]})

    def test_good_hosts(self):
        c = config.validate({"targets": [{"location": "a", "host": "2001:db8::1"}, {"location": "b", "host": "dns.google"}]})
        self.assertEqual(len(c["targets"]), 2)

    def test_limits(self):
        with self.assertRaises(config.ConfigError):
            config.validate({"ping": {"interval_ms": 1000, "timeout_ms": 2000}})
        with self.assertRaises(config.ConfigError):
            config.validate({"alerts": {"loss_warn": 30, "loss_crit": 10}})

    def test_security_not_changed_by_update(self):
        d = tempfile.mkdtemp()
        cfg = config.Config(os.path.join(d, "c.json"))
        cfg.set_security(password_hash="x")
        cfg.update({**cfg.get(), "security": {"password_hash": "", "view_requires_login": True}})
        self.assertEqual(cfg.get()["security"]["password_hash"], "x")
        self.assertTrue(cfg.get()["security"]["view_requires_login"])
        self.assertNotIn("password_hash", json.dumps(cfg.public()))


class AuthTest(unittest.TestCase):
    def test_password(self):
        h = auth.hash_password("correct horse")
        self.assertTrue(auth.check_password("correct horse", h))
        self.assertFalse(auth.check_password("wrong", h))

    def test_session_dies_with_password_change(self):
        d = tempfile.mkdtemp()
        cfg = config.Config(os.path.join(d, "c.json"))
        cfg.set_security(password_hash=auth.hash_password("one two three"))
        a = auth.Auth(d, cfg)
        s = a.make_session()
        self.assertTrue(a.check_session(s))
        cfg.set_security(password_hash=auth.hash_password("four five six"))
        self.assertFalse(a.check_session(s))

    def test_tokens(self):
        d = tempfile.mkdtemp()
        cfg = config.Config(os.path.join(d, "c.json"))
        a = auth.Auth(d, cfg)
        tok, item = a.new_token("hub")
        self.assertTrue(a.check_token(tok))
        self.assertNotIn(tok, open(os.path.join(d, "c.json")).read())
        a.delete_token(item["id"])
        self.assertFalse(a.check_token(tok))


class MtrTest(unittest.TestCase):
    RESULT = {"report": {"mtr": {"dst": "1.1.1.1"}, "hubs": [
        {"count": 1, "host": "router (198.51.100.1)", "ASN": "AS???", "Loss%": 0.0, "Snt": 10, "Last": 0.5, "Avg": 0.6, "Best": 0.4, "Wrst": 0.9, "StDev": 0.1},
        {"count": 2, "host": "???", "ASN": "AS???", "Loss%": 100.0, "Snt": 10, "Last": 0, "Avg": 0, "Best": 0, "Wrst": 0, "StDev": 0},
        {"count": 3, "host": "one.one.one.one (1.1.1.1)", "ASN": "AS13335", "Loss%": 10.0, "Snt": 10, "Last": 9.1, "Avg": 9.4, "Best": 8.8, "Wrst": 11.0, "StDev": 0.6}]}}

    def test_cmd(self):
        self.assertEqual(mtr.build_cmd("1.1.1.1", "tcp", 443, 100, 1.0, False, True),
                         ["mtr", "--json", "-c", "100", "-i", "1.0", "-n", "-z", "-T", "-P", "443", "--", "1.1.1.1"])

    def test_summary_and_report(self):
        self.assertEqual(mtr.summarize(self.RESULT), (10.0, 3))
        txt = mtr.report_text(self.RESULT, {"started": 1_800_000_000, "mode": "tcp", "port": 443, "cycles": 10,
                                            "interval": 1.0, "site": "site-a", "public_ip": "203.0.113.5",
                                            "host": "1.1.1.1", "location": "Cloudflare", "trig": "auto", "reason": "loss 30%"})
        self.assertIn("MTR from site-a (public IP 203.0.113.5)", txt)
        self.assertIn("TCP port 443", txt)
        self.assertIn("2027-01-15 08:00:00 UTC", txt)
        self.assertIn("automatic: loss 30%", txt)
        self.assertRegex(txt, r"  3\. AS13335 +one\.one\.one\.one \(1\.1\.1\.1\) +10\.0%")


class AutoMtrTest(unittest.TestCase):
    """Automatic MTR: starts over the loss limit, then respects cooldown per location and the hourly cap."""

    def setUp(self):
        d = tempfile.mkdtemp()
        self.c = config.validate({"targets": [{"location": "L", "host": "192.0.2.1"}, {"location": "L", "host": "192.0.2.2"},
                                              {"location": "M", "host": "192.0.2.3"}],
                                  "auto_mtr": {"loss_pct": 20, "window_s": 30, "cooldown_min": 30, "max_per_hour": 2}})
        self.r = mtr.MtrRunner(FakeCfg(self.c), store.Store(os.path.join(d, "t.db")))
        self.p = pinger.Pinger(FakeCfg(self.c), None)
        self.p.period, self.p.timeout = 1.0, 1.0

    def host(self, h, loss_every):
        st = pinger.HostState(h, 0, 100)
        now = int(time.time())
        for i in range(30):
            st.recent.append((now - 30 + i, None if i % loss_every == 0 else 10.0))
        return st

    def test_cooldown_and_cap(self):
        self.r.consider(self.host("192.0.2.1", 50), "L", self.c, self.p)     # ~3% loss: nothing
        self.assertEqual(self.r.queue, [])
        self.r.consider(self.host("192.0.2.1", 2), "L", self.c, self.p)      # 50%: starts
        self.r.consider(self.host("192.0.2.2", 2), "L", self.c, self.p)      # same location: cooldown
        self.assertEqual(len(self.r.queue), 1)
        self.r.consider(self.host("192.0.2.3", 2), "M", self.c, self.p)      # other location: starts
        self.assertEqual(len(self.r.queue), 2)
        self.r.auto_last.clear()
        self.r.consider(self.host("192.0.2.2", 2), "L", self.c, self.p)      # hourly cap of 2 reached
        self.assertEqual(len(self.r.queue), 2)
        run = self.r.store.mtr_get(self.r.queue[0][1])
        self.assertEqual((run["trig"], run["status"]), ("auto", "queued"))
        self.assertIn("loss 50%", run["reason"])


class TriggerTest(AutoMtrTest):
    def test_down_latency_recovery(self):
        st = self.host("192.0.2.1", 50)
        st.status = "down"
        self.r.consider(st, "L", self.c, self.p)
        self.assertEqual(self.r.store.mtr_get(self.r.queue[0][1])["reason"], "target down")
        c = config.validate({**self.c, "auto_mtr": {**self.c["auto_mtr"], "on_latency": True, "latency_rise_ms": 50,
                                                    "max_per_hour": 10}})
        self.r.cfg = FakeCfg(c)
        self.r._base["192.0.2.3"] = (20.0, time.time())
        slow = pinger.HostState("192.0.2.3", 0, 100)
        now = int(time.time())
        for i in range(30):
            slow.recent.append((now - 30 + i, 95.0))
        self.r.consider(slow, "M", c, self.p)
        self.assertIn("normal is 20 ms", self.r.store.mtr_get(self.r.queue[-1][1])["reason"])
        self.r.on_status("192.0.2.2", "L", "down", "ok", c)      # same location, but its own cooldown key
        self.assertEqual(self.r.store.mtr_get(self.r.queue[-1][1])["reason"], "recovered (was down)")
        self.assertEqual(len(self.r.queue), 3)

    def test_priority_and_pending(self):
        a = self.r.request("192.0.2.1", trig="schedule", reason="base")
        b = self.r.request("192.0.2.2", trig="manual")
        self.assertEqual([q[1] for q in self.r.queue], [b, a])      # manual first
        self.assertTrue(self.r.pending("192.0.2.1", "schedule"))
        self.assertFalse(self.r.pending("192.0.2.1", "auto"))
        self.assertTrue(self.r.cancel(a))
        self.assertEqual(self.r.store.mtr_get(a)["status"], "cancelled")

    def test_schedule_validation(self):
        c = config.validate({"targets": [{"location": "A", "host": "192.0.2.1"}],
                             "schedules": [{"name": "Baseline", "hosts": ["192.0.2.1", "198.51.100.7"], "every_min": 15}]})
        self.assertEqual(c["schedules"][0]["hosts"], ["192.0.2.1"])
        with self.assertRaises(config.ConfigError):
            config.validate({"schedules": [{"name": "x", "every_min": 1}]})


class MedianTest(unittest.TestCase):
    def test_median(self):
        s = store.Store(os.path.join(tempfile.mkdtemp(), "t.db"))
        now = 1_800_000_000
        recs = [(now - 7200 + i * 60, 60, 0, 10.0, 20.0 + (i % 3), 30.0, 1.0) for i in range(100)]
        s.import_records("h", "m1", recs)
        self.assertEqual(s.median_avg("h", 86400, now), 21.0)


if __name__ == "__main__":
    unittest.main()
