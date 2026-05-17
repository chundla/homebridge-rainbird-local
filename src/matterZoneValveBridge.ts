import type { API, Logging, MatterAccessory } from 'homebridge';

import type { ZoneRuntime } from './zoneRuntime.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { getZoneValveDisplayName } from './zoneNames.js';

export interface MatterZoneValveController {
  name: string;
  serial: string;
  modelName: string;
  matterZoneValves: boolean;
  zones: number[];
  zoneNames: string[];
  zoneRuntime: ZoneRuntime;
  controller?: {
    startZone(zone: number, minutes: number): Promise<void>;
    stackZone(zone: number, minutes: number): Promise<void>;
    stopIrrigation(): Promise<void>;
  };
  stackRunRequests?: boolean;
}

export interface MatterZoneValveAccessoryContext {
  kind: 'rainbird-zone-valve';
  controllerSerial: string;
  zone: number;
}

type MatterZoneValveAccessory = MatterAccessory<MatterZoneValveAccessoryContext>;
type MatterZoneValveCachedAccessory = Pick<MatterAccessory, 'UUID' | 'context'>;

type MatterBridgeLike = Pick<API, 'isMatterEnabled'> & {
  matter?: {
    uuid: Pick<API['hap']['uuid'], 'generate'>;
    deviceTypes: {
      WaterValve: MatterZoneValveAccessory['deviceType'];
    };
    types: {
      ValveConfigurationAndControl: {
        ValveState: {
          Closed: number;
          Open: number;
        };
      };
    };
    clusterNames?: {
      ValveConfigurationAndControl?: string;
    };
    registerPlatformAccessories(
      pluginIdentifier: string,
      platformName: string,
      accessories: MatterZoneValveAccessory[],
    ): Promise<void>;
    updatePlatformAccessories(accessories: MatterZoneValveAccessory[]): Promise<void>;
    updateAccessoryState?(
      uuid: string,
      cluster: string,
      attributes: Record<string, unknown>,
      partId?: string,
    ): Promise<void>;
    unregisterPlatformAccessories(
      pluginIdentifier: string,
      platformName: string,
      accessories: MatterAccessory[],
    ): Promise<void>;
  };
};
type MatterBridgeLog = Pick<Logging, 'warn' | 'info'>;

export type MatterZoneValveBridgeResult = 'disabled' | 'skipped' | 'ready';

export interface MatterZoneValveBridge {
  configureMatterAccessory(accessory: MatterZoneValveCachedAccessory): void;
  ensureController(controller: MatterZoneValveController): Promise<MatterZoneValveBridgeResult>;
  syncControllerState(controller: MatterZoneValveController): Promise<void>;
}

function isMatterZoneValveAccessoryContext(context: unknown): context is MatterZoneValveAccessoryContext {
  if (!context || typeof context !== 'object') {
    return false;
  }

  const value = context as Record<string, unknown>;
  return value.kind === 'rainbird-zone-valve'
    && typeof value.controllerSerial === 'string'
    && typeof value.zone === 'number';
}

class HomebridgeMatterZoneValveBridge implements MatterZoneValveBridge {
  private readonly controllerAccessories = new Map<string, Map<number, MatterZoneValveCachedAccessory>>();

  constructor(
    private readonly api: MatterBridgeLike,
    private readonly log: MatterBridgeLog,
  ) {}

  configureMatterAccessory(accessory: MatterZoneValveCachedAccessory): void {
    if (!isMatterZoneValveAccessoryContext(accessory.context)) {
      return;
    }

    let zones = this.controllerAccessories.get(accessory.context.controllerSerial);
    if (!zones) {
      zones = new Map();
      this.controllerAccessories.set(accessory.context.controllerSerial, zones);
    }

    zones.set(accessory.context.zone, accessory);
  }

  async ensureController(controller: MatterZoneValveController): Promise<MatterZoneValveBridgeResult> {
    if (!controller.matterZoneValves) {
      await this.unregisterMissingZones(controller.serial, new Set());
      return 'disabled';
    }

    if (!this.api.isMatterEnabled() || !this.api.matter) {
      this.log.warn(
        `[${controller.name}] Matter zone valves requested, but Matter is not enabled for this bridge. `
        + 'Skipping Matter registration.',
      );
      return 'skipped';
    }

    const published = this.controllerAccessories.get(controller.serial) ?? new Map<number, MatterZoneValveCachedAccessory>();
    const desiredZones = new Set(controller.zones);
    const toRegister: MatterZoneValveAccessory[] = [];
    const toUpdate: MatterZoneValveAccessory[] = [];

    for (const zone of controller.zones) {
      const accessory = this.buildAccessory(controller, zone);
      if (published.has(zone)) {
        toUpdate.push(accessory);
      } else {
        toRegister.push(accessory);
      }
      published.set(zone, accessory);
    }

    if (toRegister.length > 0) {
      await this.api.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, toRegister);
    }
    if (toUpdate.length > 0) {
      await this.api.matter.updatePlatformAccessories(toUpdate);
    }
    await this.unregisterMissingZones(controller.serial, desiredZones);
    this.controllerAccessories.set(controller.serial, published);

