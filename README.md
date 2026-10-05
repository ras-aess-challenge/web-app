# Living Map Documentation

This repository contains the documentation for the **Living Map** project.

The documentation covers the complete system architecture, communication protocol, ROS integration, web application, simulation, deployment, and testing workflow.

## Documentation

* [Run Guide](run-guide.md) — How to run and verify the complete system
* [ROS Integration](ros-integration.md) — ROS Writer, Executor, and Foxglove integration
* [WebApp Contract](webapp-contract.md) — MQTT, WebSocket, and web application data flow
* [Simulation](simulation.md) — Simulation controls, zone configuration, reset behavior, and automatic dispatch
* [Migration Report](migration-report.md) — Architecture comparison and migration verification

## System Overview

The Living Map system integrates:

* **Python beacon network** for authenticated beacon communication
* **ROS Writer and Executor** for robot coordination
* **MQTT** for mission and beacon communication
* **WebSocket** for real-time dashboard updates
* **React dashboard** for monitoring and mission control
* **Foxglove** for live ROS data visualization

The main communication flow is:

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
```

The web application provides the monitoring and control interface for the integrated system.

## Related Repositories

The project is organized across separate repositories.

* **WebApp** — React dashboard and Node MQTT/WebSocket backend
* **Robots Network** — Python authenticated beacon network
* **Docker** — Shared Docker Compose configuration and deployment
* **Docs** — Project documentation and technical guides

The documentation in this repository is intended to explain how these components work together and how to run the integrated system.

## Running the Integrated System

The main Docker configuration is maintained in the **Docker repository**.

From the Docker repository:

```bash
docker compose up -d --build --wait --wait-timeout 180
```

The dashboard is available at:

```text
http://localhost:5173
```

Foxglove can connect to:

```text
ws://localhost:8765
```

The ROS Executor can automatically visit Writer beacons. Manual beacon assignment can also be enabled through the Docker configuration.

For the exact deployment and execution procedure, follow the [Run Guide](run-guide.md).

## Configuration

The integrated deployment is configured through the Docker repository `.env` file.

For example:

```text
AUTO_DISPATCH=0
```

disables automatic dispatch and allows beacons to be selected and assigned manually.

The documentation explains the available configuration options and their effect on the system.

## Purpose of This Repository

This repository is the **technical documentation reference** for the Living Map project.

It is intended to provide:

* System architecture documentation
* Communication and data-flow specifications
* ROS integration details
* Web application contracts
* Simulation instructions
* Deployment and configuration guides
* Migration and verification results

For implementation code, refer to the corresponding project repositories.
