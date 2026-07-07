import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distResources = join(repoRoot, 'dist', 'resources');
const srcResources = join(repoRoot, 'src', 'resources');

const requiredYaml = ['sipcommands.yaml', 'models.yaml'];

test('build copies src/resources into dist/resources', () => {
  assert.ok(existsSync(distResources), 'dist/resources must exist after npm run build');
  for (const name of requiredYaml) {
    const distPath = join(distResources, name);
    const srcPath = join(srcResources, name);
    assert.ok(existsSync(distPath), `missing ${distPath}`);
    assert.ok(existsSync(srcPath), `missing source ${srcPath}`);
    assert.equal(
      readFileSync(distPath, 'utf8'),
      readFileSync(srcPath, 'utf8'),
      `${name} in dist must match src/resources (run build after YAML edits)`,
    );
  }
});