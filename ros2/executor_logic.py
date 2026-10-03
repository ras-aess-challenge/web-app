"""
Modele cinematique de l'Executor simule (pur Python, sans ROS -> testable).

  standby --assign--> en-route --(arrive)--> inspecting (4 s) --> done --> returning --(home)--> standby

mission_status expose a l'exterieur : None | 'active' | 'done' | 'cancelled'
"""
import math

HOME = (-5.5, -4.0)
SPEED = 0.7        # m/s
ARRIVE_M = 0.35    # distance consideree comme "arrive"
INSPECT_S = 4.0


class ExecutorModel:
    def __init__(self, home=HOME, speed=SPEED):
        self.home = home
        self.speed = speed
        self.pos = home
        self.theta = 0.0
        self.state = 'standby'
        self.mission_id = None
        self.mission_status = None
        self.target = None
        self.inspect_left = 0.0
        self.battery = 88.0

    # --- ordres ---
    def assign(self, mission_id, target_xy):
        self.mission_id = mission_id
        self.target = (float(target_xy[0]), float(target_xy[1]))
        self.mission_status = 'active'
        self.state = 'en-route'
        self.inspect_left = INSPECT_S

    def cancel(self, mission_id=None):
        if mission_id is not None and mission_id != self.mission_id:
            return
        if self.state in ('en-route', 'inspecting'):
            self.mission_status = 'cancelled'
            self.state = 'returning'
            self.target = self.home

    # --- dynamique ---
    def _move_toward(self, goal, dt):
        dx, dy = goal[0] - self.pos[0], goal[1] - self.pos[1]
        d = math.hypot(dx, dy)
        if d <= ARRIVE_M:
            return True
        self.theta = math.atan2(dy, dx)
        step = min(self.speed * dt, d)
        self.pos = (self.pos[0] + dx / d * step, self.pos[1] + dy / d * step)
        self.battery = max(5.0, self.battery - 0.02 * dt)
        return math.hypot(goal[0] - self.pos[0], goal[1] - self.pos[1]) <= ARRIVE_M

    def tick(self, dt):
        if self.state == 'en-route':
            if self._move_toward(self.target, dt):
                self.state = 'inspecting'
        elif self.state == 'inspecting':
            self.inspect_left -= dt
            if self.inspect_left <= 0:
                self.mission_status = 'done'
                self.state = 'returning'
                self.target = self.home
        elif self.state == 'returning':
            if self._move_toward(self.home, dt):
                self.state = 'standby'

    def status(self):
        return {'state': self.state, 'mission_id': self.mission_id,
                'mission_status': self.mission_status, 'battery': round(self.battery, 1)}
