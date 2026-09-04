# Athere Layered QR18 Verification — CURRENT (2026-09-04)

**Status:** implemented. Backlog **Item 10**.

## Acceptance

> Every important completion claim can be traced to its evidence and verifier.

QR18 is no longer a single completion hash check. Completion requires structured Levels 1–6, each with evidence. A bare PASS/FAIL is not accepted.

## Levels

| Level | Id | Question |
|---|---|---|
| 1 | `action` | Did recorded work evidence / performers exist? |
| 2 | `artifact` | Is there verified artifact lineage (hash + producer agent/action + verifier)? |
| 3 | `state-transition` | Is the certifier independent of recorded performers? |
| 4 | `subgoal` | Does `completedWork` cover the plan/subgoals? |
| 5 | `workflow` | Empty pending/failed work; dependencies satisfied? |
| 6 | `mission` | Did service `verifyProof` succeed against an objective? |

## Authority

- Evaluator: `packages/proof/src/qr18-layered-verification.js` (`evaluateQr18Layers`)
- Gate: `packages/mission/src/mission-state-service.js` re-evaluates on every `completed` transition and **ignores** caller-supplied `qr18` bags
- Owner path: `packages/orchestrator/src/mission-orchestrator.js` attaches the evaluated structure to `result.qr18` before the completion transition

Proof store primitives (`writeProof` / `verifyProof` / artifact proofs) are unchanged and remain Level 6 / Level 2 inputs — not replaced.

## What this does not do

- Item 11 workflow/plan graphs (still prose/`currentPlan` + dependencies)
- Model-confidence substitution for QR18 (forbidden by backlog)
- Multi-writer / Tailscale-native Postgres changes
