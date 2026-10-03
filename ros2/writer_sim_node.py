#!/usr/bin/env python3
"""
Faux Writer ROS 2 (Humble) pour tester Foxglove sans le vrai robot.

Publie les memes topics que le vrai robot :
  /odom           nav_msgs/Odometry                10 Hz  (le robot tourne en rond)
  /tf             odom -> base_link                10 Hz
  /scan           sensor_msgs/LaserScan             5 Hz  (piece de 12 x 10 m + un debris)
  /battery_state  sensor_msgs/BatteryState          1 Hz
  /diagnostics    diagnostic_msgs/DiagnosticArray   1 Hz  (battery, lidar, motors)

Injecte volontairement des pannes, pour verifier qu'on les voit dans Foxglove :
  - chaque minute, le lidar "tombe" pendant 10 s : /scan s'arrete, diagnostic ERROR
  - la batterie se vide : WARN sous 30 %, ERROR sous 15 %, puis elle est "changee" a 5 %

Lancer :
  source /opt/ros/humble/setup.bash
  python3 writer_sim_node.py
"""
import math

import rclpy
from rclpy.node import Node
from geometry_msgs.msg import TransformStamped
from nav_msgs.msg import Odometry
from sensor_msgs.msg import LaserScan, BatteryState
from diagnostic_msgs.msg import DiagnosticArray, DiagnosticStatus, KeyValue
from tf2_ros import TransformBroadcaster

ROOM_X, ROOM_Y = 6.0, 5.0      # murs de la piece a +-6 m et +-5 m
DEBRIS = (1.5, 0.5, 0.5)       # obstacle : x, y, rayon (m)
LIDAR_PERIOD, LIDAR_DOWN = 60.0, 10.0


def ray_range(x, y, ang, max_range):
    """Distance du robot (x, y) au premier obstacle dans la direction ang."""
    c, s = math.cos(ang), math.sin(ang)
    best = max_range
    if abs(c) > 1e-9:
        t = ((ROOM_X if c > 0 else -ROOM_X) - x) / c
        if t > 0:
            best = min(best, t)
    if abs(s) > 1e-9:
        t = ((ROOM_Y if s > 0 else -ROOM_Y) - y) / s
        if t > 0:
            best = min(best, t)
    cx, cy, r = DEBRIS
    dx, dy = x - cx, y - cy
    b = dx * c + dy * s
    disc = b * b - (dx * dx + dy * dy - r * r)
    if disc >= 0:
        t = -b - math.sqrt(disc)
        if t > 0:
            best = min(best, t)
    return best


