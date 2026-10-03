#!/usr/bin/env python3
"""Test Ubuntu (ONA) -> MQTT -> backend -> dashboard, format docs/ona-contract.md"""
import json, math, sys, time
from datetime import datetime, timezone
import paho.mqtt.client as mqtt

BROKER = sys.argv[1] if len(sys.argv) > 1 else "192.168.190.1"

def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
client.connect(BROKER, 1883, 60)
client.loop_start()
print(f"Connecte a {BROKER}:1883 - Ctrl+C pour arreter")

def pub(topic, payload):
    client.publish(topic, json.dumps(payload))
    print(topic, payload.get("pos"))

t = 0
try:
    while True:
        a = t / 10
        pub("robots/writer", {"id": "writer", "pos": {"x": round(4 * math.cos(a), 2), "y": round(3 * math.sin(a), 2)},
            "theta": round(a + math.pi / 2, 2), "batteryPct": round(max(20, 95 - t * 0.1), 1),
            "state": "exploring", "source": "writer", "ts": now()})
        pub("robots/executor", {"id": "executor", "pos": {"x": -5, "y": -3}, "theta": 0, "batteryPct": 90,
            "state": "standby", "source": "executor", "ts": now()})
        if t >= 5:
            pub("beacons/B-VM", {"id": "B-VM", "pos": {"x": 4, "y": 0}, "info": "victim detected - sent from Ubuntu",
                "source": "writer", "ts": now(), "status": "active"})
            pub("targets/T-VM", {"id": "T-VM", "pos": {"x": 4.5, "y": 0.5}, "ts": now(), "confidence": 0.8,
                "source": "writer", "status": "tracked", "uncertainty": {"sigmaX": 0.8, "sigmaY": 0.5, "angleDeg": 20}})
        if t == 5:
            pub("events/evt-vm-1", {"id": "evt-vm-1", "type": "victim", "pos": {"x": 4.5, "y": 0.5},
                "severity": "critical", "source": "writer", "ts": now(), "note": "victim found near B-VM"})
        t += 1
        time.sleep(1)
except KeyboardInterrupt:
    print("\nArrete.")
finally:
    client.loop_stop()
    client.disconnect()
