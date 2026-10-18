# Architecture

## Runtime model

- The application is a static React + TypeScript site built with Vite.
- UI and client-side application logic run in the browser.
- There is no server-side Java or application backend in this architecture.
- The static React app serves a project landing page at `/` and an IDE workbench at `/ide`; other paths show a not-found view.
- Development/build tooling uses Node.js locally; this does not make Node.js a production runtime dependency.

## Boundaries

- `components/`: reusable presentation components.
- `pages/`: page composition and route-level views.
- `hooks/`: reusable React state and lifecycle logic.
- `services/`: browser APIs and external integrations, kept separate from presentation.
- `platform/`: framework-independent TypeScript foundations for browser-side plugin concepts. This is a small compatibility layer, not an IntelliJ runtime.
- `styles/`: shared styling and design tokens.
- `utils/`: small pure helpers where practical.

Keep browser-specific capabilities behind clear interfaces in `services/` when doing so improves testability. Do not add a backend or compatibility workaround without an explicit architectural need.

## Current UI milestone

The root route is a project picker with three sample browser projects and a disabled Google Drive connection state. Google OAuth and Drive file access are not configured, so the UI does not represent sign-in as successful. The `/ide` route uses the platform `MemoryFileSystem`, `DocumentModel`, and `EditorModel` for the selected bundled sample project. Its IDEA-inspired workbench includes menu/action search, resizable project tree, editable tabs, a syntax-colored text editor with line numbers and caret status, local file creation, and Problems/Terminal/Run/Debug panels. Shortcuts include `Ctrl/Cmd+P`, `Ctrl/Cmd+Shift+A`, `Ctrl/Cmd+N`, `Alt+1`, and `Alt+4`. Edits remain in page memory. The Terminal panel does not execute operating system commands, and run/debug controls do not launch a process. These are browser UI foundations, not full IntelliJ IDEA functionality.

## Plugin compatibility boundary

`frontend/src/platform/` currently provides composable browser implementations for lifetimes, services, message topics, extension and action registries, project/module ownership, an in-memory VFS, documents, editor state, and language/PSI interfaces. `PluginCatalog` validates metadata for plugin modules already included in the frontend build. It does not parse arbitrary IntelliJ descriptors or load Java/Kotlin plugin JARs.

The long-term target is selective IntelliJ Platform API compatibility through explicit adapters, with API shape and behavioral compatibility measured separately. JVM bytecode, Swing/AWT, native OS access, arbitrary process execution, and unrestricted filesystem access are not provided by a browser. See [plugin API compatibility](plugin-api-compatibility.md) for the subsystem matrix, phases, and risks. Keep new API families small, typed, tested, and honest about browser-specific behavior.

## Static deployment

The Vite production build is emitted to `frontend/dist/`. GitHub Pages or another static host can serve these files. Any feature that depends on particular HTTP headers (for example, cross-origin isolation) must be validated against the deployment host rather than assumed to work everywhere.

## Platform verification

The platform kernel uses the Node.js built-in test runner; no test framework dependency is required. From `frontend/`, run `npm run verify:platform` for lifecycle, event subscription, and model checks. `npm run lint` and `npm run build` cover the TypeScript source and static production bundle.
