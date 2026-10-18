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

- `/` is the project landing page. It offers three selectable sample projects and a clearly disabled Google Drive connection control while OAuth and Drive access remain unconfigured.
- `/ide` opens the browser-only WebBrains workbench with the selected in-memory sample project, IDEA-inspired menus and tool windows, editable tabs, project tree, syntax-colored text editor, file/action search, and local tool panels.

The sample project is temporary browser memory. Editing and save actions do not write to Google Drive or the host filesystem. `Ctrl/Cmd+P` searches files, `Ctrl/Cmd+Shift+A` searches available actions, `Ctrl/Cmd+N` creates a file, and `Alt+1` / `Alt+4` toggle the project and bottom tool windows. The Terminal panel is informational and does not run shell commands; run/debug controls are interface placeholders until a browser preview/runtime is configured.

## Checks and production build

Run these from `frontend/`:

```sh
npm run lint
npm run build
```

The static production output is written to `frontend/dist/`. It can be deployed to static hosting such as GitHub Pages; no Node.js server is needed at runtime. Features that require browser cross-origin isolation or special response headers must be checked against the capabilities of the chosen host.

## Plugin API compatibility

WebBrains is building toward selective IntelliJ Platform API compatibility through browser-native implementations and explicit adapters. The current platform foundation covers scoped lifetimes, services, message topics, extension/action registries, project and module models, an in-memory VFS, documents, editor state, and language/PSI interfaces. A metadata catalog can validate dependencies for plugin code already bundled into the frontend.

This does not run arbitrary IntelliJ Java/Kotlin plugin JARs and does not provide a JVM, Swing/AWT, native OS access, or unrestricted local filesystem/process APIs. Similar API shapes do not guarantee matching behavior. See [the compatibility strategy](docs/plugin-api-compatibility.md) for the subsystem support matrix, milestone order, and limitations.

The platform foundation uses Node's built-in test runner. From `frontend/`, run `npm run verify:platform`, `npm run lint`, and `npm run build`.
