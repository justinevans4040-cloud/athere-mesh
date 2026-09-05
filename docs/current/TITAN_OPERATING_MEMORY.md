# Titan operating memory — 2026-08-23

This is the durable handoff for future work on Titan. Treat it as operational context, not proof that unfinished work is complete.

## Public identity (outreach / email / vendor contact — HARD)

Do not invent or substitute. Load this before any external email, sample request, partnership ask, or company-facing copy.

- **Company:** ForgeFront Systems
- **Founder:** Justin Evans
- **Email:** justin.evans4040@gmail.com
- **Public site:** https://forgefront-systems.vercel.app
- **Products under ForgeFront (not company names):** Athere Mesh, Titan, Edge Nodes, ForgeFront Command
- **Forbidden in signatures:** wakeforged.com as the company site; signing as “Athere Mesh / Titan” instead of ForgeFront Systems

## Live operator faces (2026-09-05)

- Command Deck (Lenovo): `http://127.0.0.1:5050/` — start with Titan/Ollama tokens only; do not import Ichabod `DATABASE_URL` on Lenovo.
- Command Deck (Ichabod tunnel): `http://127.0.0.1:15050/`
- ForgeFront Solar/PM (tunnel → Ichabod `:8787`): `http://127.0.0.1:18787/` and `/pm`
- Sales Hunter Tier Zero may merge qualified pipeline into ForgeFront `/api/state` when ingest is explicitly enabled.
- Next capability under Zero: `outreach_send` with `humanApproved:true` (one lead) → local outbox + CRM follow-up. `phone_call` still denied.

## Canonical locations

- Local repository: `C:\Users\justi\Titan`
- GitHub: `https://github.com/justinevans4040-cloud/athere-mesh`
- Branch: `master`
- Google Drive Athere Mesh root: `1vPrBHfcvC8T2KSCgvmW-cWQOVZMUsisU`
- Programming-backup folder: `1tndsSXC2BjZVcsF5GLZi-oKdUzaUV45_`
- Verified archive: `17u1FlBl7AzVJCektSo586HpJGJvz0KPF`
- Backup record: `1Zl41GNoUa_VYyTCLlW0BsaLrfkL3_Tvj`

## Operating boundaries

- Titan is a reconstruction after the original machine loss; do not describe it as the recovered original.
- Use ordinary language at the operator surface. JSON is an internal transport, not a user requirement.
- Claims require fresh executable evidence. Record incomplete or blocked work honestly.
- Preserve existing artifacts and history. Do not remove material unless Justin explicitly requests the exact removal.
- Keep approvals proportional: read-only and ordinary in-scope operations should run directly; require confirmation only when privilege or meaningful risk actually requires it.
- Odin is outside Titan's team and outside this repository's scope. Mentions are historical context only; do not inspect, modify, deploy, or bind Odin.
- Redis/S24 integration remains last because it requires Justin and the S24.

## Ichabod access

- Host: `ichabodcrane`
- Tailscale address verified on 2026-08-23: `100.77.131.28`
- User: `the_founder`
- Lenovo key: `C:\Users\justi\.ssh\id_ed25519`
- Verified PowerShell route: `ssh -i "$env:USERPROFILE\.ssh\id_ed25519" the_founder@100.77.131.28`
- The short hostname resolved over a different IPv6 route during verification; prefer the verified Tailscale route until its SSH host-key routing is reconciled.

## Live Ollama boundary

- Last verified service state: active and responsive at `http://127.0.0.1:11434`.
- Last verified effective bind: `OLLAMA_HOST=0.0.0.0:11434`, listening on all IPv4 interfaces.
- `/etc/systemd/system/ollama.service.d/override.conf` also contained that all-interface value.
- Loopback hardening was prepared but not applied because Ubuntu required interactive sudo authentication. Do not claim it is fixed until `systemctl show`, `ss`, and the loopback API probe all prove the effective listener is `127.0.0.1:11434` only.
- Durable repair script: `scripts/harden-ollama-loopback.sh`. It adds a later systemd drop-in without removing the existing one and refuses to report success unless the effective environment, listener, and API probe pass.

## Backup proof

See [TITAN_PROGRAMMING_BACKUP.md](TITAN_PROGRAMMING_BACKUP.md) for the private Drive archive, SHA-256, included content, test count, credential scan, and exact status boundary.
