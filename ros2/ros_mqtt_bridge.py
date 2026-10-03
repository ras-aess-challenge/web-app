#!/usr/bin/env python3
"""
Pont ROS 2 (Humble) <-> MQTT pour le Command Post.

  ROS 2 -> MQTT -> backend -> WebSocket -> dashboard
    /ona/parsed_targets (String JSON) -> targets/<id>
    /ona/beacons        (String JSON) -> beacons/<id>   (+ events/<id> a la 1re detection)
    /odom, /battery_state, sante      -> robots/writer     (2 Hz)
    /executor/odom, /executor/status  -> robots/executor   (2 Hz) + missions/<id>
    /diagnostics + silence topics     -> events/<id>       (sur changement)

  Dashboard -> backend -> MQTT -> ROS 2
    cmd/assign-mission  -> /executor/mission  (l'Executor se deplace jusqu'a la balise)
    cmd/cancel-mission  -> /executor/mission  {"cancel": true}

Variables d'environnement :
  MQTT_HOST (def. 192.168.190.1)   MQTT_PORT (def. 1883)   ROBOT_ID (def. writer)
  ANCHOR_LAT / ANCHOR_LON (def. Tunis, comme le dashboard)

Lancer :  source /opt/ros/humble/setup.bash && python3 ros_mqtt_bridge.py
"""
import json
import os
import queue
import time

import paho.mqtt.client as mqtt
import rclpy
from diagnostic_msgs.msg import DiagnosticArray
from nav_msgs.msg import Odometry
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from sensor_msgs.msg import BatteryState, LaserScan
from std_msgs.msg import String

import bridge_core as core


def guarded(fn):
    """Une exception dans un callback est loguee mais ne tue pas le pont."""
    def wrapper(self, *a, **k):
        try:
            return fn(self, *a, **k)
        except Exception as e:  # noqa: BLE001
            self.get_logger().error(f'{fn.__name__}: {type(e).__name__}: {e}')
    wrapper.__name__ = fn.__name__
    return wrapper


KEEPALIVE_S = 3.0      # republie cibles/robots (ts d'origine) : backend et late joiners convergent
BEACON_KEEPALIVE_S = 5.0
TARGET_TTL_S = 180.0   # on arrete de republier une cible apres 3 min sans nouvelle


class MqttOut:
    """Client MQTT paho (v1 ou v2) : reconnexion auto, abonnement cmd/# , file des commandes recues."""

    def __init__(self, host, port, log):
        self.log = log
        self.connected = False
        self.commands = queue.SimpleQueue()   # (topic, texte) -> traite dans le thread ROS
        try:
            self.c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'ros-bridge-{os.getpid()}')
        except AttributeError:  # paho 1.x
            self.c = mqtt.Client(client_id=f'ros-bridge-{os.getpid()}')
        self.c.on_connect = self._on_connect
        self.c.on_disconnect = self._on_disconnect
        self.c.on_message = self._on_message
        self.c.reconnect_delay_set(min_delay=1, max_delay=10)
        self.c.connect_async(host, port, keepalive=30)
        self.c.loop_start()

    def _on_connect(self, *args):
        self.connected = True
        self.c.subscribe('cmd/#', qos=0)
        self.log.info('MQTT connecte (abonne a cmd/#)')

    def _on_disconnect(self, *args):
        self.connected = False
        self.log.warn('MQTT deconnecte (reconnexion auto)')

    def _on_message(self, client, userdata, msg):
        try:
            self.commands.put((msg.topic, msg.payload.decode('utf-8', 'replace')))
        except Exception:  # noqa: BLE001
            pass

    def publish(self, topic, payload):
        self.c.publish(topic, json.dumps(payload), qos=0)


