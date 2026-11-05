import { config, dataPath } from './config';
import { Db } from './db';
import { EventBus } from './events';
import { History } from './history';
import { Notifier } from './notifications';
import { DeviceRegistry } from './registry';
import { Zigbee2MqttDriver } from './drivers/zigbee2mqtt';
import { SonoffDriver } from './drivers/sonoff';
import { TuyaDriver } from './drivers/tuya';

export interface Backend {
  db: Db;
  events: EventBus;
  history: History;
  notifier: Notifier;
  registry: DeviceRegistry;
  z2m: Zigbee2MqttDriver;
  sonoff: SonoffDriver;
  tuya: TuyaDriver;
  start(): void;
  stop(): void;
}

/** Ustawienia MQTT zapisane z panelu mają pierwszeństwo przed zmiennymi środowiskowymi. */
export interface MqttSettings {
  url?: string;
  topic?: string;
}

export function createBackend(dbPath = dataPath('simplehome.db')): Backend {
  const db = new Db(dbPath);
  const events = new EventBus();
  const history = new History(db);
  const notifier = new Notifier(db, events);
  const registry = new DeviceRegistry(db, events, history, notifier);

  const mqtt = db.getSetting<MqttSettings>('mqtt', {});
  const z2m = new Zigbee2MqttDriver(
    {
      url: mqtt.url || config.mqttUrl,
      topic: mqtt.topic || config.mqttTopic,
      username: config.mqttUser,
      password: config.mqttPassword,
    },
    registry,
    events,
  );
  const sonoff = new SonoffDriver(registry);
  const tuya = new TuyaDriver(registry);
  registry.registerDriver(z2m);
  registry.registerDriver(sonoff);
  registry.registerDriver(tuya);

  let maintenance: ReturnType<typeof setInterval> | null = null;

  return {
    db,
    events,
    history,
    notifier,
    registry,
    z2m,
    sonoff,
    tuya,
    start() {
      z2m.start();
      sonoff.start();
      tuya.start();
      history.prune(config.rawRetentionDays, config.hourlyRetentionDays);
      maintenance = setInterval(() => history.prune(config.rawRetentionDays, config.hourlyRetentionDays), 6 * 3600_000);
    },
    stop() {
      if (maintenance) clearInterval(maintenance);
      z2m.stop();
      sonoff.stop();
      tuya.stop();
      registry.flush();
    },
  };
}
