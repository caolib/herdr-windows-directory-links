'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { spawnSync } = require('node:child_process');
const { ensureHelper } = require('./native-helper');
const { createSession } = require('./helper-session');

const PLUGIN_ID = 'local.windows-directory-links';
const ACTION_ID = 'open-directory';
const HANDLER_ID = 'local-directory';
// Reject controls and bidi overrides/marks, but preserve legitimate ZWJ/ZWNJ.
const CONTROL = new RegExp(`[\\p{Cc}${String.fromCodePoint(
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069, 0xfeff,
)}]`, 'u');
const MAX_PATH = 259; // Explorer long-path behavior is deliberately out of scope.

class DirectoryLinkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DirectoryLinkError';
    this.code = code;
  }
}
function reject(code, message) { throw new DirectoryLinkError(code, message); }

function validateWindowsPath(target) {
  if (typeof target !== 'string' || !/^[a-z]:\\/i.test(target) || CONTROL.test(target)) {
    reject('unsafe_path', '只接受本地盘符绝对路径。');
  }
  if (target.length > MAX_PATH) reject('path_too_long', '暂不支持超过 259 个 UTF-16 字符的路径。');
  if (/[<>"|?*]/.test(target) || target.slice(2).includes(':')) {
    reject('unsafe_path', '拒绝设备路径、非法名称和备用数据流。');
  }
  for (const component of target.slice(3).split('\\')) {
    if (!component) continue;
    if (component === '.' || component === '..' || /[. ]$/.test(component) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(component)) {
      reject('unsafe_path', '拒绝歧义路径和 Windows 保留名称。');
    }
  }
  return target;
}

function parseDirectoryUrl(raw) {
  if (typeof raw !== 'string' || !raw.isWellFormed() || raw.length > 16384 || CONTROL.test(raw) ||
      !/^file:\/\/\/[a-z]:\//i.test(raw) || /\s$/.test(raw) || raw.includes('\\') || /[?#]/.test(raw) ||
      /%(?![0-9a-f]{2})/i.test(raw)) {
    reject('invalid_url', '需要无主机、查询串或片段的 file:/// URL。');
  }
  let target;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'file:' || url.hostname || url.username || url.password || url.port) {
      reject('invalid_url', '拒绝远程主机或带凭据的链接。');
    }
    // Check original dot segments: WHATWG URL normalizes them before fileURLToPath.
    if (raw.split('/').some(part => /^(?:\.|%2e){1,2}$/i.test(part))) {
      reject('invalid_url', '拒绝带点段的歧义链接。');
    }
    target = fileURLToPath(url, { windows: true });
  } catch (error) {
    if (error instanceof DirectoryLinkError) throw error;
    reject('invalid_url', '文件 URL 编码或格式无效。');
  }
  return validateWindowsPath(target);
}

function parseClickContext(env) {
  let context;
  try { context = JSON.parse(env.HERDR_PLUGIN_CONTEXT_JSON); }
  catch { reject('invalid_context', '缺失或无效的 Herdr 点击上下文。'); }
  if (!context || Array.isArray(context) || typeof context !== 'object' ||
      env.HERDR_ENV !== '1' || env.HERDR_PLUGIN_ID !== PLUGIN_ID ||
      env.HERDR_PLUGIN_ACTION_ID !== ACTION_ID || context.invocation_source !== 'link_click' ||
      context.link_handler_id !== HANDLER_ID || env.HERDR_PLUGIN_LINK_HANDLER_ID !== HANDLER_ID ||
      typeof context.clicked_url !== 'string' || context.clicked_url !== env.HERDR_PLUGIN_CLICKED_URL) {
    reject('invalid_context', '仅接受此插件的匹配链接点击。');
  }
  for (const [field, variable] of [
    ['focused_pane_id', 'HERDR_PANE_ID'], ['tab_id', 'HERDR_TAB_ID'], ['workspace_id', 'HERDR_WORKSPACE_ID'],
  ]) {
    if (typeof context[field] !== 'string' || !context[field] ||
        context[field].length > 128 || context[field].startsWith('-') ||
        CONTROL.test(context[field]) || context[field] !== env[variable]) {
      reject('invalid_context', '点击 pane、tab 或 workspace 标识缺失或不一致。');
    }
  }
  return context;
}

function ensureLocalDrive(target, drives) {
  validateWindowsPath(target);
  if (!Array.isArray(drives) || !drives.some(drive =>
    typeof drive === 'string' && drive.toLowerCase() === target.slice(0, 3).toLowerCase())) {
    reject('nonlocal_drive', '拒绝网络盘、未知磁盘及未挂载的盘符。');
  }
}

function metadataError(error) {
  if (error instanceof DirectoryLinkError) throw error;
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') reject('not_found', '目标目录不存在。');
  if (error.code === 'EACCES' || error.code === 'EPERM') reject('access_denied', '无法读取目标目录元数据。');
  reject('metadata_failure', '读取目录元数据失败。');
}

