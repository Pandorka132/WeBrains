# Python Community Edition: current status and roadmap

**Last verified:** 2026-10-19  
**Scope:** Python Community Edition plugin `263.7031.23`, IntelliJ build `263.7031.*`  
**Current goal:** turn one real, unmodified Python CE capability into a browser-consumable language service for WebBrains. This is not yet a port of the complete plugin.

This file is the current hand-off point for future sessions. Read it before continuing the Python CE experiment. Historical compiler attempts and their logs remain in [the detailed experiment log](../experiments/python-plugin/README.md).

## Current verified result

**The original Python CE lexer compiles to WebAssembly GC and passes its Node smoke test. Its worker adapter is connected to the editor syntax layer, but real browser/Worker validation is still pending. The WebBrains platform now has a dependency-aware runtime for statically bundled browser plugins, plugin-contributed project templates, a language metadata/diagnostic registry, an ordered platform editor-key-handler registry, a platform auto-closing-pair engine configured by the Python language service from the inspected Python CE brace/quote handlers, and a diagnostic range/rendering contract. Enter/Tab now dispatch through the platform API; Python CE contributes a transitional regex-based Enter handler, not the original `PythonEnterHandler`. The editor wavy-underlines original lexer tokens classified as `BAD_CHARACTER` or `INCONSISTENT_DEDENT` and converts those tokens into ranged error diagnostics. The first completion slice now presents identifiers emitted by the original Python CE lexer from the current file, with a popup navigable by arrows and accepted by Enter/Tab or click; Ctrl+Space requests completion explicitly. This is lexical current-file word completion only, not Python CE's PSI/type/import-aware completion contributors. Grammar-level diagnostics and semantic analysis remain unavailable in the browser until the original parser/PSI dependency closure runs there. **The original Python CE parser now runs on the JVM probe** after initializing a real IntelliJ `MockApplication`, registering the real `PyElementTypesFacadeImpl` service, registering the declared Python dialect-token extension point, and using the original `PythonParserDefinition` and `PyParser`. The valid fixture returns zero parser errors; `if True print(1)` returns a real parser error range. The experimental WebAssembly build of this parser probe is currently blocked during GraalVM analysis by an `Incorrect single abstract method logic` failure involving IntelliJ `RefHashMap$Key`. This reproduces with both the locally patched GraalVM 25.4.4.1.1 compiler and the 25.5.5-dev master build; no compiler workaround was added. Therefore grammar-level diagnostics are verified only in the JVM experiment, not in the browser editor.

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

## Build pipeline and important paths

- Pipeline: `scripts/plugin_web_build.py`
- Profile: `experiments/plugin-build/profiles/python-ce-lexer.json`
- Build/test documentation: `experiments/plugin-build/README.md`
- Java probe: `experiments/python-plugin/teavm-poc/src/main/java/experiment/LexerProbe.java`
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
5. **Port the JVM parser bootstrap into a browser-compatible runtime.** The probe now runs the original `PythonParserDefinition`/`PyParser` on the JVM with the real `PyElementTypesFacadeImpl` and the three real dialect-token contributors registered. The matching `plugin.xml` declares `Pythonid.dialectsTokenSetContributor` and the service implementation. The WebAssembly build currently fails earlier in GraalVM analysis on `Incorrect single abstract method logic` for `RefHashMap$Key`; investigate that compiler failure without substituting parser logic or fake IntelliJ services. Only after a valid Wasm runtime test should parser error ranges be connected to the existing editor diagnostic contract. PSI-backed annotators, inspections, completion, and the user-facing Python execution runtime (Pyodide) remain separate capabilities.
6. **Keep tests and docs current.** Re-run the pipeline, Python unit tests, frontend platform/style/routing checks, lint, typecheck/build, and `git diff --check` after relevant changes.

## Non-goals / guardrails

- No server-side Java; the deployed WeBrains app remains a static browser application.
- Do not modify the original JetBrains plugin JARs.
- Do not label a lexer-only proof as “Python CE support” without qualification.
- Do not silently substitute handwritten tokenization, fake IntelliJ classes, or unapproved compatibility workarounds for original behavior.
- Do not push to GitHub or publish the local GraalVM compiler patch unless explicitly asked.
- Keep large downloaded archives, platform JARs, compiler builds, generated Wasm, and diagnostics out of Git unless there is a deliberate, reviewed reason to track them.
