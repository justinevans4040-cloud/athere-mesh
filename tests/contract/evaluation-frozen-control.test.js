import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TITAN_CORE_V2_CONTROL_ID,
  TITAN_CORE_V2_CONTROL_SHA256,
  buildEfficiencyCandidateCohort,
  compareEvaluationCohorts,
  loadFrozenEvaluationControl,
} from '../../packages/evaluation/src/evaluation-harness.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('Item 2: frozen titan-core-v2 control is present and SHA-pinned', async () => {
  const loaded = await loadFrozenEvaluationControl({ root: REPO_ROOT });
  assert.equal(loaded.cohort.id, TITAN_CORE_V2_CONTROL_ID);
  assert.equal(loaded.sha256, TITAN_CORE_V2_CONTROL_SHA256);
  assert.equal(loaded.cohort.frozen, true);
  assert.equal(loaded.cohort.trials.length, 3);
});

test('Item 2: efficiency candidate against frozen control proves improvement beyond noise', async () => {
  const loaded = await loadFrozenEvaluationControl({ root: REPO_ROOT });
  const candidate = buildEfficiencyCandidateCohort(loaded.cohort);
  const verdict = compareEvaluationCohorts({ control: loaded.cohort, candidate });
  assert.equal(verdict.verdict, 'improvement_proven');
});
