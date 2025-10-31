#!/usr/bin/env node

/**
 * Benchmark runner for engram-nodejs.
 *
 * Simulates a content-archive workload:
 *  - Generates an article corpus and SQLite catalog
 *  - Packages everything into an Engram archive
 *  - Reads batched content and executes SQL queries
 *
 * Produces BENCHMARK.md with the latest measurements.
 */

import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'engram-bench-'));
const benchOutputPath = path.join(repoRoot, 'BENCHMARK.md');

const cleanupPaths = [];

function formatMs(ms) {
  return `${ms.toFixed(2)} ms`;
}

function formatThroughput(bytes, ms) {
  const mb = bytes / (1024 * 1024);
  const seconds = ms / 1000;
  return `${(mb / seconds).toFixed(2)} MB/s`;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

async function main() {
  const { EngramWriter, EngramArchive, CompressionMethod, createManifest } = await import(
    '../lib/index.js'
  );
  const betterSqlite3 = await import('better-sqlite3');
  const Database = betterSqlite3.default ?? betterSqlite3;

  const scratchDir = path.join(tmpRoot, 'scratch');
  cleanupPaths.push(tmpRoot);
  await mkdir(scratchDir);

  const dbPath = path.join(scratchDir, 'catalog.db');
  const archivePath = path.join(scratchDir, 'benchmark.eng');
  const docCount = 1200;
  const docBody = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(40); // ~2.8KB
  const binaryAssetSize = 4 * 1024 * 1024; // 4 MB
  const docPaths = [];
  const metrics = {};

  // Prepare SQLite database
  const dbPrepStart = performance.now();
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      inventory INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const insertStmt = db.prepare(`
    INSERT INTO products (sku, name, category, price, inventory, updated_at)
    VALUES (@sku, @name, @category, @price, @inventory, @updated_at)
  `);
  const categories = ['archive', 'storage', 'analysis', 'workflow'];
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      insertStmt.run(row);
    }
  });
  const rows = Array.from({ length: 5000 }, (_, i) => {
    const category = categories[i % categories.length];
    return {
      sku: `SKU-${String(i + 1).padStart(5, '0')}`,
      name: `Engram Product ${i + 1}`,
      category,
      price: 49.99 + (i % 200) * 0.5,
      inventory: 1000 - (i % 100),
      updated_at: new Date(Date.now() - i * 86400000).toISOString(),
    };
  });
  insertMany(rows);
  db.close();
  metrics.prepare_database_ms = performance.now() - dbPrepStart;

  // Write Engram archive
  const writer = new EngramWriter(archivePath);
  const writeStart = performance.now();
  writer.addManifest(
    createManifest({
      name: 'benchmark-archive',
      version: '1.0.0',
      description: 'Synthetic archive used for performance measurements',
      author: 'Benchmark Suite',
    })
  );

  // Add documents
  for (let i = 0; i < docCount; i += 1) {
    const doc = {
      id: i + 1,
      slug: `article-${String(i + 1).padStart(5, '0')}`,
      title: `Knowledge base article #${i + 1}`,
      tags: ['engram', 'benchmark', categories[i % categories.length]],
      body: docBody,
      updated_at: new Date(Date.now() - i * 3600000).toISOString(),
      author: i % 2 === 0 ? 'Automation' : 'Documentation Team',
    };
    const archiveDocPath = `content/articles/${doc.slug}.json`;
    writer.addJson(archiveDocPath, doc);
    docPaths.push(archiveDocPath);
  }

  // Add media asset
  const assetBuffer = randomBytes(binaryAssetSize);
  writer.addFileWithCompression(
    'assets/library-hero.bin',
    assetBuffer,
    CompressionMethod.Zstd
  );

  // Add the SQLite database
  writer.addDatabase('data/catalog.db', dbPath);
  writer.finalize();
  metrics.write_archive_ms = performance.now() - writeStart;
  metrics.archive_size_bytes = statSync(archivePath).size;

  // Read benchmarks
  const openStart = performance.now();
  const archive = new EngramArchive(archivePath);
  metrics.open_archive_ms = performance.now() - openStart;

  const listStart = performance.now();
  const files = archive.listFiles();
  metrics.list_files_ms = performance.now() - listStart;
  metrics.archive_entry_count = files.length;

  const manifestStart = performance.now();
  archive.readManifest();
  metrics.read_manifest_ms = performance.now() - manifestStart;

  const batchPaths = docPaths.slice(0, 200);
  const readBatchStart = performance.now();
  const docBuffers = await archive.readFiles(batchPaths);
  metrics.read_doc_batch_ms = performance.now() - readBatchStart;
  metrics.read_doc_batch_avg_ms = metrics.read_doc_batch_ms / batchPaths.length;

  const parseStart = performance.now();
  for (const buffer of docBuffers) {
    JSON.parse(buffer.toString('utf-8'));
  }
  metrics.parse_doc_batch_ms = performance.now() - parseStart;

  const dbOpenStart = performance.now();
  const archiveDb = archive.openDatabase('data/catalog.db');
  metrics.open_database_ms = performance.now() - dbOpenStart;

  const queryIterations = 25;
  const queryStart = performance.now();
  for (let i = 0; i < queryIterations; i += 1) {
    const minPrice = 50 + (i % 20) * 10;
    const maxPrice = minPrice + 100;
    archiveDb.query(
      `
        SELECT sku, name, price, inventory
        FROM products
        WHERE price BETWEEN ? AND ?
        ORDER BY updated_at DESC
        LIMIT 50
      `,
      [minPrice, maxPrice]
    );
  }
  metrics.database_query_total_ms = performance.now() - queryStart;
  metrics.database_query_avg_ms = metrics.database_query_total_ms / queryIterations;

  const throughputMs = metrics.read_doc_batch_ms;
  const totalBytes = docBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  metrics.read_doc_batch_throughput = formatThroughput(totalBytes, throughputMs);

  // Build BENCHMARK.md
  const now = new Date();
  const systemInfo = {
    node: process.version,
    os: `${os.type()} ${os.release()} (${process.arch})`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    memory: `${(os.totalmem() / (1024 ** 3)).toFixed(1)} GB`,
  };

  const markdown = `# Benchmark Results

_Last updated: ${now.toISOString()}_

These measurements capture a documentation-archive workload. Each run overwrites this file; the Git history of \`BENCHMARK.md\` preserves historical trends.

## Test Environment
- Node.js: ${systemInfo.node}
- OS: ${systemInfo.os}
- CPU: ${systemInfo.cpu}
- Memory: ${systemInfo.memory}

## Scenario: Archive build and query
- Articles: ${docCount} (~${formatBytes(Buffer.byteLength(docBody))} body each)
- Catalog rows: 5000 products
- Binary assets: 1 × ${formatBytes(binaryAssetSize)}
- Archive size: ${formatBytes(metrics.archive_size_bytes)}

### Timings
| Operation | Result |
| --- | --- |
| Prepare SQLite catalog | ${formatMs(metrics.prepare_database_ms)} |
| Write archive (finalize) | ${formatMs(metrics.write_archive_ms)} |
| Cold open archive | ${formatMs(metrics.open_archive_ms)} |
| List ${metrics.archive_entry_count} entries | ${formatMs(metrics.list_files_ms)} |
| Read manifest | ${formatMs(metrics.read_manifest_ms)} |
| Read ${batchPaths.length} JSON docs (batched) | ${formatMs(metrics.read_doc_batch_ms)} |
| Average per JSON doc (read) | ${formatMs(metrics.read_doc_batch_avg_ms)} |
| JSON parse batch | ${formatMs(metrics.parse_doc_batch_ms)} |
| Open embedded SQLite DB | ${formatMs(metrics.open_database_ms)} |
| ${queryIterations} analytical queries | ${formatMs(metrics.database_query_total_ms)} |
| Average per query | ${formatMs(metrics.database_query_avg_ms)} |
| JSON read throughput | ${metrics.read_doc_batch_throughput} |

## Reproducing
1. Ensure the native module is built (\`pnpm run build\` or \`pnpm run build:local\`).
2. Run \`pnpm run bench\`.
3. Review and commit the refreshed \`BENCHMARK.md\` to capture the results in Git history.

> Benchmark history is intentionally maintained through Git logs — compare revisions of \`BENCHMARK.md\` to see performance trends.
`;

  writeFileSync(benchOutputPath, markdown, 'utf8');

  console.log('Benchmark complete.');
  console.table({
    'Archive size': formatBytes(metrics.archive_size_bytes),
    'Write archive': formatMs(metrics.write_archive_ms),
    'Read batch': formatMs(metrics.read_doc_batch_ms),
    'Batch throughput': metrics.read_doc_batch_throughput,
    'AVG query': formatMs(metrics.database_query_avg_ms),
  });
}

main()
  .catch((err) => {
    console.error('Benchmark failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const target of cleanupPaths) {
      try {
        rmSync(target, { recursive: true, force: true });
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') {
          console.warn(`Warning: failed to remove ${target}: ${cleanupError.message}`);
        }
      }
    }
  });
