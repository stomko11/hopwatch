"""Start the real launcher with probe and hub in one process group and check they find each other.
fping / mtr are not needed for this: the probe starts its web UI even when fping is missing."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def get(url, body=None, cookie=None):
    h = {"X-Hopwatch": "1", "Content-Type": "application/json"}
    if cookie:
        h["Cookie"] = cookie
    r = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=h)
    with urllib.request.urlopen(r, timeout=10) as x:
        return json.loads(x.read()), x.headers.get("Set-Cookie")


class LauncherTest(unittest.TestCase):
    def test_both_in_one(self):
        data, pp, hp = tempfile.mkdtemp(), free_port(), free_port()
        # the launcher expects the apps next to it, as in the image: build that layout with links
        app = tempfile.mkdtemp()
        for src, dst in (("probe/app", "probe"), ("hub/app", "hub"), ("shared", "shared"), ("ui", "ui")):
            os.symlink(os.path.abspath(os.path.join(ROOT, src)), os.path.join(app, dst))
        os.symlink(os.path.abspath(os.path.join(ROOT, "launcher", "run.py")), os.path.join(app, "run.py"))
        env = {**os.environ, "HOPWATCH_PROBE": "true", "HOPWATCH_HUB": "true", "HOPWATCH_PROBE_PORT": str(pp),
               "HOPWATCH_HUB_PORT": str(hp), "HOPWATCH_DATA": data, "HOPWATCH_BIND": "127.0.0.1", "HOPWATCH_LOG": "WARNING"}
        p = subprocess.Popen([sys.executable, os.path.join(app, "run.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(60):
                try:
                    get(f"http://127.0.0.1:{pp}/healthz")
                    get(f"http://127.0.0.1:{hp}/healthz")
                    break
                except OSError:
                    time.sleep(0.25)
            self.assertTrue(os.path.exists(os.path.join(data, "config.json")))
            self.assertTrue(os.path.exists(os.path.join(data, "hub", "config.json")))
            _, ck = get(f"http://127.0.0.1:{hp}/api/password", {"new": "launcher-test-1"})
            live, _ = get(f"http://127.0.0.1:{hp}/api/live", cookie=ck.split(";")[0])
            local = [x for x in live["probes"] if x["id"] == "local"]
            self.assertEqual(len(local), 1)
            self.assertNotIn("error", {k: v for k, v in local[0].items() if v}, local[0])
            self.assertEqual(len(local[0]["targets"]), 2)          # the probe's default targets
            self.assertNotIn("local", open(os.path.join(data, "hub", "config.json")).read())
            r = subprocess.run([sys.executable, os.path.join(app, "run.py"), "--health"], env=env, capture_output=True)
            self.assertEqual(r.returncode, 0, r.stdout)
        finally:
            p.terminate()
            p.wait(15)

    def test_nothing_to_run(self):
        env = {**os.environ, "HOPWATCH_PROBE": "false", "HOPWATCH_HUB": "false"}
        r = subprocess.run([sys.executable, os.path.join(ROOT, "launcher", "run.py")], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 2)


if __name__ == "__main__":
    unittest.main()
