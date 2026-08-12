# FUTURE INTEGRATIONS — QUARANTINED RESEARCH MATERIAL

> **BIG FLAG:** Nothing in this directory is active Athere Mesh production
> code. Nothing here should be deployed, imported into Titan, or connected to
> the Resonance Bus until it has passed a ForgeFront architecture review,
> license review, hostile security audit, and integration tests.

This directory preserves useful third-party source and research discovered for
future Athere Mesh development. It is intentionally isolated from current
runtime code so promising material can be retained without quietly changing
the product or overstating implementation status.

## Contents

| Area | Status | Purpose |
| --- | --- | --- |
| [`rucelium/`](rucelium/) | Source retained; inactive | Signed node envelopes, replay protection, constrained transport, durable logs, calibration drift/quarantine, Merkle evidence and governed actions |
| [`self-hosted-candidates/`](self-hosted-candidates/) | Research shortlist; no vendored code | Candidate systems for fleet operations, workflows, alerts, synchronization, storage, remote management and agent observability |

## Mandatory activation gate

Before any component becomes part of Athere Mesh:

1. Pin the exact upstream commit and preserve its license.
2. Identify the narrow capability being adopted; do not import an entire
   platform when a small interface is sufficient.
3. Threat-model keys, authentication, authorization, network exposure,
   persistence, compromised nodes and recovery.
4. Bind administrative traffic to Tailscale with explicit ACLs.
5. Prove behavior with reproducible tests and evidence artifacts.
6. Record the decision in current architecture and progress documentation.

The directory is a source quarry, not a claim that these capabilities are
already implemented.
