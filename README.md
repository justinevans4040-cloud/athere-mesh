# ATHERE Mesh

Current architecture authority:

- [Strategic directive](docs/current/ATHERE_MESH_STRATEGIC_DIRECTIVE.md)
- [Frozen architecture baseline](docs/current/ATHERE_ARCHITECTURE_BASELINE_2026-08-26.md)
- [Evaluation and regression harness](docs/current/ATHERE_EVALUATION_HARNESS.md)
- [Ordered modification backlog](research/ATHERE_MESH_MODIFICATION_BACKLOG_2026-08-25.md)

> People keep asking where they can go to find the technology they were promised.  
> They want to know if there is a *there*.  
> **There is. It’s called Athere.**

**CURRENT (2026-07-27):** Athere Mesh is a user-owned decentralized AI operating fabric. Titan is the mission command surface. Agents coordinate through a **Resonance Bus** of typed signals and proof — not essay handoffs. Shared edge memory is a **Redis RAM pool** across Tailscale-connected devices (phones/Termux + build cells). Ordinary work is **tokenless-default** and local-first.

This repository is the public, **traceable** record of that product direction for the [Decentralize AI](https://decentralizeai.tech/) / HackerNoon track.

Published entry: [AI Needs to Shut Up and Get to Work](https://hackernoon.com/ai-needs-to-shut-up-and-get-to-work)

---

## What changed (honest status)

| Era | What it was | Where to read it |
|---|---|---|
| Brochure v0 (early Jul 2026) | Docs-only concept scaffold | [archive/iterations/2026-07-brochure-v0/](archive/iterations/2026-07-brochure-v0/SNAPSHOT.md) |
| Direction align (2026-07-27) | Brand + Redis RAM share + Titan recreate + Resonance Bus | This README + [docs/current/](docs/current/) |
| Slices 0–3 + demos (2026-07-27) | Runnable fabric → bus → UI → durable/policy + MP4s | [PROGRESS](docs/current/PROGRESS.md) · [demos](evidence/demos/README.md) |
| Contest pack (2026-07-27) | Judge one-pager, &lt;10 min script, HackerNoon build draft | [JUDGE_PACK](docs/current/JUDGE_PACK.md) |

**Start here (judges):** [docs/current/JUDGE_PACK.md](docs/current/JUDGE_PACK.md)

**Nothing is deleted.** Prior intros and explanations are frozen under `archive/iterations/`. Live docs below are rewritten to match CURRENT direction and link back to history.

---

## The product (CURRENT)

- **Athere** — the destination: where AI stops promising and starts working; also the compact language / meaning layer for the mesh.
- **Titan** — mission command. Being **recreated to design** (Redis-first + typed bus). The old rewrite-damaged tree is not the product.
- **Resonance Bus** — structured A2A: intent/state/evidence/decision/handoff as machine-readable signals; proof-over-“done.”
- **Redis RAM share** — Android/Termux (and seed nodes) contribute capped RAM into one Tailscale-bound Redis fabric for hot scratch + bus transport.
- **COMS-SYNTAX** — CLAIM / PLAN / DONE / REVIEW / BLOCK for operator discipline.

Agents remain role-bound specialists (validation, resources, monitoring, stewardship). Founder-owned persona packs are not published here until provenance and hold rules allow.

---

## Documentation map

### Current direction

- [docs/current/DIRECTION.md](docs/current/DIRECTION.md)
- [docs/current/REDIS_RAM_POOL.md](docs/current/REDIS_RAM_POOL.md)
- [docs/current/RESONANCE_BUS.md](docs/current/RESONANCE_BUS.md)
- [docs/current/TITAN.md](docs/current/TITAN.md)
- [docs/current/PROGRESS.md](docs/current/PROGRESS.md)
- [docs/current/ACTION_LOG.md](docs/current/ACTION_LOG.md)
- [docs/current/JUDGE_PACK.md](docs/current/JUDGE_PACK.md)
- [docs/current/CONTEST_DEMO_SCRIPT.md](docs/current/CONTEST_DEMO_SCRIPT.md)
- [docs/current/HACKERNOON_BUILD_POST_DRAFT.md](docs/current/HACKERNOON_BUILD_POST_DRAFT.md)

### Rewritten living docs (history preserved in archive)

- [docs/HACKATHON_PITCH.md](docs/HACKATHON_PITCH.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/AGENTS.md](docs/AGENTS.md)
- [docs/WORKFLOW.md](docs/WORKFLOW.md)
- [docs/ATHERE_MESH_PAPER.md](docs/ATHERE_MESH_PAPER.md)

### Iteration archive

- [archive/iterations/](archive/iterations/) — dated snapshots of every public narrative pass
- [archive/ip-imports/](archive/ip-imports/) — associated IP excerpts with provenance labels
- [evidence/](evidence/) — smoke logs and demo artifacts as slices land
- [future-integrations/](future-integrations/) — **inactive, quarantined research material** retained for later hostile audit and integration

---

## One-line hook (CURRENT)

Athere is the *there*. Titan commands the mission. Redis shares the RAM. The Resonance Bus carries proof — not essays.

## License

MIT — see [LICENSE](LICENSE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Prefer additive PRs that archive prior text instead of deleting history.

## Repository Operations Template
This repository follows the standard operating files: STATUS.md, ROADMAP.md, CHANGELOG.md, CONTRIBUTING.md, SECURITY.md, GOVERNANCE.md, and REPO_TEMPLATE.md.
