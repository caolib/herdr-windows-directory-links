# Windows Directory Links

A Windows-only **Herdr TUI** plugin for Ctrl+clicking local OSC 8 links.

- **Directories:** open in File Explorer.
- **Ordinary files:** open with their Windows default application.
- **Restricted files:** open the containing directory and select the file, without executing it.
- **Relative links:** resolve against the verified clicked pane's working directory.

Supports hostless `file:///C:/...` URLs and relative local paths. It does not change the status bar, mouse capture, ordinary single-click behavior, or HTTP(S) handling. This is not a Herdr desktop mod or a Claude Code plugin.

## Requirements

- Windows 10/11 and Herdr **0.9.5 or later**, using a trusted local pane and endpoint.
- .NET Framework 4.x.
- **For installation, building, and configuration:** Node.js >=22.1.0 and Windows PowerShell 5.1 in FullLanguage mode. The existing execution policy must allow local `.ps1` files.
- A writable installation directory for `.build/` and `.native-cache/`.
- Herdr mouse capture enabled and a terminal-recognized OSC 8 link.

Herdr does not install the toolchain for you. The plugin does not bypass execution policies, change antivirus settings, or request elevation.

After building, each click launches a single .NET process. It does **not** start Node.js, PowerShell, Herdr CLI, or an implicit compiler. There are no npm dependencies or persistent helper services.

Tested locally with Windows 11, Herdr 0.9.5, Node.js 24.14.1, and Windows PowerShell 5.1. New Herdr versions should be checked for compatibility with the Windows named-pipe mapping.

## Install from GitHub

Run from a trusted **local Windows Herdr pane**:

```powershell
herdr plugin install caolib/herdr-windows-directory-links
herdr plugin disable local.windows-directory-links
$configDir = herdr plugin config-dir local.windows-directory-links
$pluginInfo = herdr plugin list --plugin local.windows-directory-links --json | ConvertFrom-Json
$pluginRoot = $pluginInfo.result.plugins[0].plugin_root
```

GitHub installation runs the manifest build before registering the plugin. The install command prints a summary; the JSON list provides the actual Herdr-managed source directory.

For a first installation with **no existing binding**, configure and enable:

```powershell
node (Join-Path $pluginRoot 'scripts/configure-local.js') "$configDir"
herdr plugin enable local.windows-directory-links
```

Configuration writes `local-host.json` exclusively. It binds the host's MachineGuid hash, the final Herdr executable path, and the local socket. It does not store the raw MachineGuid, overwrite an existing binding, or enable the plugin itself.

If a binding already exists, inspect it first. Skip configuration when it is still valid; do not automatically delete or overwrite it. A missing or mismatched binding causes clicks to fail closed.

If the same plugin ID is already locally linked, disable it and run `herdr plugin unlink local.windows-directory-links` before GitHub installation. Keep local development links and GitHub installations separate.

The GitHub `herdr-plugin` topic enables automatic marketplace discovery. **A marketplace listing is not an official security review or certification.**

## Local development

Run these commands from the repository root in the intended local Herdr pane:

```powershell
node scripts/build-plugin.js
herdr plugin link . --disabled
$configDir = herdr plugin config-dir local.windows-directory-links
# First-time configuration only; do not overwrite an existing binding.
node scripts/configure-local.js "$configDir"
herdr plugin enable local.windows-directory-links
```

Unlike GitHub installation, **local `plugin link` does not run manifest build commands**.

To update a local link:

```powershell
herdr plugin disable local.windows-directory-links
node scripts/build-plugin.js
herdr plugin link . --enabled
```

Wait for active commands to finish before rebuilding: Windows may lock a running executable. The build verifies existing artifacts and refuses to overwrite corrupted executables. It does not modify the host binding.

If the socket/session or Herdr executable path changes, disable the plugin and inspect the old binding before explicitly reconfiguring. Never initialize bindings from SSH or forwarded sessions.

## File behavior and relative links

