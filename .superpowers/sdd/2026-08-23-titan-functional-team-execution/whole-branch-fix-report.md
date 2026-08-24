# Whole-branch hostile-audit repair report

Reviewed range: `3ad2ce7..44cf703`

Repair branch: `feature/titan-functional-execution`

## Baseline

- The supplied directory is a linked Git worktree (`GIT_DIR` differs from `GIT_COMMON_DIR`), not a submodule, on the named repair branch.
- Pre-change status was clean.
- Fresh pre-change `corepack pnpm test`: 91 tests, 91 passed, 0 failed.

## Root-cause trace and hypotheses

### Finding 1 — caller authority is not authenticated

Trace: `createTitanService()` constructs `createTitanApi({ profile: 'owner' })`; the command, mission-read, and chat handlers pass that configured profile directly to the orchestrator/runtime. No request property establishes caller identity. Loopback binding limits transport reach but browser-simple `text/plain` cross-site POSTs can still execute a handler. No `Origin` or `Sec-Fetch-Site` check exists.

Hypothesis: requiring a strong reusable bearer credential for owner command/chat/mission routes, before body reads or executor/model calls, establishes caller authority without introducing interactive per-command approval. Rejecting mismatched `Origin` and cross-site fetch metadata provides defense in depth. `/health` and `/api/team` can remain explicitly public and non-sensitive.

### Finding 2 — command execution has no admission boundary

Trace: every `POST /api/commands` independently awaits `orchestrator.execute()`. The orchestrator invokes the 300-second Node test executor, so concurrent requests start concurrent full suites. The systemd unit has restart and privilege settings but no task, memory, or CPU limit.

Hypothesis: a server-local single-flight gate acquired immediately before `orchestrator.execute()` and released in `finally` will make a concurrent request return `429` plus `Retry-After` without a second executor call, including when the first result is blocked or throws. Bounded systemd `TasksMax`, `MemoryMax`, and `CPUQuota` values can cap damage while permitting one normal Titan suite.

### Finding 3 — exclusive lock files have no reclaimable ownership

Trace: `saveMission()` creates an empty `.<mission>.lock` with `open(..., 'wx')`; cleanup removes the pathname unconditionally. A crash leaves an ownerless file. Recovery treats `mission write already in progress` as retryable, but every retry encounters the same `EEXIST`, so startup fails repeatedly. There is no owner token, PID/host identity, lease timestamp, liveness probe, or ownership check before cleanup.

Hypothesis: writing versioned owner/lease metadata (`token`, same-host `pid`, acquired/expiry times) into each exclusive lock permits deterministic liveness checks. On `EEXIST`, only a valid same-host lock whose owner is demonstrably dead is reclaimable; an active or unverifiable owner remains protected. Cleanup that verifies the current token before removal prevents a stale writer from deleting a successor lock while preserving atomic revision writes.

### Finding 4 — result evidence crosses only ephemeral boundaries

Trace: Miss Vale Prime and QRA transitions pass through `persist()`, but NYX and RUNE call `publish()` directly, so their signals exist only on the memory bus. Test totals are returned as the top-level `execute()` response and written inside the proof, but are absent from the stored mission loaded by `getMission()`. A fresh orchestrator therefore returns neither the exact counts nor persisted NYX/RUNE attribution.

Hypothesis: persist NYX and RUNE running evidence as revisioned mission signals before completion, then store the validated totals and matching agent evidence on the completed mission from the exact payload whose proof hash was verified. A fresh orchestrator/API load will reproduce the counts and attribution, with the completed record bound to the verified proof reference.

### Finding 5 — advisory errors are untyped and incompletely mapped

Trace: the runtime throws ordinary `Error`/`TypeError` instances. `publicErrorResponse()` recognizes a few message strings, but omits `request requires non-empty text` and `agent is not operational`, so expected client faults become generic HTTP 500 responses.

