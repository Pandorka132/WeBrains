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

The root route selects local browser storage or Google Drive and lists, creates, and opens projects for the selected provider. Local files are backed by BrowserFS `AsyncMirror`, with IndexedDB as the asynchronous persistent filesystem. Drive files are fetched and uploaded through the Drive API using a token from Google Identity Services. WebBrains creates/reuses the `WebBrains` folder in Drive root, then stores each project folder under `WebBrains/projects`; project files and subfolders remain beneath their project folder. The token and expiry are stored in localStorage; Drive file contents are not written to browser storage. The landing page has a **Sign in with Google** button and does not ask end users to enter configuration. Configure `VITE_GOOGLE_CLIENT_ID` once in the build/deployment environment. Create a Google Cloud project, enable the Google Drive API, configure the OAuth consent screen, create a Web application OAuth client, and add the exact development and deployment origins as Authorized JavaScript origins. The client ID is public configuration; no client secret is used. The app requests `drive.file`. Access tokens are bearer credentials stored in localStorage with their expiry and must be re-authorized after expiry or revocation. The `/ide` route adapts each provider to the shared virtual filesystem interface and uses `DocumentModel` and `EditorModel` for open documents. Its Darcula New UI workbench includes menu/action search, resizable project tree, editable tabs, syntax-colored editor with line numbers and caret status, file creation, and Problems/Terminal/Run/Debug panels. File-name search is available through `Shift`-`Shift` and `Ctrl/Cmd+Shift+N` (this is not full IntelliJ Search Everywhere); Find Action uses `Ctrl/Cmd+Shift+A`, New File uses `Alt+Insert`, and tool windows use `Alt+1` / `Alt+4`. `Ctrl/Cmd+P` (parameter info) and text search (`Ctrl/Cmd+F`, `Ctrl/Cmd+Shift+F`) are explicitly reported as not implemented rather than pretending to perform those actions. The Terminal panel does not execute operating system commands, and run/debug controls do not launch a process. The workbench reproduces the IDE interface rather than its JVM-based execution environment.

## Active Python CE experiment

The first real-plugin target is Python CE `263.7031.23`, specifically its original lexer. A profile-driven GraalVM Web Image build currently passes a Node runtime smoke test (`LEXER_OK tokens=22`) with the original lexer and platform classes. This is a capability-level proof only: it is not a full Python CE build and is not yet wired to the editor or browser worker. The current wrapper is generated per image; a shared-runtime split has not been proven. See [`python-ce-roadmap.md`](python-ce-roadmap.md) for the current hand-off, commands, known compiler patch, artifact locations, and ordered next steps.

## Plugin compatibility boundary

`frontend/src/platform/` currently provides composable browser implementations for lifetimes, services, message topics, extension and action registries, project/module ownership, an in-memory VFS, documents, editor state, and language/PSI interfaces. `PluginCatalog` validates metadata for plugin modules already included in the frontend build. It does not parse arbitrary IntelliJ descriptors or load Java/Kotlin plugin JARs.

The long-term target is selective IntelliJ Platform API compatibility through explicit adapters, with API shape and behavioral compatibility measured separately. JVM bytecode, Swing/AWT, native OS access, arbitrary process execution, and unrestricted filesystem access are not provided by a browser. See [plugin API compatibility](plugin-api-compatibility.md) for the subsystem matrix, phases, and risks. Keep new API families small, typed, tested, and honest about browser-specific behavior.

## Static deployment

The Vite production build is emitted to `frontend/dist/`. GitHub Pages or another static host can serve these files. Any feature that depends on particular HTTP headers (for example, cross-origin isolation) must be validated against the deployment host rather than assumed to work everywhere.

## Platform verification

The platform kernel and provider contract checks use Node's built-in test runner; CSS regression checks parse the stylesheet with PostCSS. From `frontend/`, run `npm run verify:platform`, `npm run verify:styles`, `npm run lint`, and `npm run build`. BrowserFS IndexedDB durability and OAuth popup behavior still require a browser run with a valid client ID. `Ctrl/Cmd+S` flushes all open writable tabs.
