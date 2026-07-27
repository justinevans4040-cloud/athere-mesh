# ATHERE Mesh Architecture — CURRENT (2026-07-27)

> Historical brochure text (unchanged): [archive/iterations/2026-07-brochure-v0/docs/ARCHITECTURE.md](../archive/iterations/2026-07-brochure-v0/docs/ARCHITECTURE.md)

## Layers (CURRENT)

### 1. Athere
Destination and language layer. Brand: *there is a there — it’s called Athere.* Converts operating pressure into structured meaning (intent / state / evidence / decision / handoff) without requiring essay chat between agents.

### 2. Titan
Mission command spine. **Recreated to design** (not the wiped rewrite tree). Frames missions, exposes bus + RAM pool health, demands proof.

### 3. Fabric — Redis RAM pool
Tailscale-bound Redis contributors (Termux phones + seed nodes) share capped RAM for hot scratch and bus transport. See [current/REDIS_RAM_POOL.md](current/REDIS_RAM_POOL.md).

### 4. Resonance Bus
Typed signals on the fabric. See [current/RESONANCE_BUS.md](current/RESONANCE_BUS.md).

### 5. Agent mesh
Role-bound specialists (validate, coordinate, monitor, steward, execute). Identities are capability + policy — not permanent chat personas published without provenance.

## Flow (CURRENT)

1. Mission enters Titan.
2. Titan emits `accepted` on the Resonance Bus.
3. Deterministic / specialist workers advance `running` → `blocked` | `completed` with **proof**.
4. Redis RAM pool holds hot signal + scratch state.
5. Durable stores (next slices) keep audit and mission records.

## Design principle

Distribute trust and execution. Prefer compact signals and shared edge memory over one rented model and one fragile prompt.
