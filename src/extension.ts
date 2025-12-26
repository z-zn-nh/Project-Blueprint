// 这个文件是扩展的“主入口”。
//
// 设计目标（核心思路）：
// - 扫描一个真实文件夹，生成一份“目录树快照”（BlueprintTreeNode）。
// - 把目录树快照发送到 Webview，在 Webview 里做“纯内存编辑”（不触碰磁盘真实文件）。
// - 用户在 Webview 中通过快捷键增删改节点、撤销重做。
// - 导出时，Webview 把当前树结构回传给扩展端，由扩展端写入 Markdown 文件。
//
// 为什么要把编辑逻辑放在 Webview：
// - Webview 更适合做交互（键盘编辑、即时渲染）。
// - 扩展端只做：扫描/校验/导出/持久化（写出 md），职责更清晰。
import * as vscode from "vscode";
import * as path from "path";

// activate 是扩展生命周期入口：
// - 只会在扩展被激活时调用一次。
// - 我们在这里注册命令、初始化输出通道等。
export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Project Blueprint");
  context.subscriptions.push(output);
  output.show(true);

  try {
    output.appendLine("[activate] begin");

    // 输出调试信息（开发阶段用）：
    // - output channel：用户可见、便于排障
    // - console：开发调试时查看
    console.log(
      'Congratulations, your extension "project-blueprint" is now active!'
    );
    output.appendLine("[activate] registered");

    const openInBlueprintDisposable = vscode.commands.registerCommand(
      "project-blueprint.openInBlueprint",
      async (uri?: vscode.Uri) => {
        // 命令入口：用户在资源管理器右键文件夹后触发。
        // 这里的 uri 是右键的资源路径。
        output.appendLine(
          `[command:openInBlueprint] invoked uri=${
            uri ? uri.toString(true) : "<empty>"
          }`
        );

        // 1) 参数校验：必须是文件夹
        if (!uri) {
          vscode.window.showErrorMessage(
            "请选择一个文件夹后再使用“在蓝图中打开”。"
          );
          output.appendLine("[command:openInBlueprint] aborted: uri is empty");
          return;
        }

        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type !== vscode.FileType.Directory) {
            vscode.window.showErrorMessage("“在蓝图中打开”仅支持文件夹。");
            output.appendLine(
              `[command:openInBlueprint] aborted: not a directory type=${stat.type}`
            );
            return;
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            `无法读取所选目录信息：${
              err instanceof Error ? err.message : String(err)
            }`
          );
          output.appendLine(
            `[command:openInBlueprint] aborted: stat failed err=${
              err instanceof Error ? err.stack ?? err.message : String(err)
            }`
          );
          return;
        }

        // 2) 扫描目录：把磁盘文件夹转成内存树
        vscode.window.showInformationMessage(
          `Project Blueprint：正在打开 ${uri.fsPath}`
        );
        output.appendLine(
          `[command:openInBlueprint] opening webview for ${uri.fsPath}`
        );

        // tree 是“权威的初始快照”。
        // Webview 里会维护自己的 treeState（可编辑），导出时再回传。
        let tree: BlueprintTreeNode;
        try {
          tree = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Window,
              title: "Project Blueprint: Scanning folder...",
            },
            async () => {
              const rootName = path.basename(uri.fsPath) || "Blueprint";
              return scanFolderToTree(uri, rootName);
            }
          );
          output.appendLine("[scan] done");
        } catch (err) {
          vscode.window.showErrorMessage(
            `扫描目录失败：${err instanceof Error ? err.message : String(err)}`
          );
          output.appendLine(
            `[scan] failed err=${
              err instanceof Error ? err.stack ?? err.message : String(err)
            }`
          );
          return;
        }

        // 3) 创建 Webview Panel：承载交互 UI。
        const folderName = path.basename(uri.fsPath) || "Blueprint";
        const panel = vscode.window.createWebviewPanel(
          "projectBlueprint.designer",
          `Project Blueprint: ${folderName}`,
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri],
          }
        );

        // 4) 注入 HTML：包含样式 + 脚本。脚本里会 acquireVsCodeApi 并建立双向通信。
        panel.webview.html = getWebviewHtml(panel.webview);
        output.appendLine("[command:openInBlueprint] webview html set");

        panel.webview.onDidReceiveMessage((message: unknown) => {
          // Webview -> Extension 通信入口：
          // - ready：Webview 已加载完成，扩展端可以发送 init 数据
          // - exportMarkdown：请求导出（Webview 会把当前 treeState 作为参数传回）
          if (!message || typeof message !== "object") {
            return;
          }

          const msg = message as { type?: string; tree?: unknown };
          switch (msg.type) {
            case "ready": {
              output.appendLine("[webview] ready");

              // init：把初始扫描树发送给 Webview。
              // Webview 收到后会渲染，并把根节点设为默认选中。
              panel.webview.postMessage({
                type: "init",
                tree,
              });
              output.appendLine("[webview] init sent");
              return;
            }
            case "exportMarkdown": {
              output.appendLine("[webview] exportMarkdown clicked");
              void (async () => {
                try {
                  // 安全/健壮性：
                  // - Webview 传回的数据属于“不可信输入”，所以先 tryParse 校验。
                  // - 解析失败则回退到初始 tree（至少能导出）。
                  const providedTree = tryParseTreeFromWebview(msg.tree);
                  const md = treeToTreeMarkdown(providedTree ?? tree);
                  const exportUri = await exportTreeMarkdownToFolder(uri, md);
                  const doc = await vscode.workspace.openTextDocument(
                    exportUri
                  );
                  await vscode.window.showTextDocument(doc, { preview: false });
                } catch (err) {
                  vscode.window.showErrorMessage(
                    `导出失败：${
                      err instanceof Error ? err.message : String(err)
                    }`
                  );
                  output.appendLine(
                    `[export] failed err=${
                      err instanceof Error
                        ? err.stack ?? err.message
                        : String(err)
                    }`
                  );
                }
              })();
              return;
            }
          }
        });
      }
    );

    const generateBlueprintMarkdownDisposable = vscode.commands.registerCommand(
      "project-blueprint.generateBlueprintMarkdown",
      async (uri?: vscode.Uri) => {
        output.appendLine(
          `[command:generateBlueprintMarkdown] invoked uri=${
            uri ? uri.toString(true) : "<empty>"
          }`
        );

        if (!uri) {
          vscode.window.showErrorMessage(
            "请选择一个文件夹后再使用“生成项目蓝图”。"
          );
          output.appendLine(
            "[command:generateBlueprintMarkdown] aborted: uri is empty"
          );
          return;
        }

        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.type !== vscode.FileType.Directory) {
            vscode.window.showErrorMessage("“生成项目蓝图”仅支持文件夹。");
            output.appendLine(
              `[command:generateBlueprintMarkdown] aborted: not a directory type=${stat.type}`
            );
            return;
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            `无法读取所选目录信息：${
              err instanceof Error ? err.message : String(err)
            }`
          );
          output.appendLine(
            `[command:generateBlueprintMarkdown] aborted: stat failed err=${
              err instanceof Error ? err.stack ?? err.message : String(err)
            }`
          );
          return;
        }

        vscode.window.showInformationMessage(
          `Project Blueprint：正在生成 ${uri.fsPath} 的项目蓝图`
        );
        output.appendLine(
          `[command:generateBlueprintMarkdown] generating for ${uri.fsPath}`
        );

        let tree: BlueprintTreeNode;
        try {
          tree = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Window,
              title: "Project Blueprint: Scanning folder...",
            },
            async () => {
              const rootName = path.basename(uri.fsPath) || "Blueprint";
              return scanFolderToTree(uri, rootName);
            }
          );
          output.appendLine("[generateBlueprintMarkdown] scan done");
        } catch (err) {
          vscode.window.showErrorMessage(
            `扫描目录失败：${err instanceof Error ? err.message : String(err)}`
          );
          output.appendLine(
            `[generateBlueprintMarkdown] scan failed err=${
              err instanceof Error ? err.stack ?? err.message : String(err)
            }`
          );
          return;
        }

        try {
          const md = treeToTreeMarkdown(tree);
          const exportUri = await exportTreeMarkdownToFolder(uri, md);
          output.appendLine(
            `[generateBlueprintMarkdown] written file=${exportUri.fsPath}`
          );
          vscode.window.showInformationMessage(`已生成：${exportUri.fsPath}`);
          const doc = await vscode.workspace.openTextDocument(exportUri);
          await vscode.window.showTextDocument(doc, { preview: false });
        } catch (err) {
          vscode.window.showErrorMessage(
            `生成失败：${err instanceof Error ? err.message : String(err)}`
          );
          output.appendLine(
            `[generateBlueprintMarkdown] failed err=${
              err instanceof Error ? err.stack ?? err.message : String(err)
            }`
          );
        }
      }
    );

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable = vscode.commands.registerCommand(
      "project-blueprint.helloWorld",
      () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        vscode.window.showInformationMessage(
          "Hello World from project_blueprint!"
        );
      }
    );

    context.subscriptions.push(
      openInBlueprintDisposable,
      generateBlueprintMarkdownDisposable,
      disposable
    );
    output.appendLine("[activate] end");
  } catch (err) {
    output.appendLine(
      `[activate] failed err=${
        err instanceof Error ? err.stack ?? err.message : String(err)
      }`
    );
    vscode.window.showErrorMessage(
      `Project Blueprint 激活失败：${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

// 生成 Webview 的 HTML。
// 说明：这里直接返回一个大字符串（包含 CSS 和 JS）。
// - CSP 使用 nonce，防止被注入脚本。
// - JS 里维护 treeState（内存树）、selectedId（选中节点）、editingId（正在编辑节点）等。
function getWebviewHtml(webview: vscode.Webview): string {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Project Blueprint</title>
	<style>
		:root {
			color-scheme: light dark;
		}
		body {
			padding: 0;
			margin: 0;
			background: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size);
		}
		.toolbar {
			display: flex;
			gap: 8px;
			padding: 8px 12px;
			border-bottom: 1px solid var(--vscode-editorGroup-border);
		}
		button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: 1px solid var(--vscode-button-border);
			padding: 6px 10px;
			border-radius: 4px;
			cursor: pointer;
		}
		button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		.content {
			padding: 12px;
		}
		.tree {
			margin-top: 10px;
			border: 1px solid var(--vscode-editorWidget-border);
			background: var(--vscode-editorWidget-background);
			border-radius: 6px;
			padding: 8px;
			outline: none;
		}
		.node {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 2px 4px;
			border-radius: 4px;
			cursor: pointer;
			user-select: none;
		}
		.prefix {
			white-space: pre;
			font-family: var(--vscode-editor-font-family);
			opacity: 0.85;
		}
		.kind {
			white-space: pre;
			font-family: var(--vscode-editor-font-family);
			width: 5ch;
			opacity: 0.9;
		}
		.label {
			white-space: pre;
			font-family: var(--vscode-editor-font-family);
		}
		.node:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.node.selected {
			background: var(--vscode-list-activeSelectionBackground);
			color: var(--vscode-list-activeSelectionForeground);
		}
		.node input {
			width: min(520px, 100%);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			padding: 2px 6px;
			font: inherit;
		}
		.hint {
			opacity: 0.9;
			line-height: 1.6;
		}
		.kbd {
			display: inline-block;
			padding: 1px 6px;
			border-radius: 4px;
			border: 1px solid var(--vscode-editorWidget-border);
			background: var(--vscode-editorWidget-background);
			font-family: var(--vscode-editor-font-family);
			font-size: 0.95em;
		}
	</style>
</head>
<body>
	<div class="toolbar">
		<button id="exportMdBtn" type="button">导出为 Markdown</button>
	</div>
	<div class="content">
		<div class="hint">
			<div>Webview 已启动。下一步会在这里渲染目录树并实现键盘编辑。</div>
			<div>快捷键预期：</div>
			<div><span class="kbd">Enter</span> 新建文件夹</div>
			<div><span class="kbd">Tab</span> 新建文件</div>
			<div><span class="kbd">F2</span> 重命名</div>
			<div><span class="kbd">Delete</span> 删除</div>
			<div><span class="kbd">Ctrl</span> + <span class="kbd">S</span> 导出 Markdown</div>
		</div>
		<div id="tree" class="tree" tabindex="0" aria-label="Blueprint tree"></div>
	</div>
	<script nonce="${nonce}">
		// Webview 端的核心状态：
		// - treeState：当前可编辑的目录树（内存，不落盘）
		// - selectedId：当前选中的节点
		// - editingId：当前处于“内联重命名输入框”的节点
		// - undoStack/redoStack：撤销/重做栈（存快照）
		// - pendingCreate：用于“新建但命名为空则取消创建”的场景
		const vscode = acquireVsCodeApi();
		let treeState = null;
		let selectedId = null;
		let editingId = null;
		let pendingCreate = null; // { id, undoLenBefore, redoBefore }
		let idCounter = 0;
		let undoStack = [];
		let redoStack = [];

		// Webview 内部 ID 生成器：
		// - 仅用于“新建节点”时生成临时 id。
		// - 与扩展端扫描出来的 id 规则不同，但只要在当前 treeState 内唯一即可。
		function makeId() {
			idCounter++;
			return (Date.now().toString(36) + '-' + idCounter.toString(36));
		}

		// 查找：从 root 开始，找到指定 id 的节点路径。
		// 返回值是一个数组：从 root 到目标节点的链路（用于删除、同级插入等）。
		function findPathById(node, id, pathAcc = []) {
			if (!node) return null;
			if (node.id === id) return pathAcc.concat(node);
			if (node.type === 'folder' && Array.isArray(node.children)) {
				for (const child of node.children) {
					const found = findPathById(child, id, pathAcc.concat(node));
					if (found) return found;
				}
			}
			return null;
		}

		function getSelectedPath() {
			if (!treeState || !selectedId) return null;
			return findPathById(treeState, selectedId);
		}

		function getNodeById(node, id) {
			const p = findPathById(node, id);
			return p ? p[p.length - 1] : null;
		}

		// 确保节点具备 folder 结构：
		// - type = folder
		// - children = []
		// 某些情况下我们需要“把选中节点当成容器”，就会调用这个。
		function ensureFolder(node) {
			if (!node) return;
			if (node.type !== 'folder') {
				node.type = 'folder';
			}
			if (!Array.isArray(node.children)) {
				node.children = [];
			}
		}

		function deepClone(value) {
			if (typeof structuredClone === 'function') {
				return structuredClone(value);
			}
			return JSON.parse(JSON.stringify(value));
		}

		// 记录撤销快照：
		// - 采用深拷贝保存 treeState 和 selectedId
		// - 新操作发生后，清空 redoStack
		function pushHistory() {
			undoStack.push({ tree: deepClone(treeState), selectedId });
			if (undoStack.length > 100) {
				undoStack.shift();
			}
			redoStack = [];
		}

		function beginPendingCreate(newId, undoLenBefore, redoBefore) {
			pendingCreate = { id: newId, undoLenBefore, redoBefore };
		}

		// 新建节点“命名为空则取消”的关键逻辑：
		// - 新建时会 beginPendingCreate() 记录“新建前的 undoStack 长度”和“redo 快照”。
		// - 当用户把名字删空并确认/失焦/ESC，则调用 cancelPendingCreateIfNeeded()
		//   回滚到新建之前的状态，相当于这次创建从未发生。
		function cancelPendingCreateIfNeeded(id) {
			if (!pendingCreate || pendingCreate.id !== id) {
				return false;
			}
			const rec = undoStack[pendingCreate.undoLenBefore];
			if (rec) {
				treeState = rec.tree;
				selectedId = rec.selectedId;
			}
			undoStack.length = pendingCreate.undoLenBefore;
			redoStack = pendingCreate.redoBefore;
			pendingCreate = null;
			editingId = null;
			renderTree();
			document.getElementById('tree')?.focus();
			return true;
		}

		function undo() {
			if (editingId) return;
			if (!undoStack.length) return;
			redoStack.push({ tree: deepClone(treeState), selectedId });
			const prev = undoStack.pop();
			treeState = prev.tree;
			selectedId = prev.selectedId;
			editingId = null;
			renderTree();
		}

		function redo() {
			if (editingId) return;
			if (!redoStack.length) return;
			undoStack.push({ tree: deepClone(treeState), selectedId });
			const next = redoStack.pop();
			treeState = next.tree;
			selectedId = next.selectedId;
			editingId = null;
			renderTree();
		}

		// 渲染：把 treeState 展开为“类 tree 输出”的可视列表。
		// 注意：这里是“展开式列表”而不是可折叠树（简单但直观）。
		function renderTree() {
			const rootEl = document.getElementById('tree');
			if (!rootEl) return;
			rootEl.innerHTML = '';
			if (!treeState) {
				rootEl.textContent = '正在加载目录树...';
				return;
			}

			const frag = document.createDocumentFragment();
			appendNode(frag, treeState, '', true, true);
			rootEl.appendChild(frag);

			if (editingId) {
				const input = rootEl.querySelector('input[data-editing="true"]');
				if (input) {
					setTimeout(() => {
						input.focus();
						input.select();
					}, 0);
				}
			}
		}

		// 渲染单个节点（以及递归渲染子节点）。
		// prefix/isLast 用于生成类似“├──/│/└──”的分支线。
		function appendNode(parent, node, prefix, isLast, isRoot) {
			const row = document.createElement('div');
			row.className = 'node';
			if (node.id === selectedId) {
				row.classList.add('selected');
			}

			const prefixSpan = document.createElement('span');
			prefixSpan.className = 'prefix';
			prefixSpan.textContent = isRoot ? '' : (prefix + (isLast ? '└── ' : '├── '));
			row.appendChild(prefixSpan);

			const labelSpan = document.createElement('span');
			labelSpan.className = 'label';
			if (node.id === editingId) {
				const input = document.createElement('input');
				input.value = node.name;
				input.setAttribute('data-editing', 'true');
				input.addEventListener('click', (e) => {
					e.stopPropagation();
				});
				input.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						e.stopPropagation();
						commitRename(node.id, input.value);
						return;
					}
					if (e.key === 'Escape') {
						e.preventDefault();
						e.stopPropagation();
						if (!cancelPendingCreateIfNeeded(node.id)) {
							editingId = null;
							renderTree();
							document.getElementById('tree')?.focus();
						}
						return;
					}
				});
				input.addEventListener('blur', () => {
					commitRename(node.id, input.value);
				});
				labelSpan.appendChild(input);
			} else {
				labelSpan.textContent = isRoot ? ('.' + node.name) : node.name;
			}
			row.appendChild(labelSpan);
			row.dataset.nodeId = node.id;
			if (node.id !== editingId) {
				row.addEventListener('click', () => {
					selectedId = node.id;
					editingId = null;
					document.getElementById('tree')?.focus();
					renderTree();
				});
				if (!isRoot) {
					row.addEventListener('dblclick', (e) => {
						e.preventDefault();
						e.stopPropagation();
						selectedId = node.id;
						editingId = node.id;
						renderTree();
					});
				}
			}
			parent.appendChild(row);

			if (node.type === 'folder' && Array.isArray(node.children)) {
				const nextPrefix = isRoot ? '' : (prefix + (isLast ? '    ' : '│   '));
				node.children.forEach((child, idx) => {
					appendNode(parent, child, nextPrefix, idx === node.children.length - 1, false);
				});
			}
		}

		function createSiblingFile() {
			if (editingId) return;
			if (treeState && selectedId === treeState.id) {
				pushHistory();
				ensureFolder(treeState);
				const newNode = { id: makeId(), name: 'New File', type: 'file' };
				treeState.children.push(newNode);
				selectedId = newNode.id;
				editingId = newNode.id;
				renderTree();
				return;
			}
			const path = getSelectedPath();
			if (!path || path.length < 2) {
				return;
			}
			const parent = path[path.length - 2];
			const current = path[path.length - 1];
			if (!Array.isArray(parent.children)) return;
			pushHistory();

			const idx = parent.children.findIndex((c) => c.id === current.id);
			if (idx < 0) return;
			const newNode = { id: makeId(), name: 'New File', type: 'file' };
			parent.children.splice(idx + 1, 0, newNode);
			selectedId = newNode.id;
			editingId = newNode.id;
			renderTree();
		}

		function createChildFolder() {
			if (editingId) return;
			if (!treeState) return;
			if (!selectedId) {
				selectedId = treeState.id;
			}
			if (selectedId === treeState.id) {
				pushHistory();
				ensureFolder(treeState);
				const newNode = { id: makeId(), name: 'New Folder', type: 'folder', children: [] };
				treeState.children.push(newNode);
				selectedId = newNode.id;
				editingId = newNode.id;
				renderTree();
				return;
			}
			const node = getNodeById(treeState, selectedId);
			if (!node) return;
			pushHistory();
			ensureFolder(node);
			const newNode = { id: makeId(), name: 'New Folder', type: 'folder', children: [] };
			node.children.push(newNode);
			selectedId = newNode.id;
			editingId = newNode.id;
			renderTree();
		}

		function renameSelected() {
			if (!treeState || !selectedId) return;
			if (selectedId === treeState.id) return;
			editingId = selectedId;
			renderTree();
		}

		// 提交重命名：
		// - 若 trimmed 为空：
		//   - 如果是 pendingCreate 节点 => 取消创建
		//   - 否则 => 取消编辑（不改名）
		// - 若有有效名称：更新节点名，并入栈以支持撤销
		function commitRename(id, value) {
			if (!treeState) return;
			const node = getNodeById(treeState, id);
			if (!node) {
				editingId = null;
				renderTree();
				document.getElementById('tree')?.focus();
				return;
			}
			const trimmed = (value || '').trim();
			if (!trimmed) {
				if (!cancelPendingCreateIfNeeded(id)) {
					editingId = null;
					renderTree();
					document.getElementById('tree')?.focus();
				}
				return;
			}
			if (node.name !== trimmed) {
				pushHistory();
				node.name = trimmed;
			}
			if (pendingCreate && pendingCreate.id === id) {
				pendingCreate = null;
			}
			editingId = null;
			renderTree();
			document.getElementById('tree')?.focus();
		}

		function createSiblingFolder() {
			if (editingId) return;
			if (!treeState) return;
			const undoLenBefore = undoStack.length;
			const redoBefore = deepClone(redoStack);
			if (selectedId === treeState.id) {
				pushHistory();
				ensureFolder(treeState);
				const newNode = { id: makeId(), name: 'New Folder', type: 'folder', children: [] };
				treeState.children.push(newNode);
				selectedId = newNode.id;
				editingId = newNode.id;
				beginPendingCreate(newNode.id, undoLenBefore, redoBefore);
				renderTree();
				return;
			}
			const path = getSelectedPath();
			if (!path || path.length < 2) return;
			const parent = path[path.length - 2];
			const current = path[path.length - 1];
			if (!Array.isArray(parent.children)) return;
			pushHistory();
			const idx = parent.children.findIndex((c) => c.id === current.id);
			if (idx < 0) return;
			const newNode = { id: makeId(), name: 'New Folder', type: 'folder', children: [] };
			parent.children.splice(idx + 1, 0, newNode);
			selectedId = newNode.id;
			editingId = newNode.id;
			beginPendingCreate(newNode.id, undoLenBefore, redoBefore);
			renderTree();
		}

		function createChildFile() {
			if (editingId) return;
			if (!treeState) return;
			if (!selectedId) {
				selectedId = treeState.id;
			}
			const undoLenBefore = undoStack.length;
			const redoBefore = deepClone(redoStack);
			if (selectedId === treeState.id) {
				pushHistory();
				ensureFolder(treeState);
				const newNode = { id: makeId(), name: 'New File', type: 'file' };
				treeState.children.push(newNode);
				selectedId = newNode.id;
				editingId = newNode.id;
				beginPendingCreate(newNode.id, undoLenBefore, redoBefore);
				renderTree();
				return;
			}
			const node = getNodeById(treeState, selectedId);
			if (!node) return;
			pushHistory();
			ensureFolder(node);
			const newNode = { id: makeId(), name: 'New File', type: 'file' };
			node.children.push(newNode);
			selectedId = newNode.id;
			editingId = newNode.id;
			beginPendingCreate(newNode.id, undoLenBefore, redoBefore);
			renderTree();
		}

		function deleteSelected() {
			if (editingId) return;
			const path = getSelectedPath();
			if (!path || path.length < 2) {
				return;
			}
			const parent = path[path.length - 2];
			const current = path[path.length - 1];
			if (!Array.isArray(parent.children)) return;
			pushHistory();
			const idx = parent.children.findIndex((c) => c.id === current.id);
			if (idx < 0) return;
			parent.children.splice(idx, 1);
			const fallback = parent.children[idx] || parent.children[idx - 1] || parent;
			selectedId = fallback.id;
			renderTree();
		}

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (!message || typeof message !== 'object') return;
			switch (message.type) {
				case 'init':
					treeState = message.tree;
					selectedId = treeState?.id ?? null;
					editingId = null;
					renderTree();
					document.getElementById('tree')?.focus();
					return;
			}
		});

		// 键盘交互：尽量在 Webview 内消费快捷键，避免影响外部编辑器。
		// 同时注意：
		// - 输入框编辑时不应该触发树的快捷键
		// - 部分按键会在 window 层也监听（用于“树没焦点也能删除”）
		document.getElementById('tree')?.addEventListener('keydown', (e) => {
			if (!treeState) return;
			const isModifier = e.ctrlKey || e.metaKey;
			const activeEl = document.activeElement;
			const isEditingInput = activeEl && activeEl.tagName === 'INPUT';
			if (isModifier && !isEditingInput) {
				if (e.key.toLowerCase() === 'z') {
					e.preventDefault();
					undo();
					return;
				}
				if (e.key.toLowerCase() === 'y') {
					e.preventDefault();
					redo();
					return;
				}
				if (e.key.toLowerCase() === 's') {
					e.preventDefault();
					vscode.postMessage({ type: 'exportMarkdown', tree: treeState });
					return;
				}
			}
			if (e.key === 'Enter') {
				e.preventDefault();
				createSiblingFolder();
				return;
			}
			if (e.key === 'Tab') {
				e.preventDefault();
				e.stopPropagation();
				if (selectedId === treeState.id) {
					return;
				}
				createChildFile();
				return;
			}
			if (e.key === 'F2') {
				e.preventDefault();
				renameSelected();
				return;
			}
			if (e.key === 'Delete') {
				e.preventDefault();
				e.stopPropagation();
				deleteSelected();
				return;
			}
			if (e.key === 'Backspace') {
				e.preventDefault();
				e.stopPropagation();
				deleteSelected();
				return;
			}
		});

		window.addEventListener('load', () => {
			vscode.postMessage({ type: 'ready' });
			renderTree();
		});

		window.addEventListener('keydown', (e) => {
			if (e.defaultPrevented) return;
			if (!treeState) return;
			const activeEl = document.activeElement;
			const isEditingInput = activeEl && activeEl.tagName === 'INPUT';
			if (isEditingInput) return;
			if (e.key === 'Delete') {
				e.preventDefault();
				deleteSelected();
				return;
			}
			if (e.key === 'Backspace') {
				e.preventDefault();
				deleteSelected();
				return;
			}
		});

		document.getElementById('exportMdBtn')?.addEventListener('click', () => {
			vscode.postMessage({ type: 'exportMarkdown', tree: treeState });
		});
	</script>
</body>
</html>`;
}

type BlueprintNodeType = "file" | "folder";

type BlueprintTreeNode = {
  id: string;
  name: string;
  type: BlueprintNodeType;
  children?: BlueprintTreeNode[];
};

const DEFAULT_EXCLUDES = new Set([
  // VCS
  ".git",
  ".svn",
  ".hg",

  // JS/TS ecosystem
  "node_modules",
  "bower_components",
  ".npm",
  ".pnpm-store",
  ".yarn",
  ".pnp",
  ".parcel-cache",
  ".turbo",
  ".nx",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".vite",
  ".cache",
  ".vercel",
  ".netlify",

  // Build artifacts (common)
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  ".nyc_output",

  // Python
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  "env",

  // Java/Kotlin/Gradle
  ".gradle",

  // .NET
  "bin",
  "obj",
  ".vs",

  // IDE
  ".idea",
]);

function createIdFactory(): () => string {
  let n = 0;
  return () => `${Date.now().toString(36)}-${(n++).toString(36)}`;
}

async function scanFolderToTree(
  folderUri: vscode.Uri,
  name: string,
  excludes: ReadonlySet<string> = DEFAULT_EXCLUDES,
  makeId: () => string = createIdFactory()
): Promise<BlueprintTreeNode> {
  const children: BlueprintTreeNode[] = [];
  const entries = await vscode.workspace.fs.readDirectory(folderUri);

  for (const [entryName, entryType] of entries) {
    if (excludes.has(entryName)) {
      continue;
    }

    const childUri = vscode.Uri.joinPath(folderUri, entryName);
    if (entryType === vscode.FileType.Directory) {
      children.push(
        await scanFolderToTree(childUri, entryName, excludes, makeId)
      );
      continue;
    }

    if (entryType === vscode.FileType.File) {
      children.push({
        id: makeId(),
        name: entryName,
        type: "file",
      });
    }
  }

  children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    id: makeId(),
    name,
    type: "folder",
    children,
  };
}

