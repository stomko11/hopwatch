FROM alpine:3.20

RUN apk add --no-cache python3 fping mtr tzdata ca-certificates tini

COPY app /app

ENV HOPWATCH_PORT=8095 \
    HOPWATCH_DATA=/data \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

VOLUME /data
EXPOSE 8095

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO- "http://127.0.0.1:${HOPWATCH_PORT}/healthz" >/dev/null || exit 1

LABEL org.opencontainers.image.title="Hopwatch Probe" \
      org.opencontainers.image.description="Pings targets every second, keeps the history and runs MTR on demand or when loss goes up." \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["python3", "/app/main.py"]
