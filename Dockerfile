# One image for both apps. HOPWATCH_PROBE / HOPWATCH_HUB choose what runs (see launcher/run.py).
FROM alpine:3.20

RUN apk add --no-cache python3 fping mtr tzdata ca-certificates tini

COPY probe/app /app/probe
COPY hub/app /app/hub
COPY shared /app/shared
COPY ui /app/ui
COPY launcher/run.py /app/run.py
COPY probe/app/static/icon.svg probe/app/static/icon.png /app/hub/static/

ENV HOPWATCH_PROBE=true \
    HOPWATCH_PROBE_PORT=8095 \
    HOPWATCH_HUB=false \
    HOPWATCH_HUB_PORT=8090 \
    HOPWATCH_DATA=/data \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

VOLUME /data
EXPOSE 8095 8090

HEALTHCHECK --interval=60s --timeout=10s --start-period=20s CMD python3 /app/run.py --health

LABEL org.opencontainers.image.title="Hopwatch" \
      org.opencontainers.image.description="Probe: 1 s ping history and MTR on demand, on a schedule or when something goes wrong. Hub: several probes on one page, what several sites see at once." \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["python3", "/app/run.py"]
