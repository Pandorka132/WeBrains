# Python Community Edition compatibility experiment

This folder isolates the first plugin compatibility investigation for WebBrains.

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
4. Only then attempt a GraalVM Web Image proof of concept for the smallest viable Java/Kotlin subset.
5. Keep running user Python code separate from IDE/plugin code; Pyodide is the intended browser-side execution runtime.

## Important technical risk

GraalVM Web Image performs ahead-of-time compilation of an application to WebAssembly; it is not, by itself, a JVM that can freely load arbitrary, previously unknown plugin JARs at runtime. A plugin compiled into an image must be included in that image's build-time program and supported by closed-world analysis. The Python CE distribution depends on a large IntelliJ Platform API surface, so loading the full original plugin unmodified is **not yet demonstrated** and may require substantial platform compatibility work.

The local machine has GraalVM 25.0.3 installed, but `wasm-as` (Binaryen) was not found during the initial environment check. A minimal Web Image build therefore has a toolchain prerequisite to resolve before that part of the experiment.

No backend or server-side Java is introduced by this experiment.
