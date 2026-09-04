# Athere Redis Resonance Bus — CURRENT (2026-09-03)

**Status:** implemented, opt-in, cross-host proven. **Transport only.**

This is doctrine-baseline blocker 1 of 3. It is not a numbered backlog item and
it does not advance the backlog past Item 9.

## What it is

`createRedisResonanceBus` in `packages/resonance/src/redis-resonance-bus.js` is a
second implementation of the existing resonance bus contract. It does not
replace `createMemoryResonanceBus`, which remains the reference implementation
and the default.

Both implementations satisfy one shared contract suite,
`tests/support/resonance-bus-contract.js`, run against the memory bus from
`tests/integration/resonance-bus.test.js` and against Redis from
`tests/integration/redis-resonance-bus.test.js`. The behaviour under contract is
signal ordering within a mission, idempotent republish, rejection of a reused
signal id carrying different content, mission stream isolation, and refusal of
invalid signals.

## Dependencies

**Zero npm dependencies added.** The repository production footprint is still
`@electric-sql/pglite` and `pg`.

`packages/resonance/src/resp-client.js` is a minimal RESP2 client over
`node:net`. The command surface the bus needs is `GET`, `SET`, `RPUSH`,
`LRANGE`, `SCAN`, `DEL` and `EVAL`, so a client library would have added a
dependency and supply-chain surface far larger than the protocol actually
spoken. This follows the working zero-dependency probe used to provision the
seed.

## Data model

- `athere:mesh:resonance:mission:<missionId>:signals` — a Redis `LIST`. Order is
  list order; `sequence` is the 1-based position, so a record's sequence cannot
  disagree with its position in the stream.
- `athere:mesh:resonance:signal:<signalId>` — `<contentFingerprint>:<sequence>`.

`publish` is a single atomic `EVAL`. The idempotency check, the append and the
sequence record cannot straddle two round trips, so two hosts racing the same
signal id can neither double-append nor record a sequence that disagrees with
the stream. `EVAL` is core Redis, so atomicity costs no dependency.

The namespace is configurable, which is what keeps test and evidence runs from
colliding with live mission streams.

## Seed identity guard

Before any read or write the bus reads `athere:mesh:seed:id` and compares it to
the configured `expectedSeedId`. A missing key throws, and a different value
throws. There is no permissive mode.

This exists because two other Redis units on the seed host compete for port
6379. A misconfiguration that pointed the mesh at a different, empty Redis would
read an empty stream and look like "no signals yet" — silently wrong is far
worse than crashed. `verifySeed()` returns the identity Redis actually served,
so evidence records the observed value instead of echoing the expectation.

`expectedSeedId` is mandatory at construction. `resolveRedisResonanceOptions`
throws if a host is configured without `ATHERE_MESH_REDIS_SEED_ID`.

## Configuration

Read from the environment only. **No password is stored in this repository.**

| Variable | Meaning |
|---|---|
| `ATHERE_MESH_REDIS_URL` | `redis://:password@host:port`. `rediss:` is rejected — this client speaks plaintext RESP over the tailnet. |
| `ATHERE_MESH_REDIS_HOST` / `_PORT` | Alternative to the URL. Port defaults to 6380. |
| `ATHERE_MESH_REDIS_PASSWORD` | Password inline. |
| `ATHERE_MESH_REDIS_PASSWORD_FILE` | Preferred. Reads a mode-600 file, keeping the secret out of `argv` and out of any environment a shared box can list. |
| `ATHERE_MESH_REDIS_SEED_ID` | Required whenever a host is configured. |
| `ATHERE_MESH_REDIS_SEED_KEY` | Defaults to `athere:mesh:seed:id`. |
| `ATHERE_MESH_REDIS_NAMESPACE` | Defaults to `athere:mesh:resonance`. |

`resolveRedisResonanceOptions` returns `null` when nothing is configured, which
is the offline-first default.

## Failure behaviour

Connection refusal, connect timeout, authentication failure, command timeout,
protocol error and seed guard failure all raise explicit `Error`s. Nothing
degrades to a silent no-op. A network bus that quietly returns "fine" is the
failure mode this design refuses.

## Serialization boundary (deliberate difference from the memory bus)

The memory bus holds object references, so a signal field whose value is
`undefined` or a `Date` is stored as-is. Across a transport those become
something different or vanish. `publish` therefore fingerprints the signal
before and after a JSON round trip and throws if they differ, rather than
silently transporting a changed signal. The memory bus accepts such a signal;
the Redis bus rejects it loudly. This is the one intentional divergence and it
fails safe.

## Defaults are unchanged

`createMissionOrchestrator` still defaults to `createMemoryResonanceBus()`, so
the full suite stays hermetic and runs offline. Redis is opt-in by injection.
Redis-dependent tests skip with a stated reason when the seed is unconfigured or
unreachable; in the offline default they skip without touching the network.

## What this does NOT do

- **The doctrine baseline loop is not complete.** Agent A → Agent B with zero
  human intervention needs three things; this is one of them.
- **No remote executor dispatch.** Nothing lets a mission on one host make an
  executor on another host perform work.
- **Nothing in the orchestrator uses this yet.**
- **No consumer semantics.** `read` returns the whole mission stream. There is
  no blocking read, no consumer group, no delivery tracking, no trimming.
- **Single seed host.** No replication or failover.

Shared authoritative mission state is a separate path — see
`docs/current/ATHERE_SHARED_MISSION_STATE.md` (blocker 2).

## Known residual: the orchestrator swallows publish errors

`publish()` in `packages/orchestrator/src/mission-orchestrator.js` wraps
`bus.publish` in `try { … } catch { return false }`, and every call site
discards the returned value. For the in-memory bus that is close to harmless,
because the only realistic throw is a contract violation.

For a network bus it is not acceptable. A connection failure, an auth failure or
a seed-guard refusal would be swallowed, and the mission would continue as
though the signal had been delivered — which is exactly the silent-empty-stream
failure the seed guard exists to prevent, reintroduced one layer up.

**This behaviour was left unchanged in this run** because fixing it changes
orchestrator semantics and needs its own test-first cycle with a decision about
whether a transport failure should block a mission or be recorded and continue.
It is recorded here as a blocker on wiring this bus into the orchestrator, not
as an accepted design.

## Evidence

`evidence/smoke-redis-resonance-crosshost-20260903-182344.json`. A process on
`JustinLenovo` (100.125.245.10) published to the seed on `ichabodcrane`
(100.77.131.28:6380); a separate process on `ichabodcrane`, running
byte-identical bus sources against that host's own loopback Redis, read the
signals back in order and byte-identical. Three rounds. Each round also proves
persistent idempotency: an identical re-publish from a third, separate OS
process returned `duplicate: true` at the original sequence, which
process-local deduplication cannot do.

The evidence file's `doesNotProve` list is the authoritative scope statement.
