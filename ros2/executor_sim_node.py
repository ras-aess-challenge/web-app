#!/usr/bin/env python3
"""
Faux Executor ROS 2 : recoit une mission, se deplace jusqu'a la cible, l'inspecte, rentre.

  Abonne :  /executor/mission  (std_msgs/String, JSON)
              {"mission_id": "M-1", "target": {"x": -3.0, "y": 4.0}}     -> demarre
              {"cancel": true, "mission_id": "M-1"}                      -> annule
  Publie :  /executor/odom     (nav_msgs/Odometry)   10 Hz
            /executor/status   (std_msgs/String JSON) 2 Hz : state, mission_id, mission_status, battery

Lancer :  source /opt/ros/humble/setup.bash && python3 executor_sim_node.py
"""
import json
import math
import time

import rclpy
from nav_msgs.msg import Odometry
from rclpy.node import Node
from std_msgs.msg import String

import zone
from executor_logic import ExecutorModel


class ExecutorSim(Node):
    def __init__(self):
        super().__init__('executor_sim')
        self.model = ExecutorModel()
        self.odom_pub = self.create_publisher(Odometry, '/executor/odom', 10)
        self.status_pub = self.create_publisher(String, '/executor/status', 10)
        self.create_subscription(String, '/executor/mission', self.on_mission, 10)
        self.create_subscription(String, '/sim/reset', self.on_reset, 10)
        self.create_subscription(String, '/sim/zone', self.on_zone, 10)
        self.last = time.time()
        self.create_timer(0.1, self.tick)
        self.create_timer(0.5, self.publish_status)
        self.get_logger().info('Faux Executor pret : mission sur /executor/mission')

    def on_reset(self, _msg):
        self.model.reset()
        self.get_logger().info('reset : Executor retourne a la base')
        self.publish_status()

    def on_zone(self, msg):
        try:
            ok = zone.set_polygon(json.loads(msg.data).get('polygon'))
        except (ValueError, AttributeError):
            ok = False
        if ok:
            self.model.reset(home=zone.home())
            self.get_logger().info('nouvelle zone recue : Executor retourne a la base de la zone')
            self.publish_status()

    def on_mission(self, msg):
        try:
            d = json.loads(msg.data)
            if d.get('cancel'):
                self.model.cancel(d.get('mission_id'))
                self.get_logger().info(f"mission {d.get('mission_id')} annulee")
                return
            t = d['target']
            self.model.assign(str(d['mission_id']), (t['x'], t['y']))
            self.get_logger().info(f"mission {d['mission_id']} -> cible ({t['x']:.1f}, {t['y']:.1f})")
        except (ValueError, KeyError, TypeError) as e:
            self.get_logger().warn(f'mission invalide ignoree : {e}')
        self.publish_status()

    def tick(self):
        now = time.time()
        self.model.tick(now - self.last)
        self.last = now
        m = self.model
        o = Odometry()
        o.header.stamp = self.get_clock().now().to_msg()
        o.header.frame_id = 'odom'
        o.child_frame_id = 'executor_base'
        o.pose.pose.position.x, o.pose.pose.position.y = m.pos
        o.pose.pose.orientation.z = math.sin(m.theta / 2.0)
        o.pose.pose.orientation.w = math.cos(m.theta / 2.0)
        self.odom_pub.publish(o)

    def publish_status(self):
        self.status_pub.publish(String(data=json.dumps(self.model.status())))


def main():
    rclpy.init()
    node = ExecutorSim()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