function treeToMarkdown(tree: BlueprintTreeNode): string {
  const lines: string[] = [];

  const visit = (node: BlueprintTreeNode, depth: number) => {
    const indent = "  ".repeat(depth);
    const label = node.type === "folder" ? `${node.name}/` : node.name;
    lines.push(`${indent}- ${label}`);
    if (node.type === "folder" && node.children) {
      for (const child of node.children) {
        visit(child, depth + 1);
      }
    }
  };

  visit(tree, 0);
  return lines.join("\n") + "\n";
}

function treeToTreeMarkdown(tree: BlueprintTreeNode): string {
  const normalized = normalizeTreeForExport(tree);
  const lines: string[] = [];

  const render = (node: BlueprintTreeNode, prefix: string, isLast: boolean) => {
    const connector = isLast ? "└── " : "├── ";
    lines.push(`${prefix}${connector}${node.name}`);

    if (node.type === "folder" && node.children && node.children.length) {
      const nextPrefix = prefix + (isLast ? "    " : "│   ");
      node.children.forEach((child, idx) => {
        render(child, nextPrefix, idx === node.children!.length - 1);
      });
    }
  };

  // Top line should be the selected folder name (root).
  lines.push(`.${normalized.name}`);
  if (
    normalized.type === "folder" &&
    normalized.children &&
    normalized.children.length
  ) {
    normalized.children.forEach((child, idx) => {
      render(child, "", idx === normalized.children!.length - 1);
    });
  }

  return lines.join("\n") + "\n";
}

