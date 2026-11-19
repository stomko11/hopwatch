import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))
sys.path.insert(1, os.path.join(os.path.dirname(__file__), "..", "..", "shared"))

import config  # noqa: E402
import hub     # noqa: E402


def probe(step, series):
    return {"step": step, "series": [{"host": h, "location": loc, "points": pts} for h, loc, pts in series]}


def pts(t0, step, losses, avg=20.0):
    return [[t0 + i * step, avg if l < 100 else None, l, 1.0, avg] for i, l in enumerate(losses)]


class CorrelateTest(unittest.TestCase):
    TH = {"loss": 1.0, "jitter": None, "delay": None}
    NAMES = {"a": "Site A", "b": "Site B"}

    def test_target_incident_seen_from_both(self):
        d = {"a": probe(60, [("192.0.2.1", "X", pts(0, 60, [0, 30, 40, 0, 0]))]),
             "b": probe(60, [("192.0.2.1", "X", pts(0, 60, [0, 20, 50, 0, 0]))])}
        r = hub.correlate(d, self.NAMES, self.TH, 2, join_s=0)
        self.assertEqual(len(r["incidents"]), 1)
        i = r["incidents"][0]
        self.assertEqual((i["kind"], i["t0"], i["t1"], i["buckets"]), ("target", 60, 180, 2))
        self.assertEqual(i["worst"], {"Site A": 40, "Site B": 50})

    def test_one_site_path_and_site_uplink(self):
        # site A loses on its single target only -> path; site B loses on all its targets -> its uplink
        d = {"a": probe(60, [("192.0.2.1", "X", pts(0, 60, [0, 30, 0])), ("192.0.2.2", "Y", pts(0, 60, [0, 0, 0])),
                             ("192.0.2.3", "Z", pts(0, 60, [0, 0, 0]))]),
             "b": probe(60, [("192.0.2.1", "X", pts(0, 60, [0, 0, 0])), ("192.0.2.2", "Y", pts(0, 60, [0, 0, 80])),
                             ("192.0.2.3", "Z", pts(0, 60, [0, 0, 90]))])}
        r = hub.correlate(d, self.NAMES, self.TH, 2)
        kinds = sorted((i["host"], i["kind"], tuple(i["site_names"])) for i in r["incidents"])
        self.assertEqual(kinds, [("192.0.2.1", "path", ("Site A",)), ("192.0.2.2", "site", ("Site B",)),
                                 ("192.0.2.3", "site", ("Site B",))])

    def test_different_steps_are_aligned(self):
        d = {"a": probe(60, [("h", "X", pts(0, 60, [0, 0, 0, 0, 30, 0]))]),
             "b": probe(120, [("h", "X", pts(0, 120, [0, 0, 25]))])}
        r = hub.correlate(d, self.NAMES, self.TH, 2)
        self.assertEqual([(i["kind"], i["t0"]) for i in r["incidents"]], [("target", 240)])

    def test_delay_against_own_normal(self):
        a = [[i * 60, 20.0 if i != 5 else 120.0, 0, 1, 20] for i in range(10)]
        b = [[i * 60, 200.0 if i != 5 else 290.0, 0, 1, 200] for i in range(10)]   # far site, slower normal
        d = {"a": probe(60, [("h", "X", a)]), "b": probe(60, [("h", "X", b)])}
        r = hub.correlate(d, self.NAMES, {"loss": None, "jitter": None, "delay": 50}, 2)
        self.assertEqual([(i["signal"], i["t0"]) for i in r["incidents"]], [("delay", 300)])

    def test_failed_probe_is_ignored(self):
        d = {"a": probe(60, [("h", "X", pts(0, 60, [50]))]), "b": {"error": "down"}}
        r = hub.correlate(d, self.NAMES, self.TH, 1)
        self.assertEqual(len(r["incidents"]), 1)

    def test_one_site_fragment_inside_shared_incident_is_merged(self):
        d = {"a": probe(60, [("h", "X", pts(0, 60, [0, 30, 30, 0, 30, 0]))]),
             "b": probe(60, [("h", "X", pts(0, 60, [0, 30, 30, 30, 30, 0]))])}
        r = hub.correlate(d, self.NAMES, self.TH, 2)
        self.assertEqual([(i["kind"], i["t0"], i["t1"]) for i in r["incidents"]], [("target", 60, 300)])


