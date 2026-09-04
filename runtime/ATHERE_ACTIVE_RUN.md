# Athere Active Run



**Status:** Active — Items 2–14 landed. **Item 14 typed memory projection** (`docs/current/ATHERE_TYPED_MEMORY.md`). Item 15 not started.

**New-thread tie-in (paste block):** `docs/current/ATHERE_THREAD_TIE_IN.md` — continue only; zero skill load = deletion; no rebuild.

This file is the live operator view for the current Athere implementation run.

## Current run

- State: Authority chain locked per founder Justin Evans: founder → Miss Vale Prime → The Britt 4.0 for dangerous keys; `qra_sentinel` is last-line output Governor with blast radius; `cluster_core_qc_sentinel` remains daily QC only. See `docs/current/ATHERE_AUTHORITY_AND_SENTINEL.md` and `packages/contracts/src/authority-chain.js`.
- Current focus: **Item 14 landed** — typed memory projection over mission authority (no parallel DB). Item 15 not started.
- Orchestrator publish-error swallow residual **closed** for network buses: Redis bus sets `failClosedOnPublish: true`; env auto-wire injects that bus when `ATHERE_MESH_REDIS_*` is set.

- **Why the scrape was replaced.** Seven consecutive hostile audits each found a new encoding channel (synonym keys, object bags, combining marks, homoglyphs, base64/URI, char arrays, substring embeds, nest depth). The root flaw was structural, not incremental: independence was decided by searching **caller-supplied** data for a name, so the attacker controlled the haystack and the boundary could never be proven closed. Worse, it forced the honest orchestrator to strip the certifier `agent` and `verifier` from `artifactReferences`, which **regressed backlog Item 6** (artifact lineage requires producer action and verifier decision — `writeArtifactProof` takes `agent` and `verifierResult` by design).

- **Enforcement (structural).** `authorizeCompletedWorkClaim` now takes the mission's hash-chained `transitionHistory` and the validated update, and consults **no caller payload content at all**. `recordedWorkPerformers` collects the `actor` of every ledger entry that performed work — a non-empty service-computed change to the authoritative `evidence` array, or a recorded executor action. Actors are written from `authorization.envelope.agent_id`, so they cannot be forged without passing envelope authorization. A certifier is rejected if it is in that set, or if its own transition would write work evidence (perform-and-certify in one act). `normalizeAgentId` is trim + casefold only, valid because recorded ids come from the closed fleet registry / `OPERATIONS` map.

- **Deleted as a security boundary:** equals-OR-contains matching, base64 and `decodeURIComponent` leaf expansion, char/codepoint-array joining, the 100k-node iterative walk, the hand-rolled Cyrillic/Greek/Latin lookalike map, NFKD + Mn/Cf stripping, and `normalizeEvidenceEntries` / `collectPerformanceStringLeaves` / `normalizePerformerId`. Verified absent from `execution-roles.js` by grep.

- **Kept unchanged:** signal↔envelope bind, role taxonomy (manager/executor/auditor/recovery), `completed` requires plan-covering `completedWork` + empty `pendingWork` + empty `failedWork`, executor cannot emit `completed`, recovery cannot advance `completedWork`, operation-ID idempotency.

- **Structural verdict table (ACCEPT/REJECT as designed):**

  | Probe | Channel | Verdict |
  | --- | --- | --- |
  | honest orchestrator | nyx/rune perform, auditor certifies, Item 6 provenance present | ACCEPT |
  | recorded performer | auditor is ledger `actor` of a prior evidence write, then certifies | REJECT |
  | same transition | auditor writes `update.evidence` while advancing `completedWork` | REJECT |
  | recorded performer | auditor is ledger `actor` of a prior evidence write, then emits `completed` | REJECT |
  | forged `signal.agent` | executor envelope + auditor signal agent | REJECT |
  | executor completedWork / executor+manager `completed` | role gate | REJECT |
  | `completed` with pending/failed work | work-coverage gate | REJECT |
  | recovery completedWork | role gate | REJECT |
  | payload games | base64, URI, homoglyphs, combining marks, synonyms, bags, depth-40, char arrays, substring embeds, `artifactReferences[].agent`, `activeAgents` | **IRRELEVANT** — do not influence the decision in either direction |

- Full suite **257/257** (was 248/248). Personal adversarial re-probe **12/12** matched expectation, including the documented boundaries below.

- **Documented boundaries / residual risk (not silently ignored):**
  - `artifactReferences` writes are the auditor's own certification output and are required by Item 6, so they are deliberately not performance.
  - `environmentObservations` writes and atomic fact operations are separate lifecycles and are not performance. The orchestrator grants the auditor `verify_proof` only, so the fact path is not reachable there.
  - Clearing the evidence array is not a work-evidence write; the prior value survives in the ledger `changes`.
  - A mission imported from a pre-ledger snapshot has no ledger, so its recorded performer set is empty and independence cannot bite. Ledger-backed missions are unaffected. Failing closed there would block completion of live legacy mission data, so behaviour was left unchanged and recorded here instead.
  - Independence is mission-scoped, not per-subgoal: the ledger cannot attribute a transition to a specific subgoal without reading caller content. This is strictly stricter than per-item attribution.



## Checkpoint history



1. Current `master`, ordered backlog, live run file, mission-state service, and existing supersession tests were re-read.

2. Item 2 remained partial because no genuine persisted measured control exists; no synthetic benchmark data was created.

3. Hostile-audit Item 5 gap confirmed: generic `transition()` accepted caller-supplied complete `authoritativeFacts` replacements, allowing lifecycle semantics to be bypassed.

4. TDD RED reproduced the gap with six expected failures: raw replacement was accepted and the four semantic operations plus capability enforcement did not exist.

5. Production implementation added permission-scoped `recordFact`, `supersedeFact`, `correctFact`, and `revokeFact`, and rejected post-creation raw fact-array replacement.

