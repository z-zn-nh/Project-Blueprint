# Project Blueprint 代码导读（按文件 + 按函数）

本文档是对 **Project Blueprint** 扩展的“全量代码导读”。目标是让你后续能按图索骥：

- 明白 VS Code 是如何加载扩展、如何触发命令
- 明白扩展端（Extension Host）与 Webview 端分别负责什么
- 明白扫描目录、内存树结构、快捷键编辑、撤销重做、导出 Markdown 的完整链路

---

## 0. 总体架构（先理解分层）

本扩展分两层：

- **扩展端（Extension Host）**：负责扫描真实文件夹、创建 Webview、接收 Webview 消息、导出 Markdown 写文件
- **Webview 端（UI/交互层）**：负责展示树、键盘交互编辑、撤销重做、把最终 treeState 回传给扩展端

核心原则：

- **编辑只发生在内存树上，不改真实文件**
- **导出是扩展端写 Markdown 文件到“右键选中的文件夹”目录**

---

## 1) `project-blueprint/package.json`（扩展清单/manifest）

这是 VS Code 和 `vsce` 打包时最重要的文件：

- **扩展是谁**：`name` / `displayName` / `version`
- **扩展入口在哪**：`main`（通常指向编译后的 JS）
- **扩展什么时候激活**：`activationEvents`
- **扩展提供哪些命令/菜单**：`contributes.commands` / `contributes.menus`
- **最低兼容 VS Code 版本**：`engines.vscode`

### 关键字段说明

#### `main: "./dist/extension.js"`

- **作用**：告诉 VS Code，扩展实际运行入口是哪个 JS 文件
- **来源**：由 `webpack` 把 `src/extension.ts` 打包输出到 `dist/extension.js`

#### `contributes.commands`

- **作用**：声明命令，让命令面板/菜单能看到
- 例如：
  - `project-blueprint.openInBlueprint`
  - `project-blueprint.helloWorld`

#### `contributes.menus["explorer/context"]`

- **作用**：把命令挂到资源管理器右键菜单
- `when: "explorerResourceIsFolder"`：确保只对“文件夹”显示

#### `activationEvents`

- **作用**：决定扩展何时被加载
- 你现在的用法：
  - `onStartupFinished`：VS Code 启动完成后激活
  - `onCommand:...`：执行命令时激活

#### `engines.vscode` 与 `@types/vscode`

- `engines.vscode`：用户最低 VS Code 版本
- `@types/vscode`：你编译时的 API 类型定义
- 打包工具 `vsce` 会检查两者是否对齐；一般推荐：
  - **`@types/vscode` 不要高于 `engines.vscode`**（否则 `vsce package` 可能报错）

---

## 2) `.vscode/launch.json`（F5 调试扩展宿主）

按 F5 时，VS Code 会启动一个新的“Extension Development Host”窗口。

### 关键点

- **`type: "extensionHost"`**：表明调试的是扩展
- **`--extensionDevelopmentPath=.../project-blueprint`**：明确扩展工程根目录
  - 如果这个路径错了，就会出现：`Extension manifest not found: ... package.json`
- **隔离参数**：
  - `--user-data-dir=...` / `--extensions-dir=...`：隔离用户数据与扩展目录
  - `--disable-extensions`：禁用其它扩展，排查冲突

---

## 3) `.vscode/tasks.json`（编译任务）

用于给 `launch.json` 的 `preLaunchTask` 提供具体任务。

### 关键点

- `cwd: "${workspaceFolder}/project-blueprint"`
  - **保证 `npm run compile` 在正确目录执行**
  - 避免在上一级目录执行导致找不到 manifest/依赖

---

## 4) `webpack.config.js` / `dist/extension.js`（构建链路）

- `webpack.config.js`：定义如何把 TS 打包成可运行的扩展 JS
- `dist/extension.js`：扩展实际被 VS Code 加载运行的产物（`package.json.main` 指向它）

常用命令：

- `npm run compile`：调试构建
- `npm run package`：发布构建（通常压缩/隐藏 sourcemap）

---

## 5) `src/extension.ts`（扩展端核心逻辑）

这是扩展的“业务主文件”：扫描目录、创建 Webview、消息通信、导出。

