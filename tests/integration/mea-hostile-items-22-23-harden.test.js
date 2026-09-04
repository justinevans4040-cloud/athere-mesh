import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SKILLS,
  MAX_SKILL_VERSIONS,
  createValidatedSkillLibrary,
} from '../../packages/skills/src/validated-skill-library.js';
import {
  MAX_IMPROVEMENT_PROPOSALS,
  createSelfImprovementSandbox,
} from '../../packages/improvement/src/self-improvement-sandbox.js';

function skillBody(id) {
  return {
    id,
    purpose: 'p',
    inputs: ['a'],
    outputs: ['b'],
    prerequisites: ['c'],
    procedure: ['d'],
    verificationMethod: 'e',
    historicalSuccessRate: 0.5,
    failureRate: 0.5,
    compatibleModels: ['local'],
    cost: { max_tool_calls: 1, max_state_mutations: 1 },
  };
}

test('H22: skill library fails closed at hard skill cap', async () => {
  assert.equal(typeof MAX_SKILLS, 'number');
  const permanent = Array.from({ length: MAX_SKILLS + 1 }, (_, i) => Object.freeze({
    id: `lesson-cap-${i}`,
    stage: 'measure',
    experienceId: `exp-cap-${i}`,
    approvedBy: 'qra_emerge_audit',
  }));
  const learning = { listPermanent: () => permanent };
  const library = createValidatedSkillLibrary({ learning, now: () => '2026-09-05T09:00:00.000Z' });
  for (let i = 0; i < MAX_SKILLS; i += 1) {
    await library.publishFromLesson({
      lessonId: `lesson-cap-${i}`,
      skill: skillBody(`skill-cap-${i}`),
    });
  }
  await assert.rejects(
    () => library.publishFromLesson({
      lessonId: `lesson-cap-${MAX_SKILLS}`,
      skill: skillBody(`skill-cap-${MAX_SKILLS}`),
    }),
    /skills exceed cap/,
  );
});

test('H22: skill versions fail closed at hard version cap', async () => {
  const permanent = Array.from({ length: MAX_SKILL_VERSIONS + 1 }, (_, i) => Object.freeze({
    id: `lesson-ver-${i}`,
    stage: 'measure',
    experienceId: `exp-ver-${i}`,
    approvedBy: 'qra_emerge_audit',
  }));
  const learning = { listPermanent: () => permanent };
  const library = createValidatedSkillLibrary({ learning, now: () => '2026-09-05T09:00:00.000Z' });
  await library.publishFromLesson({
    lessonId: 'lesson-ver-0',
    skill: skillBody('skill-ver-cap'),
  });
  for (let i = 1; i < MAX_SKILL_VERSIONS; i += 1) {
    await library.publishVersion({
      skillId: 'skill-ver-cap',
      lessonId: `lesson-ver-${i}`,
      skill: skillBody('skill-ver-cap'),
    });
  }
  await assert.rejects(
    () => library.publishVersion({
      skillId: 'skill-ver-cap',
      lessonId: `lesson-ver-${MAX_SKILL_VERSIONS}`,
      skill: skillBody('skill-ver-cap'),
    }),
    /skill versions exceed cap/,
  );
});

test('H23: monitor requires authorized actor; approve-and-deploy same actor fails closed', async () => {
  assert.equal(typeof MAX_IMPROVEMENT_PROPOSALS, 'number');
  const sandbox = createSelfImprovementSandbox({ now: () => '2026-09-05T09:00:00.000Z' });
  await sandbox.propose({
    id: 'imp-harden-1',
    target: 'code',
    summary: 'x',
    change: { a: 1 },
    proposedBy: 'nyx',
  });
  await sandbox.enterSandbox({ proposalId: 'imp-harden-1' });
  await sandbox.benchmark({
    proposalId: 'imp-harden-1',
    result: { taskSuccessRate: 0.9, failedHandoffs: 0, securityFindings: 0 },
  });
  await sandbox.compareWithFrozenControl({
    proposalId: 'imp-harden-1',
    control: { taskSuccessRate: 0.4, failedHandoffs: 2, securityFindings: 0 },
  });
  await sandbox.securityCheck({
    proposalId: 'imp-harden-1',
    result: { passed: true, findings: [] },
  });
  await sandbox.qr18Validate({
    proposalId: 'imp-harden-1',
    result: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
  });
  await sandbox.approve({ proposalId: 'imp-harden-1', actor: 'qra_emerge_audit' });

  await assert.rejects(
    () => sandbox.deploy({ proposalId: 'imp-harden-1', actor: 'qra_emerge_audit' }),
    /approve-and-deploy by same actor/,
  );

  await sandbox.deploy({ proposalId: 'imp-harden-1', actor: 'miss-vale-prime' });
  await assert.rejects(
    () => sandbox.monitor({
      proposalId: 'imp-harden-1',
      observation: { healthy: false, reason: 'attacker' },
    }),
    /approver|deployer|unauthorized|must be a non-empty string|actor/,
  );
  await assert.rejects(
    () => sandbox.monitor({
      proposalId: 'imp-harden-1',
      actor: 'nyx',
      observation: { healthy: false, reason: 'attacker' },
    }),
    /unauthorized/,
  );
  const monitored = await sandbox.monitor({
    proposalId: 'imp-harden-1',
    actor: 'qra_emerge_audit',
    observation: { healthy: false, reason: 'real' },
  });
  assert.equal(monitored.monitoredBy, 'qra_emerge_audit');
});

test('H23: improvement proposal cap fails closed', async () => {
  const sandbox = createSelfImprovementSandbox({ now: () => '2026-09-05T09:00:00.000Z' });
  for (let i = 0; i < MAX_IMPROVEMENT_PROPOSALS; i += 1) {
    await sandbox.propose({
      id: `imp-cap-${i}`,
      target: 'code',
      summary: 'x',
      change: { a: 1 },
      proposedBy: 'nyx',
    });
  }
  await assert.rejects(
    () => sandbox.propose({
      id: `imp-cap-${MAX_IMPROVEMENT_PROPOSALS}`,
      target: 'code',
      summary: 'x',
      change: { a: 1 },
      proposedBy: 'nyx',
    }),
    /proposals exceed cap/,
  );
});