6. TDD GREEN passed 6/6 focused tests.

7. Existing supersession integration tests were found to exercise the intentionally retired raw-mutation path; their lineage-validation coverage was preserved in the dedicated semantic-operation suite rather than silently dropped.

8. Stale-revision rejection plus ambiguous-current, broken-cross-key-lineage, and missing-revocation-timestamp guards were added; final focused suite passed 10/10.

9. `node --check` passed on the production module and dedicated test file. Git blob hashes matched the exact committed production and dedicated-test bytes.

10. Full repository Node >=24 regression could not be executed because the connected execution device was offline; no GitHub Actions workflow was used as a substitute.

11. Node v24.14.1 became available; Item 6 operational provenance was implemented test-first and passed 9/9 focused plus 147/147 full repository tests.

12. The prior broad completion label was rejected: Item 2 remains incomplete until real repeated controls are collected and frozen.

13. Item 6 was committed and pushed as `04ff4132d8615ca781f193f8990e9b580382d008`; local and remote `master` matched after push.

14. A persistent completion goal was armed for Items 1–8 with strict ordered acceptance, test-first implementation, hostile audit, security review, and evidence-before-claims requirements.

15. TDD added a measured cohort collector, safe per-file Node regression execution, and seed-drift rejection; complete verification passed 151/151.

16. TDD connected the collector to the safe Node executor and immutable writer; a permanent eight-task `titan-core-v1` suite and clean-commit CLI are ready for the first genuine three-trial run.

17. Hostile audit preserved v1 but rejected it as final because it omitted evaluator self-coverage.

18. The self-covering `titan-core-v2` control ran 12 pinned tasks three times from clean commit `42b3a4fc8a85`; all trials passed and the frozen artifact validated at SHA-256 `08f56024a5b4be47c3e8edcd1c48aa7dc2388785392233178d1bb0631b254498`.

19. Final Item 2 verification passed the full 152-test suite and production dependency audit. Item 2 is complete; no improvement claim is implied without a future comparative candidate run.

20. Ordered acceptance audit found direct evidence for Items 3–7 and confirmed Item 8 incomplete due to missing universal operation IDs.

21. Item 8 TDD RED reproduced duplicate transition execution; GREEN now returns exact retries without a new revision and rejects conflicting ID reuse. Full verification passes 153/153; Item 8 remains partial.

22. Item 8 extended to create, recordFact, supersedeFact, correctFact, revokeFact, proof-store, recovery-coordinator, node-executor, and node-control-collector. All now require operationId with persisted dedup and conflict rejection.

23. Clean baseline re-established: fresh master clone (dba1123), corepack pnpm install --frozen-lockfile, corepack pnpm test = 153/153 pass, 0 fail.

24. 21-file changeset carried onto clean master with per-file scope proof; every file tied to Item 8 idempotency contract. No scope creep.

25. Test correction: mission-state-service.test.js retry-timeout assertion updated to use includeHistorical: true, per ATHERE_STATE_SUPERSESSION.md and checkpoint 32 (history-hiding is deliberate design).

26. Full verification: corepack pnpm test = 176/176 pass (23 new idempotency tests); node --check all JS clean; corepack pnpm audit = 0 vulnerabilities.

27. Gate inspection: 10 state-changing operations enumerated; all implement persisted operation-ID contract or have documented exemption (ATHERE_IDEMPOTENT_OPERATIONS.md for store adapters).

28. Security review: no medium+ vulnerabilities found. Optional hardening noted for signal.agent vs envelope.agent_id cross-check.

29. Bugbot review: one finding — recovery authorization fails on missions with non-empty permissions that omit qra_recovery_driver. Assessed as pre-existing design constraint, not Item 8 regression; orchestrator always includes recovery driver in permissions at creation.

30. Hostile audit verdict: READY. Item 8 complete. Residual: future callers must include qra_recovery_driver in mission permissions for recovery to work.

31. Founder agent IP restore: Caretaker removed from `jobs` and restored as agent `fleet_orchestration` in `agents[]`. Doctrine agents LOOM, ECHO, Caretaker, Cluster QC Sentinel asserted by contract tests. Docs/STATUS/baseline updated to forbid identity demotion. corepack pnpm test 177/177.

32. Item 9 started after operator go. Hole confirmed: nyx/rune advanced `completedWork` in orchestrator running transitions; mission-state-service accepted it; no MEA role taxonomy.

33. TDD RED: 6/6 contract tests for `execution-roles` passed as pure contract; 6/6 integration MEA tests failed against production (executor/manager could still advance `completedWork`; orchestrator still self-certified).

34. Production: added `packages/contracts/src/execution-roles.js`; wired role/action/signal checks into `authorizeAgentOperation`; wired `authorizeCompletedWorkClaim` into `mission-state-service.transition`; orchestrator nyx/rune updates record evidence/activeAgents only; auditor completion alone advances `completedWork`.

35. Existing mission-state-service lineage/persistence tests corrected to MEA-correct actors (executor evidence, auditor certifies) without dropping coverage.

36. Docs: `docs/current/ATHERE_MANAGER_EXECUTOR_AUDITOR.md`; baseline/skill updated so Item 8 no longer blocks Item 9. Doctrine rule verified present.

37. Prior claim of Item 9 complete at 189/189 **retracted** after ruthless hostile audit found Hole 1 (signal↔envelope forge) and Hole 2 (same-update auditor self-cert) still OPEN.

38. Hole 1 closed: every `transition` requires `signal.agent === envelope.agent_id` (fail closed); `authorizeCompletedWorkClaim` uses authorized envelope agent. Hostile test `mea-hostile-signal-envelope-mismatch.test.js` GREEN.

39. Hole 2 closed: independence check includes `update.evidence` and same-transition `signal.evidence` performers. Hostile test `mea-hostile-same-update-self-cert.test.js` GREEN. Orchestrator completion no longer lists auditor as evidence performer when advancing `completedWork` (verification stays on signal/artifacts).

