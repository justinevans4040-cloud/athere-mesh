# RuCelium Useful Code Extraction

> **INACTIVE / QUARANTINED:** Retained for future Athere Mesh development.
> This code is not wired into Titan, Redis, the Resonance Bus, or any current
> runtime. It requires security, architecture, license, and integration review
> before use.

This is a focused, unmodified-source extraction from `ruvnet/RuCelium` for
evaluation and later integration into ForgeFront WAKE / Athere Mesh systems.

## Source

- Repository: https://github.com/ruvnet/RuCelium
- Exact source commit: `813da13eb9a46b6acf78fe7ecc8c220ecf83b386`
- Extracted: 2026-08-12
- License: MIT; the upstream `LICENSE` is included.

No upstream Rust source files in this package were rewritten. The workspace
manifest and this documentation were added to make the selected crates a
standalone evaluation bundle.

## Included crates

| Crate | Potential ForgeFront use |
| --- | --- |
| `rucelium-core` | Shared sensor/event data types and validation |
| `rucelium-abi` | Compact binary records, CBOR and signed envelopes |
| `rucelium-transport` | MTU fragmentation/reassembly for constrained links |
| `rucelium-ingest` | Device registry, revocation, signature checks and replay protection |
| `rucelium-store` | Append-only segmented records, dedup and crash recovery |
| `rucelium-calibration` | Calibration lineage, drift detection and node quarantine |
| `rucelium-notary` | Merkle evidence batches and inclusion proofs |
| `rucelium-policy` | Governed agent/action authorization pipeline |
| `rufield-core` | Generic field-event, tensor and privacy data model |
| `rufield-privacy` | Privacy classification and consent/identity policy guard |

## Recommended WAKE path

1. Android/Termux node creates a sample.
2. `rucelium-abi` serializes and signs it.
3. `rucelium-transport` fragments it if necessary.
4. The Dell controller reassembles the message.
5. `rucelium-ingest` verifies identity, revocation and sequence freshness.
6. `rucelium-store` records the accepted sample.
7. `rucelium-notary` produces durable tamper-evidence.
8. Apache Ignite or another WAKE service consumes only accepted records.

This code does not implement Apache Ignite, distributed RAM, Android hardware
collection or live Wi-Fi CSI capture. It supplies trust, transport, storage and
governance components around those systems.

## Deliberately excluded

The runnable `rucelium-gateway` daemon is not included. Upstream v0.1 binds its
HTTP and UDP services to all interfaces, exposes unauthenticated administrative
endpoints, and derives production-sensitive identities from a predictable
numeric seed. It should not be deployed unchanged.

Synthetic sensing, benchmark and viewer crates are also excluded. Their
benchmark results do not establish real-world sensor accuracy.

## Before production integration

- Replace deterministic numeric key derivation with OS-generated Ed25519 keys
  stored in an appropriate secret store or hardware-backed keystore.
- Put all administrative endpoints behind strong authentication and explicit
  Tailscale ACLs.
- Add protocol version negotiation and a migration policy before freezing a
  wire format.
- Threat-model denial-of-service behavior, storage exhaustion, key rotation,
  compromised nodes and controller recovery.
- Run `cargo test --workspace`, `cargo clippy --workspace -- -W clippy::all`,
  dependency auditing and ForgeFront-specific integration tests.
- Retain this MIT license and upstream attribution when copying substantial
  portions.

## Verification status

The upstream commit passed its GitHub Actions build, test, Clippy and synthetic
benchmark workflow. This extraction was structurally checked, but Cargo was not
installed in the extraction environment, so it was not recompiled locally.
