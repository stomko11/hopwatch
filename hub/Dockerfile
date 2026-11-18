# Build from the repository root:  docker build -f hub/Dockerfile .
FROM alpine:3.20

RUN apk add --no-cache python3 tzdata ca-certificates tini

COPY hub/app /app
COPY shared/*.py /app/
COPY ui /app/ui
COPY probe/app/static/icon.svg probe/app/static/icon.png /app/static/

ENV HOPWATCH_PORT=8090 \
    HOPWATCH_DATA=/data \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

VOLUME /data
EXPOSE 8090

HEALTHCHECK --interval=60s --timeout=5s --start-period=15s \
  CMD wget -qO- "http://127.0.0.1:${HOPWATCH_PORT}/healthz" >/dev/null || exit 1

LABEL org.opencontainers.image.title="Hopwatch Hub" \
      org.opencontainers.image.description="One page for several Hopwatch Probes: what several sites see at once, and what only one site sees." \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["python3", "/app/main.py"]
