import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TITAN_CORE_V2_CONTROL_ID,
  buildEfficiencyCandidateCohort,
  loadFrozenEvaluationControl,
} from '../../packages/evaluation/src/evaluation-harness.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function loadItem21HarnessCandidate({
  repositoryRoot = REPO_ROOT,
  controlId = TITAN_CORE_V2_CONTROL_ID,
  latencyDeltaMs = -200,
} = {}) {
  const loaded = await loadFrozenEvaluationControl({ root: repositoryRoot, controlId });
  return Object.freeze({
    repositoryRoot,
    controlId,
    control: loaded.cohort,
    controlSha256: loaded.sha256,
    candidateCohort: buildEfficiencyCandidateCohort(loaded.cohort, { latencyDeltaMs }),
  });
}

export { REPO_ROOT as ATHERE_REPO_ROOT, TITAN_CORE_V2_CONTROL_ID };
