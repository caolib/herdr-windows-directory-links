# Windows Directory Links

Windows 本机 Herdr TUI 的本地链接插件：保留鼠标捕获，通过 **Ctrl＋点击** OSC 8 链接打开已有本地文件或目录。普通文件使用系统默认应用，目录使用资源管理器；常见程序／脚本／快捷方式打开所在目录并选中文件，不执行。支持 `file:///C:/...` 和按被点击 pane 工作目录解析的相对路径，不再使用文档扩展名允许列表。

不改变状态栏的样式、宽度或输出；点击目标来自完整 URI，与 `Desktop` 标签是否被截断无关。这不是 Herdr 桌面 mod 或 Claude Code 插件。

## 运行要求

- Windows 10/11、Herdr **0.9.5 或更新版本**，本机服务与本地 pane。
- .NET Framework 4.x；使用 Windows 自带框架，无第三方运行时包。
- **构建／配置／测试时**需要 Node.js ≥22.1.0、Windows PowerShell 5.1 完整语言模式，以及现有执行策略允许本地 `.ps1`；插件不绕过策略或提权。
- **点击时不需要启动 Node、PowerShell、Herdr CLI 或其他辅助进程**：Herdr 直接启动 `.build/directory-links.exe --click`，同一进程完成检查和系统调用。
- 源码目录可写入 `.native-cache`／`.build`；构建后日常点击只读取它们。
- Herdr `ui.mouse_capture` 已开启，终端实际输出 OSC 8 文件 URI。插件不修改 `FORCE_HYPERLINK` 或现有状态栏。

实测环境：Windows 11、Herdr 0.9.5、Node.js 24.14.1、Windows PowerShell 5.1。.NET 程序是本地编译的 C#，不是 NativeAOT；仍有 CLR 启动成本。

## 目录结构

```text
src/                 JS 参考链路与原生 helper 管理
  native/            C# 生产链路、路径策略与 PowerShell 编译器
scripts/             构建、本机配置与手工验证脚本
tests/               自动化回归测试
docs/                GitHub 发布与官方上架规划
herdr-plugin.toml    Herdr 生产入口及构建声明
.build/              本机发布产物，Git 忽略
.native-cache/       本机编译缓存，Git 忽略
```

源码和开发工具分层；发布入口仍是根目录下的 `.build/directory-links.exe`，不迁移本机绑定。GitHub 上传、首个 Release 与官方上架步骤见[发布计划](docs/publishing.md)。

## GitHub 安装

在满足上述工具链要求的 **Windows 本机 Herdr pane** 中安装：

```powershell
herdr plugin install caolib/herdr-windows-directory-links
herdr plugin disable local.windows-directory-links
$configDir = herdr plugin config-dir local.windows-directory-links
$pluginInfo = herdr plugin list --plugin local.windows-directory-links --json | ConvertFrom-Json
$pluginRoot = $pluginInfo.result.plugins[0].plugin_root
```

安装命令只打印摘要；通过列表 JSON 获取 Herdr 管理的实际源码根目录，不能使用原开发仓库。首次绑定后启用：

```powershell
node (Join-Path $pluginRoot 'scripts/configure-local.js') "$configDir"
herdr plugin enable local.windows-directory-links
```

安装会先运行 manifest build；Herdr 不代装工具链，也不自动创建本机绑定。缺少绑定时点击会拒绝。已有 `local-host.json` 时先核验旧绑定，仍有效则跳过配置，不能直接覆盖或删除。若同 ID 插件已通过本地 `plugin link` 注册，应先停用并 `plugin unlink local.windows-directory-links`，再安装；绑定不随源码发布。

官方列表通过 GitHub topic `herdr-plugin` 自动发现，**收录不代表官方安全审核**。MIT 许可证见 [LICENSE](LICENSE)。

## 构建与启用

以下命令从**本仓库根目录**运行；首次安装在目标**本地 Herdr pane**中执行：

```powershell
node scripts/build-plugin.js
# 注意：plugin link 不运行 manifest build，必须先手工构建。
herdr plugin link . --disabled
$configDir = herdr plugin config-dir local.windows-directory-links
node scripts/configure-local.js "$configDir"
herdr plugin enable local.windows-directory-links
herdr plugin action list --plugin local.windows-directory-links
```

`.` 指当前仓库根目录，也可改为可信的本机插件绝对路径。Herdr 工作目录是插件根目录，因而 manifest 的 `.build/directory-links.exe` 可以解析。GitHub 安装会运行声明的 `[[build]]`，本地 link 不会。