### 5.1 数据结构：`BlueprintTreeNode`

用于表示目录树：

- **`id`**：节点唯一标识（选中/删除/重命名/撤销重做依赖它）
- **`name`**：名称
- **`type`**：`"file" | "folder"`
- **`children?`**：仅 folder 节点存在

### 5.2 `DEFAULT_EXCLUDES`

扫描目录时默认忽略的目录集合（为了性能/内存）：

- VCS：`.git` `.svn` `.hg`
- 依赖/缓存：`node_modules` `.pnpm-store` `.yarn` ...
- 构建产物：`dist` `build` `out` `coverage` ...
- 语言工具缓存：`__pycache__` `.gradle` `bin/obj` ...

它会被 `scanFolderToTree(..., excludes = DEFAULT_EXCLUDES)` 使用。

### 5.3 `activate(context)`：扩展入口

#### 输入

- `context: vscode.ExtensionContext`

#### 处理

- 创建 OutputChannel，打印关键日志（方便排查问题）
- 注册命令：
  - `project-blueprint.openInBlueprint`
  - `project-blueprint.helloWorld`

#### 输出

- VS Code 里可通过右键菜单触发命令

### 5.4 命令：`project-blueprint.openInBlueprint`

这是用户真正用到的命令。

#### 输入

- `uri?: vscode.Uri`（用户右键选中的资源路径）

#### 处理

1. 校验 uri

- uri 为空：提示“请选择文件夹”
- `workspace.fs.stat(uri)`：必须是 Directory

2. 扫描

- `scanFolderToTree(uri, rootName)` 得到初始 `tree`

3. 创建 Webview

- `createWebviewPanel(...)`
- `panel.webview.html = getWebviewHtml(...)`

4. 通信

- Webview 发 `ready` → 扩展端回 `init`（带初始 tree）
- Webview 发 `exportMarkdown` → 扩展端生成 Markdown + 写文件 + 打开

#### 输出

- 打开一个 Webview 面板，让用户编辑目录树

### 5.5 `getWebviewHtml(webview)`：生成 Webview 页面

#### 输入

- `webview`：用于设置 CSP、nonce 等

#### 处理

- 生成 `nonce`
- 返回 HTML 字符串（包含 CSS 与 `<script>`）

#### 输出

- `string`：赋给 `panel.webview.html`

### 5.6 `createIdFactory()`

扩展端扫描用的 ID 工厂。

- 输入：无
- 输出：`() => string`（每次调用生成唯一 id）

### 5.7 `scanFolderToTree(folderUri, name, excludes)`

把真实文件夹扫描为 `BlueprintTreeNode`。

#### 输入

- `folderUri`: 要扫描的目录
- `name`: 根节点显示名
- `excludes`: 忽略目录集合

#### 处理

- `workspace.fs.readDirectory(folderUri)` 读取当前层
- 对子项：
  - 如果是目录且命中 excludes：跳过
  - 如果是目录：递归
  - 如果是文件：生成 file 节点

#### 输出

- `BlueprintTreeNode`（folder 类型 root）

### 5.8 `tryParseTreeFromWebview(treeLike)`

Webview 回传的数据属于“不可信输入”，这里做容错解析。

- 输入：`unknown`
- 输出：`BlueprintTreeNode | null`

### 5.9 `treeToTreeMarkdown(tree)`

把树结构转为 ASCII tree 文本。

- 输入：`BlueprintTreeNode`
- 处理：递归遍历 + connector (`├──/└──/│`) + prefix
- 输出：`string`

### 5.10 `exportTreeMarkdownToFolder(folderUri, md)`

把 markdown 写到右键文件夹目录下，并自动避免重名覆盖。

- 输入：`folderUri` + `md`
- 处理：尝试 `blueprint.md`，存在则 `blueprint-1.md`...
- 输出：导出文件的 `Uri`

---

## 6) Webview 端脚本（在 `getWebviewHtml` 的 `<script>` 内）

Webview 端是“编辑器本体”，主要做：

- 渲染树
- 处理键盘快捷键
- 维护撤销重做
- 把 treeState 回传扩展端导出

### 6.1 通信

- Webview → 扩展端：
  - `ready`
  - `exportMarkdown`（携带 treeState）
