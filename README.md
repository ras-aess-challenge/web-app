# Living Map webapp

The React dashboard and Node MQTT/WebSocket backend are integrated with the
authenticated Python beacon network, ROS Writer/Executor and Foxglove.
Shared Docker configuration lives in [../docker/](../docker/README.md);
full documentation lives in [../docs/](../docs/README.md).

```bash
cd ../docker
docker compose up -d --build --wait --wait-timeout 180
```

Open **http://localhost:5173**, select an automatically generated writer beacon
and assign it to the ROS Executor. Mission progress, inspection, completion and
cancellation return through MQTT and the dashboard WebSocket. Connect Foxglove
to **ws://localhost:8765** for live sensors.

See the [full ROS integration](../docs/ros-integration.md),
[run guide](../docs/run-guide.md), and [data contract](../docs/webapp-contract.md).
The Python-only alternative and separate fake-ONA demo remain available; explicit
Compose files select them. The main `.env` selects the full ROS deployment.
