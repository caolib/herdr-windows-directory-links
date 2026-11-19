'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSession } = require('../src/helper-session');
const plugin = require('../src/open-directory');

const fixture = `const r=require('node:readline').createInterface({input:process.stdin});
r.on('line',line=>console.log(JSON.stringify({pid:process.pid,...JSON.parse(line)})));`;

test('multiple requests share one process, and EOF ends it', async () => {
  const session = createSession(process.execPath, ['-e', fixture]);
  const facts = await session.request({ operation: 'facts' });
  const final = await session.request({ operation: 'validate', path: 'C:\\folder' });
  assert.equal(facts.pid, final.pid);
  assert.equal(final.path, 'C:\\folder');
  await session.finish();
  await assert.rejects(session.request({ operation: 'open' }));
});

test('malformed response fails closed and child is reaped', async () => {
  const session = createSession(process.execPath, ['-e', "process.stdin.on('data',()=>console.log('not JSON')); "]);
  await assert.rejects(session.request({ operation: 'facts' }), error => error.code === 'helper_protocol_error');
  await assert.rejects(session.finish());
});

test('timeout terminates stalled child', async () => {
  const session = createSession(process.execPath, ['-e', 'process.stdin.resume()'], { timeout: 500 });
  await assert.rejects(session.request({ operation: 'facts' }), error => error.code === 'helper_timeout');
  await assert.rejects(session.finish(), error => error.code === 'helper_timeout');
});

test('spawn failure is reported and cleanup finishes', async () => {
  const session = createSession('nonexistent-herdr-helper-12345', []);
  await assert.rejects(session.request({ operation: 'facts' }));
  await assert.rejects(session.finish());
});

test('native session gets facts and validates directory without opening a window',
  { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
    const session = plugin.nativeSession();
    try {
      const facts = await session.request({ operation: 'facts' });
      assert.match(facts.host, /^[a-f0-9]{64}$/);
      assert.ok(Array.isArray(facts.drives));
      const result = await session.request({ operation: 'validate', path: process.env.SystemRoot });
      assert.equal(result.opened, false);
    } finally { await session.finish(); }
  });

test('native session abort after facts does not require an open request',
  { skip: process.platform !== 'win32' }, async () => {
    const session = plugin.nativeSession();
    await session.request({ operation: 'facts' });
    await session.finish();
  });

test('native session rejects invalid final request',
  { skip: process.platform !== 'win32' }, async () => {
    const session = plugin.nativeSession();
    await session.request({ operation: 'facts' });
    await assert.rejects(session.request({ operation: 'execute' }), plugin.DirectoryLinkError);
    await assert.rejects(session.finish(), plugin.DirectoryLinkError);
  });

test('handler closes one session on metadata rejection and never sends open', async () => {
  const context = { invocation_source: 'link_click', link_handler_id: plugin.HANDLER_ID,
    clicked_url: 'file:///C:/missing', focused_pane_id: 'pane', tab_id: 'tab', workspace_id: 'workspace' };
  const env = { HERDR_ENV: '1', HERDR_PLUGIN_ID: plugin.PLUGIN_ID, HERDR_PLUGIN_ACTION_ID: plugin.ACTION_ID,
    HERDR_PLUGIN_LINK_HANDLER_ID: plugin.HANDLER_ID, HERDR_PLUGIN_CLICKED_URL: context.clicked_url,
    HERDR_PANE_ID: 'pane', HERDR_TAB_ID: 'tab', HERDR_WORKSPACE_ID: 'workspace',
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify(context) };
  let finishes = 0;
  const requests = [];
  await assert.rejects(plugin.handleClick(env, {
    platform: 'win32', verifyPane: async () => {},
    nativeSession: () => ({
      request: async request => { requests.push(request.operation); return { drives: ['C:\\'] }; },
      finish: async () => { finishes++; },
    }),
    fs: { lstat: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); } },
  }), error => error.code === 'not_found');
  assert.deepEqual(requests, ['facts']);
  assert.equal(finishes, 1);
});
