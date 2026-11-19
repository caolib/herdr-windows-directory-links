'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { configure } = require('../scripts/configure-local');
const { build } = require('../scripts/build-plugin');

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

    // Complete click pipeline: the API's clicked pane cwd, not plugin/process cwd.
    const relative = 'proposal/qcbm/output/report-v25-integrated.docx';
    const project = path.join(root, 'project');
    const other = path.join(root, 'other-project');
    for (const cwd of [project, other]) {
      const file = path.join(cwd, ...relative.split('/'));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'validation only; never opened');
    }
    context.clicked_url = relative;
    env.HERDR_PLUGIN_CLICKED_URL = relative;
    env.HERDR_PLUGIN_CONTEXT_JSON = JSON.stringify(context);
    const scenarios = [
      { fields: { cwd: project } },
      { fields: { cwd: other, foreground_cwd: project } },
      { fields: { cwd: project, foreground_cwd: null } },
      { fields: {}, error: 'unverified_cwd' },
      { fields: { cwd: project, foreground_cwd: '/remote' }, error: 'unverified_cwd' },
      { fields: { cwd: project, pane_id: 'other-pane' }, error: 'unverified_pane' },
    ];
    for (const { fields, error } of scenarios) {
      reply = (socket, request) => {
        assert.equal(request.params.pane_id, 'test-pane');
        socket.end(JSON.stringify({ id: request.id, result: { type: 'pane_info', pane: {
          pane_id: 'test-pane', tab_id: 'test-tab', workspace_id: 'test-ws', ...fields,
        } } }) + '\n');
      };
      const checked = await execute(executable, env);
      if (error) {
        assert.equal(checked.code, 1);
        assert.equal(checked.stderr, error);
      } else {
        assert.equal(checked.code, 0, checked.stderr);
        const output = JSON.parse(checked.stdout);
        assert.equal(output.opened, false);
        assert.equal(output.action, 'open');
        assert.equal(output.path.toLowerCase(), path.join(project, ...relative.split('/')).toLowerCase());
      }
    }
    const script = path.join(project, 'build-plugin.js');
    await fs.writeFile(script, 'validation only; never executed');
    context.clicked_url = 'build-plugin.js';
    env.HERDR_PLUGIN_CLICKED_URL = context.clicked_url;
    env.HERDR_PLUGIN_CONTEXT_JSON = JSON.stringify(context);
    reply = (socket, request) => {
      socket.end(JSON.stringify({ id: request.id, result: { type: 'pane_info', pane: {
        pane_id: 'test-pane', tab_id: 'test-tab', workspace_id: 'test-ws', cwd: other, foreground_cwd: project,
      } } }) + '\n');
    };
    const selected = await execute(executable, env);
    assert.equal(selected.code, 0, selected.stderr);
    const output = JSON.parse(selected.stdout);
    assert.equal(output.opened, false);
    assert.equal(output.action, 'select');
    assert.equal(output.path.toLowerCase(), script.toLowerCase());
  });
