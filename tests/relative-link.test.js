'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const tempDirectory = require('./temp-directory');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { build } = require('../scripts/build-plugin');
const windows = { skip: process.platform !== 'win32', timeout: 60000 };
let executable;
function policy(requests) {
  executable ||= build();
  const result = spawnSync(executable, ['--policy-test'], {
    input: JSON.stringify(requests), encoding: 'utf8', shell: false, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const relative = 'proposal/qcbm/output/report-v25-integrated.docx';
const documentExtensions = [
  '.md', '.markdown', '.txt', '.log', '.pdf', '.docx', '.xlsx', '.pptx',
  '.csv', '.tsv', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini',
  '.custom', '.png', '.html', '.zip', '.xml', '.bin',
];

test('common documents including relative README pass native validation', windows, async t => {
  const root = await tempDirectory(path.join(os.tmpdir(), 'herdr-document-types-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const files = documentExtensions.map(extension => path.join(root, 'README' + extension));
  await Promise.all(files.map(file => fs.writeFile(file, 'validation fixture; never opened')));
  const requests = files.flatMap(file => [
    { operation: 'validate-link', value: path.basename(file), cwd: root },
    { operation: 'validate-link', value: pathToFileURL(file).href },
  ]);
  const results = policy(requests);
  results.forEach((result, index) => {
    assert.equal(result.path?.toLowerCase(), files[Math.floor(index / 2)].toLowerCase(), result.error);
    assert.equal(result.action, 'open');
    assert.equal(result.opened, false);
  });
  assert.equal(policy([{ operation: 'resolve', value: files[0] }])[0].error, 'not_directory');
});
for (const [value, expected] of [
  [relative, 'proposal\\qcbm\\output\\report-v25-integrated.docx'],
  ['./' + relative, 'proposal\\qcbm\\output\\report-v25-integrated.docx'],
  [relative.replaceAll('/', '\\'), 'proposal\\qcbm\\output\\report-v25-integrated.docx'],
  ['output/中文%20👨‍👩‍👧.DOCX', 'output\\中文 👨‍👩‍👧.DOCX'],
  ['output/%23%25,(x)%26.docx', 'output\\#%,(x)&.docx'],
  ['output/literal%2520.docx', 'output\\literal%20.docx'],
]) {
  test(`relative document joins pane cwd: ${value}`, windows, () => {
    const [result] = policy([{ operation: 'parse-link', value, cwd: 'C:\\project' }]);
    assert.equal(result.path, 'C:\\project\\' + expected, result.error);
  });
}

test('restricted and extensionless files retain their exact path for Explorer selection, never file open', windows, async t => {
  const root = await tempDirectory(path.join(os.tmpdir(), 'herdr-restricted-files-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const names = ['program.EXE', 'script.cmd', 'script.ps1', 'script.js', 'script.py', 'shortcut.lnk',
    'link.url', 'installer.msi', 'control.cpl', 'page.hta', 'macro.docm', 'README',
    '中文 空格 👨‍👩‍👧 #%,(x)&.js', 'literal%20.ps1'];
  await Promise.all(names.map(name => fs.writeFile(path.join(root, name), 'validation only; never executed')));
  const results = policy(names.flatMap(name => [
    { operation: 'validate-link', value: encodeURIComponent(name), cwd: root },
    { operation: 'validate-link', value: pathToFileURL(path.join(root, name)).href },
  ]));
  results.forEach((result, index) => {
    assert.equal(result.path?.toLowerCase(), path.join(root, names[Math.floor(index / 2)]).toLowerCase(), result.error);
    assert.equal(result.action, 'select');
    assert.equal(result.opened, false);
  });
  const directory = path.join(root, 'folder.exe');
  await fs.mkdir(directory);
  const [result] = policy([{ operation: 'validate-link', value: 'folder.exe', cwd: root }]);
  assert.equal(result.path?.toLowerCase(), directory.toLowerCase(), result.error);
  assert.equal(result.action, 'open');
  const leased = policy(names.map(name => ({ operation: 'file-lease-test', value: path.join(root, name) })));
  leased.forEach((result, index) => {
    assert.equal(result.path?.toLowerCase(), path.join(root, names[index]).toLowerCase(), result.error);
    assert.equal(result.action, 'select');
    assert.equal(result.opened, false);
  });
});

test('relative document prefers foreground cwd and accepts drive root', windows, () => {
  const results = policy([
    { operation: 'parse-link', value: relative, cwd: 'C:\\wrong', foreground_cwd: 'D:/project' },
    { operation: 'parse-link', value: relative, cwd: 'C:\\' },
    { operation: 'parse-link', value: 'file:///C:/Windows', foreground_cwd: '/remote' },
  ]);
  assert.equal(results[0].path, 'D:\\project\\' + relative.replaceAll('/', '\\'));
  assert.equal(results[1].path, 'C:\\' + relative.replaceAll('/', '\\'));
  assert.equal(results[2].path, 'C:\\Windows');
});

for (const value of [
  '../report.docx', 'output/../report.docx', '%2e%2e/report.docx',
  '/report.docx', '\\report.docx', '//server/share/report.docx',
  'C:report.docx', 'C:/report.docx', 'https://example.com/report.docx',
  'report.docx?download=1', 'report.docx#fragment', 'output/%2Freport.docx',
  'output/%5Creport.docx', 'output/%FF.docx', 'output/%ZZ.docx',
  'output/%00.docx', 'output/%E2%80%AE.docx', 'output/CON.docx',
  'output/report.docx ', 'output/report.docx:stream', '', null,
]) {
  test(`relative document rejects ambiguous or unsupported input: ${value}`, windows, () => {
    assert.ok(policy([{ operation: 'parse-link', value, cwd: 'C:\\project' }])[0].error);
  });
}

test('relative document requires valid pane cwd and never falls back from invalid foreground cwd', windows, () => {
  for (const fields of [
    {}, { cwd: 'project' }, { cwd: '/remote' }, { cwd: '\\\\server\\share' },
    { cwd: 'C:\\project', foreground_cwd: '/remote' },
    { cwd: 'C:\\project', foreground_cwd: { path: 'C:\\other' } },
  ]) {
    const [result] = policy([{ operation: 'parse-link', value: relative, ...fields }]);
    assert.equal(result.error, 'unverified_cwd', JSON.stringify(fields));
  }
  assert.ok(policy([{ operation: 'parse-link', value: 'x'.repeat(250) + '.docx', cwd: 'C:\\project' }])[0].error);
});

test('file validation preserves directories, browses restricted files and leases the target ancestry', windows, async t => {
  const root = await tempDirectory(path.join(os.tmpdir(), 'herdr-relative-docx-test-'));
  const junction = path.join(root, 'alias');
  const network = path.join(root, 'network');
  const disguised = path.join(root, 'disguised.exe');
  t.after(async () => {
    for (const link of [junction, network, disguised]) {
      await fs.unlink(link).catch(async error => {
        if (error.code !== 'ENOENT') await fs.rmdir(link);
      });
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const directory = path.join(root, 'proposal', 'qcbm', 'output');
  await fs.mkdir(directory, { recursive: true });
  const document = path.join(directory, 'report-v25-integrated.docx');
  await fs.writeFile(document, 'validation fixture; never opened');
  await fs.symlink(directory, junction, 'junction');
  await fs.symlink(document, disguised, 'junction');
  await fs.symlink('\\\\nonexistent-herdr-host\\share', network, 'junction');
  const unsafeFiles = [];
  for (const name of ['app.exe', 'script.ps1', 'shortcut.lnk', 'macro.docm', 'file.url']) {
    const file = path.join(directory, name);
    await fs.writeFile(file, 'not executable'); unsafeFiles.push(file);
  }
  const results = policy([
    { operation: 'validate-link', value: relative, cwd: root },
    { operation: 'validate-link', value: pathToFileURL(document).href },
    { operation: 'validate-link', value: pathToFileURL(directory).href },
    ...unsafeFiles.map(file => ({ operation: 'validate-link', value: pathToFileURL(file).href })),
    { operation: 'validate-link', value: 'missing.docx', cwd: root },
    { operation: 'document-lease-test', value: document },
    { operation: 'resolve', value: document }, // Legacy directory-only helper stays strict.
    { operation: 'validate-link', value: 'alias/report-v25-integrated.docx', cwd: root },
    { operation: 'validate-link', value: 'network/report.docx', cwd: root },
    { operation: 'validate-link', value: pathToFileURL(disguised).href },
  ]);
  assert.equal(results[0].path?.toLowerCase(), document.toLowerCase(), results[0].error);
  assert.equal(results[1].path?.toLowerCase(), document.toLowerCase(), results[1].error);
  assert.equal(results[2].path?.toLowerCase(), directory.toLowerCase(), results[2].error);
  results.slice(3, 8).forEach((result, index) => {
    assert.equal(result.path?.toLowerCase(), unsafeFiles[index].toLowerCase(), result.error);
    assert.equal(result.action, 'select');
  });
  assert.equal(results[8].error, 'not_found');
  assert.equal(results[9].path?.toLowerCase(), document.toLowerCase(), results[9].error);
  assert.equal(results[10].error, 'not_directory');
  assert.equal(results[11].path?.toLowerCase(), document.toLowerCase(), results[11].error);
  assert.ok(results[12].error);
  assert.equal(results[13].path?.toLowerCase(), document.toLowerCase(), results[13].error);
  assert.equal(results[13].action, 'select');
});

test('an ordinary-looking link to a restricted final file selects the final file under lease', windows, async t => {
  const root = await tempDirectory(path.join(os.tmpdir(), 'herdr-select-final-test-'));
  const alias = path.join(root, 'ordinary.md');
  t.after(async () => {
    await fs.unlink(alias).catch(async error => {
      if (error.code !== 'ENOENT') await fs.rmdir(alias);
    });
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const file = path.join(root, 'build-plugin.js');
  await fs.writeFile(file, 'validation only; never executed');
  await fs.symlink(file, alias, 'junction');
  const results = policy([
    { operation: 'validate-link', value: 'ordinary.md', cwd: root },
    { operation: 'validate-link', value: pathToFileURL(alias).href },
    { operation: 'file-lease-test', value: alias },
  ]);
  for (const result of results) {
    assert.equal(result.path?.toLowerCase(), file.toLowerCase(), result.error);
    assert.equal(result.action, 'select');
    assert.equal(result.opened, false);
  }
});

test('manifest routes relative documents without taking over web links or executable paths', async () => {
  const manifest = await fs.readFile(path.join(__dirname, '..', 'herdr-plugin.toml'), 'utf8');
  const match = manifest.match(/^pattern = (?:'([^']*)'|"([^"]*)")$/m);
  assert.ok(match);
  const expression = match[1] ?? match[2];
  const regex = new RegExp(expression.replace(/^\(\?i\)/, ''), 'i');
  for (const value of [relative, './' + relative, relative.replaceAll('/', '\\'), 'output/report.DOCX',
    'file:///C:/Windows', 'README', 'assets', 'app.exe', 'script.ps1',
    ...documentExtensions.map(extension => 'README' + extension.toUpperCase())]) {
    assert.ok(regex.test(value), value);
  }
  for (const value of ['https://example.com/report.docx', 'mailto:test@example.com', 'C:/README.md', '/remote/report.docx']) {
    assert.equal(regex.test(value), false, value);
  }
});
