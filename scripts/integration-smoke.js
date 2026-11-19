'use strict';

// Run only on explicit request: --activate opens the clicked Desktop directory.
const net = require('node:net');
const { spawnSync } = require('node:child_process');

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = `directory-links-smoke:${method}`;
    const socket = net.connect('\\\\.\\pipe\\' + process.env.HERDR_SOCKET_PATH);
    let pending = '';
    socket.setTimeout(10000);
    socket.on('connect', () => socket.write(JSON.stringify({ id, method, params }) + '\n'));
    socket.on('data', data => {
      pending += data.toString('utf8');
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        let response;
        try { response = JSON.parse(line); } catch { continue; }
        if (response.id !== id) continue;
        socket.end();
        if (response.error) reject(new Error(JSON.stringify(response.error)));
        else resolve(response.result);
      }
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('Herdr API timeout')); });
    socket.on('error', reject);
    socket.on('end', () => reject(new Error('Herdr API ended without response')));
  });
}

async function main() {
  const [pane, activate] = process.argv.slice(2);
  if (process.platform !== 'win32' || !pane || (activate && !['--activate', '--action'].includes(activate))) {
    throw new Error('Usage: node scripts/integration-smoke.js <test-pane-id> [--activate|--action]');
  }
  if (activate === '--action') {
    // Synthetic API context: tests Herdr argv/runtime and actual opening, NOT mouse/OSC 8.
    const info = await request('pane.get', { pane_id: pane });
    const clicked = require('node:url').pathToFileURL(
      require('node:path').join(require('node:os').homedir(), 'Desktop')).href;
    const result = await request('plugin.action.invoke', {
      plugin_id: 'local.windows-directory-links', action_id: 'open-directory',
      context: {
        invocation_source: 'link_click', link_handler_id: 'local-directory', clicked_url: clicked,
        focused_pane_id: pane, tab_id: info.pane.tab_id, workspace_id: info.pane.workspace_id,
      },
    });
    console.log('Synthetic action smoke (NOT a physical click):', JSON.stringify(result));
    return;
  }
  const read = spawnSync(process.env.HERDR_BIN_PATH,
    ['pane', 'read', pane, '--source', 'visible', '--format', 'text'],
    { encoding: 'utf8', shell: false, timeout: 10000, cwd: require('node:path').join(__dirname, '..') });
  if (read.error || read.status !== 0) throw new Error('Could not read test pane');
  const lines = read.stdout.split(/\r?\n/);
  const row = lines.findIndex(line => /^\s*Desktop\s*$/.test(line));
  if (row < 0) throw new Error('Desktop fixture is not visible in the test pane');
  const params = { pane_id: pane, viewport_row: row, col: lines[row].indexOf('Desktop'), offset_from_bottom: 0 };
  let resolved = await request('pane.link.resolve', params);
  if (!resolved.regions?.length) {
    // CLI pane.read trims blank viewport lines; resolve actual cells via read-only API.
    const info = await request('pane.get', { pane_id: pane });
    for (let candidate = 0; candidate < info.pane.scroll.viewport_rows; candidate++) {
      params.viewport_row = candidate;
      resolved = await request('pane.link.resolve', params);
      if (resolved.regions?.some(region => region.end_col - region.start_col + 1 === 7)) break;
    }
  }
  if (!resolved.regions?.some(region => region.end_col - region.start_col + 1 === 7)) {
    throw new Error('Herdr did not find the seven-cell Desktop OSC 8 link');
  }
  console.log('Desktop OSC 8 region:', JSON.stringify(resolved));
  if (activate) {
    const result = await request('pane.link.activate', params);
    if (!result.handled || !result.url?.startsWith('file:///')) throw new Error('Directory link not handled');
    console.log('Herdr link activation:', JSON.stringify(result));
  }
}
if (require.main === module) main().catch(error => {
  process.stderr.write(error.message + '\n'); process.exitCode = 1;
});
