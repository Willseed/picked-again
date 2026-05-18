import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lhciRoot = path.join(repoRoot, '.lighthouseci');

const profiles = {
  mobile: {
    config: '.lighthouserc.mobile.cjs',
    outputDir: path.join(lhciRoot, 'mobile'),
    workDir: path.join(lhciRoot, 'work', 'mobile'),
  },
  desktop: {
    config: '.lighthouserc.desktop.cjs',
    outputDir: path.join(lhciRoot, 'desktop'),
    workDir: path.join(lhciRoot, 'work', 'desktop'),
  },
};

const profileName = process.argv[2];
const profile = profiles[profileName];

if (!profile) {
  console.error(`Usage: node scripts/run-lhci.mjs ${Object.keys(profiles).join('|')}`);
  process.exit(1);
}

const lhciCliPath = require.resolve('@lhci/cli/src/cli.js');
const lockDir = path.join(lhciRoot, 'locks', profileName);

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function removeStaleLock() {
  let pid;

  try {
    pid = Number(readFileSync(path.join(lockDir, 'pid'), 'utf8'));
  } catch {
    console.error(`LHCI ${profileName} lock exists without a readable pid at ${lockDir}.`);
    console.error('Remove it only after verifying no matching LHCI run is active.');
    process.exit(1);
  }

  if (Number.isInteger(pid) && pid > 0 && isProcessRunning(pid)) {
    console.error(`Another LHCI ${profileName} run is already active (pid ${pid}).`);
    process.exit(1);
  }

  if (!Number.isInteger(pid) || pid <= 0) {
    console.error(`LHCI ${profileName} lock has an invalid pid at ${lockDir}.`);
    console.error('Remove it only after verifying no matching LHCI run is active.');
    process.exit(1);
  }

  rmSync(lockDir, {recursive: true, force: true});
}

function acquireLock() {
  mkdirSync(path.dirname(lockDir), {recursive: true});

  try {
    mkdirSync(lockDir);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    removeStaleLock();
    mkdirSync(lockDir);
  }

  writeFileSync(path.join(lockDir, 'pid'), `${process.pid}\n`);
}

function releaseLock() {
  rmSync(lockDir, {recursive: true, force: true});
}

function resetDirectory(directory) {
  rmSync(directory, {recursive: true, force: true});
  mkdirSync(directory, {recursive: true});
}

acquireLock();
process.on('exit', releaseLock);

resetDirectory(profile.workDir);
resetDirectory(profile.outputDir);

const result = spawnSync(
  process.execPath,
  [lhciCliPath, 'autorun', `--config=${path.join(repoRoot, profile.config)}`],
  {
    cwd: profile.workDir,
    env: process.env,
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.signal) {
  console.error(`LHCI ${profileName} run terminated by ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
