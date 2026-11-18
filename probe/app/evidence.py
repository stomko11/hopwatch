"""Exports: MTR runs as text / JSON / ZIP, ping data as CSV, and an evidence pack for a time window."""
import csv
import io
import json
import time
import zipfile
from datetime import datetime, timezone

from config import VERSION


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if t else ""


def run_name(r) -> str:
    return f"mtr-{r['id']}-{r['host']}-{time.strftime('%Y%m%d-%H%M%S', time.gmtime(r.get('started') or r['created']))}Z"


def runs_text(runs) -> str:
    """All reports one after another, ready to paste into a ticket."""
    parts = []
    for r in runs:
        if r.get("report"):
            parts.append(r["report"].rstrip())
        else:
            parts.append(f"MTR #{r['id']} to {r['host']}: {r['status']}" + (f" ({r['error']})" if r.get("error") else ""))
    return ("\n\n" + "-" * 78 + "\n\n").join(parts) + "\n"


def series_csv(data, targets, step) -> str:
    """data: {host: [(t, acc or None)]} from Store.series."""
    loc = {t["host"]: t["location"] for t in targets}
    role = {t["host"]: t.get("role") or "" for t in targets}
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["time_utc", "location", "role", "target", "seconds", "sent", "lost", "loss_pct", "avg_ms", "min_ms", "max_ms", "jitter_ms"])
    for host, rows in data.items():
        for t, v in rows:
            if v:
                w.writerow([iso(t), loc.get(host, ""), role.get(host, ""), host, step, v["sent"], v["lost"], v["loss"],
                            v["avg"], v["min"], v["max"], v["jitter"]])
    return out.getvalue()


def events_csv(events) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["time_utc", "kind", "location", "target", "level", "details"])
    for e in sorted(events, key=lambda x: x["t"]):
        extra = {k: v for k, v in e.items() if k not in ("t", "kind", "location", "host", "level")}
        w.writerow([iso(e["t"]), e["kind"], e.get("location") or "", e.get("host") or "", e.get("level") or "",
                    json.dumps(extra) if extra else ""])
    return out.getvalue()


def runs_index_csv(runs) -> str:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["id", "started_utc", "location", "target", "mode", "port", "cycles", "trigger", "reason", "status",
                "loss_at_target_pct", "hops", "file"])
    for r in runs:
        w.writerow([r["id"], iso(r.get("started") or r["created"]), r["location"], r["host"], r["mode"], r.get("port") or "",
                    r["cycles"], r["trig"], r.get("reason") or "", r["status"], r.get("dst_loss") if r.get("dst_loss") is not None else "",
                    r.get("hops") or "", run_name(r) + ".txt" if r.get("report") else ""])
    return out.getvalue()


def summary(data, targets):
    """Per target: totals over the whole window."""
    loc = {t["host"]: t["location"] for t in targets}
    rows = []
    for host, buckets in data.items():
        sent = lost = 0
        avgs, mx = [], 0
        for _, v in buckets:
            if not v:
                continue
            sent += v["sent"]
            lost += v["lost"]
            if v["avg"] is not None:
                avgs.append((v["avg"], v["sent"] - v["lost"]))
                mx = max(mx, v["max"] or 0)
        n = sum(w for _, w in avgs)
        rows.append({"location": loc.get(host, ""), "host": host, "sent": sent, "lost": lost,
                     "loss": round(100.0 * lost / sent, 2) if sent else None,
                     "avg": round(sum(a * w for a, w in avgs) / n, 1) if n else None, "max": mx or None})
    return sorted(rows, key=lambda r: (r["location"], r["host"]))


def pack(site, public_ip, t0, t1, targets, data, step, events, runs, note="") -> bytes:
    """One ZIP with everything about a time window: a readable summary first, raw data after."""
    rows = summary(data, targets)
    lines = [
        f"Evidence pack from Hopwatch Probe {VERSION}",
        f"Site:      {site}" + (f"  (public IP {public_ip})" if public_ip else ""),
        f"Window:    {iso(t0)}  to  {iso(t1)}  (UTC)",
        f"Created:   {iso(time.time())}",
        f"Ping data: one row per target per {step} s in ping.csv",
    ]
    if note:
        lines += ["", "Note: " + note]
    lines += ["", "Per target over the whole window", ""]
    lines.append(f"{'Location':<22} {'Target':<40} {'Sent':>7} {'Lost':>6} {'Loss%':>6} {'Avg ms':>8} {'Max ms':>8}")
    for r in rows:
        lines.append(f"{r['location'][:22]:<22} {r['host'][:40]:<40} {r['sent']:>7} {r['lost']:>6} "
                     f"{'' if r['loss'] is None else format(r['loss'], '.2f'):>6} "
                     f"{'' if r['avg'] is None else r['avg']:>8} {'' if r['max'] is None else r['max']:>8}")
    status = [e for e in events if e["kind"] == "status"]
    lines += ["", f"Status changes in the window: {len(status)} (all events in events.csv)"]
    for e in sorted(status, key=lambda x: x["t"])[:200]:
        lines.append(f"  {iso(e['t'])}  {e.get('location') or ''} {e.get('host') or ''}: {e.get('before')} -> {e.get('level')}"
                     + (f"  loss {e['loss']}%" if e.get("loss") is not None else ""))
    lines += ["", f"MTR runs in the window: {len(runs)} (index in mtr/index.csv)"]
    for r in sorted(runs, key=lambda x: x.get("started") or x["created"]):
        lines.append(f"  #{r['id']}  {iso(r.get('started') or r['created'])}  {r['host']} ({r['location']})  "
                     f"{r['mode'].upper()}  {r['trig']}{(': ' + r['reason']) if r.get('reason') else ''}  "
                     f"loss at target {'' if r.get('dst_loss') is None else str(r['dst_loss']) + '%'}")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("README.txt", "\n".join(lines) + "\n")
        z.writestr("ping.csv", series_csv(data, targets, step))
        z.writestr("events.csv", events_csv(events))
        z.writestr("mtr/index.csv", runs_index_csv(runs))
        if runs:
            z.writestr("mtr/all-reports.txt", runs_text(runs))
        for r in runs:
            if r.get("report"):
                z.writestr(f"mtr/{run_name(r)}.txt", r["report"])
            if r.get("result"):
                z.writestr(f"mtr/{run_name(r)}.json", json.dumps(r["result"], indent=1))
    return buf.getvalue()


def runs_zip(runs) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("index.csv", runs_index_csv(runs))
        z.writestr("all-reports.txt", runs_text(runs))
        for r in runs:
            if r.get("report"):
                z.writestr(f"{run_name(r)}.txt", r["report"])
            if r.get("result"):
                z.writestr(f"{run_name(r)}.json", json.dumps(r["result"], indent=1))
    return buf.getvalue()
