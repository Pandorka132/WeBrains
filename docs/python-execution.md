# WeBrains Python execution: first implementation

**Status:** implementation, TypeScript/build/unit checks, and a real Firefox browser smoke test pass. The browser test created a local Python project, launched its saved run configuration, and observed `Hello World` followed by exit code `0`.

## Architecture

- The platform execution contract lives in `frontend/src/platform/core/execution.ts`. It defines plugin-contributed run configuration types, executor registration, validation, project-scoped configuration persistence, argument tokenization, execution events, stdin responses, and foreground-run lifecycle management.
- The bundled Python CE 263.7031.23 descriptor was inspected inside `python-ce/lib/python-ce.jar`: `META-INF/plugin.xml` registers `com.jetbrains.python.run.PythonConfigurationType`, `com.jetbrains.python.run.PythonRunner`, and `com.jetbrains.python.run.PythonRunConfigurationProducer`. WeBrains models that separation as a plugin-contributed configuration type plus executor; the producer's editor/file-context behavior is currently a narrower adaptation.
- `PythonCore` contributes the `python-ce.run` configuration type and `python-ce.pyodide` executor through the existing plugin activation context. Python-specific behavior is not registered directly by the IDE page.
- `frontend/src/platform/core/pythonExecution.ts` snapshots supported project text files from the virtual filesystem and starts a module Worker. Environment files named `.env` or `.env.*` are deliberately excluded from the snapshot; the assistant must not inspect their contents.
- `frontend/src/platform/core/pyodideVersion.ts` pins the runtime version and CDN index URL in one place. `frontend/src/platform/core/pyodide.worker.ts` loads the official [Pyodide 314.0.7 ESM distribution](https://pyodide.org/en/stable/usage/quickstart.html) from jsDelivr, mounts project files in Pyodide's virtual filesystem, sets `sys.argv` and the working directory, loads packages discoverable from project Python imports, and forwards stdout/stderr and completion status.
- One Worker/interpreter is warmed in the background when the project workspace opens and reused for later runs. The first project open or first run pays the Pyodide startup cost; subsequent runs avoid reloading the runtime. Each run refreshes the virtual project filesystem, evicts project-local modules from `sys.modules`, resets `sys.path`/stdin, and updates argv/cwd/stdout/stderr. Unchanged Python source files are not rescanned for package imports on every run. A 90-second initialization timeout reports a visible error. Stopping a running program terminates its Worker so execution can be interrupted; the next run then initializes a fresh runtime.
- The IDE stops the active execution during component cleanup instead of permanently disposing the manager; React StrictMode replays effect cleanup/setup in development, so permanent disposal there would leave the next Run click attached to a dead manager. Python syntax diagnostics also return the last Python expression explicitly so valid files do not trigger JSON parsing errors.
- Run configurations are stored at `.run/webrains-run-configurations.json` through the project VFS, so local BrowserFS and Google Drive providers own persistence. The selected configuration ID is a UI preference; it does not contain source or secret data.

## Currently implemented configuration fields

- Configuration name (initially suggested from the selected script's basename, matching PythonRunConfiguration's suggested-name behavior).
- Run target: project-relative script path (`.py` file) or qualified module name (`python -m` semantics).
- Program arguments, parsed into argv without invoking an OS shell or shell expansion.
- Project-relative working directory; empty or `.` means the project root.
- Optional stdin redirection from a project-relative text file. `.env`/`.env.*` and recognized binary files are intentionally not exposed to the runtime.

The configuration validates the script, working directory and argument quoting before a run. The editor saves open writable files before launching. The existing Run tool window receives output and status and offers rerun, stop, configuration selection/editing, and an input entry when stdin is available. Debug is intentionally disabled because there is no debugger backend.

## Browser-specific constraints and parity gaps

- Pyodide is a browser interpreter, **not** a native Python process. Native subprocesses, arbitrary OS shell commands, local system interpreters and native debugger attachment are not provided.
- Interactive `input()` requires `SharedArrayBuffer`, which in turn requires a cross-origin-isolated document. The UI reports when stdin is unavailable. This generally requires response headers `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`) on the hosting origin. Do not enable these globally without testing the Google Drive popup OAuth flow: COOP `same-origin` can sever popup opener communication. The current app does not silently change deployment headers.
- Pyodide runtime assets and packages load from the pinned jsDelivr release, so the first run requires network access and a deployment Content Security Policy that permits the Worker module and that CDN. A fully self-hosted runtime is a separate deployment choice.
- Module targets and redirected text-file stdin are implemented. Environment-variable editing is intentionally omitted until there is a secret-safe storage model: configuration records are persisted in the project VFS and may be shared with the project, so adding raw environment values now could leak secrets. Terminal emulation, command-line-after-run, native process integration, and Debug are also not implemented. The worker maps Python `SystemExit` to an exit code and reports Python failures through stderr/status rather than pretending it has a native OS process.
- Python CE's full IntelliJ PSI, interpreter/SDK management, run-configuration XML, debugger, and process-handler implementation are not ported. This is an intentionally narrow browser adaptation, not binary compatibility with arbitrary IntelliJ plugins.

## Verification

From `frontend/`:

```sh
npm run build
npm run verify:platform
npm run verify:styles
npm run verify:routing
npm run lint
```

These checks validate compilation, plugin registration, configuration persistence/validation, argument parsing, environment-file exclusion, and the existing UI/style contracts. A local Firefox smoke test previously verified the real Worker/CDN runtime path for `print("Hello World")`, exit code `0`, and a clean browser console. Persistent-worker reuse and project-state refresh should also be exercised in the browser after this change. Broader browser coverage is still needed for tracebacks, third-party imports, arguments, working directory, Stop, and (on a cross-origin-isolated host) `input()`.
