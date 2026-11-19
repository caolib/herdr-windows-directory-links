'use strict';

// Local link does not run Herdr build steps: invoke explicitly before linking.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ensureHelper } = require('../src/native-helper');

const PLUGIN_ROOT = path.join(__dirname, '..');
const SOURCE_NAMES = [
  'src/native/windows-shell.cs',
  'src/native/directory-policy.cs',
  'src/native/click-runtime.cs',
  'src/native/windows-shell.ps1',
];

function hash(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function build() {
  if (process.platform !== 'win32') throw new Error('Windows only');
  const root = process.env.SystemRoot;
  const cached = ensureHelper(root);
  const directory = path.join(PLUGIN_ROOT, '.build');
  fs.mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, 'directory-links.exe');
  // Inspect a previous generated target before replacing it; never touch a binding.
  if (fs.existsSync(executable)) {
    const previous = fs.readFileSync(executable);
    const expected = fs.readFileSync(executable + '.sha256', 'utf8').trim();
    if (hash(previous) !== expected) throw new Error('Existing build is corrupt; inspect before rebuilding');
  }
  const bytes = fs.readFileSync(cached);
  if (!fs.existsSync(executable) || !fs.readFileSync(executable).equals(bytes)) {
    fs.writeFileSync(executable, bytes);
  }
  fs.writeFileSync(executable + '.sha256', hash(bytes) + '\n');
  fs.writeFileSync(executable + '.source-sha256', hash(Buffer.concat(SOURCE_NAMES.map(name =>
    fs.readFileSync(path.join(PLUGIN_ROOT, name))))) + '\n');
  return executable;
}
if (require.main === module) {
  try { console.log('Built:', build()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { build };
