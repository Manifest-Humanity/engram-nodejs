#!/usr/bin/env node

/**
 * Benchmark runner for engram-nodejs.
 *
 * Generates two workloads side-by-side:
 *  1. Baseline "small archive" representative of a help center.
 *  2. Stress "enterprise archive" with tens of thousands of entries.
 *
 * Each workload records:
 *  - Build/packaging timings
 *  - Three access modes (cold start, warm module, warm handles)
 *  - Throughput normalised per document and per SQL query
 *
 * CI runs publish results to BENCHMARK.md for historical tracking.
 * Local runs emit LOCAL_BENCHMARK.md (git ignored) so you can inspect
 * your machine stats without churning the repo.
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
const ciBenchmarkPath = path.join(repoRoot, 'BENCHMARK.md');
const localBenchmarkPath = path.join(repoRoot, 'LOCAL_BENCHMARK.md');
const chartRelativePath = 'docs/bench-throughput-overview.svg';
const chartOutputPath = path.join(repoRoot, 'docs', 'bench-throughput-overview.svg');
const cargoLockPath = path.join(repoRoot, 'Cargo.lock');
const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

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
  if (seconds === 0) return '0 MB/s';
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
    // ignore - fall through to unknown
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
    metrics.read_doc_batch_bytes = totalBytes;
    metrics.read_doc_batch_mb_per_s =
      metrics.read_doc_batch_ms > 0
        ? (totalBytes / MB) / (metrics.read_doc_batch_ms / 1000)
        : 0;
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

function writeThroughputChart({ scenarioResults, outputPath }) {
  const dataPoints = scenarioResults.map((result) => {
    const warm = result.modes.warm_process_warm_archive ?? {};
    return {
      label: result.scenario.label,
      archiveMb: result.archiveSizeBytes / MB,
      docsPerSec: Number(warm.docs_per_sec) || 0,
      queriesPerSec: Number(warm.queries_per_sec) || 0,
      batchMs: Number(warm.read_doc_batch_ms) || 0,
      bandwidth: Number(warm.read_doc_batch_mb_per_s) || 0,
    };
  });

  if (dataPoints.length === 0) {
    const emptySvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="480" viewBox="0 0 960 480">
  <rect x="0" y="0" width="960" height="480" fill="#ffffff"/>
  <text x="480" y="248" text-anchor="middle" font-size="18" font-family="Segoe UI, Arial, sans-serif" fill="#555555">
    No benchmark data available
  </text>
</svg>
`;
    writeFileSync(outputPath, emptySvg, 'utf8');
    return;
  }

  const sortedData = [...dataPoints].sort((a, b) => a.archiveMb - b.archiveMb);

  const metricsConfig = [
    {
      key: 'docsPerSec',
      label: 'Docs per second (warm)',
      color: '#2d7dd2',
      formatter: (value) => formatNumber(value, 0, 'docs/s'),
      tickFormatter: (value) => formatNumber(value, 0),
      approxTickCount: 4,
    },
    {
      key: 'queriesPerSec',
      label: 'Queries per second (warm)',
      color: '#4cb944',
      formatter: (value) => formatNumber(value, 1, 'queries/s'),
      tickFormatter: (value) => formatNumber(value, 0),
      approxTickCount: 4,
    },
    {
      key: 'batchMs',
      label: 'JSON batch read (ms, warm)',
      color: '#f38d2e',
      formatter: (value) => formatMs(value),
      tickFormatter: (value) => formatNumber(value, 1),
      approxTickCount: 4,
    },
    {
      key: 'bandwidth',
      label: 'JSON bandwidth (MB/s, warm)',
      color: '#8750a1',
      formatter: (value) => formatNumber(value, 1, 'MB/s'),
      tickFormatter: (value) => formatNumber(value, 0),
      approxTickCount: 4,
    },
  ];

  const width = 960;
  const height = 640;
  const margin = { top: 72, right: 72, bottom: 140, left: 128 };
  const panelCount = metricsConfig.length;
  const panelGap = 32;
  const plotWidth = width - margin.left - margin.right;
  const plotLeft = margin.left;
  const plotRight = width - margin.right;
  const xInnerPadding = Math.min(120, plotWidth * 0.1);
  const xRangeStart = plotLeft + xInnerPadding;
  const xRangeEnd = plotRight - xInnerPadding;
  const plotInnerWidth = xRangeEnd - xRangeStart;
  const panelHeight =
    (height - margin.top - margin.bottom - panelGap * (panelCount - 1)) / panelCount;

  const maxArchive = Math.max(...sortedData.map((point) => point.archiveMb), 0);

  const buildTickData = (maxValue, approxTickCount = 4) => {
    if (!Number.isFinite(maxValue) || maxValue <= 0) {
      const ticks = [];
      const step = 1 / Math.max(approxTickCount, 1);
      for (let i = 0; i <= approxTickCount; i += 1) {
        ticks.push(Number((i * step).toFixed(2)));
      }
      return { axisMax: 1, ticks };
    }

    const roughStep = maxValue / Math.max(approxTickCount, 1);
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const residual = roughStep / magnitude;
    let niceResidual;
    if (residual >= 5) {
      niceResidual = 5;
    } else if (residual >= 2) {
      niceResidual = 2;
    } else {
      niceResidual = 1;
    }
    const step = niceResidual * magnitude;
    const axisMax = step * Math.ceil(maxValue / step);
    const ticks = [];
    for (let value = 0; value <= axisMax + step / 2; value += step) {
      ticks.push(Number(value.toFixed(6)));
    }
    return { axisMax, ticks };
  };

  const xTickData = buildTickData(maxArchive, 4);
  const xAxisMax = xTickData.axisMax || (maxArchive || 1);
  const xTicks = xTickData.ticks;
  const xScale = (value) =>
    xRangeStart +
    plotInnerWidth * (xAxisMax === 0 ? 0 : Math.min(Math.max(value, 0), xAxisMax) / xAxisMax);

  const formatArchiveTick = (value) => {
    if (value >= 10) return formatNumber(value, 0);
    return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  };

  const svgParts = [];
  svgParts.push('<?xml version="1.0" encoding="UTF-8"?>');
  svgParts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  svgParts.push('<rect x="0" y="0" width="100%" height="100%" fill="#ffffff"/>');
  svgParts.push(
    '<title>Warm throughput metrics across archive sizes</title>'
  );
  svgParts.push(
    `<desc>Warm Engram benchmarks for varying archive sizes, tracking docs per second, queries per second, JSON batch latency, and JSON bandwidth.</desc>`
  );

  xTicks.forEach((tick) => {
    const x = xScale(tick);
    svgParts.push(
      `<line x1="${x.toFixed(2)}" y1="${margin.top}" x2="${x.toFixed(
        2
      )}" y2="${height - margin.bottom}" stroke="#eef2f7" stroke-width="1"/>`
    );
  });

  sortedData.forEach((point) => {
    const x = xScale(point.archiveMb);
    svgParts.push(
      `<line x1="${x.toFixed(2)}" y1="${margin.top}" x2="${x.toFixed(
        2
      )}" y2="${height - margin.bottom}" stroke="#d7dee9" stroke-width="1" stroke-dasharray="4 4"/>`
    );
  });

  metricsConfig.forEach((metric, index) => {
    const values = sortedData.map((point) => Number(point[metric.key]) || 0);
    const { axisMax, ticks } = buildTickData(Math.max(...values, 0), metric.approxTickCount);
    const panelTop = margin.top + index * (panelHeight + panelGap);
    const panelBottom = panelTop + panelHeight;
    const panelColor = index % 2 === 0 ? '#f8fafc' : '#ffffff';

    svgParts.push(
      `<rect x="${xRangeStart.toFixed(2)}" y="${panelTop.toFixed(
        2
      )}" width="${plotInnerWidth.toFixed(2)}" height="${panelHeight.toFixed(2)}" fill="${panelColor}" />`
    );
    const panelLabelX = (xRangeStart + xRangeEnd) / 2;
    const panelLabelY = panelTop - 12;
    svgParts.push(
      `<text x="${panelLabelX.toFixed(2)}" y="${panelLabelY.toFixed(
        2
      )}" text-anchor="middle" font-size="12" font-weight="600" font-family="Segoe UI, Arial, sans-serif" fill="#1f2937">${metric.label}</text>`
    );

    svgParts.push(
      `<line x1="${xRangeStart.toFixed(2)}" y1="${panelTop.toFixed(
        2
      )}" x2="${xRangeStart.toFixed(2)}" y2="${panelBottom.toFixed(
        2
      )}" stroke="#cbd5e1" stroke-width="1.5"/>`
    );

    ticks.forEach((tick) => {
      const ratio = axisMax === 0 ? 0 : tick / axisMax;
      const y = panelBottom - ratio * panelHeight;
      svgParts.push(
        `<line x1="${xRangeStart.toFixed(2)}" y1="${y.toFixed(
          2
        )}" x2="${xRangeEnd.toFixed(2)}" y2="${y.toFixed(
          2
        )}" stroke="#e2e8f0" stroke-width="1"/>`
      );
      svgParts.push(
        `<text x="${(xRangeStart - 18).toFixed(2)}" y="${(y + 4).toFixed(
          2
        )}" text-anchor="end" font-size="11" font-family="Segoe UI, Arial, sans-serif" fill="#475569">${metric.tickFormatter(
          tick
        )}</text>`
      );
    });

    const axisSafeMax = axisMax || 1;
    const polyPoints = sortedData
      .map((point) => {
        const value = Number(point[metric.key]) || 0;
        const ratio = axisSafeMax === 0 ? 0 : value / axisSafeMax;
        const x = xScale(point.archiveMb);
        const y = panelBottom - ratio * panelHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

    svgParts.push(
      `<polyline points="${polyPoints}" fill="none" stroke="${metric.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
    );

    sortedData.forEach((point, pointIndex) => {
      const value = Number(point[metric.key]) || 0;
      const ratio = axisSafeMax === 0 ? 0 : value / axisSafeMax;
      const cx = xScale(point.archiveMb);
      const cy = panelBottom - ratio * panelHeight;
      svgParts.push(
        `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(
          2
        )}" r="5" fill="${metric.color}" stroke="#ffffff" stroke-width="2"/>`
      );

      const annotation = metric.formatter(value);
      let textY = cy - 10;
      if (textY < panelTop + 16) {
        textY = cy + 16;
      }
      svgParts.push(
        `<text x="${cx.toFixed(2)}" y="${textY.toFixed(
          2
        )}" text-anchor="middle" font-size="11" font-family="Segoe UI, Arial, sans-serif" fill="#1f2937">${annotation}</text>`
      );

      if (index === 0) {
        const labelY = cy - 30;
        const scenarioLabelY = labelY < panelTop + 12 ? panelTop + 12 : labelY;
        svgParts.push(
          `<text x="${cx.toFixed(2)}" y="${scenarioLabelY.toFixed(
            2
          )}" text-anchor="middle" font-size="11" font-family="Segoe UI, Arial, sans-serif" fill="#6b7280">${point.label}</text>`
        );
      }
    });
  });

  const axisY = height - margin.bottom;
  svgParts.push(
    `<line x1="${xRangeStart.toFixed(2)}" y1="${axisY.toFixed(
      2
    )}" x2="${xRangeEnd.toFixed(2)}" y2="${axisY.toFixed(
      2
    )}" stroke="#94a3b8" stroke-width="1.5"/>`
  );

  xTicks.forEach((tick) => {
    const x = xScale(tick);
    svgParts.push(
      `<text x="${x.toFixed(2)}" y="${(axisY + 20).toFixed(
        2
      )}" text-anchor="middle" font-size="11" font-family="Segoe UI, Arial, sans-serif" fill="#475569">${formatArchiveTick(
        tick
      )}</text>`
    );
  });

  sortedData.forEach((point) => {
    const x = xScale(point.archiveMb);
    svgParts.push(
      `<text x="${x.toFixed(2)}" y="${(height - margin.bottom + 44).toFixed(
        2
      )}" text-anchor="middle" font-size="12" font-family="Segoe UI, Arial, sans-serif" fill="#1f2937">${point.label}</text>`
    );
    svgParts.push(
      `<text x="${x.toFixed(2)}" y="${(height - margin.bottom + 60).toFixed(
        2
      )}" text-anchor="middle" font-size="11" font-family="Segoe UI, Arial, sans-serif" fill="#64748b">${formatNumber(
        point.archiveMb,
        2,
        'MB'
      )}</text>`
    );
  });

  svgParts.push(
    `<text x="${((xRangeStart + xRangeEnd) / 2).toFixed(
      2
    )}" y="${(height - margin.bottom + 80).toFixed(
      2
    )}" text-anchor="middle" font-size="13" font-family="Segoe UI, Arial, sans-serif" fill="#1f2937">Archive size (MB)</text>`
  );

  svgParts.push(
    `<text x="${((xRangeStart + xRangeEnd) / 2).toFixed(
      2
    )}" y="${(margin.top - 24).toFixed(
      2
    )}" text-anchor="middle" font-size="18" font-family="Segoe UI, Arial, sans-serif" fill="#111827">Warm throughput metrics vs archive size</text>`
  );

  svgParts.push('</svg>');

  writeFileSync(outputPath, `${svgParts.join('\n')}\n`, 'utf8');
}

function buildMarkdown({ metadata, scenarioResults, outputFileName, chartPath }) {
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

  const retentionNotice =
    outputFileName === 'BENCHMARK.md'
      ? 'These measurements keep Engram performance honest. CI runs overwrite this file - use Git history for long-term trends.'
      : 'These measurements keep Engram performance honest. This local snapshot is git ignored so you can iterate without repo churn.';

  const warmMetricsBullets = scenarioResults.length
    ? scenarioResults
        .map((result) => {
          const warm = result.modes.warm_process_warm_archive;
          return `- ${result.scenario.label}: ${formatNumber(
            warm.docs_per_sec,
            0,
            'docs/s'
          )}, ${formatNumber(warm.queries_per_sec, 1, 'queries/s')}, ${formatMs(
            warm.read_doc_batch_ms
          )} JSON batch, ${formatNumber(warm.read_doc_batch_mb_per_s, 1, 'MB/s')} throughput`;
        })
        .join('\n')
    : '*No warm metrics recorded.*';

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

${retentionNotice}

## Quick glance
| Scenario | Archive size | Build time | Cold batch read | Warm batch read | Warm doc throughput | Warm query throughput |
| --- | --- | --- | --- | --- | --- | --- |
${summaryRows}

### Warm throughput overview
![Warm throughput metrics vs archive size](${chartPath})

${warmMetricsBullets}

Warm runs keep the archive and SQLite handles in memory, eliminating cold-start overhead.

`;

  const sections = scenarioResults.map((result) => {
    const { scenario, archiveSizeBytes, prepareDatabaseMs, dbPrepDetails, writeArchiveMs, modes } =
      result;

    const datasetLines = [
      `- Articles packaged: ${formatCount(scenario.docCount)} (~${formatBytes(
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
        : 'Packing the large dataset takes around two seconds because of the extra databases and 160 MB payload.';

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

  const reproductionSteps =
    outputFileName === 'BENCHMARK.md'
      ? [
          'Build the native module (`pnpm run build` or `pnpm run build:local`).',
          'Run `pnpm run bench` locally to refresh `LOCAL_BENCHMARK.md` with your machine stats (git ignored).',
          'Use Git history for `BENCHMARK.md` (updated by CI) before claiming regressions or improvements.',
        ]
      : [
          'Build the native module (`pnpm run build` or `pnpm run build:local`).',
          'Run `pnpm run bench` again whenever you need to refresh this local snapshot.',
          'Compare with the committed `BENCHMARK.md` (published by CI) before claiming regressions.',
        ];

  const reproductionNote =
    outputFileName === 'BENCHMARK.md'
      ? 'Local runs intentionally leave `BENCHMARK.md` untouched. Commit updates generated by CI.'
      : '`LOCAL_BENCHMARK.md` is git ignored so you can iterate freely. CI owns the canonical `BENCHMARK.md`.';

  const footer = `## Reproducing locally
${reproductionSteps.map((step, idx) => `${idx + 1}. ${step}`).join('\n')}

> ${reproductionNote}
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

  writeThroughputChart({ scenarioResults, outputPath: chartOutputPath });

  const benchmarkOutputPath = isCi ? ciBenchmarkPath : localBenchmarkPath;
  const outputFileName = path.basename(benchmarkOutputPath);

  const markdown = buildMarkdown({
    metadata: {
      crateCommit,
      engramCoreCommit,
      nodeVersion: process.version,
      system: systemInfo,
    },
    scenarioResults,
    outputFileName,
    chartPath: chartRelativePath,
  });

  writeFileSync(benchmarkOutputPath, markdown, 'utf8');

  console.log(
    `Benchmark suite complete. Updated ${outputFileName} and ${chartRelativePath}.`
  );
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

export { writeThroughputChart };

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
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
}
