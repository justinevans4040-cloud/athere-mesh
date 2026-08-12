# Self-hosted Infrastructure Candidates

> **RESEARCH ONLY — NO THIRD-PARTY RUNTIME CODE IS VENDORED HERE.**

Source catalog: https://github.com/awesome-selfhosted/awesome-selfhosted  
Catalog commit reviewed: `40b727016bb9b6163e2f5a4f6f254196c5bc49bf`  
Reviewed: 2026-08-12

The catalog itself is a curated list, not an application worth importing.
These are the strongest candidates discovered for later Athere Mesh work.

## Priority shortlist

| Priority | Project | Potential Athere Mesh role | License note | Integration posture |
| --- | --- | --- | --- | --- |
| 1 | [HomeButler](https://github.com/Higangssh/homebutler) | Narrow MCP/JSON interface for server health, Docker inventory, ports, restart evidence, backup drills, Wake-on-LAN and remote operations | MIT | Audit first; strongest candidate for Titan operator tooling |
| 2 | [Dagu](https://github.com/dagucloud/dagu) | Local-first workflows over scripts, SSH, containers and AI-agent tasks | GPL-3.0 | Prefer separate service/API use; review copyleft obligations before copying code |
| 3 | [ntfy](https://github.com/binwiederhier/ntfy) | Push AetherMesh alerts and mission events to Android or desktop | Server Apache-2.0; client licensing differs | Prefer separate notification service |
| 4 | [Syncthing](https://github.com/syncthing/syncthing) | Continuous encrypted synchronization between controller, workstations and supported edge devices | MPL-2.0 | Integrate as a service, not copied internals |
| 5 | [SeaweedFS](https://github.com/seaweedfs/seaweedfs) | Horizontally scalable file/object layer for large evidence and artifact collections | Apache-2.0 | Evaluate only if existing storage cannot meet the requirement |
| 6 | [MeshCentral](https://github.com/Ylianst/MeshCentral) | Remote monitoring, terminal and desktop control for compatible computers | Apache-2.0 | Keep behind Tailscale; validate agent/device support |
| 7 | [Node-RED](https://github.com/node-red/node-red) | Visual event routing between devices, APIs and services | Apache-2.0 | Optional adapter layer; do not make it the core Resonance Bus |
| 8 | [Langfuse](https://github.com/langfuse/langfuse) | LLM/agent traces, evaluation, prompt history and operational metrics | Mixed/current terms require review | Evaluate as an external observability service |

## Best immediate lead: HomeButler

HomeButler closely overlaps the unfinished operator surface around Athere Mesh:

- CPU, RAM, disk, process and port inventory
- Docker and systemd state
- multi-server operations
- crash evidence and restart-loop detection
- backup restore drills
- browser and terminal dashboards
- Wake-on-LAN
- structured JSON and MCP access for agents without unrestricted shell access

It should be audited as a source of patterns and possibly used as a separate
operator tool. It must not be silently relabeled as Titan or treated as proof
that Titan is complete.

## Architectural fit

The candidates complement rather than replace the current design:

- Redis RAM pool remains hot shared state and transport.
- Resonance Bus remains the typed proof-bearing coordination contract.
- RuCelium-derived components may strengthen signed ingest, replay protection
  and durable evidence.
- HomeButler or MeshCentral may expose host operations through constrained
  interfaces.
- Dagu may schedule repeatable missions.
- ntfy may carry operator alerts.
- Syncthing or SeaweedFS may handle artifacts that do not belong in Redis.
- Langfuse may observe model calls without becoming the source of truth.

## Do not do

- Do not clone all catalog projects into this repository.
- Do not run multiple overlapping control planes without a written ownership
  boundary.
- Do not expose dashboards or administration ports directly to the internet.
- Do not copy GPL, AGPL, MPL or mixed-license source into proprietary modules
  without a specific license determination.
- Do not describe a candidate as integrated until tests and evidence exist.
