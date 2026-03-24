import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { RainbirdAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { RainbirdController } from './rainbird/rainbird.js';

export interface RainbirdPlatformConfig extends PlatformConfig {
  host: string;
  password: string;
  expose?: 'controller' | 'zones';
  zoneNames?: string[];
  defaultDurationMinutes?: number;
  refreshIntervalSeconds?: number;
  programSwitches?: boolean;
  zoneSwitches?: boolean;
  zoneValves?: boolean;
  logScheduleOnStart?: boolean;
  debug?: boolean;
}

export class RainbirdPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  private readonly handlers: Map<string, RainbirdAccessory> = new Map();

  private controller?: RainbirdController;
  private refreshTimer?: NodeJS.Timeout;
  private zones: number[] = [];
  private serial = '';
  private modelName = 'Rain Bird Controller';
  private refreshTick = 0;
  private refreshInProgress = false;

  constructor(
    public readonly log: Logging,
    public readonly config: RainbirdPlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    if (!config?.host || !config?.password) {
      this.log.warn('Rain Bird platform missing host/password.');
      return;
    }

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices().catch((err) => this.log.error('Discovery failed', err));
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  private get zoneNames(): string[] {
    return this.config.zoneNames ?? [];
  }

  private get defaultDuration(): number {
    return this.config.defaultDurationMinutes ?? 10;
  }

  private get refreshInterval(): number {
    return this.config.refreshIntervalSeconds ?? 30;
  }

  private get exposeMode(): 'controller' | 'zones' {
    return this.config.expose ?? 'controller';
  }

  private async discoverDevices(): Promise<void> {
    this.log.info('Connecting to Rain Bird controller...');
    const host = String(this.config.host).trim();
    const password = String(this.config.password).trim();
    this.controller = await RainbirdController.create(host, password, this.log, Boolean(this.config.debug));

    try {
      const model = await this.controller.getModelAndVersion();
      this.modelName = model.modelInfo.name || model.modelId;
    } catch {
      this.modelName = 'Rain Bird Controller';
    }

    try {
      this.serial = await this.controller.getSerialNumber();
    } catch {
      this.serial = this.config.host;
    }

    const stations = await this.controller.getAvailableStations();
    this.zones = Array.from(stations.activeSet).sort((a, b) => a - b);

    this.log.info(`Connected to ${this.modelName} (${this.serial}). Detected ${this.zones.length} active zone(s).`);
    this.log.info(
      `Expose mode: ${this.exposeMode}. Zone valves=${this.config.zoneValves !== false}, `
      + `zone switches=${this.config.zoneSwitches !== false}, `
      + `program switches=${Boolean(this.config.programSwitches)}`,
    );

    if (this.config.logScheduleOnStart || this.config.debug) {
      try {
        const scheduleSnapshot = await this.controller.getSchedule();
        this.log.info(
          `Schedule read succeeded (${scheduleSnapshot.programInfo.length} program definition(s), `
          + `${scheduleSnapshot.durations.length} zone duration set(s)).`,
        );
        this.log.debug('Schedule snapshot:', JSON.stringify(scheduleSnapshot));
      } catch (err) {
        this.log.warn('Failed to load schedule:', err);
      }
    }

    if (this.exposeMode === 'controller') {
      this.registerControllerAccessory();
    } else {
      this.registerZoneAccessories();
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!accessory.context?.active) {
        this.log.info('Removing stale accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
        this.handlers.delete(uuid);
      }
    }

    this.refreshTimer?.unref();
    this.refreshTimer = setInterval(() => {
      this.refreshStatus().catch((err) => this.log.warn('Refresh failed:', err));
    }, this.refreshInterval * 1000);

    await this.refreshStatus();
  }

  private registerControllerAccessory(): RainbirdAccessory | undefined {
    const uuid = this.api.hap.uuid.generate(`${this.serial}-controller`);
    const existing = this.accessories.get(uuid);

    const accessory = existing ?? new this.api.platformAccessory(this.config.name ?? 'Rain Bird', uuid);
    accessory.context.type = 'controller';
    accessory.context.serial = this.serial;
    accessory.context.zones = this.zones;
    accessory.context.zoneNames = this.zoneNames;
    accessory.context.defaultDuration = this.defaultDuration;
    accessory.context.programSwitches = Boolean(this.config.programSwitches);
    accessory.context.zoneSwitches = this.config.zoneSwitches !== false;
    accessory.context.zoneValves = this.config.zoneValves !== false;
    accessory.context.model = this.modelName;
    accessory.context.active = true;

    const handler = new RainbirdAccessory(this, accessory, this.controller!, this.log);
    this.handlers.set(uuid, handler);

    if (!existing) {
      this.log.info(`Registering controller accessory: ${accessory.displayName}`);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.set(uuid, accessory);
    }

    return handler;
  }

  private registerZoneAccessories(): void {
    for (const zone of this.zones) {
      const name = this.zoneNames[zone - 1] ?? `Zone ${zone}`;
      const uuid = this.api.hap.uuid.generate(`${this.serial}-zone-${zone}`);
      const existing = this.accessories.get(uuid);
      const accessory = existing ?? new this.api.platformAccessory(name, uuid);
      accessory.context.type = 'zone';
      accessory.context.zone = zone;
      accessory.context.serial = this.serial;
      accessory.context.zoneName = name;
      accessory.context.defaultDuration = this.defaultDuration;
      accessory.context.model = this.modelName;
      accessory.context.active = true;

      const handler = new RainbirdAccessory(this, accessory, this.controller!, this.log);
      this.handlers.set(uuid, handler);

      if (!existing) {
        this.log.info(`Registering zone accessory: ${name}`);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      }
    }
  }

  async refreshStatus(): Promise<void> {
    if (!this.controller) {
      return;
    }
    if (this.refreshInProgress) {
      this.log.debug('Skipping refresh tick because a previous refresh is still running.');
      return;
    }
    this.refreshInProgress = true;
    try {
      const activeStations = await this.controller.getActiveStations();
      const activeSet = new Set(activeStations);

      let rainSensorActive: boolean | undefined;
      let rainDelayDays: number | undefined;
      try {
        rainSensorActive = await this.controller.getRainSensorState();
      } catch (err) {
        this.log.debug('Rain sensor state fetch failed:', err);
      }
      try {
        rainDelayDays = await this.controller.getRainDelay();
      } catch (err) {
        this.log.debug('Rain delay fetch failed:', err);
      }

      this.refreshTick += 1;
      const activeSummary = activeStations.length > 0 ? activeStations.join(',') : 'none';
      this.log.debug(
        `Refresh #${this.refreshTick}: active zones=${activeSummary}, `
        + `rainSensor=${String(rainSensorActive)}, rainDelayDays=${String(rainDelayDays)}`,
      );
      if (this.refreshTick % 20 === 0) {
        this.log.info(
          `Refresh heartbeat: active zones=${activeSummary}, rain delay=${rainDelayDays ?? 0} day(s), `
          + `rain sensor=${rainSensorActive ? 'wet' : 'dry'}`,
        );
      }

      for (const [uuid, accessory] of this.accessories.entries()) {
        const handler = this.handlers.get(uuid) ?? RainbirdAccessory.getHandler(this, accessory);
        if (!handler) {
          continue;
        }
        this.handlers.set(uuid, handler);
        handler.updateStatus(activeSet, rainSensorActive, rainDelayDays);
      }
    } finally {
      this.refreshInProgress = false;
    }
  }
}
