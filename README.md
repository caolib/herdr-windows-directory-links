# Windows Directory Links

Windows 本机 Herdr TUI 的目录链接插件：保留鼠标捕获，通过 **Ctrl＋点击** OSC 8 `file:///C:/...` 链接在资源管理器中打开已有目录。

不改变状态栏的样式、宽度或输出；点击目标来自完整 URI，与 `Desktop` 标签是否被截断无关。这不是 Herdr 桌面 mod 或 Claude Code 插件。

## 运行要求

- Windows 10/11、Herdr **0.9.5 或更新版本**，本机服务与本地 pane。
- .NET Framework 4.x；使用 Windows 自带框架，无第三方运行时包。
- **构建／配置／测试时**需要 Node.js ≥22.1.0、Windows PowerShell 5.1 完整语言模式，以及现有执行策略允许本地 `.ps1`；插件不绕过策略或提权。
- **点击时不需要启动 Node、PowerShell、Herdr CLI 或其他辅助进程**：Herdr 直接启动 `.build/directory-links.exe --click`，同一进程完成检查和系统调用。
- 源码目录可写入 `.native-cache`／`.build`；构建后日常点击只读取它们。
- Herdr `ui.mouse_capture` 已开启，终端实际输出 OSC 8 文件 URI。插件不修改 `FORCE_HYPERLINK` 或现有状态栏。

实测环境：Windows 11、Herdr 0.9.5、Node.js 24.14.1、Windows PowerShell 5.1。.NET 程序是本地编译的 C#，不是 NativeAOT；仍有 CLR 启动成本。

## 构建与启用

首次安装，在仓库根目录和目标**本地 Herdr pane**中执行：

```powershell
node windows-directory-links/build-plugin.js
# 注意：plugin link 不运行 manifest build，必须先手工构建。
herdr plugin link C:/code/herdr-plugins/windows-directory-links --disabled
$configDir = herdr plugin config-dir local.windows-directory-links
node windows-directory-links/configure-local.js "$configDir"
herdr plugin enable local.windows-directory-links
herdr plugin action list --plugin local.windows-directory-links
```

替换为实际插件绝对路径。Herdr 工作目录是插件根目录，因而 manifest 的 `.build/directory-links.exe` 可以解析。GitHub 安装会运行声明的 `[[build]]`，本地 link 不会。

`configure-local.js` 显式记录本机 MachineGuid 的 SHA-256、Herdr exe 最终路径和固定 socket 到插件配置目录 `local-host.json`；不保存原始 MachineGuid，不启用插件、不覆盖旧绑定。它必须运行在可信本地 endpoint，不能在 SSH／转发会话执行。

更新源码或从 0.1.0 升级到 0.2.0：

```powershell
herdr plugin disable local.windows-directory-links
node windows-directory-links/build-plugin.js
herdr plugin link C:/code/herdr-plugins/windows-directory-links --enabled
```

不更改有效本机绑定，不需重启 Herdr。构建会核实已有产物后重用／替换，不覆盖损坏的产物。正在使用的 exe 可能被 Windows 锁定，先等当前动作结束，再构建。

切换 session／socket／Herdr exe 最终路径后，先停用、检查并明确删除旧 `local-host.json`，再从目标本地 pane 重新配置。不复制绑定到远程机器。

## 验证

自动化测试（不打开资源管理器窗口）：

```powershell
node --test windows-directory-links/open-directory.test.js windows-directory-links/local-context.test.js windows-directory-links/native-helper.test.js windows-directory-links/helper-session.test.js windows-directory-links/native-click.test.js windows-directory-links/native-pipe.test.js
```

保留 JS 参考实现用于策略对照／回归测试；生产 manifest 已不调用它。原生测试涵盖 URL/Unicode、盘符根目录、本地 junction、UNC junction 拒绝、文件／脚本拒绝、本机绑定、实际 pane 查询、管道响应分块／错误／截断和不一致 ID。单元测试只调用 validate，临时文件和配置清理。