`scripts/configure-local.js` 显式记录本机 MachineGuid 的 SHA-256、Herdr exe 最终路径和固定 socket 到插件配置目录 `local-host.json`；不保存原始 MachineGuid，不启用插件、不覆盖旧绑定。它必须运行在可信本地 endpoint，不能在 SSH／转发会话执行。

更新源码或升级版本（包括 0.3.0 的链接匹配规则）：

```powershell
herdr plugin disable local.windows-directory-links
node scripts/build-plugin.js
herdr plugin link . --enabled
```

不更改有效本机绑定，不需重启 Herdr。构建会核实已有产物后重用／替换，不覆盖损坏的产物。正在使用的 exe 可能被 Windows 锁定，先等当前动作结束，再构建。

切换 session／socket／Herdr exe 最终路径后，先停用、检查并明确删除旧 `local-host.json`，再从目标本地 pane 重新配置。不复制绑定到远程机器。

## 通用文件与相对路径

0.4.0 不再使用文档扩展名允许列表，支持终端已经识别为 OSC 8 的本地文件／目录链接，例如：

```text
[本项目说明](README.md)
[打开 v25 整合版 DOCX](proposal/qcbm/output/report-v25-integrated.docx)
```

点击时先从已绑定本机服务查询被点击 pane，优先使用其 `foreground_cwd`，缺失／为空时使用 `cwd`，再拼接相对路径。支持 `/`、`\` 分隔符和开头 `./`；保留单次严格 URL 解码，拒绝 `..`、根相对路径、UNC、盘符相对路径及其他协议。不使用插件／Herdr 进程目录，不扫描磁盘或逐级向上猜根目录。工作目录不合法报 `unverified_cwd`，目标不存在报 `not_found`。绝对目标使用 `file:///盘符:/...`。

普通文件（如 Markdown、TXT、PDF、Office、图片或自定义扩展名）使用系统默认关联应用打开；没有关联或关联应用启动失败时返回系统错误，例如 `win32_1155`，不静默退回其他打开方式。目录使用资源管理器。

常见程序、脚本、快捷方式及宏文档（例如 `.exe`、`.cmd`、`.ps1`、`.js`、`.py`、`.lnk`、`.url`、`.docm`）打开最终文件所在目录并**选中该文件**，不执行；无扩展名文件同样处理，避免 Windows 自动尝试可执行后缀。原始路径或重解析后的最终路径任一受限即使用文件定位，扩展名大小写不敏感；完整名单以 `src/native/directory-policy.cs` 的 `RestrictedExtensions` 为准。不查询默认关联来放行脚本，即使 `.js` 的默认应用是 VS Code 也保持定位行为。目录即使叫 `folder.exe` 也正常浏览该目录。受限类型判断并不是内容或文件关联安全认证，未知类型的默认应用行为及应用内内容处理／联网不由插件控制。

0.4.1 使用 Windows `SHOpenFolderAndSelectItems` 定位文件，不拼接 `explorer /select` 命令。`--validate-click` 保留完整文件路径，并返回 `action="select"`、`opened=false`；这表示拟执行的定位方式，不表示已经打开窗口或选中文件。

Windows 下 Herdr 的实时 cwd 报告可能滞后；`cwd` 是 pane／workspace 报告的目录，并不保证等于 AI 会话后来切换的目录。使用 shell／agent 的工作目录集成保持一致；插件无法从相对链接本身推断遗漏的项目根目录。纯文本 Markdown 未被终端识别为链接时，插件也不会自行解析屏幕。

手工验证（只打印链接，参数对应目标本地 pane 下的已有文件／目录）：

```powershell
node scripts/emit-test-links.js README.md
```

更新时重新 `plugin link`，使 Herdr 加载新的相对链接匹配规则。普通单击不是插件触发事件；仍使用 Ctrl＋点击。

## 验证

自动化测试（不打开资源管理器或文档应用窗口）：

```powershell
node --test tests/open-directory.test.js tests/local-context.test.js tests/native-helper.test.js tests/helper-session.test.js tests/native-click.test.js tests/native-pipe.test.js tests/relative-link.test.js
```

保留 JS 目录参考实现用于 URL 策略对照／回归测试；生产 manifest 已不调用它，通用文件功能在 C# 实现。原生测试涵盖 URL/Unicode、盘符根目录、本地／UNC junction、本机绑定、实际 pane 查询、管道响应分块／错误／截断和不一致 ID，以及相对路径拼接、cwd 优先级／缺失、普通类型与自定义扩展名、受限类型的完整路径与选中模式、目标／祖先租约及旧 helper 目录限制。只验证、不打开应用；测试创建并清理临时文件、目录、junction 和配置。