40. Adversarial repro: forge REJECTED; same-update self-cert REJECTED; honest service + orchestrator paths OK. Focused MEA suite 37/37. Full suite **191/191**. Hostile audit: READY for Item 9 (uncommitted).

41. Ruthless re-audit AFTER READY claim: original forge + same-update (array/update.evidence) still REJECT. NEW holes OPEN — object `signal.evidence` self-cert advances `completedWork`; `completed` without `completedWork` publishes mission success. RED tests left; READY retracted; Item 9 incomplete.

42. Hole A/B closed on production path: `normalizeEvidenceEntries` + `performer` alias; `completed` requires plan-covering `completedWork` and empty `pendingWork` before proof re-read. Proof-boundary test updated to MEA-correct work update so ENOENT proof path still exercises. Personal re-probes 8/8; full suite **193/193**. Item 9 READY (uncommitted). Item 10 not started.

43. Third ruthless re-audit AFTER Hole A/B READY: prior named forges still REJECT. NEW holes OPEN — nested `result.agent` / `executor` / `agents[]` self-cert advances `completedWork`; `completed` publishes with non-empty `failedWork`. RED tests left (5); READY retracted; Item 9 incomplete. No production fix this turn. No commit.

44. C1–C4 + D closed in `execution-roles.js`: bounded evidence identity scrape covers top-level `agent`/`performer`/`executor`, `agents[]`, nested `result` identity fields (and bounded `result.result…`), plus object aliases; `completed` fail-closed on non-empty `failedWork` after update merge. Sibling aliases found in adversarial pass (`result.agents[]`, executor object, `result.performer`/`executor`, agents object entries, `result.result.agent`) also REJECT. Personal re-probe cannot reopen prior holes or C/D. Full suite **198/198**. Item 9 READY (uncommitted). Item 10 not started. No commit.

45. Fourth ruthless re-audit AFTER C/D READY: prior named forges + C/D + recovery + mission-merge failedWork still REJECT. NEW holes OPEN — **E** `signal.result.agent` / `signal.result.executor` self-cert advances `completedWork` (and completed with identical re-assert); **F** `evidence.evidence.agent` double wrap on signal and update.evidence. RED tests left; READY retracted; Item 9 incomplete. No production fix this turn. No commit. `store.saveMission` remains out-of-scope (not used to fail).

46. E/F + verifier closed: `signal.result` first-class performer source; nested `evidence` wraps walked; string `verifier` + `agentEvidence[]` scraped. Personal re-probe 21/21 attack REJECT, honest ACCEPT; full suite **206/206**. Item 9 READY (uncommitted). Item 10 not started. No commit.

47. Fifth ruthless re-audit AFTER E/F READY: prior named forges + E/F/verifier + recovery + dual-role wipe still REJECT. NEW holes OPEN — **G1/G2** object-shaped `agentEvidence`/`agents` self-cert; **G3/G4** case-variant / ZWSP performer id; **G5** missed keys `author`/`workers`/`actors`/`by`. RED tests left; READY retracted; Item 9 incomplete. No production fix this turn. No commit. `store.saveMission` remains out-of-scope.

48. G1–G5 closed in `execution-roles.js`: bag scrape accepts array / object / object-map / string; identity keys add `author`/`by`/`actor` and bags `workers`/`actors`; `normalizePerformerId` (trim, Cf/ZWSP/BOM strip, NFKC, casefold) on independence compare. Personal sibling probes REJECT (map agentEvidence, actors.lead, evidence.by, BOM/ZWNJ/case/NFKC). Combining-mark + unbounded non-Mesh aliases documented residual. Fifth test **11/11**; full suite **217/217**. Item 9 READY (uncommitted). Item 10 not started. No commit.

49. Sixth ruthless re-audit AFTER G1–G5 READY: prior A–G + fullwidth + workers string/object still REJECT. NEW holes OPEN — **H1** combining-mark id ACCEPT; **H2** synonym keys writer/operator/contributor/owner/createdBy/submittedBy/signedBy/principal ACCEPT; **H3** Cyrillic homoglyph ACCEPT; **H4** team/crew/participants/operators bags ACCEPT; **H5** priorEvidence combining-mark only then certify ACCEPT; **H6** `agent_id` key ACCEPT. Soft-note "out of scope" rejected as soft-pass against Item 9 acceptance. RED tests left; READY retracted; Item 9 incomplete. No production fix. No commit. Full suite **221/227** (6 RED fails). `store.saveMission` out-of-scope.

50. H1–H6 **class-closed** in `execution-roles.js`: replaced identity-key allowlist with bounded deep string leaf scrape (depth 32) over priorEvidence / update.evidence / signal.evidence / signal.result; `normalizePerformerId` now NFKD + Mn/Cf strip + local Cyrillic/Greek lookalike map + casefold; any leaf normalizing to certifier REJECT. Orchestrator honest completion already omits auditor id string leaves from `signal.result`. Sibling probes (note/reviewedBy/authorizer/Greek α/depth-16) REJECT; honest nyx/rune ACCEPT. Sixth suite **14/14**; full suite **231/231**. Item 9 READY (uncommitted). Item 10 not started. No commit. `store.saveMission` out-of-scope.

51. Seventh ruthless re-audit AFTER H1–H6 READY: prior A–G + H1–H6 + honest still hold. NEW holes OPEN — **I1–I3** lookalikes outside local map (script-g / Komi-d / Greek-iota) ACCEPT; **I4** depth-40 nest ACCEPT; **I5** substring / path / JSON-blob embedding ACCEPT; **I6** base64 / URI-encoded sole leaf ACCEPT; **I7** char-array / codepoint-array ACCEPT; **I8** `artifactReferences[].agent` only ACCEPT; **I9** `activeAgents` auditor list ACCEPT. Personal probes confirm each advances `completedWork: ['inspect']`. Call site does not pass `activeAgents` / `artifactReferences` into deep scrape. RED tests left in `mea-hostile-seventh-reaudit-self-cert.test.js` (13). READY retracted; Item 9 incomplete. No production fix. No commit. Full suite **235/248**. `store.saveMission` out-of-scope.