在本地 shell pane 中显示手工测试链接：

```powershell
node C:/code/herdr-plugins/windows-directory-links/emit-test-links.js
```

Ctrl＋点击 `Desktop`、截短标签及盘符根目录。夹具默认主目录下 Desktop；重定向桌面以真实状态栏 URI 为准。本机目标 `C:\Users\caolib\Desktop`。调整窗口宽度再次验证原状态栏；HTTP(S) 仍由原逻辑处理。

不要用普通 `herdr plugin action invoke` 当作真实点击测试：缺失来源字段会被拒绝。合成 API smoke **会打开 Desktop**，仅在明确需要真实打开验证时运行：

```powershell
node windows-directory-links/integration-smoke.js <pane-id> --action
```

它是注入合成上下文测试，不是物理 Ctrl＋点击。`--activate` 尝试从终端坐标定位真实 OSC 8；没有区域时拒绝，不退回合成上下文。

## 安全边界

- 只匹配 `file://`。只接受无主机的 `file:///盘符:/...`；不接管 HTTP(S)、其他协议或裸路径。
- 编码仅解一次，严格 UTF-8；拒绝错误百分号编码、代理项、编码分隔符、控制字符、双向方向覆盖／标记、凭据、查询串、片段和主机（包括 `localhost`）。保留合法 ZWJ／ZWNJ／组合 emoji。
- 只允许本地磁盘绝对目录；拒绝 UNC、设备路径、网络盘、备用数据流、Windows 保留名称、点段、尾随点／空格等歧义路径。解码及最终路径均最多 **259 个 UTF-16 字符**，不截断、不声称支持长路径。
- 逐级以 `OPEN_REPARSE_POINT` 读取元数据及 symlink／junction 的实际 target，先核实 target 本地性，再访问目标；未知 reparse 类型 fail closed。查询 DOS 设备映射，拒绝网络映射并核实 SUBST 目标。
- 只打开目录，普通文件、`.exe`、`.bat`、`.ps1`、`.lnk` 均不执行或打开。若目录名称有这些后缀，也只是浏览目录。
- 检查官方 `focused_pane_id`／`tab_id`／`workspace_id` 与 env 一致。链接 context 实际填被点击 pane，不要求其现在仍 focused。
- 每次重新核实 MachineGuid 哈希、绑定 socket 和 Herdr exe realpath；直接调用固定**本机** named pipe 的 `pane.get`，匹配 request ID、响应类型与 pane／tab／workspace，失败不降级。不使用 CLI 的远程参数，不新建 SSH 转发。
- Windows Herdr 0.9.5 pipe 名是 `\\.\pipe\` 加原 socket 字符串。因为 .NET Framework 字符串构造器拒绝其中的盘符冒号，使用 Win32 打开准确本机 pipe，再包为 .NET 异步流。连接／读写最多 5 秒，整个动作 15 秒超时；无后台服务或轮询。
- 构建时使用可信系统 PowerShell 编译自有源码。源码地址缓存 `.native-cache`，发布入口 `.build/directory-links.exe`；直接入口每次核实 exe 和源码 SHA-256，损坏或源码更新而未构建则拒绝，不暗中编译。摘要用于完整性／陈旧版本检测，不是抗同账户篡改认证。
- 路径不进入命令文本／argv，不使用 shell、`cmd /c start`、`Invoke-Expression` 或环境变量展开。直接 `ShellExecuteExW` 的 `explore`，`lpFile` 为完整 Unicode 字面目录、`lpParameters=NULL`；避免 explorer 逗号开关解析，保留 `%`、`,`、括号、`&`，引号属于非法文件名而拒绝。
- 0.2.1 将已校验目录及祖先句柄一直保持到系统打开结束，不再在 Resolve／Open 之间释放。使用目录读权限与只共享读，使 Windows 拒绝这段时间的重命名／删除替换；不读取目录条目。最终打开使用 `OPEN_REPARSE_POINT`，拒绝意外重解析点，不先跟入 UNC。回归测试实际验证目标和父目录重命名被阻止。本机同账户篡改源码／环境／绑定、系统级干预和 ShellExecuteExW 返回后的行为仍不属于认证保证。
- **上游限制**：Herdr 0.9.5 没有 machine／remote pane 字段或点击签名，API 允许自定义 context，本机 pipe 也能被转发。不能识别同账户完整伪造上下文、本地 pane 内手工 SSH 输出的远程同名路径、或远程客户端控制已绑定服务。绑定必须在可信本地 endpoint 初始化；不要点击这类远程路径。这是明确缩小的支持范围，不声称补上上游认证。
- 无常驻服务、外网请求或目录内容读取；只读取必要目录元数据、本机标识和本地 Herdr 状态。资源管理器自身正常系统行为不由插件限制。
- 跨插件匹配优先级不保证；不要同时启用另一套 `file://` handler。未引入重复点击防抖，避免误吞正常点击。