Hypothesis: a typed runtime error with a closed set of codes, mapped explicitly by the API to fixed public status/messages, gives empty advisory text a stable `400` and disabled agents a stable non-500 client response without reflecting arbitrary internals.

### Finding 6 — inspection names imply a Git property it never measures

Trace: `inspect()` recursively enumerates `packages/**/src` and `tests/**` with `readdir`; it never reads Git metadata. The approved plan nevertheless calls these “tracked” counts, and the archive deliberately lacks `.git`.

Hypothesis: renaming the result fields to `sourceFilesOnDisk` and `testFilesOnDisk`, and updating proof fixtures and documentation to say “current on-disk matching files,” preserves the no-shell inspection while removing the false Git-tracked claim.

## RED evidence

- Finding 1 API auth/origin: `node --test --test-name-pattern "owner routes require bearer authentication" tests/integration/functional-api.test.js` failed as intended. Actual statuses were public health/team `200/200`, then protected command/mission/chat/cross-site `200/404/200/200`; expected protected statuses were `401/401/401/403`. Executor, retrieval, and model paths were therefore reachable without caller authentication.
- Finding 1 client reuse: `node --test --test-name-pattern "functional smoke proves health" tests/integration/functional-smoke.test.js` failed because the command request had no bearer `Authorization` header.
- Finding 2 admission: `node --test --test-name-pattern "command admission is single-flight" tests/integration/functional-api.test.js` failed because the concurrent command returned `200`, not `429`.
- Finding 2 service bounds: `node --test tests/contract/service-contract.test.js` failed at the absent `TasksMax=256` assertion (and therefore had not yet reached the absent memory/CPU assertions).
- Finding 3 lock recovery: `node --test --test-name-pattern "startup recovery reclaims a demonstrably dead-owner lease" tests/integration/recovery-coordinator.test.js` failed with `mission write already in progress` at the stale `EEXIST`, reproducing the restart-loop cause.
- Finding 4 restart result: `node --test --test-name-pattern "restart retrieval preserves NYX and RUNE evidence" tests/integration/mission-orchestrator.test.js` failed because the durable agents were only `titan`, `miss-vale-prime`, and `qra_emerge_audit`; NYX and RUNE were absent.
- Finding 5 typed advisory errors: `node --test --test-name-pattern "advisory client errors use stable" tests/integration/functional-api.test.js` failed because both empty text and disabled-agent requests returned generic `500 internal server error`.
- Finding 6 metric truth: `node --test --test-name-pattern "node test executor inspects repository metadata" tests/integration/node-test-executor.test.js` failed because the implementation still returned `sourceFiles`/`testFiles` instead of the explicit on-disk names.

## GREEN evidence

- Exact focused rerun after implementation:
  - Finding 1 owner auth/origin: 1/1 passed.
  - Finding 1 smoke bearer reuse: 1/1 passed.
  - Finding 2 command single-flight/release: 1/1 passed.
  - Finding 2 service resource contract: 1/1 passed.
  - Finding 3 stale-dead reclamation plus active-owner refusal: 2/2 passed.
  - Finding 4 restart-stable evidence/totals: 1/1 passed.
  - Finding 5 typed advisory statuses: 1/1 passed.
  - Finding 6 on-disk metric names: 1/1 passed.
- Grouped touched-surface run initially reported 56/58 because two pre-existing assertions still expected the old three-revision lifecycle. Persisting NYX and RUNE intentionally makes completed/blocked post-execution missions revision 5. Updating only those expectations produced 58/58 passed.
- Deeper persistence/lock/smoke/orchestrator/recovery group: 28/28 passed, including the token-ownership regression proving an old writer cannot delete a successor lock.
- Fresh full `corepack pnpm test`: 98 tests, 98 passed, 0 failed.

## Final verification

