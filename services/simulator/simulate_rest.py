import urllib.request
import json
import time
import random
import sys
from datetime import datetime

ALB_URL = "http://tf-aqua-sense-production-alb-840180883.ap-south-1.elb.amazonaws.com/api/usage/ingest"

# The database contains these seeded meters for Rajesh Kumar (userId: a0000001-0000-0000-0000-000000000001):
METERS = [
    {"id": "SMT-W-0041", "type": "water", "userId": "a0000001-0000-0000-0000-000000000001"},
    {"id": "SMT-W-0042", "type": "water", "userId": "a0000001-0000-0000-0000-000000000001"},
    {"id": "SMT-E-0087", "type": "energy", "userId": "a0000001-0000-0000-0000-000000000001"}
]

print("==================================================")
print("  AquaSense REST Telemetry Simulator")
print("  Sending live meter readings directly to ALB...")
print("  ALB Target: " + ALB_URL)
print("==================================================")

try:
    while True:
        # Pick a random meter
        meter = random.choice(METERS)
        
        # Generate value
        if meter["type"] == "water":
            value = round(random.uniform(1.0, 15.0), 2)
            pressure = round(random.uniform(2.0, 3.0), 1)
        else:
            value = round(random.uniform(0.5, 3.5), 2)
            pressure = None
            
        payload = {
            "meterId": meter["id"],
            "type": meter["type"],
            "value": value,
            "pressure": pressure,
            "userId": meter["userId"]
        }
        
        # Post to ALB
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(
            ALB_URL,
            data=data,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        
        try:
            with urllib.request.urlopen(req) as res:
                response = json.loads(res.read().decode())
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Ingested {meter['id']} ({meter['type']}): value={value} | Result: {response.get('message')}")
        except Exception as e:
            print(f"Error sending reading for {meter['id']}: {e}", file=sys.stderr)
            
        time.sleep(5)
except KeyboardInterrupt:
    print("\nSimulator stopped.")
