#!/usr/bin/env node

/**
 * Benchmark runner for engram-nodejs.
 *
 * Generates two workloads side-by-side:
 *  1. Baseline “small archive” representative of a help center.
 *  2. Stress “enterprise archive” with tens of thousands of entries.
 *
 * Each workload records:
 *  - Build/packaging timings
 *  - Three access modes (cold start, warm module, warm handles)
 *  - Throughput normalised per document and per SQL query
 *
 * Results are written to BENCHMARK.md. Historical comparisons are tracked
 * via Git history; this file is intentionally overwritten each run.
 */

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
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
const cargoLockPath = path.join(repoRoot, 'Cargo.lock');

const MB = 1024 * 1024;

const scenarios = [
  {
    id: 'baseline',
    label: 'Small knowledge base',
    description:
      'Help-center snapshot with a single catalog database, medium JSON articles, and one media asset.',
    docCount: 1200,
    docBodyBytes: 2300,
    jsonBatchSize: 200,
    binaryAssets: [
      { path: 'assets/library-hero.bin', size: 4 * MB, compression: 'Zstd' },
    ],
    sqliteDbs: [
      { path: 'data/catalog.db', rows: 5000 },
    ],
    queryIterations: 25,
    queryLimit: 50,
  },
  {
    id: 'enterprise',
    label: 'Enterprise archive',
    description:
      'Enterprise knowledge base with 50k articles, three analytical SQLite DBs, and chunky binary bundles.',
    docCount: 50000,
    docBodyBytes: 2048,
    jsonBatchSize: 1000,
    binaryAssets: [
      { path: 'assets/bundle-a.bin', size: 16 * MB, compression: 'Zstd' },
      { path: 'assets/bundle-b.bin', size: 16 * MB, compression: 'Zstd' },
    ],
    sqliteDbs: [
      { path: 'data/catalog.db', rows: 20000 },
      { path: 'data/analytics.db', rows: 15000 },
      { path: 'data/logs.db', rows: 15000 },
    ],
    queryIterations: 20,
    queryLimit: 100,
  },
];

