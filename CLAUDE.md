# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目与开发命令

这是 Windows 本机 **Herdr TUI** 的 OSC 8 本地链接插件，不是 Herdr 桌面 mod 或 Claude Code 插件。Ctrl＋点击文件时使用系统默认应用，目录用资源管理器；常见程序、脚本、快捷方式及无扩展名文件在资源管理器中打开所在目录并选中文件，不执行。不修改状态栏、鼠标捕获或 HTTP(S) 处理。

以下命令和 README 示例均从本仓库根目录运行。源码在 `src/`（C#／编译器在 `src/native/`），开发工具在 `scripts/`，回归测试在 `tests/`；准备 GitHub 发布或官方收录时读 `docs/publishing.md`。

依赖：Windows 10/11、Herdr ≥0.9.5、.NET Framework 4.x。构建／配置／测试使用 Node.js ≥22.1.0 和 Windows PowerShell 5.1 完整语言模式；现有执行策略必须允许本地 `.ps1`。使用系统框架和 Node 内置模块，无 npm 依赖安装或独立 `.csproj` 构建流程。

```sh
# 编译 C# 并发布生产入口（原生测试也会按需构建）
node scripts/build-plugin.js

# 全部自动化测试，不打开应用窗口
node --test tests/open-directory.test.js tests/local-context.test.js tests/native-helper.test.js tests/helper-session.test.js tests/native-click.test.js tests/native-pipe.test.js tests/relative-link.test.js

# 单个文件／按名称运行单项测试
node --test tests/open-directory.test.js
node --test --test-name-pattern="C# URL policy" tests/native-click.test.js

# 单文件 JS 语法检查；没有独立 lint 命令
node --check src/open-directory.js
```

原生测试在非 Windows 平台跳过；真实绑定／pane API 测试还要求本地 Herdr pane 的 `HERDR_PANE_ID` 等环境。要验证全部测试，应从目标本地 pane 运行并检查跳过数量。

本地 `herdr plugin link` **不会执行 manifest build**，更新前手工构建；使用中的 exe 可能被 Windows 锁定，先停用并等待动作结束。首次启用、重新链接和日志命令见 `README.md`「构建与启用」「日志与排障」。`node scripts/configure-local.js <插件配置目录>` 排他创建 `local-host.json`，不覆盖旧绑定、不启用插件；socket／session／exe 路径变化后须检查旧绑定再明确重新配置。

手工链接夹具：`node scripts/emit-test-links.js README.md` 只打印链接。`scripts/integration-smoke.js <pane-id> --action` 会合成上下文并打开 Desktop，`--activate` 会激活真实链接；仅在用户明确要求实际打开验证时运行。普通 action invoke 不等于物理 Ctrl＋点击。安装与绑定必须使用可信本地 endpoint，不能从 SSH／转发会话初始化。

## 跨语言架构

**生产链路**：`herdr-plugin.toml` 将本地链接交给 `.build/directory-links.exe --click`；`windows-shell.cs` 分派到 `click-runtime.cs`，核验构建完整性、点击上下文、本机绑定和实时 pane，再通过 `directory-policy.cs` 解析目标并调用系统打开器。只有一个 .NET 进程，不启动 Node、PowerShell 或 Herdr CLI，不隐式编译。`--validate-click` 走相同检查但不打开窗口。

**通用文件策略与租约**：`DirectoryPolicy.WithResolvedLink` 逐级检查 DOS 设备映射及 symlink／junction，在访问 target 前确认本地性；保留已检查目标及祖先句柄至回调结束。祖先只共享读，生产叶节点允许读写共享供关联应用使用，但不共享删除权限。普通文件不按扩展名逐个放行；`RestrictedExtensions`／`CanOpenFile` 决定原始或最终文件是否只能定位，无扩展名文件同样定位，避免 Windows 隐式尝试可执行后缀。回调接收完整最终路径和 `selectFile` 标识；受限文件用 `ILCreateFromPathW`／`SHOpenFolderAndSelectItems`（单个完整 PIDL、`cidl=0`）打开父目录并选中文件，不执行、不拼 explorer 参数。COM 成功初始化后平衡清理，PIDL 用 COM task allocator 释放。普通文件／目录仍用 `ShellExecuteExW` 的 `open`／`explore`，`lpFile` 是 Unicode 字面路径，`lpParameters=NULL`。`--validate-click` 的 `action="select"` 仅表示计划动作，`opened=false` 不调用窗口 API。保持租约包围系统调用，避免解析后释放句柄再打开的替换竞态。旧 `WithResolved` 和 helper 模式仍只允许目录。

