#!/usr/bin/env python3
"""
Mock data publisher - broker public (aucune inscription requise)
"""

import json
import time
import random

import paho.mqtt.client as mqtt

MQTT_BROKER_HOST = "broker.hivemq.com"   # broker public gratuit, aucune inscription
MQTT_BROKER_PORT = 1883

TOPIC_PREFIX = "pictogramme-tsyp14-livingmap-x7f2q9"

TOPIC_POSE = f"{TOPIC_PREFIX}/writer/pose"
TOPIC_BEACONS = f"{TOPIC_PREFIX}/beacons"
TOPIC_EVENTS = f"{TOPIC_PREFIX}/events"
TOPIC_EXEC_STATUS = f"{TOPIC_PREFIX}/executor/status"

ORIGIN_LAT = 36.8065
ORIGIN_LON = 10.1815
METERS_PER_DEG_LAT = 111320.0


def xy_to_gps(x, y):
    lat = ORIGIN_LAT + (y / METERS_PER_DEG_LAT)
    lon = ORIGIN_LON + (x / (METERS_PER_DEG_LAT * 0.83))
    return lat, lon


def main():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)
    client.connect(MQTT_BROKER_HOST, MQTT_BROKER_PORT, 60)
    client.loop_start()

    print("Mock publisher démarré - Ctrl+C pour arrêter\n")

    x, y = 0.0, 0.0
    beacon_id = 0

    try:
        while True:
            x += random.uniform(-0.3, 0.5)
            y += random.uniform(-0.3, 0.5)
            lat, lon = xy_to_gps(x, y)

            pose = {
                "x": round(x, 2),
                "y": round(y, 2),
                "gps_lat": lat,
                "gps_lon": lon,
                "t": time.time(),
            }
            client.publish(TOPIC_POSE, json.dumps(pose))
            print("pose ->", pose)

            if random.random() < 0.25:
                beacon_id += 1
                beacon = {
                    "id": f"b{beacon_id}",
                    "event_type": random.choice(["victim", "hazard", "fire", "obstacle"]),
                    "message": "mock event detected",
                    "gps_lat": lat,
                    "gps_lon": lon,
                    "t": time.time(),
                }
                client.publish(TOPIC_BEACONS, json.dumps(beacon))
                print("beacon ->", beacon)

            time.sleep(2)

    except KeyboardInterrupt:
        print("\nArrêté.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
