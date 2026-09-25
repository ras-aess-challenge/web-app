import { start, wireCommands } from './server.js';
import { config } from './config.js';

const { client } = start();
wireCommands(client);

process.on('SIGINT', () => { try { client.end(); } catch {} process.exit(0); });
console.log(`[backend] MQTT_URL=${config.mqttUrl} TOPICS=${config.topics.join(' ')}`);
