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

## Original completion contributor probe (2026-10-28)

The JVM harness now invokes the unmodified `com.jetbrains.python.codeInsight.completion.PyKeywordCompletionContributor` against real Python PSI from Python CE 263.7031.23. The first zero-result runs exposed a bootstrap error in the harness: passing `PythonFileType` through `CoreApplicationEnvironment` created a `PsiPlainTextFileImpl`, so the Python contributor's PSI patterns could never match. The harness now creates the PSI file with `PythonLanguage.INSTANCE` and registers the original `PyLanguageFacadeImpl` service, alongside the original `TailTypeFactory` service and the Python registry keys. The position is set to the start of IntelliJ's `IntellijIdeaRulezzz` dummy identifier (the actual caret offset), not the end of the fixture.

Verified fixture `if TruIntellijIdeaRulezzz` returns original contributor items `[not, lambda, True, False, None]`; the PSI chain contains `PyReferenceExpressionImpl`, `PyIfPartIfImpl`, `PyIfStatementImpl`, and `PyFileImpl`. Additional contexts also return original results: inside a function body the contributor returns 32 statement/expression keywords, and after a `try` body it returns 31 candidates including `except`/`finally`. A `from os import pa…` fixture returns no items from this one contributor, as expected for a contributor focused on Python keywords rather than import members. These are successful JVM reference checks for this original contributor, not proof of the full IntelliJ completion pipeline or browser integration.

- Probe: `experiments/python-plugin/java-probes/experiment/PythonCompletionProbe.java`
- Registry metadata helper: `experiments/python-plugin/java-probes/experiment/PythonRegistryKeys.java`
- Verified: non-empty results from the original contributor in several Python PSI contexts, with the matching Python CE/platform JARs. Frontend `npm run build`, `npm run lint`, and `git diff --check` also pass.
- Superseded by the WASM completion probe below: the original contributor now runs in Web Image and is connected to the editor completion registry through a local worker adapter. The adapter is limited to the original keyword contributor; import-member completion, unresolved references, and the broader completion pipeline are not included.


## WASM completion probe follow-up (2026-10-29)

The Web Image smoke test now gets past the original dynamic-proxy registration failures after adding GraalVM reachability metadata for IntelliJ listener proxies. The probe was also decoupled from a host-only plugin descriptor directory: the required registry keys are registered directly in the isolated harness, which avoids relying on host filesystem paths inside the WASM runtime. Adding `-H:+AddAllCharsets` gets past Python parser initialization's `UTF-32BE` charset failure.

The next runtime blocker is now resource-bundle registration for the original Python parser (`messages.PyParserBundle`); the smoke test still fails before completion candidates are emitted. The probe also needs further platform registry initialization and reflective service setup. This remains a feasibility experiment only: the browser completion popup is not fixed or connected to the original contributor. Do not install the artifact into the frontend until the runtime smoke test passes and a real worker protocol is implemented.


## WASM completion probe follow-up 2 (2026-10-29)

Explicit resource-bundle options let the WASM smoke test get past the earlier `PyParserBundle` registration error. The current failure has moved further into execution and is now `jdk.graal.compiler.debug.GraalError: unimplemented override`, after Python PSI/parser initialization begins. The original contributor still works in the JVM reference probe and returns five items for `if Tru…`. The Web Image binary builds, but runtime execution does not complete, so this still does not constitute browser integration and the editor popup remains unconnected.

