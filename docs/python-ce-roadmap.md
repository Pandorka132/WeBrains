# Python Community Edition: current status and roadmap

**Last verified:** 2026-10-20
**Scope:** Python Community Edition plugin `263.7031.23`, IntelliJ build `263.7031.*`  
**Current goal:** turn one real, unmodified Python CE capability into a browser-consumable language service for WebBrains. This is not yet a port of the complete plugin.

This file is the current hand-off point for future sessions. Read it before continuing the Python CE experiment. Historical compiler attempts and their logs remain in [the detailed experiment log](../experiments/python-plugin/README.md).

## Current verified result

**The original Python CE lexer compiles to WebAssembly GC and passes its Node smoke test. Its worker adapter is connected to the editor syntax layer, but real browser/Worker validation is still pending. The WebBrains platform now has a dependency-aware runtime for statically bundled browser plugins, plugin-contributed project templates, a language metadata/diagnostic registry, an ordered platform editor-key-handler registry, a platform auto-closing-pair engine configured by the Python language service from the inspected Python CE brace/quote handlers, and a diagnostic range/rendering contract. Enter/Tab now dispatch through the platform API; Python CE contributes a transitional regex-based Enter handler, not the original `PythonEnterHandler`. The editor wavy-underlines original lexer tokens classified as `BAD_CHARACTER` or `INCONSISTENT_DEDENT` and converts those tokens into ranged error diagnostics. The editor now has a language-scoped plugin completion-contributor hook modeled on IntelliJ's `com.intellij.completion.contributor` extension point. The earlier hand-built current-file identifier source, pseudo-icons/details, and custom menu footer were removed because they did not come from the original Python completion implementation. No Python completion contributor is registered until the original PSI/context-dependent implementation can be ported accurately; the editor does not fabricate candidates. Diagnostic underlines now expose a styled hover summary with severity, message, and source; the Problems tool window lists active-file diagnostics, updates its count, and navigates the editor caret to a selected problem. The original `PyCompletionConfidence` and `PyKeywordCompletionContributor` were inspected; their PSI-context behavior is not approximated with a global handwritten keyword list. The original parser now runs in the Wasm experiment, but the browser editor is not wired to consume its PSI diagnostics yet; semantic inspection remains blocked on loading the real Python plugin registry metadata. **The original Python CE parser now runs on the JVM probe** after initializing a real IntelliJ `MockApplication`, registering the real `PyElementTypesFacadeImpl` service, registering the declared Python dialect-token extension point, and using the original `PythonParserDefinition` and `PyParser`. The valid fixture returns zero parser errors; `if True print(1)` returns a real parser error range. The first experimental WebAssembly build of this parser probe was blocked during GraalVM analysis by an `Incorrect single abstract method logic` failure involving IntelliJ `RefHashMap$Key`. A local, ignored GraalVM source change added a JLS 9.8 fallback for the three overridable `Object` method signatures; rebuilding the local compiler moved the profile past analysis and emitted Wasm. The original parser now runs in WebAssembly GC: the valid fixture reports `PARSER_OK errors=0`, and `if True print(1)` reports the original parser's error range `8..16`. The standalone `AtomicReferenceFieldUpdater.newUpdater()` probe and Kotlin `SupervisorJob()` probe now both pass in WebAssembly GC after a local GraalVM source change in `substratevm/.../RecomputedFields.java`: when Web Image's caller-sensitive API returns `null`, the JDK updater substitution skips only the caller-based access check while retaining field/type/volatile validation and offset setup. A separate Web Image compiler gap discovered while expanding the PSI harness was also fixed locally by mapping `UNSTRUCTURED_LOCKING` to an `IllegalMonitorStateException` support method. The custom Web Image compiler was rebuilt successfully. The original Python CE parser now passes in Wasm: a valid fixture returns `PARSER_OK errors=0`, and `if True print(1)` returns the original parser error range `8..16`. The new real-inspection harness now gets as far as the original `TypeEvalContextFactoryImpl`, but stops because the plugin's declared registry key `python.optimized.type.eval.context` has not been loaded by the minimal bootstrap. This is a missing plugin-descriptor/registry initialization step, not a passing semantic-inspection test. `asd()` is **not yet confirmed** by the original `PyUnresolvedReferencesInspection` in Wasm. Do not add a handwritten name resolver or fake inspection.

Reproduce from the repository root:

