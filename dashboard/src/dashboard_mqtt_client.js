/**
 * Command Post <-> Outside Network MQTT client
 * ==============================================
 *
 * Drop this into the dashboard team's web app (React/plain JS).
 * Connects to the mosquitto broker running on the Ubuntu VM (the
 * "Outside Network Area") over MQTT-over-WebSockets, and wires the
 * incoming topics to whatever functions actually update the dashboard's
 * live map / event list / robot status.
 *
 * Install:
 *     npm install mqtt
 *
 * Adjust BROKER_URL below to the VM's LAN IP once it's on Bridged mode
 * (see the earlier steps) - port 9001 is the websocket listener set up
 * in mosquitto's config.
 */

import mqtt from "mqtt";

// --- CONFIG ---
const BROKER_URL = "ws://172.21.7.135:9001"
const TOPICS = {
  POSE: "livingmap/writer/pose",
  BEACONS: "livingmap/beacons",
  EVENTS: "livingmap/events",
  MISSION: "livingmap/executor/mission", // dashboard -> executor (outgoing)
  EXEC_STATUS: "livingmap/executor/status",
};

const client = mqtt.connect(BROKER_URL);

client.on("connect", () => {
  console.log("Connected to Outside Network broker");
  client.subscribe(TOPICS.POSE);
  client.subscribe(TOPICS.BEACONS);
  client.subscribe(TOPICS.EVENTS);
  client.subscribe(TOPICS.EXEC_STATUS);
});

client.on("error", (err) => {
  console.error("MQTT connection error:", err);
});

client.on("message", (topic, message) => {
  let data;
  try {
    data = JSON.parse(message.toString());
  } catch (e) {
    console.warn("Non-JSON message on", topic, message.toString());
    return;
  }

  switch (topic) {
    case TOPICS.POSE:
      // data: { x, y, gps_lat, gps_lon, t }
      updateWriterPosition(data);
      break;
    case TOPICS.BEACONS:
      // data: { id, event_type, message, x, y, gps_lat, gps_lon, t }
      addBeaconMarker(data);
      break;
    case TOPICS.EVENTS:
      // data: { event_type, details, t }
      addEventMarker(data);
      break;
    case TOPICS.EXEC_STATUS:
      // data: { status, pose, t }
      updateExecutorStatus(data);
      break;
    default:
      break;
  }
});

/**
 * Call this from the dashboard UI (e.g. when someone clicks a beacon
 * and picks "send mission to executor").
 */
export function sendMission(beaconId, targetGps, instructions) {
  client.publish(
    TOPICS.MISSION,
    JSON.stringify({
      beacon_id: beaconId,
      target_gps: targetGps,
      instructions,
    })
  );
}

// --- Replace these stubs with your real dashboard update functions ---
function updateWriterPosition(data) {
  console.log("Writer position:", data);
}
function addBeaconMarker(data) {
  console.log("Beacon:", data);
}
function addEventMarker(data) {
  console.log("Event:", data);
}
function updateExecutorStatus(data) {
  console.log("Executor status:", data);
}

export { client };