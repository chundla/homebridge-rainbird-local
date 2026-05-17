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
