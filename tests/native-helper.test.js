'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ensureHelper } = require('../src/native-helper');
const plugin = require('../src/open-directory');

test('compiled facts preserve host binding and current local drives',
  { skip: process.platform !== 'win32' }, () => {
    const facts = plugin.nativeShell({ operation: 'facts' });
    assert.equal(facts.host, plugin.nativeShell({ operation: 'host' }).host);
    assert.deepEqual(facts.drives, plugin.nativeShell({ operation: 'drives' }).drives);
    assert.match(facts.host, /^[a-f0-9]{64}$/);
  });

test('helper builds once, verifies cached bytes and refuses corrupt cache',
  { skip: process.platform !== 'win32', timeout: 60000 }, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-native-helper-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const windows = process.env.SystemRoot;
    const executable = ensureHelper(windows, process.env, { cacheRoot: root });
    const before = fs.statSync(executable).mtimeMs;
    assert.equal(ensureHelper(windows, process.env, { cacheRoot: root }), executable);
    assert.equal(fs.statSync(executable).mtimeMs, before);
    const result = spawnSync(executable, [], {
      input: JSON.stringify({ operation: 'host' }), encoding: 'utf8', shell: false,
    });
    assert.equal(result.status, 0);
    assert.match(JSON.parse(result.stdout).host, /^[a-f0-9]{64}$/);
    fs.appendFileSync(executable, 'corruption');
    assert.throws(() => ensureHelper(windows, process.env, { cacheRoot: root }),
      error => error.code === 'helper_cache_invalid');
  });

test('native helper rejects unknown operations and malformed JSON',
  { skip: process.platform !== 'win32' }, () => {
    assert.throws(() => plugin.nativeShell({ operation: 'execute', path: 'C:\\Windows' }),
      plugin.DirectoryLinkError);
    const executable = ensureHelper(process.env.SystemRoot);
    const result = spawnSync(executable, [], { input: '{', encoding: 'utf8', shell: false });
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'native_failure');
  });
