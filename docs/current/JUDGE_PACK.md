# Judge pack — Athere Mesh / Titan (Round 1 surface)

One page for reviewers. Everything else is linked.

## One sentence

**Athere** is the *there* for user-owned AI work: Titan commands missions over a typed **Resonance Bus** with proof, on a **Redis RAM** edge fabric, with **tokenless-default** policy — public progress fully traced on GitHub.

## Already published

- Entry: [AI Needs to Shut Up and Get to Work](https://hackernoon.com/ai-needs-to-shut-up-and-get-to-work)  
- Repo: https://github.com/justinevans4040-cloud/athere-mesh  
- Contest site: https://decentralizeai.tech/

## What shipped

| Slice / cut | Claim | Evidence |
|---|---|---|
| 0 Fabric | Redis RAM pool API + smoke | [smoke JSON](../../evidence/smoke-redis-pool-20260727-103136.json) · [demo](../../evidence/demos/athere-titan-slice0-demo.mp4) |
| 0b S24 Tailscale | Lenovo Titan → S24 Termux Redis over Tailscale | [smoke JSON](../../evidence/smoke-s24-redis-tailscale-20260730-122029.json) |
| 1 Bus | accepted→running→completed + proof | [smoke](../../evidence/smoke-resonance-bus-20260727-103621.json) · [demo](../../evidence/demos/athere-titan-slice1-demo.mp4) |
| 2 UI | Mission command operator surface | [smoke](../../evidence/smoke-mission-ui-20260727-122848.json) · [demo](../../evidence/demos/athere-titan-slice2-demo.mp4) |
| 3 Durable+policy | File durable + tokenless + external deny | [smoke](../../evidence/smoke-durable-policy-20260727-130214.json) · [demo](../../evidence/demos/athere-titan-slice3-demo.mp4) |
| 3b Postgres durable | Postgres client contract (Lenovo PGlite; Ubuntu next) | [smoke](../../evidence/smoke-durable-postgres-20260730-123416.json) |
| Arweave | S24 Redis smoke pinned permanently | [smoke](../../evidence/smoke-arweave-20260730-s24-redis.json) · [live](https://arweave.net/SdrVKy0BCjDMhIQQO7Igt-wSNvOSKq5zCXOXBbOGpe4) |
| Nosana | Short GPU smoke then STOPPED | [nosana/](../../evidence/nosana/) |

## How to review in &lt;10 minutes

Follow [CONTEST_DEMO_SCRIPT.md](CONTEST_DEMO_SCRIPT.md) or watch demos in order: [evidence/demos/README.md](../../evidence/demos/README.md).

## Direction docs

- [DIRECTION.md](DIRECTION.md)  
- [REDIS_RAM_POOL.md](REDIS_RAM_POOL.md)  
- [RESONANCE_BUS.md](RESONANCE_BUS.md)  
- [TITAN.md](TITAN.md)  
- [PROGRESS.md](PROGRESS.md) (full timeline)

## Honesty bounds

- This repo is the **public trail**; live code recreate lives on the operator Lenovo under `athere-titan`.  
- Brochure v0 is archived, not deleted: [archive/iterations/2026-07-brochure-v0/](../../archive/iterations/2026-07-brochure-v0/SNAPSHOT.md).  
- Founder agent personas are **not** reconstructed here.  
- S24 Redis claim is backed by Tailscale smoke (2026-07-30).  
- Postgres durable Lenovo smoke uses embedded PGlite with the **same SQL contract** Ubuntu/`DATABASE_URL` will use when the control plane is online.  
- Arweave permanence: S24 Redis smoke JSON is live at [arweave.net/SdrVKy0BCjDMhIQQO7Igt-wSNvOSKq5zCXOXBbOGpe4](https://arweave.net/SdrVKy0BCjDMhIQQO7Igt-wSNvOSKq5zCXOXBbOGpe4) (`winc=0`, SHA verified).  
- Nosana: short smoke only — stopped after proof.

## Build follow-up draft (publish on HackerNoon)

[HACKERNOON_BUILD_POST_DRAFT.md](HACKERNOON_BUILD_POST_DRAFT.md)
