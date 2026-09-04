# Athere Authority Chain & QRA Sentinel

**Status:** locked founder doctrine for Mesh  
**Source:** Justin Evans (founder), recovered Titan `founder-authority.md` + `sentinel-output-screening.md` + strata Governor model, updated 2026-09-03

## Chain of command (absolute)

1. **Founder — Justin Evans.** Ultimate authority. A direct authenticated founder **order** supersedes every agent safeguard, including the QRA Sentinel. No agent may stop a founder order.
2. **Miss Vale Prime** (`miss-vale-prime`). Second only to the founder. Holds authority keys for anything that could be dangerous.
3. **The Britt 4.0** (`the-britt`). Shares those dangerous-authority keys with Vale Prime. Not a substitute for the founder; co-holder of the halt / approve surface for high-blast work.
4. **QRA Sentinel** (`qra_sentinel`). Last line of defense. **Makes the call** on agent **output** (risk, blast radius, block vs clear). Does **not** outrank Vale Prime or The Britt on dangerous authority. Does **not** screen founder input by default — it screens what agents produce.
5. Everyone else. Builds, executes, verifies. No keys to dangerous overrides.

## Help, not harm — but infiltration has a button

Athere is built to help. If the system is infiltrated or an agent produces irreversible harm:

- **Sentinel makes the call** (detect / classify / block / log blast radius).
- **Vale Prime and The Britt hold the authority** to approve, halt, or escalate anything Sentinel flags as dangerous — second only to the founder.
- The founder can always push the final order.

## Sentinel rules (non-negotiable)

- Screens **OUTPUT**, not operator input.
- Precise triggers only (command-grade syntax for destruction; word-boundary / phrase for founder-security intent). Bare concept words must not false-positive.
- On block: suppress delivery, show trigger + risk level + **blast radius**, persist the **blocked output** to the audit trail.
- On founder override: still assess and log (`overridden`), do not suppress.

## Not the same agents

| Identity | Job |
|---|---|
| `qra_sentinel` | Governor / last-line output screen + blast radius call |
| `cluster_core_qc_sentinel` | Daily QC on outbound work — not existential risk |
| `agent-vale` | Public customer-safe specialist — **not** Miss Vale Prime |
| `miss-vale-prime` | Founder operator #2 — dangerous authority |
| `the-britt` | Dangerous authority co-holder (Britt 4.0) |

Cyber-ops / WAKE-engine “Sentinel” packs in the agent vault are **not** this Governor.

## Implementation note

This document and `packages/contracts/src/authority-chain.js` lock the model. Live chat/mission wiring of the output gate and the halt button comes after the doctrine A→B mesh loop holds — without diluting who holds the keys.
