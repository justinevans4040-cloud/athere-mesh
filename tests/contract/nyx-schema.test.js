import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNyxSchema,
  assertNyxKillSwitch,
  NYX_SCHEMA_VERSION,
  NYX_TOOL_IDS,
} from '../../packages/nyx/src/nyx-schema.js';

test('NYX schema freezes identity, tools, peers, and kill switch', () => {
  const schema = createNyxSchema();
  assert.equal(schema.version, NYX_SCHEMA_VERSION);
  assert.equal(schema.identity, 'nyx-coding-operator');
  assert.equal(schema.killSwitch, false);
  assert.ok(schema.tools.includes('run_tests'));
  assert.equal(schema.peers.integrity, 'rune');
  assert.equal(NYX_TOOL_IDS.length, 7);
});

test('NYX kill switch blocks execution path', () => {
  const schema = createNyxSchema({ killSwitch: true });
  assert.throws(() => assertNyxKillSwitch(schema), /kill switch/i);
});
