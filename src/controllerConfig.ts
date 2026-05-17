import type { PlatformConfig } from 'homebridge';

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
  programBudgetServiceType?: 'fan' | 'light' | 'switch';
  zoneSwitches?: boolean;
  zoneValves?: boolean;
  matterZoneValves?: boolean;
  stackRunRequests?: boolean;
  logScheduleOnStart?: boolean;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
}

export interface RainbirdPlatformConfig extends PlatformConfig, RainbirdControllerConfig {
  debug?: boolean;
  devices?: RainbirdControllerConfig[];
  additionalControllers?: RainbirdControllerConfig[];
  controllers?: RainbirdControllerConfig[];
}

export interface NormalizedRainbirdControllerConfig extends RainbirdControllerConfig {
  matterZoneValves: boolean;
}

export function normalizeControllerConfig(config: RainbirdControllerConfig): NormalizedRainbirdControllerConfig {
  return {
    ...config,
    matterZoneValves: config.matterZoneValves ?? false,
  };
}
