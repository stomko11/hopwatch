"""Read ping targets (and optionally their history) from a Netdata agent that runs the go.d ping collector."""
import json
import logging
import time
import urllib.parse
import urllib.request

log = logging.getLogger("netdata")


def _get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "hopwatch-probe"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def clean_url(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if not url.startswith(("http://", "https://")):
        url = "http://" + url
    p = urllib.parse.urlparse(url)
    if not p.hostname:
        raise ValueError("not a valid Netdata address")
    return f"{p.scheme}://{p.netloc}"


def targets(url: str):
    """-> [{"location", "host", "chart"}] from the charts with context ping.host_rtt."""
    url = clean_url(url)
    charts = _get(url + "/api/v1/charts").get("charts", {})
    out = []
    for cid, ch in charts.items():
        if ch.get("context") != "ping.host_rtt":
            continue
        lab = ch.get("chart_labels") or {}
        host = lab.get("host")
        if not host:
            continue
        out.append({"location": (lab.get("_collect_job") or host).replace("_", " "), "host": host, "chart": cid})
    out.sort(key=lambda x: (x["location"], x["host"]))
    return out


def history(url: str, chart_rtt: str, days: int, step: int):
    """Per-step records from Netdata for one target: [(t, sent, lost, min, avg, max, jitter)].
    Packet counts come from Netdata's host_packets chart (summed per step) and are scaled down to
    fit 255 when needed, keeping the loss ratio."""
    url = clean_url(url)
    base = chart_rtt.replace(".host_rtt_", ".host_{}_")
    after = -int(days * 86400)
    points = max(1, int(days * 86400 / step))

    def series(chart, group="average"):
        q = {"chart": chart, "after": after, "points": points, "group": group, "format": "json", "options": "seconds"}
        try:
            d = _get(url + "/api/v1/data?" + urllib.parse.urlencode(q), timeout=120)
        except Exception as e:
            log.info("netdata %s: %s", chart, e)
            return {}
        labels = d.get("labels", [])
        return {int(row[0]): dict(zip(labels[1:], row[1:])) for row in d.get("data", [])}

    rtt = series(chart_rtt)
    pk = series(base.format("packets"), "sum")
    jit = series(base.format("jitter"))
    out = []
    for t, p in pk.items():
        sent, recv = p.get("sent"), p.get("received")
        if not sent:
            continue
        sent, recv = float(sent), float(recv or 0)
        lost = max(0.0, sent - recv)
        if sent > 255:
            lost, sent = lost * 255 / sent, 255
        sent_i = max(1, int(round(sent)))
        lost_i = min(sent_i, int(round(lost)))
        r = rtt.get(t) or {}
        out.append((t - t % step, sent_i, lost_i, r.get("min"), r.get("avg"), r.get("max"), (jit.get(t) or {}).get("mean")))
    return out
