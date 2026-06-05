"""
AquaSense IoT Water Meter Simulator
=====================================
Simulates one or more smart water meters registered in AWS IoT Core / Greengrass.
Each meter publishes periodic JSON telemetry to the MQTT topic:
    aquasense/telemetry/{meter_id}

Shadow updates are also published so the device state is visible in AWS IoT Device Shadow.

Required environment variables (or pass as CLI args):
    ENDPOINT        - AWS IoT Core ATS endpoint  (e.g. xxxxxx-ats.iot.us-east-1.amazonaws.com)
    CERT_PATH       - Path to the device certificate (.pem.crt)
    KEY_PATH        - Path to the private key (.pem.key)
    CA_PATH         - Path to the Amazon Root CA (.pem)
    METER_IDS       - Comma-separated meter IDs (default: meter-001,meter-002,meter-003)
    PUBLISH_INTERVAL- Seconds between publishes (default: 5)
    GREENGRASS_MODE - Set to "1" to connect through a local Greengrass Core instead of IoT Core directly

Usage:
    pip install -r requirements.txt
    python iot_meter_simulator.py \
        --endpoint xxxxxx-ats.iot.us-east-1.amazonaws.com \
        --cert    certs/device.pem.crt \
        --key     certs/private.pem.key \
        --ca      certs/AmazonRootCA1.pem
"""

import argparse
import json
import logging
import os
import random
import signal
import sys
import time
import threading
import uuid
import urllib.request
from dotenv import load_dotenv
load_dotenv()
from datetime import datetime, timezone
from concurrent.futures import Future

# AWS IoT Device SDK v2
from awscrt import io, mqtt
from awsiot import mqtt_connection_builder

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("AquaSenseSimulator")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
TELEMETRY_TOPIC_PREFIX = "aquasense/telemetry"
SHADOW_TOPIC_PREFIX = "$aws/things/{meter_id}/shadow/update"
ALERT_THRESHOLD_LITERS = 20.0          # single-reading alert threshold
DAILY_BUDGET_LITERS = 200.0            # per-meter daily budget
CLIENT_ID_PREFIX = "aquasense-sim"

# Mapping of seeded meters to their corresponding database user IDs and types
METER_USER_MAP = {
    "SMT-W-0041": {"userId": "b1031dfa-00a1-7027-bb09-2f4ed1abb296", "type": "water"},
    "SMT-W-0042": {"userId": "b1031dfa-00a1-7027-bb09-2f4ed1abb296", "type": "water"},
    "SMT-E-0087": {"userId": "b1031dfa-00a1-7027-bb09-2f4ed1abb296", "type": "energy"},
    "SMT-W-0043": {"userId": "a0000001-0000-0000-0000-000000000002", "type": "water"},
    "SMT-E-0088": {"userId": "a0000001-0000-0000-0000-000000000002", "type": "energy"},
    "SMT-W-0044": {"userId": "a0000001-0000-0000-0000-000000000002", "type": "water"}
}

def _post_to_alb(alb_endpoint: str, meter_id: str, value: float):
    # Map meter
    info = METER_USER_MAP.get(meter_id, {
        "userId": "a0000001-0000-0000-0000-000000000001",
        "type": "water"
    })
    
    payload = {
        "meterId": meter_id,
        "type": info["type"],
        "value": value,
        "pressure": round(random.uniform(2.0, 3.0), 1) if info["type"] == "water" else None,
        "userId": info["userId"]
    }
    
    url = f"{alb_endpoint.rstrip('/')}/api/usage/ingest"
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            pass
    except Exception as e:
        log.warning("[%s] Failed to ingest via REST to ALB: %s", meter_id, e)

