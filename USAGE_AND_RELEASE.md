# Project Blueprint 使用与发布指南（A/B 两套方案）

本文档用于：

- **A 方案**：你先自用（本地打包 `.vsix` 安装），适合个人/团队内分发
- **B 方案**：后续发布到 **VS Code Marketplace**（需要 publisher + Token）

> 说明：本扩展的“目录设计”仅维护 **内存树结构**，不会创建/删除真实文件。导出时只会在你右键的文件夹下生成 `blueprint*.md`。

---

## 功能使用（日常）

### 打开方式

- 在 VS Code 资源管理器中 **右键某个文件夹**
- 选择：`在蓝图中打开`

### 直接生成项目蓝图（跳过 Webview）

- 在 VS Code 资源管理器中 **右键某个文件夹**
- 选择：`生成项目蓝图`
- 会直接在该文件夹根目录生成 `blueprint*.md` 并自动打开

> 说明：该方式导出的是“扫描到的真实目录结构快照”（不包含 Webview 内的编辑结果）。

### Webview 快捷键

在蓝图 Webview 内：

- **Enter**：新建文件夹（同级）
- **Tab**：新建文件（子级）；根节点 Tab 已禁用
- **F2 / 双击**：重命名（输入框会自动全选）
- **Delete / Backspace**：删除选中节点（一次只删一个）
- **Ctrl+Z / Ctrl+Y**：撤销 / 重做
- **Ctrl+S**：导出 Markdown（等价于点击“导出为 Markdown”按钮）

### 导出说明

- 导出文件位置：**你右键打开蓝图的那个文件夹目录**
- 文件名：优先 `blueprint.md`，如果已存在会生成 `blueprint-1.md`、`blueprint-2.md`...
- 导出内容：Linux `tree` 风格的 ASCII 目录树（纯文本，不包含 ``` 代码块包裹）

---

## A 方案：本地自用（打包 `.vsix` 安装）

### 适用场景

- 你想先自用一段时间
- 或团队内部共享（把 `.vsix` 放到内网/网盘分发）

### 前置条件

- 已安装 Node.js（建议 18+）
- 能在项目目录运行 npm

### 1) 构建

在 `project-blueprint` 目录下：

> 注意：必须在包含扩展 `package.json` 的目录执行命令（也就是本仓库的 `project-blueprint/` 目录）。
> 如果你在上一级目录执行，会出现：`Extension manifest not found: ...\\package.json`

- `npm install`
- `npm run compile`

### 2) 打包 `.vsix`

推荐使用 `vsce`：

> 同样需要在 `project-blueprint/` 目录执行。

- `npx @vscode/vsce package`

打包完成后，会在当前目录生成类似：

- `project-blueprint-0.0.1.vsix`

### 3) 本地安装

在 VS Code 中：

- 打开 Extensions 面板
- 右上角 `...`
- `Install from VSIX...`
- 选择生成的 `.vsix`

### 4) 版本管理（自用推荐做法）

每次你想更新安装包：

- 修改 `package.json` 的 `version`
- 重新 `npm run compile`
- 再 `npx @vscode/vsce package`
- 重新安装新的 `.vsix`

---

## B 方案：发布到 VS Code Marketplace

### 适用场景

- 你希望公开发布
- 或者需要 Marketplace 的自动更新体验

### 0) 发布前准备清单（建议）

- **完善 README**：功能说明、截图、快捷键
- **完善 CHANGELOG**：每个版本的变更
- **补充 License**：例如 MIT（如需）
- **补充 icon / repository**（可选但推荐）
- 检查 `package.json`：
  - `name` / `displayName`
  - `publisher`
  - `version`（遵循语义化：1.0.0、1.0.1...）
  - `engines.vscode`

### 1) 注册 Publisher

到 Marketplace 创建 publisher：

- https://marketplace.visualstudio.com/

### 2) 创建 Personal Access Token (PAT)

在 Azure DevOps 创建 PAT（发布扩展需要）：

- 需要包含 Marketplace 发布相关权限（按官方说明勾选）

### 3) 登录 vsce

在项目目录：

- `npx @vscode/vsce login <你的publisher>`

按提示输入 token。

### 4) 发布

- `npx @vscode/vsce publish`

或指定版本增量：

- `npx @vscode/vsce publish patch`（+0.0.1）
- `npx @vscode/vsce publish minor`（+0.1.0）
- `npx @vscode/vsce publish major`（+1.0.0）

---

## 常见问题（FAQ）

### 1) 为什么导出不会创建真实文件夹/文件？

本扩展定位为“目录结构设计器”，为了安全和可控，所有操作都发生在 Webview 的内存树上；导出只生成一份 Markdown 结构快照。

### 2) 快捷键会不会和其它插件冲突？

Webview 内部通过 JS 捕获按键并 `preventDefault()`，通常不会影响编辑器全局快捷键；若遇到冲突，建议用 VS Code 的快捷键诊断（Keyboard Shortcuts Troubleshooting）定位。
