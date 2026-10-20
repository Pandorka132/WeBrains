# Python Community Edition compatibility experiment

This folder isolates the first plugin compatibility investigation for WebBrains.

> **Current hand-off:** read [`../../docs/python-ce-roadmap.md`](../../docs/python-ce-roadmap.md) first. It records the latest verified result, reproducible commands, compiler patch, exact artifact paths, guardrails, and ordered next steps. The sections below retain the historical investigation log; older statements about the lexer failing in Wasm were superseded by the successful GraalVM Web Image run recorded on 2026-10-19. The 2026-10-20 parser-probe update further isolates the current parser Wasm startup failure to `SupervisorJob` / `JobSupport` initialization; see the roadmap for the staged test evidence.

## Automated plugin-to-browser build

The profile-driven build/test pipeline is documented in [`../plugin-build/README.md`](../plugin-build/README.md). Once the local patched GraalVM Web Image build and matching IntelliJ platform JARs are available, the Python CE lexer profile can be run from the repository root with:

```sh
python3 scripts/plugin_web_build.py experiments/python-plugin/python-ce-263.7031.23.zip
```

It generates a timestamped browser artifact under `experiments/plugin-builds/PythonCore/263.7031.23/`, then runs the Wasm GC output under Node and asserts `LEXER_OK tokens=22`. Add `--install-frontend` to copy the generated runtime and worker into the ignored frontend public directory for local editor testing. The structured-token API is verified under Node, but real-browser Worker execution is still pending. This is a tested lexer capability, not a build of the complete Python CE plugin.

## Input

The archive `python-ce-263.7031.23.zip` is the supplied JetBrains Python Community Edition distribution. It lives in this experiment folder and is excluded from Git because it is a large third-party artifact.

## Reproduce the metadata inspection

From the repository root:

```sh
python3 experiments/python-plugin/inspect_plugin.py
```

The script uses only Python's standard library. It reads the nested plugin JAR and its `META-INF/plugin.xml` descriptor in memory, without unpacking the whole distribution or running plugin code.

Additional inspection helpers:

```sh
python3 experiments/python-plugin/inventory_classes.py
python3 experiments/python-plugin/extract_core_jars.py
```

`inventory_classes.py` lists bundled JARs and searches for lexer/parser-related class names. `extract_core_jars.py` extracts only four language JARs into the Git-ignored `artifacts/` directory for local bytecode inspection with tools such as `javap`.

## Initial findings

- The archive is approximately 76 MB compressed and contains 9,033 entries.
- It contains 98 module JARs plus 8,934 files under `python-ce/helpers/`.
- The plugin descriptor identifies Python Community Edition version `263.7031.23` and targets IntelliJ build `263.7031.*`.
- The descriptor declares 95 plugin modules. Five modules are marked as required: `intellij.python.community.common`, `intellij.python.parser`, `intellij.python.ast`, `intellij.python.syntax.core`, and `intellij.python.syntax`.
- The plugin depends on IntelliJ Platform modules and services. Even the required parser/syntax modules depend on platform APIs, so they are not standalone parser JARs.
- The parser module contains `PythonLexer`, the generated `_PythonLexer`, `PythonHighlightingLexer`, and `PythonParser`. This is a promising place to focus, but the original classes are not self-contained: `PythonLexer` extends IntelliJ's `FlexAdapter`; `_PythonLexer` returns IntelliJ `IElementType` values and calls `PyTokenTypes` / `PyLexerFStringHelper`; the latter uses IntelliJ `Stack` and PSI token types. The full parser takes IntelliJ `SyntaxTreeBuilder` and `IElementType` as inputs.
- A practical first target is therefore **lexical analysis only**, not the full IntelliJ PSI parser. The generated lexer may be reusable algorithmically, but it needs a compatibility layer for token types and IntelliJ lexer interfaces. That layer must be small and explicit; simply loading the JAR in WebAssembly will not make IntelliJ APIs available.
- Upstream source: https://github.com/JetBrains/intellij-community/tree/master/python
- Upstream plugin descriptor: https://github.com/JetBrains/intellij-community/blob/master/python/pluginCore/resources/META-INF/plugin.xml

