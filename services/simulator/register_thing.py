"""
register_thing.py – AWS IoT Core Thing Registration Helper
===========================================================
Automates the one-time setup for each simulated water meter:
  1. Creates an IoT Thing in AWS IoT Core (if not already present)
  2. Creates and attaches an X.509 certificate + private key
  3. Creates and attaches a least-privilege IoT Policy
  4. Saves all certificate files to ./certs/<meter_id>/

Requirements:
    pip install boto3
    AWS credentials configured (env vars, ~/.aws/credentials, or IAM role)

Usage:
    python register_thing.py --region us-east-1 --meter-ids meter-001,meter-002,meter-003
"""

import argparse
import json
import logging
import os
import sys
import urllib.request

import boto3
from botocore.exceptions import ClientError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("RegisterThing")

THING_TYPE  = "AquaSenseWaterMeter"
POLICY_NAME = "AquaSenseSimulatorPolicy"
CA_URL      = "https://www.amazontrust.com/repository/AmazonRootCA1.pem"
CERT_DIR    = os.path.join(os.path.dirname(__file__), "certs")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ensure_thing_type(iot_client, region: str):
    """Create the AquaSenseWaterMeter thing type if it doesn't exist."""
    try:
        iot_client.create_thing_type(
            thingTypeName=THING_TYPE,
            thingTypeProperties={
                "thingTypeDescription": "AquaSense simulated smart water meter",
                "searchableAttributes": ["zone", "meter_id"],
            },
        )
        log.info("Created thing type: %s", THING_TYPE)
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceAlreadyExistsException":
            log.info("Thing type already exists: %s", THING_TYPE)
        else:
            raise


def ensure_policy(iot_client, account_id: str, region: str):
    """Create the IoT policy (idempotent)."""
    policy_document = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": ["iot:Connect"],
                "Resource": f"arn:aws:iot:{region}:{account_id}:client/aquasense-sim-*",
            },
            {
                "Effect": "Allow",
                "Action": ["iot:Publish"],
                "Resource": [
                    f"arn:aws:iot:{region}:{account_id}:topic/aquasense/*",
                    f"arn:aws:iot:{region}:{account_id}:topic/$aws/things/*/shadow/update",
                ],
            },
            {
                "Effect": "Allow",
                "Action": ["iot:Subscribe"],
                "Resource": [
                    f"arn:aws:iot:{region}:{account_id}:topicfilter/aquasense/*",
                    f"arn:aws:iot:{region}:{account_id}:topicfilter/$aws/things/*/shadow/*",
                ],
            },
            {
                "Effect": "Allow",
                "Action": ["iot:Receive"],
                "Resource": [
                    f"arn:aws:iot:{region}:{account_id}:topic/aquasense/*",
                    f"arn:aws:iot:{region}:{account_id}:topic/$aws/things/*/shadow/*",
                ],
            },
        ],
    }
    try:
        iot_client.create_policy(
            policyName=POLICY_NAME,
            policyDocument=json.dumps(policy_document),
        )
        log.info("Created IoT policy: %s", POLICY_NAME)
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceAlreadyExistsException":
            log.info("IoT policy already exists: %s", POLICY_NAME)
        else:
            raise


def download_root_ca(dest_dir: str) -> str:
    """Download AmazonRootCA1.pem once and cache it locally."""
    ca_path = os.path.join(dest_dir, "AmazonRootCA1.pem")
    if os.path.exists(ca_path):
        return ca_path
    log.info("Downloading Amazon Root CA → %s", ca_path)
    urllib.request.urlretrieve(CA_URL, ca_path)
    return ca_path


