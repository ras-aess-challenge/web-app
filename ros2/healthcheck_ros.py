"""Check fresh ROS/MQTT telemetry and an actual Foxglove protocol handshake."""
import base64
import json
import os
import socket
import time

state = json.load(open(os.getenv('ROS_HEALTH_FILE', '/tmp/ros-health.json')))
assert state['mqtt'] and all(state.get(key) and time.time() - state[key] < 8 for key in ('ts', 'odom', 'executor'))
with socket.create_connection(('127.0.0.1', 8765), timeout=5) as conn:
    key = base64.b64encode(os.urandom(16)).decode()
    conn.sendall(('GET / HTTP/1.1\r\nHost: localhost:8765\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                  f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n'
                  'Sec-WebSocket-Protocol: foxglove.sdk.v1, foxglove.websocket.v1\r\n\r\n').encode())
    response = b''
    while b'\r\n\r\n' not in response:
        chunk = conn.recv(4096)
        if not chunk:
            break
        response += chunk
    assert b'101 Switching Protocols' in response and (b'foxglove.sdk.v1' in response or b'foxglove.websocket.v1' in response)

    # Complete a masked WebSocket close handshake to avoid noisy reset errors.
    mask = os.urandom(4)
    payload = bytes((3, 232))  # normal closure, status 1000
    conn.sendall(bytes((0x88, 0x82)) + mask + bytes(value ^ mask[i % 4] for i, value in enumerate(payload)))
    conn.recv(4096)