function normalizeTreeForExport(node: BlueprintTreeNode): BlueprintTreeNode {
  if (node.type !== "folder") {
    return { id: node.id, name: node.name, type: "file" };
  }

  const children = (node.children ?? []).map(normalizeTreeForExport);
  children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    id: node.id,
    name: node.name,
    type: "folder",
    children,
  };
}

async function exportTreeMarkdownToFolder(
  folderUri: vscode.Uri,
  markdown: string
): Promise<vscode.Uri> {
  const fileNameBase = "blueprint";
  const ext = ".md";

  for (let i = 0; i < 1000; i++) {
    const name =
      i === 0 ? `${fileNameBase}${ext}` : `${fileNameBase}-${i}${ext}`;
    const candidate = vscode.Uri.joinPath(folderUri, name);
    try {
      await vscode.workspace.fs.stat(candidate);
      continue;
    } catch {
      await vscode.workspace.fs.writeFile(
        candidate,
        Buffer.from(markdown, "utf8")
      );
      return candidate;
    }
  }

  throw new Error("无法生成可用的导出文件名。请检查目录权限或清理同名文件。");
}

function tryParseTreeFromWebview(value: unknown): BlueprintTreeNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const v = value as {
    id?: unknown;
    name?: unknown;
    type?: unknown;
    children?: unknown;
  };

  if (typeof v.id !== "string" || typeof v.name !== "string") {
    return null;
  }
  if (v.type !== "file" && v.type !== "folder") {
    return null;
  }

  const node: BlueprintTreeNode = {
    id: v.id,
    name: v.name,
    type: v.type,
  };

  if (v.type === "folder" && Array.isArray(v.children)) {
    const children: BlueprintTreeNode[] = [];
    for (const c of v.children) {
      const parsed = tryParseTreeFromWebview(c);
      if (parsed) {
        children.push(parsed);
      }
    }
    node.children = children;
  }

  return node;
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// This method is called when your extension is deactivated
export function deactivate() {}
