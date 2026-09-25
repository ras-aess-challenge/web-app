# The Living Map — Command Post (JS-only)

Vite+React dashboard + Node.js MQTT->WS backend. See PLAN.md and docs/ona-contract.md.

## Quickstart (local)

1. `mosquitto -c mosquitto/mosquitto.conf`
2. `cd backend && npm i && npm start` (+ `npm run sim` in a second terminal for fake ROS bridge)
3. `cd dashboard && npm i && npm run dev` -> http://localhost:5173
4. `cd backend && npm test` (13 tests: contract, gateway, sync, commands, sim shapes)

## Docker

`docker compose up --build` (mosquitto :1883, backend :4311, dashboard :5173). Copy `.env.example` to `.env` to tune.

## Production

Stop `npm run sim`. Set `MQTT_URL` to the real broker and `VITE_WS_URL` to the backend. Tune `VITE_LIVE_MS`/`VITE_STALE_MS`, `HEARTBEAT_MS`, `SNAPSHOT_CAP` without code changes.

Simulator `backend/src/sim-publisher.js` is dev-only stand-in for the ROS2->MQTT bridge.
