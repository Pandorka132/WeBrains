# React + TypeScript + Vite

WebBrains is a browser-only IDE experiment, built as a static React + TypeScript + Vite application.

## Routes and current UI

- `/` displays the project picker and Google Drive connection state. OAuth and Drive access are not configured, so the connect control is disabled and clearly labeled.
- `/ide` displays the IDEA-inspired browser workbench for the selected in-memory sample project, with menus, project tree, editable tabs, syntax-colored editor, action/file search, and Problems/Terminal/Run/Debug panels.

Files and edits remain in page memory. Use `Ctrl/Cmd+P` for files, `Ctrl/Cmd+Shift+A` for actions, `Ctrl/Cmd+N` for a new file, and `Alt+1` / `Alt+4` to toggle tool windows. The Terminal panel does not run shell commands, and run/debug controls do not launch local processes.

Run `npm run dev` to start the development server. The verification commands are `npm run verify:platform`, `npm run lint`, and `npm run build`.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