Example link formats, assuming the targets exist:

```text
[Project README](README.md)
[Open a document](output/report.docx)
[Select the build script](scripts/build-plugin.js)
```

The verified clicked pane's `foreground_cwd` is preferred. Only a missing or empty value falls back to `cwd`; an invalid nonempty value is rejected. The plugin does not use its own process directory, search the disk, or guess a project root.

Relative paths accept `/`, `\`, and leading `./`. Parent traversal (`..`), root-relative paths, UNC paths, drive-relative paths, other schemes, queries, and fragments are rejected. Absolute targets must use hostless file URLs such as `file:///C:/...`.

Herdr's Windows working-directory report can lag behind a shell or agent's directory changes. Keep the pane's working-directory integration up to date; the plugin cannot infer a missing root from the link alone. It also cannot turn unrecognized plain Markdown into terminal links.

Ordinary files, including Markdown, text, PDFs, Office documents, images, and custom extensions, use the default association. Missing associations return a Windows error rather than silently switching open methods.

Common programs, scripts, shortcuts, and macro documents are restricted—for example `.exe`, `.cmd`, `.ps1`, `.js`, `.py`, `.lnk`, `.url`, and `.docm`. Extensionless files are also selected rather than opened, preventing Windows executable-suffix probing. The original or final resolved filename can trigger restriction. See `RestrictedExtensions` in `src/native/directory-policy.cs` for the full list.

JavaScript remains restricted even if its default application is VS Code. A directory named `folder.exe` is still treated as a directory.

File selection uses `SHOpenFolderAndSelectItems`, not an `explorer /select` command string. Ordinary files and directories use `ShellExecuteExW` with literal Unicode paths and no command parameters.

## Security boundaries

- Strict single-pass UTF-8 URL decoding; malformed encoding, encoded separators, control characters, ambiguous Windows names, alternate data streams, and unsafe path forms are rejected.
- Final paths are limited to **259 UTF-16 code units**. Long paths are rejected, not truncated.
- DOS device mappings, symlinks, and junctions are checked before accessing targets. Network mappings, UNC targets, and unsupported reparse types fail closed.
- Checked target and ancestor handles remain leased until the system call returns. Ancestors deny write/delete sharing; file leaves permit read/write sharing but not deletion or replacement.
- Each production click verifies executable/source digests, link-click context, host binding, and the live pane/tab/workspace through the bound local named pipe. Failure does not fall back to remote endpoints or another pane.
- Digests detect stale or corrupted artifacts; they do not authenticate against same-account tampering.
- Restricted extensions are **not** content or association certification. Unknown associations, application content handling, and application networking remain outside the plugin's control.
- Herdr 0.9.5 does not provide signed click context or complete remote-pane identity. Same-account context forgery, forwarded local services, and remote output naming a local file cannot be fully distinguished. Use trusted local endpoints only.
- The plugin itself makes no external network requests and does not read directory listings or file contents. Associated applications and File Explorer retain their normal Windows behavior.

## Tests and manual checks

Run from the repository root:

```powershell
node --test tests/open-directory.test.js tests/local-context.test.js tests/native-helper.test.js tests/helper-session.test.js tests/native-click.test.js tests/native-pipe.test.js tests/relative-link.test.js

# A single test file or selected test:
node --test tests/open-directory.test.js
node --test --test-name-pattern="C# URL policy" tests/native-click.test.js

# Syntax check:
node --check src/open-directory.js
```

Automated tests do not open applications. They create and remove temporary files, directories, junctions, and configurations, and attempt renames to verify leases. Native tests require Windows; live Herdr integration tests also require local pane environment variables.

Windows CI runs Node.js 22 and 24 with pinned official Actions and read-only permissions. Hosted runners lack a bound local Herdr pane, so three integration tests are skipped. Temporary fixtures are canonicalized to handle Windows profile aliases.

Print manual OSC 8 links without opening anything:

