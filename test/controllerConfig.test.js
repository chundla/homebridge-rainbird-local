import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalizeControllerConfig } from '../dist/controllerConfig.js';
import { createMatterZoneValveBridge } from '../dist/matterZoneValveBridge.js';
import { createZoneRuntime } from '../dist/zoneRuntime.js';

test('normalizeControllerConfig defaults Matter zone valves off', () => {
  const normalized = normalizeControllerConfig({
    host: '192.0.2.10',
    password: 'secret',
  });

  assert.equal(normalized.matterZoneValves, false);
});

test('config schema copies stay aligned for Matter zone valves', () => {
  const rootSchema = JSON.parse(readFileSync(new globalThis.URL('../config.schema.json', import.meta.url), 'utf8'));
  const srcSchema = JSON.parse(readFileSync(new globalThis.URL('../src/config.schema.json', import.meta.url), 'utf8'));

  const rootMatterZoneValves = rootSchema.schema.properties.devices.items.properties.matterZoneValves;
  const srcMatterZoneValves = srcSchema.schema.properties.matterZoneValves;

  assert.deepEqual(srcMatterZoneValves, rootMatterZoneValves);
});

test('createZoneRuntime keeps shared duration and active state in one place', () => {
  const runtime = createZoneRuntime([1, 3], 10);

  assert.deepEqual(runtime.getActiveZones(), []);
  assert.equal(runtime.getZoneState(1).active, false);
  assert.equal(runtime.getZoneState(1).durationSeconds, 600);

  runtime.setZoneDurationSeconds(3, 180);
  runtime.setActiveZones([3]);

  assert.deepEqual(runtime.getActiveZones(), [3]);
  assert.deepEqual(runtime.getZoneState(3), {
    zone: 3,
    active: true,
    durationSeconds: 180,
  });
  assert.equal(runtime.getZoneState(1).durationSeconds, 600);
});

test('Matter zone valve bridge skips registration with a clear log when bridge Matter is disabled', async () => {
  const warnings = [];
  const bridge = createMatterZoneValveBridge(
    {
      isMatterEnabled: () => false,
      matter: undefined,
    },
    {
      warn: (message) => warnings.push(message),
      info: () => undefined,
    },
  );

  const result = await bridge.ensureController({
    name: 'Back Yard',
    serial: 'RB-1',
    modelName: 'ESP-ME3',
    matterZoneValves: true,
    zones: [1, 2],
    zoneRuntime: createZoneRuntime([1, 2], 10),
  });

  assert.equal(result, 'skipped');
  assert.deepEqual(warnings, [
    '[Back Yard] Matter zone valves requested, but Matter is not enabled for this bridge. Skipping Matter registration.',
  ]);
});

function createMatterApiDouble() {
  const registrations = [];
  const updates = [];
  const unregistrations = [];

  return {
    registrations,
    updates,
    unregistrations,
    api: {
      isMatterEnabled: () => true,
      matter: {
        uuid: {
          generate: (value) => `uuid:${value}`,
        },
        deviceTypes: {
          WaterValve: 'WaterValve',
        },
        types: {
          ValveConfigurationAndControl: {
            ValveState: {
              Closed: 0,
              Open: 1,
            },
          },
        },
        registerPlatformAccessories: async (plugin, platform, accessories) => {
          registrations.push({ plugin, platform, accessories });
        },
        updatePlatformAccessories: async (accessories) => {
          updates.push(accessories);
        },
        unregisterPlatformAccessories: async (plugin, platform, accessories) => {
          unregistrations.push({ plugin, platform, accessories });
        },
      },
    },
  };
}

test('Matter zone valve bridge publishes one WaterValve per active filtered zone with stable IDs and zone valve names', async () => {
  const matter = createMatterApiDouble();
  const bridge = createMatterZoneValveBridge(
    matter.api,
    {
      warn: () => undefined,
      info: () => undefined,
    },
  );

  const runtime = createZoneRuntime([1, 3], 10);
  runtime.setZoneDurationSeconds(1, 240);
  runtime.setZoneDurationSeconds(3, 480);
  runtime.setActiveZones([3]);

  const result = await bridge.ensureController({
    name: 'Back Yard',
    serial: 'RB-1',
    modelName: 'ESP-ME3',
    matterZoneValves: true,
    zones: [1, 3],
    zoneNames: ['Front Lawn', 'Back Lawn', 'Side Beds'],
    zoneRuntime: runtime,
  });

  assert.equal(result, 'ready');
  assert.equal(matter.registrations.length, 1);
  assert.deepEqual(matter.registrations[0], {
    plugin: 'homebridge-rainbird-local',
    platform: 'RainBirdLocal',
    accessories: [
      {
        UUID: 'uuid:rainbird-matter-zone-valve:RB-1:1',
        displayName: 'Back Yard Front Lawn Valve',
        deviceType: 'WaterValve',
        serialNumber: 'RB-1-z1',
        manufacturer: 'Rain Bird',
        model: 'ESP-ME3',
        context: {
          kind: 'rainbird-zone-valve',
          controllerSerial: 'RB-1',
          zone: 1,
        },
        clusters: {
          valveConfigurationAndControl: {
            currentState: 0,
            targetState: 0,
            defaultOpenDuration: 240,
            openDuration: 240,
            remainingDuration: 0,
          },
        },
      },
      {
        UUID: 'uuid:rainbird-matter-zone-valve:RB-1:3',
        displayName: 'Back Yard Side Beds Valve',
        deviceType: 'WaterValve',
        serialNumber: 'RB-1-z3',
        manufacturer: 'Rain Bird',
        model: 'ESP-ME3',
        context: {
          kind: 'rainbird-zone-valve',
          controllerSerial: 'RB-1',
          zone: 3,
        },
        clusters: {
          valveConfigurationAndControl: {
            currentState: 1,
            targetState: 1,
            defaultOpenDuration: 480,
            openDuration: 480,
            remainingDuration: 480,
          },
        },
      },
    ],
  });
  assert.deepEqual(matter.updates, []);
  assert.deepEqual(matter.unregistrations, []);
});