The experimental profile currently explicitly includes the Python parser bundle/resources and all charsets, plus reachability metadata for listener proxies. Stage logging narrows the latest failure further: `PsiFileFactory.createFileFromText(...)`, `file.findElementAt(...)`, `project.isDisposed()`, `file.getVirtualFile().isValid()`, `file.isValid()`, and one direct `ASTNode.getTreeParent()` call all complete. The failure is reproducibly triggered by `position.getContainingFile()` / `position.isValid()`. Bytecode inspection shows `SharedImplUtil.getContainingFile()` walks to the root `FileElement` and calls `FileASTNode.getPsi()`; a manual root walk succeeds, but calling `rootNode.getPsi()` itself triggers `GraalError: unimplemented override`. `FileElement` inherits the final `CompositeElement.getPsi()` implementation. That implementation first calls `ProgressIndicatorProvider.checkCanceled()`, reads the cached `myWrapper`, and on a cache miss calls the virtual `createPsiNoLock()` before caching via `AtomicReferenceFieldUpdater.compareAndSet(...)`; `FileElement` overrides `createPsiNoLock()`. I added a separate stage immediately before that lazy PSI path and confirmed that calling `ProgressIndicatorProvider.checkCanceled()` directly already throws the same `GraalError: unimplemented override`. The progress manager lookup itself succeeds and resolves to `com.intellij.openapi.progress.impl.CoreProgressManager`; its `doCheckCanceled()` override is therefore the next concrete dispatch to isolate. This is before `CompletionParameters` can finish and before `fillCompletionVariants(...)` is called. The original contributor still passes on JVM. Next inspect the `CoreProgressManager.doCheckCanceled()` call chain and map the failing virtual dispatch in Web Image; do not replace it with handwritten PSI/completion logic.

## WASM completion contributor and editor adapter (2026-10-29)

The completion WASM blocker was traced through the original IntelliJ progress/cancellation path. `DebugAttachDetectorArgs` calls `ManagementFactory.getRuntimeMXBean().getInputArguments()` and then attempts to read VM agent properties. Web Image's `WebImageJavaMainSupport.getInputArguments()` was an explicit `unimplementedOverride`, and the JDK's `VMSupport.initAgentProperties` native method was unsupported. The local, ignored GraalVM source now returns an empty argument list (the browser runtime has no JVM process command line) and substitutes agent-property initialization with an empty properties pass-through for Web Image. After that, the completion probe needed additional original platform reflection/proxy metadata and the `editor.range.marker.use.pmarker.internal` registry key. No JetBrains plugin JAR was changed.

The original `com.jetbrains.python.codeInsight.completion.PyKeywordCompletionContributor` now completes successfully in Web Image WASM GC. The harness filters lookup elements using the original prefix matcher semantics rather than returning every item emitted by the contributor. Verified runtime fixtures:

- `if Tru` at caret offset 6 returns `["True"]`.
- `def f():\n    pas` at caret offset 16 returns `["pass"]`.
- Two calls to `GraalVM.run(...)` in the same JavaScript worker context succeeded sequentially in a Node worker-context harness; each invocation creates a fresh Web Image runtime, so it does not reuse a Java main-thread instance.

A worker adapter is now in `experiments/plugin-build/templates/python-ce-completion.worker.js`; `scripts/plugin_web_build.py` supports profile-specific worker templates and generates the correct per-image WASM path. `frontend/src/platform/core/pythonCompletion.ts` compiles the 34 MiB completion module once, keeps a worker alive, tracks/cancels lookup requests, and exposes the original contributor through the existing `EditorCompletionContributorRegistry`. The bundled PythonCore plugin registers it, and `CodeEditor` already requests completion on typing and Ctrl+Space. Generated local artifacts are copied to the Git-ignored `frontend/public/plugins/pythoncore/` folder for local testing.

Verified after this integration slice:

- Profile `experiments/plugin-build/profiles/python-ce-completion.json`: `BUILD_AND_RUNTIME_TEST_PASSED`.
- Worker-context harness returned exactly `True` and `pass` for the two fixtures above.
- Python build-pipeline unit tests pass.
- Frontend platform tests, style tests, lint, and production build pass; lint reports the same 9 existing warnings and no errors.
- `git diff --check` passes.

The actual worker was also exercised in headless Firefox 159 against the local Vite server: two sequential requests returned `True` and `pass`, including the real browser Worker, `fetch`, WASM compilation, and asset URLs. This is a browser-level worker smoke test, not a test of typing into the React editor or its popup. The local browser automation interceptor is unavailable, so the React editor has **not** been verified end-to-end. The completion image is about 34 MiB and each request creates a fresh Web Image runtime, so startup latency must be measured. This integration only provides keyword completion from the original contributor. Import member completion, unresolved-reference completion, completion ranking/insert handlers, live IntelliJ editor services, and full PSI-backed inspections are not implemented by this slice. Do not claim full IntelliJ/Python CE completion parity.
