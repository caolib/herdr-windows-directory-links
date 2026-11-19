'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { configure } = require('./configure-local');
const { build } = require('./build-plugin');

function execute(executable, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--validate-click'], { env, shell: false,
      windowsHide: true, timeout: 12000 });
    let stderr = '', stdout = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stderr: stderr.trim(), stdout }));
  });
}

test('native runtime rejects forged, malformed and truncated pipe responses',
  { skip: process.platform !== 'win32' || !process.env.HERDR_PANE_ID, timeout: 60000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'herdr-native-pipe-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await configure(root);
    const executable = build();
    const configFile = path.join(root, 'local-host.json');
    const binding = JSON.parse(await fs.readFile(configFile, 'utf8'));
    const socketName = path.join(root, 'herdr-fake.sock');
    await fs.writeFile(configFile, JSON.stringify({ ...binding, socket: socketName }));
    const context = { invocation_source: 'link_click', link_handler_id: 'local-directory',
      clicked_url: 'file:///C:/Windows', focused_pane_id: 'test-pane', tab_id: 'test-tab', workspace_id: 'test-ws' };
    const env = { ...process.env, HERDR_ENV: '1', HERDR_PLUGIN_ID: 'local.windows-directory-links',
      HERDR_PLUGIN_ACTION_ID: 'open-directory', HERDR_PLUGIN_LINK_HANDLER_ID: 'local-directory',
      HERDR_PLUGIN_CLICKED_URL: context.clicked_url, HERDR_PLUGIN_CONFIG_DIR: root,
      HERDR_SOCKET_PATH: socketName, HERDR_PANE_ID: context.focused_pane_id,
      HERDR_TAB_ID: context.tab_id, HERDR_WORKSPACE_ID: context.workspace_id,
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify(context) };
    let reply;
    const server = net.createServer(socket => {
      socket.on('error', () => {});
      let pending = '';
      socket.on('data', data => {
        pending += data.toString('utf8');
        if (pending.includes('\n')) reply(socket, JSON.parse(pending.trim()));
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen('\\\\.\\pipe\\' + socketName, resolve);
    });
    t.after(() => new Promise(resolve => server.close(resolve)));
    for (const bad of ['malformed', 'truncated', 'error', 'wrong-pane', 'wrong-tab', 'wrong-ws', 'wrong-type']) {
      reply = (socket, request) => {
        if (bad === 'malformed') { socket.end('{not JSON}\n'); return; }
        if (bad === 'truncated') { socket.end('{"id":'); return; }
        const pane = { pane_id: 'test-pane', tab_id: 'test-tab', workspace_id: 'test-ws' };
        if (bad === 'wrong-pane') pane.pane_id = 'other';
        if (bad === 'wrong-tab') pane.tab_id = 'other';
        if (bad === 'wrong-ws') pane.workspace_id = 'other';
        const response = bad === 'error' ? { id: request.id, error: { code: 'pane_not_found' } }
          : { id: request.id, result: { type: bad === 'wrong-type' ? 'pane_list' : 'pane_info', pane } };
        socket.end(JSON.stringify(response) + '\n');
      };
      const result = await execute(executable, env);
      assert.equal(result.code, 1, bad); assert.equal(result.stderr, 'unverified_pane', bad);
    }
    reply = (socket, request) => {
      const response = JSON.stringify({ id: request.id, result: { type: 'pane_info', pane: {
        pane_id: 'test-pane', tab_id: 'test-tab', workspace_id: 'test-ws' } } }) + '\n';
      socket.write('{"id":"unrelated","event":"ignored"}\n');
      socket.write(response.slice(0, 15)); socket.end(response.slice(15));
    };
    const result = await execute(executable, env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).opened, false);
  });
