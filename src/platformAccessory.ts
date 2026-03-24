import type { Characteristic, CharacteristicValue, Logging, PlatformAccessory, Service } from 'homebridge';

import type { RainbirdPlatform } from './platform.js';
import type { RainbirdController } from './rainbird/rainbird.js';

type ProgramSwitch = {
  service: Service;
};

type ZoneSwitch = {
  zone: number;
  service: Service;
};

type ZoneValve = {
  zone: number;
  service: Service;
  durationSeconds: number;
};



type WithUUID<T> = T & { UUID: string };
type CharacteristicCtor = WithUUID<new () => Characteristic>;

type CustomTypes = {
  RainDelayCharacteristic: CharacteristicCtor;
};

export class RainbirdAccessory {
  private static handlers = new WeakMap<PlatformAccessory, RainbirdAccessory>();
  private static customTypes?: CustomTypes;

  static getHandler(platform: RainbirdPlatform, accessory: PlatformAccessory): RainbirdAccessory | undefined {
    void platform;
    return RainbirdAccessory.handlers.get(accessory);
  }

  private static getCustomTypes(platform: RainbirdPlatform): CustomTypes {
    if (RainbirdAccessory.customTypes) {
      return RainbirdAccessory.customTypes;
    }

    const hap = platform.api.hap;

    class RainDelayCharacteristic extends hap.Characteristic {
      static readonly UUID = '3b1992a8-1c6f-4c85-9fbf-63d4e76c2a0a';
      constructor() {
        super('Rain Delay', RainDelayCharacteristic.UUID, {
          format: hap.Formats.UINT8,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.PAIRED_WRITE, hap.Perms.NOTIFY],
        });
        this.setProps({
          format: hap.Formats.UINT8,
          unit: 'days',
          minValue: 0,
          maxValue: 14,
          minStep: 1,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.PAIRED_WRITE, hap.Perms.NOTIFY],
        });
        this.value = this.getDefaultValue();
      }
    }

    RainbirdAccessory.customTypes = {
      RainDelayCharacteristic: RainDelayCharacteristic as unknown as CharacteristicCtor,
    };

    return RainbirdAccessory.customTypes;
  }

  private readonly infoService: Service;
  private irrigationService?: Service;
  private valveService?: Service;
  private rainSensorService?: Service;
  private programSwitches: ProgramSwitch[] = [];
  private zoneSwitches: ZoneSwitch[] = [];
  private zoneValves: ZoneValve[] = [];

  private isActive = false;
  private remainingDuration = 0;
  private activeZones = new Set<number>();
  private rainDelayDays = 0;
  private rainSensorActive = false;

  private readonly zone?: number;
  private readonly zones: number[];
  private readonly defaultDuration: number;

  constructor(
    private readonly platform: RainbirdPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly controller: RainbirdController,
    private readonly log: Logging,
  ) {
    this.zone = this.accessory.context.zone;
    this.zones = this.accessory.context.zones ?? [];
    this.defaultDuration = this.accessory.context.defaultDuration ?? 10;

    this.infoService = this.accessory.getService(this.platform.Service.AccessoryInformation)
      || this.accessory.addService(this.platform.Service.AccessoryInformation);

    this.setupInfoService();

    if (this.accessory.context.type === 'controller') {
      this.setupController();
    } else {
      this.setupZone();
    }

    RainbirdAccessory.handlers.set(this.accessory, this);
  }

  updateStatus(activeStations: Set<number>, rainSensorActive?: boolean, rainDelayDays?: number): void {
    this.activeZones = new Set(activeStations);
    if (typeof rainSensorActive === 'boolean') {
      this.rainSensorActive = rainSensorActive;
    }
    if (typeof rainDelayDays === 'number') {
      this.rainDelayDays = rainDelayDays;
    }

    if (this.accessory.context.type === 'controller') {
      this.updateControllerState(activeStations.size > 0, activeStations, this.rainSensorActive, this.rainDelayDays);
      return;
    }

    this.updateZoneState(this.zone ?? 0, activeStations);
  }

  updateControllerState(irrigationOn: boolean, activeStations: Set<number>, rainSensorActive?: boolean, rainDelayDays?: number): void {
    if (!this.irrigationService) {
      return;
    }

    this.isActive = irrigationOn;
    this.activeZones = new Set(activeStations);

    this.irrigationService.updateCharacteristic(this.platform.Characteristic.Active, irrigationOn
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE);

    this.irrigationService.updateCharacteristic(this.platform.Characteristic.InUse, irrigationOn
      ? this.platform.Characteristic.InUse.IN_USE
      : this.platform.Characteristic.InUse.NOT_IN_USE);

    if (typeof rainDelayDays === 'number') {
      this.rainDelayDays = rainDelayDays;
      const custom = RainbirdAccessory.getCustomTypes(this.platform);
      const rainDelayChar = this.irrigationService.getCharacteristic(custom.RainDelayCharacteristic as unknown as CharacteristicCtor);
      rainDelayChar?.updateValue(rainDelayDays);
    }

    if (this.rainSensorService && typeof rainSensorActive === 'boolean') {
      this.rainSensorService.updateCharacteristic(
        this.platform.Characteristic.LeakDetected,
        rainSensorActive
          ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
          : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
      );
    }

    for (const programSwitch of this.programSwitches) {
      programSwitch.service.updateCharacteristic(this.platform.Characteristic.On, false);
    }

    for (const zoneSwitch of this.zoneSwitches) {
      zoneSwitch.service.updateCharacteristic(this.platform.Characteristic.On, activeStations.has(zoneSwitch.zone));
    }

    for (const zoneValve of this.zoneValves) {
      const active = activeStations.has(zoneValve.zone);
      zoneValve.service.updateCharacteristic(this.platform.Characteristic.Active, active
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE);
      zoneValve.service.updateCharacteristic(this.platform.Characteristic.InUse, active
        ? this.platform.Characteristic.InUse.IN_USE
        : this.platform.Characteristic.InUse.NOT_IN_USE);
      zoneValve.service.updateCharacteristic(this.platform.Characteristic.RemainingDuration, active ? zoneValve.durationSeconds : 0);
    }
  }

  updateZoneState(zone: number, activeStations: Set<number>): void {
    if (!this.valveService || zone < 1) {
      return;
    }

    const active = activeStations.has(zone);
    this.isActive = active;
    this.remainingDuration = active ? this.defaultDuration * 60 : 0;

    this.valveService.updateCharacteristic(this.platform.Characteristic.Active, active
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE);

    this.valveService.updateCharacteristic(this.platform.Characteristic.InUse, active
      ? this.platform.Characteristic.InUse.IN_USE
      : this.platform.Characteristic.InUse.NOT_IN_USE);

    this.valveService.updateCharacteristic(this.platform.Characteristic.RemainingDuration, this.remainingDuration);
  }

  private setupInfoService(): void {
    this.infoService
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Rain Bird')
      .setCharacteristic(this.platform.Characteristic.Model, this.accessory.context.model ?? 'Rain Bird Controller')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.serial ?? 'Unknown');
  }

  private setupController(): void {
    this.irrigationService = this.accessory.getService(this.platform.Service.IrrigationSystem)
      || this.accessory.addService(this.platform.Service.IrrigationSystem);

    this.irrigationService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);

    const programMode = this.platform.Characteristic.ProgramMode;
    const programModeValue = (programMode?.PROGRAM_SCHEDULED_MANUAL_MODE
      ?? programMode?.PROGRAM_SCHEDULED
      ?? programMode?.NO_PROGRAM_SCHEDULED
      ?? 0) as number;
    if (Number.isFinite(programModeValue)) {
      this.irrigationService.setCharacteristic(this.platform.Characteristic.ProgramMode, programModeValue);
    }

    this.irrigationService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.getActive())
      .onSet((value) => this.setControllerActive(value));

    this.irrigationService.getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(() => this.getInUse());

    const custom = RainbirdAccessory.getCustomTypes(this.platform);
    const RainDelayCharacteristic = custom.RainDelayCharacteristic;
    const RainDelayCharacteristicClass = RainDelayCharacteristic as unknown as WithUUID<typeof Characteristic>;
    if (!this.irrigationService.testCharacteristic(RainDelayCharacteristicClass)) {
      this.irrigationService.addCharacteristic(RainDelayCharacteristicClass);
    }
    this.irrigationService.getCharacteristic(RainDelayCharacteristic as unknown as CharacteristicCtor)
      .onGet(() => this.rainDelayDays)
      .onSet((value) => this.setRainDelay(value));

    this.rainSensorService = this.accessory.getService('Rain Sensor')
      || this.accessory.addService(this.platform.Service.LeakSensor, 'Rain Sensor', 'rain-sensor');

    this.rainSensorService.getCharacteristic(this.platform.Characteristic.LeakDetected)
      .onGet(() => (this.rainSensorActive
        ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
        : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED));

    const shouldExposeSwitches = Boolean(this.accessory.context.programSwitches);
    if (shouldExposeSwitches) {
      const programs = [1, 2, 3, 4];
      for (const program of programs) {
        const name = `Program ${program}`;
        const subtype = `program-${program}`;
        const service = this.accessory.getServiceById(this.platform.Service.Switch, subtype)
          || this.accessory.addService(this.platform.Service.Switch, name, subtype);

        service.getCharacteristic(this.platform.Characteristic.On)
          .onGet(() => false)
          .onSet(async (value) => this.setProgramSwitch(program, value));

        this.programSwitches.push({ service });
      }
    }

    const shouldExposeZoneValves = this.accessory.context.zoneValves !== false;
    const shouldExposeZoneSwitches = (this.accessory.context.zoneSwitches !== false) && !shouldExposeZoneValves;
    if (shouldExposeZoneSwitches) {
      for (const zone of this.zones) {
        const name = this.accessory.context.zoneNames?.[zone - 1] ?? `Zone ${zone}`;
        const subtype = `zone-switch-${zone}`;
        const service = this.accessory.getServiceById(this.platform.Service.Switch, subtype)
          || this.accessory.addService(this.platform.Service.Switch, name, subtype);

        service.getCharacteristic(this.platform.Characteristic.On)
          .onGet(() => this.activeZones.has(zone))
          .onSet(async (value) => this.setZoneSwitch(zone, value));

        this.zoneSwitches.push({ zone, service });
      }
    }

    if (shouldExposeZoneValves) {
      for (const zone of this.zones) {
        const name = `${this.accessory.context.zoneNames?.[zone - 1] ?? `Zone ${zone}`} Valve`;
        const subtype = `zone-valve-${zone}`;
        const service = this.accessory.getServiceById(this.platform.Service.Valve, subtype)
          || this.accessory.addService(this.platform.Service.Valve, name, subtype);

        service
          .setCharacteristic(this.platform.Characteristic.Name, name)
          .setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.IRRIGATION)
          .setCharacteristic(this.platform.Characteristic.SetDuration, this.defaultDuration * 60);

        service.getCharacteristic(this.platform.Characteristic.Active)
          .onGet(() => (this.activeZones.has(zone)
            ? this.platform.Characteristic.Active.ACTIVE
            : this.platform.Characteristic.Active.INACTIVE))
          .onSet(async (value) => this.setZoneValveActive(zone, value));

        service.getCharacteristic(this.platform.Characteristic.InUse)
          .onGet(() => (this.activeZones.has(zone)
            ? this.platform.Characteristic.InUse.IN_USE
            : this.platform.Characteristic.InUse.NOT_IN_USE));

        service.getCharacteristic(this.platform.Characteristic.RemainingDuration)
          .onGet(() => (this.activeZones.has(zone) ? (this.zoneValves.find((v) => v.zone === zone)?.durationSeconds ?? this.defaultDuration * 60) : 0));

        service.getCharacteristic(this.platform.Characteristic.SetDuration)
          .onSet((value) => this.setZoneValveDuration(zone, value));

        this.zoneValves.push({ zone, service, durationSeconds: this.defaultDuration * 60 });
      }
    }

    this.pruneControllerServices(shouldExposeSwitches, shouldExposeZoneSwitches, shouldExposeZoneValves);
  }

  private pruneControllerServices(programSwitches: boolean, zoneSwitches: boolean, zoneValves: boolean): void {
    for (const service of [...this.accessory.services]) {
      const subtype = service.subtype ?? '';
      if (subtype.startsWith('program-') && !programSwitches) {
        this.accessory.removeService(service);
      }
      if (subtype.startsWith('zone-switch-') && !zoneSwitches) {
        this.accessory.removeService(service);
      }
      if (subtype.startsWith('zone-valve-') && !zoneValves) {
        this.accessory.removeService(service);
      }
      if (subtype === 'schedule') {
        this.accessory.removeService(service);
      }
    }
  }

  private setupZone(): void {
    const zone = this.zone ?? 0;
    this.valveService = this.accessory.getService(this.platform.Service.Valve)
      || this.accessory.addService(this.platform.Service.Valve);

    this.valveService
      .setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName)
      .setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.IRRIGATION)
      .setCharacteristic(this.platform.Characteristic.SetDuration, this.defaultDuration * 60);

    this.valveService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.getActive())
      .onSet((value) => this.setZoneActive(zone, value));

    this.valveService.getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(() => this.getInUse());

    this.valveService.getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .onGet(() => this.getRemainingDuration());

    this.valveService.getCharacteristic(this.platform.Characteristic.SetDuration)
      .onSet((value) => {
        this.remainingDuration = Number(value);
      });
  }

  private async setControllerActive(value: CharacteristicValue): Promise<void> {
    const active = Number(value) === this.platform.Characteristic.Active.ACTIVE;
    if (!active) {
      this.log.info('Stopping irrigation from controller tile');
      await this.controller.stopIrrigation();
      this.isActive = false;
      this.remainingDuration = 0;
      this.activeZones.clear();
      return;
    }

    if (this.zones.length > 0) {
      const zone = this.zones[0];
      this.log.info(`Starting irrigation from controller tile (Zone ${zone}, ${this.defaultDuration} min)`);
      await this.controller.startZone(zone, this.defaultDuration);
      this.isActive = true;
      this.remainingDuration = this.defaultDuration * 60;
      this.activeZones = new Set([zone]);
      return;
    }

    this.log.warn('Controller tile requested start, but no active zones were detected');
  }

  private async setZoneActive(zone: number, value: CharacteristicValue): Promise<void> {
    const active = Number(value) === this.platform.Characteristic.Active.ACTIVE;
    if (!active) {
      this.log.info(`Stopping irrigation from zone valve (${zone})`);
      await this.controller.stopIrrigation();
      this.isActive = false;
      this.remainingDuration = 0;
      this.activeZones.clear();
      return;
    }

    const durationSeconds = this.remainingDuration > 0 ? this.remainingDuration : this.defaultDuration * 60;
    this.log.info(`Starting zone ${zone} for ${Math.max(1, Math.ceil(durationSeconds / 60))} minute(s)`);
    await this.controller.startZone(zone, Math.max(1, Math.ceil(durationSeconds / 60)));
    this.isActive = true;
    this.remainingDuration = durationSeconds;
    this.activeZones = new Set([zone]);
  }

  private async setZoneSwitch(zone: number, value: CharacteristicValue): Promise<void> {
    const active = Boolean(value);
    if (!active) {
      this.log.info(`Stopping irrigation from zone switch (${zone})`);
      await this.controller.stopIrrigation();
      return;
    }
    this.log.info(`Starting zone ${zone} from zone switch for ${this.defaultDuration} minute(s)`);
    await this.controller.startZone(zone, this.defaultDuration);
  }

  private async setProgramSwitch(program: number, value: CharacteristicValue): Promise<void> {
    if (!value) {
      return;
    }
    this.log.info(`Starting Rain Bird program ${program}`);
    await this.controller.startProgram(program);
    this.log.debug(`Started Rain Bird program ${program}`);
  }

  private setZoneValveDuration(zone: number, value: CharacteristicValue): void {
    const found = this.zoneValves.find((v) => v.zone === zone);
    if (!found) {
      return;
    }
    found.durationSeconds = Math.max(60, Number(value) || this.defaultDuration * 60);
    this.log.debug(`Updated zone ${zone} valve duration to ${found.durationSeconds} second(s)`);
  }

  private async setZoneValveActive(zone: number, value: CharacteristicValue): Promise<void> {
    const active = Number(value) === this.platform.Characteristic.Active.ACTIVE;
    if (!active) {
      this.log.info(`Stopping irrigation from controller-zone valve (${zone})`);
      await this.controller.stopIrrigation();
      return;
    }
    const durationSeconds = this.zoneValves.find((v) => v.zone === zone)?.durationSeconds ?? this.defaultDuration * 60;
    this.log.info(`Starting controller-zone valve ${zone} for ${Math.max(1, Math.ceil(durationSeconds / 60))} minute(s)`);
    await this.controller.startZone(zone, Math.max(1, Math.ceil(durationSeconds / 60)));
  }

  private async setRainDelay(value: CharacteristicValue): Promise<void> {
    const days = Math.max(0, Math.min(14, Number(value)));
    this.log.info(`Setting rain delay to ${days} day(s)`);
    await this.controller.setRainDelay(days);
    this.rainDelayDays = days;
  }

  private getActive(): number {
    return this.isActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
  }

  private getInUse(): number {
    return this.isActive ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE;
  }

  private getRemainingDuration(): number {
    return this.remainingDuration;
  }
}
