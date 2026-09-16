# Athere ADK-Style Ergonomics Layer Design

**Date:** 2026-09-16
**Status:** Approved design captured for implementation planning
**Branch:** `feat/adk-ergonomics-layer`
**Baseline:** `master` after merge commit `82c0a5773a0ce9c480a4c4f8366a3a592146c243`

## Objective

Improve Athere/Titan developer ergonomics without replacing or weakening the existing Athere control plane.

The implementation must preserve Athere's current mission authority, operation envelopes, capability binding, QR18 verification, MEA evidence rules, recovery behavior, model-provider boundaries, MCP boundaries, learning gates, agent identity, and dangerous-authority chain.

The work has four targets:

1. Prove and wire Prepared Context through the live operational agent invocation path.
2. Add progressive skill disclosure over the existing validated skill library.
3. Add typed lifecycle hooks that cannot acquire mission authority by default.
4. Add a thin declarative composition surface for agents, tools, skills, and hooks.

## Non-goals

This project will not:

- replace Athere orchestration with Google ADK or another framework;
- introduce a second mission-state authority;
- let MCP, model providers, skills, or lifecycle hooks mutate mission state directly;
- change Vale Prime identity or authority;
- edit The Britt 4.0 behavior, identity, or authority;
- reintroduce Odin into Athere Mesh;
- make Prepared Context a replacement database;
- create an alternate ungoverned agent runtime;
- convert the codebase from Node/JavaScript to Python;
- expand scope into unrelated refactors.

## Approaches considered

### Approach A: Adopt ADK-style runtime composition directly

Replace major Athere runtime/orchestrator surfaces with ADK agent/tool/skill composition.

**Rejected.** This would sacrifice mature Athere authority, verification, evidence, recovery, and fail-closed boundaries for convenience. It would also create migration risk in the most sensitive part of the system.

### Approach B: Add a thin ergonomics layer over existing Athere authority

Keep all authoritative Athere components intact and add small adapter surfaces that make context, skills, hooks, and composition easier to consume.

**Chosen.** This keeps the control plane authoritative while improving developer-facing composition. New features become clients of existing Athere services rather than replacements for them.

### Approach C: Create a separate developer-mode runtime

Build a second simplified runtime for rapid experimentation and bridge it back into Athere later.

**Rejected.** A second runtime risks drift, duplicated policy, ambiguous authority, and the exact second-source-of-truth problem that Prepared Context was designed to avoid.

## Architectural principle

The ergonomics layer is additive and subordinate.

```text
Declarative composition / lifecycle hooks / skill disclosure
                         |
                         v
                  Agent invocation
                         |
               Prepared Context binding
                         |
                         v
        Existing Athere mission authority
                         |
     envelopes / permissions / evidence / QR18
                         |
                         v
           existing execution providers
```

No new component may bypass the existing mission authority path.

## 1. Live Prepared Context binding

### Current state

Prepared Context is implemented on `master` in `packages/memory/src/prepared-context.js`. It provides deterministic packaging, immutable storage, reader binding, mission revision binding, integrity verification, and stale-context rejection.

The current Titan startup path creates the orchestrator and the advisory agent runtime independently. The current `mission-orchestrator.js` does not import Prepared Context, and `agent-runtime.js` currently receives only the agent, envelope, and objective text from its completion provider.

### Required behavior

Operational agent invocation must be able to receive only a Prepared Context package that has been resolved against current authoritative mission state.

The live flow must be:

```text
mission state
  -> state-aware retrieval
  -> prepareContextPackage()
  -> writePreparedContext()
  -> resolvePreparedContext()
  -> exact handle + integrity attached to invocation
  -> provider receives bounded resolved context
  -> invocation evidence records the same context identity
```

### Boundary

Prepared Context resolution belongs between mission authority and model/agent completion. The provider must not be allowed to select an arbitrary context package by path or bypass resolution.

### Proposed component

Add a focused runtime helper under `packages/agent/src/` or `packages/memory/src/` that accepts:

- authoritative mission service;
- prepared-context root;
- mission id;
- reader/agent identity;
- retrieval query;
- token budget.

It returns a resolved, verified context object plus its handle and integrity metadata.

The caller passes that object into the model completion request as data only. It grants no authority.

### Advisory chat

Current `/api/chat` advisory traffic uses synthetic advisory envelopes with state version `0` and no operational tools. Advisory chat must remain isolated from operational mission context unless it is explicitly bound to a real mission through an authorized operational path.

No silent mission-memory preload is permitted for public advisory chat.

## 2. Progressive skill disclosure

### Current state

`createValidatedSkillLibrary()` already provides gated publication, immutable versions, provenance, bounded skill counts, and `reuse()`.

