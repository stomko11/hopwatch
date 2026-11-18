"""Hopwatch container entry point: runs the Probe, the Hub, or both.

  HOPWATCH_PROBE=true|false   run the probe (default true)
  HOPWATCH_PROBE_PORT=8095    its web UI port (HOPWATCH_PORT also works, for older setups)
  HOPWATCH_HUB=true|false     run the hub (default false)
  HOPWATCH_HUB_PORT=8090      its web UI port
  HOPWATCH_DATA=/data         probe data here, hub data in <data>/hub

With both on, the hub shows the local probe without any setup: a token made fresh at every start is
given to both, and never written anywhere. If either one stops, the container stops, so Docker's
restart policy brings both back.

`run.py --health` is the container health check.
"""
import os
import secrets
import signal
import subprocess
import sys
import time
import urllib.request

APP = os.path.dirname(os.path.abspath(__file__))


def flag(name, default):
    v = os.environ.get(name)
    return default if v is None or v.strip() == "" else v.strip().lower() in ("1", "true", "yes", "on")


def settings():
    probe, hub = flag("HOPWATCH_PROBE", True), flag("HOPWATCH_HUB", False)
    pport = int(os.environ.get("HOPWATCH_PROBE_PORT") or os.environ.get("HOPWATCH_PORT") or 8095)
    hport = int(os.environ.get("HOPWATCH_HUB_PORT") or 8090)
    return probe, hub, pport, hport, os.environ.get("HOPWATCH_DATA", "/data")


def health():
    probe, hub, pport, hport, _ = settings()
    for on, port in ((probe, pport), (hub, hport)):
        if on:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=4).read()
    return 0


def main():
    if "--health" in sys.argv:
        try:
            return health()
        except Exception as e:
            print(e)
            return 1
    probe, hub, pport, hport, data = settings()
    if not probe and not hub:
        print("Both HOPWATCH_PROBE and HOPWATCH_HUB are off, nothing to run.", flush=True)
        return 2
    if probe and hub and pport == hport:
        print(f"Probe and hub can't both use port {pport}.", flush=True)
        return 2
    base = {k: v for k, v in os.environ.items() if not k.startswith("HOPWATCH_LOCAL_")}
    kids = []
    if probe and hub:
        tok = secrets.token_urlsafe(32)
        base["HOPWATCH_LOCAL_TOKEN"] = tok
    if probe:
        env = {**base, "HOPWATCH_PORT": str(pport), "HOPWATCH_DATA": data}
        kids.append(("probe", subprocess.Popen([sys.executable, os.path.join(APP, "probe", "main.py")], env=env)))
    if hub:
        env = {**base, "HOPWATCH_PORT": str(hport), "HOPWATCH_DATA": os.path.join(data, "hub")}
        if probe:
            env["HOPWATCH_LOCAL_PROBE_URL"] = f"http://127.0.0.1:{pport}"
            env["HOPWATCH_LOCAL_PROBE_CONFIG"] = os.path.join(data, "config.json")
        kids.append(("hub", subprocess.Popen([sys.executable, os.path.join(APP, "hub", "main.py")], env=env)))

    def stop(*_):
        for _, p in kids:
            if p.poll() is None:
                p.terminate()
        end = time.time() + 10
        for _, p in kids:
            try:
                p.wait(max(0.1, end - time.time()))
            except subprocess.TimeoutExpired:
                p.kill()
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    while True:
        for name, p in kids:
            rc = p.poll()
            if rc is not None:
                print(f"{name} stopped (exit {rc}), stopping the container", flush=True)
                for _, q in kids:
                    if q.poll() is None:
                        q.terminate()
                return rc or 1
        time.sleep(1)


if __name__ == "__main__":
    sys.exit(main())
