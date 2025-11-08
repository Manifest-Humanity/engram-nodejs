# Claude Code Guidance for Engram Node.js

**Last Updated:** 2025-11-07
**Version:** v0.1.3
**Branch:** main

---

## Project Overview

**Engram Node.js** is a native Node.js addon that provides high-performance bindings to the Engram archive format (.eng files). Built with Napi-rs, it combines Rust's speed and safety with JavaScript's ease of use, delivering prebuilt binaries for common platforms with zero runtime dependencies.

**Key Features:**
- Native performance with zero-copy operations
- TypeScript wrapper with full type definitions
- Prebuilt binaries for macOS (x64/arm64), Windows (x64), Linux (x64)
- Synchronous and asynchronous file reading
- Direct SQLite database access without extraction
- Batch operations for efficient multi-file reads
- Node.js 18+ with native fetch and worker threads support

**Use Cases:**
- Loading Engram archives in Electron apps
- Serverless functions accessing knowledge archives
- CLI tools working with .eng files
- Web servers streaming archive contents
- Desktop applications with offline-first data

---

## Architecture

### Directory Structure

```
engram-nodejs/
├── crates/
│   ├── engram-ffi/          # FFI layer for C bindings
│   │   ├── src/
│   │   │   └── lib.rs       # C-compatible API
│   │   └── Cargo.toml
│   │
│   └── engram-napi/         # Napi-rs bindings
│       ├── src/
│       │   └── lib.rs       # Node.js native module
│       └── Cargo.toml
│
├── src/
│   ├── index.ts             # TypeScript wrapper
│   └── native.d.ts          # Native module type definitions
│
├── lib/
│   ├── index.js             # Compiled JavaScript
│   └── index.d.ts           # Compiled type definitions
│
├── dist/                    # Prebuilt native binaries
│   ├── index.js             # Platform-specific .node files
│   └── *.node
│
├── tests/                   # Vitest test suites
├── examples/                # Usage examples
├── benchmarks/              # Performance benchmarks
├── scripts/                 # Build and utility scripts
│
├── package.json
├── tsconfig.json
└── Cargo.toml               # Workspace configuration
```

### Technology Stack

- **Napi-rs:** Native addon framework for Node.js
- **TypeScript:** Type-safe JavaScript wrapper
- **Rust:** Core implementation (engram-core + engram-vfs)
- **Vitest:** Modern test runner
- **pnpm:** Fast, efficient package manager

### Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│ User Application (JavaScript/TypeScript)            │
├─────────────────────────────────────────────────────┤
│ TypeScript Wrapper (src/index.ts)                   │
│  ├─ EngramArchive class                             │
│  ├─ EngramWriter class                              │
│  └─ EngramDatabase class                            │
├─────────────────────────────────────────────────────┤
│ Napi-rs Bindings (crates/engram-napi)              │
│  ├─ JsEngramArchive                                 │
│  ├─ JsEngramWriter                                  │
│  └─ JsEngramDatabase                                │
├─────────────────────────────────────────────────────┤
│ FFI Layer (crates/engram-ffi)                       │
│  └─ C-compatible API                                │
├─────────────────────────────────────────────────────┤
│ Engram Core (engram-core, engram-vfs)              │
│  ├─ Archive reader/writer                           │
│  ├─ Compression (LZ4, Zstd)                         │
│  └─ SQLite VFS                                      │
└─────────────────────────────────────────────────────┘
```

---

## Development Workflow

### Initial Setup

```bash
# Clone repository
git clone https://github.com/Manifest-Humanity/engram-nodejs.git
cd engram-nodejs

# Install dependencies (requires pnpm)
pnpm install

# Build native addon + TypeScript
pnpm run build

# Run tests
pnpm test

# Run examples
pnpm run example
```

### Development Commands

```bash
# Build (release mode)
pnpm run build                    # Native + TypeScript

# Build (debug mode, faster compilation)
pnpm run build:debug              # For development

# TypeScript only
pnpm run build:ts                 # Compile TypeScript

# Testing
pnpm test                         # Run all tests
pnpm run test:watch               # Watch mode

# Examples
pnpm run example                  # Run basic usage example

# Benchmarks
pnpm run bench                    # Performance benchmarks

