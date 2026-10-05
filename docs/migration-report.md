# System integration migration report

Date: 2026-10-05 (Africa/Tunis). Destination: `web-app`, branch `main`, baseline
`62cc4bd`. Implementation source: secondary repository `TSYP-AESS`, branch `main`,
baseline `d666cee` (new implementation primarily in `847543e`). Both repositories
were clean before changes. No history was rewritten, and the secondary repository was not modified.
Publication uses the GitHub account and commit identity `anonym-03`.

## A. Repository analysis

| Area | Existing destination | Secondary implementation |
| --- | --- | --- |
| Frontend | Plain JavaScript React 19, Vite 6, OpenLayers, Canvas fallback; state in React; WebSocket reconnect/sync; shared normalization contract | Same framework/design; adds zone outline, reset button, uncertainty display options and prominent assignment button |
| Backend | Node ES modules, MQTT normalization -> bounded snapshot -> WebSocket; HTTP `/health`; payload limit; command publication | Same gateway; adds reset snapshot clearing but removes HTTP health and payload limit |
| ROS | Humble simulated Writer sensors, Executor lifecycle, mission tracker, diagnostics, Foxglove; authenticated network Writer; retained network feeds to Foxglove; supervision and real health checks | Random Writer exploration; polygon configuration; random targets/beacons; automatic dispatch queue; reset/zone ROS topics; weaker supervision; no authenticated network integration |
| Storage | External Python command post atomically persists beacon JSON in `beacons` volume; MQTT persistence uses `mqtt-data`; gateway/ROS mission state in memory | No database, ORM, schema migrations or durable mission store |
| Infrastructure | Parent `docker/` controls shared Python network/robots, Node, nginx, MQTT and ROS; seven services in full ROS mode; unpublished internal APIs; localhost host bindings; pinned images; non-root/read-only containers; isolated test helpers | Separate Compose with exposed broker/backend, Vite dev serving, unpinned images, no equivalent health/order/security integration |
| Authentication | HMAC SHA-256 and shared secret on Python protocol; MQTT/operator WebSocket are trusted-network interfaces without user accounts | Anonymous MQTT/operator WebSocket; no new identity or authorization system |
| APIs | Dashboard `/ws` -> nginx -> Node -> `cmd/<action>` -> ROS or HTTP Executor; `/health`; network-bridge health; Foxglove websocket | Adds `reset-map` and `set-zone`; no new REST controllers |
| Builds/tests/CI | npm lockfiles and component tests; Python tests; container system tests; production nginx build; Vite development; no CI configuration found | Same base tests plus dispatcher/zone/writer tests; technical report/demo materials reference its standalone architecture |

No additional framework, shared workspace manager, SQL database, external cloud
service, or CI/CD pipeline was introduced. The destination retains the authenticated
Python network and its original Docker ownership. It is independent of the secondary
repository; it still intentionally participates in the existing parent integration
workspace (`Network`, `Robots-Network`, `docker`).

## B. Migration summary

| Feature | Source | Final location / adaptation |
| --- | --- | --- |
| Polygon default and geometry | Secondary zone implementation | `shared/zone.json`, `ros2/zone.py`, `dashboard/src/zone.js`; canonical config shared across builds |
| Bounded random Writer movement and seeded scenario | Secondary Writer/logic | `ros2/writer_logic.py`, `ros2/writer_sim_node.py`; real sensor/diagnostics topics preserved |
| Random target layouts and beacon drops at Writer odometry | Secondary ONA simulator | `ros2/parsed_targets_sim.py`; runs only in explicitly selected standalone demo |
| Severity/FIFO automatic dispatch and manual deduplication | Secondary dispatcher | `ros2/bridge_core.py`, `ros2/ros_mqtt_bridge.py`; feeds from authenticated network also supported; automatic mode is the deployment default; manual mode remains selectable |
| Reset / set-zone ROS controls | Secondary reset implementation | Shared command contract, gateway, ROS bridge and simulator subscribers; reset supported in both modes, zone editing simulation-only |
| Multi-client confirmed reset and recovery | Reworked secondary reset | `system/map-reset` -> `map.reset`; backend clears after confirmation; current polygon survives snapshot eviction and is retained over MQTT |
| Polygon drawing UI | Completed unfinished secondary hooks | `dashboard/src/OlMap.jsx`, `geo.js`, `App.jsx`; OpenLayers draw tool, validation, confirmed zone update |
| Zone overlays and fitting | Secondary map renderers | `OlMap.jsx`, `MapCanvas.jsx`; offline fit added; selected beacon highlighting retained |
| Smaller/limited-age uncertainty rendering | Secondary display options | `staleness.js`, both maps; original full 2-sigma default retained; redraw signature now includes decay/growth/visibility |
| Prominent assignment action | Secondary panel change | `dashboard/src/panels.jsx` |
| Foxglove layout delta | Secondary layout | `foxglove/living_map_robot_health.json`; existing layout already had most panels; remaining metadata merged |
| Tests/docs | Secondary tests + new integration tests | ROS tests, gateway/staleness tests, `backend/test/simulation-system.e2e.js`, these docs; outdated standalone deployment docs were replaced with destination-specific instructions |

