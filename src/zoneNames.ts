export function getZoneDisplayName(zone: number, zoneNames: string[] | undefined): string {
  const configuredName = zoneNames?.[zone - 1]?.trim();
  return configuredName || `Zone ${zone}`;
}

export function getZoneValveDisplayName(zone: number, zoneNames: string[] | undefined): string {
  return `${getZoneDisplayName(zone, zoneNames)} Valve`;
}