# Local build for specific platform
pnpm run build:local              # Build for current platform
```

### Branch Naming Convention

```
main                              # Stable releases
feat/feature-name                 # New features
fix/bug-name                      # Bug fixes
perf/optimization-name            # Performance improvements
docs/documentation-update         # Documentation
refactor/code-improvement         # Code refactoring
test/test-additions               # Test improvements
```

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Types:** feat, fix, perf, docs, test, refactor, chore
**Scopes:** napi, ffi, ts, build, deps

**Example:**
```
feat(napi): Add batch file reading support

- Implement readFiles() for parallel file access
- Use Napi thread pool for async operations
- Add TypeScript wrapper with Promise<Buffer[]>
- Tests: 100% passing (15 new tests)

Performance: 3x faster than sequential reads for 10+ files

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Common Tasks

### Using EngramArchive (Reading Archives)

```typescript
import { EngramArchive } from 'engram-nodejs';

// Open archive
const archive = new EngramArchive('path/to/my.archive.eng');

// Get basic info
console.log(`Total entries: ${archive.entryCount}`);

// List all files
const files = archive.listFiles();
console.log(files.slice(0, 10));

// Check if file exists
if (archive.contains('manifest.json')) {
  // Get metadata
  const metadata = archive.getMetadata('manifest.json');
  console.log(`Size: ${metadata.uncompressedSize} bytes`);
  console.log(`Compression: ${metadata.compression}`);
}

// Read file (async)
const readmeData = await archive.readFile('README.md');
const readmeText = readmeData.toString('utf-8');

// Read file (sync)
const configData = archive.readFileSync('config.json');

// Read as text
const intro = await archive.readText('docs/intro.md');

// Read as JSON
const manifest = await archive.readJson('manifest.json');
console.log(`Project: ${manifest.name} v${manifest.version}`);

// Batch read multiple files
const [logo, hero, icon] = await archive.readFiles([
  'assets/logo.svg',
  'assets/hero.png',
  'assets/icon.png'
]);

// List files with prefix
const docs = archive.listPrefix('docs/');
console.log('Documentation files:', docs);
```

### Using EngramWriter (Creating Archives)

```typescript
import { EngramWriter, CompressionMethod } from 'engram-nodejs';
import fs from 'fs/promises';

// Create new archive
const writer = new EngramWriter('output/my-archive.eng');

// Add text content
writer.addText('README.md', '# My Archive\n\nHello world!');

// Add JSON content
writer.addJson('data/stats.json', {
  total: 42,
  updated: new Date().toISOString()
});

// Add file from memory with automatic compression
const logoData = await fs.readFile('assets/logo.svg');
writer.addFile('assets/logo.svg', logoData);

// Add file with specific compression
const imageData = await fs.readFile('assets/hero.png');
writer.addFileWithCompression(
  'assets/hero.png',
  imageData,
  CompressionMethod.Brotli
);

// Add file directly from disk
writer.addFileFromDisk('config.toml', 'path/to/config.toml');

// Add manifest
writer.addManifest({
  name: 'my-project',
  version: '1.0.0',
  description: 'My awesome archive',
  author: 'Your Name',
  created: new Date().toISOString()
});

// Add SQLite database
writer.addDatabase('data/catalog.sqlite', 'path/to/catalog.db');

// IMPORTANT: Must call finalize() before exiting
writer.finalize();
console.log('Archive created successfully!');
```

### Using EngramDatabase (Querying SQLite)

```typescript
import { EngramArchive } from 'engram-nodejs';

const archive = new EngramArchive('knowledge.eng');

// Open embedded database
const db = archive.openDatabase('data/knowledge.sqlite');

// Query multiple rows
const articles = db.query<{ id: number; title: string; category: string }>(
  'SELECT id, title, category FROM articles WHERE category = ? ORDER BY published_at DESC LIMIT 10',
  ['technology']
);

for (const article of articles) {
  console.log(`${article.id}: ${article.title}`);
}

// Query single row
const user = db.queryOne<{ id: number; name: string; email: string }>(
  'SELECT * FROM users WHERE id = ?',
  [42]
);

if (user) {
  console.log(`User: ${user.name} <${user.email}>`);
}

// Query single value
const count = db.queryValue<number>(
  'SELECT COUNT(*) FROM articles WHERE category = ?',
  ['science']
);
console.log(`Science articles: ${count}`);

// Execute INSERT/UPDATE/DELETE
const rowsAffected = db.execute(
  'UPDATE articles SET views = views + 1 WHERE id = ?',
  [123]
);
console.log(`Updated ${rowsAffected} rows`);

// Check if table exists
if (db.tableExists('comments')) {
  console.log('Comments table found');
}
```

