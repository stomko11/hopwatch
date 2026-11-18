# Hopwatch

Network path monitoring for people who have to prove where a problem is, to a data centre, an ISP or
their own users.

- **Hopwatch Probe** runs at a site. It pings your targets every second, keeps the history and runs
  MTR on demand, on a schedule and automatically when something goes wrong. Every result can be copied
  or exported in the format support teams ask for.
- **Hopwatch Hub** shows several probes on one page. It tells problems that several sites see at the
  same moment (the target's side) from problems only one site sees (the path from that site, or that
  site's own uplink), so site and ISP noise is filtered out.

![icon](docs/icon.png)

## Hopwatch Probe

| | |
|---|---|
| Ping | `fping`, one ping per target per second (interval, timeout and size configurable) |
| Status | loss %, latency and jitter over a window, with warning and critical limits |
| History | every ping for 7 days, 1-minute data for 90 days, 5-minute data for a year (configurable); about 250 MB a year for 50 targets |
| MTR | ICMP, TCP (any port) or UDP; 100 cycles by default; host names and AS numbers; up to 4 at once, the rest wait (manual first) |
| Automatic MTR | when a target goes down, when loss stays over X % for N seconds, when latency goes over a limit or rises above its normal; once more when it recovers; cooldown and hourly limit |
| Periodic MTR | schedules (targets, every N minutes, mode, cycles) keep a record of the normal path; every run can be compared with the previous one to the same target |
| Reading MTR | the run page says where loss starts and whether it continues to the target, and highlights hops that changed since the previous run |
| Evidence | per run: copy as text (`mtr -rwbz` layout with site, public IP, target, mode and UTC time on top), .txt, .json; several runs as one ZIP or text; a whole time window as one ZIP with a summary, every ping as CSV, the status changes and all MTR reports |
| TCP check | finds out daily which targets answer on a TCP port (443 by default), so TCP MTR is offered where it works |
| Netdata import | targets and up to a year of history from a Netdata agent with the go.d ping collector |
| Security | admin password (PBKDF2), API tokens, optional login for viewing, CORS allow-list |

Everything is configured in the web UI. MTR only runs to targets in your list.

## Hopwatch Hub

| | |
|---|---|
| Overview | every location as seen from every site, with a verdict: *seen from several sites*, *only from one site*, or OK |
| Incidents | over a time window: loss, jitter and delay (against each site's own normal), grouped into *seen from several sites*, *one site's path* and *one site's own link* (many targets at once) |
| Compare | the same targets charted from every site, one line per site |
| MTR | start MTR from all sites at the same moment; list runs from every site; put the runs of two sites next to each other |
| Evidence | one ZIP: what several sites saw, what one site saw, and each site's own evidence pack in its folder |

The probes keep their own history; the hub reads it over their API with a token per probe, so nothing
is stored twice. The hub has to reach the probes (LAN or VPN); the probes never need to reach the hub.

## Install on Unraid

1. Docker → **Add Container** → **Template repositories**: add `https://github.com/stomko11/hopwatch`,
   then pick `hopwatch-probe` or `hopwatch-hub`. Or copy the XML from `unraid/` to
   `/boot/config/plugins/dockerMan/templates-user/` and pick it under **Template**.
2. **Probe:** keep **Network type: Host**, so MTR shows your real first hop instead of the Docker
   bridge. Open `http://<server>:8095`, set the admin password, add targets in **Settings** (or import
   them from Netdata).
3. **Hub:** open `http://<server>:8090`, set its password. On each probe create an API token
   (**Settings → Security**), then add the probe in the hub (**Settings → Probes → Add probe**).

## Run with Docker

```sh
docker run -d --name hopwatch-probe --network host --cap-add NET_RAW \
  -v /srv/hopwatch-probe:/data --restart unless-stopped ghcr.io/stomko11/hopwatch-probe:latest

docker run -d --name hopwatch-hub -p 8090:8090 \
  -v /srv/hopwatch-hub:/data --restart unless-stopped ghcr.io/stomko11/hopwatch-hub:latest
```

## Environment

Only what has to be known before the web UI is reachable:

| Variable | Default | |
|---|---|---|
| `HOPWATCH_PORT` | probe `8095`, hub `8090` | web UI port |
| `HOPWATCH_BIND` | all | address to listen on |
| `HOPWATCH_DATA` | `/data` | data folder |
| `HOPWATCH_RESET_PASSWORD` | `false` | `true` removes the admin password at start |
| `HOPWATCH_LOG` | `INFO` | log level |

## Probe API

JSON over HTTP. Read calls are open unless *Viewing needs a login* is on. Changes need the admin
login or `Authorization: Bearer <token>`. Browser requests that change something also need the header
`X-Hopwatch: 1`.

| Call | |
|---|---|
| `GET /api/status` | live loss / latency / jitter per target |
| `GET /api/series?from=&to=&points=&group=location\|host&host=a,b&location=x,y` | chart data |
| `GET /api/series.csv?…` | the same as CSV |
| `GET /api/mtr?from=&to=&host=&trig=manual,auto,schedule&status=` | MTR runs |
| `GET /api/mtr/<id>`, `GET /api/mtr/report/<id>` | one run (JSON), its text report |
| `GET /api/mtr/export?ids=1,2&format=zip\|txt\|json` | several runs |
| `POST /api/mtr` `{"hosts": [...], "mode": "icmp\|tcp\|udp\|tcp_if_open", "port", "cycles"}` | start MTR |
| `GET /api/evidence?from=&to=&host=&location=&note=` | evidence pack (ZIP) |
| `GET /api/events` | status changes and automatic MTR runs |
| `GET` / `PUT /api/config` | settings |

## Development

```sh
python3 -m unittest discover -s probe/tests
python3 -m unittest discover -s hub/tests
docker build -f probe/Dockerfile -t hopwatch-probe:dev .
docker build -f hub/Dockerfile -t hopwatch-hub:dev .
```

Plain Python standard library and plain JavaScript (`ui/` is shared by both), no build step.
Docker Desktop and Colima on macOS answer pings themselves, so real loss can only be tested on Linux
(or by dropping replies with iptables inside the container).

## Licence

MIT
