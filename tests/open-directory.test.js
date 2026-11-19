'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const plugin = require('../src/open-directory');

function clickEnv(url = 'file:///C:/Users/example/Desktop') {
  return {
    HERDR_ENV: '1', HERDR_PLUGIN_ID: plugin.PLUGIN_ID,
    HERDR_PLUGIN_ACTION_ID: plugin.ACTION_ID,
    HERDR_PLUGIN_LINK_HANDLER_ID: plugin.HANDLER_ID,
    HERDR_PLUGIN_CLICKED_URL: url,
    HERDR_PANE_ID: 'pane-1', HERDR_TAB_ID: 'tab-1', HERDR_WORKSPACE_ID: 'workspace-1',
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      invocation_source: 'link_click', link_handler_id: plugin.HANDLER_ID, clicked_url: url,
      focused_pane_id: 'pane-1', tab_id: 'tab-1', workspace_id: 'workspace-1',
    }),
  };
}
function directoryInfo() { return { isDirectory: () => true, isSymbolicLink: () => false }; }
function fakeFs(overrides = {}) {
  return { lstat: async () => directoryInfo(), stat: async () => directoryInfo(),
    realpath: async target => target, ...overrides };
}
function hasCode(code) { return error => error instanceof plugin.DirectoryLinkError && error.code === code; }

for (const [url, expected] of [
  ['file:///C:/Users/example/Desktop', 'C:\\Users\\example\\Desktop'],
  ['file:///C:/', 'C:\\'],
  ['FILE:///c:/folder/', 'c:\\folder\\'],
  ['file:///C:/%E4%B8%AD%E6%96%87%20folder', 'C:\\中文 folder'],
  ['file:///C:/%23%25,(x)%26', 'C:\\#%,(x)&'],
  ['file:///C:/literal%2520', 'C:\\literal%20'],
  ['file:///C:/emoji-%F0%9F%90%B1', 'C:\\emoji-🐱'],
  ['file:///C:/family-%F0%9F%91%A8%E2%80%8D%F0%9F%91%A9%E2%80%8D%F0%9F%91%A7', 'C:\\family-👨‍👩‍👧'],
  ['file:///C:/a%E2%80%8Cb', 'C:\\a\u200cb'],
  ['file:///C:/apostrophe%27s', "C:\\apostrophe's"],
]) {
  test(`URL accepted literally: ${url}`, () => assert.equal(plugin.parseDirectoryUrl(url), expected));
}

for (const url of [
  undefined, '', 'https://example.com', 'C:\\Desktop', 'file:/C:/Desktop',
  'file://server/C:/Desktop', 'file://localhost/C:/Desktop', 'file://user:pass@server/C:/',
  'file://server:80/C:/', 'file:////server/share', 'file:///\\\\server\\share',
  'file:///C:/x?', 'file:///C:/x?query=1', 'file:///C:/x#', 'file:///C:/x#fragment', 'file:///C:/x ', 'file:///C:/x\t',
  'file:///C:/x%ZZ', 'file:///C:/x%', 'file:///C:/%FF', 'file:///C:/%C0%AF',
  'file:///C:/%00', 'file:///C:/%0A', 'file:///C:/a\nb', 'file:///C:/%E2%80%AE',
  'file:///C:/a%2Fb', 'file:///C:/a%5Cb', 'file:///C:/a\\b',
  'file:///C:/x%22y', 'file:///C:/x%3Ay', 'file:///C:/x%7Cy', 'file:///C:/x%2Ay',
  'file:///C:/x.', 'file:///C:/x%20', 'file:///C:/CON', 'file:///C:/nul.txt',
  'file:///C:/COM1', 'file:///C:/LPT%C2%B2', 'file:///C|/folder',
  'file:///C:/./x', 'file:///C:/../x', 'file:///C:/%2e%2e/x', 'file:///C:/%2e./x',
  'file:///C:/%3F/Device', 'file:///C:/x' + 'a'.repeat(259),
]) {
  test(`URL rejected: ${String(url)}`, () => assert.throws(() => plugin.parseDirectoryUrl(url), plugin.DirectoryLinkError));
}