class RoleTest(unittest.TestCase):
    def test_roles_are_separate_locations(self):
        d = {"a": {"step": 60, "series": [{"host": "h1", "location": "DC1", "role": "Own", "points": pts(0, 60, [30])},
                                          {"host": "h2", "location": "DC1", "role": "ISP", "points": pts(0, 60, [0])}]},
             "b": {"step": 60, "series": [{"host": "h1", "location": "DC1", "role": "Own", "points": pts(0, 60, [30])},
                                          {"host": "h2", "location": "DC1", "role": "ISP", "points": pts(0, 60, [0])}]}}
        r = hub.correlate(d, {}, {"loss": 1, "jitter": None, "delay": None}, 2)
        self.assertEqual([i["location"] for i in r["incidents"]], ["DC1 · Own"])

    def test_group_from_probe(self):
        # 0.2.5 probes send the group: a target without a location is grouped by its role
        s = {"host": "1.1.1.1", "location": "Public", "role": "Public", "group": "Public", "points": pts(0, 60, [30])}
        d = {"a": {"step": 60, "series": [s]}, "b": {"step": 60, "series": [dict(s)]}}
        r = hub.correlate(d, {}, {"loss": 1, "jitter": None, "delay": None}, 2)
        self.assertEqual([i["location"] for i in r["incidents"]], ["Public"])

    def test_sites_needed(self):
        self.assertEqual(hub.sites_needed(0, 3), 3)       # all
        self.assertEqual(hub.sites_needed(2, 3), 2)
        self.assertEqual(hub.sites_needed(3, 2), 2)       # an offline site doesn't block everything
        self.assertEqual(hub.sites_needed(0, 0), 1)


class JoinTest(unittest.TestCase):
    def test_gaps_shorter_than_join_are_one_incident(self):
        a = pts(0, 10, [30, 0, 0, 0, 30, 0, 0, 0, 0, 0, 0, 0, 30])     # gaps of 40 s and 80 s
        d = {"a": probe(10, [("h", "X", a)]), "b": probe(10, [("h", "X", a)])}
        r = hub.correlate(d, {}, {"loss": 1, "jitter": None, "delay": None}, 2, join_s=60)
        self.assertEqual([(i["t0"], i["t1"]) for i in sorted(r["incidents"], key=lambda x: x["t0"])], [(0, 50), (120, 130)])


class ConfigTest(unittest.TestCase):
    def test_tokens_kept_and_hidden(self):
        c = config.Config(os.path.join(tempfile.mkdtemp(), "c.json"))
        c.update({**c.get(), "probes": [{"name": "A", "url": "http://192.0.2.5:8095", "token": "hw_secret"}]})
        pid = c.get()["probes"][0]["id"]
        c.update({**c.public(), "probes": [{"id": pid, "name": "A2", "url": "http://192.0.2.5:8095", "token": ""}]})
        self.assertEqual(c.get()["probes"][0]["token"], "hw_secret")
        self.assertNotIn("hw_secret", str(c.public()))
        self.assertTrue(c.public()["probes"][0]["token_set"])

    def test_rename_local_probe(self):
        d = tempfile.mkdtemp()
        with open(os.path.join(d, "probe.json"), "w") as f:
            f.write('{"site_name": "Home"}')
        os.environ.update({"HOPWATCH_LOCAL_PROBE_URL": "http://127.0.0.1:1", "HOPWATCH_LOCAL_TOKEN": "x" * 40,
                           "HOPWATCH_LOCAL_PROBE_CONFIG": os.path.join(d, "probe.json")})
        try:
            c = config.Config(os.path.join(d, "c.json"))
            self.assertEqual(c.probes()[0]["name"], "Home")
            pub = c.public()
            c.update(pub)                                   # saving other settings keeps following the site name
            self.assertEqual(c.get()["local_name"], "")
            pub["probes"][0]["name"] = "Home office"
            c.update(pub)
            self.assertEqual(c.probes()[0]["name"], "Home office")
            self.assertEqual(c.get()["probes"], [])          # never stored as a normal probe
        finally:
            for k in ("HOPWATCH_LOCAL_PROBE_URL", "HOPWATCH_LOCAL_TOKEN", "HOPWATCH_LOCAL_PROBE_CONFIG"):
                os.environ.pop(k, None)

    def test_bad_url(self):
        with self.assertRaises(config.ConfigError):
            config.validate({"probes": [{"name": "x", "url": "file:///etc/passwd"}]})


