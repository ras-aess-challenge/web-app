# Living Map WebApp

The React dashboard and Node.js MQTT/WebSocket backend are integrated with the authenticated Python beacon network, ROS Writer/Executor, and Foxglove.

The WebApp is part of the complete **Living Map** system and provides the dashboard and backend services required to monitor missions, beacons, and robot activity.

---

## Architecture

The WebApp is integrated into the following system:

```text
Writer
   ↓
Weak Node
   ↓
Strong Node
   ↓
ONA
   ↓
Command Post
   ↓
ROS Executor
   ↓
MQTT
   ↓
Node Backend
   ↓
WebSocket
   ↓
React Dashboard
```

The WebApp receives mission and beacon information through MQTT and provides real-time updates to the React dashboard through WebSocket.

Foxglove is used for live ROS and sensor visualization.

---

## Running the WebApp

The shared Docker configuration is maintained in the separate Docker repository.

```bash
cd ../docker
docker compose up -d --build --wait --wait-timeout 180
```

Once the services are running, open:

**http://localhost:5173**

The React dashboard will be available through the browser.

---

## ROS Integration

The ROS Executor automatically visits Writer beacons in the integrated deployment.

Mission information is transmitted through MQTT and returned to the dashboard through WebSocket, including:

* Mission assignment
* Mission progress
* Beacon inspection
* Mission completion
* Mission cancellation

Foxglove can be connected to:

```text
ws://localhost:8765
```

for live ROS and sensor data.

For the complete integration documentation, see:

* [ROS Integration](https://github.com/ras-aess-challenge/docs/blob/main/ros-integration.md)
* [Run Guide](https://github.com/ras-aess-challenge/docs/blob/main/run-guide.md)
* [WebApp Contract](https://github.com/ras-aess-challenge/docs/blob/main/webapp-contract.md)

---

## Automatic and Manual Dispatch

The ROS Executor can automatically select and visit Writer beacons.

To disable automatic dispatch:

```text
AUTO_DISPATCH=0
```

Set this value in:

```text
docker/.env
```

Then recreate the services.

This allows beacons to be selected and assigned manually.

The configuration details are documented in:

[Configuration](https://github.com/ras-aess-challenge/docs/blob/main/configuration.md)

---

## Simulation

The integrated Writer explores the configured polygon defined in:

```text
shared/zone.json
```

The project also supports standalone simulation and alternative execution modes.

The simulation documentation covers:

* Zone configuration
* Zone drawing
* Reset behavior
* Automatic dispatch
* Manual dispatch
* Python-only execution
* Fake-ONA demonstration

See:

[Simulation and Run Documentation](https://github.com/ras-aess-challenge/docs/blob/main/run-guide.md)

---

## Deployment

The main deployment uses the full ROS integration.

Alternative Compose configurations are available for:

* Full ROS deployment
* Python-only deployment
* Fake-ONA demonstration

See the deployment documentation:

[Deployment](https://github.com/ras-aess-challenge/docs/blob/main/deployment.md)

---

## Documentation

All technical documentation is maintained in the separate **Living Map Docs repository**:

**[ras-aess-challenge/docs](https://github.com/ras-aess-challenge/docs)**

### Architecture

* [Architecture](https://github.com/ras-aess-challenge/docs/blob/main/architecture.md)
* [Code Structure](https://github.com/ras-aess-challenge/docs/blob/main/code-structure.md)
* [Protocol](https://github.com/ras-aess-challenge/docs/blob/main/protocol.md)

### WebApp

* [WebApp Documentation](https://github.com/ras-aess-challenge/docs/blob/main/webapp.md)
* [WebApp Plan](https://github.com/ras-aess-challenge/docs/blob/main/webapp-plan.md)
* [WebApp Contract](https://github.com/ras-aess-challenge/docs/blob/main/webapp-contract.md)

### ROS and Execution

* [ROS Integration](https://github.com/ras-aess-challenge/docs/blob/main/ros-integration.md)
* [Run Guide](https://github.com/ras-aess-challenge/docs/blob/main/run-guide.md)

### Configuration and Deployment

* [Configuration](https://github.com/ras-aess-challenge/docs/blob/main/configuration.md)
* [Deployment](https://github.com/ras-aess-challenge/docs/blob/main/deployment.md)
* [Development](https://github.com/ras-aess-challenge/docs/blob/main/development.md)
* [Operations](https://github.com/ras-aess-challenge/docs/blob/main/operations.md)
* [Troubleshooting](https://github.com/ras-aess-challenge/docs/blob/main/troubleshooting.md)

### Security and Verification

* [Security](https://github.com/ras-aess-challenge/docs/blob/main/security.md)
* [Testing](https://github.com/ras-aess-challenge/docs/blob/main/testing.md)
* [Verification](https://github.com/ras-aess-challenge/docs/blob/main/verification.md)

### Workspace

* [Workspace README](https://github.com/ras-aess-challenge/docs/blob/main/workspace-readme.md)

---

## Related Repositories

* [Documentation](https://github.com/ras-aess-challenge/docs)
* [Docker](https://github.com/ras-aess-challenge/docker)
* [Robots Network](https://github.com/ras-aess-challenge/robots-network)

---

## Migration

The architecture comparison and migration verification are documented in the project documentation repository.

See the [Verification Documentation](https://github.com/ras-aess-challenge/docs/blob/main/verification.md).
