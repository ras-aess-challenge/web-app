"""Drop beacons at the ROS writer's actual odometry and deliver through authenticated TCP."""
import os
import time
import rclpy
from nav_msgs.msg import Odometry
from std_msgs.msg import String
from rclpy.node import Node
from writer import Writer
from writer_client import send_node

class NetworkWriter(Node):
    def __init__(self):
        super().__init__('network_writer')
        self.writer = Writer('ROS_WRITER')
        self.last_position = None
        self.pending = None
        self.interval = float(os.getenv('ROS_BEACON_INTERVAL', '30'))
        self.last_delivery = time.time() - self.interval
        self.create_subscription(Odometry, '/odom', self.odometry, 10)
        self.create_subscription(String, '/sim/reset', self.on_reset, 10)
        self.create_timer(1.0, self.deliver)

    def on_reset(self, _message):
        self.pending = None
        self.last_position = None
        self.last_delivery = time.time()

    def odometry(self, message):
        p = message.pose.pose.position
        self.last_position = (p.x, p.y)

    def deliver(self):
        if self.last_position is None or (self.pending is None and time.time() - self.last_delivery < self.interval):
            return
        if self.pending is None:
            self.writer.x, self.writer.y = self.last_position
            # Alternate between VICTIM and FIRE for the ROS Demo
            event_to_drop = 'FIRE' if len(self.writer.dropped_nodes) % 2 != 0 else 'VICTIM'
            self.writer.x, self.writer.y = self.last_position
            self.pending = self.writer.drop_node(event_to_drop, 0.9)
        try:
            node_id = send_node(self.pending)
            self.get_logger().info(f'Network confirmed {node_id}')
            self.pending = None
            self.last_delivery = time.time()
        except (OSError, RuntimeError) as exc:
            self.get_logger().warn(f'Delivery deferred: {type(exc).__name__}')
            if time.time() - self.pending.timestamp > 300:
                self.pending = None


def main():
    rclpy.init()
    node = NetworkWriter()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
