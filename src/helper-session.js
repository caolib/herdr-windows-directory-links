'use strict';

const { spawn } = require('node:child_process');

// A pipe exists only during one click. No detached/background service or polling.
function createSession(executable, args, options = {}) {
  const { timeout = 15000, ...spawnOptions } = options;
  const child = spawn(executable, args, {
    shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...spawnOptions,
  });
  let waiting = null, output = '', stderr = '', ended = false, failure = null;
  let settleClosed;
  const closed = new Promise(resolve => { settleClosed = resolve; });
  const fail = code => {
    failure = failure || code;
    if (waiting) { waiting.reject(Object.assign(new Error(failure), { code: failure })); waiting = null; }
    child.kill();
  };
  const timer = setTimeout(() => fail('helper_timeout'), timeout);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    output += chunk;
    if (output.length > 32768) return fail('helper_protocol_error');
    let newline;
    while ((newline = output.indexOf('\n')) !== -1) {
      const line = output.slice(0, newline); output = output.slice(newline + 1);
      if (!waiting) return fail('helper_protocol_error');
      let result;
      try { result = JSON.parse(line); } catch { return fail('helper_protocol_error'); }
      const pending = waiting; waiting = null; pending.resolve(result);
    }
  });
  child.stderr.on('data', chunk => {
    stderr += chunk;
    if (stderr.length > 4096) fail('helper_protocol_error');
  });
  child.stdin.on('error', () => fail('helper_write_failed'));
  child.on('error', () => fail('helper_spawn_failed'));
  child.on('close', (code, signal) => {
    clearTimeout(timer); ended = true;
    const detail = stderr.trim();
    if (code !== 0 || signal || output.trim()) {
      failure = failure || (/^(?:win32_\d+|native_failure|unsafe_path|nonlocal_drive|not_directory|path_too_long|unsafe_final_path|path_changed|host_unavailable|invalid_operation)$/.test(detail)
        ? detail : 'helper_failed');
    }
    if (waiting) { waiting.reject(Object.assign(new Error(failure || 'helper_early_exit'), { code: failure || 'helper_early_exit' })); waiting = null; }
    settleClosed();
  });
  return {
    request(value) {
      if (ended || failure || waiting) return Promise.reject(Object.assign(new Error('helper_unavailable'), { code: failure || 'helper_unavailable' }));
      const line = JSON.stringify(value);
      if (line.length > 32768) return Promise.reject(Object.assign(new Error('helper_protocol_error'), { code: 'helper_protocol_error' }));
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
        child.stdin.write(line + '\n');
      });
    },
    async finish() {
      if (!ended) child.stdin.end();
      await closed;
      if (failure) throw Object.assign(new Error(failure), { code: failure });
    },
  };
}
module.exports = { createSession };
