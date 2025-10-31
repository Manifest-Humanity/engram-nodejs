# Benchmark Results

_Last updated: 2025-10-31T02:55:50.063Z_

These measurements capture a documentation-archive workload. Each run overwrites this file; the Git history of `BENCHMARK.md` preserves historical trends.

## Test Environment
- Node.js: v20.19.2
- OS: Windows_NT 10.0.26100 (x64)
- CPU: AMD Ryzen 5 5600X 6-Core Processor             
- Memory: 31.9 GB

## Scenario: Archive build and query
- Articles: 1200 (~2.23 KB body each)
- Catalog rows: 5000 products
- Binary assets: 1 × 4.00 MB
- Archive size: 7.30 MB

### Timings
| Operation | Result |
| --- | --- |
| Prepare SQLite catalog | 44.18 ms |
| Write archive (finalize) | 87.38 ms |
| Cold open archive | 32.66 ms |
| List 1203 entries | 0.44 ms |
| Read manifest | 0.10 ms |
| Read 200 JSON docs (batched) | 2.58 ms |
| Average per JSON doc (read) | 0.01 ms |
| JSON parse batch | 0.81 ms |
| Open embedded SQLite DB | 29.29 ms |
| 25 analytical queries | 21.38 ms |
| Average per query | 0.86 ms |
| JSON read throughput | 186.09 MB/s |

## Reproducing
1. Ensure the native module is built (`pnpm run build` or `pnpm run build:local`).
2. Run `pnpm run bench`.
3. Review and commit the refreshed `BENCHMARK.md` to capture the results in Git history.

> Benchmark history is intentionally maintained through Git logs — compare revisions of `BENCHMARK.md` to see performance trends.