## Compatibility hypothesis

Treat this as a staged compatibility test, not as an assumption that the entire plugin will work unchanged:

1. Parse the original plugin metadata and build a module/dependency inventory.
2. Select one small, frontend-oriented capability (ideally Python file type, lexer/parser, or syntax highlighting) and trace its transitive dependencies.
3. Check whether those dependencies can be represented in the WebBrains browser platform.
4. Test the original Python CE lexer with TeaVM WebAssembly GC and the matching IntelliJ Platform JARs.
5. Expand to parser/AST only after the lexer works in Wasm; keep running user Python code separate from IDE/plugin code (Pyodide remains the intended browser-side execution runtime).

## Important technical risk

TeaVM performs ahead-of-time compilation; it is not, by itself, a JVM that can freely load arbitrary, previously unknown plugin JARs at runtime. A plugin compiled into Wasm must be included in the build-time program, and the reachable API surface must be supported by TeaVM and its class library. The Python CE distribution depends on a large IntelliJ Platform API surface, so loading the full original plugin unmodified is **not yet demonstrated** and may require substantial platform compatibility work.

## Ahead-of-time compiler probe (2026-10-19)

A reproducible TeaVM probe lives in `teavm-poc/`. It initializes the original `com.jetbrains.python.PyNames` class from the extracted parser module, so this is not just a hand-written Hello World and does not inline only a compile-time constant.

Prerequisites: JDK 25, Maven, the supplied Python CE ZIP, the extracted Python CE JARs, and the matching IntelliJ Platform JARs. The matching IDEA 2026.3 EAP 7 archive is `artifacts/.tools/idea-263.7031.23.tar.gz`; its platform JARs are extracted to the Git-ignored `artifacts/.tools/idea-platform/` folder.

```sh
python3 experiments/python-plugin/extract_core_jars.py
mvn -f experiments/python-plugin/teavm-poc/pom.xml package
```

The selected target is WebAssembly GC. The earlier `PyNames`-only probe established that a small part of the original plugin can compile to Wasm; JavaScript is not the target for the current test.

Observed on this machine with TeaVM 0.16.0 and JDK 25:

- Earlier `PyNames`-only WebAssembly GC build succeeded: 335 classes / 2,378 methods, output module 139,532 bytes. This was not the lexer or full plugin.
- Node's WebAssembly validator accepted the generated module. It imports TeaVM JavaScript runtime functions, so the `.wasm` file is **not** a standalone executable and this validation alone does not prove browser runtime execution.

A JWebAssembly 0.4 trial was also attempted against the same original class and current Kotlin standard library. Its bytecode/annotation parser emitted errors such as `Unknown annotation value type pool type: 99` while scanning Kotlin classes and produced only a 76-byte WASM file. That output is not accepted as a successful plugin compilation. The published 0.4 artifact is from 2022; this is a concrete incompatibility with the current dependency set, not proof that every possible JWebAssembly input fails.

### Real lexer test with the matching platform build (2026-10-19)

The matching IntelliJ IDEA 2026.3 EAP 7 archive was downloaded from JetBrains and its 480 top-level platform JARs (about 760 MB extracted) were placed under the ignored `artifacts/.tools/idea-platform/` directory. Archive SHA-256: `df285d7f73081d7e184254b1cd054b8d8a6ed98397a3e63fa845688b0695e124`.

`java-probes/experiment/LexerProbe.java` calls the original `com.jetbrains.python.lexer._PythonLexer`, `PythonLexerKind`, and IntelliJ `IElementType`; no plugin JAR was patched and no fake IntelliJ class was created.