### Helper Functions

```typescript
import { createManifest, type EngramManifest } from 'engram-nodejs';

// Create manifest with defaults
const manifest = createManifest({
  name: 'my-archive',
  version: '1.0.0',
  description: 'Archive description',
  author: 'Your Name',
  license: 'MIT'
});
// Automatically adds 'created' timestamp

// Type-safe manifest
const typedManifest: EngramManifest = {
  name: 'project',
  version: '2.0.0',
  custom_field: 'custom value'  // Additional fields allowed
};
```

---

## Building Native Addons

### Napi-rs Build Process

The Napi-rs workflow handles cross-compilation and platform-specific builds:

```bash
# Build for current platform (development)
pnpm exec napi build --platform --cargo-cwd ./crates/engram-napi dist

# Build in release mode (optimized)
pnpm exec napi build --platform --release --cargo-cwd ./crates/engram-napi dist

# Build for specific platform
pnpm exec napi build --platform --target x86_64-apple-darwin
pnpm exec napi build --platform --target aarch64-apple-darwin
pnpm exec napi build --platform --target x86_64-pc-windows-msvc
pnpm exec napi build --platform --target x86_64-unknown-linux-gnu
```

### Supported Platforms

Configured in `package.json`:

```json
{
  "napi": {
    "name": "engram-nodejs",
    "triples": {
      "defaults": true,
      "additional": [
        "x86_64-pc-windows-msvc",
        "x86_64-apple-darwin",
        "aarch64-apple-darwin",
        "x86_64-unknown-linux-gnu"
      ]
    }
  }
}
```

**Prebuilt Platforms:**
- macOS x64 (Intel)
- macOS ARM64 (Apple Silicon)
- Windows x64
- Linux x64 (glibc)

### CI/CD Build Pipeline

GitHub Actions automatically builds binaries for all platforms:

```yaml
# .github/workflows/build.yml
- Build on macOS (universal binary)
- Build on Windows
- Build on Linux
- Run tests on all platforms
- Publish prebuilt binaries to npm
```

---

## Testing

### Test Structure

```
tests/
├── archive.test.ts          # Archive reading tests
├── writer.test.ts           # Archive writing tests
├── database.test.ts         # SQLite VFS tests
└── fixtures/                # Test data
    ├── sample.eng
    └── test-data.sqlite
```

### Running Tests

```bash
# Run all tests
pnpm test

# Watch mode (auto-rerun on changes)
pnpm run test:watch

# Run specific test file
pnpm exec vitest run tests/archive.test.ts

# Run with logging
DEBUG=engram:* pnpm test
```

### Writing Tests

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EngramArchive, EngramWriter } from '../src/index';
import fs from 'fs/promises';

