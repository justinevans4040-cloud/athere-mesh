# ATHERE Mesh Workflow — CURRENT (2026-07-27)

> Historical brochure workflow: [archive/iterations/2026-07-brochure-v0/docs/WORKFLOW.md](../archive/iterations/2026-07-brochure-v0/docs/WORKFLOW.md)

## Mission lifecycle (CURRENT)

1. Operator submits intent in Titan.
2. Titan frames the mission and posts `accepted` on the Resonance Bus.
3. Workers advance `running` (deterministic-first when possible).
4. Blockers emit `blocked` with reason (COMS `BLOCK`).
5. Completion requires `completed` **plus proof** (artifact / hash) — COMS `DONE`.
6. Hot state lives on the Redis RAM pool; durable audit follows in later slices.
7. Handoffs are signal + ownership claims (`CLAIM` / `REVIEW`), not essay threads.

## Design outcome

A resilient loop that judges can verify: mission → signals → proof — with a public iteration trail in `archive/`.
