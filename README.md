# Engram Node.js Bindings

`engram-nodejs` packages the Rust native module (via NAPI-RS) together with a TypeScript API for working with Engram archives from Node.js or Electron. It depends on the Rust core implementation that now lives in the sibling [`engram-core`](../engram-core) repository.

## Layout
- `crates/engram-napi`: Rust N-API module exposing the Engram API to JavaScript.
- `crates/engram-ffi`: Optional C FFI layer reused by other bindings.
- `src/`: TypeScript source for the public JavaScript API.
- `lib/`: Pre-built JavaScript typings and CommonJS bundle produced by `pnpm run build`.
- `examples/`: Usage samples (`pnpm run example`).
- `tests/`: Vitest-based integration tests.

## Prerequisites
- Node.js 18+
- pnpm 8+
- Rust toolchain with a stable compiler
- Native build tooling for your platform (MSVC on Windows, Xcode CLT on macOS, GCC/Clang on Linux)
- GitHub personal access token (PAT) with read access to [`Manifest-Humanity/engram-core`](https://github.com/Manifest-Humanity/engram-core), exported as `ENGRAM_CORE_TOKEN`

The Rust crates reference the `engram-core` repo via a relative path (`../../engram-core/...`). When you publish this repository independently, replace those path dependencies with the appropriate git or registry references.

## Install & Build
```bash
git clone https://github.com/yourusername/engram-nodejs.git
cd engram-nodejs
cp .env.example .env    # populate ENGRAM_CORE_TOKEN (and optional NPM_TOKEN)
pnpm run build:local    # installs deps and runs the full build
```

### Testing
```bash
pnpm test          # One-off test run
pnpm run test:watch
```

### Running the example
```bash
pnpm run example
```

### Manual build invocation
If you prefer to drive the steps yourself:
```bash
pnpm install --frozen-lockfile
pnpm run build
```

## Benchmarks
- Review the latest numbers in `BENCHMARK.md` (history is preserved via Git commits).
- Generate fresh measurements locally with `pnpm run bench`. The command rebuilds a synthetic archive, runs database and file-access scenarios, updates `BENCHMARK.md`, and should be committed alongside your changes.
- GitHub Actions re-runs the benchmark suite on `main` and for pull requests, publishing the generated report as a workflow artifact for reproducible comparisons.

## Publishing Checklist
1. Update dependency declarations in `crates/*/Cargo.toml` to point at the released `engram-core`.
2. Ensure `NPM_TOKEN` is configured locally (`.env`) and in CI (`secrets.NPM_TOKEN`).
3. Run `pnpm run build` to generate/verify `lib/` artifacts.
4. Run `pnpm test`.
5. Tag and publish through your registry of choice, or trigger the GitHub workflow.

## License
MIT License – see `LICENSE`.
