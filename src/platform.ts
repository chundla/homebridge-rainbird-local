import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { RainbirdAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { RainbirdController } from './rainbird/rainbird.js';

export interface RainbirdControllerConfig {
  configDevice?: string;
  name?: string;
  host: string;
  password: string;
  expose?: 'controller' | 'zones';
  zoneNames?: string[];
  ignoredZones?: number[];
  defaultDurationMinutes?: number;
  refreshIntervalSeconds?: number;
  programSwitches?: boolean;
  programSwitchList?: number[];
  zoneSwitches?: boolean;
  zoneValves?: boolean;
  logScheduleOnStart?: boolean;
  debug?: boolean;
}

export interface RainbirdPlatformConfig extends PlatformConfig, RainbirdControllerConfig {
  devices?: RainbirdControllerConfig[];
  additionalControllers?: RainbirdControllerConfig[];
  controllers?: RainbirdControllerConfig[];
}

type ControllerRuntime = {
  key: string;
  name: string;
  host: string;
  exposeMode: 'controller' | 'zones';
  zoneNames: string[];
  ignoredZones: Set<number>;
  defaultDuration: number;
  refreshIntervalSeconds: number;
  programSwitches: number[];
  zoneSwitches: boolean;
  zoneValves: boolean;
  logScheduleOnStart: boolean;
  debug: boolean;
  controller: RainbirdController;
  serial: string;
  modelName: string;
  zones: number[];
  refreshTick: number;
  refreshInProgress: boolean;
};

export class RainbirdPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  private readonly handlers: Map<string, RainbirdAccessory> = new Map();
  private readonly controllers: ControllerRuntime[] = [];
  private readonly refreshTimers: NodeJS.Timeout[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: RainbirdPlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    const configured = this.getConfiguredControllers();
    if (configured.length === 0) {
      this.log.warn('Rain Bird platform missing host/password (or empty controllers list).');
      return;
    }

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices().catch((err) => this.log.error('Discovery failed', err));
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    accessory.context.active = false;
    this.accessories.set(accessory.UUID, accessory);
  }

  private getConfiguredControllers(): RainbirdControllerConfig[] {
    const result: RainbirdControllerConfig[] = [];

    if (Array.isArray(this.config.devices) && this.config.devices.length > 0) {
      for (const entry of this.config.devices) {
        if (!entry?.host || !entry?.password) {
          continue;
        }
        result.push(entry);
      }
      return result;
    }

    if (this.config.host && this.config.password) {
      result.push(this.config);
    }

    const extras = Array.isArray(this.config.additionalControllers)
      ? this.config.additionalControllers
      : (Array.isArray(this.config.controllers) ? this.config.controllers : []);

    for (const entry of extras) {
      if (!entry?.host || !entry?.password) {
        continue;
      }
      result.push(entry);
    }

    return result;
  }

  private toProgramSwitchList(enabled: boolean | undefined, list: number[] | undefined): number[] {
    const normalizedList = [...new Set((list ?? []).map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 1 && v <= 4))]
      .sort((a, b) => a - b);
    if (normalizedList.length > 0) {
      return normalizedList;
    }
    return enabled ? [1, 2, 3, 4] : [];
  }

  private async discoverDevices(): Promise<void> {
    const configured = this.getConfiguredControllers();
    this.controllers.length = 0;

    for (let i = 0; i < configured.length; i++) {
      const entry = configured[i];
      const host = String(entry.host ?? '').trim();
      const password = String(entry.password ?? '').trim();
      if (!host || !password) {
        this.log.warn(`Skipping controller at index ${i}: missing host/password`);
        continue;
      }

      const key = `${host}#${i}`;
      const runtime: ControllerRuntime = {
        key,
        name: entry.configDevice?.trim() || entry.name?.trim() || this.config.name || `Rain Bird ${i + 1}`,
        host,
        exposeMode: entry.expose ?? this.config.expose ?? 'controller',
        zoneNames: entry.zoneNames ?? this.config.zoneNames ?? [],
        ignoredZones: new Set((entry.ignoredZones ?? this.config.ignoredZones ?? []).map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)),
        defaultDuration: entry.defaultDurationMinutes ?? this.config.defaultDurationMinutes ?? 10,
        refreshIntervalSeconds: entry.refreshIntervalSeconds ?? this.config.refreshIntervalSeconds ?? 30,
        programSwitches: this.toProgramSwitchList(
          entry.programSwitches ?? this.config.programSwitches,
          entry.programSwitchList ?? this.config.programSwitchList,
        ),
        zoneSwitches: entry.zoneSwitches ?? this.config.zoneSwitches ?? true,
        zoneValves: entry.zoneValves ?? this.config.zoneValves ?? true,
        logScheduleOnStart: entry.logScheduleOnStart ?? this.config.logScheduleOnStart ?? false,
        debug: this.config.debug ?? false,
        controller: await RainbirdController.create(host, password, this.log, Boolean(this.config.debug)),
        serial: host,
        modelName: 'Rain Bird Controller',
        zones: [],
        refreshTick: 0,
        refreshInProgress: false,
      };

      try {
        const model = await runtime.controller.getModelAndVersion();
        runtime.modelName = model.modelInfo.name || model.modelId;
      } catch {
        runtime.modelName = 'Rain Bird Controller';
      }

      try {
        runtime.serial = await runtime.controller.getSerialNumber();
      } catch {
        runtime.serial = runtime.host;
      }

      const stations = await runtime.controller.getAvailableStations();
      runtime.zones = Array.from(stations.activeSet)
        .filter((zone) => !runtime.ignoredZones.has(zone))
        .sort((a, b) => a - b);

      this.log.info(
        `[${runtime.name}] Connected to ${runtime.modelName} (${runtime.serial}). `
        + `Detected ${runtime.zones.length} active zone(s) after filtering.`,
      );
      this.log.info(
        `[${runtime.name}] Expose mode: ${runtime.exposeMode}. Zone valves=${runtime.zoneValves}, `
        + `zone switches=${runtime.zoneSwitches}, program switches=${runtime.programSwitches.join(',') || 'none'}`,
      );
      if (runtime.ignoredZones.size > 0) {
        this.log.info(`[${runtime.name}] Ignoring zones: ${[...runtime.ignoredZones].sort((a, b) => a - b).join(',')}`);
      }

      if (runtime.logScheduleOnStart || runtime.debug) {
        try {
          const scheduleSnapshot = await runtime.controller.getSchedule();
          this.log.info(
            `[${runtime.name}] Schedule read succeeded (${scheduleSnapshot.programInfo.length} program definition(s), `
            + `${scheduleSnapshot.durations.length} zone duration set(s)).`,
          );
          this.log.debug(`[${runtime.name}] Schedule snapshot:`, JSON.stringify(scheduleSnapshot));
        } catch (err) {
          this.log.warn(`[${runtime.name}] Failed to load schedule:`, err);
        }
      }

      this.controllers.push(runtime);

      if (runtime.exposeMode === 'controller') {
        this.registerControllerAccessory(runtime);
      } else {
        this.registerZoneAccessories(runtime);
      }
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!accessory.context?.active) {
        this.log.info('Removing stale accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
        this.handlers.delete(uuid);
      }
    }

    for (const timer of this.refreshTimers) {
      clearInterval(timer);
    }
    this.refreshTimers.length = 0;

    for (const runtime of this.controllers) {
      const timer = setInterval(() => {
        this.refreshStatus(runtime).catch((err) => this.log.warn(`[${runtime.name}] Refresh failed:`, err));
      }, runtime.refreshIntervalSeconds * 1000);
      timer.unref();
      this.refreshTimers.push(timer);
      await this.refreshStatus(runtime);
    }
  }

  private registerControllerAccessory(runtime: ControllerRuntime): RainbirdAccessory | undefined {
    const uuid = this.api.hap.uuid.generate(`${runtime.key}:${runtime.serial}-controller`);
    const existing = this.accessories.get(uuid);

    const accessory = existing ?? new this.api.platformAccessory(runtime.name, uuid);
    accessory.context.type = 'controller';
    accessory.context.controllerKey = runtime.key;
    accessory.context.serial = runtime.serial;
    accessory.context.zones = runtime.zones;
    accessory.context.zoneNames = runtime.zoneNames;
    accessory.context.defaultDuration = runtime.defaultDuration;
    accessory.context.programSwitches = runtime.programSwitches;
    accessory.context.zoneSwitches = runtime.zoneSwitches;
    accessory.context.zoneValves = runtime.zoneValves;
    accessory.context.model = runtime.modelName;
    accessory.context.active = true;

    const handler = new RainbirdAccessory(this, accessory, runtime.controller, this.log);
    this.handlers.set(uuid, handler);

    if (!existing) {
      this.log.info(`[${runtime.name}] Registering controller accessory: ${accessory.displayName}`);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }

    return handler;
  }

  private registerZoneAccessories(runtime: ControllerRuntime): void {
    for (const zone of runtime.zones) {
      const name = runtime.zoneNames[zone - 1] ?? `Zone ${zone}`;
      const uuid = this.api.hap.uuid.generate(`${runtime.key}:${runtime.serial}-zone-${zone}`);
      const existing = this.accessories.get(uuid);
      const accessory = existing ?? new this.api.platformAccessory(`${runtime.name} ${name}`, uuid);
      accessory.context.type = 'zone';
      accessory.context.controllerKey = runtime.key;
      accessory.context.zone = zone;
      accessory.context.serial = runtime.serial;
      accessory.context.zoneName = name;
      accessory.context.defaultDuration = runtime.defaultDuration;
      accessory.context.model = runtime.modelName;
      accessory.context.active = true;

      const handler = new RainbirdAccessory(this, accessory, runtime.controller, this.log);
      this.handlers.set(uuid, handler);

      if (!existing) {
        this.log.info(`[${runtime.name}] Registering zone accessory: ${name}`);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      }
    }
  }

  async refreshStatus(runtime: ControllerRuntime): Promise<void> {
    if (runtime.refreshInProgress) {
      this.log.debug(`[${runtime.name}] Skipping refresh tick because a previous refresh is still running.`);
      return;
    }

    runtime.refreshInProgress = true;
    try {
      const activeStationsRaw = await runtime.controller.getActiveStations();
      const activeStations = activeStationsRaw.filter((zone) => !runtime.ignoredZones.has(zone));
      const activeSet = new Set(activeStations);

      let rainSensorActive: boolean | undefined;
      let rainDelayDays: number | undefined;
      try {
        rainSensorActive = await runtime.controller.getRainSensorState();
      } catch (err) {
        this.log.debug(`[${runtime.name}] Rain sensor state fetch failed:`, err);
      }
      try {
        rainDelayDays = await runtime.controller.getRainDelay();
      } catch (err) {
        this.log.debug(`[${runtime.name}] Rain delay fetch failed:`, err);
      }

      runtime.refreshTick += 1;
      const activeSummary = activeStations.length > 0 ? activeStations.join(',') : 'none';
      this.log.debug(
        `[${runtime.name}] Refresh #${runtime.refreshTick}: active zones=${activeSummary}, `
        + `rainSensor=${String(rainSensorActive)}, rainDelayDays=${String(rainDelayDays)}`,
      );
      if (runtime.refreshTick % 20 === 0) {
        this.log.info(
          `[${runtime.name}] Refresh heartbeat: active zones=${activeSummary}, rain delay=${rainDelayDays ?? 0} day(s), `
          + `rain sensor=${rainSensorActive ? 'wet' : 'dry'}`,
        );
      }

      for (const [uuid, accessory] of this.accessories.entries()) {
        if (accessory.context?.controllerKey !== runtime.key) {
          continue;
        }
        const handler = this.handlers.get(uuid) ?? RainbirdAccessory.getHandler(this, accessory);
        if (!handler) {
          continue;
        }
        this.handlers.set(uuid, handler);
        handler.updateStatus(activeSet, rainSensorActive, rainDelayDays);
      }
    } finally {
      runtime.refreshInProgress = false;
    }
  }
}
