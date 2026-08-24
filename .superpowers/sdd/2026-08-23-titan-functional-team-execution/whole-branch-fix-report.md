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