## C. Architectural decisions

1. Keep the destination's HTTP health checks, nginx same-origin `/ws`, payload limit,
   retained-command replay rejection, authenticated feeds, ROS health file and process
   supervisor. Replacing them with the secondary versions would break Docker readiness,
   remote browsers and network/Foxglove integration.
2. Keep FIRE event support. The secondary contract would have removed it.
3. Adapt reset instead of clearing snapshots optimistically. A backend receipt is not
   proof that ROS reset. ROS confirmation clears all clients and the gateway together; earlier records are ignored for this session.
   Reset state is pinned outside the bounded telemetry snapshot.
4. Provide Reset map in the integrated deployment as well as the standalone simulator.
   A retained cutoff clears the operator session and prevents old MQTT/network records
   from repopulating it, while the durable beacon store remains unchanged. Restrict
   zone editing to the standalone simulator.
5. Enable automatic assignment by default (`AUTO_DISPATCH=1`) in both ROS deployments,
   matching the secondary implementation; explicit `0` selects manual control. Existing manual assignments cannot be
   overwritten while pending/active. Queue priority is critical, warn, info, then arrival.
6. Move the zone configuration to `shared/`, avoiding browser imports of ROS-only files
   and missing Docker build-context assets. Improve concave-polygon interior selection.
7. Fix Vite development with a `/ws` proxy; production keeps nginx routing. Remove the
   stale hardcoded private broker IP from the bridge and VM test publisher defaults.
8. Preserve dependency versions and lockfiles. Do not migrate a competing Compose stack,
   weaker Dockerfiles, historical plan, or reports that describe obsolete infrastructure.

## D. Files changed

- `web-app/backend/src`: config/capability, reset normalization, gateway snapshots,
  server status, retained session cutoffs and single-pass command forwarding. Network adapters remain intact.
- `web-app/backend/test`: reset/zone/eviction/cutoff regressions and live simulation E2E.
- `web-app/shared`: extended command/envelope validation and canonical polygon JSON.
- `web-app/ros2`: geometry/Writer modules; adapted Writer, Executor, ONA, bridge,
  dispatcher and tests; broker default cleanup. Existing entrypoint, health checks and
  authenticated NetworkWriter are retained.
- `web-app/dashboard`: zone helpers, drawing/overlays, reset state, uncertainty options,
  fitting, preserved selection, assignment action, development proxy and tests.
- `web-app/foxglove`, `.env.example`, `.gitignore`, `README.md`, `docs/`: layout,
  documented config/behavior, Python artifact ignores and report.
- Parent `docker/`: ROS config copy and test build context; explicit auto-dispatch/seed
  settings; demo capability and E2E test service; `test-simulation.sh`; docs/example.
- Parent `docs/configuration.md`, `docs/testing.md`: unified settings/test instructions.
- `Robots-Network/tests/test_system.py`: fix existing PoD expectation from 0.90 to
  0.95 to match the already-modified Writer CLI; no robot behavior changed.

The parent workspace is not itself a Git repository. `docker/` and `docs/` are
separate Git repositories, as are `web-app/` and `Robots-Network/`. Their integration
changes are published together to the existing repositories. There are no deleted source files or duplicate
migrated services. Existing uncommitted work was not present or overwritten.

