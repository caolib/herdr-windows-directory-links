'use strict';

// Manual OSC 8 smoke fixture. Merely prints links; never opens a directory.
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (process.platform !== 'win32') {
  process.stderr.write('This fixture requires Windows.\n');
  process.exitCode = 1;
} else {
  const desktop = path.join(os.homedir(), 'Desktop');
  const url = pathToFileURL(desktop).href;
  const link = (target, label) => `\x1b]8;;${target}\x1b\\${label}\x1b]8;;\x1b\\`;
  process.stdout.write('Ctrl+click with Herdr ui.mouse_capture enabled:\n');
  process.stdout.write(`  ${link(url, 'Desktop')}\n`);
  process.stdout.write(`  ${link(url, 'Desk… (same full URI)')}\n`);
  process.stdout.write(`  ${link(pathToFileURL(path.parse(desktop).root).href, 'Drive root')}\n`);
  process.stdout.write(`  ${link('https://herdr.dev/tui/docs/plugins/', 'HTTPS (not handled by this plugin)')}\n`);
  process.stdout.write('Desktop fixture assumes the standard home/Desktop location; use your actual statusline for redirected desktops.\n');
}
