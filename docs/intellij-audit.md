# IntelliJ Platform comparison audit

**Audit date:** 2026-10-18

WebBrains is a static React/TypeScript application. This audit distinguishes behavior from visual resemblance: there is no JVM runtime, Swing/AWT, arbitrary IntelliJ plugin JAR loading, or local OS process execution.

## Changes made in this pass

- The bottom tool window has all four rounded corners and sits inside the central workbench area, aligned to the editor's left/right insets (tool-stripe width plus one workbench gap) with a 6 px bottom margin. The stripes no longer overlap its rounded corners or content. Its surface is `#191a1c`; the workbench background is `#26282c`.
- Shared CSS variables now drive stripe widths, workbench gaps, editor insets, and bottom-panel margins. At narrow widths the side docks overlay the editor instead of shrinking the editor and right dock into an unusable sliver; an unused right dock stays available through its stripe drop target.
- Repeated trailing CSS overrides were folded into the main workbench layout rules, duplicate dock styling and 29 obsolete legacy rules were removed, and `App.css` was formatted into readable rule blocks. The stylesheet regression suite checks selector/declaration duplication within each cascade scope.
- Editor line highlighting now follows the 21 px line height used by the gutter and syntax layer. Caret status updates while moving the caret and splits text on actual LF separators.
- Editor input now updates the minimal changed document range rather than replacing the whole document on each keystroke. `DocumentModel` normalizes CRLF/CR to LF, and `EditorModel` tracks caret/selection offsets through edits.
- Editor/document resources are disposed when tabs close, projects change, or the IDE unmounts.
- Save queues and save status are keyed by project plus file path, avoiding collisions between similarly named files from different projects. Local edits are coalesced before BrowserFS queues IndexedDB writes; Google Drive keeps a longer debounce. The in-app project-navigation controls flush pending writes and wait for them to finish, and navigation stays in the editor if a write fails.
- VFS path normalization resolves `.`/`..`, rejects traversal above the project root, validates entry names, and avoids root-prefix collisions. Local metadata and persisted Drive tokens are validated; file-open/create failures are surfaced instead of becoming unhandled rejections. Common binary extensions are refused by the text editor so PNG/ZIP/PDF-like assets are not accidentally decoded and overwritten as UTF-8; this is a conservative extension heuristic, not full MIME/content detection.
- Keyboard shortcuts now match IntelliJ conventions where supported: `Shift` twice and `Ctrl/Cmd+Shift+N` open the current file-name search (not full Search Everywhere), Find Action uses `Ctrl/Cmd+Shift+A`, New File uses `Alt+Insert`, Project uses `Alt+1`, and Run tool window uses `Alt+4`. `Ctrl/Cmd+S` flushes pending saves for all open writable tabs. Unsupported parameter info and text search report that they are not implemented.
- Internal links, the favicon, and JetBrains SVG assets now use Vite's base URL. Project tree disclosure, folder/file icons, New action, search, and file-type icons use assets copied from the JetBrains IntelliJ Community source under Apache 2.0, with attribution in `public/icons/intellij/NOTICE.txt`. The remaining in-component `svg` drawings in `IdePage.tsx` were removed.
- The Project tree has a collapsible project root with nested rows indented relative to the root icon. Nested directories have real disclosure buttons using the upstream chevron and CSS rotation. New, Expand All, and Collapse All use JetBrains SVG assets; creation targets the selected directory or the project root. Right-click menus are implemented for root, directory, and file nodes, with only currently supported actions exposed.
- Tool-window icons can be dragged to another dock group and dropped on another icon to reorder before/after it. Their order persists separately from dock assignment. Left/right split tool windows share the upper side stripe; bottom-left icons live at the bottom of the left stripe and bottom-right split icons at the bottom of the right stripe, matching `ToolWindowPaneNewButtonManager`'s anchor-to-stripe mapping. Bottom tool windows are laid out left/right as separate rounded panes when the bottom anchor is split. Dropping a header onto a single side panel chooses upper/lower placement based on the half of the panel under the pointer, matching the upstream `ToolWindowDropArea` split rule. Empty sides do not render a fake “Drop a tool window here” panel; their stripe remains a valid drop target.
- GitHub Pages builds use a repository-aware base and hash routing, with pure routing regression tests; the deployment workflow runs lint and all test suites before deployment.

## Follow-up audit: tree and dock interactions

- Fixed the root-level indentation bug by making the project root an actual disclosure row and indenting its children as descendants, rather than siblings aligned to the root label.
- Added the upstream `expui/general/expandAll.svg` and `collapseAll.svg` assets (Apache 2.0, credited in `frontend/public/icons/intellij/NOTICE.txt`) and wired them to tree-wide expansion controls.
- Added right-click menus for project root, directory, and file rows. These currently expose New File/New Directory where applicable, Open for files, and Expand All/Collapse All. Rename, Delete, Copy Path, VCS, and other actions are intentionally not advertised until their underlying behavior is implemented and verified.
- The bottom dock row now uses the tool-stripe inset rather than adding the full left/right side-panel widths, which had pushed the bottom row too far toward the center.
- Drag-over now highlights actual side/bottom dock panes and stripe groups with a blue target outline/fill; drag-leave clears the highlight. This is an initial drop-target affordance, not yet a pixel-perfect reproduction of IntelliJ's split insertion line/blue preview region.
- Run/Debug toolbar actions and tool-window buttons reference the existing IntelliJ source SVG assets (`run-action.svg`, `debug-action.svg`, `run.svg`, `debug.svg`) rather than Unicode glyphs. The runtime actions remain placeholders because no browser execution/debug runtime is connected.

## Subsystem comparison

### Workbench and tool windows