在本地 shell pane 中显示手工测试链接：

```powershell
node scripts/emit-test-links.js
```

Ctrl＋点击 `Desktop`、截短标签及盘符根目录。夹具默认主目录下 Desktop；重定向桌面以真实状态栏 URI 为准，不依赖固定用户名或桌面绝对路径。调整窗口宽度再次验证原状态栏；HTTP(S) 仍由原逻辑处理。

不要用普通 `herdr plugin action invoke` 当作真实点击测试：缺失来源字段会被拒绝。合成 API smoke **会打开 Desktop**，仅在明确需要真实打开验证时运行：

```powershell
node scripts/integration-smoke.js <pane-id> --action
```

它是注入合成上下文测试，不是物理 Ctrl＋点击。`--activate` 尝试从终端坐标定位真实 OSC 8；没有区域时拒绝，不退回合成上下文。

## 安全边界

- 匹配 `file://` 及相对文件／目录链接。文件 URI 只接受无主机的 `file:///盘符:/...`；不接管 HTTP(S)、其他协议或裸绝对路径。
- 编码仅解一次，严格 UTF-8；拒绝错误百分号编码、代理项、编码分隔符、控制字符、双向方向覆盖／标记、凭据、查询串、片段和主机（包括 `localhost`）。保留合法 ZWJ／ZWNJ／组合 emoji。
- 最终目标必须是本地磁盘文件或目录；拒绝 UNC、设备路径、网络盘、备用数据流、Windows 保留名称、点段、尾随点／空格等歧义路径，相对路径仅允许移除开头 `./`。解码及最终路径均最多 **259 个 UTF-16 字符**，不截断、不声称支持长路径。
- 逐级以 `OPEN_REPARSE_POINT` 读取元数据及 symlink／junction 的实际 target，先核实 target 本地性，再访问目标；未知 reparse 类型 fail closed。查询 DOS 设备映射，拒绝网络映射并核实 SUBST 目标。
- 普通文件按系统关联打开；原始或最终文件名的扩展名受限时打开最终文件的父目录并选中文件，不执行。无扩展名文件同样定位；目录不按后缀限制。插件不读取或验证文件内容，受限后缀名单并不声称识别所有恶意内容或未知关联。
- 检查官方 `focused_pane_id`／`tab_id`／`workspace_id` 与 env 一致。链接 context 实际填被点击 pane，不要求其现在仍 focused。
- 每次重新核实 MachineGuid 哈希、绑定 socket 和 Herdr exe realpath；直接调用固定**本机** named pipe 的 `pane.get`，匹配 request ID、响应类型与 pane／tab／workspace，失败不降级。不使用 CLI 的远程参数，不新建 SSH 转发。
- Windows Herdr 0.9.5 pipe 名是 `\\.\pipe\` 加原 socket 字符串。因为 .NET Framework 字符串构造器拒绝其中的盘符冒号，使用 Win32 打开准确本机 pipe，再包为 .NET 异步流。连接／读写最多 5 秒，整个动作 15 秒超时；无后台服务或轮询。
- 构建时使用可信系统 PowerShell 编译自有源码。源码地址缓存 `.native-cache`，发布入口 `.build/directory-links.exe`；直接入口每次核实 exe 和源码 SHA-256，损坏或源码更新而未构建则拒绝，不暗中编译。摘要用于完整性／陈旧版本检测，不是抗同账户篡改认证。
- 路径不进入命令文本／argv，不使用 shell、`cmd /c start`、`Invoke-Expression` 或环境变量展开。直接 `ShellExecuteExW`：目录用 `explore`、普通文件用 `open`，`lpFile` 为完整 Unicode 字面路径、`lpParameters=NULL`。受限文件通过 `ILCreateFromPathW` 生成完整 PIDL，`SHOpenFolderAndSelectItems` 以 `cidl=0`、空子项数组、`dwFlags=0` 打开父目录并选中；平衡 COM 初始化并释放 PIDL。两种方式均避免 explorer 逗号开关解析，保留 `%`、`,`、括号、`&`，引号属于非法文件名而拒绝。
- 已校验目标及祖先句柄一直保持到系统调用结束，不在 Resolve／Open 之间释放。祖先仅共享读，生产叶节点允许读写共享供关联应用使用，但不共享删除权限，回归测试验证文件可被读写打开且目标和父目录不能重命名。最终打开使用 `OPEN_REPARSE_POINT`，拒绝意外重解析点，不先跟入 UNC。租约不是文件内容认证；同账户篡改源码／环境／绑定、内容修改、系统级干预和 ShellExecuteExW 返回后的行为不属于认证保证。
- **上游限制**：Herdr 0.9.5 没有 machine／remote pane 字段或点击签名，API 允许自定义 context，本机 pipe 也能被转发。不能识别同账户完整伪造上下文、本地 pane 内手工 SSH 输出的远程同名路径、或远程客户端控制已绑定服务。绑定必须在可信本地 endpoint 初始化；不要点击这类远程路径。这是明确缩小的支持范围，不声称补上上游认证。
- 无常驻服务、外网请求或目录内容读取；只读取必要目录元数据、本机标识和本地 Herdr 状态。资源管理器自身正常系统行为不由插件限制。
- 跨插件匹配优先级不保证；不要同时启用另一套 `file://` handler。未引入重复点击防抖，避免误吞正常点击。

