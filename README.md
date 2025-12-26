# Project Blueprint

一个 VS Code 扩展：把指定文件夹扫描成“目录结构蓝图”，在 Webview 里像编辑思维导图一样编辑目录树（仅内存，不改真实文件），并一键导出为 `tree` 风格的文本。

## 功能亮点

- **右键文件夹一键生成蓝图**：直接在根目录生成 `blueprint*.md`
- **Webview 可视化编辑目录树**：增删改节点、撤销/重做（仅内存，不触碰真实文件）
- **导出 tree 风格 Markdown**：适合放到项目根目录做结构快照/交接文档

## 命令（Commands）

- `在蓝图中打开`：打开 Webview 编辑器（可编辑后导出）
- `生成项目蓝图`：跳过 Webview，直接扫描并生成 Markdown

---

## 使用方式

### 打开蓝图

- 在资源管理器中右键一个**文件夹**
- 点击：`在蓝图中打开`

### 直接生成项目蓝图（跳过 Webview）

- 在资源管理器中右键一个**文件夹**
- 点击：`生成项目蓝图`
- 扩展会直接在该文件夹根目录生成 `blueprint*.md` 并自动打开

> 说明：该方式会导出“扫描到的真实目录结构快照”（不包含 Webview 内的编辑结果）。

### Webview 快捷键

- **Enter**：新建文件夹（同级）
- **Tab**：新建文件（子级）；根节点 Tab 已禁用
- **F2 / 双击**：重命名（输入框自动全选）
- **Delete / Backspace**：删除选中节点（一次只删一个）
- **Ctrl+Z / Ctrl+Y**：撤销 / 重做
- **Ctrl+S**：导出 Markdown（等价于点击“导出为 Markdown”按钮）

### 创建时的空命名行为

当你新建文件/文件夹后进入重命名输入框：

- 如果你把名称清空，并按 Enter / 失焦 / Esc
- 会**取消这次创建**（不会留下一个空名字节点）

---

## 导出说明

- 导出位置：你右键选择的那个文件夹目录
- 导出文件名：默认 `blueprint.md`，如冲突则自动递增 `blueprint-1.md`、`blueprint-2.md`...
- 导出内容：Linux `tree` 风格的 ASCII 目录树（纯文本，不包含 ``` 包裹）

导出有两种来源：

- **从 Webview 导出（Ctrl+S / 按钮）**：导出的是 Webview 当前编辑后的 treeState
- **右键直接生成（生成项目蓝图）**：导出的是扫描到的真实目录结构快照

---

## 默认忽略的目录

扫描目录时会默认忽略一些“体积大 / 可再生成 / 与源码无关”的目录，否则像 `node_modules` 这类目录会让扫描很慢、占用大量内存。

当前默认忽略的常见目录包括（不区分大小写，按目录名精确匹配）：

- **版本控制**：`.git`、`.svn`、`.hg`
- **依赖/缓存**：`node_modules`、`bower_components`、`.npm`、`.pnpm-store`、`.yarn`、`.pnp`、`.cache`
- **前端构建缓存/产物**：`.next`、`.nuxt`、`.svelte-kit`、`.astro`、`.vite`、`.parcel-cache`、`.turbo`、`.nx`、`.vercel`、`.netlify`
- **通用构建产物**：`dist`、`build`、`out`、`target`、`coverage`、`.nyc_output`
- **Python**：`__pycache__`、`.pytest_cache`、`.mypy_cache`、`.ruff_cache`、`.venv`、`venv`、`env`
- **Java/Gradle**：`.gradle`
- **.NET/VS**：`bin`、`obj`、`.vs`
- **IDE**：`.idea`

如果你想调整忽略列表：

- 修改 `src/extension.ts` 里的 `DEFAULT_EXCLUDES`

---
