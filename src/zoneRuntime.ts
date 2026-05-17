export interface ZoneState {
  zone: number;
  active: boolean;
  durationSeconds: number;
  remainingDurationSeconds: number;
}

export interface ZoneRuntime {
  getActiveZones(): number[];
  setActiveZones(zones: Iterable<number>): void;
  getZoneState(zone: number): ZoneState;
  getZoneDurationSeconds(zone: number): number;
  getZoneRemainingDurationSeconds(zone: number): number;
  setZoneDurationSeconds(zone: number, seconds: number): void;
  setZoneRemainingDurationSeconds(zone: number, seconds: number): void;
}

class InMemoryZoneRuntime implements ZoneRuntime {
  private readonly durations = new Map<number, number>();
  private readonly remainingDurations = new Map<number, number>();
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
    for (const zone of this.durations.keys()) {
      if (!this.activeZones.has(zone)) {
        this.remainingDurations.set(zone, 0);
      } else if ((this.remainingDurations.get(zone) ?? 0) <= 0) {
        this.remainingDurations.set(zone, this.getZoneDurationSeconds(zone));
      }
    }
  }

  getZoneState(zone: number): ZoneState {
    return {
      zone,
      active: this.activeZones.has(zone),
      durationSeconds: this.getZoneDurationSeconds(zone),
      remainingDurationSeconds: this.getZoneRemainingDurationSeconds(zone),
    };
  }

  getZoneDurationSeconds(zone: number): number {
    return this.durations.get(zone) ?? 60;
  }

  getZoneRemainingDurationSeconds(zone: number): number {
    if (!this.activeZones.has(zone)) {
      return 0;
    }
    return this.remainingDurations.get(zone) ?? this.getZoneDurationSeconds(zone);
  }

  setZoneDurationSeconds(zone: number, seconds: number): void {
    const normalized = Math.max(60, Math.round(Number(seconds) || 60));
    this.durations.set(zone, normalized);
    if (this.activeZones.has(zone)) {
      this.remainingDurations.set(zone, normalized);
    }
  }

  setZoneRemainingDurationSeconds(zone: number, seconds: number): void {
    const normalized = Math.max(0, Math.round(Number(seconds) || 0));
    this.remainingDurations.set(zone, normalized);
  }
}

export function createZoneRuntime(zones: number[], defaultDurationMinutes: number): ZoneRuntime {
  return new InMemoryZoneRuntime(zones, defaultDurationMinutes);
}
