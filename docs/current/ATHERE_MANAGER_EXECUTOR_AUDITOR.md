# Athere Manager / Executor / Auditor Contract

**Status:** implemented for the current authoritative mission path  
**Backlog:** `research/ATHERE_MESH_MODIFICATION_BACKLOG_2026-08-25.md`, Item 9

## Separation

Operational agents map onto four execution roles:

| Role | Agents | Authority |
| --- | --- | --- |
| Manager | `miss-vale-prime` | Interprets mission state, starts supervision, allocates work. May emit `running`. Cannot emit `completed` or advance `completedWork`. |
| Executor | `nyx`, `rune` | Performs observe/execute work and records evidence. May emit `running`. Cannot emit `completed` or advance `completedWork`. |
| Auditor | `qra_emerge_audit` | Independently examines resulting reality. May emit `running` when approving intermediate subgoal transitions, and `completed` for proof-gated mission success. Sole authority to advance `completedWork`. |
| Recovery | `qra_recovery_driver` | Blocks interrupted missions. May emit `blocked` only. |

The falsifiable acceptance claim is: **the component that performs an action does not possess sole authority to declare that action successful.**

## Enforcement boundary

Role taxonomy lives in `packages/contracts/src/execution-roles.js`. Authorization enters through `authorizeAgentOperation` (signal and action × role) and `authorizeCompletedWorkClaim` (success certification).

`createMissionStateService().transition` binds `signal.agent` to `envelope.agent_id` on every transition (fail closed) and applies `authorizeCompletedWorkClaim` from the authorized envelope agent on every state-changing transition that includes `completedWork` **or** emits `completed`. An executor or manager update that attempts to mark subgoals complete is rejected before publication.

### Independence is structural, not a payload scrape

Independence used to be decided by deep-scraping caller-supplied payloads (`evidence`, `result`, `artifactReferences`, `activeAgents`) for the certifier's agent id. That is retired. It let the attacker control the haystack, so it could never be proven closed: seven consecutive hostile audits each found a new encoding of the same string (synonym keys, object bags, combining marks, homoglyphs, base64 and percent encoding, character arrays, substring embeds, nest depth). It also forced the honest orchestrator to strip the certifier `agent` and `verifier` out of `artifactReferences`, which regressed Item 6 artifact provenance.

Independence is now decided from identity the **service** established:

- **Recorded performer set.** Every entry in the mission's hash-chained `transitionHistory` carries an `actor` written from `authorization.envelope.agent_id` and an `action` from the closed `OPERATIONS` map. A caller cannot author either without passing envelope authorization. `recordedWorkPerformers` collects the actors of entries that **performed work**: entries whose service-computed `changes` show a non-empty write to the authoritative `evidence` array, or whose recorded action is an executor action.
- **Independence rule.** When an agent advances `completedWork` or emits `completed`, the authorized envelope agent is rejected if it appears in that recorded performer set, or if the transition under authorization would itself write work evidence into authoritative state (perform-and-certify in one act). Service-recorded identities are compared to service-recorded identities.
- **Normalization.** Recorded ids come from the closed fleet registry, so `normalizeAgentId` is trim + casefold and nothing else. No lookalike map, no NFKD folding, no base64/URI decoding, no deep walk, no node budget.
- **Caller payloads are not an identity source at all.** `evidence` contents, `signal.result`, `signal.evidence`, `artifactReferences`, and `activeAgents` do not influence the decision. An executor may write any string it likes into evidence without affecting the auditor's authority, and no payload can rescue a certifier that the ledger recorded as a performer.

Scope is per mission and mission-wide: an agent recorded as a performer anywhere in a mission's ledger cannot certify work in that mission. This is stricter than per-subgoal attribution, which the ledger cannot establish without reading caller content.

**Known boundaries** (pinned by `tests/integration/mea-structural-provenance.test.js`):

- Writing `artifactReferences` is the auditor's own certification output and is required by Item 6, so it is not performance.
- `environmentObservations` writes and atomic fact operations are separate lifecycles and are not performance. The orchestrator does not grant the auditor fact permissions.
- Clearing the evidence array is not a work-evidence write; the prior value survives in the ledger `changes`.
- A mission imported from a pre-ledger snapshot has no recorded performer set, so independence cannot bite on it. Ledger-backed missions are unaffected.

Mission completion remains proof-gated **and** work-certified: a `completed` signal must leave `completedWork` covering `currentPlan.steps` (or subgoals) with empty `pendingWork` **and** empty `failedWork` after the update merge, then still re-read and verify proof bytes. Auditor-owned completion is necessary but not sufficient without independent work certification and proof verification.

## Operational orchestrator path

`createMissionOrchestrator` keeps the established agents, envelopes, operation IDs, and idempotency contract. Narrow MEA change:

1. Manager starts supervision (`running`).
2. Executors (`nyx` / `rune`) record evidence and `activeAgents` only; they do not advance `completedWork`. This makes them the recorded performers.
3. Auditor completion transition advances `completedWork` after independent proof and artifact provenance verification. The auditor writes no mission evidence, so it never enters the performer set.

The completion update carries full Item 6 artifact lineage — `artifactRef` plus the verified producer `agent`, `action`, and `verifierResult` (including `verifier: 'qra_emerge_audit'`). Restoring those fields is safe precisely because payload content is no longer an identity source.

## Acceptance evidence

Structural enforcement:

- `tests/contract/execution-roles.test.js` (7): role taxonomy, signal/action authority, `recordedWorkPerformers` derivation from ledger entries, recorded-actor independence, completedWork claim helper.
- `tests/integration/mea-structural-provenance.test.js` (7): auditor recorded as the actor of a prior evidence write cannot advance `completedWork` or emit `completed`; perform-and-certify in one transition rejected; planted payload names across every retired scrape channel do not block an independent auditor; the two known boundaries above are pinned.
- `tests/integration/manager-executor-auditor.test.js` (6): universal service rejection of executor/manager success claims; auditor-only `completedWork`; recorded performer ≠ certifier; orchestrator happy path with auditor-gated `completedWork`.
- `tests/integration/mea-hostile-signal-envelope-mismatch.test.js`: rejects forged `signal.agent` that disagrees with `envelope.agent_id`.
- `tests/integration/mea-hostile-completed-bypasses-completedWork.test.js`: rejects proof-gated `completed` that omits auditor-certified work coverage.
- `tests/integration/mea-hostile-completed-with-failedWork.test.js`: rejects `completed` while `failedWork` remains non-empty.
- `tests/integration/mea-hostile-same-update-self-cert.test.js`: rejects auditor perform+certify in one `completedWork` update.

Retired scrape-channel re-audit files (fifth/sixth/seventh, nested evidence/wrap, signal-result, signal-evidence-object, evidence-verifier) were **deleted** in ckpt 92 bloat cleanup. Their genuine acceptance requirements already live in `mea-structural-provenance` and the kept hostile pins above; payload IRRELEVANT duplicates were not retained.

Supporting:

- `tests/integration/mission-state-service.test.js`: lineage and persistence coverage on MEA-correct actors without dropping transition-history assertions.
- `tests/integration/mission-orchestrator.test.js`: end-to-end completion still proof-bound with NYX/RUNE evidence and auditor completion; completion `artifactReferences` asserts Item 6 producer `agent`/`action` and `verifierResult.verifier`.
- `tests/integration/artifact-proof.test.js`: `writeArtifactProof` / `verifyArtifactProof` still bind producer agent, action, and verifier decision to exact bytes.
