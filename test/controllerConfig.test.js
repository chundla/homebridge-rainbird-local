import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalizeControllerConfig } from '../dist/controllerConfig.js';
import { createMatterZoneValveBridge } from '../dist/matterZoneValveBridge.js';
import { RainbirdPlatform } from '../dist/platform.js';
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
    remainingDurationSeconds: 180,
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
  const stateUpdates = [];
  const unregistrations = [];

  return {
    registrations,
    updates,
    stateUpdates,
    unregistrations,
    api: {
      isMatterEnabled: () => true,
      matter: {
        clusterNames: {
          ValveConfigurationAndControl: 'valveConfigurationAndControl',
        },
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
        updateAccessoryState: async (uuid, cluster, attributes, partId) => {
          stateUpdates.push({ uuid, cluster, attributes, partId });
        },
        unregisterPlatformAccessories: async (plugin, platform, accessories) => {
          unregistrations.push({ plugin, platform, accessories });
        },
      },
    },
  };
}

function stripMatterAccessoryFunctions(accessory) {
  const rest = { ...accessory };
  delete rest.handlers;
  delete rest.getState;
  return rest;
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
  assert.deepEqual({
    ...matter.registrations[0],
    accessories: matter.registrations[0].accessories.map(stripMatterAccessoryFunctions),
  }, {
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
  assert.deepEqual(matter.registrations.map((entry) => ({
    ...entry,
    accessories: entry.accessories.map(stripMatterAccessoryFunctions),
  })), [
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
  assert.deepEqual(matter.updates.map((accessories) => accessories.map(stripMatterAccessoryFunctions)), [[
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

test('Matter zone valve bridge wires WaterValve open and close commands through the shared zone runtime', async () => {
  const matter = createMatterApiDouble();
  const bridge = createMatterZoneValveBridge(
    matter.api,
    {
      warn: () => undefined,
      info: () => undefined,
    },
  );

  const runtime = createZoneRuntime([1], 10);
  const commands = [];

  await bridge.ensureController({
    name: 'Front Yard',
    serial: 'RB-9',
    modelName: 'ESP-TM2',
    matterZoneValves: true,
    zones: [1],
    zoneNames: ['Beds'],
    zoneRuntime: runtime,
    controller: {
      startZone: async (zone, minutes) => {
        commands.push({ type: 'start', zone, minutes });
      },
      stackZone: async (zone, minutes) => {
        commands.push({ type: 'stack', zone, minutes });
      },
      stopIrrigation: async () => {
        commands.push({ type: 'stop' });
      },
    },
    stackRunRequests: false,
  });

  const accessory = matter.registrations[0].accessories[0];

  await accessory.handlers.valveConfigurationAndControl.open({ openDuration: 180 });

  assert.deepEqual(commands, [
    { type: 'start', zone: 1, minutes: 3 },
  ]);
  assert.deepEqual(runtime.getZoneState(1), {
    zone: 1,
    active: true,
    durationSeconds: 180,
    remainingDurationSeconds: 180,
  });
  assert.equal(await accessory.getState('valveConfigurationAndControl', 'defaultOpenDuration'), 180);
  assert.equal(await accessory.getState('valveConfigurationAndControl', 'openDuration'), 180);
  assert.equal(await accessory.getState('valveConfigurationAndControl', 'remainingDuration'), 180);
  assert.equal(await accessory.getState('valveConfigurationAndControl', 'currentState'), 1);

  await accessory.handlers.valveConfigurationAndControl.close();

  assert.deepEqual(commands, [
    { type: 'start', zone: 1, minutes: 3 },
    { type: 'stop' },
  ]);
  assert.deepEqual(runtime.getZoneState(1), {
    zone: 1,
    active: false,
    durationSeconds: 180,
    remainingDurationSeconds: 0,
  });
  assert.equal(await accessory.getState('valveConfigurationAndControl', 'remainingDuration'), 0);
  assert.equal(await accessory.getState('valveConfigurationAndControl', 'currentState'), 0);
});

test('Matter zone valve bridge pushes refreshed active state and remaining duration into published Matter accessories', async () => {
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

  await bridge.ensureController({
    name: 'Back Yard',
    serial: 'RB-1',
    modelName: 'ESP-ME3',
    matterZoneValves: true,
    zones: [1, 3],
    zoneNames: ['Front Lawn', 'Back Lawn', 'Side Beds'],
    zoneRuntime: runtime,
  });

  runtime.setActiveZones([3]);
  runtime.setZoneRemainingDurationSeconds(3, 125);

  await bridge.syncControllerState({
    name: 'Back Yard',
    serial: 'RB-1',
    modelName: 'ESP-ME3',
    matterZoneValves: true,
    zones: [1, 3],
    zoneNames: ['Front Lawn', 'Back Lawn', 'Side Beds'],
    zoneRuntime: runtime,
  });

  assert.deepEqual(matter.stateUpdates, [
    {
      uuid: 'uuid:rainbird-matter-zone-valve:RB-1:1',
      cluster: 'valveConfigurationAndControl',
      attributes: {
        currentState: 0,
        targetState: 0,
        defaultOpenDuration: 240,
        openDuration: 240,
        remainingDuration: 0,
      },
      partId: undefined,
    },
    {
      uuid: 'uuid:rainbird-matter-zone-valve:RB-1:3',
      cluster: 'valveConfigurationAndControl',
      attributes: {
        currentState: 1,
        targetState: 1,
        defaultOpenDuration: 480,
        openDuration: 480,
        remainingDuration: 125,
      },
      partId: undefined,
    },
  ]);
});

test('RainbirdPlatform refreshStatus pushes queue-backed remaining duration into Matter zone valves', async () => {
  const runtime = {
    key: '192.0.2.10#0',
    name: 'Back Yard',
    ignoredZones: new Set(),
    controller: {
      getActiveStations: async () => [3],
      getRainSensorState: async () => false,
      getRainDelay: async () => 0,
      getCurrentQueue: async () => ({
        currentProgram: { zone: 3, seconds: 125 },
        zones: [],
      }),
    },
    zoneRuntime: createZoneRuntime([3], 10),
    refreshTick: 0,
    refreshInProgress: false,
    consecutiveRefreshFailures: 0,
    programSwitches: [],
    lastQueueSignature: undefined,
    serial: 'RB-1',
    modelName: 'ESP-ME3',
    matterZoneValves: true,
    zones: [3],
    zoneNames: ['Side Beds'],
  };

  const syncCalls = [];
  const fakePlatform = {
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    accessories: new Map(),
    handlers: new Map(),
    api: {
      hap: {
        uuid: {
          generate: (value) => value,
        },
      },
    },
    matterZoneValveBridge: {
      syncControllerState: async (controller) => {
        syncCalls.push({
          active: controller.zoneRuntime.getZoneState(3).active,
          remainingDurationSeconds: controller.zoneRuntime.getZoneRemainingDurationSeconds(3),
        });
      },
    },
    logProgramMetadata: () => undefined,
  };

  await RainbirdPlatform.prototype.refreshStatus.call(fakePlatform, runtime);

  assert.equal(runtime.zoneRuntime.getZoneRemainingDurationSeconds(3), 125);
  assert.deepEqual(syncCalls, [
    {
      active: true,
      remainingDurationSeconds: 125,
    },
  ]);
});