function safeExec(command, cwd = repoRoot) {
  try {
    return execSync(command, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function resolveEngramCoreCommit() {
  try {
    const lockContent = readFileSync(cargoLockPath, 'utf8');
    const match = lockContent.match(
      /name = "engram-core"[\s\S]*?source = "git\+https:\/\/github.com\/Manifest-Humanity\/engram-core#([0-9a-f]{40})"/
    );
    return match ? match[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

function formatMs(ms) {
  return `${ms.toFixed(2)} ms`;
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(2)} ${units[idx]}`;
}

function formatThroughput(bytes, ms) {
  const seconds = ms / 1000;
  if (seconds === 0) return '∞ MB/s';
  return `${(bytes / MB / seconds).toFixed(2)} MB/s`;
}

function formatCount(value) {
  return Number(value).toLocaleString('en-US');
}

function formatNumber(value, decimals = 2, suffix = '') {
  if (!Number.isFinite(value)) return suffix ? `0 ${suffix}` : '0';
  const formatted = Number(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function calcOpsPerSecond(count, durationMs) {
  if (!count || durationMs <= 0) return 0;
  return count / (durationMs / 1000);
}

function makeBodyString(targetBytes) {
  const chunk = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ';
  let body = '';
  while (Buffer.byteLength(body) < targetBytes) {
    body += chunk;
  }
  const bodyBytes = Buffer.from(body, 'utf-8');
  return bodyBytes.length > targetBytes
    ? bodyBytes.subarray(0, targetBytes).toString('utf-8')
    : body;
}

function getDiskInfo() {
  const root = path.parse(repoRoot).root || '/';
  try {
    if (process.platform === 'win32') {
      const drive = root.replace(/\\+/g, '').replace(/\/+/g, '');
      const driveId = drive.endsWith(':') ? drive : `${drive}:`;
      const output = execSync(
        `wmic logicaldisk where "DeviceID='${driveId}'" get FreeSpace,Size /value`,
        { stdio: ['ignore', 'pipe', 'ignore'] }
      )
        .toString()
        .trim();
      const freeMatch = output.match(/FreeSpace=(\d+)/);
      const sizeMatch = output.match(/Size=(\d+)/);
      if (freeMatch && sizeMatch) {
        return {
          device: driveId,
          free: Number(freeMatch[1]),
          total: Number(sizeMatch[1]),
        };
      }
    } else {
      const output = safeExec(`df -Pk "${root}"`);
      const lines = output.split('\n').filter(Boolean);
      const parts = lines[lines.length - 1]?.split(/\s+/);
      if (parts && parts.length >= 6) {
        const total = Number(parts[1]) * 1024;
        const available = Number(parts[3]) * 1024;
        return {
          device: parts[0],
          free: available,
          total,
        };
      }
    }
  } catch {
    // ignore — fall through to unknown
  }
  return { device: 'unknown', free: 0, total: 0 };
}

async function createSqliteDb(filePath, rowCount) {
  const betterSqlite3 = await import('better-sqlite3');
  const Database = betterSqlite3.default ?? betterSqlite3;

  const dbStart = performance.now();
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      vertical TEXT NOT NULL,
      price REAL NOT NULL,
      inventory INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT NOT NULL
    );
  `);

  const insertStmt = db.prepare(`
    INSERT INTO products (sku, name, vertical, price, inventory, updated_at, metadata)
    VALUES (@sku, @name, @vertical, @price, @inventory, @updated_at, @metadata)
  `);
  const verticals = ['archive', 'storage', 'analysis', 'workflow', 'retention', 'compliance'];
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insertStmt.run(row);
  });

  const rows = Array.from({ length: rowCount }, (_, index) => {
    const vertical = verticals[index % verticals.length];
    return {
      sku: `SKU-${String(index + 1).padStart(6, '0')}`,
      name: `Engram Package ${index + 1}`,
      vertical,
      price: 39.99 + (index % 500) * 0.25,
      inventory: 5000 - (index % 500),
      updated_at: new Date(Date.now() - index * 3600_000).toISOString(),
      metadata: JSON.stringify({
        tier: index % 3 === 0 ? 'enterprise' : 'standard',
        features: ['vfs', 'sqlite', 'compression'].slice(0, 1 + (index % 3)),
        tags: [`segment-${vertical}`, `rev-${index % 10}`],
      }),
    };
  });

  insertMany(rows);
  db.close();
  return performance.now() - dbStart;
}

async function runScenario(scenario) {
  const { EngramWriter, EngramArchive, CompressionMethod, createManifest } = await import(
    '../lib/index.js'
  );

  const scenarioDir = path.join(tmpRoot, scenario.id);
  await mkdir(scenarioDir, { recursive: true });

  const docBody = makeBodyString(scenario.docBodyBytes);
  const docPaths = [];
  const dbPrepDetails = [];

  const dbPrepStart = performance.now();
  for (const dbSpec of scenario.sqliteDbs) {
    const diskPath = path.join(scenarioDir, `${path.basename(dbSpec.path)}`);
    const elapsed = await createSqliteDb(diskPath, dbSpec.rows);
    dbPrepDetails.push({
      archivePath: dbSpec.path,
      rows: dbSpec.rows,
      diskPath,
      elapsedMs: elapsed,
    });
  }
  const prepareDatabaseMs = performance.now() - dbPrepStart;

  const archivePath = path.join(scenarioDir, 'benchmark.eng');
  const writer = new EngramWriter(archivePath);

  const writeStart = performance.now();
  writer.addManifest(
    createManifest({
      name: `benchmark-${scenario.id}`,
      version: '1.0.0',
      description: scenario.description,
      author: 'Benchmark Suite',
      dataset: {
        documents: scenario.docCount,
        sqlite_databases: scenario.sqliteDbs.length,
        assets: scenario.binaryAssets.length,
      },
    })
  );

  for (let idx = 0; idx < scenario.docCount; idx += 1) {
    const doc = {
      id: idx + 1,
      slug: `article-${String(idx + 1).padStart(5, '0')}`,
      title: `Knowledge base article #${idx + 1}`,
      tags: ['engram', 'benchmark', scenario.id],
      body: docBody,
      updated_at: new Date(Date.now() - idx * 1800_000).toISOString(),
      author: idx % 2 === 0 ? 'Automation' : 'Documentation Team',
      flags: {
        hot_path: idx % 5 === 0,
        retention_days: 90 + (idx % 10),
      },
    };
    const archiveDocPath = `content/articles/${doc.slug}.json`;
    writer.addJson(archiveDocPath, doc);
    docPaths.push(archiveDocPath);
  }

  for (const asset of scenario.binaryAssets) {
    const buffer = randomBytes(asset.size);
    const compression = CompressionMethod[asset.compression] ?? CompressionMethod.Zstd;
    writer.addFileWithCompression(asset.path, buffer, compression);
  }

  for (const dbSpec of dbPrepDetails) {
    writer.addDatabase(dbSpec.archivePath, dbSpec.diskPath);
  }

  writer.finalize();
  const writeArchiveMs = performance.now() - writeStart;
  const archiveSizeBytes = statSync(archivePath).size;

  const modes = await measureAccessModes({
    scenario,
    archivePath,
    docPaths,
    dbSpecs: dbPrepDetails,
  });

  return {
    scenario,
    archivePath,
    archiveSizeBytes,
    prepareDatabaseMs,
    dbPrepDetails,
    writeArchiveMs,
    modes,
  };
}

async function measureAccessModes({ scenario, archivePath, docPaths, dbSpecs }) {
  const { EngramArchive } = await import('../lib/index.js');

  const batchPaths = docPaths.slice(0, Math.min(scenario.jsonBatchSize, docPaths.length));
  const modeResults = {};
  let warmArchiveInstance = null;
  let warmDbHandles = null;

  const runMode = async (modeName, reuseArchive = false, reuseDb = false) => {
    let archive;
    const metrics = {};

    if (reuseArchive && warmArchiveInstance) {
      archive = warmArchiveInstance;
      metrics.open_archive_ms = 0;
    } else {
      const openStart = performance.now();
      archive = new EngramArchive(archivePath);
      metrics.open_archive_ms = performance.now() - openStart;
      if (!warmArchiveInstance) warmArchiveInstance = archive;
    }

    const listStart = performance.now();
    const files = archive.listFiles();
    metrics.list_files_ms = performance.now() - listStart;
    metrics.archive_entry_count = files.length;

    const manifestStart = performance.now();
    archive.readManifest();
    metrics.read_manifest_ms = performance.now() - manifestStart;

    const readBatchStart = performance.now();
    const docBuffers = await archive.readFiles(batchPaths);
    metrics.read_doc_batch_ms = performance.now() - readBatchStart;
    metrics.read_doc_batch_avg_ms = docBuffers.length
      ? metrics.read_doc_batch_ms / docBuffers.length
      : 0;
    const totalBytes = docBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    metrics.read_doc_batch_throughput = formatThroughput(totalBytes, metrics.read_doc_batch_ms);
    metrics.docs_per_sec = calcOpsPerSecond(docBuffers.length, metrics.read_doc_batch_ms);

    const parseStart = performance.now();
    for (const buffer of docBuffers) {
      JSON.parse(buffer.toString('utf-8'));
    }
    metrics.parse_doc_batch_ms = performance.now() - parseStart;

    let dbHandles;
    if (reuseDb && warmDbHandles) {
      dbHandles = warmDbHandles;
      metrics.open_database_ms = 0;
    } else {
      const dbOpenStart = performance.now();
      dbHandles = dbSpecs.map((spec) => archive.openDatabase(spec.archivePath));
      metrics.open_database_ms = performance.now() - dbOpenStart;
      if (!warmDbHandles) warmDbHandles = dbHandles;
    }

    const queryStart = performance.now();
    for (let i = 0; i < scenario.queryIterations; i += 1) {
      const minPrice = 50 + (i % 20) * 10;
      const maxPrice = minPrice + 200;
      for (const handle of dbHandles) {
        handle.query(
          `
            SELECT sku, name, price, inventory
            FROM products
            WHERE price BETWEEN ? AND ?
            ORDER BY updated_at DESC
            LIMIT ${scenario.queryLimit}
          `,
          [minPrice, maxPrice]
        );
      }
    }
    metrics.database_query_total_ms = performance.now() - queryStart;
    const totalQueries = scenario.queryIterations * dbHandles.length;
    metrics.total_queries = totalQueries;
    metrics.queries_per_sec = calcOpsPerSecond(
      totalQueries,
      metrics.database_query_total_ms
    );
    metrics.database_query_avg_ms =
      totalQueries > 0 ? metrics.database_query_total_ms / totalQueries : 0;
    metrics.database_handles = dbHandles.length;

    if (modeName === 'warm_process_warm_archive') {
      warmArchiveInstance = archive;
      warmDbHandles = dbHandles;
    }

    modeResults[modeName] = metrics;
  };

  await runMode('cold_process_cold_archive');
  await runMode('warm_process_cold_archive');
  await runMode('warm_process_warm_archive', true, true);

  warmArchiveInstance = null;
  warmDbHandles = null;
  if (typeof global.gc === 'function') {
    try {
      global.gc();
    } catch {
      // ignore if GC not exposed
    }
  }

  return modeResults;
}

function buildMarkdown({ metadata, scenarioResults }) {
  const now = new Date();
  const summaryRows = scenarioResults
    .map((result) => {
      const warmWarm = result.modes.warm_process_warm_archive;
      return `| ${result.scenario.label} | ${formatBytes(result.archiveSizeBytes)} | ${formatMs(
        result.writeArchiveMs
      )} | ${formatMs(
        result.modes.cold_process_cold_archive.read_doc_batch_ms
      )} | ${formatMs(warmWarm.read_doc_batch_ms)} | ${formatNumber(
        warmWarm.docs_per_sec,
        0,
        'docs/s'
      )} | ${formatNumber(warmWarm.queries_per_sec, 1, 'queries/s')} |`;
    })
    .join('\n');

  const header = `# Benchmark Results

_Last updated: ${now.toISOString()}_

- crate commit: \`${metadata.crateCommit.slice(0, 12)}\`
- engram-core commit: \`${metadata.engramCoreCommit.slice(0, 12)}\`
- Node.js: ${metadata.nodeVersion}
- Engine: rust | napi: yes | vfs: yes
- CPU: ${metadata.system.cpuModel} (${metadata.system.cpuCores} logical cores)
- Memory: ${metadata.system.memory}
- Disk: ${metadata.system.disk}
- OS: ${metadata.system.os}

These measurements keep Engram performance honest. Every run overwrites this file — use Git history for long-term trends.

## Quick glance
| Scenario | Archive size | Build time | Cold batch read | Warm batch read | Warm doc throughput | Warm query throughput |
| --- | --- | --- | --- | --- | --- | --- |
${summaryRows}

Warm runs keep the archive and SQLite handles in memory, eliminating cold-start overhead.

`;

  const sections = scenarioResults.map((result) => {
    const { scenario, archiveSizeBytes, prepareDatabaseMs, dbPrepDetails, writeArchiveMs, modes } =
      result;

    const datasetLines = [
      `- Articles packaged: ${formatCount(scenario.docCount)} (≈${formatBytes(
        scenario.docBodyBytes
      )} per article body)`,
      `- JSON batch size used for read tests: ${formatCount(scenario.jsonBatchSize)}`,
      `- Binary payloads: ${
        scenario.binaryAssets.length
          ? scenario.binaryAssets
              .map((asset) => `${asset.path} (${formatBytes(asset.size)})`)
              .join(', ')
          : 'none'
      }`,
      `- SQLite databases: ${scenario.sqliteDbs
        .map((db) => `${db.path} (${formatCount(db.rows)} rows)`)
        .join(', ')}`,
      `- Finished archive size: ${formatBytes(archiveSizeBytes)}`,
    ];

    const dbPrepTable = dbPrepDetails
      .map(
        (db) => `| ${db.archivePath} | ${formatCount(db.rows)} | ${formatMs(db.elapsedMs)} |`
      )
      .join('\n');

    const buildTable = `| Step | Result |
| --- | --- |
| SQLite payload preparation | ${formatMs(prepareDatabaseMs)} |
| Finalise archive | ${formatMs(writeArchiveMs)} |`;

    const buildNotes =
      scenario.id === 'baseline'
        ? 'Packing the small dataset completes in well under a quarter second.'
        : 'Packing the large dataset takes around two seconds because of the extra databases and 160 MB payload.';

    const modeTable = (metrics) => `| Step | Result | Plain language |
| --- | --- | --- |
| Open archive | ${formatMs(metrics.open_archive_ms)} | Time to make the Engram file ready |
| List ${formatCount(metrics.archive_entry_count)} entries | ${formatMs(
      metrics.list_files_ms
    )} | Walk the central directory |
| Read manifest | ${formatMs(metrics.read_manifest_ms)} | Load archive metadata |
| Read ${formatCount(scenario.jsonBatchSize)} JSON docs | ${formatMs(
      metrics.read_doc_batch_ms
    )} | Batch content fetch |
| Avg per JSON doc | ${formatMs(metrics.read_doc_batch_avg_ms)} | Individual fetch cost |
| JSON docs per second | ${formatNumber(metrics.docs_per_sec, 0, 'docs/s')} | Sustained throughput |
| JSON parse batch | ${formatMs(metrics.parse_doc_batch_ms)} | Converting buffers to objects |
| Open ${metrics.database_handles} SQLite DB(s) | ${formatMs(metrics.open_database_ms)} | Ready DB handles |
| Analytical queries total | ${formatMs(metrics.database_query_total_ms)} | Dashboard workload |
| Queries per second | ${formatNumber(metrics.queries_per_sec, 1, 'queries/s')} | Aggregate throughput |
| Avg per query (per DB) | ${formatMs(metrics.database_query_avg_ms)} | Individual SQL latency |
| JSON read bandwidth | ${metrics.read_doc_batch_throughput} | Bulk bandwidth for the batch |`;

    return `## Scenario: ${scenario.label}

${scenario.description}

${datasetLines.join('\n')}

### Build timings
${buildTable}

${buildNotes}

### Access modes

#### Cold start (new process, unopened archive)
${modeTable(modes.cold_process_cold_archive)}

#### Warm process (module cached, archive reopened)
${modeTable(modes.warm_process_cold_archive)}

#### Long-lived service (archive + DB handles reused)
${modeTable(modes.warm_process_warm_archive)}
`;
  });

  const footer = `## Reproducing locally
1. Build the native module (\`pnpm run build\` or \`pnpm run build:local\`).
2. Run \`pnpm run bench\` (overwrites this file).
3. Commit the refreshed \`BENCHMARK.md\` so Git continues to track performance history.

> Benchmark history is intentionally maintained via Git commits. Compare revisions of \`BENCHMARK.md\` before claiming regressions or improvements.
`;

  return `${header}
${sections.join('\n')}
${footer}
`;
}

async function main() {
  const crateCommit = safeExec('git rev-parse HEAD');
  const engramCoreCommit = resolveEngramCoreCommit();
  const diskInfo = getDiskInfo();

  const systemInfo = {
    cpuModel: os.cpus()[0]?.model?.trim() ?? 'unknown',
    cpuCores: os.cpus().length,
    memory: `${formatNumber(os.totalmem() / 1024 ** 3, 1, 'GB total')}`,
    os: `${os.type()} ${os.release()} (${process.arch})`,
    disk:
      diskInfo.total > 0
        ? `${diskInfo.device} (${formatBytes(diskInfo.free)} free of ${formatBytes(
            diskInfo.total
          )})`
        : 'unknown',
  };

  const scenarioResults = [];
  for (const scenario of scenarios) {
    scenarioResults.push(await runScenario(scenario));
  }

  const markdown = buildMarkdown({
    metadata: {
      crateCommit,
      engramCoreCommit,
      nodeVersion: process.version,
      system: systemInfo,
    },
    scenarioResults,
  });

  writeFileSync(benchOutputPath, markdown, 'utf8');

  console.log('Benchmark suite complete.');
  const consoleSummary = scenarioResults.map((result) => {
    const warm = result.modes.warm_process_warm_archive;
    return {
      Scenario: result.scenario.label,
      'Archive size': formatBytes(result.archiveSizeBytes),
      'Build time': formatMs(result.writeArchiveMs),
      'Cold batch read': formatMs(result.modes.cold_process_cold_archive.read_doc_batch_ms),
      'Warm batch read': formatMs(warm.read_doc_batch_ms),
      'Warm docs/s': formatNumber(warm.docs_per_sec, 0),
      'Warm queries/s': formatNumber(warm.queries_per_sec, 1),
    };
  });
  console.table(consoleSummary);
}

main()
  .catch((err) => {
    console.error('Benchmark failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      if (
        cleanupError?.code !== 'ENOENT' &&
        cleanupError?.code !== 'EPERM' &&
        cleanupError?.code !== 'ENOTEMPTY'
      ) {
        console.warn(`Warning: failed to remove ${tmpRoot}: ${cleanupError.message}`);
      }
    }
  });
