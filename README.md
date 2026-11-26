# Codex 项目接力

在正在做项目的 Codex 桌面聊天里说 **“开个新对话”**，`handoff` 会创建一个新的侧边栏聊天。新聊天读回项目要求和中途更正，核对原工作目录，在理解工程后等待你的下一步指令。你也可以直接发送 `$handoff`。

A Codex desktop skill that hands a project to a fresh chat. The receiving chat reviews the project and waits for your next instruction before doing any project work.

## 安装

在 Codex 中发送以下指令，通过内置的技能安装器从本仓库安装。

```text
使用 $skill-installer 安装 https://github.com/hualuowuhenjian-cyber/codex-handoff/tree/v1.0.0/skills/handoff
```

也可以从 [GitHub Releases](https://github.com/hualuowuhenjian-cyber/codex-handoff/releases) 下载 `handoff.zip`。解压后，把整个 `handoff` 目录放到 `$CODEX_HOME/skills/`。使用默认配置时，Windows 安装路径为 `%USERPROFILE%\.codex\skills\handoff\SKILL.md`，macOS 和 Linux 对应 `~/.codex/skills/handoff/SKILL.md`。安装后重新打开 Codex，让它加载技能。

## 使用

1. 在已有项目聊天中发送“开个新对话”或“项目交接给新对话”。
2. 旧聊天整理目标、原始要求、关键更正、当前工作树及剩余事项，并将资料位置随首条消息交给新聊天。
3. 新聊天只读核对项目，说明目标、关键组件、当前进度和判断依据。若影响理解的关键信息缺失，它会先核实或说明缺口。
4. 新聊天确认理解并结束本轮后，旧聊天给出入口。后续要修改代码、运行测试或生成交付物时，在新聊天中下达指令。

交接使用 Codex 桌面端创建、读取和等待聊天的工具。新旧聊天需要能读取原工作目录与交接资料。附带的工作区核验脚本使用 Node.js，并在 Git 可用时核对分支、HEAD、暂存区指纹和选定文件的内容。普通目录也支持文件级核对。已在 Windows、Node.js 24 和 Git 环境下验证。

## 交接资料

每次交接的 `brief.md`、工作区清单和回执保存在双方可访问的本地目录。旧聊天保留供回查，原工作树的暂存和未暂存修改都保留在原处。可安装的技能文件位于 [skills/handoff](skills/handoff)。

## 开发与打包

从仓库根目录运行回归测试。测试使用 Node.js 内置的测试运行器，Git 用于构造临时工作树。

```sh
node --test tests/handoff.test.cjs
```

从已提交的技能目录生成安装包。解压后的顶层目录为 `handoff/`，其中包含技能入口、辅助脚本和许可证。

```sh
git archive --format=zip --output=handoff.zip HEAD:skills
```

本项目采用 [MIT 许可证](LICENSE)。