test('Matter zone valve bridge reuses cached per-zone IDs across restart and removes stale zones after rediscovery', async () => {
  const matter = createMatterApiDouble();
  const bridge = createMatterZoneValveBridge(
    matter.api,
    {
      warn: () => undefined,
      info: () => undefined,
    },
  );

  bridge.configureMatterAccessory({
    UUID: 'uuid:rainbird-matter-zone-valve:RB-1:1',
    context: {
      kind: 'rainbird-zone-valve',
      controllerSerial: 'RB-1',
      zone: 1,
    },
  });
  bridge.configureMatterAccessory({
    UUID: 'uuid:rainbird-matter-zone-valve:RB-1:2',
    context: {
      kind: 'rainbird-zone-valve',
      controllerSerial: 'RB-1',
      zone: 2,
    },
  });

  const result = await bridge.ensureController({
    name: 'Back Yard',
    serial: 'RB-1',
    modelName: 'ESP-ME3',
    matterZoneValves: true,
    zones: [1, 3],
    zoneNames: ['Front Lawn', 'Back Lawn', 'Side Beds'],
    zoneRuntime: createZoneRuntime([1, 3], 10),
  });

  assert.equal(result, 'ready');
  assert.deepEqual(matter.registrations, [
    {
      plugin: 'homebridge-rainbird-local',
      platform: 'RainBirdLocal',
      accessories: [
        {
          UUID: 'uuid:rainbird-matter-zone-valve:RB-1:3',
          displayName: 'Back Yard Side Beds Valve',
          deviceType: 'WaterValve',
          serialNumber: 'RB-1-z3',
          manufacturer: 'Rain Bird',
          model: 'ESP-ME3',
          context: {
            kind: 'rainbird-zone-valve',
            controllerSerial: 'RB-1',
            zone: 3,
          },
          clusters: {
            valveConfigurationAndControl: {
              currentState: 0,
              targetState: 0,
              defaultOpenDuration: 600,
              openDuration: 600,
              remainingDuration: 0,
            },
          },
        },
      ],
    },
  ]);
  assert.deepEqual(matter.updates, [[
    {
      UUID: 'uuid:rainbird-matter-zone-valve:RB-1:1',
      displayName: 'Back Yard Front Lawn Valve',
      deviceType: 'WaterValve',
      serialNumber: 'RB-1-z1',
      manufacturer: 'Rain Bird',
      model: 'ESP-ME3',
      context: {
        kind: 'rainbird-zone-valve',
        controllerSerial: 'RB-1',
        zone: 1,
      },
      clusters: {
        valveConfigurationAndControl: {
          currentState: 0,
          targetState: 0,
          defaultOpenDuration: 600,
          openDuration: 600,
          remainingDuration: 0,
        },
      },
    },
  ]]);
  assert.deepEqual(matter.unregistrations, [
    {
      plugin: 'homebridge-rainbird-local',
      platform: 'RainBirdLocal',
      accessories: [
        {
          UUID: 'uuid:rainbird-matter-zone-valve:RB-1:2',
          context: {
            kind: 'rainbird-zone-valve',
            controllerSerial: 'RB-1',
            zone: 2,
          },
        },
      ],
    },
  ]);
});

test('Matter zone valve bridge removes cached valves when a controller no longer opts in', async () => {
  const matter = createMatterApiDouble();
  const bridge = createMatterZoneValveBridge(
    matter.api,
    {
      warn: () => undefined,
      info: () => undefined,
    },
  );

  bridge.configureMatterAccessory({
    UUID: 'uuid:rainbird-matter-zone-valve:RB-1:1',
    context: {
      kind: 'rainbird-zone-valve',
      controllerSerial: 'RB-1',
      zone: 1,
    },
  });

  const result = await bridge.ensureController({
    name: 'Back Yard',
    serial: 'RB-1',
    modelName: 'ESP-ME3',
    matterZoneValves: false,
    zones: [1],
    zoneNames: ['Front Lawn'],
    zoneRuntime: createZoneRuntime([1], 10),
  });

  assert.equal(result, 'disabled');
  assert.deepEqual(matter.registrations, []);
  assert.deepEqual(matter.updates, []);
  assert.deepEqual(matter.unregistrations, [
    {
      plugin: 'homebridge-rainbird-local',
      platform: 'RainBirdLocal',
      accessories: [
        {
          UUID: 'uuid:rainbird-matter-zone-valve:RB-1:1',
          context: {
            kind: 'rainbird-zone-valve',
            controllerSerial: 'RB-1',
            zone: 1,
          },
        },
      ],
    },
  ]);
});