test('complete link-click context is accepted', () => assert.equal(plugin.parseClickContext(clickEnv()).focused_pane_id, 'pane-1'));
for (const variable of ['HERDR_ENV', 'HERDR_PLUGIN_ID', 'HERDR_PLUGIN_ACTION_ID',
  'HERDR_PLUGIN_LINK_HANDLER_ID', 'HERDR_PLUGIN_CLICKED_URL', 'HERDR_PANE_ID',
  'HERDR_TAB_ID', 'HERDR_WORKSPACE_ID', 'HERDR_PLUGIN_CONTEXT_JSON']) {
  test(`missing context rejected: ${variable}`, () => {
    const env = clickEnv(); delete env[variable];
    assert.throws(() => plugin.parseClickContext(env), hasCode('invalid_context'));
  });
}
for (const [field, value] of [['invocation_source', 'action'], ['link_handler_id', 'another-handler'],
  ['clicked_url', 'file:///C:/different'], ['focused_pane_id', 'other-pane'], ['focused_pane_id', null],
  ['tab_id', 'other-tab'], ['workspace_id', 'other-workspace']]) {
  test(`inconsistent context rejected: ${field}`, () => {
    const env = clickEnv(); const context = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON);
    context[field] = value; env.HERDR_PLUGIN_CONTEXT_JSON = JSON.stringify(context);
    assert.throws(() => plugin.parseClickContext(env), hasCode('invalid_context'));
  });
}

test('network drives are rejected before filesystem access', async () => {
  let reads = 0;
  await assert.rejects(plugin.resolveLocalDirectory('Z:\\Desktop', ['C:\\'],
    fakeFs({ lstat: async () => { reads++; return directoryInfo(); } })), hasCode('nonlocal_drive'));
  assert.equal(reads, 0);
});
for (const [label, overrides, code] of [
  ['file', { lstat: async () => ({ isDirectory: () => false, isSymbolicLink: () => false }) }, 'not_directory'],
  ['missing', { lstat: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); } }, 'not_found'],
  ['denied', { lstat: async () => { throw Object.assign(new Error(), { code: 'EACCES' }); } }, 'access_denied'],
  ['final UNC', { realpath: async () => '\\\\server\\share' }, 'unsafe_path'],
  ['final network disk', { realpath: async () => 'Z:\\folder' }, 'nonlocal_drive'],
]) {
  test(`directory validation rejects ${label}`, async () => {
    await assert.rejects(plugin.resolveLocalDirectory('C:\\folder', ['C:\\'], fakeFs(overrides)), hasCode(code));
  });
}
for (const destination of ['\\\\server\\share', '\\\\?\\UNC\\server\\share', '\\\\.\\C:\\x', 'Z:\\folder']) {
  test(`junction rejected before reading target: ${destination}`, async () => {
    const reads = [];
    await assert.rejects(plugin.resolveLocalDirectory('C:\\junction\\child', ['C:\\'], fakeFs({
      lstat: async target => { reads.push(target); return { isSymbolicLink: () => true }; },
      readlink: async () => destination,
    })), plugin.DirectoryLinkError);
    assert.deepEqual(reads, ['C:\\junction']);
  });
}
for (const destination of ['C:\\actual', '\\\\?\\C:\\actual', 'actual']) {
  test(`local junction resolution: ${destination}`, async () => {
    const resolved = await plugin.resolveLocalDirectory('C:\\junction\\child', ['C:\\'], fakeFs({
      lstat: async target => target === 'C:\\junction' ? { isSymbolicLink: () => true } : directoryInfo(),
      readlink: async () => destination,
    }));
    assert.equal(resolved, 'C:\\actual\\child');
  });
}

test('junction loops fail closed', async () => {
  await assert.rejects(plugin.resolveLocalDirectory('C:\\loop', ['C:\\'], fakeFs({
    lstat: async () => ({ isSymbolicLink: () => true }), readlink: async () => 'C:\\loop',
  })), hasCode('link_loop'));
});

