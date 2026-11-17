# Hopwatch

Network path monitoring for people who have to prove to a data centre or ISP that the problem is on
their side.

- **Hopwatch Probe** (this release): runs at one site. It pings your targets every second, keeps the
  history and runs MTR, on demand or automatically when packet loss goes over a limit. The result
  comes as a hop table and as plain text in the `mtr -rwbz` layout that support teams ask for.
- **Hopwatch Hub** (planned): collects from several probes and shows problems seen from more than one
  site, so you can tell a path problem at one site from a problem at the target.

## Hopwatch Probe

![icon](docs/icon.png)

### What it does

| | |
|---|---|
| Ping | `fping`, one ping per target per second (interval, timeout and size configurable) |
| Status | loss %, latency and jitter over a window; warning and critical limits per setting |
| History | every ping for 7 days, 1-minute data for 90 days, 5-minute data for a year (all configurable); about 250 MB a year for 50 targets |
| MTR | ICMP, TCP (any port) or UDP; 100 cycles by default; host names and AS numbers; up to 4 at once, the rest wait |
| Automatic MTR | when loss stays over X % for N seconds; cooldown per location or IP; hourly limit |
| TCP check | finds out once a day which targets answer on a TCP port (443 by default), so TCP MTR is offered only where it works |
| Netdata import | reads targets and up to a year of history from a Netdata agent with the go.d ping collector |
| Security | admin password (PBKDF2), API tokens for the hub or scripts, optional login for viewing, CORS allow-list |

Everything is configured in the web UI. MTR only runs to targets in your list, so the probe can't be
used to trace arbitrary hosts.

### Install on Unraid

1. **Apps** won't list it yet. Until then: Docker → **Add Container** → **Template repositories**, add
   `https://github.com/stomko11/hopwatch`, then pick `hopwatch-probe` from the template list.
   Or copy `unraid/hopwatch-probe.xml` to `/boot/config/plugins/dockerMan/templates-user/` and pick
   it under Add Container → Template.
2. Keep **Network type: Host**. MTR then shows your real first hop instead of the Docker bridge.
3. Start it and open `http://<server>:8095`. Set the admin password, then add targets in
   **Settings** (or import them from Netdata).

### Run with Docker

```sh
docker run -d --name hopwatch-probe --network host --cap-add NET_RAW \
  -v /srv/hopwatch-probe:/data --restart unless-stopped \
  ghcr.io/stomko11/hopwatch-probe:latest
```

With a bridge network instead, publish the port with `-p 8095:8095`.

### Environment

Only what has to be known before the web UI is reachable:

| Variable | Default | |
|---|---|---|
| `HOPWATCH_PORT` | `8095` | web UI port |
| `HOPWATCH_BIND` | all | address to listen on |
| `HOPWATCH_DATA` | `/data` | data folder |
| `HOPWATCH_RESET_PASSWORD` | `false` | `true` removes the admin password at start |
| `HOPWATCH_LOG` | `INFO` | log level |

### API

JSON over HTTP. Read calls are open unless *Viewing needs a login* is on. Changes need the admin
login or `Authorization: Bearer <token>` (create tokens under Settings → Security).
Requests that change something from a browser also need the header `X-Hopwatch: 1`.

| Call | |
|---|---|
| `GET /api/status` | live loss / latency / jitter per target |
| `GET /api/series?from=&to=&points=&group=location\|host&location=` | chart data |
| `GET /api/mtr`, `GET /api/mtr/<id>`, `GET /api/mtr/report/<id>` | MTR runs, one run, its text report |
| `POST /api/mtr` `{"hosts": [...], "mode": "icmp\|tcp\|udp\|tcp_if_open", "port", "cycles"}` | start MTR |
| `GET /api/events` | status changes and automatic MTR runs |
| `GET` / `PUT /api/config` | settings |

### Development

```sh
cd probe
python3 -m unittest discover -s tests
docker build -t hopwatch-probe:dev .
```

Plain Python standard library and plain JavaScript, no build step. Note that Docker Desktop and
Colima on macOS answer pings themselves, so loss can only be tested on a Linux host.

## Licence

MIT