- 扩展端 → Webview：
  - `init`（携带初始 tree）

### 6.2 核心状态

- `treeState`: 当前可编辑的目录树
- `selectedId`: 当前选中节点
- `editingId`: 当前处于重命名输入框的节点
- `undoStack` / `redoStack`: 撤销重做栈（存快照）
- `pendingCreate`: 新建节点但允许“命名为空则取消创建”

### 6.3 节点定位

- `makeId()`：Webview 新建节点的 id
- `findPathById()`：从 root 找到目标节点路径（用于删除/同级插入）
- `getNodeById()`：拿到目标节点
- `ensureFolder()`：保证 folder 有 children

### 6.4 撤销/重做

- `deepClone()`：用于保存快照（避免引用共享）
- `pushHistory()`：压入 undo 快照并清空 redo
- `undo()` / `redo()`：回滚/前进

### 6.5 渲染

- `renderTree()`：重新渲染整棵树；如果 editingId 存在则自动 focus input
- `appendNode(...)`：递归渲染节点与分支线

### 6.6 编辑与结构修改

- `renameSelected()`：进入重命名
- `commitRename(id, value)`：提交重命名

  - trimmed 为空：
    - 如果是 pendingCreate：取消创建（回滚）
    - 否则：取消编辑不改名

- 新建规则（你的设计）：

  - `Enter`：新建同级文件夹，并立即进入编辑
  - `Tab`：新建子级文件（根节点禁用），并立即进入编辑

- 删除规则：

  - `Delete/Backspace`：删除选中节点（一次只删一个）

- 导出：
  - `Ctrl+S` 或点击按钮 → `exportMarkdown` 消息 → 扩展端写 md

---

## 7) 文档文件

### 7.1 `README.md`

面向“使用者”的快速说明：

- 如何打开蓝图
- 快捷键
- 导出说明
- 默认忽略目录清单

### 7.2 `USAGE_AND_RELEASE.md`

面向“维护者”的打包/发布流程：

- A：本地 `.vsix` 打包与安装
- B：Marketplace 发布流程

---

## 8) 推荐学习路径（建议）

如果你想最省时间，建议按这个顺序读：

1. `package.json`：理解命令、菜单、入口
2. `launch.json` / `tasks.json`：理解调试为什么能跑起来
3. `activate` + `openInBlueprint`：理解主流程
4. `scanFolderToTree`：理解数据从磁盘到 tree
5. Webview `<script>`：理解交互、撤销重做、编辑、导出
6. `treeToTreeMarkdown` + `exportTreeMarkdownToFolder`：理解导出链路

---

## 9) 教学式场景走读（场景 2：按一次完整操作链路学习）

这一章不再“按函数解释”，而是按你真实使用时的操作顺序，把 **发生了什么**、**代码从哪跳到哪**、**状态如何变化** 讲清楚。

### 9.1 场景：右键文件夹 → “在蓝图中打开” → Webview 展示树

#### 你在 UI 做了什么

- 在资源管理器右键一个文件夹
- 点击：`在蓝图中打开`

#### 扩展端发生了什么（`src/extension.ts`）

- 入口：`activate()` 中注册的命令 `project-blueprint.openInBlueprint`
- 校验：
  - `uri` 是否存在
  - `workspace.fs.stat(uri)` 是否是目录
- 扫描：调用 `scanFolderToTree(uri, rootName, DEFAULT_EXCLUDES)`
  - 产出：一份初始目录树 `tree: BlueprintTreeNode`
- 创建 Webview：`createWebviewPanel(...)` + `panel.webview.html = getWebviewHtml(...)`
- 建立消息接收：`panel.webview.onDidReceiveMessage(...)`

#### Webview 端发生了什么（`getWebviewHtml()` 内 `<script>`）

- Webview 启动后会发消息：`{ type: "ready" }`
- 扩展端收到 `ready` 后回发：`{ type: "init", tree }`
- Webview 收到 `init` 后：
  - `treeState = tree`
  - `selectedId = treeState.id`（默认选中根）
  - `editingId = null`
  - 调用 `renderTree()`：把树渲染到页面