# ---------------------------------------------------------------------------
# MeterState – tracks cumulative usage per meter
# ---------------------------------------------------------------------------
class MeterState:
    def __init__(self, meter_id: str, zone: str = "zone-A"):
        self.meter_id = meter_id
        self.zone = zone
        self.cumulative_liters = 0.0
        self.session_start = datetime.now(timezone.utc).isoformat()
        self.reading_count = 0
        self.alert_count = 0
        self._lock = threading.Lock()

    def next_reading(self) -> dict:
        """Generate one simulated water-flow reading."""
        with self._lock:
            # Simulate realistic burst (0-25 L) with occasional zero (tap off)
            if random.random() < 0.15:          # 15 % chance tap is off
                flow = 0.0
            else:
                flow = round(random.gauss(mu=8.0, sigma=4.5), 3)
                flow = max(0.0, flow)

            self.cumulative_liters += flow
            self.reading_count += 1
            alert = flow > ALERT_THRESHOLD_LITERS
            if alert:
                self.alert_count += 1

            payload = {
                "meter_id": self.meter_id,
                "zone": self.zone,
                "water_usage_liters": round(flow, 3),
                "cumulative_liters": round(self.cumulative_liters, 3),
                "daily_budget_liters": DAILY_BUDGET_LITERS,
                "budget_remaining_liters": round(
                    max(0.0, DAILY_BUDGET_LITERS - self.cumulative_liters), 3
                ),
                "reading_id": str(uuid.uuid4()),
                "reading_count": self.reading_count,
                "alert": alert,
                "alert_type": "HIGH_FLOW" if alert else None,
                "unit": "liters",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "session_start": self.session_start,
            }
            return payload

    def shadow_payload(self, reported: dict) -> dict:
        """Wrap telemetry as an IoT Device Shadow reported state."""
        return {
            "state": {
                "reported": {
                    "meter_id": reported["meter_id"],
                    "zone": reported["zone"],
                    "cumulative_liters": reported["cumulative_liters"],
                    "last_reading_liters": reported["water_usage_liters"],
                    "alert": reported["alert"],
                    "online": True,
                    "timestamp": reported["timestamp"],
                }
            }
        }


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------
def build_connection(endpoint: str, cert: str, key: str, ca: str,
                     client_id: str, greengrass_mode: bool) -> mqtt.Connection:
    """
    Build an MQTT connection to either:
      - AWS IoT Core directly (standard mTLS)
      - A local Greengrass Core (same mTLS but host is 'localhost' or GG discovery endpoint)
    """
    event_loop_group = io.EventLoopGroup(1)
    host_resolver = io.DefaultHostResolver(event_loop_group)
    client_bootstrap = io.ClientBootstrap(event_loop_group, host_resolver)

    if greengrass_mode:
        # When running as a Greengrass client-device, connect to the local core.
        # The endpoint should be overridden to the Greengrass Core IP / hostname.
        log.info("Greengrass mode: connecting to local Greengrass Core at %s", endpoint)

    conn = mqtt_connection_builder.mtls_from_path(
        endpoint=endpoint,
        cert_filepath=cert,
        pri_key_filepath=key,
        client_bootstrap=client_bootstrap,
        ca_filepath=ca,
        client_id=client_id,
        clean_session=False,
        keep_alive_secs=30,
        on_connection_interrupted=_on_connection_interrupted,
        on_connection_resumed=_on_connection_resumed,
    )
    return conn


def _on_connection_interrupted(connection, error, **kwargs):
    log.warning("Connection interrupted: %s", error)


def _on_connection_resumed(connection, return_code, session_present, **kwargs):
    log.info("Connection resumed (return_code=%s, session_present=%s)",
             return_code, session_present)


# ---------------------------------------------------------------------------
# Publisher thread – one per meter
# ---------------------------------------------------------------------------
class MeterPublisher(threading.Thread):
    def __init__(self, meter: MeterState, connection: mqtt.Connection,
                 interval: float, stop_event: threading.Event, alb_endpoint: str = None):
        super().__init__(name=f"publisher-{meter.meter_id}", daemon=True)
        self.meter = meter
        self.connection = connection
        self.interval = interval
        self.stop_event = stop_event
        self.alb_endpoint = alb_endpoint

    def _publish(self, topic: str, payload: dict):
        message = json.dumps(payload)
        future, _ = self.connection.publish(
            topic=topic,
            payload=message,
            qos=mqtt.QoS.AT_LEAST_ONCE,
        )
        future.result()          # block until broker ACKs

    def run(self):
        log.info("[%s] Publisher started – interval=%.1fs", self.meter.meter_id, self.interval)
        while not self.stop_event.is_set():
            try:
                reading = self.meter.next_reading()

                # ── Telemetry topic ──────────────────────────────────────────
                telemetry_topic = f"{TELEMETRY_TOPIC_PREFIX}/{self.meter.meter_id}"
                self._publish(telemetry_topic, reading)
                log.info(
                    "[%s] ✔ Published → %s | flow=%.3fL  cumulative=%.3fL  alert=%s",
                    self.meter.meter_id, telemetry_topic,
                    reading["water_usage_liters"],
                    reading["cumulative_liters"],
                    reading["alert"],
                )

                # ── Device Shadow update ─────────────────────────────────────
                shadow_topic = SHADOW_TOPIC_PREFIX.format(meter_id=self.meter.meter_id)
                self._publish(shadow_topic, self.meter.shadow_payload(reading))

                # ── Alert topic (conditional) ────────────────────────────────
                if reading["alert"]:
                    alert_payload = {
                        "meter_id": self.meter.meter_id,
                        "alert_type": reading["alert_type"],
                        "value": reading["water_usage_liters"],
                        "threshold": ALERT_THRESHOLD_LITERS,
                        "timestamp": reading["timestamp"],
                    }
                    self._publish(f"aquasense/alerts/{self.meter.meter_id}", alert_payload)
                    log.warning("[%s] ⚠ HIGH FLOW ALERT  %.3fL > %.1fL",
                                self.meter.meter_id, reading["water_usage_liters"],
                                ALERT_THRESHOLD_LITERS)

                # ── ALB Ingestion (optional REST sync) ──────────────────────
                if self.alb_endpoint:
                    _post_to_alb(self.alb_endpoint, self.meter.meter_id, reading["water_usage_liters"])

            except Exception as exc:
                log.error("[%s] Publish error: %s", self.meter.meter_id, exc)

            self.stop_event.wait(timeout=self.interval)

        log.info("[%s] Publisher stopped.", self.meter.meter_id)


