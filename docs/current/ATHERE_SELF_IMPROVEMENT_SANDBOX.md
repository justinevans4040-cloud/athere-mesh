# Athere Self-Improvement Sandbox (Item 23)

Controlled experimental improvement. **Never:** agent modifies itself → says it is better → production.

## Pipeline

`PROPOSE` → `SANDBOX` → `BENCHMARK` → `COMPARE WITH FROZEN CONTROL` → `SECURITY CHECK` → `QR18 VALIDATION` → `APPROVE` → `DEPLOY` → `MONITOR` → `ROLLBACK IF REQUIRED`

## Targets

prompts, workflows, routing_policies, skills, tools, memory_strategy, planning_strategy, agent_implementations, code

## Acceptance

Athere can experimentally improve itself without allowing uncontrolled self-modification.

## API

- `packages/contracts/src/self-improvement.js`
- `packages/improvement/src/self-improvement-sandbox.js` — `createSelfImprovementSandbox()`
- `service.runImprovementPipeline(...)`
- `service.deployImprovementToProduction(...)` — always rejected (self-declare path)
- `service.listImprovementProposals()`

Approvers/deployers: `qra_emerge_audit`, `miss-vale-prime` only.

## Security (local)

- Stage skips rejected
- Frozen-control regression rejected
- Self-declare-better → production rejected
- Security `passed: true` with findings rejected; benchmark `securityFindings > 0` cannot pass security
- Proposer cannot approve or deploy own proposal (separation of duties)
- Approver cannot also deploy the same proposal
- Monitor requires approver or deployer actor (unauthorized monitor REJECT)
- Hard cap: `MAX_IMPROVEMENT_PROPOSALS` (64) fail closed
- Executor cannot approve/deploy
- `selfImprovement` via generic `transition` rejected
- No new HTTP surface; no GitHub review

## Evidence

- `tests/contract/self-improvement.test.js`
- `tests/integration/self-improvement-item23.test.js`
- `tests/integration/self-improvement-item23-security.test.js`
- `tests/integration/mea-hostile-items-22-23-harden.test.js`