    this.log.info(
      `[${controller.name}] Published ${controller.zones.length} Matter zone valve accessory${controller.zones.length === 1 ? '' : 'ies'}.`,
    );
    return 'ready';
  }

  async syncControllerState(controller: MatterZoneValveController): Promise<void> {
    if (!controller.matterZoneValves || !this.api.isMatterEnabled() || !this.api.matter?.updateAccessoryState) {
      return;
    }

    const clusterName = this.api.matter.clusterNames?.ValveConfigurationAndControl ?? 'valveConfigurationAndControl';
    for (const zone of controller.zones) {
      const accessory = this.controllerAccessories.get(controller.serial)?.get(zone);
      if (!accessory) {
        continue;
      }
      const valveState = controller.zoneRuntime.getZoneState(zone);
      const state = this.api.matter.types.ValveConfigurationAndControl.ValveState;
      await this.api.matter.updateAccessoryState(
        accessory.UUID,
        clusterName,
        {
          currentState: valveState.active ? state.Open : state.Closed,
          targetState: valveState.active ? state.Open : state.Closed,
          defaultOpenDuration: valveState.durationSeconds,
          openDuration: valveState.durationSeconds,
          remainingDuration: valveState.active ? valveState.remainingDurationSeconds : 0,
        },
      );
    }
  }

  private buildAccessory(controller: MatterZoneValveController, zone: number): MatterZoneValveAccessory {
    const valveState = controller.zoneRuntime.getZoneState(zone);
    const matter = this.api.matter!;
    const state = matter.types.ValveConfigurationAndControl.ValveState;

    return {
      UUID: matter.uuid.generate(`rainbird-matter-zone-valve:${controller.serial}:${zone}`),
      displayName: `${controller.name} ${getZoneValveDisplayName(zone, controller.zoneNames)}`,
      deviceType: matter.deviceTypes.WaterValve,
      serialNumber: `${controller.serial}-z${zone}`,
      manufacturer: 'Rain Bird',
      model: controller.modelName,
      context: {
        kind: 'rainbird-zone-valve',
        controllerSerial: controller.serial,
        zone,
      },
      handlers: {
        valveConfigurationAndControl: {
          open: async (request) => this.openZoneValve(controller, zone, request?.openDuration),
          close: async () => this.closeZoneValve(controller),
        },
      },
      getState: (_cluster, attribute) => this.getValveStateAttribute(controller, zone, attribute),
      clusters: {
        valveConfigurationAndControl: {
          currentState: valveState.active ? state.Open : state.Closed,
          targetState: valveState.active ? state.Open : state.Closed,
          defaultOpenDuration: valveState.durationSeconds,
          openDuration: valveState.durationSeconds,
          remainingDuration: valveState.active ? valveState.remainingDurationSeconds : 0,
        },
      },
    };
  }

  private async openZoneValve(controller: MatterZoneValveController, zone: number, requestedDurationSeconds?: number | null): Promise<void> {
    if (!controller.controller) {
      throw new Error(`No controller command path available for Matter zone valve ${zone}`);
    }

    if (typeof requestedDurationSeconds === 'number' && Number.isFinite(requestedDurationSeconds) && requestedDurationSeconds > 0) {
      controller.zoneRuntime.setZoneDurationSeconds(zone, requestedDurationSeconds);
    }

    const durationSeconds = controller.zoneRuntime.getZoneDurationSeconds(zone);
    const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
    const hasActiveRun = controller.zoneRuntime.getActiveZones().length > 0;

    if (controller.stackRunRequests && hasActiveRun) {
      await controller.controller.stackZone(zone, minutes);
    } else {
      await controller.controller.startZone(zone, minutes);
    }

    controller.zoneRuntime.setActiveZones([zone]);
    controller.zoneRuntime.setZoneRemainingDurationSeconds(zone, durationSeconds);
  }

  private async closeZoneValve(controller: MatterZoneValveController): Promise<void> {
    if (!controller.controller) {
      throw new Error('No controller command path available for Matter zone valve');
    }

    await controller.controller.stopIrrigation();
    controller.zoneRuntime.setActiveZones([]);
  }

  private getValveStateAttribute(controller: MatterZoneValveController, zone: number, attribute: string): number | null | undefined {
    const valveState = controller.zoneRuntime.getZoneState(zone);
    const state = this.api.matter?.types.ValveConfigurationAndControl.ValveState;
    switch (attribute) {
    case 'currentState':
    case 'targetState':
      return valveState.active ? state?.Open : state?.Closed;
    case 'defaultOpenDuration':
    case 'openDuration':
      return valveState.durationSeconds;
    case 'remainingDuration':
      return valveState.active ? valveState.remainingDurationSeconds : 0;
    default:
      return undefined;
    }
  }

  private async unregisterMissingZones(controllerSerial: string, desiredZones: Set<number>): Promise<void> {
    const published = this.controllerAccessories.get(controllerSerial);
    if (!this.api.matter || !published) {
      return;
    }

    const staleAccessories = [...published.entries()]
      .filter(([zone]) => !desiredZones.has(zone))
      .map(([, accessory]) => accessory);

    if (staleAccessories.length === 0) {
      return;
    }

    await this.api.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories as MatterAccessory[]);

    for (const accessory of staleAccessories) {
      published.delete(accessory.context.zone);
    }

    if (published.size === 0) {
      this.controllerAccessories.delete(controllerSerial);
    }
  }
}

export function createMatterZoneValveBridge(api: MatterBridgeLike, log: MatterBridgeLog): MatterZoneValveBridge {
  return new HomebridgeMatterZoneValveBridge(api, log);
}