- `corepack pnpm audit --prod`: `No known vulnerabilities found`.
- Tracked-file high-confidence credential signatures (private keys, AWS-style access keys, GitHub tokens, long `sk-` tokens): no matching files.
- Literal credential-assignment candidate scan returned only `docs/current/TITAN.md`; manual inspection confirmed the value is the documented `<strong random bearer credential of at least 32 bytes>` placeholder, not a credential. No tracked `.env` files exist.
- Final `git diff --check`: exit 0 with no whitespace errors (only the repository's local LF-to-CRLF conversion warnings).
- No deployment, remote mutation, Odin access, registry removal, agent removal, cluster removal, or Caretaker change was performed.

## Hostile self-review

HOSTILE AUDIT
- Claim: Owner execution, advisory chat, and mission reads are authenticated without per-command approval.
- Evidence: Missing credentials produce `401` with a bearer challenge; an authenticated cross-site browser-shaped request produces `403`; health/team remain `200`; executor, mission loader, and model counters remain zero for rejected requests. The smoke configures one environment credential and reuses it.
- Claim: Concurrent command amplification and service resource exposure are bounded.
- Evidence: While one command is held, the second receives `429` plus `Retry-After: 1` and the orchestrator call list excludes it. A blocked completion releases the gate; a thrown executor error also releases it. The service contract proves `TasksMax=256`, `MemoryMax=2G`, and `CPUQuota=200%`.
- Claim: Crash-stale locks recover without stealing active/successor ownership.
- Evidence: Versioned lock metadata includes hostname, PID, opaque token, acquisition time, and lease expiry. A deterministic dead owner is reclaimed and startup blocks the interrupted mission; a deterministic active owner remains accepted/locked. Cleanup refuses to remove a valid successor token. Atomic snapshot rename and expected-revision checks remain exercised.
- Claim: Restart retrieval reproduces proof-bound agent evidence and exact totals.
- Evidence: A fresh orchestrator loads five durable signals (`titan`, Miss Vale Prime, NYX, RUNE, QRA), exact persisted counts, matching NYX/RUNE evidence, and a `proofSha256` equal to the independently verified mission proof. The functional smoke now checks the same stored result.
- Claim: Expected advisory faults are stable client responses and inspection labels are honest.
- Evidence: Empty advisory text returns fixed `400`; a disabled agent returns fixed `409`; unexpected errors remain generic/logged `500`. Executor/proof/test/doc fields say `sourceFilesOnDisk`/`testFilesOnDisk` or “current on-disk”; the prior Git-tracked claim is gone.
- Failures found: Two stale revision assertions, an unnecessary fixture property, absent successor-token coverage, and smoke not checking the newly durable stored result.
- Fixes applied: Corrected revision/fixture assertions, added successor-token preservation coverage, and made the smoke validate stored totals, proof binding, and NYX/RUNE attribution.
- Residual risk: Systemd limits and live behavior are locally contract-tested only. Ichabod deployment/restart proof remains intentionally pending because this repair explicitly forbids deployment.
VERDICT: READY FOR SEPARATE COMMIT; NOT DEPLOYED

## Round 2 hostile-audit repair

### Root-cause trace and hypotheses

#### Important — lock ownership publication and takeover are not atomic

Trace: round 1 first creates the canonical lock pathname with `open(lock, 'wx')` and only afterward writes owner metadata into that pathname. A process death between those operations leaves an empty or truncated canonical artifact. `parseLockMetadata()` returns `undefined`, and `reclaimDeadOwnerLock()` treats every invalid artifact as unreclaimable, so recovery permanently reports `mission write already in progress`.

Trace: stale takeover validates a dead token twice and then calls `rename(lock, quarantine)`. The token comparison and pathname move are separate operations. Two reclaimers can both validate the same dead token; after the first moves it and publishes a successor, the second `rename()` moves the successor before its post-rename token check notices the mismatch. Detection after displacement does not protect the current owner.

Hypothesis: prepare complete immutable version-2 metadata at a unique same-directory pathname and atomically publish it with a hard link to the canonical pathname. This makes canonical ownership appear complete or not at all. Serialize acquisition/takeover by canonical path inside the process, and accept a stale takeover only while the observed `dev`, `ino`, size, modification time, and owner token stay stable through quarantine. New metadata binds a Linux owner to boot ID and `/proc/<pid>/stat` process-start ticks so a reboot or PID reuse is demonstrably stale. Complete version-1 locks remain readable and are reclaimed only when same-host liveness is demonstrably false; invalid legacy/partial artifacts are recoverable inside the same serialized protocol. Node does not expose a portable cross-process compare-and-replace for a pathname, so the documented user-systemd single process is the cross-process boundary; the keyed mutex is deliberately an in-process guarantee rather than a false distributed-lock claim.

#### Minor 1 — bearer validation has three drifting definitions

Trace: API configuration checks byte length and whitespace but accepts non-ASCII; the request parser independently restricts its capture to printable ASCII; the smoke checks only a lower byte bound and whitespace, accepting both non-ASCII and credentials over 512 bytes. The client and server therefore disagree before authentication begins.

Hypothesis: one exported validator requiring 32–512 printable ASCII bytes, used by API configuration, request parsing, and smoke startup, removes the drift while preserving one-time bearer authentication rather than adding per-command approval.

#### Minor 2 — public health leaks recovery identifiers and details

Trace: startup recovery contains mission IDs, blocked details, and corruption reasons. `/health` returns that object verbatim on an unauthenticated route, exposing operational identifiers and failure details despite being documented as non-sensitive.

Hypothesis: derive an immutable public summary containing only numeric `recovered`, `blocked`, and `corrupt` counts. Detailed recovery does not need a new route for this repair.

#### Minor 3 — one generated task brief still claims Git tracking

Trace: the generated task-2 brief still says the inspector counts “tracked source/test files,” although the implementation enumerates current filesystem entries and the round-1 implementation/report corrected the executable and primary documentation terminology.

Hypothesis: change this one stale phrase to “current on-disk matching source/test files” and force-add the intentionally ignored SDD documentation file.

### Round 2 RED evidence

- Lock crash/reclaimer/identity group: `node --test --test-name-pattern "crash-point|two stale-lock reclaimers|prior Linux boot|reused Linux PID" tests/integration/recovery-coordinator.test.js tests/integration/mission-store.test.js` reported 5 tests, 0 passed, 5 failed.
- An empty canonical artifact and a JSON-truncated canonical artifact both failed startup recovery with `mission write already in progress`, proving the crash window remains permanently blocking.
- The deterministic two-reclaimer schedule made both callers confirm the same dead token, allowed the first to publish a successor, then made the second move that successor. The observed error was `mission lock changed during stale-owner reclamation`; the expected safe outcome was refusal without displacement.
- Version-2 fixtures from a prior boot and a reused PID both failed with `mission write already in progress`, proving the implementation had no boot/process-start identity handling.
- Bearer/health group: `node --test --test-name-pattern "bearer credentials|public health|functional API exposes health|startup composition validates" tests/integration/functional-api.test.js tests/integration/functional-smoke.test.js` reported 5 tests, 0 passed, 5 failed. The server accepted a non-ASCII credential; the smoke reached its injected network function for an invalid credential; and every health assertion received the detailed arrays instead of category counts. The rich fixture exposed all three mission IDs plus blocked/corrupt details.
- The stale task-2 phrase is documentation-only, so no behavioral test was manufactured for it; direct inspection at line 26 is its RED evidence.

### Round 2 GREEN evidence

- Focused round-2 rerun: the lock crash/interleaving/Linux-identity tests plus bearer/health tests reported 10/10 passed.
- The lock now writes complete version-2 metadata to a unique candidate and publishes it with a same-filesystem hard link. New crash-injection tests prove empty and truncated candidates never appear at the canonical pathname and are cleaned from the mission directory.
- Empty and truncated legacy canonical artifacts are reclaimed and startup recovery durably blocks the interrupted mission. A complete dead version-1 owner is still reclaimed; a complete active version-1 owner remains refused.
- The exact two-reclaimer interleaving now reports one winner and one `mission write already in progress`, one stale rename, and an intact published successor token. Both stale candidates are independently checked before the keyed takeover; the winner revalidates liveness and stable identity inside it, while the second observes the successor rather than moving it.
- Version-2 Linux identity tests reclaim a prior-boot owner and a reused PID/start-time mismatch, while an exact current boot/start identity remains refused as active.
- One `bearer-token.js` validator now enforces 32–512 visible printable ASCII bytes. API configuration, request parsing, and the smoke import it; non-ASCII and 513-byte credentials fail before network/executor work.
- Public health now maps detailed recovery into only `{ recovered, blocked, corrupt }` numeric counts. The rich fixture proves mission identifiers, blocked details, and corrupt reasons do not occur in the response.
- The ignored generated task-2 brief says “current on-disk matching source/test files,” matching the implementation and approved spec terminology.
- The first grouped touched run reported 37/39 because two tests asserted round-1 implementation mechanics (`open('wx')` and one fewer prepared-file cleanup). The assertions were corrected to test hard-link publication and candidate cleanup. The final grouped API/smoke/mission/recovery run reported 42/42 passed; the lock/recovery subset reported 26/26.
- Fresh full `corepack pnpm test`: 109 tests, 109 passed, 0 failed.

### Round 2 final verification

- `corepack pnpm audit --prod`: `No known vulnerabilities found`.
- Repository-local high-confidence credential scan found no private-key headers, AWS-style access keys, GitHub tokens, or long `sk-` tokens. The bearer-assignment scan found only the documented angle-bracket placeholder in `docs/current/TITAN.md`; no tracked `.env` files exist.
- Deletion scan returned no paths. No recovered agent, cluster, Caretaker entry, registry entry, or mission was removed.
- `git diff --check` returned no whitespace errors; the only output was the repository's existing LF-to-CRLF conversion warning.
- No deployment, remote mutation, Odin access, unmanaged service start, or external write was performed.

### Round 2 hostile self-review

HOSTILE AUDIT
- Claim: A crash cannot publish empty/truncated canonical ownership, and legacy partial locks remain recoverable.
- Evidence: Candidate crash injection leaves no canonical owner or directory clutter; two canonical partial-artifact recovery cases converge to durable blocked missions. Complete ownership is published only by hard link.
- Claim: One in-process stale reclaimer cannot move another's successor, and Linux reboot/PID reuse is distinguished from a live owner.
- Evidence: The forced two-reclaimer schedule produces one stale rename, one intact successor, one revision-2 winner, and one contention refusal. Prior-boot/PID-reuse fixtures are reclaimed; exact live identity and active legacy locks are refused.
- Claim: Authentication is one reusable client credential with one definition, not per-command approval.
- Evidence: Server configuration and smoke both reject non-ASCII and 513-byte values using the shared validator; existing authenticated command/smoke flows still pass and reuse one bearer value.
- Claim: Public health is non-sensitive and the inspection wording is honest.
- Evidence: Health contains only three numeric recovery counts and rejects a response-string scan for all fixture IDs/details. The generated task brief, implementation, tests, primary docs, and spec all say current on-disk matching files.
- Failures found: The original canonical metadata crash window, post-facto successor displacement, absent boot/start identity, validator drift, health detail leak, one stale generated phrase, and two stale round-1 test-mechanics assertions.
- Fixes applied: Atomic prepared publication, stable observation plus keyed takeover/cleanup, Linux process identity, shared bearer validation, count-only health, documentation correction, and behavior-oriented regression tests.
- Residual risk: Node exposes no portable cross-process conditional rename/replace. The tested keyed takeover guarantee is process-local; safe operation therefore requires the documented single systemd-managed Titan process with no unmanaged second writer. A process crash may leave a uniquely named incomplete candidate, but it is non-canonical and cannot block ownership. Live Ichabod deployment/restart evidence remains pending because deployment was forbidden.
VERDICT: READY

Round 2 is ready for its separate commit and remains intentionally not deployed.
