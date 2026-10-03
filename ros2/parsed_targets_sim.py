#!/usr/bin/env python3
"""
Faux ONA : publie des cibles sur /ona/parsed_targets (std_msgs/String, JSON provisoire
du document de contexte : target_id, timestamp, latitude, longitude, confidence,
sigma_x, sigma_y, orientation, source).

Publie aussi des balises sur /ona/beacons (deposees par le Writer, relayees par l'ONA) :
  B-1  victime detectee, apparait apres 10 s        B-2  zone dangereuse, apparait apres 30 s
Les positions sont ecartees (+-6 m) pour que les etiquettes restent lisibles sur la carte.

Scenario en boucle de 90 s, pour tester la chaine ET le vieillissement des donnees :
  target_01  survivant mobile, mis a jour chaque seconde            -> toujours LIVE
  target_02  cible fixe, publiee pendant 25 s puis SILENCE          -> STALE -> LOST, l'ellipse GROSSIT
  target_03  apparait a t=30 s, disparait a t=50 s                  -> cible qui disparait
  target_04  rapport ancien : publie 1 fois avec un timestamp vieux de 40 s (coordonnees x/y locales)

Lancer :  source /opt/ros/humble/setup.bash && python3 parsed_targets_sim.py
"""
import json
import math
import time

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

import bridge_core as core

CYCLE_S = 90.0


class ParsedTargetsSim(Node):
    def __init__(self):
        super().__init__('ona_sim')
        self.pub = self.create_publisher(String, '/ona/parsed_targets', 10)
        self.beacon_pub = self.create_publisher(String, '/ona/beacons', 10)
        self.t0 = time.time()
        self.last_beacons = 0.0
        self.sent_old = -1
        self.create_timer(1.0, self.tick)
        self.get_logger().info('Faux ONA : cibles sur /ona/parsed_targets (cycle 90 s)')

    def send(self, tid, x, y, conf, sx, sy, ang, ts=None, as_local=False):
        now = time.time()
        d = {'target_id': tid, 'timestamp': ts if ts is not None else now,
             'confidence': conf, 'sigma_x': sx, 'sigma_y': sy, 'orientation': ang, 'source': 'ona'}
        if as_local:
            d.update({'x': x, 'y': y})
        else:
            d['latitude'], d['longitude'] = core.local_to_latlon(x, y)
        m = String()
        m.data = json.dumps(d)
        self.pub.publish(m)

    def send_beacons(self):
        """Republie les balises deja deposees (timestamp d'origine = instant du depot)."""
        el = time.time() - self.t0
        for bid, at, x, y, info, etype, sev in BEACONS:
            if el < at:
                continue
            d = {'beacon_id': bid, 'timestamp': self.t0 + at, 'info': info,
                 'event_type': etype, 'severity': sev, 'x': x, 'y': y}
            if bid == 'B-1':  # une balise en GPS, l'autre en local : les deux formats marchent
                d.pop('x'); d.pop('y')
                d['latitude'], d['longitude'] = core.local_to_latlon(x, y)
            self.beacon_pub.publish(String(data=json.dumps(d)))

    def tick(self):
        if time.time() - self.last_beacons >= 5.0:
            self.last_beacons = time.time()
            self.send_beacons()
        el = time.time() - self.t0
        cycle, t = int(el // CYCLE_S), el % CYCLE_S
        # 01 : survivant qui bouge
        self.send('target_01', -4.5 + 1.2 * math.sin(0.2 * el), -0.5 + 1.0 * math.cos(0.15 * el), 0.87, 1.0, 0.6, 35.0)
        # 02 : publiee 25 s puis silence (vieillit)
        if t < 25:
            self.send('target_02', 3.5, 3.5, 0.80, 0.8, 0.8, 0.0)
        # 03 : apparait puis disparait
        if 30 <= t < 50:
            self.send('target_03', 1.0, -4.5, 0.70, 1.2, 0.7, 60.0)
        # 04 : rapport deja vieux de 40 s (une fois par cycle)
        if t >= 5 and self.sent_old != cycle:
            self.sent_old = cycle
            self.send('target_04', 5.5, 0.5, 0.90, 0.6, 0.6, 0.0, ts=time.time() - 40.0, as_local=True)


BEACONS = [  # id, apparait a (s), x, y, info, type, severite
    ('B-1', 10.0, -3.0, 4.0, 'victim detected - thermal signature', 'victim', 'critical'),
    ('B-2', 30.0, 5.0, -3.5, 'hazard debris - unstable floor', 'hazard', 'warn'),
]


def main():
    rclpy.init()
    node = ParsedTargetsSim()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
