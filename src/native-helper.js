'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function failure(code) { throw Object.assign(new Error(code), { code }); }
function verifyCache(directory) {
  const executable = path.join(directory, 'windows-shell.exe');
  try {
    const expected = fs.readFileSync(path.join(directory, 'sha256'), 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(expected) || digest(fs.readFileSync(executable)) !== expected) {
      failure('helper_cache_invalid');
    }
  } catch { failure('helper_cache_invalid'); }
  return executable;
}

const PLUGIN_ROOT = path.join(__dirname, '..');
const SOURCE_NAMES = [
  'src/native/windows-shell.cs',
  'src/native/directory-policy.cs',
  'src/native/click-runtime.cs',
  'src/native/windows-shell.ps1',
];

function ensureHelper(systemRoot, env = process.env, options = {}) {
  const sources = SOURCE_NAMES.slice(0, 3).map(name => path.join(PLUGIN_ROOT, name));
  const builder = path.join(PLUGIN_ROOT, SOURCE_NAMES[3]);
  // Source-addressed cache: updates compile anew; every execution checks integrity.
  const version = digest(Buffer.concat(SOURCE_NAMES.map(name =>
    fs.readFileSync(path.join(PLUGIN_ROOT, name)))));
  const root = options.cacheRoot || path.join(PLUGIN_ROOT, '.native-cache');
  const directory = path.join(root, version);
  if (fs.existsSync(directory)) return verifyCache(directory);
  fs.mkdirSync(root, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(root, 'build-'));
  try {
    const executable = path.join(temporary, 'windows-shell.exe');
    const result = spawnSync(path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', builder], {
        input: JSON.stringify({ operation: 'build', sources, output: executable }),
        encoding: 'utf8', shell: false, windowsHide: true, env,
        cwd: path.win32.join(systemRoot, 'System32'), timeout: 30000, maxBuffer: 1024 * 1024,
      });
    if (result.error || result.status !== 0) failure('helper_build_failed');
    fs.writeFileSync(path.join(temporary, 'sha256'), digest(fs.readFileSync(executable)) + '\n', { flag: 'wx' });
    try { fs.renameSync(temporary, directory); }
    catch (error) {
      // A concurrent click may have published the same build first.
      if (!fs.existsSync(directory)) throw error;
    }
    return verifyCache(directory);
  } finally {
    // Remove only the fresh temporary directory owned by this invocation.
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true, force: true });
  }
}
module.exports = { ensureHelper };