async function resolveLocalDirectory(target, drives, io = fs) {
  // Walk each ancestor before traversing it: a local junction may lead to UNC.
  async function walk(input, depth) {
    if (depth > 40) reject('link_loop', '目录链接过深或形成循环。');
    ensureLocalDrive(input, drives);
    const parts = input.slice(3).split('\\').filter(Boolean);
    let current = input.slice(0, 3);
    for (let index = 0; index < parts.length; index++) {
      current = path.win32.join(current, parts[index]);
      const info = await io.lstat(current);
      if (info.isSymbolicLink()) {
        let destination = await io.readlink(current);
        // Node may return this prefix for Windows junctions, but not for input URLs.
        if (/^\\\\\?\\[a-z]:\\/i.test(destination)) destination = destination.slice(4);
        if (!path.win32.isAbsolute(destination)) destination = path.win32.resolve(path.win32.dirname(current), destination);
        // Validate BEFORE joining; otherwise a UNC target could be normalized away.
        ensureLocalDrive(destination, drives);
        const resolved = await walk(destination, depth + 1);
        return walk(path.win32.join(resolved, ...parts.slice(index + 1)), depth + 1);
      }
      if (!info.isDirectory()) reject('not_directory', '只允许打开目录，不打开文件或快捷方式。');
    }
    const real = await io.realpath(current);
    ensureLocalDrive(real, drives);
    const finalInfo = await io.stat(real);
    if (!finalInfo.isDirectory()) reject('not_directory', '目标不是目录。');
    return real;
  }
  try { return await walk(target, 0); }
  catch (error) { metadataError(error); }
}

function runJson(executable, args, options, code) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 15000, maxBuffer: 1024 * 1024, ...options,
  });
  if (result.error || result.signal || result.status !== 0) {
    const detail = (result.stderr || '').trim();
    const nativeCode = /^(?:win32_\d+|native_failure|unsafe_path|nonlocal_drive|not_directory|path_too_long|unsafe_final_path|path_changed)$/.test(detail) ? detail : '';
    if (nativeCode === 'win32_2' || nativeCode === 'win32_3') reject('not_found', '目标目录不存在。');
    if (nativeCode === 'win32_5') reject('access_denied', 'Windows 拒绝访问目标目录。');
    reject(code, `系统调用失败${nativeCode ? `（${nativeCode}）` : ''}。`);
  }
  try { return JSON.parse(result.stdout); }
  catch { reject(code, '系统接口返回了无效 JSON。'); }
}

function helperLocation(env) {
  // Windows env names are case-insensitive; object copies lose process.env's lookup.
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? env.systemroot;
  if (typeof root !== 'string') reject('system_unavailable', 'SystemRoot 未设置。');
  validateWindowsPath(root);
  let executable;
  try { executable = ensureHelper(root, env); }
  catch (error) {
    reject('system_unavailable', error.code === 'helper_cache_invalid'
      ? '系统辅助程序缓存校验失败，请显式重建。' : '无法构建系统辅助程序，请检查 PowerShell 和目录写入权限。');
  }
  return { executable, cwd: path.win32.join(root, 'System32') };
}

function nativeShell(request, env = process.env) {
  const { executable, cwd } = helperLocation(env);
  return runJson(executable, [], { cwd, input: JSON.stringify(request), env },
    request.operation === 'open' ? 'launch_failed' : 'system_validation_failed');
}

function sessionError(error, opening) {
  if (error.code === 'win32_2' || error.code === 'win32_3') reject('not_found', '目标目录不存在。');
  if (error.code === 'win32_5') reject('access_denied', 'Windows 拒绝访问目标目录。');
  reject(opening ? 'launch_failed' : 'system_validation_failed', '系统辅助程序调用失败。');
}

function nativeSession(env = process.env) {
  const { executable, cwd } = helperLocation(env);
  const session = createSession(executable, ['--session'], { cwd, env });
  let opening = false;
  return {
    async request(value) {
      opening = value.operation === 'open';
      try { return await session.request(value); } catch (error) { sessionError(error, opening); }
    },
    async finish() {
      try { await session.finish(); } catch (error) { sessionError(error, opening); }
    },
  };
}