## 日志与排障

```powershell
herdr plugin log list --plugin local.windows-directory-links --limit 20
```

stderr 仅固定代码：`invalid_context`、`invalid_url`、`unsafe_path`、`nonlocal_drive`、`not_directory`、`not_found`、`access_denied`、`unbound_host`、`unverified_pane`、`unverified_cwd`、`unsupported_file`、`helper_cache_invalid`、`unsupported_reparse`、`shell_select_failed`、`operation_timeout` 或 `win32_<编号>`。不输出完整路径、MachineGuid、环境或上下文。成功只表示系统接受打开／定位请求，日志耗时不是窗口绘制耗时。

- 没有日志：检查启用、鼠标捕获、OSC 8 输出和插件冲突。
- 启动失败／`helper_cache_invalid`：先停用并运行 `scripts/build-plugin.js`，查看产物是否存在／陈旧／损坏；不调整杀毒软件或执行策略。
- `unbound_host`：核实固定 socket／session／exe，不能自动重绑。
- `unverified_pane`：pane 已关闭、绑定 endpoint 不响应或数据不匹配；不退回当前 pane。
- `unsupported_reparse`：未知重解析点类型主动拒绝，可能涉及云目录／卷挂载，不声称普遍支持。
- `unverified_cwd`：相对目标缺乏合法本地工作目录；核实被点击 pane 的 cwd 集成，不使用插件目录兜底。
- `win32_1155`：普通文件没有系统默认关联；在 Windows 中设置该类型的默认应用后重试。
- 受限类型及无扩展名文件打开所在目录并选中属于既定行为，不是关联失败；程序／脚本／快捷方式不会由插件执行。
- `shell_select_failed`：Windows 文件定位 API 失败；不退回执行文件，也不自动改用命令行打开。
- 网络路径和长路径拒绝不是性能错误。

## 停用与移除

```powershell
herdr plugin disable local.windows-directory-links
# 或只取消注册，保留源码：
herdr plugin unlink local.windows-directory-links
```

停用后可检查并清理 `.native-cache`／`.build`；重新使用需手工构建。`local-host.json` 在 Herdr 插件配置目录，取消链接后可自行查看并删除。不留后台进程，不关闭用户已有资源管理器窗口，不改状态栏。

## 验证记录

2026-11-19：用户确认真实 Ctrl＋点击可用。最初每次三次 PowerShell，约 2～3 秒；第一轮编译辅助 exe 后 618～744 ms；复用一次辅助进程后 444～529 ms。

0.2.0：Herdr 直接调用单个 .NET 程序，不再在点击时启动 Node、PowerShell、Herdr CLI；**119 项测试通过，0 失败、0 跳过**。已在本机重注册启用，保留有效绑定，合成打开 Desktop 成功，日志 `plugin-log-16/17/18` 分别 **462／396／489 ms**；无窗口完整校验 323～349 ms。与上一版区间有重叠，不能声称大幅提速。架构简化不等于窗口加载耗时必然大幅下降；特殊字符目录的真实打开、窗口缩放及停用回退未完全验收。

0.2.1：复核发现 Resolve 后释放句柄再打开的竞态，已改为保留已校验目录／祖先句柄至打开完成，并让最后打开不跟随重解析点。实际回归验证目标和父目录不能在期间被重命名；119 项测试全部通过（0 失败、0 跳过）。已恢复启用，`plugin-log-19` 成功、退出码 0，耗时 **420 ms**。

