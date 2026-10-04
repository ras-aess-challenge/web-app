#!/bin/bash
set -eo pipefail
source /opt/ros/humble/setup.bash
cd /app
children=()
start() { "$@" & children+=("$!"); }
cleanup() { trap - EXIT INT TERM; kill "${children[@]}" 2>/dev/null || true; wait || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
start ros2 launch foxglove_bridge foxglove_bridge_launch.xml port:=8765
start python3 /app/writer_sim_node.py
if [ "${SIM_ONA:-1}" = 1 ]; then start python3 /app/parsed_targets_sim.py; fi
if [ "${NETWORK_BEACONS:-0}" = 1 ]; then start python3 /app/network_writer_node.py; fi
start python3 /app/executor_sim_node.py
start python3 /app/ros_mqtt_bridge.py
set +e
wait -n
result=$?
# Any child exit is a supervisor failure, even if the child exited zero.
if [ "$result" = 0 ]; then result=1; fi
exit "$result"