## 日志与排障

```powershell
herdr plugin log list --plugin local.windows-directory-links --limit 20
```

stderr 仅固定代码：`invalid_context`、`invalid_url`、`unsafe_path`、`nonlocal_drive`、`not_directory`、`not_found`、`access_denied`、`unbound_host`、`unverified_pane`、`helper_cache_invalid`、`unsupported_reparse`、`operation_timeout` 或 `win32_<编号>`。不输出完整路径、MachineGuid、环境或上下文。成功只表示系统接受打开，日志耗时不是窗口绘制耗时。

- 没有日志：检查启用、鼠标捕获、OSC 8 输出和插件冲突。
- 启动失败／`helper_cache_invalid`：先停用并运行 `build-plugin.js`，查看产物是否存在／陈旧／损坏；不调整杀毒软件或执行策略。
- `unbound_host`：核实固定 socket／session／exe，不能自动重绑。
- `unverified_pane`：pane 已关闭、绑定 endpoint 不响应或数据不匹配；不退回当前 pane。
- `unsupported_reparse`：未知重解析点类型主动拒绝，可能涉及云目录／卷挂载，不声称普遍支持。
- 网络路径、长路径和普通文件拒绝不是性能错误。

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

## 参考与借鉴

- [Herdr 插件文档](https://herdr.dev/tui/docs/plugins/)、[build 时机：local link 不运行 build](https://herdr.dev/docs/0.9.5/plugins/)
- [0.9.5 context 定义](https://github.com/herdrdev/herdr/blob/v0.9.5/src/api/schema/plugins.rs#L353-L395)、[点击构造](https://github.com/herdrdev/herdr/blob/v0.9.5/src/app/api/plugins/context.rs#L323-L378)、[环境映射](https://github.com/herdrdev/herdr/blob/v0.9.5/src/app/api/plugins/runtime.rs#L39-L80)
- [PaneInfo](https://github.com/herdrdev/herdr/blob/v0.9.5/src/api/schema/panes.rs#L448-L491)、[Windows IPC](https://github.com/herdrdev/herdr/blob/v0.9.5/src/ipc.rs#L35-L50)、[context 非认证](https://github.com/herdrdev/herdr/blob/v0.9.5/src/app/api/plugins/context.rs#L5-L28)
- [ShellExecuteExW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecuteexw)、[SHELLEXECUTEINFOW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfow)、[GetDriveTypeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew)、[GetFinalPathNameByHandleW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew)
- [bagonyi/herdr-file-links](https://github.com/bagonyi/herdr-file-links/blob/main/open_file_link.py)：借鉴系统打开器、参数隔离和危险文件不执行的思想。
- [johntrandall/herdr-open-links](https://github.com/johntrandall/herdr-open-links/blob/main/open-url.sh)：借鉴短启动链路，不照搬通用协议放行或宽松文件打开；其 macOS 防抖没有引入。

参考插件仅只读核对，未执行下载代码；本实现为独立编写，没有复制其代码。