class FakeWriter(Node):
    def __init__(self):
        super().__init__('writer_sim')
        self.t0 = self.get_clock().now()
        self.battery = 60.0
        self.lidar_was_down = False
        self.last_batt_level = None
        self.odom_pub = self.create_publisher(Odometry, '/odom', 10)
        self.scan_pub = self.create_publisher(LaserScan, '/scan', 10)
        self.batt_pub = self.create_publisher(BatteryState, '/battery_state', 10)
        self.diag_pub = self.create_publisher(DiagnosticArray, '/diagnostics', 10)
        self.tf = TransformBroadcaster(self)
        self.create_timer(0.1, self.tick_motion)
        self.create_timer(0.2, self.tick_scan)
        self.create_timer(1.0, self.tick_health)
        self.get_logger().info('Fake Writer started: /odom /tf /scan /battery_state /diagnostics')

    def elapsed(self):
        return (self.get_clock().now() - self.t0).nanoseconds / 1e9

    def pose(self):
        """Ellipse de 4 m x 3 m, un tour en ~63 s. Retourne x, y, cap, vitesse."""
        a = self.elapsed() / 10.0
        x, y = 4 * math.cos(a), 3 * math.sin(a)
        yaw = math.atan2(3 * math.cos(a), -4 * math.sin(a))
        speed = math.hypot(0.4 * math.sin(a), 0.3 * math.cos(a))
        return x, y, yaw, speed

    def lidar_down(self):
        return (self.elapsed() % LIDAR_PERIOD) >= LIDAR_PERIOD - LIDAR_DOWN

    def tick_motion(self):
        x, y, yaw, speed = self.pose()
        now = self.get_clock().now().to_msg()
        qz, qw = math.sin(yaw / 2), math.cos(yaw / 2)

        odom = Odometry()
        odom.header.stamp = now
        odom.header.frame_id = 'odom'
        odom.child_frame_id = 'base_link'
        odom.pose.pose.position.x = x
        odom.pose.pose.position.y = y
        odom.pose.pose.orientation.z = qz
        odom.pose.pose.orientation.w = qw
        odom.twist.twist.linear.x = speed
        self.odom_pub.publish(odom)

        tf = TransformStamped()
        tf.header.stamp = now
        tf.header.frame_id = 'odom'
        tf.child_frame_id = 'base_link'
        tf.transform.translation.x = x
        tf.transform.translation.y = y
        tf.transform.rotation.z = qz
        tf.transform.rotation.w = qw
        self.tf.sendTransform(tf)

    def tick_scan(self):
        if self.lidar_down():
            return  # panne simulee : plus aucun message sur /scan
        x, y, yaw, _ = self.pose()
        n = 360
        scan = LaserScan()
        scan.header.stamp = self.get_clock().now().to_msg()
        scan.header.frame_id = 'base_link'
        scan.angle_increment = 2 * math.pi / n
        scan.angle_min = -math.pi
        scan.angle_max = math.pi - scan.angle_increment
        scan.scan_time = 0.2
        scan.range_min = 0.1
        scan.range_max = 12.0
        scan.ranges = [
            float(ray_range(x, y, yaw - math.pi + i * scan.angle_increment, 12.0)) for i in range(n)
        ]
        self.scan_pub.publish(scan)

    @staticmethod
    def status(name, level, message, values):
        s = DiagnosticStatus()
        s.name = name
        s.level = level
        s.message = message
        s.hardware_id = 'writer'
        s.values = [KeyValue(key=k, value=v) for k, v in values.items()]
        return s

    def tick_health(self):
        self.battery -= 0.2
        if self.battery < 5:
            self.battery = 100.0
            self.get_logger().info('Battery swapped: back to 100 %')
        now = self.get_clock().now().to_msg()

        batt = BatteryState()
        batt.header.stamp = now
        batt.percentage = self.battery / 100.0
        batt.voltage = 10.5 + 2.1 * self.battery / 100.0
        batt.present = True
        batt.power_supply_status = BatteryState.POWER_SUPPLY_STATUS_DISCHARGING
        self.batt_pub.publish(batt)

        if self.battery < 15:
            blvl, bmsg = DiagnosticStatus.ERROR, 'critical: return to base'
        elif self.battery < 30:
            blvl, bmsg = DiagnosticStatus.WARN, 'low'
        else:
            blvl, bmsg = DiagnosticStatus.OK, 'ok'
        down = self.lidar_down()

        diag = DiagnosticArray()
        diag.header.stamp = now
        diag.status = [
            self.status('writer/battery', blvl, bmsg,
                        {'percentage': f'{self.battery:.1f}', 'voltage': f'{batt.voltage:.2f}'}),
            self.status('writer/lidar',
                        DiagnosticStatus.ERROR if down else DiagnosticStatus.OK,
                        'no scan received' if down else 'publishing at 5 Hz',
                        {'rate_hz': '0' if down else '5'}),
            self.status('writer/motors', DiagnosticStatus.OK, 'ok',
                        {'speed_mps': f'{self.pose()[3]:.2f}'}),
        ]
        self.diag_pub.publish(diag)

        # Logs dans /rosout uniquement quand l'etat change (visible dans le panneau Log)
        if down and not self.lidar_was_down:
            self.get_logger().error('LIDAR fault: no /scan (simulated, 10 s)')
        elif not down and self.lidar_was_down:
            self.get_logger().info('LIDAR recovered')
        self.lidar_was_down = down
        if blvl != self.last_batt_level:
            if blvl == DiagnosticStatus.ERROR:
                self.get_logger().error(f'Battery critical: {self.battery:.0f} %')
            elif blvl == DiagnosticStatus.WARN:
                self.get_logger().warn(f'Battery low: {self.battery:.0f} %')
            self.last_batt_level = blvl


def main():
    rclpy.init()
    node = FakeWriter()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == '__main__':
    main()
