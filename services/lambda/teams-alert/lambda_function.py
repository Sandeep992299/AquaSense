"""
AquaSense – Teams Alert Lambda
==============================
Triggered by:
  • AWS SNS (via subscription)  → event source: sns
  • AWS SQS (via event-source mapping) → event source: sqs
  • AWS IoT Rule (direct invoke) → event source: iot

Sends a nicely formatted Adaptive Card to Microsoft Teams via an
Incoming Webhook URL stored in AWS Secrets Manager.

Environment variables (set in Lambda console or Terraform):
  TEAMS_WEBHOOK_SECRET_NAME  – Secrets Manager secret name  (default: aquasense/teams-webhook)
  TEAMS_WEBHOOK_URL          – OR a direct webhook URL (overrides secret lookup)
  ENVIRONMENT                – prod / staging / dev  (default: prod)
  PROJECT_NAME               – display name  (default: AquaSense)
"""

import json
import logging
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone
from typing import Any

import boto3
from botocore.exceptions import ClientError

# ── Logging ────────────────────────────────────────────────────────────────
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ── Constants ──────────────────────────────────────────────────────────────
PROJECT_NAME   = os.environ.get("PROJECT_NAME", "AquaSense")
ENVIRONMENT    = os.environ.get("ENVIRONMENT", "prod")
SECRET_NAME    = os.environ.get("TEAMS_WEBHOOK_SECRET_NAME", "aquasense/teams-webhook")
DIRECT_WEBHOOK = os.environ.get("TEAMS_WEBHOOK_URL", "")

# Alert type → emoji + colour (Teams theme colour hex)
ALERT_META = {
    "HIGH_FLOW":     {"emoji": "🌊", "color": "#FF6B35", "title": "High Water Usage"},
    "HIGH_USAGE":    {"emoji": "📈", "color": "#FF6B35", "title": "High Usage Detected"},
    "LEAKAGE":       {"emoji": "💧", "color": "#E63946", "title": "Water Leakage Detected"},
    "HIGH_PRESSURE": {"emoji": "⚠️",  "color": "#FF9F1C", "title": "High Pressure Alert"},
    "LOW_PRESSURE":  {"emoji": "⬇️",  "color": "#457B9D", "title": "Low Pressure Alert"},
    "ANOMALY":       {"emoji": "🔍", "color": "#6A4C93", "title": "Anomaly Detected"},
    "SPIKE":         {"emoji": "⚡", "color": "#F4A261", "title": "Energy Spike"},
    "CRITICAL":      {"emoji": "🚨", "color": "#E63946", "title": "Critical Alert"},
    "WARNING":       {"emoji": "⚠️",  "color": "#FF9F1C", "title": "Warning"},
    "INFO":          {"emoji": "ℹ️",  "color": "#2196F3", "title": "Information"},
    "DEFAULT":       {"emoji": "🔔", "color": "#4A90D9", "title": "AquaSense Alert"},
}

SEVERITY_COLOR = {
    "critical": "#E63946",
    "warning":  "#FF9F1C",
    "info":     "#2196F3",
}


# ══════════════════════════════════════════════════════════════════════════════
# Webhook URL retrieval
# ══════════════════════════════════════════════════════════════════════════════
def _get_webhook_url() -> str:
    """Return the Teams webhook URL from env var or Secrets Manager."""
    if DIRECT_WEBHOOK:
        return DIRECT_WEBHOOK

    client = boto3.client("secretsmanager")
    try:
        resp  = client.get_secret_value(SecretId=SECRET_NAME)
        secret = resp.get("SecretString", "{}")
        data   = json.loads(secret)
        url    = data.get("webhook_url") or data.get("TEAMS_WEBHOOK_URL", "")
        if not url:
            raise ValueError(f"webhook_url key not found in secret '{SECRET_NAME}'")
        return url
    except ClientError as exc:
        logger.error("Failed to retrieve secret '%s': %s", SECRET_NAME, exc)
        raise


# ══════════════════════════════════════════════════════════════════════════════
# Event parsers
# ══════════════════════════════════════════════════════════════════════════════
def _parse_sns(record: dict) -> dict:
    """Extract alert payload from an SNS record."""
    msg = record["Sns"]["Message"]
    try:
        return json.loads(msg)
    except json.JSONDecodeError:
        return {"raw_message": msg, "alert_type": "DEFAULT"}


