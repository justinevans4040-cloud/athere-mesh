import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  prepareContextPackage,
  readPreparedContext,
  resolvePreparedContext,
  writePreparedContext,
} from '../../packages/memory/src/prepared-context.js';

const MISSION_ID = 'mission-context-resolution';

function serviceFixture({ stateVersion = 7, stateHash = 'a'.repeat(64) } = {}) {
  const selected = {
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
  return {
    async retrieveMemory({ query }) {
      return {
        missionId: MISSION_ID,
        reader: 'orchestrator',
        query: { ...query, preferCurrent: true },
        selected,
        candidates: [selected],
        mode: 'state_aware',
      };
    },
    async select() {
      return {
        missionId: MISSION_ID,
        stateVersion,
        currentFacts: [{
          id: 'fact-current',
          key: 'SERVER_IP',
          value: '10.0.0.2',
          status: 'current',
        }],
      };
    },
    async verifyHistory() {
      return {
        valid: true,
        integrityBound: true,
        missionId: MISSION_ID,
        stateVersion,
        stateHash,
      };
    },
  };
}

async function preparedFor(service) {
  return prepareContextPackage({
    service,
    missionId: MISSION_ID,
    reader: 'orchestrator',
    query: { key: 'SERVER_IP' },
    maxEstimatedTokens: 1024,
  });
}

test('read rejects a different valid package stored under the requested handle path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-context-path-binding-'));
  const first = await preparedFor(serviceFixture());
  const second = await preparedFor(serviceFixture({ stateVersion: 8, stateHash: 'b'.repeat(64) }));
  const ref = await writePreparedContext({ root, contextPackage: first });

  await writeFile(path.join(root, ref.path), `${JSON.stringify(second)}\n`, 'utf8');

  await assert.rejects(
    () => readPreparedContext({ root, handle: first.handle }),
    /prepared-context handle does not match requested handle/,
  );
});

test('resolver activates only the package bound to the current verified mission revision', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-context-resolution-'));
  const currentService = serviceFixture();
  const prepared = await preparedFor(currentService);
  await writePreparedContext({ root, contextPackage: prepared });

  const resolved = await resolvePreparedContext({
    root,
    handle: prepared.handle,
    service: currentService,
    reader: 'orchestrator',
  });
  assert.deepEqual(resolved, prepared);

  await assert.rejects(
    () => resolvePreparedContext({
      root,
      handle: prepared.handle,
      service: serviceFixture({ stateVersion: 8, stateHash: 'b'.repeat(64) }),
      reader: 'orchestrator',
    }),
    /prepared-context is stale for current mission state/,
  );
});

test('resolver will not activate a package for a different reader', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-context-reader-binding-'));
  const service = serviceFixture();
  const prepared = await preparedFor(service);
  await writePreparedContext({ root, contextPackage: prepared });

  await assert.rejects(
    () => resolvePreparedContext({
      root,
      handle: prepared.handle,
      service,
      reader: 'auditor',
    }),
    /prepared-context reader mismatch/,
  );
});
