# Project Blueprint

一个 VS Code 扩展：把指定文件夹扫描成“目录结构蓝图”，在 Webview 里像编辑思维导图一样编辑目录树（仅内存，不改真实文件），并一键导出为 `tree` 风格的文本。

---

## 使用方式

### 打开蓝图

- 在资源管理器中右键一个**文件夹**
- 点击：`在蓝图中打开`

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

- 导出位置：你右键打开蓝图的那个文件夹目录
- 导出文件名：默认 `blueprint.md`，如冲突则自动递增 `blueprint-1.md`、`blueprint-2.md`...
- 导出内容：Linux `tree` 风格的 ASCII 目录树（纯文本，不包含 ``` 包裹）

---

## 默认忽略的目录（为了更快、更省内存）

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

## 开发/打包/发布

请查看：`USAGE_AND_RELEASE.md`

- **A 方案**：本地自用（打包 `.vsix` 安装）
- **B 方案**：发布到 VS Code Marketplace
