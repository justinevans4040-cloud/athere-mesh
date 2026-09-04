# Athere Model Adapter (Item 18)

Universal model/agent adapter. **Replacing a foundation model does not change Athere’s control protocol.**

## Contract

- One completion shape: `complete({ agent, text }) → { content }`
- Capability registry lists providers (`ollama`, `openai`, `gemini`, `claude`, `local`, `none`)
- Every capability entry must set `mission_control: false`
- Model output is advisory only — never mission transition, MEA certification, or state mutation

## API

- `getModelCapability` / `listModelCapabilities` / `assertControlProtocolInvariant` — `packages/contracts/src/model-capability-registry.js`
- `createModelAdapter({ provider, model, allowRemote?, complete?, ... })` — `packages/agent/src/model-adapter.js`
- `createCompletionFromAdapter(adapter)` — drop-in for `createAgentRuntime({ complete })`
- `createOllamaCompletion` remains available; Ollama path still loopback-bound

## Wiring

- `scripts/chat.js` builds complete via the adapter (`ATHERE_MODEL_PROVIDER`, `ATHERE_MODEL`, `ATHERE_MODEL_ALLOW_REMOTE=1` for remotes)
- Default remains Ollama on loopback
- Remote providers require `allowRemote: true` and an injected `complete` (no live API keys in-repo)

## Acceptance

Swapping providers (ollama ↔ claude/openai/gemini/local) keeps the same runtime/chat control surface; adapter results cannot carry control fields.

## Security (local)

- No new HTTP control surface
- `mission_control: true` rejected
- Remote fail-closed without `allowRemote`
- Result keys other than `content` rejected
- `createCompletionFromAdapter` requires explicit capabilities and always re-wraps `complete` (no bypass of control-field filtering)
- Ollama non-loopback still refused by `createOllamaCompletion`

## Evidence

- `packages/contracts/src/model-capability-registry.js`
- `packages/agent/src/model-adapter.js`
- `tests/contract/model-adapter.test.js`
- `tests/integration/model-adapter-item18.test.js`
