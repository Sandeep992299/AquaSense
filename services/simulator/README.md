# AquaSense IoT Water Meter Simulator

## Overview

Simulates one or more smart water meters registered in **AWS IoT Core / Greengrass**. Each virtual meter:

- Connects to AWS IoT Core (or a local Greengrass Core) using **mutual TLS** (X.509 certificates).
- Publishes periodic JSON telemetry to `aquasense/telemetry/{meter_id}`.
- Updates the **AWS IoT Device Shadow** to reflect current state.
- Fires alerts to `aquasense/alerts/{meter_id}` when a single reading exceeds the high-flow threshold.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Python 3.8+ | `python --version` |
| AWS IoT Core thing registered | Console → IoT Core → Things |
| Device certificate + private key + Amazon Root CA | Downloaded when you create the thing |
| (Optional) Greengrass Core running locally | For Greengrass mode |

---

## Setup

```bash
# 1. Create a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt
```

Place your certificates in a `certs/` sub-folder:

```
services/simulator/
├── certs/
│   ├── AmazonRootCA1.pem
│   ├── device.pem.crt
│   └── private.pem.key
├── iot_meter_simulator.py
└── requirements.txt
```

---

## Running the Simulator

### Directly to AWS IoT Core

```bash
python iot_meter_simulator.py \
  --endpoint xxxxxx-ats.iot.us-east-1.amazonaws.com \
  --cert     certs/device.pem.crt \
  --key      certs/private.pem.key \
  --ca       certs/AmazonRootCA1.pem \
  --meter-ids meter-001,meter-002,meter-003 \
  --interval  5
```

### Through a Local Greengrass Core

```bash
python iot_meter_simulator.py \
  --endpoint <greengrass-core-ip-or-hostname> \
  --cert     certs/device.pem.crt \
  --key      certs/private.pem.key \
  --ca       certs/AmazonRootCA1.pem \
  --greengrass
```

### Via Environment Variables

```bash
export ENDPOINT="xxxxxx-ats.iot.us-east-1.amazonaws.com"
export CERT_PATH="certs/device.pem.crt"
export KEY_PATH="certs/private.pem.key"
export CA_PATH="certs/AmazonRootCA1.pem"
export METER_IDS="meter-001,meter-002"
export PUBLISH_INTERVAL="5"
export GREENGRASS_MODE="0"   # set to "1" for Greengrass

python iot_meter_simulator.py
```

---

## MQTT Topics Published

| Topic | Purpose |
|---|---|
| `aquasense/telemetry/{meter_id}` | Periodic water usage readings |
| `$aws/things/{meter_id}/shadow/update` | Device Shadow reported state |
| `aquasense/alerts/{meter_id}` | High-flow alert (conditional) |

---

## Sample Telemetry Payload

```json
{
  "meter_id": "meter-001",
  "zone": "zone-1",
  "water_usage_liters": 7.342,
  "cumulative_liters": 123.456,
  "daily_budget_liters": 200.0,
  "budget_remaining_liters": 76.544,
  "reading_id": "a1b2c3d4-...",
  "reading_count": 18,
  "alert": false,
  "alert_type": null,
  "unit": "liters",
  "timestamp": "2026-05-03T12:49:00+00:00",
  "session_start": "2026-05-03T12:30:00+00:00"
}
```

---

## AWS IoT Core Setup Checklist

1. **Create a Thing** → IoT Core → Manage → Things → Create thing
2. **Attach a certificate** (auto-generate) and download all four files
3. **Attach a Policy** to the certificate with at minimum:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["iot:Connect"],
      "Resource": "arn:aws:iot:<region>:<account>:client/aquasense-sim-*"
    },
    {
      "Effect": "Allow",
      "Action": ["iot:Publish"],
      "Resource": [
        "arn:aws:iot:<region>:<account>:topic/aquasense/*",
        "arn:aws:iot:<region>:<account>:topic/$aws/things/*/shadow/update"
      ]
    }
  ]
}
```

4. **Find your endpoint**: IoT Core → Settings → Device data endpoint
5. (Optional) Set up an **IoT Rule** to forward `aquasense/telemetry/#` to DynamoDB / Lambda / your `usage-service`.

---

## Verifying Messages in AWS Console

1. Open **AWS IoT Core → MQTT Test Client**
2. Subscribe to `aquasense/telemetry/#`
3. Run the simulator — messages should appear within seconds
