"""Hopwatch Hub: one page for several Hopwatch Probes. It shows which problems several sites see at
the same time (the target's side) and which only one site sees (that site's path or uplink).

Environment (everything else is set in the web UI):
  HOPWATCH_PORT            web UI port (default 8090)
  HOPWATCH_BIND            address to listen on (default all)
  HOPWATCH_DATA            data folder (default /data)
  HOPWATCH_RESET_PASSWORD  "true" removes the admin password at start
  HOPWATCH_LOG             log level (default INFO)
"""
import logging
import os
import signal
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
for _d in (os.path.join(HERE, "..", "shared"), os.path.join(HERE, "..", "..", "shared")):   # image, checkout
    if os.path.isdir(_d):
        sys.path.insert(1, _d)

from auth import Auth            # noqa: E402
from config import VERSION, Config   # noqa: E402
import web                       # noqa: E402


def main():
    logging.basicConfig(level=os.environ.get("HOPWATCH_LOG", "INFO").upper(),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log = logging.getLogger("hopwatch")
    data = os.environ.get("HOPWATCH_DATA", "/data")
    os.makedirs(data, exist_ok=True)
    cfg = Config(os.path.join(data, "config.json"))
    if os.environ.get("HOPWATCH_RESET_PASSWORD", "").lower() in ("1", "true", "yes"):
        cfg.set_security(password_hash="")
        log.warning("admin password removed (HOPWATCH_RESET_PASSWORD); set a new one, then switch the variable back")
    signal.signal(signal.SIGTERM, lambda *_: os._exit(0))
    signal.signal(signal.SIGINT, lambda *_: os._exit(0))
    log.info("Hopwatch Hub %s, data in %s", VERSION, data)
    app = web.App(cfg, Auth(data, cfg))
    app.cross.start()
    web.serve(app, int(os.environ.get("HOPWATCH_PORT", "8090")), os.environ.get("HOPWATCH_BIND", ""))


if __name__ == "__main__":
    main()
