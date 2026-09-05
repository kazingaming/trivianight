#!/usr/bin/env node
/**
 * One-click launcher.
 *
 * Checks the machine has what it needs, installs and builds if anything is
 * missing or stale, starts the server, and opens the browser. Everything is
 * resolved relative to this file, so the project folder can live anywhere and
 * be moved without breaking.
 *
 * Developers should keep using `npm run dev` — this is the "just let me play"
 * path, and it runs the real production build rather than the dev server.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const MIN_NODE_MAJOR = 20;
/** Wrangler's own default, kept so the local URL matches the docs. */
const DEFAULT_PORT = 8787;

const c = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  amber: '\u001b[33m',
  cyan: '\u001b[36m',
  red: '\u001b[31m',
  green: '\u001b[32m',
};

function say(message = '') {
  process.stdout.write(`${message}\n`);
}

function banner() {
  say();
  say(`  ${c.amber}${c.bold}TRIVIA NIGHT${c.reset}`);
  say(`  ${c.dim}starting up${c.reset}`);
  say();
}

function fail(title, detail) {
  say();
  say(`  ${c.red}${c.bold}${title}${c.reset}`);
  for (const line of detail) say(`  ${line}`);
  say();
  process.exitCode = 1;
}

/** Run a command, streaming its output. Resolves with the exit code. */
function run(command, args, label) {
  return new Promise((done) => {
    say(`  ${c.dim}${label}${c.reset}`);
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      shell: isWindows,
      env: process.env,
    });
    child.on('close', (code) => done(code ?? 1));
    child.on('error', () => done(1));
  });
}

function portInUse(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once('error', (error) => done(error.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => done(false)));
    probe.listen(port, '127.0.0.1');
  });
}

/** Newest mtime under a directory, ignoring node_modules. Null if absent. */
function newestMtime(dir) {
  if (!existsSync(dir)) return null;
  let newest = 0;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

/** Rebuild only when sources are newer than the last build. */
function buildIsStale() {
  const dist = join(root, 'apps', 'web', 'dist');
  if (!existsSync(join(dist, 'index.html'))) return true;
  const built = newestMtime(dist) ?? 0;
  const sources = Math.max(
    newestMtime(join(root, 'apps', 'web', 'src')) ?? 0,
    newestMtime(join(root, 'packages')) ?? 0,
  );
  return sources > built;
}

function openBrowser(url) {
  try {
    if (isWindows) spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' });
    else if (process.platform === 'darwin') spawnSync('open', [url], { stdio: 'ignore' });
    else spawnSync('xdg-open', [url], { stdio: 'ignore' });
  } catch {
    // Opening a browser is a convenience; the URL is printed either way.
  }
}

async function main() {
  banner();

  /* --- Prerequisites --------------------------------------------------- */

  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
    return fail('Node.js is too old', [
      `Trivia Night needs Node ${MIN_NODE_MAJOR} or newer. You have ${process.versions.node}.`,
      '',
      'Install the LTS version from https://nodejs.org and run this again.',
    ]);
  }

  if (!existsSync(join(root, 'package.json'))) {
    return fail('Project files are missing', [
      `Expected to find package.json in ${root}.`,
      'Make sure the whole project folder was copied, not just the launcher.',
    ]);
  }

  const npmCheck = spawnSync(npm, ['--version'], { shell: isWindows, encoding: 'utf8' });
  if (npmCheck.status !== 0) {
    return fail('npm is not available', [
      'Node.js is installed but npm was not found on your PATH.',
      'Reinstall Node.js from https://nodejs.org, which includes npm.',
    ]);
  }

  say(`  ${c.green}✓${c.reset} Node ${process.versions.node}, npm ${npmCheck.stdout.trim()}`);

  /* --- Dependencies ---------------------------------------------------- */

  if (!existsSync(join(root, 'node_modules'))) {
    say(`  ${c.dim}First run — installing dependencies. This takes a minute.${c.reset}`);
    const code = await run(npm, ['install', '--no-fund', '--no-audit'], 'npm install');
    if (code !== 0) {
      return fail('Dependency install failed', [
        'Check your internet connection and try again.',
        'If it keeps failing, delete the node_modules folder and re-run.',
      ]);
    }
  } else {
    say(`  ${c.green}✓${c.reset} Dependencies installed`);
  }

  /* --- Build ----------------------------------------------------------- */

  if (buildIsStale()) {
    const code = await run(npm, ['run', 'build'], 'Building the game');
    if (code !== 0) {
      return fail('Build failed', [
        'The error above explains why.',
        'If you have edited the code, fix the reported problem and try again.',
      ]);
    }
  } else {
    say(`  ${c.green}✓${c.reset} Build up to date`);
  }

  /* --- Port ------------------------------------------------------------ */

  const port = Number(process.env.TRIVIA_PORT ?? process.env.PORT ?? DEFAULT_PORT);
  if (await portInUse(port)) {
    return fail(`Port ${port} is already in use`, [
      'Trivia Night may already be running — check your browser and other windows.',
      '',
      `If something else is using port ${port}, close it, or start with a different`,
      `port by setting TRIVIA_PORT (for example: set TRIVIA_PORT=3002).`,
    ]);
  }

  /* --- Go -------------------------------------------------------------- */

  const url = `http://localhost:${port}`;
  say();
  say(`  ${c.dim}Starting the game server…${c.reset}`);

  /*
   * Runs the real Cloudflare runtime locally: workerd, with Durable Objects,
   * exactly as production does. No account and no login are needed for this —
   * only `npm run deploy` talks to Cloudflare.
   */
  const server = spawn(
    process.execPath,
    [
      resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
      'dev',
      '--local',
      '--port',
      String(port),
    ],
    {
      cwd: resolve(root, 'apps', 'worker'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    },
  );

  // Open the browser once the runtime says it is actually listening.
  let opened = false;
  const watch = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!opened && /Ready on https?:\/\//i.test(text)) {
      opened = true;
      say();
      say(`  ${c.cyan}${c.bold}${url}${c.reset}`);
      say(`  ${c.dim}Close this window to stop the game.${c.reset}`);
      say();
      setTimeout(() => openBrowser(url), 400);
    }
  };
  server.stdout?.on('data', watch);
  server.stderr?.on('data', watch);

  const shutdown = () => {
    if (!server.killed) server.kill();
  };
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', shutdown);

  server.on('close', (code) => {
    if (code && code !== 0) {
      fail('The game server stopped unexpectedly', [
        'The error above explains why.',
        'Try running `npm run dev` to see more detail.',
      ]);
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  fail('Something went wrong starting Trivia Night', [String(error?.message ?? error)]);
});
