# Athere Validated Skill Library (Item 22)

Reusable skills from validated (gated) experience. **Skills evolve through versioning — never silent mutation.**

## Skill record fields

purpose, inputs, outputs, prerequisites, procedure, verificationMethod, historicalSuccessRate, failureRate, compatibleModels, cost, version, provenance

## Acceptance

Athere can reuse validated experience rather than re-deriving every procedure from scratch (`reuse` / `reuseSkill` sets `derivedFromScratch: false`).

## API

- `packages/contracts/src/skill-library.js` — `normalizeSkill`, `assertSkillImmutable`
- `packages/skills/src/validated-skill-library.js` — `createValidatedSkillLibrary({ learning })`
- `publishFromLesson` — only from Item 21 permanent lessons
- `publishVersion` — new version; prior versions remain readable
- `reuse` — returns procedure + metadata without re-deriving
- `mutateInPlace` — always rejected
- `service.publishSkillFromLesson` / `service.reuseSkill` / `service.listSkills`

## Security (local)

- Unvalidated / missing lessons cannot publish
- Skill versions require a **new** gated permanent lesson (no unvalidated `publishVersion`)
- `historicalSuccessRate + failureRate` cannot exceed 1
- Silent in-place mutation rejected
- Hard caps: `MAX_SKILLS` (64) / `MAX_SKILL_VERSIONS` (32) fail closed
- Unbranded skill libraries / unbranded learning `listPermanent` forgery rejected (WeakSet brands)
- Skill library must bind the same learning pipeline instance as the mission service
- `skillLibrary` / `skills` via generic `transition` rejected
- No new HTTP surface
- Skills are process-local library state (not mission-hash authority)

## Deferred

**Mission-hash the skill library — skipped for now (ACTIVE_RUN checkpoint 81).** May swing back later: bind mission-scoped skill id/version/contentHash via gated ops so `stateHash` covers reuse, without embedding the global process library into every mission.

## Evidence

- `tests/contract/skill-library.test.js`
- `tests/integration/skill-library-item22.test.js`
- `tests/integration/skill-library-item22-security.test.js`
- `tests/integration/mea-hostile-items-22-23-harden.test.js`
