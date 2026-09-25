export const config = {
  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
  wsPort: Number(process.env.WS_PORT || 4311),
  topics: (process.env.MQTT_TOPICS || 'targets/#,robots/#,events/#,beacons/#,missions/#').split(','),
  cmdTopicPrefix: process.env.CMD_TOPIC_PREFIX || 'cmd/',
  heartbeatMs: Number(process.env.HEARTBEAT_MS || 15000),
  snapshotCap: Number(process.env.SNAPSHOT_CAP || 500),
};
