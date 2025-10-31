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

The Rust crates reference the `engram-core` repo via a relative path (`../../engram-core/...`). When you publish this repository independently, replace those path dependencies with the appropriate git or registry references.

## Install & Build
```bash
git clone https://github.com/yourusername/engram-nodejs.git
cd engram-nodejs
pnpm install
pnpm run build
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

## Publishing Checklist
1. Update dependency declarations in `crates/*/Cargo.toml` to point at the released `engram-core`.
2. Run `pnpm run build` to generate/verify `lib/` artifacts.
3. Run `pnpm test`.
4. Tag and publish through your registry of choice.

## License
MIT License – see `LICENSE`.
