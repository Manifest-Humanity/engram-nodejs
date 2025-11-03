# Engram for Node.js

Engram ships a native Node.js addon plus a tidy TypeScript wrapper that lets you open `.eng` archives, stream files, and query the bundled SQLite databases without leaving JavaScript.

You get prebuilt binaries for the common desktop/server platforms, type definitions for TypeScript, and a small ergonomic API for both reading and authoring Engram archives.

## What you can do
- Mount an `.eng` archive and list, read, or batch fetch files.
- Inspect archive metadata, manifest contents, and media assets.
- Open the embedded SQLite database with zero-copy access.
- Create or update archives by writing files, JSON, and databases.
- Run the same code in Node.js, Electron, or serverless environments with Node 18+.

## Installation
Engram is published as a standard npm package with prebuilt native binaries.

```bash
# npm
npm install engram-nodejs

# or pnpm
pnpm add engram-nodejs

# or yarn
yarn add engram-nodejs
```

Requirements:
- Node.js 18 or newer (native fetch, worker threads, and napi ABI 8 support)
- macOS (x64/arm64), Windows (x64), or Linux (x64 glibc). More targets are coming; open an issue if you need something different.

No Rust toolchain or build dependencies are needed unless you choose to compile from source.

## Quick start

```ts
import { EngramArchive } from 'engram-nodejs';

const archive = new EngramArchive('path/to/my.archive.eng');

console.log(`Entries: ${archive.entryCount}`);
console.log(archive.listFiles().slice(0, 5));

const manifest = await archive.readJson('manifest.json');
console.log(`Project: ${manifest.name} v${manifest.version}`);

const db = archive.openDatabase('data/catalog.sqlite');
const topStories = db.query<{ id: string; title: string }>(
  'select id, title from posts order by published_at desc limit 10'
);
console.log(topStories);
```

## API highlights
- **`EngramArchive`** – open an archive, list files, read binary/text/JSON content, access the manifest, or open SQLite databases.
- **`EngramDatabase`** – run synchronous SQL queries (`query`, `queryOne`, `queryValue`, `execute`) against the embedded SQLite database.
- **`EngramWriter`** – create a new archive, add files from buffers/disk, set compression, attach manifests, and finish with `finalize()`.
- **`CompressionMethod`** – enumerate the compression algorithms supported when writing archives.

Check `lib/index.d.ts` or run your editor’s “Go to Definition” for the full typed surface area.

## Common recipes

### Read a text asset
```ts
const doc = await archive.readText('docs/intro.md');
```

### Stream multiple files at once
```ts
const [logo, hero] = await archive.readFiles([
  'assets/logo.svg',
  'assets/hero.png',
]);
```

### Build a new archive
```ts
import { EngramWriter, CompressionMethod } from 'engram-nodejs';

const writer = new EngramWriter('dist/my.export.eng');
writer.addManifest({ name: 'Sample', version: '1.0.0' });
writer.addJson('data/stats.json', { total: 42 });
writer.addFileWithCompression(
  'assets/hero.png',
  await fs.promises.readFile('public/hero.png'),
  CompressionMethod.Brotli,
);
writer.finalize();
```

## Working with TypeScript and bundlers
- Type definitions are bundled, so no extra `@types` package is needed.
- The package exports CommonJS (`require`) by default; if you are using ESM, rely on Node’s `createRequire` or enable transpiler interop (for example `esModuleInterop` in TypeScript).
- When shipping Electron apps, ensure the native binary ends up alongside your compiled JavaScript. Tools like `electron-builder` handle this automatically when you declare a dependency.

## Troubleshooting
- **“Cannot find module”** – ensure the install step completed; delete `node_modules` and reinstall if you upgraded Node versions.
- **Native module load errors** – verify you are on Node 18+ and one of the listed platforms. For other environments (e.g., Alpine) file an issue so we can provide a tailored build.
- **Archive path issues** – paths are resolved relative to the current working directory; pass absolute paths when embedding inside packaged apps.
- **Workflow schema validation** – if CI complains about the benchmark workflow shape, convert it to JSON and validate against GitHub’s schema:
  ```bash
  curl -sSL https://www.schemastore.org/github-workflow.json -o /tmp/github-workflow.schema.json
  npx js-yaml .github/workflows/benchmark-version-bump.yml > /tmp/benchmark-version-bump.json
  npx ajv-cli validate -s /tmp/github-workflow.schema.json -d /tmp/benchmark-version-bump.json
  ```

If you run into anything else, open an issue or start a discussion. We love seeing how you use Engram and are happy to help unblock you.

## License
MIT – see `LICENSE` for the full text.
