# Benchmark Results

_Last updated: 2025-10-31T03:18:05.066Z_

- crate commit: `3378839e0391`
- engram-core commit: `737209a6eabb`
- Node.js: v20.19.2
- Engine: rust | napi: yes | vfs: yes
- CPU: AMD Ryzen 5 5600X 6-Core Processor (12 logical cores)
- Memory: 31.9 GB total
- Disk: E: (88.83 GB free of 99.94 GB)
- OS: Windows_NT 10.0.26100 (x64)

These measurements keep Engram performance honest. Every run overwrites this file — use Git history for long-term trends.

## Quick glance
| Scenario | Archive size | Build time | Cold batch read | Warm batch read | Warm doc throughput | Warm query throughput |
| --- | --- | --- | --- | --- | --- | --- |
| Small knowledge base | 7.42 MB | 95.72 ms | 2.95 ms | 2.85 ms | 70,247 docs/s | 1,134.2 queries/s |
| Enterprise archive | 160.24 MB | 1949.82 ms | 13.53 ms | 26.45 ms | 37,808 docs/s | 203.4 queries/s |

Warm runs keep the archive and SQLite handles in memory, eliminating cold-start overhead.


## Scenario: Small knowledge base

Help-center snapshot with a single catalog database, medium JSON articles, and one media asset.

- Articles packaged: 1,200 (≈2.25 KB per article body)
- JSON batch size used for read tests: 200
- Binary payloads: assets/library-hero.bin (4.00 MB)
- SQLite databases: data/catalog.db (5,000 rows)
- Finished archive size: 7.42 MB

### Build timings
| Step | Result |
| --- | --- |
| SQLite payload preparation | 63.54 ms |
| Finalise archive | 95.72 ms |

Packing the small dataset completes in well under a quarter second.

### Access modes

#### Cold start (new process, unopened archive)
| Step | Result | Plain language |
| --- | --- | --- |
| Open archive | 31.37 ms | Time to make the Engram file ready |
| List 1,203 entries | 0.45 ms | Walk the central directory |
| Read manifest | 0.12 ms | Load archive metadata |
| Read 200 JSON docs | 2.95 ms | Batch content fetch |
| Avg per JSON doc | 0.01 ms | Individual fetch cost |
| JSON docs per second | 67,776 docs/s | Sustained throughput |
| JSON parse batch | 0.81 ms | Converting buffers to objects |
| Open 1 SQLite DB(s) | 30.98 ms | Ready DB handles |
| Analytical queries total | 23.23 ms | Dashboard workload |
| Queries per second | 1,076.4 queries/s | Aggregate throughput |
| Avg per query (per DB) | 0.93 ms | Individual SQL latency |
| JSON read bandwidth | 168.04 MB/s | Bulk bandwidth for the batch |

#### Warm process (module cached, archive reopened)
| Step | Result | Plain language |
| --- | --- | --- |
| Open archive | 27.04 ms | Time to make the Engram file ready |
| List 1,203 entries | 0.54 ms | Walk the central directory |
| Read manifest | 0.10 ms | Load archive metadata |
| Read 200 JSON docs | 3.12 ms | Batch content fetch |
| Avg per JSON doc | 0.02 ms | Individual fetch cost |
| JSON docs per second | 64,129 docs/s | Sustained throughput |
| JSON parse batch | 0.71 ms | Converting buffers to objects |
| Open 1 SQLite DB(s) | 34.97 ms | Ready DB handles |
| Analytical queries total | 23.73 ms | Dashboard workload |
| Queries per second | 1,053.6 queries/s | Aggregate throughput |
| Avg per query (per DB) | 0.95 ms | Individual SQL latency |
| JSON read bandwidth | 158.99 MB/s | Bulk bandwidth for the batch |

#### Long-lived service (archive + DB handles reused)
| Step | Result | Plain language |
| --- | --- | --- |
| Open archive | 0.00 ms | Time to make the Engram file ready |
| List 1,203 entries | 0.42 ms | Walk the central directory |
| Read manifest | 0.08 ms | Load archive metadata |
| Read 200 JSON docs | 2.85 ms | Batch content fetch |
| Avg per JSON doc | 0.01 ms | Individual fetch cost |
| JSON docs per second | 70,247 docs/s | Sustained throughput |
| JSON parse batch | 1.20 ms | Converting buffers to objects |
| Open 1 SQLite DB(s) | 0.00 ms | Ready DB handles |
| Analytical queries total | 22.04 ms | Dashboard workload |
| Queries per second | 1,134.2 queries/s | Aggregate throughput |
| Avg per query (per DB) | 0.88 ms | Individual SQL latency |
| JSON read bandwidth | 174.16 MB/s | Bulk bandwidth for the batch |