### Required behavior

Agents should not receive every full skill procedure up front. They should first receive compact skill descriptors, then explicitly load one exact validated version when needed.

### New read surface

Expose a compact immutable descriptor for each available skill:

```text
skillId
version
purpose
prerequisites
inputs
outputs
verificationMethod
provenance summary
```

The descriptor must not silently expose mutable or unvalidated procedure content.

### Load surface

An authorized consumer selects a `skillId` and optional version. Loading delegates to the existing validated skill library `reuse()` method. The resulting payload retains exact skill id, version, procedure, verification method, and provenance.

### Evidence

Whenever an operational mission uses a skill, its evidence must be able to identify the exact `skillId@version` used. Skill loading itself does not grant permission to execute tools or mutate mission state.

### No duplicate skill store

The progressive-disclosure layer is only a view over `createValidatedSkillLibrary()`. It must not maintain a parallel skill database.

## 3. Typed lifecycle hooks

### Goal

Add extension points comparable to modern agent frameworks without moving policy out of Athere.

### Supported phases

Initial hook phases:

```text
before_context
after_context
before_agent
after_agent
before_tool
after_tool
before_verification
after_verification
```

### Hook contract

Each hook receives a frozen event object with only the data appropriate to its phase. Hooks return either:

- no result; or
- a strictly validated advisory metadata object.

Hooks must not receive direct store handles, proof-store mutation methods, dangerous-authority keys, or unrestricted orchestrator objects.

### Authority rule

Hooks have **zero mission-state authority by default**.

A hook cannot:

- transition mission state;
- add or rewrite mission evidence directly;
- grant actions;
- change agent identity;
- change capability binding;
- bypass QR18 or MEA;
- authorize dangerous actions.

If future work needs an authoritative hook action, it must be implemented as a normal Athere operation through an envelope and explicit permission rather than by expanding the generic hook interface.

### Failure policy

Operational hook phases fail closed by default if a configured required hook throws or returns invalid data. Optional telemetry-only hooks may be marked non-blocking explicitly.

Required versus optional is configuration, not inferred from function behavior.

## 4. Declarative composition surface

### Goal

Provide a compact, testable way to assemble an Athere agent-facing runtime without re-implementing the runtime.

### Proposed shape

Introduce a builder/normalizer that accepts declarative configuration for:

- registered agent id;
- expected capability id;
- model adapter;
- permitted tool adapters;
- skill-disclosure source;
- lifecycle hooks;
- prepared-context policy.

The builder validates the configuration against existing fleet/capability contracts and returns a frozen composition object consumed by the existing runtime.

### Rules

The composition layer must:

- resolve agents from the canonical fleet registry;
- reject unknown or disabled agents;
- reject capability mismatches;
- preserve owner/public distribution rules;
- require explicit remote-provider permission through the existing model adapter;
- preserve MCP's `mission_control === false` invariant;
- expose only validated skills;
- bind operational context through the Prepared Context resolver;
- never own mission state.

### Why a composition object instead of a second runtime

A frozen composition object improves setup ergonomics while keeping execution in `createAgentRuntime()` and authoritative workflow in `createMissionOrchestrator()`.

## Component boundaries

### Existing components that remain authoritative

- `packages/orchestrator/src/mission-orchestrator.js`
- mission state service and stores
- operation-envelope contracts
- permission/authorization contracts
- QR18 verification
- MEA/proof paths
- recovery coordinator
- fleet registry
- model capability registry
- MCP/A2A protocol boundaries
- validated learning and skill library

### New or extended components

Expected implementation footprint:

- `packages/agent/src/agent-composition.js` or equivalent focused module;
- `packages/agent/src/lifecycle-hooks.js` or equivalent focused module;
- a progressive skill-disclosure module near `packages/skills/src/`;
- a Prepared Context invocation binding helper near `packages/agent/src/` or `packages/memory/src/`;
- minimal integration edits to `agent-runtime.js`, startup wiring, and operational invocation paths;
- contract tests under `tests/contract/`;
- focused integration tests proving context identity and evidence alignment;
- documentation for the public composition contract.

File names may change during implementation if existing repository conventions make a different placement clearly better, but responsibilities must remain separated.

## Data flow

### Operational invocation

```text
command
  -> MissionOrchestrator
  -> authorized operation envelope
  -> context policy requests mission-bound context
  -> Prepared Context package is created/written/resolved
  -> before_context / after_context hooks
  -> exact resolved context identity bound to invocation
  -> progressive skill descriptor selection
  -> exact validated skill version loaded if requested
  -> before_agent hook
  -> AgentRuntime capability/profile checks
  -> model adapter completion
  -> after_agent hook
  -> verification / evidence path
  -> before_verification / after_verification hooks
  -> QR18 / MEA remain authoritative
```

