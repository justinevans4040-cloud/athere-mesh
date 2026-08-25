# Redis and Apache Ignite on Ichabod

**Status:** Current infrastructure decision  
**Date:** 2026-08-25  
**Scope:** Athere Mesh memory, coordination, and future distributed-computing architecture

## Executive decision

Athere Mesh should continue using **Redis as its current hot-memory and coordination layer**. Apache Ignite should remain a **future option**, not a current installation target.

The decision is based on the machines that exist today:

| Machine | Current memory | Role |
|---|---:|---|
| Ichabod | 16 GB RAM | Dell Ubuntu controller |
| Lenovo | 16 GB RAM | Windows 11 Pro build/work machine |

Any discussion of 32 GB, 64 GB, 128 GB, or larger configurations describes possible future upgrades. Those figures are not the current hardware state.

Redis and Apache Ignite overlap in some areas, but they solve different-sized problems. Redis is the lighter tool for fast shared state, coordination, and messaging. Ignite is a distributed database and compute platform intended for structured data and processing across a compatible cluster. At Athere's current scale, Ignite would add memory pressure and operational complexity without a proven workload that requires it.

## The difference in plain language

Redis is like a very fast shared whiteboard. Applications and agents can place short-lived information on it, read it quickly, update counters, coordinate locks, publish events, or pull work from queues.

Apache Ignite is closer to a warehouse system with a database, inventory map, and workers. It can divide structured data across computers, run SQL queries over that data, replicate partitions, and send computation to cluster nodes.

The important distinction is that neither product turns several devices into one physically unified stick of RAM. They expose network services. Applications must deliberately store data in those services and use their APIs.

## Where Redis fits Athere Mesh

Redis directly supports Athere's current requirements:

- Fast agent state and mission state
- Resonance Bus signals and transport
- Short-lived scratch data
- Queues and work coordination
- Counters, locks, time-to-live values, and rate limits
- Cached results that can be recreated
- A relatively small operational footprint

Redis is an in-memory data store that supports strings, hashes, lists, sets, sorted sets, streams, JSON, replication, and optional disk persistence. It can be used as a cache, message broker, streaming engine, document store, or primary database depending on the design. See the official [Redis Open Source overview](https://redis.io/docs/latest/get-started/).

Redis persistence is configurable. RDB snapshots preserve point-in-time copies, while the append-only file records write operations for replay after restart. Persistence can also be disabled for data that is intentionally disposable. See [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).

That flexibility matches Athere's separation between hot operational memory and durable proof. Redis can carry live signals and short-lived state without being treated as the sole permanent record for every mission, audit, or artifact.

## Where Apache Ignite would fit later

Apache Ignite becomes valuable when Athere has a demonstrated need for capabilities beyond Redis:

- Distributed SQL tables and joins
- Transactional structured data spread across multiple machines
- Automatic partition placement and rebalancing
- Replicated data across reliable server nodes
- Large data-processing jobs divided across a cluster
- Compute jobs executed near the data they require

Ignite can run distributed, balanced, and fault-tolerant compute jobs on one node, several nodes, or an entire cluster. It also supports colocated execution, which places computation on the node containing the relevant data to reduce network movement. See the official [Apache Ignite compute documentation](https://ignite.apache.org/docs/ignite3/latest/developers-guide/compute/compute).

Ignite also supports persistent storage that keeps data on disk while loading data into RAM for processing, as well as volatile storage that keeps data only in RAM. See the [Ignite storage overview](https://ignite.apache.org/docs/ignite3/latest/administrators-guide/storage/storage-overview).

These are meaningful capabilities, but Athere should adopt them only when a real workload requires them.

## Why Ignite is deferred on the current machines

Ignite is a Java-based platform with both heap and off-heap memory requirements. Its current documentation states that the default Java heap allocation is 16 GB, although it can be changed. Storage engines reserve off-heap memory separately, and the operating system and other Athere services still require their own memory. See [Ignite general configuration guidance](https://ignite.apache.org/docs/ignite3/latest/general-tips).

A default Ignite configuration therefore does not fit safely on a 16 GB controller. Reducing the heap could make a development experiment possible, but merely making Ignite start is not the same as proving it benefits Athere.

Running Ignite on Ichabod today could compete with:

- Ubuntu and its background services
- Redis
- Titan and the Athere services
- Local models or inference services
- Build, indexing, monitoring, and recovery workloads

The Lenovo also has 16 GB of RAM. A two-machine cluster made from two already-busy 16 GB systems would add network coordination, failure handling, monitoring, backups, and version management while providing limited usable capacity.

The current Apache Ignite 3 documentation lists x86/x64 as the supported instruction-set architecture for nodes. Android/Termux devices must not be counted as Ignite server nodes unless their exact architecture and runtime compatibility are verified against the selected Ignite release. See [Ignite platform requirements](https://ignite.apache.org/docs/ignite3/latest/quick-start/embedded-mode).

## Redis and Ignite can coexist

This is not a permanent choice between one product and the other. A mature Athere deployment could use both:

| Layer | Recommended role |
|---|---|
| Redis | Live coordination, signals, queues, locks, cached results, and short-lived agent state |
| Apache Ignite | Distributed SQL, durable structured data, partitioned storage, and data-local cluster computation |
| Durable proof store | Mission history, evidence, audit records, and artifacts that must survive loss of hot memory |

Adding Ignite later should not require removing Redis. Each service should have a defined responsibility, memory ceiling, persistence policy, security boundary, and recovery test.

## Conditions for reconsidering Ignite

Ignite should be reconsidered only after all of the following are true:

1. Ichabod and the intended server nodes have confirmed hardware upgrades and measured spare memory.
2. At least two reliable, supported x86/x64 machines are available as server nodes.
3. Athere has a specific workload requiring distributed SQL, partitioned structured storage, or data-local compute.
4. Redis has been measured and shown to be insufficient for that workload.
5. A memory budget protects the operating system, Redis, Titan, and other critical services.
6. Persistence, backup, restart, node-loss, and recovery behavior can be tested with evidence.
7. Network discovery and service exposure are restricted to approved interfaces and authenticated peers.

## Present architecture position

For the current 16 GB Ichabod and 16 GB Lenovo:

- Keep Redis as Athere's hot shared-state and coordination technology.
- Do not install Ignite merely to consume or pool available RAM.
- Do not classify Android/Termux devices as Ignite server nodes.
- Continue measuring real memory use before allocating additional services.
- Preserve Ignite as a documented future option tied to explicit adoption criteria.

This position protects current stability without closing the door on a larger distributed data and compute layer after the hardware and workload justify it.

## Truth boundary

This paper records an architecture decision. It does not claim that Apache Ignite is installed, configured, or operational. It does not convert future RAM targets into present hardware facts. Multi-node service status must be established by live evidence from the machines involved.
