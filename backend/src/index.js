import { start, wireCommands } from './server.js';
import { config } from './config.js';

const { client } = start();
wireCommands(client);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => client.end(false, () => process.exit(0)));
}
console.log(`[backend] MQTT_URL=${config.mqttUrl} TOPICS=${config.topics.join(' ')}`);
