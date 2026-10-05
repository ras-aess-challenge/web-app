# Living Map Documentation

This repository contains the technical documentation for the **Living Map** project.

It documents the system architecture, communication protocol, WebApp, ROS integration, deployment, configuration, development workflow, security, testing, and verification.

---

## Documentation

### System Architecture

* [Architecture](architecture.md) — Overall Living Map system architecture and component relationships.
* [Code Structure](code-structure.md) — Organization of the project code and main components.
* [Protocol](protocol.md) — Communication protocol, message structure, and data flow.

### WebApp

* [WebApp](webapp.md) — WebApp architecture and functionality.
* [WebApp Plan](webapp-plan.md) — WebApp implementation and integration plan.
* [WebApp Contract](webapp-contract.md) — MQTT, WebSocket, and data communication contract.

### ROS Integration

* [ROS Integration](ros-integration.md) — Integration between the Living Map network, ROS Writer/Executor, and Foxglove.

### Setup and Deployment

* [Configuration](configuration.md) — System configuration, environment variables, and execution options.
* [Deployment](deployment.md) — Deployment structure and Docker-based execution.
* [Run Guide](run-guide.md) — Step-by-step guide for running the complete system.
* [Workspace README](workspace-readme.md) — Workspace-level setup and project information.

### Development and Operations

* [Development](development.md) — Development workflow and implementation guidelines.
* [Operations](operations.md) — Operational procedures and system usage.
* [Troubleshooting](troubleshooting.md) — Common problems and solutions.

### Security

* [Security](security.md) — Security mechanisms, communication protection, and security considerations.

### Testing and Verification

* [Testing](testing.md) — Testing procedures and test scenarios.
* [Verification](verification.md) — Verification of the integrated system and expected results.

---

## System Overview

The Living Map system connects the robot communication network, ROS, and the WebApp.

```text
Writer
   │
   ▼
Weak Node
   │
   ▼
Strong Node
   │
   ▼
ONA
   │
   ▼
Command Post
   │
   ▼
ROS Executor
   │
   ▼
MQTT
   │
   ▼
Node Backend
   │
   ▼
WebSocket
   │
   ▼
React Dashboard
```

The documentation in this repository describes each layer and how the components interact.

---

## Documentation Flow

For someone discovering the project for the first time, the recommended reading order is:

```text
Architecture
     ↓
Protocol
     ↓
Code Structure
     ↓
Configuration
     ↓
Deployment
     ↓
Run Guide
     ↓
ROS Integration
     ↓
WebApp
     ↓
Testing
     ↓
Verification
```

For development and maintenance:

```text
Development
     ↓
Operations
     ↓
Troubleshooting
     ↓
Security
```

---

## Main Components

### Robot Communication Network

The communication network handles the transmission of beacon information between the Writer, Weak Nodes, Strong Node, ONA, and Command Post.

### ROS

ROS provides the robot-side integration, including the Writer and Executor components.

### WebApp

The WebApp provides the operator interface for monitoring and controlling missions.

It includes:

* React dashboard
* Node.js backend
* MQTT communication
* WebSocket communication
* Mission management
* Beacon monitoring
* Robot progress
* Mission inspection and completion

### Foxglove

Foxglove is used for live ROS and sensor visualization during the integrated deployment.

---

## Deployment

The Living Map system uses Docker-based deployment for the integrated environment.

The complete procedure is documented in:

* [Configuration](configuration.md)
* [Deployment](deployment.md)
* [Run Guide](run-guide.md)

The documentation also covers the available execution modes and configuration options.

---

## Simulation and Integration

The documentation covers the integrated Writer and Executor workflow, including beacon generation, mission dispatch, ROS integration, and WebApp communication.

The configured simulation zone is defined through:

```text
shared/zone.json
```

Automatic dispatch can be controlled through the deployment configuration.

For the complete procedure, see the [Run Guide](run-guide.md) and [Configuration](configuration.md).

---

## Testing and Verification

The system includes documentation for both testing and verification.

* [Testing](testing.md) describes the testing procedures and scenarios.
* [Verification](verification.md) records the expected and verified system behavior.

These documents should be used together when validating a deployment.

---

## Security

Security considerations and protections used throughout the system are documented in [Security](security.md).

This includes the security aspects of the communication and integrated system architecture.

---

## Repository Structure

```text
docs/
├── README.md
│
├── architecture.md
├── code-structure.md
├── protocol.md
│
├── configuration.md
├── deployment.md
├── development.md
├── operations.md
├── run-guide.md
├── troubleshooting.md
│
├── ros-integration.md
│
├── webapp.md
├── webapp-plan.md
├── webapp-contract.md
│
├── security.md
├── testing.md
├── verification.md
│
└── workspace-readme.md
```

---

## Purpose

The `docs` repository is the **central documentation repository for Living Map**.

It provides a single reference for understanding, deploying, developing, testing, and verifying the complete system.
