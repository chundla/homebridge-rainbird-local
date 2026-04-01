import type { Characteristic, CharacteristicValue, Logging, PlatformAccessory, Service } from 'homebridge';

import type { RainbirdPlatform } from './platform.js';
import type { RainbirdController } from './rainbird/rainbird.js';

type ProgramSwitch = {
  service: Service;
};

type ProgramBudgetService = {
  program: number;
  service?: Service;
  uiService?: Service;
  uiType?: 'fan' | 'light' | 'switch';
  budget: number;
  runtimeMinutes: number;
  lastBudgetUpdate?: number;
  firstStartMinutes: number;
  daysMask: number;
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

type ServiceCtor = WithUUID<typeof Service>;

type CustomTypes = {
  RainDelayCharacteristic: CharacteristicCtor;
  QueueNextZoneCharacteristic: CharacteristicCtor;
  QueueRemainingRuntimeCharacteristic: CharacteristicCtor;
  CurrentZoneCharacteristic: CharacteristicCtor;
  CurrentRemainingRuntimeCharacteristic: CharacteristicCtor;
  QueueSummaryCharacteristic: CharacteristicCtor;
  ProgramBudgetCharacteristic: CharacteristicCtor;
  ProgramRuntimeMinutesCharacteristic: CharacteristicCtor;
  ProgramFirstStartCharacteristic: CharacteristicCtor;
  ProgramDaysMaskCharacteristic: CharacteristicCtor;
  QueueService: ServiceCtor;
  ProgramService: ServiceCtor;
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

    class QueueNextZoneCharacteristic extends hap.Characteristic {
      static readonly UUID = '9f1c2a52-35de-4cb5-88c9-3a204c3f93c6';
      constructor() {
        super('Queue Next Zone', QueueNextZoneCharacteristic.UUID, {
          format: hap.Formats.UINT8,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.setProps({
          format: hap.Formats.UINT8,
          minValue: 0,
          maxValue: 255,
          minStep: 1,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.value = this.getDefaultValue();
      }
    }

    class QueueRemainingRuntimeCharacteristic extends hap.Characteristic {
      static readonly UUID = '45aeaec4-8f1b-43db-8435-3b6f5f34fa17';
      constructor() {
        super('Queue Remaining Runtime', QueueRemainingRuntimeCharacteristic.UUID, {
          format: hap.Formats.UINT16,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.setProps({
          format: hap.Formats.UINT16,
          unit: 'min',
          minValue: 0,
          maxValue: 65535,
          minStep: 1,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.value = this.getDefaultValue();
      }
    }

    class CurrentZoneCharacteristic extends hap.Characteristic {
      static readonly UUID = '5e8fc8fc-8301-4709-aee0-b3bc5c84c8dd';
      constructor() {
        super('Current Running Zone', CurrentZoneCharacteristic.UUID, {
          format: hap.Formats.UINT8,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.setProps({
          format: hap.Formats.UINT8,
          minValue: 0,
          maxValue: 255,
          minStep: 1,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.value = this.getDefaultValue();
      }
    }

    class CurrentRemainingRuntimeCharacteristic extends hap.Characteristic {
      static readonly UUID = '746072eb-a1e7-4ab9-89ff-dff72cd0231a';
      constructor() {
        super('Current Remaining Runtime', CurrentRemainingRuntimeCharacteristic.UUID, {
          format: hap.Formats.UINT16,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.setProps({
          format: hap.Formats.UINT16,
          unit: 'min',
          minValue: 0,
          maxValue: 65535,
          minStep: 1,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.value = this.getDefaultValue();
      }
    }

    class QueueSummaryCharacteristic extends hap.Characteristic {
      static readonly UUID = '2fdbf35e-e0f0-4f8f-aa7b-af6ca760fd4f';
      constructor() {
        super('Queue Summary', QueueSummaryCharacteristic.UUID, {
          format: hap.Formats.STRING,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.setProps({
          format: hap.Formats.STRING,
          maxLen: 128,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.value = this.getDefaultValue();
      }
    }

    class ProgramBudgetCharacteristic extends hap.Characteristic {
      static readonly UUID = '7c7efaf0-3191-48d1-a70d-70faac3f459a';
      constructor() {
        super('Program Water Budget', ProgramBudgetCharacteristic.UUID, {
          format: hap.Formats.UINT16,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.PAIRED_WRITE, hap.Perms.NOTIFY],
        });
        this.setProps({
          format: hap.Formats.UINT16,
          unit: '%',
          minValue: 0,
          maxValue: 100,
          minStep: 1,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.PAIRED_WRITE, hap.Perms.NOTIFY],
        });
        this.value = this.getDefaultValue();
      }
    }

    class ProgramRuntimeMinutesCharacteristic extends hap.Characteristic {
      static readonly UUID = 'd4799b01-a3f5-4b33-b831-7e3efee74bc6';
      constructor() {
        super('Program Total Runtime', ProgramRuntimeMinutesCharacteristic.UUID, {
          format: hap.Formats.UINT16,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.setProps({ format: hap.Formats.UINT16, unit: 'min', minValue: 0, maxValue: 65535, minStep: 1, perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY] });
        this.value = this.getDefaultValue();
      }
    }

    class ProgramFirstStartCharacteristic extends hap.Characteristic {
      static readonly UUID = '7c0221d5-4af2-4629-a12d-56cc031bb4f0';
      constructor() {
        super('Program First Start', ProgramFirstStartCharacteristic.UUID, {
          format: hap.Formats.UINT16,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.setProps({ format: hap.Formats.UINT16, unit: 'min', minValue: 0, maxValue: 65535, minStep: 1, perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY] });
        this.value = this.getDefaultValue();
      }
    }

    class ProgramDaysMaskCharacteristic extends hap.Characteristic {
      static readonly UUID = '4cf872a4-8f8c-4235-a782-00864adbe7f0';
      constructor() {
        super('Program Days Mask', ProgramDaysMaskCharacteristic.UUID, {
          format: hap.Formats.UINT8,
          perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY],
        });
        this.setProps({ format: hap.Formats.UINT8, minValue: 0, maxValue: 127, minStep: 1, perms: [hap.Perms.PAIRED_READ, hap.Perms.NOTIFY] });
        this.value = this.getDefaultValue();
      }
    }

    class QueueService extends hap.Service {
      static readonly UUID = 'd4bfcde5-6c50-4acb-8a0f-f2e4033f7554';
      constructor(name: string, subtype?: string) {
        super(name, QueueService.UUID, subtype);
        this.addCharacteristic(QueueNextZoneCharacteristic as unknown as CharacteristicCtor);
        this.addCharacteristic(QueueRemainingRuntimeCharacteristic as unknown as CharacteristicCtor);
        this.addCharacteristic(CurrentZoneCharacteristic as unknown as CharacteristicCtor);
        this.addCharacteristic(CurrentRemainingRuntimeCharacteristic as unknown as CharacteristicCtor);
        this.addCharacteristic(QueueSummaryCharacteristic as unknown as CharacteristicCtor);
      }
    }

    class ProgramService extends hap.Service {
      static readonly UUID = 'd32f5b12-df8b-4731-a646-c0297d77ab6e';
      constructor(name: string, subtype?: string) {
        super(name, ProgramService.UUID, subtype);
        this.addCharacteristic(ProgramBudgetCharacteristic as unknown as CharacteristicCtor);
        this.addCharacteristic(ProgramRuntimeMinutesCharacteristic as unknown as CharacteristicCtor);
        this.addCharacteristic(ProgramFirstStartCharacteristic as unknown as CharacteristicCtor);
        this.addCharacteristic(ProgramDaysMaskCharacteristic as unknown as CharacteristicCtor);
      }
    }

    RainbirdAccessory.customTypes = {
      RainDelayCharacteristic: RainDelayCharacteristic as unknown as CharacteristicCtor,
      QueueNextZoneCharacteristic: QueueNextZoneCharacteristic as unknown as CharacteristicCtor,
      QueueRemainingRuntimeCharacteristic: QueueRemainingRuntimeCharacteristic as unknown as CharacteristicCtor,
      CurrentZoneCharacteristic: CurrentZoneCharacteristic as unknown as CharacteristicCtor,
      CurrentRemainingRuntimeCharacteristic: CurrentRemainingRuntimeCharacteristic as unknown as CharacteristicCtor,
      QueueSummaryCharacteristic: QueueSummaryCharacteristic as unknown as CharacteristicCtor,
      ProgramBudgetCharacteristic: ProgramBudgetCharacteristic as unknown as CharacteristicCtor,
      ProgramRuntimeMinutesCharacteristic: ProgramRuntimeMinutesCharacteristic as unknown as CharacteristicCtor,
      ProgramFirstStartCharacteristic: ProgramFirstStartCharacteristic as unknown as CharacteristicCtor,
      ProgramDaysMaskCharacteristic: ProgramDaysMaskCharacteristic as unknown as CharacteristicCtor,
      QueueService: QueueService as unknown as ServiceCtor,
      ProgramService: ProgramService as unknown as ServiceCtor,
    };

    return RainbirdAccessory.customTypes;
  }

  private readonly infoService: Service;
  private irrigationService?: Service;
  private valveService?: Service;
  private rainSensorService?: Service;
  private queueService?: Service;
  private programBudgetServices: ProgramBudgetService[] = [];
  private programSwitches: ProgramSwitch[] = [];
  private zoneSwitches: ZoneSwitch[] = [];
  private zoneValves: ZoneValve[] = [];

  private isActive = false;
  private remainingDuration = 0;
  private activeZones = new Set<number>();
  private rainDelayDays = 0;
  private rainSensorActive = false;
  private queueNextZone = 0;
  private queueRemainingRuntimeMinutes = 0;
  private currentZone = 0;
  private currentRemainingRuntimeMinutes = 0;
  private queueSummary = 'Idle';

  private readonly zone?: number;
  private readonly zones: number[];
  private readonly defaultDuration: number;

  private scheduleProgramInfo: Array<Record<string, number>> = [];
  private scheduleProgramStartInfo: Array<Record<string, number>> = [];
  private scheduleDurations: Array<{ zone: number; durations: number[] }> = [];
  private adjustedZoneDurationsSeconds: Map<number, number> = new Map();
  private zoneDefaultDurationSeconds?: number;

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

  updateStatus(
    activeStations: Set<number>,
    rainSensorActive?: boolean,
    rainDelayDays?: number,
    healthy = true,
    queueNextZone?: number,
    queueRemainingRuntimeMinutes?: number,
    currentZone?: number,
    currentRemainingRuntimeMinutes?: number,
  ): void {
    this.activeZones = new Set(activeStations);
    if (typeof rainSensorActive === 'boolean') {
      this.rainSensorActive = rainSensorActive;
    }
    if (typeof rainDelayDays === 'number') {
      this.rainDelayDays = rainDelayDays;
    }
    if (typeof queueNextZone === 'number') {
      this.queueNextZone = Math.max(0, Math.floor(queueNextZone));
    }
    if (typeof queueRemainingRuntimeMinutes === 'number') {
      this.queueRemainingRuntimeMinutes = Math.max(0, Math.floor(queueRemainingRuntimeMinutes));
    }
    if (typeof currentZone === 'number') {
      this.currentZone = Math.max(0, Math.floor(currentZone));
    }
    if (typeof currentRemainingRuntimeMinutes === 'number') {
      this.currentRemainingRuntimeMinutes = Math.max(0, Math.floor(currentRemainingRuntimeMinutes));
    }

    const runningPart = this.currentZone > 0
      ? `Running Z${this.currentZone} (${this.currentRemainingRuntimeMinutes}m)`
      : 'Running none';
    const nextPart = this.queueNextZone > 0
      ? `Next Z${this.queueNextZone} (${this.queueRemainingRuntimeMinutes}m)`
      : 'Next none';
    this.queueSummary = `${runningPart}, ${nextPart}`;

    this.updateHealth(healthy);

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

    if (this.queueService) {
      const custom = RainbirdAccessory.getCustomTypes(this.platform);
      this.queueService.updateCharacteristic(custom.QueueNextZoneCharacteristic, this.queueNextZone);
      this.queueService.updateCharacteristic(custom.QueueRemainingRuntimeCharacteristic, this.queueRemainingRuntimeMinutes);
      this.queueService.updateCharacteristic(custom.CurrentZoneCharacteristic, this.currentZone);
      this.queueService.updateCharacteristic(custom.CurrentRemainingRuntimeCharacteristic, this.currentRemainingRuntimeMinutes);
      this.queueService.updateCharacteristic(custom.QueueSummaryCharacteristic, this.queueSummary);
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

  updateHealth(healthy: boolean): void {
    const fault = healthy
      ? this.platform.Characteristic.StatusFault.NO_FAULT
      : this.platform.Characteristic.StatusFault.GENERAL_FAULT;

    this.irrigationService?.updateCharacteristic(this.platform.Characteristic.StatusFault, fault);
    this.valveService?.updateCharacteristic(this.platform.Characteristic.StatusFault, fault);
    this.rainSensorService?.updateCharacteristic(this.platform.Characteristic.StatusFault, fault);

    for (const programSwitch of this.programSwitches) {
      programSwitch.service.updateCharacteristic(this.platform.Characteristic.StatusFault, fault);
    }
    for (const zoneSwitch of this.zoneSwitches) {
      zoneSwitch.service.updateCharacteristic(this.platform.Characteristic.StatusFault, fault);
    }
    for (const zoneValve of this.zoneValves) {
      zoneValve.service.updateCharacteristic(this.platform.Characteristic.StatusFault, fault);
    }
  }

  updateZoneState(zone: number, activeStations: Set<number>): void {
    if (!this.valveService || zone < 1) {
      return;
    }

    const active = activeStations.has(zone);
    const defaultSeconds = this.zoneDefaultDurationSeconds ?? this.defaultDuration * 60;
    this.isActive = active;
    this.remainingDuration = active ? defaultSeconds : 0;

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

    this.setupQueueService();

    const enabledPrograms = Array.isArray(this.accessory.context.programSwitches)
      ? this.accessory.context.programSwitches as number[]
      : (this.accessory.context.programSwitches ? [1, 2, 3, 4] : []);
    const enabledProgramsForBudgets = enabledPrograms.length > 0 ? enabledPrograms : [1, 2, 3, 4];
    this.setupProgramBudgetServices(enabledProgramsForBudgets);

    const shouldExposeSwitches = enabledPrograms.length > 0;
    if (shouldExposeSwitches) {
      for (const program of enabledPrograms) {
        const letter = String.fromCharCode(64 + program);
        const name = `Program ${letter}`;
        const subtype = `program-${program}`;
        const service = this.accessory.getServiceById(this.platform.Service.Switch, subtype)
          || this.accessory.addService(this.platform.Service.Switch, name, subtype);

        service.setCharacteristic(this.platform.Characteristic.Name, name);

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

    this.pruneControllerServices(enabledPrograms, enabledProgramsForBudgets, shouldExposeZoneSwitches, shouldExposeZoneValves, this.zones);
  }

  private setupProgramBudgetServices(enabledPrograms: number[]): void {
    const custom = RainbirdAccessory.getCustomTypes(this.platform);
    this.programBudgetServices = [];

    for (const program of enabledPrograms) {
      const letter = String.fromCharCode(64 + program);
      const name = `Program ${letter} Budget`;
      const subtype = `program-budget-${program}`;
      const existingCustom = this.accessory.getServiceById(custom.ProgramService, subtype);
      if (existingCustom) {
        this.accessory.removeService(existingCustom);
      }
      const staleFan = this.accessory.getServiceById(this.platform.Service.Fanv2, `program-fan-${program}`);
      if (staleFan) {
        this.accessory.removeService(staleFan);
      }
      const staleLight = this.accessory.getServiceById(this.platform.Service.Lightbulb, `program-light-${program}`);
      if (staleLight) {
        this.accessory.removeService(staleLight);
      }
      const staleSwitch = this.accessory.getServiceById(this.platform.Service.Switch, `program-switch-${program}`);
      if (staleSwitch) {
        this.accessory.removeService(staleSwitch);
      }
      const service: Service | undefined = undefined;

      const budgetUiType = (this.accessory.context.programBudgetServiceType ?? 'fan') as 'fan' | 'light' | 'switch';
      const uiName = `Program ${letter} Budget`;
      const uiSubtype = `program-${budgetUiType}-${program}`;
      let uiService: Service | undefined;

      if (budgetUiType === 'fan') {
        uiService = this.accessory.getServiceById(this.platform.Service.Fanv2, uiSubtype)
          || this.accessory.addService(this.platform.Service.Fanv2, uiName, uiSubtype);
        uiService.setCharacteristic(this.platform.Characteristic.Name, uiName);
        uiService.getCharacteristic(this.platform.Characteristic.Active)
          .onGet(() => this.platform.Characteristic.Active.ACTIVE)
          .onSet(() => undefined);
        uiService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
          .onGet(() => this.programBudgetServices.find((entry) => entry.program === program)?.budget ?? 0)
          .onSet((value) => this.setProgramBudget(program, value));
      } else if (budgetUiType === 'light') {
        uiService = this.accessory.getServiceById(this.platform.Service.Lightbulb, uiSubtype)
          || this.accessory.addService(this.platform.Service.Lightbulb, uiName, uiSubtype);
        uiService.setCharacteristic(this.platform.Characteristic.Name, uiName);
        uiService.getCharacteristic(this.platform.Characteristic.On)
          .onGet(() => (this.programBudgetServices.find((entry) => entry.program === program)?.budget ?? 0) > 0)
          .onSet((value) => this.setProgramBudget(program, value ? 100 : 0));
        uiService.getCharacteristic(this.platform.Characteristic.Brightness)
          .onGet(() => this.programBudgetServices.find((entry) => entry.program === program)?.budget ?? 0)
          .onSet((value) => this.setProgramBudget(program, value));
      } else {
        uiService = this.accessory.getServiceById(this.platform.Service.Switch, uiSubtype)
          || this.accessory.addService(this.platform.Service.Switch, uiName, uiSubtype);
        uiService.setCharacteristic(this.platform.Characteristic.Name, uiName);
        uiService.getCharacteristic(this.platform.Characteristic.On)
          .onGet(() => (this.programBudgetServices.find((entry) => entry.program === program)?.budget ?? 0) > 0)
          .onSet((value) => this.setProgramBudget(program, value ? 100 : 0));
      }

      this.programBudgetServices.push({
        program,
        service,
        uiService,
        uiType: budgetUiType,
        budget: 0,
        runtimeMinutes: 0,
        lastBudgetUpdate: undefined,
        firstStartMinutes: 0,
        daysMask: 0,
      });
    }
  }

  private setupQueueService(): void {
    const custom = RainbirdAccessory.getCustomTypes(this.platform);
    this.queueService = this.accessory.getService(custom.QueueService)
      || this.accessory.addService(custom.QueueService, 'Queue Status', 'queue-status');

    this.queueService.setCharacteristic(this.platform.Characteristic.Name, 'Queue Status');

    this.queueService.getCharacteristic(custom.QueueNextZoneCharacteristic)
      .onGet(() => this.queueNextZone);

    this.queueService.getCharacteristic(custom.QueueRemainingRuntimeCharacteristic)
      .onGet(() => this.queueRemainingRuntimeMinutes);

    this.queueService.getCharacteristic(custom.CurrentZoneCharacteristic)
      .onGet(() => this.currentZone);

    this.queueService.getCharacteristic(custom.CurrentRemainingRuntimeCharacteristic)
      .onGet(() => this.currentRemainingRuntimeMinutes);

    this.queueService.getCharacteristic(custom.QueueSummaryCharacteristic)
      .onGet(() => this.queueSummary);
  }

  private pruneControllerServices(programSwitches: number[], programBudgetPrograms: number[], zoneSwitches: boolean, zoneValves: boolean, activeZones: number[]): void {
    for (const service of [...this.accessory.services]) {
      const subtype = service.subtype ?? '';
      if (subtype.startsWith('program-budget-')) {
        this.accessory.removeService(service);
      }
      if (subtype.startsWith('program-')
        && !subtype.startsWith('program-budget-')
        && !subtype.startsWith('program-fan-')
        && !subtype.startsWith('program-light-')
        && !subtype.startsWith('program-switch-')) {
        const program = Number(subtype.replace('program-', ''));
        if (!programSwitches.includes(program)) {
          this.accessory.removeService(service);
        }
      }
      if (subtype.startsWith('zone-switch-')) {
        const zone = Number(subtype.replace('zone-switch-', ''));
        if (!zoneSwitches || !activeZones.includes(zone)) {
          this.accessory.removeService(service);
        }
      }
      if (subtype.startsWith('zone-valve-')) {
        const zone = Number(subtype.replace('zone-valve-', ''));
        if (!zoneValves || !activeZones.includes(zone)) {
          this.accessory.removeService(service);
        }
      }
      if (subtype.startsWith('program-fan-')) {
        const program = Number(subtype.replace('program-fan-', ''));
        const uiType = this.accessory.context.programBudgetServiceType ?? 'fan';
        if (!programBudgetPrograms.includes(program) || uiType !== 'fan') {
          this.accessory.removeService(service);
        }
      }
      if (subtype.startsWith('program-light-')) {
        const program = Number(subtype.replace('program-light-', ''));
        const uiType = this.accessory.context.programBudgetServiceType ?? 'fan';
        if (!programBudgetPrograms.includes(program) || uiType !== 'light') {
          this.accessory.removeService(service);
        }
      }
      if (subtype.startsWith('program-switch-')) {
        const program = Number(subtype.replace('program-switch-', ''));
        const uiType = this.accessory.context.programBudgetServiceType ?? 'fan';
        if (!programBudgetPrograms.includes(program) || uiType !== 'switch') {
          this.accessory.removeService(service);
        }
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

    const fallbackSeconds = this.zoneDefaultDurationSeconds ?? this.defaultDuration * 60;
    const durationSeconds = this.remainingDuration > 0 ? this.remainingDuration : fallbackSeconds;
    const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
    this.log.info(`Starting zone ${zone} for ${minutes} minute(s)`);
    if (this.accessory.context.stackRunRequests && this.activeZones.size > 0) {
      this.log.info(`Stacking zone ${zone} behind active run`);
      await this.controller.stackZone(zone, minutes);
    } else {
      await this.controller.startZone(zone, minutes);
    }
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
    const durationSeconds = this.adjustedZoneDurationsSeconds.get(zone) ?? this.defaultDuration * 60;
    const durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
    this.log.info(`Starting zone ${zone} from zone switch for ${durationMinutes} minute(s)`);
    if (this.accessory.context.stackRunRequests && this.activeZones.size > 0) {
      this.log.info(`Stacking zone ${zone} from zone switch`);
      await this.controller.stackZone(zone, durationMinutes);
    } else {
      await this.controller.startZone(zone, durationMinutes);
    }
  }

  private async setProgramSwitch(program: number, value: CharacteristicValue): Promise<void> {
    if (!value) {
      return;
    }
    this.log.info(`Starting Rain Bird program ${program}`);
    await this.controller.startProgram(program);
    this.log.debug(`Started Rain Bird program ${program}`);
  }

  private async getProgramBudget(program: number): Promise<number> {
    const found = this.programBudgetServices.find((entry) => entry.program === program);
    if (found?.lastBudgetUpdate) {
      return found.budget;
    }
    const budget = await this.controller.getWaterBudget(program - 1);
    if (found) {
      found.budget = budget;
      found.lastBudgetUpdate = Date.now();
      if (found.service) {
        const custom = RainbirdAccessory.getCustomTypes(this.platform);
        found.service.updateCharacteristic(custom.ProgramBudgetCharacteristic, budget);
      }
      this.updateBudgetUi(found, budget);
    }
    return budget;
  }

  private async setProgramBudget(program: number, value: CharacteristicValue): Promise<void> {
    const budget = Math.max(0, Math.min(100, Number(value)));
    await this.controller.setWaterBudget(program - 1, budget);
    const found = this.programBudgetServices.find((entry) => entry.program === program);
    if (found) {
      found.budget = budget;
      found.lastBudgetUpdate = Date.now();
      if (found.service) {
        const custom = RainbirdAccessory.getCustomTypes(this.platform);
        found.service.updateCharacteristic(custom.ProgramBudgetCharacteristic, budget);
      }
      this.updateBudgetUi(found, budget);
    }
    this.log.info(`Set Program ${String.fromCharCode(64 + program)} water budget to ${budget}%`);
  }

  updateProgramBudgets(budgets: Array<{ program: number; budget: number }>): void {
    const custom = RainbirdAccessory.getCustomTypes(this.platform);
    for (const entry of budgets) {
      const found = this.programBudgetServices.find((service) => service.program === entry.program);
      if (!found) {
        continue;
      }
      found.budget = entry.budget;
      found.lastBudgetUpdate = Date.now();
      if (found.service) {
        found.service.updateCharacteristic(custom.ProgramBudgetCharacteristic, entry.budget);
      }
      this.updateBudgetUi(found, entry.budget);
    }
    this.refreshAdjustedDurations();
  }

  updateProgramMetadata(
    schedule: {
      programInfo: Array<Record<string, number>>;
      programStartInfo: Array<Record<string, number>>;
      durations: Array<{ zone: number; durations: number[] }>;
    },
  ): void {
    this.scheduleProgramInfo = schedule.programInfo ?? [];
    this.scheduleProgramStartInfo = schedule.programStartInfo ?? [];
    this.scheduleDurations = schedule.durations ?? [];

    const custom = RainbirdAccessory.getCustomTypes(this.platform);
    for (const programService of this.programBudgetServices) {
      const programZero = programService.program - 1;
      const info = schedule.programInfo.find((entry) => Number(entry.program ?? -1) === programZero);
      const start = schedule.programStartInfo.find((entry) => Number(entry.program ?? -1) === programZero);
      const firstStart = Array.isArray(start?.startTime)
        ? (start?.startTime as number[]).find((entry) => Number(entry) !== 65535)
        : undefined;
      const runtimeMinutes = schedule.durations.reduce((sum, zoneEntry) => sum + Number(zoneEntry.durations?.[programZero] ?? 0), 0);
      programService.daysMask = Number(info?.daysOfWeekMask ?? 0);
      programService.firstStartMinutes = Number(firstStart ?? 0);
      programService.runtimeMinutes = runtimeMinutes;

      if (programService.service) {
        programService.service.updateCharacteristic(custom.ProgramRuntimeMinutesCharacteristic, runtimeMinutes);
        programService.service.updateCharacteristic(custom.ProgramFirstStartCharacteristic, programService.firstStartMinutes);
        programService.service.updateCharacteristic(custom.ProgramDaysMaskCharacteristic, programService.daysMask);
      }
    }

    this.refreshAdjustedDurations();
  }

  private refreshAdjustedDurations(): void {
    if (this.scheduleDurations.length === 0) {
      return;
    }

    const budgetByProgram = new Map<number, number>();
    for (const service of this.programBudgetServices) {
      const budget = service.lastBudgetUpdate ? service.budget : 100;
      budgetByProgram.set(service.program, budget);
    }

    this.adjustedZoneDurationsSeconds.clear();
    const now = new Date();

    for (const entry of this.scheduleDurations) {
      const next = this.findNextScheduledProgram(entry.zone, entry.durations, now);
      if (!next || next.minutes <= 0) {
        continue;
      }
      const budget = budgetByProgram.get(next.program) ?? 100;
      const adjustedMinutes = Math.max(1, Math.round(next.minutes * (budget / 100)));
      const adjustedSeconds = adjustedMinutes * 60;
      this.adjustedZoneDurationsSeconds.set(next.zone, adjustedSeconds);
      this.applyAdjustedDuration(next.zone, adjustedSeconds);
    }
  }

  private findNextScheduledProgram(
    zone: number,
    zoneDurations: number[],
    now: Date,
  ): { zone: number; program: number; minutes: number; start: Date } | undefined {
    let best: { zone: number; program: number; minutes: number; start: Date } | undefined;

    for (const info of this.scheduleProgramInfo) {
      const programZero = Number(info.program ?? -1);
      if (programZero < 0) {
        continue;
      }
      const minutes = Number(zoneDurations[programZero] ?? 0);
      if (minutes <= 0) {
        continue;
      }
      const startInfo = this.scheduleProgramStartInfo.find((entry) => Number(entry.program ?? -1) === programZero);
      if (!this.isProgramEnabled(info, startInfo)) {
        continue;
      }
      const nextStart = this.findNextProgramStart(info, startInfo, now);
      if (!nextStart) {
        continue;
      }
      const candidate = { zone, program: programZero + 1, minutes, start: nextStart };
      if (!best || candidate.start.getTime() < best.start.getTime()) {
        best = candidate;
      }
    }

    return best;
  }

  private isProgramEnabled(programInfo: Record<string, number>, startInfo?: Record<string, number>): boolean {
    if (!startInfo || !Array.isArray(startInfo.startTime)) {
      return false;
    }
    const times = (startInfo.startTime as number[]).filter((value) => Number(value) !== 65535);
    if (times.length === 0) {
      return false;
    }
    if (Number(programInfo.permanentDaysOff ?? 0) > 0) {
      return false;
    }
    const daysMask = Number(programInfo.daysOfWeekMask ?? 0);
    const period = Number(programInfo.period ?? 0);
    const frequency = Number(programInfo.frequency ?? 0);
    return daysMask > 0 || period > 0 || frequency > 0;
  }

  private findNextProgramStart(
    programInfo: Record<string, number>,
    startInfo: Record<string, number> | undefined,
    now: Date,
  ): Date | undefined {
    if (!startInfo || !Array.isArray(startInfo.startTime)) {
      return undefined;
    }
    const startTimes = (startInfo.startTime as number[])
      .filter((value) => Number(value) !== 65535)
      .map((value) => Math.max(0, Math.min(1439, Number(value))))
      .sort((a, b) => a - b);
    if (startTimes.length === 0) {
      return undefined;
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todayMidnight = new Date(now);
    todayMidnight.setHours(0, 0, 0, 0);

    for (let offset = 0; offset <= 14; offset++) {
      const day = new Date(todayMidnight.getTime() + offset * 86400000);
      if (!this.isProgramActiveOnDate(programInfo, day, offset)) {
        continue;
      }
      for (const minutes of startTimes) {
        if (offset === 0 && minutes <= nowMinutes) {
          continue;
        }
        return new Date(day.getTime() + minutes * 60000);
      }
    }

    return undefined;
  }

  private isProgramActiveOnDate(programInfo: Record<string, number>, date: Date, offsetFromToday: number): boolean {
    const daysMask = Number(programInfo.daysOfWeekMask ?? 0);
    const period = Number(programInfo.period ?? 0);
    const frequency = Number(programInfo.frequency ?? 0);
    const synchro = Number(programInfo.synchro ?? 0);

    if (daysMask > 0) {
      const dayIdx = date.getDay();
      return ((daysMask >> dayIdx) & 1) === 1;
    }

    if (frequency > 0) {
      if (offsetFromToday < synchro) {
        return false;
      }
      return ((offsetFromToday - synchro) % frequency) === 0;
    }

    if (period === 1) {
      return date.getDate() % 2 === 1;
    }
    if (period === 2) {
      return date.getDate() % 2 === 0;
    }

    return false;
  }

  private updateBudgetUi(service: ProgramBudgetService, budget: number): void {
    if (!service.uiService || !service.uiType) {
      return;
    }
    if (service.uiType === 'fan') {
      service.uiService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, budget);
      return;
    }
    if (service.uiType === 'light') {
      service.uiService.updateCharacteristic(this.platform.Characteristic.Brightness, budget);
      service.uiService.updateCharacteristic(this.platform.Characteristic.On, budget > 0);
      return;
    }
    service.uiService.updateCharacteristic(this.platform.Characteristic.On, budget > 0);
  }

  private applyAdjustedDuration(zone: number, seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return;
    }

    if (this.accessory.context.type === 'controller') {
      const found = this.zoneValves.find((valve) => valve.zone === zone);
      if (!found) {
        return;
      }
      found.durationSeconds = seconds;
      found.service.updateCharacteristic(this.platform.Characteristic.SetDuration, seconds);
      return;
    }

    if (this.zone === zone && this.valveService) {
      this.zoneDefaultDurationSeconds = seconds;
      this.valveService.updateCharacteristic(this.platform.Characteristic.SetDuration, seconds);
      if (!this.isActive) {
        this.remainingDuration = seconds;
        this.valveService.updateCharacteristic(this.platform.Characteristic.RemainingDuration, seconds);
      }
    }
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
    const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
    this.log.info(`Starting controller-zone valve ${zone} for ${minutes} minute(s)`);
    if (this.accessory.context.stackRunRequests && this.activeZones.size > 0) {
      this.log.info(`Stacking controller-zone valve ${zone}`);
      await this.controller.stackZone(zone, minutes);
    } else {
      await this.controller.startZone(zone, minutes);
    }
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