### Tool invocation

```text
agent operation
  -> existing permission/capability check
  -> before_tool hook
  -> existing adapter/executor
  -> after_tool hook
  -> existing evidence/verification path
```

Hooks wrap observability and advisory metadata around existing authority checks. They do not replace those checks.

## Error handling

### Prepared Context

Fail closed on:

- mission revision mismatch;
- reader mismatch;
- handle mismatch;
- integrity mismatch;
- selected context exceeding budget;
- unavailable required authoritative state.

### Skills

Fail closed on:

- unknown skill;
- invalid version;
- unvalidated source;
- library/pipeline mismatch;
- mutation attempt.

### Hooks

Fail closed for required operational hooks on:

- exception;
- timeout;
- invalid return shape;
- attempted authority-bearing fields.

Optional telemetry hooks may be configured to fail open, but their failures must be observable.

### Composition

Reject configuration before runtime creation on:

- unknown agent;
- disabled agent;
- capability mismatch;
- invalid provider configuration;
- unapproved remote provider;
- invalid skill source;
- invalid hook definition;
- prepared-context policy that lacks authoritative resolution dependencies.

## Compatibility

Existing advisory API behavior remains compatible by default.

Existing mission execution remains authoritative and should continue working when no new hooks, skill disclosure, or context composition configuration is supplied.

The new layer should be opt-in during the first implementation pass, then become the canonical construction path only after contract and regression tests prove parity.

## Security invariants

The implementation must preserve these invariants:

1. Mission state has exactly one authority chain.
2. Model output cannot contain control fields that become authoritative state implicitly.
3. MCP cannot own mission control.
4. Advisory chat cannot silently gain operational tools or mission authority.
5. Prepared Context must be current-state-valid at activation time.
6. Skill reuse is versioned, immutable, and traceable to validated learning.
7. Lifecycle hooks do not receive mission mutation capability.
8. Agent identity and capability binding are checked before completion.
9. Dangerous-authority behavior remains outside this change.
10. The Britt 4.0 is not edited.
11. Odin remains outside Athere Mesh.

## Testing strategy

Implementation follows TDD.

### Contract tests

Add failing tests before implementation for:

- prepared-context invocation binding;
- stale-context rejection at the live invocation boundary;
- exact context handle/integrity propagation;
- compact skill listing;
- exact skill-version loading;
- proof that skill disclosure delegates to the canonical validated library;
- lifecycle phase ordering;
- frozen hook input;
- hook authority-field rejection;
- required-hook fail-closed behavior;
- optional telemetry-hook non-blocking behavior;
- composition validation for agent/capability/profile/provider boundaries.

### Integration tests

Prove at least one operational mission path where:

- authoritative mission state produces a Prepared Context package;
- the same package is resolved immediately before invocation;
- the agent/provider receives its bounded context;
- the mission evidence or trace identifies the exact context handle/integrity;
- stale state causes invocation to stop rather than silently continue.

### Regression

Run:

- prepared-context contract suite;
- new ergonomics-layer contract suites;
- existing API/runtime tests;
- full `pnpm test` regression suite;
- relevant smoke tests that can run hermetically in CI.

No completion claim is valid until the full regression suite is green.

## Implementation order

1. Prepared Context live invocation binding.
2. Progressive skill disclosure.
3. Lifecycle hooks.
4. Declarative composition.
5. Integrate composition into Titan startup behind compatibility-preserving defaults.
6. Run hostile review against authority bypass, stale context, skill provenance, hook escalation, and advisory/operational boundary crossing.
7. Fix findings and repeat verification until no known critical or high-severity findings remain.

This order intentionally proves the highest-value context path before adding ergonomic abstractions around it.

## Success criteria

The change is complete when all of the following are demonstrated in code and tests:

- a real operational agent invocation receives resolved Prepared Context;
- stale or reader-mismatched context cannot reach the provider;
- the exact context identity is observable in the mission's execution evidence/trace path;
- agents can list compact validated skills and load one exact version without a duplicate store;
- hooks run in deterministic typed phases and cannot mutate mission authority;
- declarative composition can assemble a valid agent configuration while rejecting authority/capability violations;
- existing advisory chat behavior remains isolated;
- existing full regression suite passes;
- no edits are made to The Britt 4.0 authority behavior;
- Odin remains outside the mesh.

## Rollback strategy

All new behavior must be additive and compatibility-preserving during rollout. If a new composition path fails verification, Titan startup can continue using the existing direct construction path while the feature branch is repaired.

No migration will delete existing mission state, proof data, prepared contexts, skill history, or agent registry data.