```sh
python3 scripts/plugin_web_build.py experiments/python-plugin/python-ce-263.7031.23.zip --install-frontend
python3 -m unittest discover -s experiments/plugin-build/tests -v
cd frontend && npm run build && npm run lint && npm run verify:platform && npm run verify:styles && npm run verify:routing
```

Latest recorded successful run:
`experiments/plugin-builds/PythonCore/263.7031.23/run-20261019T192843Z/`

- JavaScript wrapper: `web/python-ce-lexer.js` (~108 KiB).
- Wasm GC module: `web/python-ce-lexer.js.wasm` (~9.55 MiB).
- Runtime assertion: `LEXER_OK tokens=22`.
- Inventory status: `BUILD_AND_RUNTIME_TEST_PASSED`.
- The probe calls the original Python CE lexer and original IntelliJ Platform/Python classes. No JetBrains plugin JAR was patched, and no fake replacement IntelliJ class was introduced.
- A separate Node harness verified a source string produces structured `type`, `start`, `end`, and `text` fields, plus a completion message.
- `--install-frontend` copies generated files into the Git-ignored `frontend/public/plugins/pythoncore/` directory for local frontend testing.
- `frontend/src/components/CodeEditor.tsx` requests original lexer tokens for `.py` files and renders supported token categories; the existing regex highlighter remains the fallback while a real lexer result is unavailable.
- Each tokenization request uses a fresh worker and Web Image invocation. Re-entering Java `main()` in the same Wasm instance caused `Fatal error: overwriting existing java.lang.Thread`, so the adapter deliberately does not reuse that instance.
- The test tokenizes the original lexer fixture and expects 22 tokens, including keyword and f-string tokens. No JetBrains plugin JAR was patched and no fake replacement IntelliJ class was introduced.

This verifies the specific lexer probe and its single-invocation adapter under Node. It does **not** yet prove browser worker loading, deployed static-host paths, complete Python CE support, IntelliJ PSI, or full editor integration in a real browser.

## Editor syntax diagnostics (2026-10-20)

The Python language service now runs CPython's built-in `compile(source, '<editor>', 'exec')` through the project's Pyodide module worker and converts `SyntaxError` line/column coordinates into editor UTF-16 offsets. The worker is separate from foreground execution so syntax analysis cannot consume a run's stdin or output messages. Diagnostics are debounced and cancelled when the source changes; stale worker replies are ignored.

The Problems tool window shows current-file severity totals, file path, message, source, and line/column. Selecting a problem navigates the caret; the editor also marks diagnostic lines in the gutter and exposes the existing underline/hover details. This is **Python syntax checking**, not a port of IntelliJ's PSI annotators, inspections, type checker, or project-wide Problems analysis. Browser execution of the Pyodide worker has not yet been verified end-to-end because the local browser automation bridge is unavailable.

## Python run configurations and execution (2026-10-20)

The first browser execution slice is implemented separately from the IntelliJ Python CE lexer/parser experiment. Read [the Python execution design and limitations](./python-execution.md) for the platform execution API, PythonCore run configuration, pinned Pyodide version, Worker lifecycle, project VFS synchronization, console/stdin behavior, hosting requirements, and verification status. Build and unit checks pass, but an end-to-end browser run is still unverified; do not describe this as full IntelliJ process/debugger parity.

## Build pipeline and important paths

- Pipeline: `scripts/plugin_web_build.py`
- Profile: `experiments/plugin-build/profiles/python-ce-lexer.json`
- Build/test documentation: `experiments/plugin-build/README.md`
- Java probe: `experiments/python-plugin/java-probes/experiment/LexerProbe.java`
- Original Python CE distribution: `experiments/python-plugin/python-ce-263.7031.23.zip` (local ignored third-party artifact)
- Matching IntelliJ platform JARs: `experiments/python-plugin/artifacts/.tools/idea-platform/` (local ignored artifacts)
- Shared extracted-JAR/compiler cache: `experiments/python-plugin/artifacts/.tools/plugin-build-cache/`
- GraalVM source checkout and local compiler fix: `experiments/python-plugin/artifacts/.tools/graalvm-source/`
- Reflection config: `experiments/python-plugin/artifacts/.tools/graalvm-webimage-varhandle-probe/reflection-config.json`
- Build outputs/reports: `experiments/plugin-builds/PythonCore/263.7031.23/run-<UTC timestamp>/`

