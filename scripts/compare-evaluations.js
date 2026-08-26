import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { compareEvaluationCohorts } from '../packages/evaluation/src/evaluation-harness.js';

const [controlArgument, candidateArgument] = process.argv.slice(2);
if (!controlArgument || !candidateArgument) {
  throw new Error('usage: pnpm evaluation:compare <frozen-control.json> <candidate.json>');
}

async function readCohort(argument) {
  const filePath = path.resolve(process.cwd(), argument);
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read evaluation cohort: ${argument}`, { cause: error });
  }
}

const report = compareEvaluationCohorts({
  control: await readCohort(controlArgument),
  candidate: await readCohort(candidateArgument),
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.verdict === 'regression') process.exitCode = 2;
