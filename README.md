# WebBrains

WebBrains is a browser-first IDE experiment. The frontend is a static React application built with Vite and TypeScript; application code runs in the browser, without a Java backend.

## Project layout

- `frontend/` — React + TypeScript + Vite application.
- `frontend/src/components/` — reusable UI components.
- `frontend/src/pages/` — page-level views.
- `frontend/src/hooks/` — reusable React hooks.
- `frontend/src/services/` — browser-side integrations and service abstractions.
- `frontend/src/styles/` — shared styles and design tokens.
- `frontend/src/utils/` — framework-independent utilities.
- `frontend/src/platform/` — browser-side, TypeScript-only foundations for selected IntelliJ Platform concepts.
- `docs/` — architecture and development notes.
- `scripts/` — project maintenance and build scripts.

## Requirements

- Node.js compatible with the installed Vite version
- npm

## Development

From the repository root:

```sh
cd frontend
npm install
npm run dev
```

The browser app has two main routes:

- `/` lets users choose browser-local or Google Drive storage, create projects, list saved projects, and open a selected project.
- `/ide` opens the WebBrains workbench for that project, with Darcula New UI styling, menus and tool windows, editable tabs, project tree, syntax-colored editor, and file/action search.

Browser-local project files use BrowserFS `AsyncMirror` with IndexedDB as the persistent backend. Because AsyncMirror queues its IndexedDB writes asynchronously, the current `Saved` indicator does not yet confirm a committed IndexedDB transaction; see the persistence caveat in [the IntelliJ audit](docs/intellij-audit.md). Google Drive projects use Google Identity Services and the Drive API; WebBrains creates/reuses `WebBrains/` in the Drive root and stores projects under `WebBrains/projects/`. Project contents are read and written directly in Drive and are never persisted in browser storage. The landing page provides a **Sign in with Google** button; users do not type a client ID. Configure the application once with the `VITE_GOOGLE_CLIENT_ID` build/deployment environment variable. Create a Google Cloud project, enable the Google Drive API, configure the OAuth consent screen, create an OAuth client of type **Web application**, and add the exact development/deployment origins under **Authorized JavaScript origins**. The client ID is public configuration; no client secret belongs in the browser. WebBrains requests the `drive.file` scope. The stored access token is a bearer credential and remains available only until Google expires or revokes it; expired sessions require authorization again. `Shift` twice or `Ctrl/Cmd+Shift+N` opens file-name search, `Ctrl/Cmd+Shift+A` opens Find Action, `Alt+Insert` creates a file, `Ctrl/Cmd+S` saves all open writable tabs, and `Alt+1` / `Alt+4` toggles the Project / Run tool windows. `Ctrl/Cmd+P` parameter info and text search shortcuts are not implemented yet. The Terminal panel is informational and does not run shell commands; run/debug controls do not launch a process.

## Checks and production build

Run these from `frontend/`:

```sh
npm run lint
npm run build
```

The static production output is written to `frontend/dist/`. No Node.js server is needed at runtime. The repository includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml` that runs lint and all test suites, builds with a repository-aware asset base, and deploys on pushes to `main`. In repository **Settings → Pages**, select **GitHub Actions** as the source. To enable Google Drive in the deployed build, add a repository variable named `VITE_GOOGLE_CLIENT_ID` and register the Pages origin in Google Cloud's Authorized JavaScript origins. The GitHub Pages build uses hash routes (for example, `/<repo>/#/ide?...`) so direct navigation works on static hosting without server rewrites. Features that require browser cross-origin isolation or special response headers must be checked against the capabilities of the chosen host.

## Plugin API compatibility

WebBrains is building toward selective IntelliJ Platform API compatibility through browser-native implementations and explicit adapters. The current platform foundation covers scoped lifetimes, services, message topics, extension/action registries, project and module models, an in-memory VFS, documents, editor state, and language/PSI interfaces. A metadata catalog can validate dependencies for plugin code already bundled into the frontend.

This does not run arbitrary IntelliJ Java/Kotlin plugin JARs and does not provide a JVM, Swing/AWT, native OS access, or unrestricted local filesystem/process APIs. Similar API shapes do not guarantee matching behavior. See [the compatibility strategy](docs/plugin-api-compatibility.md) for the subsystem support matrix, milestone order, and limitations.

The platform and routing checks use Node's built-in test runner; stylesheet regressions are checked with PostCSS. From `frontend/`, run `npm run verify:platform`, `npm run verify:styles`, `npm run verify:routing`, `npm run lint`, and `npm run build`.