// One short-lived helper per click, with fresh safety metadata.
async function handleClick(env = process.env, dependencies = {}) {
  if ((dependencies.platform || process.platform) !== 'win32') reject('unsupported_platform', '此插件仅支持 Windows。');
  const context = parseClickContext(env);
  const target = parseDirectoryUrl(context.clicked_url);
  const session = dependencies.nativeShell ? null :
    (dependencies.nativeSession || nativeSession)(env);
  const shell = dependencies.nativeShell || (request => session.request(request));
  let primaryError;
  try {
    let drives;
    if (dependencies.verifyPane) {
      await dependencies.verifyPane(context, env);
      ({ drives } = await shell({ operation: session ? 'facts' : 'drives' }));
    } else {
      const facts = await shell({ operation: 'facts' });
      await verifyLocalPane(context, env, {
        identity: currentEnv => localIdentity(currentEnv, () => facts),
      });
      drives = facts.drives;
    }
    const resolved = await resolveLocalDirectory(target, drives, dependencies.fs || fs);
    // Only send the open request AFTER host, pane and directory checks succeed.
    const result = await shell({ operation: 'open', path: resolved });
    if (!result || result.opened !== true || typeof result.path !== 'string' ||
        result.path.toLowerCase() !== resolved.toLowerCase()) {
      reject('launch_failed', 'Windows 未确认打开指定目录。');
    }
    return resolved;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (session) {
      try { await session.finish(); }
      catch (error) { if (!primaryError) throw error; }
    }
  }
}

function samePath(left, right) {
  return typeof left === 'string' && typeof right === 'string' &&
    path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
}

function validateBinding(binding, identity) {
  if (!binding || binding.version !== 1 || !/^[a-f0-9]{64}$/.test(binding.host) ||
      binding.host !== identity.host || !samePath(binding.socket, identity.socket) ||
      !samePath(binding.binary, identity.binary)) {
    reject('unbound_host', '本机、Herdr 二进制或 socket 未绑定／不匹配，请先显式配置本机。');
  }
}

async function localIdentity(env, shell = request => nativeShell(request, env), io = fs) {
  if (env.HERDR_REMOTE_KEYBINDINGS || env.HERDR_REMOTE_PREFERENCES_IDENTITY) {
    reject('remote_pane', '拒绝远程 Herdr 客户端上下文。');
  }
  validateWindowsPath(env.HERDR_SOCKET_PATH);
  validateWindowsPath(env.HERDR_BIN_PATH);
  if (path.win32.extname(env.HERDR_BIN_PATH).toLowerCase() !== '.exe') {
    reject('unbound_host', '需要 Herdr 提供的本机 exe 路径。');
  }
  const binary = await io.realpath(env.HERDR_BIN_PATH).catch(() =>
    reject('unbound_host', '无法核实本机 Herdr 二进制。'));
  validateWindowsPath(binary);
  const { host } = shell({ operation: 'host' });
  if (typeof host !== 'string' || !/^[a-f0-9]{64}$/.test(host)) {
    reject('unbound_host', '无法核实本机标识。');
  }
  return { host, binary, socket: path.win32.normalize(env.HERDR_SOCKET_PATH) };
}

function assertPaneResponse(response, context) {
  // Official CLI emits the API envelope, not the inner pane directly.
  const pane = response?.result?.pane;
  if (response?.error || response?.result?.type !== 'pane_info' || !pane ||
      pane.pane_id !== context.focused_pane_id || pane.tab_id !== context.tab_id ||
      pane.workspace_id !== context.workspace_id) {
    reject('unverified_pane', '无法在已绑定本机 Herdr 中核实点击 pane、tab 和 workspace。');
  }
}

async function verifyLocalPane(context, env = process.env, dependencies = {}) {
  const io = dependencies.fs || fs;
  const identity = await (dependencies.identity || localIdentity)(env);
  validateWindowsPath(env.HERDR_PLUGIN_CONFIG_DIR);
  let binding;
  try {
    binding = JSON.parse(await io.readFile(path.win32.join(env.HERDR_PLUGIN_CONFIG_DIR, 'local-host.json'), 'utf8'));
  } catch { reject('unbound_host', '缺失本机绑定，需先运行 configure-local.js。'); }
  validateBinding(binding, identity);
  const childEnv = { ...env, HERDR_SOCKET_PATH: identity.socket };
  delete childEnv.HERDR_SESSION;
  const response = (dependencies.query || ((binary, args, options) =>
    runJson(binary, args, options, 'unverified_pane')))(identity.binary,
    ['pane', 'get', context.focused_pane_id], { env: childEnv, cwd: __dirname });
  assertPaneResponse(response, context);
}

if (require.main === module) {
  handleClick().then(() => {
    process.stdout.write('[windows-directory-links] opened local directory\n');
  }).catch(error => {
    const known = error instanceof DirectoryLinkError;
    process.stderr.write(`[windows-directory-links] ${known ? error.code : 'internal_error'}: ${known ? error.message : '内部错误。'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  PLUGIN_ID, ACTION_ID, HANDLER_ID, DirectoryLinkError,
  validateWindowsPath, parseDirectoryUrl, parseClickContext, ensureLocalDrive,
  resolveLocalDirectory, nativeShell, nativeSession, localIdentity, validateBinding,
  assertPaneResponse, verifyLocalPane, handleClick,
};
