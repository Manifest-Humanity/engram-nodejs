#!/usr/bin/env node

/**
 * Local build helper that mirrors the CI workflow.
 * Loads environment variables from .env (if present), ensures private
 * tokens are set, then runs `pnpm install` followed by `pnpm run build`.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const envPath = resolve(repoRoot, '.env');

function loadDotEnv(filePath) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
    child.on('error', rejectPromise);
  });
}

async function main() {
  if (existsSync(envPath)) {
    loadDotEnv(envPath);
  }

  if (!process.env.ENGRAM_CORE_TOKEN) {
    throw new Error('ENGRAM_CORE_TOKEN must be set (add it to .env) to fetch private dependencies.');
  }

  console.log('Installing JS dependencies via pnpm...');
  await run('pnpm', ['install', '--frozen-lockfile']);

  console.log('Building Node.js package via pnpm build...');
  await run('pnpm', ['run', 'build']);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
