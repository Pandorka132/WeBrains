# WebBrains frontend

WebBrains is a browser-only React + TypeScript + Vite IDE experiment. It runs as a static site; there is no Java backend or Node.js runtime requirement after deployment.

## Main views

- `/` — choose local or Google Drive storage, create projects, list saved projects, and open one.
- `/ide` — the workbench with tool windows, a project tree, editable tabs, syntax-colored text editing, and file/action search.

When built for GitHub Pages, the Vite base is derived from `GITHUB_REPOSITORY` and internal routes use hashes so the app works under a repository subpath without server-side rewrites.

## Development

```sh
npm ci
npm run dev
```

## Google Drive

Set `VITE_GOOGLE_CLIENT_ID` at build time to enable Drive sign-in. The client ID is public configuration; never put a client secret in the frontend. Configure a Google Cloud OAuth client for the exact development/deployment origin, enable the Drive API, and use the `drive.file` scope. Drive access tokens are bearer credentials stored in `localStorage` until Google expires or revokes them.

## Shortcuts and limitations

- `Shift` twice or `Ctrl/Cmd+Shift+N` — file-name search (not full IntelliJ Search Everywhere).
- `Ctrl/Cmd+Shift+A` — Find Action.
- `Alt+Insert` — New File.
- `Ctrl/Cmd+S` — save all open writable tabs.
- `Alt+1` / `Alt+4` — Project / Run tool windows.

The Terminal panel is informational and does not run shell commands. Run/debug controls do not execute local processes. Parameter info, text search, full PSI, inspections, refactoring, and arbitrary IntelliJ Java/Kotlin plugin loading are not implemented.

## Verification and build

```sh
npm run lint
npm run verify:platform
npm run verify:styles
npm run verify:routing
npm run build
```

Production output is written to `dist/`. The repository-level `.github/workflows/deploy-pages.yml` builds and deploys to GitHub Pages on pushes to `main`; set **Settings → Pages → Source** to **GitHub Actions** and add the repository variable `VITE_GOOGLE_CLIENT_ID` if Drive access is needed.
