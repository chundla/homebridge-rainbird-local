export interface ZoneState {
  zone: number;
  active: boolean;
  durationSeconds: number;
}

export interface ZoneRuntime {
  getActiveZones(): number[];
  setActiveZones(zones: Iterable<number>): void;
  getZoneState(zone: number): ZoneState;
  getZoneDurationSeconds(zone: number): number;
  setZoneDurationSeconds(zone: number, seconds: number): void;
}

class InMemoryZoneRuntime implements ZoneRuntime {
  private readonly durations = new Map<number, number>();
  private activeZones = new Set<number>();

  constructor(
    zones: number[],
    defaultDurationMinutes: number,
  ) {
    const defaultSeconds = Math.max(60, Math.round(defaultDurationMinutes * 60));
    for (const zone of zones) {
      this.durations.set(zone, defaultSeconds);
    }
  }

  getActiveZones(): number[] {
    return [...this.activeZones].sort((a, b) => a - b);
  }

  setActiveZones(zones: Iterable<number>): void {
    this.activeZones = new Set([...zones].map((zone) => Number(zone)).filter((zone) => Number.isInteger(zone) && zone > 0));
  }

  getZoneState(zone: number): ZoneState {
    return {
      zone,
      active: this.activeZones.has(zone),
      durationSeconds: this.getZoneDurationSeconds(zone),
    };
  }

  getZoneDurationSeconds(zone: number): number {
    return this.durations.get(zone) ?? 60;
  }

  setZoneDurationSeconds(zone: number, seconds: number): void {
    const normalized = Math.max(60, Math.round(Number(seconds) || 60));
    this.durations.set(zone, normalized);
  }
}

export function createZoneRuntime(zones: number[], defaultDurationMinutes: number): ZoneRuntime {
  return new InMemoryZoneRuntime(zones, defaultDurationMinutes);
}
