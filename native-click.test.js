'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync, spawn } = require('node:child_process');
const net = require('node:net');
const plugin = require('./open-directory');
const { configure } = require('./configure-local');
const { build } = require('./build-plugin');
let executable;
function exe() { return executable || (executable = build()); }
function run(args, options = {}) {
  return spawnSync(exe(), args, { encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 10000, ...options });
}
function policy(requests) {
  const result = run(['--policy-test'], { input: JSON.stringify(requests) });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function clickEnv(url, config) {
  return { ...process.env,
    HERDR_ENV: '1', HERDR_PLUGIN_ID: plugin.PLUGIN_ID, HERDR_PLUGIN_ACTION_ID: plugin.ACTION_ID,
    HERDR_PLUGIN_LINK_HANDLER_ID: plugin.HANDLER_ID, HERDR_PLUGIN_CLICKED_URL: url,
    HERDR_PLUGIN_CONFIG_DIR: config,
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ invocation_source: 'link_click',
      link_handler_id: plugin.HANDLER_ID, clicked_url: url,
      focused_pane_id: process.env.HERDR_PANE_ID, tab_id: process.env.HERDR_TAB_ID,
      workspace_id: process.env.HERDR_WORKSPACE_ID }),
  };
}
const windows = { skip: process.platform !== 'win32', timeout: 60000 };

test('C# URL policy matches JS strict rejection and literal Unicode corpus', windows, () => {
  const corpus = [
    'file:///C:/', 'FILE:///c:/folder/', 'file:///C:/Desktop',
    'file:///C:/中文%20folder', 'file:///C:/%23%25,(x)%26', 'file:///C:/literal%2520',
    'file:///C:/emoji-%F0%9F%90%B1', 'file:///C:/family-👨‍👩‍👧', 'file:///C:/a%E2%80%8Cb',
    'file:///C:/apostrophe%27s', null, '', 'https://example.com', 'C:\\Desktop',
    'file:/C:/Desktop', 'file://server/C:/Desktop', 'file://localhost/C:/Desktop',
    'file:////server/share', 'file:///C:/a\\b', 'file:///C:/x?', 'file:///C:/x#',
    'file:///C:/x ', 'file:///C:/x\t', 'file:///C:/x%ZZ', 'file:///C:/x%',
    'file:///C:/%FF', 'file:///C:/%C0%AF', 'file:///C:/%00', 'file:///C:/%0A',
    'file:///C:/%E2%80%AE', 'file:///C:/a%2Fb', 'file:///C:/a%5Cb',
    'file:///C:/x%22y', 'file:///C:/x%3Ay', 'file:///C:/x%7Cy', 'file:///C:/x%2Ay',
    'file:///C:/x.', 'file:///C:/x%20', 'file:///C:/CON', 'file:///C:/nul.txt',
    'file:///C:/COM1', 'file:///C:/LPT%C2%B2', 'file:///C|/folder',
    'file:///C:/./x', 'file:///C:/../x', 'file:///C:/%2e%2e/x', 'file:///C:/%2e./x',
    'file:///C:/%3F/Device', 'file:///C:/x' + 'a'.repeat(259),
  ];
  const results = policy(corpus.map(value => ({ operation: 'parse', value })));
  corpus.forEach((url, index) => {
    let expected;
    try { expected = plugin.parseDirectoryUrl(url); }
    catch { assert.ok(results[index].error, JSON.stringify(url)); return; }
    assert.equal(results[index].path, expected, url);
  });
});

test('C# directory policy handles root, Unicode, junctions and refuses files/UNC', windows, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'herdr-native-click-test-'));
  const target = path.join(root, '中文 空格 👨‍👩‍👧 #%,(x)&');
  await fs.mkdir(target);
  const junction = path.join(root, 'junction');
  await fs.symlink(target, junction, 'junction');
  const loop = path.join(root, 'loop');
  await fs.symlink(loop, loop, 'junction');
  const network = path.join(root, 'network');
  await fs.symlink('\\\\nonexistent-herdr-host\\share', network, 'junction');
  t.after(async () => {
    for (const link of [junction, loop, network]) {
      await fs.unlink(link).catch(async error => {
        if (error.code !== 'ENOENT') await fs.rmdir(link);
      });
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const files = [];
  for (const name of ['app.exe', 'file.txt', 'script.bat', 'script.ps1', 'shortcut.lnk']) {
    const file = path.join(root, name); await fs.writeFile(file, 'not executable'); files.push(file);
  }
  const values = [target, junction, path.parse(root).root, ...files, path.join(root, 'missing'),
    '\\\\server\\share', '\\\\?\\C:\\Windows', loop, network];
  const results = policy(values.map(value => ({ operation: 'resolve', value })));
  assert.equal(results[0].path.toLowerCase(), target.toLowerCase());
  assert.equal(results[1].path.toLowerCase(), target.toLowerCase());
  assert.equal(results[2].path.toLowerCase(), path.parse(root).root.toLowerCase());
  results.slice(3).forEach(result => assert.ok(result.error));
  const leased = policy([{ operation: 'lease-test', value: target },
    { operation: 'lease-test', value: junction }]);
  for (const result of leased) assert.equal(result.path?.toLowerCase(), target.toLowerCase(), result.error);
});

test('direct runtime validates actual bound pane and target without opening windows',
  { ...windows, skip: windows.skip || !process.env.HERDR_PANE_ID }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'herdr-native-runtime-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await configure(root);
    const env = clickEnv(pathToFileURL(process.env.SystemRoot).href, root);
    let result = run(['--validate-click'], { env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).opened, false);
    for (const variable of ['HERDR_PLUGIN_ID', 'HERDR_PLUGIN_ACTION_ID', 'HERDR_PANE_ID',
      'HERDR_PLUGIN_CLICKED_URL', 'HERDR_PLUGIN_CONTEXT_JSON']) {
      const wrong = { ...env }; delete wrong[variable];
      result = run(['--validate-click'], { env: wrong });
      assert.equal(result.status, 1); assert.equal(result.stderr.trim(), 'invalid_context');
    }
    result = run(['--validate-click'], { env: { ...env, HERDR_REMOTE_KEYBINDINGS: 'local' } });
    assert.equal(result.stderr.trim(), 'remote_pane');
    const wrong = clickEnv('file:///C:/Windows', root);
    wrong.HERDR_PANE_ID = 'nonexistent-pane';
    const context = JSON.parse(wrong.HERDR_PLUGIN_CONTEXT_JSON); context.focused_pane_id = wrong.HERDR_PANE_ID;
    wrong.HERDR_PLUGIN_CONTEXT_JSON = JSON.stringify(context);
    result = run(['--validate-click'], { env: wrong });
    assert.equal(result.stderr.trim(), 'unverified_pane');
    const bindingFile = path.join(root, 'local-host.json');
    const binding = JSON.parse(await fs.readFile(bindingFile, 'utf8')); binding.host = '0'.repeat(64);
    await fs.writeFile(bindingFile, JSON.stringify(binding));
    result = run(['--validate-click'], { env });
    assert.equal(result.stderr.trim(), 'unbound_host');
  });