The build tool is profile-driven. It can inspect an unknown plugin archive and write an inventory, but it must not claim to compile arbitrary plugins without a tested profile. Unknown plugin ID: inventory plus `BUILD_BLOCKED.md`, exit code 3. Generated builds are ignored by Git and timestamped; old runs are retained rather than deleted automatically.

## Compiler findings and constraints

- TeaVM 0.16.0 with JDK 25 did not complete the original lexer build because of unsupported JDK API usage (`MethodHandle.invokeExact`, `Class.isAnonymousClass`). No workaround was added.
- GraalVM Web Image initially built the lexer module but failed at runtime during IntelliJ token type initialization. The failure was traced to missing reflection metadata for `com.intellij.concurrency.VarHandleWrapperImpl.useVarHandlesInConcurrentCollections()`.
- Registering the needed reflection metadata exposed a separate GraalVM Web Image Wasm GC compiler bug: floating-point `VarHandle.compareAndSet` was lowered through an integer-only comparison path.
- A local, unpushed patch to the GraalVM source reinterprets float/double CAS operands as same-width integers before comparison, preserving raw-bit behavior (including signed zero and NaN payloads). The added `VarHandleDoubleCASRegressionTest` passes, and the Python CE lexer smoke test passes with the patched compiler.
- GraalVM source branch/commit: `fix-wasmgc-floating-point-cas-master`, local commit `99d32d7a3f`. It is under ignored local tooling, not part of the WeBrains repository, and has not been pushed. Do not create a PR or push without explicit approval.
- Current profile excludes platform JAR names containing `ijent`, `netty`, and `sqlite` based on observed image-build initialization failures. Treat these as explicit constraints for this probe, not generic plugin build rules.
- GraalVM Web Image emits both a generated JavaScript wrapper and `.js.wasm`. The wrapper includes runtime integration and generated program/bootstrap code. It has **not** been proven safe to replace all generated wrappers with one shared runtime yet.
- Do not treat `.wasm` as a standalone executable: the tested output currently uses the generated JavaScript wrapper to initialize and run it.

## Next steps (in order)

1. **Prove browser execution.** Test the worker in a real browser, including Wasm asset loading under both root and subpath hosting. Node verifies the single-invocation API, but not browser fetch/Worker behavior.
2. **Validate editor integration.** Confirm token ranges align with textarea offsets; test stale responses, edits, file switches, worker errors, and fallback highlighting in a browser.
3. **Measure per-edit cost.** The current safe design creates a fresh worker and Wasm runtime for each debounced source update because repeated Java `main()` calls in one instance fail. Measure startup latency before deciding whether a supported reusable API is possible.
4. **Keep the runtime artifact model honest.** Inspect generated Web Image output and establish whether common runtime code can be separated from per-image bootstrap/generated code. Do not discard per-plugin `.js` until a multi-module proof passes.
5. **Port the JVM parser bootstrap into a browser-compatible runtime.** The probe now runs the original `PythonParserDefinition`/`PyParser` on the JVM with the real `PyElementTypesFacadeImpl` and the three real dialect-token contributors registered. The matching `plugin.xml` declares `Pythonid.dialectsTokenSetContributor` and the service implementation. The original parser now compiles to Wasm with a local compiler-source change, but runtime initialization still fails inside `MockApplication` with an `ExceptionInInitializerError` caused by `NullPointerException`. Continue isolating/fixing the generic Web Image `AtomicReferenceFieldUpdater.newUpdater()` runtime failure (also reproduced with a standalone `volatile Object` field) before retrying the original parser, without substituting parser logic or fake IntelliJ services. Only after a valid Wasm runtime test should parser error ranges be connected to the existing editor diagnostic contract. PSI-backed annotators, inspections, completion, and the user-facing Python execution runtime (Pyodide) remain separate capabilities.
6. **Keep tests and docs current.** Re-run the pipeline, Python unit tests, frontend platform/style/routing checks, lint, typecheck/build, and `git diff --check` after relevant changes.

## Non-goals / guardrails

- No server-side Java; the deployed WeBrains app remains a static browser application.
- Do not modify the original JetBrains plugin JARs.
- Do not label a lexer-only proof as “Python CE support” without qualification.
- Do not silently substitute handwritten tokenization, fake IntelliJ classes, or unapproved compatibility workarounds for original behavior.
- Do not push to GitHub or publish the local GraalVM compiler patch unless explicitly asked.
- Keep large downloaded archives, platform JARs, compiler builds, generated Wasm, and diagnostics out of Git unless there is a deliberate, reviewed reason to track them.
