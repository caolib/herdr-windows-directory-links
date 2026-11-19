# GitHub 发布与 Herdr 官方收录

已确认的发布目标：公开仓库 `caolib/herdr-windows-directory-links`，MIT 许可证，正式分支 `main`，首个版本 `0.4.1`。核验日期：2026-11-19。

## 发布基线

- 根目录保留 `herdr-plugin.toml`；源码在 `src/`、开发脚本在 `scripts/`、七个测试在 `tests/`。
- Windows 专用，Herdr ≥0.9.5；构建依赖 Node.js ≥22.1.0、Windows PowerShell 5.1 完整语言模式及现有执行策略允许本地 `.ps1`、.NET Framework 4.x。
- 生产入口是 `.build/directory-links.exe --click`，每次核实源码／exe 摘要、本机绑定、被点击 pane 及目标路径。
- 154 项本地自动化测试通过，0 失败、0 跳过；不带 exe／缓存的干净源码副本从不同 cwd 构建并通过完整点击校验。
- 合成点击通过生产 `--click` 入口，真实资源管理器选中构建脚本；通过 Shell 的选中项核实。未执行该脚本，绑定未变；这不是物理 Ctrl＋点击验收。
- Windows CI 覆盖 Node.js 22／24，官方 Actions 固定完整 commit SHA，只授予 `contents: read`，不持久化 Git 凭据、不缓存包管理器。托管 runner 缺少本机 Herdr pane 时集成项跳过，不能替代本地全部测试。
- `.build/`、`.native-cache/`、本机绑定、凭据和临时 agent worktree 不提交或随 Release 发布。

## 发布顺序

1. 补齐 MIT 许可证、公开安装说明、Windows CI；检查新增文件和 Git 历史，不上传凭据或 MachineGuid。
2. 审查、提交代码，建立 `main`；创建公开仓库，添加 `origin` 并推送，不使用强制推送。
3. 等待 GitHub CI，再从 GitHub 实际安装，确认 install 自动构建且完整点击校验成功。
4. 核实既有本机绑定，保持原来的启用状态；不自动删除或覆盖旧绑定。
5. 为通过验收的提交创建 `v0.4.1` tag／Release，版本与 manifest 一致。首版只发布源码，不附加本机 exe、缓存或绑定。
6. 添加 GitHub topic `herdr-plugin`，检查官方自动收录。Release／tag 不是收录硬性条件。

## GitHub 安装

官方命令接受 GitHub shorthand，而不是任意 URL：

```powershell
herdr plugin install caolib/herdr-windows-directory-links
```

- GitHub install 在用户确认后、注册前执行 `[[build]]`；构建失败中止安装。Herdr 不代装缺失工具链。
- 本地 `plugin link` 不执行 build，开发时先运行 `node scripts/build-plugin.js`。
- 同 ID 插件已经本地 link 时，先停用并解除本地 link，再做 GitHub 安装；解除链接不等于删除源码或本机绑定。
- build 不提供运行时点击 context／socket 环境，只编译，不运行 `configure-local.js`。
- 安装后进入结果中 `plugin_root` 指定的 Herdr 管理源码目录。在可信本地 pane 中取得 `herdr plugin config-dir local.windows-directory-links`，用 `scripts/configure-local.js` 首次绑定，再启用。
- 已有绑定先核验，仍有效则省略创建步骤；不能自动删除、覆盖或重新绑定。当前绑定包括 MachineGuid 哈希、Herdr exe 最终路径和 socket，不包含插件源码根目录。
- `--ref REF` 是固定 revision 参数；tag 的具体支持、更新后自动重编译和重装配置保留应以实际验收为准，不凭参数名推断。

## 官方自动收录

官方公开流程是 **GitHub topic 自动发现**，不是提交 registry PR 或审核申请。

1. 仓库公开，不能是 fork 或 archived。
2. GitHub 仓库添加 topic **`herdr-plugin`**。
3. **默认分支**包含有效 `herdr-plugin.toml`；本项目放在根目录即可。
4. 必需字段是 `id`、`name`、`version`、`min_herdr_version`；当前 manifest 已满足，且有 `platforms = ["windows"]`、描述、action、link handler 与 build。
5. 官方文档说明通常 30 分钟内刷新；默认分支 head 变化会重新扫描。一个仓库只生成一张卡片。
6. 在 [Herdr 官方插件列表](https://herdr.dev/plugins/) 核实卡片、Windows 标记和安装目标；添加 topic 只是满足发现条件，不能立即声称已收录。

官方没有人工提交／审核队列。目录属于自动发现的未审核列表，收录**不代表 Herdr 审查、认证或沙箱隔离插件代码**。

## 官方资料

- [插件开发、manifest 与安装](https://herdr.dev/tui/docs/plugins/)
- [Marketplace 自动发现](https://herdr.dev/tui/docs/marketplace/)
- [官方插件列表](https://herdr.dev/plugins/)
- [Herdr 0.9.5 插件文档](https://herdr.dev/docs/0.9.5/plugins/)
- [GitHub herdr-plugin topic](https://github.com/topics/herdr-plugin)
- [GitHub CLI 仓库创建](https://cli.github.com/manual/gh_repo_create)
- [GitHub CLI 仓库 topic 设置](https://cli.github.com/manual/gh_repo_edit)
- [官方 checkout Action](https://github.com/actions/checkout)
- [官方 setup-node Action](https://github.com/actions/setup-node)

## 执行范围

用户已授权本次公开仓库、MIT、提交推送及官方收录流程。源码仍需检查后公开；新仓库、不同许可或额外对外服务不在本次授权内。验证结果如实区分本地测试、合成点击、真实窗口、GitHub 安装、CI 和官方收录。
