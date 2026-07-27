# Resonance Bus — CURRENT (2026-07-27)

**Status label:** CURRENT design target

## Problem

Agent systems waste tokens and time on essay handoffs. “Done” without proof is theater.

## Design

The Resonance Bus carries **typed, compact signals** — state transitions, not conversation transcripts.

### Minimum signal classes

- Work-state: `accepted` | `running` | `blocked` | `completed`
- Proof: reference to artifact / hash / path
- Drift/risk (ready): drift detected, correction requested, halt required
- Cluster: node online / degraded / offline

### Operator shorthand (COMS-SYNTAX)

`CLAIM` · `PLAN` · `DONE` · `REVIEW` · `BLOCK`

## Transport

Hot path: Redis RAM pool (streams/lists). Consumers react without requiring an LLM round-trip for coordination.
