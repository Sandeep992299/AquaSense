# ── Build stage ─────────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM python:3.11-slim

LABEL org.opencontainers.image.title="AquaSense IoT Water Meter Simulator"
LABEL org.opencontainers.image.description="Simulates smart water meters publishing to AWS IoT Core"
LABEL org.opencontainers.image.version="1.0.0"

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy simulator source
COPY iot_meter_simulator.py .

# Certificates must be mounted at runtime – never bake secrets into an image.
# docker run ... -v $(pwd)/certs:/app/certs aquasense-simulator
VOLUME ["/app/certs"]

# ── Environment variable defaults (override at docker run / ECS task def) ────
ENV ENDPOINT=""
ENV CERT_PATH="/app/certs/device.pem.crt"
ENV KEY_PATH="/app/certs/private.pem.key"
ENV CA_PATH="/app/certs/AmazonRootCA1.pem"
ENV METER_IDS="meter-001,meter-002,meter-003"
ENV PUBLISH_INTERVAL="5"
ENV GREENGRASS_MODE="0"

# Non-root user for security
RUN addgroup --system aquasense && adduser --system --ingroup aquasense aquasense
USER aquasense

ENTRYPOINT ["python", "-u", "iot_meter_simulator.py"]