def _parse_sqs(record: dict) -> dict:
    """Extract alert payload from an SQS record."""
    body = record["body"]
    try:
        data = json.loads(body)
        # SQS may wrap an SNS notification
        if "Message" in data:
            return json.loads(data["Message"])
        return data
    except json.JSONDecodeError:
        return {"raw_message": body, "alert_type": "DEFAULT"}


def _parse_iot(event: dict) -> dict:
    """Direct IoT Rule invocation – event IS the payload."""
    return event


def extract_alerts(event: dict) -> list[dict]:
    """Return a list of alert payloads from any supported event source."""
    alerts = []

    if "Records" in event:
        for rec in event["Records"]:
            src = rec.get("eventSource", rec.get("EventSource", ""))
            if "sns" in src.lower():
                alerts.append(_parse_sns(rec))
            elif "sqs" in src.lower():
                alerts.append(_parse_sqs(rec))
            else:
                alerts.append(rec)   # pass-through
    else:
        # Direct invocation or IoT Rule
        alerts.append(_parse_iot(event))

    return alerts


# ══════════════════════════════════════════════════════════════════════════════
# Teams Adaptive Card builder
# ══════════════════════════════════════════════════════════════════════════════
def _now_ist() -> str:
    """Return current UTC time formatted nicely."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _meta(alert_type: str, severity: str = "") -> dict:
    """Resolve display metadata for a given alert type / severity."""
    key = (alert_type or "").upper().replace(" ", "_").replace("-", "_")
    if key in ALERT_META:
        return ALERT_META[key]
    # fallback to severity
    sev = (severity or "").lower()
    if sev == "critical":
        return ALERT_META["CRITICAL"]
    if sev == "warning":
        return ALERT_META["WARNING"]
    if sev == "info":
        return ALERT_META["INFO"]
    return ALERT_META["DEFAULT"]


def build_teams_card(alert: dict) -> dict:
    """
    Build a Microsoft Teams Adaptive Card (via Legacy Connector Card format)
    for one alert payload.

    Expected alert dict keys (all optional – graceful fallback):
      alert_type, severity, title, description / msg,
      meter_id, zone, user_id, value, unit, pressure,
      threshold, timestamp, reading_id
    """
    alert_type  = alert.get("alert_type", alert.get("kind", "DEFAULT"))
    severity    = alert.get("severity", "warning")
    meta        = _meta(alert_type, severity)

    title       = alert.get("title", meta["title"])
    description = alert.get("description", alert.get("msg", alert.get("message", "See details below.")))
    meter_id    = alert.get("meter_id",  "–")
    zone        = alert.get("zone",      "–")
    user_id     = alert.get("user_id",   alert.get("userId", "–"))
    value       = alert.get("value",     alert.get("water_usage_liters", "–"))
    unit        = alert.get("unit",      "L")
    pressure    = alert.get("pressure",  "–")
    threshold   = alert.get("threshold", "–")
    ts          = alert.get("timestamp", _now_ist())
    reading_id  = alert.get("reading_id", "–")
    env_label   = ENVIRONMENT.upper()
    color       = SEVERITY_COLOR.get(severity.lower(), meta["color"])

    # ── Legacy Connector Card (MessageCard) – widest Teams compatibility ──
    card = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "themeColor": color.lstrip("#"),
        "summary": f"{meta['emoji']} {PROJECT_NAME} – {title}",
        "sections": [
            {
                "activityTitle":    f"{meta['emoji']} **{title}**",
                "activitySubtitle": f"_{PROJECT_NAME} · {env_label} · {ts}_",
                "activityImage":    "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Water%20wave/3D/water_wave_3d.png",
                "facts": _build_facts(
                    alert_type, severity, meter_id, zone,
                    user_id, value, unit, pressure, threshold, reading_id
                ),
                "markdown": True,
            },
            {
                "text": f"> {description}",
                "markdown": True,
            },
        ],
        "potentialAction": [
            {
                "@type": "OpenUri",
                "name":  "📊 Open AquaSense Dashboard",
                "targets": [{"os": "default", "uri": "https://aquasense.example.com/alerts"}],
            },
            {
                "@type": "OpenUri",
                "name":  "📖 View Alert Docs",
                "targets": [{"os": "default", "uri": "https://aquasense.example.com/docs/alerts"}],
            },
        ],
    }
    return card


def _build_facts(alert_type, severity, meter_id, zone,
                 user_id, value, unit, pressure, threshold, reading_id) -> list[dict]:
    """Build the fact rows shown in the Teams card."""
    facts = [
        {"name": "🔔 Alert Type",  "value": alert_type or "–"},
        {"name": "🚦 Severity",    "value": severity.upper() if severity else "–"},
        {"name": "📍 Meter ID",    "value": str(meter_id)},
        {"name": "🗺️  Zone",       "value": str(zone)},
    ]

    if str(user_id) not in ("–", "None", "null", ""):
        facts.append({"name": "👤 User ID",   "value": str(user_id)})

    if str(value) not in ("–", "None", "null", ""):
        facts.append({"name": "💧 Value",     "value": f"{value} {unit}"})

    if str(pressure) not in ("–", "None", "null", ""):
        facts.append({"name": "🔵 Pressure",  "value": f"{pressure} bar"})

    if str(threshold) not in ("–", "None", "null", ""):
        facts.append({"name": "📏 Threshold", "value": str(threshold)})

    if str(reading_id) not in ("–", "None", "null", ""):
        facts.append({"name": "🆔 Reading ID","value": str(reading_id)[:16] + "…"
                      if len(str(reading_id)) > 16 else str(reading_id)})

    return facts


# ══════════════════════════════════════════════════════════════════════════════
# HTTP sender
# ══════════════════════════════════════════════════════════════════════════════
def send_to_teams(webhook_url: str, card: dict) -> None:
    """POST the card JSON to the Teams webhook URL."""
    payload = json.dumps(card).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode()
            logger.info("Teams response: HTTP %s – %s", resp.status, body)
            if resp.status not in (200, 201, 202):
                raise RuntimeError(f"Unexpected Teams status {resp.status}: {body}")
    except urllib.error.HTTPError as exc:
        logger.error("Teams HTTP error %s: %s", exc.code, exc.read().decode())
        raise
    except urllib.error.URLError as exc:
        logger.error("Teams URL error: %s", exc.reason)
        raise


# ══════════════════════════════════════════════════════════════════════════════
# Lambda handler
# ══════════════════════════════════════════════════════════════════════════════
def lambda_handler(event: dict, context: Any) -> dict:
    """
    AWS Lambda entry point.

    Accepts events from:
      • SNS subscription
      • SQS event-source mapping
      • IoT Core Rule (direct invoke)
      • Manual test invocations
    """
    logger.info("Received event: %s", json.dumps(event))

    try:
        webhook_url = _get_webhook_url()
    except Exception as exc:
        logger.error("Cannot retrieve webhook URL: %s", exc)
        return {"statusCode": 500, "body": "Webhook URL retrieval failed"}

    alerts   = extract_alerts(event)
    sent     = 0
    failures = []

    for alert in alerts:
        try:
            card = build_teams_card(alert)
            logger.info("Sending card for alert_type=%s severity=%s meter=%s",
                        alert.get("alert_type", "–"),
                        alert.get("severity", "–"),
                        alert.get("meter_id", "–"))
            send_to_teams(webhook_url, card)
            sent += 1
        except Exception as exc:
            logger.error("Failed to send alert to Teams: %s | alert=%s", exc, alert)
            failures.append({"alert": alert, "error": str(exc)})

    logger.info("Done. sent=%d  failures=%d", sent, len(failures))

    if failures:
        # Return partial failure – SQS will retry failed messages
        return {
            "statusCode": 207,
            "body": json.dumps({"sent": sent, "failures": len(failures)}),
            "batchItemFailures": [
                {"itemIdentifier": f["alert"].get("reading_id", str(i))}
                for i, f in enumerate(failures)
            ],
        }

    return {
        "statusCode": 200,
        "body": json.dumps({"sent": sent, "message": "All alerts delivered to Teams"}),
    }