**JS 参考链路**：`open-directory.js` 保留 URL／上下文策略及可注入依赖的目录回归实现；`helper-session.js` 管理一次点击的短生命周期 helper，先请求 `facts`，用绑定的 Herdr exe 执行 `pane get`，再解析目录并请求 `open`／`validate`，最后关闭并回收子进程。生产 manifest 不使用此链路。JS 没有生产实现的完整设备映射／重解析类型判定、祖先租约或通用文件打开能力，不能视为安全能力等价。

**编译发布**：`src/native-helper.js` 按源码内容定位 `.native-cache/<摘要>`，仅缓存缺失时调用 `src/native/windows-shell.ps1`，通过系统 PowerShell `Add-Type` 编译自有 C#。`scripts/build-plugin.js` 将已校验缓存复制到 `.build`，写入 exe／源码摘要 sidecar；缓存或发布 exe 损坏时拒绝覆盖。绑定独立保存在 `HERDR_PLUGIN_CONFIG_DIR/local-host.json`，构建不修改它。

## 协议与安全约束

- manifest、C#、JS 的标识保持一致：插件 `local.windows-directory-links`、action `open-directory`、handler `local-directory`。要求 `invocation_source=link_click`，完整 URL 和 pane／tab／workspace 与环境一致。context 的 `focused_pane_id` 表示被点击 pane，不要求它仍处于焦点。
- 生产连接本机 `\\.\pipe\` 加绑定 socket 字符串，发送换行 JSON `pane.get`；响应必须匹配 request ID、`result.type=pane_info` 和三个 pane 标识。命名依赖 Herdr 0.9.5 Windows 映射，升级兼容性须验证，失败不改走 CLI／远程 endpoint。每次重验 `{version:1, host, binary, socket}`；host 为 MachineGuid 哈希，binary 为 exe 最终路径。
- helper `--session` 是 UTF-8 换行 JSON 两阶段协议：先 `facts`，再 `open`／`validate`，仅一个在途请求，EOF 结束。无参数模式是单次 JSON 请求；这些模式不执行完整点击上下文／绑定验证。
- 调整编译源码时，同步维护 `src/native-helper.js`、`scripts/build-plugin.js`、`ClickRuntime.SourceNames` 的摘要顺序：`src/native/windows-shell.cs → src/native/directory-policy.cs → src/native/click-runtime.cs → src/native/windows-shell.ps1`。这些文件变化后必须重新构建；exe 与 sidecar 保留在插件根目录下的发布目录。摘要仅检测陈旧／损坏，不抵抗同账户篡改。
- 接受无主机的 `file:///盘符:/...` 及相对本地文件／目录路径，严格解码一次，最终路径最多 259 个 UTF-16 单元。相对基准来自已验证 pane 的 `foreground_cwd`，缺失／为空才用 `cwd`；非法非空前台 cwd 不回退。只移除开头 `./`，拒绝父级遍历、根相对／UNC／盘符相对路径，不搜索或向上猜根目录。
- 受限类型判断不是文件内容或系统关联的安全认证；完整规则、Windows cwd 滞后及上游认证限制见 `README.md`「通用文件与相对路径」「安全边界」。修改 manifest 后需重新 `plugin link` 加载匹配规则。

测试分工：`native-click.test.js` 对照 C#／JS URL 策略并验证目录租约和完整点击链；`native-pipe.test.js` 覆盖响应协议和被点击 pane cwd；`relative-link.test.js` 覆盖通用类型、受限文件定位模式、路径拼接、文件／祖先租约和 manifest 匹配；`helper-session.test.js` 覆盖协议、超时及回收。测试会编译并创建／清理临时配置、文件、目录及 junction，租约测试会尝试重命名，并非只读操作。
