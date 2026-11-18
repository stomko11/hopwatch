"""Hopwatch Probe: pings targets every second, keeps the history, runs MTR on demand and when loss
goes over a limit, and serves a web UI for all of it.

Environment (everything else is set in the web UI):
  HOPWATCH_PORT            web UI port (default 8095)
  HOPWATCH_BIND            address to listen on (default all)
  HOPWATCH_DATA            data folder (default /data)
  HOPWATCH_RESET_PASSWORD  "true" removes the admin password at start, to recover a lost one
  HOPWATCH_LOG             log level (default INFO)
"""
import logging
import os
import signal
import socket
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from auth import Auth            # noqa: E402
from config import VERSION, Config   # noqa: E402
from mtr import MtrRunner        # noqa: E402
from pinger import Pinger        # noqa: E402
from store import Store          # noqa: E402
import web                       # noqa: E402


def main():
    logging.basicConfig(level=os.environ.get("HOPWATCH_LOG", "INFO").upper(),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log = logging.getLogger("hopwatch")
    data = os.environ.get("HOPWATCH_DATA", "/data")
    os.makedirs(data, exist_ok=True)
    port = int(os.environ.get("HOPWATCH_PORT", "8095"))
    cfg = Config(os.path.join(data, "config.json"))
    if os.environ.get("HOPWATCH_RESET_PASSWORD", "").lower() in ("1", "true", "yes"):
        cfg.set_security(password_hash="")
        log.warning("admin password removed (HOPWATCH_RESET_PASSWORD); set a new one in the web UI, "
                    "then switch the variable back to false")
    store = Store(os.path.join(data, "hopwatch.db"))
    mtr = MtrRunner(cfg, store)
    pinger = Pinger(cfg, store)

    def on_alert(host, location, old, new, s):
        store.event("status", host=host, location=location, level=new, before=old, loss=s["loss"], avg=s["avg"])
        mtr.on_status(host, location, old, new, cfg.get())

    pinger.on_alert = on_alert
    pinger.listeners.append(lambda st, loc, c: mtr.consider(st, loc, c, pinger))

    last = {"ping": None}

    def on_config(c):
        key = (tuple((t["host"], t["enabled"]) for t in c["targets"]), tuple(sorted(c["ping"].items())),
               c["alerts"]["window_s"], c["auto_mtr"]["window_s"])
        if key != last["ping"]:
            last["ping"] = key
            pinger.restart()
            mtr.tcp_check_now()

    cfg.listeners.append(on_config)
    on_config(cfg.get())
    pinger.start()
    mtr.start()

    def housekeeping():
        while True:
            try:
                store.cleanup(cfg.get()["retention"])
            except Exception:
                log.exception("cleanup failed")
            time.sleep(3600)

    threading.Thread(target=housekeeping, daemon=True).start()

    def stop(*_):
        log.info("stopping, writing the last samples")
        pinger.stop()
        os._exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log.info("Hopwatch Probe %s, data in %s", VERSION, data)
    app = web.App(cfg, store, pinger, mtr, Auth(data, cfg), socket.gethostname())
    web.serve(app, port, os.environ.get("HOPWATCH_BIND", ""))


if __name__ == "__main__":
    main()