52. I1–I9 **class-closed** in `execution-roles.js`: full-`update` scrape (not only `update.evidence`); iterative 100k-node walk (no depth-32 fail-open); leaf URI/base64 expansion; char/codepoint-array join; normalize equals-OR-contains certifier; lookalike map adds ɡ/ԁ/ι plus fuller Cyrillic/Greek set. Orchestrator honest completion keeps `activeAgents: []` and omits certifier `agent`/`verifier` from `artifactReferences` (proof hashes retained). Seventh suite **17/17**; personal re-probe I1–I9 + depth-60 + Cyrillic-м + honest **16/16**; full suite **248/248**. Item 9 READY (uncommitted). Item 10 not started. No commit. `store.saveMission` out-of-scope.

53. **Scrape retracted as the security boundary; replaced with structural provenance; Item 6 regression fixed.** The I-class "class close" at checkpoint 52 was still whack-a-mole — its own residual admitted novel encodings could reopen it — and the sanitize it required had stripped the certifier `agent` and `verifier` out of `artifactReferences`, regressing Item 6 (artifact lineage requires producer action and verifier decision; `writeArtifactProof` takes `agent` and `verifierResult` by design). Independence now compares service-recorded identities only: `recordedWorkPerformers(transitionHistory)` collects the `actor` of ledger entries that wrote authoritative work evidence or performed an executor action, and `authorizeCompletedWorkClaim` rejects a certifier in that set or one whose own validated update writes work evidence. Caller `evidence` / `result` / `artifactReferences` / `activeAgents` content is no longer an identity source at all. Deleted: equals-OR-contains match, base64 and URI leaf decoding, char/codepoint-array join, the 100k-node walk, the lookalike map, and NFKD + Mn/Cf normalization (`normalizeAgentId` is trim + casefold on closed-set ids). Orchestrator completion restored to `{ id: 'mission-proof', ...artifactRef, ...artifactVerification }`, so certifier `agent`, `action`, and `verifierResult.verifier` are back in artifact lineage; `tests/integration/artifact-proof.test.js` and `packages/proof/src/proof-store.js` were not modified and remain green.

54. Test accounting for checkpoint 53, delta **248 → 257** (+9): +7 new `mea-structural-provenance.test.js` (recorded-actor reject on `completedWork` and on `completed`, same-transition perform-and-certify reject, planted-payload irrelevance across every retired channel, hostile-shape mission, plus 2 documented-boundary pins); +1 contract test deriving performers from ledger entries; +1 from splitting the sixth-re-audit `workers` test so its `update.evidence` half stays a genuine reject. **No hostile file was deleted and no case was silently dropped.** 49 former scrape probes were converted in place: each now asserts both that the payload does not influence authorization (independent auditor still certifies) and that the recorded-actor rule still rejects the genuine case, with the intent stated in the test name and comment. Cases that expressed a real acceptance requirement were kept and restated structurally (perform-and-certify in one update, forged `signal.agent`, executor/manager success claims, `completed` work-coverage and `failedWork` gates). Personal adversarial re-probe **12/12** matched expectation. Full suite **257/257**, 0 fail. Item 9 READY (uncommitted). Item 10 not started. No commit.

55. **Doctrine-baseline transport work started (not a numbered backlog item).** Item 9 landed as `ea74e0d` on `master`; working tree clean. The doctrine rule in `.cursor/rules/athere-mesh-doctrine.mdc` requires one unbreakable loop — **Agent A → Agent B on the local mesh with zero human intervention** — before further features. That loop has three blockers: (1) no cross-host signal transport, because the only resonance bus is process-local memory; (2) no shared mission state across hosts, because `mission-store` is local filesystem; (3) no remote executor dispatch. **This run addresses blocker 1 only: a Redis-backed resonance bus.** Backlog Item 10 is still not started, and transport does not advance the numbered backlog. Target seed is the dedicated mesh Redis on `ichabodcrane` / `100.77.131.28:6380` (Redis 8.0.5, systemd user unit `redis-athere-mesh.service`, `requirepass`, `appendonly yes`, `noeviction`, isolated from the shared 6379 instance). Reachability confirmed before coding: AUTH `+OK`, `PING` `+PONG`, `GET athere:mesh:seed:id` = `8a1e2c26-0769-405e-9a8f-85b4c2c9f1f1@ichabodcrane`. Constraints for this run: continue the existing bus abstraction (do not replace `createMemoryResonanceBus`), zero new npm dependencies, `createMissionOrchestrator` keeps defaulting to the in-memory bus so the suite stays hermetic and offline, and no secret enters git.

56. **Blocker 1 (cross-host signal transport) implemented and cross-host proven. Transport only — the doctrine baseline loop is NOT done.**