# ---------------------------------------------------------------------------
# CLI argument parsing
# ---------------------------------------------------------------------------
def parse_args():
    p = argparse.ArgumentParser(
        description="AquaSense IoT Water Meter Simulator",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--endpoint",  default=os.getenv("ENDPOINT"),
                   help="AWS IoT Core ATS endpoint hostname")
    p.add_argument("--cert",      default=os.getenv("CERT_PATH"),
                   help="Path to device certificate (.pem.crt)")
    p.add_argument("--key",       default=os.getenv("KEY_PATH"),
                   help="Path to device private key (.pem.key)")
    p.add_argument("--ca",        default=os.getenv("CA_PATH"),
                   help="Path to Amazon Root CA (.pem)")
    p.add_argument("--meter-ids", default=os.getenv("METER_IDS", "meter-001,meter-002,meter-003"),
                   help="Comma-separated meter IDs to simulate")
    p.add_argument("--interval",  type=float,
                   default=float(os.getenv("PUBLISH_INTERVAL", "5")),
                   help="Seconds between readings")
    p.add_argument("--greengrass", action="store_true",
                   default=os.getenv("GREENGRASS_MODE", "0") == "1",
                   help="Connect through a local Greengrass Core instead of IoT Core directly")
    p.add_argument("--alb-endpoint", default=os.getenv("ALB_ENDPOINT"),
                   help="ALB DNS name for database REST ingestion")
    p.add_argument("--verbose", action="store_true",
                   help="Enable debug logging")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    args = parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Validate required arguments
    missing = [n for n, v in [("--endpoint", args.endpoint),
                               ("--cert",     args.cert),
                               ("--key",      args.key),
                               ("--ca",       args.ca)] if not v]
    if missing:
        log.error("Missing required arguments: %s", ", ".join(missing))
        log.error("Set them via CLI flags or environment variables "
                  "(ENDPOINT, CERT_PATH, KEY_PATH, CA_PATH).")
        sys.exit(1)

    meter_ids = [m.strip() for m in args.meter_ids.split(",") if m.strip()]
    log.info("AquaSense IoT Simulator starting")
    log.info("  Endpoint  : %s", args.endpoint)
    log.info("  Meters    : %s", meter_ids)
    log.info("  Interval  : %.1f s", args.interval)
    log.info("  Greengrass: %s", args.greengrass)

    # ── Build one MQTT connection per meter (unique client-id required) ──
    connections: list[tuple[mqtt.Connection, MeterState]] = []
    for meter_id in meter_ids:
        client_id = f"{CLIENT_ID_PREFIX}-{meter_id}-{uuid.uuid4().hex[:6]}"
        conn = build_connection(
            endpoint=args.endpoint,
            cert=args.cert,
            key=args.key,
            ca=args.ca,
            client_id=client_id,
            greengrass_mode=args.greengrass,
        )
        log.info("Connecting meter '%s' (client_id=%s) …", meter_id, client_id)
        connect_future = conn.connect()
        connect_future.result()    # raises on failure
        log.info("  ✔ Connected: %s", meter_id)

        meter = MeterState(meter_id=meter_id, zone=f"zone-{meter_id[-1].upper()}")
        connections.append((conn, meter))

    # ── Graceful shutdown on Ctrl-C / SIGTERM ───────────────────────────
    stop_event = threading.Event()

    def _shutdown(signum, frame):
        log.info("Shutdown signal received – stopping…")
        stop_event.set()

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # ── Start one publisher thread per meter ─────────────────────────────
    threads: list[MeterPublisher] = []
    for conn, meter in connections:
        t = MeterPublisher(meter=meter, connection=conn,
                           interval=args.interval, stop_event=stop_event,
                           alb_endpoint=args.alb_endpoint)
        t.start()
        threads.append(t)

    log.info("All meters running. Press Ctrl-C to stop.\n")

    # Wait until stop_event is set (either by signal or error)
    stop_event.wait()

    # ── Cleanup ──────────────────────────────────────────────────────────
    for t in threads:
        t.join(timeout=5)

    for conn, meter in connections:
        log.info("Disconnecting meter '%s' …", meter.meter_id)
        # Publish offline shadow before disconnecting
        shadow_topic = SHADOW_TOPIC_PREFIX.format(meter_id=meter.meter_id)
        try:
            offline_shadow = {"state": {"reported": {"online": False,
                                                      "meter_id": meter.meter_id}}}
            pub_future, _ = conn.publish(
                topic=shadow_topic,
                payload=json.dumps(offline_shadow),
                qos=mqtt.QoS.AT_LEAST_ONCE,
            )
            pub_future.result()
        except Exception:
            pass
        disconnect_future = conn.disconnect()
        disconnect_future.result()
        log.info("  ✔ Disconnected: %s  (total readings: %d  alerts: %d)",
                 meter.meter_id, meter.reading_count, meter.alert_count)

    log.info("AquaSense Simulator shut down cleanly.")


if __name__ == "__main__":
    main()
