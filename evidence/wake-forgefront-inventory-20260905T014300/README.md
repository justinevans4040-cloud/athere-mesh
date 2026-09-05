# Wake / ForgeFront collection — inventory-first (NOT a full Lenovo dump)

**Stamp:** 20260905T014300  
**Rule:** Lenovo has ~38GB free — do **not** copy ~100GB here. Bulk stays on **Ichabod** `/mnt/storage` (762GB free).

## Measured totals (evidence-backed)

| Location | What | Size |
|---|---|---|
| **Ichabod** `/mnt/storage/WAKE` | WAKE tree | **15.8 GB** (31,256 files) |
| **Ichabod** `/mnt/storage/forgefront-vault` | ForgeFront vault | **47.9 GB** (425,502 files) |
| **Ichabod** `/mnt/storage/archive` | archive (mixed) | **45.5 GB** (198,155 files) |
| **Ichabod** `/mnt/storage/WAKE_OFFLOAD` | WAKE offload | **0.8 GB** |
| **Ichabod bulk (indexed)** | Master index on disk | **110.0 GB** |
| Lenovo `SECURE_ATHERE_AGENT_VAULT` Wake/FF SOURCES | Already curated copies | **~1.0 GB** |
| Lenovo `F:\AI_LOCAL_BACKUP` | Cursor/Gemini scratch (partial Wake/FF) | **~12 GB** total folder; Wake/FF slices smaller |
| S24 Downloads (all) | Full Download tree | **~2.5 GB** |
| S24 Downloads name-match Wake/FF | Decks/mp4s | **~0.13 GB** |
| S24 Termux home | incl. ollama 1.3G + ignite | **~2.8 GB** |

## On Lenovo (this PC) — catalog + small pull only

| Path | Contents |
|---|---|
| `evidence/wake-forgefront-inventory-20260905T014300/` | Indexes, summaries, Ichabod master index |
| `evidence/s24-dump-20260905T014300/` | S24 mesh dump: downloads inventory, athere docs, **termux-home.tgz (~718 MB)** |

## Do NOT copy to Lenovo

- `/mnt/storage/WAKE`, `forgefront-vault`, `archive` on Ichabod  
- Full S24 media / ollama models unless Justin picks specific files  

## Staging policy

1. **Source of truth for bulk:** Ichabod `/mnt/storage/...`  
2. **Lenovo:** manifests + high-value docs (<20MB) + optional 718MB Termux dump (already pulled)  
3. **S24:** leave-in-place; use inventory lists to pull selectively  

## Next concrete step

On Ichabod, organize (or symlink) into one tree Justin can browse:

`/mnt/storage/WAKE_FORGEFRONT_LIBRARY/`  
→ `01_WAKE`, `02_FORGEFRONT`, `03_ARCHIVE_MIXED`, `04_MANIFESTS`

Or open SSH file browser to `/mnt/storage/WAKE` + `forgefront-vault` and start tagging duplicates using existing `13_MANIFESTS` under forgefront-vault.
