import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createPreparedContextBinder } from '../../packages/agent/src/prepared-context-binding.js';

const MISSION_ID = 'mission-context-invocation';
const CURRENT_HASH = 'a'.repeat(64);
const STALE_HASH = 'b'.repeat(64);

function selectedMemory() {
  return {
    id: `${MISSION_ID}:semantic:fact-current`,
    memoryType: 'semantic',
    content: {
      id: 'fact-current',
      key: 'SERVER_IP',
      status: 'current',
      valueRedacted: true,
    },
    provenance: {
      source: 'authoritativeFacts',
      missionId: MISSION_ID,
      factId: 'fact-current',
      key: 'SERVER_IP',
    },
    confidence: 1,
    validationState: 'current',
    score: 38,
    scoreReasons: ['authoritative_current', 'key_match'],
  };
}

function serviceFixture({ staleAtResolve = false } = {}) {
  let verificationCalls = 0;
  const selected = selectedMemory();
  return {
    async retrieveMemory({ query }) {
      return {
        missionId: MISSION_ID,
        reader: 'nyx',
        query: { ...query, preferCurrent: true },
        selected,
        candidates: [selected],
        mode: 'state_aware',
      };
    },
    async select() {
      return {
        missionId: MISSION_ID,
        stateVersion: 7,
        currentFacts: [{
          id: 'fact-current',
          key: 'SERVER_IP',
          value: '10.0.0.2',
          status: 'current',
        }],
      };
    },
    async verifyHistory() {
      verificationCalls += 1;
      const stale = staleAtResolve && verificationCalls >= 3;
      return {
        valid: true,
        integrityBound: true,
        missionId: MISSION_ID,
        stateVersion: stale ? 8 : 7,
        stateHash: stale ? STALE_HASH : CURRENT_HASH,
      };
    },
  };
}

test('binder returns exact resolved current context identity for provider invocation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-context-bind-'));
  try {
    const binder = createPreparedContextBinder({ service: serviceFixture(), root });
    const bound = await binder.bind({
      missionId: MISSION_ID,
      reader: 'nyx',
      query: { key: 'SERVER_IP' },
      maxEstimatedTokens: 1024,
    });

    assert.match(bound.handle, /^ctx_[a-f0-9]{32}$/);
    assert.match(bound.integritySha256, /^[a-f0-9]{64}$/);
    assert.equal(bound.missionId, MISSION_ID);
    assert.equal(bound.stateVersion, 7);
    assert.equal(bound.stateHash, CURRENT_HASH);
    assert.equal(bound.reader, 'nyx');
    assert.equal(bound.context.entries[0].content.value, '10.0.0.2');
    assert.equal(bound.stats.selectedCount, 1);
    assert.ok(Object.isFrozen(bound));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binder fails closed when mission state changes before activation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-context-stale-bind-'));
  try {
    const binder = createPreparedContextBinder({ service: serviceFixture({ staleAtResolve: true }), root });
    await assert.rejects(
      () => binder.bind({ missionId: MISSION_ID, reader: 'nyx' }),
      /prepared-context is stale for current mission state/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binder output does not expose authority services or storage roots', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-context-safe-bind-'));
  try {
    const binder = createPreparedContextBinder({ service: serviceFixture(), root });
    const bound = await binder.bind({ missionId: MISSION_ID, reader: 'nyx' });
    assert.equal('service' in bound, false);
    assert.equal('root' in bound, false);
    assert.equal('verifyHistory' in bound, false);
    assert.equal('writePreparedContext' in bound, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