## E. Dependencies

Added: none. Removed: none. Upgraded: none. Downgraded: none.
Both repositories have matching resolved versions: backend MQTT 5.16.0 / ws 8.21.3;
dashboard React/ReactDOM 19.3.0, OpenLayers 10.10.0, Vite 6.4.3, Vitest 3.2.7,
MQTT 5.16.0. Existing ROS Humble, paho-mqtt 2.1.0 and pinned base images remain.
Browser verification used temporary Playwright tooling under `/tmp/aess-browser`,
without adding a project dependency.

## F. Database changes

No schema change or data migration is required: neither application has an ORM/SQL
schema. The Python persistent JSON beacon format and atomic save logic are unchanged.
Named beacon/MQTT volumes are preserved. New simulation zone, mission and queue state
are not persisted to that beacon store. Runtime drawn zones restore the configured
JSON default when ROS restarts. Persistence after container recreation is verified
by comparing the complete beacon-file SHA-256 digest.

## G. Docker changes

- `web-ros.Dockerfile` copies canonical zone JSON and sets `ZONE_FILE=/app/zone.json`.
- ROS test build uses the destination root context and copies the same config.
- Full ROS override passes `AUTO_DISPATCH` (default 1) and optional `SIM_SEED`.
- Standalone demo enables backend `SIM_COMMANDS=1`, defaults auto-dispatch to 1,
  and has a profile-only simulation test runner; it uses existing application images.
- Backend subscribes to `system/map-reset`; ROS publishes retained scenario state.
- Existing service names, network topology, persistent volumes, health checks and host
  ports remain intact. Default HTTP 5173, TCP relay 65432 and Foxglove 8765 remain
  localhost-bound. Standalone dashboard remains 5174; internal MQTT is 1883 and
  backend is 4311, accessed by Docker service names and same-origin browser proxy.
- Test projects use ephemeral ports and unique volumes; cleanup never targets normal
  mission storage. Private `.env` and its secret were not changed or printed.

## H. Testing

Results and exact commands are recorded below. There is no TypeScript, configured
lint runner or formatter in these repositories; those checks are N/A rather than
invented passes. JavaScript syntax, JSX production compilation, JSON validation and
Git whitespace checks provide the applicable static validation.

| Check | Result | Command / evidence |
| --- | --- | --- |
| Production build | PASS | `npm run build --prefix web-app/dashboard`; Vite compiled 239 modules |
| Typecheck | N/A | Plain JS/JSX project; no TS compiler/config |
| Lint | N/A | No lint script/config present |
| Syntax / JSON / whitespace | PASS | `node --check` over source JS files; Python `compileall`; parse canonical zone/Foxglove JSON; `git -C web-app diff --check` |
| Backend unit/component | PASS | `npm test --prefix web-app/backend`: 31 tests, 29 pass, 2 environment-dependent tests skipped locally; live MQTT/system tests run in Docker |
| Dashboard unit | PASS | `npm test --prefix web-app/dashboard -- --maxWorkers=1`: 20 pass |
| ROS unit | PASS | `docker compose --profile test build ros-tests`; `docker compose run --rm -T --no-deps ros-tests` from `docker/`: 26 pass |
| Python fallback integration | PASS | `./docker/test.sh`: robot 11, network 6, backend 29, dashboard 17, ROS 25 passed at that revision; final added eviction/concave regressions separately pass; persistence digest unchanged after recreation |
| Full ROS/Foxglove E2E | PASS | `./docker/test-ros.sh`: 2 live E2E cases; 17 advertised channels; actual 1517-byte lidar packet; network beacon -> pending/active/done mission; cancellation confirmed |
| Migrated simulator E2E | PASS | `./docker/test-simulation.sh`: automatic mission completion, reset to two clients, edited zone, late-client sync |
| Browser E2E | PASS | `sh /tmp/aess-browser/run.sh`: headless Chromium; real same-origin WS, Draw zone -> ROS confirmation, reset button, Canvas switch, desktop/mobile rendering; no browser runtime errors |
| Docker configuration/build/startup | PASS | Compose config validation for full ROS, standalone demo and dev; all required images built and fresh isolated services started; backend/dashboard additionally rebuilt with `docker compose build --no-cache backend dashboard` |