if __name__ == "__main__":
    unittest.main()


class CrossTest(unittest.TestCase):
    """One probe's automatic MTR makes the others trace the same target, unless they have their own."""
    def setUp(self):
        self.runs = {"a": [], "b": [], "c": []}
        self.posted = []
        ps = [{"id": k, "name": k.upper(), "enabled": True} for k in "abc"]

        class Cfg:
            def get(s):
                return {"cross": {"enabled": True, "cooldown_min": 15, "max_per_hour": 30}}

            def probes(s):
                return ps

        def call(p, path, body=None, timeout=0):
            if path == "/api/status":
                return {"targets": [{"host": "h", "enabled": True}]}
            if path == "/api/mtr" and body:
                self.posted.append((p["id"], body["trig"]))
                return {"ids": [99]}
            if "host=" in path:
                return {"runs": [r for r in self.runs[p["id"]] if r["host"] == "h"]}
            return {"runs": [r for r in self.runs[p["id"]] if r["trig"] == "auto"]}

        self.x = hub.CrossCapture(Cfg(), call, lambda ps, fn: {p["id"]: fn(p) for p in ps})
        self.x.since = 0

    def test_others_trace_unless_they_have_their_own(self):
        self.runs["a"].append({"id": 1, "host": "h", "trig": "auto", "created": 1000, "status": "done", "mode": "icmp"})
        self.runs["c"].append({"id": 7, "host": "h", "trig": "auto", "created": 1010, "status": "done", "mode": "icmp"})
        self.x.tick(now=1020)
        self.assertEqual(self.posted, [("b", "cross")])          # c saw it too: it has its own run
        self.x.tick(now=1040)
        self.assertEqual(len(self.posted), 1)                     # nothing new, nothing again

    def test_cooldown_per_target(self):
        self.runs["a"].append({"id": 1, "host": "h", "trig": "auto", "created": 1000, "status": "done", "mode": "icmp"})
        self.x.tick(now=1020)
        self.runs["a"].append({"id": 2, "host": "h", "trig": "auto", "created": 1100, "status": "done", "mode": "icmp"})
        self.x.tick(now=1120)
        self.assertEqual(sorted(self.posted), [("b", "cross"), ("c", "cross")])


class SyncTest(unittest.TestCase):
    """Copying settings: only the chosen parts, never the security block or the site name."""
    def test_copy_sections(self):
        import web
        cfgs = {"a": {"site_name": "A", "auto_mtr": {"loss_pct": 10}, "targets": [{"host": "h1"}], "security": {"x": 1}},
                "b": {"site_name": "B", "auto_mtr": {"loss_pct": 20}, "targets": [{"host": "h2"}], "security": {"x": 2}}}
        put = {}

        def call(p, path, body=None, method=None, timeout=0):
            if method == "PUT":
                put[p["id"]] = body
                return {}
            return json.loads(json.dumps(cfgs[p["id"]]))
        ps = [{"id": "a", "name": "A", "enabled": True}, {"id": "b", "name": "B", "enabled": True}]
        old = (hub.call, hub.each, web.probes)
        hub.call, hub.each = call, lambda ps_, fn: {p["id"]: fn(p) for p in ps_}
        web.probes = lambda h, q=None, enabled=True: ps

        class H:
            app = type("A", (), {"cache": type("C", (), {"d": {}})()})()

            def _body(self):
                return {"source": "a", "to": ["b"], "sections": ["auto"]}
        try:
            r = web.api_probe_settings_apply(H(), {}, None)
        finally:
            hub.call, hub.each, web.probes = old
        self.assertEqual(r["results"][0].get("ok"), True)
        self.assertEqual(put["b"]["auto_mtr"], {"loss_pct": 10})          # copied
        self.assertEqual(put["b"]["targets"], [{"host": "h2"}])           # not chosen: kept
        self.assertEqual(put["b"]["site_name"], "B")
        self.assertNotIn("security", put["b"])                            # the probe keeps its own


class MigrateTest(unittest.TestCase):
    def test_old_default_follows_probes(self):
        self.assertEqual(config.validate({"correlate": {"min_sites": 2}})["correlate"]["min_sites"], 0)     # old file
        self.assertEqual(config.validate({"schema": 2, "correlate": {"min_sites": 2}})["correlate"]["min_sites"], 2)
        self.assertEqual(config.validate({"correlate": {"min_sites": 3}})["correlate"]["min_sites"], 3)