describe('EngramArchive', () => {
  const testArchive = 'test/fixtures/sample.eng';

  it('should open archive and list files', () => {
    const archive = new EngramArchive(testArchive);
    const files = archive.listFiles();

    expect(files).toContain('manifest.json');
    expect(archive.entryCount).toBeGreaterThan(0);
  });

  it('should read file contents', async () => {
    const archive = new EngramArchive(testArchive);
    const data = await archive.readFile('README.md');

    expect(data).toBeInstanceOf(Buffer);
    expect(data.length).toBeGreaterThan(0);
  });

  it('should query SQLite database', () => {
    const archive = new EngramArchive(testArchive);
    const db = archive.openDatabase('data/test.sqlite');

    const rows = db.query('SELECT * FROM test_table');
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('EngramWriter', () => {
  const outputPath = 'test/output/test-archive.eng';

  afterAll(async () => {
    await fs.unlink(outputPath).catch(() => {});
  });

  it('should create archive with files', () => {
    const writer = new EngramWriter(outputPath);

    writer.addText('README.md', '# Test Archive');
    writer.addJson('manifest.json', { name: 'test', version: '1.0.0' });
    writer.finalize();

    // Verify
    const archive = new EngramArchive(outputPath);
    expect(archive.contains('README.md')).toBe(true);
    expect(archive.contains('manifest.json')).toBe(true);
  });
});
```

---

## Publishing to npm

### Pre-publish Checklist

1. **Version bump** in `package.json`
2. **Update CHANGELOG.md** with release notes
3. **Run full test suite** on all platforms
4. **Build prebuilt binaries** via CI
5. **Test installation** from tarball

### Publishing Process

```bash
# 1. Bump version
npm version patch  # or minor, major

# 2. Build for all platforms (via GitHub Actions)
git push origin main --tags

# 3. After CI completes, publish to npm
npm publish

# Or with pnpm
pnpm publish
```

### Package Configuration

```json
{
  "name": "engram-nodejs",
  "version": "0.1.3",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "files": [
    "lib/",
    "dist/",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### .npmignore

```
# Exclude from npm package
src/
tests/
examples/
benchmarks/
crates/
target/
*.log
.env
tsconfig.json
vitest.config.ts
```

---

## Integration with Electron Apps

### Installation

```bash
npm install engram-nodejs
# or
pnpm add engram-nodejs
```

### Electron Main Process

```typescript
// main.ts
import { app, BrowserWindow } from 'electron';
import { EngramArchive } from 'engram-nodejs';
import path from 'path';

let mainWindow: BrowserWindow;

app.on('ready', () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load Engram archive from app resources
  const archivePath = path.join(app.getPath('userData'), 'knowledge.eng');
  const archive = new EngramArchive(archivePath);

  // Make archive available to renderer
  global.engramArchive = archive;

  mainWindow.loadFile('index.html');
});
```

### Electron Preload Script

```typescript
// preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('engram', {
  readFile: (path: string) => ipcRenderer.invoke('engram:readFile', path),
  listFiles: () => ipcRenderer.invoke('engram:listFiles'),
  query: (sql: string, params?: any[]) =>
    ipcRenderer.invoke('engram:query', sql, params)
});
```

### Electron Renderer Process

```typescript
// renderer.ts
declare global {
  interface Window {
    engram: {
      readFile: (path: string) => Promise<Buffer>;
      listFiles: () => Promise<string[]>;
      query: (sql: string, params?: any[]) => Promise<any[]>;
    };
  }
}

async function loadKnowledge() {
  const files = await window.engram.listFiles();
  console.log('Available files:', files);

  const manifest = await window.engram.readFile('manifest.json');
  console.log('Manifest:', JSON.parse(manifest.toString()));

  const articles = await window.engram.query(
    'SELECT * FROM articles ORDER BY created_at DESC LIMIT 10'
  );
  console.log('Recent articles:', articles);
}
```

### Packaging with electron-builder

```json
{
  "build": {
    "appId": "com.example.app",
    "files": [
      "dist/**/*",
      "node_modules/**/*",
      "package.json"
    ],
    "asarUnpack": [
      "node_modules/engram-nodejs/**/*"
    ]
  }
}
```

**Note:** The `asarUnpack` ensures native `.node` files are extracted and accessible.

---

## Troubleshooting

### "Cannot find module" Error

**Symptom:** `Error: Cannot find module 'engram-nodejs'`

**Causes:**
- Incomplete installation
- Node version mismatch
- Missing prebuilt binary for platform

**Solutions:**
```bash
# 1. Reinstall dependencies
rm -rf node_modules
pnpm install

# 2. Verify Node version
node --version  # Should be >= 18.0.0

# 3. Rebuild native module
pnpm run build

# 4. Check platform support
# Ensure you're on macOS (x64/arm64), Windows (x64), or Linux (x64)
```

### Native Module Load Errors

**Symptom:** `Error: The specified module could not be found`

**Causes:**
- Incompatible Node version
- Missing system libraries
- Architecture mismatch

**Solutions:**
```bash
# 1. Verify Node ABI compatibility
node -p "process.versions.modules"  # Should be 108+ (Node 18+)

# 2. On Linux, check glibc version
ldd --version  # Should be 2.17+

# 3. For Alpine Linux (musl), request musl build
# File an issue for additional platform support

# 4. Force rebuild
pnpm run build:local
```

### Archive Path Issues

**Symptom:** `Error: Archive not found` or `ENOENT`

**Causes:**
- Relative paths in packaged apps
- Archive moved or deleted
- Permissions issues

**Solutions:**
```typescript
// Use absolute paths
import path from 'path';

// ❌ Bad (relative)
const archive = new EngramArchive('data/archive.eng');

// ✅ Good (absolute)
const archivePath = path.join(__dirname, 'data', 'archive.eng');
const archive = new EngramArchive(archivePath);

// ✅ Electron (user data)
import { app } from 'electron';
const archivePath = path.join(app.getPath('userData'), 'archive.eng');

// ✅ Check existence first
import fs from 'fs';
if (fs.existsSync(archivePath)) {
  const archive = new EngramArchive(archivePath);
}
```

### TypeScript Type Issues

**Symptom:** Missing type definitions or type errors

**Solutions:**
```bash
# 1. Ensure TypeScript is installed
pnpm add -D typescript

# 2. Rebuild TypeScript definitions
pnpm run build:ts

# 3. Check tsconfig.json includes types
{
  "compilerOptions": {
    "types": ["node"]
  }
}

# 4. Import from correct path
import { EngramArchive } from 'engram-nodejs';  // ✅
import { EngramArchive } from 'engram-nodejs/lib';  // ❌
```

### Performance Issues

**Symptom:** Slow file reads or database queries

**Solutions:**
```typescript
// 1. Use batch operations for multiple files
// ❌ Slow (sequential)
for (const file of files) {
  await archive.readFile(file);
}

// ✅ Fast (parallel)
const data = await archive.readFiles(files);

// 2. Use synchronous reads when appropriate
// ❌ Unnecessary async overhead
const small = await archive.readFile('small.txt');

// ✅ Direct sync read
const small = archive.readFileSync('small.txt');

// 3. Cache frequently accessed data
const manifest = archive.readManifest();  // Cache this
const files = archive.listFiles();        // Cache this too

// 4. Use database indexes
db.execute('CREATE INDEX idx_category ON articles(category)');
```

### Workflow Schema Validation Error

**Symptom:** CI complains about benchmark workflow format

**Solution:**
```bash
# Convert YAML to JSON and validate
curl -sSL https://www.schemastore.org/github-workflow.json \
  -o /tmp/github-workflow.schema.json

npx js-yaml .github/workflows/benchmark-version-bump.yml \
  > /tmp/benchmark-version-bump.json

npx ajv-cli validate \
  -s /tmp/github-workflow.schema.json \
  -d /tmp/benchmark-version-bump.json
```

---

## Code Style

### TypeScript

```bash
# Format with prettier (if configured)
npx prettier --write src/**/*.ts

# Lint with ESLint (if configured)
npx eslint src/**/*.ts
```

### Rust (Napi)

```bash
# Format Rust code
cargo fmt --all

# Clippy lints
cargo clippy --all -- -D warnings
```

---

## Performance Benchmarks

### Running Benchmarks

```bash
# Run all benchmarks
pnpm run bench

# Benchmark specific operation
node benchmarks/read-benchmark.mjs
```

### Benchmark Results

See `BENCHMARK.md` for detailed performance comparisons:
- File reading: ~50ms for 10MB archive
- Database queries: ~2ms for indexed lookups
- Batch reads: 3x faster than sequential

---

## Resources

- **Main Repository:** https://github.com/Manifest-Humanity/engram-nodejs
- **Core Library:** https://github.com/Manifest-Humanity/engram-core
- **Specification:** https://github.com/Manifest-Humanity/engram-specification
- **Issues:** https://github.com/Manifest-Humanity/engram-nodejs/issues
- **NPM Package:** https://www.npmjs.com/package/engram-nodejs
- **Napi-rs Docs:** https://napi.rs

---

## Quick Reference

### Installation

```bash
npm install engram-nodejs
# or
pnpm add engram-nodejs
# or
yarn add engram-nodejs
```

### Basic Usage

```typescript
import { EngramArchive, EngramWriter } from 'engram-nodejs';

// Read
const archive = new EngramArchive('file.eng');
const data = await archive.readFile('README.md');

// Write
const writer = new EngramWriter('output.eng');
writer.addText('README.md', '# Hello');
writer.finalize();

// Query
const db = archive.openDatabase('data.sqlite');
const rows = db.query('SELECT * FROM users');
```

### Common Commands

```bash
pnpm install              # Install dependencies
pnpm run build            # Build native + TypeScript
pnpm test                 # Run tests
pnpm run example          # Run examples
pnpm run bench            # Benchmarks
```

---

**For AI Assistants:** This is a hybrid Node.js/Rust project using Napi-rs for native bindings. Always rebuild both Rust (via `napi build`) and TypeScript when making changes. The TypeScript wrapper in `src/index.ts` provides the user-facing API, while `crates/engram-napi` contains the Rust FFI bindings. Prebuilt binaries are distributed via npm; users shouldn't need Rust toolchain. When debugging native module issues, check Node version (18+), platform support, and ABI compatibility.