Failures encountered and resolved: the initial build caught a missing `fromMap` export
for the newly completed drawing tool; it was added and the production/container builds
rerun. The existing Python CLI integration asserted PoD 0.90 while the current CLI
uses 0.95; the test was corrected and the complete helper rerun successfully.
Local `python -m pytest web-app/ros2/tests -q` could not run because host pytest is not
installed; the pinned Docker pytest runner provides passing verification instead.
Builds use the existing lockfiles (`npm ci`). ROS builds used Docker's normal cache;
no claim of an uncached reinstall of ROS system packages is made.

## I. Remaining issues and practical limits

- User authentication/TLS: the inherited MQTT and operator WebSocket interfaces trust
  the internal/localhost deployment. Internet deployment needs identity/access control
  and protected transport. No new public exposure was introduced.
- Executor navigation: straight-line simulation, no Nav2/obstacle avoidance. A concave
  drawn zone can require a path around its boundary; use a convex polygon until real
  path planning exists. Writer containment is tested, including a concave polygon.
- Dispatch persistence: queue/mission state is in memory, so ROS restarts may revisit
  stored beacons. Durable exactly-once dispatch requires a separately designed mission
  journal; no durable-state guarantee is claimed.
- Dynamic polygon validation enforces vertex count, numeric bounds and area; it does
  not certify survey geometry or reject every self-intersection. Use a simple polygon.
- Runtime zone changes intentionally reset on ROS restart; permanent defaults belong
  in `shared/zone.json`. Backend restart/reconnection recovers retained scenario state.
- OpenStreetMap tiles need external network access. Offline OpenLayers grid and Canvas
  remain available; browser verification does not certify availability of tile servers.
- Existing Python replay keys use timestamp seconds and one accepted beacon per second;
  no wire-format migration was introduced. The CLI's second FIRE move currently does
  not cross its 10 m drop threshold, so it still persists one victim beacon; the ROS
  network Writer retains its existing alternating VICTIM/FIRE behavior.
- No CI pipeline or vulnerability scan was added. Production-ready Internet deployment
  and physical robot control remain outside the existing simulated system's capabilities.

The migrated system has no executable/import/build dependency on the secondary repository.
The integration changes are published as commits across the existing repositories.


## Follow-up: missing reset and overlapping map labels

The first migration limited Reset to the demo. The main operator view now always shows
**Reset map** (disabled while disconnected). ROS resets the current session and its
simulated robots, cancels its mission, and preserves durable beacon JSON. The Python
fallback cancels the active HTTP mission and confirms the same session reset. A retained
cutoff prevents historical beacon/target/event/mission replay from rebuilding the old map;
ROS also excludes those beacons from its dispatch queue. The authenticated NetworkWriter
clears pending deliveries on reset and waits for its normal interval before dropping again.

The screenshot reported as noisy logs contained historical target labels. No terminal
logging changes were made for this clarified issue. Map History defaults off: LOST targets
and beacon/event records older than three minutes are hidden on the map, with selected
beacons and mission targets kept visible. Operator panels and storage retain the data.
OpenLayers uses shared label decluttering; Canvas skips colliding labels. Beacon labels
appear for the selected beacon. Added regression tests cover 100 historical detections,
History visibility, retained cutoff filtering and storage preservation after reset.

The normal seven-service local deployment was rebuilt with its existing volumes/environment.
Main-deployment browser verification checks the enabled reset button, History toggle and
both map renderers; separate isolated tests exercise reset without changing the user's
stored operational data. Verification details for the follow-up are in the work logs under
`/tmp/aess-reset-*.log` and `/tmp/aess-main-browser.log`.


## Executor follow-up

The running Executor reported live standby telemetry but received no missions after reset:
the integrated override had `AUTO_DISPATCH=0`. The deployment now defaults to `1`, matching
the secondary implementation. Manual assignment remains available with an explicit `0`;
the manual ROS test helper sets this value deliberately. Live integrated verification
checks autonomous assignment, changing Executor position, inspection and completion.

Live result: mission `M-6851` automatically inspected beacon `WN-1791228531` and
completed. Verification observed standby -> en-route -> inspecting and 38 distinct
Executor positions before the mission `done` update. All seven services stayed healthy.
