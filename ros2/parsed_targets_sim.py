#!/usr/bin/env python3
"""
Faux ONA : publie des cibles sur /ona/parsed_targets (std_msgs/String, JSON provisoire
du document de contexte : target_id, timestamp, latitude, longitude, confidence,
sigma_x, sigma_y, orientation, source).

Publie aussi des balises sur /ona/beacons (deposees par le Writer, relayees par l'ONA) :
  une balise (victime ou danger) apparait au hasard dans un zone shared/zone.json toutes les 20-35 s
  (jusqu'a 12). SIM_SEED=<n> rend le scenario reproductible. L'Executor y va tout seul.

Les cibles changent de place (au hasard, >= 9 m entre elles) a chaque cycle, pour ne plus se superposer.
Scenario en boucle de 90 s, pour tester la chaine ET le vieillissement des donnees :
  target_01  survivant mobile, mis a jour chaque seconde            -> toujours LIVE
  target_02  cible fixe, publiee pendant 25 s puis SILENCE          -> STALE -> LOST, l'ellipse GROSSIT
  target_03  apparait a t=30 s, disparait a t=50 s                  -> cible qui disparait
  target_04  rapport ancien : publie 1 fois avec un timestamp vieux de 40 s (coordonnees x/y locales)

Lancer :  source /opt/ros/humble/setup.bash && python3 parsed_targets_sim.py
"""
import json
import math
import os
import random
import time

import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node
from std_msgs.msg import String

import bridge_core as core
import zone

CYCLE_S = 90.0
# Bloc d'exploration elargi : les balises apparaissent au hasard dedans (SIM_SEED fixe le hasard).

MAX_BEACONS = 12
TYPES = [('victim', 'critical', 'victim detected - thermal signature'),
         ('victim', 'critical', 'victim detected - voice response'),
         ('hazard', 'warn', 'hazard debris - unstable floor'),
         ('hazard', 'warn', 'hazard gas - elevated reading')]


class ParsedTargetsSim(Node):
    def __init__(self):
        super().__init__('ona_sim')
        self.pub = self.create_publisher(String, '/ona/parsed_targets', 10)
        self.beacon_pub = self.create_publisher(String, '/ona/beacons', 10)
        self.t0 = time.time()
        self.last_beacons = 0.0
        self.rng = random.Random(int(os.environ['SIM_SEED'])) if os.environ.get('SIM_SEED') else random.Random()
        self.beacons = []          # (id, ts depot, x, y, info, type, severite)
        self.next_spawn = 8.0      # 1re balise 8 s apres le demarrage
        self.writer_xy = None      # derniere position du Writer (/odom) : c'est la qu'il depose ses balises
        self.writer_seen = 0.0
        self.layout = {}           # positions (au hasard) des cibles pour le cycle courant
        self.layout_cycle = -1
        self.create_subscription(Odometry, '/odom', self.on_odom, 10)
        self.create_subscription(String, '/sim/reset', self.on_reset, 10)
        self.create_subscription(String, '/sim/zone', self.on_zone, 10)
        self.sent_old = -1
        self.create_timer(1.0, self.tick)
        self.get_logger().info('Faux ONA : cibles sur /ona/parsed_targets (cycle 90 s)')

    def on_odom(self, msg):
        p = msg.pose.pose.position
        self.writer_xy, self.writer_seen = (p.x, p.y), time.time()

    def on_reset(self, _msg):
        """Bouton Reset du dashboard : on repart d'une carte vide."""
        self.t0 = time.time()
        self.beacons = []
        self.next_spawn = 8.0
        self.sent_old = -1
        self.layout_cycle = -1
        self.get_logger().info('reset : cibles et balises effacees, nouveau scenario')

    def on_zone(self, msg):
        try:
            ok = zone.set_polygon(json.loads(msg.data).get('polygon'))
        except (ValueError, AttributeError):
            ok = False
        if ok:
            self.on_reset(None)

    def new_layout(self):
        """4 centres de cibles au hasard dans le bloc, a au moins TARGET_GAP m les uns des autres."""
        pts = []
        ax, ay = zone.half_extent()
        gap = 0.9 * min(ax, ay)      # distance mini entre deux cibles : les ellipses ne se superposent plus
        for _ in range(4):
            for _ in range(100):
                p = zone.random_point(self.rng, margin=2.0)
                if all(math.hypot(p[0] - q[0], p[1] - q[1]) >= gap for q in pts):
                    break
            pts.append(p)
        self.layout = {f'target_0{i + 1}': p for i, p in enumerate(pts)}

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

    def spawn_beacon(self, el):
        """Le Writer depose une balise la ou il se trouve (>= 4 m des autres) ; sinon point au hasard."""
        if self.writer_xy and time.time() - self.writer_seen < 5.0:
            x, y = self.writer_xy
            if any(math.hypot(x - b[2], y - b[3]) < 4.0 for b in self.beacons):
                return False    # trop pres d'une balise existante : on reessaie un peu plus tard
        else:
            x, y = zone.random_point(self.rng)
        etype, sev, info = self.rng.choice(TYPES)
        bid = f'B-{len(self.beacons) + 1}'
        self.beacons.append((bid, self.t0 + el, round(x, 2), round(y, 2), info, etype, sev))
        self.get_logger().info(f'balise {bid} deposee en ({x:.1f}, {y:.1f}) : {etype}')
        return True

    def send_beacons(self):
        """Republie les balises deja deposees (timestamp d'origine = instant du depot)."""
        el = time.time() - self.t0
        if el >= self.next_spawn and len(self.beacons) < MAX_BEACONS:
            if self.spawn_beacon(el):
                self.next_spawn = el + self.rng.uniform(20.0, 35.0)
            else:
                self.next_spawn = el + 3.0
        for i, (bid, ts, x, y, info, etype, sev) in enumerate(self.beacons):
            d = {'beacon_id': bid, 'timestamp': ts, 'info': info,
                 'event_type': etype, 'severity': sev}
            if i % 2 == 0:  # une balise sur deux en GPS, l'autre en local : les deux formats marchent
                d['latitude'], d['longitude'] = core.local_to_latlon(x, y)
            else:
                d['x'], d['y'] = x, y
            self.beacon_pub.publish(String(data=json.dumps(d)))

    def tick(self):
        if time.time() - self.last_beacons >= 5.0:
            self.last_beacons = time.time()
            self.send_beacons()
        el = time.time() - self.t0
        cycle, t = int(el // CYCLE_S), el % CYCLE_S
        if cycle != self.layout_cycle:
            self.layout_cycle = cycle
            self.new_layout()
        L = self.layout
        # 01 : survivant qui bouge
        self.send('target_01', L['target_01'][0] + 1.2 * math.sin(0.2 * el), L['target_01'][1] + 1.0 * math.cos(0.15 * el), 0.87, 1.0, 0.6, 35.0)
        # 02 : publiee 25 s puis silence (vieillit)
        if t < 25:
            self.send('target_02', *L['target_02'], 0.80, 0.8, 0.8, 0.0)
        # 03 : apparait puis disparait
        if 30 <= t < 50:
            self.send('target_03', *L['target_03'], 0.70, 1.2, 0.7, 60.0)
        # 04 : rapport deja vieux de 40 s (une fois par cycle)
        if t >= 5 and self.sent_old != cycle:
            self.sent_old = cycle
            self.send('target_04', *L['target_04'], 0.90, 0.6, 0.6, 0.0, ts=time.time() - 40.0, as_local=True)


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
