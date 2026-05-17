import type { API, Logging } from 'homebridge';

import type { ZoneRuntime } from './zoneRuntime.js';

export interface MatterZoneValveController {
  name: string;
  serial: string;
  modelName: string;
  matterZoneValves: boolean;
  zones: number[];
  zoneRuntime: ZoneRuntime;
}

type MatterBridgeLike = Pick<API, 'isMatterEnabled' | 'matter'>;
type MatterBridgeLog = Pick<Logging, 'warn' | 'info'>;

export type MatterZoneValveBridgeResult = 'disabled' | 'skipped' | 'ready';

export interface MatterZoneValveBridge {
  ensureController(controller: MatterZoneValveController): Promise<MatterZoneValveBridgeResult>;
}

class HomebridgeMatterZoneValveBridge implements MatterZoneValveBridge {
  constructor(
    private readonly api: MatterBridgeLike,
    private readonly log: MatterBridgeLog,
  ) {}

  async ensureController(controller: MatterZoneValveController): Promise<MatterZoneValveBridgeResult> {
    if (!controller.matterZoneValves) {
      return 'disabled';
    }

    if (!this.api.isMatterEnabled() || !this.api.matter) {
      this.log.warn(
        `[${controller.name}] Matter zone valves requested, but Matter is not enabled for this bridge. `
        + 'Skipping Matter registration.',
      );
      return 'skipped';
    }

    this.log.info(
      `[${controller.name}] Matter zone valve scaffold ready for ${controller.zones.length} zone(s); `
      + 'accessory publication is deferred in this baseline.',
    );
    void controller.serial;
    void controller.modelName;
    void controller.zoneRuntime;
    return 'ready';
  }
}

export function createMatterZoneValveBridge(api: MatterBridgeLike, log: MatterBridgeLog): MatterZoneValveBridge {
  return new HomebridgeMatterZoneValveBridge(api, log);
}