def register_meter(iot_client, meter_id: str, region: str) -> dict:
    """
    Register one meter as an IoT Thing, issue a certificate, and save credentials.
    Returns a dict with paths to all credential files.
    """
    meter_cert_dir = os.path.join(CERT_DIR, meter_id)
    os.makedirs(meter_cert_dir, exist_ok=True)

    # ── 1. Create / describe Thing ───────────────────────────────────────
    try:
        thing_resp = iot_client.create_thing(
            thingName=meter_id,
            thingTypeName=THING_TYPE,
            attributePayload={"attributes": {"meter_id": meter_id}},
        )
        log.info("[%s] ✔ Thing created: %s", meter_id, thing_resp["thingArn"])
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceAlreadyExistsException":
            log.info("[%s] Thing already exists.", meter_id)
        else:
            raise

    # ── 2. Create certificate + key pair ────────────────────────────────
    cert_resp = iot_client.create_keys_and_certificate(setAsActive=True)
    cert_arn  = cert_resp["certificateArn"]
    cert_id   = cert_resp["certificateId"]

    cert_path = os.path.join(meter_cert_dir, "device.pem.crt")
    key_path  = os.path.join(meter_cert_dir, "private.pem.key")
    pub_path  = os.path.join(meter_cert_dir, "public.pem.key")

    with open(cert_path, "w") as f:
        f.write(cert_resp["certificatePem"])
    with open(key_path, "w") as f:
        f.write(cert_resp["keyPair"]["PrivateKey"])
    with open(pub_path, "w") as f:
        f.write(cert_resp["keyPair"]["PublicKey"])

    log.info("[%s] ✔ Certificate saved → %s", meter_id, cert_path)

    # ── 3. Attach policy ─────────────────────────────────────────────────
    iot_client.attach_policy(policyName=POLICY_NAME, target=cert_arn)
    log.info("[%s] ✔ Policy '%s' attached.", meter_id, POLICY_NAME)

    # ── 4. Attach certificate to thing ───────────────────────────────────
    iot_client.attach_thing_principal(thingName=meter_id, principal=cert_arn)
    log.info("[%s] ✔ Certificate attached to thing.", meter_id)

    # ── 5. Download Root CA (shared) ─────────────────────────────────────
    ca_path = download_root_ca(CERT_DIR)

    return {
        "meter_id":   meter_id,
        "cert_id":    cert_id,
        "cert_arn":   cert_arn,
        "cert_path":  cert_path,
        "key_path":   key_path,
        "ca_path":    ca_path,
    }


def get_endpoint(iot_client) -> str:
    resp = iot_client.describe_endpoint(endpointType="iot:Data-ATS")
    return resp["endpointAddress"]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args():
    p = argparse.ArgumentParser(
        description="Register AquaSense water meter Things in AWS IoT Core",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--region",     default=os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
    p.add_argument("--meter-ids",  default="meter-001,meter-002,meter-003",
                   help="Comma-separated meter IDs to register")
    p.add_argument("--profile",    default=None,
                   help="AWS CLI named profile to use")
    return p.parse_args()


def main():
    args  = parse_args()
    meter_ids = [m.strip() for m in args.meter_ids.split(",") if m.strip()]

    session    = boto3.Session(region_name=args.region, profile_name=args.profile)
    iot_client = session.client("iot")
    sts_client = session.client("sts")

    account_id = sts_client.get_caller_identity()["Account"]
    endpoint   = get_endpoint(iot_client)

    log.info("AWS Account : %s", account_id)
    log.info("AWS Region  : %s", args.region)
    log.info("IoT Endpoint: %s", endpoint)
    log.info("Meters      : %s", meter_ids)
    print()

    os.makedirs(CERT_DIR, exist_ok=True)
    ensure_thing_type(iot_client, args.region)
    ensure_policy(iot_client, account_id, args.region)

    results = []
    for meter_id in meter_ids:
        try:
            info = register_meter(iot_client, meter_id, args.region)
            results.append(info)
        except Exception as exc:
            log.error("[%s] Registration failed: %s", meter_id, exc)
            sys.exit(1)

    # ── Print run command ────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("✅  All meters registered successfully!")
    print("=" * 70)
    print("\nRun the simulator with:\n")
    first = results[0]
    print(
        f"  python iot_meter_simulator.py \\\n"
        f"    --endpoint {endpoint} \\\n"
        f"    --cert     certs/{first['meter_id']}/device.pem.crt \\\n"
        f"    --key      certs/{first['meter_id']}/private.pem.key \\\n"
        f"    --ca       certs/AmazonRootCA1.pem \\\n"
        f"    --meter-ids {','.join(meter_ids)} \\\n"
        f"    --interval  5\n"
    )

    # ── Write .env for convenience ───────────────────────────────────────
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    with open(env_path, "w") as f:
        f.write(f"ENDPOINT={endpoint}\n")
        f.write(f"CERT_PATH=certs/{first['meter_id']}/device.pem.crt\n")
        f.write(f"KEY_PATH=certs/{first['meter_id']}/private.pem.key\n")
        f.write(f"CA_PATH=certs/AmazonRootCA1.pem\n")
        f.write(f"METER_IDS={','.join(meter_ids)}\n")
        f.write("PUBLISH_INTERVAL=5\n")
        f.write("GREENGRASS_MODE=0\n")
    log.info("Saved .env → %s", env_path)


if __name__ == "__main__":
    main()
