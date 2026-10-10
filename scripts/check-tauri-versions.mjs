import fs from 'node:fs';

const NPM_SCOPE = '@tauri-apps/';

function crateFor(npmName) {
  const name = npmName.slice(NPM_SCOPE.length);
  return name === 'api' ? 'tauri' : `tauri-${name}`;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function yarnVersion(lock, npmName) {
  const entry = new RegExp(`^"?${escapeRegExp(npmName)}@[^\\n]*:\\n  version "([^"]+)"`, 'm');
  return entry.exec(lock)?.[1];
}

function crateVersion(lock, crate) {
  const entry = new RegExp(`^name = "${escapeRegExp(crate)}"\\nversion = "([^"]+)"`, 'm');
  return entry.exec(lock)?.[1];
}

function majorMinor(version) {
  return version.split('.').slice(0, 2).join('.');
}

const { dependencies } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const yarnLock = fs.readFileSync('yarn.lock', 'utf8');
const cargoLock = fs.readFileSync('src-tauri/Cargo.lock', 'utf8');

const problems = Object.keys(dependencies)
  .filter((npmName) => npmName.startsWith(NPM_SCOPE))
  .flatMap((npmName) => {
    const crate = crateFor(npmName);
    const npm = yarnVersion(yarnLock, npmName);
    const cargo = crateVersion(cargoLock, crate);
    if (!npm) return [`${npmName} is not in yarn.lock`];
    if (!cargo) return [`${crate} is not in src-tauri/Cargo.lock`];
    if (majorMinor(npm) === majorMinor(cargo)) return [];
    return [`${crate} (v${cargo}) : ${npmName} (v${npm})`];
  });

if (problems.length > 0) {
  console.error('Tauri crates and NPM packages must be on the same major.minor:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('Tauri crate and NPM package versions match.');
