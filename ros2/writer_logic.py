"""
Deplacement du Writer simule (pur Python, sans ROS -> testable).

Le Writer visite des points choisis AU HASARD dans la zone (zone.py) et n'en sort jamais :
un pas qui sortirait de la zone est refuse et un nouveau point est tire.
"""
import math
import random

import zone

SPEED = 1.0                   # m/s
TURN_RATE = 1.6               # rad/s
ARRIVE_M = 0.4


class RandomWalker:
    def __init__(self, rng=None):
        self.rng = rng or random.Random()
        self.reset()

    def reset(self):
        self.x, self.y = zone.home()
        self.yaw = 0.0
        self.speed = 0.0
        self.goal = self._pick_goal()

    def _pick_goal(self):
        ax, ay = zone.half_extent()
        min_leg = 0.7 * min(ax, ay)
        g = zone.random_point(self.rng)
        for _ in range(50):
            g = zone.random_point(self.rng)
            if math.hypot(g[0] - self.x, g[1] - self.y) >= min_leg:
                break
        return g

    def tick(self, dt):
        dt = min(max(dt, 0.0), 0.5)
        dx, dy = self.goal[0] - self.x, self.goal[1] - self.y
        if math.hypot(dx, dy) <= ARRIVE_M:
            self.goal = self._pick_goal()
            dx, dy = self.goal[0] - self.x, self.goal[1] - self.y
        want = math.atan2(dy, dx)
        err = (want - self.yaw + math.pi) % (2 * math.pi) - math.pi
        self.yaw += max(-TURN_RATE * dt, min(TURN_RATE * dt, err))
        self.yaw = (self.yaw + math.pi) % (2 * math.pi) - math.pi
        self.speed = 0.0
        if abs(err) < 0.5:   # n'avance que s'il est a peu pres dans la bonne direction
            step = min(SPEED * dt, math.hypot(dx, dy))
            nx, ny = self.x + math.cos(self.yaw) * step, self.y + math.sin(self.yaw) * step
            if zone.contains(nx, ny, margin=-1e-6):
                self.x, self.y, self.speed = nx, ny, SPEED
            else:                       # le chemin sortirait de la zone : autre destination
                self.goal = self._pick_goal()