你可以理解为：**扩展端负责把“初始数据”送到 Webview；Webview 负责把数据变成 UI。**

---

### 9.2 场景：选中某节点 → 按 Enter/Tab 新建 → 立即进入重命名

#### 你在 UI 做了什么

- 点击某个节点，使其变成选中态（高亮）
- 按：
  - `Enter`：新建同级“文件夹”
  - `Tab`：新建子级“文件”（根节点禁用 Tab）

#### Webview 端发生了什么

入口一般在：树容器的 `keydown` 监听（`document.getElementById('tree')?.addEventListener('keydown', ...)`）。

一次“新建节点”的典型状态变化是：

- 先 `pushHistory()`：把当前 `{ treeState, selectedId }` 存入 `undoStack`
  - 并清空 `redoStack`（符合编辑器常规行为）
- 在 `treeState` 的某个 `children` 数组里插入新节点（新节点 `id` 来自 `makeId()`）
- 更新选择与编辑状态：
  - `selectedId = newId`
  - `editingId = newId`（让这个新节点直接进入“输入框重命名”）
- 调用 `beginPendingCreate(...)`
  - 目的：如果你把名字删空并确认，可以把“这次创建”整体回滚掉
- 最后 `renderTree()`
  - 渲染时发现 `editingId` 存在，会自动 `focus()` + `select()` 输入框

#### 为什么要有 `pendingCreate`

为了实现“新建后如果命名为空则取消创建”的体验：

- 当你提交重命名时（`commitRename(id, value)`）：
  - 如果 `trimmed` 为空：
    - 若该节点是本次新建（`pendingCreate.id === id`） → `cancelPendingCreateIfNeeded(id)` 回滚
    - 否则只是退出编辑，不改名

---

### 9.3 场景：Ctrl+Z 撤销 / Ctrl+Y 重做

#### 你在 UI 做了什么

- 按 `Ctrl+Z`：撤销
- 按 `Ctrl+Y`：重做

#### Webview 端发生了什么

入口在同一个 `keydown` 监听里：

- `Ctrl+Z` → 调用 `undo()`
- `Ctrl+Y` → 调用 `redo()`

撤销/重做的核心规则是“快照栈”：

- `pushHistory()` 保存的是 `{ tree: deepClone(treeState), selectedId }`
- `undo()`：
  - 把当前状态压入 `redoStack`
  - 从 `undoStack` 弹出快照，恢复 `treeState/selectedId`
  - `editingId = null`，避免撤销后仍卡在输入框
  - `renderTree()` 刷新 UI
- `redo()`：
  - 把当前状态压入 `undoStack`
  - 从 `redoStack` 弹出快照，恢复 `treeState/selectedId`
  - 同样 `editingId = null` + `renderTree()`

你可以把它理解为：**每次结构变更先存一个“照片”；撤销就是回到上一张照片。**

---

### 9.4 场景：Ctrl+S 导出 Markdown → 写入文件 → 打开导出文件

#### 你在 UI 做了什么

- 在 Webview 内按 `Ctrl+S`（或点击“导出为 Markdown”按钮）

#### Webview 端发生了什么

- 触发导出时会 `postMessage`：
  - `{ type: "exportMarkdown", tree: treeState }`

#### 扩展端发生了什么（`src/extension.ts`）

- `panel.webview.onDidReceiveMessage(...)` 收到 `exportMarkdown`
- 解析/校验：`tryParseTreeFromWebview(msg.tree)`
  - 失败则 fallback 到初始 `tree`（保证至少能导出）
- 生成文本：`treeToTreeMarkdown(providedTree ?? tree)`
- 写文件：`exportTreeMarkdownToFolder(uri, md)`
  - 目标目录：你右键打开蓝图的那个文件夹
  - 文件名：`blueprint.md`，冲突则 `blueprint-1.md`...
- 打开导出文件：
  - `openTextDocument(exportUri)`
  - `showTextDocument(doc)`

你可以把它理解为：**Webview 负责把“当前编辑结果”交给扩展端；扩展端负责“落盘写文件并打开”。**

---

## 状态说明

本文档基于当前项目结构与实现撰写；如果你后续把 Webview JS 拆到单独文件、或加入可配置忽略规则，这份导读也可以继续迭代。
