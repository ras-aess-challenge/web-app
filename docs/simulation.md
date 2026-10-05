# Simulation and operator controls

The default deployment remains the authenticated network + persistent beacon store + ROS
executor. Start it from `../docker` using the existing environment and Compose files.
Automatic dispatch is enabled by default (`AUTO_DISPATCH=1`): the Executor visits new
beacons without an operator click. Set it to `0` for manual missions.

The isolated simulator uses the same migrated application code and shared Dockerfiles:

```sh
cd ../docker
docker compose -f compose.ros-demo.yaml up -d --build --wait
```

Open http://localhost:5174. Set `ROS_DASHBOARD_PORT` and `FOXGLOVE_PUBLISHED_PORT`
if another deployment already occupies those ports. The simulator generates targets,
drops beacons at the Writer's current position, and automatically dispatches the Executor.
`SIM_SEED` accepts an integer for reproducible random choices. Set `AUTO_DISPATCH=0`
to demonstrate manual beacon selection and assignment instead.

**Reset map** starts a new map session in both the integrated deployment and standalone simulator. It cancels any simulated mission,
clears targets/beacons and the automatic queue, resets the simulator nodes, and publishes
a confirmed `map.reset` notification to all dashboards. It does not delete network data.
The integrated deployment preserves stored beacons and uses a retained session cutoff to
ignore earlier records during MQTT replay and polling. Zone editing (`set-zone`) remains
restricted to the standalone simulator. Reset does not delete the beacon storage volume.

On the GPS map, choose **Draw zone**, click 3–16 vertices, then double-click to finish.
The polygon must contain finite local coordinates within ±5000 m and have at least 4 m²
area. A valid change resets the simulated scenario and moves the Writer/Executor base
into the new zone. Both map implementations show the outline; **Fit zone** centers the
offline canvas. Zone editing is available only in the standalone simulator.

The permanent default is `shared/zone.json`, used by Vite and Python and copied into ROS
images as `/app/zone.json`. Edit it and rebuild to change the default. Runtime drawings
are scenario state, not a database migration: restarting ROS restores the configured
polygon. The most recent reset/zone state is retained over MQTT so restarting the backend
and reconnecting dashboards recover it. Commands themselves remain non-retained.

Writer motion is bounded by the polygon. Executor motion is still a straight-line
simulation, without obstacle avoidance; use a convex exploration polygon for missions
that must remain within the area. Stored legacy beacon positions are never discarded
because they fall outside a newer default zone. Automatic queue/mission state is in memory
and is not a durable, exactly-once dispatch system across ROS restarts.

The map defaults to current targets and recent beacons/events. Enable **History** to
show earlier records; selected beacons and mission targets remain visible. Labels avoid
collisions, and beacon names are shown only for the selected beacon. This display filter
does not delete data from the panels or persistent storage.

Uncertainty is shown at the full 2-sigma size by default. `VITE_ELLIPSE_SCALE` can adjust
its visual size; `VITE_ELLIPSE_HIDE_S` hides old ellipses after 15 seconds (`0` disables
hiding). Targets, age, probability decay and re-scout indicators remain visible. These
are Vite build-time settings, not Compose runtime environment settings.

Validation commands from the workspace root:

```sh
./docker/test.sh
./docker/test-ros.sh
./docker/test-simulation.sh
```

Each helper uses a unique Compose project, ephemeral host ports and dedicated volumes.
Its cleanup removes only that helper's test data. Existing deployment data is preserved.
