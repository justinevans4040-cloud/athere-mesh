# Athere MCP / A2A Interop (Item 19)

Thin transport adapters for **MCP** (tools/resources) and **A2A** (external agent messaging). **Athere keeps the moat** — do not recreate MCP/A2A as proprietary core, and do not let them own mission control.

## Ownership boundary

Athere owns:

- mission authority
- memory
- verification
- policy
- state
- learning
- executive control

MCP/A2A provide connectivity only. `mission_control` is always false on transport capabilities.

## API

- `packages/contracts/src/protocol-interop.js` — owned capabilities, control-field rejection, MCP/A2A normalizers
- `packages/interop/src/mcp-adapter.js` — `createMcpAdapter({ callTool?, readResource?, listTools?, allowRemote? })`
- `packages/interop/src/a2a-adapter.js` — `createA2aAdapter({ send?, receive?, allowRemote? })`
- `packages/interop/src/protocol-bridge.js` — `createProtocolBridge({ mcp?, a2a? })` advisory observations only

Bridge does **not** expose `transition`, `certify`, `recordFact`, or `decideNext`.

## Acceptance

External MCP/A2A transports connect tools/resources/agents without owning or mutating Athere’s control protocol; results cannot carry mission control fields.

## Security (local)

- No new HTTP control surface
- Remote transports fail closed without `allowRemote: true`
- Forbidden control fields rejected at top level and one nested level (`content[]` / `parts[]` / sibling objects)
- `listTools` descriptors cannot carry `mission_control` or other control fields
- Bridge `owns.*` always false for Athere moat capabilities
- Injected transports only (no bundled MCP/A2A server SDK)

## Evidence

- `packages/contracts/src/protocol-interop.js`
- `packages/interop/src/mcp-adapter.js`
- `packages/interop/src/a2a-adapter.js`
- `packages/interop/src/protocol-bridge.js`
- `tests/contract/protocol-interop.test.js`
- `tests/integration/protocol-interop-item19.test.js`
