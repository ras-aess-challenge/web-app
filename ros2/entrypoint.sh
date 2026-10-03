#!/bin/bash
set -e
source /opt/ros/humble/setup.bash
cd /app

# 1. Pont Foxglove (visualisation + debug) : ws://localhost:8765
ros2 launch foxglove_bridge foxglove_bridge_launch.xml port:=8765 &

# 2. Faux Writer (odom, tf, scan, batterie, diagnostics + pannes simulees)
python3 /app/writer_sim_node.py &

# 3. Faux ONA : cibles sur /ona/parsed_targets (desactiver avec SIM_ONA=0 quand l'equipe 1 publie)
if [ "${SIM_ONA:-1}" = "1" ]; then
  python3 /app/parsed_targets_sim.py &
fi

# 4. Faux Executor : recoit /executor/mission, se deplace jusqu'a la balise
python3 /app/executor_sim_node.py &

# 5. Pont ROS 2 <-> MQTT <-> backend <-> dashboard
python3 /app/ros_mqtt_bridge.py &

# Si un processus s'arrete, le conteneur s'arrete (et redemarre)
wait -n
exit $?