class RosMqttBridge(Node):
    def __init__(self):
        super().__init__('ros_mqtt_bridge')
        host = os.environ.get('MQTT_HOST', '192.168.190.1')
        port = int(os.environ.get('MQTT_PORT', '1883'))
        self.robot_id = os.environ.get('ROBOT_ID', 'writer')
        self.out = MqttOut(host, port, self.get_logger())
        self.get_logger().info(f'Pont ROS2<->MQTT vers {host}:{port} (robot={self.robot_id})')

        # --- Writer ---
        self.health = core.HealthTracker()
        self.pos = (0.0, 0.0)
        self.theta = 0.0
        self.odom_t = None
        self.batt_pct = None
        # --- Executor / missions / balises ---
        self.exec_pos = None
        self.exec_theta = 0.0
        self.exec_t = None
        self.exec_status = {}
        self.missions = core.MissionTracker(start=int(time.time()) % 1000 * 10 + 1)
        self.last_mission_pub = 0.0
        self.beacons = {}   # id -> {'payload', 'last_pub'}
        self.targets = {}   # topic -> [payload, derniere publication, derniere reception]
        self.n_targets_in = 0

        self.create_subscription(String, '/ona/parsed_targets', self.on_target, 10)
        self.create_subscription(String, '/ona/beacons', self.on_beacon, 10)
        self.create_subscription(Odometry, '/odom', self.on_odom, 10)
        self.create_subscription(BatteryState, '/battery_state', self.on_battery, 10)
        self.create_subscription(DiagnosticArray, '/diagnostics', self.on_diag, 10)
        self.create_subscription(LaserScan, '/scan', self.on_scan, qos_profile_sensor_data)
        self.create_subscription(Odometry, '/executor/odom', self.on_exec_odom, 10)
        self.create_subscription(String, '/executor/status', self.on_exec_status, 10)
        self.exec_pub = self.create_publisher(String, '/executor/mission', 10)

        self.create_timer(0.5, self.tick_telemetry)
        self.create_timer(1.0, self.tick_watchdog)
        self.create_timer(0.2, self.tick_commands)

    # ---------- /ona/parsed_targets ----------
    @guarded
    def on_target(self, msg):
        now = time.time()
        res = core.parse_target_message(msg.data, now)
        if res is None:
            self.get_logger().warn(f'cible ignoree (JSON invalide) : {msg.data[:80]}')
            return
        topic, payload = res
        self.targets[topic] = [payload, now, now]
        self.out.publish(topic, payload)
        self.n_targets_in += 1
        if self.n_targets_in == 1:
            self.get_logger().info(f'1re cible recue -> {topic}')

    # ---------- /ona/beacons ----------
    @guarded
    def on_beacon(self, msg):
        now = time.time()
        try:
            res = core.convert_beacon(json.loads(msg.data), now)
        except ValueError:
            res = None
        if res is None:
            self.get_logger().warn(f'balise ignoree (JSON invalide) : {msg.data[:80]}')
            return
        topic, payload, event = res
        first = payload['id'] not in self.beacons
        self.beacons[payload['id']] = {'payload': payload, 'last_pub': now}
        self.out.publish(topic, payload)
        if first:
            self.get_logger().info(f"nouvelle balise {payload['id']} -> {topic}")
            if event:
                self.emit_event(event)

    # ---------- Writer : capteurs / sante ----------
    @guarded
    def on_odom(self, msg):
        now = time.time()
        p, q = msg.pose.pose.position, msg.pose.pose.orientation
        self.pos = (p.x, p.y)
        self.theta = core.quat_to_yaw(q.x, q.y, q.z, q.w)
        self.odom_t = now
        self.health.touch('odom', now)

    @guarded
    def on_battery(self, msg):
        self.batt_pct = core.battery_pct(msg.percentage)
        self.health.touch('battery', time.time())

    @guarded
    def on_scan(self, _msg):
        self.health.touch('scan', time.time())

    @guarded
    def on_diag(self, msg):
        now = time.time()
        self.health.touch('diagnostics', now)
        for st in msg.status:
            for ev in self.health.update_diag(st.name, core.level_int(st.level), st.message, now):
                self.emit_event(ev)

    def emit_event(self, ev):
        topic, payload = core.make_event_payload(ev, self.pos, self.robot_id, time.time())
        self.out.publish(topic, payload)
        self.get_logger().info(f"evenement [{ev['severity']}] {ev['note']}")

    # ---------- Executor ----------
    @guarded
    def on_exec_odom(self, msg):
        p, q = msg.pose.pose.position, msg.pose.pose.orientation
        self.exec_pos = (p.x, p.y)
        self.exec_theta = core.quat_to_yaw(q.x, q.y, q.z, q.w)
        self.exec_t = time.time()

    @guarded
    def on_exec_status(self, msg):
        try:
            st = json.loads(msg.data)
        except ValueError:
            return
        if not isinstance(st, dict):
            return
        self.exec_status = st
        now = time.time()
        upd = self.missions.on_executor_status(st, now)
        if upd:
            self.out.publish(f"missions/{upd['id']}", upd)
            self.last_mission_pub = now
            self.get_logger().info(f"mission {upd['id']} -> {upd['status']}")
            if upd['status'] == 'done' and upd['target']['beaconId']:
                bid = upd['target']['beaconId']
                self.emit_event({'key': f'beacon-{bid}', 'type': 'system', 'severity': 'info', 'now': now,
                                 'note': f'Executor reached {bid}: mission {upd["id"]} done',
                                 'pos': (upd['target']['pos']['x'], upd['target']['pos']['y'])})

    # ---------- commandes du dashboard ----------
    @guarded
    def tick_commands(self):
        while True:
            try:
                topic, text = self.out.commands.get_nowait()
            except queue.Empty:
                return
            self.handle_command(topic, text)

    def handle_command(self, topic, text):
        parsed = core.parse_command(topic, text)
        if parsed is None:
            return
        action, payload = parsed
        now = time.time()
        beacons = {k: v['payload'] for k, v in self.beacons.items()}
        if action == 'assign-mission':
            res = self.missions.assign(payload, beacons, now)
            if res is None:
                self.get_logger().warn(f"assign-mission ignoree : balise inconnue ({payload.get('beaconId')})")
                return
            mission, ros_cmd = res
            self.out.publish(f"missions/{mission['id']}", mission)
            self.last_mission_pub = now
            self.exec_pub.publish(String(data=json.dumps(ros_cmd)))
            self.get_logger().info(f"mission {mission['id']} : Executor -> {mission['target']['beaconId']}")
        elif action == 'cancel-mission':
            res = self.missions.cancel(payload, now)
            if res:
                mission, ros_cmd = res
                self.out.publish(f"missions/{mission['id']}", mission)
                self.exec_pub.publish(String(data=json.dumps(ros_cmd)))
                self.get_logger().info(f"mission {mission['id']} annulee")

    # ---------- timers ----------
    @guarded
    def tick_telemetry(self):
        now = time.time()
        # ts = derniere odom recue (pas "maintenant") : si le noeud meurt, le robot vieillit
        # sur le dashboard (STALE -> LOST) au lieu de rester faussement LIVE.
        if self.odom_t is not None:
            topic, payload = core.make_telemetry(
                self.robot_id, self.pos, self.theta, self.batt_pct, self.health.robot_state(), self.odom_t)
            self.out.publish(topic, payload)
        if self.exec_t is not None:
            topic, payload = core.make_telemetry(
                'executor', self.exec_pos, self.exec_theta, self.exec_status.get('battery'),
                str(self.exec_status.get('state', 'unknown')), self.exec_t)
            self.out.publish(topic, payload)
        # keepalive (ts d'origine conserve) : cibles, balises, mission
        for t, rec in list(self.targets.items()):
            if now - rec[2] > TARGET_TTL_S:
                del self.targets[t]
            elif now - rec[1] >= KEEPALIVE_S:
                self.out.publish(t, rec[0])
                rec[1] = now
        for b in self.beacons.values():
            if now - b['last_pub'] >= BEACON_KEEPALIVE_S:
                self.out.publish(f"beacons/{b['payload']['id']}", b['payload'])
                b['last_pub'] = now
        if self.missions.current and now - self.last_mission_pub >= BEACON_KEEPALIVE_S:
            m = self.missions.snapshot(now)
            self.out.publish(f"missions/{m['id']}", m)
            self.last_mission_pub = now

    @guarded
    def tick_watchdog(self):
        for ev in self.health.check_silence(time.time()):
            self.emit_event(ev)


def main():
    rclpy.init()
    node = RosMqttBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