- **TDD.** The four existing memory-bus assertions were lifted into one shared contract suite, `tests/support/resonance-bus-contract.js` (not matched by Node's test glob, confirmed by exact suite accounting below), and two cases were added — every malformed field individually, and an unknown mission reading empty. RED was verified twice: first for the right reason (`ERR_MODULE_NOT_FOUND` on `redis-resonance-bus.js`) with the memory bus already passing 6/6 against the shared contract, proving the contract is a faithful restatement of existing behaviour and not a rewrite of it; then again per feature (`bus.verifySeed is not a function`, password-file `undefined`) before each production change.

- **Added:** `packages/resonance/src/resp-client.js` (minimal RESP2 over `node:net`), `packages/resonance/src/redis-resonance-bus.js`, `tests/support/resonance-bus-contract.js`, `tests/integration/redis-resonance-bus.test.js`, `scripts/smoke-redis-resonance.js`, `docs/current/ATHERE_REDIS_RESONANCE_BUS.md`, `evidence/smoke-redis-resonance-crosshost-20260903-184403.json`. **Changed:** `packages/resonance/src/resonance-bus.js` (+1 additive re-export line, no behaviour change), `tests/integration/resonance-bus.test.js` (now runs the shared contract), `package.json` (`smoke:redis-resonance`), `evidence/README.md`, this file. **`packages/orchestrator/src/mission-orchestrator.js` was not touched.**

- **Independent re-verification after the implementing agent hit a usage-limit abort:** offline suite **263 pass / 14 skip / 0 fail**; live against Ichabod seed **277/277 pass, 0 skip**; evidence file present with `ok: true`, 3 rounds, and an explicit `notClaimed` list. No password in the repository.

- **Dependency decision: zero new npm dependencies.** Production footprint is still `@electric-sql/pglite` + `pg`. The bus needs only `GET`, `SET`, `RPUSH`, `LRANGE`, `SCAN`, `DEL`, `EVAL`; a client library would have added more supply-chain surface than protocol.

- **Atomicity.** `publish` is one `EVAL`. The idempotency check, the append and the sequence record cannot straddle round trips, so racing hosts can neither double-append nor record a sequence that disagrees with list position. `sequence` is derived from 1-based list position on read, so it cannot drift from the stream.

- **Seed guard.** `athere:mesh:seed:id` is read and compared before any read or write; missing throws, different throws, no permissive mode. `expectedSeedId` is mandatory at construction and `resolveRedisResonanceOptions` throws if a host is configured without `ATHERE_MESH_REDIS_SEED_ID`. `verifySeed()` returns the value Redis actually served — added specifically because the first draft of the smoke script echoed the configured expectation back into the evidence, which would have been fabricated evidence.

- **Secrets.** Read from `ATHERE_MESH_REDIS_PASSWORD` or, preferred, `ATHERE_MESH_REDIS_PASSWORD_FILE` (mode-600 file, keeps the secret out of `argv` on a shared box). No password, and no file containing one, is in the repository; `git status` and a full-tree grep were checked before landing.

- **Test counts.** Baseline measured empirically by stashing the change and re-running at `ea74e0d`: **257/257 pass, 0 skipped**. After: **274 total, 262 pass, 0 fail, 12 skipped** in the offline default (7.5s, no network); with the seed configured **274/274 pass, 0 skipped**. Delta **+17** = 6 shared-contract cases against Redis, 9 Redis-specific cases, and 2 new contract cases that also run against memory. Focused Redis file alone: **17/17** against the live seed.

- **Offline-first proven, not asserted.** With no `ATHERE_MESH_REDIS_*` set, the 12 Redis cases skip with a stated reason and make zero network calls; the resonance files complete in 87ms. When the seed is configured but unreachable, they skip with the transport reason rather than failing.

- **Cross-host evidence (the acceptance).** 3 rounds. Process A on `JustinLenovo` / 100.125.245.10 published to `ichabodcrane` / 100.77.131.28:6380; Process B **on `ichabodcrane`**, running byte-identical bus sources (sha256-matched both ways) against that host's **own loopback** Redis, read the signals back in order and byte-identical. Each round also ran an identical re-publish from a third, separate OS process, which returned `duplicate: true` at the original sequence — **process-local deduplication cannot produce that**, so idempotency is genuinely persisted. Every assertion is enforced in the driver; a mismatch aborts rather than being written up as success. Nine signal keys were left on the seed for independent re-verification and a post-run `SCAN` confirmed the keyspace held exactly those plus the seed key, so no test residue leaked.

- **What this does NOT prove (do not restate this as baseline complete):** shared mission state across hosts is still missing (`mission-store` is local filesystem); remote executor dispatch is still missing; nothing in the orchestrator uses this transport; `read` has no consumer/subscription semantics, no blocking read, no delivery tracking, no trimming; single seed host with no replication or failover.

- **Named residual blocker — orchestrator swallows publish errors.** `publish()` in `mission-orchestrator.js` wraps `bus.publish` in `try { … } catch { return false }` and **every call site discards the return value**. For the memory bus that is near-harmless. For a network bus it is not acceptable: a connection failure, auth failure or seed-guard refusal would be swallowed and the mission would continue as though the signal had been delivered — the exact silent-empty-stream failure the seed guard exists to prevent, reintroduced one layer up. **Left unchanged deliberately** (fixing it changes orchestrator semantics and needs its own test-first cycle plus a decision on whether transport failure blocks a mission or is recorded and continues). This is a blocker on wiring the bus into the orchestrator, not an accepted design.

- **Documented boundary.** The memory bus stores object references, so a field valued `undefined` or a `Date` survives locally but not across a transport. The Redis bus fingerprints the signal before and after a JSON round trip and throws if they differ. This is the one intentional contract divergence and it fails safe rather than transporting a changed signal.

- **Documentation debt cleared.** `evidence/README.md` documented `pnpm run smoke:redis-s24`, which does not exist in this repository. Replaced with the real `smoke:redis-resonance` reproduce command, and the two S24 artifacts are now explicitly labelled historical and not reproducible from here.

57. **Blocker 2 (shared mission state across hosts) implemented and cross-host proven. State only — the doctrine baseline loop is NOT done; blocker 3 remains.**

- **Inspection.** `createMissionStateService` already accepted a `store` with `loadMission`/`saveMission`. `createPostgresMissionStore` already existed with `load`/`save` + revision CAS but was never adapted onto that contract. `createMissionOrchestrator` always constructed the filesystem-backed service. Single-writer assumption remains documented in `ATHERE_ARCHITECTURE_BASELINE_2026-08-26.md` / `TITAN.md` and is **deliberately unchanged**.

- **TDD.** RED first failed for the right reason (`ERR_MODULE_NOT_FOUND` on `postgres-mission-state-store.js`). GREEN added the adapter + env resolve + `openSharedMissionStateStore`, optional orchestrator `store` injection (default still filesystem), hermetic PGlite cases, and live cases that skip when unconfigured.

- **Added:** `packages/postgres/src/postgres-mission-state-store.js`, `tests/integration/postgres-mission-state-store.test.js`, `scripts/smoke-shared-mission-state.js`, `docs/current/ATHERE_SHARED_MISSION_STATE.md`, `evidence/smoke-shared-mission-state-crosshost-20260903-201846.json`. **Changed:** `packages/orchestrator/src/mission-orchestrator.js` (optional `store` only), `package.json` (`smoke:shared-mission-state`), `docs/current/ATHERE_MISSION_STATE_SERVICE.md`, `docs/current/ATHERE_REDIS_RESONANCE_BUS.md` (blocker-2 pointer), `evidence/README.md`, this file. **No new npm dependencies.** Mission-state-service mutation semantics untouched.

- **Secrets.** Password via `ATHERE_MESH_POSTGRES_PASSWORD_FILE` (mode 600 on Ichabod under `~/.config/athere-mesh-postgres/`). No password in git. Dedicated DB/role `athere_mesh` on Ichabod Postgres 18 (loopback).

- **Offline-first.** With no `ATHERE_MESH_POSTGRES_*` / `DATABASE_URL`, resolve returns `null`, live cases skip with a stated reason, and orchestrator/default service stay on the filesystem store. Full offline suite after this change: **289 tests, 274 pass, 15 skipped, 0 fail** (baseline before change: 281 / 267 pass / 14 skip; delta +8 = hermetic shared-store cases + 1 live skip).

- **Cross-host evidence.** 3 rounds. Process on `JustinLenovo` wrote via SSH local forward `127.0.0.1:15432→ichabod:5432` (cluster listens on loopback only — not Tailscale-native Postgres). Process on `ichabodcrane` read via host loopback. Same revision + objective + writer observation recovered; byte-identical adapter/service smoke sources hashed both ways. Evidence: `evidence/smoke-shared-mission-state-crosshost-20260903-201846.json`.

- **What this does NOT prove:** Agent A → Agent B complete; remote executor dispatch (blocker 3); orchestrator auto-wiring from env; shared proof/artifact stores; multi-writer orchestration beyond revision CAS; Postgres exposed on Tailscale without a tunnel.

58. **Blocker 3 (remote executor dispatch) implemented and cross-host proven. Narrow path — not a backlog advance; Item 10 not started.**

- **Named residual closed first.** Orchestrator `publish()` still swallows errors for the default memory bus (existing contract: telemetry cannot overturn durable completion). When `bus.failClosedOnPublish === true` (Redis bus), transport/auth/seed failure rethrows as `resonance publish failed: …`. Test: `network-bus publish failure fails closed and does not complete the mission`.

- **Added:** `packages/execution/src/remote-work-queue.js` (memory + Redis, seed-guarded, zero new npm deps), `remote-dispatch-executor.js` (inspect local / `runTests` remote), `remote-executor-worker.js`, `scripts/smoke-remote-executor-dispatch.js`, `scripts/remote-executor-worker.js`, `docs/current/ATHERE_REMOTE_EXECUTOR_DISPATCH.md`, `tests/contract/remote-executor-smoke-pin.test.js`, `evidence/smoke-remote-executor-crosshost-20260903-202947.json`. **Changed:** orchestrator optional `remoteWorkQueue` / `remoteRepositoryRoot`; Redis bus `failClosedOnPublish`; `node-test-executor` preserves POSIX absolute roots so Windows dispatchers do not rewrite Linux worker paths in the input binding; package.json `smoke:remote-executor`; evidence README; this file.

- **Cross-host evidence.** 3 rounds. Process A on `JustinLenovo` enqueued `run-node-tests` to mesh Redis `100.77.131.28:6380`. Process B on `ichabodcrane` claimed the job, ran `createNodeTestExecutor` against `~/athere-mesh-crosshost` on pin test `tests/contract/remote-executor-smoke-pin.test.js` (`passed: 1`, `exitCode: 0`). Result visible back on A via `await`. Worker hostname on every round: `ichabodcrane`.

- **What this does NOT prove (doesNotProve in evidence):** orchestrator auto-wire from env of Redis bus + remote queue + Postgres together; remote inspect; multi-worker leasing beyond LPOP; full suite remotely; Item 10 / QR18.

59. **Standing Ichabod worker + owner env auto-wire.** Closes blocker-3 honesty gaps that still required mid-flight SSH claim and left start scripts unwired.

- **Env auto-wire.** `packages/orchestrator/src/mesh-env-wiring.js` + `scripts/start-agent-api.js`: when `ATHERE_MESH_REDIS_*` is set, inject Redis bus (`failClosedOnPublish: true`); when also `ATHERE_MESH_REMOTE_WORK_QUEUE` is truthy, inject Redis remote work queue (+ optional `ATHERE_MESH_REMOTE_REPOSITORY_ROOT`); when `ATHERE_MESH_POSTGRES_*` / `DATABASE_URL` is set, inject shared Postgres mission store. Offline default unchanged when unset. Hermetic tests: `tests/integration/mesh-env-wiring.test.js`.

- **Standing worker.** `deploy/systemd/athere-mesh-remote-executor.service` (systemd --user, `Restart=always`, linger=yes) runs `node scripts/remote-executor-worker.js --loop` against `~/athere-mesh` with env from `~/.config/athere-mesh-worker/worker.env`. Proven: `systemctl --user restart` returns to active with a new MainPID; unit stays up.

- **Cross-host evidence (standing, zero mid-flight SSH claim).** 3 rounds. Lenovo dispatched+awaited on namespace `athere:mesh:work`; Ichabod standing unit MainPID `2257447` completed every round (worker pid matched MainPID; postflight PID unchanged). SSH used only for preflight/postflight status — not to start a worker per round. Evidence: `evidence/smoke-remote-executor-standing-worker-crosshost-20260903-203851.json`.

- **Doctrine baseline verdict for this narrow path:** Agent A (Lenovo publish) → Agent B (standing Ichabod worker) completes with zero human babysitting after the unit is installed. Still not claimed: full owner-API live mission over the wired stack; remote inspect; multi-worker lease; full remote suite; Item 10.

60. **Doctrine baseline residuals closed (nothing left behind before Item 10).**

- **Remote inspect.** `createRemoteDispatchExecutor` now dispatches both `inspect-repository` and `run-node-tests`. Orchestrator input bindings hash `remoteRepositoryRoot` when a queue is injected so the worker's authorizeEnvelope check matches. Standing worker handles both kinds with lease heartbeats.
- **Multi-worker lease.** Claim uses a processing zset + lease expiry (memory + Redis). `heartbeat` extends; `reclaimExpired` (also inside `claim`) returns abandoned jobs. Evidence: `evidence/smoke-remote-work-lease-20260904T035458.json`.
- **Contract cohort beyond pin.** Standing worker ran 4 contract files / 20 tests from Lenovo with `midFlightSshClaim: false`. Evidence: `evidence/smoke-remote-executor-cohort-crosshost-20260904T035619.json`.
- **Owner-API live mission over wired stack.** `scripts/smoke-owner-api-mission.js` → `orchestrator.execute({ profile: 'owner', text: 'test all of Titan' })` with Redis bus + remote queue + shared Postgres (SSH local forward `15432→ichabod:5432`). Standing unit MainPID `2263291` unchanged pre/post. Remote inspect + full suite on Ichabod: **310 tests, 309 pass, 1 skip, 0 fail**. Mission `mission-abad4f65-1b39-41a6-98e9-a688ced36b8e` revision 5 `completed` verified in Ichabod `titan_missions` via loopback psql. Evidence: `evidence/smoke-owner-api-mission-crosshost-20260904T035714.json`.
- **Still not started:** Item 10 / QR18. Documented residual: Postgres is not Tailscale-native (tunnel required); multi-writer beyond revision CAS unchanged.

61. **Item 10 — Layered QR18 verification.** Acceptance: every important completion claim traces to its evidence and verifier.

- **Added:** `packages/proof/src/qr18-layered-verification.js` (Levels 1–6 structured evidence), `tests/contract/qr18-layered-verification.test.js`, `tests/integration/qr18-layered-completion-gate.test.js`, `docs/current/ATHERE_LAYERED_QR18.md`.
- **Wired:** mission-state-service re-evaluates QR18 on `completed` after `verifyProof` and ignores caller `qr18` bags; orchestrator attaches service-shaped `result.qr18` before completion.
- **Unchanged:** proof-store write/verify primitives; MEA structural independence; Item 11 not started.
- **Hostile probes:** forged qr18 bag + missing artifact lineage → REJECT at Level 2; certifier-as-performer → REJECT at Level 3; honest six-level ACCEPT.

62. **Item 11 — Explicit workflow/plan graphs.** Acceptance: execution must remain on a valid mission path, not merely a role-legal action.

- **Added:** `packages/contracts/src/workflow-graph.js`, `tests/contract/workflow-graph.test.js`, `tests/integration/workflow-path-gate.test.js`, `docs/current/ATHERE_WORKFLOW_PLAN_GRAPHS.md`.
- **Wired:** mission create persists `workflowGraph`; dependencies normalize to typed edges; work-partition updates call `assertValidMissionPath`; QR18 Level 5 uses path assessment when a graph exists.
- **Unchanged:** MEA/QR18 completion gates; Item 12 recovery engine not started.
- **Hostile probes:** certify `verify` before `inspect` → `mission path invalid`; mutate `workflowGraph` after create → REJECT; in-order certify ACCEPT.

63. **Hostile re-audit after Item 11 READY (try-to-break).** Four holes found OPEN; READY retracted until closed.

- **H1 alternate_path waive:** `assessMissionPath` treated any `alternate_path` target as plan-order exempt without requiring `from` completed — service accepted completing `c` with `a`/`b` pending. Closed: alternate only arms when `from` is completed.
- **H2 QR18 L5 legacy:** with no `workflowGraph` and empty dependencies, Level 5 accepted skipped plan steps (`completedWork: ['c','b']`). Closed: legacy L5 also enforces `currentPlan` order.
- **H3 case-skew orphans:** `completedWork: ['verify']` against nodes `Inspect`/`Verify` reported path valid (no edge fired). Closed: unknown work node ids are violations.
- **H4 supersedes:** confirmed still REJECT for skipping depends_on (no hole).
- **Kept RED→GREEN:** `tests/integration/mea-hostile-item10-item11-reaudit.test.js`. Forged QR18 bag still REJECT.
- Item 12 not started.

64. **Item 12 — Checkpoints / branching / rollback / quarantine.** Acceptance: failure ~90% through does not force full mission restart.

- **Added:** `packages/mission/src/mission-checkpoints.js`, `tests/integration/mission-checkpoints-item12.test.js`, `tests/integration/mea-hostile-item12.test.js`, `docs/current/ATHERE_CHECKPOINTS_BRANCHING.md`.
- **Wired:** mission create initializes `checkpoints`/`branches`/`activeBranchId`; recovery-only ops `createCheckpoint`, `createBranch`, `quarantineBranch`, `rollbackToCheckpoint`, `retryFromCheckpoint`; recovery may emit `running` only for rollback/retry; orchestrator grants full recovery action set; rollback/retry on `completed` fails closed.
- **Hostile:** transition forge of checkpoints REJECT; store-tampered stateHash → integrity fail closed; executor cannot override to `create_branch`; completed-mission rollback REJECT.
- **Suite:** 331 pass / 0 fail / 17 skip (mesh Redis offline skips).
- **Security audit:** no secrets in Item 12 diff; no new HTTP surface; owner API remains bearer-gated on `127.0.0.1` by default. Residual hygiene: checkpoint snapshots retain evidence/observations (same trust boundary as mission state).
- Item 13 not started.

65. **Items 1–11 secrets / exploit audit (gap fill).** Item 12 already had a diff review; this pass covers the shipped stack Items 1–11 plus API/mesh wiring.

- **Method:** local secret-file + credential-pattern scan; owner API / bearer / bind / Redis / Postgres / remote-queue / Ollama path review; prior Item 8 security note + Item 9–11 hostile suites as authorization evidence; security-review subagent on current uncommitted surface (Item 12 residual noted).
- **Secrets in git:** PASS — no `.pass`/`.pem`/live bearer/password files tracked; Redis/Postgres passwords are env or mode-600 file only; evidence JSON uses password-file placeholders, not live secrets. Test fixtures use obvious fake passwords (`test-not-used-offline`).
- **Findings (not fixed this turn — audit only):**
  1. **Medium — unauthenticated `/health` + `/api/team`.** By design (functional-api asserts 200 without bearer). Exposes fleet topology (ids/roles/ranks/executorIds) and recovery counts. Mitigated by owner loopback bind; still local recon / tunnel risk.
  2. **Medium — `profile: 'public'` skips bearer and skips loopback bind enforcement.** Production `start-agent-api.js` always uses `owner` + `127.0.0.1`. Mis-composition of `createTitanApi({ profile: 'public' })` on a non-loopback host would serve unauthenticated chat/commands/missions (planner still denies some public actions).
  3. **Medium — Item 12 residual:** rollback/retry on non-`blocked` can apply snapshot `status` without `transitionMission` (status/signal desync). Completed rollback already REJECT.
  4. **Low — `workspace/titan-owner-smoke/**` untracked** with proof stdout / local paths (IP/ops hygiene; not credentials). Not gitignored — commit risk if added carelessly.
  5. **Low — Redis RESP plaintext + seed id in env.example** — documented Tailscale/local trust; seed is identity fingerprint, not a password.
- **Validated controls:** owner bearer (timing-safe) on commands/missions/chat; owner must bind loopback; cross-site Origin/Sec-Fetch-Site rejected; workspace root traversal blocked; Ollama non-loopback refused; MEA/QR18/path hostile suites for Items 9–11; Redis seed guard + password-file pattern; Postgres password-file pattern.
- **Verdict:** No live secret exposure found in repo. Exploit surface for a remote internet attacker against default owner API is tightly bounded (loopback + bearer). Remaining mediums are composition/recon residuals — fix when Justin orders hardening, not silently.
- Item 13 still not started.

66. **Medium security findings closed (audit follow-up).**

- **M1:** `/health` and `/api/team` now require bearer (owner smoke/client updated).
- **M2:** every profile must bind loopback; public composition without a token gets 401 on health/team/commands/missions (advisory `/api/chat` may remain tokenless on loopback only).
- **M3:** rollback/retry require `blocked`; snapshot restore no longer writes `status` (resume via `transitionMission`); idempotent replay checked before the blocked gate.
- Focused API + Item 12 hostile suites GREEN. Item 13 not started.

67. **Items 1–12 durable self-heal hardening.**

- **Recovery:** `healMissionFromCheckpoint`, `healBlockedMissionsFromCheckpoints`, `recoverAndHealMissions` — quarantine failed branch, retry last verified checkpoint, auto-heal cap 3.
- **Orchestrator:** durable checkpoints after inspect and after successful tests; failure path `blockThenHeal`.
- **Startup:** `start-agent-api` uses `recoverAndHealMissions`; `/health` recovery summary includes `healed`.
- **Hygiene:** `.gitignore` now excludes `workspace/`, `.env*`, `*.pass`.
- Evidence: `tests/integration/mission-self-heal.test.js` + updated orchestrator/API suites.
- Item 13 not started.

68. **Item 13 — Observability / execution tracing.** Acceptance: any failed mission can be reconstructed afterward.

- **Added:** `packages/mission/src/mission-execution-trace.js`, `tests/contract/mission-execution-trace.test.js`, `tests/integration/mission-execution-trace-item13.test.js`, `docs/current/ATHERE_OBSERVABILITY_TRACING.md`.
- **Wired:** mission create initializes `executionTrace`; every create/transition/fact/recovery commit appends derived events; optional `observability` bag on `transition` for tool/latency/model/token/cost; generic `transition` cannot forge `executionTrace`; `executionTrace` excluded from state-hash (same class as `transitionHistory`); `service.reconstruct({ missionId })`.
- **Orchestrator:** inspect + runTests record tool_call + latency into the observability bag.
- **Suite:** 344 pass / 0 fail / 17 skip (mesh Redis offline skips).
- **Security close:** unbounded observability + spoofable tool_call agentId closed (caps + actor bind, fail closed). Reconstruct remains forensic-only (trace still excluded from stateHash).
- Item 14 not started.

69. **Item 14 — Typed memory split (projection, not a parallel DB).** Acceptance: Athere can tell current state vs remembered history vs learned knowledge vs executable skill.

- **Added:** `packages/memory/src/typed-memory.js`, `tests/contract/typed-memory.test.js`, `tests/integration/typed-memory-item14.test.js`, `docs/current/ATHERE_TYPED_MEMORY.md`.
- **Wired:** `service.memory({ missionId, types? })` projects working/episodic/semantic/procedural/artifact/state_history from existing mission authority; generic `transition` cannot mutate `memory`.
- **Hostile (local):** forge `memory` via transition REJECT; superseded semantic fact is not working current state; classify rejects unknown fields/types.
- **Security close:** reader allowlist + enforced accessPolicy; projection caps; semantic/history/evidence redaction.
- **Suite:** 351 pass / 0 fail / 17 skip (pre-close baseline); re-verified after security closes.
- Item 15 (state-aware retrieval) not started.