## Scenario: Enterprise archive

Enterprise knowledge base with 50k articles, three analytical SQLite DBs, and chunky binary bundles.

- Articles packaged: 50,000 (≈2.00 KB per article body)
- JSON batch size used for read tests: 1,000
- Binary payloads: assets/bundle-a.bin (16.00 MB), assets/bundle-b.bin (16.00 MB)
- SQLite databases: data/catalog.db (20,000 rows), data/analytics.db (15,000 rows), data/logs.db (15,000 rows)
- Finished archive size: 160.24 MB

### Build timings
| Step | Result |
| --- | --- |
| SQLite payload preparation | 414.56 ms |
| Finalise archive | 1949.82 ms |

Packing the large dataset takes around two seconds because of the extra databases and 160 MB payload.

### Access modes

#### Cold start (new process, unopened archive)
| Step | Result | Plain language |
| --- | --- | --- |
| Open archive | 1035.62 ms | Time to make the Engram file ready |
| List 50,006 entries | 17.92 ms | Walk the central directory |
| Read manifest | 0.12 ms | Load archive metadata |
| Read 1,000 JSON docs | 13.53 ms | Batch content fetch |
| Avg per JSON doc | 0.01 ms | Individual fetch cost |
| JSON docs per second | 73,931 docs/s | Sustained throughput |
| JSON parse batch | 2.90 ms | Converting buffers to objects |
| Open 3 SQLite DB(s) | 3108.82 ms | Ready DB handles |
| Analytical queries total | 291.24 ms | Dashboard workload |
| Queries per second | 206.0 queries/s | Aggregate throughput |
| Avg per query (per DB) | 4.85 ms | Individual SQL latency |
| JSON read bandwidth | 165.73 MB/s | Bulk bandwidth for the batch |

#### Warm process (module cached, archive reopened)
| Step | Result | Plain language |
| --- | --- | --- |
| Open archive | 1006.97 ms | Time to make the Engram file ready |
| List 50,006 entries | 16.81 ms | Walk the central directory |
| Read manifest | 0.12 ms | Load archive metadata |
| Read 1,000 JSON docs | 10.66 ms | Batch content fetch |
| Avg per JSON doc | 0.01 ms | Individual fetch cost |
| JSON docs per second | 93,802 docs/s | Sustained throughput |
| JSON parse batch | 2.89 ms | Converting buffers to objects |
| Open 3 SQLite DB(s) | 3213.11 ms | Ready DB handles |
| Analytical queries total | 189.30 ms | Dashboard workload |
| Queries per second | 317.0 queries/s | Aggregate throughput |
| Avg per query (per DB) | 3.15 ms | Individual SQL latency |
| JSON read bandwidth | 210.27 MB/s | Bulk bandwidth for the batch |

#### Long-lived service (archive + DB handles reused)
| Step | Result | Plain language |
| --- | --- | --- |
| Open archive | 0.00 ms | Time to make the Engram file ready |
| List 50,006 entries | 20.42 ms | Walk the central directory |
| Read manifest | 0.10 ms | Load archive metadata |
| Read 1,000 JSON docs | 26.45 ms | Batch content fetch |
| Avg per JSON doc | 0.03 ms | Individual fetch cost |
| JSON docs per second | 37,808 docs/s | Sustained throughput |
| JSON parse batch | 3.35 ms | Converting buffers to objects |
| Open 3 SQLite DB(s) | 0.00 ms | Ready DB handles |
| Analytical queries total | 295.04 ms | Dashboard workload |
| Queries per second | 203.4 queries/s | Aggregate throughput |
| Avg per query (per DB) | 4.92 ms | Individual SQL latency |
| JSON read bandwidth | 84.76 MB/s | Bulk bandwidth for the batch |

## Reproducing locally
1. Build the native module (`pnpm run build` or `pnpm run build:local`).
2. Run `pnpm run bench` (overwrites this file).
3. Commit the refreshed `BENCHMARK.md` so Git continues to track performance history.

> Benchmark history is intentionally maintained via Git commits. Compare revisions of `BENCHMARK.md` before claiming regressions or improvements.