- **JVM reference test: passed.** The original lexer tokenized `def greet(name): return f'Hello, {name}!'` and produced 22 tokens, including the function keyword and f-string fragment tokens.
- **TeaVM WebAssembly GC test: not yet successful.** The build reaches the original lexer and resolves the genuine platform classes, but fails on unsupported JDK API calls: `java.lang.invoke.MethodHandle.invokeExact(Ljava/lang/reflect/Field;)J` and `java.lang.Class.isAnonymousClass()Z`. These are TeaVM/class-library compatibility blockers, not missing Python CE source files. TeaVM issue [#996](https://github.com/konsoletyper/teavm/issues/996) documents the same `Class.isAnonymousClass()` failure. A `.wasm` emitted with compiler errors is not considered a working build.
- The full plugin is still not compiled or running in Wasm. The next decision is whether to investigate an official TeaVM extension/class-library path for these APIs or evaluate a different Wasm compiler/runtime. No workaround or replacement API has been added.

## GraalVM Web Image trial (2026-10-19)

GraalVM Web Image was evaluated as an alternative to TeaVM. Oracle GraalVM 25.4.4 was installed through SDKMAN because the earlier GraalVM version was too old for Web Image. **The previous default-JDK restoration claim was incorrect:** this workstation currently resolves `java` to Oracle GraalVM 25.4.4; SDKMAN's 25.0.3 installation was not found when checked. Do not assume the prior default has been restored. Binaryen 133 is stored under the Git-ignored `artifacts/.tools/binaryen/` folder. The generated outputs are also under `artifacts/.tools/` and are not tracked by Git.

- **Web Image smoke test: passed.** A Java `HelloWasm` class compiled to `hellowasm.js` plus `hellowasm.js.wasm`; Node executed it and printed `GRAAL_WEBIMAGE_OK result=7`.
- **Original Python CE plugin class probe: passed.** The unmodified `com.jetbrains.python.PyNames` and `PythonLexerKind` classes compiled to Wasm and ran under Node, printing `Python CE PyNames initialized; string types=2; lexer kind=REGULAR`. This is a real plugin class, not a substitute implementation.
- **Original Python CE lexer: Wasm build passed, runtime test still fails.** GraalVM generated a 9.08 MiB Wasm module for `experiment.LexerProbe` (using the matching IDEA platform JARs, excluding unrelated Netty/SQLite/IJent JARs that triggered image-build initialization errors). At runtime, the original `_PythonLexer` constructs and resets successfully, but token-type initialization fails: directly reading the original `PyTokenTypes.DEF_KEYWORD` already throws `ExceptionInInitializerError`, caused by a `NullPointerException` in the Wasm runtime. The JVM reference test still passes with 22 tokens. This narrows the blocker to initialization of the original IntelliJ/Python token-type classes; the exact failing initializer is not yet isolated, so this is **not** counted as a working Wasm lexer.
- GraalVM Web Image is still experimental and produces a JavaScript runtime wrapper alongside the Wasm module. The plugin bytecode is compiled to Wasm; the wrapper supplies runtime integration. This matches the accepted constraint that a `.js` runtime file is okay.
- This trial does not establish that the whole IntelliJ platform or arbitrary original plugins can run unchanged. GraalVM Native Image is an ahead-of-time closed-world compiler, so reflection, service loading, resources, dynamic class loading, and runtime initialization need separate compatibility tests.

### GraalVM initializer diagnosis (2026-10-19)

A staged diagnostic probe isolated the earliest failure to `com.intellij.lang.Language` initialization: directly accessing `Language.ANY` fails with `ExceptionInInitializerError` whose cause is `NullPointerException`. `Java11Shim.INSTANCE.mapOf()` and Kotlin persistent list/set factories work in separate Wasm probes, so those obvious dependencies are not independently failing. Subsequent `IElementType`, `PythonFileType`, `PyElementType`, and `PyTokenTypes` failures are cascading `NoClassDefFoundError`s after `Language` fails.

The next probe isolated the failure one layer earlier: `com.intellij.util.containers.VarHandleWrapper.getFactory()` itself throws `NullPointerException` under GraalVM Web Image. The same probe passes on the JVM: it resolves `com.intellij.concurrency.VarHandleWrapperImpl`, creates the factory, initializes `UserDataHolderBase`, and reads `Language.ANY`. A finer-grained Wasm probe confirms `Class.forName("com.intellij.concurrency.VarHandleWrapperImpl")` succeeds, but `ReflectionUtil.getMethod(..., "useVarHandlesInConcurrentCollections", empty parameter list)` returns `null`; direct `Class.getDeclaredMethod("useVarHandlesInConcurrentCollections")` throws `NoSuchMethodException`. The original JAR does contain this public static method, and both lookups succeed on the JVM. `VarHandleWrapper.getFactory()` passes the null result to `Objects.requireNonNull`, causing the NPE. This pins the current failure to missing/incomplete GraalVM Web Image reflection metadata for that method, not to the `Language` constructor or Kotlin collection factories.

A second build using GraalVM's `--initialize-at-run-time` for `Language`, `IElementType`, `PyElementType`, and `PyTokenTypes` compiled successfully but produced the same runtime initializer failure. Thus simply switching these classes from build-time to runtime initialization is **not a fix**. No workaround has been adopted. The generated probe and logs are kept under the Git-ignored `artifacts/.tools/graalvm-webimage-varhandle-probe/` folder.

A trial reflection configuration registering `useVarHandlesInConcurrentCollections()` made more reflective members reachable, but the Web Image build then failed during compilation in Graal's `WasmGCSingleThreadedAtomicsPhase`, on `VarHandleDoubles$FieldInstanceReadWrite.compareAndSet` / `compareAndExchange` (unhandled floating-point compare). The same failure reproduced with a minimal standalone `volatile double` + `VarHandle.compareAndSet` program, independently of IntelliJ.

### GraalVM source fix and verification (2026-10-19)

The exact source for the installed Oracle GraalVM 25.4.4.1.1 build was cloned from `oracle/graal` tag `graal-25.4.4.1.1` (commit `95ce1499c8c96ab7d5a6697c5b4bf42160f3b68b`) into the Git-ignored `artifacts/.tools/graalvm-source/`. The same `WasmGCSingleThreadedAtomicsPhase.java` code is still present on upstream `master` at commit `f3e6b127686224da0dd62cdf4ffe700900c41085` at the time checked.

Root cause: the Wasm GC CAS lowering reads the old value and calls `CompareNode.createCompareNode(..., EQ, oldValue, expectedValue, ...)` without handling float/double. That `CompareNode` overload only supports integer, object, and pointer equality and throws `GraalError.shouldNotReachHere` for `f64 EQ`. The Wasm GC phase therefore cannot lower a floating-point CAS even though it explicitly expands atomics into a non-atomic read/compare/write sequence for its single-threaded execution model.

A local source patch now reinterprets float/double CAS operands as same-width integers before comparing them. This preserves the raw-bit semantics of floating-point CAS, including signed zero and distinct NaN payloads; using ordinary floating-point equality would be incorrect. Added a Web Image regression test for successful and failed CAS on both `float` and `double`, signed zero, and distinct NaN payloads.

Verified results:

- **Before patch:** the minimal Wasm GC build failed in `WasmGCSingleThreadedAtomicsPhase.processCAS` with `unhandled compare ... Constant(1.0, f64) EQ`.
- **After patch:** GraalVM source build completed with `mx -p web-image build` using the source-matched LabsJDK and `mx` 7.85.1.
- **Regression test:** `mx -p web-image unittest VarHandleDoubleCASRegressionTest` passed with `-H:Backend=WASMGC` (`OK (1 test)`). The test compares JVM and Wasm GC output and verifies float/double raw-bit semantics.
- **Original plugin lexer:** rebuilt with the patched source-built Web Image compiler; the unmodified Python CE lexer passed at runtime and emitted `LEXER_OK tokens=22`.

The source patch and regression test are local in `artifacts/.tools/graalvm-source/` on branch `fix-wasmgc-floating-point-cas-master` (local commit `99d32d7a3f` based on upstream `master`); no JetBrains JARs were changed and nothing was pushed to GitHub. The regression test also passes when rebuilt against the current upstream `master` source, and the original lexer again passes with `LEXER_OK tokens=22`. This establishes a concrete GraalVM Web Image Wasm GC compiler bug in the tested version, not a claim that all of GraalVM is broken. The separate reflection metadata requirement remains a Web Image closed-world configuration issue for the IntelliJ platform.

No backend or server-side Java is introduced by this experiment.

### Isolated GraalVM Web Image compiler check (2026-10-19)

To determine whether the floating-point CAS failure was specific to IntelliJ, a minimal Java class was compiled separately. It declares a `volatile double`, obtains a `VarHandle` for that field, and calls `compareAndSet`. The same GraalVM Web Image compiler fails on this minimal example with `WasmGCSingleThreadedAtomicsPhase.processCAS` and `unhandled compare ... Constant(1.0, f64) EQ`. Therefore, this is a general compiler-path limitation/bug in the installed Oracle GraalVM 25.4.4.1.1 build, not something introduced by the Python lexer or IntelliJ classes.

The installed GraalVM is the newest GraalVM Oracle version exposed by the local SDKMAN version list (25.4.4+1); no newer Oracle GraalVM release was available there to test. The exposed expert options were checked for a supported VarHandle/floating-point-CAS/Web Image switch; none was found. `--initialize-at-run-time` does not fix it, and `-H:+EnableFallbackCompilation` is explicitly described by the compiler as a workaround, so it was not used. The isolated source, build log, and compiler error report are retained under the Git-ignored `artifacts/.tools/graalvm-webimage-double-cas-probe/` directory.

At this point there is no verified, supported configuration-only fix for the current GraalVM compiler. A correct fix would require the compiler to lower this single-threaded floating-point CAS correctly, or an approved change to the platform path that avoids using this VarHandle implementation. Neither has been applied. Do not treat a build that merely skips this path or swaps in a different implementation as success without explicit approval and behavioral tests.

### Original Python CE parser probe (2026-10-19)

The JVM parser experiment now uses the original `com.jetbrains.python.PythonParserDefinition` and `PyParser` instead of a handwritten parser definition. The minimal platform bootstrap is based on real IntelliJ classes: `MockApplication`, `ApplicationManager.setApplication`, the real `PyElementTypesFacadeImpl` service declared in the Python CE `intellij.python.psi.impl` module, and the real `Pythonid.dialectsTokenSetContributor` extension point with the three contributors declared in the original plugin descriptor. No IntelliJ classes or Python parsing behavior were replaced.

JVM reference results with the matching platform/Python CE JARs:

- `if True:\n    print(1)\n` — `PARSER_OK errors=0`.
- `print(1)` — `PARSER_OK errors=0`.
- `if True print(1)` — one parser error covering offsets `8..16`.
- `if True:` — one parser error at end-of-line, normalized by the probe to the final source character so it can be represented by the editor's non-empty diagnostic range contract.
- `def f(` and `x = (` produce parser error ranges at the end of the incomplete expression.

The probe lives at `java-probes/experiment/ParserProbe.java`. `experiments/plugin-build/profiles/python-ce-parser.json` records the Web Image profile. The first Wasm build failed during GraalVM analysis with `Incorrect single abstract method logic` for IntelliJ's `RefHashMap$Key`; a local ignored GraalVM source change added a JLS 9.8 fallback for `equals(Object)`, `hashCode()`, and `toString()` signatures. Runtime then exposed a JDK atomic-field-updater NPE because Web Image's `Reflection.getCallerClass()` returns `null`. The local source patch in `substratevm/.../RecomputedFields.java` skips caller-based access checks only for the null-caller case while retaining field/type/volatile validation and offset setup. A separate Web Image compiler fix maps `UNSTRUCTURED_LOCKING` to the appropriate `IllegalMonitorStateException` support method. After rebuilding the custom compiler, the standalone updater and `SupervisorJob()` probes pass, and the original parser runs in Wasm: a valid fixture prints `PARSER_OK errors=0`, while `if True print(1)` yields a real parser error range `8..16`. The original `PyUnresolvedReferencesInspection` is not yet verified in Wasm: the inspection harness reaches the real `TypeEvalContextFactoryImpl` but then needs the Python plugin's declared registry key `python.optimized.type.eval.context` loaded through real plugin descriptor/registry initialization. `asd()` is not yet confirmed as an unresolved-reference diagnostic. No JetBrains JAR was patched and no handwritten resolver was added.