test('successful click opens exactly the decoded full URL target', async () => {
  const requests = [];
  const full = 'C:\\中文 Desktop #%,(x)&';
  const env = clickEnv('file:///C:/%E4%B8%AD%E6%96%87%20Desktop%20%23%25,(x)%26');
  assert.equal(await plugin.handleClick(env, {
    platform: 'win32', verifyPane: async () => {}, fs: fakeFs(),
    nativeShell: request => {
      requests.push(request);
      return request.operation === 'drives' ? { drives: ['C:\\'] } : { opened: true, path: request.path };
    },
  }), full);
  assert.deepEqual(requests, [{ operation: 'drives' }, { operation: 'open', path: full }]);
});
for (const [label, env, overrides] of [
  ['missing context', {}, {}],
  ['bad URL', clickEnv('file:///C:/x%22y'), {}],
  ['remote pane', clickEnv(), { verifyPane: async () => { throw new plugin.DirectoryLinkError('remote_pane', 'remote'); } }],
  ['file', clickEnv(), { fs: fakeFs({ lstat: async () => ({ isDirectory: () => false, isSymbolicLink: () => false }) }) }],
  ['missing directory', clickEnv(), { fs: fakeFs({ lstat: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); } }) }],
]) {
  test(`failed click never opens Explorer: ${label}`, async () => {
    let opens = 0;
    await assert.rejects(plugin.handleClick(env, {
      platform: 'win32', verifyPane: async () => {}, fs: fakeFs(),
      nativeShell: request => { if (request.operation === 'open') opens++; return { drives: ['C:\\'] }; },
      ...overrides,
    }), plugin.DirectoryLinkError);
    assert.equal(opens, 0);
  });
}

test('native failure propagates without a second launch', async () => {
  let opens = 0;
  await assert.rejects(plugin.handleClick(clickEnv(), {
    platform: 'win32', verifyPane: async () => {}, fs: fakeFs(),
    nativeShell: request => {
      if (request.operation === 'drives') return { drives: ['C:\\'] };
      opens++; throw new plugin.DirectoryLinkError('launch_failed', 'native failure');
    },
  }), hasCode('launch_failed'));
  assert.equal(opens, 1);
});

test('non-Windows host is rejected', async () => {
  await assert.rejects(plugin.handleClick(clickEnv(), { platform: 'linux' }), hasCode('unsupported_platform'));
});

test('native Windows validation uses actual temporary directories without opening windows',
  { skip: process.platform !== 'win32', timeout: 120000 }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'herdr-directory-links-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const { drives } = plugin.nativeShell({ operation: 'drives' });
    for (const name of ['Desktop', '中文 空格 🐱 👨‍👩‍👧 a‌b', '#%,(x)&', "apostrophe's %TEMP%", ',/select,']) {
      // '/' is not a legal Windows name; use a directory resembling an Explorer switch.
      const target = path.join(root, name.replaceAll('/', '_'));
      await fs.mkdir(target);
      const parsed = plugin.parseDirectoryUrl(pathToFileURL(target).href);
      const resolved = await plugin.resolveLocalDirectory(parsed, drives);
      const result = plugin.nativeShell({ operation: 'validate', path: resolved });
      assert.equal(result.opened, false);
      assert.equal(result.path.toLowerCase(), resolved.toLowerCase());
    }
    const target = path.join(root, 'Desktop');
    const junction = path.join(root, 'junction');
    await fs.symlink(target, junction, 'junction');
    assert.equal((await plugin.resolveLocalDirectory(junction, drives)).toLowerCase(), target.toLowerCase());
    // Native layer refuses unresolved junctions: caller must first canonicalize.
    assert.throws(() => plugin.nativeShell({ operation: 'validate', path: junction }), hasCode('system_validation_failed'));
    for (const name of ['file.txt', 'app.exe', 'script.bat', 'script.ps1', 'shortcut.lnk']) {
      const file = path.join(root, name); await fs.writeFile(file, 'not executable');
      await assert.rejects(plugin.resolveLocalDirectory(file, drives), hasCode('not_directory'));
      assert.throws(() => plugin.nativeShell({ operation: 'validate', path: file }), hasCode('system_validation_failed'));
    }
    assert.throws(() => plugin.nativeShell({ operation: 'validate', path: path.join(root, 'missing') }), hasCode('not_found'));
    const driveRoot = path.parse(root).root;
    assert.equal(plugin.nativeShell({ operation: 'validate', path: driveRoot }).opened, false);
  });
