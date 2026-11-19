'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const plugin = require('../src/open-directory');
const { configure } = require('../scripts/configure-local');
const identity = { host: 'a'.repeat(64), socket: 'C:\\Herdr\\herdr.sock', binary: 'C:\\Herdr\\herdr.exe' };
const binding = { version: 1, ...identity };
const context = { focused_pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1' };
const response = { result: { type: 'pane_info', pane: { pane_id: 'w1:p1', tab_id: 'w1:t1', workspace_id: 'w1' } } };
const code = value => error => error instanceof plugin.DirectoryLinkError && error.code === value;

test('binding matches only the configured host, socket and binary', () => {
  plugin.validateBinding(binding, identity);
  for (const field of ['host', 'socket', 'binary']) {
    assert.throws(() => plugin.validateBinding(binding, { ...identity, [field]: 'other' }), code('unbound_host'));
  }
  assert.throws(() => plugin.validateBinding(null, identity), code('unbound_host'));
  assert.throws(() => plugin.validateBinding({ ...binding, version: 2 }, identity), code('unbound_host'));
});

test('pane validation requires exact pane, tab and workspace from API envelope', () => {
  plugin.assertPaneResponse(response, context);
  for (const field of ['pane_id', 'tab_id', 'workspace_id']) {
    const wrong = structuredClone(response); wrong.result.pane[field] = 'other';
    assert.throws(() => plugin.assertPaneResponse(wrong, context), code('unverified_pane'));
  }
  for (const invalid of [null, {}, { error: { code: 'pane_not_found' } },
    { result: { type: 'pane_list', pane: response.result.pane } }, response.result]) {
    assert.throws(() => plugin.assertPaneResponse(invalid, context), code('unverified_pane'));
  }
});

test('local query pins endpoint and never adds remote argv', async () => {
  let queryCount = 0;
  await plugin.verifyLocalPane(context, {
    HERDR_PLUGIN_CONFIG_DIR: 'C:\\Herdr\\config', HERDR_SESSION: 'remote-session',
    HERDR_SOCKET_PATH: 'C:\\ignored\\herdr.sock',
  }, {
    identity: async () => identity,
    fs: { readFile: async () => JSON.stringify(binding) },
    query: (binary, args, options) => {
      queryCount++;
      assert.equal(binary, identity.binary);
      assert.deepEqual(args, ['pane', 'get', 'w1:p1']);
      assert.equal(options.env.HERDR_SOCKET_PATH, identity.socket);
      assert.equal(options.env.HERDR_SESSION, undefined);
      return response;
    },
  });
  assert.equal(queryCount, 1);
});

test('absent or mismatched binding never queries a server', async () => {
  for (const contents of [undefined, 'not JSON', JSON.stringify({ ...binding, host: 'b'.repeat(64) })]) {
    let queries = 0;
    await assert.rejects(plugin.verifyLocalPane(context, { HERDR_PLUGIN_CONFIG_DIR: 'C:\\config' }, {
      identity: async () => identity,
      fs: { readFile: async () => { if (contents === undefined) throw new Error(); return contents; } },
      query: () => { queries++; return response; },
    }), code('unbound_host'));
    assert.equal(queries, 0);
  }
});

test('remote-client marker is rejected before local metadata or host lookup', async () => {
  let reads = 0;
  await assert.rejects(plugin.localIdentity({ HERDR_REMOTE_KEYBINDINGS: 'local' },
    () => { reads++; }, { realpath: async () => { reads++; } }), code('remote_pane'));
  assert.equal(reads, 0);
});

test('remote/relative sockets and non-exe binary rejected', async () => {
  for (const env of [
    { HERDR_SOCKET_PATH: '/remote/herdr.sock', HERDR_BIN_PATH: identity.binary },
    { HERDR_SOCKET_PATH: '\\\\server\\share\\herdr.sock', HERDR_BIN_PATH: identity.binary },
    { HERDR_SOCKET_PATH: identity.socket, HERDR_BIN_PATH: 'herdr.exe' },
    { HERDR_SOCKET_PATH: identity.socket, HERDR_BIN_PATH: 'C:\\Herdr\\herdr.cmd' },
  ]) {
    await assert.rejects(plugin.localIdentity(env), plugin.DirectoryLinkError);
  }
});

test('malformed raw UTF-16 cannot silently target a replacement-character name', () => {
  assert.throws(() => plugin.parseDirectoryUrl('file:///C:/\uD800'), code('invalid_url'));
  assert.throws(() => plugin.parseDirectoryUrl('file:///C:/\uDC00'), code('invalid_url'));
});

test('pane IDs cannot be parsed as CLI switches', () => {
  const env = {
    HERDR_ENV: '1', HERDR_PLUGIN_ID: plugin.PLUGIN_ID, HERDR_PLUGIN_ACTION_ID: plugin.ACTION_ID,
    HERDR_PLUGIN_LINK_HANDLER_ID: plugin.HANDLER_ID, HERDR_PLUGIN_CLICKED_URL: 'file:///C:/',
    HERDR_PANE_ID: '--machine', HERDR_TAB_ID: 'tab', HERDR_WORKSPACE_ID: 'workspace',
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      invocation_source: 'link_click', link_handler_id: plugin.HANDLER_ID, clicked_url: 'file:///C:/',
      focused_pane_id: '--machine', tab_id: 'tab', workspace_id: 'workspace',
    }),
  };
  assert.throws(() => plugin.parseClickContext(env), code('invalid_context'));
});

test('local binding and live pane API can be verified without registering or opening windows',
  { skip: process.platform !== 'win32' || !process.env.HERDR_PANE_ID, timeout: 30000 }, async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'herdr-link-context-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await configure(directory);
    await assert.rejects(configure(directory), error => error.code === 'EEXIST');
    await plugin.verifyLocalPane({
      focused_pane_id: process.env.HERDR_PANE_ID,
      tab_id: process.env.HERDR_TAB_ID, workspace_id: process.env.HERDR_WORKSPACE_ID,
    }, { ...process.env, HERDR_PLUGIN_CONFIG_DIR: directory });
  });