0.3.0：新增相对 DOCX 路径识别及按已验证 pane cwd 拼接，保留目录处理。154 项自动化测试通过（0 失败、0 跳过），包括完整管道点击校验、允许列表和 DOCX／父目录租约。已重新链接并启用，确认本机绑定字节未改变；真实 pane 的相对 DOCX 校验成功，辅助程序从不同工作目录启动仍解析到正确目标。未打开文档应用或进行真实 Ctrl＋点击验收。

0.4.0：改为通用文件／目录处理，不再按文档扩展名逐个放行。普通文件用系统默认应用，常见程序／脚本／快捷方式、宏文档及无扩展名文件仅浏览所在目录。153 项自动化测试通过（0 失败、0 跳过），包括普通／自定义扩展名、受限类型父目录处理及旧目录 helper 限制。已重新链接并保持启用，本机绑定字节未变；真实 pane 的相对 `README.md` 校验成功，未启动默认应用或进行真实鼠标点击验收。

0.4.1：受限文件及无扩展名文件改为在资源管理器中打开父目录并选中文件，保持脚本不执行策略。154 项自动化测试通过（0 失败、0 跳过），包括完整文件路径／定位模式、原始或最终后缀受限、特殊字符、文件／祖先租约及完整管道链。已重新构建、链接并保持启用，本机绑定字节未变；真实 pane 的相对／绝对 `build-plugin.js` 校验成功（`action="select"`、`opened=false`），程序从不同工作目录启动仍解析到正确目标。未进行资源管理器窗口选中或物理 Ctrl＋点击验收。

目录整理：源码／原生实现迁入 `src/`／`src/native/`，开发工具迁入 `scripts/`，七个测试迁入 `tests/`，发布规划放在 `docs/`；manifest、构建输出与本机绑定位置保持不变。迁移后 154 项测试全部通过（0 失败、0 跳过）；干净源码副本在没有 exe／缓存、进程 cwd 不同的情况下完成构建，并通过真实 pane 的完整校验。已重新链接并保持启用，绑定字节未变；未打开窗口，尚未进行 GitHub 安装验收。

发布准备验收：使用真实本机绑定与 pane，向生产 `--click` 入口提供合成点击上下文，资源管理器成功选中 `scripts/build-plugin.js`；通过 Shell 的实际选中项核实，不执行该脚本，不关闭已有窗口，绑定字节未变。这不是物理 Ctrl＋点击验收。CI 使用 Windows Server 2022 与 Node.js 22／24，官方 Actions 固定完整 commit SHA、只读权限，无 npm 依赖或本机绑定上传；托管环境缺少本地 Herdr pane 时相关集成测试会跳过。

## 参考与借鉴

- [Herdr 插件文档](https://herdr.dev/tui/docs/plugins/)、[build 时机：local link 不运行 build](https://herdr.dev/docs/0.9.5/plugins/)
- [0.9.5 context 定义](https://github.com/herdrdev/herdr/blob/v0.9.5/src/api/schema/plugins.rs#L353-L395)、[点击构造](https://github.com/herdrdev/herdr/blob/v0.9.5/src/app/api/plugins/context.rs#L323-L378)、[环境映射](https://github.com/herdrdev/herdr/blob/v0.9.5/src/app/api/plugins/runtime.rs#L39-L80)
- [PaneInfo](https://github.com/herdrdev/herdr/blob/v0.9.5/src/api/schema/panes.rs#L448-L491)、[Windows IPC](https://github.com/herdrdev/herdr/blob/v0.9.5/src/ipc.rs#L35-L50)、[context 非认证](https://github.com/herdrdev/herdr/blob/v0.9.5/src/app/api/plugins/context.rs#L5-L28)
- [ShellExecuteExW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecuteexw)、[SHELLEXECUTEINFOW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfow)、[GetDriveTypeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew)、[GetFinalPathNameByHandleW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew)
- [SHOpenFolderAndSelectItems](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shopenfolderandselectitems)、[ILCreateFromPathW](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-ilcreatefrompathw)、[CoInitializeEx](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-coinitializeex)、[CoUninitialize](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-couninitialize)
- [bagonyi/herdr-file-links](https://github.com/bagonyi/herdr-file-links/blob/main/open_file_link.py)：借鉴系统打开器、参数隔离和危险文件不执行的思想。
- [johntrandall/herdr-open-links](https://github.com/johntrandall/herdr-open-links/blob/main/open-url.sh)：借鉴短启动链路，不照搬通用协议放行或宽松文件打开；其 macOS 防抖没有引入。

参考插件仅只读核对，未执行下载代码；本实现为独立编写，没有复制其代码。