The official SDK describes tool windows and their anchors; current source checks included [`ToolWindowPaneNewButtonManager`](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-impl/src/com/intellij/toolWindow/ToolWindowPaneNewButtonManager.kt), [`ToolWindowPane`](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-impl/src/com/intellij/toolWindow/ToolWindowPane.kt), [`ToolWindowDragHelper`](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-impl/src/com/intellij/toolWindow/ToolWindowDragHelper.kt), [`ToolWindowDropArea`](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-impl/src/com/intellij/toolWindow/ToolWindowDropArea.kt), [`ToolWindowLeftToolbar`](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-impl/src/com/intellij/toolWindow/ToolWindowLeftToolbar.kt), [`ToolWindowRightToolbar`](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-impl/src/com/intellij/toolWindow/ToolWindowRightToolbar.kt), and [`ToolWindowHeader`](https://github.com/JetBrains/intellij-community/blob/master/platform/platform-impl/src/com/intellij/toolWindow/ToolWindowHeader.kt). These confirm that the new UI uses left/right stripes, that bottom-anchored tools are represented in the left toolbar when the horizontal stripe extension is absent, and that drag targets split an area into halves. See [Tool Windows](https://plugins.jetbrains.com/docs/intellij/tool-windows.html) and [UI overview](https://plugins.jetbrains.com/docs/intellij/ui-overview.html).

WebBrains models two groups on the left and right, one active bottom tool window, draggable icons/headers, resize handles, and persisted tool-to-dock assignments. The empty right side intentionally remains a drop target. Tool-window factories, lazy content creation, content-manager tabs, floating/detached windows, full focus behavior, and all IntelliJ stripe policies are not implemented.

### Documents, editor, and language services

The platform now has versioned range edits, synchronous document-change events, LF normalization, and caret/selection offset mapping. The visible editor is still a textarea with a syntax-colored overlay and heuristic tokenization. There is no PSI tree, parser runtime, incremental PSI invalidation, undo/redo manager, guarded blocks, injected language, multi-caret, folding, inlays, completion lookup, inspections daemon, or refactoring engine. Syntax coloring is not semantic analysis.

### VFS and persistence

Memory, BrowserFS/IndexedDB, and Google Drive adapters share a virtual filesystem contract. Absolute paths outside a provider's root are rejected, relative paths normalize `.` / `..`, and local project IDs are validated before they become paths. Browser policy prevents transparent access to arbitrary disk paths, mounts, symlinks, and native file watchers. Drive project loading recursively lists directories before displaying the tree; this can be slow for very large projects, so lazy loading, cancellation, and bounded concurrency should precede indexing large workspaces.

**Persistence caveat:** the local provider uses BrowserFS `AsyncMirror`. Its in-memory write completes synchronously while the IndexedDB write is queued asynchronously; the current provider API does not receive a durable-commit acknowledgement from that queue. Therefore the UI's `Saved` state means the write was accepted by the active filesystem adapter, not that an IndexedDB transaction has definitely committed. A durable local-save acknowledgement layer is still required before making a stronger crash-durability guarantee. Drive access tokens currently live in `localStorage`, which is accessible to same-origin JavaScript and increases the impact of XSS; keep the `drive.file` scope narrow and revisit persistence as part of the security model.

### Services, plugins, lifetimes, and threading

WebBrains implements explicit disposable scopes, typed message topics, in-memory service containers, extension/action registries, project/module objects, and a metadata-only plugin catalog. IntelliJ services have application/project/module scopes, lazy initialization, descriptor-driven extension registration, and plugin-unload semantics. WebBrains does not instantiate arbitrary descriptor class names, load JARs, execute Java/Kotlin plugin code, or guarantee upstream service lookup/override semantics. See [Services](https://plugins.jetbrains.com/docs/intellij/plugin-services.html) and [Disposer / Disposable](https://plugins.jetbrains.com/docs/intellij/disposers.html).

IntelliJ uses an EDT/background-thread model and read/write access rules for PSI, VFS, and project data. A browser needs different concurrency contracts: expensive parsing/indexing should use Web Workers or cancellable asynchronous work, not a mechanical copy of Java read/write locks. See the [Threading Model](https://plugins.jetbrains.com/docs/intellij/threading-model.html). A static site cannot run arbitrary local processes or JVM bytecode; Terminal/Run/Debug remain placeholders unless implemented with explicit browser-native or separately designed remote execution.

## Remaining priorities

1. Add committed, repeatable browser integration tests for drag/drop, split resizing, keyboard focus, and dock-state persistence. This pass used a temporary Playwright/Firefox harness to verify icon dragging from upper to lower groups and back, icon reordering, panel-header docking, empty right-side drop targets, and layout persistence after reload. The harness exposed and helped fix a bug where a lower-stripe drop inherited the target icon's old bottom-row anchor. The temporary harness is not yet part of the repository; split resizing and keyboard focus still need browser-level tests.
2. Define a tool-window/content-manager model, including content tabs, focus behavior, and disposal tied to content lifetime.
3. Add provider contract tests for path normalization, I/O failures, and large-directory behavior.
4. Add undoable document transactions before implementing refactoring or quick fixes.
5. Add a real lexer/parser/diagnostic slice and version/cancellation contracts before claiming PSI, inspections, or completion compatibility.
6. Define lazy services, plugin unload, extension declaration translation, and version/module compatibility before supporting external plugin packages.
7. Keep OAuth token handling, CSP, IndexedDB quotas, and deployment-origin requirements in the security review.

## Verification

- `npm run build`
- `npm run lint`
- `npm run verify:platform`
- `npm run verify:styles`
- `npm run verify:routing`
- PostCSS parse of `App.css`
- `git diff --check`

Browser-only storage durability, OAuth popup behavior, and automated pointer interactions still require integration tests.