```powershell
node scripts/emit-test-links.js README.md
node scripts/emit-test-links.js scripts/build-plugin.js
```

Ctrl+click to verify ordinary opening and script selection. Use the actual status-bar URL for redirected desktops. HTTP(S) links should keep their original behavior.

`scripts/integration-smoke.js <pane-id> --action` actually opens Desktop using synthetic context; `--activate` attempts a real terminal-link activation. Run these only when actual opening is intended. Synthetic invocation is not equivalent to a physical Ctrl+click.

### Release validation

For v0.4.1:

- Local suite: **154 passed, 0 failed, 0 skipped**.
- GitHub Windows CI: Node.js 22 and 24 succeeded; **151 passed, 3 integration tests skipped** per hosted environment.
- Fresh source without prebuilt executables/cache built successfully from a different process working directory.
- Actual GitHub installation ran the build and passed native integrity and live-pane validation. The existing binding remained unchanged and the installed plugin stayed enabled.
- Explorer selection was confirmed through real Shell selected-item state using synthetic click context. Physical Ctrl+click was not automated.

[Release](https://github.com/caolib/herdr-windows-directory-links/releases/tag/v0.4.1) · [Validated CI run](https://github.com/caolib/herdr-windows-directory-links/actions/runs/44513069441)

## Logs and troubleshooting

```powershell
herdr plugin log list --plugin local.windows-directory-links --limit 20
```

Logs use fixed error codes, without full target paths, MachineGuid, or click context:

- `helper_cache_invalid`: disable, inspect artifacts, and rebuild. Do not weaken system protections.
- `unbound_host`: inspect the host/executable/socket binding; do not automatically rebind.
- `unverified_pane`: the bound service did not verify the clicked pane identifiers.
- `unverified_cwd`: a relative link has no valid local working directory.
- `unsupported_reparse`: an unknown reparse-point type was rejected.
- `win32_1155`: an ordinary file has no Windows default association.
- `shell_select_failed`: Windows file selection failed; the plugin will not execute the file as a fallback.
- `not_found`: the resolved target does not exist.

Other failures include `invalid_context`, `invalid_url`, `unsafe_path`, `nonlocal_drive`, `path_too_long`, `access_denied`, `operation_timeout`, and `win32_<number>`. Successful logs mean Windows accepted the request, not that a window finished drawing.

## Layout

```text
src/                 JavaScript reference chain and helper management
  native/            C# production runtime, path policy, PowerShell compiler
scripts/             Build, configuration, and manual verification
tests/               Automated regression tests and fixtures
docs/                Publication guidance
herdr-plugin.toml    Herdr action, link handler, and build declarations
.build/              Local executable and digest sidecars; Git-ignored
.native-cache/       Content-addressed compilation cache; Git-ignored
```

The JavaScript reference chain remains directory-only and is not security-equivalent to the production C# chain. The production manifest invokes `.build/directory-links.exe --click` directly.

## Disable or remove

```powershell
herdr plugin disable local.windows-directory-links
# For a development link:
herdr plugin unlink local.windows-directory-links
```

Configuration lives in Herdr's plugin configuration directory, not the repository. Keep bindings private. The plugin does not leave background services or close your existing Explorer windows.

## References and license

- [Herdr plugin documentation](https://herdr.dev/tui/docs/plugins/)
- [Marketplace discovery](https://herdr.dev/tui/docs/marketplace/)
- [Herdr 0.9.5 plugin documentation](https://herdr.dev/docs/0.9.5/plugins/)
- [ShellExecuteExW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecuteexw)
- [SHOpenFolderAndSelectItems](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shopenfolderandselectitems)

[bagonyi/herdr-file-links](https://github.com/bagonyi/herdr-file-links) and [johntrandall/herdr-open-links](https://github.com/johntrandall/herdr-open-links) informed the system-opener and restricted-file design. Their code was reviewed read-only, not executed or copied.

Licensed under [MIT](LICENSE).
