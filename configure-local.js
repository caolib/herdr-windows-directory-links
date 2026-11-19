'use strict';

// Explicit one-time local policy binding; never opens Explorer or enables plugins.
const fs = require('node:fs/promises');
const path = require('node:path');
const { localIdentity, validateWindowsPath } = require('./open-directory');

async function configure(configDirectory, env = process.env) {
  if (process.platform !== 'win32') throw new Error('Windows only.');
  validateWindowsPath(configDirectory);
  const identity = await localIdentity(env);
  const target = path.win32.join(configDirectory, 'local-host.json');
  await fs.mkdir(configDirectory, { recursive: true });
  // Never silently replace a previous machine binding.
  await fs.writeFile(target, JSON.stringify({ version: 1, ...identity }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
  process.stdout.write('Bound this Windows host and Herdr endpoint; plugin was not enabled.\n');
}

if (require.main === module) {
  if (process.argv.length !== 3) {
    process.stderr.write('Usage: node configure-local.js <Herdr-plugin-config-directory>\n');
    process.exitCode = 1;
  } else {
    configure(process.argv[2]).catch(error => {
      process.stderr.write(error.code === 'EEXIST'
        ? 'Binding already exists; inspect and explicitly remove it before rebinding.\n'
        : 'Local binding failed; run from the intended local Herdr pane and check access.\n');
      process.exitCode = 1;
    });
  }
}
module.exports = { configure };
